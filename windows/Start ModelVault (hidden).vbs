' Starts ModelVault without a window. With ModelVault.exe next to it that's the
' tray icon next to the clock; otherwise ModelVault runs hidden and "Stop ModelVault" stops it.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
bg = False
If WScript.Arguments.Count > 0 Then bg = (LCase(WScript.Arguments(0)) = "/background")
If fso.FileExists(dir & "\ModelVault.exe") Then
  If bg Then
    sh.Run """" & dir & "\ModelVault.exe"" /background", 1, False
  Else
    sh.Run """" & dir & "\ModelVault.exe""", 1, False
  End If
Else
  sh.Environment("Process")("MV_HIDDEN") = "1"
  If bg Then sh.Environment("Process")("MV_BACKGROUND") = "1"
  sh.Run "cmd /c """"" & dir & "\Start ModelVault.cmd""""", 0, False
End If
