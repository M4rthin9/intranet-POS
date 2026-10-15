# Production POS on port 8081

15 October 2026. The production default now serves POS at **http://192.168.1.46:8081**, sharing the existing server IP with ERP on port 80.

## Changes

- `compose.yaml` publishes host TCP 8081 to application port 3000. The Caddy service requires the explicit `standalone-https` profile, so normal startup does not request ports 80/443.
- The production environment template uses the exact LAN origin and HTTP-compatible session cookies. HTTPS mode retains configurable Secure cookies.
- The localhost overlay fully replaces the base port mapping with `!override`, preventing a second LAN binding from remaining active. It requires Compose 2.24.4 or newer.
- PostgreSQL 17, restricted runtime database access, migration ordering, application health checks, backup worker, project name and persistent volume names are retained. No database reset, data transfer or credential replacement is performed.
- Nested private environment files are excluded from Docker build contexts, including `deploy/.env.pos-production`.

## Validation

Standalone Docker Compose 5.6.0 validation passes seven configurations/checks: production defaults, explicit server-IP binding, alternate production port, optional HTTPS profile, localhost overlay, LAN overlay and alternate localhost port. Normal startup has exactly four services: `db`, `migrate`, `app`, `backup-worker`. Only POS is published; PostgreSQL remains internal. Existing database/backup volume identities are preserved. Localhost replacement is checked with an unset/empty bind variable so the base and overlay would otherwise select different interfaces.

Local lint, TypeScript checks, changed-file formatting and read-only Prisma schema/migration checks pass. All fourteen migrations are applied; this deployment change adds no database migration.

The GitHub Actions container gate now starts an isolated Nginx on port 80 before booting the default production stack on port 8081. It verifies both HTTP endpoints, application login/authorization, HTTP session cookie behavior, wrong-origin rejection, migration reapplication, localhost replacement and optional HTTPS cookies. Its prerequisite job runs migrations, lint, typecheck, regression tests, production build and browser acceptance. CI uses fresh runner-only databases; it never connects to ERP or the operational POS database.

The first container run passed default production startup, authentication and ERP port coexistence. Its additional localhost-mode probe reached the recreated container before startup completed and received a connection reset. That read-only health probe now retries transient startup failures for a bounded period, failing if the endpoint remains unavailable.

This workspace has no Docker Engine, so local Compose validation does not certify actual container startup. Hosted CI supplies container execution evidence; target-host acceptance must still confirm Windows Firewall, available RAM, real credentials, printers/scanners, backups and ERP access.

## Start on the target host

Copy `deploy/production.env.example` once to private `deploy/.env.pos-production`, then enter the actual POS PostgreSQL credentials. Preserve any existing configuration and volume credentials. From the POS repository:

```powershell
docker compose --env-file deploy/.env.pos-production config --quiet
docker compose --env-file deploy/.env.pos-production up --build -d
docker compose --env-file deploy/.env.pos-production ps
```

Open `http://192.168.1.46:8081` on every POS device, including the server browser. ERP retains `http://192.168.1.46`. Allow TCP 8081 only from the intended LAN. Keep `COMPOSE_PROFILES` unset; do not enable the optional port-80 proxy on the ERP host.

For existing installations, use the original POS project name and stop only an already-running POS Caddy service if switching from its old HTTPS mode. Do not delete volumes. A fresh Docker database needs administrator bootstrap; native Windows database accounts are not included in Git or images. Native PostgreSQL 18 archives require a compatible PostgreSQL target and cannot be restored into the default PostgreSQL 17 container.

See [deployment](deployment.md) and [ERP coexistence](erp-coexistence.md) for full setup and the optional server-only localhost mode.
