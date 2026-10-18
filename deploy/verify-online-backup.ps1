# Restore drill into an isolated disposable PostgreSQL 17 container, never live DB.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256
)
$ErrorActionPreference = 'Stop'
$Archive = (Resolve-Path -LiteralPath $Archive).Path
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $ExpectedSha256) { throw 'Archive checksum mismatch.' }
$container = 'ccida-pos-restore-check-' + [Guid]::NewGuid().ToString('N')
function Invoke-RestoreCheck([string[]]$Arguments) {
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Isolated POS restore verification failed.' }
}
try {
    # No published ports and no network: trust auth is confined to this test container.
    Invoke-RestoreCheck @('run', '-d', '--name', $container, '--network', 'none', '--memory', '512m', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17') | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        & docker exec $container pg_isready -U postgres 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Isolated recovery database did not start.' }
    Invoke-RestoreCheck @('cp', $Archive, "${container}:/tmp/pos.dump")
    Invoke-RestoreCheck @('exec', $container, 'createdb', '-U', 'postgres', 'pos_recovery')
    Invoke-RestoreCheck @('exec', $container, 'pg_restore', '-U', 'postgres', '-d', 'pos_recovery', '--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges', '/tmp/pos.dump')
    $verification = 'SELECT json_build_object(''users'', (SELECT count(*) FROM "User"), ''orders'', (SELECT count(*) FROM "Order"), ''payments'', (SELECT count(*) FROM "Payment"), ''orderSatang'', (SELECT coalesce(sum("totalSatang"),0) FROM "Order"), ''paymentSatang'', (SELECT coalesce(sum("amountSatang"),0) FROM "Payment"), ''migrations'', (SELECT count(*) FROM "_prisma_migrations"));'
    # Stdin preserves quoted PostgreSQL identifiers through Windows native argv handling.
    $verification | & docker exec -i $container psql -U postgres -d pos_recovery -v ON_ERROR_STOP=1 -Atf -
    if ($LASTEXITCODE -ne 0) { throw 'Restored database reconciliation query failed.' }
    Write-Output 'PASS checksum and real restore into an isolated empty PostgreSQL 17 database.'
} finally {
    # Exact generated test container only. Its database is tmpfs, not a production volume.
    & docker rm -f $container | Out-Null
}
