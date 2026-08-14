' Silently start LanguageBridge: does exactly what "启动LanguageBridge.bat" does
' (installs dependencies if needed, rebuilds if needed, opens the browser automatically),
' the only difference is it doesn't pop up a black console window taking up screen space —
' the server runs in the background, just double-click this file, no risk of accidentally
' closing that window and killing the service.
'
' To stop the service, still use "停止LanguageBridge.bat" — it finds and kills the process
' by port number, unrelated to whether it was started silently; both start methods use
' the same stop script.
'
' Want a desktop icon: run "create_shortcut.bat" in this same folder, it will create a
' real shortcut icon on your desktop — click that from now on, no need to open this folder.

Dim fso, shell, scriptDir
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = scriptDir
shell.Run "cmd /c """ & scriptDir & "\启动LanguageBridge.bat""", 0, False
