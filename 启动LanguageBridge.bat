@echo off
chcp 936 >nul
title LanguageBridge - Close this window to stop
cd /d "%~dp0"
echo 提示：以后可以改用 LanguageBridge.vbs（同一个文件夹里）打开，
echo 首次运行会自动在桌面建好图标，日常启动不会再弹出这个黑窗口。
echo.
echo Starting LanguageBridge...
echo (Dependency install / rebuild only happens automatically when something actually changed)
echo.

node scripts\server.mjs
pause
