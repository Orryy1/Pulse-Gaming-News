// Visual QA: a vision model looks at sampled frames the way a viewer would.

import fs from "node:fs/promises";
import type { Llm, LlmContent } from "../editorial/llm.ts";
import { VisionQaSchema, type VisionQa } from "../editorial/schema.ts";

export const VISION_PROMPT = `You are the final visual quality checker for a vertical YouTube Short from a gaming news channel.
You see frames sampled across the video in order. Fail the video only for real problems a viewer would notice:
- text that is cut off, overlapping other text, unreadable against the background or misspelt,
- broken or missing images, obvious rendering artefacts, mostly empty or black frames,
- artwork clearly showing a different game from the one named in the headline,
- anything advertiser-unfriendly (gore, nudity, offensive imagery).
Stylistic preferences are not failures. Note them in "notes". Captions show a few uppercase words of a sentence at a time and may start or end mid-sentence; judge spelling in that context (possessive "its" is correct English, not a missing apostrophe).
A Short with no game artwork (dark brand-plate backgrounds with the game's name) is a deliberate choice when no official art exists; never fail for that or for empty space below the captions.
Real-world footage carrying a small ILLUSTRATIVE tag is deliberate licensed stock for a real-world story; never fail it for not showing the game.`;

export const LONG_VISION_PROMPT = `You are the final visual quality checker for a 16:9 long-form ranking video (five to seven minutes) from a gaming channel.
You see frames sampled across the video in order. Fail the video only for real problems a viewer would notice:
- text that is cut off, overlapping other text, unreadable against the background or misspelt,
- broken or missing images, obvious rendering artefacts, mostly empty or black frames,
- a lower-third card naming one game over artwork or footage clearly from a different game,
- anything advertiser-unfriendly (gore, nudity, offensive imagery).
Stylistic preferences are not failures. Note them in "notes". Captions show a few uppercase words of a sentence at a time and may start or end mid-sentence; judge spelling in that context (possessive "its" is correct English, not a missing apostrophe). Dark brand-plate backgrounds with the theme's name are a deliberate choice when no art exists; never fail for that.`;

/** The graphics check: one frame from each full-screen graphic and chapter breather of a long video. */
export const GRAPHICS_VISION_PROMPT = `You check the on-screen graphics of a 16:9 gaming documentary or ranking before it is published.
Each frame shows one animated graphic (a chart, map, quote card, recreated document, console-menu homage, chapter title card and so on) at the moment it should be fully readable.
Fail a frame only for a real fault a viewer would notice: text cut off at an edge or by another element, text overlapping other text, text unreadable against its background, misspelt or garbled words, raw code or placeholder text, broken or missing images, empty panels or boxes where content clearly belongs, elements spilling outside the frame, or anything advertiser-unfriendly.
Deliberate looks are not faults: redaction bars, scanlines, VHS noise, pixel art, film grain, torn paper, handwriting, retro or console-menu styling, an ILLUSTRATION tag, a frame still mid-animation with something partly drawn.
Write every problem as "Frame N: what is wrong", one per frame, using the frame numbers given. Pass when nothing is wrong.`;

/** The thumbnail check: the designs that will go to YouTube. */
export const THUMB_VISION_PROMPT = `You check YouTube thumbnails for a gaming channel before they are used. Each frame is one 1280x720 thumbnail.
Fail a thumbnail only for a real fault: words cut off or overlapping, words unreadable at phone size, garbled or misspelt words, a broken or missing picture, a large empty area, an awkward crop that cuts the main subject's face in half, or anything advertiser-unfriendly.
Bold styling, outlines, glow, red circles, console or retro looks and the PULSE badge are deliberate.
Write every problem as "Frame N: what is wrong", using the frame numbers given. Pass when nothing is wrong.`;

/** The frame numbers (1-based) a checker's problems name. */
export function framesNamed(problems: string[]): number[] {
  const out = new Set<number>();
  for (const p of problems)
    for (const m of p.matchAll(/frames?\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)/gi))
      for (const n of m[1]!.split(/\s*(?:,|and|&)\s*/i))
        if (Number(n) > 0) out.add(Number(n));
  return [...out];
}

export async function visionQa(
  llm: Llm,
  frames: string[],
  context: {
    headline: string;
    gameTitle: string;
    format?: "short" | "long" | "graphics" | "thumbs";
  },
): Promise<VisionQa> {
  const content: LlmContent = [];
  for (const [i, f] of frames.entries()) {
    content.push({ type: "text", text: `Frame ${i + 1} of ${frames.length}` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: (await fs.readFile(f)).toString("base64"),
      },
    });
  }
  content.push({
    type: "text",
    text: `Headline: ${context.headline}\nGame: ${context.gameTitle || "(not about one game)"}`,
  });
  const system =
    context.format === "long"
      ? LONG_VISION_PROMPT
      : context.format === "graphics"
        ? GRAPHICS_VISION_PROMPT
        : context.format === "thumbs"
          ? THUMB_VISION_PROMPT
          : VISION_PROMPT;
  // The graphics check now looks at every graphic of a long video (up to 200 stills before the render), so it
  // runs on the mid tier; the other checks are a handful of frames and keep the top tier.
  return llm.structured({
    system,
    content,
    schema: VisionQaSchema,
    effort: "low",
    ...(context.format === "graphics" ? { tier: "mid" as const } : {}),
  });
}
