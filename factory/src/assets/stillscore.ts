// The picture editor for stills: one vision pass over an entry's screenshots
// and artwork, given that entry's sentences, picks the picture that shows what
// each sentence names, labels every picture and rejects any with readable
// text. The long-form planner then puts each sentence on its own picture.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Llm, LlmContent } from "../editorial/llm.ts";
import { FFMPEG } from "../lib/bin.ts";

const run = promisify(execFile);
const MAX_STILLS = 24;

export interface StillTarget {
  key: string; // "m0", "m1" ...
  show: string;
  sentence: string;
}

export interface StillPick {
  key: string;
  image: number; // index into the images given
  label: string;
}

export const StillRankingSchema = z.object({
  images: z.array(
    z.object({
      index: z.number(),
      label: z.string().describe("What the picture shows, under 8 words"),
      has_text: z
        .boolean()
        .describe(
          "Readable words anywhere: logos, title text, menus, HUD, captions, watermarks",
        ),
    }),
  ),
  picks: z.array(
    z.object({
      key: z.string().describe("The sentence key exactly as given"),
      image_index: z.number(),
      confidence: z
        .number()
        .describe("0-1; under 0.5 means nothing truly shows it"),
    }),
  ),
});

const PROMPT = `You are the picture editor for a video game video. You see numbered pictures of one game and the sentences the narrator says about it, each with a note of what should be on screen.
For each sentence pick the picture that best shows the specific thing it names: the character, mission, place, weapon, vehicle or moment. Prefer a different picture for every sentence. Mark any picture with readable words (logos, title text, menus, HUD, captions, watermarks) as has_text. Also mark as has_text any picture showing gore or graphic violence (blood, wounds, bodies), so it is never used: the channel must stay advertiser-friendly. Confidence under 0.5 means no picture truly shows it; say so rather than forcing a match.`;

async function thumb(src: string, dest: string): Promise<void> {
  await run(FFMPEG, [
    "-loglevel",
    "error",
    "-y",
    "-i",
    src,
    "-vf",
    "scale=384:-2",
    "-q:v",
    "5",
    dest,
  ]);
}

/** Labels every picture and picks one per sentence; pictures with text are never picked. */
export async function rankStills(
  llm: Llm,
  targets: StillTarget[],
  images: Array<{ file: string }>,
  workDir: string,
  scope?: "campaign",
  /** "documentary": the game's own interface in a screenshot is fine; only stamped-on text is refused. */
  mode?: "documentary",
): Promise<{
  picks: StillPick[];
  labels: Map<number, string>;
  withText: Set<number>;
}> {
  const shown = images.slice(0, MAX_STILLS);
  const empty = {
    picks: [] as StillPick[],
    labels: new Map<number, string>(),
    withText: new Set<number>(),
  };
  if (!shown.length || !targets.length) return empty;
  await fs.mkdir(workDir, { recursive: true });
  const content: LlmContent = [];
  for (const [i, img] of shown.entries()) {
    const t = path.join(workDir, `still_${i}.jpg`);
    try {
      await thumb(img.file, t);
    } catch {
      continue;
    }
    content.push({ type: "text", text: `Picture ${i}` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: (await fs.readFile(t)).toString("base64"),
      },
    });
  }
  if (!content.length) return empty;
  content.push({
    type: "text",
    text: `Sentences:\n${targets.map((t) => `- ${t.key}: "${t.sentence}" (show: ${t.show})`).join("\n")}`,
  });
  const r = await llm.structured({
    tier: "mid",
    system: `${PROMPT}${
      scope === "campaign"
        ? `\nThis video is about the single-player story campaign. Also mark as has_text, so it is never used, any picture that shows multiplayer (an arena map, operators or skins, scoreboards, killstreaks, a lobby) or Zombies, or that you cannot place in the story campaign.`
        : ""
    }${
      mode === "documentary"
        ? `\nThis is a documentary about the game: a screenshot showing the game's own interface (the HUD, a map, money or health, in-game signs) is fine and is NOT has_text. Mark has_text only for text stamped onto the picture from outside the game: title cards and taglines, store or review text, uploader logos and watermarks, subtitles and captions, menus and text screens.`
        : ""
    }`,
    content,
    schema: StillRankingSchema,
    effort: "low",
  });
  const withText = new Set(
    r.images.filter((x) => x.has_text).map((x) => x.index),
  );
  const labels = new Map(r.images.map((x) => [x.index, x.label]));
  const used = new Set<number>();
  const picks: StillPick[] = [];
  for (const p of r.picks) {
    if (!targets.some((t) => t.key === p.key) || p.confidence < 0.5) continue;
    if (
      p.image_index < 0 ||
      p.image_index >= shown.length ||
      withText.has(p.image_index) ||
      used.has(p.image_index)
    )
      continue;
    used.add(p.image_index);
    picks.push({
      key: p.key,
      image: p.image_index,
      label: labels.get(p.image_index) ?? "",
    });
  }
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  return { picks, labels, withText };
}
