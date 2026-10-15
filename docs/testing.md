# Testing and final acceptance

Latest validation: **56 tests across 20 files**, the existing **45 production-server/browser checks**, seven feedback browser checks, fourteen migrations, lint, typecheck and production build. The [feedback guide and acceptance](feedback.md), [receipt logo report](receipt-logo-report.md), [payment workspace](payment-workspace-redesign.md), [desktop POS](pos-desktop-redesign.md) and [event assignments](user-event-assignment.md) describe the latest changes. Login outage/retry browser acceptance and guarded startup checks are recorded in the [login recovery report](login-recovery-report.md). Earlier phase gates remain historical; feedback evidence is under [feedback acceptance](validation/feedback/results.json).

Validation uses independent `.env.test` configuration and a database name ending in `_test`. The current workspace uses `ccida_validation_test`; the clean operational database is separate. An explicit `TEST_DATABASE_URL` takes precedence over the test file for maintenance validation and must still pass the name guard. Fixtures use unique roles/users/stations/events and preserve records. Never run these fixture-producing checks against the operational database. Production payment, account, stock, QR and backup features use real implementations.

## Reusable demo data

`npm run db:seed` adds six demo users covering all five roles and an event with products, stock, QR lifecycle, orders, void and optional payment/receipt examples to the isolated test database. It preserves existing passwords and operational history. See [test seed guide](test-seed.md) for logins and startup. Seed tests check target rejection, concurrent/interrupted replay, reconciliation, changed users and closed events.

## Phase gates

Each phase ran database/schema/migration checks, ESLint, TypeScript, regression tests and the production build, fixing failures before advancing. Logs are under `validation/phase-1` through `validation/phase-8`. Final commands:

```powershell
npm run validate:phase -- 8 --isolated
npm run test:e2e
npx tsx scripts/http-lan-smoke.ts
npx tsx scripts/performance.ts
npx tsx scripts/timezone-check.ts
npm run format:check
npm audit --audit-level=moderate
```

PostgreSQL constraints and triggers are exercised against the actual database. The original nine-migration schema diff had no differences; role, printing and user/event assignment follow-ups add four forward migrations without rewriting financial history. CI additionally boots the production Compose images on a fresh PostgreSQL 17 database, applies migrations, bootstraps a Super Admin, verifies the restricted application role and reapplies migrations without a reset.

## Regression coverage

Coverage includes all five roles, salted password verification and legacy upgrade, guarded role URLs, centered desktop/mobile login, Admin aggregate dashboard permissions, secure UUIDs on HTTP, registration and QR lifecycle, invalid/wrong-event/revoked/blocked/reissued QR, immutable price/name/recipient snapshots, spoofed client totals, duplicate/mismatched submission keys, multi-station and concurrent checkout, exact PromptPay/CRC, pending-account reservation, settlement/allocations/SETTLED, duplicate payment generation/confirmation, audited COPY, simultaneous order/payment, protected void/history, database append-only enforcement, reconciliation and isolation, CSV injection escaping, Thai-hour/date reporting, stock movement and overselling, shifts and closing, expired sessions, throttling, CSRF/body limits, real archive/restore, revoked restored sessions and refusal to overwrite populated recovery targets.

## Production server and browser acceptance

`scripts/e2e.ts` starts the built Next.js production server against isolated PostgreSQL. Authenticated APIs exercise the master scenario, then Microsoft Edge/Chromium exercises registration, scanner Enter, two POS stations, payment, receipt and reporting. Dropped order/payment responses, reloads and retries preserve original request keys and produce one transaction. Authentication recovery retains unresolved checkout intent. Form checks cover catalog, stock, users and settled-customer editing. All eleven report exports return real CSV.

The browser verifies 80 × 120 mm customer/PromptPay cards, QR centering on both axes, maximum-length customer/recipient names, embedded QR images and original/COPY receipt content on 80 mm paper. Pending QR printing is audited without settlement. Voiding while a preview is open prevents the next print. Printer failures preserve settlement; repeated receipt printing requests an audited COPY. Public-origin requests are blocked and acceptance confirms no external asset requests.

Separate HTTP LAN acceptance uses `http://pos.ccida.test` on an allocated port mapped to loopback. Both runners preserve other local services. It checks `isSecureContext=false`, absent native randomUUID, cryptographic keys from getRandomValues, scanner checkout and zero browser errors. PDFs, CSV and desktop/tablet/mobile screenshots are under `validation/final`.

Backup tests restore real custom archives to new empty databases, check records and audit triggers, revoke sessions and reject a second restore. Concurrent scheduled/closing workers do not repeat schedule execution.

## Historical evidence

Earlier role-flow validation passed 35 tests and 36 browser checks; interface/conflict validation passed 33 and 34. Their reports retain historical evidence. The printing follow-up supersedes the previous 58 mm receipt and 80 × 100 mm QR layouts.

The function-review performance run committed ten checkouts with zero failures in 503 ms, with a 31 ms reconciled report. Index plans replace full order-item scans. This development-host smoke result does not certify target capacity. Timezone validation preserved UTC instants while aligning SQL charts with Asia/Bangkok; TIMESTAMPTZ and regression checks cover Thai boundaries.

## Verification limits

Docker is unavailable locally; the published production image and PostgreSQL 17 startup have passed GitHub CI. Live bank recipient/evidence, physical printers/scanners, Windows/iMin/browser versions, LAN DNS/trusted TLS, protected backup storage and sustained capacity require commissioning. The clean operational runtime connection is healthy, and fixture-producing tests use the separate validation database. See [deployment](deployment.md), [clean setup](clean-start-report.md) and [final report](final-implementation-report.md).
