// AI motion for the documentary lines nothing filmed can show, made on this PC and nowhere else. The concept
// sketch pass (src/assets/illustrate.ts) draws a still for a scene line; for the few of those lines whose
// scene has movement in it (people carrying boxes, a team typing late at night, a car on the road) this
// module brings the sketch to life for about five seconds on the PC's own image-to-video model: Wan 2.2
// TI2V 5B through ComfyUI, Apache 2.0, already in C:\Users\MORR\ComfyUI\models and proved on this PC in June
// 2026 (81 frames at 1280x704 in about 2.5 minutes). No paid API, nothing leaves the machine.
//
// Why only lines with movement: a still sketch already moves on screen (drawn on, flipbook, light table;
// src/render/sketchplan.ts), so a generated clip is worth its three GPU minutes only where the motion is the
// point of the line. The clip keeps the sketch's look (pencil and ink on cream paper), is tagged
// ILLUSTRATION on screen like the sketch, never draws a recognisable face, and is checked by measurement
// (ffmpeg's frame-to-frame difference: a clip that barely moves or jumps and flickers is dropped) rather than
// by a model call, so it costs no Claude spend.
//
// Off by default (ILLUSTRATE_VIDEO_ENABLED=false), capped per documentary (ILLUSTRATE_VIDEO_MAX), each clip
// dropped from ComfyUI's queue past ILLUSTRATE_VIDEO_TIMEOUT_SECONDS, and ILLUSTRATE_VIDEO_STUB=true makes a
// slow-zoom clip of the sketch with ffmpeg instead, so tests and dry runs never need the GPU. In the factory
// the batch takes a "gpu" turn from the PC orchestrator first (orchGpuLease), so it never competes with an
// Orryy render.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchWithTimeout, log } from "../lib/util.ts";
import { FFMPEG } from "../lib/bin.ts";
import {
  DEFAULT_ILLUSTRATE_URL,
  illustratable,
  sceneOf,
  sketchSeed,
  type SketchChapter,
  type SketchMoment,
} from "./illustrate.ts";
import {
  LOCALVIDEO_PREFIX,
  isLocalVideo,
} from "../render/components/localvideo/plan.ts";

const run = promisify(execFile);

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 704;
/** Frames the model makes (4n+1) and the rate they play at: 5.06 s. */
export const VIDEO_FRAMES = 81;
export const VIDEO_FPS = 16;
export const VIDEO_SECONDS = VIDEO_FRAMES / VIDEO_FPS;
export const LOCALVIDEO_KIND = "localvideo";
// The clip file prefix and its detector live with the render plan (no node imports there), shared here.
export { LOCALVIDEO_PREFIX, isLocalVideo };

export const LOCALVIDEO_PROVENANCE =
  "Concept sketch brought to life by a local video model (Wan 2.2 TI2V 5B via ComfyUI on this PC) from the narration; an illustration, not footage";

/** What every clip keeps: the sketch's own look, slow and calm, nothing new and nothing readable. */
export const MOTION_STYLE =
  "The pencil and ink concept sketch comes gently to life. Slow, steady, unhurried movement and a very slow camera push-in. Keep the drawing exactly as drawn: cream paper, loose linework, light ink wash and graphite shading stay the same in every frame. No new objects, no text, no letters, no logos. Faces stay simple and turned away.";

export const MOTION_NEGATIVE =
  "photograph, photorealistic, realistic skin, 3d render, colour shift, saturated colours, neon, text, letters, words, numbers, subtitles, captions, logo, watermark, signature, readable signage, recognisable face, face morphing, warped face, deformed hands, extra fingers, bad anatomy, flicker, heavy flicker, frame jitter, scene cut, fast motion, chaotic camera shake, zoom burst, smeared details, blurry, low resolution, new objects appearing, static frame";

// ---------------------------------------------------------------------------------------------------------
// Which lines: a sketchable scene (illustratable) whose shot note or sentence has movement in it. Each family
// names the movement in words the model follows; the first family that matches the shot note wins, then the
// sentence. Order matters: "drove to the printing plant" is a journey, not a factory.

interface MotionFamily {
  name: string;
  /** The words that name this movement in the writer's shot note. */
  cue: RegExp;
  /**
   * The stricter words that count in the sentence alone: a sentence's "worked" or "planned" is usually the
   * story's, not the picture's. Absent, the cue.
   */
  strong?: RegExp;
  /** What moves, in the model's words. */
  motion: string;
}

export const MOTION_FAMILIES: MotionFamily[] = [
  {
    name: "journey by road or rail",
    cue: /\b(drove|drive|driving|car|cars|van|truck|road trip|train|trains|bus|commute\w*)\b/i,
    motion:
      "the vehicle rolls slowly forward and the scenery slides gently past the windows",
  },
  {
    name: "flight",
    cue: /\b(flew|fly|flying|flight|flights|plane|planes|airport)\b/i,
    motion: "the plane drifts slowly across the sky, clouds sliding gently by",
  },
  {
    name: "carrying and shipping",
    cue: /\b(moved|moving|move|relocat\w*|packed|packing|boxes|crates|shipped|shipping|shipment\w*|delivered|deliver\w*|loaded|unloaded|carried|carrying|warehouse|printing|manufacturing)\b/i,
    strong:
      /\b(relocat\w*|packed|packing|boxes|crates|shipped|shipping|shipment\w*|loaded|unloaded|carried|carrying|moved (?:into|to|across|out|offices|house))\b/i,
    motion:
      "people carry boxes across the room at an easy pace, stacks shifting as they are set down",
  },
  {
    name: "late nights at the desks",
    cue: /\b(crunch\w*|late nights?|night shift|all-nighters?|overtime|worked|working|typing|coded|coding|programm\w*|computers?|monitors?|desks?)\b/i,
    strong:
      /\b(crunch\w*|late nights?|night shift|all-nighters?|overtime|typing|coded|coding|at (?:their|his|her) desks?)\b/i,
    motion:
      "people at their desks type and lean towards their glowing monitors, a desk lamp's light flickering softly",
  },
  {
    name: "a meeting",
    cue: /\b(meeting|meetings|boardroom|argued|argu\w+|negotiat\w*|pitched|pitching|presented|presenting|debated|discuss\w*|interview\w*)\b/i,
    motion:
      "people around the table lean in and gesture as they talk, papers sliding across the table",
  },
  {
    name: "a crowd gathering",
    cue: /\b(gathered|gathering|crammed|huddled|packed into|crowd\w*|queue\w*|queued|lined up|trade show|conference)\b/i,
    motion: "a small crowd shifts and leans in, heads turning as they look on",
  },
  {
    name: "walking and arriving",
    cue: /\b(walked|walking|walk|arrived|arriving|visited|visiting|toured|touring|travelled|traveled|research trip|wandered|explored|stepped)\b/i,
    motion:
      "figures walk slowly through the scene, the view drifting with them",
  },
  {
    name: "drawing and planning",
    cue: /\b(drew|drawing|sketch\w*|storyboard\w*|whiteboard|mapped out|planned|planning|prototype\w*)\b/i,
    strong: /\b(drew|sketched|storyboarded|whiteboard|mapped out)\b/i,
    motion:
      "a hand moves a pencil across the page, new lines appearing stroke by stroke",
  },
];

/** The movement in a line: from the writer's shot note first, then the sentence. */
export function motionOf(
  sentence: string,
  show: string,
): { family: string; motion: string; from: "show" | "sentence" } | undefined {
  for (const from of ["show", "sentence"] as const) {
    const text = from === "show" ? show : sentence;
    const f = MOTION_FAMILIES.find((x) =>
      (from === "show" ? x.cue : (x.strong ?? x.cue)).test(text),
    );
    if (f) return { family: f.name, motion: f.motion, from };
  }
  return undefined;
}

/** A filler candidate for the integration step to rank against the other areas' for a bare sentence. */
export interface LocalVideoCandidate {
  area: "localvideo";
  kind: typeof LOCALVIDEO_KIND;
  /** 0-1: how much the line gains from motion over the still sketch treatments. */
  confidence: number;
  reason: string;
  /** The clip animates this line's concept sketch, so the sketch pass must have kept one first. */
  needs: "sketch";
  /** The movement family and words the prompt uses. */
  family: string;
  motion: string;
  /** Fixed on-screen tag. */
  tag: "ILLUSTRATION";
}

export type LocalVideoVerdict =
  | { take: true; candidate: LocalVideoCandidate }
  | { take: false; reason: string };

/** Under this the still sketch treatments serve the line as well, and the clip is not worth its GPU minutes. */
export const MIN_CONFIDENCE = 0.5;

/**
 * Whether a bare sentence should get an AI motion clip, and why not when it should not. Pure: the sentence,
 * the writer's moment and the chapter only.
 */
export function localvideoVerdict(
  sentence: string,
  moment: SketchMoment,
  _chapter: SketchChapter,
  covered = false,
): LocalVideoVerdict {
  if (covered || (moment.graphic && moment.graphic.kind !== "none"))
    return { take: false, reason: "has its own picture, clip or graphic" };
  // Every rule of the sketch applies first: a real-world scene, no figure, no named person, nothing sensitive.
  if (!illustratable(sentence, moment))
    return {
      take: false,
      reason: "not a sketchable scene (the sketch rules decline it)",
    };
  const m = motionOf(sentence, moment.show);
  if (!m)
    return {
      take: false,
      reason: "a still scene: the animated sketch treatments already serve it",
    };
  // Movement the writer put in the shot note is what the picture is about; movement only in the sentence may
  // be the story's, not the picture's ("the studio moved on to the sequel").
  const confidence = m.from === "show" ? 0.75 : 0.55;
  const words = sentence.trim().split(/\s+/).length;
  // A short line plays for under five seconds; most of a clip would be cut. Slightly lower so a longer line wins.
  const adjusted =
    Math.round((confidence - (words < 10 ? 0.1 : 0)) * 100) / 100;
  if (adjusted < MIN_CONFIDENCE)
    return {
      take: false,
      reason: `movement (${m.family}) only in the sentence, and the line is short`,
    };
  return {
    take: true,
    candidate: {
      area: "localvideo",
      kind: LOCALVIDEO_KIND,
      confidence: adjusted,
      reason: `${m.family}, named in the ${m.from === "show" ? "shot note" : "sentence"}`,
      needs: "sketch",
      family: m.family,
      motion: m.motion,
      tag: "ILLUSTRATION",
    },
  };
}

/** The chooser the integration step calls for each bare sentence. */
export function localvideoFor(
  sentence: string,
  moment: SketchMoment,
  chapter: SketchChapter,
): LocalVideoCandidate | undefined {
  const v = localvideoVerdict(sentence, moment, chapter);
  return v.take ? v.candidate : undefined;
}

/** The motion prompt: the scene (shot note and sentence), the movement, then the fixed style. */
export function motionPrompt(
  sentence: string,
  chapter: SketchChapter,
  show: string | undefined,
  motion: string,
): { prompt: string; negative: string } {
  const note = (show ?? "").trim().replace(/[.!?]+$/, "");
  const scene = note
    ? `${note.charAt(0).toUpperCase()}${note.slice(1)}. The moment: ${sceneOf(sentence)}.`
    : `${sceneOf(sentence)}.`;
  const period = chapter.year ? ` Around ${chapter.year}.` : "";
  const what = motion.charAt(0).toUpperCase() + motion.slice(1);
  return {
    prompt: `A concept sketch of a scene: ${scene}${period} ${what}. ${MOTION_STYLE}`,
    negative: MOTION_NEGATIVE,
  };
}

/** The sketch's seed with its own salt, so the clip is repeatable and not tied to the drawing's noise. */
export function videoSeed(episodeId: string, sentence: string): number {
  return (sketchSeed(episodeId, sentence) ^ 0x5a17c0de) & 0x7fffffff;
}

// ---------------------------------------------------------------------------------------------------------
// The ComfyUI client.

type Workflow = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

const WORKFLOW_FILE = new URL("./localvideo.workflow.json", import.meta.url);
const POLL_MS = 3000;

/** The workflow with the five documented inputs substituted (nodes 1, 6, 7, 9 and 12; see the JSON's comment). */
export async function localVideoWorkflow(
  image: string,
  prompt: string,
  negative: string,
  seed: number,
  prefix = "pulse/localvideo",
): Promise<Workflow> {
  const wf = JSON.parse(await fs.readFile(WORKFLOW_FILE, "utf8")) as Record<
    string,
    unknown
  >;
  delete wf._comment;
  const nodes = wf as Workflow;
  nodes["1"]!.inputs.image = image;
  nodes["6"]!.inputs.text = prompt;
  nodes["7"]!.inputs.text = negative;
  nodes["9"]!.inputs.seed = seed;
  nodes["12"]!.inputs.filename_prefix = prefix;
  return nodes;
}

export interface AnimateOptions {
  dest: string;
  seed: number;
  negative?: string;
  /** The ComfyUI server; ILLUSTRATE_URL (the same server as the sketches). */
  url?: string;
  /** Upload, animate and download within this; ILLUSTRATE_VIDEO_TIMEOUT_SECONDS. */
  timeoutMs?: number;
  /** A slow-zoom ffmpeg clip of the picture instead of the model; ILLUSTRATE_VIDEO_STUB. */
  stub?: boolean;
}

/**
 * Animates one picture (a sketch PNG or a screenshot) into opts.dest (MP4) and returns its path. Uploads the
 * picture to ComfyUI's input folder, queues the workflow, waits for it in the history and downloads the
 * video it saved. A job past the timeout is taken off the queue and, if it is already running, interrupted
 * by its own id, so nobody else's ComfyUI job on the PC is touched.
 */
export async function animate(
  image: string,
  prompt: string,
  opts: AnimateOptions,
): Promise<string> {
  await fs.mkdir(path.dirname(opts.dest), { recursive: true });
  if (opts.stub) return stubClip(image, opts.dest);
  const url = (opts.url ?? DEFAULT_ILLUSTRATE_URL).replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const deadline = Date.now() + timeoutMs;

  const form = new FormData();
  const name = `${path.basename(opts.dest, path.extname(opts.dest))}_${opts.seed}${path.extname(image) || ".png"}`;
  form.append("image", new Blob([await fs.readFile(image)]), name);
  form.append("subfolder", "pulse");
  form.append("type", "input");
  form.append("overwrite", "true");
  const up = await fetchWithTimeout(
    `${url}/upload/image`,
    { method: "POST", body: form },
    60_000,
  );
  if (!up.ok)
    throw new Error(
      `comfyui upload ${up.status}: ${(await up.text()).slice(0, 300)}`,
    );
  const uploaded = (await up.json()) as { name: string; subfolder?: string };
  const ref = uploaded.subfolder
    ? `${uploaded.subfolder}/${uploaded.name}`
    : uploaded.name;

  const workflow = await localVideoWorkflow(
    ref,
    prompt,
    opts.negative ?? MOTION_NEGATIVE,
    opts.seed,
  );
  const queued = await fetchWithTimeout(
    `${url}/prompt`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: workflow,
        client_id: `pulse-localvideo-${process.pid}`,
      }),
    },
    30_000,
  );
  if (!queued.ok)
    throw new Error(
      `comfyui ${queued.status}: ${(await queued.text()).slice(0, 300)}`,
    );
  const { prompt_id: id } = (await queued.json()) as { prompt_id: string };
  if (!id) throw new Error("comfyui gave no prompt id");

  type Saved = { filename: string; subfolder?: string; type?: string };
  let outputs:
    | Record<string, { images?: Saved[]; videos?: Saved[]; gifs?: Saved[] }>
    | undefined;
  while (Date.now() < deadline) {
    await new Promise((r) =>
      setTimeout(r, Math.min(POLL_MS, Math.max(0, deadline - Date.now()))),
    );
    const res = await fetchWithTimeout(
      `${url}/history/${id}`,
      {},
      30_000,
    ).catch(() => undefined);
    if (!res?.ok) continue;
    const hist = (await res.json()) as Record<
      string,
      {
        outputs?: typeof outputs;
        status?: { status_str?: string; messages?: unknown[] };
      }
    >;
    const entry = hist[id];
    if (!entry) continue;
    if (entry.status?.status_str === "error")
      throw new Error(
        `comfyui job failed: ${JSON.stringify(entry.status.messages ?? []).slice(0, 300)}`,
      );
    if (entry.outputs && Object.keys(entry.outputs).length) {
      outputs = entry.outputs;
      break;
    }
  }
  if (!outputs) {
    await dropJob(url, id);
    throw new Error(
      `comfyui job ${id} took longer than ${Math.round(timeoutMs / 1000)}s`,
    );
  }
  // SaveVideo reports its file under "images" (with animated: true); older video nodes used "videos" or "gifs".
  const saved = Object.values(outputs)
    .flatMap((o) => [
      ...(o.images ?? []),
      ...(o.videos ?? []),
      ...(o.gifs ?? []),
    ])
    .find((f) => /\.(mp4|webm|mov)$/i.test(f.filename));
  if (!saved) throw new Error("comfyui job made no video");
  const q = new URLSearchParams({
    filename: saved.filename,
    subfolder: saved.subfolder ?? "",
    type: saved.type ?? "output",
  });
  const file = await fetchWithTimeout(`${url}/view?${q}`, {}, 120_000);
  if (!file.ok) throw new Error(`comfyui view ${file.status}`);
  await fs.writeFile(opts.dest, Buffer.from(await file.arrayBuffer()));
  return opts.dest;
}

/** Off the queue if it is waiting; interrupted by its own id if it is running (never an untargeted interrupt). */
async function dropJob(url: string, id: string): Promise<void> {
  const post = (p: string, body: unknown) =>
    fetchWithTimeout(
      `${url}${p}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      10_000,
    ).catch(() => undefined);
  await post("/queue", { delete: [id] });
  await post("/interrupt", { prompt_id: id });
}

/** The ffmpeg arguments of the stub: the picture with a slow push-in, the model's size, length and rate. */
export function stubArgs(image: string, dest: string): string[] {
  const zoom = `zoompan=z='1+0.0009*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${VIDEO_FRAMES}:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${VIDEO_FPS}`;
  return [
    "-v",
    "error",
    "-y",
    "-i",
    image,
    "-vf",
    `scale=${VIDEO_WIDTH * 2}:${VIDEO_HEIGHT * 2}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH * 2}:${VIDEO_HEIGHT * 2},${zoom},format=yuv420p`,
    "-frames:v",
    String(VIDEO_FRAMES),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-movflags",
    "+faststart",
    dest,
  ];
}

async function stubClip(image: string, dest: string): Promise<string> {
  await run(FFMPEG, stubArgs(image, dest), { windowsHide: true });
  return dest;
}

// ---------------------------------------------------------------------------------------------------------
// The measurement gate: no model call, just ffmpeg's mean frame-to-frame luma difference (YDIF, 0-255).

export interface MotionMeasure {
  frames: number;
  seconds: number;
  /** Mean and 95th percentile of YDIF over the clip. */
  mean: number;
  p95: number;
  max: number;
}

/** Below this mean the clip barely moves and the still sketch does the job. */
export const STILL_YDIF = 0.25;
/** Above this 95th percentile the clip jumps, cuts or flickers: jarring under calm narration. */
export const JUMPY_YDIF = 18;

/** YDIF values per frame (the first frame has none) to the measure. Pure. */
export function measureOf(ydifs: number[], fps = VIDEO_FPS): MotionMeasure {
  const v = ydifs.filter((x) => Number.isFinite(x));
  const sorted = [...v].sort((a, b) => a - b);
  const pick = (q: number) =>
    sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
      : 0;
  const mean = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    frames: v.length + 1,
    seconds: r((v.length + 1) / fps),
    mean: r(mean),
    p95: r(pick(0.95)),
    max: r(sorted.length ? sorted[sorted.length - 1]! : 0),
  };
}

/** Whether a measured clip may be used, and why not. Pure. */
export function judgeMotion(m: MotionMeasure): { ok: boolean; reason: string } {
  if (m.seconds < 3) return { ok: false, reason: `only ${m.seconds}s long` };
  if (m.mean < STILL_YDIF)
    return { ok: false, reason: `barely moves (mean difference ${m.mean})` };
  if (m.p95 > JUMPY_YDIF)
    return {
      ok: false,
      reason: `jumps or flickers (95th percentile difference ${m.p95})`,
    };
  return {
    ok: true,
    reason: `moves steadily (mean ${m.mean}, 95th percentile ${m.p95})`,
  };
}

/** Reads a clip's YDIF per frame with ffmpeg's signalstats. */
export async function measureClip(file: string): Promise<MotionMeasure> {
  const { stdout } = await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      "signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-",
      "-f",
      "null",
      "-",
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  const ydifs = [...stdout.matchAll(/lavfi\.signalstats\.YDIF=([\d.]+)/g)].map(
    (x) => Number(x[1]),
  );
  // signalstats gives the first frame a YDIF of 0 (no frame before it); leave it out.
  return measureOf(ydifs.slice(1));
}

// ---------------------------------------------------------------------------------------------------------
// The pass over a documentary, for the integration step: after the sketch pass has pinned its sketches,
// animate the qualifying ones (by confidence, up to the cap), gate each by measurement and hand back clip
// records in the shape assets.clips uses. One run per documentary so the cap holds for the whole video.

/** A clip as assets.clips stores it (src/episodes.ts). */
export interface LocalVideoClip {
  file: string;
  sourceUrl: string;
  provenance: string;
  durationSeconds: number;
  beatIndex: number;
  moment: number;
  label: string;
  reason: string;
  audio: false;
}

export interface LocalVideoSummary {
  asked: number; // sketches sent to the model
  made: number; // clips the model returned
  kept: number; // clips the measurement passed
  dropped: number; // made but refused by the measurement (barely moves, jumps or flickers)
  failed: number; // the model errored or timed out
  seconds: number;
}

export interface LocalVideoItem {
  entry: number;
  moment: number;
  sentence: string;
  shot: SketchMoment;
  chapter: SketchChapter;
  /** The kept sketch for this line, relative to dir. */
  sketch: string;
}

/** Releases the turn. */
export type Release = () => void;

export interface LocalVideoRunOptions {
  dir: string;
  episodeId: string;
  url: string;
  max: number;
  stub: boolean;
  timeoutMs: number;
  /** A GPU turn for the batch (orchGpuLease in the factory); absent, no turn is taken (the trial runs inside `orch run`). */
  lease?: (job: string, estMinutes: number) => Promise<Release>;
  /** Test seams. */
  animate?: typeof animate;
  measure?: (file: string) => Promise<MotionMeasure>;
}

/** Minutes of GPU one clip is planned at, for the orchestrator's estimate (2.5 measured, plus loading). */
export const CLIP_MINUTES = 3;

/** The lines to animate, best first, at most `max`: those the chooser takes, by confidence then order. */
export function pickForVideo(
  items: LocalVideoItem[],
  max: number,
): Array<LocalVideoItem & { candidate: LocalVideoCandidate }> {
  return items
    .map((it, i) => ({
      it,
      i,
      c: localvideoFor(it.sentence, it.shot, it.chapter),
    }))
    .filter(
      (x): x is { it: LocalVideoItem; i: number; c: LocalVideoCandidate } =>
        !!x.c,
    )
    .sort((a, b) => b.c.confidence - a.c.confidence || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map((x) => ({ ...x.it, candidate: x.c }));
}

export function createLocalVideoRun(opts: LocalVideoRunOptions): {
  animateAll(items: LocalVideoItem[], clips: LocalVideoClip[]): Promise<number>;
  summary(): LocalVideoSummary;
} {
  const sum: LocalVideoSummary = {
    asked: 0,
    made: 0,
    kept: 0,
    dropped: 0,
    failed: 0,
    seconds: 0,
  };
  const make = opts.animate ?? animate;
  const measure = opts.measure ?? measureClip;
  // Lines already tried (kept or not) are never tried twice in one documentary.
  const tried = new Set<string>();
  const key = (it: LocalVideoItem) => `${it.entry}:${it.moment}`;
  return {
    summary: () => ({ ...sum, seconds: Math.round(sum.seconds) }),
    async animateAll(items, clips) {
      const want = pickForVideo(
        items.filter((it) => !tried.has(key(it))),
        opts.max - sum.asked,
      );
      if (!want.length) return 0;
      const t0 = Date.now();
      let release: Release = () => {};
      if (opts.lease && !opts.stub) {
        try {
          release = await opts.lease(
            `localvideo ${want.length} clips`,
            Math.ceil(want.length * CLIP_MINUTES),
          );
        } catch (err) {
          // No turn, no clips: the sketches stay as they are rather than fight an Orryy render for the GPU.
          log(
            "warn",
            "no GPU turn for the AI motion clips; sketches stay still",
            {
              error: err instanceof Error ? err.message : String(err),
            },
          );
          return 0;
        }
      }
      let kept = 0;
      try {
        for (const it of want) {
          sum.asked++;
          tried.add(key(it));
          const { prompt, negative } = motionPrompt(
            it.sentence,
            it.chapter,
            it.shot.show,
            it.candidate.motion,
          );
          const file = path.join(
            `entry_${it.entry}`,
            "fill",
            `${LOCALVIDEO_PREFIX}${it.moment}.mp4`,
          );
          const dest = path.join(opts.dir, file);
          try {
            await make(path.join(opts.dir, it.sketch), prompt, {
              dest,
              seed: videoSeed(opts.episodeId, it.sentence),
              negative,
              url: opts.url,
              timeoutMs: opts.timeoutMs,
              stub: opts.stub,
            });
            sum.made++;
          } catch (err) {
            sum.failed++;
            log("warn", "AI motion clip not made", {
              entry: it.entry,
              sentence: it.moment,
              error: err instanceof Error ? err.message : String(err),
            });
            continue;
          }
          let verdict: { ok: boolean; reason: string };
          let m: MotionMeasure | undefined;
          try {
            m = await measure(dest);
            verdict = judgeMotion(m);
          } catch (err) {
            verdict = {
              ok: false,
              reason: `could not be measured: ${err instanceof Error ? err.message : String(err)}`,
            };
          }
          if (!verdict.ok) {
            sum.dropped++;
            log("info", "AI motion clip dropped", {
              entry: it.entry,
              sentence: it.moment,
              reason: verdict.reason,
            });
            continue;
          }
          clips.push({
            file,
            sourceUrl: "",
            provenance: LOCALVIDEO_PROVENANCE,
            durationSeconds: m?.seconds ?? VIDEO_SECONDS,
            beatIndex: it.entry,
            moment: it.moment,
            label: `AI motion: ${it.shot.show}`,
            reason: `${it.candidate.reason}; ${verdict.reason}`,
            audio: false,
          });
          kept++;
          sum.kept++;
        }
      } finally {
        release();
        sum.seconds += (Date.now() - t0) / 1000;
      }
      return kept;
    },
  };
}

/** The owner's Discord line for a documentary's run, in plain English. Empty when nothing was asked. */
export function localVideoNotice(
  headline: string,
  s: LocalVideoSummary,
): string {
  if (!s.asked) return "";
  return `Documentary "${headline}": ${s.kept} concept sketch${s.kept === 1 ? "" : "es"} brought to life as short AI motion clips on this PC's own video model (${s.asked} tried, ${s.dropped} dropped for barely moving or flickering, ${s.failed} not made; ${s.seconds}s of GPU). Each is tagged ILLUSTRATION on screen. Setting: ILLUSTRATE_VIDEO_ENABLED.`;
}

/**
 * A GPU turn from the PC orchestrator (C:\Claude\orchestrator\orch.mjs) at Pulse's priority, so a batch of
 * clips waits for an Orryy render instead of slowing it. Throws when no turn comes within maxWait minutes.
 */
export function orchGpuLease(
  maxWait = 60,
): (job: string, estMinutes: number) => Promise<Release> {
  return async (job, est) => {
    const orch: any = await import(
      process.env.ORCH_CLIENT || "file:///C:/Claude/orchestrator/orch.mjs"
    );
    return (await orch.lease("gpu", {
      job,
      project: "pulse",
      priority: 60,
      kind: "pulse:localvideo",
      est,
      vram: 20,
      ram: 16,
      maxWait,
      onWait: (why: string) =>
        log("info", "AI motion clips waiting for the GPU", { why }),
    })) as Release;
  };
}
