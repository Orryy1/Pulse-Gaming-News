// 31 Oct 2026: sends an un-uploaded documentary back to the render step so it gets the filler visuals
// (src/assets/fillers.ts) on its next render. It clears any earlier filler decision (assets.fillersChosen and
// every moment.filler) and the stored long plan, and, when the episode has already rendered (rendered,
// awaiting_approval, approved, failed), puts it back to "voiced" with its QA cleared so the factory renders it
// again. The graphics pre-pass then checks the new filler shots on their own (the other graphics keep their
// earlier verdicts). Nothing else changes: voice, media and the shot list's graphics are kept.
//
// Run ONLY while the factory is stopped (the database is a single-process PGlite folder). It refuses when a
// factory server is running (for a database under C:\PulseFactory), when the episode is on YouTube or being
// uploaded, and writes a backup of the old assets_json and script_json beside the database folder first.
//
// Usage (from the factory folder): node --import tsx data/smoke/vc_fillers.mts <db dir> [episode id] [--dry]
//   <db dir>: the live database folder, e.g. data/db; the episode defaults to Vice City, ep_20261027_865858f8.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
const dbDir = args[0];
const id = args[1] ?? "ep_20261027_865858f8";
if (!dbDir) {
  console.error("usage: node --import tsx data/smoke/vc_fillers.mts <db dir> [episode id] [--dry]");
  process.exit(2);
}
const live = path.resolve(dbDir).toLowerCase().startsWith(path.resolve("C:/PulseFactory").toLowerCase());
if (live) {
  let procs = "";
  try {
    procs = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\").CommandLine"],
      { encoding: "utf8" },
    );
  } catch {
    console.error("refused: could not list running processes to check the factory is stopped");
    process.exit(1);
  }
  if (/src[\\/]server\.ts/.test(procs)) {
    console.error("refused: a factory server (src/server.ts) is running; stop the Pulse Factory task first");
    process.exit(1);
  }
}

const RERENDER = new Set(["rendered", "awaiting_approval", "approved", "failed"]);
const db = new PGlite(dbDir);
try {
  const [ep] = (
    await db.query<{ status: string; youtube_video_id: string | null; assets_json: any; script_json: any }>(
      `SELECT status, youtube_video_id, assets_json, script_json FROM episodes WHERE id = $1`,
      [id],
    )
  ).rows;
  if (!ep) throw new Error(`no episode ${id}`);
  if (ep.youtube_video_id || ["uploading", "uploaded", "published"].includes(ep.status))
    throw new Error(`refused: ${id} is ${ep.status}${ep.youtube_video_id ? ` on YouTube (${ep.youtube_video_id})` : ""}`);
  if (ep.script_json?.evergreen_format !== "documentary") throw new Error(`refused: ${id} is not a documentary`);
  const a = { ...(ep.assets_json ?? {}) };
  const s = ep.script_json;
  let cleared = 0;
  for (const e of s.entries ?? [])
    for (const m of e.moments ?? [])
      if (m.filler) {
        delete m.filler;
        cleared++;
      }
  const had = { fillersChosen: !!a.fillersChosen, longPlan: !!a.longPlan };
  delete a.fillersChosen;
  delete a.longPlan;
  const back = RERENDER.has(ep.status);
  console.log(
    `${id} (${ep.status}): ${cleared} earlier filler decisions cleared, fillersChosen ${had.fillersChosen ? "cleared" : "not set"}, long plan ${had.longPlan ? "cleared" : "not stored"}${back ? "; back to voiced for a new render" : ""}`,
  );
  if (dry) console.log("--dry: nothing written");
  else {
    const backup = path.join(path.dirname(path.resolve(dbDir)), `vc_fillers_backup_${id}_${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify({ status: ep.status, assets_json: ep.assets_json, script_json: ep.script_json }));
    console.log(`backup: ${backup}`);
    if (back) {
      delete a.video;
      await db.query(
        `UPDATE episodes SET status = 'voiced', qa_json = NULL, attempts = 0, next_attempt_at = NULL, assets_json = $2, script_json = $3, updated_at = now() WHERE id = $1 AND youtube_video_id IS NULL`,
        [id, JSON.stringify(a), JSON.stringify(s)],
      );
    } else
      await db.query(`UPDATE episodes SET assets_json = $2, script_json = $3 WHERE id = $1 AND youtube_video_id IS NULL`, [
        id,
        JSON.stringify(a),
        JSON.stringify(s),
      ]);
    console.log("written");
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await db.close();
}
