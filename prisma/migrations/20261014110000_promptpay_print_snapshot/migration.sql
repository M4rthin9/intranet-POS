ALTER TABLE "Payment" ADD COLUMN "recipientNameSnapshot" TEXT;
INSERT INTO "Permission" ("key") VALUES ('payment.promptpay.print') ON CONFLICT DO NOTHING;
INSERT INTO "Role" ("name") VALUES ('PAYMENT_CASHIER') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleName", "permissionKey") VALUES ('PAYMENT_CASHIER', 'payment.promptpay.print') ON CONFLICT DO NOTHING;
