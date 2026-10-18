# Creates private configuration only; does not start or stop any service.
[CmdletBinding()]
param(
    [ValidatePattern('^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$')]
    [string]$Hostname = 'cccpos.dpdns.org',
    [string]$SourceEnvFile,
    [string]$TokenFile
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
if (-not $SourceEnvFile) { $SourceEnvFile = Join-Path $PSScriptRoot '.env.pos-production' }
$SourceEnvFile = (Resolve-Path -LiteralPath $SourceEnvFile).Path
$destination = Join-Path $PSScriptRoot '.env.pos-online'
if (Test-Path -LiteralPath $destination) { throw 'Online environment already exists. Review it privately instead of overwriting it.' }

function Protect-PrivatePath([string]$Path, [bool]$Directory = $false) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetOwner($identity)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($identity, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
        $rule = if ($Directory) {
            [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        } else { [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow') }
        $acl.AddAccessRule($rule)
    }
    if ($Directory) { [IO.Directory]::SetAccessControl($Path, $acl) }
    else { [IO.File]::SetAccessControl($Path, $acl) }
}

$source = [IO.File]::ReadAllLines($SourceEnvFile)
foreach ($required in @('POSTGRES_PASSWORD', 'APP_DATABASE_PASSWORD', 'DATABASE_URL', 'MIGRATION_DATABASE_URL')) {
    if (-not ($source -match "^$required=.+")) { throw "Source environment is missing $required. Existing database credentials must be retained." }
}
$secretDirectory = Join-Path $repository '.local/secrets'
New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
Protect-PrivatePath $secretDirectory $true
$destinationToken = Join-Path $secretDirectory 'cloudflare-tunnel-token'
if (Test-Path -LiteralPath $destinationToken) {
    if ($TokenFile) { throw 'Tunnel token already exists. Preserve it or rotate it separately.' }
    $token = [IO.File]::ReadAllText($destinationToken).Trim()
} elseif ($TokenFile) {
    $token = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $TokenFile).Path).Trim()
} else {
    $secureToken = Read-Host 'Paste ONLY the Cloudflare tunnel token (hidden)' -AsSecureString
    $token = [Net.NetworkCredential]::new('', $secureToken).Password.Trim()
}
if ($token -notmatch '^[A-Za-z0-9_+/=-]{40,}$') { throw 'Invalid token format. Paste the token, not the Docker command.' }
try {
    [IO.File]::WriteAllText($destinationToken, $token, [Text.UTF8Encoding]::new($false))
    Protect-PrivatePath $destinationToken
} finally { $token = $null; $secureToken = $null }
$replaced = '^(POS_HOSTNAME|CLOUDFLARE_TUNNEL_TOKEN_FILE)='
$lines = @($source | Where-Object { $_ -notmatch $replaced }) + @(
    "POS_HOSTNAME=$Hostname",
    ('CLOUDFLARE_TUNNEL_TOKEN_FILE=' + $destinationToken.Replace('\', '/'))
)
# Create with restricted inherited permissions before writing credentials.
$temporary = Join-Path $secretDirectory 'online-env.tmp'
[IO.File]::WriteAllLines($temporary, $lines, [Text.UTF8Encoding]::new($false))
Protect-PrivatePath $temporary
Move-Item -LiteralPath $temporary -Destination $destination
Protect-PrivatePath $destination
Write-Output "Prepared private online configuration for https://$Hostname. No services changed."
Write-Output 'Cloudflare published application service URL: http://online-proxy:8080'
