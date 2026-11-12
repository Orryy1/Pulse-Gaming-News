// A first look at candidate frames on this PC's own GPU (a local vision model
// through Ollama), so only clean frames reach Claude. Each frame is checked
// for the things that disqualify footage outright: words on screen, a
// streamer's webcam or recording overlay, gore, letterboxing, darkness, blur.
// When Ollama is not running, or the server on its port does not list LOCAL_VISION_MODEL, every frame passes
// through unchanged and the relay is marked down (src/assets/visionrelay.ts): with VISION_PAID_FALLBACK off no
// picture then goes to the paid API.

import fs from "node:fs/promises";
import { errorMessage, fetchWithTimeout } from "../lib/util.ts";
import { createVisionRelay } from "./visionrelay.ts";

export interface FrameFlags {
  hud: boolean; // only the game's own small HUD: fine on screen
  text: boolean;
  webcam: boolean;
  gore: boolean;
  letterbox: boolean;
  dark: boolean;
  blurry: boolean;
}

export const LOCAL_VISION_URL = (
  process.env.LOCAL_VISION_URL || "http://127.0.0.1:11434"
).replace(/\/$/, "");
export const LOCAL_VISION_MODEL =
  process.env.LOCAL_VISION_MODEL || "qwen3-vl:8b";

const PROMPT = `You screen one frame of video game footage for a news video. Answer each question about this frame with true or false.
text: any readable words, letters or numbers anywhere: titles, logos, subtitles, captions, HUD numbers, menus, objective text, watermarks, channel names.
hud_only: true only when every piece of writing in the frame is the game's own small heads-up display in a corner or edge (an ammo counter, a minimap or compass, a health bar); false when there is any title, logo, subtitle, caption, menu, objective text or large word, and false when there is no writing at all.
webcam: a real person's webcam or facecam, a picture-in-picture box, stream chat, alerts or any recording or streaming overlay on top of the game.
gore: blood sprays, wounds, dead bodies, executions.
letterbox: black bars covering more than a third of the frame.
dark: the frame is mostly black or so dark that a viewer cannot tell what is happening.
blurry: the frame is heavily blurred, smeared or an unreadable close-up of a texture.`;

const SCHEMA = {
  type: "object",
  properties: {
    text: { type: "boolean" },
    hud_only: { type: "boolean" },
    webcam: { type: "boolean" },
    gore: { type: "boolean" },
    letterbox: { type: "boolean" },
    dark: { type: "boolean" },
    blurry: { type: "boolean" },
  },
  required: [
    "text",
    "hud_only",
    "webcam",
    "gore",
    "letterbox",
    "dark",
    "blurry",
  ],
};

/** Whether a frame is unusable as footage, and why. Text alone is reported separately: it also marks where a clip must stop. */
/**
 * Room for the model's reasoning before its answer. Ollama 0.40 runs qwen3-vl's thinking even with
 * think: false (30 Oct 2026), about 100-200 tokens, and a budget sized for the bare answer cut it off
 * before the answer began: every frame check failed and went to Claude.
 */
export const THINK_ROOM = 900;

/**
 * The model's JSON answer: the reply itself, or the last {...} in the reply or its reasoning when the
 * answer arrived wrapped in thinking. Anything unreadable is an empty answer, never a throw.
 */
export function visionAnswer(body: {
  message?: { content?: string; thinking?: string };
}): any {
  for (const t of [body.message?.content, body.message?.thinking]) {
    const text = t?.trim();
    if (!text) continue;
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[^{}]*\}(?![\s\S]*\{[^{}]*\})/);
      if (m)
        try {
          return JSON.parse(m[0]);
        } catch {
          // not JSON after all
        }
    }
  }
  return {};
}

export function frameFlagsFromAnswer(body: {
  message?: { content?: string; thinking?: string };
}): FrameFlags | undefined {
  const parsed = visionAnswer(body);
  const keys = ["text", "hud_only", "webcam", "gore", "letterbox", "dark", "blurry"];
  if (!parsed || typeof parsed !== "object" || keys.some((key) => typeof parsed[key] !== "boolean")) return undefined;
  const hud = parsed.text && parsed.hud_only;
  return { hud, text: parsed.text && !hud, webcam: parsed.webcam, gore: parsed.gore,
    letterbox: parsed.letterbox, dark: parsed.dark, blurry: parsed.blurry };
}

export const rejectReason = (f: FrameFlags): string | undefined =>
  f.webcam
    ? "webcam or overlay"
    : f.gore
      ? "gore"
      : f.letterbox
        ? "letterboxed"
        : f.dark
          ? "too dark"
          : f.blurry
            ? "blurred"
            : f.text
              ? "text on screen"
              : undefined;

let downUntil = 0;

let relayAlert: (text: string) => unknown = () => undefined;
/** Where the relay's down and back alerts go (src/services.ts: Discord and the event log). */
export function onVisionRelayAlert(fn: (text: string) => unknown): void {
  relayAlert = fn;
}

/** The model names in an Ollama /api/tags answer (pure); anything unreadable is an empty list. */
export function relayModels(body: unknown): string[] {
  const models = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((m) =>
    [m?.name, m?.model].filter((x): x is string => typeof x === "string" && x.length > 0),
  );
}

/** Whether the list holds the model (pure). A name with no tag is Ollama's ":latest". */
export function hasVisionModel(models: string[], want: string): boolean {
  const norm = (n: string) => {
    const t = n.trim().toLowerCase();
    return t.includes(":") ? t : `${t}:latest`;
  };
  const w = norm(want);
  return models.some((m) => norm(m) === w);
}

/** How long the relay's model list stands before it is asked again. */
export const MODEL_CHECK_MS = 3 * 60_000;

/**
 * The relay's model check, failing closed (12 Nov 2026: a different Ollama answered on the relay's port with other
 * models, and the factory would have screened frames with it). The answer is undefined when the relay lists the
 * expected model, otherwise why not; a relay that does not answer, or answers with a list that lacks the model,
 * counts exactly as down. Cached for `ttlMs` either way, so frame work does not ask before every call.
 */
export function createModelCheck(opts: {
  fetchTags: () => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;
  model: string;
  now?: () => number;
  ttlMs?: number;
}): () => Promise<string | undefined> {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? MODEL_CHECK_MS;
  let last: { at: number; problem: string | undefined } | undefined;
  let asking: Promise<string | undefined> | undefined;
  const ask = async (): Promise<string | undefined> => {
    try {
      const res = await opts.fetchTags();
      if (!res.ok) return `the relay's model list answered ${res.status ?? "an error"}`;
      const models = relayModels(await res.json());
      if (hasVisionModel(models, opts.model)) return undefined;
      return `the relay does not list ${opts.model} (it has ${models.slice(0, 6).join(", ") || "no models"}): another server may be on its port`;
    } catch (err) {
      return `the relay's model list did not answer: ${errorMessage(err)}`;
    }
  };
  return async () => {
    if (last && now() - last.at < ttl) return last.problem;
    asking ??= ask()
      .then((problem) => {
        last = { at: now(), problem };
        return problem;
      })
      .finally(() => {
        asking = undefined;
      });
    return asking;
  };
}

/** This process's model check against LOCAL_VISION_URL. */
export const visionModelProblem = createModelCheck({
  fetchTags: () => fetchWithTimeout(`${LOCAL_VISION_URL}/api/tags`, {}, 4_000),
  model: LOCAL_VISION_MODEL,
});

/** The relay answers with the expected model in its list: no model run. A missing model is the relay down. */
async function probeRelay(): Promise<boolean> {
  return (await visionModelProblem()) === undefined;
}

/**
 * Before any frame goes to the relay: undefined when the expected model is there, else the relay is marked down
 * (the outage alert, and with VISION_PAID_FALLBACK off nothing goes to the paid API) and local work rests.
 */
async function relayNotReady(): Promise<string | undefined> {
  const problem = await visionModelProblem();
  if (problem) {
    downUntil = Date.now() + 10 * 60_000;
    visionRelay.report(false, problem);
  }
  return problem;
}

/** This process's view of the relay: one alert when it goes down, one when it is back. */
export const visionRelay = createVisionRelay({
  probe: probeRelay,
  alert: (text) => relayAlert(text),
  // Back: screen locally again at once rather than after the ten-minute rest.
  onUp: () => {
    downUntil = 0;
  },
});

/**
 * The guard's question (src/services.ts withVisionGuard): is the relay down? Never while local vision is
 * switched off on purpose (LOCAL_VISION=off: pictures go to Claude as configured) or under test.
 */
export function localVisionDown(): Promise<boolean> {
  if (process.env.LOCAL_VISION === "off" || process.env.NODE_TEST_CONTEXT)
    return Promise.resolve(false);
  return visionRelay.down();
}

// One frame and a short answer fit easily: the default 32k context held gigabytes the renderer needs.
const NUM_CTX = 8192;

/** True when the vision model runs on this machine (so unloading it frees memory for a render here). */
export function visionIsLocal(url: string): boolean {
  try {
    return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(
      new URL(url).hostname,
    );
  } catch {
    return false;
  }
}

/**
 * Unloads the vision model (it would otherwise stay resident for 15 minutes), freeing memory for a render.
 * Only when it is this machine's: the Mac's renders free nothing by unloading the PC's model over the LAN,
 * and it would throw out a model another job on the PC is using mid-run.
 */
export async function unloadLocalVision(): Promise<void> {
  if (!visionIsLocal(LOCAL_VISION_URL)) return;
  await fetchWithTimeout(
    `${LOCAL_VISION_URL}/api/generate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: LOCAL_VISION_MODEL, keep_alive: 0 }),
    },
    15_000,
  ).catch(() => undefined);
}

async function checkOne(file: string): Promise<FrameFlags | undefined> {
  const image = (await fs.readFile(file)).toString("base64");
  const res = await fetchWithTimeout(
    `${LOCAL_VISION_URL}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: LOCAL_VISION_MODEL,
        stream: false,
        think: false,
        format: SCHEMA,
        keep_alive: "15m",
        options: {
          temperature: 0,
          num_predict: 120 + THINK_ROOM,
          num_ctx: NUM_CTX,
        },
        messages: [{ role: "user", content: PROMPT, images: [image] }],
      }),
    },
    90_000,
  );
  if (!res.ok)
    throw new Error(
      `ollama ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const body = (await res.json()) as {
    message?: { content?: string; thinking?: string };
  };
  // Some vision models put their whole answer in the thinking field even with thinking off.
  return frameFlagsFromAnswer(body);
}

/**
 * Flags for each frame, in order; undefined for a frame the model could not
 * judge (or for all of them when the local model is not running), which
 * callers treat as "let Claude decide" (only while the relay answers, or with
 * VISION_PAID_FALLBACK on: src/assets/visionrelay.ts).
 */
export async function screenFrames(
  files: string[],
  concurrency = 2,
): Promise<Array<FrameFlags | undefined>> {
  const out: Array<FrameFlags | undefined> = new Array(files.length).fill(
    undefined,
  );
  if (
    !files.length ||
    Date.now() < downUntil ||
    process.env.LOCAL_VISION === "off" ||
    Boolean(process.env.NODE_TEST_CONTEXT) // tests never reach the GPU
  )
    return out;
  // A relay without the expected model is down: nothing is screened by another server's model.
  if (await relayNotReady()) return out;
  let next = 0;
  let failures = 0;
  const worker = async () => {
    while (next < files.length && failures < 3) {
      const i = next++;
      try {
        out[i] = await checkOne(files[i]!);
        visionRelay.report(true);
      } catch (err) {
        failures++;
        if (failures === 3) {
          // Not running or broken: stop trying for a while. The relay says so once per outage, and with
          // VISION_PAID_FALLBACK off the frames do not go to Claude either (src/assets/visionrelay.ts).
          downUntil = Date.now() + 10 * 60_000;
          visionRelay.report(false, errorMessage(err));
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, worker),
  );
  return out;
}

const FACE_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    box: { type: "array", items: { type: "number" } },
  },
  required: ["found", "box"],
};

/** The largest clearly visible face in a frame, as fractions of the frame (x1, y1, x2, y2). */
async function faceBox(
  file: string,
): Promise<[number, number, number, number] | undefined> {
  const image = (await fs.readFile(file)).toString("base64");
  const res = await fetchWithTimeout(
    `${LOCAL_VISION_URL}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: LOCAL_VISION_MODEL,
        stream: false,
        think: false,
        format: FACE_SCHEMA,
        keep_alive: "15m",
        options: {
          temperature: 0,
          num_predict: 80 + THINK_ROOM,
          num_ctx: NUM_CTX,
        },
        messages: [
          {
            role: "user",
            content:
              "Find the largest clearly visible human face in this video game frame (not a helmet seen from behind, not a tiny distant figure). Return found and box as [x1, y1, x2, y2] in 0-1000 coordinates relative to the image width and height.",
            images: [image],
          },
        ],
      }),
    },
    60_000,
  );
  if (!res.ok) return undefined;
  const body = (await res.json()) as {
    message?: { content?: string; thinking?: string };
  };
  const r = visionAnswer(body) as { found?: boolean; box?: number[] };
  const b = r.box;
  if (!r.found || !b || b.length !== 4) return undefined;
  const [x1, y1, x2, y2] = b.map((v) => Math.min(1, Math.max(0, v / 1000))) as [
    number,
    number,
    number,
    number,
  ];
  // Too small to read as a face on a phone, or not a box at all.
  if (x2 - x1 < 0.05 || y2 - y1 < 0.09) return undefined;
  return [x1, y1, x2, y2];
}

/** What a thumbnail's picture has for a hero (src/qa/thumbrule.ts). */
export interface HeroLook {
  /** A character's face with a readable expression, a character's whole body, or neither. */
  kind: "face" | "body" | "thing";
  /** The face or body, as fractions of the picture (x1, y1, x2, y2). */
  box?: [number, number, number, number];
  /** A photograph of a real person, not a game character. */
  realPerson: boolean;
}

/** The look's answer as a HeroLook (pure); undefined when it says nothing usable. */
export function heroLookAnswer(parsed: any): HeroLook | undefined {
  const k = parsed?.subject;
  if (!["face", "body", "thing"].includes(k)) return undefined;
  const b = parsed.box;
  const box =
    Array.isArray(b) && b.length === 4 && k !== "thing"
      ? (b.map((v: number) => Math.min(1, Math.max(0, Number(v) / 1000))) as [
          number,
          number,
          number,
          number,
        ])
      : undefined;
  const sized = box && box[2] > box[0] && box[3] > box[1];
  return {
    // A "face" too small to read on a phone is only a body.
    kind:
      k === "face" && sized && box![3] - box![1] < 0.15 ? "body" : k,
    ...(sized ? { box } : {}),
    realPerson: parsed.real_photo === true,
  };
}

/**
 * What a picture offers a thumbnail, from this PC's own model: free, and undefined whenever it is off, broken or
 * unsure, which leaves the picture where the other checks put it.
 */
export async function heroLook(file: string): Promise<HeroLook | undefined> {
  if (
    Date.now() < downUntil ||
    process.env.LOCAL_VISION === "off" ||
    process.env.NODE_TEST_CONTEXT
  )
    return undefined;
  if (await relayNotReady()) return undefined;
  try {
    const image = (await fs.readFile(file)).toString("base64");
    const res = await fetchWithTimeout(
      `${LOCAL_VISION_URL}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: LOCAL_VISION_MODEL,
          stream: false,
          think: false,
          format: {
            type: "object",
            properties: {
              subject: { type: "string", enum: ["face", "body", "thing"] },
              box: { type: "array", items: { type: "number" } },
              real_photo: { type: "boolean" },
            },
            required: ["subject", "box", "real_photo"],
          },
          keep_alive: "15m",
          options: {
            temperature: 0,
            num_predict: 80 + THINK_ROOM,
            num_ctx: NUM_CTX,
          },
          messages: [
            {
              role: "user",
              content:
                'You judge a picture for a video game thumbnail. subject: "face" when one character\'s face is large and its expression can be read, "body" when one large character\'s body fills much of the picture (masked or helmeted counts) but no readable face, "thing" for anything else (a logo, a vehicle, a landscape, a crowd of small figures). box: [x1, y1, x2, y2] around that face or body in 0-1000 coordinates relative to the image width and height, or [0,0,0,0] for a thing. real_photo: true only when this is a photograph of a real person, not a game character or artwork.',
              images: [image],
            },
          ],
        }),
      },
      60_000,
    );
    if (!res.ok) return undefined;
    return heroLookAnswer(
      visionAnswer(
        (await res.json()) as {
          message?: { content?: string; thinking?: string };
        },
      ),
    );
  } catch {
    return undefined;
  }
}

/**
 * A 16:9 portrait of the person in a clip: three frames, the one with the
 * biggest face, cropped so the face fills about half the height. False when
 * no frame shows a usable face (or the local model is not running).
 */
export async function cutPortrait(
  clipFile: string,
  outFile: string,
): Promise<boolean> {
  if (
    process.env.LOCAL_VISION === "off" ||
    process.env.NODE_TEST_CONTEXT ||
    Date.now() < downUntil
  )
    return false;
  if (await relayNotReady()) return false;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { FFMPEG, FFPROBE } = await import("../lib/bin.ts");
  const path = await import("node:path");
  const run = promisify(execFile);
  const { stdout } = await run(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=width,height",
    "-select_streams",
    "v:0",
    "-of",
    "json",
    clipFile,
  ]);
  const info = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ width: number; height: number }>;
  };
  const dur = Number(info.format?.duration ?? 4);
  const W = info.streams?.[0]?.width ?? 1280;
  const H = info.streams?.[0]?.height ?? 720;
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  let best:
    | { at: number; box: [number, number, number, number]; area: number }
    | undefined;
  for (const f of [0.2, 0.5, 0.8]) {
    const frame = `${outFile}.f${Math.round(f * 10)}.jpg`;
    try {
      await run(FFMPEG, [
        "-v",
        "error",
        "-y",
        "-ss",
        (dur * f).toFixed(2),
        "-i",
        clipFile,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        frame,
      ]);
      const box = await faceBox(frame);
      if (box) {
        const area = (box[2] - box[0]) * (box[3] - box[1]);
        if (!best || area > best.area) best = { at: dur * f, box, area };
      }
    } catch {
      // one frame failing never stops the others
    } finally {
      await fs.rm(frame, { force: true }).catch(() => undefined);
    }
  }
  if (!best) return false;
  const [x1, y1, x2, y2] = best.box;
  const faceH = (y2 - y1) * H;
  const cropH = Math.min(H, Math.max(faceH * 2, H * 0.35));
  const cropW = Math.min(W, (cropH * 16) / 9);
  const cx = ((x1 + x2) / 2) * W;
  const cy = ((y1 + y2) / 2) * H + faceH * 0.1; // a little headroom above the face
  const left = Math.round(Math.min(W - cropW, Math.max(0, cx - cropW / 2)));
  const top = Math.round(Math.min(H - cropH, Math.max(0, cy - cropH / 2)));
  await run(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-ss",
    best.at.toFixed(2),
    "-i",
    clipFile,
    "-frames:v",
    "1",
    "-vf",
    `crop=${Math.round(cropW)}:${Math.round(cropH)}:${left}:${top},scale=960:540`,
    "-q:v",
    "3",
    outFile,
  ]);
  // The finder is eager: the crop itself must read as one clear face, or there is no portrait.
  if (!(await clearFace(outFile).catch(() => false))) {
    await fs.rm(outFile, { force: true }).catch(() => undefined);
    return false;
  }
  return true;
}

/** A second look at the finished crop: one person's face, in focus, filling much of the picture. */
async function clearFace(file: string): Promise<boolean> {
  const image = (await fs.readFile(file)).toString("base64");
  const res = await fetchWithTimeout(
    `${LOCAL_VISION_URL}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: LOCAL_VISION_MODEL,
        stream: false,
        think: false,
        format: {
          type: "object",
          properties: { clear_face: { type: "boolean" } },
          required: ["clear_face"],
        },
        keep_alive: "15m",
        options: {
          temperature: 0,
          num_predict: 20 + THINK_ROOM,
          num_ctx: NUM_CTX,
        },
        messages: [
          {
            role: "user",
            content:
              "Answer clear_face: true only if this picture is a portrait of one person whose face (eyes, nose and mouth) is clearly visible, in focus, well lit and fills a large part of the picture. False for helmets seen from behind, silhouettes, blur, explosions, scenery, weapons or tiny figures.",
            images: [image],
          },
        ],
      }),
    },
    60_000,
  );
  if (!res.ok) return false;
  const body = (await res.json()) as {
    message?: { content?: string; thinking?: string };
  };
  return (visionAnswer(body) as { clear_face?: boolean }).clear_face === true;
}

/**
 * One gameplay segment's frame as the footage-first gather sees it (src/assets/footagefirst.ts): a short label
 * the planner can match to a sentence, plus the reasons a frame is junk for a documentary about this game. The
 * kids' mod uploads that reached the Vice City documentary's GTA VI chapter (Spider-Man on neon ramps, cartoon
 * zombies on shark motorbikes) are the "mod" flag; menus, loading and map screens are "menu"; a real camera
 * image (a person filmed, not rendered) is "live".
 */
export interface SegmentLook {
  label: string;
  hud: boolean;
  text: boolean;
  webcam: boolean;
  gore: boolean;
  letterbox: boolean;
  dark: boolean;
  blurry: boolean;
  mod: boolean;
  menu: boolean;
  live: boolean;
}

// Short on purpose: qwen3-vl thinks before it answers even with thinking off, and a long list of questions made
// it think past the token budget, so a quarter of the answers came back cut off with an empty label (31 Oct 2026
// experiment: the same frames answered in 1.2-3 s with a short prompt, 5-6 s with the long one).
// Six questions, not eleven: each one lengthens the model's thinking (31 Oct 2026: 5.1 s a look with eleven, the
// GPU's whole 40 minutes on four chapters). Darkness and dimness are measured from the scan, letterboxing from a
// thumbnail and menus mostly read by the OCR, so the model is not asked.
const LOOK_PROMPT = `Three frames of one gameplay segment, side by side. Answer briefly in JSON; a flag is true if it holds in any frame.
label: what it shows in under 9 plain words, never the game's name (for example "red sports car on a beach road at sunset").
text: readable words anywhere (subtitles, banners like "mission passed", big place or car names, prompts, menus, watermarks).
hud_only: all writing is the game's small corner HUD (minimap, money, health).
webcam: a facecam, picture-in-picture or stream overlay.
gore: blood, wounds or bodies.
mod: modded or kids' content (superheroes, cartoon or toy characters, giant ramps, neon obstacle courses).`;

const LOOK_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string" },
    text: { type: "boolean" },
    hud_only: { type: "boolean" },
    webcam: { type: "boolean" },
    gore: { type: "boolean" },
    mod: { type: "boolean" },
  },
  required: ["label", "text", "hud_only", "webcam", "gore", "mod"],
};

/** The model's answer as a SegmentLook; anything missing reads as false and an empty label. */
export function lookAnswer(parsed: any): SegmentLook {
  const yes = (k: string) => parsed?.[k] === true;
  const hud = yes("text") && yes("hud_only");
  return {
    // A label must describe something: the model sometimes answers "true" there (31 Oct 2026 proof).
    label: ((l: string) =>
      /^(true|false|yes|no|none|n\/a)?$/i.test(l) || !/[a-z]{3}/i.test(l)
        ? ""
        : l)(
      String(parsed?.label ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80),
    ),
    hud,
    text: yes("text") && !hud,
    webcam: yes("webcam"),
    gore: yes("gore"),
    letterbox: yes("letterbox"),
    dark: yes("dark"),
    blurry: yes("blurry"),
    mod: yes("mod"),
    menu: yes("menu"),
    live: yes("live"),
  };
}

async function lookOne(file: string): Promise<SegmentLook> {
  const image = (await fs.readFile(file)).toString("base64");
  const res = await fetchWithTimeout(
    `${LOCAL_VISION_URL}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: LOCAL_VISION_MODEL,
        stream: false,
        think: false,
        format: LOOK_SCHEMA,
        keep_alive: "15m",
        options: {
          temperature: 0,
          // Room for the thinking a cut-off answer showed it needs: Ollama stops when the answer is done.
          num_predict: 160 + 2 * THINK_ROOM,
          num_ctx: NUM_CTX,
        },
        messages: [{ role: "user", content: LOOK_PROMPT, images: [image] }],
      }),
    },
    90_000,
  );
  if (!res.ok)
    throw new Error(
      `ollama ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return lookAnswer(
    visionAnswer(
      (await res.json()) as {
        message?: { content?: string; thinking?: string };
      },
    ),
  );
}

/**
 * A label and junk flags for each frame, in order, on this PC's GPU (free: no Claude call). Undefined for a
 * frame the model could not judge, and for all of them when the local model is not running or switched off:
 * the caller then keeps nothing it could not look at.
 */
export async function lookFrames(
  files: string[],
  concurrency = 2,
): Promise<Array<SegmentLook | undefined>> {
  const out: Array<SegmentLook | undefined> = new Array(files.length).fill(
    undefined,
  );
  if (
    !files.length ||
    Date.now() < downUntil ||
    process.env.LOCAL_VISION === "off" ||
    Boolean(process.env.NODE_TEST_CONTEXT)
  )
    return out;
  if (await relayNotReady()) return out;
  let next = 0;
  let failures = 0;
  const worker = async () => {
    while (next < files.length && failures < 3) {
      const i = next++;
      try {
        out[i] = await lookOne(files[i]!);
        visionRelay.report(true);
      } catch (err) {
        failures++;
        if (failures === 3) {
          // Footage segments are not looked at for a while; the relay logs and alerts once per outage.
          downUntil = Date.now() + 10 * 60_000;
          visionRelay.report(false, errorMessage(err));
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, worker),
  );
  return out;
}

/** Whether a frame shows the moment a narration line names (src/assets/scenecheck.ts), from this PC's own model. */
export interface SubjectLook {
  /** The named subject (the character first, else the place or thing) is visibly on screen. */
  shows: boolean;
  /** 0 to 1, the model's own certainty that it does. */
  confidence: number;
  /** What the frame shows, in a few words, for the contact sheet and the log. */
  seen: string;
}

/** The subject check's answer as a SubjectLook (pure); undefined when it says nothing usable. */
export function subjectAnswer(parsed: any): SubjectLook | undefined {
  if (typeof parsed?.shows !== "boolean") return undefined;
  const c = Number(parsed.confidence);
  return {
    shows: parsed.shows,
    confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c > 1 ? c / 100 : c)) : 0,
    seen: typeof parsed.seen === "string" ? parsed.seen.slice(0, 160) : "",
  };
}

/** The question for one frame (pure): the game, the line and the names it must show. */
export function subjectPrompt(o: { game: string; line: string; names: string[] }): string {
  const names = o.names.length ? o.names.join(", ") : "what the line describes";
  return `This is one frame of a cutscene from the video game ${o.game}. A narration line will play over it: "${o.line}"
Does this frame visibly show this moment: at least one of ${names}? It need not show all of them: one named character on screen in the scene the line describes is enough. A named character counts only when that character is on screen and recognisable by their known look in this game (not someone else, not an empty room, not a face you cannot identify). A named place or object counts when it is clearly visible. When the line names a character and a place, the character matters most.
Answer shows (true or false), confidence from 0 to 1 that shows is right, and seen: what the frame shows in under 15 words.`;
}

async function subjectOne(file: string, prompt: string): Promise<SubjectLook | undefined> {
  const image = (await fs.readFile(file)).toString("base64");
  const res = await fetchWithTimeout(
    `${LOCAL_VISION_URL}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: LOCAL_VISION_MODEL,
        stream: false,
        think: false,
        format: {
          type: "object",
          properties: {
            shows: { type: "boolean" },
            confidence: { type: "number" },
            seen: { type: "string" },
          },
          required: ["shows", "confidence", "seen"],
        },
        keep_alive: "15m",
        options: { temperature: 0, num_predict: 120 + THINK_ROOM, num_ctx: NUM_CTX },
        messages: [{ role: "user", content: prompt, images: [image] }],
      }),
    },
    90_000,
  );
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return subjectAnswer(visionAnswer((await res.json()) as { message?: { content?: string; thinking?: string } }));
}

/**
 * For each frame, whether it shows what the line names, on this PC's GPU (free: never Claude, never a paid API).
 * Undefined for a frame the model could not judge, and for all of them when the local model is down, off or
 * under test: the caller then treats the moment as not confirmed.
 */
export async function subjectFrames(
  files: string[],
  ask: { game: string; line: string; names: string[] },
  concurrency = 2,
): Promise<Array<SubjectLook | undefined>> {
  const out: Array<SubjectLook | undefined> = new Array(files.length).fill(undefined);
  if (
    !files.length ||
    Date.now() < downUntil ||
    process.env.LOCAL_VISION === "off" ||
    Boolean(process.env.NODE_TEST_CONTEXT)
  )
    return out;
  if (await relayNotReady()) return out;
  const prompt = subjectPrompt(ask);
  let next = 0;
  let failures = 0;
  const worker = async () => {
    while (next < files.length && failures < 3) {
      const i = next++;
      try {
        out[i] = await subjectOne(files[i]!, prompt);
        visionRelay.report(true);
      } catch (err) {
        failures++;
        if (failures === 3) {
          downUntil = Date.now() + 10 * 60_000;
          visionRelay.report(false, errorMessage(err));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return out;
}
