// Shorts cut from a long ranking video: each one is a single entry's section
// (its rank card, footage and narration), reframed for a phone, titled as a
// question and pointing back to the full video. The worst pick goes first (it
// draws the most argument), then number two, then number one.

import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { Script } from "./schema.ts";
import type { Segment } from "../render/timeline.ts";
import type { Word } from "../voice/elevenlabs.ts";

export const CUTDOWN_MAX_SECONDS = 58; // a Short must stay under a minute, end card included
export const CUTDOWN_TAIL_SECONDS = 2.5; // the "full ranking" card after the last word

/** Which entries become Shorts, in publishing order: the last place, then number two, then number one, then the rest from the top. */
export function cutdownRanks(ranks: number[], count: number): number[] {
  const sorted = [...new Set(ranks)].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const worst = sorted[sorted.length - 1]!;
  const order = [worst, 2, 1, ...sorted.filter((r) => r > 2 && r !== worst)];
  return [...new Set(order.filter((r) => sorted.includes(r)))].slice(
    0,
    Math.max(0, count),
  );
}

/**
 * The seconds of the long video an entry occupies: from its rank card to the
 * next segment, with number one keeping the outro's verdict when it fits.
 * Too long for a Short: it ends on the last full sentence that fits.
 */
export function cutdownWindow(
  segments: Segment[],
  beatIndex: number,
  words: Word[],
  maxSeconds = CUTDOWN_MAX_SECONDS - CUTDOWN_TAIL_SECONDS,
): { start: number; end: number } | undefined {
  const beats = segments
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s.kind === "beat");
  const hit = beats[beatIndex];
  if (!hit) return undefined;
  const start = Math.max(0, hit.s.start - 0.1);
  const next = segments[hit.i + 1];
  let end = next ? next.start : hit.s.end;
  // The winner's section reads better with its verdict from the outro.
  if (
    beatIndex === beats.length - 1 &&
    next?.kind === "take" &&
    next.end - start <= maxSeconds
  )
    end = next.end;
  if (end - start > maxSeconds) {
    const fits = words.filter(
      (w) =>
        w.start >= start &&
        w.end <= start + maxSeconds - 0.3 &&
        /[.!?]["”']?$/.test(w.text),
    );
    const last = fits[fits.length - 1];
    if (!last) return undefined;
    end = last.end + 0.35;
  }
  // End just after the last word, well before the next entry's card and art fade in.
  const spoken = words.filter((w) => w.start >= start && w.end <= end + 0.05);
  const lastWord = spoken[spoken.length - 1];
  if (lastWord) end = Math.min(end, lastWord.end + 0.3);
  return { start, end };
}

/** The words spoken inside the window, timed from the start of the Short. */
export function wordsIn(
  words: Word[],
  w: { start: number; end: number },
): Word[] {
  return words
    .filter((x) => x.start >= w.start - 0.02 && x.end <= w.end + 0.05)
    .map((x) => ({
      ...x,
      start: Math.max(0, x.start - w.start),
      end: Math.max(0, x.end - w.start),
    }));
}

export const CutdownCopySchema = z.object({
  overlay_title: z
    .string()
    .describe(
      "The big question on screen above the video, 3-7 words, under 34 characters, e.g. 'THE BEST COD CAMPAIGN EVER?' or 'TOO LOW AT NUMBER 8?'",
    ),
  youtube_title: z
    .string()
    .describe(
      "Under 70 characters, front-loads the game, a question or a strong claim a fan will argue with, no hashtags, no emojis",
    ),
  description: z
    .string()
    .describe(
      "Two sentences: why this game sits at this rank, then that the full ranking is on the channel",
    ),
  question: z
    .string()
    .describe(
      "One short question for the pinned comment that invites people to disagree with the rank, under 120 characters",
    ),
});
export type CutdownCopy = z.infer<typeof CutdownCopySchema>;

export async function writeCutdownCopy(
  llm: Llm,
  parent: Script,
  entry: { rank: number; game_title: string; year: number },
  narration: string,
  total: number,
): Promise<CutdownCopy> {
  return llm.structured({
    tier: "mid",
    system: `You package a YouTube Short cut from Pulse Gaming's long ranking video. The Short is one entry's section: the rank, the footage and the narration. Write copy that makes a gamer stop scrolling and argue. American English, AP style (no serial comma). Advertiser-friendly: no violence words in titles. No clickbait that the video does not deliver; never "you won't believe". Speak as "we" if the channel speaks at all.`,
    content: `Full video: "${parent.youtube.title}"\nCriterion: ${parent.criterion ?? ""}\nThis Short: number ${entry.rank} of ${total}: ${entry.game_title} (${entry.year})\nNarration: ${narration}`,
    schema: CutdownCopySchema,
    effort: "low",
  });
}

/** The cutdown's own script: the parent's entry with its own packaging, pointing back to the full video. */
export function cutdownScript(
  parent: Script,
  beatIndex: number,
  copy: CutdownCopy,
  parentVideoId: string,
): Script {
  const entry = parent.entries![beatIndex]!;
  const beat = parent.beats[beatIndex]!;
  const total = parent.entries!.length;
  const link = `https://youtu.be/${parentVideoId}`;
  return {
    story_type: "other",
    game_title: entry.game_title,
    steam_search_term: entry.steam_search_term,
    headline: copy.overlay_title,
    hook: beat.narration.split(/(?<=[.!?])\s+/)[0] ?? beat.narration,
    beats: [
      {
        narration: beat.narration,
        visual: { kind: "none", primary: "", secondary: "" },
      },
    ],
    pulse_take: {
      label: "OUR PICK",
      narration: "",
      on_screen: String(beat.visual.secondary || ""),
    },
    loop_line: "",
    is_rumour: false,
    attribution: "",
    youtube: {
      title: copy.youtube_title,
      description: `${copy.description.trim()}\n\nThe full ranking: ${link}`,
      tags: [...new Set([entry.game_title, ...parent.youtube.tags])].slice(
        0,
        15,
      ),
    },
    claims: [],
    entries: [
      {
        rank: entry.rank,
        game_title: entry.game_title,
        steam_search_term: entry.steam_search_term,
        year: entry.year,
        platforms: entry.platforms,
      },
    ],
    criterion: parent.criterion,
    runtime: "short",
    cutdown: {
      parent_video: parentVideoId,
      rank: entry.rank,
      total,
      question: copy.question,
    },
  };
}
