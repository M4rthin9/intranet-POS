# Operational check: briefly stops only the connector, then always restores it.
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$compose = @('compose', '-p', 'ccida-pos', '--env-file', (Join-Path $repository 'deploy/.env.pos-online'), '-f', (Join-Path $repository 'compose.yaml'), '-f', (Join-Path $repository 'compose.online.yaml'))
function Request-Status([string]$Url, [string]$Method = 'GET', [string]$Origin = '') {
    $parameters = @{ Uri = $Url; Method = $Method; UseBasicParsing = $true; TimeoutSec = 10 }
    if ($Method -eq 'POST') { $parameters.Headers = @{ Origin = $Origin }; $parameters.ContentType = 'application/json'; $parameters.Body = '{"username":"","password":""}' }
    try { return [int](Invoke-WebRequest @parameters).StatusCode }
    catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }; throw }
}
$lanBefore = & docker @compose ps --status running -q app
$databaseBefore = & docker @compose ps --status running -q db
$erpBefore = @(& docker ps --filter 'name=cida-erp-' --format '{{.ID}}' | Sort-Object)
try {
    & docker @compose stop -t 10 tunnel
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the POS connector for isolation test.' }
    $running = & docker @compose ps --status running -q tunnel
    if ($running) { throw 'Connector is still running; isolation test invalid.' }
    foreach ($origin in @('http://192.168.0.46:8081', 'http://192.168.1.46:8081')) {
        if ((Request-Status "$origin/api/health") -ne 200) { throw "LAN database health failed: $origin" }
        if ((Request-Status "$origin/") -ne 200) { throw "LAN login page failed: $origin" }
        if ((Request-Status "$origin/api/auth" 'POST' $origin) -ne 400) { throw "LAN origin/form validation failed: $origin" }
        if ((Request-Status "$origin/api/auth" 'POST' 'https://wrong.example') -ne 403) { throw "LAN wrong-origin rejection failed: $origin" }
        if ((Request-Status "$origin/api/data?view=settings") -ne 401) { throw "LAN authentication guard failed: $origin" }
        Write-Output "PASS with connector stopped: $origin health, login page, origin validation and authentication guard"
    }
    if ((& docker @compose ps --status running -q app) -ne $lanBefore) { throw 'LAN application identity changed.' }
    if ((& docker @compose ps --status running -q db) -ne $databaseBefore) { throw 'POS database identity changed.' }
    $erpAfter = @(& docker ps --filter 'name=cida-erp-' --format '{{.ID}}' | Sort-Object)
    if (Compare-Object $erpBefore $erpAfter) { throw 'ERP container identities changed.' }
} finally {
    & docker @compose start tunnel
    if ($LASTEXITCODE -ne 0) { throw 'Could not restart POS connector. LAN was preserved.' }
    $connected = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try { & docker @compose exec -T online-proxy wget -q -O /dev/null http://tunnel:2000/ready 2>$null; $connected = $LASTEXITCODE -eq 0 } catch { $connected = $false }
        if ($connected) { break }
        Start-Sleep -Seconds 2
    }
    if (-not $connected) { throw 'Connector restarted but did not reconnect; check Cloudflare status. LAN remains independent.' }
    Write-Output 'PASS connector reconnected; LAN, database and ERP container identities preserved.'
}
