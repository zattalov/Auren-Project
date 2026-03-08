On Error Resume Next
Set ae = CreateObject("AfterEffects.Application")
If Err.Number <> 0 Then
    WScript.StdErr.Write "ERROR: Could not connect to After Effects: " & Err.Description
    WScript.Quit 1
End If

ae.DoScriptFile "C:\\Users\\AJMN\\Desktop\\AUREN backend\\scripts\\test_script.jsx"
If Err.Number <> 0 Then
    WScript.StdErr.Write "ERROR: Script execution failed: " & Err.Description
    WScript.Quit 1
End If

WScript.StdOut.Write "Script executed successfully"
WScript.Quit 0
