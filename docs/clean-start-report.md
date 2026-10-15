# Clean operational setup — 2026-10-15

The user authorized resetting the current application database and creating one account for every role with independently generated passwords. The application now uses a freshly migrated database with no events, categories, products, customers, QR credentials, sales, payments, receipts, stock, shifts, stations or demo accounts. System roles, permissions, five real accounts and their setup audit records remain.

| Username           | Role                 | Landing page |
| ------------------ | -------------------- | ------------ |
| `superadmin`       | SUPER_ADMIN          | `/dashboard` |
| `admin`            | ADMIN                | `/dashboard` |
| `cashier.pos`      | CASHIER              | `/pos`       |
| `cashier.register` | REGISTRATION_CASHIER | `/register`  |
| `cashier.payment`  | PAYMENT_CASHIER      | `/payments`  |

All accounts are active. Staff have no assigned event because the requested installation has no events. Super Admin must create and open the actual event, assign it to staff, create categories/products and configure the institution's verified PromptPay recipient before transactions can begin. Staff continue to use automatic operating sessions without shift controls. No placeholder event or bank recipient was created.

Passwords contain 24 cryptographically random bytes encoded as 32 characters and use the application's salted scrypt-v2 hashes. They are stored only in the restricted, ignored `.local/credentials/accounts-20261015.json` file for administrator handover. Passwords, hashes, session tokens and database connection secrets are absent from this report and Git.

## Preservation and recovery

The institution name and supplied receipt logo were retained. Sample receipt header text, footer QR content and PromptPay recipient settings were cleared; the neutral thank-you footer remains. The logo is centered on the existing 80 mm receipt layout.

Before cutover, the owned application processes were stopped and a full PostgreSQL custom archive was created. SHA-256 and archive listing were verified. A single-transaction restore into a separate new database succeeded, and row counts matched across all 27 tables, including financial history, audit records and migration history.

The prior database was renamed and retained with connections disabled. The clean staging database was then renamed to the original application database name. Existing session cookies no longer match any sessions in the clean database. No append-only triggers were disabled and no existing financial rows were rewritten. The original archive, previous configuration files, recovery drill details and reset manifest are retained under ignored `.local/backups/`. Recovery requires stopping the application and an authorized database cutover; do not restore over the clean database or re-enable archived databases during normal operation.

## Runtime and test isolation

Runtime `.env` now targets the clean local application database. `.env.test` uses the separate `ccida_validation_test` database. `npm run dev` and `dev:runtime` select runtime configuration; only `npm run dev:test` selects the fixture database. Both development modes retain the existing authenticated readiness check and the safeguards for recovering only the owned local PostgreSQL cluster. Production startup remains `npm start` and requires its database service to be available.

Automated tests accept an explicit guarded `TEST_DATABASE_URL` before reading test defaults. Fixture-producing tests and optional seeding must never target the operational database, even though its historical name ends in `_test`. Test infrastructure is retained for regression verification; normal startup and production bootstrap do not install sample records.

The operating-context service no longer prefers a demo event or automatically creates an initial event. Empty pages finish loading and provide setup guidance. Creating events remains an explicit Super Admin action.

## Validation

- All thirteen migrations applied to the clean installation; schema and migration checks passed.
- Exactly five users, one per role; every business-data table checked was empty.
- Real API login/logout succeeded for all five accounts; no sessions remained after verification.
- Browser login reached each role's required page, cashier pages had no sidebar and no browser errors occurred.
- Super Admin visited the empty POS, registration, event, product, user and settings pages without creating an event or remaining on a loading screen.
- Formatting, lint, typecheck, all 49 regression tests across 19 files and the production build passed.
- All 45 production-server/browser acceptance checks passed against the separate validation database.
- A final operational database check after the fixture-producing tests reconfirmed five users, one per role, zero business records and zero remaining sessions.
- Normal operational startup passed its authenticated readiness check and the local health endpoint returned HTTP 200. The guarded test preflight separately reported the validation database ready.

Sanitized validation results are in [clean-start acceptance](validation/clean-start.json). Private reset/recovery manifests, browser screenshots and detailed account checks remain under `.local/`.

This is a clean local operational setup. Live bank verification, physical printer/scanner testing and target-host HTTPS/backup commissioning remain deployment tasks.
