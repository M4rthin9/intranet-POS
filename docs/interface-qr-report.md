# Simplified interface and 80 mm customer QR printing

Historical interface release: the latest [printing follow-up](qr-print-report.md) supersedes the card/receipt sizes below. Both QR cards now use 80 × 120 mm paper and every original/COPY receipt uses 80 mm paper. Current evidence is in that report.

Requested change: remove กิจกรรม and จุดบริการ from the interface and center customer QR printing on 80 mm paper.

Removed event/station navigation, configuration forms, header selectors, event closing navigation, event/station names on customer cards and receipts, station codes in transaction and shift screens, and station charts/report tabs. User/role administration, registration, sales, payment, stock, shift closing, audit, backup and financial reports remain available.

## Automatic assignments and data preservation

`context.resolve` is an authenticated, origin-checked POST. An existing open shift takes priority over device preferences, preserving its event/station IDs. Without a shift, the server reuses valid device/server preferences; otherwise it chooses the open seeded test period when present, then the oldest open period. Assignments persist on the server as well as in optional device storage. A fresh database gets one audited internal operating period; closed periods are never reopened automatically.

Operators receive a real role-compatible internal station, created and audited once under a serializable transaction. Repeated/concurrent requests reuse it. Disabled automatic assignments are rejected; occupied and incompatible preferred stations cannot be assigned. Shift opening and all financial commands retain existing server checks. The interface no longer offers event/station management. Existing administrative APIs retain their permission checks for historical maintenance and integration.

No ledger rows, historical events/stations, receipt snapshots, audit records or migrations were deleted or rewritten. The existing schema and database constraints are unchanged.

## Printing

QR cards have a dedicated named print page: 80 × 100 mm, equal 4 mm margins, 72 mm content, a centered 46 mm QR image and wrapping names. The QR image itself is centered vertically and horizontally, with customer details above and instructions below. Maximum-length names use smaller text to fit above the QR. Set the printer driver to 80 mm, scale to 100%, disable browser headers/footers, and use a 100 mm card cut length. The server still issues/audits QR reprints before invoking printing. Receipt printing remains 58 mm and report printing remains A4.

## Validation

Database/schema/migration checks, lint, typecheck, **33 regression tests across 12 files**, production build and formatting pass. **34 production-server/browser checks** pass, plus ordinary HTTP LAN scanner checkout. The automatic-context regressions exercise all four roles, concurrent assignment, existing-shift preservation, occupied/incompatible preferences and disabled assignments.

Real browser printing confirms a single-page 80 × 100 mm PDF, equal print margins, zero horizontal center offset, vertical center offset below 0.01 px, no clipping, and a 120-character customer name wrapping above the QR on one page. QR reprint audit, printer failure, COPY receipts, payment retry recovery, reconciliation and backup tests also pass. The local development server remains healthy at http://localhost:3000.

Evidence: [QR card PDF](validation/final/customer-qr-80mm.pdf), [maximum-length name PDF](validation/final/customer-qr-long-name-80mm.pdf), [screen preview](validation/final/customer-qr-80mm.png), [measured print layout](validation/final/qr-print-layout.json), [browser results](validation/final/results.json), [phase validation](validation/phase-8/results.md). Physical printer output still depends on the configured driver and paper profile; the browser validation verifies layout and issued print attempts.
