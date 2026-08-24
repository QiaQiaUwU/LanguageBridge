@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

rem ============================================================
rem  下载源。
rem
rem  electron-builder 要下 Electron 运行时（约 100MB）和 winCodeSign
rem  这两样，默认从 github.com 拉 —— 国内十有八九卡住或超时，
rem  报的却是含糊的"依赖下载失败"，很容易以为是自己网络的问题。
rem  这里指到淘宝镜像，不用梯子也能下。
rem
rem  想用原始源就把下面四行注释掉（行首加 rem）。
rem ============================================================
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
set npm_config_registry=https://registry.npmmirror.com
set ELECTRON_CACHE=%LOCALAPPDATA%\electron\Cache

echo.
echo ==========================================
echo   打包桌面版 EXE（含悬浮球）
echo ==========================================
echo.
echo 打出来的是一个独立 exe，可以直接发给别人。
echo 下载源已指向国内镜像，不需要梯子。
echo.
echo   [1/3] 安装依赖      第一次几分钟，之后跳过
echo   [2/3] 构建前端      约 1 分钟
echo   [3/3] 打包 EXE      第一次要下 Electron 运行时（约 100MB）
echo.

echo ============ [1/3] 依赖 ============
if not exist node_modules (
  echo 第一次运行，正在安装依赖，请耐心等待...
  call npm install
  if errorlevel 1 goto failDeps
) else (
  echo 依赖已装好，跳过。
)

echo.
echo ============ [2/3] 构建前端 ============
call npm run build
if errorlevel 1 goto fail

echo.
echo ============ [3/3] 打包 EXE ============
echo 有进度条，按产物体积估算。第一次打包没有参考值，进度偏虚，跑完会记下来。
echo 下载 Electron 运行时那一段的进度条是 electron-builder 自己打的。
echo.
call npm run app:build
if errorlevel 1 goto failPack

echo.
echo ==========================================
echo   打包完成
echo ==========================================
echo.
echo 产物：dist-desktop\LanguageBridge-桌面版.exe
echo 这一个文件就能发给别人，双击运行。
echo.
echo 注意 dist-desktop\win-unpacked\ 是中间产物，不用管、也不要单独发。
echo.
if exist "dist-desktop\LanguageBridge-桌面版.exe" (
  for %%F in ("dist-desktop\LanguageBridge-桌面版.exe") do echo 文件大小：%%~zF 字节
  echo.
  choice /c YN /n /m "打开所在文件夹？[Y/N] "
  if not errorlevel 2 explorer "dist-desktop"
)
goto end

:failDeps
echo.
echo [失败] 依赖没装上。
echo 多半是网络问题。这个脚本已经把 npm 源指到国内镜像了，
echo 如果还是不行，手动跑一次看具体报错：npm install
goto end

:failPack
echo.
echo [失败] 打包没完成。
echo 最常见的原因是 Electron 运行时下载不下来。已经设了淘宝镜像，
echo 若仍失败，可以手动下载后放进缓存目录：
echo   %%LOCALAPPDATA%%\electron\Cache
echo 或者挂代理再跑一次。
goto end

:fail
echo.
echo [失败] 前面某一步出错了，往上翻看具体报错。

:end
echo.
pause
