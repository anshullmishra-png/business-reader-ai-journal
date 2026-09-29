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

rem BRJ_LAUNCHER lets the app restart itself (exit code 75) after restoring a backup.
set BRJ_LAUNCHER=1
set BRJ_OPEN=--open
:run
node server\index.js %BRJ_OPEN% %*
if %errorlevel%==75 (
  echo.
  echo   Restarting to finish restoring your backup...
  set BRJ_OPEN=
  goto run
)
if errorlevel 1 (
  echo.
  echo   The server stopped with an error. See the messages above.
  echo.
  pause
)
endlocal
