@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 24 (
  echo Node.js 24 or newer is required. Detected major version %NODE_MAJOR%.
  echo Update Node.js, then run this file again.
  pause
  exit /b 1
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo The clinic application is already running. Opening it now...
  start "" "http://127.0.0.1:4173"
  exit /b 0
)

if not exist "node_modules\express\package.json" (
  echo Installing application dependencies...
  where pnpm >nul 2>nul
  if not errorlevel 1 (
    call pnpm install
  ) else (
    call npm install
  )
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "$url='http://127.0.0.1:4173/health'; for($i=0;$i -lt 30;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1 ^| Out-Null; Start-Process 'http://127.0.0.1:4173'; exit}catch{Start-Sleep -Milliseconds 500}}"
echo Starting the Dental Radiology Reporting application...
echo Keep this window open while using the app. Press Ctrl+C to stop it.
node server\index.js

if errorlevel 1 pause
endlocal
