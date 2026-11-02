@echo off
title Nightbound server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed, so online hosting through this server is unavailable.
  echo Opening the offline version instead. Install Node.js from https://nodejs.org for LAN play.
  start "" "Nightbound.html"
  pause
  exit /b
)
start "" http://localhost:8090
node server.js 8090
pause
