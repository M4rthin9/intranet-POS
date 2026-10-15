# Test seed implementation report

Date: 14 October 2026. Status: **COMPLETE**.

Implemented and executed `npm run db:seed` against the isolated `ccida_test` database on 127.0.0.1:55432. Runtime `.env`, operational data and existing PromptPay settings were preserved. No migration, reset or destructive operation was needed.

## Created demo data

- Four fixed roles, application permissions and role grants, using the initializer shared with production bootstrap.
- Five securely hashed users: `demo.superadmin`, `demo.registration`, `demo.cashier01`, `demo.cashier02`, `demo.payment`.
- Five stations, one OPEN event `DEMO-CCIDA-TEST`, and four operational shifts.
- Two categories, six products, ordinary/low/zero stock, and six customer registrations with secure QR credentials.
- Five orders including two-station purchasing and a retained void with stock return.
- One synthetic confirmed payment, two allocations and an immutable receipt, using the test database's existing enabled PromptPay configuration. No bank transfer occurred.
- Blocked and reissued QR scenarios with retained revoked credentials and audit history.

Default password for new demo users: `CCIDA-Test-2026!`. `SEED_PASSWORD` can override it before first creation. All five actual demo accounts successfully logged in and authenticated with the expected roles; the temporary verification sessions were removed.

## Safety and engineering decisions

The command selects TEST_DATABASE_URL from `.env.test`, rejects production mode and requires a PostgreSQL database name ending in `_test`. Stable seed identities detect unrelated name collisions. A database advisory lock serializes concurrent runs. Financial examples run through the real application services with stable submission keys; an interrupted seed can resume. A completion marker preserves practiced state on later runs, including changed passwords, disabled users, closed shifts/events and inventory history. There is no reset mode.

Existing recipients are never modified. When PromptPay is absent/disabled, settlement remains an unpaid practice account. Optional `SEED_PROMPTPAY_PHONE` initializes only an absent setting in the test database. Production bootstrap continues to create an initial administrator without sample financial data.

## Verification

| Check                                 | Result                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Prisma schema and all nine migrations | PASS                                                                       |
| ESLint                                | PASS                                                                       |
| TypeScript                            | PASS                                                                       |
| Added seed safety/regression checks   | 2 PASS                                                                     |
| Full regression suite                 | 25 PASS across nine files                                                  |
| Production build                      | PASS                                                                       |
| Changed-file formatting               | PASS                                                                       |
| Actual demo login/authentication      | 5 PASS                                                                     |
| Second CLI seed run                   | PASS: alreadyComplete=true, same six registrations/five orders/one payment |

Seed tests exercise target rejection, grants, salted credentials, real reconciliation, blocked/reissued cards, void stock return, concurrent execution, interrupted-run replay, changed/disabled users and closed events/shifts. Original production acceptance conditions remain unchanged; this extension supplies test fixtures only.

See [login table and startup guide](test-seed.md).

Test startup now uses `npm run dev:test` and the same guarded connection loader as the seed command. Local runtime connection recovery and HTTP/browser checks are documented in [server recovery report](server-recovery-report.md).
