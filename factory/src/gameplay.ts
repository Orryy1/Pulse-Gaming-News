// The gameplay lane: the owner's own recordings become experiment Shorts. Two Windows tasks outside the
// factory (C:\Claude\tinotv-vods, contract in INBOX-CONTRACT.md) save every Twitch broadcast and cut its
// loudest, busiest 40-second moments into an inbox. Here each clip is heard (Whisper) and looked at (eight
// frames), kept only when it shows one clear test with a visible result, trimmed to 20-35 seconds and
// framed as a question with its answer at the end. Every one waits for the owner's tap in Discord. Once it
// is live on YouTube a small file tells Leonida Intel (the GTA 6 site) so it can write the article.
//
// The lane owns each clip's meta.json "status" after the finder creates it:
//   new -> reviewing -> picked | rejected -> rendered -> awaiting_approval -> published | skipped

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Llm, LlmContent } from "./editorial/llm.ts";
import type { Script } from "./editorial/schema.ts";
import type { Word } from "./voice/elevenlabs.ts";

export const GAMEPLAY_MIN_SECONDS = 20;
export const GAMEPLAY_MAX_SECONDS = 35;

export type GameplayStatus =
  | "new"
  | "reviewing"
  | "picked"
  | "rejected"
  | "rendered"
  | "awaiting_approval"
  | "published"
  | "skipped";

export interface GameplayMeta {
  id: string;
  status: GameplayStatus;
  source: {
    file: string;
    title: string;
    kind: string;
    duration_seconds?: number;
  };
  clip: {
    file: string;
    start_in_source?: number;
    peak_in_clip?: number;
    seconds: number;
  };
  score?: number;
  frames: string[];
  created_at: string;
  /** Written by the lane: why it was kept or passed over, and the episode made from it. */
  review?: {
    at: string;
    keep: boolean;
    reason: string;
    episode?: string;
    radio?: boolean;
    /** The game the reviewer saw (the stream title can be wrong); long videos use the clip as footage of it. */
    game?: string;
  };
}

export interface Experiment {
  number: number;
  question: string;
  slug: string | null;
}

/** The numbered tests in docs/GTA6_EXPERIMENT_SHORTS.md: "1. Question? (/slug/)". */
export function parseExperiments(md: string): Experiment[] {
  const out: Experiment[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\.\s+(.+?)\s*(?:\((\/[^)\s]+\/)\))?\s*$/);
    if (m)
      out.push({
        number: Number(m[1]),
        question: m[2]!.trim(),
        slug: m[3] ?? null,
      });
  }
  return out;
}

export async function readMeta(dir: string): Promise<GameplayMeta | undefined> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(dir, "meta.json"), "utf8"),
    ) as GameplayMeta;
  } catch {
    return undefined;
  }
}

/**
 * Writes a file whole: a temp file first (so the finder never reads half a file), then a rename.
 * Google Drive for desktop backs up the Videos folder and holds new files open while it reads
 * them, so on Windows the write or rename fails with EBUSY/EPERM for a few seconds (27 Oct 2026:
 * every clip from the night's stream stuck at "reviewing"). Each attempt uses its own temp name,
 * since the last one may still be held, and waits a little longer before trying again.
 */
export async function writeWhole(
  file: string,
  text: string,
  waits = [500, 1500, 4000, 10_000],
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const tmp = `${file}.${process.pid}.${attempt}.tmp`;
    try {
      await fs.writeFile(tmp, text);
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (
        !["EBUSY", "EPERM", "EACCES"].includes(code) ||
        attempt >= waits.length
      )
        throw err;
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

/** Updates meta.json in place. */
export async function writeMeta(
  dir: string,
  patch: Partial<GameplayMeta>,
): Promise<void> {
  const meta = await readMeta(dir);
  if (!meta) return;
  await writeWhole(
    path.join(dir, "meta.json"),
    JSON.stringify({ ...meta, ...patch }, null, 2),
  );
}

/** Clips waiting for review, the finder's strongest first. */
export async function newClips(
  root: string,
): Promise<Array<{ dir: string; meta: GameplayMeta }>> {
  const inbox = path.join(root, "inbox");
  const names = await fs.readdir(inbox).catch(() => [] as string[]);
  const found: Array<{ dir: string; meta: GameplayMeta }> = [];
  for (const name of names) {
    const dir = path.join(inbox, name);
    const meta = await readMeta(dir);
    if (meta?.status === "new") found.push({ dir, meta });
    // A review that died part-way (a locked file, a restart) left "reviewing" behind: look again after 30 minutes.
    else if (meta?.status === "reviewing") {
      const at =
        (await fs.stat(path.join(dir, "meta.json")).catch(() => undefined))
          ?.mtimeMs ?? Date.now();
      if (Date.now() - at > 30 * 60_000) found.push({ dir, meta });
    }
  }
  return found.sort((a, b) => (b.meta.score ?? 0) - (a.meta.score ?? 0));
}

export const GameplayReviewSchema = z.object({
  keep: z
    .boolean()
    .describe(
      "True only when the clip shows one clear test or moment with a visible outcome worth a Short",
    ),
  score: z
    .number()
    .describe(
      "1-10: how much a gamer would want to watch this to the end. 7+ is worth posting",
    ),
  reason: z
    .string()
    .describe("One sentence for the owner: why it was kept or passed over"),
  game_title: z
    .string()
    .describe("The game, as commonly written, e.g. 'Grand Theft Auto VI'"),
  experiment_number: z
    .number()
    .describe(
      "The number of the matching test from the list, or 0 when none fits",
    ),
  question: z
    .string()
    .describe(
      "The on-screen question, under 60 characters, ending with '?', e.g. 'CAN YOU OUTSWIM 5 STARS?'",
    ),
  result_line: z
    .string()
    .describe(
      "The answer card for the last 3 seconds, 2-5 words, e.g. 'THE COPS GAVE UP'",
    ),
  result: z
    .string()
    .describe(
      "One or two plain sentences on what actually happened in the clip",
    ),
  start_seconds: z
    .number()
    .describe("Where the Short starts inside the clip, in seconds"),
  end_seconds: z
    .number()
    .describe(
      "Where it ends: 20-35 seconds after the start, with the outcome visible in the last 3 seconds",
    ),
  youtube_title: z
    .string()
    .describe(
      "Under 70 characters: game name first, the question, no spoilers, no clickbait words",
    ),
  description: z
    .string()
    .describe("Two sentences on the test, no hashtags, no spoilers"),
  hashtags: z
    .array(z.string())
    .describe(
      "3-5 hashtags fans search, most specific first, e.g. #GTA6, no generic tags",
    ),
  radio_audible: z
    .boolean()
    .describe(
      "True when licensed music (car radio, a song with lyrics, a station on screen) can be heard or seen",
    ),
  spoiler: z
    .boolean()
    .describe(
      "True when the clip shows a story cutscene, a mission's plot or an ending",
    ),
  strong_language: z
    .boolean()
    .describe("True when anyone in the clip swears in the chosen window"),
  captions_ok: z
    .boolean()
    .describe(
      "True when the transcript is speech worth captioning (the player or characters), not song lyrics or noise",
    ),
});
export type GameplayReview = z.infer<typeof GameplayReviewSchema>;

export const GAMEPLAY_REVIEW_PROMPT = `You review the owner's own gameplay recordings (Xbox Series X, his retail copy) for Pulse Gaming, a gaming channel. Each candidate is a 40-second clip the highlight finder cut around a loud, busy moment. You see eight evenly spaced frames, the stream's title and what Whisper heard.
The channel makes experiment Shorts: one question, the attempt, the answer. Keep a clip only when it shows a clear test or a striking moment with a visible outcome a viewer can understand without context (a chase lost or won, a stunt landed or failed, a physics or AI reaction, a world detail). Pass over menus, loading screens, idle driving, talking to chat, inventory, cutscenes and anything confusing. Be strict: an ordinary moment scores 4-6. Most clips should not be kept.
When the stream title or the frames fit one of the listed tests, use its number and keep its question's meaning. Otherwise write a fresh question about what the clip actually shows. The question must be answered by the clip itself, and the answer must be what happened, not a guess.
Mechanics only: never name or hint at story events, characters' fates, missions or endings. A clip that shows a cutscene or plot is spoiler=true.
Choose a 20-35 second window inside the clip that starts as the attempt begins and ends right after the outcome. Frame k of 8 is at about (k-0.5)/8 of the clip's length.
Licensed music triggers Content ID: flag radio_audible when the transcript has song lyrics or a DJ, or a radio station name shows on screen.
Advertiser safety: no gore close-ups, nudity or hate; avoid the words death, kill, war, attack and crisis in the question, title and result line. British spelling in the result, American is fine for the title.`;

export async function reviewClip(
  llm: Llm,
  dir: string,
  meta: GameplayMeta,
  transcript: string,
  experiments: Experiment[],
): Promise<GameplayReview> {
  const content: LlmContent = [];
  for (const [i, f] of meta.frames.entries()) {
    const data = await fs.readFile(path.join(dir, f)).catch(() => undefined);
    if (!data) continue;
    content.push({
      type: "text",
      text: `Frame ${i + 1} of ${meta.frames.length}`,
    });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: data.toString("base64"),
      },
    });
  }
  content.push({
    type: "text",
    text: [
      `Stream title: ${meta.source.title || "(none)"}`,
      `Clip length: ${meta.clip.seconds} s; the finder's peak is at ${meta.clip.peak_in_clip ?? "?"} s`,
      `What Whisper heard: ${transcript.trim() || "(nothing, or it could not listen)"}`,
      "",
      "The test list:",
      ...experiments.map((e) => `${e.number}. ${e.question}`),
    ].join("\n"),
  });
  return llm.structured({
    system: GAMEPLAY_REVIEW_PROMPT,
    content,
    schema: GameplayReviewSchema,
    effort: "medium",
    tier: "mid",
    // One review per recording, several recordings an hour when a session lands.
    cache: "1h",
  });
}

/** The window clamped inside the clip and to 20-35 seconds. */
export function gameplayWindow(
  r: Pick<GameplayReview, "start_seconds" | "end_seconds">,
  clipSeconds: number,
): { start: number; end: number } {
  const longest = Math.min(GAMEPLAY_MAX_SECONDS, clipSeconds);
  let start = Math.max(
    0,
    Math.min(
      r.start_seconds,
      clipSeconds - Math.min(GAMEPLAY_MIN_SECONDS, clipSeconds),
    ),
  );
  let end = Math.min(
    clipSeconds,
    Math.max(r.end_seconds, start + GAMEPLAY_MIN_SECONDS),
  );
  if (end - start > longest) start = end - longest;
  if (end - start < Math.min(GAMEPLAY_MIN_SECONDS, clipSeconds)) {
    end = Math.min(clipSeconds, start + GAMEPLAY_MIN_SECONDS);
    start = Math.max(0, end - GAMEPLAY_MIN_SECONDS);
  }
  return { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 };
}

/** Kept, and safe to put in front of the owner. */
export function worthPosting(r: GameplayReview, minScore: number): boolean {
  return r.keep && r.score >= minScore && !r.spoiler && !r.strong_language;
}

/** The Script the rest of the factory works with (upload, cross-posting, analytics). */
export function gameplayScript(
  r: GameplayReview,
  inboxId: string,
  experiments: Experiment[],
): Script {
  const exp = experiments.find((e) => e.number === r.experiment_number);
  const question = /\?$/.test(r.question.trim())
    ? r.question.trim()
    : `${r.question.trim()}?`;
  const tags = r.hashtags
    .map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, ""))
    .slice(0, 5);
  return {
    story_type: "other",
    game_title: r.game_title,
    steam_search_term: "",
    headline: question,
    hook: question,
    beats: [
      {
        narration: r.result,
        visual: { kind: "none", primary: "", secondary: "" },
      },
    ],
    pulse_take: {
      label: "THE RESULT",
      narration: r.result,
      on_screen: r.result_line,
    },
    loop_line: "",
    is_rumour: false,
    attribution: "Gameplay: Pulse Gaming",
    hashtags: tags,
    youtube: {
      title: r.youtube_title.slice(0, 100),
      description: r.description.trim(),
      tags: [
        ...new Set([
          r.game_title,
          ...tags.map((t) => t.slice(1)),
          "gameplay",
          "experiment",
        ]),
      ].slice(0, 15),
    },
    claims: [],
    runtime: "short",
    gameplay: {
      inbox_id: inboxId,
      question,
      result: r.result.trim(),
      result_line: r.result_line.trim(),
      experiment_number: exp?.number ?? 0,
      experiment_slug: exp?.slug ?? null,
      radio: r.radio_audible,
    },
  };
}

/** Whisper's words inside the window, moved to start at zero. */
export function wordsInWindow(
  words: Word[],
  win: { start: number; end: number },
): Word[] {
  return words
    .filter((w) => w.start >= win.start && w.end <= win.end)
    .map((w) => ({ ...w, start: w.start - win.start, end: w.end - win.start }));
}

/**
 * Whisper invents a looping phrase over gunfire and engines ("death of death of death"). Captions only
 * go on when the window holds real speech: a few words, most of them different.
 */
export function captionable(words: Word[]): boolean {
  const said = words
    .map((w) => w.text.toLowerCase().replace(/[^a-z0-9']/g, ""))
    .filter(Boolean);
  return said.length >= 4 && new Set(said).size / said.length >= 0.6;
}

/** What Leonida Intel reads back: published/<id>.json. Written once the video is public. */
export async function writeManifest(
  root: string,
  m: {
    id: string;
    youtube_id: string;
    title: string;
    question: string;
    result: string;
    experiment_slug: string | null;
    published_at: string;
  },
): Promise<boolean> {
  const dir = path.join(root, "published");
  const file = path.join(dir, `${m.id}.json`);
  if (await fs.stat(file).catch(() => undefined)) return false;
  await fs.mkdir(dir, { recursive: true });
  await writeWhole(file, JSON.stringify(m, null, 2));
  return true;
}
