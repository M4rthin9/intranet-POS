# Phase 4 — Payment and PromptPay

Reused: account QR resolution, server exact-money helpers, stations/shifts, shared idempotency and transaction/audit services. Added pending-account uniqueness and positive payment/allocation constraints through a forward-only migration.

Implemented: payment station scan, unpaid aggregation, purchase timeline/detail, exact server-generated local dynamic PromptPay, payment numbering/reference/evidence, manual confirmation, allocation per order, atomic account settlement, duplicate payment and concurrent order/payment protection, persistent receipt snapshots and audited COPY reprints. Admin settings editor validates recipient format. No live bank recipient or mock bank verifier is installed.

Tests cover standard CRC vector and amount encoding, two POS orders, spoofed payment amount, QR not auto-confirming, order reservation, duplicate generation/confirmation, exact allocations, SETTLED rejection, receipts/reprint audit, restricted roles, and simultaneous order/payment operations. All required command evidence is in `validation/phase-4`.
