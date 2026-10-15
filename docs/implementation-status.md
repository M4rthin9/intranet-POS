# Implementation status

15 October clean operational setup: the authorized current-database reset is complete. Exactly one real account per role remains, with no demo accounts, events, products or financial transactions. Organization branding is preserved. A full archive was restored and all 27 table counts verified before the prior database was retained with connections disabled. Runtime startup uses the clean database; automated fixtures use a separate validation database. Automatic initial-event creation is removed. See [clean setup and private credential handover](clean-start-report.md). Earlier entries describe the historical implementation stages.

15 October receipt logo: completed. The supplied organization image replaces the receipt C icon and is saved through the live Super Admin settings UI. Original/COPY receipts preserve its proportions and centering on 80 mm paper. Upload preview, bounded PNG validation and audited settings updates retain existing financial data. Thirteen migrations, lint, typecheck, 48 tests, production build, formatting and 45 browser/server checks PASS. See [logo report](receipt-logo-report.md).

15 October payment cashier workspace: completed. Direct payment landing without a sidebar/menu, full-width scan/balance/PromptPay/evidence workflow, expandable copies/history and scanner-focused next-customer action after settlement. Thirteen migrations, lint, typecheck, 46 tests, production build, formatting, 44 browser/server checks, live login/role preview and HTTP LAN checkout PASS. See [payment redesign](payment-workspace-redesign.md).

15 October desktop POS redesign: completed. Full-width cashier workspace, independently scrolling product/cart lists, visible checkout, collapsible recent sales and centered QR modal with scanner focus. QR lookup avoids background refreshes; original-key recovery remains validated. Thirteen migrations, lint, typecheck, 46 tests, production build, formatting and 42 browser/server checks PASS. See [POS report](pos-desktop-redesign.md).

15 October user event assignment: completed. Super Admin attaches events from Users. Staff use assigned events without selectors or shift controls; automatic sessions preserve and reconcile the ledger. Server scopes reads/writes and reprints to the assignment. Thirteen migrations, lint, typecheck, 46 tests across 17 files, production build, formatting, 42 browser/server checks, HTTP LAN checkout and live health PASS. See [assignment report](user-event-assignment.md). Earlier counts below describe previous releases.

15 October registration-only page: completed. Cashier Register lands directly on `/register` with no sidebar/menu and full-width content. Dashboard access remains denied. Desktop/tablet/mobile login and layout acceptance pass, along with twelve migrations, lint, typecheck, 44 tests, production build, formatting and 42 browser/server checks. See [registration-only page](registration-only-page.md).

15 October registration-card design: completed. Customer cards show their actual event name/code, customer name, registration number, credential issue time in Thailand, three usage steps and registration-desk help. Fixed 80 × 120 mm paper, centered QR and maximum-length text containment pass. Latest validation: twelve migrations, lint, typecheck, 44 tests, production build, formatting and 42 browser/server checks; live health returns `ok`. See [card design and preview](registration-card-design.md).

15 October login follow-up: the stopped workspace PostgreSQL cluster recovered, and live health/all six demo logins returned 200. Guarded test startup now checks readiness and safely starts only the existing owned cluster when needed. Login database errors have a private, clear retry response; financial safe-retry semantics are preserved. See [login recovery](login-recovery-report.md) for current validation. Earlier results below describe preceding releases.

Latest gates PASS: 44 tests across 16 files, 42 main browser/server checks, real login outage → retained fields → successful retry acceptance, HTTP LAN checkout, database/twelve migrations, lint, typecheck, production build and formatting. Existing configuration, passwords and records are preserved.

Latest requested follow-up restores event registration/selection and historical sales analytics, while keeping stations automatic and cashier pages separate. The reference-inspired 80 mm receipt has configurable information QR and a scanner-readable receipt barcode for audited COPY retrieval. No financial rows are rewritten and no migration is required. See [event and receipt report](event-receipt-followup.md) for current evidence; preceding counts and layouts below describe earlier releases.

Current validation PASS: 41 tests across 15 files, 42 production-server/browser checks, database/twelve migrations, lint, typecheck, production build, formatting, HTTP LAN checkout and live development-server health. Actual receipt QR/barcode symbols decode at 203 dpi, including the closed-event reprint flow. Dependency audit: zero vulnerabilities.

Latest printing update: PromptPay print button, centered customer/payment QR cards on 80 × 120 mm paper, and every original/COPY receipt on 80 mm paper with adaptive height. Twelve additive migrations preserve financial history. See [printing report](qr-print-report.md) for current validation. Earlier counts and sizes below describe their respective releases.

Current gates pass: database/migrations, lint, typecheck, 37 tests, production build, 38 browser/server checks, HTTP LAN checkout and formatting. Both QR PDFs and original/COPY receipt PDFs contain their actual printed content at 80 mm width.

Latest role-page update: completed. New REGISTRATION_CASHIER is separate from the retained payment cashier. Superadmin/Admin land on the dashboard; each cashier sees only its own protected work page. Login is centered on desktop/mobile. Eleven additive migrations are current; database checks, lint, typecheck, 35 tests, production build and formatting pass. Thirty-six browser/server checks and HTTP LAN checkout pass. See [role pages](role-pages-report.md).

Phase 1: completed. Database check, lint, typecheck, two security tests and production build passed. Phases 2–8 proceed sequentially. Reports and command evidence reside under `docs/phases` and `docs/validation`.

Phase 2: completed. All five gates passed, including three tests against isolated PostgreSQL. QR lifecycle and event-isolation checks passed.

Phase 3: completed. All gates passed, including six tests, two-station ordering, concurrent duplicate checkout, snapshot preservation, and production build.

Phase 4: completed. All gates passed, including nine tests, settlement/allocation/receipt workflows and concurrent order/payment safety.

Phase 5: completed. All gates passed, including twelve tests and database-enforced audit/financial immutability, void and balance-restoration checks.

Phase 6: completed. All gates passed, including fourteen tests, event/date-range analytics, reconciliation through corrections, and export safety.

Phase 7: completed. All gates passed, including seventeen tests, shift/stock integrity, concurrent oversell protection, closing and archive workflow.

Phase 8: completed. All nine migrations, lint, typecheck, 23 regression tests and production build passed. Final acceptance passed 22 production-server/browser checks plus separate ordinary HTTP LAN checkout, real archive/restore, schema drift and a zero-vulnerability dependency audit. Readiness: **READY WITH CONDITIONS** as detailed in the final report.

| Phase | Database/migrations | Lint | Typecheck | Tests   | Production build |
| ----- | ------------------- | ---- | --------- | ------- | ---------------- |
| 1     | PASS                | PASS | PASS      | 2 PASS  | PASS             |
| 2     | PASS                | PASS | PASS      | 3 PASS  | PASS             |
| 3     | PASS                | PASS | PASS      | 6 PASS  | PASS             |
| 4     | PASS                | PASS | PASS      | 9 PASS  | PASS             |
| 5     | PASS                | PASS | PASS      | 12 PASS | PASS             |
| 6     | PASS                | PASS | PASS      | 14 PASS | PASS             |
| 7     | PASS                | PASS | PASS      | 17 PASS | PASS             |
| 8     | PASS                | PASS | PASS      | 23 PASS | PASS             |

All reports are under `docs/phases`; exact command logs are under `docs/validation`. No existing business records were deleted or reset. Runtime `.env` changes were preserved and tests were isolated in `.env.test`.

Complete function review: completed. Latest gate passes database/migrations, lint, typecheck, 29 tests and production build. Expanded acceptance passes 32 checks plus HTTP LAN and ten concurrent checkouts. Login/CSP, retry, form/context/search, reporting and backup fixes are documented in [function review](function-review-report.md). Default `npm run dev` uses the guarded test profile; `dev:runtime` explicitly selects runtime configuration.

Interface simplification and QR printing: completed. Event/station menus, forms, selectors and visible labels are removed; internal ledger context is automatic and historical data is preserved. Customer QR cards print on 80 × 100 mm pages with the QR centered on both axes. Latest gates pass database/migrations, lint, typecheck, 33 regression tests, production build and formatting; 34 browser/server checks and HTTP LAN checkout pass. See [interface and QR report](interface-qr-report.md).

Post-acceptance test seed: completed. Five demo users cover all four roles; reusable event/catalog/QR/stock/order/void/payment data was created only in `ccida_test`. Full regression suite now passes 25 tests across nine files; database checks, lint, typecheck and production build pass. See [seed report](test-seed-report.md) and [test logins](test-seed.md).

Sale-saving 409 correction: completed. A reproduced SUPER_ADMIN station-type conflict now allows sales and settlement on an existing active specialized shift, without closing/reassigning the user's shift or rewriting history. All latest gates pass, including 33 regression tests and 34 production-server/browser checks. Genuine conflicts retain 409 and log the action/reason. See [correction report](operations-409-report.md).
