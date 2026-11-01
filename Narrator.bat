@echo off
setlocal
title Xenoreads Narrator
cd /d "%~dp0narrator"

if not exist service-account.json (
  echo.
  echo  service-account.json is missing.
  echo  Download it from Firebase console ^> Project settings ^> Service accounts ^> Generate new private key,
  echo  rename it to service-account.json and put it in the "narrator" folder next to narrator.py.
  echo.
  pause
  exit /b 1
)

if not exist github-token.txt (
  echo.
  echo  github-token.txt is missing. The narrator publishes audio to your GitHub repo's Releases.
  echo  Create a fine-grained token on GitHub ^(Settings ^> Developer settings ^> Fine-grained tokens^)
  echo  for the xenoreads repository with "Contents: Read and write", then save it in a file
  echo  named github-token.txt in the "narrator" folder.
  echo.
  pause
  exit /b 1
)

if not exist .venv\Scripts\python.exe (
  echo  First run: setting up the narrator. This downloads about 1 GB once and takes a few minutes.
  py -3.12 -m venv .venv 2>nul || py -3.11 -m venv .venv 2>nul
  if not exist .venv\Scripts\python.exe (
    echo.
    echo  Python 3.12 is needed. Install it with this command, then run Narrator.bat again:
    echo      winget install Python.Python.3.12
    echo.
    pause
    exit /b 1
  )
  .venv\Scripts\python -m pip install --upgrade pip
  .venv\Scripts\python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
  .venv\Scripts\python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo  Setup failed. Delete the narrator\.venv folder and run Narrator.bat again.
    pause
    exit /b 1
  )
)

echo.
echo  Xenoreads narrator is running. It picks up anything you queue in the app.
echo  Leave this window open while it works. Close it any time; it resumes where it stopped.
echo.
.venv\Scripts\python narrator.py work --loop --worker pc
pause
