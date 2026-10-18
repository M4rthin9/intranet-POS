# Run from any directory: powershell -File deploy/update.ps1
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._/-]*$')]
    [string]$Ref = 'origin/main',
    [string]$EnvFile,
    [switch]$Online,
    [ValidateRange(30, 900)]
    [int]$HealthTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) {
    $environmentName = if ($Online) { '.env.pos-online' } else { '.env.pos-production' }
    $EnvFile = Join-Path $repository "deploy/$environmentName"
}
$EnvFile = (Resolve-Path -LiteralPath $EnvFile).Path

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Deployment stopped." }
}

# -WhatIf returns before fetching, creating files or changing Docker services.
if (-not $PSCmdlet.ShouldProcess('ccida-pos', "Deploy GitHub revision $Ref, with a database backup and health check")) { return }

$previousDirectory = Get-Location
$previousProfiles = $env:COMPOSE_PROFILES
$previousPrompt = $env:GIT_TERMINAL_PROMPT
$deployment = $null
$record = $null
$deploymentLock = $null
try {
    Set-Location -LiteralPath $repository
    New-Item -ItemType Directory -Force -Path (Join-Path $repository '.local') | Out-Null
    $deploymentLock = [IO.File]::Open((Join-Path $repository '.local/deploy.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $env:COMPOSE_PROFILES = ''
    $env:GIT_TERMINAL_PROMPT = '0'
    Invoke-Checked git @('fetch', 'origin', '--prune')
    $revisionOutput = & git rev-parse --verify "${Ref}^{commit}"
    if ($LASTEXITCODE -ne 0 -or -not $revisionOutput) { throw 'Cannot resolve the requested Git revision.' }
    $revision = $revisionOutput.Trim()
    if ($revision -notmatch '^[a-f0-9]{40}$') { throw 'Cannot resolve the requested Git revision.' }

    $release = Join-Path $repository ".local/releases/$revision"
    if (-not (Test-Path -LiteralPath $release)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $release) | Out-Null
        Invoke-Checked git @('worktree', 'add', '--detach', $release, $revision)
    }
    $actualRevision = (& git -C $release rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualRevision -ne $revision) { throw 'Release checkout does not match the requested revision.' }
    $releaseChanges = & git -C $release status --porcelain --untracked-files=normal
    if ($LASTEXITCODE -ne 0 -or $releaseChanges) { throw 'Release checkout has local changes; review them before updating.' }

    # Keep the project and named volumes stable across every release checkout.
    $compose = @('compose', '-p', 'ccida-pos', '--env-file', $EnvFile, '-f', (Join-Path $release 'compose.yaml'))
    if ($Online) {
        $onlineCompose = Join-Path $release 'compose.online.yaml'
        if (-not (Test-Path -LiteralPath $onlineCompose)) { throw 'This revision does not support online deployment.' }
        $compose += @('-f', $onlineCompose)
    } else {
        $onlineId = & docker ps --filter 'label=com.docker.compose.project=ccida-pos' --filter 'label=com.docker.compose.service=online-proxy' --format '{{.ID}}'
        if ($LASTEXITCODE -ne 0) { throw 'Cannot check the active POS deployment mode.' }
        if ($onlineId) { throw 'POS is running online. Use -Online to preserve HTTPS and the tunnel; use the documented maintenance rollback to return to LAN mode.' }
    }
    Invoke-Checked docker ($compose + @('config', '--quiet'))
    $configurationJson = & docker @compose config --format json
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read the production Compose configuration.' }
    $configuration = $configurationJson | ConvertFrom-Json
    # Readiness must not depend on public DNS, Cloudflare, or local certificate trust.
    $publishedPort = $configuration.services.app.ports[0].published
    $healthUrl = "http://127.0.0.1:$publishedPort/api/health"
    if ($Online) {
        $tokenPath = $configuration.secrets.cloudflare_tunnel_token.file
        if (-not [IO.Path]::IsPathRooted($tokenPath) -or -not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
            throw 'Online deployment requires an existing absolute tunnel token file.'
        }
    }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $deployment = Join-Path $repository ".local/deployments/$stamp-$($revision.Substring(0, 12)).json"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $deployment) | Out-Null
    $record = [ordered]@{ revision = $revision; ref = $Ref; release = $release; online = [bool]$Online; startedAt = (Get-Date).ToString('o'); status = 'building'; backup = $null }
    $record | ConvertTo-Json | Set-Content -LiteralPath $deployment -Encoding UTF8

    # Build before touching running services. No seed or bootstrap command runs on updates.
    Invoke-Checked docker ($compose + @('build', '--pull', 'app', 'migrate', 'backup-worker'))
    if ($Online) {
        # Upgrade the public runtime from the same build as LAN, without changing LAN settings.
        Invoke-Checked docker @('tag', 'ccida-pos-app:latest', 'ccida-pos-online-app:current')
        Invoke-Checked docker ($compose + @('pull', 'online-proxy', 'tunnel'))
        Invoke-Checked docker ($compose + @('run', '--rm', '--no-deps', 'online-proxy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile'))
    }
    $databaseId = & docker @compose ps --status running -q db
    if ($LASTEXITCODE -ne 0 -or -not $databaseId) { throw 'The production database must already be running before an update.' }

    $backupDirectory = Join-Path $repository '.local/backups/pre-update'
    New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
    $backupName = "pos-$stamp-$($revision.Substring(0, 12)).dump"
    $backupFile = Join-Path $backupDirectory $backupName
    Invoke-Checked docker ($compose + @('exec', '-T', 'db', 'pg_dump', '-U', 'ccida_owner', '-d', 'ccida', '--format=custom', '--no-owner', '--no-privileges', '--file', "/tmp/$backupName"))
    Invoke-Checked docker ($compose + @('exec', '-T', 'db', 'pg_restore', '--list', "/tmp/$backupName")) | Out-Null
    Invoke-Checked docker ($compose + @('cp', "db:/tmp/$backupName", $backupFile))
    if ((Get-Item -LiteralPath $backupFile).Length -eq 0) { throw 'Pre-update backup is empty.' }
    $record.backup = $backupFile
    $record.backupSha256 = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash
    $record.status = 'migrating'
    $record | ConvertTo-Json | Set-Content -LiteralPath $deployment -Encoding UTF8

    Invoke-Checked docker ($compose + @('run', '--rm', '--no-deps', 'migrate'))
    Invoke-Checked docker ($compose + @('up', '-d', '--no-build', '--no-deps', 'app', 'backup-worker'))
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
    $healthy = $false
    do {
        try {
            $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
            $healthy = $response.StatusCode -eq 200 -and ($response.Content | ConvertFrom-Json).status -eq 'ok'
        } catch { $healthy = $false }
        if (-not $healthy) { Start-Sleep -Seconds 2 }
    } while (-not $healthy -and (Get-Date) -lt $deadline)
    if (-not $healthy) { throw 'POS failed its health check. Review POS logs and the saved deployment record.' }
    $workerId = & docker @compose ps --status running -q backup-worker
    if ($LASTEXITCODE -ne 0 -or -not $workerId) { throw 'The POS backup worker is not running.' }

    if ($Online) {
        Invoke-Checked docker ($compose + @('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', "$HealthTimeoutSeconds", 'online-app', 'online-proxy', 'tunnel'))
        # Running is not the same as connected: require a real tunnel connection.
        $tunnelId = & docker @compose ps --status running -q tunnel
        if ($LASTEXITCODE -ne 0 -or -not $tunnelId) { throw 'The POS tunnel is not running.' }
        $connected = $false
        $tunnelDeadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
        do {
            try {
                & docker @compose exec -T online-proxy wget -q -O /dev/null http://tunnel:2000/ready 2>$null
                $connected = $LASTEXITCODE -eq 0
            } catch { $connected = $false }
            if (-not $connected) { Start-Sleep -Seconds 2 }
        } while (-not $connected -and (Get-Date) -lt $tunnelDeadline)
        if (-not $connected) { throw 'POS is healthy locally, but the tunnel did not connect. Check token and outbound connectivity. LAN HTTPS remains available.' }
    }

    $record.status = 'healthy'
    $record.completedAt = (Get-Date).ToString('o')
    $record | ConvertTo-Json | Set-Content -LiteralPath $deployment -Encoding UTF8
    Copy-Item -LiteralPath $deployment -Destination (Join-Path $repository '.local/deployments/current.json')
    Write-Host "POS updated to $revision. Health: $healthUrl"
    Write-Host "Backup: $backupFile"
} catch {
    if ($record) {
        $record.status = 'failed'
        $record | ConvertTo-Json | Set-Content -LiteralPath $deployment -Encoding UTF8
    }
    throw
} finally {
    if ($deploymentLock) { $deploymentLock.Dispose() }
    $env:COMPOSE_PROFILES = $previousProfiles
    $env:GIT_TERMINAL_PROMPT = $previousPrompt
    Set-Location -LiteralPath $previousDirectory
}
