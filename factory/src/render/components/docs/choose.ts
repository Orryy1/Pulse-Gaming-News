// Archive-style documents for the sentences nothing filmed can show (owner, 31 Oct 2026: "the full toolkit top
// documentary creators use"). About one documentary sentence in five describes a meeting, a deal, a decision, a
// schedule or a shipment; the channels we study cut to a recreated memo, contract or production schedule on a
// desk, push in on the line that matters and mark it as the narrator says it. This module decides, for one bare
// sentence, whether a document suits it, which one, and what goes on the page; ./DocumentShot.tsx draws it.
//
// Honesty rules (the filler brief): the page shows only words the sentence or the chapter's facts give (the
// chapter's game as the PROJECT line) plus fixed generic labels ("MEMO", "INTERNAL", "SCHEDULE"); everything else
// on the page is a placeholder bar; the letterhead is Pulse's own, never a real company's; no names in From/To
// fields and no invented dates or figures; every page is tagged ILLUSTRATION on screen. Sensitive lines
// (violence, crime, a lawsuit, a tragedy) and lines about the game world on screen take no document.
//
import { layoutPage } from "./layout.ts";

// Pure functions only: the integration step (src/assets/fill.ts and src/render/longplan.ts, wired by the lead)
// ranks this candidate against the other filler areas' for each bare sentence.

/** The documents this area draws. */
export const DOC_KINDS = [
  "memo",
  "schedule",
  "rota",
  "design",
  "contract",
  "manifest",
  "budget",
  "press",
  "ideas",
  "reviews",
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** What a document needs from the shot list (a subset of DocMoment, so fill.ts can pass its moments as is). */
export interface DocMomentLike {
  show?: string;
  broll?: string;
  emphasis?: string;
  person?: string;
  keywords?: string[];
  graphic?: { kind: string };
}

/** The chapter's facts a document may use. */
export interface DocChapterFacts {
  /** The chapter's game: printed as the PROJECT line, the one fact a page carries beyond its sentence. */
  game?: string;
  /** The game's release year: picks the period look (typed on cream paper, or laser-printed), never printed. */
  year?: number;
  /** True when the sentence already has its own picture, clip or graphic. */
  covered?: boolean;
}

/** Everything the page shows, derived from the sentence and the chapter only. */
export interface DocScene {
  kind: DocKind;
  /** The line that matters: the sentence as narrated, tidied for the page. */
  line: string;
  /** The words of `line` the pen marks as the narrator says them (always a substring of `line`). */
  mark: string;
  /** The chapter's game, for the PROJECT field (omitted when unknown). */
  project?: string;
  /** A date the sentence itself names ("November 2004"), for a DATE field or the schedule's milestone. */
  date?: string;
  /** The month of that date, 0-11, when it has one: where the schedule's milestone sits. */
  month?: number;
  /** A figure the sentence itself names (money or a quantity), for an amount or QTY column. */
  figure?: string;
  /** A review score the sentence itself names ("10/10"). */
  score?: string;
  /** Draw a hand-sketched map in the design page's margin (the line is about a map, a city or its size). */
  sketch?: boolean;
  /** Typed on cream paper (before 1995) or laser-printed on white. */
  look: "typed" | "laser";
  /** Rotates small choices (tilt, desk, pen) so two documents never look identical. */
  seed: number;
}

/** A candidate for the integration step: how sure this area is, and why, in plain words. */
export interface DocCandidate {
  area: "docs";
  kind: DocKind;
  /** 0..1: above about 0.6 the sentence names the document's own business (a contract, a schedule). */
  confidence: number;
  reason: string;
  scene: DocScene;
}

// The sensitive-line rule of fill.ts and illustrate.ts: those lines take a neutral real shot or nothing.
const SENSITIVE =
  /\b(lawsuit|lawsuits|sued|suing|court|courtroom|trial|judge|verdict|settlement|murder\w*|kill\w*|shoot\w*|stabb\w*|violen\w*|assault\w*|rape|racis\w*|racial|discriminat\w*|protest\w*|controvers\w*|scandal\w*|tragedy|tragic|died|death|deaths|dead body|suicide|overdos\w*|drugs?|cocaine|heroin|crime|crimes|criminal\w*|gang\w*|guns?|weapons?|hot coffee|sex\w*|strip club|prostitut\w*|porn\w*|harass\w*|abuse\w*|terror\w*|bomb\w*|war|hostage|arrest\w*|police raid|prison|jail|layoffs?|laid off|fired)\b/i;

// A shot note or sentence about something on a screen or inside the game: real footage, a screen look or a game
// still shows it better than paper would.
const ON_SCREEN =
  /\b(gameplay|in-game|cutscene|cutscenes|screenshot|screenshots|footage|trailer|loading screen|error message|menus?|servers?|freez\w*|crash\w*|players? (couldn't|could not|can't|watched|found|stuck)|frozen|glitch\w*|on stage|trophy|trophies|award ceremony)\b/i;

// The cue words of each document, looked for in the sentence first (strong) and then the writer's shot note
// and stock search (weaker). Each is the document's own business: a contract is about a deal, a rota about
// hours, a manifest about discs and shipments.
const CUES: Record<DocKind, RegExp> = {
  contract:
    /\b(contracts?|deals?|signed|signing|signs?|agreements?|NDAs?|non-disclosure|exclusives?|exclusivity|licen[cs]e[ds]?|licensing|rights|offered|offers?|terms|negotiat\w*|acquired|acquisition|bought|buyout|merger|publishing deal)\b/i,
  manifest:
    /\b(ship|shipped|shipping|shipments?|manufactur\w*|pressed|pressing|discs?|cartridges?|warehouses?|pallets?|purchase orders?|ordered|orders?|in stock|retailers?|stores? shelves|on shelves|shelves|delivered|deliver\w*|went gold|gold master)\b/i,
  budget:
    /\b(budgets?|costs?|costing|money|funding|funded|spent|spend|spending|paid|pay|salar(y|ies)|revenue|profits?|earn\w*|cash|investment|invested|investors?|expensive|afford\w*|dollars|pounds|bankrupt\w*|broke|bank)\b|[$£€]\s?\d/i,
  schedule:
    /\b(schedules?|scheduled|deadlines?|milestones?|release date|launch date|delay\w*|slipped|slip|pushed back|postpon\w*|on time|ahead of schedule|behind schedule|timeline|calendar|alpha|beta|ship date|in time for|countdown|months? (later|before|after|away)|weeks? (later|before|after|away)|by (spring|summer|autumn|fall|winter|christmas))\b/i,
  rota: /\b(crunch\w*|overtime|late nights?|all-nighters?|weekends?|night shifts?|shifts?|hours a week|\d+-hour|long hours|around the clock|seven days|slept (at|in|under)|sleeping (at|in|under)|exhaust\w*|burn(ed|t)? out|burnout)\b/i,
  design:
    /\b(designs?|designed|designers?|maps?|city|cities|world|size|bigger|smaller|layout|islands?|districts?|bridges?|roads?|streets?|mechanics?|systems?|features?|unlock\w*|locked|concept|prototype\w*|planned|blueprint|sequel|mission pack|expansion|scrapped|survived|cut|dead spots|deserts?|story went on|started (life|as|out)|didn't start|did not start)\b/i,
  press:
    /\b(announc\w*|press release|press|unveil\w*|statement|publicly|confirmed|teas(ed|er)|marketing|advert\w*|campaign|the name|named|renam\w*|title|slogan)\b/i,
  ideas:
    /\b(ideas?|brainstorm\w*|pitch(ed|es|ing)?|suggest\w*|proposals?|proposed|options|thought about|considered|toyed with|wish ?list|list of|whiteboard|sticky notes?|notes)\b/i,
  reviews:
    /\b(critics?|reviews?|reviewers?|reviewed|scored|scores?|rated|ratings?|praised|panned|acclaim\w*|out of (10|ten|100)|\d+\/10|went furthest|called it|perfect (10|ten)|verdict)\b/i,
  memo: /\b(internally|internal|memos?|emails?|decided|decisions?|ordered|told (staff|the team|everyone)|instructed|polic(y|ies)|rules?|secrecy|secret\w*|confidential|leaks?|leaked|management|executives?|bosses?|the top|approved|approval|green-?lit|mandat\w*|nightmare|ambition|department|security|warned|warning|instructions?)\b/i,
};

// Where a cue in the sentence makes this document the natural cut, and where a cue only in the notes still
// earns one. The figures are the confidence the candidate carries.
const STRONG: Record<DocKind, number> = {
  contract: 0.82,
  manifest: 0.78,
  rota: 0.8,
  schedule: 0.76,
  budget: 0.74,
  design: 0.7,
  reviews: 0.68,
  press: 0.66,
  ideas: 0.66,
  memo: 0.64,
};
const NOTE_ONLY = 0.5;
/** Below this a candidate is not offered at all. */
export const DOC_MIN_CONFIDENCE = 0.45;

// Words a design page's margin sketch suits: the line is about a map, a city's shape or its size.
const MAP_CUE =
  /\b(maps?|city|cities|islands?|districts?|bridges?|roads?|streets?|size|bigger|smaller|deserts?|dead spots|layout|coast\w*|neighbou?rhoods?|miles|kilomet\w*|square)\b/i;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const DATE_RE = new RegExp(
  `\\b((?:${MONTHS.join("|")})(?:\\s+\\d{1,2})?,?\\s+(?:19|20)\\d\\d|(?:spring|summer|autumn|fall|winter|christmas)\\s+(?:19|20)\\d\\d|(?:${MONTHS.join("|")})(?:\\s+\\d{1,2})?)\\b`,
  "i",
);
const YEAR_RE = /\b(19[5-9]\d|20[0-4]\d)\b/;
const NUMWORD =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|a|half a|a few|several|hundreds of|thousands of)";
const MONEY_RE = new RegExp(
  `([$£€]\\s?\\d[\\d,.]*(?:\\s*(?:million|billion|thousand|[mbk]))?|\\b\\d[\\d,.]*\\s*(?:million|billion|thousand)?\\s*(?:dollars|pounds|euros)|\\b${NUMWORD}\\s+(?:million|billion)\\s+(?:dollars|pounds|euros))`,
  "i",
);
const QTY_RE = new RegExp(
  `(\\b\\d[\\d,.]*\\s*(?:million|thousand)?\\s*(?:copies|units|discs|cartridges|boxes|pallets)|\\b${NUMWORD}\\s+(?:million|thousand)\\s+(?:copies|units|discs|cartridges))`,
  "i",
);
const TIMES_RE =
  /\b(?:twice|(?:\w+|\d+(?:\.\d+)?) times) (?:the size|as (?:big|large|many|much|long)|bigger|larger|more)\b/i;
const SCORE_RE =
  /\b(\d{1,3}(?:\.\d)?\s*(?:\/|out of)\s*(?:10|100|5)|perfect (?:10|ten))\b/i;

/** The sentence as it goes on the page: straight quotes, no long dashes, single spaces, its full stop kept. */
export function pageLine(sentence: string): string {
  return sentence
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s*[–—―]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(
  "a an the of to in on at for and or but as by with from its it is was were be been his her their this that these those so then than into had has have he she they we you i also even just only very".split(
    " ",
  ),
);
const tokens = (s: string) => s.split(" ").filter(Boolean);
const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9$£€%'/-]/g, "");

/** Where `phrase` sits in `line`, ignoring case: [start, end) or null. */
export function phraseAt(
  line: string,
  phrase: string,
): [number, number] | null {
  const p = phrase.trim();
  if (!p) return null;
  const i = line.toLowerCase().indexOf(p.toLowerCase());
  return i < 0 ? null : [i, i + p.length];
}

/** Trims a phrase to whole words of `line` without edge punctuation (quotes and full stops stay unmarked). */
function tidy(line: string, a: number, b: number): string {
  let s = line.slice(a, b);
  s = s.replace(/^[\s"'(,.;:!?]+|[\s"'),.;:!?]+$/g, "");
  return s;
}

/**
 * The words the pen marks, most telling first: words the narrator quotes, the writer's kinetic caption when it
 * is a whole phrase of the sentence, a date or figure the sentence names, the whole line when it is six words
 * or fewer, the document's cue with its neighbouring words, then the last three content words.
 */
export function markPhrase(
  line: string,
  kind: DocKind,
  m: DocMomentLike = {},
): string {
  const quoted = line.match(/"([^"]{2,60})"/);
  if (quoted) return tidy(quoted[1]!, 0, quoted[1]!.length);
  const emph = (m.emphasis ?? "").trim();
  if (emph && tokens(emph).length <= 6) {
    const at = phraseAt(line, emph);
    // A whole phrase only: it starts and ends on word boundaries.
    if (
      at &&
      !/\w/.test(line[at[0] - 1] ?? "") &&
      !/\w/.test(line[at[1]] ?? "")
    )
      return tidy(line, at[0], at[1]);
  }
  if (kind === "schedule" || kind === "manifest") {
    const d = line.match(DATE_RE);
    if (d) return d[0];
  }
  if (kind === "budget" || kind === "manifest") {
    const f = line.match(MONEY_RE) ?? line.match(QTY_RE);
    if (f) return tidy(f[0], 0, f[0].length);
  }
  if (kind === "reviews") {
    const s = line.match(SCORE_RE);
    if (s) return s[0];
  }
  const words = tokens(line);
  if (words.length <= 6) return tidy(line, 0, line.length);
  // A size or scale the line compares: "three times the size".
  const times = line.match(TIMES_RE);
  if (times) return times[0];
  // The document's cue, the last one in the line (the end of a sentence is usually its point), with up to two
  // content words either side, crossing at most one small word between them. A cue inside a proper name
  // ("Liberty City") is a name, not the document's business.
  const cue = new RegExp(CUES[kind].source, "gi");
  let last: RegExpExecArray | null = null;
  for (let r = cue.exec(line); r; r = cue.exec(line))
    if (r.index === 0 || !/^[A-Z][a-z]/.test(r[0])) last = r;
  if (last) {
    // Word index of the cue.
    let pos = 0;
    let wi = 0;
    for (; wi < words.length; wi++) {
      if (pos + words[wi]!.length > last.index) break;
      pos += words[wi]!.length + 1;
    }
    // A possessive ("Andreas's") belongs to the name before it, so the mark stops short of it.
    const content = (k: number) =>
      k >= 0 &&
      k < words.length &&
      !STOP.has(bare(words[k]!)) &&
      !/'s$/i.test(words[k]!);
    let a = wi;
    let b = wi;
    // Left: a content word, or one small word followed by a content word.
    for (let n = 0; n < 2; n++) {
      if (content(a - 1)) a--;
      else if (content(a - 2) && !content(a - 1) && n === 0) a -= 2;
      else break;
    }
    for (let n = 0; n < 2; n++) {
      if (content(b + 1) && !/[.,;:!?]$/.test(words[b]!)) b++;
      else break;
    }
    const phrase = words.slice(a, b + 1).join(" ");
    const out = tidy(phrase, 0, phrase.length);
    if (out) return out;
  }
  const content = words.filter((w) => !STOP.has(bare(w)));
  const tail = content.slice(-3);
  const start = line.lastIndexOf(tail[0] ?? "");
  return tidy(line, Math.max(0, start), line.length);
}

/** A stable seed from the sentence, for the page's small choices. */
export function docSeed(sentence: string): number {
  let h = 2166136261;
  for (const ch of sentence) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 100000;
}

/** The kind a line's cues point at, with whether the sentence itself (not just the notes) names it. */
function bestKind(
  sentence: string,
  notes: string,
): { kind: DocKind; strong: boolean; cue: string } | undefined {
  // Order breaks ties: the more specific document wins (a contract over a memo).
  const order: DocKind[] = [
    "contract",
    "rota",
    "reviews",
    "manifest",
    "schedule",
    "budget",
    "ideas",
    "press",
    "design",
    "memo",
  ];
  for (const k of order) {
    const r = sentence.match(CUES[k]);
    if (r) return { kind: k, strong: true, cue: r[0] };
  }
  for (const k of order) {
    const r = notes.match(CUES[k]);
    if (r) return { kind: k, strong: false, cue: r[0] };
  }
  return undefined;
}

/**
 * The document for one bare sentence, or undefined when none suits it: the sentence has its own picture or
 * graphic, is sensitive, is about something on a screen or in the game, or names no document's business.
 */
export function documentFor(
  sentence: string,
  moment: DocMomentLike,
  chapter: DocChapterFacts = {},
): DocCandidate | undefined {
  if (chapter.covered) return undefined;
  if (moment.graphic && moment.graphic.kind !== "none") return undefined;
  const line = pageLine(sentence);
  const n = tokens(line).length;
  if (n < 2 || n > 34 || line.length > 210) return undefined;
  const notes = `${moment.show ?? ""} ${moment.broll ?? ""}`;
  if (SENSITIVE.test(line) || SENSITIVE.test(notes)) return undefined;
  if (ON_SCREEN.test(line) || ON_SCREEN.test(notes)) return undefined;
  // Words the narrator quotes from someone at the studio can sit on an internal note, marked as they are said.
  const quoted = /"[^"]{2,60}"/.test(line);
  const best =
    bestKind(line, notes) ??
    (quoted
      ? { kind: "memo" as const, strong: false, cue: "quoted words" }
      : undefined);
  if (!best) return undefined;
  let { kind } = best;
  let confidence = best.strong ? STRONG[kind] : NOTE_ONLY;
  const why: string[] = [
    best.cue === "quoted words"
      ? "the sentence quotes words an internal note can carry"
      : best.strong
        ? `the sentence says "${best.cue}"`
        : `the shot note says "${best.cue}"`,
  ];
  const date = line.match(DATE_RE)?.[0];
  // A dated line about timing is a schedule even when another document's cue came first.
  if (date && kind !== "schedule" && CUES.schedule.test(line)) {
    kind = "schedule";
    confidence = STRONG.schedule;
    why.push(`and names the date ${date}`);
  }
  // Very short lines ("Critics agreed.") carry little: the page is mostly placeholder.
  if (n <= 3) {
    confidence -= 0.18;
    why.push("but the line is very short");
  }
  // A real-world stock note backs a real-world document.
  if (moment.broll?.trim()) {
    confidence += 0.04;
    why.push("about the real world");
  }
  confidence = Math.round(Math.min(0.9, confidence) * 100) / 100;
  if (confidence < DOC_MIN_CONFIDENCE) return undefined;
  const monthName = date?.match(new RegExp(MONTHS.join("|"), "i"))?.[0];
  const figure = (line.match(MONEY_RE) ?? line.match(QTY_RE))?.[0];
  const score = line.match(SCORE_RE)?.[0];
  const scene: DocScene = {
    kind,
    line,
    mark: markPhrase(line, kind, moment),
    ...(chapter.game?.trim() ? { project: chapter.game.trim() } : {}),
    ...(date ? { date: date.replace(/^\w/, (c) => c.toUpperCase()) } : {}),
    ...(monthName ? { month: MONTHS.indexOf(monthName.toLowerCase()) } : {}),
    ...(figure ? { figure: figure.trim() } : {}),
    ...(score ? { score } : {}),
    ...(kind === "design" && MAP_CUE.test(`${line} ${notes}`)
      ? { sketch: true }
      : {}),
    look:
      Number(chapter.year ?? YEAR_RE.exec(line)?.[0] ?? 2005) < 1995
        ? "typed"
        : "laser",
    seed: docSeed(sentence),
  };
  // The mark must be on the page.
  if (!phraseAt(scene.line, scene.mark))
    scene.mark = tidy(line, 0, line.length);
  // A line too long for its document (a sticky note, a clipping's headline) goes on a memo page instead, which
  // takes any line the chooser accepts; a candidate is always one the renderer can draw.
  if (!layoutPage(scene)) {
    scene.kind = "memo";
    scene.mark = markPhrase(line, "memo", moment);
    delete scene.sketch;
    why.push(`too long for a ${LABEL[kind]}, so a memo`);
    kind = "memo";
    if (!layoutPage(scene)) return undefined;
  }
  return {
    area: "docs",
    kind,
    confidence,
    reason: `${LABEL[kind]}: ${why.join(", ")}`,
    scene,
  };
}

/** Plain names for the reason line and the review sheet. */
export const LABEL: Record<DocKind, string> = {
  memo: "studio memo",
  schedule: "production schedule",
  rota: "crunch rota",
  design: "design document",
  contract: "contract page",
  manifest: "purchase order",
  budget: "budget sheet",
  press: "press release draft",
  ideas: "idea wall",
  reviews: "review clippings",
};
