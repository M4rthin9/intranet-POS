# Event analytics and receipt layout follow-up

Date: 14 October 2026 · Asia/Bangkok.

Restores event registration and event-specific sales analytics, and adapts every 80 mm paid receipt to the supplied reference. Existing accounts, roles, transactions, snapshots and 80 mm customer/PromptPay QR cards are retained.

## Events

SUPER_ADMIN has **กิจกรรม** at `/events` to create, edit and open events. The page provides customer-registration and sales-analytics shortcuts, and controlled closing with a reason. Closed events retain their history and cannot be edited or reopened. Existing close guards still require closed shifts, resolved pending payments and reconciled balances; the UI does not override unpaid balances.

Work pages identify their selected event. Choose an OPEN event before registration or checkout. An open shift locks its event selector; an explicit server switch also rejects changing events until the shift closes. Automatic station assignment continues. Restored event selection does not add event-management pages to cashier roles.

Dashboard/report selection is independent of the working shift and supports draft, open, closed and archived events. Admin retains aggregate dashboard access without detailed-report or event-management escalation. Reports and printed report headings identify the selected event. Viewing another event does not move existing orders or change the operator's shift. Global administration/settings remain available when no event is open.

## Paid receipt

All receipts remain 80 mm wide, with 4 mm margins and 72 mm content. The reference-inspired layout has a centered CCIDA mark and organization, optional header, receipt/customer/cashier/event details, item descriptions with quantity × unit price, right-aligned amounts, totals, item count, footer and Thai payment/print timestamps. Receipt height follows its content. No REPRINT title or queue number is printed. Audited copies retain a small `สำเนา / COPY` marker.

In **ตั้งค่า**, SUPER_ADMIN can configure receipt header/footer text, the footer QR's URL or short text, and its label. Leave the QR value empty to hide it. The receipt QR is configurable information; PromptPay payment QR generation remains a separate operation. Content is generated locally without fetching the QR destination. Input is limited to 240 UTF-8 bytes to keep the thermal QR legible. Decorative settings apply when a receipt is issued for printing; financial snapshots remain immutable, including legacy receipts.

The bottom CODE128 barcode contains the receipt's existing public number (`PAY-…`), which uniquely identifies its one-to-one payment/receipt record. Barcodes are generated locally using [bwip-js](https://github.com/metafloor/bwip-js). Scan it and press Enter in either the main payment scanner or **พิมพ์สำเนาจากบาร์โค้ดใบเสร็จ**. The server finds the saved receipt, requires reprint permission, verifies that the payment is confirmed, marks COPY and audits the attempt. Receipts can be retrieved after event closing. Missing, invalid or voided receipts are rejected. No new payment, allocation or customer settlement is created by scanning.

When no events are open, the payment page remains available for receipt reprints without opening a shift or creating a new operating period. New payment generation remains disabled; server confirmation/closing guards remain enforced.

## Engineering and validation

All current checks PASS: **41 tests across 15 files**, **42 production-server/browser checks**, database validation and twelve existing migrations, lint, typecheck, production build, formatting and HTTP LAN checkout. Dependency audit reports zero vulnerabilities. PDF dimensions confirm 80 mm originals/COPY receipts, and actual receipt symbols decode at 203 dpi. The completed flow covers event creation, registration, sale/payment, safe closing, historical analytics and receipt reprints when only closed events are listed.

Reuse of existing event APIs, guarded role routes, reports, shift boundaries and immutable receipts avoids a schema migration. Receipt presentation uses an additive `receipt-layout` system setting. Updating only the organization preserves configured QR settings. New dependencies are pinned; PNG/ZXing packages are development-only independent decoders used to verify printed symbols.

Current command results: [phase 8 gates](validation/phase-8/results.md), [browser acceptance](validation/final/results.json), [HTTP LAN acceptance](validation/final/http-lan.json). Tests cover explicit event switches, separate ledgers, wrong-event QR, closed/missing event rejection, receipt settings, independently decoded QR/barcodes, audited reprints, preserved financial snapshots, denied roles and closed/voided receipt behavior. Browser acceptance exercises actual event creation, registration, sale/payment, closing and historical dashboards, configurable QR settings, scanned barcode reprinting and 203 dpi raster decoding.

Evidence: [receipt preview](validation/final/receipt-sample-layout-80mm.png), [original receipt PDF](validation/final/receipt-original-80mm.pdf), [COPY receipt PDF](validation/final/receipt-80mm.pdf), and [closed-event dashboard](validation/final/event-analytics-closed.png). Physical scanner/printer behavior remains part of on-site acceptance.
