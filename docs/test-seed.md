# Test seed data and logins

Run `npm run db:seed` to add demo data to the database in **TEST_DATABASE_URL from `.env.test`**. The command never uses the runtime `.env` DATABASE_URL. It refuses production mode, non-PostgreSQL URLs and database names that do not end in `_test`. Apply the existing migrations to that test database first; no new migration is needed for the seed.

All six new demo users share **CCIDA-Test-2026!** by default. Set `SEED_PASSWORD` to a 14–256 character password before the first run to choose a different one. Passwords are independently salted and hashed through the existing authentication implementation. Repeating the seed preserves existing passwords, disabled accounts and role changes.

| Username          | Role                 | Station                           |
| ----------------- | -------------------- | --------------------------------- |
| demo.superadmin   | SUPER_ADMIN          | DEMO-ADMIN-01                     |
| demo.registration | ADMIN                | DEMO-REG-01                       |
| demo.cashier01    | CASHIER              | DEMO-POS-01                       |
| demo.cashier02    | CASHIER              | DEMO-POS-02                       |
| demo.payment      | PAYMENT_CASHIER      | DEMO-PAY-01                       |
| demo.register     | REGISTRATION_CASHIER | Automatic registration assignment |

The script also initializes all five roles, permissions and their grants using the same initializer as production bootstrap. The seed neither deletes existing grants nor changes the application's role rules.

## Sample operations

Superadmin and Admin open `/dashboard`; POS cashiers open only `/pos`; the new registration cashier opens only `/register`; payment cashiers open only `/payments`. Existing `demo.registration` remains ADMIN, with dashboard and registration access. See [role page changes](role-pages-report.md). Use the new Cashier Register option when creating registration-only staff.

Use **`demo.register`** for the registration-only page with no sidebar/menu. It opens the registration page immediately after login. See [registration cashier layout](registration-only-page.md).

Existing demo shifts retain **DEMO-CCIDA-TEST** as their event. Demo staff are assigned to this known event when their assignment is empty; existing assignments remain unchanged. Staff use the assigned event and automatic sessions without event selection or shift buttons. Super Admin changes assignments from Users and can select current/historical analytics independently. Station assignment stays automatic. The demo starts OPEN, with registration, two POS and payment sessions ready. Two categories contain six Thai-named products: tea ฿45.50, coffee ฿40, water ฿15, cake ฿60, low-stock snacks ฿25, and an out-of-stock product ฿30.

Six registrations have notes identifying their scenarios:

- `new`: an active account without purchases, ready for scanner/checkout practice.
- `unpaid`: two purchases across the two POS stations, owing ฿151.
- `settlement`: coffee and water purchases totaling ฿110; settled with a synthetic payment and immutable receipt if PromptPay is already enabled, otherwise left unpaid.
- `blocked`: a blocked customer QR for rejection tests.
- `reissued`: one revoked credential and one valid replacement.
- `voided`: a retained voided order, with cake stock returned and audit history preserved.

Print customer QR cards from Registration; seed output deliberately omits QR secrets and password hashes. Inventory includes ordinary, low and zero stock. Initial financial totals are gross ฿321, net ฿261, voided sales ฿60. With the payment example included, confirmed payments are ฿110 and outstanding is ฿151; otherwise outstanding is ฿261. These are synthetic records, not bank transfers.

Existing PromptPay settings are always preserved. If no recipient has been configured, the script skips settlement. To deliberately configure a recipient **only in this test database**, supply `SEED_PROMPTPAY_PHONE` before the first run. It is validated and used only when no PromptPay setting exists. Never transfer money using training QR codes or treat the synthetic confirmation/reference as banking evidence.

## Open the app with this data

In this workspace, the isolated validation database is `ccida_validation_test` on port 55432. The operational application uses a different database. The dedicated test launcher reads `.env.test`, validates the test database name and starts the app with that connection. It keeps the runtime `.env` unchanged:

```powershell
npm run db:seed
npm run dev:test
```

Stop any existing application instance using the same port before starting the test launcher, or configure a separate APP_ORIGIN and PORT. For another machine, configure TEST_DATABASE_URL and APP_ORIGIN in `.env.test`. Close or reuse existing demo shifts when practicing; the two POS accounts each have their own station. Only `npm run dev:test` selects the guarded test profile. `npm run dev` and `dev:runtime` select runtime database configuration and require that database and role to exist. `npm start` remains the production command. Never point validation or seeding at the operational database, even if its historical name ends in `_test`.

## Repeat runs and verification

If test login reports database unavailability, run `npm run db:test:ready`. It verifies the guarded test target and can start the existing workspace cluster if stopped. `npm run dev:test` also performs this check before starting Next.js. Recovery may take time after an interrupted shutdown; do not reset the database. Existing data and passwords are retained. See [login recovery report](login-recovery-report.md).

Stable IDs, namespace collision checks, a database advisory lock, real service submission keys and a completion marker make concurrent/repeated runs safe. Financial examples use the real registration, order, inventory, void and payment services, including their transactions, audit trails and database guards. An interrupted run can resume; a completed seed does not reset practiced transactions, reopen closed events, replenish stock or reopen shifts. Changing SEED_PASSWORD on a later run does not reset existing users. There is intentionally no destructive reset command. The database pool needs at least three available connections during simultaneous seed runs.

`tests/seed.test.ts` verifies production-target rejection, complete role grants, salted login passwords, actual financial reconciliation, blocked/reissued cards, void stock returns, concurrent runs, interrupted-run replay, preservation of changed/disabled users, and preservation of closed events/shifts. Run `npm test -- tests/seed.test.ts` for these checks or `npm test` for the full suite.

Keep test users and data isolated from production. Production setup continues to use `npm run bootstrap` with a private administrator password and no sample financial data.
