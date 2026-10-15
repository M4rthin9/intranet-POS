# Normal and VIP customer completion — 2026-10-15

Registration supports Normal and VIP customers, with Normal as the default. Both types retain the same customer account, QR credential and transaction history when their type changes. Registration, POS lookup and the payment workspace display the current type.

The type filter now runs before the database's 200-row result limit and combines with customer name/registration search. Switching events clears the registration edit form, history and card selection. VIP download controls are disabled for unavailable credentials and blocked, cancelled or expired accounts.

Normal customers retain standard QR printing. VIP customers also have individual 86 × 54 mm PDF, PNG and JPG downloads, plus A4 PDF sheets with ten cards per full page. The existing welcome artwork and current customer QR are used. See [customer cards and product tags](customer-cards-and-product-tags.md) for printing instructions.

Validation completed against the isolated `ccida_feature_test` database:

- All 70 tests across 22 files passed, including customer type changes, retained QR/account identity, authorization, assignment boundaries, blocked credentials, QR reissue, card dimensions and decoding.
- ESLint, TypeScript and the production build passed.
- HTTP checks passed for normal QR printing, individual VIP PDF/PNG/JPG downloads, an eleven-card/two-page A4 export and role restrictions.
- Microsoft Edge checked Normal/VIP labels, server type filters, editor defaults, Normal → VIP → Normal saves, refreshed lists, VIP download controls and logout using the final production image.

All synthetic customers used for validation are in the isolated test database. Physical printer/scanner acceptance remains an operator check.

The application image was deployed to the existing POS service on port 8081. All fifteen migrations are applied. The operational database retained six users and zero registrations, orders and payments, matching the pre-update counts. A verified custom-format backup is stored at `.local/backups/customer-vip-20261015/pre-update.dump` (SHA-256 `E399155184212862951E8A1FAE5476AC2E15E61E7DF336B1087CB909AC81BDED`).

PostgreSQL entered automatic recovery during rollout and returned to ready without a reset or restore. The POS app was restarted after recovery; both its page and health endpoint returned HTTP 200 and Docker reported it healthy. The backup worker was restarted after recovery. The VIP export endpoint correctly required authentication (HTTP 401). ERP services were not changed. Initial page requests timed out during the host's slow recovery/startup period; the final page check passed.
