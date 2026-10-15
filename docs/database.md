# Database and migration safety

The foundation migration creates Role, Permission, RolePermission, User, Session, RateLimit, Event, Station, Shift, Registration, CustomerAccount, QrCredential, Category, Product, Inventory, StockMovement, Order, OrderItem, Payment, PaymentAllocation, Receipt, AuditLog, SystemSetting, PromptPaySetting, IdempotencyRecord and Sequence. Later phases add forward-only SQL constraints and protections.

No migration resets databases. Development and integration tests use separate databases in an isolated cluster. Bootstrap creates only the first administrator, four role grants and station configuration; it inserts no sample customers, products, orders or payments. Tests create unique event codes and preserve their records as test evidence in the isolated test database.

Integer satang is exact. Product prices are capped to prevent overflow. Authoritative totals and immutable order item snapshots are calculated on the server. Foreign keys restrict deletion of referenced operational entities. Voids preserve rows and history.

Run `npm run db:migrate` for forward-only deployment and `npm run db:check` to validate schema and migration history. Never use `prisma migrate reset` or `db push --force-reset` with operational data.

Nine forward migrations include deferred financial constraints/append-only triggers, account/item/allocation indexes, nonblocking registration/order/payment sequences and absolute TIMESTAMPTZ fields. Existing UTC instants and financial record numbers are preserved. Legacy Sequence rows are retained; new counters increase globally with Thai-date prefixes and may have rollback gaps. Native timestamps align SQL chart hours and report boundaries with Asia/Bangkok independent of server timezone. Schema-to-database drift validation reported no differences.

Registration status is stored once on its one-to-one CustomerAccount and exposed as account.status. Settlement updates that canonical status to SETTLED atomically with payment, allocation and order changes, avoiding two independently mutable status fields.
