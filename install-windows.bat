@echo off
REM Windows installer -- NOT YET BUILT.
REM
REM This file is a placeholder so nobody mistakes the Windows path for finished.
REM Everything the installer does is already written in cross-platform
REM JavaScript under installer\, and PostgreSQL 18 publishes a Windows build, so
REM what is missing is small and specific:
REM
REM   1. installer\service.mjs needs a Windows branch. A user-level scheduled
REM      task via schtasks, or a service via nssm, so the pharmacy comes back
REM      after a power cut.
REM   2. This launcher needs to do what installer\bootstrap.sh does: find Node,
REM      fetch it if missing, then hand over to installer\main.mjs.
REM   3. Packaging into a real .exe, with Inno Setup or NSIS.
REM
REM That work should be done ON Windows, not cross-built from a Mac -- an
REM installer nobody has run is a guess. Run Claude Code inside a Windows VM,
REM point it at this repo, and it can build and test the whole thing properly,
REM taking a snapshot between attempts.
REM
REM Until then, use DEPLOY.md's manual path on Windows, or install on Linux.

echo.
echo   The Windows installer is not built yet.
echo.
echo   Two ways forward:
echo     - Follow the manual steps in DEPLOY.md, which do work on Windows.
echo     - Or build this properly: see the comments inside this file.
echo.
pause
