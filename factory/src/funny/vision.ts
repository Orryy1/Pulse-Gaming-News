// The comedy check (FUNNY_VISION): four frames around a candidate's payoff go to the PC's local vision relay (Ollama,
// LOCAL_VISION_URL and LOCAL_VISION_MODEL), never to the paid API, whatever VISION_PAID_FALLBACK says. When the relay
// is down or lacks its model, there is no verdict and the moment waits (the daily job tries again on its next pass).

import fs from "node:fs/promises";
import { fetchWithTimeout } from "../lib/util.ts";
import {
  LOCAL_VISION_MODEL,
  LOCAL_VISION_URL,
  visionAnswer,
  visionModelProblem,
} from "../assets/localvision.ts";
import type { VisionVerdict } from "./moments.ts";
import { captionProblems } from "./edit.ts";

export const COMEDY_PROMPT = `You see four frames, one second apart, from the owner's own video game stream (the middle of them is the moment chosen). Rate how funny this moment would be as a 15-second clip for gamers, as a friend would judge it.
Funny means: physics chaos (ragdolls, cars flipping, things flying), NPCs acting weird, glitches, fails (a crash, a missed jump, getting caught out), near misses that go wrong. Ordinary driving, flying or walking is 1-3. A menu, map, phone or loading screen is 0. Motion blur, a spinning rotor, fog, darkness and frame-rate stutter are not glitches. Be strict: most moments are 2-4, and 7 or more means a friend would send it to someone.
funny: 0-10.
kind: one of physics, npc, glitch, fail, near_miss, none.
why: under 12 words, what happens.
caption: 2-6 words a friend would put on it, playful, no swearing, no names, no cruelty.
menu: true when any frame is a pause menu, map, phone screen, loading or alert screen.
cutscene: true when the frames show a story cutscene rather than play.
gore: true for blood, wounds or bodies.
radio_on_screen: true when a radio station name or the radio wheel shows.`;

const SCHEMA = {
  type: "object",
  properties: {
    funny: { type: "number" },
    kind: { type: "string" },
    why: { type: "string" },
    caption: { type: "string" },
    menu: { type: "boolean" },
    cutscene: { type: "boolean" },
    gore: { type: "boolean" },
    radio_on_screen: { type: "boolean" },
  },
  required: [
    "funny",
    "kind",
    "why",
    "caption",
    "menu",
    "cutscene",
    "gore",
    "radio_on_screen",
  ],
};

const KINDS = ["physics", "npc", "glitch", "fail", "near_miss", "none"];

/** The model's answer as a verdict, or undefined when it is unreadable (pure). */
export function comedyVerdict(body: {
  message?: { content?: string; thinking?: string };
}): VisionVerdict | undefined {
  const a = visionAnswer(body);
  if (!a || typeof a !== "object" || typeof a.funny !== "number")
    return undefined;
  const flag = (k: string) => a[k] === true;
  const caption =
    typeof a.caption === "string"
      ? a.caption.trim().replace(/^["']|["']$/g, "")
      : "";
  return {
    funny: Math.max(0, Math.min(10, Math.round(a.funny))),
    kind: KINDS.includes(String(a.kind)) ? String(a.kind) : "none",
    why: String(a.why ?? "").slice(0, 120),
    ...(caption && !captionProblems(caption).length ? { caption } : {}),
    menu: flag("menu"),
    cutscene: flag("cutscene"),
    gore: flag("gore"),
    radio_on_screen: flag("radio_on_screen"),
  };
}

/** One comedy check on the PC relay; undefined when the relay is not ready or could not judge. Never paid. */
export async function rateComedy(
  frames: string[],
): Promise<VisionVerdict | undefined> {
  if (
    !frames.length ||
    process.env.NODE_TEST_CONTEXT ||
    process.env.LOCAL_VISION === "off"
  )
    return undefined;
  if (await visionModelProblem()) return undefined;
  const images = await Promise.all(
    frames.map(async (f) => (await fs.readFile(f)).toString("base64")),
  );
  // Four pictures make qwen3-vl think at length even with think off (14 Nov 2026: 2,100 tokens of thinking and no
  // answer on half the moments). "/no_think" cuts it short and the budget leaves room for what is left; one more try
  // when the answer still did not arrive.
  for (let attempt = 0; attempt < 2; attempt++) {
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
          keep_alive: process.env.LOCAL_VISION_KEEP_ALIVE ?? "60s",
          options: { temperature: 0, num_predict: COMEDY_TOKENS, num_ctx: 8192 },
          messages: [{ role: "user", content: `${COMEDY_PROMPT} /no_think`, images }],
        }),
      },
      COMEDY_TIMEOUT_MS,
    ).catch(() => undefined);
    if (!res?.ok) continue;
    const v = comedyVerdict((await res.json()) as { message?: { content?: string; thinking?: string } });
    if (v) return v;
  }
  return undefined;
}

/** Tokens for the thinking the model does anyway plus the answer. */
export const COMEDY_TOKENS = 4096;

/** How long one comedy check may take on a busy GPU. */
export const COMEDY_TIMEOUT_MS = 240_000;
