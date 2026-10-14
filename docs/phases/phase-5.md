# Phase 5 — Controls, void and audit

Reused: transactional service boundaries, persisted actor-scoped idempotency, operational shifts and original financial snapshots. Added forward-only append-only/immutability triggers and deferred financial reconciliation constraints.

Implemented: super-admin order/payment void, controlled account reopening, explicit recording of externally verified refunds, mandatory reasons, paid-order restriction, pending-payment reservation, retained original allocations/receipt, stock-return foundation, audit before/after, audit search/detail viewer, and administrator control screens. No financial delete routes exist.

Tests cover denied roles/read APIs, reasons, void rules, restored balances, retained allocations/receipt/items, duplicate void, and direct database attempts to alter audit and item records or delete an order. Existing concurrency and duplicate checkout/payment tests continue running. See `validation/phase-5`.
