Option Explicit
Dim fso, shell, scriptDir, repoRoot, hostScript, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(scriptDir)
hostScript = fso.BuildPath(scriptDir, "local-content-workers-host.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & hostScript & """"
shell.Run command, 0, True
