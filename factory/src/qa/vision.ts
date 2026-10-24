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

export async function visionQa(llm: Llm, frames: string[], context: { headline: string; gameTitle: string; format?: "short" | "long" }): Promise<VisionQa> {
  const content: LlmContent = [];
  for (const [i, f] of frames.entries()) {
    content.push({ type: "text", text: `Frame ${i + 1} of ${frames.length}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await fs.readFile(f)).toString("base64") } });
  }
  content.push({ type: "text", text: `Headline: ${context.headline}\nGame: ${context.gameTitle || "(not about one game)"}` });
  return llm.structured({ system: context.format === "long" ? LONG_VISION_PROMPT : VISION_PROMPT, content, schema: VisionQaSchema, effort: "low" });
}
