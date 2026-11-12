// The Shorts-to-long funnel as a narrow test (upgrade queue item 18, 12 Nov 2026). 26 Pulse Shorts carried a related-
// video link and YouTube credited the Shorts feed with no long-video views in 30 days; the link works, where it works
// at all, when the Short was cut from the long video and posted within three days, with the link said and shown in
// its last five seconds (Spotter; YouTube's own guide). So, behind FUNNEL_TEST (off by default):
//
// - each weekly guide (src/longguide.ts) gets FUNNEL_SHORTS (2 or 3) Shorts cut from its own chapters, one a day in
//   the cutdown slot while the guide is under FUNNEL_DAYS old;
// - the split: by episode id (unitHash of "funnel:<id>", fixed for retries), FUNNEL_SHARE of them are the "link" arm:
//   the link said ("The full guide is linked just below.") and shown (the end card) in the last 5 seconds, in the
//   description and the pinned comment, and set as the related video; the rest are the control: the same cut with no
//   pointer anywhere;
// - the related-video routine then links only Shorts cut from a long video (a ranking's cutdowns and the guide cuts
//   in the link arm), and lists the Shorts it linked before, FUNNEL_CLEAR_DAYS back, to have their link removed.
//
// Measure: long-video views credited to the Shorts feed in YouTube Analytics, per linked Short, against the control.
// Pure functions here; the pipeline makes the episodes.

import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import type { Llm } from "./editorial/llm.ts";
import type { Script } from "./editorial/schema.ts";
import type { Segment } from "./render/timeline.ts";
import type { Word } from "./voice/elevenlabs.ts";
import { voiceFor } from "./editorial/voice.ts";
import {
  CUTDOWN_MAX_SECONDS,
  cutdownWindow,
  type CutdownCopy,
} from "./editorial/cutdown.ts";
import type { LongVideo, RelatedItem, RelatedRow } from "./routines.ts";

/** The end card and the spoken line take the last five seconds (YouTube's guide). */
export const FUNNEL_TAIL_SECONDS = 5;
/** The line said over the end card in the link arm: short enough to finish well inside the tail. */
export const FUNNEL_LINE = "The full guide is linked just below.";
export const FUNNEL_CTA = "FULL GUIDE: LINK BELOW";

export type FunnelArm = "link" | "none";

/** The arm for an episode: `hash` is unitHash(`funnel:${id}`) (src/pipeline.ts), in [0, 1). */
export function funnelArm(hash: number, share: number): FunnelArm {
  return share > 0 && hash < share ? "link" : "none";
}

/** The beats that open a guide's chapters (docToScript gives each chapter's first paragraph the chapter card). */
export function chapterBeats(script: Pick<Script, "beats">): number[] {
  return script.beats.flatMap((b, i) =>
    b.visual?.kind === "chapter" ? [i] : [],
  );
}

/**
 * Which chapters become Shorts, in publishing order: the guide's own order (early-game tips first, the order a new
 * player meets them), skipping chapters already cut, at most `count`.
 */
export function funnelPicks(
  script: Pick<Script, "beats">,
  count: number,
  done: readonly number[],
): number[] {
  return chapterBeats(script)
    .filter((b) => !done.includes(b))
    .slice(0, Math.max(0, count - done.length));
}

/**
 * The seconds of the long video a chapter's Short takes: from its chapter card through as many of its paragraphs as
 * fit under a minute with the 5-second tail, ending on a full sentence (cutdownWindow on the chapter as one segment).
 */
export function funnelWindow(
  segments: Segment[],
  starts: readonly number[],
  beatIndex: number,
  words: Word[],
): { start: number; end: number; videoEnd: number } | undefined {
  const chapter = starts.indexOf(beatIndex);
  if (chapter < 0) return undefined;
  const merged: Segment[] = [];
  let beat = -1;
  for (const seg of segments) {
    if (seg.kind !== "beat") {
      merged.push({ ...seg });
      continue;
    }
    beat++;
    const last = merged[merged.length - 1];
    if (!starts.includes(beat) && last?.kind === "beat") last.end = seg.end;
    else merged.push({ ...seg });
  }
  return cutdownWindow(
    merged,
    chapter,
    words,
    CUTDOWN_MAX_SECONDS - FUNNEL_TAIL_SECONDS,
  );
}

const FunnelCopySchema = z.object({
  overlay_title: z
    .string()
    .describe(
      "The line on screen above the video, 3-7 words, under 34 characters, the game first: 'GTA 6: THE EARLY MONEY LOOP'",
    ),
  youtube_title: z
    .string()
    .describe(
      "Under 60 characters: the game's name first, then the how or why the clip shows ('GTA 6 Early Money: The Car Wash Loop'); a number only when the number is the point; no question mark, no hashtags, no emojis",
    ),
  description: z
    .string()
    .describe(
      "One or two sentences: what the viewer can do in their own game after this",
    ),
  question: z
    .string()
    .describe(
      "One short question for the pinned comment about the viewer's own game, under 120 characters",
    ),
});

/** The Short's packaging, in the friend voice; the arm decides only whether the link is mentioned (it is added after). */
export async function writeFunnelCopy(
  llm: Llm,
  o: {
    game: string;
    guideTitle: string;
    chapterTitle: string;
    narration: string;
  },
): Promise<CutdownCopy> {
  return llm.structured({
    tier: "mid",
    system: `You package a YouTube Short cut from Pulse Gaming's long guide video. The Short is one chapter's opening: a practical thing the player can do in their own game. Write copy a player stops scrolling for. American English, AP style (no serial comma). Advertiser-friendly: no violence words in titles. Never promise what the clip does not show. Do not mention the full video or a link: that is added separately.\n\n${voiceFor("cutdown")}`,
    content: `Game: ${o.game}\nFull guide: "${o.guideTitle}"\nThis Short: the chapter "${o.chapterTitle}"\nNarration: ${o.narration}`,
    schema: FunnelCopySchema,
    effort: "low",
  });
}

/** The cut's own script: the chapter's narration with its own packaging; only the link arm points back to the guide. */
export function funnelScript(
  parent: Script,
  beatIndex: number,
  copy: CutdownCopy,
  parentVideoId: string,
  arm: FunnelArm,
): Script {
  const starts = chapterBeats(parent);
  const chapter = starts.indexOf(beatIndex);
  const beat = parent.beats[beatIndex]!;
  const chapterTitle = String(beat.visual?.primary ?? "");
  const link = `https://youtu.be/${parentVideoId}`;
  const game = parent.game_title;
  return {
    story_type: "other",
    game_title: game,
    steam_search_term: parent.steam_search_term,
    headline: copy.overlay_title,
    hook: beat.narration.split(/(?<=[.!?])\s+/)[0] ?? beat.narration,
    beats: [
      {
        narration: beat.narration,
        visual: { kind: "none", primary: "", secondary: "" },
      },
    ],
    pulse_take: { label: "GUIDE", narration: "", on_screen: chapterTitle },
    loop_line: arm === "link" ? FUNNEL_LINE : "",
    is_rumour: false,
    attribution: "",
    youtube: {
      title: copy.youtube_title,
      description: `${copy.description.trim()}${arm === "link" ? `\n\nThe full guide: ${link}` : ""}`,
      tags: [...new Set([game, ...parent.youtube.tags])].slice(0, 15),
    },
    claims: [],
    runtime: "short",
    cutdown: {
      parent_video: parentVideoId,
      rank: chapter + 1,
      total: starts.length,
      question: copy.question,
      theme: game,
      guide: parent.youtube.title,
      funnel: arm,
    },
  };
}

/** Adds the spoken link line over the end card: the cut's own audio, the line from `at` seconds. */
export async function mixFunnelLine(
  ffmpeg: string,
  cutFile: string,
  lineFile: string,
  at: number,
): Promise<void> {
  const out = `${cutFile}.line.mp4`;
  const ms = Math.round(at * 1000);
  await promisify(execFile)(
    ffmpeg,
    [
      "-v",
      "error",
      "-y",
      "-i",
      cutFile,
      "-i",
      lineFile,
      "-filter_complex",
      `[1:a]adelay=${ms}|${ms},apad[l];[0:a][l]amix=inputs=2:duration=first:normalize=0[a]`,
      "-map",
      "0:v:0",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      out,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  await fs.rename(out, cutFile);
}

export interface FunnelItem extends RelatedItem {
  /** "set": add this related video; "clear": remove the Short's related video (it is not cut from a long video). */
  action: "set" | "clear";
}

/**
 * The related-video plan under the test: a Short cut from a long video links to it (a ranking's cutdowns, a guide cut
 * in the link arm); a guide cut in the control arm and every other Short get no link. `linked` are the Shorts the
 * routine linked before (its ledger) among `older` rows: those not cut from a long video are listed to be cleared,
 * once each (`cleared` is the clear ledger).
 */
export function planFunnel(
  rows: RelatedRow[],
  longs: LongVideo[],
  older: RelatedRow[] = [],
  linked: ReadonlySet<string> = new Set(),
  cleared: ReadonlySet<string> = new Set(),
): FunnelItem[] {
  const title = (r: RelatedRow) =>
    r.script_json?.youtube?.title ?? r.script_json?.headline ?? "";
  const target = (r: RelatedRow): string | undefined => {
    const c = r.script_json?.cutdown;
    if (!c?.parent_video) return undefined;
    if (c.funnel === "none") return undefined;
    return c.parent_video;
  };
  const shorts = (list: RelatedRow[]) =>
    list.filter((r) => r.youtube_video_id && r.script_json?.runtime !== "long");
  const out: FunnelItem[] = [];
  for (const r of shorts(rows)) {
    const t = target(r);
    if (!t) continue;
    out.push({
      action: "set",
      short: r.youtube_video_id!,
      title: title(r),
      target: t,
      targetTitle: longs.find((l) => l.id === t)?.title ?? "",
      reason: r.script_json?.cutdown?.funnel
        ? "funnel test: cut from this guide"
        : "cut from this ranking",
    });
  }
  const seen = new Set(out.map((o) => o.short));
  for (const r of shorts([...rows, ...older])) {
    const id = r.youtube_video_id!;
    if (seen.has(id) || !linked.has(id) || cleared.has(id) || target(r))
      continue;
    seen.add(id);
    out.push({
      action: "clear",
      short: id,
      title: title(r),
      target: "",
      targetTitle: "",
      reason: "funnel test: not cut from a long video, so no related video",
    });
  }
  return out;
}
