# Local test server recovery

Date: 14 October 2026. Status: **RESOLVED FOR TESTING**.

The application at http://localhost:3000 returned HTTP 503 for database health and the generic safe-retry message for database-backed operations. Its runtime configuration referred to database `in-pos` and role `postgres` on port 55432. Neither exists in the workspace's isolated PostgreSQL cluster. The seeded `ccida_test` database and its role were available.

Added `npm run dev:test` and a shared test-configuration loader. The launcher selects TEST_DATABASE_URL from `.env.test`, validates the PostgreSQL `_test` database guard, preserves the configured application origin and starts Next.js with the selected connection in its process environment. Seed startup now uses the same loader. Production mode remains prohibited for this test command.

Restarted only this workspace's application processes at the same address with the seeded test configuration. Runtime `.env`, financial records, client retry intents and transaction submission keys were preserved. No database/role was created, reset or deleted. Following the complete function review, `npm run dev` defaults to this guarded test profile. `dev:runtime` and production `npm start` require valid runtime configuration.

Verified database health HTTP 200; successful HTTP login and access to the seeded event for all five demo users; successful browser login, event selection and zero browser errors. Lint, typecheck, formatting and both seed safety tests passed, including interrupted/concurrent replay and preservation of passwords, disabled users and closed events. The underlying application production build was already verified after the preceding stylesheet fix; this recovery changes development startup scripts only.

Future test startup:

```powershell
npm run dev:test
```

Stop an existing instance on the same port before starting another. For test credentials and configuration, see [test seed guide](test-seed.md). Server output for the background instance is under `.local/server-recovery/`.
