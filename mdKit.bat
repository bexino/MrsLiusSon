@echo off
chcp 65001 >nul
title Markdown 工具箱 v2.1.0

if not exist "%~dp0dist\mdKit.exe" (
    echo [错误] 未找到 dist\mdKit.exe
    echo 请先在工具目录执行: npm install  然后  npm run build
    pause
    exit /b 1
)

"%~dp0dist\mdKit.exe" %*

rem 运行结束/出错时 exe 自己会停住窗口（按回车键退出），无需再 pause
