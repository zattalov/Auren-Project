@echo off
echo Starting AUREN Backend...
start "AUREN Backend" cmd /k "cd /d "%~dp0" && title AUREN Backend && npm start"

echo Starting AUREN Frontend...
start "AUREN Frontend" cmd /k "cd /d "%~dp0\AUREN-frontend" && title AUREN Frontend && npm run dev"

echo AUREN Services Started!
exit
