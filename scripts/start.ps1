param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPython = Join-Path $taskRoot '.venv\Scripts\python.exe'
$taskDist = Join-Path $taskRoot 'frontend\dist\index.html'
Set-Location -LiteralPath $taskRoot
. (Join-Path $PSScriptRoot 'status.ps1')
Write-Host 'Starwatch / Starting local analysis workspace...' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $taskPython) -or -not (Test-Path -LiteralPath $taskDist)) {
    throw 'Runtime not ready. Run scripts\setup.ps1 first.'
}
$env:NO_ALBUMENTATIONS_UPDATE = '1'
$taskReuse = $false
try {
    $taskStatus = Get-StarwatchStatus
    $taskReuse = $taskStatus.service -eq 'starwatch' -and $taskStatus.workspace -eq $taskRoot
} catch { }
if (-not $taskReuse) {
    if (Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue) {
        throw 'Port 8765 is used by another service. Stop that service or choose another port.'
    }
    $taskProcess = Start-Process -FilePath $taskPython -ArgumentList @('-m','uvicorn','backend.server:app','--host','127.0.0.1','--port','8765','--no-access-log') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'data\server.log') -RedirectStandardError (Join-Path $taskRoot 'data\server-error.log') -PassThru
    $taskProcess.Id | Set-Content -LiteralPath (Join-Path $taskRoot 'data\server.pid') -Encoding ascii
    for ($taskAttempt=0; $taskAttempt -lt 30; $taskAttempt++) {
        try {
            $taskStatus = Get-StarwatchStatus
            if ($taskStatus.service -eq 'starwatch') { $taskReuse=$true; break }
        } catch { }
        if ($taskProcess.HasExited) { throw 'Server exited. See data\server-error.log.' }
        Start-Sleep -Milliseconds 500
    }
    if (-not $taskReuse) { throw 'Service startup timed out. See data\server-error.log.' }
}
Write-Host 'Ready: http://127.0.0.1:8765/' -ForegroundColor Green
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8765/' }
