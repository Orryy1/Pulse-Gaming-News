// Showcase sandbox: the planned GTA VI Part 1 (launch_run.json doc entry) through the real documentary lane, with the
// launch settings from project_gta_launch, in its own data folder. DOC_SANDBOX_CHAPTERS keeps the writing to the first
// chapters. The render is captured for data/smoke/excerpt-style rendering of the opening only.
//   node --import tsx data/smoke/showpiece_doc.mts <sandbox> <run file> [max steps]
const [SANDBOX, RUN, MAX] = process.argv.slice(2);
process.loadEnvFile("C:/PulseFactory/factory/.env");
Object.assign(process.env, {
  DATA_DIR: SANDBOX,
  DRY_RUN: "true",
  CODEX_LLM: "false",
  MAC_RENDER_SHORTS: "false",
  SHORT_RUN_FILE: RUN,
  GAMEPLAY_ENABLED: "false",
  ORCH_CLIENT: "file:///C:/nonexistent/orch.mjs",
  PORT: "0",
  BIG_STORY_MODE: "off",
  DOC_SANDBOX_CHAPTERS: process.env.DOC_SANDBOX_CHAPTERS ?? "2",
  LONG_GUIDE_FORMAT: "true",
  GUIDE_CHAPTER_ACTION: "true",
  LONG_YOU_PER_1000: "25",
  GUIDE_YOU_PER_1000: "35",
  LONG_SENTENCE_GATE: "14",
  LONG_HOOK_STACK: "5",
  LONG_OPEN_LOOPS_MAX: "8",
  LOOP_NAME_PAYOFF: "true",
  LONG_VERDICT_STAMPS: "true",
  LONG_SAME_PICTURE_MAX_SECONDS: "12",
  LONG_CARD_SHARE: "0.3",
});
const fs = await import("node:fs/promises");
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const { maybeSelectDocumentary, advance } = await import("../../src/pipeline.ts");
const { listEpisodes, getEpisode } = await import("../../src/episodes.ts");
const { localTime } = await import("../../src/lanes.ts");

await fs.mkdir(SANDBOX!, { recursive: true });
const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
const s = createServices(db, cfg);
// One hour into the entry's making window.
const at = localTime("2026-11-13", "20:00", cfg.timezone).getTime() - 43 * 3600_000;
const offset = at - Date.now();
s.now = () => new Date(Date.now() + offset);
s.notify = async (m: any) => {
  console.log("DISCORD:", m.content ?? m.embeds?.[0]?.title ?? "", (m.embeds?.[0]?.description ?? "").slice(0, 500));
  return true;
};
if (process.env.SHOW_NO_RENDER)
  s.renderLong = (async (o: any) => {
    await fs.writeFile(`${SANDBOX}/render_input.json`, JSON.stringify(o, null, 1));
    throw new Error("stopped before render (SHOW_NO_RENDER)");
  }) as any;
let [ep] = await listEpisodes(db, 1);
if (!ep) {
  const id = await maybeSelectDocumentary(s);
  console.log("selected", id);
  if (!id) process.exit(2);
  ep = (await getEpisode(db, id))!;
}
const t0 = Date.now();
for (let i = 0; i < Number(MAX ?? 1); i++) {
  await db.query("UPDATE episodes SET next_attempt_at = NULL WHERE id = $1", [ep.id]);
  ep = (await getEpisode(db, ep.id))!;
  if (["rendered", "failed", "rejected", "published"].includes(ep.status)) break;
  const was = ep.status;
  const moved = await advance(s, ep);
  ep = (await getEpisode(db, ep.id))!;
  console.log(`step ${was} -> ${ep.status} moved=${moved} t=${((Date.now() - t0) / 1000).toFixed(0)}s err=${(ep.last_error ?? "").slice(0, 800)}`);
}
console.log("EPISODE", ep.id, ep.status);
await fs.writeFile(`${SANDBOX}/script.json`, JSON.stringify({ script: ep.script_json, factcheck: ep.factcheck_json }, null, 1));
await db.close();
process.exit(0);
