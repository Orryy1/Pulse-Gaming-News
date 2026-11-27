# Brings the Brave window to the front so YouTube Studio's dialogs render (they stay empty while Brave
# sits behind other windows). Used by the Pulse Studio tasks; the owner allowed this on 26 Oct 2026.
# When Brave is not running at all (the owner closes it to save memory, 28 Oct 2026), it is started in the
# background with no window, so the Claude extension connects; the routine then opens its own window and
# closes it when done, leaving no blank window behind.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BraveWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
if (-not (Get-Process brave -ErrorAction SilentlyContinue)) {
  $exe = @(
    "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
    "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($exe) {
    Start-Process $exe -ArgumentList '--no-startup-window'
    Start-Sleep 15  # time for the profile and the Claude extension to load
    "brave started in the background"
  } else {
    "brave not found"
  }
}
$p = Get-Process brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
foreach ($w in $p) { [void][BraveWin]::ShowWindow($w.MainWindowHandle, 9); [void][BraveWin]::SetForegroundWindow($w.MainWindowHandle) }
"brave windows brought forward: " + ($p | Measure-Object).Count
