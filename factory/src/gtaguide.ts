// GTA_GUIDES (upgrade queue item 58, owner, 26 Nov 2026: "really hammering amazing longforms"): post-launch GTA 6 guide
// lists in the shape GameSight grew on (17.4k subs, 97k-189k views a guide: "77 Things Confirmed", "30 Things You NEED
// To Do When GTA 6 Releases", "Don't Buy the Wrong GTA 6 Edition", "Beginner's Guide: 25 Things I Wish I Knew (No
// Spoilers)", "GTA 6 Won't Let You Do These 20 GTA 5 Things"). GTA VI came out on 19 Nov 2026, so practical guides are
// what people search for now.
//
// GTA_GUIDES (off by default) lets the guide take a share of the long slots (GTA_GUIDE_SHARE, default 0.5, decided per
// slot so the picker, which runs every few minutes, always gives the same answer). Everything else is the long
// ranking's machinery: the episode is a "longform" lane episode whose script is ranking-shaped (one rank beat per
// item, every item the same game), so the render's footage gather, LONG_MIN_MOVING_SHARE, the picture cap and named
// art, the chapter index and the release gate all apply unchanged. What this file adds, all pure:
//   - the topic picker: six guide kinds, scored by YouTube demand (the Data API lookups, 7-day cache), the owner's
//     stream asks list and the comments inside it; a kind made in the last 30 days never comes back;
//   - the list shape: a number plus a promise of completeness in the title, built here from the item count; item 1
//     delivered in the video's first line; every claim labelled confirmed, reported or rumour, from the fact pack;
//   - the owner's play as a source ("in my playthrough"), but only what his recordings show: the stream index's tags
//     of his own recordings, the HUD reader's measured facts and the stream asks the miner settled on his streams;
//   - the thumbnail words (2-3 huge words: a warning or a number) and the arm decision;
//   - the verdict's pass mark (gtaGuideVerdict).
// The story is never in it: the GTA VI spoiler window (src/sceneindex/spoilers.ts) holds the story until 18 Dec, for
// stream and playthrough footage alike, and a guide never sets the "spoilers ahead" warning that would open it.

import { createHash } from "node:crypto";
import { thumbWordProblems, titleEchoProblems } from "./qa/thumbrule.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BeatVisual, Script } from "./editorial/schema.ts";
import type { AnyMoment } from "./editorial/longform.ts";
import { sentencesOf } from "./editorial/longform.ts";
import { rehookProblems } from "./editorial/rehooks.ts";
import {
  stockSegueProblems,
  voiceProblems,
  withSignOff,
  writingProblems,
} from "./editorial/voice.ts";

export const GTA_GAME = "Grand Theft Auto VI";
export const GTA_SHORT = "GTA 6";
/** The launch day: no guide is picked before it. */
export const GTA_LAUNCH = "2026-11-19";
/** A guide kind made inside this many days is not picked again. */
export const GUIDE_REPEAT_DAYS = 30;
/** The platforms on every item card. */
export const GTA_PLATFORMS = "PS5, Xbox Series X|S";

export type GuideKindKey =
  | "wish-i-knew"
  | "cant-do-anymore"
  | "mistakes"
  | "early-money"
  | "hidden-features"
  | "which-edition";

export interface GuideKind {
  key: GuideKindKey;
  /** The owner's name for it, in the Discord line. */
  name: string;
  /** The title from the item count: the number and a promise of completeness, the game first or second. */
  title: (n: number) => string;
  /** The thumbnail's fallback words when the writer's do not pass: big line, small line. */
  thumb: (n: number) => { big: string; small: string };
  /** What the viewer can do after watching, for the writer. */
  angle: string;
  /** The YouTube searches that measure its demand. */
  queries: string[];
  /** Words in a stream ask (question or claim) that make it this kind's business. */
  askWords: RegExp;
  /** The fewest and most items. */
  items: [number, number];
  /** The pinned comment's question: the viewer's own tip, which feeds the stream asks list and the next guide. */
  question: string;
}

export const GUIDE_KINDS: readonly GuideKind[] = [
  {
    key: "wish-i-knew",
    name: "Things I wish I knew (no spoilers)",
    title: (n) => `GTA 6: ${n} Things I Wish I Knew (No Spoilers, Full List)`,
    thumb: () => ({ big: "START HERE", small: "NO SPOILERS" }),
    angle:
      "The things a new player should know in their first hours of GTA 6 that the game does not spell out: systems, settings, habits and money. Each item is one practical thing to know or do, and why.",
    queries: [
      "gta 6 things i wish i knew",
      "gta 6 tips no spoilers",
      "gta 6 beginner guide",
    ],
    askWords:
      /\b(how (do|does|can)|can you|is there|does it|do you|tips?|beginner|start|first hours?|settings?)\b/i,
    items: [12, 20],
    question:
      "What's the one thing you wish you'd known before your first night in Leonida? No story spoilers, please. The best tips go into the next guide.",
  },
  {
    key: "cant-do-anymore",
    name: "Things you can't do any more vs GTA 5",
    title: (n) => `GTA 6 Won't Let You Do These ${n} GTA 5 Things (Full List)`,
    thumb: () => ({ big: "NOT ANYMORE", small: "VS GTA 5" }),
    angle:
      "What GTA 5 players will try on day one that GTA 6 no longer allows, or makes work differently: each item names the GTA 5 habit, what GTA 6 does instead and what to do about it.",
    queries: [
      "gta 6 vs gta 5 differences",
      "things you can't do in gta 6",
      "gta 6 removed features",
    ],
    askWords:
      /\b(gta ?(5|v)|any ?more|removed|no longer|still|can you still|first[- ]person)\b/i,
    items: [12, 20],
    question:
      "Which GTA 5 habit did you try first in GTA 6, and did it still work? No story spoilers, please.",
  },
  {
    key: "mistakes",
    name: "Don't make these mistakes",
    title: (n) => `GTA 6: ${n} Beginner Mistakes to Avoid (The Complete List)`,
    thumb: () => ({ big: "DON'T DO THIS", small: "" }),
    angle:
      "The mistakes that cost new GTA 6 players money, time, vehicles or progress, each with what happens and what to do instead.",
    queries: [
      "gta 6 mistakes to avoid",
      "gta 6 don't do this",
      "gta 6 beginner mistakes",
    ],
    askWords:
      /\b(lose|lost|wasted|busted|fine|mistakes?|don't|avoid|wanted|police|cops|crash|fuel|run out)\b/i,
    items: [12, 20],
    question:
      "What's the mistake that cost you most in your first hours? No story spoilers, please. The best ones go into the next guide.",
  },
  {
    key: "early-money",
    name: "Best ways to make money early",
    title: (n) => `GTA 6 Early Money: The ${n} Best Ways (Complete Guide)`,
    thumb: () => ({ big: "EASY MONEY", small: "DAY 1" }),
    angle:
      "The ways to build money in the first hours of GTA 6, what each one pays and costs where the facts or the owner's own play give a figure, and what is worth buying first.",
    queries: [
      "gta 6 money guide",
      "gta 6 make money fast",
      "gta 6 best way to make money",
    ],
    askWords:
      /\b(money|cash|pays?|paid|earn|rob|robbery|heist|sell|buy|price|\$\d)/i,
    items: [10, 18],
    question:
      "What's the best early money you've found so far? No story spoilers, please. The best ones go into the next guide.",
  },
  {
    key: "hidden-features",
    name: "Hidden features",
    title: (n) =>
      `GTA 6: ${n} Hidden Features Nobody Told You About (Full List)`,
    thumb: (n) => ({ big: `${n} SECRETS`, small: "NO SPOILERS" }),
    angle:
      "Features of GTA 6 that are easy to miss in the first hours: apps, radio, wildlife, weather, the phone, details of the world. Each item says where to find it and why it is worth a look.",
    queries: [
      "gta 6 hidden features",
      "gta 6 details you missed",
      "gta 6 secret features",
    ],
    askWords:
      /\b(hidden|secret|app|radio|animals?|wildlife|storms?|weather|phone|details?|inside|buildings?|log)\b/i,
    items: [12, 20],
    question:
      "What's the best hidden detail you've found in Leonida so far? No story spoilers, please.",
  },
  {
    key: "which-edition",
    name: "Which edition",
    title: (n) =>
      `Don't Buy the Wrong GTA 6 Edition: ${n} Differences (Full Guide)`,
    thumb: () => ({ big: "NOT THIS ONE", small: "" }),
    angle:
      "Every confirmed difference between the GTA 6 editions and versions people are choosing between (price, what each includes, the pre-order and GTA+ extras, boxed versus digital, PS5 versus Xbox), so the viewer buys the right one.",
    queries: [
      "gta 6 which edition to buy",
      "gta 6 standard vs ultimate",
      "gta 6 editions explained",
    ],
    askWords:
      /\b(edition|ultimate|standard|price|\$\d|pre-?order|gta\+|disc|boxed|digital|ps5 pro|xbox)\b/i,
    items: [8, 12],
    question:
      "Which edition did you pick, and would you pick it again?",
  },
];

export const kindOf = (key: string): GuideKind | undefined =>
  GUIDE_KINDS.find((k) => k.key === key);

// ---- The share of long slots ------------------------------------------------------------------------------------------

/**
 * Whether this long slot goes to a GTA guide (pure). Off, or a share of 0: never, so nothing below runs and the long
 * lane is exactly as before. The draw is keyed on the slot itself, so every tick that sees the same slot agrees.
 */
export function gtaGuideSlot(
  cfg: { gtaGuides?: boolean; gtaGuideShare?: number },
  slot: Date,
): boolean {
  if (!cfg.gtaGuides) return false;
  const share = cfg.gtaGuideShare ?? 0;
  if (!(share > 0)) return false;
  if (share >= 1) return true;
  const n = createHash("sha1")
    .update(`gta-guide:${slot.toISOString()}`)
    .digest()
    .readUInt16BE(0);
  return n / 65536 < share;
}

// ---- The topic picker ---------------------------------------------------------------------------------------------------

/** A stream ask as the picker reads it (src/streamasks/asks.ts StreamAsk). */
export interface AskLike {
  question: string;
  claim?: string;
  status: string;
  rumour?: boolean;
  spoiler?: boolean;
  mentionCount?: number;
  score?: number;
  mentions?: Array<{ source: string }>;
  verdict?: {
    result: string;
    confidence: number;
    vodId: string;
    recordedOn: string;
    reason: string;
  };
}

export interface GuidePick {
  kind: GuideKind;
  score: number;
  /** Why it won, for the event and the Discord line. */
  why: string[];
  /** The viewers' questions it should answer (never facts by themselves). */
  asks: string[];
  demandViews: number;
}

export interface GuidePickInput {
  now: Date;
  /** Guide kinds already made (not failed), with when: inside GUIDE_REPEAT_DAYS they are left out. */
  made: Array<{ kind: string; at: string | Date }>;
  /** Views of the recent videos each kind's searches found (a kind with no reading is absent). */
  demand: Map<string, number>;
  asks: AskLike[];
}

const DAY = 86_400_000;

/** The guide topic for a slot (pure): the best-scoring kind not made in 30 days; undefined before launch or when all were. */
export function pickGuideTopic(input: GuidePickInput): GuidePick | undefined {
  if (input.now.getTime() < Date.parse(`${GTA_LAUNCH}T00:00:00Z`))
    return undefined;
  const recent = new Set(
    input.made
      .filter(
        (m) =>
          input.now.getTime() - new Date(m.at).getTime() <
          GUIDE_REPEAT_DAYS * DAY,
      )
      .map((m) => m.kind),
  );
  const open = input.asks.filter(
    (a) =>
      !a.spoiler &&
      (a.status === "open" ||
        a.status === "proved" ||
        a.status === "disproved"),
  );
  const scored = GUIDE_KINDS.filter((k) => !recent.has(k.key)).map(
    (k, order) => {
      const views = input.demand.get(k.key) ?? 0;
      const mine = open.filter((a) =>
        k.askWords.test(`${a.question} ${a.claim ?? ""}`),
      );
      const demandScore = views > 0 ? Math.log10(views + 1) * 10 : 0;
      const askScore = Math.min(
        12,
        mine.reduce((n, a) => n + 1 + Math.min(5, a.mentionCount ?? 1) / 5, 0),
      );
      const comments = mine.reduce(
        (n, a) =>
          n + (a.mentions ?? []).filter((m) => m.source === "comments").length,
        0,
      );
      const commentScore = Math.min(6, comments * 2);
      const why = [
        views > 0
          ? `${Math.round(views).toLocaleString("en-GB")} views on recent videos for its searches`
          : "no demand reading",
        `${mine.length} viewer question${mine.length === 1 ? "" : "s"} on the stream asks list`,
        ...(comments ? [`${comments} from our comments`] : []),
      ];
      const asks = [...mine]
        .sort(
          (a, b) =>
            (b.score ?? 0) - (a.score ?? 0) ||
            (b.mentionCount ?? 0) - (a.mentionCount ?? 0),
        )
        .slice(0, 8)
        .map((a) => `${a.question}${a.rumour ? " (rests on a rumour)" : ""}`);
      // A small tie-break in list order, so equal kinds always resolve the same way.
      return {
        kind: k,
        score: demandScore + askScore + commentScore - order * 0.01,
        why,
        asks,
        demandViews: views,
      };
    },
  );
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

/** Demand per kind from the Data API's search rows (pure): views of the videos that name GTA 6 and the kind's own words. */
export function guideDemand(
  rows: Map<string, Array<{ views: number; title: string }> | Error>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const k of GUIDE_KINDS) {
    let best = -1;
    for (const q of k.queries) {
      const r = rows.get(q);
      if (!r || r instanceof Error) continue;
      const v = r
        // Only videos about this kind of guide: a search for "which edition" also returns the trailers' millions.
        .filter((x) => /\bgta\s*(6|vi)\b|grand theft auto vi/i.test(x.title) && k.askWords.test(x.title))
        .slice(0, 10)
        .reduce((n, x) => n + (x.views || 0), 0);
      best = Math.max(best, v);
    }
    if (best >= 0) out.set(k.key, best);
  }
  return out;
}

/** Every query the picker asks the demand lookups (one call for all of them). */
// One search a kind (a Data API search costs 100 quota units), the kind's first; read at most once a week (the pipeline
// keeps the reading for GUIDE_DEMAND_DAYS).
export const GUIDE_QUERIES: string[] = GUIDE_KINDS.map((k) => k.queries[0]!);
/** How long a demand reading is kept before the searches run again. */
export const GUIDE_DEMAND_DAYS = 7;

// ---- The topic as the episode carries it --------------------------------------------------------------------------------

/** factcheck_json.gta_guide: what the writer and the render read. */
export interface GtaGuideTopic {
  kind: GuideKindKey;
  /** Set at selection: why this kind, the viewers' questions, the demand. */
  why: string[];
  asks: string[];
  demandViews: number;
  slot_at: string;
}

/** True for a GTA guide episode (its factcheck carries the topic). */
export function isGtaGuide(factcheck: unknown): boolean {
  const g = (factcheck as { gta_guide?: { kind?: string } } | null | undefined)
    ?.gta_guide;
  return Boolean(g && kindOf(String(g.kind ?? "")));
}

/** What the script carries: the kind, the count, the thumbnail words and the labels per item. */
export interface GtaGuideMeta {
  kind: GuideKindKey;
  items: number;
  thumb: { big: string; small: string };
  labels: Array<{ number: number; label: ClaimLabel; play: boolean }>;
  /** The pinned comment's question (the kind's own), carried so the SEO module needs no import of this one. */
  question?: string;
}

// ---- The fact pack and the owner's play ---------------------------------------------------------------------------------

/** The fact files beside package.json, used when GTA_GUIDE_FACTS is empty. */
export const DEFAULT_GUIDE_FACTS = [
  "guide_facts_gta6.md",
  "guide_facts_gta6_before_you_play.md",
  "guide_facts_gta6_leonida.md",
].map((f) => path.join(path.dirname(fileURLToPath(import.meta.url)), "..", f));

/**
 * The fact pack (pure on the texts): each file's confirmed part and its reported part, kept apart and headed so the
 * writer and the fact-check see which label a line allows. Leaks and datamines never appear in these files.
 */
export function factPackText(files: Array<{ name: string; text: string }>): {
  confirmed: string;
  reported: string;
} {
  const confirmed: string[] = [];
  const reported: string[] = [];
  for (const f of files) {
    const [conf, ...rest] = f.text.split(/^##\s+Reported[^\n]*$/im);
    const c = (conf ?? "").replace(/^#[^\n]*\n/, "").trim();
    if (c) confirmed.push(`(${path.basename(f.name)})\n${c}`);
    const r = rest.join("\n").trim();
    if (r) reported.push(`(${path.basename(f.name)})\n${r}`);
  }
  return { confirmed: confirmed.join("\n\n"), reported: reported.join("\n\n") };
}

/** Reads the fact files; a file that won't open is left out and named. */
export function readFactPack(files: readonly string[]): {
  confirmed: string;
  reported: string;
  missed: string[];
} {
  const got: Array<{ name: string; text: string }> = [];
  const missed: string[] = [];
  for (const f of files) {
    try {
      got.push({ name: f, text: fs.readFileSync(f, "utf8") });
    } catch {
      missed.push(f);
    }
  }
  return { ...factPackText(got), missed };
}

/** One recording of the game, with its tags, as the evidence builder reads it (src/vodindex/tags.ts VodTags). */
export interface PlayRecording {
  vodId: string;
  title: string;
  recordedOn?: string;
  /** The owner's own channel: only his play counts as "my playthrough". */
  own: boolean;
  stretches: Array<{
    place?: string;
    activity?: string;
    vehicle?: string;
    brands?: string[];
    story?: boolean;
    menu?: boolean;
  }>;
}

export interface PlayHudFact {
  vodId: string;
  recordedOn?: string;
  text: string;
  confidence: number;
}

const top = (xs: string[], n: number): string[] => {
  const c = new Map<string, number>();
  for (const x of xs.map((s) => s.trim()).filter(Boolean))
    c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([x, k]) => (k > 1 ? `${x} (${k})` : x));
};

/**
 * What the owner's own play shows, as source lines (pure). Only his own recordings (a permitted channel's are footage,
 * never "my playthrough"), never a story stretch or a menu, the HUD reader's facts it was at least 80% sure of, and the
 * stream asks the miner settled on his streams with at least 0.8 confidence. Empty when there is nothing: then the
 * writer may not say "in my playthrough" at all.
 */
export function playEvidence(o: {
  recordings: PlayRecording[];
  hudFacts: PlayHudFact[];
  asks: AskLike[];
  max?: number;
}): string[] {
  const own = o.recordings.filter((r) => r.own);
  const ownIds = new Set(own.map((r) => r.vodId));
  const known = new Set(o.recordings.map((r) => r.vodId));
  const lines: string[] = [];
  for (const r of own) {
    const s = r.stretches.filter((x) => !x.story && !x.menu);
    if (!s.length) continue;
    const parts = [
      `doing: ${top(
        s.map((x) => x.activity ?? ""),
        8,
      ).join("; ")}`,
      `places: ${top(
        s.map((x) => x.place ?? ""),
        8,
      ).join("; ")}`,
      `vehicles: ${top(
        s.map((x) => x.vehicle ?? ""),
        5,
      ).join("; ")}`,
      `on screen: ${top(
        s.flatMap((x) => x.brands ?? []),
        6,
      ).join("; ")}`,
    ].filter((p) => !/:\s*$/.test(p));
    lines.push(
      `My stream "${r.title.replace(/["\r\n]/g, " ").trim()}"${r.recordedOn ? ` (${r.recordedOn})` : ""} shows me ${parts.join(" | ")}`,
    );
  }
  for (const f of o.hudFacts) {
    // A HUD reading of a recording known to be someone else's is not my play.
    if (f.confidence < 0.8 || (known.has(f.vodId) && !ownIds.has(f.vodId)))
      continue;
    lines.push(
      `Measured off my own footage${f.recordedOn ? ` (${f.recordedOn})` : ""}: ${f.text}`,
    );
  }
  for (const a of o.asks) {
    const v = a.verdict;
    if (
      !v ||
      a.spoiler ||
      v.confidence < 0.8 ||
      (known.has(v.vodId) && !ownIds.has(v.vodId))
    )
      continue;
    lines.push(
      `Checked on my stream (${v.recordedOn}), "${a.question}": ${v.reason.replace(/\s+/g, " ").trim()}`,
    );
  }
  return lines.slice(0, o.max ?? 40);
}

// ---- The list shape --------------------------------------------------------------------------------------------------

export type ClaimLabel = "confirmed" | "reported" | "rumour";
export type ClaimSource = "fact pack" | "my playthrough";

export interface GuideItem {
  number: number;
  /** The item as a short on-screen line ("Don't swim in the swamps at night"). */
  title: string;
  label: ClaimLabel;
  basis: ClaimSource;
  chip: string;
  narration: string;
  footage: { want: string; keywords: string[] };
  claims: Array<{ claim: string; label: ClaimLabel; source: ClaimSource }>;
  moments: AnyMoment[];
}

export interface GuideDraft {
  kind: GuideKindKey;
  intro: { narration: string; on_screen: string };
  items: GuideItem[];
  outro: { narration: string; on_screen: string };
  thumb_words: string;
  description: string;
  tags: string[];
}

export const GUIDE_ITEM_WORDS: [number, number] = [80, 190];
export const GUIDE_INTRO_WORDS: [number, number] = [30, 110];
export const GUIDE_OUTRO_WORDS: [number, number] = [40, 140];
export const GUIDE_WORDS: [number, number] = [1500, 3500];

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const STOP = new Set(
  "the a an and or but to of in on at for with your you it its is are be this that these those from into when what how why do does don't dont not never always can can't cant will won't one two first every all any some more most just only get got gta grand theft auto game games player players number".split(
    " ",
  ),
);
const content = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9$' ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));

/** Hedges a reported or rumoured claim needs in its own item's narration. */
export const HEDGE =
  /\b(reportedly|reported|rumou?rs?|rumou?red|unconfirmed|not confirmed|allegedly|according to|sources say|said to be|hasn't confirmed|has not confirmed|not officially)\b/i;
/** First-hand words: allowed only with evidence and a "my playthrough" claim. */
export const FIRST_HAND =
  /\b(in my (playthrough|game|play|save|stream)|i (tested|tried|found|checked|measured|played|saw|lost|made|earned|bought|drove|got)|when i (played|tried|tested)|on my stream)\b/i;

/** The title from the count (pure): the kind's template, so a guide always has a number and a completeness promise. */
export function guideTitleFor(kind: GuideKind, n: number): string {
  return kind.title(n).replace(/\s+/g, " ").trim();
}

/** A completeness promise in a title (pure). */
export const COMPLETE = /\b(full list|complete|full guide|everything)\b/i;

/** The thumbnail words (pure): the writer's 2-3 words when they pass, else the kind's own; never more than 3 big words. */
export function guideThumbWords(
  kind: GuideKind,
  n: number,
  writer: string,
  /** The title it must not repeat (the thumbnail rule, src/qa/thumbrule.ts); the kind's own title when absent. */
  title = guideTitleFor(kind, n),
): { big: string; small: string } {
  const fallback = kind.thumb(n);
  const w = writer
    .toUpperCase()
    .replace(/[^A-Z0-9'$+ /]/g, " ")
    .split("/")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const big = w[0] ?? "";
  const bigWords = big.split(" ").filter(Boolean);
  // A number in the big line must be the guide's own count: "25 THINGS" on a 16-item guide is a broken promise.
  const nums = big.match(/\d+/g) ?? [];
  if (
    bigWords.length < 2 ||
    bigWords.length > 3 ||
    big.length > 16 ||
    nums.some((x) => Number(x) !== n) ||
    thumbWordProblems(big).length > 0 ||
    titleEchoProblems(big, title).length > 0
  )
    return fallback;
  const small = (w[1] ?? "").split(" ").filter(Boolean).slice(0, 3).join(" ");
  return { big, small: small.length <= 16 ? small : "" };
}

/**
 * What breaks the list shape (pure); empty when it holds. The style rules every long video shares (voice, writing,
 * re-hooks) ride along; the facts are the fact-check's job.
 */
export function guideProblems(
  d: GuideDraft,
  ctx: { kind: GuideKind; evidence: readonly string[]; introMax?: number },
): string[] {
  const p: string[] = [];
  const [lo, hi] = ctx.kind.items;
  const n = d.items.length;
  if (n < lo || n > hi)
    p.push(`There are ${n} items; this guide has ${lo}-${hi}.`);
  if (d.items.some((x, i) => x.number !== i + 1))
    p.push("Items must be numbered 1..N in the order they are spoken.");
  const first = sentencesOf(d.intro.narration)[0] ?? "";
  const one = d.items[0];
  if (one) {
    const want = content(one.title);
    const got = new Set(content(first));
    if (!want.some((w) => got.has(w)))
      p.push(
        `The video's first sentence must deliver item 1 ("${one.title}") itself: "${first}" does not. No greeting, no premise first.`,
      );
  }
  if (
    /\b(welcome|pulse gaming|today we|in this video|hey|what's up)\b/i.test(
      first,
    )
  )
    p.push(
      `The first sentence opens with a greeting or the channel ("${first}"); it is item 1.`,
    );
  const iw = words(d.intro.narration);
  const introHi = Math.min(
    GUIDE_INTRO_WORDS[1],
    ctx.introMax ?? GUIDE_INTRO_WORDS[1],
  );
  if (iw < GUIDE_INTRO_WORDS[0] || iw > introHi)
    p.push(
      `The intro is ${iw} words; it must be ${GUIDE_INTRO_WORDS[0]}-${introHi}.`,
    );
  const ow = words(d.outro.narration);
  if (ow < GUIDE_OUTRO_WORDS[0] || ow > GUIDE_OUTRO_WORDS[1])
    p.push(
      `The outro is ${ow} words; it must be ${GUIDE_OUTRO_WORDS[0]}-${GUIDE_OUTRO_WORDS[1]}.`,
    );
  for (const x of d.items) {
    const tag = `Item ${x.number} ("${x.title}")`;
    const w = words(x.narration);
    if (w < GUIDE_ITEM_WORDS[0] || w > GUIDE_ITEM_WORDS[1])
      p.push(
        `${tag} has ${w} words; it must be ${GUIDE_ITEM_WORDS[0]}-${GUIDE_ITEM_WORDS[1]}.`,
      );
    if (!x.claims.length)
      p.push(
        `${tag} lists no claims; every item names its claims with a label.`,
      );
    if (
      x.claims.some((c) => c.label !== "confirmed") &&
      !HEDGE.test(x.narration)
    )
      p.push(
        `${tag} carries a reported or rumoured claim but never says so aloud ("reportedly", "a rumour says"); label it in the narration.`,
      );
    const play =
      x.claims.some((c) => c.source === "my playthrough") ||
      x.basis === "my playthrough";
    if (FIRST_HAND.test(x.narration) && !play)
      p.push(
        `${tag} speaks first-hand ("${x.narration.match(FIRST_HAND)?.[0]}") without a "my playthrough" claim behind it.`,
      );
    if (play && !ctx.evidence.length)
      p.push(
        `${tag} rests on "my playthrough", but there is no play evidence this time: use the fact pack only.`,
      );
    const s = sentencesOf(x.narration).length;
    if (x.moments.length !== s)
      p.push(`${tag} has ${s} sentences but ${x.moments.length} moments.`);
    if (!x.chip.trim() || words(x.chip) > 4)
      p.push(`${tag}: the chip must be 1-4 words.`);
  }
  if (FIRST_HAND.test(d.intro.narration) && !ctx.evidence.length)
    p.push(
      `The intro speaks first-hand ("${d.intro.narration.match(FIRST_HAND)?.[0]}") with no play evidence.`,
    );
  const spoken = guideNarration(d);
  const total = words(spoken);
  if (total < GUIDE_WORDS[0] || total > GUIDE_WORDS[1])
    p.push(
      `Spoken word count is ${total}; it must be ${GUIDE_WORDS[0]}-${GUIDE_WORDS[1]}.`,
    );
  const openings = d.items.map((x) =>
    x.narration.toLowerCase().split(/\s+/).slice(0, 3).join(" "),
  );
  if (new Set(openings).size < openings.length)
    p.push("Two items open with the same words; vary the openings.");
  p.push(...voiceProblems(spoken));
  p.push(...writingProblems(spoken, { long: true }));
  p.push(...stockSegueProblems(spoken));
  p.push(
    ...rehookProblems([
      d.intro.narration,
      ...d.items.map((x) => x.narration),
      d.outro.narration,
    ]),
  );
  if (
    /let me know in the comments|like and subscribe|without further ado|smash that/i.test(
      spoken,
    )
  )
    p.push("Banned phrase.");
  return p;
}

/** The whole narration in spoken order (pure). */
export function guideNarration(
  d: Pick<GuideDraft, "intro" | "items" | "outro">,
): string {
  return [
    d.intro.narration,
    ...d.items.map((x) => x.narration),
    d.outro.narration,
  ].join(" ");
}

/** The item card's second line: the label, and whose play it rests on. */
export function itemLabel(x: Pick<GuideItem, "label" | "claims">): ClaimLabel {
  const all = [x.label, ...(x.claims ?? []).map((c) => c.label)];
  return all.includes("rumour") ? "rumour" : all.includes("reported") ? "reported" : "confirmed";
}

export function labelLine(x: Pick<GuideItem, "label" | "basis">): string {
  const l =
    x.label === "confirmed"
      ? "CONFIRMED"
      : x.label === "reported"
        ? "REPORTED"
        : "RUMOUR";
  return x.basis === "my playthrough" ? `${l} · MY PLAYTHROUGH` : l;
}

/**
 * The common Script shape (pure), ranking-shaped so every long-ranking device applies: one rank beat per item in spoken
 * order (1 first), the card's number is the item's, every entry is GTA VI. The entries' internal ranks run N..1 because
 * the render pairs beats with entries sorted from the highest rank down; the cards and the chapter index show 1..N.
 */
export function guideToScript(d: GuideDraft, kind: GuideKind): Script {
  const n = d.items.length;
  const title = guideTitleFor(kind, n);
  const thumb = guideThumbWords(kind, n, d.thumb_words);
  const beats = d.items.map((x) => ({
    narration: x.narration,
    footage: x.footage as Script["beats"][number]["footage"],
    visual: {
      kind: "rank",
      primary: x.title,
      secondary: x.chip,
      value_a: x.number,
      items: ["", labelLine({ label: itemLabel(x), basis: x.basis })],
    } satisfies BeatVisual,
  }));
  const meta: GtaGuideMeta = {
    kind: kind.key,
    question: kind.question,
    items: n,
    thumb,
    labels: d.items.map((x) => ({
      number: x.number,
      label: itemLabel(x),
      play:
        x.basis === "my playthrough" ||
        x.claims.some((c) => c.source === "my playthrough"),
    })),
  };
  return {
    story_type: "other",
    game_title: GTA_GAME,
    steam_search_term: "",
    headline: title,
    hook: d.intro.narration,
    hook_footage: { want: "gameplay", keywords: [GTA_GAME] },
    beats,
    pulse_take: {
      label: "WRAP-UP",
      narration: withSignOff(d.outro.narration),
      on_screen: d.outro.on_screen,
    },
    loop_line: "",
    is_rumour: false,
    attribution:
      "Sources: Rockstar Games, Take-Two, platform stores, Pulse's own play",
    youtube: {
      title,
      title_variants: [],
      description: d.description,
      tags: d.tags,
      thumb_text: [thumb.big, thumb.small].filter(Boolean).join(" / "),
    },
    claims: d.items.flatMap((x) =>
      x.claims.map((c) => ({
        claim: `[${c.label}] ${c.claim}`,
        source_url: c.source,
      })),
    ),
    entries: d.items.map((x) => ({
      moments: x.moments,
      rank: n + 1 - x.number,
      game_title: GTA_GAME,
      steam_search_term: "",
      year: 2026,
      platforms: GTA_PLATFORMS,
    })),
    evergreen_format: "ranking",
    runtime: "long",
    criterion: kind.name,
    kicker: d.intro.on_screen,
    gta_guide: meta,
  } as Script;
}

// ---- The verdict --------------------------------------------------------------------------------------------------------

/** One published long video's 7-day result. */
export interface GuideResult {
  arm: "guide" | "ranking";
  views7d: number;
  /** Thumbnail click-through, 0-1 (from Test & compare or the analytics), when known. */
  ctr?: number;
}

/**
 * The GTA guide's pass mark (pure). It passes when, with at least 6 published videos per arm, the guides' median 7-day
 * views AND median CTR (where both arms have 6 CTR readings) both beat the long ranking's medians. Until then
 * "waiting".
 */
export function gtaGuideVerdict(
  results: GuideResult[],
  perArm = 6,
): {
  verdict: "waiting" | "pass" | "fail";
  guide: { n: number; views: number; ctr?: number };
  ranking: { n: number; views: number; ctr?: number };
} {
  const med = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const side = (arm: GuideResult["arm"]) => {
    const r = results.filter((x) => x.arm === arm);
    const c = r
      .map((x) => x.ctr)
      .filter((x): x is number => typeof x === "number");
    return {
      n: r.length,
      views: med(r.map((x) => x.views7d)),
      ctrN: c.length,
      ctr: c.length ? med(c) : undefined,
    };
  };
  const g = side("guide");
  const k = side("ranking");
  const out = (verdict: "waiting" | "pass" | "fail") => ({
    verdict,
    guide: {
      n: g.n,
      views: g.views,
      ...(g.ctr !== undefined ? { ctr: g.ctr } : {}),
    },
    ranking: {
      n: k.n,
      views: k.views,
      ...(k.ctr !== undefined ? { ctr: k.ctr } : {}),
    },
  });
  if (g.n < perArm || k.n < perArm) return out("waiting");
  const ctrKnown = g.ctrN >= perArm && k.ctrN >= perArm;
  const pass = g.views > k.views && (!ctrKnown || (g.ctr ?? 0) > (k.ctr ?? 0));
  return out(pass ? "pass" : "fail");
}

/**
 * The plan's own misses (pure), sent back once before any item is paid for: the count, item 1 in the first sentence,
 * and "my playthrough" items when there is no play evidence.
 */
export function guidePlanProblems(
  plan: { intro: { narration: string }; items: Array<{ title: string; basis: string }> },
  kind: GuideKind,
  evidence: readonly string[],
): string[] {
  const p: string[] = [];
  const [lo, hi] = kind.items;
  if (plan.items.length < lo || plan.items.length > hi)
    p.push(`There are ${plan.items.length} items; this guide has ${lo}-${hi}.`);
  const first = sentencesOf(plan.intro.narration)[0] ?? "";
  const one = plan.items[0];
  if (one) {
    const got = new Set(content(first));
    if (!content(one.title).some((w) => got.has(w)))
      p.push(`The first sentence must deliver item 1 ("${one.title}") itself: "${first}" does not.`);
  }
  if (!evidence.length && plan.items.some((x) => x.basis === "my playthrough"))
    p.push('There is no play evidence this time: no item may rest on "my playthrough"; use the fact pack.');
  return p;
}
