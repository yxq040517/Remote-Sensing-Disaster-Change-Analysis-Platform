$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskPython=Join-Path $taskRoot '.venv\Scripts\python.exe'
if(-not(Test-Path -LiteralPath $taskPython)) {
    py -3.11 -m venv .venv
    if($LASTEXITCODE -ne 0){throw 'Python 3.11 is required.'}
}
$env:NO_ALBUMENTATIONS_UPDATE='1'
$taskRequirements='requirements-lock.txt'
if(-not(Test-Path -LiteralPath $taskRequirements)){$taskRequirements='requirements.txt'}
if(Get-Command uv -ErrorAction SilentlyContinue) {
    uv pip install --python $taskPython torch==2.9.1 torchvision==0.24.1 --index-url https://download.pytorch.org/whl/cu128 --link-mode copy
    if($LASTEXITCODE -ne 0){throw 'CUDA runtime installation failed.'}
    uv pip install --python $taskPython -r $taskRequirements --link-mode copy
} else {
    & $taskPython -m pip install torch==2.9.1 torchvision==0.24.1 --index-url https://download.pytorch.org/whl/cu128
    if($LASTEXITCODE -ne 0){throw 'CUDA runtime installation failed.'}
    & $taskPython -m pip install -r $taskRequirements
}
if($LASTEXITCODE -ne 0){throw 'Application dependencies failed.'}
& $taskPython -m scripts.prepare --samples 100
if($LASTEXITCODE -ne 0){throw 'Model or data preparation failed. Re-run to resume.'}
Push-Location -LiteralPath (Join-Path $taskRoot 'frontend')
try {
    npm.cmd ci --no-audit --no-fund
    if($LASTEXITCODE -ne 0){throw 'Frontend dependency installation failed.'}
    npm.cmd run build
    if($LASTEXITCODE -ne 0){throw 'Frontend build failed.'}
} finally { Pop-Location }
Write-Host 'Setup complete. Open the Starwatch launcher.' -ForegroundColor Green
