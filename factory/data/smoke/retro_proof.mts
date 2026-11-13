// Sandbox proof of the retrospective strand (upgrade item 26) on the Mac: never the live factory folder, never tick(),
// nothing published (DRY_RUN, Discord stubbed). Run every phase through ~/orch/macrun.sh.
//   node --import tsx data/smoke/retro_proof.mts <sandbox data dir> <out dir> script   the outline and the chapters
//   node --import tsx data/smoke/retro_proof.mts <sandbox data dir> <out dir> trim     keep the opening and chapter 1
//   node --import tsx data/smoke/retro_proof.mts <sandbox data dir> <out dir> render   voice, footage, render, QA
// The episode's id is kept in <out dir>/episode.txt. Every writer call goes to Codex (CODEX_CALLS=*): the Anthropic API
// is at its limit until 1 Dec. RETRO_SANDBOX_CHAPTERS picks the chapters written (default "1,story:1").
import fs from "node:fs";
import path from "node:path";
const [SB, OUT, PHASE] = process.argv.slice(2);
if (!SB || !OUT || !PHASE) throw new Error("usage: retro_proof.mts <sandbox data dir> <out dir> <script|trim|render>");
fs.mkdirSync(OUT, { recursive: true });
process.loadEnvFile(path.join(process.env.HOME!, "PulseFactory/factory/.env"));
const planFile = path.join(OUT, "retros.sandbox.json");
{
  // The repo's plan with San Andreas switched on and its first slot a day out, so nothing else is needed.
  const plan = JSON.parse(fs.readFileSync(new URL("../../retros.json", import.meta.url), "utf8"));
  plan.games[0].on = true;
  plan.first = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
}
Object.assign(process.env, {
  DATA_DIR: SB,
  DATABASE_URL: "",
  DRY_RUN: "true",
  CODEX_LLM: "true",
  CODEX_CALLS: "*",
  CODEX_VISION: "true",
  EVERGREEN_ENABLED: "false",
  WEEKLY_ENABLED: "false",
  GAMEPLAY_ENABLED: "false",
  EVERYGAME_ENABLED: "false",
  GUIDE_WEEKLY: "false",
  GAME_FETCH: "false",
  SHORT_RUN_FILE: "",
  NEWS_SLOTS: "03:00",
  BREAKING_SCORE_MIN: "1000",
  PORT: "0",
  LONGFORM_ENABLED: "true",
  DOC_ENABLED: "true",
  RETRO_ENABLED: "true",
  RETRO_FILE: planFile,
  RETRO_SANDBOX_CHAPTERS: process.env.RETRO_SANDBOX_CHAPTERS ?? "1,story:1",
  CHARACTER_QUOTES: "true",
  GAME_AUDIO_BED: "true",
});
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const { advance } = await import("../../src/pipeline.ts");
const { LANE_PRIORITY } = await import("../../src/lanes.ts");
const { getEpisode, createEpisode, logEvent } = await import("../../src/episodes.ts");
const { readRetroPlan, retroTopic } = await import("../../src/retrospective.ts");
const cfg = loadConfig();
const db = await openDb("", cfg.dataDir);
await migrate(db);
await db.query("DELETE FROM leases");
const s = createServices(db, cfg);
s.notify = async (m: any) => {
  console.log("DISCORD:", (m.content ?? m.embeds?.[0]?.title ?? "").slice(0, 300));
  return true;
};
{
  const { gameFetchPass } = await import("../../src/sceneindex/gamefetch.ts");
  const { windows } = await gameFetchPass(cfg);
  console.log("WINDOWS", JSON.stringify(windows.map((w) => ({ game: w.game, until: w.until }))));
}
const idFile = path.join(OUT, "episode.txt");
const save = (name: string, v: unknown) => fs.writeFileSync(path.join(OUT, name), typeof v === "string" ? v : JSON.stringify(v, null, 2));

async function run(id: string, until: string[], max: number): Promise<any> {
  const t0 = Date.now();
  let ep: any;
  for (let i = 0; i < max; i++) {
    await db.query("UPDATE episodes SET next_attempt_at = NULL WHERE id = $1", [id]);
    const cur = await getEpisode(db, id);
    if (!cur) break;
    await advance(s, cur);
    ep = await getEpisode(db, id);
    console.log(`step ${i}: status=${ep?.status} attempts=${ep?.attempts} err=${(ep?.last_error ?? "").slice(0, 300)} t=${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (!ep || until.includes(ep.status) || ["failed", "rejected"].includes(ep.status)) break;
  }
  return ep;
}

if (PHASE === "script") {
  // Everything else in the copied database is out of the way: only this episode moves.
  await db.query("UPDATE episodes SET status = 'published', next_attempt_at = NULL WHERE status NOT IN ('published','failed','rejected')");
  const plan = readRetroPlan(planFile)!;
  const topic = retroTopic(plan, plan.games[0]!);
  const id = `retro${Date.now().toString(36)}`;
  const slotAt = new Date(Date.now() + 3 * 86_400_000);
  await createEpisode(db, id, {
    hash: `documentary:retro-proof:${id}`,
    headline: topic.title_idea,
    items: [],
    sources: ["Wikipedia"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: new Date().toISOString(),
    score: 0,
    gameHint: topic.franchise,
  } as any, { lane: "longform", priority: LANE_PRIORITY.longform, slotAt });
  await db.query(`UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`, [id, JSON.stringify({ doc: true, topic })]);
  await logEvent(db, id, "selected", { headline: topic.title_idea, lane: "longform", documentary: true, retro: topic.retro?.key });
  fs.writeFileSync(idFile, id);
  const ep = await run(id, ["scripted"], 3);
  save("script_full.json", ep?.script_json ?? null);
  save("factcheck_full.json", ep?.factcheck_json ?? null);
  const ev = await db.query<{ kind: string; detail: unknown }>("SELECT kind, detail FROM events WHERE episode_id = $1 ORDER BY id", [id]);
  save("events_script.json", ev);
  console.log("RESULT", ep?.status, ep?.last_error ?? "");
} else if (PHASE === "trim") {
  const id = fs.readFileSync(idFile, "utf8").trim();
  const ep = (await getEpisode(db, id))!;
  const script = structuredClone(ep.script_json!) as any;
  // The opening and chapter 1: the beats before the second chapter card, the first entry, its quotes; the ending stays.
  const second = script.beats.findIndex((b: any, i: number) => i > 0 && b.visual?.kind === "chapter");
  const cut = second > 0 ? second : script.beats.length;
  script.beats = script.beats.slice(0, cut);
  const entries = [...(script.entries ?? [])].sort((a: any, b: any) => b.rank - a.rank).slice(0, 1);
  script.entries = entries.map((e: any) => ({ ...e, rank: 1 }));
  script.character_quotes = (script.character_quotes ?? []).filter((q: any) => q.beat < cut);
  delete script.open_loops;
  const fc = structuredClone(ep.factcheck_json) as any;
  fc.topic.retro.written = (fc.topic.retro.written ?? []).slice(0, 1);
  await db.query(
    `UPDATE episodes SET status = 'scripted', script_json = $2, factcheck_json = $3, assets_json = NULL, qa_json = NULL, attempts = 0, last_error = NULL, next_attempt_at = NULL WHERE id = $1`,
    [id, JSON.stringify(script), JSON.stringify(fc)],
  );
  save("script_render.json", script);
  const words = [script.hook, ...script.beats.map((b: any) => b.narration), script.pulse_take?.narration ?? ""].join(" ").split(/\s+/).filter(Boolean).length;
  console.log("TRIMMED", JSON.stringify({ beats: script.beats.length, quotes: script.character_quotes.length, words, minutes: Math.round((words / 150) * 10) / 10 }));
} else if (PHASE === "regather") {
  // The voice kept (no new ElevenLabs credits), the media and the plan dropped, so the next render gathers afresh.
  const id = fs.readFileSync(idFile, "utf8").trim();
  const ep = (await getEpisode(db, id))!;
  const a = structuredClone(ep.assets_json) as any;
  for (const k of ["images", "clips", "longPlan", "plan", "video", "poster", "thumbnail", "thumbs"]) delete a[k];
  await db.query(
    `UPDATE episodes SET status = 'voiced', assets_json = $2, qa_json = NULL, attempts = 0, last_error = NULL, next_attempt_at = NULL WHERE id = $1`,
    [id, JSON.stringify(a)],
  );
  const dir = path.join(SB, "episodes", id);
  for (const f of fs.readdirSync(dir)) if (/^entry_\d+$/.test(f)) fs.renameSync(path.join(dir, f), path.join(dir, `old_${f}_${Date.now()}`));
  console.log("REGATHER", id, Object.keys(a).join(","));
} else if (PHASE === "render") {
  const id = fs.readFileSync(idFile, "utf8").trim();
  const ep = await run(id, ["rendered", "approved", "awaiting_approval", "scheduled", "qa"], 8);
  const ev = await db.query<{ kind: string; detail: unknown }>("SELECT kind, detail FROM events WHERE episode_id = $1 ORDER BY id", [id]);
  save("events_render.json", ev);
  save("assets.json", ep?.assets_json ?? null);
  save("qa.json", ep?.qa_json ?? null);
  console.log("RESULT", ep?.status, ep?.last_error ?? "", path.join(SB, "episodes", id));
}
await db.close();
process.exit(0);
