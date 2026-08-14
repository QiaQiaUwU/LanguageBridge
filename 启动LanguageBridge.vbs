' LanguageBridge 启动器
' 双击本文件即可启动网站并自动打开浏览器，不会弹出黑色命令行窗口。
' 首次启动如果还没构建过，会短暂弹出一次命令行完成构建，之后都是静默启动。

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)

distIndex = projectDir & "\dist\index.html"

If fso.FileExists(distIndex) Then
  ' 已构建过：完全静默启动
  shell.CurrentDirectory = projectDir
  shell.Run "cmd /c node scripts\server.mjs", 0, False
Else
  ' 首次启动：需要先构建，短暂显示一次窗口
  shell.CurrentDirectory = projectDir
  shell.Run "cmd /c npm install --no-audit --no-fund && node scripts\server.mjs", 1, False
End If
