# Routes

| Route             | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `/`               | Thai operational application, role-specific navigation |
| `/api/auth`       | Login, current authenticated user, logout              |
| `/api/operations` | Validated and permission-checked mutation dispatcher   |
| `/api/data`       | Permission-checked event-scoped operational lists      |
| `/api/reports`    | Event-isolated snapshot KPIs and date-range analytics  |
| `/api/export`     | Audited complete CSV reports                           |

Further phase routes and views are documented as they are added. All mutations require the configured same Origin. All authenticated responses must use no-store; there is no client financial write queue.
