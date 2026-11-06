// Excerpt renders of the rehearsal's long episode on the Mac, to find the frames (and the shot) that abort
// Chrome's GPU process when GPU rasterisation is on (1 Nov 2026: Skia Graphite's SkAbort in
// graphite::Transform::mapRect under clipRRect, ~10 minutes into a long render). Run on the Mac only, in
// the rehearsal sandbox (~/PulseFactory/rehearsal, a render-only .env), never beside the factory service.
//   node --import tsx mac/gpubisect.mts dump [episode id]    the long render's input, as the pipeline builds
//                                                             it, saved to rehearsal/gpubisect/input.json
//   node --import tsx mac/gpubisect.mts shots <from> <to>    the plan's shots that overlap those frames
//   node --import tsx mac/gpubisect.mts render <from> <to> [--conc=N] [--raster=off] [--keep=a,b] [--drop=a,b]
//        renders the frames with GPU rasterisation on (unless --raster=off) and prints the crash count;
//        --keep / --drop keep or blank the plan's shots by index (the others play the plain backdrop)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const DATA = path.join(HOME, "PulseFactory", "rehearsal");
const OUT = path.join(DATA, "gpubisect");
fs.mkdirSync(OUT, { recursive: true });
process.loadEnvFile(path.join(DATA, ".env"));
const argv = process.argv.slice(2);
const flag = (k: string) =>
  argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const [mode, a1, a2] = argv.filter((a) => !a.startsWith("--"));
// Before the renderer is imported: render.ts reads this at load.
process.env.REMOTION_GPU_RASTER = flag("raster") === "off" ? "false" : "true";
const FAR = `${String((new Date().getUTCHours() + 12) % 24).padStart(2, "0")}:00`;
Object.assign(process.env, {
  DATA_DIR: DATA,
  DRY_RUN: "true",
  LONGFORM_ENABLED: "true",
  GAMEPLAY_ENABLED: "false",
  EVERGREEN_ENABLED: "false",
  GRAPHICS_PREPASS: "false",
  NEWS_SLOTS: FAR,
  ...Object.fromEntries(
    [
      "WHY_SLOT",
      "DEALS_SLOT",
      "EVERGREEN_SLOT",
      "WEEKLY_SLOT",
      "ENGAGE_SLOT",
      "CUTDOWN_SLOT",
      "DOC_SLOT",
      "GAMEPLAY_SLOTS",
    ].map((k) => [k, FAR]),
  ),
  BREAKING_SCORE_MIN: "1000",
  PORT: "0",
});
const INPUT = path.join(OUT, "input.json");

if (mode === "dump") {
  const { loadConfig } = await import("../src/config.ts");
  const { openDb, migrate } = await import("../src/db.ts");
  const { createServices } = await import("../src/services.ts");
  const { tickLong } = await import("../src/pipeline.ts");
  const cfg = loadConfig();
  const db = await openDb(cfg.databaseUrl, cfg.dataDir);
  await migrate(db);
  await db.query("DELETE FROM leases");
  // Named, never "the latest long": each sandbox episode has its own frames, and the logs' crash frames are
  // the Vice City documentary's (a first version dumped the newest episode instead, 1 Nov 2026).
  const id = a1 ?? "ep_20261027_865858f8";
  await db.query(
    "UPDATE episodes SET status = 'published', next_attempt_at = NULL WHERE id <> $1 AND status NOT IN ('published','failed','rejected')",
    [id],
  );
  const [t] = await db.query<{ id: string }>(
    `UPDATE episodes SET status = 'voiced', attempts = 0, next_attempt_at = NULL, last_error = NULL, qa_json = NULL
       WHERE id = $1 AND assets_json ? 'longPlan' RETURNING id`,
    [id],
  );
  if (!t) throw new Error("that long episode, with a plan, is not in the sandbox");
  const s = createServices(db, cfg);
  s.notify = async () => true;
  s.renderLong = async (input) => {
    fs.writeFileSync(INPUT, JSON.stringify(input));
    console.log("dumped", t.id, "to", INPUT);
    throw new Error("dumped");
  };
  await tickLong(s).catch(() => undefined);
  await db.query(
    "UPDATE episodes SET status = 'published', attempts = 0, last_error = NULL WHERE id = $1",
    [t.id],
  );
  await db.close();
  process.exit(fs.existsSync(INPUT) ? 0 : 1);
}

type Input = import("../src/render/render.ts").LongRenderInput;
const input = JSON.parse(fs.readFileSync(INPUT, "utf8")) as Input;
const from = Number(a1);
const to = Number(a2);
const plan = (
  input.props as { plan?: { shots: Array<Record<string, unknown>> } }
).plan;

if (mode === "shots") {
  for (const [i, s] of (plan?.shots ?? []).entries()) {
    const start = s.start as number;
    const end = s.end as number;
    if (end > from && start <= to)
      console.log(i, start, end, JSON.stringify(s).slice(0, 400));
  }
  process.exit(0);
}

if (mode === "render") {
  const { getBundle, serveDir, longProps } =
    await import("../src/render/render.ts");
  const { selectComposition, renderMedia } = await import("@remotion/renderer");
  const serveUrl = await getBundle();
  const files = await serveDir(input.episodeDir);
  const props = longProps(files.url, serveUrl, input.props);
  const keep = flag("keep")?.split(",").map(Number);
  const drop = flag("drop")?.split(",").map(Number);
  if ((keep || drop) && props.plan) {
    // A blanked shot keeps its timing and plays the plain theme plate.
    props.plan = {
      ...props.plan,
      shots: props.plan.shots.map((s, i) =>
        (keep && !keep.includes(i)) || drop?.includes(i)
          ? ({
              ...s,
              media: { type: "plate", index: 0 },
              move: "settle",
            } as typeof s)
          : s,
      ),
    };
  }
  const composition = await selectComposition({
    serveUrl,
    id: "PulseLong",
    inputProps: props,
  });
  const tag = `${from}_${to}${flag("tag") ? "_" + flag("tag") : ""}`;
  const logFile = path.join(OUT, `r_${tag}.log`);
  const logs = fs.createWriteStream(logFile);
  let crashes = 0;
  const t0 = Date.now();
  // Remotion logs through console; its browser-crash retries arrive as warnings.
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ["log", "warn", "error"] as const)
    console[k] = (...a: unknown[]) => {
      const line = a.map(String).join(" ");
      if (/browser crashed|Target closed|SkAbort|GPU process/i.test(line))
        crashes++;
      logs.write(line + "\n");
      if (/SkAbort|crashed|GPU process|exited/i.test(line))
        orig.log(line.slice(0, 300));
    };
  let err: unknown;
  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: 20,
      outputLocation: path.join(OUT, `r_${tag}.mp4`),
      inputProps: props,
      concurrency: Number(flag("conc") ?? 6),
      chromiumOptions: { gl: "angle" },
      frameRange: [from, to],
      timeoutInMilliseconds: 180_000,
      logLevel: "verbose",
      muted: true,
    });
  } catch (e) {
    err = e;
  }
  Object.assign(console, orig);
  logs.end();
  await files.close();
  const crashLines = fs
    .readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => /SkAbort|mapRect|crashed|GPU process/i.test(l));
  console.log(
    "RESULT",
    JSON.stringify({
      from,
      to,
      raster: process.env.REMOTION_GPU_RASTER,
      seconds: Math.round((Date.now() - t0) / 1000),
      crashes,
      crashLines: crashLines.length,
      error: err ? String(err).slice(0, 200) : null,
    }),
  );
  process.exit(0);
}
console.log(
  "usage: gpubisect.mts dump | shots <from> <to> | render <from> <to>",
);
