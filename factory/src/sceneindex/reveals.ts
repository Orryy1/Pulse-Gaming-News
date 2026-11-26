// The reveal classifier (owner, 26 Nov 2026, choosing "Early story free" for GTA VI: the old hold was too safe).
// During a game's spoiler window with SPOILER_EARLY_FREE, chapter 1 of its story is free everywhere and later chapters
// may be used in Shorts and long videos as long as the moment gives away no big reveal. This file says which moments
// do: a cheap pass over a scene index cut into scenes of about 45 seconds, each judged on its own words (the shots'
// descriptions and on-screen writing and the dialogue lines). A scene whose words hold a spoiling phrase is a reveal
// by rule; the rest go to the small model (site "spoiler.reveal", tier low: CODEX_CALLS and CLAUDE_VIA_MAX route it),
// 25 scenes a call. Unsure, unanswered, failed or not indexed yet counts as a reveal. The verdicts are cached per
// index in reveals.json (src/sceneindex/revealbook.ts), keyed by each scene's words, so only new or changed scenes
// are asked again. Frames (the owner's stream clips, the gameplay inbox) are judged by the local vision model.

import fs from "node:fs/promises";
import crypto from "node:crypto";
import { z } from "zod";
import type { Llm } from "../editorial/llm.ts";
import type { GameplayMeta } from "../gameplay.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import {
  LOCAL_VISION_MODEL,
  LOCAL_VISION_URL,
  visionAnswer,
} from "../assets/localvision.ts";
import {
  forgetRevealBooks,
  parseRevealBook,
  REVEAL_BOOK_VERSION,
  revealsFile,
  type RevealBook,
  type RevealKind,
  type RevealScene,
} from "./revealbook.ts";
import { indexNamesFor, loadSceneIndex, type SceneIndex } from "./schema.ts";
import {
  SPOILER_PHRASES,
  storyChapter,
  windowOpen,
  type SpoilerWindow,
} from "./spoilers.ts";

export const SCENE_SECONDS = 45;
const BATCH = 25;
const MAX_TEXT = 1600;

export interface RevealSceneInput {
  n: number;
  start: number;
  end: number;
  text: string;
  hash: string;
}

/**
 * The index cut into scenes (pure): shots joined in order until a scene spans `seconds`, contiguous from 0 to the end
 * of the upload, each with its words (the shots' descriptions and writing, then the lines said or shown in it).
 */
export function revealScenes(
  index: SceneIndex,
  seconds = SCENE_SECONDS,
): RevealSceneInput[] {
  const shots = [...index.shots].sort((a, b) => a.start - b.start);
  const end = Math.max(
    index.source.duration || 0,
    shots[shots.length - 1]?.end ?? 0,
  );
  const cuts: Array<{ start: number; end: number }> = [];
  let from = 0;
  for (const s of shots) {
    if (s.end - from >= seconds) {
      cuts.push({ start: from, end: s.end });
      from = s.end;
    }
  }
  if (end > from) {
    // A short tail joins the scene before it.
    const prev = cuts[cuts.length - 1];
    if (prev && end - from < seconds / 3) prev.end = end;
    else cuts.push({ start: from, end });
  }
  return cuts.map((c, i) => {
    const words: string[] = [];
    const seen = new Set<string>();
    const add = (t: string | undefined) => {
      const x = t?.replace(/\s+/g, " ").trim();
      if (x && !seen.has(x.toLowerCase())) {
        seen.add(x.toLowerCase());
        words.push(x);
      }
    };
    for (const s of shots) {
      if (s.end <= c.start || s.start >= c.end || s.blank || s.menu) continue;
      add(s.desc);
      if (s.text) add(`(on screen) ${s.text}`);
    }
    for (const l of index.lines) {
      if (l.end <= c.start || l.start >= c.end) continue;
      add(
        l.speaker && !l.speakerGuessed
          ? `${l.speaker}: "${l.text}"`
          : `"${l.text}"`,
      );
    }
    const text = words.join(" ").slice(0, MAX_TEXT);
    return {
      n: i + 1,
      start: c.start,
      end: c.end,
      text,
      hash: crypto.createHash("sha1").update(text).digest("hex").slice(0, 12),
    };
  });
}

/** Words that give a reveal away outright, beyond the writers' spoiler phrases. */
const EXTRA_RULES: Array<[RegExp, RevealKind]> = [
  [
    /\b(?:dead body|corpse|funeral|coffin|graveside|bleeds? out|bled out|shot dead|lifeless body|rest in peace|(?:he|she|they)(?:'s| is| are|'re) dead|you killed (?:him|her|them))\b/i,
    "death",
  ],
  [
    /\b(?:set (?:us|me) up|sold (?:us|me) out|stabbed (?:us|me) in the back|ratted (?:us|me) out)\b/i,
    "betrayal",
  ],
  [
    /\b(?:undercover (?:cop|agent|fed)|(?:is|was|were|been) (?:an? )?(?:informant|snitch|rat|fed)|wearing a wire|wore a wire|working for the (?:feds|fbi|cops|police))\b/i,
    "identity",
  ],
];

const KIND_OF: Record<string, RevealKind> = {
  "the ending": "ending",
  "a plot twist": "twist",
  "a character's death": "death",
  "a late mission": "ending",
  "a late part of the story": "ending",
};

/** A spoiling phrase in a scene's own words (pure): its kind and the words, or undefined. */
export function rulesReveal(
  text: string,
): { kind: RevealKind; phrase: string } | undefined {
  for (const [re, what] of SPOILER_PHRASES) {
    const m = text.match(re);
    if (m)
      return {
        kind: /betray|double/i.test(m[0])
          ? "betrayal"
          : /undercover|informant|snitch|mole|real identity/i.test(m[0])
            ? "identity"
            : (KIND_OF[what] ?? "twist"),
        phrase: m[0],
      };
  }
  for (const [re, kind] of EXTRA_RULES) {
    const m = text.match(re);
    if (m) return { kind, phrase: m[0] };
  }
  return undefined;
}

const KINDS = [
  "death",
  "twist",
  "betrayal",
  "ending",
  "identity",
  "none",
] as const;

export const RevealAnswerSchema = z.object({
  scenes: z.array(
    z.object({
      n: z.number().int().describe("The scene's number as given"),
      reveal: z
        .boolean()
        .describe("True when the scene shows or tells a big reveal"),
      kind: z.enum(KINDS).describe("What it reveals, or none"),
      sure: z
        .boolean()
        .describe("False when you cannot tell from the words given"),
      why: z
        .string()
        .describe("At most 12 words, no story details beyond what is needed"),
    }),
  ),
});

export const REVEAL_PROMPT = `You tag the scenes of a video game's story for a spoiler guard. Each scene is a stretch of the game's cutscene movie or playthrough, given as short descriptions of its shots and the dialogue said in it.
A scene is a REVEAL when it shows or tells any of these:
- death: a named or main character dies, is killed, or is found dead (an anonymous enemy falling in a shoot-out is not a reveal);
- twist: the story turns on a surprise the player was not meant to see coming;
- betrayal: an ally betrays, double-crosses, sells out or sets up another;
- ending: the final mission, the final confrontation, the ending or the epilogue;
- identity: a major identity reveal (someone is undercover, an informant, secretly related, or the hidden villain).
Everything else is SAFE: driving, banter, jokes, planning or pulling a job, a chase, a fight, an arrest, meeting a new character, a new place, romance, threats that are not carried out.
When you are not sure, or the words are too thin to tell, set reveal=true and sure=false. Answer for every scene number given.`;

/** One scene's verdict from the model's answer (pure): unsure, a kind or a missing answer all count as a reveal. */
export function verdictOf(
  s: RevealSceneInput,
  a: z.infer<typeof RevealAnswerSchema>["scenes"][number] | undefined,
): RevealScene {
  if (!a)
    return {
      start: s.start,
      end: s.end,
      hash: s.hash,
      reveal: true,
      by: "pending",
      why: "no answer for this scene",
    };
  const kind = a.kind !== "none" ? (a.kind as RevealKind) : undefined;
  const reveal = a.reveal || !a.sure || Boolean(kind);
  return {
    start: s.start,
    end: s.end,
    hash: s.hash,
    reveal,
    ...(reveal ? { kind: kind ?? "twist" } : {}),
    by: "model",
    why: (a.sure ? "" : "unsure: ") + a.why.slice(0, 120),
  };
}

const keyOf = (s: { start: number; hash: string }) =>
  `${s.start.toFixed(1)}|${s.hash}`;

/**
 * The index's reveal book (never throws): scenes judged before with the same words are kept, scenes whose words
 * spoil are reveals by rule, empty scenes wait (a reveal until something is indexed there), and the rest are asked in
 * batches, at most `maxCalls` calls. A failed or missing answer leaves its scenes pending, asked again next time.
 */
export async function classifyReveals(
  llm: Llm | undefined,
  index: SceneIndex,
  prev: RevealBook | undefined,
  o: { now: Date; seconds?: number; batch?: number; maxCalls?: number } = {
    now: new Date(),
  },
): Promise<{
  book: RevealBook;
  asked: number;
  failed: number;
  reused: number;
  calls: number;
}> {
  const seconds = o.seconds ?? SCENE_SECONDS;
  const scenes = revealScenes(index, seconds);
  const kept = new Map<string, RevealScene>();
  if (prev && prev.videoId === index.source.videoId)
    for (const s of prev.scenes) if (s.by !== "pending") kept.set(keyOf(s), s);
  const out: RevealScene[] = [];
  const ask: RevealSceneInput[] = [];
  let reused = 0;
  for (const s of scenes) {
    const old = kept.get(keyOf(s));
    if (old) {
      out.push({ ...old, start: s.start, end: s.end });
      reused++;
      continue;
    }
    const rule = rulesReveal(s.text);
    if (rule)
      out.push({
        start: s.start,
        end: s.end,
        hash: s.hash,
        reveal: true,
        kind: rule.kind,
        by: "rules",
        why: `"${rule.phrase}"`,
      });
    else if (!s.text.trim())
      out.push({
        start: s.start,
        end: s.end,
        hash: s.hash,
        reveal: true,
        by: "pending",
        why: "nothing indexed here yet",
      });
    else {
      out.push(verdictOf(s, undefined));
      ask.push(s);
    }
  }
  const batch = Math.max(1, o.batch ?? BATCH);
  const maxCalls = Math.max(0, o.maxCalls ?? Infinity);
  let calls = 0;
  let failed = 0;
  const chapter = storyChapter(index);
  for (let i = 0; llm && i < ask.length && calls < maxCalls; i += batch) {
    const part = ask.slice(i, i + batch);
    calls++;
    try {
      const answer = await llm.structured({
        system: REVEAL_PROMPT,
        content: `${index.game}${chapter ? `, chapter ${chapter} of the story` : ""} (${index.source.kind}: "${index.source.title}").\n\n${part
          .map((s) => `${s.n}. [${clock(s.start)}-${clock(s.end)}] ${s.text}`)
          .join("\n")}`,
        schema: RevealAnswerSchema,
        tier: "low",
        effort: "low",
        maxTokens: 4000,
        site: "spoiler.reveal",
      });
      const byN = new Map(answer.scenes.map((a) => [a.n, a]));
      for (const s of part) {
        const at = out.findIndex((x) => x.start === s.start);
        if (at >= 0) out[at] = verdictOf(s, byN.get(s.n));
      }
    } catch (err) {
      failed += part.length;
      log("warn", "reveal check: a batch failed; its scenes stay held", {
        game: index.game,
        error: errorMessage(err),
      });
    }
  }
  return {
    book: {
      version: REVEAL_BOOK_VERSION,
      game: index.game,
      videoId: index.source.videoId,
      sceneSeconds: seconds,
      madeAt: o.now.toISOString(),
      scenes: out,
    },
    asked: ask.length,
    failed,
    reused,
    calls,
  };
}

function clock(t: number): string {
  const s = Math.max(0, Math.round(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The tag counts of a book (pure): safe, reveal by kind, and pending. */
export function revealCounts(book: RevealBook): {
  scenes: number;
  safe: number;
  reveal: number;
  pending: number;
  kinds: Record<string, number>;
} {
  const kinds: Record<string, number> = {};
  let safe = 0;
  let reveal = 0;
  let pending = 0;
  for (const s of book.scenes) {
    if (s.by === "pending") pending++;
    else if (s.reveal) {
      reveal++;
      kinds[s.kind ?? "twist"] = (kinds[s.kind ?? "twist"] ?? 0) + 1;
    } else safe++;
  }
  return { scenes: book.scenes.length, safe, reveal, pending, kinds };
}

export async function loadRevealBook(
  dataDir: string,
  game: string,
): Promise<RevealBook | undefined> {
  try {
    return parseRevealBook(
      JSON.parse(await fs.readFile(revealsFile(dataDir, game), "utf8")),
    );
  } catch {
    return undefined;
  }
}

/** Written beside itself first and renamed, so a reader never sees half a file. */
export async function saveRevealBook(
  dataDir: string,
  book: RevealBook,
): Promise<void> {
  const file = revealsFile(dataDir, book.game);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(book));
  await fs.rename(tmp, file);
  forgetRevealBooks();
}

let running = false;
/** After a pass whose calls failed, the next model calls wait (a model that is down is not asked every half hour). */
let retryAfter = 0;
const RETRY_HOURS = 3;

/**
 * The server's pass (never throws; one at a time): for every open early-free window, each of the game's movie and
 * playthrough indexes gets its book brought up to date, at most `maxCalls` model calls a pass in all.
 */
export async function revealPass(
  dataDir: string,
  windows: readonly SpoilerWindow[],
  llm: Llm | undefined,
  now: Date,
  o: { maxCalls?: number } = {},
): Promise<
  Array<{
    index: string;
    safe: number;
    reveal: number;
    pending: number;
    calls: number;
  }>
> {
  if (running || !llm || now.getTime() < retryAfter) return [];
  running = true;
  const done: Array<{
    index: string;
    safe: number;
    reveal: number;
    pending: number;
    calls: number;
  }> = [];
  try {
    let budget = o.maxCalls ?? 12;
    for (const w of windows) {
      if (!w.earlyFree || !windowOpen(w, now)) continue;
      // The movie chapters first (the policy is about them), then the playthroughs.
      for (const name of [...indexNamesFor(dataDir, w.game, ["movie"]), ...indexNamesFor(dataDir, w.game, ["playthrough"])]) {
        if (budget <= 0) break;
        const index = await loadSceneIndex(dataDir, name);
        if (!index || index.origin === "trailer" || !index.shots.length)
          continue;
        const prev = await loadRevealBook(dataDir, index.game);
        const r = await classifyReveals(llm, index, prev, {
          now,
          maxCalls: budget,
        });
        budget -= r.calls;
        if (r.failed) {
          retryAfter = now.getTime() + RETRY_HOURS * 3_600_000;
          budget = 0;
        }
        const unchanged =
          prev &&
          prev.videoId === r.book.videoId &&
          prev.scenes.length === r.book.scenes.length &&
          prev.scenes.every(
            (s, i) =>
              s.hash === r.book.scenes[i]!.hash &&
              s.by === r.book.scenes[i]!.by &&
              s.reveal === r.book.scenes[i]!.reveal,
          );
        if (!unchanged) await saveRevealBook(dataDir, r.book);
        const c = revealCounts(r.book);
        if (r.calls || !unchanged) {
          log("info", "reveal check: index tagged", {
            index: name,
            safe: c.safe,
            reveal: c.reveal,
            pending: c.pending,
            calls: r.calls,
          });
          done.push({
            index: name,
            safe: c.safe,
            reveal: c.reveal,
            pending: c.pending,
            calls: r.calls,
          });
        }
      }
    }
  } catch (err) {
    log("warn", "reveal check: pass failed", { error: errorMessage(err) });
  } finally {
    running = false;
  }
  return done;
}

// ---------------------------------------------------------------- frames (stream clips, the gameplay inbox)

const FRAMES_SCHEMA = {
  type: "object",
  properties: {
    reveal: { type: "boolean" },
    kind: { type: "string", enum: [...KINDS] },
    sure: { type: "boolean" },
    why: { type: "string" },
  },
  required: ["reveal", "kind", "sure", "why"],
};

export const FRAMES_PROMPT = (
  context: string,
) => `These are evenly spaced frames from a 40-second clip of someone playing a video game. ${context}
Does the clip show a big story REVEAL: a main character dying or found dead, a plot twist, a betrayal, the ending or final mission, or a major identity reveal? Ordinary play (driving, a police chase, a shoot-out with anonymous enemies, exploring, a mission objective on screen, money on the HUD, talking in a car) is SAFE.
Answer JSON: reveal (true or false), kind (death, twist, betrayal, ending, identity or none), sure (false when the frames cannot tell you), why (at most 12 words). When unsure, reveal=true and sure=false.`;

/** The model's answer for a clip's frames (pure): unsure or unreadable is a reveal. */
export function framesVerdict(answer: any): {
  reveal: boolean;
  kind?: RevealKind;
  sure: boolean;
  why: string;
} {
  const sure = answer?.sure === true;
  const kind =
    KINDS.includes(answer?.kind) && answer.kind !== "none"
      ? (answer.kind as RevealKind)
      : undefined;
  const said = typeof answer?.reveal === "boolean" ? answer.reveal : true;
  const reveal = said || !sure || Boolean(kind);
  return {
    reveal,
    ...(kind ? { kind } : {}),
    sure,
    why: String(answer?.why ?? "no readable answer").slice(0, 120),
  };
}

/** A clip's frames judged by the local vision model (Ollama). Throws when the model cannot be reached. */
export async function framesReveal(
  files: string[],
  context: string,
  o: { url?: string; model?: string } = {},
): Promise<{ reveal: boolean; kind?: RevealKind; sure: boolean; why: string }> {
  const images = await Promise.all(
    files
      .slice(0, 8)
      .map(async (f) => (await fs.readFile(f)).toString("base64")),
  );
  if (!images.length) throw new Error("no frames");
  const ask = (plain: boolean) =>
    fetchWithTimeout(
      `${o.url ?? LOCAL_VISION_URL}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: o.model ?? LOCAL_VISION_MODEL,
          stream: false,
          ...(plain ? {} : { think: false }),
          format: FRAMES_SCHEMA,
          keep_alive: process.env.LOCAL_VISION_KEEP_ALIVE ?? "20s",
          options: { temperature: 0, num_predict: 400, num_ctx: 16384 },
          messages: [{ role: "user", content: FRAMES_PROMPT(context), images }],
        }),
      },
      180_000,
    );
  let res = await ask(false);
  if (res.status === 400) res = await ask(true);
  if (!res.ok)
    throw new Error(
      `ollama ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return framesVerdict(
    visionAnswer(
      (await res.json()) as {
        message?: { content?: string; thinking?: string };
      },
    ),
  );
}

// ---------------------------------------------------------------- the held gameplay inbox

/**
 * One held inbox clip under the new rule (pure). A clip held for spoilers (status rejected with spoiler_held_until)
 * whose frames show no reveal goes back to "new" for the owner's normal review and approval; any other held clip keeps
 * waiting, now until `until`. Clips not held for spoilers are left alone.
 */
export function recheckHeld(
  meta: GameplayMeta,
  verdict: { reveal: boolean; why: string } | undefined,
  until: string,
  now: Date,
): { action: "release" | "hold" | "skip"; meta: GameplayMeta } {
  if (meta.status !== "rejected" || !meta.review?.spoiler_held_until)
    return { action: "skip", meta };
  const note = {
    at: now.toISOString(),
    reveal: verdict?.reveal ?? true,
    why: verdict?.why ?? "not checked",
  };
  if (verdict && !verdict.reveal) {
    const { review: _held, ...rest } = meta;
    void _held;
    return {
      action: "release",
      meta: { ...rest, status: "new", spoiler_recheck: note },
    };
  }
  return {
    action: "hold",
    meta: {
      ...meta,
      spoiler_recheck: note,
      review: {
        ...meta.review,
        reason: `held for spoilers until ${until.slice(0, 10)}: ${verdict ? verdict.why : "could not be checked"}`,
        spoiler_held_until: until,
      },
    },
  };
}
