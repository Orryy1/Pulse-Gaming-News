// GAME_SPEECH_DIALOGUE proof for a long video (20 Nov 2026): a sandbox long video's script gets its exchanges with the
// game's characters (real model calls), the pipeline's own voice step voices it with the silences left for the lines
// (the clips cut, heard by Whisper and loudness-matched), and data/smoke/excerpt.mts renders the stretch around the
// first exchanges. DRY_RUN: nothing uploads. The scene indexes (and proxies) go in <sandbox>/sceneindex.
//   node --import tsx data/smoke/gamespeech_long.mts <sandbox dir> <episode id> <excerpt out.mp4> [--voice=local] [--quotes-only]
// Heavy: run it inside an orchestrator turn with ORCH_CLIENT=file:///C:/nonexistent/orch.mjs (the excerpt inherits it).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [DIR, ID, OUT] = process.argv.slice(2) as [string, string, string];
const voice = process.argv.find((a) => a.startsWith("--voice="))?.slice(8);
if (!DIR || !ID || !OUT)
  throw new Error(
    "usage: gamespeech_long.mts <sandbox dir> <episode id> <out.mp4>",
  );
if (/PulseFactory[\\/]factory[\\/]data/.test(path.resolve(DIR)))
  throw new Error("refusing the live factory's data folder");
process.loadEnvFile("C:/PulseFactory/factory/.env");
Object.assign(process.env, {
  DATA_DIR: path.resolve(DIR),
  DATABASE_URL: "",
  DRY_RUN: "true",
  PORT: "0",
  CHARACTER_QUOTES: "true",
  GAME_SPEECH_DIALOGUE: "true",
  SPOILER_GUARD: "true",
  SCENE_INDEX: "false",
  GAME_LIBRARY_DIR: process.env.GAME_LIBRARY_DIR || "D:\\pulse-data\\library",
  ...(voice ? { VOICE_PROVIDER: voice } : {}),
});
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const { advance } = await import("../../src/pipeline.ts");
const { quoteLongStep } = await import("../../src/charquotestep.ts");
const { withoutQuote } = await import("../../src/editorial/charquote.ts");
const { loadSceneIndex } = await import("../../src/sceneindex/schema.ts");
const { windowsFrom } = await import("../../src/sceneindex/gamefetch.ts");
const { setSpoilerWindows } = await import("../../src/sceneindex/spoilers.ts");

const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
const s = createServices(db, cfg);
s.notify = async () => true;
const launches = JSON.parse(
  fs.readFileSync(path.resolve("launches.json"), "utf8"),
) as Array<{ game: string; launch: string }>;
const indexes = new Map<string, any>();
for (const l of launches) {
  const i = await loadSceneIndex(cfg.dataDir, l.game);
  if (i) indexes.set(i.slug, i);
}
setSpoilerWindows(
  windowsFrom(
    launches.map((l) => ({ game: l.game, release: l.launch })),
    indexes,
    {
      days: cfg.spoilerWindowDays,
      openingShare: cfg.spoilerOpeningShare,
    },
  ),
);

let ep = (await db.query<any>(`SELECT * FROM episodes WHERE id = $1`, [ID]))[0];
if (!ep) throw new Error(`no episode ${ID}`);
if (process.argv.includes("--redo") && ep.script_json?.character_quotes?.length) {
  let script = ep.script_json;
  for (const q of script.character_quotes) script = withoutQuote(script, q.id);
  await db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [ID, JSON.stringify(script)]);
  ep = (await db.query<any>(`SELECT * FROM episodes WHERE id = $1`, [ID]))[0];
}
if (!ep.script_json?.character_quotes?.length) {
  let script = ep.script_json;
  const placed = await quoteLongStep(s, { id: ID }, script);
  if (!placed.character_quotes?.length) {
    const ev = await db.query<any>(
      `SELECT detail FROM events WHERE episode_id = $1 AND kind = 'character_quote' ORDER BY id`,
      [ID],
    );
    console.log(
      "no exchange placed:",
      JSON.stringify(ev.map((e) => e.detail)).slice(0, 2000),
    );
    await db.close();
    process.exit(2);
  }
  // The sandbox episode was published: back to the voice step with the new script (its media stays).
  await db.query(
    `UPDATE episodes SET script_json = $2, status = 'scripted', last_error = NULL WHERE id = $1`,
    [ID, JSON.stringify(placed)],
  );
  ep = (await db.query<any>(`SELECT * FROM episodes WHERE id = $1`, [ID]))[0];
  script = placed;
}
for (const q of ep.script_json.character_quotes)
  console.log(
    `exchange in beat ${q.beat}:\n  NARRATOR: ${q.before.split(/(?<=[.?!:])\s+/).at(-1)}\n  ${q.speaker.toUpperCase()}: ${q.text}\n  NARRATOR: ${q.after.split(/(?<=[.?!])\s+/)[0]}`,
  );
if (process.argv.includes("--quotes-only")) {
  await db.close();
  process.exit(0);
}
if (ep.status === "scripted") {
  console.log("voicing");
  await advance(s, ep);
  ep = (await db.query<any>(`SELECT * FROM episodes WHERE id = $1`, [ID]))[0];
  if (ep.last_error)
    console.log("  last error:", String(ep.last_error).slice(0, 600));
}
const ev = await db.query<any>(
  `SELECT kind, detail FROM events WHERE episode_id = $1 AND kind LIKE 'character_quote%' ORDER BY id`,
  [ID],
);
for (const e of ev) console.log(e.kind, JSON.stringify(e.detail).slice(0, 400));
const quotes = (ep.assets_json?.quotes ?? []) as Array<{
  id: string;
  start: number;
  seconds: number;
  speaker: string;
  text: string;
  lufs: number;
}>;
console.log(
  "status",
  ep.status,
  "quotes",
  JSON.stringify(
    quotes.map((q) => ({
      id: q.id,
      start: q.start,
      seconds: q.seconds,
      lufs: q.lufs,
    })),
  ),
);
fs.writeFileSync(
  OUT.replace(/\.mp4$/, ".quotes.json"),
  JSON.stringify(quotes, null, 1),
);
await db.close();
if (ep.status !== "voiced" || !quotes.length) process.exit(3);
// The excerpt: from 20 s before the first exchange to 20 s after the last one within 150 s of it.
const first = quotes[0]!;
const last = [...quotes].filter((q) => q.start - first.start <= 150).at(-1)!;
const from = Math.max(0, Math.floor(first.start - 20));
const to = Math.ceil(last.start + last.seconds + 20);
console.log(`excerpt ${from}-${to} s`);
execFileSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "data/smoke/excerpt.mts",
    path.resolve(DIR),
    ID,
    String(from),
    String(to),
    OUT,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ORCH_CLIENT: process.env.ORCH_CLIENT || "file:///C:/nonexistent/orch.mjs",
    },
  },
);
fs.writeFileSync(
  OUT.replace(/\.mp4$/, ".range.json"),
  JSON.stringify({ from, to }),
);
