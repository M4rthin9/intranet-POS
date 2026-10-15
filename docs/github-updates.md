# Update POS from GitHub

The source repository is `https://github.com/M4rthin9/intranet-POS`. After a feature is merged into `main` and its **CCIDA validation** workflow passes, run this on the Docker server:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/update.ps1
```

Preview the operation without fetching or changing services:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/update.ps1 -WhatIf
```

The script fetches `origin/main` and creates an isolated Git worktree at `.local/releases/<commit>`. Local edits, the operational environment file, credentials and the existing source checkout are preserved. It builds the application and maintenance images before changing running services, creates and checks a PostgreSQL backup, applies migrations, then replaces only the POS app and backup worker. It waits for the published health endpoint to report a working database connection. ERP services and Docker Desktop are not restarted.

Existing accounts, password changes, products, events and financial data persist in the same `ccida-pos` volumes. Updates never run a seed, reset, bootstrap or volume removal. An already running POS database is required. Use the [initial deployment guide](docker-production-accounts.md) for a fresh installation.

To deploy a selected release tag or commit instead of `main`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/update.ps1 -Ref v1.1.0
```

The server needs Git, Docker Compose, repository read access and Internet access to fetch source and build dependencies. Existing Git authentication is used; no GitHub token is added to containers. The default private environment file is `deploy/.env.pos-production`; use `-EnvFile <absolute-path>` for another installation file.

Updates run explicitly when you issue the command; GitHub pushes do not automatically restart production. Building shares this host's CPU/RAM with ERP, so run updates outside busy periods. The script stops if a build, backup, migration or health check fails. It records the commit, source checkout, backup location, backup SHA-256 and status under `.local/deployments/`; the latest successful deployment is in `current.json`.

Backups are saved under `.local/backups/pre-update/`. Copy them to protected off-host storage and retain them according to your operational policy. Restoring a backup or rolling back a schema requires a separate recovery decision. The script does not automatically reverse migrations or restore over live data.

Publish the updater and Docker changes to GitHub before relying on them in future release checkouts. This setup does not push local commits or publish repository changes automatically.
