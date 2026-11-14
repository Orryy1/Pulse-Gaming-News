// The breakout documentary picker (owner's growth plan, move 3, 1 Nov 2026). A faceless, AI-voiced channel with six
// videos (Desync) drew 2.55M views from one 28-minute documentary, "How Cyberpunk 2077 Saved Itself From Dying",
// because it put a famous game's collapse-and-comeback arc out right after the comeback news. Pulse's own study of
// small-channel hits found the same: one story at a turning point. Until now a model chose the documentary from two
// lists with the news headlines beside it; this scores every candidate on the five things that made the breakout,
// from the factory's own data, and takes the best, with no model call:
//   (a) fame: Steam reviews and players, how often the factory's news stream names it, and how Pulse's own videos
//       about it did against the channel's median;
//   (b) arc: a collapse, comeback, hidden reason or "what really happened" in the source material (the story's
//       angle and its Wikipedia overview);
//   (c) peg: a current news hook in the factory's stream (an update, an anniversary, a sequel, a remake, a
//       shutdown, layoffs, a sales milestone, a release);
//   (d) demand: YouTube's search page this week (src/docdemand.ts; unknown counts as neutral);
//   (e) freshness: not already a Pulse documentary, and how crowded the topic is on the big channels.
// Each pick logs its breakdown and posts one Discord line. DOC_BREAKOUT_PICKER turns it off.
// SEQUEL_WINNERS (src/sequels.ts) puts one thing ahead of the score: the long version of a Why Short that already did
// well on the channel, since proof from our own viewers beats a prediction. It is still never a repeat of a documentary.
import fs from "node:fs/promises";
import {
  DOC_FRANCHISES,
  DOC_STORIES,
  type DocTopic,
} from "./editorial/documentary.ts";
import {
  docDemandLookup,
  type Demand,
  type DemandLookup,
} from "./docdemand.ts";
import type { Db } from "./db.ts";
import {
  sequelWinners,
  winnerProof,
  type SequelNorm,
  type SequelWinner,
} from "./sequels.ts";
import { sameGame, type SteamApp, type SteamFacts } from "./assets/steam.ts";

export interface DocCandidate {
  kind: "story" | "franchise";
  /** Index into DOC_STORIES or DOC_FRANCHISES. */
  index: number;
  subject: string;
  wiki?: string;
  angle: string;
  /** Names the news and Pulse's own videos use for it ("GTA", "Phil Spencer"). */
  aliases: string[];
  /** A Steam search for its flagship game, for the fanbase figures; empty when it was never on Steam. */
  steam: string;
  /** A film from the ranked slate (FILM_SLATE_FILE). */
  slate?: { rank: number; title_idea: string };
  /** The long version of one of our own Shorts that did well: the Short, its question and its numbers. */
  sequel?: { short: string; title: string; question?: string; proof: string };
}

/** A Why Short that did well as a documentary candidate: its subject, with the Short's question as the story to tell. */
export function sequelCandidate(
  w: SequelWinner,
  norm: SequelNorm,
): DocCandidate {
  return {
    kind: "story",
    index: -1,
    subject: w.subject,
    wiki: w.subject,
    angle: w.question
      ? `${w.question} ${w.angle ?? ""}`.trim()
      : `The story behind our Short "${w.title}"`,
    aliases: [w.subject],
    steam: w.subject,
    sequel: {
      short: w.id,
      title: w.title,
      question: w.question,
      proof: winnerProof(w, norm),
    },
  };
}

// The names people use, where the subject line is not one (a story's subject is often a phrase).
const ALIASES: Record<string, string[]> = {
  "Grand Theft Auto VI": ["GTA 6", "GTA VI", "Grand Theft Auto 6"],
  "Grand Theft Auto": ["GTA"],
  "Xbox under Phil Spencer": ["Phil Spencer", "Xbox", "Activision Blizzard"],
  "Halo after Bungie": ["Halo", "343 Industries", "Halo Studios"],
  "Tango Gameworks": ["Hi-Fi Rush", "Tango Gameworks"],
  "Google Stadia": ["Stadia"],
  "The Wii U": ["Wii U"],
  "The Sega Dreamcast": ["Dreamcast"],
  "E.T. the Extra-Terrestrial": ["E.T.", "Atari landfill"],
  "Rockstar's Agent": ["Rockstar's Agent"],
  "The PlayStation 3 launch": ["PS3", "PlayStation 3"],
  "Final Fantasy XIV": [
    "FF14",
    "FFXIV",
    "Final Fantasy 14",
    "Final Fantasy XIV",
  ],
  "Star Wars Battlefront II": ["Battlefront 2", "Battlefront II"],
  "Mass Effect: Andromeda": ["Mass Effect Andromeda", "Andromeda"],
  "Diablo III": ["Diablo 3", "Diablo III"],
  "Red Dead": ["Red Dead Redemption", "RDR2"],
  "Dark Souls and the Soulsborne games": [
    "Dark Souls",
    "Elden Ring",
    "FromSoftware",
  ],
  "The Elder Scrolls": ["Elder Scrolls", "Skyrim"],
  "Call of Duty": ["CoD", "Call of Duty"],
};

// A flagship on Steam, for the fanbase figures (reviews and players right now).
const STEAM: Record<string, string> = {
  "Grand Theft Auto VI": "Grand Theft Auto V",
  "Grand Theft Auto": "Grand Theft Auto V",
  "Xbox under Phil Spencer": "",
  "Halo after Bungie": "Halo: The Master Chief Collection",
  "Tango Gameworks": "Hi-Fi Rush",
  "Google Stadia": "",
  "The Wii U": "",
  Kinect: "",
  "The Sega Dreamcast": "",
  "E.T. the Extra-Terrestrial": "",
  "Rockstar's Agent": "",
  "The PlayStation 3 launch": "",
  "Embracer Group": "",
  "Final Fantasy XIV": "Final Fantasy XIV Online",
  "Dark Souls and the Soulsborne games": "Dark Souls III",
  "Red Dead": "Red Dead Redemption 2",
  "The Elder Scrolls": "The Elder Scrolls V: Skyrim Special Edition",
};

/** What people would type for a story whose subject line is a phrase; anything else searches its subject. */
const DEMAND_QUERY: Record<string, string> = {
  "Grand Theft Auto VI": "GTA 6",
  "Xbox under Phil Spencer": "Xbox Phil Spencer",
  "Halo after Bungie": "Halo Infinite",
  "Tango Gameworks": "Hi-Fi Rush",
  "E.T. the Extra-Terrestrial": "E.T. Atari game",
  "Rockstar's Agent": "Rockstar Agent",
  "The PlayStation 3 launch": "PS3",
  "The Wii U": "Wii U",
  "The Sega Dreamcast": "Dreamcast",
  "Dark Souls and the Soulsborne games": "Dark Souls",
};

/**
 * Topics the big channels have already told well, from the 25 Oct 2026 study of top gaming documentaries and
 * the breakouts it found: 1 is crowded (several million-view documentaries), 0.5 covered once or twice.
 */
export const BIG_CHANNEL_COVERAGE: Record<string, number> = {
  "Cyberpunk 2077": 1,
  "No Man's Sky": 1,
  "Duke Nukem Forever": 1,
  "E.T. the Extra-Terrestrial": 1,
  "Grand Theft Auto": 1,
  Concord: 0.5,
  Anthem: 0.5,
  "Google Stadia": 0.5,
  Daikatana: 0.5,
  "The Sega Dreamcast": 0.5,
  "The Wii U": 0.5,
  "Star Wars Battlefront II": 0.5,
  "Final Fantasy XIV": 0.5,
  "Xbox under Phil Spencer": 0.5,
};

/** Every candidate: the single stories first (they broke out far more often), then the franchise histories. */
export function docCandidates(
  stories: ReadonlyArray<{
    subject: string;
    wiki: string;
    angle: string;
  }> = DOC_STORIES,
  franchises: readonly string[] = DOC_FRANCHISES,
): DocCandidate[] {
  const base = (s: string) => [s.replace(/\s*\(.*\)$/, "")];
  return [
    ...stories.map((s, index) => ({
      kind: "story" as const,
      index,
      subject: s.subject,
      wiki: s.wiki,
      angle: s.angle,
      aliases: [
        ...new Set([
          ...(ALIASES[s.subject] ?? base(s.subject)),
          ...base(s.wiki),
        ]),
      ],
      steam: STEAM[s.subject] ?? s.subject,
    })),
    ...franchises.map((f, index) => ({
      kind: "franchise" as const,
      index,
      subject: f,
      angle: `The ${f} story, game by game, told through its turning points`,
      aliases: ALIASES[f] ?? [f],
      steam: STEAM[f] ?? f,
    })),
  ];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when a headline names the candidate (any alias, as whole words, ignoring case). */
export function namesCandidate(
  text: string,
  c: Pick<DocCandidate, "aliases">,
): boolean {
  return c.aliases.some((a) => {
    const alias = a.trim();
    if (alias.length < 2) return false;
    // A short acronym ("GTA", "CoD") must match its own case; longer names ignore case.
    const flags = alias.length <= 4 ? "" : "i";
    return new RegExp(
      `(^|[^A-Za-z0-9])${escape(alias)}($|[^A-Za-z0-9])`,
      flags,
    ).test(text);
  });
}

// ---------------------------------------------------------------- (b) arc

const ARC: Record<"collapse" | "comeback" | "hidden", RegExp> = {
  collapse:
    /\b(collaps\w*|fail(ed|ure)?|flop(ped)?|disaster\w*|backlash|criticis\w*|controvers\w*|pulled from|removed from|refunds?|broken|buggy|bugs|outrage|boycott\w*|plummet\w*|crash(ed)?|shut (it )?down|shutdown|closed|closure|cancel(l)?ed|discontinued|layoffs?|laid off|worst|panned|lawsuit|delist\w*|apolog\w*|misleading|empty servers?|player counts? (fell|dropped))\b/gi,
  comeback:
    /\b(comeback|redemption|redeem\w*|recover\w*|turn(ed)? (it )?around|turnaround|saved|rescued|relaunch\w*|reboot\w*|revived?|revival|rebuilt|reborn|won (back|over)|2\.0|overhaul\w*|patch(ed|es)?|major update|expansion|returned|resurgen\w*|renaissance|second chance|positive reviews?|very positive|bought back|road back|way back|back from)\b/gi,
  hidden:
    /\b(never released|unreleased|cancel(l)?ed|leak(ed|s)?|secret\w*|hidden|lost|behind the scenes|development hell|delay(s|ed)?|troubled development|reportedly|what really|mystery|vapou?rware|scrapped|internal(ly)?|crunch)\b/gi,
};

/** How strong the story's arc is, 0-1, and which families it has: a collapse with a comeback scores highest. */
export function scoreArc(text: string): { score: number; families: string[] } {
  const hits = (re: RegExp) =>
    new Set((text.match(re) ?? []).map((m) => m.toLowerCase())).size;
  const c = Math.min(1, hits(ARC.collapse) / 3);
  const b = Math.min(1, hits(ARC.comeback) / 3);
  const h = Math.min(1, hits(ARC.hidden) / 3);
  const families = [
    ...(c >= 0.33 ? ["collapse"] : []),
    ...(b >= 0.33 ? ["comeback"] : []),
    ...(h >= 0.33 ? ["hidden"] : []),
  ];
  // The full arc (a fall and a return) is the breakout shape; a fall or a mystery alone is good, not best.
  const full = c >= 0.33 && b >= 0.33 ? 0.25 : 0;
  return {
    score:
      Math.round(Math.min(1, 0.3 * c + 0.3 * b + 0.15 * h + full) * 100) / 100,
    families,
  };
}

// ---------------------------------------------------------------- (c) peg

export const PEG_KINDS = [
  "sequel",
  "remake",
  "shutdown",
  "anniversary",
  "update",
  "sales",
  "layoffs",
  "release",
  "mention",
] as const;
export type PegKind = (typeof PEG_KINDS)[number];

const PEG: Array<[Exclude<PegKind, "mention">, RegExp, number]> = [
  [
    "sequel",
    /\b(sequel|announc\w*|reveal\w*|trailer|teaser|next game|successor|new game|in development)\b/i,
    1,
  ],
  [
    "remake",
    /\b(remake|remaster\w*|definitive edition|re-?release|port(ed)? to|reboot)\b/i,
    1,
  ],
  [
    "shutdown",
    /\b(shut(ting)? down|shutdown|end of service|servers? (go|going|will go) (down|offline)|delist\w*|closing|closure|sunset\w*)\b/i,
    1,
  ],
  [
    "anniversary",
    /\b(anniversary|\d+ years (ago|later|on|old)|turns \d+)\b/i,
    0.9,
  ],
  [
    "update",
    /\b(update|patch|expansion|dlc|season \d+|2\.0|overhaul|free weekend)\b/i,
    0.8,
  ],
  [
    "sales",
    /\b(sold|sales|million (copies|players|units)|milestone|record|best-selling|concurrent)\b/i,
    0.8,
  ],
  [
    "layoffs",
    /\b(layoffs?|laid off|job cuts|redundanc\w*|studio closure|restructur\w*)\b/i,
    0.7,
  ],
  [
    "release",
    /\b(release date|launch(es|ed)?|out now|delay(ed)?|pre-?order\w*|coming to)\b/i,
    0.7,
  ],
];

export interface Peg {
  kind: PegKind;
  headline: string;
  at: string;
}

/** The candidate's news pegs in the factory's own stream, strongest kind first, then newest. */
export function findPegs(
  c: Pick<DocCandidate, "aliases">,
  headlines: ReadonlyArray<{ headline: string; at: string }>,
): Peg[] {
  const out: Peg[] = [];
  for (const h of headlines) {
    if (!h.headline || !namesCandidate(h.headline, c)) continue;
    const hit = PEG.find(([, re]) => re.test(h.headline));
    out.push({
      kind: hit ? hit[0] : "mention",
      headline: h.headline,
      at: h.at,
    });
  }
  const weight = (k: PegKind) => PEG.find(([n]) => n === k)?.[2] ?? 0.3;
  return out.sort(
    (a, b) => weight(b.kind) - weight(a.kind) || b.at.localeCompare(a.at),
  );
}

/** The peg score, 0-1: the best peg's weight, fading over three weeks. */
export function scorePeg(pegs: Peg[], now: Date): number {
  let best = 0;
  for (const p of pegs) {
    const days = Math.max(0, (now.getTime() - Date.parse(p.at)) / 86_400_000);
    const w =
      (PEG.find(([n]) => n === p.kind)?.[2] ?? 0.3) *
      Math.max(0.2, 1 - days / 21);
    best = Math.max(best, w);
  }
  return Math.round(best * 100) / 100;
}

// ---------------------------------------------------------------- (a) fame, (e) freshness, scoring

export interface DocSignals {
  steamReviews?: number;
  steamPlayers?: number;
  /** Headlines naming it in the factory's stream over the last 60 days. */
  newsMentions: number;
  /** Median views of Pulse's own videos about it, and the channel's median, when there are any. */
  pulseViews?: number;
  channelMedian?: number;
  /** The story's angle, the line the documentary is built on. */
  arcText: string;
  /** Its Wikipedia overview, when fetched: evidence that the source material carries the arc. */
  overview?: string;
  pegs: Peg[];
  demand?: Demand;
  /** An earlier Pulse documentary on this exact subject (it is never picked again within three years). */
  coveredByPulse?: string;
  /** A Pulse long video on a related subject (an alias overlaps). */
  relatedPulse?: string;
}

/** Fame, 0-1: the Steam fanbase on a log scale, the news stream's attention and Pulse's own results with it. */
export function scoreFame(s: DocSignals): number {
  const parts: number[] = [];
  if (s.steamReviews) parts.push(Math.min(1, Math.log10(s.steamReviews) / 6));
  if (s.steamPlayers) parts.push(Math.min(1, Math.log10(s.steamPlayers) / 5));
  parts.push(Math.min(1, Math.log10(1 + s.newsMentions) / 2));
  if (s.pulseViews !== undefined && s.channelMedian)
    parts.push(
      Math.max(
        0,
        Math.min(
          1,
          0.5 +
            0.25 * Math.log2(Math.max(0.01, s.pulseViews / s.channelMedian)),
        ),
      ),
    );
  return (
    Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) / 100
  );
}

const DEMAND_SCORE = { none: 0.1, low: 0.45, medium: 0.75, high: 1 } as const;

/** Freshness, 0-1: crowded on the big channels or close to a recent Pulse long video scores lower. */
export function scoreFreshness(c: DocCandidate, s: DocSignals): number {
  const crowd = BIG_CHANNEL_COVERAGE[c.subject] ?? 0;
  // A recent hit on the search page that is itself a documentary on it: the topic is being covered right now.
  const docNow =
    s.demand?.top &&
    /\b(documentary|the story of|what happened|rise and fall|downfall|how .* (saved|died|fell))\b/i.test(
      s.demand.top.title,
    )
      ? 0.25
      : 0;
  const related = s.relatedPulse ? 0.3 : 0;
  return (
    Math.round(Math.max(0, 1 - 0.6 * crowd - docNow - related) * 100) / 100
  );
}

// ---------------------------------------------------------------- the shape (DOC_PICK_SINGLE_SUBJECT)

/**
 * How much a story is about one thing, 0-1. The audit's evidence (Nov 2026): the long videos that reach 100k from small
 * channels follow a person, a hunt or a failure (Sewsh's strongest player, CRG's full story of one game, Joeseppi's
 * cube); both of ours that surveyed a series held 11-12%. A person or a hunt in the angle raises it, a failure helps,
 * and a list of topics ("GTA Online's money, Red Dead 2, Dan Houser leaving, the leak and the delays") is a survey.
 */
export function scoreShape(angle: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const hit = (re: RegExp) => re.test(angle);
  let score = 0.4;
  if (
    hit(
      /\b(the (man|woman|teen(ager)?|kid|boy|girl|player|programmer|lawyer|hacker|designer|founder|creator)|one (man|woman|player|person|fan)|who)\b/i,
    )
  ) {
    score += 0.3;
    reasons.push("a person");
  }
  if (
    hit(
      /\b(hunt|hunted|mystery|solved?|tracked|caught|search(ed)? for|chased?|prize|winner|sting)\b/i,
    )
  ) {
    score += 0.25;
    reasons.push("a hunt");
  }
  if (
    hit(
      /\b(fail(ed|ure)?|flop(ped)?|collapse[ds]?|shut ?down|closed|cancel(l)?ed|pulled|lost|fired|sued|lawsuit|disbarred|disaster)\b/i,
    )
  ) {
    score += 0.15;
    reasons.push("a failure");
  }
  const listed = (angle.match(/,/g) ?? []).length + (/:/.test(angle) ? 1 : 0);
  if (listed >= 3) {
    score -= 0.35;
    reasons.push("a list of topics");
  }
  if (
    hit(
      /\b(game by game|history of|every game|the whole series|franchise|decade|the story of|lost years|years of)\b/i,
    )
  ) {
    score -= 0.25;
    reasons.push("a survey");
  }
  return {
    score: Math.round(Math.max(0, Math.min(1, score)) * 100) / 100,
    reasons,
  };
}

/** A film on the slate as a documentary candidate (the writer treats it as it does a sequel: its own wiki and angle). */
export interface SlateFilm {
  rank: number;
  subject: string;
  wiki: string;
  angle: string;
  title_idea: string;
  aliases?: string[];
  steam?: string;
}

export function slateCandidate(f: SlateFilm): DocCandidate {
  return {
    kind: "story",
    index: -1,
    subject: f.subject,
    wiki: f.wiki,
    angle: f.angle,
    aliases: f.aliases?.length ? f.aliases : [f.subject],
    steam: f.steam ?? "",
    slate: { rank: f.rank, title_idea: f.title_idea },
  };
}

/** How much each part counts; they sum to 1. */
export const DOC_PICK_WEIGHTS = {
  fame: 0.25,
  arc: 0.25,
  peg: 0.2,
  demand: 0.15,
  freshness: 0.15,
} as const;

/** The share of its score a topic with no arc at all keeps. */
export const ARC_FLOOR = 0.55;

export interface DocScore {
  candidate: DocCandidate;
  total: number;
  parts: {
    fame: number;
    arc: number;
    peg: number;
    demand: number;
    freshness: number;
  };
  /** Plain-English reasons, one per part, for the log and Discord. */
  notes: string[];
  excluded?: string;
}

const short = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `${Math.round(n / 1e3)}K`
      : String(n);

/** One candidate's score and its reasons. */
export function scoreCandidate(
  c: DocCandidate,
  s: DocSignals,
  now: Date,
): DocScore {
  // The angle carries most of it; a long article names a delay or a patch almost always, so it counts for less.
  const own = scoreArc(s.arcText);
  const src = s.overview ? scoreArc(s.overview) : undefined;
  const arc = {
    score: src
      ? Math.round((0.65 * own.score + 0.35 * src.score) * 100) / 100
      : own.score,
    families: [...new Set([...own.families, ...(src?.families ?? [])])],
  };
  const parts = {
    fame: scoreFame(s),
    arc: arc.score,
    peg: scorePeg(s.pegs, now),
    demand: s.demand ? DEMAND_SCORE[s.demand.level] : 0.5,
    freshness: scoreFreshness(c, s),
  };
  // The arc is the breakout's engine, not one factor among five: a famous, pegged, in-demand topic with no fall,
  // return or mystery to tell (a plain franchise survey) keeps at most 55% of its score; 0.6 of arc or more keeps all.
  const engine = ARC_FLOOR + (1 - ARC_FLOOR) * Math.min(1, parts.arc / 0.6);
  const total =
    Math.round(
      (Object.keys(parts) as Array<keyof typeof parts>).reduce(
        (n, k) => n + parts[k] * DOC_PICK_WEIGHTS[k],
        0,
      ) *
        engine *
        1000,
    ) / 1000;
  const fame = [
    s.steamReviews ? `${short(s.steamReviews)} Steam reviews` : "",
    s.steamPlayers ? `${short(s.steamPlayers)} playing now` : "",
    `${s.newsMentions} headlines in 60 days`,
    s.pulseViews !== undefined && s.channelMedian
      ? `Pulse videos on it ${short(s.pulseViews)} views against a ${short(s.channelMedian)} median`
      : "",
  ].filter(Boolean);
  const peg = s.pegs[0];
  const notes = [
    `fame ${parts.fame} (${fame.join(", ")})`,
    `arc ${parts.arc} (${arc.families.join(" + ") || "no clear arc"})`,
    `peg ${parts.peg}${peg ? ` (${peg.kind}: "${peg.headline.slice(0, 90)}")` : " (nothing in the news)"}`,
    `demand ${parts.demand} (${s.demand ? `${short(s.demand.views)} views on its top YouTube videos this week, ${s.demand.level}` : "unknown"})`,
    `freshness ${parts.freshness}${BIG_CHANNEL_COVERAGE[c.subject] ? " (already covered by big channels)" : ""}${s.relatedPulse ? ` (close to Pulse's "${s.relatedPulse}")` : ""}`,
  ];
  return {
    candidate: c,
    total,
    parts,
    notes,
    ...(s.coveredByPulse
      ? { excluded: `Pulse already made "${s.coveredByPulse}"` }
      : {}),
  };
}

/** Every candidate scored, best first; excluded ones last. */
export function rankDocCandidates(
  cands: DocCandidate[],
  signals: Map<string, DocSignals>,
  now: Date,
  o: { singleSubject?: boolean } = {},
): DocScore[] {
  return cands
    .map((c) => {
      const scored = scoreCandidate(
        c,
        signals.get(c.subject) ?? emptySignals(c),
        now,
      );
      if (!o.singleSubject) return scored;
      // A survey leaves the running; a story keeps 60% of its score at worst, all of it at a clear shape.
      if (c.kind === "franchise")
        return {
          ...scored,
          excluded: scored.excluded ?? "a series survey (DOC_PICK_SINGLE_SUBJECT)",
        };
      const shape = scoreShape(c.angle);
      return {
        ...scored,
        total:
          Math.round(
            scored.total * (0.6 + 0.4 * Math.min(1, shape.score / 0.7)) * 1000,
          ) / 1000,
        notes: [
          ...scored.notes,
          `shape ${shape.score} (${shape.reasons.join(" + ") || "no person, hunt or failure in the angle"})`,
        ],
      };
    })
    .sort(
      (a, b) =>
        Number(!!a.excluded) - Number(!!b.excluded) || b.total - a.total,
    );
}

export function emptySignals(c: Pick<DocCandidate, "angle">): DocSignals {
  return { newsMentions: 0, arcText: c.angle, pegs: [] };
}

/** The documentary topic the writer takes, from the winning score. */
export function topicFromScore(s: DocScore): DocTopic {
  const c = s.candidate;
  return {
    kind: c.kind,
    franchise_index: c.kind === "franchise" ? c.index : -1,
    story_index: c.kind === "story" ? c.index : -1,
    title_idea:
      c.sequel?.question ??
      (c.kind === "story" ? c.angle : `The ${c.subject} story`),
    angle: c.angle,
    reason: `Breakout pick ${s.total}: ${s.notes.join("; ")}`,
    franchise: c.subject,
    ...(c.wiki ? { wiki: c.wiki } : {}),
  };
}

/** The one Discord line a pick posts. */
export function docPickLine(win: DocScore, runnerUp?: DocScore): string {
  const p = win.parts;
  const peg = win.notes[2]!.replace(/^peg [\d.]+ ?/, "");
  return `Next documentary: ${win.candidate.subject} (score ${win.total}: fame ${p.fame}, arc ${p.arc}, news peg ${p.peg}, demand ${p.demand}, freshness ${p.freshness}). Peg ${peg}.${runnerUp ? ` Runner-up: ${runnerUp.candidate.subject} (${runnerUp.total}).` : ""}`;
}

// ---------------------------------------------------------------- gathering the signals

export interface PickDeps {
  /** Headlines from the factory's stream (news episodes and every story cluster seen), newest first. */
  headlines: ReadonlyArray<{ headline: string; at: string }>;
  /** Pulse's videos with their best view count (episodes with metrics). */
  videos: ReadonlyArray<{ headline: string; title: string; views: number }>;
  /** Subjects of earlier Pulse documentaries (three years) and the titles of Pulse's long videos. */
  coveredSubjects: readonly string[];
  longTitles: readonly string[];
  /** Steam fanbase for a search term; cached facts from earlier episodes are tried first by the caller. */
  steam?: (
    term: string,
  ) => Promise<{ reviews?: number; players?: number } | undefined>;
  /** A Wikipedia overview's text, for the arc. */
  overview?: (c: DocCandidate) => Promise<string | undefined>;
  demand?: DemandLookup;
  /** At most this many candidates get the slow lookups above. */
  lookups: number;
  now: Date;
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** The cheap signals for every candidate, then the slow lookups for the best `lookups` of them. */
export async function gatherDocSignals(
  cands: DocCandidate[],
  d: PickDeps,
): Promise<Map<string, DocSignals>> {
  const out = new Map<string, DocSignals>();
  const since = d.now.getTime() - 60 * 86_400_000;
  const recent = d.headlines.filter((h) => Date.parse(h.at) >= since);
  const pegWindow = d.headlines.filter(
    (h) => Date.parse(h.at) >= d.now.getTime() - 21 * 86_400_000,
  );
  const channelMedian = median(d.videos.map((v) => v.views));
  const covered = new Set(d.coveredSubjects.map((x) => x.toLowerCase().trim()));
  for (const c of cands) {
    const mine = d.videos.filter((v) =>
      namesCandidate(`${v.headline} ${v.title}`, c),
    );
    out.set(c.subject, {
      newsMentions: recent.filter((h) => namesCandidate(h.headline, c)).length,
      ...(mine.length
        ? { pulseViews: median(mine.map((v) => v.views)), channelMedian }
        : {}),
      arcText: c.angle,
      pegs: findPegs(c, pegWindow),
      ...(covered.has(c.subject.toLowerCase())
        ? { coveredByPulse: c.subject }
        : {}),
      ...((): { relatedPulse?: string } => {
        const t = d.longTitles.find((x) => namesCandidate(x, c));
        return t ? { relatedPulse: t } : {};
      })(),
    });
  }
  // The slow lookups go to the candidates that already look best.
  const first = rankDocCandidates(cands, out, d.now)
    .filter((s) => !s.excluded)
    .slice(0, Math.max(0, d.lookups));
  for (const { candidate: c } of first) {
    const s = out.get(c.subject)!;
    if (d.steam && c.steam) {
      const f = await d.steam(c.steam).catch(() => undefined);
      if (f?.reviews) s.steamReviews = f.reviews;
      if (f?.players) s.steamPlayers = f.players;
    }
    if (d.overview) {
      const text = await d.overview(c).catch(() => undefined);
      if (text) s.overview = text.slice(0, 6000);
    }
    if (d.demand) {
      const q = DEMAND_QUERY[c.subject] ?? c.subject;
      const dem = await d.demand(q).catch(() => undefined);
      if (dem) s.demand = dem;
    }
  }
  return out;
}

// ---------------------------------------------------------------- the factory's data

/** What the picker reads from the services bundle (src/pipeline.ts Services). */
export interface PickServices {
  db: Db;
  findGame(term: string): Promise<SteamApp | undefined>;
  gameFacts(app: SteamApp): Promise<SteamFacts>;
  research(
    title: string,
    fallbackQuery: string,
    maxChars?: number,
  ): Promise<{ text: string } | undefined>;
}

/** The pick's inputs from the database (read-only) and the slow lookups through the services. */
export async function pickDeps(
  s: PickServices,
  o: { now: Date; lookups: number; demand?: DemandLookup; offline?: boolean },
): Promise<PickDeps> {
  const { db } = s;
  const { now } = o;
  const headlines = [
    ...(await db.query<{ headline: string; at: string | Date }>(
      `SELECT headline, first_seen AS at FROM cluster_sightings WHERE last_seen > $1::timestamptz - interval '60 days' ORDER BY first_seen DESC LIMIT 4000`,
      [now],
    )),
    ...(await db.query<{ headline: string; at: string | Date }>(
      `SELECT story_json->>'headline' AS headline, created_at AS at FROM episodes WHERE lane IN ('news','news_breaking') AND created_at > $1::timestamptz - interval '60 days'`,
      [now],
    )),
  ]
    .filter((h) => h.headline)
    .map((h) => ({ headline: h.headline, at: new Date(h.at).toISOString() }));
  const videos = (
    await db.query<{
      headline: string | null;
      title: string | null;
      views: number;
    }>(
      `SELECT e.story_json->>'headline' AS headline, e.script_json->'youtube'->>'title' AS title, max(m.views) AS views FROM episodes e JOIN video_metrics m ON m.episode_id = e.id GROUP BY e.id, e.story_json, e.script_json`,
    )
  ).map((v) => ({
    headline: v.headline ?? "",
    title: v.title ?? "",
    views: Number(v.views) || 0,
  }));
  const coveredSubjects = (
    await db.query<{ franchise: string | null }>(
      `SELECT factcheck_json->'topic'->>'franchise' AS franchise FROM episodes WHERE lane = 'longform' AND factcheck_json->>'doc' = 'true' AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '3 years'`,
      [now],
    )
  )
    .map((r) => r.franchise ?? "")
    .filter(Boolean);
  const longTitles = (
    await db.query<{ title: string | null }>(
      `SELECT script_json->'youtube'->>'title' AS title FROM episodes WHERE lane = 'longform' AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '90 days'`,
      [now],
    )
  )
    .map((r) => r.title ?? "")
    .filter(Boolean);
  // Steam figures already on file from earlier episodes come first: no request for a game the factory knows.
  const known = (
    await db.query<{ f: SteamFacts | null }>(
      `SELECT assets_json->'steam'->'facts' AS f FROM episodes WHERE assets_json->'steam'->'facts' IS NOT NULL ORDER BY updated_at DESC LIMIT 500`,
    )
  )
    .map((r) => r.f)
    .filter((f): f is SteamFacts => !!f?.name);
  const steam = async (term: string) => {
    const hit = known.find(
      (f) => sameGame(term, f.name) && (f.totalReviews || f.currentPlayers),
    );
    if (hit) return { reviews: hit.totalReviews, players: hit.currentPlayers };
    if (o.offline) return undefined;
    const app = await s.findGame(term);
    if (!app) return undefined;
    const f = await s.gameFacts(app);
    return { reviews: f.totalReviews, players: f.currentPlayers };
  };
  return {
    headlines,
    videos,
    coveredSubjects,
    longTitles,
    steam,
    overview: o.offline
      ? undefined
      : async (c) =>
          (
            await s.research(
              c.wiki ?? c.subject,
              c.kind === "story" ? c.subject : `${c.subject} video game series`,
              6000,
            )
          )?.text,
    demand: o.demand,
    lookups: o.lookups,
    now,
  };
}

/** The whole pick: every candidate scored from the factory's data, best first. */
export async function rankBreakoutDocs(
  s: PickServices,
  o: {
    now: Date;
    lookups: number;
    demand?: DemandLookup;
    offline?: boolean;
    extra?: DocCandidate[];
    singleSubject?: boolean;
  },
): Promise<DocScore[]> {
  const cands = [...(o.extra ?? []), ...docCandidates()];
  const deps = await pickDeps(s, o);
  return rankDocCandidates(cands, await gatherDocSignals(cands, deps), o.now, {
    singleSubject: o.singleSubject,
  });
}

/** The slate file's films, best first; none when it is unset or unreadable. */
export async function readFilmSlate(file: string): Promise<SlateFilm[]> {
  if (!file) return [];
  try {
    const films = JSON.parse(await fs.readFile(file, "utf8")) as SlateFilm[];
    return [...films].sort((a, b) => a.rank - b.rank);
  } catch {
    return [];
  }
}

/**
 * The next documentary: the best candidate that Pulse has not made, its score breakdown for the event log and its
 * Discord line. Undefined when every candidate is excluded (the writer's pick then decides).
 */
export async function pickBreakoutDoc(
  s: PickServices & {
    cfg: {
      docPickLookups: number;
      sequelWinners?: boolean;
      docPickSingleSubject?: boolean;
      filmSlateFile?: string;
    };
    now(): Date;
  },
): Promise<
  { topic: DocTopic; detail: Record<string, unknown>; line: string } | undefined
> {
  const now = s.now();
  const found = s.cfg.sequelWinners
    ? await sequelWinners(s.db, now)
    : undefined;
  const extra = found
    ? found.winners
        .filter((w) => w.kind === "why" && w.subject)
        .map((w) => sequelCandidate(w, found.norm))
    : [];
  const slate = (await readFilmSlate(s.cfg.filmSlateFile ?? "")).map(slateCandidate);
  const ranked = await rankBreakoutDocs(s, {
    now,
    lookups: s.cfg.docPickLookups,
    demand: docDemandLookup(s, () => s.now()),
    extra: [...extra, ...slate],
    singleSubject: s.cfg.docPickSingleSubject,
  });
  const open = ranked.filter((x) => !x.excluded);
  // The strongest winner not yet made goes first, in the order sequelWinners ranked them.
  const sequel = extra
    .map((c) => open.find((x) => x.candidate === c))
    .find(Boolean);
  // Next the slate, in its own order: the evidence behind that order is broader than this score can see.
  const onSlate = slate
    .map((c) => open.find((x) => x.candidate === c))
    .find(Boolean);
  const win = sequel ?? onSlate ?? open[0];
  if (!win) return undefined;
  if (sequel) {
    const rest = open.filter((x) => x !== win);
    const made = win.candidate.sequel!;
    return {
      topic: {
        ...topicFromScore(win),
        reason: `The long version of our Short "${made.title}": ${made.proof}.`,
      },
      detail: {
        pick: win.candidate.subject,
        sequel: made,
        total: win.total,
        parts: win.parts,
        notes: win.notes,
        next: rest
          .slice(0, 4)
          .map((x) => ({ subject: x.candidate.subject, total: x.total })),
      },
      line: `Next documentary: ${win.candidate.subject}, the long version of our Short "${made.title}" (${made.proof}). It goes ahead of the score pick${rest[0] ? `, ${rest[0].candidate.subject} (${rest[0].total})` : ""}, which comes next.`,
    };
  }
  return {
    topic: win.candidate.slate
      ? { ...topicFromScore(win), title_idea: win.candidate.slate.title_idea }
      : topicFromScore(win),
    detail: {
      pick: win.candidate.subject,
      ...(win.candidate.slate ? { slate_rank: win.candidate.slate.rank } : {}),
      total: win.total,
      parts: win.parts,
      notes: win.notes,
      demand_check: docDemandLookup(s, () => now) ? "on" : "stub (unknown)",
      next: open
        .slice(1, 5)
        .map((x) => ({ subject: x.candidate.subject, total: x.total })),
    },
    line: docPickLine(win, open[1]),
  };
}
