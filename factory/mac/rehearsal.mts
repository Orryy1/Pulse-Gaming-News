// Timed render rehearsal on the Mac (run there: cd ~/PulseFactory/factory && node --import tsx mac/rehearsal.mts).
// Only the long lane's tick runs (never the scheduler or the Shorts tick: one factory per API key), on
// a render-only .env without publishing tokens. Uses the long-video sandbox copied from the PC (~/PulseFactory/rehearsal: its own database and one finished
// long episode with media and plan). The episode is put back to "voiced" so the ticks only render it again,
// then QA and the thumbnails run, with the upload a dry run. Prints how long the render took, so the Mac's
// slot lead times can be set from a real number (the PC does a long render in a median 25 minutes).
//   node --import tsx mac/rehearsal.mts [long] [episode id] [--replan]   a long video (--replan drops its
//                                                                      saved plan, so the current code plans it)
//   node --import tsx mac/rehearsal.mts short <episode id>              a Short: the Shorts tick, as
//                                                                      data/smoke/shortdry.mts does on the PC
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const envFile = path.join(HOME, "PulseFactory", "rehearsal", ".env");
if (!fs.existsSync(envFile))
  throw new Error(
    "no ~/PulseFactory/rehearsal/.env: the PC writes a render-only one (no publishing tokens)",
  );
process.loadEnvFile(envFile);
const DATA = path.join(HOME, "PulseFactory", "rehearsal");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SHORT = args[0] === "short";
if (args[0] === "short" || args[0] === "long") args.shift();
const ID = args[0];
const REPLAN = process.argv.includes("--replan");
if (SHORT && !ID)
  throw new Error("usage: mac/rehearsal.mts short <episode id>");
Object.assign(process.env, {
  DATA_DIR: DATA,
  DRY_RUN: "true",
  LONGFORM_ENABLED: SHORT ? "false" : "true",
  GAMEPLAY_ENABLED: "false",
  EVERGREEN_ENABLED: "false",
  // A news slot twelve hours away: close enough to exist, far enough that the long render never waits for it.
  NEWS_SLOTS: `${String((new Date().getUTCHours() + 12) % 24).padStart(2, "0")}:00`,
  BREAKING_SCORE_MIN: "1000",
  PORT: "0",
});
const { loadConfig } = await import("../src/config.ts");
const { openDb, migrate } = await import("../src/db.ts");
const { createServices } = await import("../src/services.ts");
const { tick, tickLong } = await import("../src/pipeline.ts");
const { getEpisode } = await import("../src/episodes.ts");

const cfg = loadConfig();
console.log("rehearsal", {
  dataDir: cfg.dataDir,
  dryRun: cfg.dryRun,
  concurrency: cfg.remotionConcurrency,
  gl: cfg.remotionGl,
});
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
await db.query("DELETE FROM leases");
// The snapshot carries the live Shorts schedule; in the sandbox nothing else is in production, so the long
// render never waits for a Short's slot.
await db.query(
  "UPDATE episodes SET status = 'published', next_attempt_at = NULL WHERE id <> $1 AND status NOT IN ('published','failed','rejected')",
  [ID ?? ""],
);
// A Short is put back to before its render with its upload forgotten (the upload is a dry run anyway).
const [target] = SHORT
  ? await db.query<{ id: string; has_plan: boolean }>(
      `UPDATE episodes SET status = 'voiced', youtube_video_id = NULL, youtube_status = NULL, upload_session_uri = NULL,
              qa_json = NULL, attempts = 0, last_error = NULL, next_attempt_at = NULL, publish_at = NULL
         WHERE id = $1 AND lane <> 'longform' RETURNING id, false AS has_plan`,
      [ID],
    )
  : await db.query<{ id: string; has_plan: boolean }>(
      `UPDATE episodes SET status = 'voiced', attempts = 0, next_attempt_at = NULL, last_error = NULL, qa_json = NULL,
              assets_json = CASE WHEN $2 THEN assets_json - 'longPlan' ELSE assets_json END
         WHERE id = COALESCE($1, (SELECT id FROM episodes WHERE lane = 'longform' AND assets_json ? 'longPlan' ORDER BY id DESC LIMIT 1))
         RETURNING id, (assets_json ? 'longPlan') AS has_plan`,
      [ID ?? null, REPLAN],
    );
if (!target)
  throw new Error(
    SHORT
      ? `no Short ${ID} in the rehearsal sandbox`
      : "no long episode with a plan in the rehearsal sandbox",
  );
// The old render is removed so the timing is a real render, not a file found on disk.
for (const f of ["short.mp4", "render_raw.mp4"])
  fs.rmSync(path.join(DATA, "episodes", target.id, f), { force: true });
console.log(
  "rendering again",
  target.id,
  SHORT ? "(Short)" : REPLAN ? "(long, planned again)" : "(long)",
);
const s = createServices(db, cfg);
// The real clock: the copied episode's slot is in the past, so the long lane finds it due.
s.notify = async (m) => {
  console.log(
    "DISCORD:",
    (m.content ?? m.embeds?.[0]?.title ?? "").slice(0, 200),
  );
  return true;
};
const t0 = Date.now();
let renderSeconds: number | undefined;
let ep;
for (let i = 0; i < (SHORT ? 4 : 8); i++) {
  await db.query(
    "UPDATE episodes SET next_attempt_at = NULL WHERE status NOT IN ('published','failed','rejected')",
  );
  const r = SHORT ? await tick(s) : await tickLong(s);
  ep = await getEpisode(db, target.id);
  const t = (Date.now() - t0) / 1000;
  if (
    renderSeconds === undefined &&
    fs.existsSync(path.join(DATA, "episodes", target.id, "short.mp4"))
  )
    renderSeconds = t;
  console.log(
    `tick ${i}: ran=${r.ran} status=${ep?.status} attempts=${ep?.attempts} err=${(ep?.last_error ?? "").slice(0, 300)} t=${t.toFixed(0)}s`,
  );
  if (
    SHORT &&
    ep &&
    ["voiced", "rendered", "selected", "scripted"].includes(ep.status)
  )
    continue;
  if (
    !ep ||
    SHORT ||
    [
      "published",
      "failed",
      "rejected",
      "awaiting_approval",
      "approved",
      "uploading",
    ].includes(ep.status)
  )
    break;
}
console.log("RESULT", {
  status: ep?.status,
  renderMinutes:
    renderSeconds === undefined ? "no file" : (renderSeconds / 60).toFixed(1),
  totalMinutes: ((Date.now() - t0) / 60000).toFixed(1),
  qa: JSON.stringify(ep?.qa_json ?? null).slice(0, 300),
  peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
});
await db.close();
