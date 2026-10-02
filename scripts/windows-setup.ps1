# LabForge Windows setup and check. Run from the repo root:  .\scripts\windows-setup.ps1
# Writes everything it finds to .labforge-report.txt so it can be read without copy and paste.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$report = Join-Path $root ".labforge-report.txt"
"LabForge report $(Get-Date -Format s)" | Out-File $report -Encoding utf8

function Log($t) { Write-Host $t; $t | Out-File $report -Append -Encoding utf8 }
function Run($label, [scriptblock]$b) {
  Log "`n== $label"
  try { $o = & $b 2>&1 | Out-String; Log $o.TrimEnd() } catch { Log "ERROR: $_" }
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
}

# 1. uv
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Log "uv missing, installing with winget"
  winget install --id astral-sh.uv -e --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
  Refresh-Path
}
Run "uv" { uv --version }

# 2. Python env and packages (one environment, appspi\.venv, with the test tools)
Run "install api, agent and dev tools" { uv sync --project apps/api --extra dev --link-mode copy }
Run "pnpm install" { if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm install } else { "pnpm is missing: npm install -g pnpm" } }

# 3. Tool versions
Run "docker" { docker version --format "client {{.Client.Version}} server {{.Server.Version}}" }
Run "docker compose" { docker compose version }
Run "vagrant" { vagrant --version }
Run "vagrant plugins" { vagrant plugin list }
Run "vagrant boxes" { vagrant box list }
$vb = Get-Command VBoxManage -ErrorAction SilentlyContinue
if (-not $vb -and (Test-Path "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe")) { $vb = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" }
if ($vb) { Run "virtualbox" { & $vb --version } } else { Log "`n== virtualbox`nNOT INSTALLED (optional, only for VM labs: winget install Oracle.VirtualBox)" }
Run "hypervisor present" { (Get-CimInstance Win32_ComputerSystem).HypervisorPresent }
Run "memory GB / free disk GB on F" {
  [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)
  [math]::Round((Get-PSDrive F).Free/1GB,1)
}

# 4. LabForge's own host check and tests
Push-Location apps\api
Run "hostenv virtualbox" { uv run python -m labforge_core.services.hostenv virtualbox }
Run "api tests" { uv run pytest -q -x 2>&1 | Select-Object -Last 25 }
Run "docker preflight (Linux labs)" { uv run python -m labforge_core.services.preflight }
Run "docker preflight (Windows guests)" { uv run python -m labforge_core.services.preflight --windows }
Pop-Location

Log "`nDone. Report saved to $report"
