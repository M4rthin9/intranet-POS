$ErrorActionPreference = 'Stop'
$sourceScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/update.ps1'
$testRoot = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) '.local') ('updater-test-' + [Guid]::NewGuid().ToString('N'))
$global:posUpdateTestCommands = [Collections.Generic.List[string]]::new()
$global:posUpdateTestFailure = ''
$global:posUpdateTestRevision = 'f' * 40
$global:posUpdateTestToken = ''
$global:posUpdateHealthUrls = [Collections.Generic.List[string]]::new()
function git {
    $values = @($args)
    $global:LASTEXITCODE = 0
    $global:posUpdateTestCommands.Add('git ' + ($values -join ' '))
    if ($values -contains 'rev-parse') { return $global:posUpdateTestRevision }
    if ($values[0] -eq 'worktree') {
        New-Item -ItemType Directory -Force -Path $values[3] | Out-Null
        [IO.File]::WriteAllText((Join-Path $values[3] 'compose.online.yaml'), '# isolated fixture')
    }
}
function docker {
    $values = @($args)
    $global:LASTEXITCODE = 0
    $line = 'docker ' + ($values -join ' ')
    $global:posUpdateTestCommands.Add($line)
    if ($values[0] -eq 'ps') {
        if ($global:posUpdateTestFailure -eq 'online-reject-lan') { return 'online-proxy-running' }
        return
    }
    if (($global:posUpdateTestFailure -eq 'build' -and $values -contains 'build') -or
        ($global:posUpdateTestFailure -eq 'backup' -and $values -contains 'pg_dump') -or
        ($global:posUpdateTestFailure -eq 'migration' -and $values -contains 'run') -or
        ($global:posUpdateTestFailure -eq 'online-validate' -and $values -contains 'validate')) { $global:LASTEXITCODE = 1; return }
    if ($values -contains 'config' -and $values -contains 'json') {
        return (@{ services = @{ app = @{ environment = @{ APP_ORIGIN = 'https://unreachable.example' }; ports = @(@{ published = 8081 }) } }; secrets = @{ cloudflare_tunnel_token = @{ file = $global:posUpdateTestToken } } } | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($values -contains 'ps') { return 'fake-running-container' }
    if ($values -contains 'cp') { [IO.File]::WriteAllText($values[-1], 'mock PostgreSQL archive') }
}
function Invoke-WebRequest { param($Uri, [switch]$UseBasicParsing, $TimeoutSec) $global:posUpdateHealthUrls.Add($Uri); return [pscustomobject]@{ StatusCode=200; Content='{"status":"ok"}' } }
function Assert-True($condition, $message) { if (-not $condition) { throw $message } }
foreach ($scenario in @('preview', 'success', 'build', 'backup', 'migration', 'online-success', 'online-validate', 'online-reject-lan')) {
    $fakeRepository = Join-Path $testRoot $scenario
    $fakeDeploy = Join-Path $fakeRepository 'deploy'
    New-Item -ItemType Directory -Force -Path $fakeDeploy | Out-Null
    Copy-Item -LiteralPath $sourceScript -Destination (Join-Path $fakeDeploy 'update.ps1')
    [IO.File]::WriteAllText((Join-Path $fakeDeploy '.env.pos-production'), 'NOT_REAL_CREDENTIALS=1')
    [IO.File]::WriteAllText((Join-Path $fakeDeploy '.env.pos-online'), 'NOT_REAL_CREDENTIALS=1')
    $global:posUpdateTestToken = Join-Path $fakeRepository 'fake-token'
    [IO.File]::WriteAllText($global:posUpdateTestToken, 'fixture only')
    $global:posUpdateTestCommands.Clear()
    $global:posUpdateHealthUrls.Clear()
    $global:posUpdateTestFailure = $scenario
    $oldProfiles = $env:COMPOSE_PROFILES
    $env:COMPOSE_PROFILES = 'must-be-preserved'
    try {
        if ($scenario -eq 'preview') {
            & (Join-Path $fakeDeploy 'update.ps1') -WhatIf
            Assert-True ($global:posUpdateTestCommands.Count -eq 0) 'Preview called external commands.'
        } elseif ($scenario -in @('success', 'online-success')) {
            & (Join-Path $fakeDeploy 'update.ps1') -Online:($scenario -eq 'online-success')
            $text = $global:posUpdateTestCommands -join "`n"
            Assert-True ($text.IndexOf(' build ') -lt $text.IndexOf(' pg_dump ')) 'Backup ran before build.'
            Assert-True ($text.IndexOf(' pg_dump ') -lt $text.IndexOf(' run --rm --no-deps migrate')) 'Migration ran before backup.'
            Assert-True ($text.IndexOf(' run --rm --no-deps migrate') -lt $text.IndexOf(' up ')) 'Services updated before migration.'
            Assert-True ($text -notmatch 'seed|bootstrap| down |reset') 'Updater invoked a seed/reset command.'
            $record = Get-Content (Join-Path $fakeRepository '.local/deployments/current.json') -Raw | ConvertFrom-Json
            Assert-True ($record.status -eq 'healthy' -and $record.backupSha256.Length -eq 64) 'Successful deployment record is incomplete.'
            Assert-True ($global:posUpdateHealthUrls[0] -eq 'http://127.0.0.1:8081/api/health') 'Readiness depended on public DNS.'
            if ($scenario -eq 'online-success') {
                Assert-True ($record.online -and $text -match 'compose.online.yaml' -and $text -match 'online-proxy tunnel' -and $text -match 'http://tunnel:2000/ready') 'Online services or connected-tunnel check were omitted.'
            }
        } else {
            $failed = $false
            try { & (Join-Path $fakeDeploy 'update.ps1') -Online:($scenario -eq 'online-validate') } catch { $failed = $true }
            Assert-True $failed "The $scenario failure did not stop deployment."
            Assert-True (-not (($global:posUpdateTestCommands -join "`n") -match ' up ')) "Services changed after $scenario failed."
        }
        Assert-True ($env:COMPOSE_PROFILES -eq 'must-be-preserved') 'Compose profile environment was not restored.'
        Write-Output "PASS updater $scenario"
    } finally { $env:COMPOSE_PROFILES = $oldProfiles }
}
