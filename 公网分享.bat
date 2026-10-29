@echo off
chcp 65001 >nul
title 马戏星探 SCOUT - 免费异网公网穿透
set "PATH=C:\node;%PATH%"

echo ====================================================
echo 🎪 正在为《马戏星探》生成异网公网临时游玩链接...
echo ⏳ 请稍候（第一次需要下载轻量网络转发组件）...
echo ====================================================
echo.

npx --yes localtunnel --port 3000
pause
