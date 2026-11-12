// Series proof (format redesign plan items 3 and 4): numbered Why Shorts and GTA File parts through the real
// selection, writer and fact check, in a sandbox database. Nothing is voiced, rendered or uploaded: each episode takes
// only its script step. DRY_RUN, a stubbed Discord and an embedded database keep everything inside the sandbox.
//   node --import tsx data/smoke/series_scripts.mts <sandbox dir> <out dir> <why|file> <count>
const [SANDBOX, OUT, KIND, COUNT] = process.argv.slice(2);
process.loadEnvFile(process.env.SHOW_ENV ?? "C:/PulseFactory/factory/.env");
Object.assign(process.env, {
  DATA_DIR: SANDBOX,
  DATABASE_URL: "",
  DRY_RUN: "true",
  CODEX_LLM: "false",
  CODEX_CALLS: "",
  MAC_RENDER_SHORTS: "false",
  SHORT_RUN_FILE: "",
  EVERGREEN_ENABLED: "false",
  LONGFORM_ENABLED: "false",
  GAMEPLAY_ENABLED: "false",
  ORCH_CLIENT: "file:///C:/nonexistent/orch.mjs",
  PORT: "0",
  WHY_ENABLED: "true",
  WHY_DAYS: "mon,tue,wed,thu,fri,sat,sun",
  WHY_SLOTS: "12:00,18:30",
  WHY_SERIAL_ENABLED: "true",
  WHY_TARGET_SECONDS: "45-60",
  WHY_HOME_SHARE: "1",
  SERIES_GTA_FILE_ENABLED: KIND === "file" ? "true" : "false",
  SERIES_GTA_FILE_SLOT: "18:30",
  SERIES_GTA_FILE_RUN_FILE: new URL("../../gta_file_run.json", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
  DEMAND_CHECK: "false",
});
const fs = await import("node:fs/promises");
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices } = await import("../../src/services.ts");
const { maybeSelectWhy, advance } = await import("../../src/pipeline.ts");
const { getEpisode } = await import("../../src/episodes.ts");
const { narrationOf } = await import("../../src/editorial/schema.ts");

await fs.mkdir(SANDBOX!, { recursive: true });
await fs.mkdir(OUT!, { recursive: true });
const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl, cfg.dataDir);
await migrate(db);
const s = createServices(db, cfg);
s.notify = async (m: any) => {
  console.log("DISCORD:", m.content ?? m.embeds?.[0]?.title ?? "");
  return true;
};
const days = ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"];
for (let i = 0; i < Number(COUNT ?? 3); i++) {
  // The clock sits 90 minutes before the slot (GMT in late November), inside its lead time.
  const at = KIND === "file" ? `${days[i]}T17:00:00Z` : `${days[i]}T10:30:00Z`;
  const fixed = new Date(at).getTime();
  const start = Date.now();
  s.now = () => new Date(fixed + (Date.now() - start));
  const id = await maybeSelectWhy(s);
  console.log("selected", at, id);
  if (!id) continue;
  let ep = (await getEpisode(db, id))!;
  await advance(s, ep);
  ep = (await getEpisode(db, id))!;
  const sc = ep.script_json;
  const name = KIND === "file" ? `gta-file-part-${ep.story_json.gtaFile?.part}` : `why-${ep.story_json.why?.serial?.number}`;
  const words = sc ? narrationOf(sc).split(/\s+/).filter(Boolean).length : 0;
  const summary = {
    status: ep.status,
    last_error: ep.last_error,
    hash: ep.story_hash,
    serial: ep.story_json.why?.serial ?? null,
    gta_file: ep.story_json.gtaFile ?? null,
    title: sc?.youtube.title,
    words,
    seconds_at_2_6_wps: Math.round(words / 2.6),
    factcheck_verdict: (ep.factcheck_json as any)?.verdict,
    factcheck_blockers: ((ep.factcheck_json as any)?.issues ?? []).filter((x: any) => x.severity === "blocker"),
  };
  await fs.writeFile(`${OUT}/${name}.json`, JSON.stringify({ summary, sources: ep.story_json.items.map((x: any) => x.url), script: sc, factcheck: ep.factcheck_json }, null, 1));
  await fs.writeFile(
    `${OUT}/${name}.txt`,
    [`${summary.title}`, `status ${summary.status}; fact check ${summary.factcheck_verdict}; ${words} words, about ${summary.seconds_at_2_6_wps} s`, "", sc ? narrationOf(sc) : `(no script: ${ep.last_error})`].join("\n"),
  );
  console.log(name, JSON.stringify(summary));
}
await db.close();
process.exit(0);
