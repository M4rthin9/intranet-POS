# User event assignments and automatic staff sessions

15 October 2026.

Super Admin selects **กิจกรรมที่ผูกกับผู้ใช้งาน** when creating or editing an account on the Users page. Active staff accounts require an event. Super Admin accounts can leave the assignment empty and retain administration across events.

Staff see their assigned event as a read-only label. They have no event selector or เปิดกะ/ปิดกะ controls. Cashier Register continues to open directly on the registration page with no menu. Admin retains its dashboard and registration pages; shift management belongs to Super Admin.

The existing accounting model is preserved: staff operating sessions open automatically when the work context or first sale/payment is resolved. Existing active sessions are reused, including under concurrent retries. Logging out does not discard a session or financial history. Super Admin can inspect or reconcile sessions in the Shifts page.

## Assignment and closing controls

- The server reads the current user assignment for registration, QR access, purchases, payment/receipt access, event lists and Admin dashboard data. A browser preference or forged event ID cannot substitute another event.
- Super Admin reassignment seals the previous staff session and records its summary before saving the new assignment. Pending payments block the change and roll the transaction back. Old order/payment IDs, amounts and event references remain unchanged. Staff refresh their page to receive the new assignment.
- Event closing verifies pending payments, reconciliation and outstanding-balance approval, then closes staff sessions with audited summaries automatically. An open Super Admin session still needs closing by Super Admin.
- Assigning a closed or archived event permits authorized historical views and receipt reprints. New registration/sales/payments remain blocked; there is no fallback to another open event.
- An account without an assignment displays a message to contact Super Admin and cannot start work.

## Database and rollout

Migration `20261015010000_user_event_assignment` adds nullable `User.assignedEventId`, a foreign key with restricted deletion and an index. It backfills only an existing active session or saved operating context. It never selects an unrelated event and does not delete/reset data or rewrite financial rows. There are now thirteen migrations.

The workspace test database has the migration applied. Runtime configuration and passwords remain unchanged. Apply `npm run db:migrate` with the production deployment's configured database credentials before running the new build. For the isolated test database, `npm run db:migrate:test` verifies the test target and applies migrations without using the runtime connection.

The seed supplies the known demo event to demo staff only when their assignment is empty. Repeating it preserves existing assignments, passwords, role changes and operational records.

## Acceptance

Regression coverage includes Super Admin-only assignment, required event validation, foreign-event read/write rejection, unassigned-account behavior, automatic first-sale/payment sessions, pending-payment reassignment rollback, historical receipt isolation, event closing summaries and preserved ledger references. Browser acceptance covers user-form assignment, read-only staff event labels, role pages without shift controls, registration/QR, multiple POS purchases, PromptPay confirmation, copies and closed-event reprints.

Final validation passes thirteen migrations, lint, typecheck, **46 tests in 17 files**, production build, formatting, **42 production-server/browser checks**, ordinary HTTP LAN checkout and live development health. The browser test's former expectation that Admin could read an unassigned historical event was corrected: it now asserts 403 first, has Super Admin assign that event, then verifies permitted analytics. The initial evidence is retained in `validation/user-event-assignment/initial-old-dashboard-expectation.json`.

Evidence: [phase gates](validation/phase-8/results.md), [browser results](validation/final/results.json), [registration staff page](validation/final/registration-only-desktop.png) and [user assignment form](validation/final/user-event-assignment.png).
