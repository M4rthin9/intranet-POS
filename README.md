# CCIDA Event POS & Payment Management

Thai-first intranet POS with one customer QR, multiple purchases, and final PromptPay settlement. All eight implementation phases are documented in [implementation status](docs/implementation-status.md). Deployment, operator, backup and testing guides are in `docs`.

The supplied workspace was empty. This implementation uses Next.js 16 App Router, React 19, TypeScript, PostgreSQL, Prisma 6, Zod, local QR generation and modular server services. Financial values use integer satang and server-calculated totals. There are no production sample accounts, transactions or PromptPay recipient.

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

## Deployment and operation

```powershell
docker compose up --build -d
npm run backup:worker
```

Docker requires the owner/application database credentials described in the deployment guide. Browser printing supports 58 mm receipts and A4 reports/PDF. USB scanners use HID keyboard mode with an Enter suffix. HTTPS enables PWA installation; ordinary HTTP LAN checkout uses secure random request keys and remains functional.

See [final report](docs/final-implementation-report.md), [operator guide](docs/operator-guide.md), [backup/restore](docs/backup-restore.md), and [testing](docs/testing.md).
