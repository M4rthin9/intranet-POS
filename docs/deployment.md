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

The default production stack publishes POS on **port 8081**, at **http://192.168.1.46:8081** for this server. Existing ERP/Nginx retains port 80 and its current IP/URL. The Caddy proxy is an explicit optional profile and does not start with the normal production command. See [ERP coexistence](erp-coexistence.md) for Windows checks, firewall setup and the localhost-only override.

The Dockerfile builds a standalone production application and a separate maintenance/backup image. Compose runs PostgreSQL 17, the application and backup worker; a one-time migration job completes before either application service starts. The application listens on container port 3000, mapped to host port 8081. PostgreSQL has no published host port. Named database/backup volumes and the existing `ccida-pos` project name are retained. Never remove volumes to apply this change.

Copy [the production template](../deploy/production.env.example) once to a private file; preserve the native application's existing `.env`:

```powershell
if (-not (Test-Path -LiteralPath 'deploy/.env.pos-production')) {
    Copy-Item -LiteralPath 'deploy/production.env.example' -Destination 'deploy/.env.pos-production'
}
notepad deploy/.env.pos-production
```

Set strong, different owner/application passwords and replace both URL password placeholders with their corresponding URL-encoded secrets. Keep existing-volume credentials unchanged on an update. Password environment variables initialize new volumes only; changing them does not rotate an existing PostgreSQL password. The template contains:

```dotenv
POS_BIND_ADDRESS=0.0.0.0
POS_PORT=8081
APP_ORIGIN=http://192.168.1.46:8081
COOKIE_SECURE=false
```

Use that exact IP URL on every device, including the server browser. Changing the host port also requires changing the port in `APP_ORIGIN`. HTTP requires `COOKIE_SECURE=false`; trusted HTTPS requires `true`. The application rejects write requests from a different origin. Secrets remain outside Git and Docker build contexts. Owner credentials are supplied only to migration/maintenance. Initialization grants `ccida_app` data access without ownership or DDL rights; integrity guards remain protected.

Ensure `COMPOSE_PROFILES` is unset so the optional HTTPS proxy stays off. From this repository:

```powershell
docker compose --env-file deploy/.env.pos-production config --quiet
docker compose --env-file deploy/.env.pos-production config --services
docker compose --env-file deploy/.env.pos-production up --build -d
docker compose --env-file deploy/.env.pos-production ps
docker compose --env-file deploy/.env.pos-production logs app migrate backup-worker
```

The active service list must contain only `db`, `migrate`, `app` and `backup-worker`. A completed migration container is expected. If an older POS deployment already runs its own Caddy proxy, first stop only that project's `proxy` service; starting a new profile configuration does not automatically stop existing containers. Do not stop ERP or use `down --volumes`.

For a **fresh** database only, create the first administrator after migrations. Existing accounts remain unchanged. Supply the password through the process environment:

```powershell
$env:BOOTSTRAP_USERNAME = Read-Host 'Administrator username'
$posBootstrapSecret = Read-Host 'Administrator password (at least 14 characters)' -AsSecureString
$env:BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $posBootstrapSecret).Password
try {
    docker compose --env-file deploy/.env.pos-production run --rm -e BOOTSTRAP_USERNAME -e BOOTSTRAP_PASSWORD migrate npm run bootstrap
} finally {
    Remove-Item Env:\BOOTSTRAP_PASSWORD
}
```

For a separate dedicated HTTPS host, the existing `standalone-https` profile remains available. Only enable it when ports 80/443 are available, update `deploy/Caddyfile` and `APP_ORIGIN` to the same HTTPS hostname, set `COOKIE_SECURE=true`, and restrict the direct application binding to `127.0.0.1`. Start with `docker compose --env-file deploy/.env.pos-production --profile standalone-https up --build -d`. This option needs internal DNS and trusted Caddy CA installation. Do not enable it on the existing ERP server that already owns port 80. HTTP POS works on the LAN; PWA/service-worker installation needs a secure context.

Before service, create staff, configure actual products/categories, set and validate the real institutional PromptPay recipient, perform a controlled QR-card/receipt/scanner/payment acceptance test, and enable backup scheduling. Internal operating assignments are automatic; existing open shifts retain their ledger context. Configure 80 mm profiles for both QR cards and every original/COPY receipt. No bank API credentials are required for the specified manual verification workflow.

On a fresh production database, upload the bundled [organization logo](../public/receipt-logo.png) through Settings → โลโก้บนใบเสร็จ → บันทึกโลโก้. Current local branding is stored in the database and is not transferred by Git. Existing installations preserve their uploaded logo and receipt settings when applying migrations.

## Operating checks and updates

Production builds use two Next.js workers to limit memory and CPU contention on the shared POS/ERP host. This changes build concurrency only; the running application retains its existing service limits and configuration.

`/api/health` checks the database connection without disclosing connection details. Monitor application/backup-worker health and disk capacity, maintain server time synchronization, and keep a protected off-server archive copy. Build/install artifacts before an Internet-disconnected event; runtime assets, QR generation and POS API calls remain local.

Updates use `npm ci`, `npm run db:migrate`, all validation checks and `npm run build`, then restart the application. Build reuses a client only when its schema/SDK and generated files match; otherwise it generates Prisma. On Windows, stop the app before schema/client changes because the loaded engine DLL cannot be replaced. Never use reset, forced db push, volume removal or restore over operational data. The timestamp migration acquires table locks; apply migrations during a maintenance window. Initial deployment runs migrations before business records exist.

Actual Docker startup and Windows network access require target-host acceptance; this workspace has a standalone Compose validator but no Docker engine. Native production-server/real PostgreSQL and browser validation provide separate application evidence.

GitHub Actions validates the source on Node 24/PostgreSQL 17, then builds and boots the production Docker application, migration job and backup worker in a fresh, uniquely named CI Compose project. It tests health with the restricted application role, administrator bootstrap, authenticated settings and migration reapplication. CI credentials/volumes exist only on the hosted runner; the workflow does not connect to or deploy an operational database. This supplements target-host acceptance rather than configuring the institution's live DNS, TLS trust, bank recipient or printers.
