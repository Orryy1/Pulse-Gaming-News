// The critic's questions to a local vision model (CRITIC, src/qa/criticcore.ts), through Ollama on the PC: never
// Claude, never a paid API. One question per judged frame (does the picture show what the line says, which game it
// is, a fan mod, someone else's watermark) and one per graphic OCR could not find (is its text fully readable).
//
// The model: CRITIC_VISION_MODEL, else LOCAL_VISION_MODEL. A big model (CriticSettings.bigModels, about 18-20 GB)
// loads only inside an orchestrator gpu turn and is unloaded the moment the critic is done; on a machine with no
// orchestrator (the Mac) the critic uses the factory's everyday model instead, so the PC's GPU is never taken unasked.

import fs from "node:fs/promises";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import { loadOrch } from "../lib/orch.ts";
import {
  LOCAL_VISION_MODEL,
  LOCAL_VISION_URL,
  THINK_ROOM,
  visionAnswer,
  relayModels,
  hasVisionModel,
} from "../assets/localvision.ts";
import {
  frameJudgement,
  isBigModel,
  type CriticSettings,
  type FrameJudgement,
} from "./criticcore.ts";

/** The frame question (pure): the line, the game (and the chapter's game) and the graphic meant to be up. */
export function framePrompt(o: {
  line: string;
  game: string;
  chapterGame?: string;
  graphic?: string;
}): string {
  const game = o.game || "a video game";
  const chapter =
    o.chapterGame && o.chapterGame !== o.game
      ? ` This part of it is about ${o.chapterGame}.`
      : "";
  const line = o.line
    ? `The narrator says this line while the frame is on screen: "${o.line}"`
    : "No line is being spoken.";
  const graphic = o.graphic
    ? `\nA graphic with the words "${o.graphic}" is meant to be on screen now; when it is, judge the graphic and the picture together.`
    : "";
  return `You review one frame of a finished YouTube video about video games by the channel Pulse Gaming. The video is about ${game}.${chapter}
${line}${graphic}
Answer with JSON.
seen: what the frame shows, in under 15 words.
match: 0 to 3. 3: the frame shows exactly what the line says (the named game, character, place, person, object, event or figure). 2: the right game or subject but not the exact thing said. 1: only loosely related. 0: unrelated to the line, the wrong thing, broken, black or blank. A graphic or card whose words say what the line says counts as 3.
game: "named" when the picture is from ${game}${o.chapterGame && o.chapterGame !== o.game ? ` or ${o.chapterGame}` : ""}; "other" when it is clearly from a different video game; "none" when it is not a game picture (a graphic, a text card, a photo of a real person or place, hardware, a store page); "unsure" when you cannot tell.
other_game: the other game's name when game is "other", else "".
fan_mod: true only when the game picture itself is plainly a fan mod, a fake or a mash-up (characters from other franchises, joke mods). Pulse's own designed cards (store pages, case files, notes, title cards, quote cards) are not fan mods.
watermark: true when another channel's or a stock library's watermark, logo, handle or web address sits over the picture (a YouTube channel logo, an @handle, Shutterstock, Getty Images, Adobe Stock, Pond5, Storyblocks, TikTok). Pulse's own captions, its PULSE logo, its small credit lines (such as "FOOTAGE: OFFICIAL TRAILERS") and the game's own HUD or the publisher's logo on official art do not count.
watermark_text: the watermark's words, else "".`;
}

export const FRAME_SCHEMA = {
  type: "object",
  properties: {
    seen: { type: "string" },
    match: { type: "number" },
    game: { type: "string", enum: ["named", "other", "none", "unsure"] },
    other_game: { type: "string" },
    fan_mod: { type: "boolean" },
    watermark: { type: "boolean" },
    watermark_text: { type: "string" },
  },
  required: [
    "seen",
    "match",
    "game",
    "other_game",
    "fan_mod",
    "watermark",
    "watermark_text",
  ],
};

/** The graphic question (pure). */
export function graphicPrompt(text: string): string {
  return `This is one frame of a finished vertical or widescreen video. A graphic with these words should be on screen: "${text}".
Answer with JSON. visible: true when those words (or nearly all of them) are on screen, whole, not cut off by the frame's edge, not covered by another graphic or caption, and large and clear enough to read on a phone; false otherwise. seen: the words you can actually read, in under 20 words.`;
}

export const GRAPHIC_SCHEMA = {
  type: "object",
  properties: { visible: { type: "boolean" }, seen: { type: "string" } },
  required: ["visible", "seen"],
};

/** One question about one picture to a model; the parsed JSON answer, or undefined when it could not answer. */
export async function askPicture(o: {
  url?: string;
  model: string;
  prompt: string;
  schema: object;
  image: string;
  keepAlive?: string | number;
  timeoutMs?: number;
}): Promise<any | undefined> {
  const image = (await fs.readFile(o.image)).toString("base64");
  const res = await fetchWithTimeout(
    `${o.url ?? LOCAL_VISION_URL}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: o.model,
        stream: false,
        think: false,
        format: o.schema,
        keep_alive: o.keepAlive ?? "60s",
        options: {
          temperature: 0,
          num_predict: 200 + THINK_ROOM,
          num_ctx: 8192,
        },
        messages: [{ role: "user", content: o.prompt, images: [image] }],
      }),
    },
    o.timeoutMs ?? 180_000,
  );
  if (!res.ok)
    throw new Error(
      `ollama ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const parsed = visionAnswer(
    (await res.json()) as { message?: { content?: string; thinking?: string } },
  );
  return parsed && typeof parsed === "object" && Object.keys(parsed).length
    ? parsed
    : undefined;
}

/** A frame judged by the model; undefined when it could not judge. */
export async function judgeFrame(
  model: string,
  image: string,
  ask: { line: string; game: string; chapterGame?: string; graphic?: string },
): Promise<FrameJudgement | undefined> {
  return frameJudgement(
    await askPicture({
      model,
      image,
      prompt: framePrompt(ask),
      schema: FRAME_SCHEMA,
    }),
  );
}

/** Whether a graphic's words are readable on the frame, by the model; undefined when it could not say. */
export async function graphicVisible(
  model: string,
  image: string,
  text: string,
): Promise<boolean | undefined> {
  const a = await askPicture({
    model,
    image,
    prompt: graphicPrompt(text),
    schema: GRAPHIC_SCHEMA,
  });
  return typeof a?.visible === "boolean" ? a.visible : undefined;
}

/** Frees a model's memory at once (keep_alive 0); never throws. */
export async function unloadModel(
  model: string,
  url = LOCAL_VISION_URL,
): Promise<void> {
  await fetchWithTimeout(
    `${url}/api/generate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, keep_alive: 0 }),
    },
    20_000,
  ).catch(() => undefined);
}

/** Whether the relay lists a model. */
export async function relayHas(
  model: string,
  url = LOCAL_VISION_URL,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${url}/api/tags`, {}, 5_000);
    return res.ok && hasVisionModel(relayModels(await res.json()), model);
  } catch {
    return false;
  }
}

export interface ModelChoice {
  model: string;
  big: boolean;
  /** Why this model, for the report's notes. */
  why: string;
}

/**
 * Which model the critic asks (pure): the critic's own setting, unless it is a big model on a machine with no
 * orchestrator, where the everyday model stands in.
 */
export function chooseCriticModel(
  s: Pick<CriticSettings, "model" | "bigModels">,
  o: { everyday?: string; orchestrator: boolean },
): ModelChoice {
  const everyday = o.everyday ?? LOCAL_VISION_MODEL;
  const want = s.model.trim() || everyday;
  const big = isBigModel(want, s.bigModels);
  if (big && !o.orchestrator)
    return {
      model: everyday,
      big: false,
      why: `${want} needs a GPU turn from the PC orchestrator and there is none on this machine, so ${everyday} judged`,
    };
  return {
    model: want,
    big,
    why: big ? `${want} under an orchestrator heavy turn` : `${want}`,
  };
}

/** Runs `fn` with the critic's model ready: a big one inside a heavy turn (everyday model unloaded first) and unloaded after. */
export async function withCriticModel<T>(
  s: Pick<CriticSettings, "model" | "bigModels" | "leaseVram" | "leaseRam">,
  o: { job: string; est: number; priority?: number },
  fn: (choice: ModelChoice) => Promise<T>,
): Promise<T> {
  let orch: Awaited<ReturnType<typeof loadOrch>> | undefined;
  try {
    orch = await loadOrch();
  } catch {
    orch = undefined;
  }
  const choice = chooseCriticModel(s, { orchestrator: !!orch });
  if (!choice.big) return fn(choice);
  let release: () => void = () => undefined;
  try {
    // A heavy turn, not a gpu one: with mmap off the model also takes its whole size in system RAM.
    release = (await orch!.lease("heavy", {
      job: o.job,
      project: "pulse",
      priority: o.priority ?? 60,
      kind: "pulse:critic",
      est: o.est,
      vram: s.leaseVram,
      ram: s.leaseRam,
      maxWait: 90,
      onWait: (why: string) =>
        log("info", "critic waiting for the GPU", { why }),
    })) as () => void;
  } catch (err) {
    // No turn in time: the everyday model judges rather than the big one loading beside someone else's job.
    log(
      "warn",
      "critic: no GPU turn for the big model; the everyday model judges",
      { error: errorMessage(err) },
    );
    return fn({
      model: LOCAL_VISION_MODEL,
      big: false,
      why: `no GPU turn for ${choice.model} in time, so ${LOCAL_VISION_MODEL} judged`,
    });
  }
  try {
    await unloadModel(LOCAL_VISION_MODEL);
    return await fn(choice);
  } finally {
    await unloadModel(choice.model);
    release();
  }
}
