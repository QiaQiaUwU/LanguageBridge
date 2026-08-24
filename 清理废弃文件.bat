@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   LanguageBridge 清理废弃文件
echo ============================================
echo.
echo 只删过程性文档和多余的启动器，不碰代码、不碰你的数据。
echo data\ resources\ node_modules\ 一律不动。
echo.
echo 会删的东西：
echo.

set COUNT=0

rem ---- 过程性文档：写给自己看的排期笔记和演示话术 ----
rem 这些已经在 .gitignore 里，不会上传；留在本地也只是占地方
call :CHECK "待办与方案.md"
call :CHECK "展示稿.md"
call :CHECK "上传到GitHub.md"
call :CHECK "docs\项目现状说明.md"
call :CHECK "docs\GitHub发布清单.md"
call :CHECK "docs\介绍视频稿.md"
call :CHECK "docs\README-旧版备份.md"
call :CHECK "docs\需求文档-v2.md"

rem ---- 早期版本遗留的启动器 ----
rem 现在能用的是：启动LanguageBridge.bat / 以桌面软件方式启动（含悬浮球）.bat
rem                停止LanguageBridge.bat / 一键打包EXE.bat / 打包桌面版EXE（含悬浮球）.bat
call :CHECK "create_shortcut.bat"
call :CHECK "start_silent.vbs"
call :CHECK "启动LanguageBridge.vbs"
call :CHECK "启动桌面版.bat"

rem ---- 构建缓存标记，删了下次会自动重建 ----
call :CHECK ".lb-build-hash"
call :CHECK ".lb-deps-hash"

echo.
if %COUNT%==0 (
    echo 没有需要清理的文件，目录已经是干净的。
    echo.
    pause
    exit /b 0
)

echo 共 %COUNT% 项。
echo.
echo 保留的：README.md、许可证说明.md、docs\示例单词表.txt、
echo         以及 5 个还在用的 bat/vbs 启动器。
echo.
set /p YES=确定删除？输入 y 回车继续，其它任意键取消：
if /i not "%YES%"=="y" (
    echo 已取消，什么都没删。
    pause
    exit /b 0
)

echo.
call :DEL "待办与方案.md"
call :DEL "展示稿.md"
call :DEL "上传到GitHub.md"
call :DEL "docs\项目现状说明.md"
call :DEL "docs\GitHub发布清单.md"
call :DEL "docs\介绍视频稿.md"
call :DEL "docs\README-旧版备份.md"
call :DEL "docs\需求文档-v2.md"
call :DEL "create_shortcut.bat"
call :DEL "start_silent.vbs"
call :DEL "启动LanguageBridge.vbs"
call :DEL "启动桌面版.bat"
call :DEL ".lb-build-hash"
call :DEL ".lb-deps-hash"

echo.
echo 清理完成。
echo 构建缓存标记删掉了，下次启动会重新编译一次，属正常。
echo.
pause
exit /b 0

:CHECK
if exist "%~1" (
    echo    - %~1
    set /a COUNT+=1
)
exit /b 0

:DEL
if exist "%~1" (
    del /q "%~1" 2>nul
    if exist "%~1" (
        echo    删除失败（可能被占用）：%~1
    ) else (
        echo    已删除：%~1
    )
)
exit /b 0
