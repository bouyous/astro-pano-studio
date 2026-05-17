@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0AstroPanoStudio.exe" (
  start "" "%~dp0AstroPanoStudio.exe"
  exit /b
)
powershell -ExecutionPolicy Bypass -File "%~dp0lancer.ps1"
