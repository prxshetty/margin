@echo off
REM start.bat — simple double-click launcher for Windows
REM Delegates to the PowerShell script so we only maintain one Windows script.

powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
