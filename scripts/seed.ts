import { loadTestEnvironment } from './test-database';

// Load the test connection before importing Prisma or any service that uses it.

async function main() {
  loadTestEnvironment();
  const { seedTestData } = await import('./seed-data');
  const { db } = await import('../src/lib/db');
  try {
    const result = await seedTestData({
      password: process.env.SEED_PASSWORD,
      promptPayPhone: process.env.SEED_PROMPTPAY_PHONE,
    });
    console.log(JSON.stringify(result, null, 2));
    console.log(
      'Test seed complete. Existing account passwords and operational data were preserved.',
    );
    console.log('New users use SEED_PASSWORD, or CCIDA-Test-2026! when it is unset.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Prisma errors can include connection details; report a plain application message only.
  console.error(
    error instanceof Error && error.name === 'Error'
      ? error.message
      : 'Seed failed. Check the isolated test database and migrations.',
  );
  process.exitCode = 1;
});
