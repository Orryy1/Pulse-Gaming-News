// The writers' room (top creator gap plan, 19 Nov 2026; reference spec ten/room_spec.md, tested by hand on 24
// published stories). Blind judges scored the published Shorts at about 3.9 out of 10; an editor's loop on the facts
// already in each script reached 6.9, and what still held those back was the material. The room is a clean, separate
// path with a short brief, for the same Shorts the desk covers (news, breaking and Why), in five steps:
//   1. the fact pack ("room.pack"): one call over the fetched articles, the Fact Vault note and any community items;
//      quotes and numbers the code cannot find in a fetched text are dropped and counted, never trusted to the model;
//   2. the writer ("room.write"): four angles, a kill decision, the point and three drafts as plain narration;
//   3. the critics ("room.critic", "room.viewer"): title and narration only, never the pack or the plan;
//   4. the edit ("room.edit"): edits only, biggest weakness first, a fresh read after each round;
//   5. the layout ("room.layout"): the chosen words laid into the normal Script without changing one of them.
// Deterministic checks run on every draft (no model). Everything here but the injected steps of runRoom and runLayout
// and the three call helpers is pure. Every number the critics' hand test may move lives in ROOM below.

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { Script } from "./schema.ts";
import type { ArticleText } from "../discovery/article.ts";
import type { StoryCluster } from "../discovery/cluster.ts";
import { PULSE_FACT_RULES } from "./voice.ts";
import { SOURCE_TRUTH_RULE } from "./shortrules.ts";
import { CREDIT_RULE } from "./credits.ts";
import { contentTokens, gameAliases, spokenSentences } from "./payoff.ts";
import { deskChecks, deskLines } from "./desk.ts";
import { reviseByEdits } from "./revise.ts";
import { stripVoiceTags } from "../voice/tags.ts";
import {
  panelPick,
  runPanel,
  type PanelCandidate,
  type PanelCritic,
  type PanelRead,
  type PanelRule,
} from "../panel/panel.ts";

// ---------------------------------------------------------------- the numbers, in one place

/** Every limit the room uses. The critics' hand test may move these; nothing else in the code repeats them. */
export const ROOM = {
  /** The pack. */
  quotesMax: 3,
  quoteWords: 15,
  numbersMax: 4,
  /** Primary sources followed from the articles' own links (SCRIPT_ROOM_LINKS). */
  linksMax: 3,
  /** The checks. */
  firstSentenceWords: 12,
  /** The held-back answer first appears at this share of the words or later. */
  answerAt: 0.7,
  /** Spoken proper names besides the game and its maker, and spoken numbers, before the edit is told to cut. */
  namesMax: 2,
  numbersSpokenMax: 2,
  /** A slogan closer: the last two sentences both under this many words. */
  closerShortWords: 6,
  /** An echo closer: the last line shares this many content words with the first. */
  closerEchoWords: 3,
  /** The critics. */
  passMark: 8,
  floor: 7,
  /** promise_kept under this is the first thing the edit fixes. */
  promiseMin: 7,
  /** Edit rounds (SCRIPT_ROOM_ROUNDS overrides, at most roundsMax). */
  rounds: 2,
  roundsMax: 2,
  /** Model calls a Short at most, whatever the settings say. */
  caps: {
    pack: 1,
    write: 1,
    critic: 3,
    viewer: 3,
    edit: 2,
    layout: 2,
    repair: 1,
  },
} as const;

export const ROOM_PACK_SITE = "room.pack";
export const ROOM_WRITE_SITE = "room.write";
export const ROOM_CRITIC_SITE = "room.critic";
export const ROOM_VIEWER_SITE = "room.viewer";
export const ROOM_EDIT_SITE = "room.edit";
export const ROOM_LAYOUT_SITE = "room.layout";
/** The one edits-only repair after a fact check or a house safety check blocks the laid-out script. */
export const ROOM_REPAIR_SITE = "room.repair";

export type RoomMode = "off" | "check" | "on";
export type RoomArm = "room" | "control";
export type RoomCalls = { -readonly [K in keyof typeof ROOM.caps]: number };

/** Which arm of the SCRIPT_ROOM_SHARE split an episode is in (pure): the same id always lands the same way. */
export function roomArm(episodeId: string, share: number): RoomArm {
  if (share <= 0) return "control";
  if (share >= 1) return "room";
  const n = createHash("sha1")
    .update(`script-room:${episodeId}`)
    .digest()
    .readUInt16BE(0);
  return n / 65536 < share ? "room" : "control";
}

/** The room's call caps for one Short (pure): critic reads follow the rounds (one per draft set, one per round). */
export function roomCaps(rounds: number): RoomCalls {
  const r = Math.min(ROOM.roundsMax, Math.max(0, Math.round(rounds)));
  return {
    ...ROOM.caps,
    critic: Math.min(ROOM.caps.critic, r + 1),
    viewer: Math.min(ROOM.caps.viewer, r + 1),
    edit: Math.min(ROOM.caps.edit, r),
  };
}

export const noCalls = (): RoomCalls => ({
  pack: 0,
  write: 0,
  critic: 0,
  viewer: 0,
  edit: 0,
  layout: 0,
  repair: 0,
});

// ---------------------------------------------------------------- 1. the fact pack

const SOLIDITY = ["confirmed", "reported", "speculation"] as const;

export const FactPackSchema = z.object({
  game: z
    .string()
    .describe(
      "The game the story is about, as fans name it; empty when it is about no one game",
    ),
  company: z
    .string()
    .describe(
      "The company at the centre (the maker, publisher or platform holder); empty when none",
    ),
  what_happened: z.string().describe("Two plain sentences with the date"),
  the_why: z.object({
    stated: z
      .boolean()
      .describe(
        "True when someone with standing states the reason in the sources",
      ),
    reason: z
      .string()
      .describe(
        'The actual reason as stated, or "no stated reason" plus the best-evidenced explanation',
      ),
    who: z.string().describe("Who states or offers it, with their role"),
    url: z.string().describe("The source URL"),
  }),
  quotes: z
    .array(
      z.object({
        text: z
          .string()
          .describe(
            "Verbatim, copied character for character from a source text, 15 words or fewer",
          ),
        speaker: z.string(),
        role: z.string(),
        outlet: z.string(),
        url: z.string(),
      }),
    )
    .describe(
      "Up to 3 verbatim quotes; a quote not found word for word in a source is dropped",
    ),
  numbers: z
    .array(
      z.object({
        value: z
          .string()
          .describe(
            "The number exactly as a source writes it (e.g. $69.99, 2 million, 40%)",
          ),
        spoken: z.string().describe("Rounded the way a person says it"),
        what: z.string().describe("What it counts"),
        url: z.string(),
      }),
    )
    .describe(
      "Up to 4 hard numbers; a number not in any source text is dropped",
    ),
  surprise: z.object({
    detail: z
      .string()
      .describe(
        "The least-known, most counterintuitive true detail: an earlier promise this contradicts, the fine print, a number that reframes it; empty when there is none",
      ),
    url: z.string(),
  }),
  stakes_for_player: z
    .string()
    .describe("What changes for someone who plays or buys this"),
  fan_argument: z.object({
    side_a: z
      .string()
      .describe(
        "What one side of the players argues, one line; empty when the material shows no argument",
      ),
    side_b: z.string(),
  }),
  callback: z.object({
    date: z.string(),
    line: z
      .string()
      .describe(
        "One earlier event that makes this story mean more, in one line; empty when none",
      ),
  }),
  best_questions: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
        solidity: z.enum(SOLIDITY),
      }),
    )
    .describe(
      "The two questions a fan would most want answered, each with its true answer and how solid it is",
    ),
  thin: z.object({
    thin: z
      .boolean()
      .describe(
        "True when there is nothing surprising and no real reason here",
      ),
    reason: z.string(),
  }),
  unverified: z
    .array(z.string())
    .describe("Anything the sources disagree on or do not support"),
});
export type FactPack = z.infer<typeof FactPackSchema>;

/** The pack's instructions. */
export function packPrompt(): string {
  return `You are the researcher in a writers' room for a gaming news Shorts channel. Read the sources and build the fact pack the writer will work from. The writer sees nothing else, so it must hold everything that could make a 40-second Short worth watching, and nothing that is not true.

- what_happened: two plain sentences with the date.
- the_why: the actual reason, as stated by someone with standing, with the source URL; or "no stated reason" plus the best-evidenced explanation and who offers it (stated false).
- quotes: up to ${ROOM.quotesMax}, copied verbatim from a source text, ${ROOM.quoteWords} words or fewer, with speaker, role, outlet and URL. Code checks every quote against the sources word for word and drops any it cannot find.
- numbers: up to ${ROOM.numbersMax} hard numbers exactly as a source writes them, with the URL, each with a spoken form rounded the way a person says it. Code drops any number it cannot find in a source.
- surprise: the least-known, most counterintuitive true detail (an earlier promise this contradicts, a detail in the fine print, a number that reframes it), with its source. This is the most valuable field: look hard.
- stakes_for_player: what changes for someone who plays or buys this.
- fan_argument: what players are arguing about, both sides in a line each, from the community items when there are any.
- callback: one earlier event that makes this story mean more (date and one line).
- best_questions: two questions a fan would most want answered, each with its true answer and how solid it is (confirmed, reported or speculation).
- thin: true when there is nothing surprising and no real reason here, with the reason.
- unverified: anything the sources disagree on or do not support.

Use only the sources and long-established public knowledge. Leave a field empty rather than fill it with a guess.`;
}

export interface PackInput {
  cluster: Pick<StoryCluster, "headline" | "items" | "gameHint">;
  articles: ArticleText[];
  /** The Pulse Fact Vault's note for the story's games (FACT_VAULT). */
  vault?: string;
  /** Live store numbers (Steam), a verified source. */
  storeData?: string;
  /** Reddit items or viewer comments on the story, when the factory has any. */
  community?: string[];
  /** Primary sources followed from the articles' links (SCRIPT_ROOM_LINKS). */
  primaries?: ArticleText[];
}

/** The pack's message: every source text in full, nothing about earlier drafts. */
export function packContent(o: PackInput): string {
  const byUrl = new Map(o.articles.map((a) => [a.url, a]));
  const sources = o.cluster.items
    .map((item, i) => {
      const art = byUrl.get(item.url);
      return `<source index="${i}" outlet="${item.source}" url="${item.url}" published="${item.publishedAt}">\n<headline>${item.title}</headline>\n<body>${art?.text || item.summary || "(headline only)"}</body>\n</source>`;
    })
    .join("\n");
  const primaries = (o.primaries ?? [])
    .map(
      (a) =>
        `<source kind="primary" url="${a.url}">\n<headline>${a.title}</headline>\n<body>${a.text}</body>\n</source>`,
    )
    .join("\n");
  const community = o.community?.length
    ? `\n\n<community>\n${o.community.map((c) => `- ${c}`).join("\n")}\n</community>`
    : "";
  return `STORY: ${o.cluster.headline}${o.cluster.gameHint ? ` (game: ${o.cluster.gameHint})` : ""}\n\nSources:\n${sources}${primaries ? `\n${primaries}` : ""}${o.storeData ? `\n<source outlet="Steam store (live data)">\n${o.storeData}\n</source>` : ""}${o.vault ? `\n\n${o.vault}` : ""}${community}`;
}

/** The texts a quote may be found in (pure): the fetched articles, the primaries and the feed's own summaries. */
export function quoteCorpus(o: PackInput): string[] {
  return [
    ...o.articles.map((a) => a.text),
    ...(o.primaries ?? []).map((a) => a.text),
    ...o.cluster.items.map((i) => `${i.title}\n${i.summary}`),
  ].filter(Boolean);
}

/** The texts a number may be found in (pure): the quote corpus, the vault's verified facts and the store data. */
export function numberCorpus(o: PackInput): string[] {
  return [...quoteCorpus(o), o.vault ?? "", o.storeData ?? ""].filter(Boolean);
}

/** Text for word-for-word matching (pure): case, curly quotes, dashes and whitespace made plain. */
export function normaliseForMatch(t: string): string {
  return stripVoiceTags(t)
    .toLowerCase()
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A quote's own words, without the quotation marks or closing punctuation round it (pure). */
function quoteCore(t: string): string {
  return normaliseForMatch(t)
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/[.,;:!?…]+$/g, "")
    .replace(/^["'\s]+|["'\s]+$/g, "");
}

/** Whether a quote is in one of the texts word for word (pure). */
export function quoteFound(quote: string, texts: readonly string[]): boolean {
  const q = quoteCore(quote);
  if (q.split(" ").filter(Boolean).length < 2) return false;
  return texts.some((t) => normaliseForMatch(t).includes(q));
}

/** The figures in a written number, commas taken out ("$1,299.99" gives ["1299.99"]) (pure). */
export function figuresIn(t: string): string[] {
  return (
    t.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []
  ).map((f) => f.replace(/\.0+$/, ""));
}

/** Whether every figure of a number is in one of the texts as a figure of its own (pure). */
export function numberFound(value: string, texts: readonly string[]): boolean {
  const figs = figuresIn(value);
  if (!figs.length) {
    // A number in words ("two million") is kept only when a text says it in the same words.
    const w = normaliseForMatch(value);
    return w.length > 2 && texts.some((t) => normaliseForMatch(t).includes(w));
  }
  const pool = new Set(texts.flatMap((t) => figuresIn(t)));
  return figs.every((f) => pool.has(f));
}

export interface PackDrops {
  quotes: number;
  numbers: number;
  /** What was dropped, for the record. */
  dropped: string[];
}

/** The pack with every quote and number the code cannot find in a source taken out, counted (pure). */
export function verifyPack(
  pack: FactPack,
  corpora: { quotes: readonly string[]; numbers: readonly string[] },
): { pack: FactPack; drops: PackDrops } {
  const dropped: string[] = [];
  let qn = 0;
  let nn = 0;
  const quotes = pack.quotes.filter((q) => {
    const words = quoteCore(q.text).split(" ").filter(Boolean).length;
    const ok = words <= ROOM.quoteWords && quoteFound(q.text, corpora.quotes);
    if (!ok) {
      qn++;
      dropped.push(
        `quote: "${q.text}"${words > ROOM.quoteWords ? " (too long)" : ""}`,
      );
    }
    return ok;
  });
  const numbers = pack.numbers.filter((n) => {
    const ok = numberFound(n.value, corpora.numbers);
    if (!ok) {
      nn++;
      dropped.push(`number: ${n.value}`);
    }
    return ok;
  });
  return {
    pack: {
      ...pack,
      quotes: quotes.slice(0, ROOM.quotesMax),
      numbers: numbers.slice(0, ROOM.numbersMax),
    },
    drops: { quotes: qn, numbers: nn, dropped },
  };
}

/** One pack call, verified by code. Throws when the call fails. */
export async function buildPack(
  llm: Llm,
  input: PackInput,
): Promise<{ pack: FactPack; drops: PackDrops }> {
  const raw = await llm.structured({
    site: ROOM_PACK_SITE,
    effort: "medium",
    system: packPrompt(),
    content: packContent(input),
    schema: FactPackSchema,
  });
  return verifyPack(raw, {
    quotes: quoteCorpus(input),
    numbers: numberCorpus(input),
  });
}

/** What the record keeps of a pack (pure). */
export interface PackSummary {
  stated_reason: boolean;
  quotes: number;
  numbers: number;
  surprise: boolean;
  thin: boolean;
  thin_reason?: string;
  dropped_quotes: number;
  dropped_numbers: number;
  unverified: number;
  primaries?: number;
}

export function packSummary(
  pack: FactPack,
  drops: PackDrops,
  primaries?: number,
): PackSummary {
  return {
    stated_reason:
      pack.the_why.stated && !/no stated reason/i.test(pack.the_why.reason),
    quotes: pack.quotes.length,
    numbers: pack.numbers.length,
    surprise: !!pack.surprise.detail.trim(),
    thin: pack.thin.thin,
    ...(pack.thin.thin && pack.thin.reason.trim()
      ? { thin_reason: pack.thin.reason.trim() }
      : {}),
    dropped_quotes: drops.quotes,
    dropped_numbers: drops.numbers,
    unverified: pack.unverified.length,
    ...(primaries !== undefined ? { primaries } : {}),
  };
}

/** Whether the published narration used the pack's quotes, numbers and surprise (pure; "check" mode's record). */
export function packUsed(
  pack: FactPack,
  narration: string,
): { quotes: number; numbers: number; surprise: boolean } {
  const said = normaliseForMatch(narration);
  const quotes = pack.quotes.filter((q) =>
    said.includes(quoteCore(q.text)),
  ).length;
  const saidFigs = new Set(figuresIn(narration));
  const numbers = pack.numbers.filter((n) => {
    const f = figuresIn(n.value);
    return f.length
      ? f.every((x) => saidFigs.has(x))
      : said.includes(normaliseForMatch(n.spoken));
  }).length;
  const keys = contentTokens(pack.surprise.detail).filter(
    (t) => t.length > 3 || /\d/.test(t),
  );
  const toks = new Set(contentTokens(narration));
  const surprise =
    keys.length >= 2 &&
    keys.filter((k) => toks.has(k)).length / keys.length >= 0.5;
  return { quotes, numbers, surprise };
}

/** Hosts that look like a primary source: the publisher's own post, a filing, a court or an investor page. */
const PRIMARY_HINT =
  /(?:^|\.)(?:sec\.gov|courtlistener\.com|investors?\.|ir\.|news\.xbox\.com|blog\.playstation\.com|nintendo\.(?:com|co\.jp)|rockstargames\.com|ea\.com|ubisoft\.com|bethesda\.net|store\.steampowered\.com)|\/(?:press|newsroom|news|blog|investors?|filings?)\b|interview/i;

/**
 * Whether the factory already reads a host (pure): the host, or a domain it sits under, is one of the given URLs'
 * (the feeds and the story's own items). A primary source on any other host is never fetched.
 */
export function factoryHosts(
  urls: readonly string[],
): (host: string) => boolean {
  const domains = new Set<string>();
  for (const u of urls) {
    try {
      const h = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
      domains.add(h);
      // The domain a feed's subdomain sits under (feeds.feedburner.com reads as feedburner.com too).
      const parts = h.split(".");
      if (parts.length > 2) domains.add(parts.slice(-2).join("."));
    } catch {
      // not a URL
    }
  }
  return (host: string) => {
    const h = host.toLowerCase().replace(/^www\./, "");
    return [...domains].some((d) => h === d || h.endsWith(`.${d}`));
  };
}

/**
 * Up to ROOM.linksMax of the articles' own outbound links that look like a primary source (pure), only on a host the
 * factory already reads (`allowedHost`), never a link back to the article's own outlet or a social site.
 */
export function primaryLinks(
  links: readonly string[],
  allowedHost: (host: string) => boolean,
  skip: readonly string[] = [],
): string[] {
  const out: string[] = [];
  const seen = new Set(skip);
  for (const l of links) {
    let u: URL;
    try {
      u = new URL(l);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    const key = `${u.hostname}${u.pathname}`;
    if (seen.has(l) || seen.has(key)) continue;
    if (
      /(?:^|\.)(?:twitter|x|facebook|instagram|tiktok|youtube|reddit|discord)\.com$|(?:^|\.)t\.co$|(?:^|\.)bsky\.app$/i.test(
        u.hostname,
      )
    )
      continue;
    if (!allowedHost(u.hostname.toLowerCase())) continue;
    if (!PRIMARY_HINT.test(`${u.hostname}${u.pathname}`)) continue;
    seen.add(key);
    out.push(l);
    if (out.length >= ROOM.linksMax) break;
  }
  return out;
}

// ---------------------------------------------------------------- 2. the writer

export const ROOM_STRUCTURES = [
  "contradiction",
  "cold_fact",
  "quote_open",
  "tiny_story",
  "news_then_catch",
] as const;

export const RoomAngleSchema = z.object({
  question: z.string().describe("The question in a fan's own words"),
  answer: z.string().describe("The true held-back answer, from the pack"),
  solidity: z.enum(SOLIDITY),
  why_stop: z
    .string()
    .describe("Why someone who does not play this game would still stop"),
  first_line: z.string(),
});

export const RoomDraftSchema = z.object({
  label: z.enum(["A", "B", "C"]),
  angle: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe("The index of the angle it is written on"),
  structure: z.enum(ROOM_STRUCTURES),
  title: z
    .string()
    .describe(
      "8 words or fewer, names the game, gives the premise and not the answer",
    ),
  narration: z
    .string()
    .describe(
      "The whole spoken narration as plain text, nothing but the words said",
    ),
  answer_line: z
    .string()
    .describe(
      "The sentence where the held-back answer lands, copied exactly from the narration",
    ),
});
export type RoomDraft = z.infer<typeof RoomDraftSchema>;

export const RoomWriterSchema = z.object({
  angles: z.array(RoomAngleSchema).describe("Four candidate angles"),
  best: z.number().int().min(0).max(3).describe("The index of the best angle"),
  second: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe("The index of the second-best angle"),
  kill: z
    .boolean()
    .describe(
      "True when the pack is thin and no angle has a concrete, true, held-back answer",
    ),
  kill_reason: z.string(),
  point: z.string().describe("The Short's one point in one plain sentence"),
  drafts: z
    .array(RoomDraftSchema)
    .describe(
      "A and B on the best angle with two different structures, C on the second-best",
    ),
});
export type RoomWriting = z.infer<typeof RoomWriterSchema>;

/** The room's own brief: the craft rules from the hand test, the critics' corrections and the house safety rules. */
export function writerPrompt(words: { min: number; max: number }): string {
  return `You are the writer in a writers' room for Pulse Gaming News, a YouTube Shorts channel. You get a fact pack and nothing else. You return four angles, a kill decision, the point and three drafts of plain spoken narration.

1. Find the question. Four candidate angles. Each is the question in a fan's own words, the true held-back answer from the pack with how solid it is, why someone who does not play this game would still stop, and a first line. Prefer an angle with someone at fault, a broken promise, or two facts that should not both be true. The best angles usually come from the surprise and the callback; the payoffs from the quotes and the numbers. A niche story with nothing at stake for a general gamer either leads with what makes it matter to someone who never played it, or is killed.
2. Kill rule. If the pack is thin and no angle has a concrete, true, held-back answer, set kill true and say why. Write the drafts anyway.
3. Three drafts: A and B on the best angle with two different structures, C on the second-best angle. Structures: contradiction (a contradiction, rule out the obvious answer, reveal, verdict); cold_fact (a cold fact, the odd part, escalate, reveal); quote_open (open on the real quote, who said it and why it is strange, reveal); tiny_story (someone wanted something, the obstacle, the turn, the outcome); news_then_catch (the news in the hook, then hold back the catch, the reason or the consequence).

Craft rules for every draft:
- ${words.min} to ${words.max} spoken words.
- First sentence: ${ROOM.firstSentenceWords} words or fewer, names the game or company, and is a plain concrete surprise a general gamer understands; where true it names the personal consequence (what the viewer gets, loses, pays or can do). Never open on a quote without context, an unknown name, or "X, not Y". It does not contain the answer. No riddles, no hype words.
- Second sentence sharpens the gap. It is never background.
- Every sentence does one of five jobs: sharpen the question, rule out the obvious answer, add a concrete detail that makes the answer land harder, deliver the answer, deliver the verdict. No stall lines. One point and one thread: the middle is never a list of facts and never splits into a second story.
- One turn at 40 to 55% that renews curiosity with new information.
- The answer lands after ${Math.round(ROOM.answerAt * 100)}% of the words and is concrete, and it is as big as the first line promised: if it is smaller, resize the first line or change the angle. Use the real quote or the real number when the pack has one. Copy the sentence where it lands into answer_line.
- After the answer: one verdict in the narrator's own voice ("I") that a viewer could disagree with, with its reason. Then stop on a plain last line: the verdict's reason or the concrete consequence for the player. No echo of the first line, no flip, no symmetry, no punchline of two short sentences. Never end on a question, an ask, a plug or a pointer to another video.
- Names and numbers: at most ${ROOM.namesMax} spoken proper names besides the game and its maker, and at most ${ROOM.numbersSpokenMax} numbers in the whole narration. Sources are credited on screen, not read aloud: say "reportedly" or "one report says", unless the outlet or the person is the story (a rumor still names who reports it once). A quote keeps its speaker in three or four words.
- One point. If the point cannot be said in one plain sentence, re-angle.
- Facts only from the pack; nothing from unverified. Reported or speculative things are flagged in a few natural words. Second-hand quotes are attributed to the outlet that carried them. Never imply the answer is bigger than it is.
- Human: contractions, short and long sentences mixed, the game's full name once then the short form, no lists of three, no "it isn't just X, it's Y", no stiff connectives, no stock phrases, no forced "you", at most one joke and only if it follows from the line before.
- Numbers rounded as spoken, no em dashes, nothing advertiser-unfriendly.
- Title: 8 words or fewer, names the game, gives the premise and not the answer.

${PULSE_FACT_RULES}

${SOURCE_TRUTH_RULE}

${CREDIT_RULE}`;
}

/** The pack as the writer reads it (pure). */
export function packText(pack: FactPack): string {
  return `FACT PACK\n${JSON.stringify(pack, null, 1)}`;
}

/** One writer call. Throws when the call fails. */
export async function writeRoom(
  llm: Llm,
  pack: FactPack,
  words: { min: number; max: number },
  extra = "",
): Promise<RoomWriting> {
  return llm.structured({
    site: ROOM_WRITE_SITE,
    effort: "high",
    system: writerPrompt(words),
    content: `${packText(pack)}${extra ? `\n\n${extra}` : ""}`,
    schema: RoomWriterSchema,
  });
}

// ---------------------------------------------------------------- 3. the critics

export const EDITOR_DIMENSIONS = [
  "clarity",
  "hook",
  "payoff",
  "voice",
  "human",
  "promise_kept",
  "overall",
] as const;
export type EditorDimension = (typeof EDITOR_DIMENSIONS)[number];
export const VIEWER_DIMENSIONS = [
  "stop",
  "stay",
  "got_it",
  "worth_it",
  "comment",
  "share",
  "overall",
] as const;
export type ViewerDimension = (typeof VIEWER_DIMENSIONS)[number];

const EDITOR_RUBRIC: Record<EditorDimension, string> = {
  clarity:
    "one plain point, easy on ONE listen, not too many names or numbers to hold",
  hook: "the first sentence opens a real question or surprise and makes you want the next line",
  payoff: "something held back, paid late and worth the wait",
  voice:
    "a real person with a view talking to a friend, not a news desk and not a try-hard",
  human:
    "free of AI tells: stiff connectives, stock phrases, forced you, tidy slogan endings",
  promise_kept: "the ending is as big as the first line promised",
  overall:
    "would a tough editor at a top human gaming Shorts channel publish it as it stands",
};
const VIEWER_RUBRIC: Record<ViewerDimension, string> = {
  stop: "would you stop scrolling on the first line",
  stay: "would you stay to the end",
  got_it: "did you get it on one listen",
  worth_it: "was the ending worth the wait",
  comment: "would you want to comment",
  share: "would you send it to a friend",
  overall: "how good a Short this is for you",
};

const mark = (d: string, rubric: string) =>
  z.number().int().min(1).max(10).describe(`${d}, 1 to 10: ${rubric}`);

export const EditorReadSchema = z.object({
  label: z.string().describe("The draft's label"),
  ...(Object.fromEntries(
    EDITOR_DIMENSIONS.map((d) => [d, mark(d, EDITOR_RUBRIC[d])]),
  ) as Record<EditorDimension, z.ZodNumber>),
  swipe: z
    .number()
    .int()
    .min(0)
    .describe(
      "The sentence number (1 is the first) where a scrolling viewer leaves; 0 if they finish",
    ),
  weakness: z
    .string()
    .describe("The single biggest weakness, quoting the exact line"),
  fix: z.string().describe("One concrete instruction"),
  second_thread: z
    .string()
    .describe(
      "A second thread or story the middle splits into, quoted; empty when there is one thread",
    ),
  drop: z
    .boolean()
    .describe(
      "True when even the best version of this story should not be published",
    ),
});
export type EditorRead = z.infer<typeof EditorReadSchema>;

export const ViewerReadSchema = z.object({
  label: z.string(),
  ...(Object.fromEntries(
    VIEWER_DIMENSIONS.map((d) => [d, mark(d, VIEWER_RUBRIC[d])]),
  ) as Record<ViewerDimension, z.ZodNumber>),
  swipe: z
    .number()
    .int()
    .min(0)
    .describe(
      "The sentence number where you would swipe away; 0 if you finish",
    ),
  lost_me: z
    .string()
    .describe(
      "The exact phrase where your attention drops; empty if it never did",
    ),
  fix: z.string().describe("One concrete instruction"),
  drop: z
    .boolean()
    .describe(
      "True when nothing here is at stake for a general gamer and you would not want it at all",
    ),
});
export type ViewerRead = z.infer<typeof ViewerReadSchema>;

export const EditorPanelSchema = z.object({
  reads: z.array(EditorReadSchema),
  pick: z.string().describe("The label of the draft you would publish"),
});
export const ViewerPanelSchema = z.object({ reads: z.array(ViewerReadSchema) });

export function editorPrompt(): string {
  return `You are a tough editor at a top human gaming Shorts channel. You get one to three drafts of the same story, each as its title and its narration, heard once. You know nothing else about the story, the channel or what the writer meant. Mark each draft from 1 to 10:

${EDITOR_DIMENSIONS.map((d) => `- ${d}: ${EDITOR_RUBRIC[d]}.`).join("\n")}

5 is average for a competent channel. Use the full range: 8 or more only for a draft you would publish as it stands. Don't reward length, and don't mark a fact down because you doubt it. Then give swipe (the sentence where a scrolling viewer leaves, 0 if they finish), weakness (the single biggest, quoting the exact line), fix (one concrete instruction), second_thread (quote any second thread the middle splits into) and drop (true when even the best version of this story should not go out). Pick the draft you would publish.`;
}

export function viewerPrompt(): string {
  return `You are a general gamer scrolling YouTube Shorts late at night. You play a few big games and follow the news loosely; you do not know every studio or every name. You get one to three drafts of the same story, each as a title and the narration you would hear once. Mark each from 1 to 10:

${VIEWER_DIMENSIONS.map((d) => `- ${d}: ${VIEWER_RUBRIC[d]}.`).join("\n")}

Be honest: most Shorts lose you in five seconds. Then give swipe (the sentence where you would swipe, 0 if you finish), lost_me (the exact phrase where your attention drops), fix (one concrete instruction) and drop (true when nothing here is at stake for someone like you).`;
}

/** What the critics see (pure): titles and narration, never the pack, the angles or the plan. */
export function criticContent(
  drafts: ReadonlyArray<{ label: string; title: string; narration: string }>,
): string {
  return drafts
    .map(
      (d) =>
        `DRAFT ${d.label}\nTITLE: ${d.title.trim()}\nNARRATION: ${stripVoiceTags(d.narration).replace(/\s+/g, " ").trim()}`,
    )
    .join("\n\n");
}

export async function readEditor(
  llm: Llm,
  drafts: ReadonlyArray<{ label: string; title: string; narration: string }>,
): Promise<z.infer<typeof EditorPanelSchema>> {
  return llm.structured({
    site: ROOM_CRITIC_SITE,
    tier: "mid",
    effort: "medium",
    system: editorPrompt(),
    content: criticContent(drafts),
    schema: EditorPanelSchema,
  });
}

export async function readViewer(
  llm: Llm,
  drafts: ReadonlyArray<{ label: string; title: string; narration: string }>,
): Promise<z.infer<typeof ViewerPanelSchema>> {
  return llm.structured({
    site: ROOM_VIEWER_SITE,
    tier: "mid",
    effort: "medium",
    system: viewerPrompt(),
    content: criticContent(drafts),
    schema: ViewerPanelSchema,
  });
}

/** The mark a draft carries (pure): the mean of the two overall marks, the editor's alone without a viewer read. */
export function meanOverall(
  e: Pick<EditorRead, "overall">,
  v?: Pick<ViewerRead, "overall">,
): number {
  return v ? (e.overall + v.overall) / 2 : e.overall;
}

/** The room's pick rule on the shared blind panel: the best mean overall, ties to the editor critic. */
export const ROOM_PICK_RULE: PanelRule = {
  name: "best mean of the two overall marks",
  ties: [
    { by: "criticPick", critic: "editor" },
    { by: "critic", critic: "editor" },
    { by: "order" },
  ],
};

/**
 * The pick (pure): the best mean of the two overall marks; a tie goes to the editor critic (its own pick, then its
 * higher overall, then the earlier draft). Returns the index into `editor`. The rule is the shared panel's
 * (src/panel/panel.ts) with ROOM_PICK_RULE.
 */
export function pickDraft(
  editor: ReadonlyArray<Pick<EditorRead, "label" | "overall">>,
  viewer: ReadonlyArray<Pick<ViewerRead, "label" | "overall">> | undefined,
  editorPick?: string,
): number {
  const ids = editor.map((_, i) => String(i));
  const read = (id: string, overall: number) => ({ id, overall, marks: {}, fault: "" });
  const verdicts = [
    {
      critic: "editor",
      required: true,
      verdict: {
        reads: editor.map((e, i) => read(ids[i]!, e.overall)),
        pick: ids.filter((_, i) => editor[i]!.label === editorPick),
      },
    },
    ...(viewer
      ? [
          {
            critic: "viewer",
            verdict: {
              reads: editor.flatMap((e, i) => {
                const v = viewer.find((x) => x.label === e.label);
                return v ? [read(ids[i]!, v.overall)] : [];
              }),
            },
          },
        ]
      : []),
  ];
  const p = panelPick(ids, verdicts, ROOM_PICK_RULE);
  return p.pick === undefined ? -1 : Number(p.pick);
}

/** Whether a read clears the room (pure): mean overall at the pass mark and no editor dimension under the floor. */
export function clearsRoom(
  e: Pick<EditorRead, EditorDimension>,
  v?: Pick<ViewerRead, "overall">,
  min: number = ROOM.passMark,
): boolean {
  return (
    meanOverall(e, v) >= min &&
    EDITOR_DIMENSIONS.every((d) => e[d] >= ROOM.floor)
  );
}

/** Both critics said drop (pure): the story falls back to the normal path. */
export function bothDrop(
  e?: Pick<EditorRead, "drop">,
  v?: Pick<ViewerRead, "drop">,
): boolean {
  return !!e?.drop && !!v?.drop;
}

// ---------------------------------------------------------------- deterministic checks

export const ROOM_RULES = [
  "first_long",
  "first_unnamed",
  "words",
  "last_line_ask",
  "em_dash",
  "early_answer",
  "answer_unfound",
  "names",
  "numbers",
  "closer_short",
  "closer_echo",
  "banned_line",
  "full_name",
  "repeated_fact",
  "formula_ending",
] as const;
export type RoomRule = (typeof ROOM_RULES)[number];

export interface RoomFinding {
  rule: RoomRule;
  problem: string;
}

export interface RoomCounts {
  words: number;
  names: number;
  name_list: string[];
  numbers: number;
  answer_at?: number;
}

/** Outlets a narration may read out; the story's own sources are added by the caller. */
export const KNOWN_OUTLETS = [
  "Bloomberg",
  "IGN",
  "The Verge",
  "Verge",
  "Insider Gaming",
  "Eurogamer",
  "VGC",
  "GameSpot",
  "Kotaku",
  "PC Gamer",
  "Polygon",
  "Reuters",
  "Digital Foundry",
  "Windows Central",
  "Game File",
  "Axios",
  "Famitsu",
  "Rock Paper Shotgun",
  "GamesIndustry.biz",
  "Jason Schreier",
  "Tom Henderson",
  "Jeff Grubb",
];

/** Words that start a capitalised run but are not names. */
const NOT_NAMES = new Set(
  "I I'm I'd I'll I've A An The And But So Or If When Then That This These Those It It's Its They Their He She We You Your Yes No Not Now Here There What Why How Who Which Where Except Still Just Even Only Also Plus Because Since After Before While Until Today Tomorrow Yesterday Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Christmas Halloween US UK EU America American Europe Japan Japanese Steam PlayStation PS5 PS4 Xbox Switch Nintendo PC Mac Game Pass Series Edition Ultimate Standard Deluxe Remastered Remake DLC Season Update Patch Trailer Direct State Play Showcase Early Access OK".split(
    " ",
  ),
);

/**
 * Distinct spoken people and outlets besides the game and its maker (pure): the known outlets and the story's own,
 * plus runs of two or more capitalised words that are not the game, the maker, a platform or a sentence's opener.
 */
export function spokenNames(
  narration: string,
  o: { game?: string; company?: string; outlets?: readonly string[] } = {},
): string[] {
  const text = stripVoiceTags(narration);
  const skip = (n: string) => {
    const l = n.toLowerCase();
    return (
      (!!o.game &&
        (o.game.toLowerCase().includes(l) ||
          l.includes(o.game.toLowerCase()))) ||
      (!!o.company &&
        (o.company.toLowerCase().includes(l) ||
          l.includes(o.company.toLowerCase())))
    );
  };
  const found = new Map<string, string>();
  for (const out of [...KNOWN_OUTLETS, ...(o.outlets ?? [])]) {
    if (!out.trim()) continue;
    const re = new RegExp(
      `\\b${out.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    );
    if (re.test(text) && !skip(out))
      found.set(out.toLowerCase().replace(/^the /, ""), out);
  }
  const aliases = o.game ? gameAliases(o.game) : new Set<string>();
  for (const m of text.matchAll(
    /\b[A-Z][a-z'’]+(?:\s+(?:de|van|von|da)?\s*[A-Z][a-z'’]+)+\b/g,
  )) {
    const words = m[0]
      .split(/\s+/)
      .filter((w) => !NOT_NAMES.has(w.replace(/['’]s$/, "")));
    if (words.length < 2) continue;
    const name = words.join(" ").replace(/['’]s$/, "");
    if (skip(name)) continue;
    if (words.some((w) => aliases.has(w.toLowerCase()))) continue;
    const key = name.toLowerCase();
    if ([...found.keys()].some((k) => k.includes(key) || key.includes(k)))
      continue;
    found.set(key, name);
  }
  return [...found.values()];
}

const NUMBER_WORDS =
  /\b(?:(?:three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half)(?:[\s-]+(?:and\s+)?(?:one|two|three|four|five|six|seven|eight|nine|hundred|thousand|million|billion))*)\b/gi;

/** The game's own name taken out of a text, its numbered short form too ("GTA 6", "GTA VI") (pure). */
function withoutGame(text: string, game = ""): string {
  if (!game.trim()) return text;
  let t = text
    .split(new RegExp(game.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"))
    .join(" ");
  const words = game
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const plain = words.filter((w) => !/^[IVX]+$/.test(w) && !/^\d+$/.test(w));
  const acronym = plain.length >= 2 ? plain.map((w) => w[0]).join("") : "";
  const firstWord = plain[0] ?? "";
  for (const head of [acronym, firstWord].filter((h) => h.length >= 2))
    t = t.replace(new RegExp(`\\b${head}\\s*(?:\\d+|[IVX]+)\\b`, "gi"), " ");
  return t;
}

/** Distinct spoken numbers (pure): figures and number words, the game's own numeral left out. */
export function spokenNumbers(narration: string, game = ""): string[] {
  const t = withoutGame(stripVoiceTags(narration), game);
  const FIGURE = /[$£€]?\d+(?:\.\d+)?(?:%|\s*(?:million|billion|thousand))?/gi;
  const plain = t.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const figs = (plain.match(FIGURE) ?? []).map((x) =>
    x.toLowerCase().replace(/\s+/g, " "),
  );
  // Number words only where no figure stands ("2 million" is one number, not two).
  const words = (plain.replace(FIGURE, " ").match(NUMBER_WORDS) ?? []).map(
    (x) => x.toLowerCase().replace(/\s+/g, " "),
  );
  return [...new Set([...figs, ...words])];
}

/** Where a draft's answer line first appears, as a share of the words (pure); undefined when it isn't found. */
export function answerShare(
  narration: string,
  answerLine: string,
): number | undefined {
  const { sentences, total } = spokenSentences([narration]);
  const want = normaliseForMatch(answerLine)
    .replace(/[^a-z0-9$% ]/g, "")
    .trim();
  if (!total || want.split(" ").length < 3) return undefined;
  const head = want.split(" ").slice(0, 6).join(" ");
  const i = sentences.findIndex((s) => {
    const t = normaliseForMatch(s.text)
      .replace(/[^a-z0-9$% ]/g, "")
      .trim();
    return t.includes(head) || want.includes(t);
  });
  return i < 0 ? undefined : sentences[i]!.start / total;
}

/**
 * Every deterministic finding on one draft, and the counts the record keeps (pure). The desk's checks (banned lines,
 * a last-line ask, the full name over twice, a repeated fact, a formula ending) are reused; findings never block on
 * their own, they go to the edit as instructions.
 */
export function roomChecks(o: {
  narration: string;
  answerLine?: string;
  game?: string;
  company?: string;
  outlets?: readonly string[];
  words: { min: number; max: number };
}): { findings: RoomFinding[]; counts: RoomCounts } {
  const out: RoomFinding[] = [];
  const text = stripVoiceTags(o.narration).replace(/\s+/g, " ").trim();
  const { sentences, total } = spokenSentences([text]);
  const first = sentences[0]?.text ?? "";
  if ((sentences[0]?.words ?? 0) > ROOM.firstSentenceWords)
    out.push({
      rule: "first_long",
      problem: `The first sentence is ${sentences[0]!.words} words; say it in ${ROOM.firstSentenceWords} or fewer.`,
    });
  const named = (() => {
    const toks = new Set(contentTokens(first));
    const aliases = [
      ...(o.game ? gameAliases(o.game) : []),
      ...(o.company ? contentTokens(o.company) : []),
    ];
    return (
      aliases.some((a) => toks.has(a)) ||
      (!!o.company && first.toLowerCase().includes(o.company.toLowerCase()))
    );
  })();
  if ((o.game || o.company) && !named)
    out.push({
      rule: "first_unnamed",
      problem:
        "The first sentence does not name the game or the company; a viewer must know the topic at once.",
    });
  if (total < o.words.min || total > o.words.max)
    out.push({
      rule: "words",
      problem: `The narration is ${total} words; it must be ${o.words.min} to ${o.words.max}.`,
    });
  if (/—|\s–\s/.test(text))
    out.push({
      rule: "em_dash",
      problem: "Take out the em dash; use a full stop or a comma.",
    });
  let answerAt: number | undefined;
  if (o.answerLine !== undefined) {
    answerAt = answerShare(text, o.answerLine);
    if (answerAt === undefined)
      out.push({
        rule: "answer_unfound",
        problem:
          "The held-back answer line is not in the narration as written.",
      });
    else if (answerAt < ROOM.answerAt)
      out.push({
        rule: "early_answer",
        problem: `The answer lands at ${Math.round(answerAt * 100)}% of the words; hold it until after ${Math.round(ROOM.answerAt * 100)}%.`,
      });
  }
  const names = spokenNames(text, o);
  if (names.length > ROOM.namesMax)
    out.push({
      rule: "names",
      problem: `${names.length} names are read out (${names.join(", ")}); keep at most ${ROOM.namesMax} besides the game and its maker. Credit sources on screen, say "reportedly" instead, and give a quote's speaker in three or four words.`,
    });
  const numbers = spokenNumbers(text, o.game);
  if (numbers.length > ROOM.numbersSpokenMax)
    out.push({
      rule: "numbers",
      problem: `${numbers.length} numbers are said (${numbers.join(", ")}); keep the ${ROOM.numbersSpokenMax} that carry the point and cut the rest.`,
    });
  const last = sentences[sentences.length - 1];
  const before = sentences[sentences.length - 2];
  if (
    last &&
    before &&
    last.words < ROOM.closerShortWords &&
    before.words < ROOM.closerShortWords
  )
    out.push({
      rule: "closer_short",
      problem: `The ending "${before.text} ${last.text}" is a two-short-sentence punchline; end on one plain line: the verdict's reason or the concrete consequence for the player.`,
    });
  if (last && sentences.length > 1) {
    const aliases = o.game ? gameAliases(o.game) : new Set<string>();
    const a = new Set(contentTokens(first).filter((t) => !aliases.has(t)));
    const shared = [...new Set(contentTokens(last.text))].filter(
      (t) => !aliases.has(t) && a.has(t),
    );
    if (shared.length >= ROOM.closerEchoWords)
      out.push({
        rule: "closer_echo",
        problem: `The last line echoes the first ("${shared.join(", ")}"); end on the consequence for the player instead of a callback.`,
      });
  }
  for (const f of deskChecks({ lines: [text], game: o.game }))
    out.push({
      rule: f.rule === "last_line_ask" ? "last_line_ask" : (f.rule as RoomRule),
      problem: f.problem,
    });
  return {
    findings: out,
    counts: {
      words: total,
      names: names.length,
      name_list: names,
      numbers: numbers.length,
      ...(answerAt !== undefined
        ? { answer_at: Math.round(answerAt * 100) / 100 }
        : {}),
    },
  };
}

// ---------------------------------------------------------------- 4. the edit

/** The one instruction an edit round gets (pure): a broken promise first, then the editor's weakness, then the flags. */
export function roomInstruction(o: {
  editor: Pick<
    EditorRead,
    "promise_kept" | "weakness" | "fix" | "second_thread" | "overall"
  >;
  viewer?: Pick<ViewerRead, "fix" | "lost_me" | "overall">;
  findings: readonly RoomFinding[];
  point?: string;
}): string {
  const parts: string[] = [];
  if (o.editor.promise_kept < ROOM.promiseMin)
    parts.push(
      `First: the ending is smaller than the first line promises (promise kept ${o.editor.promise_kept}/10). Resize the first line to what the answer really delivers, or change the angle to one whose answer is as big as its first line.`,
    );
  parts.push(
    `Biggest weakness: ${o.editor.weakness.trim()} Fix: ${o.editor.fix.trim()}`,
  );
  if (o.editor.second_thread.trim())
    parts.push(
      `Cut the second thread (${o.editor.second_thread.trim()}): one point, one thread.`,
    );
  if (o.viewer?.fix.trim())
    parts.push(
      `The viewer lost interest at "${o.viewer.lost_me.trim()}": ${o.viewer.fix.trim()}`,
    );
  if (o.findings.length)
    parts.push(
      `Also: ${o.findings
        .slice(0, 5)
        .map((f) => f.problem)
        .join(" ")}`,
    );
  if (o.point?.trim()) parts.push(`The point: ${o.point.trim()}`);
  parts.push(
    "Edits only: change what these name and keep every other line word for word. Use only facts already in the draft. Hold the answer late, keep the verdict in the narrator's own voice, and end on a plain line.",
  );
  return parts.join(" ");
}

export const RoomTextSchema = z.object({
  title: z.string(),
  narration: z.string(),
});
export type RoomText = z.infer<typeof RoomTextSchema>;

/** One edits-only round on title and narration ("room.edit" or "room.repair"). Undefined when the edits don't apply. */
export async function editRoom(
  llm: Llm,
  o: {
    draft: RoomText;
    problems: string[];
    pack?: FactPack;
    words: { min: number; max: number };
    site?: string;
  },
): Promise<RoomText | undefined> {
  return reviseByEdits(llm, {
    site: o.site ?? ROOM_EDIT_SITE,
    system: writerPrompt(o.words),
    content: o.pack ? packText(o.pack) : "",
    schema: RoomTextSchema,
    draft: o.draft,
    problems: o.problems,
    job: "writers' room",
  });
}

// ---------------------------------------------------------------- the room's loop

export interface RoomRoundMarks {
  /** 0 is the drafts' read; 1 and on, each edit round. */
  round: number;
  /** The label of the draft read in this round. */
  label: string;
  editor?: Record<EditorDimension, number>;
  viewer?: Record<ViewerDimension, number>;
  mean?: number;
  findings: RoomRule[];
  instruction?: string;
  refused?: string[];
}

export type RoomStop =
  | "cleared"
  | "no_gain"
  | "rounds"
  | "cap"
  | "unread"
  | "killed"
  | "dropped"
  | "failed";

export interface RoomRun {
  pack?: FactPack;
  drops?: PackDrops;
  writing?: RoomWriting;
  /** Each draft's first read and checks. */
  drafts: Array<{
    label: string;
    title: string;
    narration: string;
    editor?: Record<EditorDimension, number>;
    viewer?: Record<ViewerDimension, number>;
    counts: RoomCounts;
    findings: RoomRule[];
  }>;
  pick?: string;
  rounds: RoomRoundMarks[];
  final?: RoomText & { answer_line?: string; counts: RoomCounts };
  kill?: { why: string };
  drop?: { editor: boolean; viewer: boolean };
  stop: RoomStop;
  error?: string;
  calls: RoomCalls;
}

const editorMarks = (r: EditorRead) =>
  Object.fromEntries(EDITOR_DIMENSIONS.map((d) => [d, r[d]])) as Record<
    EditorDimension,
    number
  >;
const viewerMarks = (r: ViewerRead) =>
  Object.fromEntries(VIEWER_DIMENSIONS.map((d) => [d, r[d]])) as Record<
    ViewerDimension,
    number
  >;

type ShownDraft = { label: string; title: string; narration: string };

/**
 * The room's critics on the shared blind panel. Each draft is a candidate (its id the label, its view exactly what
 * criticContent shows of it); the injected critics still receive the drafts themselves, so their requests are byte for
 * byte what they were before the panel. `single`: a re-read of one edited version, whose read is the first one
 * returned whatever its label (and whose editor answer must carry reads, as before).
 */
async function roomPanel(o: {
  drafts: ShownDraft[];
  editor: (drafts: ShownDraft[]) => Promise<z.infer<typeof EditorPanelSchema>>;
  viewer?: (drafts: ShownDraft[]) => Promise<z.infer<typeof ViewerPanelSchema>>;
  single?: boolean;
  viewerCalls?: number;
}) {
  const byCandidate = new Map<PanelCandidate, ShownDraft>();
  const candidates = o.drafts.map((d) => {
    const c: PanelCandidate = { id: d.label, view: criticContent([d]) };
    byCandidate.set(c, d);
    return c;
  });
  const critic = <A extends { reads?: unknown }>(
    name: string,
    fn: (drafts: ShownDraft[]) => Promise<A>,
    toRead: (id: string, r: any) => PanelRead<unknown>,
    required: boolean,
  ): PanelCritic<unknown> => ({
    name,
    required,
    judge: async (cands) => {
      const r = await fn(cands.map((c) => byCandidate.get(c)!));
      if (o.single && required) void (r as any).reads[0];
      const list: any[] = Array.isArray((r as any)?.reads) ? (r as any).reads : [];
      const reads = o.single
        ? list[0] && cands[0]
          ? [toRead(cands[0].id, list[0])]
          : []
        : list.map((x) => toRead(String(x?.label), x));
      const pick = (r as any)?.pick;
      return { reads, raw: r, ...(typeof pick === "string" ? { pick } : {}) };
    },
  });
  const editorRead = (id: string, x: any): PanelRead<unknown> => ({
    id,
    marks: Object.fromEntries(EDITOR_DIMENSIONS.map((d) => [d, x?.[d]])),
    overall: x?.overall,
    fault: String(x?.weakness ?? ""),
    drop: x?.drop === true,
    raw: x,
  });
  const viewerRead = (id: string, x: any): PanelRead<unknown> => ({
    id,
    marks: Object.fromEntries(VIEWER_DIMENSIONS.map((d) => [d, x?.[d]])),
    overall: x?.overall,
    fault: String(x?.lost_me || x?.fix || ""),
    drop: x?.drop === true,
    raw: x,
  });
  return runPanel({
    candidates,
    critics: [
      critic("editor", o.editor, editorRead, true),
      ...(o.viewer ? [critic("viewer", o.viewer, viewerRead, false)] : []),
    ],
    rule: ROOM_PICK_RULE,
    caps: {
      perCritic: { editor: 1, viewer: o.viewerCalls ?? 1 },
      candidates: candidates.length,
    },
  });
}

/**
 * Steps 1 to 4 (the steps are injected, so it is tested without a model). The pack, the writer, both critics on the
 * three drafts, the pick, then edit rounds on the pick while it misses the bar: one instruction, the edit, the caller's
 * accept (a fact guard), a fresh read by both critics. Stops when it clears, when a round does not improve the mean,
 * after `rounds` edits or at a cap. The kept version is the best-marked one that passed its accept. A killed story,
 * or one both critics drop, comes back with no final text.
 */
export async function runRoom(o: {
  pack: () => Promise<{ pack: FactPack; drops: PackDrops }>;
  write: (pack: FactPack) => Promise<RoomWriting>;
  editor: (
    drafts: Array<{ label: string; title: string; narration: string }>,
  ) => Promise<z.infer<typeof EditorPanelSchema>>;
  /** Absent when SCRIPT_ROOM_VIEWER is off. */
  viewer?: (
    drafts: Array<{ label: string; title: string; narration: string }>,
  ) => Promise<z.infer<typeof ViewerPanelSchema>>;
  edit: (
    draft: RoomText,
    instruction: string,
    pack: FactPack,
  ) => Promise<RoomText | undefined>;
  /** Why an edited version may not be kept (numbers or quotes the sources lack); empty to keep it. */
  accept?: (before: RoomText, after: RoomText) => string[];
  check: (
    narration: string,
    answerLine?: string,
  ) => { findings: RoomFinding[]; counts: RoomCounts };
  rounds?: number;
  min?: number;
}): Promise<RoomRun> {
  const caps = roomCaps(o.rounds ?? ROOM.rounds);
  const min = o.min ?? ROOM.passMark;
  const calls = noCalls();
  const run: RoomRun = { drafts: [], rounds: [], stop: "failed", calls };
  try {
    calls.pack++;
    const p = await o.pack();
    run.pack = p.pack;
    run.drops = p.drops;
    calls.write++;
    const w = await o.write(p.pack);
    run.writing = w;
    const drafts = w.drafts.slice(0, 3);
    if (!drafts.length) {
      run.error = "the writer returned no drafts";
      return run;
    }
    const checked = drafts.map((d) => ({
      d,
      c: o.check(d.narration, d.answer_line),
    }));
    run.drafts = checked.map(({ d, c }) => ({
      label: d.label,
      title: d.title,
      narration: d.narration,
      counts: c.counts,
      findings: c.findings.map((f) => f.rule),
    }));
    if (w.kill) {
      run.kill = {
        why:
          w.kill_reason.trim() ||
          "The pack is thin and no angle has a concrete held-back answer.",
      };
      run.stop = "killed";
      return run;
    }
    const shown = drafts.map((d) => ({
      label: d.label,
      title: d.title,
      narration: d.narration,
    }));
    // Both critics read the drafts blind on the shared panel (src/panel/panel.ts): the editor first and required (no
    // editor read, no pick), the viewer beside it when it is on (its failure only leaves its marks out).
    const first = await roomPanel({ drafts: shown, editor: o.editor, viewer: o.viewer });
    calls.critic += first.callsBy.editor ?? 0;
    calls.viewer += first.callsBy.viewer ?? 0;
    if (first.failed.editor !== undefined) {
      run.stop = "unread";
      return run;
    }
    const ed = first.verdicts.editor!.raw as z.infer<typeof EditorPanelSchema>;
    const vw = first.verdicts.viewer?.raw as
      | z.infer<typeof ViewerPanelSchema>
      | undefined;
    const readOf = (label: string) => ed.reads.find((r) => r.label === label);
    const viewOf = (label: string) => vw?.reads.find((r) => r.label === label);
    run.drafts = run.drafts.map((d) => {
      const e = readOf(d.label);
      const v = viewOf(d.label);
      return {
        ...d,
        ...(e ? { editor: editorMarks(e) } : {}),
        ...(v ? { viewer: viewerMarks(v) } : {}),
      };
    });
    const reads = drafts
      .map((d) => readOf(d.label))
      .filter((r): r is EditorRead => !!r);
    if (!reads.length) {
      run.stop = "unread";
      return run;
    }
    const pi = pickDraft(reads, vw?.reads, ed.pick);
    const pickedRead = reads[pi]!;
    const picked = drafts.find((d) => d.label === pickedRead.label)!;
    run.pick = picked.label;
    const pickedView = viewOf(picked.label);
    if (bothDrop(pickedRead, pickedView)) {
      run.drop = { editor: true, viewer: true };
      run.stop = "dropped";
      return run;
    }
    const firstCheck = checked.find((c) => c.d.label === picked.label)!.c;
    run.rounds.push({
      round: 0,
      label: picked.label,
      editor: editorMarks(pickedRead),
      ...(pickedView ? { viewer: viewerMarks(pickedView) } : {}),
      mean: meanOverall(pickedRead, pickedView),
      findings: firstCheck.findings.map((f) => f.rule),
    });
    let best = {
      text: { title: picked.title, narration: picked.narration } as RoomText,
      e: pickedRead,
      v: pickedView,
      check: firstCheck,
    };
    const done = (stop: RoomStop): RoomRun => {
      run.final = {
        ...best.text,
        answer_line: picked.answer_line,
        counts: best.check.counts,
      };
      run.stop = stop;
      return run;
    };
    if (clearsRoom(best.e, best.v, min)) return done("cleared");
    for (let r = 1; r <= caps.edit; r++) {
      if (calls.edit >= caps.edit || calls.critic >= caps.critic)
        return done("cap");
      const instruction = roomInstruction({
        editor: best.e,
        viewer: best.v,
        findings: best.check.findings,
        point: w.point,
      });
      calls.edit++;
      const after = await o
        .edit(best.text, instruction, p.pack)
        .catch(() => undefined);
      if (!after) {
        run.rounds.push({
          round: r,
          label: picked.label,
          findings: [],
          instruction,
          refused: ["The edits did not apply."],
        });
        continue;
      }
      const refused = o.accept?.(best.text, after) ?? [];
      const c = o.check(after.narration, picked.answer_line);
      if (refused.length) {
        run.rounds.push({
          round: r,
          label: picked.label,
          findings: c.findings.map((f) => f.rule),
          instruction,
          refused: refused.slice(0, 6),
        });
        continue;
      }
      // A fresh read of the edited version alone, on the same panel (the viewer within its cap).
      const again = await roomPanel({
        drafts: [{ label: picked.label, ...after }],
        editor: o.editor,
        viewer: o.viewer,
        single: true,
        viewerCalls: o.viewer && calls.viewer < caps.viewer ? 1 : 0,
      });
      calls.critic += again.callsBy.editor ?? 0;
      calls.viewer += again.callsBy.viewer ?? 0;
      let e2: EditorRead | undefined =
        again.failed.editor === undefined
          ? (again.verdicts.editor?.raw as z.infer<typeof EditorPanelSchema>)
              .reads[0]
          : undefined;
      let v2: ViewerRead | undefined;
      try {
        v2 = (
          again.verdicts.viewer?.raw as
            | z.infer<typeof ViewerPanelSchema>
            | undefined
        )?.reads[0];
      } catch {
        // a viewer answer with no reads counts as a failed read, as it always did
        e2 = undefined;
      }
      if (!e2) {
        run.rounds.push({
          round: r,
          label: picked.label,
          findings: c.findings.map((f) => f.rule),
          instruction,
          refused: ["The critic's read failed."],
        });
        return done("unread");
      }
      const mean = meanOverall(e2, v2);
      run.rounds.push({
        round: r,
        label: picked.label,
        editor: editorMarks(e2),
        ...(v2 ? { viewer: viewerMarks(v2) } : {}),
        mean,
        findings: c.findings.map((f) => f.rule),
        instruction,
      });
      const improved = mean > meanOverall(best.e, best.v);
      if (improved) best = { text: after, e: e2, v: v2, check: c };
      if (clearsRoom(best.e, best.v, min)) return done("cleared");
      if (!improved) return done("no_gain");
    }
    return done("rounds");
  } catch (err) {
    run.error = err instanceof Error ? err.message : String(err);
    run.stop = "failed";
    return run;
  }
}

/**
 * The fact guard on an edit (pure): a number or a quotation the edited narration says that the sources (the pack's
 * corpora) do not hold is refused.
 */
export function roomEditProblems(
  after: RoomText,
  corpora: { quotes: readonly string[]; numbers: readonly string[] },
  before?: RoomText,
): string[] {
  const out: string[] = [];
  const had = new Set(before ? figuresIn(before.narration) : []);
  for (const f of figuresIn(after.narration))
    if (!had.has(f) && !numberFound(f, corpora.numbers))
      out.push(`The edit adds the figure ${f}, which no source gives.`);
  for (const m of stripVoiceTags(after.narration).matchAll(
    /["“]([^"”]{8,})["”]/g,
  ))
    if (
      !quoteFound(m[1]!, corpora.quotes) &&
      !(
        before && normaliseForMatch(before.narration).includes(quoteCore(m[1]!))
      )
    )
      out.push(
        `The edit quotes "${m[1]}", which no source says word for word.`,
      );
  return out;
}

// ---------------------------------------------------------------- 5. the layout

/** The words of a narration for the layout's comparison (pure): whitespace and punctuation made plain, case kept out. */
export function narrationKey(t: string): string {
  return normaliseForMatch(t)
    .replace(/[^a-z0-9$%£€'\s]/g, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether the laid-out script says exactly the room's words (pure). */
export function layoutKeeps(
  script: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
  narration: string,
): boolean {
  return narrationKey(deskLines(script).join(" ")) === narrationKey(narration);
}

/** Where the laid-out words first differ from the room's, for the retry (pure). */
export function layoutDiff(
  script: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
  narration: string,
): string {
  const a = narrationKey(deskLines(script).join(" ")).split(" ");
  const b = narrationKey(narration).split(" ");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return "";
  return `The laid-out narration differs from the locked words at word ${i + 1}: it says "${a.slice(i, i + 8).join(" ")}" where the locked narration says "${b.slice(i, i + 8).join(" ")}".`;
}

/** The layout's own brief: the words are fixed; only the shape around them is written. */
export function layoutRule(locked: {
  title: string;
  narration: string;
}): string {
  return `LOCKED NARRATION. The narration below is final. Lay it out into the script without changing, adding, dropping or reordering one word: the hook is its first sentence, the beats are the sentences that follow (one or two sentences each), pulse_take.narration is the verdict sentence or two, and loop_line is the last sentence. Joined in order, hook, beats, take and loop line must read exactly the locked narration. Everything else is yours to write as usual from the sources: each beat's card and footage, hook_footage, the take's label and on-screen line, the headline, the stamp (only on a word that is spoken), people, the claims with the source URL that supports each, the attribution that credits the sources on screen, the hashtags, the description and the tags. Leave desk_question out. The YouTube title starts from the room's title "${locked.title.trim()}" and may only be adjusted for search (the game named the way people type it), never to give the answer away.

LOCKED NARRATION:
${locked.narration.trim()}`;
}

export interface LayoutResult {
  script?: Script;
  calls: number;
  /** Why the layout fell back to the normal writer, when it did. */
  fallback?: string;
}

/** Lays out the words, checks them by code, one retry with the difference, then gives up (the caller falls back). */
export async function runLayout(o: {
  narration: string;
  layout: (feedback?: string) => Promise<Script>;
  max?: number;
}): Promise<LayoutResult> {
  const max = Math.min(ROOM.caps.layout, o.max ?? ROOM.caps.layout);
  let feedback: string | undefined;
  let calls = 0;
  let why = "the layout did not run";
  for (let i = 0; i < max; i++) {
    calls++;
    let sc: Script;
    try {
      sc = await o.layout(feedback);
    } catch (err) {
      why = `the layout failed: ${err instanceof Error ? err.message : String(err)}`;
      feedback = undefined;
      continue;
    }
    if (layoutKeeps(sc, o.narration)) return { script: sc, calls };
    feedback = layoutDiff(sc, o.narration);
    why = `the layout changed the words: ${feedback}`;
  }
  return { calls, fallback: why };
}

// ---------------------------------------------------------------- the record

export interface RoomRecord {
  arm: RoomArm;
  mode: Exclude<RoomMode, "off">;
  /** "check" and "on": what the pack held. */
  pack?: PackSummary;
  /** "check": whether the published script used the pack's quotes, numbers and surprise. */
  used?: { quotes: number; numbers: number; surprise: boolean };
  angles?: Array<{ question: string; answer: string; solidity: string }>;
  point?: string;
  /** The drafts' first marks and counts. */
  drafts?: RoomRun["drafts"];
  pick?: string;
  rounds?: RoomRoundMarks[];
  /** The kept version's marks, each critic's separately. */
  editor_overall?: number;
  viewer_overall?: number;
  mean?: number;
  counts?: RoomCounts;
  kill?: { why: string };
  drop?: { editor: boolean; viewer: boolean };
  stop?: RoomStop;
  /** Why the normal writer wrote the Short instead: a kill, a drop, a failed step, the layout or the fact check. */
  fallback?: string;
  /** True when the published words are the room's. */
  wrote?: boolean;
  /** Steps a room script skipped or ran record-only. */
  skipped?: string[];
  calls: RoomCalls;
  /** The model that wrote the drafts (from the usage meter), when known. */
  model?: string;
}

/** The record a script carries (pure). */
export function roomRecord(o: {
  arm: RoomArm;
  mode: Exclude<RoomMode, "off">;
  run?: RoomRun;
  pack?: { pack: FactPack; drops: PackDrops; primaries?: number };
  used?: RoomRecord["used"];
  fallback?: string;
  wrote?: boolean;
  skipped?: string[];
  calls?: Partial<RoomCalls>;
  model?: string;
}): RoomRecord {
  const run = o.run;
  const pack =
    o.pack ??
    (run?.pack && run.drops ? { pack: run.pack, drops: run.drops } : undefined);
  const last = run?.rounds
    .filter((r) => r.editor)
    .reduce<
      RoomRoundMarks | undefined
    >((b, r) => (!b || (r.mean ?? 0) > (b.mean ?? 0) ? r : b), undefined);
  return {
    arm: o.arm,
    mode: o.mode,
    ...(pack
      ? { pack: packSummary(pack.pack, pack.drops, pack.primaries) }
      : {}),
    ...(o.used ? { used: o.used } : {}),
    ...(run?.writing
      ? {
          angles: run.writing.angles.map((a) => ({
            question: a.question,
            answer: a.answer,
            solidity: a.solidity,
          })),
          point: run.writing.point,
        }
      : {}),
    ...(run?.drafts.length ? { drafts: run.drafts } : {}),
    ...(run?.pick ? { pick: run.pick } : {}),
    ...(run?.rounds.length ? { rounds: run.rounds } : {}),
    ...(last?.editor ? { editor_overall: last.editor.overall } : {}),
    ...(last?.viewer ? { viewer_overall: last.viewer.overall } : {}),
    ...(last?.mean !== undefined ? { mean: last.mean } : {}),
    ...(run?.final ? { counts: run.final.counts } : {}),
    ...(run?.kill ? { kill: run.kill } : {}),
    ...(run?.drop ? { drop: run.drop } : {}),
    ...(run ? { stop: run.stop } : {}),
    ...(o.fallback ? { fallback: o.fallback } : {}),
    ...(o.wrote !== undefined ? { wrote: o.wrote } : {}),
    ...(o.skipped?.length ? { skipped: o.skipped } : {}),
    calls: { ...noCalls(), ...(run?.calls ?? {}), ...(o.calls ?? {}) },
    ...(o.model ? { model: o.model } : {}),
  };
}

// ---------------------------------------------------------------- the weekly report

/** Shorts with retention data needed on each side before the report gives any verdict. */
export const ROOM_VERDICT_MIN = 20;

/**
 * The weekly report's room lines (pure): per side (the room wrote it; the control arm; the room's arm that fell back),
 * Shorts, average viewed and comments per 1,000 views; then, from ROOM_VERDICT_MIN a side, the difference in average
 * viewed, and the rank correlation of each critic's mark with average viewed (they correlate only about 0.49 with each
 * other, so the report shows which one tracks retention). `corr` is the report's own Spearman.
 */
export function roomLinesForReport(
  rows: Array<{
    arm?: RoomArm;
    wrote?: boolean;
    editor?: number;
    viewer?: number;
    views?: number | null;
    viewed_pct?: number;
    comments?: number;
  }>,
  corr: (xs: number[], ys: number[]) => number | undefined,
): string[] {
  const all = rows.filter((r) => r.arm);
  if (!all.length) return [];
  const viewedOf = (xs: typeof all) =>
    xs
      .map((r) => r.viewed_pct)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const avg = (xs: number[]) =>
    xs.reduce((a, v) => a + v, 0) / (xs.length || 1);
  const sum = (xs: typeof all, label: string) => {
    const viewed = viewedOf(xs);
    const views = xs.reduce((a, r) => a + (r.views ?? 0), 0);
    const comments = xs.reduce((a, r) => a + (r.comments ?? 0), 0);
    return `${label} ${xs.length} Shorts, average viewed ${viewed.length ? `${avg(viewed).toFixed(1)}%` : "n/a"}, comments per 1,000 views ${views > 0 ? ((comments / views) * 1000).toFixed(2) : "n/a"}`;
  };
  const wrote = all.filter((r) => r.arm === "room" && r.wrote);
  const control = all.filter((r) => r.arm === "control");
  const fell = all.filter((r) => r.arm === "room" && !r.wrote);
  const sides = [
    wrote.length ? sum(wrote, "room wrote") : "",
    control.length ? sum(control, "control arm") : "",
    fell.length ? sum(fell, "room arm, normal writer") : "",
  ].filter(Boolean);
  const vw = viewedOf(wrote);
  const vc = viewedOf(control);
  const verdict =
    vw.length >= ROOM_VERDICT_MIN && vc.length >= ROOM_VERDICT_MIN
      ? `Writers' room verdict: average viewed ${avg(vw).toFixed(1)}% where the room wrote against ${avg(vc).toFixed(1)}% in the control arm (${(avg(vw) - avg(vc)).toFixed(1)} points, ${vw.length} against ${vc.length} Shorts).`
      : `Writers' room verdict: ${vw.length} room and ${vc.length} control Shorts with retention data; no verdict before ${ROOM_VERDICT_MIN} a side.`;
  const marks = (key: "editor" | "viewer", label: string) => {
    const paired = wrote.filter(
      (r) =>
        typeof r[key] === "number" &&
        typeof r.viewed_pct === "number" &&
        Number.isFinite(r.viewed_pct),
    );
    if (paired.length < ROOM_VERDICT_MIN)
      return `${label}: ${paired.length} of ${ROOM_VERDICT_MIN} Shorts so far`;
    const rho = corr(
      paired.map((r) => r[key]!),
      paired.map((r) => r.viewed_pct!),
    );
    return `${label}: rank correlation ${rho === undefined ? "n/a" : rho.toFixed(2)} over ${paired.length} Shorts`;
  };
  return [
    `Writers' room (SCRIPT_ROOM), by side: ${sides.join("; ")}.`,
    verdict,
    `Writers' room marks against average viewed: ${marks("editor", "editor critic")}; ${marks("viewer", "viewer critic")}.`,
  ];
}
