Option Explicit

Dim shell
Dim command
Dim index

If WScript.Arguments.Count < 1 Then
    WScript.Quit 2
End If

Set shell = CreateObject("WScript.Shell")

command = "powershell.exe -NoProfile -WindowStyle Hidden -NonInteractive -ExecutionPolicy Bypass -File " & QuoteArgument(WScript.Arguments(0))

For index = 1 To WScript.Arguments.Count - 1
    command = command & " " & QuoteArgument(WScript.Arguments(index))
Next

shell.Run command, 0, False

Function QuoteArgument(value)
    QuoteArgument = """" & Replace(CStr(value), """", """""") & """"
End Function
