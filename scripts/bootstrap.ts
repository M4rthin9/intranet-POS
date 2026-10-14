import 'dotenv/config';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { rolePermissions, permissions } from '../src/lib/rbac';
import { audit } from '../src/lib/audit';
import type { RoleName } from '@prisma/client';
async function main() {
  const username = process.env.BOOTSTRAP_USERNAME;
  const password = process.env.BOOTSTRAP_PASSWORD;
  if (!username || !password || password.length < 14)
    throw new Error(
      'Provide BOOTSTRAP_USERNAME and a password of at least 14 characters through the environment.',
    );
  await db.$transaction(async (tx) => {
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
    if (await tx.user.findFirst({ where: { roleName: 'SUPER_ADMIN' } }))
      throw new Error(
        'A super administrator already exists; bootstrap will not overwrite accounts.',
      );
    const user = await tx.user.create({
      data: {
        username,
        displayName: 'ผู้ดูแลระบบสูงสุด',
        roleName: 'SUPER_ADMIN',
        passwordHash: hashPassword(password),
      },
    });
    for (const [code, type] of [
      ['REG-01', 'REGISTRATION'],
      ['POS-01', 'POS'],
      ['POS-02', 'POS'],
      ['PAY-01', 'PAYMENT'],
      ['ADMIN-01', 'ADMIN'],
    ] as const)
      await tx.station.upsert({ where: { code }, create: { code, name: code, type }, update: {} });
    await audit(tx, { id: user.id, roleName: 'SUPER_ADMIN' }, 'USER_CREATE', 'User', user.id, {
      after: { username, roleName: 'SUPER_ADMIN' },
      reason: 'Initial production bootstrap',
    });
  });
  console.log('Administrator and stations initialized. No sample financial data was inserted.');
}
main().finally(() => db.$disconnect());
