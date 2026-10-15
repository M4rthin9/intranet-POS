# Routes

Authenticated pages now have separate URLs with server role checks: `/dashboard` for Superadmin/Admin, `/pos` for POS cashiers, `/register` for registration cashiers, and `/payments` for payment cashiers. Existing Superadmin modules also use their own paths, such as `/users`, `/stock`, `/reports` and `/settings`. `/` is the centered login page and redirects authenticated users to their role's home. `/api/dashboard` returns authorized aggregate data; detailed `/api/reports` retains its original restriction. See [role page report](role-pages-report.md).

| Route             | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `/`               | Thai operational application, role-specific navigation |
| `/api/auth`       | Login, current authenticated user, logout              |
| `/api/operations` | Validated and permission-checked mutation dispatcher   |
| `/api/data`       | Permission-checked event-scoped operational lists      |
| `/api/reports`    | Event-isolated snapshot KPIs and date-range analytics  |
| `/api/export`     | Audited complete CSV reports                           |

Additional routes: `/api/backup` protects archive creation/list/download; `/api/health` checks live database readiness without secrets; `/manifest.webmanifest` and `/sw.js` provide local install/static fallback assets. All mutations require the configured same Origin. Authenticated responses use no-store. Transient client drafts preserve uncertain request keys; no independent offline financial ledger exists.

`/events` restores event registration/editing/closing for SUPER_ADMIN. Work pages select an OPEN event, locked during an open shift. Analytics pages independently select historical events. Station assignment stays automatic. `context.resolve` supports a guarded explicit `switchEvent`; stale preferences still retain an open shift. `receipt.print` accepts either `paymentId` or scanned `receiptNumber` for authorized audited printing. See [event and receipt changes](event-receipt-followup.md).
