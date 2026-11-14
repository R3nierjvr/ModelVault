@echo off
rem Stops the ModelVault that runs from this folder (not any other Node.js programs).
rem "Stop ModelVault.cmd /all" also closes its tray icon (setup does this before updating).
set "MV_STOP_TRAY=0"
if /i "%~1"=="/all" set "MV_STOP_TRAY=1"
powershell -NoProfile -Command "$dir = '%~dp0'; if ($env:MV_STOP_TRAY -eq '1') { $tray = Join-Path $dir 'ModelVault.exe'; Get-CimInstance Win32_Process -Filter \"Name='ModelVault.exe'\" | Where-Object { $_.ExecutablePath -eq $tray } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } }; $exe = Join-Path $dir 'runtime\node.exe'; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -like '*Start ModelVault.cmd*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
if "%MV_QUIET%"=="1" exit /b 0
echo ModelVault stopped.
timeout /t 2 >nul
