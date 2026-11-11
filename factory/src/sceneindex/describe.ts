// What a shot shows, in the game's own names, from the free local vision model on the PC (Ollama, the same one
// src/assets/localvision.ts screens frames with; reached over the network from the Mac). The model sees the shot's
// keyframes (one picture each: a strip of frames side by side is squashed out of shape by models that take
// square pictures), the dialogue on screen during it and the game's cast and place lists, and answers in
// JSON. Nothing here costs money; when the model is not running a shot simply stays undescribed and is tried
// again on the next pass (it is still found by its dialogue).

import fs from "node:fs/promises";
import { fetchWithTimeout } from "../lib/util.ts";
import {
  LOCAL_VISION_MODEL,
  LOCAL_VISION_URL,
  THINK_ROOM,
  visionAnswer,
} from "../assets/localvision.ts";
import { knownName } from "./names.ts";

export interface ShotLook {
  desc: string;
  who: string[];
  where: string;
  mood: string;
  tags: string[];
  menu: boolean;
}

export interface LookContext {
  game: string;
  cast: string[];
  places: string[];
  /** Dialogue shown or said during the shot, "Speaker: words". */
  dialogue: string[];
  /** Other writing read in the shot (a place card). */
  text: string;
  frames: number;
}

/** The question put to the model for one shot (pure, so its wording is tested and stays short: the model thinks before answering). */
export function lookPrompt(c: LookContext): string {
  const list = (xs: string[], n: number) => xs.slice(0, n).join(", ");
  return [
    `${c.frames > 1 ? `${c.frames} frames of one shot, in order,` : "One frame of a shot"} from the video game "${c.game}". Describe the shot for a footage search. Answer in JSON.`,
    `description: one plain sentence, under 25 words: who does what, where. Use a character's name when you are confident who it is, otherwise describe them (for example "a red-haired man in dark armour").`,
    `characters: names of the characters visible, only from this list: ${list(c.cast, 40) || "(no list: leave empty unless the dialogue names them)"}.`,
    `place: where it is, from this list when it fits: ${list(c.places, 30) || "(no list)"}; otherwise two or three plain words ("a forest clearing").`,
    `mood: one or two words.`,
    `tags: 4 to 8 single search words not already in the description: objects, actions, weather, colours.`,
    `menu: true only for a menu, map, inventory, loading or title screen with no scene behind it.`,
    c.dialogue.length
      ? `Dialogue on screen during this shot (the speaker is usually the character shown): ${c.dialogue.slice(0, 4).join(" | ").slice(0, 500)}`
      : "",
    c.text ? `Other writing read in the shot: ${c.text.slice(0, 120)}` : "",
    `Ignore subtitles and name plates in the picture itself; never copy them into the description.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string" },
    characters: { type: "array", items: { type: "string" } },
    place: { type: "string" },
    mood: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    menu: { type: "boolean" },
  },
  required: ["description", "characters", "place", "mood", "tags", "menu"],
};

const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/**
 * The model's answer as a ShotLook (pure): characters kept only when they are on the game's list (or a speaker
 * named on screen), in the list's spelling; a place takes the list's spelling when it is on it; a description that
 * describes nothing ("true", "none") is empty. Undefined when the answer has no description at all.
 */
export function lookAnswer(
  parsed: any,
  c: Pick<LookContext, "cast" | "places">,
): ShotLook | undefined {
  const desc = clean(parsed?.description, 220);
  if (!/[a-z]{3}/i.test(desc) || /^(true|false|yes|no|none|n\/a)$/i.test(desc))
    return undefined;
  const who: string[] = [];
  for (const raw of Array.isArray(parsed?.characters)
    ? parsed.characters
    : []) {
    const name = knownName(clean(raw, 40), c.cast);
    if (name && !who.includes(name)) who.push(name);
  }
  const place = clean(parsed?.place, 60);
  const tags = (Array.isArray(parsed?.tags) ? parsed.tags : [])
    .map((t: unknown) => clean(t, 24).toLowerCase())
    .filter((t: string) => /[a-z]{3}/.test(t))
    .slice(0, 10);
  return {
    desc,
    who: who.slice(0, 6),
    where: /^(none|unknown|n\/a|unclear)?$/i.test(place)
      ? ""
      : (knownName(place, c.places) ?? place),
    mood: clean(parsed?.mood, 30).toLowerCase(),
    tags: [...new Set<string>(tags)],
    menu: parsed?.menu === true,
  };
}

/** True when the vision model answers at all (the PC is on and Ollama is running). */
export async function visionUp(url = LOCAL_VISION_URL): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${url}/api/version`, {}, 5_000);
    return res.ok;
  } catch {
    return false;
  }
}

/** One shot's keyframes, in order, looked at by the local model. Throws when the model cannot be reached. */
export async function lookAtShot(
  files: string[],
  c: LookContext,
): Promise<ShotLook | undefined> {
  const images = await Promise.all(
    files.map(async (file) => (await fs.readFile(file)).toString("base64")),
  );
  const ask = (plain: boolean) =>
    fetchWithTimeout(
    `${LOCAL_VISION_URL}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: LOCAL_VISION_MODEL,
        stream: false,
        ...(plain ? {} : { think: false }),
        format: SCHEMA,
        keep_alive: "15m",
        options: {
          temperature: 0,
          num_predict: 260 + 2 * THINK_ROOM,
          num_ctx: 8192,
        },
        messages: [{ role: "user", content: lookPrompt(c), images }],
      }),
    },
    120_000,
    );
  let res = await ask(false);
  // A model with no thinking mode can refuse the field outright: the same question without it.
  if (res.status === 400) res = await ask(true);
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
    c,
  );
}
