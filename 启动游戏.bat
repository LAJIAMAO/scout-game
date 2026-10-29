@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "GAME_NODE=node"
if exist "%~dp0runtime\node.exe" set "GAME_NODE=%~dp0runtime\node.exe"
"%GAME_NODE%" -e "if(Number(process.versions.node.split('.')[0])!==24)process.exit(1)"
if errorlevel 1 (
  echo 请先安装 Node.js 24，再重新启动。
  pause
  exit /b 1
)
if not exist "%~dp0node_modules\express\package.json" (
  echo 请先在此目录运行 npm ci 安装依赖。
  pause
  exit /b 1
)
set "SCOUT_OPEN=1"
"%GAME_NODE%" "%~dp0server.js"
pause
