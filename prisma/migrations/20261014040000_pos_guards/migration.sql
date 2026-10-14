CREATE UNIQUE INDEX "Shift_open_user" ON "Shift" ("userId") WHERE "closedAt" IS NULL;
CREATE UNIQUE INDEX "Shift_open_station" ON "Shift" ("stationId") WHERE "closedAt" IS NULL;
CREATE UNIQUE INDEX "QrCredential_active_account" ON "QrCredential" ("accountId") WHERE "revokedAt" IS NULL;
ALTER TABLE "Product" ADD CONSTRAINT "Product_positive_price" CHECK ("priceSatang" > 0 AND "priceSatang" <= 1000000);
ALTER TABLE "Order" ADD CONSTRAINT "Order_positive_total" CHECK ("totalSatang" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_exact_total" CHECK ("quantity" > 0 AND "unitPriceSatang" > 0 AND "lineTotalSatang" = "unitPriceSatang"::bigint * "quantity");
