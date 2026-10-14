# Corrections, concurrency and immutable history

Only SUPER_ADMIN may void orders/payments, record a verified refund, or reopen a settled account. Every correction requires a reason. Recorded unpaid orders may be voided; paid orders require payment void first. Pending payment reserves orders and must be voided before order changes. A payment void preserves allocations and receipt, restores its orders to RECORDED and reactivates the account (retaining a security BLOCKED state). Refund recording requires explicit verified bank-refund reference; the application does not transfer money or contact a bank.

Reopening a settled account is an audited permission-controlled action. Prior paid orders and payments remain immutable; newly recorded purchases can settle in a later payment. CLOSED/ARCHIVED events reject operational mutations.

Persistent idempotency keys are actor/action scoped with canonical request hashes. Reusing a key for different data is rejected. Retries and simultaneous submissions return one committed result. Serializable transactions with bounded conflict retries cover QR replacement, checkout, payment, corrections and shift changes. Partial indexes enforce one active credential/account, one pending payment/account, one open shift/user/station.

Database triggers reject audit, item, allocation, stock movement and idempotency mutation/deletion; operational financial deletes are forbidden. Order/receipt snapshots and payment financial facts are immutable. Deferred constraints check exact order/item and confirmed payment/allocation reconciliation at transaction commit. Database owners can disable database triggers; production separates application access from migration/DBA credentials and relies on protected backups as additional evidence.
