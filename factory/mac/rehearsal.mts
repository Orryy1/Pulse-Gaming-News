// Timed render rehearsal on the Mac (run there: cd ~/PulseFactory/factory && node --import tsx mac/rehearsal.mts).
// Only the long lane's tick runs (never the scheduler or the Shorts tick: one factory per API key), on
// a render-only .env without publishing tokens. Uses the long-video sandbox copied from the PC (~/PulseFactory/rehearsal: its own database and one finished
// long episode with media and plan). The episode is put back to "voiced" so the ticks only render it again,
// then QA and the thumbnails run, with the upload a dry run. Prints how long the render took, so the Mac's
// slot lead times can be set from a real number (the PC does a long render in a median 25 minutes).
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
Object.assign(process.env, {
  DATA_DIR: DATA,
  DRY_RUN: "true",
  LONGFORM_ENABLED: "true",
  EVERGREEN_ENABLED: "false",
  NEWS_SLOTS: "03:00",
  BREAKING_SCORE_MIN: "1000",
  PORT: "0",
});
const { loadConfig } = await import("../src/config.ts");
const { openDb, migrate } = await import("../src/db.ts");
const { createServices } = await import("../src/services.ts");
const { tickLong } = await import("../src/pipeline.ts");
const { listEpisodes } = await import("../src/episodes.ts");

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
const [target] = await db.query<{ id: string; has_plan: boolean }>(
  `UPDATE episodes SET status = 'voiced', attempts = 0, next_attempt_at = NULL, last_error = NULL, qa_json = NULL
     WHERE id = COALESCE($1, (SELECT id FROM episodes WHERE lane = 'longform' AND assets_json ? 'longPlan' ORDER BY id DESC LIMIT 1))
     RETURNING id, (assets_json ? 'longPlan') AS has_plan`,
  [process.argv[2] ?? null],
);
if (!target)
  throw new Error("no long episode with a plan in the rehearsal sandbox");
// The old render is removed so the timing is a real render, not a file found on disk.
for (const f of ["short.mp4", "render_raw.mp4"])
  fs.rmSync(path.join(DATA, "episodes", target.id, f), { force: true });
console.log("rendering again", target.id);
const s = createServices(db, cfg);
// The sandbox's clock: a Sunday afternoon with the slot ahead, as the PC's dry runs pretend.
const offset = new Date("2026-10-18T15:05:00Z").getTime() - Date.now();
s.now = () => new Date(Date.now() + offset);
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
for (let i = 0; i < 8; i++) {
  await db.query(
    "UPDATE episodes SET next_attempt_at = NULL WHERE status NOT IN ('published','failed','rejected')",
  );
  const r = await tickLong(s);
  [ep] = await listEpisodes(db, 1);
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
    !ep ||
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
});
await db.close();
