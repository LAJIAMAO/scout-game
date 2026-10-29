@echo off
chcp 65001 >nul
title 马戏星探 SCOUT 联机服务器
set "PATH=C:\node;%PATH%"

echo ====================================================
echo 🎪 正在启动《马戏星探》(SCOUT) 联机服务器...
echo 📡 本地访问地址: http://localhost:3000
echo 💡 手机/其他电脑局域网访问: http://[你的电脑IP]:3000
echo ====================================================
node server.js
pause
