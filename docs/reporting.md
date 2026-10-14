# Dashboard, outstanding monitor and reports

All reports require `report.view` (SUPER_ADMIN). A repeatable serializable database snapshot powers current event KPIs and server SQL aggregates. Dashboard and unpaid account screens refresh every five seconds; this is bounded polling, not an independent client ledger.

Definitions: gross sales include recorded historical order value before voids. Net sales exclude voided orders. Confirmed payment value includes only currently CONFIRMED payments; voids/refunds preserve history and restore outstanding. For a complete event: `net sales = confirmed payments + outstanding`. The dashboard shows a reconciliation warning when this fails. Average order value is a rounded presentation statistic; transaction totals remain exact integer satang.

Charts: hourly sales, category/product (immutable snapshots), station, cashier, payment timeline, audit-derived outstanding trend (including corrections), void trend and average order KPI. SQL grouping avoids downloading every order/item into the browser. Unpaid accounts support search, amount/age/registration sorting, account status and app event selection.

Reports provide event/daily/date-range summaries, product/category/station/cashier breakdowns, payments, outstanding, registrations, voids and shifts. Dates use Asia/Bangkok boundaries. Date-range sales and confirmed payments are flows in the selected interval; outstanding and registration status are current stocks. A date-range view does not claim the full-event reconciliation equation.

CSV exports are authenticated, audited, UTF-8 with BOM and formula-injection escaping. Aggregated exports and financial detail exports contain complete event rows without UI-list limits. CSV plus browser Print/Save as PDF are supported; native XLSX is intentionally not added because CSV and PDF meet the practical export requirement. Browser report print uses A4; receipts use 58 mm. Operational tables show bounded recent records; exports are the full ledger.
