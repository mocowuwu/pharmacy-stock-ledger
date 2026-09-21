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

# PROCESSOR_ARCHITECTURE is the architecture of *this process*, so it reads
# AMD64 for a 32-bit or emulated shell on an ARM machine; PROCESSOR_ARCHITEW6432
# carries the real one in that case.
$RealArch     = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$IsArmMachine = $RealArch -notin @("AMD64", "x86")

function Say  { param($m) Write-Host "   $m" }
function Die  { param($m) Write-Host ""; Write-Host "Stopped. $m" -ForegroundColor Red; Write-Host ""; exit 1 }

function Find-Node {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    try { $major = [int](& node -p "process.versions.node.split('.')[0]") } catch { return $null }
    if ($major -lt $NodeMajorMin) { return $null }
    # On Windows on ARM the whole stack runs as x64 under emulation (see below).
    # A native ARM Node would install ARM native modules beside an x64 PostgreSQL,
    # which is not the combination that was tested -- fetch an x64 Node instead.
    if ($IsArmMachine) {
        try { $arch = (& node -p "process.arch").Trim() } catch { return $null }
        if ($arch -ne "x64") { return $null }
    }
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

# Windows on ARM runs the x64 build under Windows' own x64 emulation. The
# PostgreSQL binaries this installer fetches are published for x64 only, so the
# whole stack -- Node, PostgreSQL, the app -- is x64 there, and it is what was
# tested on an ARM machine. It is not refused, and needs no opt-in.
#
# This lives here rather than inside Get-Node so that it applies whichever Node
# turns up first; Find-Node skips a native ARM Node for the same reason.
if ($IsArmMachine) {
    Say "Windows on ARM ($env:PROCESSOR_ARCHITECTURE): using the x64 build under Windows' emulation."
}

$NodeBin = Find-Node
if (-not $NodeBin) { $NodeBin = Get-Node -InstallDir $InstallDir }

& $NodeBin (Join-Path $SourceDir "installer\main.mjs") `
    --source $SourceDir --dir $InstallDir @args
exit $LASTEXITCODE
