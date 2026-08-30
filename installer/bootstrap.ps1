# Shared bootstrap for Windows, invoked by install-windows.bat.
#
# The counterpart of bootstrap.sh, and it has the same single job: make sure a
# usable Node exists, then hand over to installer\main.mjs, which is the same
# cross-platform JavaScript every platform runs.
#
# PowerShell rather than batch because this has to download and unzip a file,
# and batch has no way to do either without inventing one.
#
# Nothing here is installed system-wide. A Node fetched by this script lives
# inside the pharmacy folder and is deleted with it.

$ErrorActionPreference = "Stop"

$NodeMajorMin = 20
$NodeVersion  = "v22.20.0"

function Say  { param($m) Write-Host "   $m" }
function Die  { param($m) Write-Host ""; Write-Host "Stopped. $m" -ForegroundColor Red; Write-Host ""; exit 1 }

function Find-Node {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    try { $major = [int](& node -p "process.versions.node.split('.')[0]") } catch { return $null }
    if ($major -lt $NodeMajorMin) { return $null }
    return $command.Source
}

function Get-Node {
    param($InstallDir)

    $name    = "node-$NodeVersion-win-x64"
    $url     = "https://nodejs.org/dist/$NodeVersion/$name.zip"
    $runtime = Join-Path $InstallDir "runtime"

    Say "Node is not installed, or is too old. Fetching one for the pharmacy."
    Say "It goes in $runtime and is removed when you uninstall."
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null

    $archive = Join-Path $runtime "$name.zip"
    try {
        # Windows PowerShell 5 negotiates TLS 1.0 by default, which nodejs.org
        # refuses. The download fails as "could not create SSL/TLS channel",
        # which names everything except the reason.
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $ProgressPreference = "SilentlyContinue"   # the progress bar makes this ~10x slower
        Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
    } catch {
        Die "could not download Node from $url`n`nInstall Node 22 from https://nodejs.org and run this again."
    }

    Expand-Archive -Path $archive -DestinationPath $runtime -Force
    Remove-Item $archive -Force

    $node = Join-Path $runtime "$name\node.exe"
    if (-not (Test-Path $node)) { Die "the downloaded Node does not run" }

    $env:PATH = "$(Split-Path $node);$env:PATH"
    Say "Node $NodeVersion ready."
    return $node
}

# installer\bootstrap.ps1 -> the repo root is its parent's parent.
$SourceDir  = Split-Path -Parent $PSScriptRoot
$InstallDir = if ($env:PHARMACY_DIR) { $env:PHARMACY_DIR } else { Join-Path $env:USERPROFILE "pharmacy" }
# The install directory must be on a real local disk, and this is not a
# preference. Two things break on a shared or network folder, both silently:
#
#   - PostgreSQL's data directory needs fsync and locking semantics a shared
#     filesystem does not provide. That is a corruption risk, not a slow build.
#   - The boot task runs as SYSTEM, and SYSTEM has no access to a per-user
#     mapped drive or a \\Mac\Home UNC path. The pharmacy would install
#     perfectly and then never come back from a power cut.
#
# Running the installer *from* a shared folder is fine -- the source is only
# read, and copied onto C:. It is the destination that has to be local.
if ($InstallDir -like "\\*") {
    Die "the pharmacy cannot be installed onto a network or shared folder:`n  $InstallDir`n`nInstall onto this machine's own disk instead:`n  set PHARMACY_DIR=C:\pharmacy"
}
$drive = Get-PSDrive -Name ($InstallDir.Substring(0,1)) -ErrorAction SilentlyContinue
if ($drive -and $drive.DisplayRoot -like "\\*") {
    Die "$($drive.Name): is a mapped network drive ($($drive.DisplayRoot)), which cannot hold the database.`n`nInstall onto this machine's own disk instead:`n  set PHARMACY_DIR=C:\pharmacy"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# The PostgreSQL binaries this installer fetches are published for x64 only, so
# an ARM machine cannot be quietly half-supported.
#
# This check belongs here, not inside Get-Node where it used to live. Find-Node
# runs first, so on an ARM machine that happened to have Node installed the
# refusal never fired at all -- the install went straight on to fetch a
# PostgreSQL that does not exist for it. A guard that only guards the path
# nobody took is not a guard.
#
# Windows 11 on ARM does emulate x64, and the whole stack was in fact first
# proven that way; but emulated is not what a pharmacy should be running on
# unknowingly, and nobody has tested it under load. Refuse, and say what it is.
if ($env:PROCESSOR_ARCHITECTURE -notin @("AMD64", "x86")) {
    Die ("unsupported processor: $env:PROCESSOR_ARCHITECTURE. This needs a 64-bit Intel or`n" +
         "AMD machine -- the PostgreSQL build the pharmacy uses is published for those only.")
}

$NodeBin = Find-Node
if (-not $NodeBin) { $NodeBin = Get-Node -InstallDir $InstallDir }

& $NodeBin (Join-Path $SourceDir "installer\main.mjs") `
    --source $SourceDir --dir $InstallDir @args
exit $LASTEXITCODE
