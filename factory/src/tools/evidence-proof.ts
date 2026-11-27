// Proof renders for the evidence board style (EVIDENCE_STYLE, src/evidencestyle.ts): a GTA lore Short sample and a 60 s
// long-video excerpt, both cut from a real GTA documentary's narration, pictures and footage, rendered by the factory's
// own compositions with the board plan the pipeline would make. Then every frame is scanned for black and frozen
// frames, and a contact sheet is made. Run through the orchestrator on the PC:
//   C:\Claude\orchestrator\orch.cmd run --class heavy --project pulse --job "evidence proof" --priority 20 --est 30 --
//     node --import tsx src/tools/evidence-proof.ts <episode dump.json> <episode dir> <out dir>
// The dump is the episode's row (script_json, assets_json) as JSON. Writes, under <out dir>: short_board.mp4,
// long_excerpt.mp4, *_sheet.jpg, *_plan.json and report.json.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { FFMPEG } from "../lib/bin.ts";
import { getBundle, longProps, serveDir } from "../render/render.ts";
import { buildSegments, type Segment } from "../render/timeline.ts";
import { buildPlan, TAIL_SECONDS } from "../render/plan.ts";
import { shortLayout } from "../render/cleanframe.ts";
import { LONG_TAIL_SECONDS, openChaptersAtBreaks } from "../render/longplan.ts";
import { segmentInputs } from "../pipeline.ts";
import { prepareEvidence } from "../evidencestep.ts";
import { pinnable } from "../evidencestyle.ts";
import type { EvidenceBoardPlan } from "../render/evidenceboard.ts";
import type { Word } from "../voice/elevenlabs.ts";

const run = promisify(execFile);
const ff = (args: string[]) =>
  run(FFMPEG, ["-v", "error", "-y", ...args], { maxBuffer: 256 * 1024 * 1024 });
const FPS = 30;
const on = { evidenceStyle: true, evidenceStyleShare: 1 };

/** Black frames (mean luma under 18 of 255) and frozen runs (no change for half a second or more), per frame. */
async function scan(
  file: string,
): Promise<{ frames: number; black: number[]; frozen: string[] }> {
  const { stderr } = await run(
    FFMPEG,
    [
      "-v",
      "info",
      "-i",
      file,
      "-vf",
      "signalstats,metadata=print:key=lavfi.signalstats.YAVG,freezedetect=n=0.002:d=0.5",
      "-an",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  const out = String(stderr);
  const luma = [...out.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map(
    (m) => Number(m[1]),
  );
  const black = luma.flatMap((y, i) => (y < 18 ? [i] : []));
  const frozen = [
    ...out.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g),
  ].map((m) => `${Number(m[1]).toFixed(2)}s for ${Number(m[2]).toFixed(2)}s`);
  return { frames: luma.length, black, frozen };
}

/** A contact sheet: one frame every `every` seconds, `cols` across. */
async function sheet(
  file: string,
  out: string,
  every: number,
  cols: number,
  w: number,
): Promise<void> {
  await ff([
    "-i",
    file,
    "-vf",
    `fps=1/${every},scale=${w}:-2,tile=${cols}x6:padding=6:color=0x111111`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    out,
  ]);
}

async function render(
  id: string,
  props: Record<string, unknown>,
  out: string,
  frameRange?: [number, number],
) {
  const serveUrl = await getBundle();
  const composition = await selectComposition({
    serveUrl,
    id,
    inputProps: props,
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: out,
    inputProps: props,
    chromiumOptions: { gl: "angle" },
    concurrency: 6,
    ...(frameRange ? { frameRange } : {}),
  });
}

async function stills(
  id: string,
  props: Record<string, unknown>,
  frames: number[],
  dest: (f: number) => string,
) {
  const serveUrl = await getBundle();
  const composition = await selectComposition({
    serveUrl,
    id,
    inputProps: props,
  });
  for (const frame of frames)
    await renderStill({
      composition,
      serveUrl,
      frame: Math.min(frame, composition.durationInFrames - 1),
      output: dest(frame),
      inputProps: props,
      imageFormat: "jpeg",
      jpegQuality: 90,
      chromiumOptions: { gl: "angle" },
    });
}

/** Where a plan's elements land, in seconds, for the report. */
const summary = (p: EvidenceBoardPlan | undefined, offset = 0) =>
  p && {
    mode: p.mode,
    dates: p.dates.map((d) =>
      `${((d.from - offset) / FPS).toFixed(1)}s ${d.big} ${d.sub ?? ""}`.trim(),
    ),
    cases: p.cases.map(
      (c) => `${((c.from - offset) / FPS).toFixed(1)}s CASE: ${c.topic}`,
    ),
    stamps: p.stamps.map(
      (s) => `${((s.from - offset) / FPS).toFixed(1)}s ${s.text}`,
    ),
    windows: p.windows.map(
      (w) =>
        `${((w.from - offset) / FPS).toFixed(1)}-${((w.to - offset) / FPS).toFixed(1)}s ${w.pins.length} pins`,
    ),
  };

const [dumpFile, epDir, outDir, sharesFile] = process.argv.slice(2);
if (!dumpFile || !epDir || !outDir)
  throw new Error(
    "usage: evidence-proof.ts <dump.json> <episode dir> <out dir> [face shares.json]",
  );
// The face check: Apple Vision only runs on the Mac, so the PC proof reads the biggest-face shares the Mac measured for
// these pictures through the factory's own readBoxes ({ "entry_0/assets/x.jpg": 0.01, ... }). Without the file
// nothing is pinned, as in production when the check cannot run.
const measured: Record<string, number> = sharesFile
  ? JSON.parse(await fs.readFile(sharesFile, "utf8"))
  : {};
await fs.mkdir(outDir, { recursive: true });
const row = JSON.parse(await fs.readFile(dumpFile, "utf8"));
const script = row.script_json;
const assets = row.assets_json;
const allWords: Word[] = assets.words;
const report: Record<string, unknown> = {
  episode: row.id,
  made: new Date().toISOString(),
};
const noFaces = async (files: string[]) => {
  const shares = new Map<string, number>();
  for (const f of files) {
    const rel = path.relative(epDir, f).split(path.sep).join("/");
    if (measured[rel] !== undefined) shares.set(f, measured[rel]!);
  }
  report.faceCheck = {
    measured: Object.keys(measured).length,
    matched: shares.size,
    asked: files.length,
  };
  return { checked: shares.size > 0, shares };
};

// ---- The GTA lore Short: the documentary's cold open as a Short, its own sentences as hook, beats and loop ----------
{
  const end = allWords.findIndex(
    (w, i) => w.end >= 40 && /[.!?]["”]?$/.test(w.text) && i > 10,
  );
  const words = allWords.slice(0, end + 1);
  const t1 = words.at(-1)!.end;
  const sentences: Word[][] = [[]];
  for (const w of words) {
    sentences.at(-1)!.push(w);
    if (/[.!?]["”]?$/.test(w.text)) sentences.push([]);
  }
  const ss = sentences.filter((s) => s.length);
  const inputs = ss.map((s, i) => ({
    kind: (i === 0
      ? "hook"
      : i === ss.length - 1
        ? "loop"
        : "beat") as Segment["kind"],
    text: s.map((w) => w.text).join(" "),
  }));
  const duration = t1 + 0.4 + TAIL_SECONDS;
  const segments = buildSegments(inputs, words, duration);
  // The episode's own GTA pictures and footage (the first two entries: GTA V and GTA Online), staged like an episode.
  const shortDir = path.join(outDir, "short_ep");
  await fs.mkdir(path.join(shortDir, "assets"), { recursive: true });
  await ff([
    "-i",
    path.join(epDir, assets.audio ?? "voice.mp3"),
    "-t",
    String(t1 + 0.4),
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    path.join(shortDir, "voice.mp3"),
  ]);
  const pics = (assets.images as Array<Record<string, any>>)
    .filter(
      (i) =>
        [0, 1].includes(i.beatIndex) &&
        ["hero", "screenshot", "capsule"].includes(i.kind) &&
        i.aspect >= 1.2,
    )
    .slice(0, 10);
  // Game pictures only: the documentary's archive photos of real people stay out of the sample (the rule that they are
  // never pinned is tested in tests/evidencestyle.test.ts and shown in the long excerpt's plan).
  const imgs = pics;
  const clips = (assets.clips as Array<Record<string, any>>)
    .filter((c) => [0, 1].includes(c.beatIndex))
    .slice(0, 4);
  for (const [k, f] of [
    ...imgs.map((i, k) => [k, i.file]),
    ...clips.map((c, k) => [100 + k, c.file]),
  ] as Array<[number, string]>)
    await fs.copyFile(
      path.join(epDir, f),
      path.join(shortDir, "assets", `${k}${path.extname(f)}`),
    );
  const plan = buildPlan({
    segments,
    words,
    durationSeconds: duration,
    images: imgs.map((i) => ({ kind: i.kind, aspect: i.aspect })),
    clips: clips.map((c) => ({
      durationSeconds: c.durationSeconds,
      motion: c.motion,
    })),
    storyType: "explainer",
    isRumour: false,
    attribution: "",
    variant: 1,
  });
  const layout = shortLayout(
    segments,
    plan.fps,
    plan.totalFrames,
    plan.tailFrames,
  );
  const prep = await prepareEvidence({
    cfg: on,
    episodeId: row.id,
    frame: "short",
    fps: plan.fps,
    headline: script.headline,
    game: "Grand Theft Auto VI",
    words,
    segments,
    images: imgs.map((i) => ({
      file: i.file,
      kind: i.kind,
      provenance: i.provenance,
    })),
    dir: epDir,
    avoid: [
      [0, layout.hookEnd],
      [layout.loopFrom, plan.totalFrames],
    ],
    event: async (_k, d) => (report.shortEvent = d),
    faces: noFaces,
  });
  const board = prep?.plan(plan.shots, plan.totalFrames);
  await fs.writeFile(
    path.join(outDir, "short_plan.json"),
    JSON.stringify(board, null, 2),
  );
  const files = await serveDir(shortDir);
  try {
    const base = {
      headline: script.headline,
      storyType: "explainer",
      gameTitle: "Grand Theft Auto VI",
      gameSubtitle: "",
      isRumour: false,
      attribution: "",
      footageCredit: "FOOTAGE: ROCKSTAR GAMES · OFFICIAL TRAILERS",
      segments,
      words,
      images: imgs.map((i, k) => ({
        src: `${files.url}/assets/${k}${path.extname(i.file)}`,
        kind: i.kind,
        aspect: i.aspect,
      })),
      clips: clips.map((c, k) => ({
        src: `${files.url}/assets/${100 + k}${path.extname(c.file)}`,
        durationSeconds: c.durationSeconds,
      })),
      steam: null,
      emphasis: [],
      plan,
      clean: true,
      logoSrc: "logo.png",
      audioSrc: `${files.url}/voice.mp3`,
      musicSrc: "music_2.mp3",
      durationSeconds: duration,
      variant: 1,
      renderDate: "2026-11-26",
    };
    const out = path.join(outDir, "short_board.mp4");
    await render("PulseShort", { ...base, board }, out);
    // The same frames without the style, for the side by side.
    const at = [
      ...(board?.windows ?? []).slice(0, 2).map((w) => w.from + 25),
      ...(board?.stamps ?? []).slice(0, 1).map((s) => s.from + 14),
      ...(board?.dates ?? []).slice(0, 1).map((d) => d.from + 30),
      ...(board?.cases ?? []).slice(0, 1).map((c) => c.from + 60),
    ];
    await stills("PulseShort", base, at, (f) =>
      path.join(outDir, `short_off_${f}.jpg`),
    );
    await stills("PulseShort", { ...base, board }, at, (f) =>
      path.join(outDir, `short_on_${f}.jpg`),
    );
    await sheet(out, path.join(outDir, "short_sheet.jpg"), 2, 6, 270);
    report.short = {
      seconds: duration,
      pictures: imgs.map(
        (i) =>
          `${i.kind}${pinnable({ kind: i.kind, provenance: i.provenance }) ? "" : " (never pinned)"}: ${String(i.provenance).slice(0, 70)}`,
      ),
      plan: summary(board),
      scan: await scan(out),
      compareFrames: at,
    };
  } finally {
    await files.close();
  }
}

// ---- The long video: a 60 s excerpt where the style has the most to show ------------------------------------------
{
  const duration = (assets.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
  const segments = openChaptersAtBreaks(
    buildSegments(segmentInputs(script), allWords, duration),
    assets.breaks,
  );
  const plan = assets.longPlan;
  const prep = await prepareEvidence({
    cfg: on,
    episodeId: row.id,
    frame: "long",
    fps: FPS,
    headline: script.headline,
    title: script.youtube?.title,
    game: script.game_title,
    chapters: segments.flatMap((g) =>
      g.visual?.primary &&
      (g.visual.kind === "chapter" || g.visual.kind === "rank")
        ? [g.visual.primary]
        : [],
    ),
    kind: "documentary",
    words: allWords,
    segments,
    images: (assets.images as Array<Record<string, any>>).map((i) => ({
      file: i.file,
      kind: i.kind,
      provenance: i.provenance,
    })),
    dir: epDir,
    breaks: assets.breaks,
    event: async (_k, d) => (report.longEvent = d),
    faces: noFaces,
  });
  const board = prep!.plan(plan.shots, plan.totalFrames)!;
  await fs.writeFile(
    path.join(outDir, "long_plan.json"),
    JSON.stringify(board, null, 2),
  );
  // The minute with the most of the style in it: a case card, dates, stamps and a board window.
  const len = 60 * FPS;
  let best = 0;
  let bestScore = -1;
  for (let f0 = 0; f0 + len < plan.totalFrames; f0 += 5 * FPS) {
    const inside = (x: { from: number }) =>
      x.from >= f0 + 30 && x.from < f0 + len - 90;
    const score =
      board.cases.filter(inside).length * 3 +
      Math.min(2, board.dates.filter(inside).length) +
      board.stamps.filter(inside).length * 3 +
      Math.min(2, board.windows.filter(inside).length) * 2;
    if (score > bestScore) {
      bestScore = score;
      best = f0;
    }
  }
  const files = await serveDir(epDir);
  try {
    const serveUrl = await getBundle();
    const props = (withBoard: boolean) =>
      longProps(files.url, serveUrl, {
        title: script.headline,
        kicker: script.kicker ?? "",
        criterion: script.criterion ?? "",
        theme: script.game_title,
        footageCredit: "FOOTAGE: ROCKSTAR GAMES · OFFICIAL TRAILERS",
        segments,
        words: allWords,
        durationSeconds: duration,
        variant: 0,
        audioFile: assets.audio ?? "voice.mp3",
        musicFile: assets.musicFile ?? null,
        imageFiles: (assets.images as Array<Record<string, any>>).map((i) => ({
          file: i.file,
          kind: i.kind,
          aspect: i.aspect,
          beatIndex: i.beatIndex,
          label: i.label,
          moment: i.moment,
        })),
        clipFiles: (assets.clips as Array<Record<string, any>>).map((c) => ({
          file: c.file,
          durationSeconds: c.durationSeconds,
          beatIndex: c.beatIndex,
          moment: c.moment,
        })),
        plan,
        renderDate: "2026-11-26",
        ...(withBoard ? { board } : {}),
      }) as unknown as Record<string, unknown>;
    const out = path.join(outDir, "long_excerpt.mp4");
    await render("PulseLong", props(true), out, [best, best + len - 1]);
    const inside = (from: number) => from >= best && from < best + len;
    const at = [
      ...board.windows
        .filter((w) => inside(w.from))
        .slice(0, 2)
        .map((w) => w.from + 40),
      ...board.stamps
        .filter((s) => inside(s.from))
        .slice(0, 1)
        .map((s) => s.from + 14),
      ...board.dates
        .filter((d) => inside(d.from))
        .slice(0, 1)
        .map((d) => d.from + 30),
      ...board.cases
        .filter((c) => inside(c.from))
        .slice(0, 1)
        .map((c) => c.from + 60),
    ];
    await stills("PulseLong", props(false), at, (f) =>
      path.join(outDir, `long_off_${f}.jpg`),
    );
    await stills("PulseLong", props(true), at, (f) =>
      path.join(outDir, `long_on_${f}.jpg`),
    );
    await sheet(out, path.join(outDir, "long_sheet.jpg"), 2.5, 4, 420);
    report.long = {
      excerpt: `${(best / FPS).toFixed(1)}-${((best + len) / FPS).toFixed(1)}s of ${duration.toFixed(0)}s`,
      plan: summary(board),
      inExcerpt: summary(
        {
          ...board,
          dates: board.dates.filter((d) => inside(d.from)),
          cases: board.cases.filter((c) => inside(c.from)),
          stamps: board.stamps.filter((s) => inside(s.from)),
          windows: board.windows.filter((w) => inside(w.from)),
        },
        best,
      ),
      scan: await scan(out),
      compareFrames: at.map((f) => f - best),
    };
  } finally {
    await files.close();
  }
}

await fs.writeFile(
  path.join(outDir, "report.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
process.exit(0);
