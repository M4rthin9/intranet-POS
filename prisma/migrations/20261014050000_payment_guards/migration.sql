CREATE UNIQUE INDEX "Payment_pending_account" ON "Payment" ("accountId") WHERE "status" IN ('PENDING', 'AWAITING_CONFIRMATION');
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_positive_amount" CHECK ("amountSatang" > 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_positive_amount" CHECK ("amountSatang" > 0);
