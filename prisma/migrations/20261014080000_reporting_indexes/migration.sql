CREATE INDEX "Order_eventId_status_createdAt_idx" ON "Order" ("eventId","status","createdAt");
CREATE INDEX "Payment_eventId_confirmedAt_idx" ON "Payment" ("eventId","confirmedAt");
CREATE INDEX "Payment_eventId_voidedAt_idx" ON "Payment" ("eventId","voidedAt");
CREATE INDEX "Registration_eventId_createdAt_idx" ON "Registration" ("eventId","createdAt");
CREATE INDEX "AuditLog_eventId_action_createdAt_idx" ON "AuditLog" ("eventId","action","createdAt");
