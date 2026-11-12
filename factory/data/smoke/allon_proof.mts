// Sandbox proof with every pre-built switch on (claude/allon, 12 Nov 2026): a news Short, a Why Short (the serial) and
// a GTA File part through the real selection, writer, fact check, voice, footage and render, in a sandbox database.
// DRY_RUN and a stubbed Discord keep everything inside the sandbox; ORCH_CLIENT off means the render takes no
// priority-60 turn, so run the render phase inside `orch.cmd run --class heavy ... --priority 20`.
//   node --import tsx data/smoke/allon_proof.mts <sandbox dir> <news|why|file> <until: voiced|rendered>
// Claude is at its spend limit: every writer call goes to Codex (CODEX_CALLS=*).
const [SANDBOX, KIND, UNTIL] = process.argv.slice(2);
process.loadEnvFile(process.env.SHOW_ENV ?? "C:/PulseFactory/factory/.env");
// SHOW_OVERLAY: the live Mac's behaviour settings (no secrets, no paths), laid over the PC .env so the sandbox writes
// and draws like the live factory.
if (process.env.SHOW_OVERLAY) {
  const { readFileSync } = await import("node:fs");
  for (const line of readFileSync(process.env.SHOW_OVERLAY, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]!] = m[2]!;
  }
}
const day = new Date().toISOString().slice(0, 10);
const slotAt = new Date(Math.ceil((Date.now() + 70 * 60_000) / 300_000) * 300_000);
const newsSlot = process.env.PROOF_NEWS_SLOT ?? slotAt.toISOString().slice(11, 16);
Object.assign(process.env, {
  DATA_DIR: SANDBOX,
  DATABASE_URL: "",
  DRY_RUN: "true",
  CODEX_LLM: "true",
  CODEX_CALLS: "*",
  MAC_RENDER_SHORTS: "false",
  EVERGREEN_ENABLED: "false",
  LONGFORM_ENABLED: "false",
  GAMEPLAY_ENABLED: "false",
  EVERYGAME_ENABLED: "false",
  ORCH_CLIENT: "file:///C:/nonexistent/orch.mjs",
  PORT: "0",
  // ---- everything switched on (the list in the allon report)
  SHORT_LENGTHS: "news=30-35,why=45-60",
  SHORT_MIN_SECONDS: "30",
  INSTAGRAM_MAX_SECONDS: "35",
  SHORT_SKELETONS: "true",
  SHORT_ARGUES_CHECK: "true",
  DROP_ANGLE: "true",
  DROP_ANGLE_HOURS: "12",
  RUMOUR_SHARE: "0",
  NEWS_LATE_SLOT_ENABLED: "false",
  BREAKING_HOME_ONLY: "true",
  NEWS_SEGMENT: "true",
  NEWS_SEGMENT_SERIES: "true",
  SERIES_NEXT_LINE: "true",
  WHY_ENABLED: "true",
  WHY_SERIAL_ENABLED: "true",
  WHY_TARGET_SECONDS: "45-60",
  WHY_HOME_SHARE: "0.5",
  SERIES_GTA_FILE_ENABLED: "true",
  SERIES_GTA_FILE_SLOT: "18:30",
  SERIES_GTA_FILE_RUN_FILE: "gta_file_run.json",
  SERIES_COVER_STYLE: "strip",
  SERIES_EPISODE_NUMBERS: "true",
  SERIES_PLAYLISTS: "true",
  // The launch run is planned to 21 Nov; the series proofs are for after it.
  SHORT_RUN_FILE: "",
  // A news Short is made from today's real feeds: its slot is set 70 minutes ahead of the real clock (GMT in November).
  ...(KIND === "news" ? { NEWS_SLOTS: newsSlot } : {}),
});
const fs = await import("node:fs/promises");
const path = await import("node:path");
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const { discoverTick, maybeSelect, maybeSelectWhy, advance } = await import("../../src/pipeline.ts");
const { listEpisodes, getEpisode } = await import("../../src/episodes.ts");
const { narrationOf } = await import("../../src/editorial/schema.ts");

await fs.mkdir(SANDBOX!, { recursive: true });
const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
const s = createServices(db, cfg);
s.notify = async (m: any) => {
  console.log("DISCORD:", m.content ?? m.embeds?.[0]?.title ?? "", (m.embeds?.[0]?.description ?? "").slice(0, 300));
  return true;
};
// The clock: 90 minutes before the slot (GMT in November), inside its lead time. The GTA File's part 1 is dated 22 Nov.
const at =
  KIND === "file" ? "2026-11-22T17:00:00Z" : KIND === "why" ? `${day}T10:30:00Z` : undefined;
let [ep] = await listEpisodes(db, 5);
// A pick the fact check dropped: select again in the same sandbox, so the editor knows what was dropped.
if (ep && ["rejected", "failed"].includes(ep.status) && process.env.PROOF_RESELECT) ep = undefined as any;
if (!ep) {
  if (at) {
    const fixed = new Date(at).getTime();
    const start = Date.now();
    s.now = () => new Date(fixed + (Date.now() - start));
  }
  if (KIND === "news") console.log("discovered", await discoverTick(s), "stories; news slot", newsSlot);
  const id = KIND === "news" ? await maybeSelect(s) : await maybeSelectWhy(s);
  console.log("selected", at, id);
  if (!id) process.exit(2);
  ep = (await getEpisode(db, id))!;
} else if (at || ep.slot_at) {
  // Later phases keep the selection's clock, so the slot is still ahead (a news Short's: 70 minutes before its slot).
  const fixed = at ? Date.parse(at) : Date.parse(ep.slot_at!) - 70 * 60_000;
  const start = Date.now();
  s.now = () => new Date(fixed + (Date.now() - start));
}
const order = ["selected", "scripted", "voiced", "rendered"];
const t0 = Date.now();
for (let i = 0; i < 6; i++) {
  await db.query("UPDATE episodes SET next_attempt_at = NULL WHERE id = $1", [ep.id]);
  ep = (await getEpisode(db, ep.id))!;
  if (!order.includes(ep.status) || order.indexOf(ep.status) >= order.indexOf(UNTIL ?? "voiced")) break;
  const was = ep.status;
  const moved = await advance(s, ep);
  ep = (await getEpisode(db, ep.id))!;
  console.log(`step ${was} -> ${ep.status} moved=${moved} t=${((Date.now() - t0) / 1000).toFixed(0)}s err=${(ep.last_error ?? "").slice(0, 600)}`);
  if (!moved && ep.status === was) break;
}
const sc = ep.script_json;
const words = sc ? narrationOf(sc).split(/\s+/).filter(Boolean).length : 0;
const summary = {
  id: ep.id,
  status: ep.status,
  lane: ep.lane,
  last_error: ep.last_error,
  title: sc?.youtube.title,
  series: sc?.series ?? null,
  next_line: sc?.next_line ?? null,
  skeleton: sc?.skeleton ?? null,
  serial: ep.story_json?.why?.serial ?? null,
  gta_file_part: ep.story_json?.gtaFile?.part ?? null,
  words,
  factcheck: (ep.factcheck_json as any)?.verdict ?? null,
  audio_seconds: (ep.assets_json as any)?.audio?.duration ?? (ep.assets_json as any)?.durationSeconds ?? null,
};
console.log("SUMMARY", JSON.stringify(summary));
await fs.writeFile(
  path.join(SANDBOX!, `${KIND}_summary.json`),
  JSON.stringify({ summary, script: sc, factcheck: ep.factcheck_json, qa: ep.qa_json, sources: ep.story_json?.items?.map((x: any) => x.url) }, null, 1),
);
await db.close();
if (ep.status === "rendered") await fs.copyFile(path.join(cfg.dataDir, "episodes", ep.id, "short.mp4"), path.join(SANDBOX!, `${KIND}.mp4`));
process.exit(0);
