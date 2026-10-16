# Clear event sales

Super Admin can open **Settings → Clear event sales**, select an open event, and preview its sales and customer balances. Enter the exact event code, give a reason, acknowledge that bank payments are not refunded, then choose **Back up and clear event sales**.

The action creates a database backup and verifies that PostgreSQL can read the archive before changing sales. If the event's sales change after the preview, refresh the preview and confirm again. Backup failures leave sales unchanged. An interrupted response retains the original request in the browser session; use **Retry clear request** to retrieve its result without clearing later sales.

Current sales, payment totals, void totals and customer balances restart at zero. Previously sold stock is returned exactly once. Open shifts are closed; assigned staff automatically start a new shift on their next transaction. Super Admin must reopen their own shift before selling again.

Customers, Normal/VIP status, QR cards, products, opening stock and stock adjustments are retained. Settled customer accounts become active; blocked, cancelled and expired accounts retain their restrictions. Other events are unaffected. Closed and archived events cannot be reset.

Old orders, payment evidence, allocations, receipts, stock movements and audit records remain in the database. Immutable archive membership excludes cleared transactions from current lists, reports and exports. The audit log records each corrected transaction and the event reset with its reason and backup reference. Previous reset references are visible in the event preview. Previously closed shift summaries remain historical records.

This operation resets POS accounting and does not transfer or refund money. Any required bank refund must be handled separately.
