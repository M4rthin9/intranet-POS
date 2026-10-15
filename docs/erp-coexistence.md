# POS beside the existing ERP on 192.168.1.46

The default production Compose setup serves POS at **http://192.168.1.46:8081**. Existing ERP/Nginx keeps **http://192.168.1.46** on port 80. Both applications use the same server IP with different ports. ERP containers, routing and databases need no changes.

| Application                  | Server browser                             | Other LAN computers           |
| ---------------------------- | ------------------------------------------ | ----------------------------- |
| Existing ERP                 | Existing URL, including `http://localhost` | `http://192.168.1.46`         |
| POS, production default      | `http://192.168.1.46:8081`                 | `http://192.168.1.46:8081`    |
| POS, optional localhost mode | `http://localhost:8081`                    | Unavailable: loopback binding |

Login and write requests require an exact match to `APP_ORIGIN` or an explicitly listed `APP_ALLOWED_ORIGINS` entry, including scheme and port. The current dual-interface server accepts `http://192.168.0.46:8081` for `192.168.0.x` clients and `http://192.168.1.46:8081` for `192.168.1.x` clients. See [dual LAN origins](dual-lan-origins.md). `localhost` on a cashier PC refers to that PC, not the server.

## Prepare the target server

Use Docker Desktop with Linux containers and Compose 2.24.4 or newer. The localhost overlay uses `!override` to replace the production LAN binding completely. Docker Engine 28 or newer is recommended for loopback publishing because older releases have a documented same-LAN exposure issue.

```powershell
docker version
docker compose version
docker ps --format 'table {{.Names}}\t{{.Ports}}'
Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue
```

If 8081 is occupied, choose a free port and change both `POS_PORT` and the port in `APP_ORIGIN`. The application continues listening on container port 3000. Do not change ERP's port mapping.

The host has 8 GB RAM shared by Windows and ERP. Measure available memory and build images outside busy hours or on another machine. Separate ports do not isolate CPU, RAM, disk or Docker Engine capacity.

## Configure and start production

Copy the production template once without replacing existing runtime settings:

```powershell
if (-not (Test-Path -LiteralPath 'deploy/.env.pos-production')) {
    Copy-Item -LiteralPath 'deploy/production.env.example' -Destination 'deploy/.env.pos-production'
}
notepad deploy/.env.pos-production
```

Enter real, distinct PostgreSQL owner/application passwords, with matching URL-encoded values in the two connection URLs. These belong to POS. On an existing POS volume, retain its credentials; changing initialization variables does not rotate database passwords. Keep the completed file private: Git and Docker build contexts exclude it. The native application's `.env` remains unchanged.

```dotenv
POS_BIND_ADDRESS=0.0.0.0
POS_PORT=8081
APP_ORIGIN=http://192.168.1.46:8081
COOKIE_SECURE=false
```

The bind address publishes the app on host interfaces. Allow inbound TCP 8081 only from the intended LAN in Windows Firewall. Do not add router port forwarding for this LAN deployment. HTTP requires `COOKIE_SECURE=false`; trusted HTTPS is required for PWA installation. Future HTTPS routing can use a separate POS hostname in the existing proxy after a separately reviewed routing change.

Use the same POS project name consistently. The repository keeps `ccida-pos` and its existing database/backup volumes. If an earlier POS installation used another project name, retain it using `-p` on every command. Never use ERP's project name. Ensure `COMPOSE_PROFILES` is unset:

```powershell
docker compose --env-file deploy/.env.pos-production config --quiet
docker compose --env-file deploy/.env.pos-production config --services
docker compose --env-file deploy/.env.pos-production up --build -d
docker compose --env-file deploy/.env.pos-production ps
docker compose --env-file deploy/.env.pos-production logs app migrate backup-worker
```

The service list contains `db`, `migrate`, `app` and `backup-worker`. The migration job exits successfully before app/backup worker start. PostgreSQL has no published host port. The optional Caddy proxy is excluded; do not enable `standalone-https` or explicitly start `proxy` on this ERP host because that would request ports 80/443.

If an older POS deployment already started its own Caddy proxy, stop only that POS project's `proxy` service before switching modes. Profile changes do not stop existing containers. No ERP restart, global Docker cleanup or volume deletion is needed. Never run `down --volumes` on operational data.

## Optional localhost-only mode

For access only from the server browser, copy `deploy/localhost.env.example` to private `deploy/.env.pos-local` without overwriting an existing file, then enter the actual PostgreSQL credentials. It defaults to `POS_BIND_ADDRESS=127.0.0.1`, `POS_PORT=8081` and `POS_APP_ORIGIN=http://localhost:8081`. Use both files on every command:

```powershell
docker compose --env-file deploy/.env.pos-local -f compose.yaml -f compose.localhost.yaml config --quiet
docker compose --env-file deploy/.env.pos-local -f compose.yaml -f compose.localhost.yaml up --build -d
docker compose --env-file deploy/.env.pos-local -f compose.yaml -f compose.localhost.yaml ps
```

The overlay replaces the production port mapping rather than appending another binding. Its HTTP origin/cookie settings override the base. Open `http://localhost:8081` in this mode; other LAN computers cannot connect. Change `POS_APP_ORIGIN` with the port if choosing another port for this overlay.

## Accounts, data and acceptance

The five real native-app accounts are stored in the native database. Git and a fresh Docker volume do not transfer them. Preserve accounts/settings through a verified backup/restore into a compatible empty target before cutover. The native database uses PostgreSQL 18; the default Docker database/client remain PostgreSQL 17 to preserve existing Docker deployments. Do not restore a PostgreSQL 18 archive into PostgreSQL 17 or change an existing volume's major version. Use a compatible PostgreSQL 18 target or a separately validated migration for native-data transfer.

For a genuinely fresh database, bootstrap the first Super Admin with the masked-password command in [deployment](deployment.md). Then create real staff, events, products and the institutional PromptPay configuration. Do not install demo seeds. Existing Docker accounts/data remain intact when applying this port configuration.

On the target host, check `http://192.168.1.46:8081/api/health`, login/logout, role landing pages, registration, POS scanning, payment, 80 mm printing and the backup worker. Reopen ERP's original URL and verify its login and a normal read operation. Reboot acceptance must confirm Docker and both applications recover without a developer session.

This repository prepares the deployment; it does not start containers on the institution's ERP server. Real target credentials, network access, available RAM and any native-data transfer remain host acceptance tasks.

## Validation

The current change checks the default LAN model, explicit LAN binding, alternate ports and localhost overlays, with no active service claiming ports 80/443. PostgreSQL remains private and POS volume identities remain unchanged. The dedicated HTTPS proxy still requires explicit opt-in. See [port 8081 implementation report](production-port-8081.md).

Hosted CI builds the production images, starts an isolated Nginx on port 80 first, then boots the default POS stack on port 8081. It checks health, bootstrap/login, HTTP cookies, authenticated settings, wrong-origin rejection, migration reapplication, localhost replacement and optional HTTPS cookie behavior. CI uses temporary credentials/volumes and does not touch an operational ERP host.

References: [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/), [Compose profiles](https://docs.docker.com/compose/how-tos/profiles/), [Compose merge and override](https://docs.docker.com/reference/compose-file/merge/), [backup/restore](backup-restore.md).
