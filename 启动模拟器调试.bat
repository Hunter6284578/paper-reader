@echo off
chcp 65001 >nul 2>&1
title 论文阅读器 - 安卓模拟器调试

echo ========================================
echo   论文阅读器 - 安卓模拟器调试工具
echo ========================================
echo.

set JAVA_HOME=D:\dev-tools\jdk21
set ANDROID_HOME=D:\dev-tools\android-sdk
set ANDROID_SDK_ROOT=D:\dev-tools\android-sdk
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%

REM 检查模拟器是否已运行
adb devices 2>nul | findstr "emulator-5554" >nul
if %errorlevel%==0 (
    echo [√] 模拟器已在运行
) else (
    echo [...] 正在启动模拟器...
    start "" "D:\dev-tools\android-sdk\emulator\emulator.exe" -avd paper-reader-test -gpu auto -netdelay none -netspeed full
    echo [...] 等待模拟器启动...
    timeout /t 30 /nobreak >nul
)

echo.
echo [...] 安装最新 APK...
adb install -r "D:\论文阅读器\client\android\app\build\outputs\apk\debug\app-debug.apk"

echo.
echo [...] 启动应用...
adb shell am start -n com.paperreader.app/.MainActivity

echo.
echo ========================================
echo   完成! 应用已在模拟器中启动
echo.
echo   调试 WebView:
echo   1. 打开 Chrome 浏览器
echo   2. 地址栏输入: chrome://inspect
echo   3. 点击 "inspect" 链接
echo.
echo   查看日志:
echo   adb logcat | findstr paperreader
echo ========================================
echo.
pause
