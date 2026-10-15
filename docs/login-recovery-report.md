# Login 503 recovery

Date: 15 October 2026 · Asia/Bangkok.

The live development app at http://localhost:3000 was running with the correct guarded test profile, but its PostgreSQL cluster on 127.0.0.1:55432 was stopped. `/api/health` and login returned 503. The PostgreSQL log recorded an interrupted shutdown; restarting the existing cluster completed automatic recovery before it accepted connections. No reset, initialization, migration repair or credential replacement was performed. The separate PostgreSQL service on port 5432 was left untouched.

After recovery, live health returned 200 and all six existing demo accounts signed in with HTTP 200 and their original roles. Runtime `.env` and `.env.test` credentials were preserved. Existing passwords and business records were not deleted or reset.

## Changes

`npm run dev` / `dev:test` now verify an authenticated database connection before starting Next.js. For the existing Windows workspace cluster only, the launcher can start `.local/postgres` at loopback port 55432 using matching PostgreSQL tools. It uses a hidden detached launcher, verifies that the resolved data directory stays inside the workspace, and waits up to three minutes for recovery. It never initializes a cluster, resets data, stops a running server, creates roles/databases or starts a different database service. Other endpoints must be started/configured by their owner. Invalid targets, wrong credentials and incompatible tools fail with a clear startup diagnostic.

Standalone readiness/recovery command:

```powershell
npm run db:test:ready
```

Login database errors now return 503 with `DATABASE_UNAVAILABLE`, `Retry-After: 5` and a clear instruction to retry sign-in once the database is ready. Credentials and raw connection errors are excluded from responses/logs. Invalid passwords remain 401; record conflicts remain 409. Financial operations retain their original safe-retry message and request-key behavior. The login form keeps its inputs in memory for manual retry; passwords are not stored in session storage.

## Validation

All checks PASS: 44 tests across 16 files, 42 main production-server/browser checks, dedicated real login-outage/retry acceptance, HTTP LAN checkout, database/twelve migrations, lint, typecheck, production build and formatting. The live app at port 3000 remains healthy; all six original demo logins returned 200.

Current results: [phase 8 gates](validation/phase-8/results.md), [main browser acceptance](validation/final/results.json) and [dedicated login outage/recovery check](validation/login-recovery/results.json). New regression cases cover missing Prisma initialization codes, response privacy, failure status/cookies, financial retry semantics, authenticated readiness without record changes, runtime-target rejection and refusal to launch PostgreSQL for a foreign endpoint.

The dedicated browser check runs an actual production server with an unavailable database, verifies 503/no cookie and retained login inputs, then reconnects that owned test server to the healthy isolated database. The same form succeeds without re-entering credentials and opens the correct cashier page, creating one session and one LOGIN audit. It leaves the live app and existing users untouched. Evidence: [unavailable login](validation/login-recovery/login-unavailable.png) and [successful retry](validation/login-recovery/login-recovered.png).

Production `npm start` and explicit `dev:runtime` continue to use runtime configuration and do not auto-start or substitute test databases. The preserved runtime `in-pos` connection still requires its own valid database/role credentials before production commissioning.
