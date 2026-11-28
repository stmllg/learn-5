@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare_manifest.ps1"
if errorlevel 1 echo FAILED - do not upload yet.
pause
