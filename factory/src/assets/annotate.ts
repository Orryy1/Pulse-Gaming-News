// Where a named thing sits in a picture, from the local vision model (Qwen3-VL through Ollama, as for the
// footage screen in localvision.ts), for the long videos' "zoom to the detail" annotations: when a
// sentence names something on screen, the camera pushes in on it and a labelled box draws itself on
// (the Game Maker's Toolkit look, owner 27 Oct 2026). Nothing is drawn unless the model finds the thing.
import fs from "node:fs/promises";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import { LOCAL_VISION_MODEL, LOCAL_VISION_URL } from "./localvision.ts";

/** A box as fractions of the picture: [left, top, right, bottom], 0 to 1. */
export type Box = [number, number, number, number];

const SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    bbox_2d: { type: "array", items: { type: "number" } },
  },
  required: ["found", "bbox_2d"],
};

/** A box worth drawing: inside the picture, not a sliver, not most of the frame. */
export function usableBox(raw: unknown): Box | undefined {
  if (
    !Array.isArray(raw) ||
    raw.length !== 4 ||
    !raw.every((n) => typeof n === "number" && Number.isFinite(n))
  )
    return undefined;
  const [x1, y1, x2, y2] = (raw as number[]).map(
    (n) => Math.max(0, Math.min(1000, n)) / 1000,
  ) as Box;
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return undefined;
  const area = w * h;
  if (area < 0.004 || area > 0.45) return undefined;
  // A tall sign or a long car can be thin one way: only a sliver both ways is too small to point at.
  if (Math.min(w, h) < 0.012 || Math.max(w, h) < 0.05) return undefined;
  return [x1, y1, x2, y2];
}

/** Where `what` is in the picture, or undefined when it is not clearly there (or the model is not running). */
export async function locate(
  file: string,
  what: string,
): Promise<Box | undefined> {
  if (process.env.LOCAL_VISION === "off" || process.env.NODE_TEST_CONTEXT)
    return undefined;
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
          format: SCHEMA,
          keep_alive: "5m",
          options: { temperature: 0, num_predict: 120, num_ctx: 8192 },
          messages: [
            {
              role: "user",
              content: `Locate ${what} in this image. Only if it is clearly visible, answer found true and its bounding box as bbox_2d [x1, y1, x2, y2] in 0-1000 coordinates relative to the image width and height. If it is not visible, or you are unsure it is this exact thing, answer found false and an empty bbox_2d.`,
              images: [image],
            },
          ],
        }),
      },
      90_000,
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as {
      message?: { content?: string; thinking?: string };
    };
    const ans = JSON.parse(
      body.message?.content?.trim() || body.message?.thinking?.trim() || "{}",
    );
    return ans.found === true ? usableBox(ans.bbox_2d) : undefined;
  } catch (err) {
    log("warn", "locate failed", { what, error: errorMessage(err) });
    return undefined;
  }
}

/** A label worth putting on screen: a name, not the game itself or a generic word. */
export function annotationLabel(
  m: { person?: string; keywords?: string[]; show?: string },
  game: string,
): string | undefined {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const g = norm(game);
  for (const c of [m.person, ...(m.keywords ?? [])]) {
    const t = (c ?? "").trim();
    if (!t || t.split(/\s+/).length > 5 || t.length > 32) continue;
    const n = norm(t);
    if (
      !n ||
      n === g ||
      g.includes(n) ||
      /^(gameplay|trailer|footage|screenshot|logo|title|menu|the game)$/.test(n)
    )
      continue;
    return t;
  }
  return undefined;
}
