@echo off
REM  Pharmacy Stock Ledger -- Windows installer.
REM
REM  Double-click this file. It installs into %USERPROFILE%\pharmacy, brings its
REM  own PostgreSQL and its own Node, and touches nothing else on the machine.
REM  Uninstalling is deleting that folder.
REM
REM  One administrator prompt appears part-way through. Click Yes. It buys two
REM  things and nothing else: the firewall rule that lets the till reach this
REM  machine at all, and the boot task that reopens the pharmacy after a power
REM  cut. Clicking No still finishes the install and prints what to do by hand.
REM
REM  The real work is in installer\, in the same cross-platform JavaScript the
REM  macOS and Linux installers run. This file only finds PowerShell.

setlocal

REM  `pushd`, not `cd /d`. cmd.exe cannot hold a UNC path as its working
REM  directory, and this is launched from one more often than you would think --
REM  a Parallels or VMware shared folder is \\Mac\Home\..., and a folder on a
REM  NAS is the same shape. `cd /d` there prints an error and silently leaves
REM  the session in C:\Windows; `pushd` maps the UNC path to a temporary drive
REM  letter and works. `popd` at the end releases it.
pushd "%~dp0"

REM  Check Windows OS version before launching PowerShell.
REM  Windows 7 (6.1), Windows 8 (6.2), and Windows 8.1 (6.3) cannot run Node 20+
REM  or PostgreSQL 18 natively.
ver | findstr /i " 5. 6.0. 6.1. 6.2. 6.3." > nul
if %ERRORLEVEL% equ 0 (
  echo.
  echo   ========================================================================
  echo   Windows 7 / 8 detected:
  echo.
  echo   Next.js 16 and PostgreSQL 18 require Windows 10 or newer to run natively.
  echo   Node 20+ cannot execute directly on Windows 7.
  echo.
  echo   To run the pharmacy on this machine without upgrading or wiping Windows:
  echo   Please read WINDOWS-7.md to set up the lightweight VirtualBox server.
  echo   ========================================================================
  echo.
  pause
  popd
  exit /b 1
)

echo.
echo   Pharmacy Stock Ledger -- installing
echo.

REM  -ExecutionPolicy Bypass applies to this one invocation only; it does not
REM  change the machine's policy. Without it the default policy on a fresh
REM  Windows refuses to run the script at all.
REM  "%CD%", not "%~dp0". After the pushd above, %CD% is the temporary drive
REM  letter -- so PowerShell and Node see Z:\installer\... and never a UNC path.
REM  %~dp0 would hand the raw \\Mac\Home\... path straight back to them.
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\installer\bootstrap.ps1" %*
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% NEQ 0 (
  echo.
  echo   The install did not finish. The reason is above.
  echo.
)

REM  Double-clicked, this window closes the instant the script ends and takes
REM  the owner's one-time password with it. Wait for a keypress instead.
pause
popd
exit /b %EXITCODE%
