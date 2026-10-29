@echo off
chcp 65001 >nul
title 一键同步更新到云端服务器
set "PATH=C:\node;C:\Program Files\Git\cmd;%PATH%"

echo ====================================================
echo 🎪 正在将本地最新代码推送到 GitHub 并自动部署到云端...
echo ====================================================
echo.

git add .
set /p commit_msg="请输入本次更新说明（直接按回车默认为‘版本更新’）："
if "%commit_msg%"=="" set commit_msg=版本更新

git commit -m "%commit_msg%"
git push origin main

echo.
echo ====================================================
echo ✅ 代码已成功推送！
echo 🚀 Render 云端服务器正在自动重新打包上线（约需 1 分钟）...
echo 🌐 稍后直接刷新你的线上地址即可看到最新版本：
echo    https://scout-game-i4wj.onrender.com
echo ====================================================
pause
