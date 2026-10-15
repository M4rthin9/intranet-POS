# POS Docker deployment — 2026-10-15

POS is deployed at `http://192.168.1.46:8081` in the `ccida-pos` Compose project. The application and PostgreSQL health checks pass; the backup worker is running and the migration job exited successfully. All fourteen migrations are applied. Docker Desktop and the ERP stack were not restarted. ERP still responds on port 80.

The production database has exactly five active users, one per role. Their independent random passwords are retained privately in `.local/credentials/production-accounts.json`; no passwords appear in this report. Every account passed real HTTP login, session identity, role authorization and logout checks. The restricted `ccida_app` database identity was confirmed. No sessions remained after validation.

Events, products, categories, stations, registrations, customer accounts, QR credentials, orders, payments, receipts, inventory, stock movements, shifts and feedback were confirmed empty. Super Admin must create/open an event, assign staff and configure products and the real payment recipient before service.

The production build, lint, TypeScript check and source whitespace check passed. The published HTML page, production CSS/JavaScript assets and database health endpoint returned HTTP 200. A PostgreSQL custom-format commissioning backup was created under `.local/backups/production-commissioning/initial.dump`, checked using `pg_restore --list`, copied to the host and hashed with SHA-256. Backup scheduling and off-host retention remain operator configuration.

The GitHub remote is `https://github.com/M4rthin9/intranet-POS.git`; an authenticated fetch succeeded. The new [updater](../deploy/update.ps1) fetches a selected revision into an isolated worktree, builds images, checks a pre-update database backup, applies migrations and replaces only the app and backup worker. It retains the same project and volumes and never seeds or resets data. Concurrent updates from this checkout are prevented by a file lock. See [update instructions](github-updates.md).

Updater tests passed for preview without changes, successful deployment, build failure, backup failure and migration failure using isolated mocks. The production `-WhatIf` preview also passed. A live GitHub update was not applied over the new installation; local source changes have not been committed or pushed. Physical printers/scanners, live bank acceptance, another LAN device and HTTPS were not tested. The deployed URL uses HTTP intranet access.
