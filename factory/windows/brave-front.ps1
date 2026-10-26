# Brings the Brave window to the front so YouTube Studio's dialogs render (they stay empty while Brave
# sits behind other windows). Used by the Pulse Studio tasks; the owner allowed this on 26 Oct 2026.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BraveWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
$p = Get-Process brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
foreach ($w in $p) { [void][BraveWin]::ShowWindow($w.MainWindowHandle, 9); [void][BraveWin]::SetForegroundWindow($w.MainWindowHandle) }
"brave windows brought forward: " + ($p | Measure-Object).Count
