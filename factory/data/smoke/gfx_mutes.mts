// Re-measures the graphics check on a real documentary from a database COPY (1 Nov 2026 graphics-mutes work):
// rebuilds the PulseLong props the render step builds with every graphic restored (no mutes), lists the checks
// the stills pre-pass would make (src/qa/graphicscheck.ts graphicChecks), renders the chosen ones as stills at
// their settled frames, and with --judge sends them to the same vision checker in the same batches of eight.
// It also prints which style drew each graphic (Long.tsx debugGraphics), for grouping the faults by component.
//
// node --import tsx data/smoke/gfx_mutes.mts [--db data/smoke/dbcopy/db] [--ep ep_20261027_865858f8]
//   [--keys 0:9,1:19 | --faulted | --passed N | --all] [--scale 0.28125] [--out <dir>] [--judge] [--tag before] [--old-timing]
//   [--also compare,kinetic] [--skip-chapters 4,5] [--before-fit]
// --also adds every check of those graphic kinds or filler families, to see that fixes did not break good ones.
// --skip-chapters keeps --also out of chapters whose words are the fault (FFXIV's writer's notes), --before-fit draws with GRAPHICS_FIT off.
// --faulted: every key the episode's last stills pre-pass muted (its graphics_prepass event).
// --judge reads only the Claude key from the live factory/.env (never written) and records its spend in the copy.
// The episode folder is only read (served over loopback); nothing is written to it or to the live database.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  openBrowser,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { getBundle, longProps, serveDir } from "../../src/render/render.ts";
import { buildSegments } from "../../src/render/timeline.ts";
import {
  buildLongPlan,
  momentKeys,
  momentWindows,
  openChaptersAtBreaks,
} from "../../src/render/longplan.ts";
import {
  chapterSentences,
  photoCredit,
  segmentInputs,
  variantOf,
} from "../../src/pipeline.ts";
import { coldOpenLine, coldOpenTiming } from "../../src/render/bookends.ts";
import { graphicDrawsFor } from "../../src/render/gfxdraws.ts";
import { wholeLineFiller } from "../../src/render/fillerplan.ts";
import { loopsOfScript } from "../../src/editorial/documentary.ts";
import { parseCameraSetting } from "../../src/render/camera.ts";
import {
  checkFrame,
  graphicChecks,
  GRAPHICS_BATCH,
} from "../../src/qa/graphicscheck.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")
    ? args[i + 1]!
    : fallback;
};
const DB = path.resolve(flag("db", "data/smoke/dbcopy/db"));
if (
  path
    .resolve(DB)
    .toLowerCase()
    .startsWith(path.resolve("C:/PulseFactory/factory/data/db").toLowerCase())
)
  throw new Error("that is the live database; copy it first");
const EP = flag("ep", "ep_20261027_865858f8");
const OUT = path.resolve(flag("out", "data/smoke/gfx_mutes_out"));
const TAG = flag("tag", "now");
const SCALE = Number(flag("scale", String(540 / 1920)));
const DIR = `C:/PulseFactory/factory/data/episodes/${EP}`;
fs.mkdirSync(OUT, { recursive: true });
process.env.DATA_DIR = path.dirname(DB);

const db = new PGlite(DB);
const row = (
  await db.query<any>(
    `SELECT script_json, assets_json FROM episodes WHERE id = $1`,
    [EP],
  )
).rows[0];
const lastPrepass = (
  await db.query<any>(
    `SELECT detail FROM events WHERE episode_id = $1 AND kind = 'graphics_prepass' ORDER BY id DESC LIMIT 1`,
    [EP],
  )
).rows[0]?.detail;
await db.close();
const script = row.script_json;
const assets = row.assets_json;
const LONG_FPS = 30;
const duration = (assets.durationSeconds ?? 300) + 6;
const words = assets.words ?? [];
const segments = openChaptersAtBreaks(
  buildSegments(segmentInputs(script, Boolean(assets.desk)), words, duration),
  assets.breaks,
);
const variant = variantOf(EP);
const images = (assets.images ?? []).map((i: any) => ({
  file: i.file,
  kind: i.kind,
  aspect: i.aspect,
  beatIndex: i.beatIndex,
  credit: photoCredit(i),
  moment: i.moment,
  label: i.label,
  layers: i.layers,
}));
const fitOn = !args.includes("--before-fit");
const moments = [...(script.entries ?? [])]
  .sort((a: any, b: any) => b.rank - a.rank)
  .map((e: any) => e.moments ?? [])
  // As the render step reads them with GRAPHICS_FIT on: a kinetic card from an older plan is made whole.
  .map((ms: any[]) =>
    ms.map((m: any) =>
      m.filler && fitOn
        ? { ...m, filler: wholeLineFiller(m.filler, m.emphasis) }
        : m,
    ),
  );
const clips = (assets.clips ?? []).map((c: any) => ({
  file: c.file,
  durationSeconds: c.durationSeconds,
  beatIndex: c.beatIndex,
  role: c.role,
  moment: c.moment,
  credit: c.credit,
  audio: c.audio,
  label: c.label,
  span: c.span,
}));
// Every graphic and filler restored, as before the pre-pass muted any: the plan is made again with the fillers.
const craft = {
  rhythm: true,
  entryPace: false,
  bookend: true,
  coldOpen: true,
  titleDrop: true,
  chapterIndex: true,
};
const plan = buildLongPlan({
  segments,
  words,
  durationSeconds: duration,
  images: images.map((i: any) => ({
    kind: i.kind,
    aspect: i.aspect,
    beatIndex: i.beatIndex,
    moment: i.moment,
    file: i.file,
  })),
  clips: clips.map((c: any) => ({
    durationSeconds: c.durationSeconds,
    beatIndex: c.beatIndex,
    role: c.role,
    moment: c.moment,
    span: c.span,
  })),
  noRepeats: true,
  variant,
  realPinnedOnly: true,
  momentCounts: moments.map((m: any[]) => m.length),
  momentKeys: moments.map((e: any[]) => e.map(momentKeys)),
  momentFillers: moments.map((e: any[]) => e.map((m: any) => m.filler)),
  momentShows: moments.map((e: any[], i: number) => {
    const said = chapterSentences(script, i);
    return e.map(
      (m: any, k: number) =>
        `${said[k] ?? ""} ${m.show} ${m.person ?? ""} ${m.keywords?.join(" ") ?? ""}`,
    );
  }),
  takeEntry: script.take_entry,
  rhythm: craft.rhythm,
  entryPace: craft.entryPace,
  bookend: craft.bookend,
  coldOpenFrames: coldOpenTiming(LONG_FPS).frames,
});
const props = {
  title: script.headline,
  kicker: script.kicker ?? "",
  criterion: script.criterion ?? "",
  spoilers: false,
  recap: false,
  theme: script.game_title,
  footageCredit: clips.length ? "FOOTAGE: OFFICIAL TRAILERS · STEAM" : "",
  endLine: "A new documentary every month · Shorts every day",
  moments: moments.map((ms: any[]) =>
    ms.map((m: any) => ({
      show: m.show,
      graphic: m.graphic,
      emphasis: m.emphasis,
      person: m.person || undefined,
      beat: m.beat,
      filler: m.filler,
    })),
  ),
  segments,
  words,
  durationSeconds: duration + 20,
  coldOpenLine: coldOpenLine(script.hook),
  titleDrop: craft.titleDrop,
  chapterIndex: craft.chapterIndex,
  cutRhythm: craft.rhythm,
  entryPace: craft.entryPace,
  bookendEnding: craft.bookend,
  next: null,
  variant,
  audioFile: assets.audio ?? null,
  musicFile: null,
  imageFiles: images,
  clipFiles: clips,
  plan,
  renderDate: "2026-10-31",
  breaks: assets.breaks,
  quietBreaks: [],
  palette: assets.palette,
  annotations: [...(assets.annotations ?? []), ...(assets.textDetails ?? [])],
  eraBeds: true,
  sketchAnimation: true,
  photoTreatments: true,
  graphicsFit: fitOn,
  // The recall cards, as the render step passes them when the script has open loops.
  loops: script.open_loops?.length ? loopsOfScript(script) : undefined,
  camera: parseCameraSetting("all"),
  debugGraphics: true,
};

// The checks the pre-pass would make with nothing muted (GRAPHICS_PREPASS_MAX 200).
const draws = graphicDrawsFor(segments, script.game_title);
const checks = graphicChecks(
  {
    windows: momentWindows(
      segments,
      words,
      moments.map((m: any[]) => m.length),
      moments.map((e: any[]) => e.map(momentKeys)),
    ),
    graphicOf: (e: number, m: number) => moments[e]?.[m]?.graphic,
    breaks: assets.breaks,
    durationSeconds: duration,
    shots: plan.shots,
    // As the render step passes them since 1 Nov 2026 (--old-timing leaves them out, as before).
    ...(args.includes("--old-timing")
      ? {}
      : {
          momentOf: (e: number, m: number) => moments[e]?.[m],
          draws: (e: number, m: number) =>
            !moments[e]?.[m] || draws(e, moments[e][m].graphic),
        }),
  },
  {},
  Number(flag("max", "200")),
);
const wanted = args.includes("--all")
  ? checks.map((c) => c.what)
  : args.includes("--faulted")
    ? ((lastPrepass?.faulted ?? []) as string[])
    : args.includes("--passed")
      ? // Every Nth check the last pre-pass passed (--passed N), to see the fixes did not break good graphics.
        checks
          .map((c) => c.what)
          .filter((k) => !(lastPrepass?.faulted ?? []).includes(k))
          .filter((_, i) => i % Number(flag("passed", "4")) === 0)
      : flag("keys").split(",").filter(Boolean);
const skip = flag("skip-chapters").split(",").filter(Boolean);
const also = flag("also").split(",").filter(Boolean);
for (const c of checks) {
  const [e, m] = c.what.split(":").map(Number);
  const mo = moments[e!]?.[m!];
  if (
    mo &&
    !skip.includes(String(e)) &&
    (also.includes(mo.graphic?.kind) || also.includes(mo.filler?.family)) &&
    !wanted.includes(c.what)
  )
    wanted.push(c.what);
}
const missing = wanted.filter((k) => !checks.some((c) => c.what === k));
if (missing.length)
  console.log("not among this run's checks:", missing.join(" "));
// A key can have two checks (its filler shot and its graphic): both are rendered.
const items = checks
  .filter((c) => wanted.includes(c.what))
  .map((c, i) => ({
    ...c,
    file: path.join(
      OUT,
      `${TAG}_${String(i).padStart(3, "0")}_${c.what.replace(":", "-")}.jpg`,
    ),
  }));
console.log("checks", checks.length, "rendering", items.length);

const judgeOnly = args.includes("--judge-only");
if (judgeOnly) {
  const saved = JSON.parse(fs.readFileSync(path.join(OUT, `${TAG}_items.json`), "utf8"));
  items.splice(0, items.length, ...saved);
}
const serveUrl = judgeOnly ? "" : await getBundle();
if (!judgeOnly) {
const files = await serveDir(DIR);
const inputProps = longProps(files.url, serveUrl, props as never);
const browser = await openBrowser("chrome", {
  chromiumOptions: { gl: "angle" },
});
const composition = await selectComposition({
  serveUrl,
  id: "PulseLong",
  inputProps,
  puppeteerInstance: browser,
});
let styles: Record<string, string> = {};
for (const [n, it] of items.entries()) {
  await renderStill({
    composition,
    serveUrl,
    output: it.file,
    inputProps,
    frame: checkFrame(it, LONG_FPS),
    imageFormat: "jpeg",
    jpegQuality: 82,
    scale: SCALE,
    puppeteerInstance: browser,
    chromiumOptions: { gl: "angle" },
    timeoutInMilliseconds: 180_000,
    onBrowserLog:
      n === 0
        ? (l) => {
            const m = l.text.match(/^GFXSTYLES (.*)$/);
            if (m) styles = JSON.parse(m[1]!);
          }
        : undefined,
  });
  process.stdout.write(".");
}
console.log();
await browser.close({ silent: true });
await files.close();
const kinds = Object.fromEntries(
  items.map((it) => {
    const [e, m] = it.what.split(":").map(Number);
    return [
      it.what,
      moments[e!]?.[m!]?.filler &&
      plan.shots.some(
        (s: any) =>
          s.media.type === "filler" &&
          `${s.media.entry}:${s.media.index}` === it.what,
      )
        ? `filler/${moments[e!][m!].filler.family}`
        : styles[it.what] === "house"
          ? `house/${moments[e!]?.[m!]?.graphic?.kind}`
          : styles[it.what],
    ];
  }),
);
fs.writeFileSync(
  path.join(OUT, `${TAG}_items.json`),
  JSON.stringify(
    items.map((it) => ({ ...it, style: kinds[it.what] })),
    null,
    1,
  ),
);
console.log("styles written to", path.join(OUT, `${TAG}_items.json`));
}

if (args.includes("--judge") || judgeOnly) {
  // Only the key and workspace from the live settings file, read and never written.
  for (const line of fs
    .readFileSync("C:/PulseFactory/factory/.env", "utf8")
    .split(/\r?\n/)) {
    const m = line.match(/^(ANTHROPIC_API_KEY|ANTHROPIC_WORKSPACE_ID)=(.*)$/);
    if (m) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  const { createClaude } = await import("../../src/editorial/llm.ts");
  const { visionQa } = await import("../../src/qa/vision.ts");
  const { judgeGraphics } = await import("../../src/qa/graphicscheck.ts");
  const llm = createClaude({
    top: "claude-opus-5-5",
    mid: "claude-sonnet-5-5",
    low: "claude-haiku-5-5",
  });
  const r = await judgeGraphics(items, (frames) =>
    visionQa(llm, frames, {
      headline: script.headline,
      gameTitle: script.game_title,
      format: "graphics",
    }),
  );
  fs.writeFileSync(
    path.join(OUT, `${TAG}_verdicts.json`),
    JSON.stringify(
      {
        checked: items.length,
        batches: Math.ceil(items.length / GRAPHICS_BATCH),
        ...r,
      },
      null,
      1,
    ),
  );
  console.log(
    `judged ${items.length}: faulted ${r.faulted.length}`,
    r.faulted.join(" "),
  );
  for (const p of r.problems)
    for (const q of p.problems) console.log(" ", p.at.join(" "), "|", q);
}
