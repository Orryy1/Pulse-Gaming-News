// Sandbox: an every-game Short (src/editorial/everygame.ts) through the real factory steps, one step at a time, in
// its own data folder. DRY_RUN and a stubbed Discord mean nothing leaves the sandbox; ORCH_CLIENT off means the
// render takes no priority-60 turn, so wrap the run in `orch.cmd run --class heavy ... --priority 20`.
//   node --import tsx data/smoke/everygame_short.mts <sandbox dir> [max steps] [plan index]
// EG_NO_RENDER=1 stops before the render and writes render_props.json (the footage plan as it would be drawn).
// EG_REGATHER=1 clears the gathered pictures first, keeping the script and the voice.
// EG_OUTLINE=1 also writes the long video's outline and chapter list (one more writer call).
const [SANDBOX, MAX, INDEX] = process.argv.slice(2);
process.loadEnvFile(process.env.SHOW_ENV ?? "C:/PulseFactory/factory/.env");
Object.assign(process.env, {
  DATA_DIR: SANDBOX,
  DRY_RUN: "true",
  CODEX_LLM: "false",
  MAC_RENDER_SHORTS: "false",
  SHORT_RUN_FILE: "",
  EVERYGAME_ENABLED: "true",
  EVERYGAME_FILE: "",
  EVERGREEN_ENABLED: "false",
  LONGFORM_ENABLED: "false",
  GAMEPLAY_ENABLED: "false",
  ORCH_CLIENT: "file:///C:/nonexistent/orch.mjs",
  PORT: "0",
});
const fs = await import("node:fs/promises");
const path = await import("node:path");
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const { createEveryGameShort, advance } = await import("../../src/pipeline.ts");
const { readEveryGamePlan } = await import("../../src/everygame.ts");
const { loadEveryGameRoster, auditEveryGameAssets } = await import("../../src/everygamestep.ts");
const { outlineEveryGame, validateEveryGameOutline, chapterList, rosterBrief } = await import("../../src/editorial/everygame.ts");
const { listEpisodes, getEpisode } = await import("../../src/episodes.ts");

await fs.mkdir(SANDBOX!, { recursive: true });
const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
const s = createServices(db, cfg);
s.notify = async (m: any) => {
  console.log("DISCORD:", m.content ?? m.embeds?.[0]?.title ?? "", (m.embeds?.[0]?.description ?? "").slice(0, 400));
  return true;
};
if (process.env.EG_NO_RENDER) {
  s.render = (async (o: any) => {
    await fs.writeFile(`${SANDBOX}/render_props.json`, JSON.stringify(o, null, 1));
    throw new Error("stopped before render (EG_NO_RENDER)");
  }) as any;
}
const entry = readEveryGamePlan(cfg.everyGameFile)[Number(INDEX ?? 0)]!;
let [ep] = await listEpisodes(db, 1);
if (!ep) {
  const roster = await loadEveryGameRoster(s, entry);
  await fs.writeFile(`${SANDBOX}/roster.json`, JSON.stringify(roster, null, 1));
  console.log(rosterBrief(roster, roster.entries));
  console.log("left out:", roster.dropped.map((d) => `${d.title} (${d.why})`).join("; "));
  const id = await createEveryGameShort(s, entry, new Date(s.now().getTime() + 2 * 3600_000));
  console.log("selected", id);
  if (!id) process.exit(2);
  ep = (await getEpisode(db, id))!;
}
if (process.env.EG_OUTLINE) {
  const roster = (ep.factcheck_json as any).every_game.roster;
  const notes = await s.research(entry.wiki ?? roster.series, `${roster.series} video game series`, 12000);
  let outline = await outlineEveryGame(s.llm, roster, entry.title, entry.angle, notes?.text ?? "");
  let problems = validateEveryGameOutline(outline, roster);
  if (problems.length) {
    console.log("outline problems, one rewrite:", problems);
    outline = await outlineEveryGame(s.llm, roster, entry.title, entry.angle, notes?.text ?? "", { feedback: problems });
    problems = validateEveryGameOutline(outline, roster);
  }
  await fs.writeFile(`${SANDBOX}/long_outline.json`, JSON.stringify({ title: entry.title, problems, chapters: chapterList(outline, roster), outline }, null, 1));
  console.log(`LONG OUTLINE "${entry.title}" problems=${JSON.stringify(problems)}\n${chapterList(outline, roster).join("\n")}`);
}
// EG_REGATHER=1: the pictures are gathered again (the script and the voice are kept).
if (process.env.EG_REGATHER && ep.assets_json) {
  const { images, clips, plan, officialTrailer, ...keep } = ep.assets_json as any;
  void images; void clips; void plan; void officialTrailer;
  await db.query("UPDATE episodes SET assets_json = $2 WHERE id = $1", [ep.id, JSON.stringify(keep)]);
  console.log("regather: pictures cleared, kept", Object.keys(keep).join(","));
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
const script = ep.script_json;
const assets = ep.assets_json ?? {};
const era = script?.every_game && assets.images ? auditEveryGameAssets(script, assets) : undefined;
// The footage plan: for each beat, the game, its year and hardware, what the plan shows and where it came from.
const plan = (assets as any).plan;
const beats = (script?.beats ?? []).map((b: any, i: number) => {
  const meta = script!.every_game!.beats[i]!;
  const shots = (plan?.shots ?? [])
    .filter((sh: any) => sh.segment === i + 1) // segment 0 is the hook; the beats follow in order
    .map((sh: any) => {
      const m = sh.media;
      const src = m.type === "image" ? assets.images?.[m.index] : m.type === "clip" ? assets.clips?.[m.index] : undefined;
      return { frames: [sh.start, sh.end], seconds: +((sh.end - sh.start) / 30).toFixed(2), type: m.type, file: src?.file, provenance: src?.provenance, beatIndex: src?.beatIndex };
    });
  return { beat: i + 1, title: meta.title, year: meta.year, platforms: meta.platforms, device: meta.device, handheld: meta.handheld, year_stamp: meta.stamp, line: b.narration, caption: b.visual.secondary, shows: era?.audit[i]?.shows, shots };
});
await fs.writeFile(`${SANDBOX}/script.json`, JSON.stringify({ script, factcheck: ep.factcheck_json, qa: ep.qa_json }, null, 1));
await fs.writeFile(`${SANDBOX}/footage_plan.json`, JSON.stringify({ title: script?.youtube.title, era_problems: era?.problems ?? null, dropped: era?.dropped ?? null, beats }, null, 1));
await db.close();
if (ep.status === "rendered") await fs.copyFile(path.join(cfg.dataDir, "episodes", ep.id, "short.mp4"), `${SANDBOX}/short.mp4`);
process.exit(0);
