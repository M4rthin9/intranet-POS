# Backup and recovery

## Backup

SUPER_ADMIN can create and download a backup from the Backup screen. The server runs real `pg_dump --format=custom --no-owner --no-privileges`, computes a streaming SHA-256 checksum, registers metadata and audits BACKUP_CREATE. Downloads are authenticated and streamed. Keep the backup directory outside public assets with restrictive filesystem/NTFS permissions. Linux artifacts use mode 0600 and directory mode 0700.

Set BACKUP_DIRECTORY and install a pg_dump/pg_restore version matching or newer than the server. Windows can set PG_BIN_DIRECTORY to the PostgreSQL `bin` directory; Linux uses PATH. Database passwords are passed to subprocesses through environment variables, never command arguments or logs. PostgreSQL utility errors return sanitized operator messages.

Enable a 1–168 hour schedule in the administrator screen and run:

```powershell
npm run backup:worker
# One cycle for a commissioning check:
npm run backup:once
```

The worker polls every 30 seconds. Closing requests are durable, claimed with a compare-and-swap, retried after failures and recoverable after stale processing claims. Concurrent workers cannot claim the same request or scheduled cycle. Successful closing backup stores the archive ID in the closing request. Scheduling remains disabled until configured. Keep off-server copies, monitor disk and practice recovery; archives are never silently deleted for retention.

## Authorized restore into a new empty database

The restore script verifies an active SUPER_ADMIN username/password against the source database, requires backup.manage, resolves only a registered archive, verifies SHA-256, rejects the source database name, and refuses any target containing user tables/views/sequences in any user schema. It uses a single-transaction pg_restore with exit-on-error and no clean/drop flags. All restored sessions are revoked. RESTORE_EXECUTE is audited in source and restored databases.

Have an authorized database administrator provision a separate **empty** recovery database and set its connection URL. Supply credentials through process environment with a masked prompt:

```powershell
$env:RESTORE_DATABASE_URL = Read-Host 'Separate empty recovery database URL'
$env:RESTORE_ADMIN_USERNAME = Read-Host 'Current super administrator username'
$recoverySecret = Read-Host 'Administrator password' -AsSecureString
$env:RESTORE_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $recoverySecret).Password
npm run restore -- <registered-backup-id>
Remove-Item Env:\RESTORE_ADMIN_PASSWORD
```

Reconcile event/order/payment/allocation totals, inspect audit and receipt history, verify sequence values and migration history, then validate the application against the recovered database. Switching production connection configuration is a separate, explicitly authorized maintenance action. Existing databases are preserved by this script.

If the source database is unavailable, institutional DBA incident authorization is required for an offline recovery using protected archive copies and a fresh database. Record that authorization and reconcile before cutover. There is no public restore endpoint and no unaudited overwrite path.

The automated recovery drill creates a new uniquely named `_test` database, restores a real archive, verifies user/payment records, revokes sessions, checks append-only audit enforcement after restore and proves that repeat restore to the populated target is rejected. Test recovery databases are retained as evidence.

References: [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).
