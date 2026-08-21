@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo   LanguageBridge  桌面版
echo ==========================================
echo.
echo 第一次运行会安装 Electron（约 100MB），需要几分钟。
echo 之后再启动就很快了。
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js，请先安装：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo 正在安装 Electron...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 安装失败，看看上面的报错。
    pause
    exit /b 1
  )
)

echo 正在启动桌面版...
call npx electron electron/main.cjs

pause
