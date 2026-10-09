@echo off
setlocal
start "Barber Queue Backend" cmd /k "cd /d %~dp0backend && npm install && npm run dev"
start "Barber Queue Frontend" cmd /k "cd /d %~dp0frontend && npm install && npm run dev"
