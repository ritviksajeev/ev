@echo off
rem Windows: first run installs everything, then starts the API and the game
rem in two windows. Open the "Network" URL from the game window on your phone.
cd /d "%~dp0"

if not exist .env (
  copy .env.example .env >nul
  echo Created .env - paste your Gemini key and model, save, and close Notepad to continue.
  start "" /wait notepad .env
)

if not exist backend\.venv\Scripts\python.exe (
  echo Creating the Python environment...
  py -3.11 -m venv backend\.venv 2>nul || python -m venv backend\.venv
  if errorlevel 1 (
    echo Python 3.11+ not found. Install it with:  winget install Python.Python.3.11
    exit /b 1
  )
  backend\.venv\Scripts\python -m pip install -r backend\requirements-dev.txt || exit /b 1
)

if not exist frontend\node_modules (
  echo Installing the game's packages...
  pushd frontend
  call npm install || (popd & exit /b 1)
  popd
)

start "Sketch Fighter API" cmd /k backend\.venv\Scripts\python backend\app.py
start "Sketch Fighter game" cmd /k "cd frontend && npm run dev"
