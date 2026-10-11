# BINNY installer for Windows: https://openbin.ai/install-binny.ps1
#
#   irm https://openbin.ai/install-binny.ps1 | iex
#
# Installs binny.exe, OpenBin's terminal reverse-engineering agent. Pure
# PowerShell, no dependencies beyond what ships with Windows 10/11.
#
# What it does:
#   1. Detects your CPU arch (amd64).
#   2. Downloads the matching zip from the latest binny-releases GitHub
#      release (just binny.exe, around 10 MB).
#   3. Installs to %LOCALAPPDATA%\Programs\openbin (next to openbin.exe) and
#      adds it to your PATH.
#
# Env overrides:
#   BINNY_INSTALL_DIR   where to put the binary  (default LOCALAPPDATA\Programs\openbin)
#   BINNY_RELEASE_BASE  release asset base URL   (default GitHub latest)

$ErrorActionPreference = 'Stop'

$repo        = 'openbin-ai/binny-releases'
$releaseBase = if ($env:BINNY_RELEASE_BASE) { $env:BINNY_RELEASE_BASE } else { "https://github.com/$repo/releases/latest/download" }
$installDir  = if ($env:BINNY_INSTALL_DIR)  { $env:BINNY_INSTALL_DIR }  else { Join-Path $env:LOCALAPPDATA 'Programs\openbin' }

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "warning: $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

# --- detect arch -----------------------------------------------------------
# Go release naming: amd64. Windows on ARM can run the amd64 build under
# emulation, so fall back to amd64 rather than refusing to install.
$arch = 'amd64'
switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { $arch = 'amd64' }
  'ARM64' { Warn 'Windows on ARM detected; installing the amd64 build (runs under emulation).'; $arch = 'amd64' }
  default { $arch = 'amd64' }
}

$asset = "binny-windows-$arch.zip"
$url   = "$releaseBase/$asset"

# --- download + extract ----------------------------------------------------
$tmp = Join-Path $env:TEMP ("binny-install-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  $zipPath = Join-Path $tmp $asset
  Info "Downloading $asset from the latest release..."
  try {
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  } catch {
    Die "download failed: $url`nIs there a published release yet? See https://github.com/$repo/releases"
  }

  Info 'Extracting...'
  Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
  # Zip extracts to binny-windows-<arch>\binny.exe; find it wherever it
  # landed so we don't hard-depend on the layout.
  $bin = Get-ChildItem -Path $tmp -Recurse -Filter 'binny.exe' | Select-Object -First 1
  if (-not $bin) { Die "could not find binny.exe inside $asset" }

  # --- install -------------------------------------------------------------
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $dest = Join-Path $installDir 'binny.exe'
  # If binny is currently running it holds a lock; ask the user to close it.
  try {
    Copy-Item -Path $bin.FullName -Destination $dest -Force
  } catch {
    Die "could not write $dest (is binny currently running? close it and retry): $_"
  }
  Info "Installed binny to $dest"

  try { $ver = & $dest --version 2>$null } catch { $ver = $null }
  if ($ver) { Info $ver } else { Info 'binny (version unknown)' }

  # --- PATH setup ----------------------------------------------------------
  # Add installDir to the USER PATH (persisted) if not already present, and to
  # this session's PATH so `openbin` works immediately.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }
  $onPath = ($userPath -split ';') -contains $installDir
  if (-not $onPath) {
    $newPath = if ($userPath.TrimEnd(';')) { $userPath.TrimEnd(';') + ';' + $installDir } else { $installDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Info "Added $installDir to your user PATH."
    Warn "Open a NEW terminal for the PATH change to take effect (this window won't see it)."
  }
  if (($env:Path -split ';') -notcontains $installDir) {
    $env:Path = "$env:Path;$installDir"
  }

  # --- next steps ----------------------------------------------------------
  Write-Host ''
  Write-Host 'binny is installed. Next steps:'
  Write-Host ''
  Write-Host '  openbin login     # once; binny reuses the openbin CLI sign-in'
  Write-Host '                    # (no openbin yet? irm https://openbin.ai/install.ps1 | iex)'
  Write-Host '  binny             # pick a project, set an LLM key, start investigating'
  Write-Host ''
  Write-Host 'Inside binny: /help lists commands, /key stores a BYOK key, /endpoint points a'
  Write-Host 'provider at a gateway host. Docker Desktop is needed only for /decompile and'
  Write-Host 'the sandbox tools. This is a beta: report problems in the Discord.'
}
finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
