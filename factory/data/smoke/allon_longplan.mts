// Sandbox proof (claude/allon): a long video's plan with every pre-built switch on, from a copy of a sandbox long
// that is already scripted and voiced (no writer or voice spend). The episode goes back to "voiced" without its plan,
// the render step plans it again with the media it already has, and the render itself is stubbed: the props it would
// have drawn are written to long_props.json and the run stops. DRY_RUN; Discord stubbed.
//   node --import tsx data/smoke/allon_longplan.mts <sandbox copy dir> <episode id>
const [SANDBOX, ID] = process.argv.slice(2);
process.loadEnvFile(process.env.SHOW_ENV ?? "C:/PulseFactory/factory/.env");
if (process.env.SHOW_OVERLAY) {
  const { readFileSync } = await import("node:fs");
  for (const line of readFileSync(process.env.SHOW_OVERLAY, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]!] = m[2]!;
  }
}
Object.assign(process.env, {
  DATA_DIR: SANDBOX,
  DATABASE_URL: "",
  DRY_RUN: "true",
  CODEX_LLM: "true",
  CODEX_CALLS: "*",
  LONGFORM_ENABLED: "true",
  MAC_STILLS: "false",
  ORCH_CLIENT: "file:///C:/nonexistent/orch.mjs",
  PORT: "0",
  SERIES_COVER_STYLE: "strip",
  SERIES_EPISODE_NUMBERS: "true",
  SERIES_PLAYLISTS: "true",
  SHORT_SKELETONS: "true",
  DROP_ANGLE: "true",
});
const fs = await import("node:fs/promises");
const path = await import("node:path");
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const { advance } = await import("../../src/pipeline.ts");
const { getEpisode } = await import("../../src/episodes.ts");

const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
const s = createServices(db, cfg);
s.notify = async (m: any) => {
  console.log("DISCORD:", m.content ?? m.embeds?.[0]?.title ?? "");
  return true;
};
let props: any;
s.renderLong = (async (o: any) => {
  props = o;
  await fs.writeFile(path.join(SANDBOX!, "long_props.json"), JSON.stringify(o, null, 1));
  throw new Error("stopped before the long render (plan proof)");
}) as any;
let ep = (await getEpisode(db, ID!))!;
const { longPlan: _plan, video: _video, ...keep } = (ep.assets_json ?? {}) as any;
await db.query(
  "UPDATE episodes SET status = 'voiced', assets_json = $2, attempts = 0, next_attempt_at = NULL, last_error = NULL, slot_at = $3 WHERE id = $1",
  [ep.id, JSON.stringify(keep), new Date(Date.now() + 6 * 3600_000).toISOString()],
);
ep = (await getEpisode(db, ep.id))!;
const t0 = Date.now();
await advance(s, ep);
ep = (await getEpisode(db, ep.id))!;
console.log(`render step: ${ep.status} t=${((Date.now() - t0) / 1000).toFixed(0)}s err=${(ep.last_error ?? "").slice(0, 300)}`);
const plan = (ep.assets_json as any)?.longPlan;
const shots = plan?.shots ?? [];
const media = (ep.assets_json as any) ?? {};
const fileOf = (m: any) => (m?.type === "image" ? media.images?.[m.index]?.file : m?.type === "clip" ? media.clips?.[m.index]?.file : undefined);
const summary = {
  id: ep.id,
  title: ep.script_json?.youtube?.title,
  planned: !!plan,
  render_reached: !!props,
  shots: shots.length,
  seconds: media.durationSeconds ?? null,
  clip_shots: shots.filter((x: any) => x.media?.type === "clip").length,
  image_shots: shots.filter((x: any) => x.media?.type === "image").length,
};
console.log("SUMMARY", JSON.stringify(summary));
await fs.writeFile(
  path.join(SANDBOX!, "long_plan.json"),
  JSON.stringify({ summary, shots: shots.map((x: any) => ({ start: x.start, end: x.end, type: x.media?.type, file: fileOf(x.media) })) }, null, 1),
);
await db.close();
process.exit(0);
