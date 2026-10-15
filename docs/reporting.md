# Dashboard, outstanding monitor and reports

Detailed reports require `report.view` (SUPER_ADMIN). Admin uses a separate aggregate dashboard endpoint without detailed customer debts or report access. A repeatable serializable database snapshot powers event KPIs and server SQL aggregates. Dashboard and unpaid account screens refresh every five seconds; clients do not maintain independent financial ledgers.

Definitions: gross sales include recorded historical order value before voids. Net sales exclude voided orders. Confirmed payment value includes only currently CONFIRMED payments; voids/refunds preserve history and restore outstanding. For a complete event: `net sales = confirmed payments + outstanding`. The dashboard shows a reconciliation warning when this fails. Average order value is a rounded presentation statistic; transaction totals remain exact integer satang.

Charts: hourly sales, category/product (immutable snapshots), station, cashier, payment timeline, audit-derived outstanding trend (including corrections), void trend and average order KPI. SQL grouping avoids downloading every order/item into the browser. Unpaid accounts support search, amount/age/registration sorting and account status. The current interface restores event selection for isolated analytics while station assignments remain automatic and station chart tabs stay hidden.

Reports provide event/daily/date-range summaries, product/category/station/cashier breakdowns, payments, outstanding, registrations, voids and shifts. Dates use Asia/Bangkok boundaries. Date-range sales and confirmed payments are flows in the selected interval; outstanding and registration status are current stocks. A date-range view does not claim the full-event reconciliation equation.

CSV exports are authenticated, audited, UTF-8 with BOM and formula-injection escaping. Aggregated and financial detail exports contain complete event rows without UI-list limits. CSV plus browser Print/Save as PDF are supported; native XLSX is outside the initial release. Reports print on A4; every original/COPY receipt uses 80 mm paper. Operational tables show bounded recent records; exports contain the full ledger.
