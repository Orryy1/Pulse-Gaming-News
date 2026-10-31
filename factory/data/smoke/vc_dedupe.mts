// 31 Oct 2026: one-off repair of the Vice City documentary's media list. The sentence top-up ran twice and its
// second run wrote new stock clips over the first run's files (entry_N/fill/stock/assets/stock_0.mp4), so the
// episode lists the same file twice with two labels and two sentences. This drops, for each file listed more
// than once, every entry but the LAST one (the later run wrote the file last, so its entry describes what is on
// disk) and leaves every other clip and image as it is. The stored long plan points at clips by position, so it
// is cleared too: the render step builds a fresh one (with the 31 Oct rules on real photos).
//
// Run ONLY while the factory is stopped (the database is a single-process PGlite folder). It refuses when a
// factory server is running, when the episode has a youtube_video_id, and writes a backup of the old
// assets_json beside the database folder before changing anything.
//
// --cap-stock=N (off by default) also trims the existing stock to N clips per theme ("office at night" was in
// 7 times), by the rule new videos follow (src/assets/repeats.ts trimStockThemes): within a theme it keeps the
// clips that are their sentence's only media first, then the earliest; a dropped clip's sentence is left for
// the graphics pass (nothing is added here).
//
// Usage (from the factory folder): node --import tsx data/smoke/vc_dedupe.mts <db dir> [episode id] [--dry] [--cap-stock=N]
//   <db dir>: the live database folder, e.g. data/db; the episode defaults to Vice City, ep_20261027_865858f8.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
const { duplicateFiles, keepLatestPerFile, trimStockThemes, stockThemeGroups } = await import("../../src/assets/repeats.ts");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
const capArg = process.argv.find((a) => a.startsWith("--cap-stock"));
const cap = capArg ? Number(capArg.split("=")[1]) : 0;
if (capArg && !(Number.isInteger(cap) && cap >= 1)) {
  console.error("--cap-stock needs a whole number of clips per theme, e.g. --cap-stock=2");
  process.exit(2);
}
const dbDir = args[0];
const id = args[1] ?? "ep_20261027_865858f8";
if (!dbDir) {
  console.error("usage: node --import tsx data/smoke/vc_dedupe.mts <db dir> [episode id] [--dry] [--cap-stock=N]");
  process.exit(2);
}

// A running factory holds the database: two processes writing one PGlite folder can corrupt it. A copy outside
// the live install (C:\PulseFactory) can be repaired while the factory runs, which is how this was tested.
const live = path.resolve(dbDir).toLowerCase().startsWith(path.resolve("C:/PulseFactory").toLowerCase());
let procs = "";
if (live) try {
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

const db = new PGlite(dbDir);
try {
  const [ep] = (
    await db.query<{ youtube_video_id: string | null; assets_json: any }>(
      `SELECT youtube_video_id, assets_json FROM episodes WHERE id = $1`,
      [id],
    )
  ).rows;
  if (!ep) throw new Error(`no episode ${id}`);
  if (ep.youtube_video_id) throw new Error(`refused: ${id} is already on YouTube (${ep.youtube_video_id})`);
  const a = ep.assets_json ?? {};
  const clips: any[] = a.clips ?? [];
  const dups = duplicateFiles(clips);
  if (dups.length) console.log("files listed twice (the later entry is kept):");
  else console.log("no clip file is listed twice");
  for (const f of dups) {
    const all = clips.filter((c) => String(c.file).replace(/\\/g, "/").toLowerCase() === f.replace(/\\/g, "/").toLowerCase());
    console.log(`  ${f}`);
    for (const c of all.slice(0, -1)) console.log(`    drop: sentence ${c.beatIndex}.${c.moment} "${c.label}"`);
    console.log(`    keep: sentence ${all.at(-1).beatIndex}.${all.at(-1).moment} "${all.at(-1).label}"`);
  }
  let kept = keepLatestPerFile(clips);
  if (cap) {
    const before = stockThemeGroups(kept);
    const t = trimStockThemes(kept, a.images ?? [], cap);
    const still = new Set(t.kept);
    console.log(`stock per theme, at most ${cap} (${kept.filter((c) => c.stock).length} stock clips -> ${t.kept.filter((c) => c.stock).length}):`);
    for (const g of before.filter((g) => g.members.length > cap))
      console.log(`  ${g.theme}: ${g.members.length} -> ${g.members.filter((j) => still.has(kept[j])).length}`);
    if (!t.dropped.length) console.log("  no theme is over the cap");
    for (const c of t.dropped) {
      const others = [...t.kept, ...(a.images ?? [])].some((x: any) => x.beatIndex === c.beatIndex && x.moment === c.moment);
      console.log(`  sentence ${c.beatIndex}.${c.moment} loses "${c.label}"${others ? " (keeps its other media)" : " (now bare: left for the graphics pass)"}`);
    }
    kept = t.kept;
  }
  if (kept.length === clips.length) {
    console.log(`${id}: nothing to do`);
  } else {
    console.log(`${id}: ${clips.length} clips -> ${kept.length}; long plan ${a.longPlan ? "cleared (rebuilt at render)" : "not stored"}`);
    if (dry) console.log("--dry: nothing written");
    else {
      const backup = path.join(path.dirname(path.resolve(dbDir)), `vc_dedupe_backup_${id}_${Date.now()}.json`);
      fs.writeFileSync(backup, JSON.stringify(a));
      console.log(`backup of the old assets_json: ${backup}`);
      const { longPlan: _old, ...rest } = a;
      await db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1 AND youtube_video_id IS NULL`, [
        id,
        JSON.stringify({ ...rest, clips: kept }),
      ]);
      console.log("written");
    }
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await db.close();
}
