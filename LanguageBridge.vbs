' LanguageBridge 启动器
' 双击这个文件（或者双击桌面上的 LanguageBridge 图标）即可打开。
'
' 首次运行时会自动在桌面创建一个"LanguageBridge"图标，之后请从桌面图标打开，
' 不需要再进这个文件夹点任何东西。
'
' 窗口显示逻辑：LanguageBridge 服务本身是常驻运行的（关掉窗口/进程，服务就停），
' 所以窗口不会自动消失——但日常启动时这个窗口会保持隐藏，不会挡在眼前。
' 只有第一次启动、或者装了新依赖/改了代码需要重新安装构建时（这一步可能要几十秒
' 到几分钟），才会短暂显示一个窗口，让你能看到真实进度、确认不是卡死了；
' 这种情况下装/建完之后窗口不会自动隐藏，需要你自己手动最小化即可，服务继续运行
' 不受影响。停止服务：双击"停止LanguageBridge.bat"，或者直接在任务管理器里
' 结束 node.exe 进程。

Dim fso, shell, scriptDir, desktopPath, shortcutPath

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = scriptDir

' ===== 首次运行：自动在桌面建一个快捷方式，之后不用再管这个文件夹 =====
desktopPath = shell.SpecialFolders("Desktop")
shortcutPath = desktopPath & "\LanguageBridge.lnk"

If Not fso.FileExists(shortcutPath) Then
  Dim link
  Set link = shell.CreateShortcut(shortcutPath)
  link.TargetPath = "wscript.exe"
  link.Arguments = """" & WScript.ScriptFullName & """"
  link.WorkingDirectory = scriptDir
  link.WindowStyle = 7
  link.Description = "LanguageBridge"
  If fso.FileExists(scriptDir & "\public\icon.ico") Then
    link.IconLocation = scriptDir & "\public\icon.ico"
  End If
  link.Save
End If

' ===== 判断这次是否需要装依赖/构建：需要的话显示窗口，不需要就静默 =====
' 判断逻辑跟 scripts/server.mjs 里 ensureDepsInstalled/ensureBuilt 的判断依据完全一致
' （同样是对 package.json+lock 和全部源码算哈希、对比上次记录的哈希文件），
' 这里在 VBS 层面重复一次同样的检查，只是为了决定"要不要弹窗口"，
' 真正的安装/构建动作还是由 server.mjs 自己去做。
Dim needsVisibleWindow
needsVisibleWindow = False

If Not fso.FolderExists(scriptDir & "\node_modules") Then
  needsVisibleWindow = True
ElseIf Not fso.FileExists(scriptDir & "\dist\index.html") Then
  needsVisibleWindow = True
ElseIf Not fso.FileExists(scriptDir & "\.lb-deps-hash") Then
  needsVisibleWindow = True
ElseIf Not fso.FileExists(scriptDir & "\.lb-build-hash") Then
  needsVisibleWindow = True
End If

If needsVisibleWindow Then
  ' 第一次启动 / 需要重新安装或构建：显示窗口，让用户看到真实进度，避免误以为卡死
  shell.Run "cmd /c """ & scriptDir & "\scripts\run.bat""", 1, False
Else
  ' 日常启动：一切都已就绪，静默在后台跑，不弹任何窗口
  shell.Run "cmd /c """ & scriptDir & "\scripts\run.bat""", 0, False
End If
