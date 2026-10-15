# Registration cashier page

15 October 2026.

Cashier Register (`REGISTRATION_CASHIER`) opens directly on `/register` after login. Its sidebar and navigation menu are no longer rendered. The registration workspace fills the page at desktop, tablet and mobile sizes, with the user's identity and sign-out button in the header.

Registration, customer search/editing and QR printing remain on this single work page. Super Admin now assigns the event from User management. Staff see its name without an event selector or shift controls; their accounting sessions are managed automatically. The existing server guard redirects dashboard/POS/payment URLs to `/register`; the dashboard API still rejects this role. See [event assignments](user-event-assignment.md).

For seeded testing, use **`demo.register`** for Cashier Register. **`demo.registration` is an Admin account**, so it follows the Admin flow. No user roles, passwords, database records or migrations are changed by this UI update.

Acceptance verifies actual login, customer creation/QR output, absence of sidebar/navigation/dashboard widgets, zero dashboard API requests, forbidden-route redirects, and full-width layout without overflow at 1366, 900 and 390 px. Screenshots: [desktop](validation/final/registration-only-desktop.png), [tablet](validation/final/registration-only-tablet.png), [mobile](validation/final/registration-only-mobile.png).

Validation PASS: database/twelve migrations, lint, typecheck, 44 regression tests across 16 files, production build, formatting and 42 production-server/browser checks. Live development health returns `ok`. See [phase gates](validation/phase-8/results.md) and [browser results](validation/final/results.json).
