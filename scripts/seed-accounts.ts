import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { initializeRoles } from '../src/lib/initialize-roles';
import { audit } from '../src/lib/audit';

const accounts = [
  {
    username: 'superadmin',
    roleName: 'SUPER_ADMIN',
    displayName: 'Super Administrator',
  },
  { username: 'admin', roleName: 'ADMIN', displayName: 'Administrator' },
  { username: 'cashier.pos', roleName: 'CASHIER', displayName: 'POS Cashier' },
  {
    username: 'cashier.payment',
    roleName: 'PAYMENT_CASHIER',
    displayName: 'Payment Cashier',
  },
  {
    username: 'cashier.register',
    roleName: 'REGISTRATION_CASHIER',
    displayName: 'Registration Cashier',
  },
] as const;

const manifestSchema = z
  .array(
    z.object({
      username: z.string(),
      roleName: z.string(),
      displayName: z.string().min(1),
      password: z.string().min(14).max(256),
    }),
  )
  .length(accounts.length);

async function main() {
  const file = resolve(
    process.env.SEED_ACCOUNTS_FILE ?? '.local/credentials/production-accounts.json',
  );
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  // Persist before the transaction so a failed/interrupted run can reuse the same secrets.
  // Exclusive creation prevents a rerun from replacing the administrator's handover file.
  try {
    await writeFile(
      file,
      JSON.stringify(
        accounts.map((account) => ({
          ...account,
          password: randomBytes(24).toString('base64url'),
        })),
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const credentials = manifestSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  for (const account of accounts) {
    if (
      credentials.filter(
        (entry) => entry.username === account.username && entry.roleName === account.roleName,
      ).length !== 1
    )
      throw new Error(
        'The credentials file must contain exactly one entry for every production role.',
      );
  }
  // Hash outside the transaction: strong scrypt must not consume its timeout.
  const prepared = credentials.map((entry) => ({
    ...entry,
    passwordHash: hashPassword(entry.password),
  }));
  const result = await db.$transaction(
    async (tx) => {
      await initializeRoles(tx);
      const results = [];
      for (const account of accounts) {
        const existing = await tx.user.findUnique({
          where: { username: account.username },
        });
        if (existing) {
          if (existing.roleName !== account.roleName)
            throw new Error(
              'A seed username already belongs to a different role. No accounts were changed.',
            );
          results.push({
            username: account.username,
            role: account.roleName,
            status: 'preserved',
          });
          continue;
        }
        const credential = prepared.find((entry) => entry.username === account.username)!;
        const user = await tx.user.create({
          data: {
            ...account,
            passwordHash: credential.passwordHash,
            active: true,
          },
        });
        await audit(
          tx,
          { id: 'production-account-seed', roleName: 'SUPER_ADMIN' },
          'USER_CREATE',
          'User',
          user.id,
          {
            after: { username: user.username, roleName: user.roleName },
            reason: 'Account-only production initialization',
          },
        );
        results.push({
          username: account.username,
          role: account.roleName,
          status: 'created',
        });
      }
      return results;
    },
    { timeout: 30000 },
  );
  console.table(result);
  console.log(`Credentials file: ${file}. Preserved accounts retain their existing passwords.`);
  console.log(
    'Account seed complete. No events, products, stations or transactions were inserted.',
  );
}

main()
  .catch(() => {
    console.error(
      'Account seed failed. Check database access and the private credentials file; no existing passwords are overwritten.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
