ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_balance" CHECK ("openingStock">=0 AND "soldQuantity">=0 AND "remainingStock">=0 AND "remainingStock"::bigint="openingStock"::bigint-"soldQuantity"+"adjustments");
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_guest_count" CHECK ("guestCount">0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_threshold" CHECK ("lowStockThreshold">=0);
CREATE FUNCTION ccida_shift_closed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."closedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Closed shift is immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['closedAt','summary']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['closedAt','summary']) THEN RAISE EXCEPTION 'Shift identity is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "Shift_close_immutable" BEFORE UPDATE ON "Shift" FOR EACH ROW EXECUTE FUNCTION ccida_shift_closed();
