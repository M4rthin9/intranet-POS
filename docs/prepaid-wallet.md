# Event prepaid credit

Create or edit an event and choose **Prepaid · เติมเครดิตก่อนซื้อ ห้ามใช้เกินยอด** before any sales or payments are recorded. Existing Wallet (pay later) and Instant events retain their behavior.

At the payment counter, scan the participant QR, enter the credit amount in baht, and choose Cash or PromptPay. Each top-up supports ฿0.01–฿10,000; additional top-ups can be made later. Count cash or verify the bank transfer, then confirm receipt of the money. Pending payments provide no spendable credit. Confirmation issues a top-up receipt and keeps the account active.

At POS, scan the same participant QR. The checkout shows current credit and the balance after purchase. Successful purchases consume confirmed credit from the oldest top-ups first. Insufficient credit is rejected by the server; transaction retries and simultaneous cashiers cannot spend the same credit twice. Wallets belong to one registration in one event.

A Super Admin can void a prepaid purchase to return its credit. A top-up that funded any non-voided purchase cannot be voided or refunded. Only an entirely unused top-up can be refunded through the existing verified refund control. There is no partial cash-out or transfer between wallets. The event stays open while unused credit remains. Bulk event sales clearing is unavailable for prepaid events.

Reports count money received at top-up confirmation and sales at purchase time. Reconciliation is **sales + unused credit = confirmed money received + outstanding sales**; spending credit does not record a second cash/PromptPay receipt.

Deploy the additive `20261029160000_prepaid_wallet` migration before this application version. It adds the PREPAID option and payment purpose, retaining existing payments as SALE. Do not roll back to an older application after prepaid events have been used: the old application does not enforce prepaid spending rules. Keep the migrated schema and use a forward fix for any later issue.

Validation: `npm test -- tests/prepaid-wallet.test.ts` on a database ending in `_test`, plus the existing payment/report/financial integrity tests. Never seed or run integration fixtures against the live Neon database.
