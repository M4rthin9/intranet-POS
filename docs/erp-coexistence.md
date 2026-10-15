# POS beside the existing ERP on 192.168.1.46

The existing ERP uses Nginx at `http://localhost` or `http://192.168.1.46`. Run POS on a separate host port without changing the server IP, ERP containers, ERP database, Nginx configuration or ports 80/443. The supplied override defaults to server-only POS access at `http://localhost:8081`.

| Application                     | Server browser                             | Other LAN computers            |
| ------------------------------- | ------------------------------------------ | ------------------------------ |
| Existing ERP                    | Existing URL, including `http://localhost` | Existing `http://192.168.1.46` |
| POS, default configuration      | `http://localhost:8081`                    | Unavailable: loopback binding  |
| POS, optional LAN configuration | `http://192.168.1.46:8081`                 | `http://192.168.1.46:8081`     |

`localhost` always means the device opening the browser. On a cashier computer it refers to that cashier computer, so remote staff must use the server's LAN URL. Choose one canonical POS URL: authentication and write requests require an exact origin match, including scheme and port. Do not alternate between localhost and the IP for the same deployment.

## Prepare the target server

This configuration is for Docker Desktop using Linux containers. Check the target's Docker Engine/Compose versions and existing port assignments before starting anything. Docker Engine 28 or later is recommended for loopback publishing because older engines have a documented same-LAN exposure issue.

```powershell
docker version
docker compose version
docker ps --format 'table {{.Names}}\t{{.Ports}}'
Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue
```

If 8081 is occupied, choose a free host port and change both `POS_PORT` and the port in `POS_APP_ORIGIN`. The application continues listening on container port 3000.

The host has 8 GB RAM shared by Windows and ERP. Check actual free memory and ERP usage, and build images away from active service hours or on another machine. This setup provides port/network/storage separation; both applications still share host CPU, memory, disk and the Docker engine. A separate machine or more RAM may be needed after measuring both workloads.

## Configure without replacing the existing runtime settings

From the POS repository, copy the dedicated template once:

```powershell
if (Test-Path -LiteralPath 'deploy/.env.pos-local') {
  Write-Output 'Existing POS configuration preserved; edit it as needed.'
} else {
  Copy-Item -LiteralPath 'deploy/localhost.env.example' -Destination 'deploy/.env.pos-local'
}
```

If that destination already exists, edit it instead of overwriting it. Set strong, distinct owner/application database passwords and their matching URL-encoded values in the two URLs. Keep the completed file private. Its filename is ignored by Git. These are PostgreSQL credentials for the POS Docker database; ERP database settings are separate.

The default values are:

```dotenv
POS_BIND_ADDRESS=127.0.0.1
POS_PORT=8081
POS_APP_ORIGIN=http://localhost:8081
```

For access from registration/POS/payment workstations on the LAN, change:

```dotenv
POS_BIND_ADDRESS=192.168.1.46
POS_PORT=8081
POS_APP_ORIGIN=http://192.168.1.46:8081
```

In LAN mode, allow inbound TCP 8081 only from the intended local network in Windows Firewall and use the LAN URL on every device. Do not create router port forwarding for this local deployment. HTTP uses `COOKIE_SECURE=false` in this override. Trusted HTTPS remains the preferred setup for sensitive traffic and PWA installation; it can later use a separate POS hostname through Nginx without changing the ERP route. This override does not configure TLS.

## Validate and start only the POS stack

Use the same POS project name consistently; never use the ERP project's name. The commands below retain the repository's existing `ccida-pos` name and its project-scoped database/backup volumes. If a previous POS Docker installation used a different project name, retain that original name with `-p` on every command instead of creating a second empty installation.

```powershell
docker compose --env-file deploy/.env.pos-local -f compose.yaml -f compose.localhost.yaml config --quiet
docker compose --env-file deploy/.env.pos-local -f compose.yaml -f compose.localhost.yaml config --services
docker compose --env-file deploy/.env.pos-local -f compose.yaml -f compose.localhost.yaml up --build -d
docker compose --env-file deploy/.env.pos-local -f compose.yaml -f compose.localhost.yaml ps
```

With no profiles enabled, `config --services` lists `db`, `migrate`, `app` and `backup-worker`; it excludes `proxy`. Ensure `COMPOSE_PROFILES` is unset in the shell and environment file. Do not enable the `standalone-https` profile or explicitly start `proxy` with this override, because that intentionally enables Caddy's original port 80/443 mappings.

The override publishes only POS port 8081 by default. PostgreSQL remains internal, and the POS stack uses its own named volumes. No global Docker cleanup, network changes, ERP restart or volume deletion is required. A previously running POS Caddy container from an older standalone deployment must be stopped in its own POS project before switching deployment modes; this guide does not stop an existing ERP proxy.

## Accounts, data and acceptance

The five real accounts created in the current native application database are stored in that database. Git and a fresh Docker volume do not transfer them. To preserve those accounts and settings, plan a verified backup/restore into a compatible empty target before cutover. The existing native database uses PostgreSQL 18; the default Docker database/client are PostgreSQL 17. Do not attempt to restore that PostgreSQL 18 archive into PostgreSQL 17. Use a compatible PostgreSQL 18 deployment or a separately validated data migration. No account or data transfer is performed by this port override.

For a genuinely fresh database, initialize the first administrator using the existing protected bootstrap process, with the same Compose options above. Bootstrap creates a Super Admin only; create the actual event and other accounts through User management. Do not run the demo seed against this deployment.

```powershell
$env:BOOTSTRAP_USERNAME = Read-Host 'Administrator username'
$posBootstrapSecret = Read-Host 'Administrator password (at least 14 characters)' -AsSecureString
$env:BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $posBootstrapSecret).Password
docker compose --env-file deploy/.env.pos-local -f compose.yaml -f compose.localhost.yaml run --rm -e BOOTSTRAP_USERNAME -e BOOTSTRAP_PASSWORD migrate npm run bootstrap
Remove-Item Env:\BOOTSTRAP_PASSWORD
```

Verify the chosen POS URL's `/api/health`, login/logout, role landing pages, registration, scanner entry, payment confirmation, 80 mm printing and backup worker. Reopen the ERP's original URL and confirm its login and a normal read operation still work. Reboot acceptance must verify that Docker and both applications recover without a manual developer session.

This is a prepared deployment configuration. Starting it requires the actual target Docker host, real database credentials and a data-transfer decision; it does not change the running native POS or existing ERP.

## Validation

Docker Compose 5.6.0 configuration checks passed for the existing standalone HTTPS deployment, localhost port 8081, LAN `192.168.1.46:8081` and alternate localhost port 8082. The separate-port models exclude Caddy from the active service set, publish only the chosen POS port, keep PostgreSQL private and retain the existing POS project-scoped volumes.

A built Next.js production server using the separate validation database passed health, HTTP login, authenticated settings, HttpOnly/non-Secure cookie handling for HTTP, wrong-origin rejection, production CSP and logout at `http://localhost:8081`. The operational five-account database was not used for fixture creation. Sanitized evidence is in [coexistence validation](validation/erp-coexistence.json).

Hosted CI additionally validates the merged Docker configurations and starts the production image with the localhost override to check the published port and authentication. This does not certify the existing ERP host's free ports, memory capacity or Windows Firewall; those checks remain part of target-host acceptance.

References: [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/), [Compose profiles](https://docs.docker.com/compose/how-tos/profiles/), [POS deployment](deployment.md), [backup/restore](backup-restore.md).
