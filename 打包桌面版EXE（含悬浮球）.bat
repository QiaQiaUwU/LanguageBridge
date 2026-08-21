@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo   打包桌面版 EXE（含悬浮球）
echo ==========================================
echo.
echo 打出来的是一个独立 exe，可以直接发给别人。
echo 第一次跑要下载 Electron 运行时，需要几分钟。
echo.

if not exist node_modules (
  echo [1/3] 安装依赖...
  call npm install
  if errorlevel 1 goto fail
) else (
  echo [1/3] 依赖已装好，跳过
)

echo [2/3] 构建前端...
call npm run build
if errorlevel 1 goto fail

echo [3/3] 打包 EXE...
call npm run app:build
if errorlevel 1 goto fail

echo.
echo 打包完成，文件在 dist-desktop 目录里。
start "" "dist-desktop"
goto end

:fail
echo.
echo [x] 失败了，把上面的红字截图发给我。
echo     常见原因：网络装不上依赖、或者杀毒软件拦了 Electron 下载。

:end
pause
