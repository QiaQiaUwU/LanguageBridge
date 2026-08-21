@echo off
chcp 936 >nul
setlocal

rem ============================================================
rem  一键打包 LanguageBridge 成可以直接发给别人的文件夹
rem
rem  双击这个文件就行，全程不用输命令。
rem  产物在 dist-exe\ 里：exe + 你的词库 + 学习数据 + 一个双击启动器。
rem  把整个 dist-exe 文件夹拷给别人，对方电脑不用装 Node。
rem ============================================================

cd /d "%~dp0"

echo.
echo ==========================================
echo   LanguageBridge  一键打包
echo ==========================================
echo.

rem ---- 1. 检查 Node ----
where node >nul 2>nul
if errorlevel 1 (
  echo [x] 没找到 Node.js。
  echo     打包需要 Node 18 以上，去 https://nodejs.org 装完再双击本文件。
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set NODEV=%%v
echo [1/4] Node 版本 %NODEV%

rem ---- 2. 装依赖（只在缺 node_modules 时装）----
if not exist "node_modules" (
  echo [2/4] 第一次打包，正在安装依赖（几分钟，只有这一次）...
  call npm install
  if errorlevel 1 (
    echo.
    echo [x] 依赖安装失败，看上面的报错。
    pause
    exit /b 1
  )
) else (
  echo [2/4] 依赖已在，跳过安装
)

rem ---- 3. 打包 ----
echo [3/4] 正在构建并打包 exe（第一次会下载 Node 运行时，about 40MB）...
call npm run build:exe
if errorlevel 1 (
  echo.
  echo [x] 打包失败，看上面的报错。
  echo     常见原因：模板结构有错（会指出是哪个文件第几行）、或者网络下不到运行时。
  pause
  exit /b 1
)

rem ---- 4. 收尾 ----
echo [4/4] 完成
echo.
echo ==========================================
echo   打包好了，产物在这里：
echo   %cd%\dist-exe
echo.
echo   里面是：
echo     LanguageBridge.exe        主程序
echo     resources\                你的词库
echo     data\                     学习数据
echo     port.txt                  端口（默认 58712）
echo     双击打开 LanguageBridge.vbs   给别人用的启动器，不弹黑窗
echo.
echo   把整个 dist-exe 文件夹拷给别人即可，对方不用装 Node。
echo ==========================================
echo.

rem 打包完直接把文件夹开出来，省得自己去找
if exist "dist-exe" start "" "dist-exe"

pause

echo.
echo 提示：这条路线用 pkg，需要联网下载 Node 二进制，经常下不到。
echo 打不出来的话，请改用「打包桌面版EXE（含悬浮球）.bat」——
echo 那条走 Electron，产物带桌面悬浮球，也不依赖 pkg。
pause
