// A first look at candidate frames on this PC's own GPU (a local vision model
// through Ollama), so only clean frames reach Claude. Each frame is checked
// for the things that disqualify footage outright: words on screen, a
// streamer's webcam or recording overlay, gore, letterboxing, darkness, blur.
// When Ollama is not running every frame passes through unchanged.

import fs from "node:fs/promises";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";

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

// One frame and a short answer fit easily: the default 32k context held gigabytes the renderer needs.
const NUM_CTX = 8192;

/** Unloads the vision model (it would otherwise stay resident for 15 minutes), freeing memory for a render. */
export async function unloadLocalVision(): Promise<void> {
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
  const parsed = visionAnswer(body);
  const yes = (k: string) => parsed[k] === true;
  // Writing that is only the game's own small HUD does not count as text on screen.
  const hud = yes("text") && yes("hud_only");
  return {
    hud,
    text: yes("text") && !hud,
    webcam: yes("webcam"),
    gore: yes("gore"),
    letterbox: yes("letterbox"),
    dark: yes("dark"),
    blurry: yes("blurry"),
  };
}

/**
 * Flags for each frame, in order; undefined for a frame the model could not
 * judge (or for all of them when the local model is not running), which
 * callers treat as "let Claude decide".
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
  let next = 0;
  let failures = 0;
  const worker = async () => {
    while (next < files.length && failures < 3) {
      const i = next++;
      try {
        out[i] = await checkOne(files[i]!);
      } catch (err) {
        failures++;
        if (failures === 3) {
          // Not running or broken: stop trying for a while and let Claude see everything.
          downUntil = Date.now() + 10 * 60_000;
          log(
            "warn",
            "local vision unavailable; frames go straight to Claude",
            { error: errorMessage(err) },
          );
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

const LOOK_PROMPT = `You look at three frames of one few-second segment of a gameplay recording, side by side (start, middle, end), for a documentary editor. Give a short label for the segment and answer each question with true or false; a question is true when it holds in any of the three frames.
label: what the segment shows, under 9 words, concrete nouns (for example "red sports car on a palm-lined beach road at sunset"). Never leave it empty.
text: any readable words anywhere: titles, subtitles, captions, banners such as "mission passed", place and vehicle names written large, menus, objective text, watermarks, channel names, subscribe buttons.
hud_only: true only when every piece of writing is the game's own small heads-up display in a corner (minimap, ammo, health, money); false when there is any other writing, and false when there is no writing at all.
webcam: a real person's webcam or facecam, a picture-in-picture box, stream chat, alerts or any recording overlay.
gore: blood sprays, wounds, dead bodies, executions.
letterbox: black bars covering more than a third of the frame.
dark: mostly black or too dark to tell what is happening.
blurry: heavily blurred, smeared or an unreadable close-up of a texture.
mod: the game has been modded or turned into kids' content: superheroes or cartoon and toy characters (Spider-Man, Hulk, Sonic, Minions, cartoon zombies or animals), giant ramps, neon obstacle courses, impossible vehicles or objects pasted into the world.
menu: a menu, pause screen, loading screen, title screen, map screen or settings screen rather than the game world.
live: a real camera image of real people or places, not a rendered game.`;

const LOOK_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string" },
    text: { type: "boolean" },
    hud_only: { type: "boolean" },
    webcam: { type: "boolean" },
    gore: { type: "boolean" },
    letterbox: { type: "boolean" },
    dark: { type: "boolean" },
    blurry: { type: "boolean" },
    mod: { type: "boolean" },
    menu: { type: "boolean" },
    live: { type: "boolean" },
  },
  required: [
    "label",
    "text",
    "hud_only",
    "webcam",
    "gore",
    "letterbox",
    "dark",
    "blurry",
    "mod",
    "menu",
    "live",
  ],
};

/** The model's answer as a SegmentLook; anything missing reads as false and an empty label. */
export function lookAnswer(parsed: any): SegmentLook {
  const yes = (k: string) => parsed?.[k] === true;
  const hud = yes("text") && yes("hud_only");
  return {
    label: String(parsed?.label ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80),
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
          num_predict: 160 + THINK_ROOM,
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
  let next = 0;
  let failures = 0;
  const worker = async () => {
    while (next < files.length && failures < 3) {
      const i = next++;
      try {
        out[i] = await lookOne(files[i]!);
      } catch (err) {
        failures++;
        if (failures === 3) {
          downUntil = Date.now() + 10 * 60_000;
          log("warn", "local vision unavailable; footage segments not looked at", {
            error: errorMessage(err),
          });
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, worker),
  );
  return out;
}
