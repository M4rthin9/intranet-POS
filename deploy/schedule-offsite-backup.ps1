[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'run-offsite-backup.ps1'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName = 'CCIDA POS Encrypted Offsite Backup'
if ($PSCmdlet.ShouldProcess($taskName, 'Run POS-only encrypted backup daily at 02:30 and at user logon')) {
    $executable = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $action = New-ScheduledTaskAction -Execute $executable -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $script + '"')
    $triggers = @((New-ScheduledTaskTrigger -Daily -At '02:30'), (New-ScheduledTaskTrigger -AtLogOn -User $user))
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 15)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'POS-only encrypted R2 backups; requires this Docker Desktop user to be logged in.' -Force | Out-Null
    Write-Output 'POS backup task registered for 02:30 local time and logon. Recovery without a logged-in Docker Desktop user is not guaranteed.'
}
