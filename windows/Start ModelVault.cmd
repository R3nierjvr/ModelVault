@echo off
setlocal
title ModelVault
cd /d "%~dp0"
call "%~dp0settings.cmd"
if exist "%LOCALAPPDATA%\ModelVault\settings.cmd" call "%LOCALAPPDATA%\ModelVault\settings.cmd"
if "%MV_BACKGROUND%"=="1" set "OPEN_BROWSER=0"
set "PATH=%~dp0bin;%SystemRoot%\System32;%PATH%"
set "NODE_ENV=production"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

rem Running without a window (the tray icon, or "Start ModelVault (hidden).vbs"): keep what ModelVault
rem prints in data\logs\ModelVault.log. The tray icon's "View log" opens it.
if "%MV_HIDDEN%"=="1" (
  set "MV_LOG_TIMES=1"
  set "MV_LOGFILE=%DATA_DIR%\logs\ModelVault.log"
  if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"
)

rem Already running? Then just open it.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:%PORT%/api/ping | Out-Null; exit 0 } catch { if ($_.Exception.Response) { exit 0 } else { exit 1 } }" >nul 2>&1
if %ERRORLEVEL%==0 (
  if not "%OPEN_BROWSER%"=="0" start "" http://localhost:%PORT%
  exit /b 0
)

echo.
echo   ModelVault is starting...
echo   Open http://localhost:%PORT% in your browser.
echo   Keep this window open while you use ModelVault. Close it to stop ModelVault.
echo.

if not "%OPEN_BROWSER%"=="0" start "" /b cmd /c "ping -n 5 127.0.0.1 >nul & start "" http://localhost:%PORT%"

:run
if defined MV_LOGFILE (
  call :rotate
  >>"%MV_LOGFILE%" echo.
  >>"%MV_LOGFILE%" echo ===== ModelVault starting, %DATE% %TIME% =====
  "%~dp0runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0app\server\index.js" >>"%MV_LOGFILE%" 2>&1
) else (
  "%~dp0runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0app\server\index.js"
)
set "CODE=%ERRORLEVEL%"
rem Exit code 0 means ModelVault restarted itself (after an update or a folder change): start it again.
if "%CODE%"=="0" (
  echo.
  echo   Restarting ModelVault...
  ping -n 3 127.0.0.1 >nul
  goto run
)
if defined MV_LOGFILE echo ===== ModelVault stopped, code %CODE%, %DATE% %TIME% =====>>"%MV_LOGFILE%"
echo.
echo   ModelVault stopped (code %CODE%). If this was unexpected, the lines above say why.
if not "%MV_HIDDEN%"=="1" pause
exit /b %CODE%

rem Keeps the log small: over 2 MB, it becomes ModelVault-previous.log and a new one starts.
:rotate
if not exist "%MV_LOGFILE%" exit /b 0
for %%A in ("%MV_LOGFILE%") do if %%~zA GTR 2000000 move /y "%MV_LOGFILE%" "%DATA_DIR%\logs\ModelVault-previous.log" >nul
exit /b 0
