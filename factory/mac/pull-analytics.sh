#!/bin/bash
# Copies the weekly analytics report (src/analyticsloop.ts) off the Mac into C:\Claude\analytics\pulse, where the
# command centre reads every project's latest.md (run on the PC in Git Bash; the Mac never pushes). Each file lands
# under a .part name and replaces the old one only when it arrived whole and looks right, so a failed copy leaves last
# week's report in place. status.json gets three keys merged in (pulled_at, ok, error) and keeps everything else the
# project chat writes there; a report more than eight days old counts as a failure, since the Monday job did not run.
#   bash mac/pull-analytics.sh      (PC tasks: Mondays 09:30 and 13:00 UK; see the analytics loop spec, section 2)
set -uo pipefail
DEST="${PULL_ANALYTICS_DEST:-/c/Claude/analytics/pulse}"
SRC="PulseFactory/factory/data/reports/analytics"
mkdir -p "$DEST"
err=""
for f in latest.md latest.json; do
  if ! scp -q -p -o BatchMode=yes -o ConnectTimeout=20 "pulse-mac:$SRC/$f" "$DEST/$f.part" 2>/dev/null; then
    err="could not copy $f from the Mac"
    break
  fi
done
if [ -z "$err" ] && ! head -1 "$DEST/latest.md.part" | grep -q '^# Pulse Gaming: analytics feedback loop'; then
  err="latest.md from the Mac is not the report"
fi
if [ -z "$err" ]; then
  err=$(LOOP_JSON="$DEST/latest.json.part" node -e '
    const j = JSON.parse(require("fs").readFileSync(process.env.LOOP_JSON, "utf8"));
    const age = (Date.now() - Date.parse(j.run_at)) / 86400000;
    if (!(age < 8)) console.log(`the report on the Mac is from ${String(j.run_at).slice(0, 10)}; the weekly job has not run since`);
  ' 2>/dev/null || echo "latest.json from the Mac is not valid JSON")
fi
if [ -z "$err" ]; then
  mv -f "$DEST/latest.md.part" "$DEST/latest.md"
  mv -f "$DEST/latest.json.part" "$DEST/latest.json"
  # RETENTION_LEARN: the week's retention lessons go into lessons.md as one dated line, newest first (GROWTH-LOOP.md
  # step 3), once per report; nothing is written while the report carries none.
  LOOP_JSON="$DEST/latest.json" LESSONS="$DEST/lessons.md" node -e '
    const fs = require("fs");
    const j = JSON.parse(fs.readFileSync(process.env.LOOP_JSON, "utf8"));
    const ls = (j.retention && j.retention.lessons) || [];
    if (!ls.length) process.exit(0);
    const day = String(j.run_at).slice(0, 10);
    const d = new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const line = `- ${d} (retention curves, automatic, ${j.retention.shorts} Shorts): ` + ls.map((l) => l.replace(/ \(retention curves [^)]*\)\.?$/, ".")).join(" ");
    let text = "";
    try { text = fs.readFileSync(process.env.LESSONS, "utf8"); } catch { text = "# Pulse lessons\n\nOne line per verdict, newest first.\n\n"; }
    if (text.includes(`- ${d} (retention curves`)) process.exit(0);
    const at = text.search(/^- /m);
    text = at < 0 ? text.replace(/\n*$/, "\n\n") + line + "\n" : text.slice(0, at) + line + "\n" + text.slice(at);
    fs.writeFileSync(process.env.LESSONS, text);
  ' 2>/dev/null || echo "retention lessons not filed in lessons.md" >&2
else
  rm -f "$DEST/latest.md.part" "$DEST/latest.json.part"
fi
LOOP_STATUS="$DEST/status.json" LOOP_ERR="$err" node -e '
  const fs = require("fs");
  const file = process.env.LOOP_STATUS;
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  s.pulled_at = new Date().toISOString();
  s.ok = !process.env.LOOP_ERR;
  s.error = process.env.LOOP_ERR || null;
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
'
if [ -n "$err" ]; then
  echo "analytics pull failed: $err (the old report stays in place)" >&2
  exit 1
fi
echo "analytics report pulled into $DEST"
