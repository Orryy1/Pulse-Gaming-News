// One question about one picture to the PC's own vision model (Ollama, qwen3-vl), with a JSON schema for the answer.
// Used by the GPU picture tools to caption a scene before outpainting, to check an extension for invented people or
// writing, to rank thumbnail candidates and to match moments across two games' footage. Free and local: never a paid
// model. LOCAL_VISION_URL and GPUVIS_VISION_MODEL (default qwen3-vl:8b, the resident one) choose the server and model.

import fs from "node:fs/promises";
import { fetchWithTimeout } from "../lib/util.ts";
import { visionAnswer } from "../assets/localvision.ts";

export const GPUVIS_VISION_URL = (
  process.env.LOCAL_VISION_URL || "http://127.0.0.1:11434"
).replace(/\/$/, "");
export const GPUVIS_VISION_MODEL =
  process.env.GPUVIS_VISION_MODEL || "qwen3-vl:8b";

export type Ask = (
  files: string[],
  prompt: string,
  schema: Record<string, unknown>,
) => Promise<any>;

/** Asks the local vision model about one or more pictures; resolves to the parsed JSON answer ({} when unreadable). */
export const askVision: Ask = async (files, prompt, schema) => {
  const images = await Promise.all(
    files.map(async (f) => (await fs.readFile(f)).toString("base64")),
  );
  const res = await fetchWithTimeout(
    `${GPUVIS_VISION_URL}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: GPUVIS_VISION_MODEL,
        stream: false,
        think: false,
        format: { type: "object", ...schema },
        keep_alive: process.env.LOCAL_VISION_KEEP_ALIVE ?? "60s",
        options: { temperature: 0, num_predict: 1200, num_ctx: 8192 },
        messages: [{ role: "user", content: prompt, images }],
      }),
    },
    180_000,
  );
  if (!res.ok)
    throw new Error(
      `vision ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return visionAnswer(
    (await res.json()) as { message?: { content?: string; thinking?: string } },
  );
};
