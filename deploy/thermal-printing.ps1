# A dedicated Chrome POS profile; does not change other browser profiles or Windows defaults.
[CmdletBinding(SupportsShouldProcess)]
param(
    [uri]$PosUrl = 'http://localhost:8081',
    [string]$BrowserPath,
    [switch]$Install,
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
try {
    if (-not $PosUrl.IsAbsoluteUri -or $PosUrl.Scheme -notin @('http', 'https') -or
        $PosUrl.UserInfo -or $PosUrl.Query -or $PosUrl.Fragment -or
        $PosUrl.AbsolutePath -notmatch '^/[A-Za-z0-9/_-]*$') {
        throw 'Supply the trusted POS http/https address without a query, fragment or credentials.'
    }
    if (-not $BrowserPath) {
        $candidates = @(
            (Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Google/Chrome/Application/chrome.exe'),
            (Join-Path $env:LOCALAPPDATA 'Google/Chrome/Application/chrome.exe')
        )
        $BrowserPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
    if (-not $BrowserPath -or -not (Test-Path -LiteralPath $BrowserPath -PathType Leaf)) {
        throw 'Install Google Chrome on this cashier PC before setting up automatic printing.'
    }
    $BrowserPath = (Resolve-Path -LiteralPath $BrowserPath).Path
    $printer = Get-CimInstance -ClassName Win32_Printer -Filter 'Default = TRUE' | Select-Object -First 1
    $reason = if (-not $printer) {
        'No Windows default printer. Connect/install the thermal printer and set it as default.'
    } elseif ($printer.Name -match 'PDF|XPS|OneNote|Fax|AnyDesk' -or $printer.PortName -eq 'PORTPROMPT:') {
        "The default printer is '$($printer.Name)'. Set the physical thermal printer as the Windows default."
    } elseif ($printer.WorkOffline -or $printer.PrinterStatus -eq 7) {
        "The default printer '$($printer.Name)' is offline. Connect it before opening POS."
    } else { '' }
    $status = [pscustomobject]@{
        Ready = -not [bool]$reason
        DefaultPrinter = $printer.Name
        Browser = $BrowserPath
        PosUrl = $PosUrl.AbsoluteUri
        Message = if ($reason) { $reason } else { 'Ready to send POS bills to the Windows default printer without confirmation.' }
    }
    if ($Check) { $status; return }
    $installation = Join-Path $env:LOCALAPPDATA 'CCIDA/POS-AutomaticPrinting'
    $profile = Join-Path $installation 'Browser'
    $arguments = @(
        "--user-data-dir=`"$profile`"",
        '--kiosk-printing',
        '--use-system-default-printer',
        '--no-first-run',
        '--no-default-browser-check',
        "--app=`"$($PosUrl.AbsoluteUri)`""
    )
    if ($Install) {
        if (-not $PSCmdlet.ShouldProcess($installation, 'Install the POS automatic-printing desktop shortcut and separate browser profile')) { return }
        New-Item -ItemType Directory -Force -Path $installation | Out-Null
        $installedScript = Join-Path $installation 'thermal-printing.ps1'
        if ([IO.Path]::GetFullPath($PSCommandPath) -ne [IO.Path]::GetFullPath($installedScript)) {
            Copy-Item -LiteralPath $PSCommandPath -Destination $installedScript -Force
        }
        $defaultProfile = Join-Path $profile 'Default'
        $preferencesPath = Join-Path $defaultProfile 'Preferences'
        if (-not (Test-Path -LiteralPath $preferencesPath)) {
            New-Item -ItemType Directory -Force -Path $defaultProfile | Out-Null
            $preferences = @{ printing = @{
                use_system_default_printer = $true
                print_preview_sticky_settings = @{ appState = (@{ version = 2; isHeaderFooterEnabled = $false; isCssBackgroundEnabled = $true } | ConvertTo-Json -Compress) }
            } }
            [IO.File]::WriteAllText($preferencesPath, ($preferences | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
        }
        $desktop = [Environment]::GetFolderPath('Desktop')
        $shortcutPath = Join-Path $desktop 'CCIDA POS - Automatic Printing.lnk'
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
        $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$installedScript`" -PosUrl `"$($PosUrl.AbsoluteUri)`" -BrowserPath `"$BrowserPath`""
        $shortcut.WorkingDirectory = $installation
        $shortcut.IconLocation = "$BrowserPath,0"
        $shortcut.Description = 'CCIDA POS - print bills automatically to the Windows default thermal printer'
        $shortcut.Save()
        Write-Output "Installed: $shortcutPath"
        Write-Output $status.Message
        return
    }
    if ($reason) { throw $reason }
    if ($PSCmdlet.ShouldProcess($PosUrl.AbsoluteUri, "Open the POS cashier browser with automatic printing to $($printer.Name)")) {
        # Interactive POS window. Its separate user-data directory isolates silent printing.
        Start-Process -FilePath $BrowserPath -ArgumentList $arguments -WindowStyle Normal
    }
} catch {
    if (-not $Install -and -not $Check -and -not $WhatIfPreference) {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'CCIDA POS - Printer setup') | Out-Null
    }
    throw
}
