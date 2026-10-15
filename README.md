# CCIDA Event POS & Payment Management

[![Validation](https://github.com/M4rthin9/intranet-POS/actions/workflows/validate.yml/badge.svg?branch=main)](https://github.com/M4rthin9/intranet-POS/actions/workflows/validate.yml)

Current release includes assigned-event staff access without shift controls, separate full-width registration/POS/payment cashier workspaces, centered POS QR checkout, verified PromptPay settlement, and 80 mm receipts with the supplied organization logo. Super Admin and Admin retain their authorized dashboard views. See [release readiness](docs/production-release.md) for validation, publication scope and live-deployment requirements.

Customers can submit ratings and comments without login at `/feedback`. Super Admin reviews responses and event summaries at `/feedback-responses`, with a link for the configurable receipt QR. See [feedback setup, privacy and validation](docs/feedback.md).

Event registration is restored at `/events` for Superadmin, with OPEN-event selection for registration/sales and historical event selection for analytics. The 80 mm paid receipt follows the supplied reference, with configurable footer QR and a receipt barcode for audited reprints. See [event and receipt follow-up](docs/event-receipt-followup.md).

Each role now has its own landing page: Superadmin/Admin use `/dashboard`, POS cashiers use only `/pos`, registration cashiers use only `/register`, and payment cashiers use only `/payments`. Login uses a centered desktop/mobile card. The new registration-only role preserves existing accounts and payment access. See [role pages and test login](docs/role-pages-report.md).

Thai-first intranet POS with one customer QR, multiple purchases, and final PromptPay settlement. All eight implementation phases are documented in [implementation status](docs/implementation-status.md). Deployment, operator, backup and testing guides are in `docs`.

Built with Next.js 16 App Router, React 19, TypeScript, PostgreSQL, Prisma 6, Zod, local QR generation and modular server services. Financial values use integer satang and server-calculated totals. There are no production sample accounts, transactions or PromptPay recipient.

## Run with your database

Use Node 24 LTS (the implementation was also validated with Node 26). Configure `.env` from `.env.example` with a reachable PostgreSQL database, exact `APP_ORIGIN`, and appropriate cookie/backup settings. Preserve any existing configuration.

```powershell
npm ci
npm run db:migrate
# Set BOOTSTRAP_USERNAME and BOOTSTRAP_PASSWORD in the process environment.
npm run bootstrap
npm run build
npm start
```

Bootstrap refuses to overwrite an existing super administrator and creates no sample financial data. It requires a password of at least 14 characters. See [deployment](docs/deployment.md) for a masked-password setup, the available isolated development database, and Docker/LAN deployment.

## Validate safely

Configure `.env.test` from `.env.test.example` with a **separate database whose name ends in `_test`**. Tests refuse any other database name. The current workspace has an isolated PostgreSQL 18 cluster and test configuration prepared for validation.

```powershell
npm run validate:phase -- 8 --isolated
npm run test:e2e
npx tsx scripts/http-lan-smoke.ts
npx tsx scripts/performance.ts
npm audit --audit-level=moderate
```

The production-server and browser tests create only isolated test records. They preserve test history instead of clearing databases. Browser tests use installed Microsoft Edge on Windows; set `BROWSER_EXECUTABLE` for another compatible Chromium browser, or install Playwright Chromium on Linux.

## Test users and sample data

Test startup now checks database readiness before opening the app and can start the existing workspace PostgreSQL cluster safely if it is stopped. Run `npm run db:test:ready` to check/recover that test connection without restarting the app. Runtime credentials remain unchanged. See [login 503 recovery](docs/login-recovery-report.md).

`npm run dev` and `dev:runtime` use the operational `.env` configuration; `npm start` remains the production command. **`npm run dev:test`** explicitly launches the isolated `.env.test` database. The clean operational setup contains one real account per role and no sample records; credentials are stored privately outside Git. Super Admin must create an event, assign staff, add products and configure the actual PromptPay recipient before service. Opening an empty installation never creates an event automatically. See [clean setup and validation](docs/clean-start-report.md).

For optional development fixtures only, `npm run db:seed` adds test logins and sample transactions to the separate test database. It preserves existing records and passwords. These fixtures are never installed by normal startup or production bootstrap. See [test seed guide](docs/test-seed.md).

## Deployment and operation

The default production Docker setup serves POS at `http://192.168.1.46:8081`. ERP/Nginx keeps `http://192.168.1.46` on port 80. Configure real PostgreSQL passwords in a private `deploy/.env.pos-production` copied from [the production template](deploy/production.env.example), then run from this repository:

```powershell
docker compose --env-file deploy/.env.pos-production config --quiet
docker compose --env-file deploy/.env.pos-production up --build -d
docker compose --env-file deploy/.env.pos-production ps
```

The stack starts the POS application, PostgreSQL and backup worker, with a one-time migration job. PostgreSQL stays private; the optional HTTPS proxy is disabled by default. Existing POS volumes retain their data. See [ERP coexistence and server setup](docs/erp-coexistence.md), including a server-only localhost override. Docker requires the owner/application database credentials described in the deployment guide. All original/COPY receipts and both customer/PromptPay QR cards use 80 mm paper. The payment section includes a PromptPay QR print button; both QR layouts center the image on an 80 × 120 mm card. Receipts adapt their height to the items. Reports use A4. See [printing setup](docs/printer-integration.md). USB scanners use HID keyboard mode with an Enter suffix. HTTPS enables PWA installation; ordinary HTTP LAN checkout uses secure random request keys and remains functional.

Use [the production environment template](deploy/production.env.example) for a fresh Docker deployment. After bootstrap, Super Admin can upload the bundled [organization logo](public/receipt-logo.png) under Settings → โลโก้บนใบเสร็จ. Existing installations retain their database settings; Git publication does not transfer accounts, payment records or backups.

Super Admin creates/reviews events and assigns an event to each staff account. Staff work in that event with automatic sessions; Super Admin manages its own manually opened operating sessions. Dashboard/report event selection supports historical events independently. Existing records and audit boundaries remain intact. See [event assignments](docs/user-event-assignment.md).

See [final report](docs/final-implementation-report.md), [operator guide](docs/operator-guide.md), [backup/restore](docs/backup-restore.md), and [testing](docs/testing.md).
