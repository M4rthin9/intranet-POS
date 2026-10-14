# Phase 2 — Event, registration and QR

Reused: foundation transaction/audit/auth/RBAC services and relational identities. No schema replacement or data reset.

Implemented: event create/edit/open with safe state transitions; registration create/search/edit/status; opaque 256-bit QR issuance; local QR rendering; 58 mm print layout; audited QR reprints; blocking; transactional reissue and retained credential history. Wrong-event, revoked, settled and blocked credentials are rejected on the server. Cancellation/expiration rejects unpaid accounts. Reissue preserves account identity and financial history.

UI: Thai-first application shell, event/station selection, registration editor/table/history, administrator account/station/organization editors. Registration collects optional phone/group/table data only when entered.

Validation includes a real PostgreSQL integration test for registration, secure token format, QR PNG, reissue, revocation, event isolation, blocking and unauthorized registration. See `validation/phase-2` for all checks and production build evidence.
