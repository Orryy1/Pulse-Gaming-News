# The stream recordings on the PC (owner, 25 Nov 2026), run by the "Pulse stream recordings" task every three hours:
#   1. new Twitch past broadcasts of every channel (tinotv, the owner's own; spencey96, his cousin's, used with his
#      permission) into D:\pulse-data\vods\<Channel> VODs, Twitch only, with an archive file per channel. Work files go
#      to the local temp folder first, never a synced folder. A copy shorter than Twitch's own length is fetched again
#      (twice at most), and a short copy is never written to the archive, so the next run tries once more.
#   2. the index, tags and meaning vectors of every recording not done yet (src/tools/vodpc.ts index), through the
#      orchestrator at test priority, so a render or a live job always comes first.
#   3. recordings older than VOD_KEEP_DAYS (10) and fully indexed leave D: for the Mac mini's USB drive, copied and
#      checked by size first, never deleted outright (kept here when the drive is not there); old cut clips go.
#   D: keeps VOD_MIN_FREE_GB (320) free: a download that would take it lower is refused with a log line.
# A cheap check comes first: listing a channel's broadcasts downloads nothing, so a run with nothing new is seconds.
# Install: windows\install-vod-daily.cmd. Log: D:\pulse-data\logs\vod-daily.log.
$ErrorActionPreference = "Continue"
$Root     = if ($env:VOD_ROOT) { $env:VOD_ROOT } else { "D:\pulse-data\vods" }
$Factory  = Split-Path -Parent $PSScriptRoot
$Log      = "D:\pulse-data\logs\vod-daily.log"
# Work files on D: (big files live there), in a folder no sync tool watches.
$Temp     = "D:\pulse-data\scratch\vod-temp"
$Attempts = Join-Path $Root "short-attempts.txt"
$IndexDir = if ($env:VOD_DATA_DIR) { Join-Path $env:VOD_DATA_DIR "vodindex" } else { "C:\pulse-vods\data\vodindex" }
$Lock     = Join-Path $Root ".vod-daily.lock"
# D: keeps this much free after every download (the Sleepy Lore Lodge stops below 300 GB).
# Decimal GB, as the factory and Explorer count them; a value that is not a number falls back to 320.
$MinFreeGB = 320
if ($env:VOD_MIN_FREE_GB -as [int]) { $MinFreeGB = [int]$env:VOD_MIN_FREE_GB }
$Orch     = "C:\Claude\orchestrator\orch.cmd"
$Channels = @(
  @{ Name = "tinotv";    Dir = Join-Path $Root "TinoTV VODs";    Archive = Join-Path $Root "downloaded.txt" },
  @{ Name = "spencey96"; Dir = Join-Path $Root "Spencey96 VODs"; Archive = Join-Path $Root "spencey96-downloaded.txt" }
)

New-Item -ItemType Directory -Force (Split-Path $Log), $Temp | Out-Null
function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Encoding utf8 $Log }

# One run at a time: a lock younger than 12 hours means another run is still going, unless the run that wrote it is
# gone. A PC restart (25 Nov 2026, 23:37) killed a run mid-index and left its lock, so the next run would have skipped.
if ((Test-Path $Lock) -and ((Get-Date) - (Get-Item $Lock).LastWriteTime).TotalHours -lt 12) {
  $holder = (Get-Content -LiteralPath $Lock -TotalCount 1 -ErrorAction SilentlyContinue) -as [int]
  $alive = $holder -and (Get-Process -Id $holder -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq "powershell" })
  if ($alive) { Log "Skipped: another run holds the lock"; exit 0 }
  Log "Stale lock from run $holder (no longer running): taking it over"
}
Set-Content -Path $Lock -Value $PID
try {
  $ytdlp = (Get-Command yt-dlp -ErrorAction SilentlyContinue).Source
  if (-not $ytdlp) { Log "yt-dlp not found"; exit 1 }
  & $ytdlp -U 2>&1 | Out-Null   # Twitch changes often; keep yt-dlp current
  # Without ffprobe no copy can be measured, so nothing is downloaded (it would be fetched again every run).
  if (-not (Get-Command ffprobe -ErrorAction SilentlyContinue)) { Log "ffprobe not found"; exit 1 }
  # Work files left by a killed download go after a day.
  Get-ChildItem -LiteralPath $Temp -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } | Remove-Item -Force -ErrorAction SilentlyContinue
  # Runs a short copy has been fetched in, per VOD: after three, the short copy is kept as it is.
  $tries = @{}
  if (Test-Path $Attempts) { foreach ($l in Get-Content $Attempts) { $p = $l -split '\s+'; if ($p.Count -ge 2) { $tries[$p[0]] = [int]$p[1] } } }

  function Get-Seconds($file) {
    $d = & ffprobe -v error -show_entries format=duration -of csv=p=0 "$file" 2>$null
    if ($d) { [double]$d } else { 0 }
  }

  foreach ($ch in $Channels) {
    $freeGB = [math]::Round((Get-PSDrive ($Root.Substring(0, 1))).Free / 1e9)
    if ($freeGB -lt $MinFreeGB) { Log "Refused: downloads skipped, D: has $freeGB GB free and keeps $MinFreeGB GB"; break }
    New-Item -ItemType Directory -Force $ch.Dir | Out-Null
    if (-not (Test-Path $ch.Archive)) { New-Item -ItemType File $ch.Archive | Out-Null }
    $done = @{}
    # Done: in the archive and either the whole recording is here or its index is (pruned recordings keep theirs).
    # An archived VOD with neither (a download that never finished) is fetched again.
    foreach ($line in Get-Content $ch.Archive) {
      $id = ($line -split '\s+')[-1]
      if (-not $id) { continue }
      $here = Get-ChildItem -LiteralPath $ch.Dir -Filter "*[$id].mp4" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($here -or (Test-Path (Join-Path $IndexDir "$id\index.json"))) { $done[$id] = $true }
    }
    $url = "https://www.twitch.tv/$($ch.Name)/videos?filter=archives&sort=time"
    $rows = & $ytdlp $url --flat-playlist --print "%(id)s|%(duration)s|%(live_status)s" 2>$null
    $new = @($rows | Where-Object { $_ -match '^v?\d+\|' } | ForEach-Object {
      $p = $_ -split '\|'; [pscustomobject]@{ Id = $p[0]; Seconds = $p[1]; Live = $p[2] }
    } | Where-Object { -not $done[$_.Id] -and $_.Live -ne "is_live" })
    Log "$($ch.Name): $(@($rows).Count) broadcasts listed, $($new.Count) new ($freeGB GB free)"
    foreach ($vod in $new) {
      $want = 0.0
      if (-not [double]::TryParse($vod.Seconds, [ref]$want) -or $want -le 0) {
        $one = & $ytdlp "https://www.twitch.tv/videos/$($vod.Id.TrimStart('v'))" --skip-download --print "%(duration)s|%(live_status)s" 2>$null | Select-Object -Last 1
        $p = "$one" -split '\|'
        if ($p.Count -ge 2 -and $p[1] -eq "is_live") { Log "  $($vod.Id): still live, next run"; continue }
        [void][double]::TryParse($p[0], [ref]$want)
      }
      # The download's size from its length (1080p Twitch is about 4.5 GB an hour; 20 GB when the length is unknown):
      # refused when D: would drop under its floor.
      $needGB = if ($want -gt 0) { [math]::Ceiling($want / 3600 * 4.5) } else { 20 }
      $freeNow = [math]::Round((Get-PSDrive ($Root.Substring(0, 1))).Free / 1e9)
      if ($freeNow - $needGB -lt $MinFreeGB) {
        Log "  Refused: $($vod.Id) needs about $needGB GB and D: has $freeNow GB free, keeping $MinFreeGB GB"
        continue
      }
      $ok = $false
      for ($try = 1; $try -le 2 -and -not $ok; $try++) {
        & $ytdlp "https://www.twitch.tv/videos/$($vod.Id.TrimStart('v'))" `
          -f "best[height<=1080]/best" `
          -P "home:$($ch.Dir)" -P "temp:$Temp" `
          -o "%(upload_date>%Y-%m-%d)s %(title).80B [%(id)s].%(ext)s" `
          --force-overwrites --retries 10 --fragment-retries 50 --concurrent-fragments 4 `
          --match-filters "!is_live" 2>&1 | Select-String -Pattern "Destination|ERROR" | ForEach-Object { Log "  $($_.Line)" }
        $file = Get-ChildItem -LiteralPath $ch.Dir -Filter "*[$($vod.Id)].mp4" -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $file) { Log "  $($vod.Id): no file after try $try"; continue }
        $got = Get-Seconds $file.FullName
        # Short by more than a minute (or 1%) of Twitch's own length: fragments were lost, so it is fetched again.
        $slack = [math]::Max(60, $want * 0.01)
        $runs = 1 + [int]$tries[$vod.Id]
        if ($want -gt 0 -and $got -lt $want - $slack -and $runs -lt 3) {
          Log "  $($vod.Id): short copy, $([math]::Round($got)) of $([math]::Round($want)) s (try $try, run $runs)"
          if ($try -lt 2) { Remove-Item -LiteralPath $file.FullName -Force }
          else {
            # Kept aside, never indexed (its times would not fit the whole copy); the next run tries again.
            $tries[$vod.Id] = $runs
            Set-Content -Encoding ascii $Attempts ($tries.GetEnumerator() | ForEach-Object { "$($_.Key) $($_.Value)" })
            $aside = Join-Path $ch.Dir "partial-$($vod.Id).mp4.bak"
            Remove-Item -LiteralPath $aside -Force -ErrorAction SilentlyContinue
            Move-Item -LiteralPath $file.FullName $aside
          }
        } else {
          if ($want -gt 0 -and $got -lt $want - $slack) { Log "  $($vod.Id): still short after $runs runs, kept as it is" }
          $ok = $true
          Add-Content -Encoding ascii $ch.Archive "twitchvod $($vod.Id)"
          Log "  $($vod.Id): saved, $([math]::Round($got)) s of $([math]::Round($want)) s"
        }
      }
      # A partial copy kept aside by hand goes once the whole one is in.
      if ($ok) { Get-ChildItem -LiteralPath $ch.Dir -Filter "partial-$($vod.Id)*" -ErrorAction SilentlyContinue | Remove-Item -Force }
    }
    # Partial copies of recordings already saved whole (an earlier manual re-download).
    foreach ($bak in Get-ChildItem -LiteralPath $ch.Dir -Filter "partial-*.bak" -ErrorAction SilentlyContinue) {
      if ($bak.Name -match 'partial-(v\d+)' -and $done[$Matches[1]] -and (Get-ChildItem -LiteralPath $ch.Dir -Filter "*[$($Matches[1])].mp4")) {
        Log "  removing $($bak.Name): the whole recording is in"
        Remove-Item -LiteralPath $bak.FullName -Force
      }
    }
  }

  # The index: a recording not fully indexed is worked on for up to 90 minutes a run, at test priority.
  Set-Location $Factory
  $status = & node --import tsx src/tools/vodpc.ts status 2>&1
  $status | ForEach-Object { Log "  $_" }
  if ($status | Where-Object { $_ -notmatch 'READY' }) {
    Log "Indexing through the orchestrator"
    & $Orch run --class gpu --project pulse --job "vodpc: index stream recordings" --priority 20 --est 95 -- node --import tsx src/tools/vodpc.ts index --hours 1.5 2>&1 |
      Select-Object -Last 15 | ForEach-Object { Log "  $_" }
  }
  $keep = if ($env:VOD_KEEP_DAYS) { $env:VOD_KEEP_DAYS } else { "10" }
  & node --import tsx src/tools/vodpc.ts prune --days $keep 2>&1 | ForEach-Object { Log "  $_" }
  Log "Done"
} finally {
  Remove-Item -LiteralPath $Lock -Force -ErrorAction SilentlyContinue
}
