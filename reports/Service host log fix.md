# Service host log fix (11 Nov 2026)

## What went wrong

On 7 Nov the PC's picture checker (the PulseGaming-Ollama service) crashed and stayed down. The small
program that runs it (`pulse-service-host.exe`) tried to open its log files in `D:\pulse-data\logs`, the
service's own account was not allowed to write there, and the program gave up and took the service with
it. Its error log had also grown to 336 MB because nothing ever trimmed it.

## What the new version does

- If it cannot write its logs in `D:\pulse-data\logs`, it writes them in the service account's own temp
  folder instead, then in its local app data folder, and if none of those work it runs with no log file.
  A log problem can no longer stop the service. The first line of the fallback log says why it moved.
- Each log file is rolled over at 20 MB and only three old copies are kept (`.log.1` is the newest), so
  a log can never grow past about 80 MB again. The existing 336 MB file is renamed to `.log.1` the first
  time the new version starts, and drops off after three more rollovers (or delete it by hand).
- If the service account cannot write `D:\pulse-data\temp`, the program it runs gets the account's own
  temp folder instead, for the same reason.
- Nothing else changes: same settings, same Ollama, VoxCPM and ASR behaviour.

Tested on the PC: built with the repo's own build script, its tests pass, and trial runs proved the
temp fallback, the second fallback, the 20 MB rollover (sizes shrunk to 1 MB for the test) and that only
three old files are kept.

## Where it is

- New (not yet in use): `D:\pulse-tools\pulse-service-host\f309064902158dbfea0074fd5c66c67d70db5862\pulse-service-host.exe`
  (build receipt beside it; SHA-256 `1b34d675e952e920f91d6b9bd3ee9c6d7245f520087ecb8bf558e8207119ef52`).
- Old (still running all three services): `D:\pulse-tools\pulse-service-host\bacb7f0d69c37d3c66db6add6f2e5a7ff00b9a7d\pulse-service-host.exe`.
  It was left untouched.
- Source: branch `claude/service-host-log-fix`, commit `f30906490`, built on top of the running version's
  commit `bacb7f0d6`. It is committed on the PC only, not pushed: that line of history (822 commits from
  the Codex recovery work) has never been on GitHub, and the GitHub repo is public. Pushing it would
  publish all of it. Decide that separately.

## How to swap it in (admin, on the PC)

Do this after the orchestrator's permissions fix for `D:\pulse-data\logs` and `D:\pulse-data\temp` has been
run, at a quiet moment: restarting a service cuts off anything using it at that second (picture checks
for Ollama, Liam's voice for VoxCPM, speech timing for ASR).

1. On the PC, open PowerShell as administrator.
2. Check nothing heavy is mid-run: `C:\Claude\orchestrator\orch.cmd status`.
3. Paste this. It points each service at the new file and restarts it, one at a time. It edits only the
   program path inside each service's start command, so every other setting stays exactly as it is.

```powershell
$old = 'D:\pulse-tools\pulse-service-host\bacb7f0d69c37d3c66db6add6f2e5a7ff00b9a7d\pulse-service-host.exe'
$new = 'D:\pulse-tools\pulse-service-host\f309064902158dbfea0074fd5c66c67d70db5862\pulse-service-host.exe'
if (-not (Test-Path -LiteralPath $new)) { throw 'new service host missing' }
foreach ($svc in 'PulseGaming-Ollama', 'PulseGaming-VoxCPM', 'PulseGaming-ASR') {
    $key = "HKLM:\SYSTEM\CurrentControlSet\Services\$svc"
    $path = (Get-ItemProperty -LiteralPath $key).ImagePath
    if ($path -notlike "*$old*") { Write-Warning "$svc does not use the old host, left alone"; continue }
    Set-ItemProperty -LiteralPath $key -Name ImagePath -Value $path.Replace($old, $new)
    Restart-Service -Name $svc -Force
    Start-Sleep -Seconds 5
    Get-Service -Name $svc | Format-Table -AutoSize Name, Status
}
```

4. Check the picture checker answers: `Invoke-RestMethod http://127.0.0.1:11434/api/tags` should list the
   models. New log files appear in `D:\pulse-data\logs` (or, if the permissions fix has not been run, in
   the service account's temp folder, with a first line starting `pulse_service_host_log_fallback`).

Only Ollama crashed, so swapping just that one service is fine too: run the loop with
`'PulseGaming-Ollama'` alone.

## How to undo it

Same as above with `$old` and `$new` swapped. The old file was never changed.

## Notes

- The orchestrator's watchdog may watch these services. If it compares the start command against a fixed
  value, tell the Master orchestrator chat that the host path changed.
- The trial build installed the .NET first-run HTTPS development certificate in the PC user's certificate
  store (a standard .NET first-run step, harmless, removable with `dotnet dev-certs https --clean`).
- The factory side (no paid picture checks while this relay is down) is a separate fix on `claude/stage`,
  commit `2833f75a7`.
