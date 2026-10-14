CREATE FUNCTION ccida_deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME; END; $$;
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ccida_deny_mutation();
CREATE TRIGGER "StockMovement_append_only" BEFORE UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION ccida_deny_mutation();
CREATE TRIGGER "PaymentAllocation_append_only" BEFORE UPDATE OR DELETE ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION ccida_deny_mutation();
CREATE TRIGGER "OrderItem_immutable" BEFORE UPDATE OR DELETE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION ccida_deny_mutation();
CREATE TRIGGER "IdempotencyRecord_immutable" BEFORE UPDATE OR DELETE ON "IdempotencyRecord" FOR EACH ROW EXECUTE FUNCTION ccida_deny_mutation();
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['Order','Payment','Receipt','Registration','CustomerAccount','QrCredential','Shift'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ccida_deny_mutation()',table_name||'_no_delete',table_name);
  END LOOP;
END; $$;
CREATE FUNCTION ccida_order_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','voidReason','voidedAt','voidedBy']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','voidReason','voidedAt','voidedBy']) THEN RAISE EXCEPTION 'Recorded financial facts are immutable'; END IF;
  IF OLD."status" = 'VOIDED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Voided order is immutable'; END IF;
  IF NEW."status"='VOIDED' AND (NEW."voidReason" IS NULL OR length(trim(NEW."voidReason"))<3 OR NEW."voidedBy" IS NULL OR NEW."voidedAt" IS NULL) THEN RAISE EXCEPTION 'Void requires reason, actor and timestamp'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "Order_financial_immutable" BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION ccida_order_immutable();
CREATE FUNCTION ccida_payment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','reference','evidence','confirmedAt','userId','stationId','shiftId','voidReason','voidedAt','voidedBy']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','reference','evidence','confirmedAt','userId','stationId','shiftId','voidReason','voidedAt','voidedBy']) THEN RAISE EXCEPTION 'Payment financial facts are immutable'; END IF;
  IF OLD."status" IN ('CONFIRMED','VOIDED','REFUNDED') AND (to_jsonb(NEW) - ARRAY['status','voidReason','voidedAt','voidedBy']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','voidReason','voidedAt','voidedBy']) THEN RAISE EXCEPTION 'Confirmed payment evidence is immutable'; END IF;
  IF OLD."status" IN ('VOIDED','REFUNDED') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Corrected payment is immutable'; END IF;
  IF NEW."status" IN ('VOIDED','REFUNDED') AND (NEW."voidReason" IS NULL OR length(trim(NEW."voidReason"))<3 OR NEW."voidedBy" IS NULL OR NEW."voidedAt" IS NULL) THEN RAISE EXCEPTION 'Correction requires reason, actor and timestamp'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "Payment_financial_immutable" BEFORE UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION ccida_payment_immutable();
CREATE FUNCTION ccida_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'printCount') IS DISTINCT FROM (to_jsonb(OLD)-'printCount') OR NEW."printCount"<>OLD."printCount"+1 THEN RAISE EXCEPTION 'Receipt snapshot is immutable; print count can only increment'; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "Receipt_snapshot_immutable" BEFORE UPDATE ON "Receipt" FOR EACH ROW EXECUTE FUNCTION ccida_receipt_immutable();
CREATE FUNCTION ccida_allocation_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Payment"; o "Order";
BEGIN
 SELECT * INTO p FROM "Payment" WHERE "id"=NEW."paymentId"; SELECT * INTO o FROM "Order" WHERE "id"=NEW."orderId";
 IF p."accountId"<>o."accountId" OR p."eventId"<>o."eventId" OR NEW."amountSatang"<>o."totalSatang" THEN RAISE EXCEPTION 'Allocation must exactly match order/account/event'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "PaymentAllocation_valid" BEFORE INSERT ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION ccida_allocation_valid();
CREATE FUNCTION ccida_payment_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_payment "Payment"; allocated bigint;
BEGIN
 SELECT * INTO current_payment FROM "Payment" WHERE "id"=NEW."id";
 IF current_payment."status"='CONFIRMED' THEN
   SELECT COALESCE(SUM("amountSatang"),0) INTO allocated FROM "PaymentAllocation" WHERE "paymentId"=NEW."id";
   IF allocated<>current_payment."amountSatang" OR current_payment."confirmedAt" IS NULL OR current_payment."reference" IS NULL OR current_payment."evidence" IS NULL THEN RAISE EXCEPTION 'Confirmed payment must have evidence and balanced allocations'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "Payment_balance" AFTER INSERT OR UPDATE ON "Payment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ccida_payment_balanced();
CREATE FUNCTION ccida_order_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_order "Order"; paid bigint; item_total bigint;
BEGIN
 SELECT * INTO current_order FROM "Order" WHERE "id"=NEW."id";
 SELECT COALESCE(SUM("lineTotalSatang"),0) INTO item_total FROM "OrderItem" WHERE "orderId"=NEW."id";
 IF item_total<>current_order."totalSatang" THEN RAISE EXCEPTION 'Order item total must match order'; END IF;
 SELECT COALESCE(SUM(a."amountSatang"),0) INTO paid FROM "PaymentAllocation" a JOIN "Payment" p ON p."id"=a."paymentId" WHERE a."orderId"=NEW."id" AND p."status"='CONFIRMED';
 IF (current_order."status"='PAID' AND paid<>current_order."totalSatang") OR (current_order."status"<>'PAID' AND paid<>0) THEN RAISE EXCEPTION 'Order status and confirmed allocations must reconcile'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "Order_balance" AFTER INSERT OR UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ccida_order_balanced();
CREATE FUNCTION ccida_child_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item_sum bigint; order_total integer; order_status "OrderStatus"; paid bigint; payment_total integer; payment_status "PaymentStatus"; allocated bigint;
BEGIN
 SELECT "totalSatang","status" INTO order_total,order_status FROM "Order" WHERE "id"=NEW."orderId";
 SELECT COALESCE(SUM("lineTotalSatang"),0) INTO item_sum FROM "OrderItem" WHERE "orderId"=NEW."orderId";
 SELECT COALESCE(SUM(a."amountSatang"),0) INTO paid FROM "PaymentAllocation" a JOIN "Payment" p ON p."id"=a."paymentId" WHERE a."orderId"=NEW."orderId" AND p."status"='CONFIRMED';
 IF item_sum<>order_total OR (order_status='PAID' AND paid<>order_total) OR (order_status<>'PAID' AND paid<>0) THEN RAISE EXCEPTION 'Financial child records must reconcile with order'; END IF;
 IF TG_TABLE_NAME='PaymentAllocation' THEN
   SELECT "amountSatang","status" INTO payment_total,payment_status FROM "Payment" WHERE "id"=NEW."paymentId";
   SELECT COALESCE(SUM("amountSatang"),0) INTO allocated FROM "PaymentAllocation" WHERE "paymentId"=NEW."paymentId";
   IF payment_status='CONFIRMED' AND allocated<>payment_total THEN RAISE EXCEPTION 'Allocation total must match confirmed payment'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "OrderItem_balance" AFTER INSERT ON "OrderItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ccida_child_balanced();
CREATE CONSTRAINT TRIGGER "PaymentAllocation_balance" AFTER INSERT ON "PaymentAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ccida_child_balanced();
