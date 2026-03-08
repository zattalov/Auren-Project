@echo off
REM ═══════════════════════════════════════════
REM  AUREN — Premiere Pro Extension Installer
REM  Just double-click this file!
REM ═══════════════════════════════════════════

echo.
echo   ╔══════════════════════════════════════╗
echo   ║   AUREN Extension Installer          ║
echo   ╚══════════════════════════════════════╝
echo.
echo   Installing...
echo.

REM Enable unsigned extensions
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1

REM Create symlink
set "SOURCE=%~dp0"
if "%SOURCE:~-1%"=="\" set "SOURCE=%SOURCE:~0,-1%"
set "TARGET=%APPDATA%\Adobe\CEP\extensions\com.auren.premiere.panel"

if exist "%TARGET%" rmdir "%TARGET%" >nul 2>&1
if not exist "%APPDATA%\Adobe\CEP\extensions" mkdir "%APPDATA%\Adobe\CEP\extensions"
mklink /J "%TARGET%" "%SOURCE%" >nul 2>&1

echo   Done! Now:
echo.
echo   1. Restart Premiere Pro
echo   2. Window → Extensions → AUREN Panel
echo.
pause
