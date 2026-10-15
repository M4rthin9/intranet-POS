# Two server network addresses

The server has Wi-Fi `192.168.0.46/24` and Ethernet `192.168.1.46/24`. Docker publishes POS on all host interfaces at port 8081.

| Network | POS URL |
| --- | --- |
| Clients at `192.168.0.x` | `http://192.168.0.46:8081` |
| Clients/server at `192.168.1.x` | `http://192.168.1.46:8081` |

Production configuration in the private `deploy/.env.pos-production` file:

```dotenv
APP_ORIGIN=http://192.168.0.46:8081
APP_ALLOWED_ORIGINS=http://192.168.1.46:8081
POS_BIND_ADDRESS=0.0.0.0
POS_PORT=8081
COOKIE_SECURE=false
```

`APP_ORIGIN` is the canonical address for generated feedback links. `APP_ALLOWED_ORIGINS` adds exact browser origins, separated by commas. Both addresses may sign in and submit operations. Scheme and port must match. Unlisted sites, missing origins and literal `null` origins remain rejected; no wildcard or forwarded-host trust is added. Cookies are separate for each address, so sign in again when switching URLs.

This dual-address configuration replaces the earlier single-address deployment guidance. It does not bridge the two networks. Each client should use the server address on its own subnet. Keep both server addresses reserved in DHCP or configured appropriately; allow inbound TCP 8081 from the intended LANs.

After changing these settings, rebuild the app if origin-allowlist support has not yet been installed, then recreate only the POS app:

```powershell
docker compose --env-file deploy/.env.pos-production build app
docker compose --env-file deploy/.env.pos-production up -d --no-build --no-deps app
```

Database contents and ERP services are preserved.

Validation on 2026-10-15: the updated production image was deployed by recreating only the POS app. Nine origin-allowlist unit tests, targeted lint, TypeScript and the production build passed. Real HTTP login, session lookup and logout succeeded through both addresses using an existing account. Unlisted sites, missing/null origins, wrong ports and lookalike hosts returned HTTP 403. ERP continued to return HTTP 200. Current account passwords were preserved; setup credential files are not rotated when an account password changes.
