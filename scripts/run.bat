@echo off
chcp 65001 >nul
title LanguageBridge - 首次准备中，请稍候（可以手动最小化这个窗口，关闭则会停止服务）
cd /d "%~dp0.."
echo 正在准备 LanguageBridge，第一次启动可能需要几十秒到几分钟...
echo 准备完成后网页会自动打开，这个窗口可以手动最小化（不要关闭，关闭会停止服务）
echo 之后的日常启动会在几秒内完成，且不会再看到这个窗口
echo.
node scripts\server.mjs
