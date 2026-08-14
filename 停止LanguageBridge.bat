@echo off
chcp 65001 >nul
title Stop LanguageBridge
cd /d "%~dp0"

set PORT=58712
if exist port.txt (
  set /p PORT=<port.txt
)

echo Looking for process on port %PORT% ...
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo Found PID %%p, stopping...
  taskkill /PID %%p /F >nul 2>nul
  set FOUND=1
)

if "%FOUND%"=="0" (
  echo No running LanguageBridge service found on port %PORT%.
) else (
  echo Stopped.
)
echo.
echo If you changed the port, check port.txt for the current value.
pause
