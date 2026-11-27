/**
 * LONG_FACT_DISCIPLINE: a long ranking checked without a model before its fact-check (src/config.ts).
 *
 * From 20 to 23 Nov 2026 about ten long rankings died at the fact-check after their one rewrite, on the same few
 * shapes: unsupported absolutes and series-wide firsts ("the first God of War not made mainly by Santa Monica",
 * Betrayal came first), stat cards whose figure no fact supports ("Story length: a few hours"), a card naming the
 * wrong game or year ("Final Fantasy XVI: 1991", IV's year), an "Every X" title over a list that left entries out
 * (the second Steam Controller, Super Mario Maker and Run), and a methodology line the writer was asked to invent
 * ("All of this comes from launch reviews, ... patch histories and how each game runs on today's hardware").
 *
 * disciplineLongform mends what can be mended safely here (a card is decoration, so a doubtful one is dropped; an
 * unproven "every" becomes the count; a sourceless methodology line is cut) and names the rest (absolutes, firsts,
 * spoken figures behind a dropped card) for the writer's one rewrite. Pure and deterministic: no model, no network.
 */
import { sentencesOf, type LongformScript } from "./longform.ts";

/** One game's fact pack as the writer and the fact-check see it. */
export interface PackFact {
  title: string;
  facts: string;
}

export type PreFlagKind =
  | "absolute"
  | "first"
  | "card_figure"
  | "card_game"
  | "card_date"
  | "rank_year"
  | "method"
  | "scope";

export interface PreFlag {
  kind: PreFlagKind;
  /** The line or card text as it stands in the draft. */
  quote: string;
  problem: string;
  /** Mended here already (the card dropped, the line cut, the title counted); else it goes to the rewrite. */
  fixed: boolean;
}

export interface DisciplineResult {
  draft: LongformScript;
  flags: PreFlag[];
}

export interface DisciplineOptions {
  /**
   * The fact pack's own complete list of the series, when it has one. An "Every X" title stands only when the
   * ranking covers every name on it; without a list nothing proves "every", so the title is counted.
   */
  completeList?: string[];
}

/** The rewrite's named line for a flag still open. */
export const preFlagLine = (f: PreFlag): string =>
  `Pre-check: "${f.quote}" - ${f.problem}`;

/** At most this many named lines go to the rewrite, the most serious first, so the feedback stays readable. */
export const PRE_FLAG_FEEDBACK_MAX = 12;

/** The open flags as the rewrite's feedback: firsts, card-backed figures and absolutes, capped. */
export function preFlagFeedback(flags: readonly PreFlag[]): string[] {
  const order: PreFlagKind[] = [
    "first",
    "card_figure",
    "rank_year",
    "card_date",
    "card_game",
    "method",
    "absolute",
    "scope",
  ];
  return [...flags]
    .filter((f) => !f.fixed)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .slice(0, PRE_FLAG_FEEDBACK_MAX)
    .map(preFlagLine);
}

// ------------------------------------------------------------------ text helpers

const lower = (t: string) =>
  t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
/** Letters and digits only, single-spaced: "Final Fantasy XVI: 1991" -> "final fantasy xvi 1991". */
export const normText = (t: string) =>
  lower(t)
    .replace(/[®™©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const wordsOf = (t: string) => t.split(/\s+/).filter(Boolean).length;
const hasWords = (hay: string, needle: string) =>
  !!needle && ` ${hay} `.includes(` ${needle} `);

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};
const SCALE: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  m: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
};

/** A figure written in the text: its value (a year is a value too) and how it was written. */
export interface Figure {
  raw: string;
  value: number;
  year: boolean;
}

// A figure starts a word ("PS5", "N64" are names) and ends one ("2D", "1080p" are labels) unless a scale follows.
const DIGIT_FIGURE =
  /(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(thousand|million|billion|bn|k|m|b)\b|(?![A-Za-z\d]))/gi;
const WORD_FIGURE = new RegExp(
  `\\b(${Object.keys(NUMBER_WORDS).join("|")})(?:[\\s-](${Object.keys(NUMBER_WORDS).join("|")}))?\\s+(thousand|million|billion)\\b`,
  "gi",
);

/** The figures a text states: digits (with a scale word) and number words with a scale ("five million"). */
export function figuresIn(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(DIGIT_FIGURE)) {
    const n = Number(m[1]!.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const scale = m[2] ? (SCALE[m[2].toLowerCase()] ?? 1) : 1;
    // "Final Fantasy VII" has no digits; "Half-Life 2" does, so a lone small digit glued to a title is still a figure.
    const year = !m[2] && /^\d{4}$/.test(m[1]!) && n >= 1950 && n <= 2039;
    out.push({ raw: m[0], value: n * scale, year });
  }
  for (const m of text.matchAll(WORD_FIGURE)) {
    const a = NUMBER_WORDS[m[1]!.toLowerCase()] ?? 0;
    const b = m[2] ? (NUMBER_WORDS[m[2].toLowerCase()] ?? 0) : 0;
    out.push({
      raw: m[0],
      value: (a + b) * (SCALE[m[3]!.toLowerCase()] ?? 1),
      year: false,
    });
  }
  return out;
}

/** A vague length or time claim a card can't source: "a few hours", "one evening", "a weekend". */
const VAGUE_DURATION =
  /\b(?:a few|a couple of|several|one|two|three|a single|an?)\s+(?:hours?|evenings?|afternoons?|weekends?|nights?|sittings?|days?|minutes?)\b/gi;

/** Whether the pack states this figure: the same value, within 5% for a big count (rounded figures read "almost"). */
function packHasValue(packFigures: readonly Figure[], f: Figure): boolean {
  return packFigures.some((p) =>
    f.value >= 1000 && !f.year && !p.year
      ? Math.abs(p.value - f.value) <= 0.05 * f.value
      : p.value === f.value,
  );
}

const yearsIn = (text: string) =>
  new Set(
    figuresIn(text)
      .filter((f) => f.year)
      .map((f) => f.value),
  );

/**
 * The pack for one game: the same title, or else one title inside the other ("Portal" and "Portal (2007)"). A pack
 * that is another entry's own exactly is never borrowed: "Super Mario Bros." never takes "Super Mario Bros. 3"'s.
 */
export function packFor(
  pack: readonly PackFact[],
  title: string,
  otherTitles: readonly string[] = [],
): PackFact[] {
  const t = normText(title);
  const exact = pack.filter((p) => normText(p.title) === t);
  if (exact.length) return exact;
  const others = new Set(otherTitles.map(normText).filter((o) => o !== t));
  return pack.filter((p) => {
    const q = normText(p.title);
    return (
      q.length >= 4 && !others.has(q) && (hasWords(t, q) || hasWords(q, t))
    );
  });
}

/** The original release year a Wikipedia lead gives: "Final Fantasy IV is a 1991 role-playing video game". */
export function leadYear(facts: string): number | undefined {
  const m = facts.match(/\bis an?\s+(?:\w+\s+){0,2}?(19[5-9]\d|20[0-3]\d)\b/i);
  return m ? Number(m[1]) : undefined;
}

// ------------------------------------------------------------------ the spoken lines

interface Spoken {
  /** "intro", "outro" or the entry's index in draft.entries. */
  field: "intro" | "outro" | number;
  index: number;
  sentence: string;
}

function spokenSentences(d: LongformScript): Spoken[] {
  const out: Spoken[] = [];
  sentencesOf(d.intro.narration).forEach((s, i) =>
    out.push({ field: "intro", index: i, sentence: s }),
  );
  d.entries.forEach((e, f) =>
    sentencesOf(e.narration).forEach((s, i) =>
      out.push({ field: f, index: i, sentence: s }),
    ),
  );
  sentencesOf(d.outro.narration).forEach((s, i) =>
    out.push({ field: "outro", index: i, sentence: s }),
  );
  return out;
}

/**
 * Absolutes the fact-check rejects when the facts don't say them (item 45): never, always, only, every other, no
 * other, the whole way, exactly what. "not only", "if only", "as always" and "never mind" are idiom, not claims.
 */
const ABSOLUTES: ReadonlyArray<{ re: RegExp; word: string; soft: string }> = [
  {
    re: /\bnever\b(?!\s+mind\b)/i,
    word: "never",
    soft: '"rarely", "hardly ever", or say who says so',
  },
  {
    re: /(?<!\b(?:as|almost|nearly|not)\s)\balways\b/i,
    word: "always",
    soft: '"usually", "often", or say who says so',
  },
  {
    re: /(?<!\b(?:not|if)\s)\bonly\b(?!\s+(?:just|to)\b)/i,
    word: "only",
    soft: '"one of the few", or name the source',
  },
  {
    re: /\bevery other\b/i,
    word: "every other",
    soft: '"most", or name the others',
  },
  {
    re: /\bno other\b/i,
    word: "no other",
    soft: '"few others", or name the source',
  },
  {
    re: /\bthe whole way\b/i,
    word: "the whole way",
    soft: '"most of the way"',
  },
  {
    re: /\bexactly (?:what|where|how|when|who)\b/i,
    word: "exactly",
    soft: "say what the game really shows, or cut it",
  },
];

/**
 * A series-wide or industry first: "the first God of War not made mainly by Santa Monica Studio", "the first game
 * to...", "the first ever", "for the first time in the series". "The first level" or "first released" are not.
 */
const SERIES_FIRST = [
  /\b(?:the|its|their|series'?s?|franchise'?s?)\s+(?:very\s+)?first\b(?:\s+[\w'’:-]+){0,6}?\s+(?:not|to|ever|outside|without|in (?:the|a|its) (?:series|franchise|genre|industry|history)|of its kind)\b/i,
  /\bfirst[- ]ever\b/i,
  /\bfor the (?:very )?first time in (?:the |its )?(?:series|franchise|history|gaming|the industry)\b/i,
];

/** The absolute and the next two words, found in the pack: the facts say it, so it is not flagged. */
function packSays(
  sentence: string,
  at: number,
  word: string,
  packNorm: string,
): boolean {
  const tail = normText(
    sentence
      .slice(at)
      .split(/\s+/)
      .slice(0, wordsOf(word) + 2)
      .join(" "),
  );
  return tail.length > 0 && hasWords(packNorm, tail);
}

export function absoluteFlags(
  d: LongformScript,
  pack: readonly PackFact[],
): PreFlag[] {
  const packNorm = normText(pack.map((p) => p.facts).join(" "));
  const out: PreFlag[] = [];
  for (const s of spokenSentences(d)) {
    const first = SERIES_FIRST.map((re) => s.sentence.match(re)).find(Boolean);
    if (
      first &&
      first.index !== undefined &&
      !packSays(s.sentence, first.index, first[0], packNorm)
    ) {
      out.push({
        kind: "first",
        quote: s.sentence,
        problem: `a series-wide "first" ("${first[0]}") that the facts given do not state. Check it against every earlier entry in the series (spin-offs, handheld and mobile games count) or drop the claim.`,
        fixed: false,
      });
      continue;
    }
    for (const a of ABSOLUTES) {
      const m = s.sentence.match(a.re);
      if (!m || m.index === undefined) continue;
      if (packSays(s.sentence, m.index, m[0], packNorm)) continue;
      out.push({
        kind: "absolute",
        quote: s.sentence,
        problem: `an absolute ("${a.word}") that the facts given do not state. Soften it (${a.soft}) or cut the line.`,
        fixed: false,
      });
      break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ methodology lines (rule b)

/** A sentence that claims an evidence basis for the order. */
const METHOD_VERB =
  /\b(?:comes? from|came from|is based on|are based on|based on|drawn from|draws on|built (?:on|from)|(?:we|I) (?:looked|went|dug|combed) (?:at|through|into)|(?:we|I) (?:weighed|tested|measured|checked|benchmarked|played)|what (?:we|I) weighed|weighed up|judged (?:on|by)|ranked (?:on|by) (?:a mix of|a blend of)|sources? (?:are|include))\b/i;

/** The ranking as the subject of a methodology line. */
const RANKING_SUBJECT =
  /\b(?:all of this|all of these|this ranking|the ranking|these rankings|this list|the list|the order|this order|these placings|these picks|every pick|each pick|each placing|every placing|my picks|our picks|my order|our order)\b/i;

/** The evidence a methodology line may name, and what in the pack would back it. */
const EVIDENCE: ReadonlyArray<{ name: string; said: RegExp; backed: RegExp }> =
  [
    {
      name: "reviews",
      said: /\b(?:launch |critic(?:s'?)? |user )?reviews?\b|\breview scores?\b|\bmetacritic\b|\bcritics?\b/i,
      backed: /\bmetacritic\b|\breviews?\b|\bcritic/i,
    },
    {
      name: "sales figures",
      said: /\bsales\b|\bsales figures\b|\bunits sold\b|\bcopies sold\b/i,
      backed: /\bsold\b|\bsales\b|\bcopies\b|\bunits\b/i,
    },
    {
      name: "patch histories",
      said: /\bpatch(?:es|ing)?\b|\bpatch (?:notes|histor(?:y|ies))\b|\bupdate histor(?:y|ies)\b/i,
      backed: /\bpatch/i,
    },
    {
      name: "hardware tests",
      said: /\btoday'?s hardware\b|\bmodern hardware\b|\bhardware tests?\b|\bbenchmarks?\b|\bframe ?rates?\b|\bperformance tests?\b/i,
      backed:
        /\bbenchmark|\bframe ?rate|\bfps\b|\bperformance test|\btested on\b/i,
    },
    {
      name: "player counts",
      said: /\bplayer counts?\b|\bconcurrent players\b/i,
      backed: /\bplayers on steam\b|\bplayer count|\bconcurrent/i,
    },
  ];

/** The evidence kinds a sentence names that the pack does not hold, when the sentence states an evidence basis. */
export function unbackedMethod(sentence: string, packText: string): string[] {
  const named = EVIDENCE.filter((e) => e.said.test(sentence));
  if (!named.length) return [];
  // A methodology line says what the ranking itself rests on ("All of this comes from ..."), or names three kinds of
  // evidence at once; "Built on id Tech 7" or "based on the Wii U version" are about a game, not the order.
  const aboutTheOrder =
    METHOD_VERB.test(sentence) && RANKING_SUBJECT.test(sentence);
  if (!aboutTheOrder && named.length < 3) return [];
  return named.filter((e) => !e.backed.test(packText)).map((e) => e.name);
}

// ------------------------------------------------------------------ "Every X" titles (rule a)

const HEADS: ReadonlyArray<readonly [string, string]> = [
  ["game", "games"],
  ["entry", "entries"],
  ["release", "releases"],
  ["title", "titles"],
  ["console", "consoles"],
  ["handheld", "handhelds"],
  ["controller", "controllers"],
  ["device", "devices"],
  ["mission", "missions"],
  ["boss", "bosses"],
  ["map", "maps"],
  ["ending", "endings"],
  ["campaign", "campaigns"],
  ["remake", "remakes"],
  ["sequel", "sequels"],
  ["instalment", "instalments"],
  ["installment", "installments"],
  ["episode", "episodes"],
  ["expansion", "expansions"],
  ["level", "levels"],
  ["character", "characters"],
  ["villain", "villains"],
  ["protagonist", "protagonists"],
  ["spin-off", "spin-offs"],
  ["system", "systems"],
  ["machine", "machines"],
];
const HEAD_ALT = HEADS.flatMap(([a, b]) => [b, a]).join("|");
function pluralOf(head: string): string {
  const pair = HEADS.find(
    ([a, b]) => a === head.toLowerCase() || b === head.toLowerCase(),
  );
  const plural = pair ? pair[1] : `${head}s`;
  if (head === head.toUpperCase() && /[A-Z]/.test(head))
    return plural.toUpperCase();
  if (head[0] && head[0] === head[0].toUpperCase())
    return plural[0]!.toUpperCase() + plural.slice(1);
  return plural;
}

/** The title's scope phrase: "Every 2D Mario Game" in "Every 2D Mario Game, Ranked", with its parts. */
interface TitleScope {
  match: string;
  index: number;
  /** The words between "every" and the head noun, with a trailing space when there are any: "2D Mario ". */
  span: string;
  head: string;
}

/** "Every"/"All" opening the title, or after "Ranking"/"Ranked:"/a colon; "for every year" is not a scope claim. */
const TITLE_EVERY_START =
  /(^|\branking\s+|\branked:?\s+|\brating\s+|:\s*)(every|all)\s+(?:single\s+)?(?:(?:the|of the)\s+)?/i;
/** Where the scope phrase ends: a comma, a colon, " - ", "Ranked", "Rated", "Worst", "Best" or the end. */
const TITLE_BOUNDARY =
  /\s*(?:,|:|\s-\s|\branked\b|\brated\b|\bworst\b|\bbest\b|$)/i;

/** A count already in place ("All 12 Halo Games"); "2D" in "Every 2D Mario Game" is a name, not a count. */
const COUNTED = /^\d+(?:,\d{3})*\s/;

const headOf = (w: string) =>
  HEADS.find(([a, b]) => a === w.toLowerCase() || b === w.toLowerCase())?.[0];

/** Whether a title claims every entry ("Every Zelda, Ranked"), whether or not its phrase can be counted. */
export function titleClaimsEvery(title: string): boolean {
  const m = TITLE_EVERY_START.exec(title);
  return !!m && !COUNTED.test(title.slice(m.index + m[0].length));
}

/**
 * The scope phrase when it can be counted safely: it must end on a head noun ("Game", "Release"), the last word
 * before the title's boundary, so "Every Game Boy Game" counts the second "Game" and "Every Xbox Console
 * Exclusive" or "All Steam Hardware" (no head to count) are left for the writer.
 */
export function titleScope(title: string): TitleScope | undefined {
  const m = TITLE_EVERY_START.exec(title);
  if (!m) return undefined;
  const start = m.index + m[1]!.length;
  const bodyAt = m.index + m[0].length;
  const rest = title.slice(bodyAt);
  if (COUNTED.test(rest)) return undefined;
  const segment = rest.slice(0, rest.search(TITLE_BOUNDARY)).trimEnd();
  const words = segment.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  if (!last || !headOf(last)) return undefined;
  const span = words.slice(0, -1).join(" ");
  return {
    match: title.slice(start, bodyAt + segment.length),
    index: start,
    span: span ? `${span} ` : "",
    head: last,
  };
}

/** "Every 2D Mario Game, Ranked" -> "12 2D Mario Games, Ranked". Undefined when there is no countable "every" phrase. */
export function countedTitle(title: string, n: number): string | undefined {
  const sc = titleScope(title);
  if (!sc) return undefined;
  const replaced = `${n} ${sc.span}${pluralOf(sc.head)}`;
  return (
    title.slice(0, sc.index) +
    replaced +
    title.slice(sc.index + sc.match.length)
  );
}

const SPOKEN_EVERY = new RegExp(
  `\\b(every|all)\\s+(single\\s+)?((?:the|of the)\\s+)?((?:[^\\s,.;:!?]+\\s+){0,6}?)(${HEAD_ALT})\\b(\\s+ever(?:\\s+(?:made|released))?)?`,
  "gi",
);

/** Words before "every" that make it something else: "almost every", "not every", "of all", "than every". */
const NOT_A_SCOPE_BEFORE =
  /\b(?:almost|nearly|not|virtually|practically|of|than|like)\s*$/i;

/**
 * A spoken or written "every 2D Mario game" said as the count: "each of these 12 2D Mario games" (the verb stays
 * singular and still agrees), "all 12 2D Mario games". Only the title's own phrase, word for word with the same head
 * noun: "every 3D Zelda game" in a Zelda ranking, "every Mario level", "every game in the series", "all the other
 * Zelda games" and "all three Halo games" are left as they are.
 */
export function countedText(
  text: string,
  n: number,
  scope: Pick<TitleScope, "span" | "head">,
): string {
  const spanNorm = normText(scope.span);
  const head = headOf(scope.head);
  return text.replace(
    SPOKEN_EVERY,
    (
      whole,
      q: string,
      _single,
      _the,
      span: string,
      h: string,
      _ever,
      at: number,
    ) => {
      if (normText(span) !== spanNorm || headOf(h) !== head) return whole;
      if (NOT_A_SCOPE_BEFORE.test(text.slice(0, at))) return whole;
      const startOfSentence =
        at === 0 || /[.!?]\s*["'“‘]?\s*$/.test(text.slice(0, at));
      const plural = pluralOf(h.toLowerCase());
      const phrase =
        q.toLowerCase() === "every"
          ? `each of these ${n} ${span}${plural}`
          : `all ${n} ${span}${plural}`;
      return startOfSentence
        ? phrase[0]!.toUpperCase() + phrase.slice(1)
        : phrase;
    },
  );
}

/** Whether the ranking covers every name on the pack's complete list. */
export function coversList(
  entries: readonly string[],
  list: readonly string[],
): boolean {
  const have = entries.map(normText);
  return (
    list.length > 0 &&
    list.every((x) => {
      const t = normText(x);
      // An entry may carry more of the name, never less: "Steam Controller" does not cover "Steam Controller (2026)".
      return have.some((h) => h === t || hasWords(h, t));
    })
  );
}

/**
 * Rule (a): an "Every X" ranking covers the pack's complete list, or its title, description and lines are counted.
 * A title whose phrase can't be counted safely ("Every Zelda, Ranked") is named for the rewrite instead.
 */
export function scopeRule(
  d: LongformScript,
  opts: DisciplineOptions = {},
): { draft: LongformScript; flags: PreFlag[] } {
  const titles = d.entries.map((e) => e.game_title);
  if (opts.completeList?.length && coversList(titles, opts.completeList))
    return { draft: d, flags: [] };
  const n = d.entries.length;
  const flags: PreFlag[] = [];
  const scope = titleScope(d.youtube.title) ?? titleScope(d.title);
  for (const t of [d.youtube.title, d.title])
    if (titleClaimsEvery(t) && !titleScope(t))
      flags.push({
        kind: "scope",
        quote: t,
        problem: `claims every entry, and no complete list in the facts shows the ranking covers them all. Say the count instead ("${n} ... Games, Ranked").`,
        fixed: false,
      });
  if (!scope) return { draft: d, flags };
  const count = (t: string) => countedText(t, n, scope);
  const title = (t: string) => {
    const c = countedTitle(t, n);
    if (c && c !== t)
      flags.push({
        kind: "scope",
        quote: t,
        problem: `claims every entry, and no complete list in the facts shows the ranking covers them all; counted as "${c}".`,
        fixed: true,
      });
    return count(c ?? t);
  };
  const next: LongformScript = {
    ...d,
    title: title(d.title),
    intro: {
      ...d.intro,
      narration: count(d.intro.narration),
      on_screen: title(d.intro.on_screen),
    },
    entries: d.entries.map((e) => ({ ...e, narration: count(e.narration) })),
    outro: {
      ...d.outro,
      narration: count(d.outro.narration),
      on_screen: title(d.outro.on_screen),
    },
    youtube: {
      ...d.youtube,
      title: title(d.youtube.title),
      description: count(d.youtube.description),
      ...(d.youtube.thumb_text !== undefined
        ? { thumb_text: title(d.youtube.thumb_text) }
        : {}),
    },
  };
  const spokenChanged = [
    [d.intro.narration, next.intro.narration],
    ...d.entries.map((e, i) => [e.narration, next.entries[i]!.narration]),
    [d.outro.narration, next.outro.narration],
    [d.youtube.description, next.youtube.description],
  ].filter(([a, b]) => a !== b);
  for (const [a] of spokenChanged)
    flags.push({
      kind: "scope",
      quote: (a!.match(SPOKEN_EVERY)?.[0] ?? a!).trim(),
      problem: `an "every" the facts can't prove; said as the count (${n}).`,
      fixed: true,
    });
  return { draft: next, flags };
}

// ------------------------------------------------------------------ cards (rule c and unsupported figures)

const NO_CARD = {
  kind: "none" as const,
  primary: "",
  secondary: "",
  items: [] as string[],
};
/** Kinds that name other games on purpose. */
const MULTI_GAME_KINDS = new Set([
  "versus",
  "compare",
  "timeline",
  "list",
  "bars",
  "span",
]);

const cardString = (g: {
  primary: string;
  secondary: string;
  items: string[];
}) => [g.primary, g.secondary, ...g.items].filter(Boolean).join(" | ");

/** Another entry's title on this entry's card, or undefined. Longest title first, the entry's own name removed. */
function otherGameOnCard(
  text: string,
  own: string,
  others: readonly string[],
): string | undefined {
  let t = ` ${normText(text)} `;
  const mine = normText(own);
  if (mine) t = t.split(` ${mine} `).join(" ");
  return [...others]
    .sort((a, b) => normText(b).length - normText(a).length)
    .find((o) => {
      const n = normText(o);
      return (
        n.length >= 3 &&
        n !== mine &&
        !hasWords(mine, n) &&
        t.includes(` ${n} `)
      );
    });
}

/** Removes sentence `index` from a narration (the moment for it goes too, by the caller). */
function dropSentence(text: string, index: number): string {
  return sentencesOf(text)
    .filter((_, i) => i !== index)
    .join(" ");
}

/**
 * The deterministic pass on a long ranking draft before its fact-check: rule (a) the "every" scope, rule (b) a
 * sourceless methodology line cut, rule (c) cards naming another game or another game's year dropped and a rank card's
 * year set to the game's own, cards whose figures no fact supports dropped, and absolutes and firsts named.
 */
export function disciplineLongform(
  draft: LongformScript,
  pack: readonly PackFact[],
  opts: DisciplineOptions = {},
): DisciplineResult {
  const flags: PreFlag[] = [];
  const scoped = scopeRule(draft, opts);
  let d = scoped.draft;
  flags.push(...scoped.flags);
  const packText = pack.map((p) => p.facts).join("\n");

  // (b) A methodology line naming evidence the pack does not hold: cut (never the opening line), else named.
  const cutIntro: number[] = [];
  const cutOutro: number[] = [];
  const cutEntry = new Map<number, number[]>();
  for (const s of spokenSentences(d)) {
    const missing = unbackedMethod(s.sentence, packText);
    if (!missing.length) continue;
    const opener = s.field === "intro" && s.index === 0;
    const fieldText =
      s.field === "intro"
        ? d.intro.narration
        : s.field === "outro"
          ? d.outro.narration
          : d.entries[s.field]!.narration;
    const left =
      sentencesOf(fieldText).length -
      1 -
      (s.field === "intro"
        ? cutIntro.length
        : s.field === "outro"
          ? cutOutro.length
          : (cutEntry.get(s.field)?.length ?? 0));
    const fixed = !opener && left >= 2;
    flags.push({
      kind: "method",
      quote: s.sentence,
      problem: `states what the ranking is based on (${missing.join(", ")}) and the facts given hold no such source. Never claim a method or evidence the facts don't contain; say the rule the order is judged by instead.`,
      fixed,
    });
    if (!fixed) continue;
    if (s.field === "intro") cutIntro.push(s.index);
    else if (s.field === "outro") cutOutro.push(s.index);
    else cutEntry.set(s.field, [...(cutEntry.get(s.field) ?? []), s.index]);
  }
  const dropAll = (text: string, idx: number[]) =>
    [...idx].sort((a, b) => b - a).reduce((t, i) => dropSentence(t, i), text);
  d = {
    ...d,
    intro: { ...d.intro, narration: dropAll(d.intro.narration, cutIntro) },
    outro: { ...d.outro, narration: dropAll(d.outro.narration, cutOutro) },
    entries: d.entries.map((e, f) => {
      const idx = cutEntry.get(f);
      if (!idx?.length) return e;
      const aligned = e.moments.length === sentencesOf(e.narration).length;
      return {
        ...e,
        narration: dropAll(e.narration, idx),
        moments: aligned
          ? e.moments.filter((_, i) => !idx.includes(i))
          : e.moments,
      };
    }),
  };
  // The description takes the same rule: its methodology sentence goes when another sentence is left.
  const desc = d.youtube.description.split(/(?<=[.!?])\s+/).filter(Boolean);
  const keptDesc = desc.filter((x) => !unbackedMethod(x, packText).length);
  if (keptDesc.length && keptDesc.length < desc.length) {
    for (const x of desc.filter((y) => !keptDesc.includes(y)))
      flags.push({
        kind: "method",
        quote: x,
        problem:
          "the description states a method or evidence the facts don't contain; cut.",
        fixed: true,
      });
    d = { ...d, youtube: { ...d.youtube, description: keptDesc.join(" ") } };
  }

  // (c) and the figures: each entry's cards against its own game and its own pack.
  const titles = d.entries.map((e) => e.game_title);
  const allFigures = figuresIn(packText);
  const allYearsIn = yearsIn(packText);
  const allYears = new Map<number, string>();
  for (const e of d.entries)
    for (const p of packFor(pack, e.game_title, titles)) {
      const ly = leadYear(p.facts);
      if (ly && !allYears.has(ly)) allYears.set(ly, e.game_title);
    }
  d = {
    ...d,
    entries: d.entries.map((e) => {
      const own = packFor(pack, e.game_title, titles);
      const ownText = own.map((p) => p.facts).join("\n");
      const ownFigures = figuresIn(ownText);
      const ownYears = yearsIn(ownText);
      const others = titles.filter((t) => t !== e.game_title);
      const sentences = sentencesOf(e.narration);
      let year = e.year;
      // The rank card's year must be this game's own: a year the game's facts never give, where its lead names another.
      if (own.length && ownYears.size && !ownYears.has(e.year)) {
        const ly = own
          .map((p) => leadYear(p.facts))
          .find((y) => y !== undefined);
        const belongs = allYears.get(e.year);
        if (ly && ly !== e.year) {
          year = ly;
          flags.push({
            kind: "rank_year",
            quote: `${e.game_title}: ${e.year}`,
            problem: `the rank card's year is not ${e.game_title}'s own${belongs ? ` (${e.year} is ${belongs}'s)` : ""}; its facts give ${ly}, so the card shows ${ly}.`,
            fixed: true,
          });
        } else {
          flags.push({
            kind: "rank_year",
            quote: `${e.game_title}: ${e.year}`,
            problem: `the rank card's year is not in ${e.game_title}'s facts${belongs ? ` (${e.year} is ${belongs}'s)` : ""}; give the game's own original release year.`,
            fixed: false,
          });
        }
      }
      const moments = e.moments.map((m, i) => {
        const g = m.graphic;
        if (g.kind === "none") return m;
        const text = cardString(g);
        const line = sentences[i] ?? text;
        const drop = (kind: PreFlagKind, problem: string, named = false) => {
          flags.push({
            kind,
            quote: text,
            problem: `${problem} Card dropped.`,
            fixed: true,
          });
          if (named)
            flags.push({
              kind,
              quote: line,
              problem: `${problem} Source it from this game's facts or cut it.`,
              fixed: false,
            });
          return { ...m, graphic: { ...g, ...NO_CARD } };
        };
        if (!MULTI_GAME_KINDS.has(g.kind)) {
          const other = otherGameOnCard(
            `${g.primary} ${g.secondary}`,
            e.game_title,
            others,
          );
          if (other)
            return drop(
              "card_game",
              `a card in the ${e.game_title} entry names ${other}.`,
            );
        }
        if (!own.length) return m; // no pack for this game: nothing to judge its figures by
        // A compare, list, bars, timeline, span or versus card shows other games on purpose: any game's facts may back it.
        const multi = MULTI_GAME_KINDS.has(g.kind);
        const factsFigures = multi ? allFigures : ownFigures;
        const factsYears = multi ? allYearsIn : ownYears;
        const factsText = multi ? packText : ownText;
        const figures = figuresIn(text);
        if (g.kind !== "span" && g.kind !== "timeline" && g.kind !== "versus") {
          const strayYear = figures.find(
            (f) => f.year && !factsYears.has(f.value) && f.value !== year,
          );
          if (strayYear) {
            const whose = allYears.get(strayYear.value);
            return drop(
              "card_date",
              `the card's date ${strayYear.value} is not ${e.game_title}'s own${whose && whose !== e.game_title ? ` (it is ${whose}'s)` : ""}.`,
              true,
            );
          }
        }
        const unsupported = figures.find(
          (f) => !f.year && !packHasValue(factsFigures, f),
        );
        if (unsupported)
          return drop(
            "card_figure",
            `the card shows "${unsupported.raw.trim()}", a figure no fact given for ${e.game_title} supports.`,
            true,
          );
        const vague = text
          .match(VAGUE_DURATION)
          ?.find((v) => !lower(factsText).includes(lower(v)));
        if (vague)
          return drop(
            "card_figure",
            `the card shows "${vague}", a length no fact given for ${e.game_title} states.`,
            true,
          );
        return m;
      });
      return { ...e, year, moments };
    }),
  };

  flags.push(...absoluteFlags(d, pack));
  return { draft: d, flags };
}
