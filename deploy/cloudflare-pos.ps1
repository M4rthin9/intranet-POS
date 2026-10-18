# Manages only the named POS tunnel and exact POS DNS record. No ERP routes.
[CmdletBinding()]
param(
    [string]$CredentialsFile,
    [ValidatePattern('^[a-z0-9][a-z0-9.-]+[a-z0-9]$')][string]$Hostname = 'cccpos.dpdns.org',
    [switch]$Publish
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
if (-not $CredentialsFile) { $CredentialsFile = Join-Path $repository '.local/secrets/cloudflare-storage.json' }
$credentials = Get-Content -LiteralPath $CredentialsFile -Raw | ConvertFrom-Json
$headers = @{ Authorization = 'Bearer ' + $credentials.apiToken }
$api = 'https://api.cloudflare.com/client/v4'
function Invoke-Cloudflare([string]$Method, [string]$Path, $Body) {
    try {
        $parameters = @{ Method = $Method; Uri = $api + $Path; Headers = $headers; TimeoutSec = 30 }
        if ($null -ne $Body) { $parameters.Body = $Body | ConvertTo-Json -Depth 12 -Compress; $parameters.ContentType = 'application/json' }
        $response = Invoke-RestMethod @parameters
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        $codes = ''
        try { $codes = ((($_.ErrorDetails.Message | ConvertFrom-Json).errors | ForEach-Object { $_.code }) -join ',') } catch {}
        throw "Cloudflare $Method request failed for $Path (HTTP $status; error codes $codes). Check permissions/connectivity; secret response omitted."
    }
    if (-not $response.success) { throw "Cloudflare rejected $Method $Path." }
    return $response.result
}
$zones = @(Invoke-Cloudflare GET ('/zones?name=' + $Hostname) $null)
if ($zones.Count -ne 1 -or $zones[0].status -ne 'active') { throw 'The exact POS domain must be an active Cloudflare zone in this account.' }
if ($zones[0].account.id -ne $credentials.accountId) { throw 'Domain belongs to a different account.' }
$accountPath = '/accounts/' + $credentials.accountId
$tunnelName = 'ccida-pos-production'
$tunnels = @(Invoke-Cloudflare GET ($accountPath + '/cfd_tunnel?is_deleted=false&name=' + $tunnelName) $null)
$tunnels = @($tunnels | Where-Object { $_.name -eq $tunnelName })
if ($tunnels.Count -gt 1) { throw 'Multiple matching POS tunnels exist; resolve the duplicate before continuing.' }
if ($tunnels.Count -eq 0) {
    $tunnel = Invoke-Cloudflare POST ($accountPath + '/cfd_tunnel') @{ name = $tunnelName; config_src = 'cloudflare' }
} else { $tunnel = $tunnels[0] }
$tunnelPath = $accountPath + '/cfd_tunnel/' + $tunnel.id
$configuration = Invoke-Cloudflare GET ($tunnelPath + '/configurations') $null
$otherRoutes = @($configuration.config.ingress | Where-Object { $_.hostname -and $_.hostname -ne $Hostname })
if ($otherRoutes.Count) { throw 'The named tunnel contains another hostname. Refusing to modify non-POS routes.' }
$null = Invoke-Cloudflare PUT ($tunnelPath + '/configurations') @{
    config = @{ ingress = @(@{ hostname = $Hostname; service = 'http://online-proxy:8080' }, @{ service = 'http_status:404' }) }
}
$tokenFile = Join-Path $repository '.local/secrets/cloudflare-tunnel-token'
if (-not (Test-Path -LiteralPath $tokenFile)) {
    $token = Invoke-Cloudflare GET ($tunnelPath + '/token') $null
    # Parent directory was protected before the API credentials were stored.
    [IO.File]::WriteAllText($tokenFile, $token, [Text.UTF8Encoding]::new($false))
    $token = $null
}
$stateDirectory = Join-Path $repository '.local/deployments'
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
@{ hostname = $Hostname; tunnelId = $tunnel.id; tunnelName = $tunnelName; zoneId = $zones[0].id } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDirectory 'cloudflare-pos.json')
if ($Publish) {
    $recordsPath = '/zones/' + $zones[0].id + '/dns_records'
    $records = @(Invoke-Cloudflare GET ($recordsPath + '?name=' + $Hostname) $null)
    $target = $tunnel.id + '.cfargotunnel.com'
    $conflicts = @($records | Where-Object { $_.type -in @('A', 'AAAA', 'CNAME') -and ($_.type -ne 'CNAME' -or $_.content -ne $target) })
    if ($conflicts.Count) { throw 'A conflicting POS DNS address exists. No existing DNS record was replaced.' }
    $matching = @($records | Where-Object { $_.type -eq 'CNAME' -and $_.content -eq $target })
    if (-not $matching.Count) {
        $null = Invoke-Cloudflare POST $recordsPath @{ type = 'CNAME'; name = $Hostname; content = $target; proxied = $true; ttl = 1 }
    } elseif (-not $matching[0].proxied) { throw 'Existing POS tunnel DNS record is not proxied. Review it before publication.' }
    # Append a hostname-specific bypass rule, preserving unrelated zone rules.
    $rulesetPath = '/zones/' + $zones[0].id + '/rulesets'
    $rulesets = @(Invoke-Cloudflare GET $rulesetPath $null)
    $cacheRuleset = @($rulesets | Where-Object { $_.phase -eq 'http_request_cache_settings' -and $_.kind -eq 'zone' })
    $bypass = @{
        ref = 'ccida_pos_cache_bypass'; action = 'set_cache_settings';
        action_parameters = @{ cache = $false }; enabled = $true;
        expression = '(http.host eq "' + $Hostname + '")'; description = 'POS only: bypass cache for authenticated and customer data'
    }
    if ($cacheRuleset.Count -eq 0) {
        $null = Invoke-Cloudflare POST $rulesetPath @{ name = 'POS cache privacy'; kind = 'zone'; phase = 'http_request_cache_settings'; rules = @($bypass) }
    } elseif ($cacheRuleset.Count -eq 1) {
        $existingRuleset = Invoke-Cloudflare GET ($rulesetPath + '/' + $cacheRuleset[0].id) $null
        $rules = @($existingRuleset.rules | Where-Object { $_.ref -ne 'ccida_pos_cache_bypass' } | ForEach-Object {
            $rule = @{}
            foreach ($property in @('id', 'ref', 'action', 'action_parameters', 'expression', 'description', 'enabled', 'logging')) {
                if ($null -ne $_.$property) { $rule[$property] = $_.$property }
            }
            $rule
        }) + @($bypass)
        $null = Invoke-Cloudflare PUT ($rulesetPath + '/' + $cacheRuleset[0].id) @{ rules = $rules }
    } else { throw 'Multiple cache entrypoints found; review POS cache policy.' }
    $redirectRuleset = @($rulesets | Where-Object { $_.phase -eq 'http_request_dynamic_redirect' -and $_.kind -eq 'zone' })
    $redirect = @{
        ref = 'ccida_pos_https_redirect'; action = 'redirect'; enabled = $true;
        expression = '(http.host eq "' + $Hostname + '" and not ssl)'; description = 'POS only: redirect HTTP to HTTPS';
        action_parameters = @{ from_value = @{ status_code = 301; target_url = @{ expression = 'concat("https://' + $Hostname + '", http.request.uri.path)' }; preserve_query_string = $true } }
    }
    if ($redirectRuleset.Count -eq 0) {
        $null = Invoke-Cloudflare POST $rulesetPath @{ name = 'POS HTTPS'; kind = 'zone'; phase = 'http_request_dynamic_redirect'; rules = @($redirect) }
    } elseif ($redirectRuleset.Count -eq 1) {
        $existingRuleset = Invoke-Cloudflare GET ($rulesetPath + '/' + $redirectRuleset[0].id) $null
        $rules = @($existingRuleset.rules | Where-Object { $_.ref -ne 'ccida_pos_https_redirect' } | ForEach-Object {
            $rule = @{}
            foreach ($property in @('id', 'ref', 'action', 'action_parameters', 'expression', 'description', 'enabled', 'logging')) {
                if ($null -ne $_.$property) { $rule[$property] = $_.$property }
            }
            $rule
        }) + @($redirect)
        $null = Invoke-Cloudflare PUT ($rulesetPath + '/' + $redirectRuleset[0].id) @{ rules = $rules }
    } else { throw 'Multiple redirect entrypoints found; review POS HTTPS policy.' }
    Write-Output "Published POS only: https://$Hostname"
} else { Write-Output 'POS tunnel prepared. Public DNS publication has not been enabled.' }
