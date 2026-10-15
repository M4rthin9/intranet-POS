import type { RoleName } from '@prisma/client';
import type { Tx } from './db';
import { permissions, rolePermissions } from './rbac';

/** Add the application's fixed roles and grants without removing existing records. */
export async function initializeRoles(tx: Tx) {
  for (const key of permissions)
    await tx.permission.upsert({ where: { key }, create: { key }, update: {} });
  for (const name of Object.keys(rolePermissions) as RoleName[]) {
    await tx.role.upsert({ where: { name }, create: { name }, update: {} });
    for (const permissionKey of rolePermissions[name])
      await tx.rolePermission.upsert({
        where: { roleName_permissionKey: { roleName: name, permissionKey } },
        create: { roleName: name, permissionKey },
        update: {},
      });
  }
}
