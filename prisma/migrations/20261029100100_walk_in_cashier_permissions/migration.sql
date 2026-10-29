INSERT INTO "Role" ("name") VALUES ('WALK_IN_CASHIER');
INSERT INTO "RolePermission" ("roleName", "permissionKey")
SELECT 'WALK_IN_CASHIER', "permissionKey" FROM "RolePermission" WHERE "roleName" = 'CASHIER';
