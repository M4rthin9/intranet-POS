$ErrorActionPreference = 'Stop'
$sourceScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/update.ps1'
$testRoot = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) '.local') ('updater-test-' + [Guid]::NewGuid().ToString('N'))
$global:posUpdateTestCommands = [Collections.Generic.List[string]]::new()
$global:posUpdateTestFailure = ''
$global:posUpdateTestRevision = 'f' * 40
function git {
    $values = @($args)
    $global:LASTEXITCODE = 0
    $global:posUpdateTestCommands.Add('git ' + ($values -join ' '))
    if ($values -contains 'rev-parse') { return $global:posUpdateTestRevision }
    if ($values[0] -eq 'worktree') { New-Item -ItemType Directory -Force -Path $values[3] | Out-Null }
}
function docker {
    $values = @($args)
    $global:LASTEXITCODE = 0
    $line = 'docker ' + ($values -join ' ')
    $global:posUpdateTestCommands.Add($line)
    if (($global:posUpdateTestFailure -eq 'build' -and $values -contains 'build') -or
        ($global:posUpdateTestFailure -eq 'backup' -and $values -contains 'pg_dump') -or
        ($global:posUpdateTestFailure -eq 'migration' -and $values -contains 'run')) { $global:LASTEXITCODE = 1; return }
    if ($values -contains 'config' -and $values -contains 'json') { return '{"services":{"app":{"environment":{"APP_ORIGIN":"http://localhost:8081"}}}}' }
    if ($values -contains 'ps') { return 'fake-running-container' }
    if ($values -contains 'cp') { [IO.File]::WriteAllText($values[-1], 'mock PostgreSQL archive') }
}
function Invoke-WebRequest { return [pscustomobject]@{ StatusCode=200; Content='{"status":"ok"}' } }
function Assert-True($condition, $message) { if (-not $condition) { throw $message } }
foreach ($scenario in @('preview', 'success', 'build', 'backup', 'migration')) {
    $fakeRepository = Join-Path $testRoot $scenario
    $fakeDeploy = Join-Path $fakeRepository 'deploy'
    New-Item -ItemType Directory -Force -Path $fakeDeploy | Out-Null
    Copy-Item -LiteralPath $sourceScript -Destination (Join-Path $fakeDeploy 'update.ps1')
    [IO.File]::WriteAllText((Join-Path $fakeDeploy '.env.pos-production'), 'NOT_REAL_CREDENTIALS=1')
    $global:posUpdateTestCommands.Clear()
    $global:posUpdateTestFailure = $scenario
    $oldProfiles = $env:COMPOSE_PROFILES
    $env:COMPOSE_PROFILES = 'must-be-preserved'
    try {
        if ($scenario -eq 'preview') {
            & (Join-Path $fakeDeploy 'update.ps1') -WhatIf
            Assert-True ($global:posUpdateTestCommands.Count -eq 0) 'Preview called external commands.'
        } elseif ($scenario -eq 'success') {
            & (Join-Path $fakeDeploy 'update.ps1')
            $text = $global:posUpdateTestCommands -join "`n"
            Assert-True ($text.IndexOf(' build ') -lt $text.IndexOf(' pg_dump ')) 'Backup ran before build.'
            Assert-True ($text.IndexOf(' pg_dump ') -lt $text.IndexOf(' run ')) 'Migration ran before backup.'
            Assert-True ($text.IndexOf(' run ') -lt $text.IndexOf(' up ')) 'Services updated before migration.'
            Assert-True ($text -notmatch 'seed|bootstrap| down |reset') 'Updater invoked a seed/reset command.'
            $record = Get-Content (Join-Path $fakeRepository '.local/deployments/current.json') -Raw | ConvertFrom-Json
            Assert-True ($record.status -eq 'healthy' -and $record.backupSha256.Length -eq 64) 'Successful deployment record is incomplete.'
        } else {
            $failed = $false
            try { & (Join-Path $fakeDeploy 'update.ps1') } catch { $failed = $true }
            Assert-True $failed "The $scenario failure did not stop deployment."
            Assert-True (-not (($global:posUpdateTestCommands -join "`n") -match ' up ')) "Services changed after $scenario failed."
        }
        Assert-True ($env:COMPOSE_PROFILES -eq 'must-be-preserved') 'Compose profile environment was not restored.'
        Write-Output "PASS updater $scenario"
    } finally { $env:COMPOSE_PROFILES = $oldProfiles }
}
