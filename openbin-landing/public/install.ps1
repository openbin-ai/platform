# openbin installer for Windows — https://openbin.ai/install.ps1
#
#   irm https://openbin.ai/install.ps1 | iex
#
# Installs the `openbin` CLI (decompile APKs and native binaries on your own
# machine, upload the result to your OpenAPK/OpenBin account). Pure PowerShell,
# no dependencies beyond what ships with Windows 10/11.
#
# What it does:
#   1. Detects your CPU arch (amd64).
#   2. Downloads the matching CLI zip from the latest GitHub release
#      (just openbin.exe — ~10 MB; the Docker worker images are pulled
#      lazily the first time you decompile).
#   3. Installs to %LOCALAPPDATA%\Programs\openbin and adds it to your PATH.
#
# Env overrides:
#   OPENBIN_INSTALL_DIR   where to put the binary  (default LOCALAPPDATA\Programs\openbin)
#   OPENBIN_RELEASE_BASE  release asset base URL   (default GitHub latest)
#
# Note: openbin runs the decompiler in a local Docker container, so Docker
# Desktop (WSL 2 backend) must be installed and running to decompile.

$ErrorActionPreference = 'Stop'

$repo        = 'openbin-ai/platform'
$releaseBase = if ($env:OPENBIN_RELEASE_BASE) { $env:OPENBIN_RELEASE_BASE } else { "https://github.com/$repo/releases/latest/download" }
$installDir  = if ($env:OPENBIN_INSTALL_DIR)  { $env:OPENBIN_INSTALL_DIR }  else { Join-Path $env:LOCALAPPDATA 'Programs\openbin' }

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

$asset = "openbin-windows-$arch.zip"
$url   = "$releaseBase/$asset"

# --- download + extract ----------------------------------------------------
$tmp = Join-Path $env:TEMP ("openbin-install-" + [System.Guid]::NewGuid().ToString('N'))
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
  # Zip extracts to openbin-windows-<arch>\openbin.exe — find it wherever it
  # landed so we don't hard-depend on the layout.
  $bin = Get-ChildItem -Path $tmp -Recurse -Filter 'openbin.exe' | Select-Object -First 1
  if (-not $bin) { Die "could not find openbin.exe inside $asset" }

  # --- install -------------------------------------------------------------
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $dest = Join-Path $installDir 'openbin.exe'
  # If an openbin is currently running it holds a lock; ask the user to close it.
  try {
    Copy-Item -Path $bin.FullName -Destination $dest -Force
  } catch {
    Die "could not write $dest (is openbin currently running? close it and retry): $_"
  }
  Info "Installed openbin to $dest"

  try { $ver = & $dest --version 2>$null } catch { $ver = $null }
  if ($ver) { Info $ver } else { Info 'openbin (version unknown)' }

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
  Write-Host 'openbin is installed. Next steps:'
  Write-Host ''
  Write-Host '  openbin login                   # one-time browser sign-in'
  Write-Host '  openbin apk app-release.apk     # decompile an APK locally, upload the result'
  Write-Host '  openbin decompile firmware.exe  # native binary (Ghidra)'
  Write-Host ''
  Write-Host 'The first decompile downloads the worker Docker image (one-time, cached after).'
  Write-Host 'Docker Desktop must be installed and running (WSL 2 backend):'
  Write-Host '  https://www.docker.com/products/docker-desktop/'
  Write-Host 'Questions / sponsorship: husam@openbin.ai'
}
finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
