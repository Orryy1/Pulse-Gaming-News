// The edit director's proof render in a sandbox (never the live factory; run through ~/orch/macrun.sh on the Mac): a
// published Short renders again from its own stored plan, media and voice with RETENTION_DIRECTOR=fix, so the only
// change is what the director made. The published file is kept as before.mp4 and the new one is after.mp4. Nothing is
// uploaded (DRY_RUN), no paid API is called (the plan and the voice are reused), advance() only, never tick().
//   node --import tsx src/tools/retention-proof.ts <sandbox data dir> <episode id> [<episode id> ...]
// The sandbox holds a copy of the database (db/), the episodes' folders (episodes/<id>/) and the model to test
// (retention/model.json).
import fs from "node:fs";
import path from "node:path";
process.loadEnvFile(path.join(process.env.HOME!, "PulseFactory/factory/.env"));
// --control: the same render with the director off (control.mp4), so a before-and-after differs only by the director,
// not by whatever else changed in the factory since the Short was published.
const CONTROL = process.argv.includes("--control");
const [SB, ...IDS] = process.argv.slice(2).filter((a) => a !== "--control");
if (!SB || !IDS.length)
  throw new Error(
    "usage: retention-proof.ts <sandbox data dir> <episode id>...",
  );
Object.assign(process.env, {
  DATA_DIR: SB,
  DATABASE_URL: "",
  DRY_RUN: "true",
  RETENTION_DIRECTOR: CONTROL ? "off" : "fix",
  LONGFORM_ENABLED: "false",
  EVERGREEN_ENABLED: "false",
  WEEKLY_ENABLED: "false",
  GAMEPLAY_ENABLED: "false",
  GAME_FETCH: "false",
  SHORT_RUN_FILE: "",
  BREAKING_SCORE_MIN: "1000",
  PORT: "0",
});
const { loadConfig } = await import("../config.ts");
const { openDb, migrate } = await import("../db.ts");
const { createServices } = await import("../services.ts");
const { advance } = await import("../pipeline.ts");
const { getEpisode } = await import("../episodes.ts");
const cfg = loadConfig();
const db = await openDb("", cfg.dataDir);
await migrate(db);
await db.query("DELETE FROM leases");
const s = createServices(db, cfg);
s.notify = async (m: any) => {
  console.log(
    "DISCORD:",
    String(m.content ?? m.embeds?.[0]?.title ?? "").slice(0, 200),
  );
  return true;
};
const results: unknown[] = [];
for (const ID of IDS) {
  const dir = path.join(SB, "episodes", ID);
  const short = path.join(dir, "short.mp4");
  const before = path.join(dir, "before.mp4");
  if (!fs.existsSync(before)) {
    if (!fs.existsSync(short)) {
      console.log(`${ID}: no published short.mp4 in the sandbox, skipped`);
      continue;
    }
    fs.renameSync(short, before);
  }
  const ep0 = (await getEpisode(db, ID))!;
  const a = { ...(ep0.assets_json as any) };
  const beforePlan = structuredClone(a.plan);
  delete a.retention;
  // Only this episode moves; everything else in the sandbox stays put.
  await db.query(
    "UPDATE episodes SET status = 'published', next_attempt_at = NULL WHERE id <> ALL($1) AND status NOT IN ('published','failed','rejected')",
    [IDS],
  );
  await db.query(
    `UPDATE episodes SET status = 'voiced', assets_json = $2, qa_json = NULL, attempts = 0, last_error = NULL, next_attempt_at = NULL,
            youtube_video_id = NULL, youtube_status = NULL, upload_session_uri = NULL, publish_at = NULL WHERE id = $1`,
    [ID, JSON.stringify(a)],
  );
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) {
    await db.query("UPDATE episodes SET next_attempt_at = NULL WHERE id = $1", [
      ID,
    ]);
    const cur = await getEpisode(db, ID);
    if (!cur || cur.status !== "voiced") break;
    await advance(s, cur);
    const ep = await getEpisode(db, ID);
    console.log(
      `${ID} tick ${i}: status=${ep?.status} err=${(ep?.last_error ?? "").slice(0, 200)} t=${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
  }
  const ep = await getEpisode(db, ID);
  const after = path.join(dir, CONTROL ? "control.mp4" : "after.mp4");
  if (fs.existsSync(short)) fs.renameSync(short, after);
  const ret = (ep?.assets_json as any)?.retention;
  results.push({
    id: ID,
    status: ep?.status,
    after: fs.existsSync(after) ? after : null,
    retention: ret,
    beforePlan,
    afterPlan: (ep?.assets_json as any)?.plan,
  });
  console.log(
    `${ID}: ${fs.existsSync(after) ? "after.mp4 rendered" : "no render"}; director: ${JSON.stringify(ret?.report?.fixes ?? ret?.skipped ?? null).slice(0, 400)}`,
  );
}
fs.writeFileSync(path.join(SB, CONTROL ? "control.json" : "proof.json"), JSON.stringify(results, null, 1));
await db.close();
process.exit(0);
