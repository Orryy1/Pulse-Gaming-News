// Proof render for upgrade item 25 in a sandbox (never the live factory; run through ~/orch/macrun.sh): one real Short again with
// CHARACTER_QUOTES_SHORT=2 and GAME_AUDIO_BED on. Nothing published (DRY_RUN). advance() only, never tick().
// Usage from ~/gameaudio/factory: node --import tsx data/smoke/_gameaudio.mts <episode id> <sandbox data dir> [K=V ...]
import fs from "node:fs";
import path from "node:path";
process.loadEnvFile(path.join(process.env.HOME!, "PulseFactory/factory/.env"));
const argv = process.argv.slice(2);
const [ID, SB] = argv;
const extras = Object.fromEntries(argv.filter((a) => /^[A-Z_0-9]+=/.test(a)).map((a) => a.split(/=(.*)/s).slice(0, 2)));
Object.assign(process.env, {
  DATA_DIR: SB,
  DATABASE_URL: "",
  DRY_RUN: "true",
  LONGFORM_ENABLED: "false",
  EVERGREEN_ENABLED: "false",
  WEEKLY_ENABLED: "false",
  GAMEPLAY_ENABLED: "false",
  GAME_FETCH: "false",
  SHORT_RUN_FILE: "",
  NEWS_SLOTS: "03:00",
  BREAKING_SCORE_MIN: "1000",
  PORT: "0",
  CHARACTER_QUOTES: "true",
  CHARACTER_QUOTES_SHORT: "2",
  GAME_AUDIO_BED: "true",
  GAME_AUDIO_SHARE: "1",
  ...extras,
});
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const { advance } = await import("../../src/pipeline.ts");
const { getEpisode } = await import("../../src/episodes.ts");
const { quoteScriptStep } = await import("../../src/charquotestep.ts");
const { WORDS_MAX } = await import("../../src/editorial/editorial.ts");
const cfg = loadConfig();
const db = await openDb("", cfg.dataDir);
await migrate(db);
await db.query("DELETE FROM leases");
await db.query(
  "UPDATE episodes SET status = 'published', next_attempt_at = NULL WHERE id <> $1 AND status NOT IN ('published','failed','rejected')",
  [ID],
);
const s = createServices(db, cfg);
s.notify = async (m: any) => {
  console.log("DISCORD:", (m.content ?? m.embeds?.[0]?.title ?? "").slice(0, 200));
  return true;
};
// The spoiler windows, loaded the way the server loads them at start (gameFetchPass; GAME_FETCH is off here, so it
// only reads the sandbox's filed.json and scene indexes). Without them quotes fail closed (12 Nov 2026, 7d4655142);
// the first proof ran before that and took lines from 81% and 93% of Ocarina's story.
{
  const { gameFetchPass } = await import("../../src/sceneindex/gamefetch.ts");
  const { windows } = await gameFetchPass(cfg);
  console.log("WINDOWS", JSON.stringify(windows.map((w) => ({ game: w.game, until: w.until, opening: w.openingShare, late: w.lateTerms.length }))));
  if (cfg.spoilerGuard && !windows.length) throw new Error("no spoiler windows loaded: the proof would place no quote");
}
const ep0 = (await getEpisode(db, ID))!;
const stage = argv.includes("--render-only") ? "render" : "full";
if (stage === "full") {
  // The script as it was, with up to two character quotes written in (the writer may decline either).
  let script = ep0.script_json!;
  delete (script as any).character_quotes;
  script = await quoteScriptStep(s, ep0, script, {
    wordsMax: WORDS_MAX,
    capSeconds: 58,
    story: ep0.story_json.headline,
  });
  console.log("QUOTES", JSON.stringify((script.character_quotes ?? []).map((q) => ({ beat: q.beat, speaker: q.speaker, text: q.text, before: q.before, after: q.after }))));
  await db.query(
    `UPDATE episodes SET status = 'scripted', script_json = $2, assets_json = NULL, youtube_video_id = NULL, youtube_status = NULL,
            upload_session_uri = NULL, qa_json = NULL, attempts = 0, last_error = NULL, next_attempt_at = NULL, publish_at = NULL WHERE id = $1`,
    [ID, JSON.stringify(script)],
  );
} else {
  const a = ep0.assets_json as any;
  delete a.plan;
  await db.query(
    `UPDATE episodes SET status = 'voiced', assets_json = $2, qa_json = NULL, attempts = 0, last_error = NULL, next_attempt_at = NULL WHERE id = $1`,
    [ID, JSON.stringify(a)],
  );
}
const t0 = Date.now();
let ep;
for (let i = 0; i < 4; i++) {
  await db.query("UPDATE episodes SET next_attempt_at = NULL WHERE id = $1", [ID]);
  {
    const cur = await getEpisode(db, ID);
    if (!cur) break;
    await advance(s, cur);
  }
  ep = await getEpisode(db, ID);
  console.log(`tick ${i}: status=${ep?.status} attempts=${ep?.attempts} err=${(ep?.last_error ?? "").slice(0, 300)} t=${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (!ep || !["voiced", "rendered", "selected", "scripted"].includes(ep.status)) break;
}
const ev = await db.query<{ kind: string; detail: unknown }>(
  "SELECT kind, detail FROM events WHERE episode_id = $1 AND (kind LIKE 'character_quote%' OR kind = 'game_audio') ORDER BY id",
  [ID],
);
for (const e of ev) console.log("EVENT", e.kind, JSON.stringify(e.detail).slice(0, 900));
const a = ep?.assets_json as any;
console.log("ASSETS", JSON.stringify({ quotes: (a?.quotes ?? []).map((q: any) => ({ start: q.start, seconds: q.seconds, speaker: q.speaker })), clips: (a?.clips ?? []).map((c: any) => c.provenance.slice(0, 90)), words: a?.words?.length, duration: a?.durationSeconds }));
const epDir = path.join(SB, "episodes", ID);
console.log("RESULT", ep?.status, fs.existsSync(path.join(epDir, "short.mp4")) ? path.join(epDir, "short.mp4") : "no short.mp4", "vision:", JSON.stringify(ep?.qa_json?.vision ?? null).slice(0, 400), "rubric:", ep?.qa_json?.rubric?.grade);
await db.close();
process.exit(0);
