# Phase 3 — Fast POS

Reused: registration account lookup, role policy, station validation, transactional audits and shared Thai application shell. Added forward-only unique active shift and QR credential indexes and financial check constraints.

Implemented: administrator category/product creation, editing, archival/reactivation, server decimal price parser; touch product buttons, category tabs, code/name search, device favorites, recent products, cart increment/decrement/removal, USB scanner Enter input, customer validation with existing outstanding and new total, recorded orders and immutable item/category/price snapshots, station/user/shift tracking and own cashier history. Stock-aware checkout is transactional and activated only for products explicitly configured to track stock.

Open-shift foundation is introduced here because checkout must have real station/user accountability; Phase 7 extends closing and summary. Idempotency foundation is introduced at order creation and Phase 5 adds wider controls. A failed or uncertain network submission retains its original request key; retry returns the saved order. Totals submitted by clients are not authoritative.

Tests: server totals despite a spoofed total, decimal parsing, historical snapshots after price/name edits, duplicate payload/key conflict, concurrent duplicate checkout, two stations, account outstanding, wrong station type and forbidden roles. See `validation/phase-3`.
