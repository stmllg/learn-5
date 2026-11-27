@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0download_engine.ps1"
if errorlevel 1 (echo Download failed. Please send a screenshot.) else (echo Done.)
pause
