# Payment cashier workspace redesign

15 October 2026 · completed.

Payment Cashier opens `/payments` directly and uses the full workspace width, like Cashier Register. Its sidebar and menu are removed; server role guards still redirect forbidden pages back to payments. Assigned-event information and sign-out remain in the header area. There are no dashboard cards, event selectors or shift buttons for this role. Super Admin retains its navigation when using the same payment screen.

The primary action is customer QR scanning, with scanner focus after the saved-request state loads. Desktop work proceeds left to right: customer and server-calculated balance, compact PromptPay QR, then mandatory bank reference/evidence verification. The current sale's orders expand individually. Receipt barcode reprinting and payment history are collapsed utilities below the transaction. Tablet/mobile sections stack and scroll normally. Short desktop screens use a compact layout: confirmation is visible at 1366 × 768, at approximately y=695.

The on-screen QR panel is separate from the thermal print card. **พิมพ์ QR พร้อมเพย์** retains the original audited 80 × 120 mm print preview; paid receipts and copies retain their 80 mm layout, saved financial snapshot, configurable information QR and receipt barcode. Generating or printing the payment QR does not confirm payment. Staff still verify recipient, exact amount, time and bank evidence manually.

After settlement, the screen shows the confirmed receipts and **รับชำระผู้ร่วมงานถัดไป**, which clears the completed customer and restores scanner focus. Pending or unknown requests cannot use that reset action. A synchronous action guard blocks overlapping scan/generate/confirmation submissions, and the existing persisted request keys remain authoritative for network-loss/reload recovery. Backend money, allocations, authorization and audit logic are unchanged. No migration, data reset or configuration/password replacement was required.

Validation passes:

- PostgreSQL schema validation and status: all **13 migrations** applied.
- Lint, typecheck, **46 regression tests across 17 files**, production build and formatting.
- **44 complete production-server/browser checks**, including confirmation and QR creation with lost response/reload/original-key retry, print failure, exact settlement, archived-event copies, backup and existing POS/registration controls.
- Real payment-cashier login on the live local server: direct payment landing, forbidden-dashboard redirect, zero dashboard requests, scanner focus and no menu/shift controls. This preview submits no financial operations.
- Layout acceptance at 1920 × 1080, 1366 × 768, 1024 × 768 and 390 × 844: no horizontal overflow, correctly sized evidence checkbox and collapsed utilities. Confirmation stays visible on both tested desktop viewports.
- Ordinary HTTP LAN checkout passes without browser errors.

Visual review found the generic input-width rule also applied to the evidence checkbox; its fixed 18 px width now prevents clipped verification text. The initial expanded acceptance run closed the receipt during the new next-customer check before an existing later PDF assertion; the check now follows PDF validation, and the entire suite passes again. Initial failure evidence is archived in `validation/payment-workspace/initial-acceptance.json`.

Evidence: [desktop transaction](validation/final/payment-workspace-1366.png), [wide desktop](validation/final/payment-workspace-1920.png), [mobile](validation/final/payment-workspace-390.png), [live start screen](validation/final/payment-start-1366.png), [layout measurements](validation/final/payment-layout.json), [live login/role checks](validation/final/payment-live-preview.json), [44-check results](validation/final/results.json), [phase gates](validation/phase-8/results.md).

Production readiness remains **READY WITH CONDITIONS** in the [final report](final-implementation-report.md): this interface change does not certify a physical printer, bank recipient or target deployment host.
