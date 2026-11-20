// Renders one finished Short again in a sandbox (its own data folder, database copy and render-only .env), through the
// render step only: no discovery, no writing, no voice, no upload. For proving render-side changes such as the
// graphics audit (GRAPHICS_AUDIT) on real episodes. Never point it at the live factory's data folder.
//   SANDBOX=<dir with .env, db/ and episodes/<id>/> node --import tsx data/smoke/gfxsandbox.mts <episode id>
// Prints the render step's outcome, the graphics events and where the new short.mp4 is.
import fs from "node:fs";
import path from "node:path";

const SANDBOX = process.env.SANDBOX;
const ID = process.argv[2];
if (!SANDBOX || !ID) throw new Error("usage: SANDBOX=<dir> gfxsandbox.mts <episode id>");
if (/PulseFactory[\\/]factory[\\/]data/.test(path.resolve(SANDBOX)))
  throw new Error("refusing to run on the live factory's data folder");
process.loadEnvFile(path.join(SANDBOX, ".env"));
Object.assign(process.env, { DATA_DIR: SANDBOX, DRY_RUN: "true", PORT: "0" });
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices, advance } = {
  ...(await import("../../src/services.ts")),
  ...(await import("../../src/pipeline.ts")),
};
const { getEpisode } = await import("../../src/episodes.ts");
const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
await db.query("DELETE FROM leases");
await db.query(
  `UPDATE episodes SET status = 'voiced', youtube_video_id = NULL, youtube_status = NULL, upload_session_uri = NULL,
          qa_json = NULL, attempts = 0, last_error = NULL, next_attempt_at = NULL, publish_at = NULL WHERE id = $1`,
  [ID],
);
for (const f of ["short.mp4", "render_raw.mp4"]) fs.rmSync(path.join(SANDBOX, "episodes", ID, f), { force: true });
const s = createServices(db, cfg);
s.notify = async (m) => {
  console.log("DISCORD:", (m.content ?? m.embeds?.[0]?.title ?? "").slice(0, 200));
  return true;
};
const t0 = Date.now();
try {
  const ep = await getEpisode(db, ID);
  if (!ep) throw new Error(`no ${ID} in the sandbox`);
  await advance(s, ep);
} catch (e) {
  console.log("STEP ERROR", (e as Error).message.slice(0, 600));
}
const ep = await getEpisode(db, ID);
const events = await db.query<{ kind: string; detail: unknown }>(
  `SELECT kind, detail FROM events WHERE episode_id = $1 AND kind LIKE 'graphics%' AND created_at > $2 ORDER BY created_at`,
  [ID, new Date(t0).toISOString()],
);
for (const e of events) console.log("EVENT", e.kind, JSON.stringify(e.detail).slice(0, 700));
console.log("RESULT", {
  status: ep?.status,
  error: (ep?.last_error ?? "").slice(0, 400),
  minutes: ((Date.now() - t0) / 60000).toFixed(1),
  video: fs.existsSync(path.join(SANDBOX, "episodes", ID, "short.mp4")) ? path.join(SANDBOX, "episodes", ID, "short.mp4") : "none",
  qa: JSON.stringify(ep?.qa_json ?? null).slice(0, 400),
});
await db.close();
