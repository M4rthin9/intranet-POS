# Phase 7 — Shift, stock and event closing

Reused: shift identity from Phase 3, inventory-aware checkout and void-return movements, SQL event reconciliation, export infrastructure and transactional audit. Added forward-only inventory balance/positive-count and closed-shift immutability constraints.

Implemented: shift opening/closing, own and controlled administrative close, immutable summaries; one-time opening stock, adjustment reasons, per-event movement history, low-stock warnings, POS stock display, stock/shift CSV; event closing summary, unresolved-payment/open-shift restrictions, mandatory reconciliation, explicit outstanding override/reason, closing snapshot, durable backup request and CLOSED→ARCHIVED workflow.

Tests: stock sale/void/adjustment math and movement history, no opening overwrite, negative-stock rejection, two-station simultaneous oversell prevention, closing shift immutability, closing prerequisites/override, snapshot, archive, closed-event and role restrictions. See `validation/phase-7` for the full checks.
