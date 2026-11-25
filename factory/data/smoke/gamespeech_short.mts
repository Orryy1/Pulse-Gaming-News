// GAME_SPEECH_DIALOGUE proof (20 Nov 2026): one published Short again in a sandbox, with the game's characters talking
// with the narrator. The published script is taken from a saved /admin/export, the exchange writer runs on it (real
// model calls: one or two), then the pipeline's own voice and render steps make the Short (DRY_RUN: nothing uploads).
// The scene indexes (and their proxies) go in <sandbox>/sceneindex; the game library is read from GAME_LIBRARY_DIR.
//   node --import tsx data/smoke/gamespeech_short.mts <sandbox dir> <export.json> <episode id> [--voice=local]
// A second run reuses the placed exchanges (no model call) and carries on from the episode's status.
// Heavy (voice, Whisper, render): run it inside an orchestrator turn with ORCH_CLIENT=file:///C:/nonexistent/orch.mjs.
import fs from "node:fs";
import path from "node:path";

const [DIR, EXP, ID] = process.argv.slice(2) as [string, string, string];
const voice = process.argv.find((a) => a.startsWith("--voice="))?.slice(8);
if (!DIR || !EXP || !ID)
  throw new Error(
    "usage: gamespeech_short.mts <sandbox dir> <export.json> <episode id>",
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
const { quoteScriptStep } = await import("../../src/charquotestep.ts");
const { withoutQuote } = await import("../../src/editorial/charquote.ts");
const { loadSceneIndex } = await import("../../src/sceneindex/schema.ts");
const { windowsFrom } = await import("../../src/sceneindex/gamefetch.ts");
const { setSpoilerWindows } = await import("../../src/sceneindex/spoilers.ts");

const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
const s = createServices(db, cfg);
s.notify = async () => true;

// The spoiler windows, as the game fetcher sets them in the factory (fail closed without them).
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

const rows = JSON.parse(fs.readFileSync(EXP, "utf8")) as any[];
const row = rows.find((r) => r.id === ID);
if (!row) throw new Error(`no ${ID} in ${EXP}`);
let ep = (await db.query<any>(`SELECT * FROM episodes WHERE id = $1`, [ID]))[0];
if (!ep?.script_json?.character_quotes?.length) {
  let script = row.script_json;
  for (const q of script.character_quotes ?? [])
    script = withoutQuote(script, q.id);
  if (!ep)
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json) VALUES ($1, $2, 'selected', $3, $4, $5)`,
      [
        ID,
        `proof-${ID}`,
        JSON.stringify({
          headline: script.headline,
          url: "",
          gameHint: script.game_title,
          sources: [],
        }),
        row.lane,
        JSON.stringify(script),
      ],
    );
  const placed = await quoteScriptStep(s, { id: ID }, script, {
    story: script.headline,
  });
  if (!placed.character_quotes?.length) {
    const ev = await db.query<any>(
      `SELECT detail FROM events WHERE episode_id = $1 AND kind = 'character_quote' ORDER BY id`,
      [ID],
    );
    console.log(
      "no exchange placed:",
      JSON.stringify(ev.map((e) => e.detail)).slice(0, 1500),
    );
    await db.close();
    process.exit(2);
  }
  await db.query(
    `UPDATE episodes SET script_json = $2, status = 'scripted', assets_json = NULL WHERE id = $1`,
    [ID, JSON.stringify(placed)],
  );
  ep = (await db.query<any>(`SELECT * FROM episodes WHERE id = $1`, [ID]))[0];
}
for (const q of ep.script_json.character_quotes)
  console.log(
    `exchange in beat ${q.beat}:\n  NARRATOR: ${q.before.split(/(?<=[.?!:])\s+/).at(-1)}\n  ${q.speaker.toUpperCase()}: ${q.text}\n  NARRATOR: ${q.after.split(/(?<=[.?!])\s+/)[0]}`,
  );
if (process.argv.includes("--quotes-only")) {
  await db.close();
  process.exit(0);
}
for (
  let k = 0;
  k < 4 &&
  !["rendered", "failed", "rejected", "awaiting_approval"].includes(ep.status);
  k++
) {
  console.log(`step from ${ep.status}`);
  await advance(s, ep);
  ep = (await db.query<any>(`SELECT * FROM episodes WHERE id = $1`, [ID]))[0];
  if (ep.last_error)
    console.log("  last error:", String(ep.last_error).slice(0, 400));
}
const ev = await db.query<any>(
  `SELECT kind, detail FROM events WHERE episode_id = $1 AND kind LIKE 'character_quote%' ORDER BY id`,
  [ID],
);
for (const e of ev) console.log(e.kind, JSON.stringify(e.detail).slice(0, 400));
console.log(
  "status",
  ep.status,
  "quotes",
  JSON.stringify(
    (ep.assets_json?.quotes ?? []).map((q: any) => ({
      id: q.id,
      start: q.start,
      seconds: q.seconds,
      lufs: q.lufs,
      mode: q.mode,
    })),
  ),
);
console.log("short:", path.join(cfg.dataDir, "episodes", ID, "short.mp4"));
await db.close();
