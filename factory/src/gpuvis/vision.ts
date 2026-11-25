// One question about one or more pictures to the PC's own vision model (Ollama), with a JSON schema for the answer.
// Used by the GPU picture tools to caption a scene before outpainting, to check an extension for invented people or
// writing, to rank thumbnail candidates and to match moments across two games' footage. Free and local: never a paid
// model. LOCAL_VISION_URL chooses the server; GPUVIS_VISION_MODEL the model for captions and checks (default
// qwen3-vl:8b, the resident one) and GPUVIS_RANK_MODEL the one that ranks thumbnails (default qwen3-vl:30b).
//
// 20 Nov 2026: this Ollama's qwen3-vl thinks even with think: false, often 2,000 to 4,000 tokens, and a budget of 1,200
// left the answer empty (every rubric score and grid ranking came back blank). So the budget is 4,096 and the answer is
// read from the reply or, failing that, the last JSON object in the thinking.

import fs from "node:fs/promises";
import { fetchWithTimeout } from "../lib/util.ts";
import { visionAnswer } from "../assets/localvision.ts";

export const GPUVIS_VISION_URL = (
  process.env.LOCAL_VISION_URL || "http://127.0.0.1:11434"
).replace(/\/$/, "");
export const GPUVIS_VISION_MODEL =
  process.env.GPUVIS_VISION_MODEL || "qwen3-vl:8b";
/**
 * The thumbnail judge. Measured 20 Nov 2026 on the GTA VI documentary's seven candidates: the 8B never finished its
 * thinking inside 4,096 tokens on a ranking; gemma3:12b answered at once but in the order shown (2, 3, 4, 5, 6, 7, 1);
 * the 30B gave a reasoned order (face close-ups first, the old cover grid last) in about a minute.
 */
export const GPUVIS_RANK_MODEL =
  process.env.GPUVIS_RANK_MODEL || "qwen3-vl:30b";

export type Ask = (
  files: string[],
  prompt: string,
  schema: Record<string, unknown>,
) => Promise<any>;

/** An Ask on a given model; resolves to the parsed JSON answer ({} when unreadable). */
export function makeAsk(
  model: string,
  numPredict = 4096,
  timeoutMs = 300_000,
): Ask {
  const ask = askImages(model, numPredict, timeoutMs);
  return async (files, prompt, schema) =>
    ask(
      await Promise.all(
        files.map(async (f) => (await fs.readFile(f)).toString("base64")),
      ),
      prompt,
      schema,
    );
}

/** The same question with the pictures already in base64 (the GPU service's /ask route). */
export function askImages(
  model: string,
  numPredict = 4096,
  timeoutMs = 300_000,
  /** How long Ollama keeps the model loaded after the answer (0 unloads it at once); LOCAL_VISION_KEEP_ALIVE or 60 s. */
  keepAlive?: string | number,
): (
  images: string[],
  prompt: string,
  schema: Record<string, unknown>,
) => Promise<any> {
  return async (images, prompt, schema) => {
    const res = await fetchWithTimeout(
      `${GPUVIS_VISION_URL}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          format: { type: "object", ...schema },
          keep_alive: keepAlive ?? process.env.LOCAL_VISION_KEEP_ALIVE ?? "60s",
          options: { temperature: 0, num_predict: numPredict, num_ctx: 8192 },
          messages: [{ role: "user", content: prompt, images }],
        }),
      },
      timeoutMs,
    );
    if (!res.ok)
      throw new Error(
        `vision ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    return visionAnswer(
      (await res.json()) as {
        message?: { content?: string; thinking?: string };
      },
    );
  };
}

/** Captions, margin checks and the match judge. */
export const askVision: Ask = makeAsk(GPUVIS_VISION_MODEL);
/** The thumbnail ranking. */
export const askRanker: Ask = makeAsk(GPUVIS_RANK_MODEL);
