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
      "The things a new player should know in their first hours of GTA 6 that the game does not spell out: systems, controls, in-game settings, habits and money. Each item is one practical thing to do, with exactly how or where, and what it gets you (money, time, a way out of trouble, a vehicle or item kept).",
    queries: [
      "gta 6 things i wish i knew",
      "gta 6 tips no spoilers",
      "gta 6 beginner guide",
    ],
    askWords:
      /\b(how (do|does|can)|can you|is there|does it|do you|tips?|beginner|start|first hours?|settings?)\b/i,
    items: [8, 20],
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
    items: [8, 20],
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
    items: [8, 20],
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
    items: [7, 18],
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
      "Things GTA 6 can do that the game never explains and most players miss: a phone app's less obvious function, a control or input, a system rule, a shop or service, a place that is useful for something. Each item says exactly what to do or where to go, and what you get for it. Never scenery to look at, never a headline everyone saw in the trailers, never a console or controller feature.",
    queries: [
      "gta 6 hidden features",
      "gta 6 details you missed",
      "gta 6 secret features",
    ],
    askWords:
      /\b(hidden|secret|app|radio|animals?|wildlife|storms?|weather|phone|details?|inside|buildings?|log)\b/i,
    items: [7, 15],
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
    items: [6, 12],
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
  /** Each item's line, what to do and what you get, in spoken order (for the proof report and the record). */
  list?: Array<{ number: number; title: string; how: string; payoff: string }>;
  /** The pinned comment's question (the kind's own), carried so the SEO module needs no import of this one. */
  question?: string;
}

// ---- The fact pack and the owner's play ---------------------------------------------------------------------------------

/** The fact files beside package.json, used when GTA_GUIDE_FACTS is empty. */
export const DEFAULT_GUIDE_FACTS = [
  "guide_facts_gta6.md",
  "guide_facts_gta6_before_you_play.md",
  "guide_facts_gta6_leonida.md",
  // Post-launch mechanics (27 Nov 2026): systems, controls, economy and settings from the released game, sectioned
  // by guide kind ("### Hidden features (hidden-features)"), so each guide reads only its own kind's sections.
  "guide_facts_gta6_mechanics.md",
].map((f) => path.join(path.dirname(fileURLToPath(import.meta.url)), "..", f));

/**
 * The fact pack (pure on the texts): each file's confirmed part and its reported part, kept apart and headed so the
 * writer and the fact-check see which label a line allows. Leaks and datamines never appear in these files.
 */
export function factPackText(
  files: Array<{ name: string; text: string }>,
  /** The guide's kind: a "### ... (other-kind)" section is left out, so every call carries only what this guide can use. */
  kind?: string,
): {
  confirmed: string;
  reported: string;
} {
  const confirmed: string[] = [];
  const reported: string[] = [];
  for (const f of files) {
    // An "## Owner's play" section is notes about the owner's footage, never a fact: his play reaches the writer only
    // as play evidence (playEvidence), so a pack line can't be said first-hand or as "reportedly".
    const own = f.text.replace(/^##\s+Owner'?s play[^\n]*\n[\s\S]*?(?=^##\s|(?![\s\S]))/im, "");
    const text = kind ? kindSections(own, kind) : own;
    const [conf, ...rest] = text.split(/^##\s+Reported[^\n]*$/im);
    const c = (conf ?? "").replace(/^#[^\n]*\n/, "").trim();
    if (c) confirmed.push(`(${path.basename(f.name)})\n${c}`);
    const r = rest.join("\n").trim();
    if (r) reported.push(`(${path.basename(f.name)})\n${r}`);
  }
  return { confirmed: confirmed.join("\n\n"), reported: reported.join("\n\n") };
}

/** The text without the sections headed for another guide kind ("### Mistakes to avoid (mistakes)") (pure). */
export function kindSections(text: string, kind: string): string {
  const keys = new Set(GUIDE_KINDS.map((k) => k.key as string));
  const out: string[] = [];
  let skip = false;
  for (const line of text.split("\n")) {
    const h3 = line.match(/^###\s.*\(([a-z-]+)\)\s*$/);
    if (h3) skip = keys.has(h3[1]!) && h3[1] !== kind;
    else if (/^#{1,3}\s/.test(line)) skip = false;
    if (!skip) out.push(line);
  }
  return out.join("\n");
}

/** Reads the fact files; a file that won't open is left out and named. */
export function readFactPack(files: readonly string[], kind?: string): {
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
  return { ...factPackText(got, kind), missed };
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
  /** What to do: the button, menu, app, place or step (the plan's). */
  how?: string;
  /** What you get for it: money, time, a way out, an item kept (the plan's). */
  payoff?: string;
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

// Up to 240 words an item: a guide may have as few as 7 items rather than padding, and each then carries its how-to.
export const GUIDE_ITEM_WORDS: [number, number] = [80, 240];
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

// ---- Item quality (owner, 26 Nov 2026, first proof: "radio on foot", "look for alligators", "DualSense haptics") --------
// The bar is GameSight's guides: every item a concrete, non-obvious mechanic, setting, trick or system, with how or
// where, and the payoff said. Sightseeing, trailer headlines and console features are not guide items.

const NUM_WORDS =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(
    " ",
  );
/** A spoken or written count as a number (pure): "12" or "twelve"; NaN otherwise. */
export function countValue(s: string): number {
  const w = s.trim().toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  const i = NUM_WORDS.indexOf(w);
  return i >= 0 ? i : Number.NaN;
}
const NUM = `\\d{1,2}|${NUM_WORDS.join("|")}`;
const LIST_NOUN = "things|features|tips|mistakes|ways|differences|secrets|items|habits|details|tricks|changes";

/** A console, controller or display feature: never a guide item, except in the edition guide. */
export const HARDWARE =
  /\b(haptics?|dualsense|adaptive triggers?|tempest|3d audio|spatial audio|ray[- ]?trac\w*|frame ?rates?|\d+ ?fps|resolution|4k (mode|output|resolution|tv|display)|hdr|performance mode|quality mode|ps5 pro|pro enhanced|load(ing)? times?|ssd|controller speaker|controller light ?bar|quick resume|activity cards?)\b/i;
/** A title that only points at something to look at or listen to. */
export const SIGHTSEEING =
  /^(go and )?(look (for|at|out for|around|under|up)|notice|admire|enjoy|take in|listen (to|for|in)|watch (for|the)|see|spot|explore|check out|appreciate|soak up|stop and|feel|hear|visit)\b/i;
/** What every trailer and preview already showed: a guide item about it needs a real mechanic and gain. */
export const TRAILER_FAMOUS =
  /\b(alligators?|gators?|flamingos?|hurricanes?|tropical storms?|storms?|weather|art deco|neon|beach(es)?|swamps?|wetlands|everglades|jet ?skis?|underwater|ruins|radio|music|songs?|podcasts?|social media|jason and lucia|two (playable )?(protagonists|leads|characters)|dual protagonists|vice city('s)? streets|skyline|sunsets?|scenery|wildlife|forest)\b/i;
/** A gain the viewer can use. */
export const TANGIBLE =
  /(\$\d|\b(money|cash|dollars?|free|unlocks?|faster|quicker|saves?|saving|avoid|escape|lose (the )?(cops|police|heat)|wanted|heals?|health|armou?r|ammo|weapons?|guns?|discounts?|cheaper|xp|skills?|stamina|fast travel|reward|collectibles?|achievement|trophy|stash|loot|safe ?house|shortcut|spawns?|refund|cops|police|rob(s|bed|bing|bery|beries)?|tills?|payouts?|pays?|profit|earn\w*|sell\w*|fuel|gas|repairs?|stranded|minutes|insurance|keep (your|the) (car|cash|money|weapons?|vehicle|loot|gear))\b)/i;
/** A payoff that is a mood, not a gain. */
export const VAGUE_PAYOFF =
  /^(it'?s |a |more )?(fun|cool(?! down)|nice|neat|beautiful|pretty|immersi\w*|atmospher\w*|a change of scenery|change of scenery|something different|variety|looks? (great|good|amazing|stunning)|worth (a|the) (look|visit)|a nice touch|smart little feature|realism|realistic|relaxing|chill)\b/i;

const wordCount = (t: string | undefined) =>
  (t ?? "").trim().split(/\s+/).filter(Boolean).length;

/**
 * What makes one item too thin for the bar (pure): no how, no payoff, a mood for a payoff, a console feature (outside
 * the edition guide), or sightseeing and trailer headlines with nothing to gain.
 */
export function itemQualityProblems(
  x: { title: string; how?: string; payoff?: string; notes?: string; chip?: string },
  kind: Pick<GuideKind, "key">,
  tag = `"${x.title}"`,
): string[] {
  const p: string[] = [];
  const all = `${x.title} ${x.how ?? ""} ${x.payoff ?? ""} ${x.notes ?? ""} ${x.chip ?? ""}`;
  if (wordCount(x.how) < 3)
    p.push(`${tag} does not say what to do: give the button, menu, app, place or step (how).`);
  if (wordCount(x.payoff) < 3)
    p.push(`${tag} does not say what you get for it (payoff): money, time, a way out, an item kept.`);
  else if (VAGUE_PAYOFF.test((x.payoff ?? "").trim()) && !TANGIBLE.test(x.payoff ?? ""))
    p.push(`${tag}: "${x.payoff}" is a mood, not a payoff; name what the player gains or drop the item.`);
  if (kind.key !== "which-edition" && HARDWARE.test(all))
    p.push(`${tag} is a console, controller or display feature, not something in the game: drop it.`);
  if (
    (SIGHTSEEING.test(x.title.trim()) || TRAILER_FAMOUS.test(x.title)) &&
    !TANGIBLE.test(`${x.how ?? ""} ${x.payoff ?? ""}`)
  )
    p.push(
      `${tag} is sightseeing or a trailer headline everyone has seen; replace it with a concrete, non-obvious mechanic, trick or system with a real gain.`,
    );
  return p;
}

// Only a count that claims the whole list: a determiner first ("these 12 features", "the first of twelve things", "all 8
// tips"), at most two words before the noun ("these 12 GTA 6 features"). "The two items that matter most", "the first
// three tips" and "Grand Theft Auto 6 features" are not the list's count.
const countRe = () =>
  new RegExp(
    `\\b(these|all|of|our)(\\s+)(${NUM})(\\s+(?:[\\w'-]+\\s+){0,2}?(?:${LIST_NOUN})\\b)`,
    "gi",
  );

/** The smallest list any guide kind has: "these two things" in an outro is never the list's count. */
const LEAST_COUNT = 6;

/** Counts said in a text that claim the whole list (pure). */
export function countsSaid(text: string): number[] {
  return [...text.matchAll(countRe())]
    .map((m) => countValue(m[3]!))
    .filter((v) => Number.isFinite(v) && v >= LEAST_COUNT);
}

/** The count in a text changed from one number to another, digits as digits and words as words (pure). */
export function withCount(text: string, from: number, to: number): string {
  return text.replace(
    countRe(),
    (m: string, det: string, gap: string, n: string, rest: string) => {
      if (countValue(n) !== from) return m;
      const word = /^\d+$/.test(n) ? String(to) : (NUM_WORDS[to] ?? String(to));
      return `${det}${gap}${/^[A-Z]/.test(n) ? word[0]!.toUpperCase() + word.slice(1) : word}${rest}`;
    },
  );
}

/** The number an item's opening line says it is ("Number 3", "No. 3"), when it says one (pure). */
export function spokenItemNumber(sentence: string): number | undefined {
  const m = sentence.match(
    new RegExp(`^\\W*(?:\\[[a-z ]+\\]\\s*)?(?:(?:and|so|okay|right),?\\s+)?(?:number|item|tip)\\s+(${NUM})\\b`, "i"),
  );
  const v = m ? countValue(m[1]!) : Number.NaN;
  return Number.isFinite(v) ? v : undefined;
}

/** Ranking talk the long ranking's voice brings, which a guide never uses (pure regex). */
export const RANKING_TALK =
  /\b(i'?m ranking|ranked|my ranking|this ranking|ranking (them|these|it|everyday|by)|hardest call|least (sure|certain) (about|of)|i'?d put [^.]{0,60}?\b(ahead of|above|below|at the top)|top of (this|my) list|number one spot)\b/i;

/** The writer talking about its sources instead of the game (27 Nov proof: "The recordings provide no reproducible escape methods"). */
export const META_TALK =
  /\b(fact pack|play evidence|my recordings|the (sources?|material) (provides?|do not|don'?t|does not|doesn'?t|lacks?|shows? no|holds? no|gives? no)|(the )?sources (are|is) (thin|incomplete))/i;
/**
 * Source talk that also reads as game talk ("the evidence doesn't lead back to you", "the recording doesn't save"):
 * checked only in the intro and the description, where the game's own evidence and recordings never come up.
 */
export const META_FRAMING =
  /\b(the (recordings?|brief|evidence) (provides?|do not|don'?t|does not|doesn'?t|lacks?|shows? no|holds? no|gives? no)|recordings (are|is) (thin|incomplete)|no (usable|reproducible) (escape|methods?|instructions?|details?|items?|information))\b/i;

/** Em dashes and spaced en dashes, said as the pause they are: a comma, so a sentence count never changes (pure). */
export function scrubDashes(t: string): string {
  if (!/—|\s–\s/.test(t)) return t;
  return t
    .replace(/[ \t]*—[ \t]*|[ \t]+–[ \t]+/g, ", ")
    .replace(/,\s*([,.!?;:])/g, "$1")
    .replace(/(^|\n), /g, "$1")
    .replace(/,[ \t]*$/gm, "")
    .replace(/[ \t]+$/gm, "");
}

/** Every string in a value with its dashes scrubbed (pure). */
export function scrubAll<T>(v: T): T {
  if (typeof v === "string") return scrubDashes(v) as T;
  if (Array.isArray(v)) return v.map((x) => scrubAll(x)) as T;
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, scrubAll(x)]),
    ) as T;
  return v;
}

const OWN_NUMBER = new RegExp(`^(?:no\\.?|number|item|tip|#)\\s*(?:${NUM})$`, "i");
const SOURCE_CARD =
  /\b(stream footage|on (my |the )?stream|from (my|the) (stream|vod|playthrough)|my playthrough|my stream|recorded (on|live)|vod)\b/i;
const DATE_MATTERS =
  /\b(release\w*|launch\w*|update\w*|patch\w*|until|ends?|ending|starts?|expires?|deadline|event|available|arriv\w*|season|limited|unlock\w*|returns?)\b/i;

/**
 * A guide moment's graphic, kept only when it tells the viewer something (pure): never the item's own number (the
 * card says it), never where the footage came from ("Stream footage"), and a date only when the date is the point.
 */
export function guideGraphicKept(
  g: { kind: string; primary?: string; secondary?: string; items?: string[] } | undefined,
  sentence: string,
): boolean {
  if (!g || g.kind === "none") return false;
  const text = `${g.primary ?? ""} ${g.secondary ?? ""} ${(g.items ?? []).join(" ")}`;
  if (OWN_NUMBER.test((g.primary ?? "").trim())) return false;
  if (SOURCE_CARD.test(text)) return false;
  if (g.kind === "date" && !DATE_MATTERS.test(sentence)) return false;
  return true;
}

/** A card that only says what isn't known ("Not established", "Not announced", "No performance verdict"). */
export const EMPTY_CARD =
  /^(not (established|announced|confirmed|known|yet known|listed|stated)|unknown|unconfirmed|tbc|tba|to be (confirmed|announced)|no (\w+ )?(verdict|answer|word|details?|information))\b/i;

/** Pulse never cites Wikipedia on air (owner, 13 Nov 2026): a card naming it is dropped, in every long video. */
export const WIKIPEDIA_CARD = /\bwikipedia\b/i;

/** A guide's still is shown once (no reused stills; the which-edition proof showed one car still three times in a minute). */
export const GUIDE_STILL_MAX_SHOWS = 1;

const plain = (t: string | undefined) => (t ?? "").toLowerCase().replace(/[^a-z0-9$£€%]+/g, " ").trim();
// A card's title is its key; an untitled card keys on its second line and rows, so two different untitled compares both stay.
const cardKey = (g: { kind: string; primary?: string; secondary?: string; items?: string[] }) =>
  plain(g.primary) ? `${g.kind}|${plain(g.primary)}` : `${g.kind}||${plain(g.secondary)}|${cardItems(g)}`;
const cardItems = (g: { items?: string[] }) =>
  (g.items ?? []).map((x) => x.toLowerCase().replace(/[^a-z0-9$£€%]+/g, " ").trim()).sort().join("|");

/**
 * The moments with every graphic that carries nothing taken off (pure): the item's own number, a footage credit, a
 * date that isn't the point, a card that only says what isn't known, a Wikipedia credit, and a card the item already
 * showed (same kind and title, or the same rows).
 */
export function cleanGuideMoments(narration: string, moments: AnyMoment[]): AnyMoment[] {
  const s = sentencesOf(narration);
  const seen = new Set<string>();
  const none = { kind: "none", primary: "", secondary: "", items: [] };
  return moments.map((m, i) => {
    const g = (m as { graphic?: { kind: string; primary?: string; secondary?: string; items?: string[]; evidence?: { credit?: string } } }).graphic;
    if (!g || g.kind === "none") return m;
    const text = `${g.primary ?? ""} ${g.secondary ?? ""} ${(g.items ?? []).join(" ")} ${g.evidence?.credit ?? ""}`;
    const rows = cardItems(g);
    const dup = seen.has(cardKey(g)) || (rows.length > 0 && seen.has(`rows|${rows}`));
    const keep =
      guideGraphicKept(g, s[i] ?? "") &&
      !EMPTY_CARD.test((g.primary ?? "").trim()) &&
      !WIKIPEDIA_CARD.test(text) &&
      !dup;
    if (!keep) return { ...m, graphic: none } as AnyMoment;
    seen.add(cardKey(g));
    if (rows) seen.add(`rows|${rows}`);
    return m;
  });
}

/**
 * The plan with its thin items dropped down to the kind's minimum, never below it (the first thin items in spoken order
 * fill any gap); item 1 always stays (the intro delivers it). Every count in the intro, outro, description and
 * thumbnail words follows the new number, so the title, the thumbnail and the voice agree (pure).
 */
export function dropThinItems<
  P extends {
    intro: { narration: string; on_screen: string };
    outro?: { narration: string; on_screen: string };
    description?: string;
    thumb_words?: string;
    items: Array<{ title: string; how?: string; payoff?: string; notes?: string; chip?: string }>;
  },
>(plan: P, kind: GuideKind): { plan: P; dropped: string[] } {
  const thin = plan.items.map((x, i) => i > 0 && itemQualityProblems(x, kind).length > 0);
  const good = thin.filter((t) => !t).length;
  // Down to the minimum, never below: the first thin items in spoken order fill any gap.
  let spare = Math.max(0, kind.items[0] - good);
  const keep = plan.items.filter((_, i) => !thin[i] || spare-- > 0);
  if (keep.length === plan.items.length) return { plan, dropped: [] };
  const dropped = plan.items.filter((x) => !keep.includes(x)).map((x) => x.title);
  const from = plan.items.length;
  const to = keep.length;
  const count = (t: string) => withCount(t, from, to);
  return {
    plan: {
      ...plan,
      intro: {
        narration: count(plan.intro.narration),
        on_screen: count(plan.intro.on_screen),
      },
      ...(plan.outro
        ? { outro: { narration: count(plan.outro.narration), on_screen: count(plan.outro.on_screen) } }
        : {}),
      ...(plan.description !== undefined ? { description: count(plan.description) } : {}),
      ...(plan.thumb_words !== undefined
        ? { thumb_words: plan.thumb_words.replace(new RegExp(`\\b${from}\\b`, "g"), String(to)) }
        : {}),
      items: keep,
    },
    dropped,
  };
}

/** Item quality across a finished draft (pure): recorded as style warnings, never a reason for a whole rewrite. */
export function guideQualityWarnings(d: Pick<GuideDraft, "items">, kind: GuideKind): string[] {
  return d.items.flatMap((x) => itemQualityProblems(x, kind, `Item ${x.number} ("${x.title}")`));
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
    const said = spokenItemNumber(sentencesOf(x.narration)[0] ?? "");
    if (said !== undefined && said !== x.number)
      p.push(
        `${tag} says it is number ${said}; on screen it is number ${x.number}. Items count up from 1 in the order spoken.`,
      );
  }
  for (const c of countsSaid(
    `${d.intro.narration} ${d.outro.narration} ${d.description}`,
  ))
    if (c !== n)
      p.push(
        `The intro, outro or description says ${c} items; the list has ${n}. Say ${n}.`,
      );
  const ranked = [
    d.intro.narration,
    ...d.items.map((x) => x.narration),
    d.outro.narration,
  ]
    .join(" ")
    .match(RANKING_TALK);
  if (ranked)
    p.push(
      `"${ranked[0]}" is ranking talk; a guide is a list in the order spoken, never a ranking.`,
    );
  const meta =
    guideNarration(d).concat(" ", d.description).match(META_TALK) ??
    `${d.intro.narration} ${d.description}`.match(META_FRAMING);
  if (meta)
    p.push(`"${meta[0]}" talks about the sources; the viewer hears only the game.`);
  if (/\u2014/.test(JSON.stringify(d)))
    p.push("An em dash is in the text; the channel never uses them.");
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
export function guideToScript(draft: GuideDraft, kind: GuideKind): Script {
  // No em dash reaches the screen or the voice, whatever the writer or a repair left (the humaniser that strips them
  // runs on Shorts and documentary chapters only), and no graphic that carries nothing.
  const scrubbed = scrubAll(draft);
  const d: GuideDraft = {
    ...scrubbed,
    items: scrubbed.items.map((x) => ({
      ...x,
      moments: cleanGuideMoments(x.narration, x.moments),
    })),
  };
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
    list: d.items.map((x) => ({
      number: x.number,
      title: x.title,
      how: x.how ?? "",
      payoff: x.payoff ?? "",
    })),
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
  plan: {
    intro: { narration: string };
    description?: string;
    items: Array<{
      title: string;
      basis: string;
      how?: string;
      payoff?: string;
      notes?: string;
      chip?: string;
    }>;
  },
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
  plan.items.forEach((x, i) =>
    p.push(...itemQualityProblems(x, kind, `Item ${i + 1} ("${x.title}")`)),
  );
  for (const c of countsSaid(plan.intro.narration))
    if (c !== plan.items.length)
      p.push(`The intro says ${c} items; the plan has ${plan.items.length}.`);
  const framing = `${plan.intro.narration} ${plan.description ?? ""}`;
  const meta = framing.match(META_TALK) ?? framing.match(META_FRAMING);
  if (meta)
    p.push(`"${meta[0]}" talks about the sources; the viewer hears only the game. Leave thin parts out.`);
  const ranked = plan.intro.narration.match(RANKING_TALK);
  if (ranked)
    p.push(
      `"${ranked[0]}" is ranking talk; a guide is a list in the order spoken, never a ranking.`,
    );
  return p;
}
