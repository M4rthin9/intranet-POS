import '../tests/setup';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { salesFixture } from '../tests/sales-helpers';
import { registrationAction } from '../src/lib/registration';
import { orderAction } from '../src/lib/orders';
import { report } from '../src/lib/reports';
import { db } from '../src/lib/db';
async function main() {
  const f = await salesFixture();
  const tokens: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = (await registrationAction(f.actors.ADMIN, 'registration.create', {
      eventId: f.event.id,
      stationId: f.stations[0].id,
      customerName: `Concurrent customer ${i}`,
    })) as unknown as { token: string };
    tokens.push(r.token);
  }
  const timings: number[] = [];
  const start = performance.now();
  const results = await Promise.allSettled(
    tokens.map(async (token) => {
      const began = performance.now();
      const order = await orderAction(f.actors.CASHIER, 'order.create', {
        ...f.orderInput(),
        key: randomUUID(),
        token,
      });
      timings.push(performance.now() - began);
      return order;
    }),
  );
  const wallMs = performance.now() - start;
  const reportStart = performance.now();
  const summary = await report(f.actors.SUPER_ADMIN, f.event.id);
  const reportMs = performance.now() - reportStart;
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const metadata = {
    date: new Date().toISOString(),
    concurrentRequests: 10,
    committed: fulfilled,
    failed: 10 - fulfilled,
    wallMs: Math.round(wallMs),
    checkoutMaxMs: Math.round(Math.max(...timings)),
    reportMs: Math.round(reportMs),
    reconciled: summary.reconciled,
    scope:
      'Isolated PostgreSQL 18 test database on the development host; not a target-hardware capacity certification.',
  };
  await writeFile('docs/validation/final/performance.json', JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify(metadata));
  assert.equal(fulfilled, 10, 'Every independent-account concurrent checkout must commit.');
  assert.equal(summary.netSalesSatang, 45500);
  assert.ok(summary.reconciled);
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : 'Performance validation failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
