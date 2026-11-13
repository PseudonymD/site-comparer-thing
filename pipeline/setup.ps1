# One-time setup for Windows (PowerShell): creates .venv with pinned dependencies.
# Usage (from the repository root):
#   powershell -ExecutionPolicy Bypass -File pipeline\setup.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not (Have "uv")) {
    Write-Host "==> 'uv' not found - installing it (https://docs.astral.sh/uv/)"
    try {
        powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    } catch { Write-Host "uv install failed: $_" }
    $env:Path = "$env:USERPROFILE\.local\bin;$env:USERPROFILE\.cargo\bin;$env:Path"
}

if (Have "uv") {
    Write-Host "==> Creating .venv with Python 3.12 (uv downloads Python if needed)"
    uv venv --python 3.12 --allow-existing .venv
    uv pip install --python .venv\Scripts\python.exe -r requirements.txt
} else {
    Write-Host "==> uv unavailable - falling back to python -m venv + pip"
    $py = (Get-Command python -ErrorAction SilentlyContinue)
    if (-not $py) { $py = (Get-Command py -ErrorAction SilentlyContinue) }
    if (-not $py) { throw "Install Python 3.10+ from https://www.python.org/downloads/ (tick 'Add to PATH')" }
    & $py.Source -m venv .venv
    .venv\Scripts\python.exe -m pip install --upgrade pip
    .venv\Scripts\python.exe -m pip install -r requirements.txt
}

if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }

Write-Host ""
Write-Host "==> Setup complete. Next steps (from the repository root):"
Write-Host ""
Write-Host "    .venv\Scripts\Activate.ps1"
Write-Host "    python -m pipeline doctor"
Write-Host "    python -m pipeline run --quick"
Write-Host "    python -m pipeline run"
Write-Host "    python -m pipeline publish"
Write-Host ""
