@echo off
cd /d "%~dp0"
set PYTHONUTF8=1
start "Herb Inventory" python app.py
timeout /t 2 /nobreak > nul
start "" "http://localhost:5000"
