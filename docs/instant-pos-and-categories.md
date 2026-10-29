# Event payment modes and POS categories

In **Events**, choose the POS payment mode before the first sale:

- **Wallet** (default): scan the registered customer's QR and settle later at the payment desk.
- **Instant**: sell to a walk-in customer without a customer QR. Choose cash or PromptPay, prepare the sale, verify funds, then confirm and print the receipt. Cash checkout records received cash and change. PromptPay uses the configured recipient and requires a bank reference and verification of incoming funds.

Payment mode cannot change after the event has sales. Existing events remain Wallet.

In **Users**, edit a cashier and select the allowed POS categories. An empty selection gives no catalog access. Existing cashiers need explicit assignments after upgrading. Super Admin retains access to all categories. Products and categories are filtered by the server, and order submissions recheck assignments; favorites, search and product scanning therefore use the same permitted catalog.

Instant sales use a separate walk-in customer/account record for each sale, preserving the existing payment allocation, receipt, stock, correction and reporting ledgers. Walk-in records appear in customer/account counts. Preparing a sale reserves stock and leaves an unpaid order until payment is confirmed. Reopen pending payments from recent sales after closing checkout or reloading. Administrators can correct unpaid sales using the existing payment/order void controls. Confirmation is manual; displaying a QR does not prove a bank transfer succeeded.

Deploy the migration with `npm run db:migrate` before starting the updated app, then assign cashier categories. No operational migration or deployment is performed by the test commands below.

Validation (isolated test database only):

```powershell
npm run db:migrate:test
npm test
npm run typecheck
npm run lint
npm run build
node node_modules/tsx/dist/cli.mjs scripts/instant-pos-e2e.ts
```

The browser check covers category assignments through the administration UI, walk-in cash and PromptPay checkout, a lost sale response followed by reload/retry, pending-payment recovery, and receipt display. Preview screenshots are saved under `.local/previews/`.
