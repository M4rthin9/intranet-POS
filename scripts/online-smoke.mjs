// Operational acceptance: authenticates existing accounts; creates no sales/test fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = process.env.APP_ORIGIN ?? 'https://cccpos.dpdns.org';
const secure = new URL(origin).protocol === 'https:';
const accounts = process.env.POS_ACCOUNTS_FILE
  ? JSON.parse(readFileSync(resolve(process.env.POS_ACCOUNTS_FILE), 'utf8'))
  : [];
if (process.argv.includes('--enable-backups') && !accounts.length)
  throw Error(
    'Set POS_ACCOUNTS_FILE to a protected file containing current authorized credentials before changing backup settings.',
  );
async function call(path, options = {}) {
  return fetch(origin + path, {
    ...options,
    signal: AbortSignal.timeout(60000),
    redirect: 'manual',
  });
}
assert.equal((await call('/api/health')).status, 200);
assert.equal((await call('/feedback')).status, 200);
assert.equal((await call('/api/auth')).status, 401);
assert.equal(
  (
    await call('/api/auth', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{"username":"","password":""}',
    })
  ).status,
  400,
);
for (const account of accounts) {
  const response = await call('/api/auth', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: account.username, password: account.password }),
  });
  assert.equal(response.status, 200, `${account.roleName} login`);
  assert.equal((await response.json()).user.roleName, account.roleName);
  const setCookie = response.headers.get('set-cookie');
  if (secure) assert.match(setCookie, /;\s*Secure(?:;|$)/i);
  else assert.doesNotMatch(setCookie, /;\s*Secure(?:;|$)/i);
  assert.match(setCookie, /;\s*HttpOnly(?:;|$)/i);
  assert.match(setCookie, /SameSite=Strict/i);
  const Cookie = setCookie.split(';')[0];
  try {
    assert.equal((await call('/api/auth', { headers: { Cookie } })).status, 200);
    assert.equal(
      (await call('/api/data?view=settings', { headers: { Cookie } })).status,
      account.roleName === 'SUPER_ADMIN' ? 200 : 403,
    );
    if (account.roleName === 'SUPER_ADMIN' && process.argv.includes('--enable-backups')) {
      const schedule = await call('/api/operations', {
        method: 'POST',
        headers: { Origin: origin, Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'backup.schedule',
          input: { enabled: true, intervalHours: 1 },
        }),
      });
      assert.equal(schedule.status, 200, 'Enable hourly audited application backups');
      const backup = await call('/api/backup', {
        method: 'POST',
        headers: { Origin: origin, Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Online POS commissioning backup' }),
      });
      assert.equal(backup.status, 200, 'Create registered commissioning backup');
      console.log('PASS hourly backup scheduling and registered application backup');
    }
    console.log(`PASS ${origin} authentication and role checks: ${account.roleName}`);
  } finally {
    assert.equal(
      (await call('/api/auth', { method: 'DELETE', headers: { Origin: origin, Cookie } })).status,
      200,
    );
  }
}
assert.equal(
  (
    await call('/api/auth', {
      method: 'POST',
      headers: { Origin: 'https://wrong.example', 'Content-Type': 'application/json' },
      body: '{}',
    })
  ).status,
  403,
);
console.log(
  `PASS ${origin}: health, feedback, anonymous denial, valid-origin validation and wrong-origin rejection`,
);
if (!accounts.length)
  console.log(
    'Credential checks skipped: set POS_ACCOUNTS_FILE to a protected file of current authorized accounts to test roles/cookies/logout.',
  );
