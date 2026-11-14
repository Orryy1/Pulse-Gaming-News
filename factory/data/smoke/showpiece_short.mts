// Showcase sandbox: a planned Why Short (launch_run.json) through the real factory steps, one step at a time, in its
// own data folder. DRY_RUN and a stubbed Discord mean nothing leaves the sandbox; ORCH_CLIENT off means the render
// takes no priority-60 turn, so wrap the render step in `orch.cmd run ... --priority 20`.
//   node --import tsx data/smoke/showpiece_short.mts <sandbox dir> <run file> <date> <slot> [max steps]
const [SANDBOX, RUN, DATE, SLOT, MAX] = process.argv.slice(2);
process.loadEnvFile(process.env.SHOW_ENV ?? "C:/PulseFactory/factory/.env");
Object.assign(process.env, {
  DATA_DIR: SANDBOX,
  DRY_RUN: "true",
  CODEX_LLM: "false",
  MAC_RENDER_SHORTS: "false",
  SHORT_RUN_FILE: RUN,
  EVERGREEN_ENABLED: "false",
  LONGFORM_ENABLED: "false",
  GAMEPLAY_ENABLED: "false",
  ORCH_CLIENT: "file:///C:/nonexistent/orch.mjs",
  PORT: "0",
  ...(process.env.SHOW_ENV ? { LOCAL_VISION: "off", YTDLP_PATH: "yt-dlp" } : {}),
  OFFICIAL_STILL_FRAMES: "8",
  SHORT_VIVID: "true",
  SHORT_SUITE_SHARE: "1",
});
const fs = await import("node:fs/promises");
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const { selectRunWhy, advance } = await import("../../src/pipeline.ts");
const { readRun, whyRunEntry } = await import("../../src/shortrun.ts");
const { listEpisodes, getEpisode } = await import("../../src/episodes.ts");
const { localTime } = await import("../../src/lanes.ts");

await fs.mkdir(SANDBOX!, { recursive: true });
const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
const s = createServices(db, cfg);
// The clock sits two hours before the slot, inside its lead time.
const due = localTime(DATE!, SLOT!, cfg.timezone);
const offset = due.getTime() - 2 * 3600_000 - Date.now();
s.now = () => new Date(Date.now() + offset);
s.notify = async (m: any) => {
  console.log("DISCORD:", m.content ?? m.embeds?.[0]?.title ?? "", (m.embeds?.[0]?.description ?? "").slice(0, 400));
  return true;
};
if (process.env.SHOW_NO_RENDER) {
  s.render = (async (o: any) => {
    await fs.writeFile(`${SANDBOX}/render_props.json`, JSON.stringify(o, null, 1));
    throw new Error("stopped before render (SHOW_NO_RENDER)");
  }) as any;
}
if (process.env.SHOW_RENDER === "mac") {
  const { macRender, syncCode } = await import("./showpiece_macrender.mts");
  if (!process.env.SHOW_NOSYNC) syncCode();
  s.render = macRender as any;
}
let [ep] = await listEpisodes(db, 1);
if (!ep) {
  let id: string | undefined;
  if (process.env.SHOW_TOPIC) {
    // A ranking topic as the editor would pick it (createEvergreen), so the rest is the lane's own code.
    const topic = JSON.parse(process.env.SHOW_TOPIC);
    const { createEpisode } = await import("../../src/episodes.ts");
    id = `ep_show_${Date.now()}`;
    const now = s.now();
    await createEpisode(
      db,
      id,
      { hash: `evergreen:${topic.format}:${topic.theme}`, headline: topic.title_idea, items: [], sources: ["Steam"], hasOfficial: true, corroborated: true, rumourSignals: false, newestAt: now.toISOString(), score: 0, gameHint: topic.theme } as any,
      { lane: "evergreen", priority: 2, slotAt: due },
    );
    await db.query("UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1", [id, JSON.stringify({ topic })]);
  } else id = await selectRunWhy(s, whyRunEntry(readRun(cfg.shortRunFile), due, cfg.timezone)!, due);
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
  console.log(`step ${was} -> ${ep.status} moved=${moved} t=${((Date.now() - t0) / 1000).toFixed(0)}s err=${(ep.last_error ?? "").slice(0, 600)}`);
}
console.log("EPISODE", ep.id, ep.status);
await fs.writeFile(`${SANDBOX}/script.json`, JSON.stringify({ script: ep.script_json, factcheck: ep.factcheck_json, qa: ep.qa_json }, null, 1));
await db.close();
if (ep.status === "rendered") await fs.copyFile(`${cfg.dataDir}/episodes/${ep.id}/short.mp4`, `${SANDBOX}/short.mp4`);
process.exit(0);
