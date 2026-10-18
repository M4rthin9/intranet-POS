# Task Scheduler entry point. Credentials remain in protected files, not task arguments.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$configuration = Get-Content -LiteralPath (Join-Path $repository '.local/secrets/r2-backup.json') -Raw | ConvertFrom-Json
$env:AWS_ACCESS_KEY_ID = $configuration.accessKeyId
$env:AWS_SECRET_ACCESS_KEY = $configuration.secretAccessKey
$env:AWS_DEFAULT_REGION = 'auto'
$env:RESTIC_REPOSITORY = $configuration.repository
$env:RESTIC_PASSWORD_FILE = Join-Path $repository '.local/secrets/restic-password'
$resticDirectory = Join-Path $repository '.local/tools/restic'
$restic = Get-ChildItem -LiteralPath $resticDirectory -Filter 'restic*.exe' | Select-Object -First 1
if (-not $restic) { throw 'Install the checksum-verified official restic binary under .local/tools/restic first.' }
$previousPath = $env:PATH
try {
    # offsite-backup.ps1 invokes the stable command name, regardless of release filename.
    $env:PATH = $resticDirectory + ';' + $env:PATH
    & (Join-Path $PSScriptRoot 'offsite-backup.ps1')
} finally {
    $env:PATH = $previousPath
    Remove-Item Env:\AWS_ACCESS_KEY_ID, Env:\AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
}
