; ModelVault installer (NSIS). Built by tools/build-windows.sh; installs for the current user, no admin needed.
Unicode true
!ifndef VERSION
  !define VERSION "0.0"
!endif
!ifndef SRC
  !define SRC "ModelVault"
!endif
!ifndef OUTFILE
  !define OUTFILE "ModelVault-Windows-Installer.exe"
!endif
!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "ModelVault"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\ModelVault"
InstallDirRegKey HKCU "Software\ModelVault" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "ModelVault ${VERSION}"
VIProductVersion "${VERSION}.0.0"
VIAddVersionKey "ProductName" "ModelVault"
VIAddVersionKey "FileDescription" "ModelVault setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "V3sper Studios"

Var IsUpdate
Var OldVersion
Var WelcomeTitle
Var WelcomeText

!define MUI_ICON "${SRC}\modelvault.ico"
!define MUI_UNICON "${SRC}\modelvault.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "$WelcomeTitle"
!define MUI_WELCOMEPAGE_TEXT "$WelcomeText"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Start ModelVault now"
!define MUI_FINISHPAGE_RUN_FUNCTION StartNow
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\READ ME FIRST.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Show the read-me"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
; An update keeps the folder and the shortcut choices from the first install, so those pages are skipped.
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipWhenUpdating
!insertmacro MUI_PAGE_DIRECTORY
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipWhenUpdating
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function SkipWhenUpdating
  ${If} $IsUpdate == 1
    Abort
  ${EndIf}
FunctionEnd

; After a silent update (started from ModelVault's Settings > About), start ModelVault again in the background.
Function .onInstSuccess
  IfSilent 0 +2
    Exec '"$INSTDIR\ModelVault.exe" /background'
FunctionEnd

; Stops ModelVault and closes its tray icon, so its files can be replaced.
Function StopRunning
  IfFileExists "$INSTDIR\Stop ModelVault.cmd" 0 +2
    nsExec::Exec '"$SYSDIR\cmd.exe" /c "set MV_QUIET=1&& "$INSTDIR\Stop ModelVault.cmd" /all"'
FunctionEnd
Function un.StopRunning
  IfFileExists "$INSTDIR\Stop ModelVault.cmd" 0 +2
    nsExec::Exec '"$SYSDIR\cmd.exe" /c "set MV_QUIET=1&& "$INSTDIR\Stop ModelVault.cmd" /all"'
FunctionEnd
Function StartNow
  Exec '"$INSTDIR\ModelVault.exe"'
FunctionEnd

Section "ModelVault (required)" SecMain
  SectionIn RO
  Call StopRunning
  SetOutPath "$INSTDIR"
  ; Replace the program; your data lives in %LOCALAPPDATA%\ModelVault and is not touched.
  RMDir /r "$INSTDIR\app"
  File /r "${SRC}\*.*"
  ; Your own settings file, created once and kept across updates.
  CreateDirectory "$LOCALAPPDATA\ModelVault"
  IfFileExists "$LOCALAPPDATA\ModelVault\settings.cmd" +2 0
    CopyFiles /SILENT "$INSTDIR\user-settings.cmd" "$LOCALAPPDATA\ModelVault\settings.cmd"

  CreateDirectory "$SMPROGRAMS\ModelVault"
  CreateShortcut "$SMPROGRAMS\ModelVault\ModelVault.lnk" "$INSTDIR\ModelVault.exe"
  CreateShortcut "$SMPROGRAMS\ModelVault\ModelVault (with log window).lnk" "$INSTDIR\Start ModelVault.cmd" "" "$INSTDIR\modelvault.ico"
  CreateShortcut "$SMPROGRAMS\ModelVault\Stop ModelVault.lnk" "$INSTDIR\Stop ModelVault.cmd" "/all" "$INSTDIR\modelvault.ico"
  CreateShortcut "$SMPROGRAMS\ModelVault\ModelVault settings.lnk" "$WINDIR\notepad.exe" '"$LOCALAPPDATA\ModelVault\settings.cmd"'
  CreateShortcut "$SMPROGRAMS\ModelVault\Uninstall ModelVault.lnk" "$INSTDIR\Uninstall.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\ModelVault" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\ModelVault" "Version" "${VERSION}"
  !define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\ModelVault"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "ModelVault"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "V3sper Studios"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\modelvault.ico"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\ModelVault.lnk" "$INSTDIR\ModelVault.exe"
SectionEnd

Section /o "Start ModelVault when I sign in to Windows" SecStartup
  CreateShortcut "$SMSTARTUP\ModelVault.lnk" "$INSTDIR\ModelVault.exe" "/background"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "The ModelVault program, with its own Node.js and 7-Zip."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "A ModelVault icon on your desktop."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} "Runs ModelVault in the background when you sign in, with its icon next to the clock (it doesn't open the browser then)."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Function .onInit
  StrCpy $IsUpdate 0
  ReadRegStr $0 HKCU "Software\ModelVault" "InstallDir"
  ReadRegStr $OldVersion HKCU "Software\ModelVault" "Version"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\Uninstall.exe"
    StrCpy $IsUpdate 1
    StrCpy $INSTDIR $0
    ; Keep the shortcuts the way they were set up.
    ${IfNot} ${FileExists} "$DESKTOP\ModelVault.lnk"
      SectionSetFlags ${SecDesktop} 0
    ${EndIf}
    ${If} ${FileExists} "$SMSTARTUP\ModelVault.lnk"
      SectionSetFlags ${SecStartup} ${SF_SELECTED}
    ${EndIf}
  ${EndIf}
  ${If} $IsUpdate == 1
    StrCpy $WelcomeTitle "Update ModelVault"
    ${If} $OldVersion != ""
      StrCpy $WelcomeText "This updates ModelVault from version $OldVersion to ${VERSION}.$\r$\n$\r$\nIf ModelVault is running, setup stops it first and starts it again afterwards. Your library, settings, database and shortcuts stay as they are."
    ${Else}
      StrCpy $WelcomeText "This updates ModelVault to version ${VERSION}.$\r$\n$\r$\nIf ModelVault is running, setup stops it first and starts it again afterwards. Your library, settings, database and shortcuts stay as they are."
    ${EndIf}
  ${Else}
    StrCpy $WelcomeTitle "Install ModelVault"
    StrCpy $WelcomeText "This installs ModelVault ${VERSION}: your library for 3D print models, paints, filament, resin and tools.$\r$\n$\r$\nIt runs on this PC and opens in your web browser. No administrator rights are needed."
  ${EndIf}
FunctionEnd


Section "Uninstall"
  Call un.StopRunning
  Delete "$DESKTOP\ModelVault.lnk"
  Delete "$SMSTARTUP\ModelVault.lnk"
  RMDir /r "$SMPROGRAMS\ModelVault"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\bin"
  RMDir /r "$INSTDIR\licenses"
  Delete "$INSTDIR\*.cmd"
  Delete "$INSTDIR\*.vbs"
  Delete "$INSTDIR\*.txt"
  Delete "$INSTDIR\*.ico"
  Delete "$INSTDIR\ModelVault.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ModelVault"
  DeleteRegKey HKCU "Software\ModelVault"
  MessageBox MB_OK|MB_ICONINFORMATION "ModelVault is removed.$\r$\n$\r$\nYour models, database and settings are kept:$\r$\n  $LOCALAPPDATA\ModelVault  (database, thumbnails, settings)$\r$\n  and your library folder.$\r$\nDelete them yourself if you don't need them any more." /SD IDOK
SectionEnd
