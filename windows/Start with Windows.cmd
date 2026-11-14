@echo off
rem Adds (or removes) a shortcut in your Startup folder so ModelVault starts in the background when you sign in.
rem (The tray icon's menu has the same switch: right-click the ModelVault icon next to the clock.)
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ModelVault.lnk"
if exist "%LNK%" (
  del "%LNK%"
  echo ModelVault will no longer start with Windows.
) else (
  powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath = '%~dp0ModelVault.exe'; $s.Arguments = '/background'; $s.WorkingDirectory = '%~dp0'; $s.Save()"
  echo ModelVault will now start in the background when you sign in to Windows.
  echo Run this file again to turn that off.
)
pause
