// A first look at candidate frames on this PC's own GPU (a local vision model
// through Ollama), so only clean frames reach Claude. Each frame is checked
// for the things that disqualify footage outright: words on screen, a
// streamer's webcam or recording overlay, gore, letterboxing, darkness, blur.
// When Ollama is not running every frame passes through unchanged.

import fs from "node:fs/promises";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";

export interface FrameFlags {
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
webcam: a real person's webcam or facecam, a picture-in-picture box, stream chat, alerts or any recording or streaming overlay on top of the game.
gore: blood sprays, wounds, dead bodies, executions.
letterbox: black bars covering more than a third of the frame.
dark: the frame is mostly black or so dark that a viewer cannot tell what is happening.
blurry: the frame is heavily blurred, smeared or an unreadable close-up of a texture.`;

const SCHEMA = {
  type: "object",
  properties: {
    text: { type: "boolean" },
    webcam: { type: "boolean" },
    gore: { type: "boolean" },
    letterbox: { type: "boolean" },
    dark: { type: "boolean" },
    blurry: { type: "boolean" },
  },
  required: ["text", "webcam", "gore", "letterbox", "dark", "blurry"],
};

/** Whether a frame is unusable as footage, and why. Text alone is reported separately: it also marks where a clip must stop. */
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
        options: { temperature: 0, num_predict: 120 },
        messages: [{ role: "user", content: PROMPT, images: [image] }],
      }),
    },
    90_000,
  );
  if (!res.ok)
    throw new Error(
      `ollama ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const body = (await res.json()) as { message?: { content?: string; thinking?: string } };
  // Some vision models put their whole answer in the thinking field even with thinking off.
  const parsed = JSON.parse(body.message?.content?.trim() || body.message?.thinking?.trim() || "{}");
  return Object.fromEntries(
    Object.keys(SCHEMA.properties).map((k) => [k, parsed[k] === true]),
  ) as unknown as FrameFlags;
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
