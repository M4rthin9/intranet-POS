# Separate role pages and centered login

The user clarified that Cashier Register means a new customer-registration cashier, while the existing payment cashier remains. This supersedes the original four-role specification by adding REGISTRATION_CASHIER; existing users keep their current roles and passwords.

| Role                                    | Landing URL  | Available pages                                         |
| --------------------------------------- | ------------ | ------------------------------------------------------- |
| SUPER_ADMIN                             | `/dashboard` | Dashboard and existing administration/operations pages  |
| ADMIN                                   | `/dashboard` | Aggregate dashboard and registration for assigned event |
| CASHIER / Cashier POS                   | `/pos`       | POS only                                                |
| REGISTRATION_CASHIER / Cashier Register | `/register`  | Customer registration and QR only                       |
| PAYMENT_CASHIER                         | `/payments`  | Payment only                                            |

Pages enforce authentication and allowed roles on the server. Visiting another role's page redirects to the user's own landing page. Navigation uses real URLs. Cashier Register, Cashier POS and Payment Cashier have full-width work pages with no sidebar/menu. Super Admin assigns staff events in Users, and staff sessions are automatic with no shift buttons. Existing API permissions continue to enforce role separation; the registration cashier cannot create sales or confirm payments. See [current event assignments](user-event-assignment.md), [desktop POS](pos-desktop-redesign.md) and [payment workspace](payment-workspace-redesign.md).

15 October registration-only follow-up passes 44 regression tests, 42 production-server/browser checks, database/twelve migrations, lint, typecheck, production build and formatting. Desktop/tablet/mobile acceptance confirms no navigation or dashboard API requests. Use `demo.register` for this role; `demo.registration` is Admin. See [registration-only page and screenshots](registration-only-page.md). Counts below describe the original role migration release.

Admin receives `dashboard.view` through a separate aggregate-only `/api/dashboard` endpoint. This does not grant detailed reports, CSV exports or payment controls. Dashboard responses omit the customer debt list and station metadata. Superadmin retains its existing authority.

Login is one centered card on desktop and mobile. Successful login/logout uses a full navigation so an old user's client route cache is not reused. Existing opaque QR printing remains centered on 80 mm paper.

Two additive migrations extend the role enum and create grants. They are separate so the new PostgreSQL enum value is committed before it is used. All eleven migrations have been applied to the isolated test database. No user role, existing transaction, financial snapshot, event or audit record was overwritten. Prisma was regenerated while only the owned local Next.js server was stopped, then the server was restarted.

The idempotent seed adds `demo.register` with REGISTRATION_CASHIER. Existing demo accounts remain unchanged; `demo.registration` is still ADMIN and now opens on the dashboard. New demo users use CCIDA-Test-2026! unless a seed password was supplied.

Validation passes schema/migration checks, lint, typecheck, **35 regression tests across 13 files**, production build and formatting. **36 production-server/browser checks** pass, plus ordinary HTTP LAN checkout. Tests verify five-role authentication, Admin dashboard authorization, registration-only cashier signup/QR creation, forbidden sale/payment APIs, one-page cashier menus, cross-role URL redirects, login/relogin and existing payment/stock/audit/backup flows.

The first full regression run hit one transient database reachability failure during checkout setup. Database health and the focused order suite passed, then the complete 35-test run passed. Transaction retry rules were not weakened or changed.

Browser measurements verify horizontal and vertical card centering without overflow at 1366 × 900 and 390 × 844. Evidence: [desktop login](validation/final/login-desktop.png), [mobile login](validation/final/login-mobile.png), [registration cashier page](validation/final/registration-cashier.png), [browser results](validation/final/results.json), [phase gates](validation/phase-8/results.md). The local app is healthy at http://localhost:3000.
