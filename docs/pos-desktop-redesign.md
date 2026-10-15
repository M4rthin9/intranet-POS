# Desktop POS and QR checkout redesign

15 October 2026.

The POS cashier now has a full-width work page with a compact header and its assigned event. There is no single-item sidebar. Products sit on the left; the cart stays on the right with a visible total and checkout button. Product and cart lists scroll independently within the desktop workspace, so a long catalog does not push checkout below the screen.

Product cards show readable prices, a selected quantity badge, favorite controls and available stock. Cart rows have compact quantity controls and a remove button; Clear is available for an unsent cart. Quantity increases respect the displayed stock and 99-item limit. The server still validates price, stock, account status and the assigned event. Recent sales are available in a collapsible section.

## QR checkout

Click **ตรวจสอบ QR และบันทึก** to open a centered native modal above the page. The scanner input receives focus immediately. Scan the existing customer QR and press Enter, review the customer's name and totals, then confirm the sale. A valid lookup focuses the confirmation button for keyboard operation. Checking a QR does not record a sale.

QR lookup no longer refreshes events, products and sale history or displays a misleading saved message. Local guards avoid overlapping lookup/save calls. Errors appear inside the modal, with focus restored for rescanning after a rejected check. Escape/back closes an unsent checkout while preserving its cart. An uncertain submission retains its original idempotency key and locks dismissal until recovery; authentication loss and reload still recover the same attempt.

No database migration or financial-row rewrite was needed. Event assignments, automatic staff sessions, permissions, receipts and bank confirmation remain in place.

## Validation and previews

Database/thirteen migrations, lint, typecheck, **46 regression tests**, production build, formatting and **42 production-server/browser checks** pass. Desktop checks at 1920 × 1080, 1366 × 768 and 1024 × 768 verify that the cart and QR button fit the viewport without horizontal overflow. The modal is centered on both axes, scanner autofocus works, Escape preserves the cart, and unknown-attempt recovery survives sign-in/reload without duplicate sales.

The measured opening time was **114 ms on this test host**, with **zero catalog/event/history requests during QR lookup**. This is a local acceptance measurement, not a guarantee for other devices or networks. Evidence: [layout measurements](validation/final/pos-layout.json), [production POS](validation/final/pos-desktop-redesign.png), [production QR modal](validation/final/pos-qr-modal.png), [browser results](validation/final/results.json) and [phase gates](validation/phase-8/results.md).

`scripts/pos-preview.ts` captures the existing development app using the demo cashier's current assignment; it does not submit a sale or change that assignment. These local previews are kept in ignored `.local/previews` because they can contain customer details. Published previews above use synthetic acceptance fixtures. The preview exposed a development hot-reload loop after source changes; restarting only the owned workspace Next dev process resolved it, and the live preview then passed. Database state and sessions were retained.
