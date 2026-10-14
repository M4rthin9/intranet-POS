import '../tests/setup';
import { db } from '../src/lib/db';
import { writeFile } from 'node:fs/promises';
async function main() {
  const clock = await db.$queryRaw<
    Array<{ timezone: string; clock: Date }>
  >`SELECT current_setting('TimeZone') AS timezone, NOW() AS clock`;
  const order = await db.order.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const hours = await db.$queryRaw<
    Array<{ label: string }>
  >`SELECT to_char("createdAt" AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD HH24:00') AS label FROM "Order" WHERE "id"=${order.id}`;
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const metadata = {
    clientUtc: new Date().toISOString(),
    databaseTimezone: clock[0].timezone,
    databaseUtc: clock[0].clock.toISOString(),
    orderUtc: order.createdAt.toISOString(),
    chartHour: hours[0].label,
    expectedThaiHour: formatter.format(order.createdAt) + ':00',
  };
  await writeFile('docs/validation/final/timezone-check.json', JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify(metadata));
}
main().finally(() => db.$disconnect());
