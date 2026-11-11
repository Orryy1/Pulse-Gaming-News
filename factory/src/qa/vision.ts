// Visual QA: a vision model looks at sampled frames the way a viewer would.

import fs from "node:fs/promises";
import type { Llm, LlmContent } from "../editorial/llm.ts";
import { VisionQaSchema, type VisionQa } from "../editorial/schema.ts";
import { whenVisionPaused } from "../assets/visionrelay.ts";

/**
 * What a check returns when it could not look: the PC vision relay is down and VISION_PAID_FALLBACK is off. It
 * passes, exactly as with VISION_QA off, so no slot waits for the relay; the note says the check was skipped.
 */
export const VISION_SKIPPED: VisionQa = {
  verdict: "pass",
  problems: [],
  notes:
    "Not checked: the PC vision relay was down and the paid fallback is off (VISION_PAID_FALLBACK).",
};

export const VISION_PROMPT = `You are the final visual quality checker for a vertical YouTube Short from a gaming news channel.
You see frames sampled across the video in order. Fail the video only for real problems a viewer would notice:
- text that is cut off, overlapping other text, unreadable against the background or misspelt,
- broken or missing images, obvious rendering artefacts, mostly empty or black frames,
- artwork clearly showing a different game from the one named in the headline, including the wrong entry or era of a series when it is plain from the picture and the narration (a 2012 remake's logo over a story about the 2005 original, a modern game's art on a line about the first one),
- large lettering burned into a trailer or poster behind the captions: a game's title, "LAUNCH TRAILER", a review quote or a date card, especially when the vertical crop leaves it as a giant fragment ("ULTIMATE SO") or it collides with the captions. Small in-game text, a HUD or a sign in the world is fine,
- anything advertiser-unfriendly (gore, nudity, offensive imagery), including any sexualised or suggestive character or person, drawn or real, and any crop dominated by a chest, groin or underwear: fail these whatever the game, and always fail if the character could be under 18.
Frame 1 and the last frame matter most: frame 1 is what the viewer decides on, and the last frame is what the Short loops from. Judge both with the same care as the rest and name them when they are at fault.
Stylistic preferences are not failures. Note them in "notes". Captions show a few uppercase words of a sentence at a time and may start or end mid-sentence; judge spelling in that context (possessive "its" is correct English, not a missing apostrophe).
A frame with captions over a plain dark panel and no picture is an empty screen, not a design choice: fail it when it is frame 1 or when two or more frames show it. One such frame elsewhere goes in the notes. Never fail for empty space below the captions when a picture fills the frame.
Real-world footage carrying a small ILLUSTRATIVE tag is deliberate licensed stock for a real-world story; never fail it for not showing the game.`;

/**
 * Where a Short's frames are judged: the opening, each line after its card lands, the last second. Always both ends,
 * however many lines there are: until 5 Nov 2026 the list was cut at eight and a Short with many lines was never
 * judged on the frame it loops from.
 */
export function shortSampleTimes(
  segmentStarts: number[],
  duration: number,
  max = 8,
): number[] {
  const first = 0.8;
  const last = duration - 1;
  const inner = segmentStarts
    .slice(1)
    .map((t) => t + 1.2)
    .filter((t) => t > first && t < last);
  const room = Math.max(0, max - 2);
  const picked =
    inner.length <= room
      ? inner
      : Array.from(
          { length: room },
          (_, i) => inner[Math.floor(((i + 0.5) * inner.length) / room)]!,
        );
  return [first, ...picked, last].filter((t) => t >= 0 && t < duration);
}

export const LONG_VISION_PROMPT = `You are the final visual quality checker for a 16:9 long-form ranking video (five to seven minutes) from a gaming channel.
You see frames sampled across the video in order. Fail the video only for real problems a viewer would notice:
- text that is cut off, overlapping other text, unreadable against the background or misspelt,
- broken or missing images, obvious rendering artefacts, mostly empty or black frames,
- a lower-third card naming one game over artwork or footage clearly from a different game,
- anything advertiser-unfriendly (gore, nudity, offensive imagery), including any sexualised or suggestive character or person, drawn or real, and any crop dominated by a chest, groin or underwear: fail these whatever the game, and always fail if the character could be under 18.
Stylistic preferences are not failures. Note them in "notes". Captions show a few uppercase words of a sentence at a time and may start or end mid-sentence; judge spelling in that context (possessive "its" is correct English, not a missing apostrophe). Dark brand-plate backgrounds with the theme's name are a deliberate choice when no art exists; never fail for that.`;

/** The graphics check: one frame from each full-screen graphic and chapter breather of a long video. */
export const GRAPHICS_VISION_PROMPT = `You check the on-screen graphics of a 16:9 gaming documentary or ranking before it is published.
Each frame shows one animated graphic (a chart, map, quote card, recreated document, console-menu homage, chapter title card and so on) at the moment it should be fully readable.
Fail a frame only for a real fault a viewer would notice: text cut off at an edge or by another element, text overlapping other text, text unreadable against its background, misspelt or garbled words, raw code or placeholder text, broken or missing images, empty panels or boxes where content clearly belongs, elements spilling outside the frame, or anything advertiser-unfriendly.
Deliberate looks are not faults: redaction bars, scanlines, VHS noise, pixel art, film grain, torn paper, handwriting, retro or console-menu styling, an ILLUSTRATION tag, a frame still mid-animation with something partly drawn.
Also intended, never a fault: grey placeholder bars standing in for body text on a recreated press page, article or magazine card; a scrolling news ticker whose words pass the edges of its band; a lower-third report card whose upper area is left empty for the footage; a big figure or word filled with a picture or texture; a watermark of the speaker's initials behind a quote; a drawn scene of objects with no words (a desk, a microphone and tape reel, a calendar with crossed-off days), which is an illustration, not an empty panel. Clipped, overlapping, off-edge or unreadable text stays a fault wherever it appears.
Judge the graphic, not what is behind it: words that belong to the game footage or artwork (an in-game caption, a HUD, a logo in the picture) are not the graphic's text. The video's corner marks (the PULSE logo, chapter numbers, a year counter that shows the chapter's year, a footage credit) are fixed furniture; fault them only when they cover the graphic's own text.
Write every problem as "Frame N: what is wrong", one per frame, using the frame numbers given. Pass when nothing is wrong.`;

/** The thumbnail check: the designs that will go to YouTube. */
export const THUMB_VISION_PROMPT = `You check YouTube thumbnails for a gaming channel before they are used. Each frame is one 1280x720 thumbnail.
Fail a thumbnail only for a real fault: words cut off or overlapping, words unreadable at phone size, garbled or misspelt words, a broken or missing picture, a large empty area, an awkward crop that cuts the main subject's face in half, a character with part of the face or body missing (a hole, blur or glow where a mouth, chin or limb should be, the mark of a bad cut-out), or anything advertiser-unfriendly.
Bold styling, outlines, glow, red circles, console or retro looks and the PULSE badge are deliberate. So is a busy comic-panel grid of pictures around the title block (a series' cover-art look): judge whether its title reads at phone size and every panel shows a real picture, not how busy it is.
Write every problem as "Frame N: what is wrong", using the frame numbers given. Pass when nothing is wrong.`;

/** What the thumbnail check adds under the hero rule (THUMB_HERO_RULE, src/qa/thumbrule.ts). */
export const THUMB_HERO_PROMPT = `These thumbnails follow a rule: one recognisable hero and at most four big words (one strong word is fine, even one that repeats the title's promise). Also fail a thumbnail for: artwork clearly showing a different game from the one named in the Game line or in its own words (any game of the named series is right when its words name no single game); no clear main subject a fan would recognise, a character, creature or vehicle filling much of the frame (a landscape, a blurred wash or a crowd of tiny figures is not one); a logo or title baked into the picture that the crop cuts off or that collides with the words; words that mean nothing to someone who has not watched the video, such as a bare rank; an arrow, circle or other pointer mark; a photograph of a real person's face. The plain dark gradient behind the words is deliberate. The comic-panel grid described above is the one approved exception to the hero and word rules.`;

const FRAME_REF = /frames?\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)/gi;

/**
 * The frame numbers (1-based) a checker's problems are about. A problem written the asked way ("Frame 4:
 * ...") is about its leading frame only: a cross-reference inside it ("... while Frame 2 names Dan Houser")
 * does not fault that other frame. On 30 Oct 2026 such cross-references muted four good graphics (Vice City
 * 1:28, Halo 4:0, 4:2 and 6:3). A problem with no leading frame falls back to every frame it names.
 */
export function framesNamed(problems: string[]): number[] {
  const out = new Set<number>();
  const add = (list: string) => {
    for (const n of list.split(/\s*(?:,|and|&)\s*/i))
      if (Number(n) > 0) out.add(Number(n));
  };
  for (const p of problems) {
    const lead = p.match(
      /^\W*frames?\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)\s*(?:[:.)\-]|$)/i,
    );
    if (lead) add(lead[1]!);
    else for (const m of p.matchAll(FRAME_REF)) add(m[1]!);
  }
  return [...out];
}

export async function visionQa(
  llm: Llm,
  frames: string[],
  context: {
    headline: string;
    gameTitle: string;
    format?: "short" | "long" | "graphics" | "thumbs";
    /** Thumbnails under the hero rule: the check also looks for the wrong game, no hero and cryptic words. */
    heroRule?: boolean;
    /** What the narrator says: captions repeat these words, so a word found here is not a misspelling. */
    narration?: string;
    /** The Short's own cards: a card caught fading in or out is not lettering burned into the picture. */
    cardTexts?: string[];
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
    text:
      `Headline: ${context.headline}\nGame: ${context.gameTitle || "(not about one game)"}` +
      // 2 Nov 2026: "Then the trail thins." failed three times as a misspelling of "things" and lost a slot.
      (context.narration
        ? `\n\nThe narration, which the captions repeat word for word. A caption word that appears here is spelled correctly, however unusual it looks:\n${context.narration.slice(0, 6000)}`
        : "") +
      // 5 Nov 2026: our own "DISCOVERY WON" card, caught mid-fade, failed three times as burned-in trailer text.
      (context.cardTexts?.length
        ? `\n\nThe Short's own cards, which fade in and out and may look faint or ghosted in a frame. Lettering that matches these is our graphic, never burned-in text:\n${context.cardTexts.join("\n").slice(0, 2000)}`
        : ""),
  });
  const system =
    context.format === "long"
      ? LONG_VISION_PROMPT
      : context.format === "graphics"
        ? GRAPHICS_VISION_PROMPT
        : context.format === "thumbs"
          ? context.heroRule
            ? `${THUMB_VISION_PROMPT}\n${THUMB_HERO_PROMPT}`
            : THUMB_VISION_PROMPT
          : VISION_PROMPT;
  // The graphics check now looks at every graphic of a long video (up to 200 stills before the render), so it
  // runs on the mid tier; the other checks are a handful of frames and keep the top tier.
  return llm
    .structured({
      system,
      content,
      schema: VisionQaSchema,
      effort: "low",
      ...(context.format === "graphics" ? { tier: "mid" as const } : {}),
    })
    .catch(whenVisionPaused(VISION_SKIPPED));
}
