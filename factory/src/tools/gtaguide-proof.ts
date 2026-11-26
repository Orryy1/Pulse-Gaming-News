// The GTA guide proof (GTA_GUIDES, upgrade queue item 58): one real guide made by the factory's own long lane in a
// sandbox, up to the render, and a 60 s excerpt of it. Run on the Mac mini, from a copy of the branch, through the
// Mac's turn-taking:
//   ~/orch/macrun.sh gtaguide-proof node --import tsx src/tools/gtaguide-proof.ts --env=<factory .env> //     --live-data=<live data dir> --out=<dir> [--seconds=60] [--kind=<kind>]
// The sandbox has its own database and data folder under <out>/data: the live database is never opened. The small
// folders the guide reads (the recordings' tags from the PC, the HUD readings, the stream asks) are copied in; the big
// read-mostly ones the footage gather needs (stream and scene indexes, the game library, press kits, store trailers,
// meaning vectors, maps) are linked, so a cache the gather refreshes there is shared with the live factory, as its own
// gathers would refresh it. The logo cache and everything else stay in the sandbox. DRY_RUN: nothing is uploaded. The
// writer takes the factory's own model route (Max plan when it is not paused, else Codex, the API key last). The
// render is cut to the first 60 s (item 1 is in the first line), then every frame is scanned for black and frozen
// frames and a contact sheet is made. Writes, under <out>: script.json, thumb*.jpg, excerpt.mp4, sheet.jpg, report.json.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const args = process.argv.slice(2);
const flag = (n: string) =>
  args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const out = path.resolve(flag("out") ?? "gtaguide-proof");
const envFile = flag("env");
const liveData = flag("live-data");
const seconds = Number(flag("seconds") ?? 60);
if (!envFile || !liveData) {
  console.error(
    "usage: gtaguide-proof.ts --env=<factory .env> --live-data=<live data dir> --out=<dir> [--seconds=60] [--kind=<kind>]",
  );
  process.exit(2);
}
const data = path.join(out, "data");
await fs.mkdir(data, { recursive: true });
process.loadEnvFile(envFile);
// The live data folder's read-only parts, linked into the sandbox (never the database, logs or episodes).
// Copied: small, and written by the live factory while this runs.
for (const d of ["vodremote", "hud", "streamasks"]) {
  const to = path.join(data, d);
  if (await fs.stat(to).catch(() => undefined)) continue;
  if (await fs.stat(path.join(liveData, d)).catch(() => undefined)) await fs.cp(path.join(liveData, d), to, { recursive: true });
}
// Linked: big and read-mostly (never the database, logs, episodes, tokens or the mention cache).
for (const d of ["vodindex", "sceneindex", "gamelib", "presskits", "storetrailers", "semantic", "gamemaps"]) {
  const link = path.join(data, d);
  if (await fs.lstat(link).catch(() => undefined)) continue;
  if (await fs.stat(path.join(liveData, d)).catch(() => undefined)) await fs.symlink(path.join(liveData, d), link);
}
Object.assign(process.env, {
  DATA_DIR: data,
  DATABASE_URL: "",
  DRY_RUN: "true",
  PORT: "0",
  LONGFORM_ENABLED: "true",
  LONGFORM_DAYS: "mon,tue,wed,thu,fri,sat,sun",
  LONGFORM_SKIP: "",
  LONG_LEAD_MINUTES: String(48 * 60),
  GTA_GUIDES: "true",
  GTA_GUIDE_SHARE: "1",
  AUTO_PUBLISH: "false",
  BACKUP_DIR: path.join(out, "backup"),
});

const { loadConfig } = await import("../config.ts");
const { openDb, migrate } = await import("../db.ts");
const { createServices } = await import("../services.ts");
const { maybeSelectLongform, tickLong } = await import("../pipeline.ts");
const { FFMPEG } = await import("../lib/bin.ts");
const { LONG_FPS } = await import("../render/longplan.ts");
const run = promisify(execFile);

const cfg = loadConfig();
const db = await openDb("", cfg.dataDir);
await migrate(db);
await db.query("DELETE FROM leases");
const s = createServices(db, cfg);
s.notify = async (m: { content?: string }) => {
  console.log("DISCORD:", (m.content ?? "").slice(0, 300));
  return true;
};
// The excerpt: the long render cut to its first `seconds` (the poster and the thumbnails are made as usual).
const renderLong = s.renderLong;
s.renderLong = (input) =>
  renderLong({ ...input, frameRange: [0, Math.round(seconds * LONG_FPS) - 1] });
const t0 = Date.now();
const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;

type Row = {
  id: string;
  status: string;
  last_error: string | null;
  script_json: any;
  assets_json: any;
  factcheck_json: any;
};
let [ep] = await db.query<Row>(
  `SELECT id, status, last_error, script_json, assets_json, factcheck_json FROM episodes WHERE lane = 'longform' ORDER BY created_at DESC LIMIT 1`,
);
if (!ep) {
  const id = await maybeSelectLongform(s);
  if (!id) throw new Error("no guide was selected");
  // --kind: a chosen guide kind for the proof instead of the picker's (the picker's choice is logged either way).
  const kind = flag("kind");
  if (kind)
    await db.query(
      `UPDATE episodes SET factcheck_json = jsonb_set(factcheck_json, '{gta_guide,kind}', to_jsonb($2::text)) WHERE id = $1`,
      [id, kind],
    );
  [ep] = await db.query<Row>(
    `SELECT id, status, last_error, script_json, assets_json, factcheck_json FROM episodes WHERE id = $1`,
    [id],
  );
}
console.log(
  "episode",
  ep!.id,
  ep!.status,
  JSON.stringify(ep!.factcheck_json?.gta_guide ?? {}),
);
for (let i = 0; i < 12; i++) {
  await db.query(
    `UPDATE episodes SET next_attempt_at = NULL, attempts = 0 WHERE id = $1 AND status NOT IN ('published','failed','rejected')`,
    [ep!.id],
  );
  await tickLong(s);
  [ep] = await db.query<Row>(
    `SELECT id, status, last_error, script_json, assets_json, factcheck_json FROM episodes WHERE id = $1`,
    [ep!.id],
  );
  console.log(
    `pass ${i}: ${ep!.status} ${(ep!.last_error ?? "").slice(0, 300)} t=${secs()}`,
  );
  const dir = path.join(cfg.dataDir, "episodes", ep!.id);
  const rendered = await fs
    .stat(path.join(dir, "render_raw.mp4"))
    .catch(() => undefined);
  if (
    rendered ||
    [
      "failed",
      "rejected",
      "awaiting_approval",
      "approved",
      "published",
    ].includes(ep!.status)
  )
    break;
}
const dir = path.join(cfg.dataDir, "episodes", ep!.id);
await fs.writeFile(
  path.join(out, "script.json"),
  JSON.stringify(ep!.script_json, null, 2),
);
const report: Record<string, unknown> = {
  episode: ep!.id,
  status: ep!.status,
  error: ep!.last_error,
  topic: ep!.factcheck_json?.gta_guide,
  title: ep!.script_json?.youtube?.title,
  items: ep!.script_json?.gta_guide?.items,
  thumb: ep!.script_json?.gta_guide?.thumb,
  evidence_lines: (ep!.factcheck_json?.evidence ?? []).length,
};
for (const f of [
  "thumb.jpg",
  "thumb_b.jpg",
  "thumb_c.jpg",
  "poster.jpg",
  "assets/guide_frame.jpg",
])
  await fs
    .copyFile(path.join(dir, f), path.join(out, path.basename(f)))
    .catch(() => undefined);
const raw = (await fs.stat(path.join(dir, "short.mp4")).catch(() => undefined))
  ? path.join(dir, "short.mp4")
  : path.join(dir, "render_raw.mp4");
if (await fs.stat(raw).catch(() => undefined)) {
  const excerpt = path.join(out, "excerpt.mp4");
  await run(FFMPEG, [
    "-loglevel",
    "error",
    "-y",
    "-i",
    raw,
    "-t",
    String(seconds),
    "-c",
    "copy",
    excerpt,
  ]);
  // Every frame's average brightness: black frames (under 16 of 255) and frozen runs (freezedetect, 0.5 s).
  const lumas = await run(
    FFMPEG,
    [
      "-hide_banner",
      "-i",
      excerpt,
      "-vf",
      "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
      "-f",
      "null",
      "-",
    ],
    {
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const y = [
    ...`${lumas.stdout}${lumas.stderr}`.matchAll(/YAVG=([\d.]+)/g),
  ].map((m) => Number(m[1]));
  const black = y.map((v, i) => [i, v] as const).filter(([, v]) => v < 16);
  const frozen = await run(
    FFMPEG,
    [
      "-hide_banner",
      "-i",
      excerpt,
      "-vf",
      "freezedetect=n=0.003:d=0.5",
      "-map",
      "0:v:0",
      "-f",
      "null",
      "-",
    ],
    {
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const freezes = [
    ...`${frozen.stdout}${frozen.stderr}`.matchAll(
      /freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g,
    ),
  ].map((m) => ({
    at: Number(m[1]),
    seconds: Number(m[2]),
  }));
  await run(FFMPEG, [
    "-loglevel",
    "error",
    "-y",
    "-i",
    excerpt,
    "-vf",
    "fps=1/3,scale=480:-2,tile=4x5:padding=6:color=black",
    "-frames:v",
    "1",
    path.join(out, "sheet.jpg"),
  ]);
  report.excerpt = {
    frames: y.length,
    black: black.length,
    blackFrames: black.slice(0, 20).map(([i]) => i),
    freezes,
  };
}
await fs.writeFile(
  path.join(out, "report.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
await db.close();
process.exit(0);
