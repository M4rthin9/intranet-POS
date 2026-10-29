ALTER TYPE "PosPaymentMode" ADD VALUE 'PREPAID';
ALTER TABLE "Payment" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'SALE';
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_purpose_check" CHECK ("purpose" IN ('SALE', 'WALLET_TOPUP'));
CREATE INDEX "Payment_accountId_purpose_status_idx" ON "Payment"("accountId", "purpose", "status");

-- Keep ordinary settlement exact. A top-up may retain unspent credit, but may never be overspent.
CREATE FUNCTION ccida_check_payment(payment_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p "Payment"; allocated bigint;
BEGIN
  SELECT * INTO p FROM "Payment" WHERE id=payment_id;
  SELECT COALESCE(SUM(a."amountSatang"),0) INTO allocated
    FROM "PaymentAllocation" a JOIN "Order" o ON o.id=a."orderId"
    WHERE a."paymentId"=p.id AND (p.purpose='SALE' OR o.status<>'VOIDED');
  IF p.status='CONFIRMED' THEN
    IF p."confirmedAt" IS NULL OR p.reference IS NULL OR p.evidence IS NULL OR
       (p.purpose='SALE' AND allocated<>p."amountSatang") OR
       (p.purpose='WALLET_TOPUP' AND allocated>p."amountSatang") THEN
      RAISE EXCEPTION 'Confirmed payment must have evidence and balanced allocations';
    END IF;
  ELSIF p.purpose='WALLET_TOPUP' AND allocated<>0 THEN
    RAISE EXCEPTION 'Spent wallet credit cannot be voided or refunded';
  END IF;
END; $$;

CREATE FUNCTION ccida_check_order(order_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o "Order"; item_total bigint; paid bigint;
BEGIN
  SELECT * INTO o FROM "Order" WHERE id=order_id;
  SELECT COALESCE(SUM("lineTotalSatang"),0) INTO item_total FROM "OrderItem" WHERE "orderId"=o.id;
  SELECT COALESCE(SUM(a."amountSatang"),0) INTO paid
    FROM "PaymentAllocation" a JOIN "Payment" p ON p.id=a."paymentId"
    WHERE a."orderId"=o.id AND p.status='CONFIRMED' AND (o.status<>'VOIDED' OR p.purpose='SALE');
  IF item_total<>o."totalSatang" OR (o.status='PAID' AND paid<>o."totalSatang") OR
     (o.status<>'PAID' AND paid<>0) THEN
    RAISE EXCEPTION 'Order status and confirmed allocations must reconcile';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION ccida_allocation_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Payment"; o "Order";
BEGIN
  -- Serializing allocations against their funding payment prevents concurrent overspending.
  SELECT * INTO p FROM "Payment" WHERE id=NEW."paymentId" FOR UPDATE;
  SELECT * INTO o FROM "Order" WHERE id=NEW."orderId";
  IF p."accountId"<>o."accountId" OR p."eventId"<>o."eventId" OR NEW."amountSatang"<=0 OR
     (p.purpose='SALE' AND NEW."amountSatang"<>o."totalSatang") OR
     (p.purpose='WALLET_TOPUP' AND (p.status<>'CONFIRMED' OR NEW."amountSatang">o."totalSatang")) THEN
    RAISE EXCEPTION 'Allocation must match order/account/event and confirmed wallet funds';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION ccida_payment_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ccida_check_payment(NEW.id);
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION ccida_order_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocation RECORD;
BEGIN
  PERFORM ccida_check_order(NEW.id);
  FOR allocation IN SELECT "paymentId" FROM "PaymentAllocation" WHERE "orderId"=NEW.id LOOP
    PERFORM ccida_check_payment(allocation."paymentId");
  END LOOP;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION ccida_child_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ccida_check_order(NEW."orderId");
  IF TG_TABLE_NAME='PaymentAllocation' THEN
    PERFORM ccida_check_payment(NEW."paymentId");
  END IF;
  RETURN NEW;
END; $$;
