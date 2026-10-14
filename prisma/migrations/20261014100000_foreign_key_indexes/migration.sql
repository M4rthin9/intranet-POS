CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem" ("orderId");
CREATE INDEX "PaymentAllocation_orderId_idx" ON "PaymentAllocation" ("orderId");
CREATE INDEX "Order_accountId_status_idx" ON "Order" ("accountId","status");
CREATE INDEX "Payment_accountId_status_idx" ON "Payment" ("accountId","status");
CREATE INDEX "StockMovement_inventoryId_createdAt_idx" ON "StockMovement" ("inventoryId","createdAt");
