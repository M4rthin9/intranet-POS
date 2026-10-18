# Run daily under a dedicated Windows account with Docker and remote-repository access.
# Requires restic and RESTIC_REPOSITORY / RESTIC_PASSWORD_FILE in that account's environment.
[CmdletBinding()]
param([string]$EnvFile)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) { $EnvFile = Join-Path $PSScriptRoot '.env.pos-online' }
$EnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
if (-not $env:RESTIC_REPOSITORY -or -not $env:RESTIC_PASSWORD_FILE) { throw 'Configure a remote RESTIC_REPOSITORY and a protected RESTIC_PASSWORD_FILE first.' }
if ($env:RESTIC_REPOSITORY -notmatch '^(s3:|sftp:|rest:|azure:|gs:|b2:|rclone:)') { throw 'Use an off-device restic backend, not a local directory.' }
if (-not (Test-Path -LiteralPath $env:RESTIC_PASSWORD_FILE -PathType Leaf)) { throw 'Restic password file is missing.' }
Get-Command restic -ErrorAction Stop | Out-Null
$staging = Join-Path $repository '.local/offsite-staging'
New-Item -ItemType Directory -Force -Path $staging | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($identity)
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($identity, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
[IO.Directory]::SetAccessControl($staging, $acl)
$lock = [IO.File]::Open((Join-Path $repository '.local/offsite-backup.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
function Invoke-BackupCommand([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed. Offsite backup is incomplete; retention was not advanced." }
}
$compose = @('compose', '-p', 'ccida-pos', '--env-file', $EnvFile, '-f', (Join-Path $repository 'compose.yaml'), '-f', (Join-Path $repository 'compose.online.yaml'))
try {
    Invoke-BackupCommand docker ($compose + @('exec', '-T', 'db', 'pg_dump', '-U', 'ccida_owner', '-d', 'ccida', '--format=custom', '--no-owner', '--no-privileges', '--file', '/tmp/pos-offsite.dump'))
    Invoke-BackupCommand docker ($compose + @('exec', '-T', 'db', 'pg_restore', '--list', '/tmp/pos-offsite.dump')) | Out-Null
    $dump = Join-Path $staging 'database.dump'
    Invoke-BackupCommand docker ($compose + @('cp', 'db:/tmp/pos-offsite.dump', $dump))
    if ((Get-Item -LiteralPath $dump).Length -eq 0) { throw 'Database archive is empty.' }
    (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash | Set-Content -LiteralPath (Join-Path $staging 'database.sha256')
    Invoke-BackupCommand docker ($compose + @('cp', 'backup-worker:/backups/.', (Join-Path $staging 'registered-backups')))
    # Contains DB credentials. Restic encrypts the snapshot; staging remains ACL protected.
    Copy-Item -LiteralPath $EnvFile -Destination (Join-Path $staging 'online.env')
    Invoke-BackupCommand restic @('backup', $staging, '--tag', 'ccida-pos', '--host', $env:COMPUTERNAME)
    # Limit retention operations to this application's snapshots on this machine.
    Invoke-BackupCommand restic @('forget', '--tag', 'ccida-pos', '--host', $env:COMPUTERNAME, '--keep-within', '30d', '--prune')
    Write-Output 'POS encrypted offsite backup completed. Production archives and database were preserved.'
} finally { $lock.Dispose() }
