# Additive activation: LAN app and ERP are never recreated or reconfigured.
[CmdletBinding()]
param([ValidateRange(0,3600)][int]$WaitForDeploymentSeconds = 1800)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $PSScriptRoot '.env.pos-online'
if (-not (Test-Path -LiteralPath $environmentFile)) { throw 'Prepare the private online environment first.' }
$lock = $null
$deadline = (Get-Date).AddSeconds($WaitForDeploymentSeconds)
do {
    try { $lock = [IO.File]::Open((Join-Path $repository '.local/deploy.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { if ((Get-Date) -ge $deadline) { throw 'Another POS deployment still holds the lock. Nothing was changed.' }; Start-Sleep -Seconds 2 }
} while (-not $lock)
function Invoke-PosCommand([string[]]$Arguments) {
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'POS online activation stopped after a failed Docker command. Check the saved checkpoint; ERP was not modified.' }
}
$compose = @('compose', '-p', 'ccida-pos', '--env-file', $environmentFile, '-f', (Join-Path $repository 'compose.yaml'), '-f', (Join-Path $repository 'compose.online.yaml'))
$financialSql = 'SELECT json_build_object(''users'', (SELECT count(*) FROM "User"), ''events'', (SELECT count(*) FROM "Event"), ''products'', (SELECT count(*) FROM "Product"), ''registrations'', (SELECT count(*) FROM "Registration"), ''orders'', (SELECT count(*) FROM "Order"), ''payments'', (SELECT count(*) FROM "Payment"), ''receipts'', (SELECT count(*) FROM "Receipt"), ''orderSatang'', (SELECT coalesce(sum("totalSatang"),0) FROM "Order"), ''paymentSatang'', (SELECT coalesce(sum("amountSatang"),0) FROM "Payment"));'
function Read-PosTotals {
    $result = $financialSql | & docker @compose exec -T db psql -U ccida_owner -d ccida -v ON_ERROR_STOP=1 -Atf -
    if ($LASTEXITCODE -ne 0) { throw 'Cannot reconcile current POS totals.' }
    return ($result | ConvertFrom-Json | ConvertTo-Json -Compress)
}
try {
    Invoke-PosCommand ($compose + @('config', '--quiet'))
    Invoke-PosCommand ($compose + @('run', '--rm', '--no-deps', 'online-proxy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile'))
    $checkpoint = Join-Path $repository ('.local/secrets/online-activation-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path $checkpoint | Out-Null
    $databaseId = (& docker @compose ps --status running -q db).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $databaseId) { throw 'The existing POS database must be running.' }
    $lanId = (& docker @compose ps --status running -q app).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $lanId) { throw 'The existing LAN POS must be running.' }
    $lanImage = (& docker inspect --format '{{.Image}}' $lanId).Trim()
    if ($LASTEXITCODE -ne 0 -or $lanImage -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Cannot identify the running LAN application image.' }
    Invoke-PosCommand @('tag', $lanImage, 'ccida-pos-online-app:current')
    $erpBefore = @(& docker ps --filter 'name=cida-erp-' --format '{{.ID}}' | Sort-Object)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot record existing ERP container identities.' }
    $before = Read-PosTotals
    $before | Set-Content -LiteralPath (Join-Path $checkpoint 'totals-before.json')
    & docker inspect --format '{{json .Image}}' ccida-pos-app-1 ccida-pos-backup-worker-1 | Set-Content -LiteralPath (Join-Path $checkpoint 'images-before.jsonl')
    Invoke-PosCommand ($compose + @('exec', '-T', 'db', 'pg_dump', '-U', 'ccida_owner', '-d', 'ccida', '--format=custom', '--no-owner', '--no-privileges', '--file', '/tmp/pos-online-activation.dump'))
    Invoke-PosCommand ($compose + @('exec', '-T', 'db', 'pg_restore', '--list', '/tmp/pos-online-activation.dump')) | Out-Null
    $archive = Join-Path $checkpoint 'database.dump'
    Invoke-PosCommand ($compose + @('cp', 'db:/tmp/pos-online-activation.dump', $archive))
    (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash | Set-Content -LiteralPath (Join-Path $checkpoint 'database.sha256')
    Write-Output 'POS checkpoint verified; adding public POS services while preserving LAN containers.'
    Invoke-PosCommand ($compose + @('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '180', 'online-app'))
    Invoke-PosCommand ($compose + @('up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'online-proxy', 'tunnel'))
    $connected = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            & docker @compose exec -T online-proxy wget -q -O /dev/null http://tunnel:2000/ready 2>$null
            $connected = $LASTEXITCODE -eq 0
        } catch { $connected = $false }
        if ($connected) { break }
        Start-Sleep -Seconds 2
    }
    if (-not $connected) { throw 'POS is configured locally, but the tunnel is not ready. Public DNS was not published.' }
    $after = Read-PosTotals
    $after | Set-Content -LiteralPath (Join-Path $checkpoint 'totals-after.json')
    if ($before -ne $after) { Write-Output 'Business totals changed while LAN remained active; before/after records saved for review. No business records were written by activation.' }
    if ((& docker @compose ps --status running -q db).Trim() -ne $databaseId) { throw 'Database container identity changed unexpectedly.' }
    if ((& docker @compose ps --status running -q app).Trim() -ne $lanId) { throw 'LAN application identity changed unexpectedly.' }
    $erpAfter = @(& docker ps --filter 'name=cida-erp-' --format '{{.ID}}' | Sort-Object)
    if (Compare-Object $erpBefore $erpAfter) { throw 'ERP container identities changed during commissioning. Review before publication.' }
    & (Join-Path $PSScriptRoot 'cloudflare-pos.ps1') -Publish
    @{ activatedAt = (Get-Date).ToString('o'); hostname = 'cccpos.dpdns.org'; lanContainerId = $lanId; databaseContainerId = $databaseId; image = $lanImage; checkpoint = $checkpoint } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $repository '.local/deployments/online-current.json')
    Write-Output 'POS online activation complete. Run scripts/online-smoke.mjs for external HTTPS acceptance.'
} finally { $lock.Dispose() }
