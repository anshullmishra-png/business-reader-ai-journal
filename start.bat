@echo off
setlocal
title Business Reads Journal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Install the LTS version from https://nodejs.org, then double-click start.bat again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo   First launch: installing dependencies. This takes a minute...
  echo.
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo   npm install failed. Check your internet connection and try again.
    echo.
    pause
    exit /b 1
  )
)

node server\index.js --open %*
if errorlevel 1 (
  echo.
  echo   The server stopped with an error. See the messages above.
  echo.
  pause
)
endlocal
