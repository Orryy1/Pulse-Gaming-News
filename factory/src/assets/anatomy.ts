// Where an anatomy explainer's callouts point (EXPLAINERS, src/render/components/explainers/Anatomy.tsx): the free
// local vision model on the PC (Ollama qwen3-vl, reached through src/assets/localvision.ts like every other vision
// check) is shown each candidate screenshot with the parts the line names and says where each one is. A part the
// model cannot see is dropped; a picture that shows fewer than two parts is passed over for the next; none good
// enough and the anatomy explainer is dropped, so a callout never points at something that is not there.

import type { Explainer } from "../render/components/explainers/types.ts";
import { visibleCrop, type Orientation } from "../render/components/explainers/layout.ts";

/** The JSON shape the model answers in (Ollama's structured output). */
export const ANATOMY_SCHEMA = {
  type: "object",
  properties: {
    parts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          visible: { type: "boolean" },
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["n", "visible", "x", "y"],
      },
    },
  },
  required: ["parts"],
} as const;

export function anatomyPrompt(labels: string[], game: string): string {
  return `This is a picture from the video game ${game || "in the story"}. Find each of these things in it:\n${labels
    .map((l, i) => `${i + 1}. ${l}`)
    .join(
      "\n",
    )}\nFor each, answer n (its number), visible (true only when you can clearly see that exact thing in this picture), and x and y: the centre of the thing on a 0-1000 grid across the picture's width and down its height (0 at the left and top, 1000 at the right and bottom). When it is not clearly visible, answer visible false and x and y 0.`;
}

/** Room for the model's reasoning: qwen3-vl thinks before it answers even when asked not to, and a cut answer is empty. */
export const ANATOMY_TOKENS = 2600;

/**
 * One picture and prompt to the local vision model, the way the factory reaches it (src/assets/localvision.ts
 * visionTarget: the PC's Ollama, or the Mac's when that is how the factory is set), answered in ANATOMY_SCHEMA.
 */
export async function anatomyAsk(
  file: string,
  prompt: string,
  timeoutMs = 120_000,
): Promise<unknown> {
  const fs = await import("node:fs/promises");
  const { visionTarget, visionAnswer } = await import("./localvision.ts");
  const { fetchWithTimeout } = await import("../lib/util.ts");
  const where = await visionTarget();
  const image = (await fs.readFile(file)).toString("base64");
  const res = await fetchWithTimeout(
    `${where.url}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: where.model,
        stream: false,
        think: false,
        format: ANATOMY_SCHEMA,
        keep_alive: process.env.LOCAL_VISION_KEEP_ALIVE ?? "20s",
        options: { temperature: 0, num_predict: ANATOMY_TOKENS, num_ctx: 8192 },
        messages: [{ role: "user", content: prompt, images: [image] }],
      }),
    },
    timeoutMs,
  );
  if (!res.ok)
    throw new Error(
      `ollama ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return visionAnswer(
    (await res.json()) as { message?: { content?: string; thinking?: string } },
  );
}

/** The model's answer as points per item (pure): undefined for an item it could not see or placed off the picture. */
export function anatomyPoints(
  answer: unknown,
  count: number,
): Array<{ x: number; y: number } | undefined> {
  const parts =
    (
      answer as {
        parts?: Array<{
          n?: number;
          visible?: boolean;
          x?: number;
          y?: number;
        }>;
      }
    )?.parts ?? [];
  const out: Array<{ x: number; y: number } | undefined> = Array.from(
    { length: count },
    () => undefined,
  );
  for (const p of parts) {
    const i = Number(p.n) - 1;
    if (!(i >= 0 && i < count) || p.visible !== true) continue;
    const x = Number(p.x) / 1000;
    const y = Number(p.y) / 1000;
    // Keep a margin: a point on the very edge is a guess, and its callout would run off the board.
    if (!(x >= 0.04 && x <= 0.96 && y >= 0.04 && y <= 0.96)) continue;
    out[i] = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
  }
  return out;
}

/** The longest the placing may take for one explainer, all pictures together: a stalled model never holds a render. */
export const ANATOMY_BUDGET_MS = 90_000;

/**
 * The anatomy explainer placed on the first picture that shows at least two of its parts inside what the board will
 * show of it (the picture is cover-cropped to the board, ./layout.ts visibleCrop), with only the parts the model saw;
 * undefined when no picture does. Pictures are tried in order (the caller ranks them); `ask` sends one picture and
 * prompt to the vision model and returns its parsed answer. A failed or timed-out call ends the search: the model is
 * down or stalled, and the next picture would only wait as long.
 */
export async function placeAnatomy(
  e: Explainer,
  pictures: Array<{ file: string; src: string; aspect?: number }>,
  game: string,
  ask: (file: string, prompt: string) => Promise<unknown>,
  log: (note: string) => void = () => undefined,
  o: { orientation?: Orientation; budgetMs?: number; now?: () => number } = {},
): Promise<Explainer | undefined> {
  if (e.type !== "anatomy") return e;
  const labels = e.items.map((i) => i.label);
  const now = o.now ?? Date.now;
  const until = now() + (o.budgetMs ?? ANATOMY_BUDGET_MS);
  for (const pic of pictures.slice(0, 4)) {
    if (now() > until) {
      log("anatomy: out of time");
      break;
    }
    let answer: unknown;
    try {
      answer = await ask(pic.file, anatomyPrompt(labels, game));
    } catch (err) {
      log(`vision failed on ${pic.file}: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
      break;
    }
    const aspect = pic.aspect ?? 16 / 9;
    const crop = visibleCrop(aspect, o.orientation ?? "tall");
    const pts = anatomyPoints(answer, labels.length).map((p) =>
      p && p.x >= crop.x0 && p.x <= crop.x1 && p.y >= crop.y0 && p.y <= crop.y1 ? p : undefined,
    );
    const seen = pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    log(`${pic.file}: sees ${seen.length} of ${labels.length} on screen (${seen.map((i) => labels[i]).join(", ")})`);
    if (seen.length < 2) continue;
    return {
      ...e,
      items: seen.map((i) => e.items[i]!),
      points: seen.map((i) => pts[i]!),
      picture: pic.src,
      aspect,
    };
  }
  return undefined;
}
