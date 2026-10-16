$ErrorActionPreference = 'Stop'
$script = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/thermal-printing.ps1'
$global:thermalTestPrinter = $null
function Get-CimInstance {
    param([string]$ClassName, [string]$Filter)
    if ($ClassName -ne 'Win32_Printer' -or $Filter -ne 'Default = TRUE') { throw 'Printer check must select the Windows default.' }
    $global:thermalTestPrinter
}
function Assert-PrinterStatus {
    param($Printer, [bool]$Expected, [string]$Message)
    $global:thermalTestPrinter = $Printer
    $status = & $script -Check -BrowserPath (Join-Path $PSHOME 'powershell.exe') -PosUrl 'https://pos.example.test'
    if ($status.Ready -ne $Expected -or $status.Message -notmatch $Message) { throw "Unexpected status: $($status | ConvertTo-Json -Compress)" }
}
Assert-PrinterStatus $null $false 'No Windows default printer'
Assert-PrinterStatus ([pscustomobject]@{ Name = 'AnyDesk Printer'; PortName = 'AD_Port'; WorkOffline = $false; PrinterStatus = 3 }) $false 'physical thermal'
Assert-PrinterStatus ([pscustomobject]@{ Name = 'Microsoft Print to PDF'; PortName = 'PORTPROMPT:'; WorkOffline = $false; PrinterStatus = 3 }) $false 'physical thermal'
Assert-PrinterStatus ([pscustomobject]@{ Name = 'Thermal 80mm'; PortName = 'USB001'; WorkOffline = $true; PrinterStatus = 7 }) $false 'offline'
Assert-PrinterStatus ([pscustomobject]@{ Name = 'Thermal 80mm'; PortName = 'USB001'; WorkOffline = $false; PrinterStatus = 3 }) $true 'without confirmation'
$rejected = $false
try { & $script -Check -PosUrl 'https://pos.example.test/?next=bad' } catch { $rejected = $_.Exception.Message -match 'trusted POS' }
if (-not $rejected) { throw 'Unexpected launcher URL accepted.' }
Write-Output 'PASS: physical/default, virtual, missing and offline printer checks; launcher URL validation.'
