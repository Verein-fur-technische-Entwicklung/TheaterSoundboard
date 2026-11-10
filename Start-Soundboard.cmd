@echo off
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-windows.ps1"
if errorlevel 1 pause
