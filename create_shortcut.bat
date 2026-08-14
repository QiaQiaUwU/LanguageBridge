@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Create Desktop Shortcut for LanguageBridge

echo [1] Script started, folder changed OK.
pause

set "HERE=%~dp0"
set "WDIR=%HERE:~0,-1%"
set "VBS=%HERE%start_silent.vbs"
set "ICON=%HERE%public\icon.ico"
echo [2] HERE = %HERE%
echo [2] VBS  = %VBS%
pause

if not exist "%VBS%" (
  echo [3] start_silent.vbs was NOT found at that path.
  pause
  exit /b 1
)
echo [3] start_silent.vbs WAS found OK.
pause

set "PS1=%TEMP%\lb_create_shortcut_%RANDOM%.ps1"
echo [4] About to write temp ps1 file at: %PS1%
> "%PS1%" echo $q = [char]34
>> "%PS1%" echo $W = New-Object -ComObject WScript.Shell
>> "%PS1%" echo $d = $W.SpecialFolders('Desktop')
>> "%PS1%" echo $s = $W.CreateShortcut((Join-Path $d 'LanguageBridge.lnk'))
>> "%PS1%" echo $s.TargetPath = 'wscript.exe'
>> "%PS1%" echo $s.Arguments = $q + $env:LB_VBS + $q
>> "%PS1%" echo $s.WorkingDirectory = $env:LB_WDIR
>> "%PS1%" echo $s.WindowStyle = 7
>> "%PS1%" echo $s.Description = 'LanguageBridge'
>> "%PS1%" echo if (Test-Path $env:LB_ICON) { $s.IconLocation = $env:LB_ICON }
>> "%PS1%" echo $s.Save()
if exist "%PS1%" (echo [4] Temp ps1 file created OK.) else (echo [4] Temp ps1 file FAILED to be created.)
pause

set "LB_VBS=%VBS%"
set "LB_WDIR=%WDIR%"
set "LB_ICON=%ICON%"
echo [5] About to run PowerShell against that ps1 file...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "RC=%ERRORLEVEL%"
echo [5] PowerShell finished, exit code: %RC%
del "%PS1%" >nul 2>nul
pause

echo.
if "%RC%"=="0" (
  echo [6] Success - a "LanguageBridge" shortcut was created on your Desktop.
) else (
  echo [6] Failed - error code %RC%.
)
pause
