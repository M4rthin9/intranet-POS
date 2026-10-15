INSERT INTO "Role" ("name") VALUES ('ADMIN'), ('REGISTRATION_CASHIER') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" ("key") VALUES
('dashboard.view'), ('registration.create'), ('registration.view'), ('registration.update'),
('registration.qr.create'), ('registration.qr.reprint'), ('registration.qr.block'),
('registration.qr.reissue'), ('event.view'), ('station.view'), ('shift.manage')
ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleName", "permissionKey") VALUES ('ADMIN', 'dashboard.view') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleName", "permissionKey")
SELECT 'REGISTRATION_CASHIER'::"RoleName", "key" FROM "Permission"
WHERE "key" IN ('registration.create', 'registration.view', 'registration.update',
'registration.qr.create', 'registration.qr.reprint', 'registration.qr.block',
'registration.qr.reissue', 'event.view', 'station.view', 'shift.manage')
ON CONFLICT DO NOTHING;
