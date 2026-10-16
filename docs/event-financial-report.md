# Consolidated event financial report

Open **Reports → รายงานรวมทั้งกิจกรรม** (the default report tab), select the event, and use **พิมพ์รายงานรวม / บันทึก PDF**. All sections print together in one A4 document; choose Save as PDF in the browser to save one file. Use the regular browser when selecting a PDF destination; the automatic-printing cashier shortcut sends print jobs straight to its default printer.

The report covers the whole selected event, regardless of date filters used in other report tabs. Its timestamp uses Asia/Bangkok. The same database snapshot supplies all sections:

1. Executive summary: net sales, confirmed receipts, outstanding balance, and cancelled-sale disclosure.
2. Confirmed receipts split into PromptPay and net cash (excluding change). Other historical payment methods, if present, are also disclosed.
3. Every sold category, quantity, and subtotal.
4. Every product sold, grouped by its category at the time of sale, with the recorded unit price, quantity, category subtotal, and final total. Historical name/price/category changes remain separate rows.
5. Reconciliation differences and finance/reviewer signature spaces.

Sales include RECORDED and PAID orders. Voided and cleared orders are excluded. Receipts include CONFIRMED payments and exclude cleared, pending, voided, and refunded payments. Report permission is required; the API is authenticated and never cached.

All four reconciliation differences should be zero: payment-method total versus confirmed receipts; category total versus net sales; product total versus net sales; net sales versus confirmed receipts plus outstanding balances. An outstanding balance can be nonzero while the report reconciles correctly. A mismatch is displayed for review; totals are never adjusted to force agreement.

Verification: isolated database tests cover cash/change, PromptPay, unpaid sales, historical price/name snapshots, corrected payments, voided orders, empty events, event isolation, and permissions. Browser verification uses synthetic data with 72 product rows across four categories, mobile sizing, print controls, and A4 PDF output.
