# Security review and launch checklist

Implemented: salted scrypt password hashing; opaque 256-bit sessions stored as SHA-256 digests; HttpOnly/SameSite=Strict cookies, configurable Secure attribute and expiry; current active-user/role checks on every request; backend granular RBAC; session revocation on disabling, password change or role change; login throttling by normalized username across source IPs; failed login audit; strict configured Origin for mutations; JSON content type and 64 KiB streaming body limit; Zod validation; parameterized SQL and fixed validated CLI identifiers; exact integer money; idempotency; serializable financial transactions with bounded backoff; database financial checks and append-only records.

New hashes use versioned scrypt with N=131072, r=8, p=1 and a 16-byte random salt, following [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Login derivation runs asynchronously. Existing hashes remain verifiable and upgrade on successful login with redacted audit metadata. Session creation rechecks active role, username and credentials within its transaction.

Headers restrict framing, MIME sniffing, resource/connect origins, workers/objects, referrers, camera, microphone and geolocation. Local assets/system fonts avoid Internet dependencies. CSP allows inline scripts/styles required by Next.js. React debugging receives unsafe-eval only in development; production excludes it. Nonce-based CSP remains optional future hardening. The application does not render untrusted HTML.

Runtime password hashes, database/session secrets and raw customer tokens are excluded from list/report responses except authorized registration printing. PromptPay configuration is administrator-only; recipient metadata is naturally encoded in the authorized payment QR. Do not put archives under public or commit .env files. Tests are gated to a separate `_test` database, and test configuration is loaded independently of the runtime .env.

Database audit/item/allocation/stock/idempotency records are append-only; financial deletes and snapshot mutation are blocked. Migration ownership is separate from the container application's PostgreSQL role, preventing the app from disabling triggers. A DBA remains privileged; protect owner credentials and independent backup copies.

Commissioning checklist:

- Configure reachable production database credentials; confirm the current `.env` connection. Bootstrap the first administrator with a strong unique secret, then create staff roles and stations.
- Trust internal HTTPS certificates on clients, enable Secure cookies and expose the application only through the trusted proxy/LAN firewall. Caddy overrides X-Real-IP; do not trust arbitrary forwarded headers on an externally reachable app port.
- Validate the institutional PromptPay recipient and manual evidence procedure. QR generation or printing does not prove a bank transfer.
- Validate physical 80 mm printers and HID scanners, stock counts and shift/event-closing procedures.
- Enable/monitor scheduled and event-closing backups, protect archive ACLs and prove restore before opening the real event.
- Run target-machine capacity tests and verify clock synchronization, power protection and database/application health.

Dependency audit evidence is stored under validation/final. The pinned lockfile and reviewed dependency overrides remove the initially detected advisories. This engineering review is not an independent penetration test.
