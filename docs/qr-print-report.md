# QR and receipt printing follow-up

Date: 14 October 2026 · Asia/Bangkok.

The payment section now includes **พิมพ์ QR พร้อมเพย์** beside the generated QR and on pending history rows. Customer and PromptPay QR cards share an 80 × 120 mm layout. Every original and COPY receipt uses 80 mm paper.

## Layout and operation

Thermal documents use equal 4 mm margins and 72 mm content. Both cards center the 46 mm QR on the paper, with details above and instructions below. The customer card identifies the registration. The payment card shows its number, customer, exact amount and original recipient. Maximum-length names wrap within the card. Receipt height follows its actual items and COPY heading. Reports retain A4.

Select 80 mm paper, actual size/100% scale and disabled browser headers/footers. Use a 120 mm cut length for QR cards. See [printer setup](printer-integration.md) and [payment workflow](payment-workflow.md).

## Controls and data preservation

`payment.qr.print` requires `payment.promptpay.print`, granted to PAYMENT_CASHIER and the super administrator. Each preview/print checks an open operating period, compatible active station, operator's own open shift, active account, pending payment and unchanged outstanding total. It uses the saved payload and creates a `PAYMENT_QR_PRINT` audit. Printing never creates another payment, confirms a transfer, allocates orders or issues a receipt.

One additive migration introduces nullable `Payment.recipientNameSnapshot` and the permission grant, bringing the total to twelve. New payments preserve the original recipient even after settings change. Legacy rows remain unchanged; original idempotent generation responses supply their recipient when available. Otherwise, the card instructs the operator to check the bank application's recipient. Immutable financial triggers protect the new snapshot.

The modal revalidates before invoking the printer. Invalid pending payments hide their QR and block that attempt. Transport/printer failures preserve pending status and allow retry. Previously printed bank QR paper cannot be remotely revoked; remove obsolete cards and verify transfer evidence before confirmation.

All print dialogs use a shared portal outside the application container, fixing hidden receipt/PromptPay content during printing. Receipt measurement runs before display and after content changes. Browser PDF tests clear screen-media overrides before printing, so they exercise the actual print stylesheet. Audited COPY behavior and settlement protection are preserved.

## Validation

All checks pass: twelve migrations and database validation, lint, typecheck, **37 tests across 14 files**, production build, **38 production-server/browser checks**, ordinary HTTP LAN checkout and formatting. The development server health check also returns `ok`. Local documentation links resolve.

Current checks: [phase 8 gates](validation/phase-8/results.md) and [production browser acceptance](validation/final/results.json). Real PostgreSQL regression coverage checks original recipients/payloads, legacy metadata, forbidden roles, audits and confirmed/voided rejection. Browser checks verify embedded PDF content, paper dimensions, centered QR, maximum-length names, original/COPY receipts, printer failures, stale previews and retry recovery.

- [Customer QR PDF](validation/final/customer-qr-80mm.pdf)
- [PromptPay QR PDF](validation/final/promptpay-qr-80mm.pdf) and [preview](validation/final/promptpay-qr-80mm.png)
- [Maximum-length PromptPay names](validation/final/promptpay-long-name-80mm.pdf)
- [Original receipt](validation/final/receipt-original-80mm.pdf) and [COPY receipt](validation/final/receipt-80mm.pdf)
- [Receipt measurements](validation/final/receipt-layout.json)

Existing users, financial history and runtime configuration are preserved. Physical paper delivery, driver behavior and live bank acceptance require on-site commissioning; automation verifies the application and generated PDFs.
