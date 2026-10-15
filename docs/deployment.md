# Production and intranet deployment

## Current workspace

PostgreSQL 18 binaries are installed at `C:\Program Files\PostgreSQL\18\bin`. The implementation initialized a separate loopback-only cluster under `.local/postgres` on port 55432 with isolated `ccida_dev` and `ccida_test` databases. The installed PostgreSQL service and its data were not modified.

The authorized clean reset on 2026-10-15 replaced the application database with an empty migrated installation containing one real account per role. Runtime `.env` now targets that clean `ccida_test` database; `.env.test` targets the separate `ccida_validation_test` database. The prior database, a verified backup and the previous configuration files are retained privately under the workspace recovery procedure. The institution name and receipt logo are preserved; sample records and PromptPay details are absent. Credentials remain outside Git. See [clean setup](clean-start-report.md).

For operational development, `npm run dev` and `dev:runtime` load runtime configuration. Only `npm run dev:test` loads the guarded `.env.test` connection. Production remains `npm start`. The current operational server is available at http://localhost:3000. Keep the operational database separate from test fixtures even when its historical name ends in `_test`.

The test launcher now verifies database readiness first. It may start the existing owned Windows cluster on loopback port 55432 with matching `PG_BIN_DIRECTORY` tools and wait for recovery, without resetting data or changing other services. `npm run db:test:ready` provides the same check/recovery without launching another Next.js instance. See [login recovery](login-recovery-report.md). Production/runtime startup never substitutes the test connection.

The original isolated development database can be used without changing `.env` by setting process-local values in PowerShell:

```powershell
$env:DATABASE_URL = 'postgresql://ccida_test@127.0.0.1:55432/ccida_dev?schema=public'
$env:APP_ORIGIN = 'http://localhost:3000'
$env:COOKIE_SECURE = 'false'
$env:BACKUP_DIRECTORY = Join-Path (Get-Location) '.local\backups'
$env:PG_BIN_DIRECTORY = 'C:\Program Files\PostgreSQL\18\bin'
npm run db:migrate
$env:BOOTSTRAP_USERNAME = Read-Host 'Administrator username'
$bootstrapSecret = Read-Host 'Administrator password (at least 14 characters)' -AsSecureString
$env:BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $bootstrapSecret).Password
npm run bootstrap
Remove-Item Env:\BOOTSTRAP_PASSWORD
npm run build
npm start
```

These development-cluster credentials use loopback trust and are unsuitable for a production database. If the isolated cluster is stopped, start only that cluster:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D '.local\postgres' -l '.local\postgres.log' -o '-p 55432 -h 127.0.0.1' -w start
```

## Docker deployment

Use [deploy/production.env.example](../deploy/production.env.example) as the Docker-specific template. Keep the completed `.env` outside Git. Replace both password placeholders in the URLs with the corresponding URL-encoded secret; the application role and migration owner must use different credentials. For another hostname, update both `APP_ORIGIN` and `deploy/Caddyfile` before deployment.

The Dockerfile includes a standalone application and a separate maintenance/backup tools target. Compose provisions PostgreSQL 17 and a matching PostgreSQL 17 client, a migration job, application, backup worker and Caddy proxy. Database storage and backups use durable named volumes. Database and application ports are internal to the Compose network; the proxy exposes LAN HTTP/HTTPS.

Set these in a protected `.env` or deployment secret environment:

```dotenv
POSTGRES_PASSWORD=<strong owner password>
APP_DATABASE_PASSWORD=<different strong application password>
DATABASE_URL=postgresql://ccida_app:<URL-encoded application password>@db:5432/ccida?schema=public
MIGRATION_DATABASE_URL=postgresql://ccida_owner:<URL-encoded owner password>@db:5432/ccida?schema=public
APP_ORIGIN=https://pos.ccida.local
```

Passwords are placeholders; provide real values locally and never commit them. Owner credentials are supplied only to migration/maintenance. The initialization SQL gives `ccida_app` data privileges without ownership or DDL rights; integrity triggers remain protected from the application role. Existing volumes are retained. The initialization script runs only for a new database volume.

```powershell
docker compose up --build -d
docker compose logs app migrate backup-worker
```

Create the first administrator after migrations. Supply its password through environment, not a command argument:

```powershell
$env:BOOTSTRAP_USERNAME = Read-Host 'Administrator username'
$bootstrapSecret = Read-Host 'Administrator password' -AsSecureString
$env:BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $bootstrapSecret).Password
docker compose run --rm -e BOOTSTRAP_USERNAME -e BOOTSTRAP_PASSWORD migrate npm run bootstrap
Remove-Item Env:\BOOTSTRAP_PASSWORD
```

Configure internal DNS so `pos.ccida.local` resolves to the server. Caddy uses its internal certificate authority; institutional IT must distribute/trust that CA on operational devices. With trusted HTTPS, Secure cookies and PWA installation work. Ordinary HTTP LAN browsing is supported with `COOKIE_SECURE=false` and an exact HTTP `APP_ORIGIN`; service-worker installation requires a secure context. The browser request-key implementation uses getRandomValues and does not depend on secure-context-only randomUUID.

Before service, create staff, configure actual products/categories, set and validate the real institutional PromptPay recipient, perform a controlled QR-card/receipt/scanner/payment acceptance test, and enable backup scheduling. Internal operating assignments are automatic; existing open shifts retain their ledger context. Configure 80 mm profiles for both QR cards and every original/COPY receipt. No bank API credentials are required for the specified manual verification workflow.

On a fresh production database, upload the bundled [organization logo](../public/receipt-logo.png) through Settings → โลโก้บนใบเสร็จ → บันทึกโลโก้. Current local branding is stored in the database and is not transferred by Git. Existing installations preserve their uploaded logo and receipt settings when applying migrations.

## Operating checks and updates

`/api/health` checks the database connection without disclosing connection details. Monitor application/backup-worker health and disk capacity, maintain server time synchronization, and keep a protected off-server archive copy. Build/install artifacts before an Internet-disconnected event; runtime assets, QR generation and POS API calls remain local.

Updates use `npm ci`, `npm run db:migrate`, all validation checks and `npm run build`, then restart the application. Build reuses a client only when its schema/SDK and generated files match; otherwise it generates Prisma. On Windows, stop the app before schema/client changes because the loaded engine DLL cannot be replaced. Never use reset, forced db push, volume removal or restore over operational data. The timestamp migration acquires table locks; apply migrations during a maintenance window. Initial deployment runs migrations before business records exist.

Docker execution and internal DNS/CA installation require target-host acceptance; this workspace has no Docker CLI. Native production-server/real PostgreSQL and browser validation provide separate application evidence.

GitHub Actions validates the source on Node 24/PostgreSQL 17, then builds and boots the production Docker application, migration job and backup worker in a fresh, uniquely named CI Compose project. It tests health with the restricted application role, administrator bootstrap, authenticated settings and migration reapplication. CI credentials/volumes exist only on the hosted runner; the workflow does not connect to or deploy an operational database. This supplements target-host acceptance rather than configuring the institution's live DNS, TLS trust, bank recipient or printers.
