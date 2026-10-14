# MASTER DEVELOPMENT PROMPT
## CCIDA Event POS & Payment Management System

You are the senior full-stack architect and lead engineer responsible for analyzing, designing, implementing, testing, documenting, and production-hardening an institutional Intranet POS system.

Your task is to work directly with the CURRENT repository.

Do not create a disconnected replacement project unless the existing architecture is fundamentally unusable.

First analyze the complete repository, understand the existing stack, database, UI system, coding conventions, authentication, deployment configuration, and reusable components.

Then implement the system through all phases defined below.

---

# 1. PROJECT NAME

**CCIDA Event POS & Payment Management System**

Thai name:

**ระบบบริหารการจำหน่ายสินค้าและชำระเงินภายในกิจกรรม ทัณฑสถานบำบัดพิเศษกลาง**

The application is an:

**Intranet-first Web Application / PWA**

It must work primarily over the internal LAN.

Example:

```text
http://pos.ccida.local
```

The core POS operation must NOT require public internet access.

External internet may only be required later for optional payment verification integrations.

---

# 2. CORE BUSINESS CONCEPT

The system uses one unique customer QR as an account identifier.

A registered customer:

1. receives a QR from the Registration desk,
2. enters the event,
3. purchases products from one or multiple POS stations,
4. does NOT pay at those POS stations,
5. each purchase is attached to the customer's QR account,
6. purchases may happen multiple times,
7. before leaving the controlled area, the customer goes to the Payment station,
8. Payment Cashier scans the same QR,
9. the system aggregates all unpaid orders,
10. the system generates a PromptPay QR for the exact outstanding amount,
11. payment is confirmed,
12. a receipt is generated,
13. the account becomes SETTLED.

Core principle:

**BUY MANY TIMES → ONE CUSTOMER QR → PAY ONCE BEFORE EXIT**

---

# 3. NON-NEGOTIABLE ARCHITECTURAL RULE

The QR must NOT contain:

- product information
- customer balance
- transaction details
- mutable financial information

The QR should contain only a secure random opaque account token.

Example:

```text
CCA-EVT-4D8F7K2M9Q
```

or a cryptographically secure UUID/token.

The server must use that token to retrieve the account from the central database.

---

# 4. APPLICATION ARCHITECTURE

Preferred architecture if compatible with the existing repository:

```text
Frontend / Web App
Next.js App Router
TypeScript
Tailwind CSS

Database
PostgreSQL

ORM
Prisma

Validation
Zod

Forms
React Hook Form

Tables
TanStack Table

Charts
Recharts

Deployment
Docker / Docker Compose

Mode
Intranet-first

Client Devices
Windows PCs
iMin POS
Touchscreen POS
Tablet browser
Laptop

Peripheral Support
USB QR scanner
58 mm thermal receipt printer
```

If the repository already uses equivalent technologies, prefer extending existing architecture instead of unnecessary rewrites.

---

# 5. USER ROLES

The system has exactly four primary operational roles.

## SUPER_ADMIN

Thai display name:

**ผู้ดูแลระบบสูงสุด**

Can access everything.

Permissions include:

- Dashboard
- Registration
- Orders
- Payment
- Products
- Categories
- Events
- Users
- Roles
- Stations
- PromptPay settings
- Reports
- Audit Logs
- Void operations
- Corrections
- Backup
- System configuration

---

## ADMIN

Thai display name:

**เจ้าหน้าที่ลงทะเบียน**

Primary responsibility:

Registration and Customer QR management.

Allowed:

- create registration
- search registrations
- view registration status
- generate customer QR
- reprint QR
- block QR
- replace/reissue QR
- view whether account is active or settled

Not allowed:

- sell products
- receive payments
- confirm payments
- change product prices
- manage users
- delete transactions
- modify system settings

---

## CASHIER

Thai display name:

**เจ้าหน้าที่ขายสินค้า**

Primary responsibility:

Product order entry only.

Allowed:

- view products
- search products
- filter categories
- add products to cart
- change quantity before checkout
- remove cart item before checkout
- scan customer QR
- create order
- view own recent orders

Not allowed:

- receive payment
- create PromptPay payment QR
- confirm payment
- register customers
- change prices
- manage users
- delete completed transactions
- void completed orders

---

## PAYMENT_CASHIER

Thai display name:

**เจ้าหน้าที่รับชำระเงิน**

Primary responsibility:

Final settlement.

Allowed:

- scan customer QR
- view unpaid orders
- view purchase timeline
- calculate outstanding amount
- generate PromptPay QR
- confirm payment
- print receipt
- reprint receipt

Not allowed:

- add products
- edit product prices
- create registrations
- manage users
- delete transactions
- edit system settings

---

# 6. RBAC REQUIREMENT

Do NOT rely only on UI visibility.

Backend authorization must validate permissions for every privileged operation.

Create granular permissions such as:

```text
registration.create
registration.view
registration.qr.create
registration.qr.reprint
registration.qr.block
registration.qr.reissue

product.view
product.create
product.update
product.archive

order.create
order.view
order.view_own
order.void

payment.view
payment.promptpay.create
payment.confirm
payment.void
payment.receipt.print
payment.receipt.reprint

event.manage

station.manage

user.manage

report.view

audit.view

settings.manage

backup.manage
```

SUPER_ADMIN may have:

```text
*
```

---

# 7. EVENT MANAGEMENT

The system must support reusable events.

Example:

```text
EVENT-2026-001
EVENT-2026-002
```

Each event must isolate:

- registrations
- orders
- payments
- reports
- statistics
- QR accounts

Event statuses should include:

```text
DRAFT
OPEN
CLOSED
ARCHIVED
```

---

# 8. REGISTRATION SYSTEM

Registration records should support fields such as:

```text
registrationNumber
eventId
customerName
phone
group
tableNumber
guestCount
notes
accountToken
status
createdBy
createdAt
updatedAt
```

Use only fields actually required by the workflow.

Do not over-collect personal information.

Registration statuses:

```text
ACTIVE
SETTLED
BLOCKED
CANCELLED
EXPIRED
```

QR replacement must NOT lose previous orders.

When a QR is replaced:

```text
Old QR -> REVOKED
New QR -> ACTIVE
Same customer account
Same historical transactions
```

Keep QR issuance/reissue history.

---

# 9. FAST POS INTERFACE

Cashier POS must prioritize SPEED.

Design for:

- touchscreen
- high customer volume
- minimal clicks
- large product buttons
- large checkout button
- quick quantity adjustment
- product search
- product code search
- category tabs
- favorite products
- recent products
- keyboard shortcuts where useful

Typical screen:

```text
Categories
---------------------------------
อาหาร | เครื่องดื่ม | ขนม | อื่นๆ

Products                 Cart
---------------------------------
Americano    ฿40         Americano x2    ฿80
Thai Tea     ฿45         Cake x1         ฿60
Cake         ฿60

                              TOTAL ฿140

                           [ CHECKOUT ]
```

Checkout flow:

```text
Cart
↓
Checkout
↓
Scan Customer QR
↓
Validate Account
↓
Show Current Order
↓
Show Existing Outstanding
↓
Confirm
↓
Record Order
```

Cashier does NOT receive money.

---

# 10. ORDER SYSTEM

Use immutable financial snapshots.

Order item fields should include:

```text
productId
productCodeSnapshot
productNameSnapshot
unitPriceSnapshot
quantity
lineTotal
```

Changing a product's future price must NOT modify historical orders.

Order statuses:

```text
DRAFT
RECORDED
PAID
VOIDED
```

Once an order reaches RECORDED, normal Cashiers cannot modify it.

---

# 11. VOID INSTEAD OF DELETE

Financial and operational records must never be silently deleted.

Do NOT provide:

```text
DELETE ORDER
DELETE PAYMENT
```

Use:

```text
VOID
```

Voiding requires:

- authorized user
- reason
- timestamp
- audit trail

Example:

```text
ORD-20261014-000145

VOIDED

Reason:
Incorrect quantity

Voided by:
SUPERADMIN01

Timestamp:
2026-10-14 13:42
```

---

# 12. CUSTOMER PURCHASE TIMELINE

Payment Cashier should see:

```text
REG-00125

10:02 POS-01     ฿120
10:35 POS-03     ฿220
11:17 POS-02     ฿180
12:10 POS-01      ฿80

-----------------------
OUTSTANDING       ฿600
```

Allow drilling down into order items.

---

# 13. PAYMENT SYSTEM

Payment entity statuses:

```text
PENDING
AWAITING_CONFIRMATION
CONFIRMED
FAILED
VOIDED
REFUNDED
```

Payment must reference:

- customer account / registration
- event
- cashier
- station
- amount
- payment method
- payment reference
- timestamps

Generate payment numbers automatically:

```text
PAY-20261014-000001
```

---

# 14. PAYMENT ALLOCATION

Implement explicit payment allocation.

Example structure:

```text
Payment
   |
   +--- PaymentAllocation -> Order 001
   |
   +--- PaymentAllocation -> Order 002
   |
   +--- PaymentAllocation -> Order 003
```

This ensures proper reconciliation and future support for partial/multiple payment if needed.

Initial version may require exact full settlement.

---

# 15. PROMPTPAY QR

PromptPay configuration must only be editable by SUPER_ADMIN.

Configuration may include:

```text
PromptPay Type
PromptPay Identifier
Display Name
Enabled
```

Payment Cashier does NOT manually enter the payment amount.

The server computes:

```text
outstandingAmount
```

and generates the QR for exactly that amount.

Example:

```text
Outstanding: ฿600

Generate PromptPay QR

Amount encoded:
฿600.00
```

Generating a QR must NOT automatically mark the payment as confirmed.

---

# 16. PAYMENT VERIFICATION

Initial version:

Payment Cashier verifies payment evidence and manually confirms payment.

Future version:

Allow integration with an authorized bank/payment provider API.

Design the payment architecture so automatic verification can be added without rewriting the transaction model.

---

# 17. DUPLICATE PAYMENT PROTECTION

After successful settlement:

```text
Registration.status = SETTLED
```

If scanned again:

Display:

```text
ACCOUNT ALREADY SETTLED

Payment:
PAY-20261014-000251

Amount:
฿600

Paid at:
13:42
```

Do not automatically generate another payment.

Any reopening or correction must require SUPER_ADMIN-level control and audit logging.

---

# 18. RECEIPTS

Support 58 mm thermal receipts.

Receipt data should include:

```text
Organization
Event
Payment Number
Registration Number
Orders / summary
Amount
Payment Method
Payment Date
Payment Cashier
Station
```

Support:

```text
PRINT
REPRINT
```

Reprinted receipts must show:

```text
สำเนา / COPY
```

Every reprint must be audited.

---

# 19. PRODUCT MANAGEMENT

Product fields:

```text
code
name
categoryId
price
image
active
sortOrder
```

SUPER_ADMIN can:

- create
- edit
- archive
- reactivate

Avoid hard delete if a product already appears in historical transactions.

---

# 20. CATEGORY MANAGEMENT

Example categories:

```text
อาหารตามสั่ง
ครัวอีสาน
กาแฟ
เครื่องดื่ม
ขนม
ไอศกรีม
ผลิตภัณฑ์ฝึกวิชาชีพ
อื่น ๆ
```

Allow future categories without code changes.

---

# 21. STATION MANAGEMENT

Every operational device should have a station identity.

Examples:

```text
REG-01
POS-01
POS-02
POS-03
PAY-01
ADMIN-01
```

Station types:

```text
REGISTRATION
POS
PAYMENT
ADMIN
```

Transactions should record:

```text
userId
stationId
eventId
timestamp
```

---

# 22. SHIFT MANAGEMENT

Add station/user shift support.

Open Shift:

```text
User
Station
Start Time
Event
```

Close Shift summary:

```text
Orders
Gross Sales
Voids
Payments
Outstanding impact
Start time
End time
```

---

# 23. INVENTORY

Implement an inventory-ready architecture.

Initial stock support should include:

```text
openingStock
soldQuantity
adjustments
remainingStock
```

Support low-stock warnings.

Do not allow inventory complexity to slow down POS checkout.

Inventory may be configurable per product.

---

# 24. OUTSTANDING MONITOR

Create a dedicated real-time screen.

Example:

```text
UNPAID ACCOUNTS

REG-0215       ฿1,250
REG-0219         ฿750
REG-0232       ฿2,130
REG-0245         ฿420

Accounts Outstanding: 17
Outstanding Amount: ฿13,200
```

Provide:

- search
- sorting
- age/time since last purchase
- event filtering
- status filtering

---

# 25. DASHBOARD

SUPER_ADMIN dashboard should display real-time operational KPIs.

Cards:

```text
Registered
Active
Settled
Outstanding

Orders
Gross Sales
Confirmed Payments
Outstanding Amount

Void Orders
Void Payments
```

Charts:

- sales by hour
- sales by category
- sales by product
- top products
- sales by POS station
- sales by Cashier
- payment timeline
- outstanding amount trend
- void transaction trend
- average order value

Use meaningful charts only.

Avoid dashboard decoration without operational value.

---

# 26. REPORTING

Provide reports for:

- daily sales
- event sales
- date range
- products
- categories
- stations
- Cashiers
- payments
- outstanding accounts
- voids
- registrations
- shift summaries

Support export where practical:

```text
XLSX
CSV
PDF
Print
```

Use the repository's existing export infrastructure if available.

---

# 27. EVENT CLOSING

Before an Event can be closed, show:

```text
Total Registrations
Total Orders
Gross Sales
Confirmed Payments
Outstanding Accounts
Outstanding Amount
Void Amount
```

If:

```text
Outstanding > 0
```

display a warning.

SUPER_ADMIN may still close the Event only through an explicit audited action if business rules allow it.

---

# 28. AUDIT LOG

Audit all sensitive actions.

Examples:

```text
LOGIN
LOGOUT

EVENT_CREATE
EVENT_OPEN
EVENT_CLOSE

REGISTRATION_CREATE
REGISTRATION_UPDATE

QR_CREATE
QR_REPRINT
QR_BLOCK
QR_REISSUE

ORDER_CREATE
ORDER_VOID

PAYMENT_QR_GENERATE
PAYMENT_CONFIRM
PAYMENT_VOID
PAYMENT_REFUND

RECEIPT_PRINT
RECEIPT_REPRINT

PRODUCT_CREATE
PRODUCT_UPDATE
PRODUCT_ARCHIVE
PRICE_CHANGE

USER_CREATE
USER_UPDATE
USER_DISABLE

STATION_CREATE
STATION_UPDATE

SETTINGS_UPDATE

BACKUP_CREATE
RESTORE_EXECUTE
```

Audit fields:

```text
id
actorUserId
actorRole
eventId
stationId
action
entityType
entityId
before
after
reason
ipAddress
userAgent
createdAt
```

Audit records should be append-only.

---

# 29. SECURITY REQUIREMENTS

Implement:

- secure password hashing
- strong authentication
- server-side RBAC
- session expiration
- rate limiting where appropriate
- CSRF protection where relevant
- input validation
- secure cookies
- secrets stored in environment variables
- database constraints
- transaction-safe financial operations
- duplicate-submit protection
- idempotency for critical payment operations
- sanitized output
- safe logging

Do NOT expose:

- database credentials
- PromptPay configuration secrets
- session secrets
- internal tokens

---

# 30. CONCURRENCY AND TRANSACTION SAFETY

The system may have multiple Cashiers working simultaneously.

Prevent race conditions.

Critical workflows must use database transactions.

Especially:

- QR replacement
- order submission
- payment creation
- payment confirmation
- payment allocation
- event closing
- inventory decrement

Prevent double-click / duplicate request creation.

Use idempotency where appropriate.

---

# 31. PWA MODE

Make the application PWA-ready where technically reasonable.

POS devices should be able to install/open it like a native application.

Expected user experience:

```text
Desktop/Home Screen
[ CCIDA POS ]

Click
↓
Full-screen POS
```

Do not create an independent offline financial database on every client.

The central server remains the source of truth.

---

# 32. INTRANET MODE

Primary environment:

```text
Internal LAN
```

Example:

```text
http://pos.ccida.local
```

POS core functions must continue working without public Internet if:

```text
LAN = available
Server = available
```

---

# 33. BACKUP AND RECOVERY

Implement or prepare support for:

```text
Manual Backup
Scheduled Backup
Event Closing Backup
Restore Procedure
```

Only authorized roles may restore.

Document restore procedure clearly.

---

# 34. ERROR HANDLING

Every critical failure must produce understandable UI feedback.

Never silently fail.

Examples:

```text
QR not found
QR blocked
Account settled
Event closed
Product unavailable
Order already submitted
Payment already confirmed
Server unavailable
Printer unavailable
Permission denied
```

Provide safe retry behavior.

---

# 35. USER EXPERIENCE

UI must be:

- Thai-first
- responsive
- fast
- touch-friendly
- professional
- accessible
- modern
- uncluttered

Design should feel like a modern enterprise POS rather than a generic admin template.

Primary Cashier flow must require as few actions as possible.

---

# 36. DESIGN LANGUAGE

Use:

- modern institutional visual language
- professional dashboard
- spacious layout
- clear typography
- restrained use of color
- strong visual hierarchy
- consistent iconography
- status chips
- clear success/warning/error states

Do NOT use excessive gradients, animations, or decorative charts.

---

# 37. DATABASE DESIGN

Design proper relational models for at least:

```text
User
Role
Permission

Event

Station
Shift

Registration
CustomerAccount
QrCredential / QrHistory

Category
Product
Inventory / StockMovement

Order
OrderItem

Payment
PaymentAllocation

Receipt

AuditLog

SystemSetting
PromptPaySetting
```

Use the repository's established tenancy/institution model if one already exists.

Use:

- foreign keys
- indexes
- unique constraints
- timestamps
- appropriate enums
- decimal/money-safe data types

Do NOT use floating point for financial amounts.

---

# 38. MONEY HANDLING

Store money using safe decimal/integer representations.

Never rely on binary floating point for financial calculations.

Server must calculate all authoritative totals.

Never trust totals submitted by the client.

---

# 39. TESTING

Add tests for critical workflows.

At minimum:

### Registration

- create registration
- QR generated
- invalid QR rejected
- blocked QR rejected
- QR replacement works

### Orders

- Cashier creates order
- price snapshot preserved
- Cashier cannot receive payment
- duplicate order submission prevented
- void rules enforced

### Payments

- outstanding calculated correctly
- QR amount calculated server-side
- Payment Cashier can confirm
- duplicate payment prevented
- settled account cannot be repaid
- allocations correct

### RBAC

Verify each role cannot access forbidden actions.

### Concurrency

Test simultaneous order/payment scenarios.

---

# 40. DOCUMENTATION

Maintain documentation inside:

```text
/docs
```

Recommended documents:

```text
docs/architecture.md
docs/database.md
docs/rbac.md
docs/pos-workflow.md
docs/payment-workflow.md
docs/deployment.md
docs/backup-restore.md
docs/printer-integration.md
docs/security.md
docs/testing.md
```

Also create:

```text
docs/implementation-status.md
```

Update it after each phase.

---

# 41. DEVELOPMENT RULES

Before changing code:

1. inspect repository
2. inspect package.json
3. inspect database schema
4. inspect migrations
5. inspect authentication
6. inspect existing RBAC
7. inspect components
8. inspect routes
9. inspect environment configuration
10. inspect Docker/deployment configuration

Reuse existing architecture when appropriate.

Do not duplicate:

- auth systems
- permission frameworks
- UI primitives
- database clients
- utilities
- export infrastructure
- audit infrastructure

---

# 42. MIGRATION SAFETY

Never destroy existing production data.

Prefer forward-only migrations.

Do not:

```text
DROP DATABASE
RESET DATABASE
DELETE ALL DATA
```

unless explicitly authorized.

Seed data must be clearly separated from production data.

---

# 43. PHASE IMPLEMENTATION PLAN

Implement the project through these phases.

---

## PHASE 1 — FOUNDATION & ARCHITECTURE

Analyze repository.

Implement/verify:

- project structure
- database foundation
- authentication
- four roles
- permission system
- server-side authorization
- app shell
- navigation
- station concept
- event foundation
- audit foundation
- system settings
- documentation

Deliver:

```text
Phase 1 report
Database diagram
RBAC matrix
Route map
Architecture documentation
```

---

## PHASE 2 — EVENT, REGISTRATION & QR

Implement:

- Event CRUD
- Event status
- Registration CRUD
- secure customer account token
- QR generation
- QR printing
- QR reprint
- QR block
- QR reissue
- QR history
- search
- status management

Deliver:

```text
Registration workflow
QR security controls
Phase 2 report
```

---

## PHASE 3 — FAST POS

Implement:

- Product categories
- Product CRUD
- POS interface
- category tabs
- product search
- touch controls
- cart
- quantity adjustment
- QR scan at checkout
- account validation
- order creation
- order item snapshot
- station tracking
- Cashier history

Optimize for speed.

Deliver:

```text
Operational POS
Phase 3 report
```

---

## PHASE 4 — PAYMENT & PROMPTPAY

Implement:

- Payment station
- scan registration QR
- unpaid order aggregation
- purchase timeline
- outstanding calculation
- PromptPay dynamic QR
- payment references
- manual payment confirmation
- payment allocation
- duplicate-payment prevention
- SETTLED logic
- receipts
- receipt reprint tracking

Deliver:

```text
Payment workflow
PromptPay workflow
Phase 4 report
```

---

## PHASE 5 — CONTROLS, VOID & AUDIT

Implement:

- order void
- payment void
- correction controls
- mandatory reasons
- approval restrictions
- append-only audit records
- before/after snapshots
- duplicate submission protection
- idempotency
- concurrency controls

Deliver:

```text
Audit coverage matrix
Control documentation
Phase 5 report
```

---

## PHASE 6 — DASHBOARD & REPORTING

Implement:

- Super Admin dashboard
- real-time KPIs
- sales analytics
- outstanding monitor
- cashier performance
- station performance
- product/category reports
- payment reports
- void reports
- registration reports
- exports

Deliver:

```text
Dashboard
Reports
Phase 6 report
```

---

## PHASE 7 — SHIFT, STOCK & EVENT CLOSING

Implement:

- shift opening
- shift closing
- shift summary
- inventory foundation
- stock movement
- opening stock
- low stock warning
- event closing summary
- outstanding warning
- event archive workflow

Deliver:

```text
Shift report
Stock report
Closing report
Phase 7 report
```

---

## PHASE 8 — PRODUCTION HARDENING

Complete:

- PWA configuration
- printer integration
- QR scanner optimization
- Docker deployment
- intranet configuration
- environment configuration
- backup
- restore procedure
- performance optimization
- security review
- validation
- regression testing
- production build
- operator documentation

Deliver:

```text
Production deployment guide
Backup / Restore guide
Security checklist
Testing report
Final implementation report
```

---

# 44. PHASE EXECUTION RULE

For every phase:

1. analyze current implementation
2. state what will be reused
3. implement database changes
4. implement backend
5. implement frontend
6. implement permissions
7. implement audit logging
8. add validation
9. test
10. fix discovered defects
11. run lint
12. run typecheck
13. run relevant tests
14. run production build
15. update documentation
16. produce phase report

Do NOT declare a phase complete while known critical errors remain.

---

# 45. CONTINUOUS EXECUTION

After successfully completing one phase:

Proceed automatically to the next phase.

Do NOT require another prompt such as:

```text
continue
next phase
yes
proceed
```

unless there is a genuinely destructive action requiring explicit authorization.

Continue:

```text
Phase 1
↓
Phase 2
↓
Phase 3
↓
Phase 4
↓
Phase 5
↓
Phase 6
↓
Phase 7
↓
Phase 8
```

---

# 46. DO NOT STOP FOR MINOR DECISIONS

For ordinary implementation choices:

Make the best professional engineering decision yourself.

Do not stop to ask questions about:

- file naming
- component naming
- minor UI details
- ordinary schema indexes
- standard validation
- routine refactoring
- standard library selection

Document the decision instead.

Only stop if an operation would:

- destroy data
- overwrite unknown production configuration
- expose credentials
- require unavailable external credentials
- create serious irreversible changes

---

# 47. CODE QUALITY

The resulting codebase must be:

- modular
- typed
- maintainable
- secure
- testable
- understandable by another developer
- free of unnecessary duplication
- consistent with existing repository conventions

Do not leave major features as mockups.

Do not implement visual-only placeholders for features described as functional.

---

# 48. FINAL VALIDATION

At the end of Phase 8 run a complete system validation.

Validate this end-to-end scenario:

```text
SUPER_ADMIN creates Event
↓
ADMIN registers Customer
↓
ADMIN generates Customer QR
↓
CASHIER adds products
↓
CASHIER scans Customer QR
↓
Order recorded
↓
Customer buys again at another POS
↓
Second Order recorded
↓
PAYMENT_CASHIER scans QR
↓
System aggregates both Orders
↓
System calculates exact outstanding
↓
PromptPay QR generated
↓
Payment confirmed
↓
Payment allocated
↓
Receipt printed
↓
Registration becomes SETTLED
↓
QR scanned again
↓
System blocks duplicate payment
↓
SUPER_ADMIN can see complete Audit Trail
↓
Dashboard and reports reconcile correctly
```

Also test:

```text
Invalid QR
Blocked QR
Reissued QR
Void Order
Void Payment
Duplicate Checkout
Duplicate Payment
Unauthorized API access
Network interruption
Printer failure
Event Closed
```

---

# 49. FINAL DELIVERABLE

When all phases are complete, provide a final project report containing:

1. implementation summary
2. repository changes
3. architecture
4. database models
5. migrations
6. RBAC
7. routes
8. POS workflow
9. payment workflow
10. PromptPay design
11. reporting
12. audit controls
13. security controls
14. testing results
15. build status
16. deployment instructions
17. backup/restore
18. known limitations
19. optional future improvements
20. exact commands to run the system

End with a concise production readiness status:

```text
READY
READY WITH CONDITIONS
NOT READY
```

and explain any remaining conditions.

---

# PRIMARY OBJECTIVE

Build a production-quality Intranet POS and deferred-payment system that is:

**FAST — CONTROLLED — TRANSPARENT — AUDITABLE — SECURE — EASY TO OPERATE**

The system must be suitable for real operational use inside:

**ทัณฑสถานบำบัดพิเศษกลาง**