-- Preserve existing records/counters while eliminating a shared transactional row bottleneck.
CREATE SEQUENCE ccida_registration_number AS bigint NO CYCLE;
CREATE SEQUENCE ccida_order_number AS bigint NO CYCLE;
CREATE SEQUENCE ccida_payment_number AS bigint NO CYCLE;
SELECT setval('ccida_registration_number',GREATEST(1,COALESCE((SELECT MAX(split_part("number",'-',3)::bigint) FROM "Registration" WHERE "number"~'^REG-[0-9]{8}-[0-9]+$'),0),COALESCE((SELECT MAX("value") FROM "Sequence" WHERE "key" LIKE 'REG-%'),0)),EXISTS(SELECT 1 FROM "Registration") OR EXISTS(SELECT 1 FROM "Sequence" WHERE "key" LIKE 'REG-%' AND "value">0));
SELECT setval('ccida_order_number',GREATEST(1,COALESCE((SELECT MAX(split_part("number",'-',3)::bigint) FROM "Order" WHERE "number"~'^ORD-[0-9]{8}-[0-9]+$'),0),COALESCE((SELECT MAX("value") FROM "Sequence" WHERE "key" LIKE 'ORD-%'),0)),EXISTS(SELECT 1 FROM "Order") OR EXISTS(SELECT 1 FROM "Sequence" WHERE "key" LIKE 'ORD-%' AND "value">0));
SELECT setval('ccida_payment_number',GREATEST(1,COALESCE((SELECT MAX(split_part("number",'-',3)::bigint) FROM "Payment" WHERE "number"~'^PAY-[0-9]{8}-[0-9]+$'),0),COALESCE((SELECT MAX("value") FROM "Sequence" WHERE "key" LIKE 'PAY-%'),0)),EXISTS(SELECT 1 FROM "Payment") OR EXISTS(SELECT 1 FROM "Sequence" WHERE "key" LIKE 'PAY-%' AND "value">0));
