# Docker production and account-only initialization

POS accepts `http://192.168.0.46:8081` and `http://192.168.1.46:8081`; the ERP service keeps port 80. Each device should use the address reachable on its own subnet. Both addresses are explicitly trusted; see [dual LAN origins](dual-lan-origins.md). This deployment is HTTP on the intranet. Trusted HTTPS can be configured using the existing optional proxy profile on a host with ports 80/443 available.

Keep `deploy/.env.pos-production` private. It contains independent random owner/application database passwords. Do not replace it when updating an existing database volume. The database and backups use persistent named volumes; never run `down --volumes` against production.

```powershell
docker compose --env-file deploy/.env.pos-production config --quiet
docker compose --env-file deploy/.env.pos-production up --build -d
docker compose --env-file deploy/.env.pos-production ps
```

For an account-only installation, use the following command after migrations. It creates one active account per role, plus required roles, grants and account audit entries. It creates no events, products, stations, customers, financial records or payment recipient. Staff have no event assignment until Super Admin creates an event and assigns it.

```powershell
New-Item -ItemType Directory -Force -Path .local/credentials | Out-Null
$posCredentialsDirectory = (Resolve-Path .local/credentials).Path
docker compose --env-file deploy/.env.pos-production run --rm --no-deps --volume "${posCredentialsDirectory}:/credentials" -e SEED_ACCOUNTS_FILE=/credentials/production-accounts.json migrate npm run db:seed:accounts
```

The seed writes independent 32-character random passwords to `.local/credentials/production-accounts.json` before committing new accounts. The file is excluded from Git and Docker build contexts. Keep it private and protect its Windows file permissions. Both the seed and ordinary startup preserve existing passwords. Rerunning the seed with this file adds missing accounts; existing accounts are reported as preserved. Passwords in the file apply only to accounts created from that manifest; later password changes do not update it.

| Username | Role |
| --- | --- |
| `superadmin` | SUPER_ADMIN |
| `admin` | ADMIN |
| `cashier.pos` | CASHIER |
| `cashier.payment` | PAYMENT_CASHIER |
| `cashier.register` | REGISTRATION_CASHIER |

Do not use `npm run db:seed` for production: that separate command intentionally creates test fixtures in an isolated test database. Account initialization is an explicit maintenance action and never runs automatically on container restart.

The app and backup worker run as the unprivileged Node user. PostgreSQL is private to Docker; the app uses a restricted database role, while migrations use the owner. The backup worker supports scheduled and event-closing backups. Enable a schedule in Settings and copy backups off this machine. Configure the real PromptPay recipient before taking payments.
