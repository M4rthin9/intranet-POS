# POS Cloudflare Tunnel commissioning — 2026-10-17

POS is available at **https://cccpos.dpdns.org**. The user confirmed successful
login using their current account. The public runtime uses the exact image of the
working LAN release (`6321838`) and the same PostgreSQL database.

The existing LAN application, database, backup worker and ERP were preserved.
LAN remains available at **http://192.168.0.46:8081** and
**http://192.168.1.46:8081**. No LAN origin/cookie settings, host ports, local DNS,
hosts files, certificates, router forwarding, Windows power settings or ERP routes
were changed. The three public services publish no host ports.

## Evidence

- Proxy tests passed for exact preservation of LAN Compose services, separate
  HTTPS runtime, hostname rejection, client-IP normalization, no-store responses,
  20 MiB uploads and oversized-body rejection.
- Deployment updater checks passed for preview, success, build/backup/migration
  failures, online mode, proxy validation failure and accidental LAN-mode updates.
- Public HTTPS health, feedback, anonymous rejection, valid-origin form validation
  and wrong-origin rejection passed. Current account login was confirmed by the user.
  Old saved commissioning passwords were rejected; no passwords were reset and no
  new accounts were created. Automated authenticated checks for every role require
  a protected file of current authorized credentials.
- The connector was actually stopped. Both LAN addresses continued serving database
  health and login pages, accepting their configured origins and enforcing origin
  and authentication guards. The connector was restarted and readiness verified.
- LAN application/database and ERP container identities remained unchanged.
  The original ERP address returned HTTP 200.
- Pre-activation financial totals matched after adding public services. Activation
  created no sales, payments, registrations, or other business fixtures.
- A fresh backup was encrypted into the dedicated R2 prefix, downloaded, decrypted,
  checksum-verified and restored successfully into a separate empty PostgreSQL 17
  test container. Restored business counts/totals matched the backup. The isolated
  recovery container was removed afterward; the live database was preserved.
- The Windows scheduled backup task was triggered and completed with result `0`.

Private checkpoints, archive hashes and Cloudflare state remain under ignored
`.local/secrets` and `.local/deployments`. No secrets are included in this report.
See [operating and rollback instructions](online-deployment.md).

The online deployment scripts and Compose configuration are included in source
control. Use the GitHub-based updater with `-Online`; older revisions without
the online Compose file are rejected before service changes.

Physical printers/scanners, a second LAN device, mobile-data access and host reboot
were not tested in this session. The existing in-app hourly backup setting must be
managed by an authenticated Super Admin; the separate encrypted R2 backup job is
configured for 02:30 local time and user logon. Docker Desktop and the host must stay
running for public service; normal LAN operation does not require Cloudflare.
