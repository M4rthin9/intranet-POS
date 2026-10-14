# Phase 6 — Dashboard and reporting

Reused: immutable order/category facts, append-only audit timeline, authenticated app shell and exact financial records. No schema changes required; migration checks still run against all existing migrations.

Implemented: real event KPIs, counts/status/void/average order value, SQL aggregated hourly/category/product/station/cashier sales, payment timeline, outstanding and void trends, reconciliation status, five-second polling outstanding screen with search/sorting/age/status, date-range and event reporting, complete authenticated/audited CSV exports, spreadsheet injection protection, A4 report printing/PDF.

Tests: dashboard/category/product/order/outstanding totals, settlement/correction reconciliation and audit-derived trend, event isolation, historical date-range sales vs current outstanding, unauthorized reports and CSV escaping. Previous critical workflows continue in the full regression suite. See `validation/phase-6` for command and build evidence.
