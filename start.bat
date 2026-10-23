@echo off
rem Runs Readout locally for development (the real app lives on Vercel).
rem Needs Node.js 22+ and a .env.local file (see .env.example).
title Readout (development)
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:4317
node server\local.js
