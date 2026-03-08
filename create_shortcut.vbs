Set oWS = WScript.CreateObject("WScript.Shell")

sLinkFile = oWS.SpecialFolders("Desktop") & "\AUREN Desktop App.lnk"

Set oLink = oWS.CreateShortcut(sLinkFile)

' We now run npm start which triggers Electron
oLink.TargetPath = "cmd.exe"
oLink.Arguments = "/c ""cd /d \""c:\Users\AJMN\Desktop\AUREN backend\"" && npm start"""
oLink.WorkingDirectory = "c:\Users\AJMN\Desktop\AUREN backend"
' Using shell32.dll index 215 for a power button icon
oLink.IconLocation = "shell32.dll, 215"
oLink.Description = "Launch AUREN Desktop Application"
oLink.WindowStyle = 7 ' Run minimized so the cmd window doesn't bother the user

oLink.Save

WScript.Echo "Shortcut created on your Desktop as 'AUREN Desktop App'"
