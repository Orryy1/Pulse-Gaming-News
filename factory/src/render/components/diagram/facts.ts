// The facts an explainer diagram draws, derived from a documentary sentence and its chapter's own text
// only (31 Oct 2026). Five shapes, each a pure function that returns its data or the reason it cannot:
//   - org chart: studios and teams and who owned or merged into whom, from a sentence (or, for a line like
//     "Then the ownership changed.", the nearest neighbouring sentence) that names them and the relation;
//   - timeline: the years and events the chapter's sentences and grounded graphics state, the sentence's
//     own year highlighted;
//   - split screen: two named efforts running at once ("alongside", "at the same time", "meanwhile");
//   - flow: a chain the sentence spells out (A, then B; moved from A to B and C);
//   - before/after: a change the sentence states (once X, now Y; started life as X).
// Every label is a run of the sentence's or the chapter's words, trimmed, or a fixed generic label; a name
// the text does not give is never supplied, so when the data is not there the shape declines.

import type { FillerChapter } from "../kinetic/types.ts";

/** A derivation's answer: the data, or why not. */
export type Derived<T> =
  { ok: true; data: T; note: string } | { ok: false; why: string };
const no = <T>(why: string): Derived<T> => ({ ok: false, why });

/** At most this many words in a diagram label (readable at phone size inside a node). */
export const LABEL_WORDS = 7;

const MONTHS =
  /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)$/i;
const LEAD = new Set(
  "and but so then also while because although though which who that when where after before".split(
    " ",
  ),
);
const TRAIL = new Set(
  "a an the and or but of to in on at by for with from as that this its their his her it is was were be".split(
    " ",
  ),
);
const nrm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const strip = (s: string) =>
  s
    .replace(/^[\s,;:—–"“”'‘’(]+/, "")
    .replace(/[\s,;:.!?—–"“”'‘’)]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

/** A clause as a label: leading joiners and trailing small words off, undefined when longer than `max` words. */
export function condense(
  clause: string,
  max = LABEL_WORDS,
): string | undefined {
  let w = words(strip(clause));
  while (w.length && LEAD.has(nrm(w[0]!))) w = w.slice(1);
  while (w.length && TRAIL.has(nrm(w[w.length - 1]!))) w = w.slice(0, -1);
  const out = strip(w.join(" "));
  if (!out || words(out).length > max) return undefined;
  return out;
}

// ------------------------------------------------------------------------------------------- names

const ORG_SUFFIX =
  "Design|Games|Studios?|North|Interactive|Software|Entertainment|Productions|Publishing|Group|Leeds|London|Lincoln|Toronto|San Diego|New England|India|Inc\\.?|Ltd\\.?|Corporation|Company";
/** A run of capitalised words (Take-Two, DMA, Rockstar North, BMG Interactive). */
// Later words may be a number or a numeral ("Red Dead Redemption 2", "Grand Theft Auto IV").
const CAP =
  "[A-Z][A-Za-z0-9'’&.-]*(?:\\s+(?:of\\s+)?(?:[A-Z][A-Za-z0-9'’&.-]*|\\d+\\b))*";
const SUFFIXED = new RegExp(`\\b(${CAP}\\s+(?:${ORG_SUFFIX}))\\b`, "g");

/** Whether a capitalised phrase names a game of this chapter (never an org). */
function isGame(name: string, chapter: FillerChapter): boolean {
  const n = name.toLowerCase();
  const g = chapter.game.toLowerCase();
  return (
    /\b(grand theft auto|gta)\b/i.test(name) || g.includes(n) || n.includes(g)
  );
}

/** The studios, publishers and teams a text names: suffixed names ("DMA Design") and names a deal verb takes. */
export function orgNames(text: string, chapter: FillerChapter): string[] {
  const out: string[] = [];
  const add = (x: string) => {
    const t = strip(x).replace(/'s$|’s$/, "");
    if (!t || MONTHS.test(t) || isGame(t, chapter)) return;
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const m of text.matchAll(SUFFIXED)) add(m[1]!);
  const deal = new RegExp(
    `(?:acquired|bought|purchased|from|by|merged with|subsidiary of|division of|owned by|sold)\\s+(${CAP})`,
    "g",
  );
  for (const m of text.matchAll(deal)) add(m[1]!);
  const subj = new RegExp(
    `(${CAP})\\s+(?:acquired|bought|purchased|sold|owned|merged)\\b`,
    "g",
  );
  for (const m of text.matchAll(subj)) add(m[1]!);
  return out;
}

// ------------------------------------------------------------------------------------------- org chart

export type OrgEdge = {
  from: string;
  to: string;
  label: string;
  kind: "owns" | "former" | "merged" | "renamed";
};
export interface OrgFacts {
  nodes: string[];
  edges: OrgEdge[];
  /** The node the sentence is about (the one that changed hands), when one is. */
  focus?: string;
}

/** The ownership relation a single sentence states between named studios, if it states one. */
export function orgRelation(
  sentence: string,
  chapter: FillerChapter,
): OrgFacts | undefined {
  const names = orgNames(sentence, chapter);
  const known = (x: string | undefined) =>
    x
      ? names.find(
          (n) =>
            strip(x)
              .replace(/'s$|’s$/, "")
              .toLowerCase() === n.toLowerCase(),
        )
      : undefined;
  let m = sentence.match(
    new RegExp(
      `(${CAP})\\s+(acquired|bought|purchased|took over)\\s+(${CAP})(?:\\s+from\\s+(${CAP}))?`,
    ),
  );
  if (m) {
    const owner = known(m[1]);
    const child = known(m[3]);
    const former = known(m[4]);
    if (owner && child && owner !== child) {
      const edges: OrgEdge[] = [];
      if (former)
        edges.push({ from: former, to: child, label: "from", kind: "former" });
      edges.push({
        from: owner,
        to: child,
        label: m[2]!.toLowerCase(),
        kind: "owns",
      });
      return {
        nodes: [former, owner, child].filter((x): x is string => !!x),
        edges,
        focus: child,
      };
    }
  }
  m = sentence.match(
    new RegExp(
      `(${CAP})\\s+(?:was|were)\\s+(acquired|bought|purchased)\\s+by\\s+(${CAP})(?:\\s+from\\s+(${CAP}))?`,
    ),
  );
  if (m) {
    const child = known(m[1]);
    const owner = known(m[3]);
    const former = known(m[4]);
    if (owner && child && owner !== child) {
      const edges: OrgEdge[] = [];
      if (former)
        edges.push({ from: former, to: child, label: "from", kind: "former" });
      edges.push({
        from: owner,
        to: child,
        label: m[2]!.toLowerCase(),
        kind: "owns",
      });
      return {
        nodes: [former, owner, child].filter((x): x is string => !!x),
        edges,
        focus: child,
      };
    }
  }
  m = sentence.match(
    new RegExp(
      `(${CAP}),?\\s+(?:a|the)\\s+(subsidiary|division|studio|label|arm)\\s+of\\s+(${CAP})`,
    ),
  );
  if (m) {
    const child = known(m[1]);
    const owner = known(m[3]);
    if (owner && child && owner !== child)
      return {
        nodes: [owner, child],
        edges: [
          {
            from: owner,
            to: child,
            label: `${m[2]!.toLowerCase()} of`,
            kind: "owns",
          },
        ],
        focus: child,
      };
  }
  m = sentence.match(
    new RegExp(
      `(${CAP})\\s+(?:became|was renamed|was rebranded as|was renamed to)\\s+(${CAP})`,
    ),
  );
  if (m) {
    const a = known(m[1]);
    const b = known(m[2]);
    if (a && b && a !== b)
      return {
        nodes: [a, b],
        edges: [{ from: a, to: b, label: "became", kind: "renamed" }],
        focus: b,
      };
  }
  m = sentence.match(
    new RegExp(`(${CAP})\\s+(?:and|merged with)\\s+(${CAP})\\s*(?:merged)?`),
  );
  if (m && /\bmerged?\b/i.test(sentence)) {
    const a = known(m[1]);
    const b = known(m[2]);
    if (a && b && a !== b)
      return {
        nodes: [a, b],
        edges: [{ from: a, to: b, label: "merged", kind: "merged" }],
      };
  }
  return undefined;
}

const OWNERSHIP_CUE =
  /\b(ownership|owner|owners|acquired|acquisition|bought|parent company|subsidiary|merged|merger|takeover|took over|sold to|sold off)\b/i;

/**
 * The org chart for a sentence: its own relation, or, when the sentence speaks of ownership without naming
 * it ("Then the ownership changed."), the relation stated within two sentences of it.
 */
export function orgFacts(
  sentence: string,
  chapter: FillerChapter,
  index: number,
): Derived<OrgFacts> {
  const own = orgRelation(sentence, chapter);
  if (own)
    return {
      ok: true,
      data: own,
      note: "the sentence names the studios and the deal",
    };
  if (!OWNERSHIP_CUE.test(sentence))
    return no("it does not speak of who owned whom");
  if (index < 0)
    return no("it speaks of ownership but its chapter position is unknown");
  for (const d of [1, -1, 2, -2]) {
    const s = chapter.sentences[index + d];
    const r = s ? orgRelation(s, chapter) : undefined;
    if (r)
      return {
        ok: true,
        data: r,
        note: `the deal is named ${Math.abs(d) === 1 ? "beside it" : "two lines away"}`,
      };
  }
  return no("it speaks of ownership but no sentence near it names the studios");
}

// ------------------------------------------------------------------------------------------- timeline

export type TimelineEvent = {
  year: number;
  label: string;
  index: number;
  focus?: boolean;
};
export interface TimelineFacts {
  events: TimelineEvent[];
}

const YEAR = /\b(19[5-9]\d|20[0-4]\d)\b(?!s)/;
const YEARS = /\b(19[5-9]\d|20[0-4]\d)\b(?!s)/g;
// A year inside the story (Vice City's 1986, CJ coming home in 1992) is not a development date.
const IN_FICTION =
  /\b(story|follows|followed|set in|setting|character|protagonist|comes home|returns home|plays as|in-game|era|decade|plot|drew on|inspired by|riots)\b/i;
const DATE_WORD = (w: string) =>
  MONTHS.test(nrm(w)) ||
  /^\d{1,2}(st|nd|rd|th)?,?$/.test(w) ||
  YEAR.test(w) ||
  /^(late|early|mid|in|on|by|of|during|around|since|until|the|back|spring|summer|fall|autumn|winter)$/i.test(
    nrm(w),
  );

/** The event a sentence states for its year: the clause holding the year, the date words taken out. */
export function eventLabel(sentence: string): string | undefined {
  if (/["“”]/.test(sentence)) return undefined;
  const clauses = sentence.split(/,\s+|;\s+|\s+and\s+(?=[a-z])/);
  const k = clauses.findIndex((c) => YEAR.test(c));
  if (k < 0) return undefined;
  const tryClause = (c: string | undefined) => {
    if (!c) return undefined;
    let w = words(c);
    // Date words come off the front and the back ("In 1999, ...", "... started in 2015").
    while (w.length && DATE_WORD(w[0]!)) w = w.slice(1);
    while (w.length && DATE_WORD(w[w.length - 1]!)) w = w.slice(0, -1);
    if (w.some((x) => YEAR.test(x))) return undefined;
    const label = condense(w.join(" "));
    // A label that opens on a pronoun ("it was the best-selling game") says nothing on its own.
    if (
      label &&
      /^(it|its|it's|they|he|she|this|that|these|those|there|was|were|had|has|is|would|could|first)\b/i.test(
        label,
      )
    )
      return undefined;
    // Three words at least: "first seen" or "announced" is not an event a viewer can place.
    return label && words(label).length >= 3 ? label : undefined;
  };
  // A year alone in its clause: "In 1999, a small group built..." takes the next clause; "..., a
  // prequel, Vice City Stories, in 2006" the one before.
  if (tryClause(clauses[k])) return tryClause(clauses[k]);
  if (words(clauses[k]!).length > 4) return undefined;
  return k === 0 ? tryClause(clauses[k + 1]) : tryClause(clauses[k - 1]);
}

/** The year of a sentence about the real world, if it states exactly one. */
export function sentenceYear(sentence: string): number | undefined {
  if (IN_FICTION.test(sentence)) return undefined;
  const ys = [
    ...new Set([...sentence.matchAll(YEARS)].map((m) => Number(m[1]))),
  ];
  return ys.length === 1 ? ys[0] : undefined;
}

/** A graphic's row as a timeline label: two words or more and no year of its own ("London 1969"). */
function graphicLabel(text: string): string | undefined {
  const l = condense(text);
  return l && words(l).length >= 2 && !YEAR.test(l) ? l : undefined;
}

/** A grounded graphic's own year events (timeline rows "2013: GTA V launches", a date with its label). */
function graphicEvents(chapter: FillerChapter): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  (chapter.moments ?? []).forEach((m, index) => {
    const g = m.graphic;
    if (!g) return;
    if (g.kind === "timeline")
      for (const row of g.items ?? []) {
        const [y, ...rest] = row.split(":");
        const year = Number(y?.match(YEAR)?.[0]);
        const label = graphicLabel(rest.join(":"));
        if (year && label) out.push({ year, label, index });
      }
    if (g.kind === "date") {
      const year = Number(g.primary?.match(YEAR)?.[0]);
      const label = graphicLabel(g.secondary ?? "");
      if (year && label) out.push({ year, label, index });
    }
  });
  return out;
}

/**
 * The chapter's development timeline with this sentence's year highlighted: at most five events, one per
 * year, the sentence's own and the nearest others in the chapter. Declines without a year of its own or
 * without two other dated events to place it among.
 */
export function timelineFacts(
  sentence: string,
  chapter: FillerChapter,
  index: number,
): Derived<TimelineFacts> {
  const year = sentenceYear(sentence);
  if (!year)
    return no(
      YEAR.test(sentence)
        ? "its year is inside the story, not the making of it"
        : "it names no year",
    );
  const label = eventLabel(sentence);
  if (!label) return no("its year has no event a short label can carry");
  const byYear = new Map<number, TimelineEvent>();
  byYear.set(year, { year, label, index, focus: true });
  const others: TimelineEvent[] = [];
  chapter.sentences.forEach((s, i) => {
    if (i === index) return;
    const y = sentenceYear(s);
    const l = y ? eventLabel(s) : undefined;
    if (y && l) others.push({ year: y, label: l, index: i });
  });
  others.push(...graphicEvents(chapter));
  // The nearest lines in the chapter first: they are the story around this one.
  others.sort((a, b) => Math.abs(a.index - index) - Math.abs(b.index - index));
  for (const e of others) {
    if (byYear.size >= 5) break;
    if (!byYear.has(e.year)) byYear.set(e.year, e);
  }
  if (byYear.size < 3)
    return no("the chapter dates fewer than two other events");
  const events = [...byYear.values()].sort((a, b) => a.year - b.year);
  return {
    ok: true,
    data: { events },
    note: `${events.length} dated events from the chapter`,
  };
}

// ------------------------------------------------------------------------------------------- split screen

export type Side = { title: string; caption?: string };
export interface SplitFacts {
  left: Side;
  right: Side;
}

const PARALLEL =
  /\b(alongside|at the same time|simultaneously|in parallel|meanwhile|side by side)\b/i;
const NAME = new RegExp(CAP, "g");

/** The most specific name in a clause (a capitalised phrase that is not the sentence's first word). */
function nameIn(clause: string, skipFirst: boolean): string | undefined {
  const found: string[] = [];
  for (const m of clause.matchAll(NAME)) {
    if (skipFirst && m.index === 0 && !/\s/.test(m[0])) continue;
    const t = strip(m[0]).replace(/'s$|’s$/, "");
    if (
      t &&
      !MONTHS.test(t) &&
      !/^(The|A|An|It|They|He|She|Then|Meanwhile|By|In|On|At)$/.test(t)
    )
      found.push(t);
  }
  return found.sort((a, b) => b.length - a.length)[0];
}

/** Two efforts running at once, each named by the sentence (or "it" read as the chapter's game). */
export function splitFacts(
  sentence: string,
  chapter: FillerChapter,
): Derived<SplitFacts> {
  const cue = sentence.match(PARALLEL);
  if (!cue) return no("it does not describe two things happening at once");
  const at = cue.index!;
  const before = sentence.slice(0, at);
  const after = sentence.slice(at + cue[0].length);
  let leftTitle = nameIn(before, true);
  let rightTitle = nameIn(after, false);
  // "Rockstar hoped to build it alongside Red Dead Redemption 2": "it" is the chapter's game.
  if (
    /\balongside\b/i.test(cue[0]) &&
    /\b(it|this)\s*$/i.test(before.trim()) &&
    rightTitle
  )
    leftTitle = chapter.game;
  if (/\bmeanwhile\b/i.test(cue[0]) && !leftTitle) {
    // "Meanwhile, X" pairs the line with what came before: not enough on its own.
    return no(
      "'meanwhile' pairs it with an earlier line, so one side is not named here",
    );
  }
  if (!leftTitle || !rightTitle) return no("it does not name both sides");
  if (leftTitle.toLowerCase() === rightTitle.toLowerCase())
    return no("both sides are the same name");
  const cap = (s: string) => condense(s, 6);
  return {
    ok: true,
    data: {
      left: { title: leftTitle, caption: cap(before.replace(leftTitle, "")) },
      right: { title: rightTitle, caption: cap(after.replace(rightTitle, "")) },
    },
    note: "two named efforts in one line",
  };
}

// ------------------------------------------------------------------------------------------- flow

export interface FlowFacts {
  /** Steps in order; the last may fan out to several targets. */
  steps: string[];
  /** Extra targets of the last hand-off ("moved to GTA Online and Red Dead Redemption 2"). */
  fan?: string[];
}

const MOVE =
  /\b(moved|went|passed|handed(?: over)?|sent|shifted|switched|transferred|ported|pooled|redirected)\s+(?:over\s+)?(?:to|onto|into)\s+/i;

/** Names in a list ("GTA Online and Red Dead Redemption 2"), each as a label. */
function listOf(text: string): string[] {
  // A trailing "after four months" or "for more polish" is when or why, not a destination.
  const where = strip(text).split(
    /\s+(?:after|before|in|for|by|when|because|within|until|while)\s+/,
  )[0]!;
  return where
    .split(/,\s+|\s+and\s+/)
    .map((x) => condense(x.replace(/^(the|a|an)\s+/i, ""), 5))
    .filter((x): x is string => !!x);
}

/** What moved, from the words before the verb: the first clause that is not a lone adverb, cut at its verb. */
function sourceOf(before: string): string | undefined {
  const named = before.match(
    new RegExp(`\\b(?:on|from|at)\\s+(?:the\\s+)?(${CAP})`),
  )?.[1];
  if (named && !MONTHS.test(words(named)[0]!)) return strip(named);
  // The clause nearest the verb names what moved ("the discs went to manufacturing"); a possessive one
  // ("its resources moved") points back to the clause before it, and a lone adverb or a date names nothing.
  const clauses = before
    .split(/,\s+|\s+and\s+/)
    .map((c) => c.trim().replace(/^(when|while|as|so|and|but|then)\s+/i, ""))
    .filter(
      (c) =>
        c &&
        !/^[A-Za-z]+$/.test(c) &&
        !words(c).every((w) => DATE_WORD(w) || /^\d/.test(w)) &&
        !/^by\s/i.test(c),
    );
  let k = clauses.length - 1;
  while (k > 0 && /^(its|their|his|her)\b/i.test(clauses[k]!)) k--;
  const c = clauses[k];
  if (!c || /^(its|their|his|her)\b/i.test(c)) return undefined;
  return condense(
    c
      .replace(/\s+\b(had|has|have|was|were|is|are|been|would|could)\b.*$/i, "")
      .replace(/^(the|a|an)\s+/i, ""),
    4,
  );
}

/** A chain the sentence spells out: "A, then B" or "X moved to Y (and Z)" with its source named. */
export function flowFacts(
  sentence: string,
  chapter: FillerChapter,
): Derived<FlowFacts> {
  if (/["“”]/.test(sentence)) return no("it quotes someone");
  const mv = sentence.match(MOVE);
  if (mv) {
    const before = sentence.slice(0, mv.index!);
    const targets = listOf(sentence.slice(mv.index! + mv[0].length));
    // The source: what the first clause names ("began ... on the Dreamcast", "planned single-player DLC").
    const from = sourceOf(before);
    if (!from || !targets.length)
      return no("the hand-off does not name both ends");
    if (targets.some((t) => t.toLowerCase() === from.toLowerCase()))
      return no("it hands off to itself");
    return {
      ok: true,
      data: {
        steps: [from, targets[0]!],
        fan: targets.length > 1 ? targets.slice(1, 3) : undefined,
      },
      note: "a hand-off with both ends named",
    };
  }
  const parts = sentence.split(/,?\s+(?:and\s+)?then\s+/i);
  if (parts.length >= 2 && parts.length <= 4) {
    const steps = parts.map((p) =>
      condense(
        p.replace(
          /^(it|they|he|she|we)\s+(had been|was|were|has been|had)\s+/i,
          "",
        ),
      ),
    );
    if (steps.every((s): s is string => !!s && words(s).length >= 2))
      return {
        ok: true,
        data: { steps },
        note: `${steps.length} steps the sentence orders with "then"`,
      };
    return no("its steps are too long to label");
  }
  return no("it does not spell out a chain");
}

// ------------------------------------------------------------------------------------------- before/after

export interface BeforeAfterFacts {
  before: { head: string; text: string };
  after: { head: string; text: string };
}

const PAST =
  /\b(once|used to|at first|originally|in week one|(19|20)\d\d|couldn't|could not|had)\b/i;

// "three criminals instead of one": a bare count is not a state a panel can show.
const NUMBER_WORD = /^(one|two|three|four|five|six|seven|eight|nine|ten)$/i;

/** A change the sentence states: "X ... in 2013 now Y", "started life as X", "X instead of Y". */
export function beforeAfterFacts(
  sentence: string,
  chapter: FillerChapter,
): Derived<BeforeAfterFacts> {
  if (/["“”]/.test(sentence)) return no("it quotes someone");
  const now = sentence.match(/\b(?:was |is |were )?now\b/i);
  if (now && PAST.test(sentence.slice(0, now.index!))) {
    const first = sentence.slice(0, now.index!);
    const year = first.match(YEAR)?.[0];
    // "The same store Rockstar had switched off in week one": the change is the relative clause.
    const rel =
      first.match(/\b(?:had|has|once|that|which|who)\s+(.+)$/i)?.[1] ?? first;
    const b = condense(rel.replace(YEAR, "").replace(/\s+in\s*$/i, ""));
    const a = condense(sentence.slice(now.index! + now[0].length));
    if (b && a)
      return {
        ok: true,
        data: {
          before: { head: year ?? "BEFORE", text: b },
          after: { head: "NOW", text: a },
        },
        note: "the sentence states what it was and what it is now",
      };
    return no("its two states are too long to label");
  }
  const life = sentence.match(
    /\b(?:it|this|the game)\s+(?:started|began)\s+(?:life\s+|out\s+)?as\s+(.+)$/i,
  );
  if (life && !/\b(didn't|did not|never|wasn't)\b/i.test(sentence)) {
    const b = condense(life[1]!);
    if (b)
      return {
        ok: true,
        data: {
          before: { head: "BEFORE", text: b },
          after: { head: "AFTER", text: chapter.game },
        },
        note: "it started life as something else; the chapter is about what it became",
      };
  }
  const inst = sentence.match(/^(.*?)\binstead of\s+(.+)$/i);
  if (inst) {
    const a = condense(inst[1]!.split(/[:,]\s+/).pop() ?? "", 6);
    // "instead of discs, to stop leaks": the old way ends at the comma.
    const b = condense(inst[2]!.split(/,\s+/)[0]!, 6);
    if (
      a &&
      b &&
      words(a).length >= 2 &&
      words(b).some((w) => /^[a-z]{4,}/i.test(w) && !NUMBER_WORD.test(w))
    )
      return {
        ok: true,
        data: {
          before: { head: "BEFORE", text: b },
          after: { head: "AFTER", text: a },
        },
        note: "the sentence sets the new way against the old",
      };
  }
  const became = sentence.match(
    new RegExp(
      `(${CAP})\\s+(?:became|turned into|was renamed|was rebranded as)\\s+(.+)$`,
    ),
  );
  if (became && (YEAR.test(sentence) || /[A-Z]/.test(became[2]!.slice(1)))) {
    const b = condense(became[1]!);
    const a = condense(became[2]!);
    if (a && b)
      return {
        ok: true,
        data: {
          before: { head: "BEFORE", text: b },
          after: { head: "AFTER", text: a },
        },
        note: "a named thing became another",
      };
  }
  return no("it states no change from one state to another");
}
