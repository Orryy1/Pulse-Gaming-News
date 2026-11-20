// Dry run of the weekly guide (src/longguide.ts) and the funnel test (src/funnel.ts) in their own data folder.
//   plan:  node --import tsx data/smoke/longguide_dryrun.mts plan [guides.json]
//          the strand's next weeks: dates, fixed titles, frame problems and why each guide waits. No calls.
//   write: node --import tsx data/smoke/longguide_dryrun.mts write <sandbox> <guides.json> <footage library> [max steps]
//          the plan's first guide through the real documentary lane with GUIDE_WEEKLY on, DOC_SANDBOX_CHAPTERS=1 and
//          the render stubbed (render_input.json for showpiece_longrender.mts). Writes <sandbox>/script.json.
//   funnel: node --import tsx data/smoke/longguide_dryrun.mts funnel <sandbox> <sample long mp4> [max steps]
//          marks the sandbox's guide as published with the sample render as its video, then makes one funnel Short
//          from it (cut, copy, link line, render) with FUNNEL_TEST on and the arm forced by FUNNEL_SHARE (1: link).
const [MODE, ...ARGS] = process.argv.slice(2);
const fs = await import("node:fs/promises");

if (MODE === "plan") {
  const { readGuidePlan, guideTitle, guideFrameProblems, guideNotReady } = await import("../../src/longguide.ts");
  const { localTime, addDays } = await import("../../src/lanes.ts");
  const plan = readGuidePlan(ARGS[0] ?? "");
  if (!plan) process.exit(2);
  console.log(`${plan.game}: weekly from ${plan.first} at ${plan.slot}, made ${plan.make_hours_before} h ahead`);
  for (const g of plan.guides) {
    const t = guideTitle(plan, g);
    console.log(`- ${g.key}: "${t}" (${t.length} chars), thumb "${g.thumb}", on=${Boolean(g.on)}`);
    for (const p of guideFrameProblems(plan, g)) console.log(`    frame: ${p}`);
  }
  for (let w = 0; w < 6; w++) {
    const day = addDays(plan.first, w * 7);
    const at = localTime(day, plan.slot, "Europe/London");
    const ready = plan.guides.find((g) => !guideNotReady(plan, g, at, "Europe/London"));
    const why = plan.guides.map((g) => `${g.key}: ${guideNotReady(plan, g, at, "Europe/London") ?? "ready"}`);
    console.log(`week ${w + 1} ${day}: ${ready ? guideTitle(plan, ready) : "nothing ready"} | ${why.join("; ")}`);
  }
  process.exit(0);
}

const SANDBOX = ARGS[0]!;
process.loadEnvFile("C:/PulseFactory/factory/.env");
Object.assign(process.env, {
  DATA_DIR: SANDBOX,
  DRY_RUN: "true",
  CODEX_LLM: "true",
  CODEX_CALLS: "*",
  MAC_RENDER_SHORTS: "false",
  SHORT_RUN_FILE: "",
  EVERYGAME_ENABLED: "false",
  GAMEPLAY_ENABLED: "false",
  GAMEPLAY_ROOT: "",
  ORCH_CLIENT: "file:///C:/nonexistent/orch.mjs",
  PORT: "0",
  BIG_STORY_MODE: "off",
  CAPTURE_CHECKLIST: "false",
  CUTSCENE_FOOTAGE: "false",
  SPOILER_GUARD: "true",
  OFFICIAL_STILL_FRAMES: "8",
  DOC_SANDBOX_CHAPTERS: process.env.DOC_SANDBOX_CHAPTERS ?? "1",
  FRIEND_PASS: "documentary",
  LONG_GUIDE_FORMAT: "true",
  GUIDE_CHAPTER_ACTION: "true",
  GUIDE_WEEKLY: "true",
  GUIDE_OWN_FIRST: "true",
  LONG_YOU_PER_1000: "25",
  GUIDE_YOU_PER_1000: "35",
  LONG_SENTENCE_GATE: "14",
  LONG_HOOK_STACK: "5",
  LONG_OPEN_LOOPS_MAX: "8",
  LOOP_NAME_PAYOFF: "true",
  LONG_SAME_PICTURE_MAX_SECONDS: "12",
  LONG_CARD_SHARE: "0.3",
  CUTDOWN_SLOT: "15:30",
});
if (MODE === "write") {
  process.env.GUIDE_WEEKLY_FILE = ARGS[1]!;
  process.env.FOOTAGE_LIBRARY = ARGS[2]!;
}
if (MODE === "funnel") {
  process.env.FUNNEL_TEST = "true";
  process.env.FUNNEL_SHARE = process.env.FUNNEL_SHARE ?? "1";
}
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const { maybeSelectDocumentary, maybeSelectFunnelCut, advance } = await import("../../src/pipeline.ts");
const { listEpisodes, getEpisode, episodeDir } = await import("../../src/episodes.ts");
const { localTime } = await import("../../src/lanes.ts");
const { readGuidePlan } = await import("../../src/longguide.ts");

await fs.mkdir(SANDBOX, { recursive: true });
const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
const s = createServices(db, cfg);
s.notify = async (m: any) => {
  console.log("DISCORD:", m.content ?? m.embeds?.[0]?.title ?? "", (m.embeds?.[0]?.description ?? "").slice(0, 500));
  return true;
};
const step = async (ep: any, max: number, stop: string[]) => {
  const t0 = Date.now();
  for (let i = 0; i < max; i++) {
    await db.query("UPDATE episodes SET next_attempt_at = NULL WHERE id = $1", [ep.id]);
    ep = (await getEpisode(db, ep.id))!;
    if (stop.includes(ep.status)) break;
    const was = ep.status;
    const moved = await advance(s, ep);
    ep = (await getEpisode(db, ep.id))!;
    console.log(`step ${was} -> ${ep.status} moved=${moved} t=${((Date.now() - t0) / 1000).toFixed(0)}s err=${(ep.last_error ?? "").slice(0, 800)}`);
  }
  return ep;
};

if (MODE === "write") {
  const plan = readGuidePlan(ARGS[1]!)!;
  // One hour into the first guide's making window.
  const at = localTime(plan.first, plan.slot, cfg.timezone).getTime() - (plan.make_hours_before - 1) * 3600_000;
  const offset = at - Date.now();
  s.now = () => new Date(Date.now() + offset);
  s.renderLong = (async (o: any) => {
    await fs.writeFile(`${SANDBOX}/render_input.json`, JSON.stringify(o, null, 1));
    throw new Error("stopped before render (dry run)");
  }) as any;
  let [ep] = await listEpisodes(db, 1);
  if (!ep) {
    const id = await maybeSelectDocumentary(s);
    console.log("selected", id);
    if (!id) process.exit(2);
    ep = (await getEpisode(db, id))!;
  }
  ep = await step(ep, Number(ARGS[3] ?? 4), ["rendered", "failed", "rejected", "published"]);
  console.log("EPISODE", ep.id, ep.status);
  await fs.writeFile(`${SANDBOX}/script.json`, JSON.stringify({ script: ep.script_json, factcheck: ep.factcheck_json, assets: ep.assets_json }, null, 1));
}

if (MODE === "funnel") {
  const SAMPLE = ARGS[1]!;
  const eps = await listEpisodes(db, 20);
  const parent = eps.find((e: any) => e.lane === "longform")!;
  // The guide goes out: the sample render stands in for its video, published yesterday at the slot.
  const pdir = episodeDir(cfg, parent.id);
  await fs.copyFile(SAMPLE, `${pdir}/short.mp4`);
  const published = new Date(Date.now() - 20 * 3600_000);
  await db.query(
    `UPDATE episodes SET status = 'published', youtube_video_id = 'DRYRUNLONG1', publish_at = $2 WHERE id = $1`,
    [parent.id, published],
  );
  // Inside the cutdown slot's lead time today.
  const slot = localTime(new Date().toISOString().slice(0, 10), cfg.cutdownSlot, cfg.timezone).getTime();
  const offset = slot - 60 * 60_000 - Date.now();
  s.now = () => new Date(Date.now() + offset);
  let cut = eps.find((e: any) => e.lane === "cutdown");
  if (!cut) {
    const id = await maybeSelectFunnelCut(s);
    console.log("funnel cut selected", id);
    if (!id) process.exit(3);
    cut = (await getEpisode(db, id))!;
  }
  cut = await step(cut, Number(ARGS[2] ?? 4), ["rendered", "failed", "rejected", "published"]);
  console.log("FUNNEL", cut.id, cut.status, JSON.stringify(cut.script_json?.cutdown), cut.script_json?.youtube?.title);
  await fs.writeFile(`${SANDBOX}/funnel_script.json`, JSON.stringify({ script: cut.script_json, assets: cut.assets_json, qa: cut.qa_json }, null, 1));
}
await db.close();
process.exit(0);
