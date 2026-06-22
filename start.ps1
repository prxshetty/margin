# start.ps1 — Windows PowerShell startup script
# Run with:  powershell -ExecutionPolicy Bypass -File start.ps1

$ErrorActionPreference = "Stop"
$RootDir = $PSScriptRoot
Set-Location $RootDir

# ── Python environment ──────────────────────────────────────────────────────
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}

& ".venv\Scripts\Activate.ps1"
pip install -q --upgrade pip
pip install -q -r requirements.txt

# ── Node environment ────────────────────────────────────────────────────────
if (-not (Test-Path "ui\node_modules")) {
    Write-Host "Installing frontend dependencies..."
    Push-Location ui
    npm install
    Pop-Location
}

# ── Launch ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Starting SLM Writing Engine..."
Write-Host "  API  -> http://localhost:8000"
Write-Host "  UI   -> http://localhost:5173"
Write-Host ""

$api = Start-Process -NoNewWindow -PassThru -FilePath "uvicorn" `
    -ArgumentList "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"

$ui = Start-Process -NoNewWindow -PassThru -FilePath "npm" `
    -ArgumentList "run", "dev" -WorkingDirectory "ui"

try {
    Wait-Process -Id $api.Id, $ui.Id
} finally {
    # Clean up both processes if one exits
    foreach ($proc in @($api, $ui)) {
        if (-not $proc.HasExited) { $proc.Kill() }
    }
}
