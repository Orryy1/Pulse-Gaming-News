/**
 * LONG_FACT_DISCIPLINE's repair for a long ranking whose fact-check still fails after the rewrite (src/config.ts).
 *
 * FACT_REPAIR (src/factrepair.ts) edits spoken strings only, so on 20 Nov 2026 a clean cut of "Story length: a few
 * hours" was undone by the same words on the moment's card, and a dropped sentence left its moment behind (every
 * later picture one line late). This repair works on the structured draft: a dropped sentence takes its moment, an
 * edited one loses a card that repeats the blocked claim, a blocked card goes on its own, a rank card's wrong year
 * takes the one the checker gives, and a blocked description sentence goes.
 *
 * With `lastResort` (after the line-by-line repair failed), a blocked sentence the line rules would not touch is cut
 * whole, or its blocked appositive clause, instead of the whole episode failing: never the opening line or a rank
 * announcement, never leaving an entry under three sentences, never leaving the next sentence leaning on nothing
 * ("That...", "This..."), all within the 15% cut cap. The caller fact-checks the result again and ships it only on a
 * pass, so nothing unsupported can go out this way. Pure and deterministic.
 */
import {
  RANK_LINE,
  SENTENCE_SPLIT,
  core,
  locate,
  lower,
  parseBlocker,
  repairBlockers,
  words,
  type Repair,
} from "./factrepair.ts";
import { sentencesOf } from "./editorial/longform.ts";

/** A moment's card in a long ranking's shot list. */
export interface LongCard {
  kind: string;
  primary: string;
  secondary: string;
  items: string[];
}

/** What the long repair reads and writes: the shape of a long ranking draft (src/editorial/longform.ts). */
export interface LongDraft {
  intro: { narration: string };
  entries: Array<{
    game_title: string;
    year: number;
    narration: string;
    moments: Array<{ graphic: LongCard }>;
  }>;
  outro: { narration: string };
  youtube: { title: string; description: string };
}

export interface LongRepair {
  quote: string;
  kind:
    | Repair["kind"]
    | "drop_card"
    | "card_year"
    | "drop_description"
    | "cut_sentence"
    | "cut_appositive";
  from: string;
  to: string;
}

export interface LongRepairOptions {
  /** The last resort: blocked sentences cut whole (or their appositive), up to 8 blockers, within the cut cap. */
  lastResort?: boolean;
  /** More blockers than this and nothing is mended; default 4 (8 in the last resort). */
  maxBlockers?: number;
  /** The most of the spoken words all cuts may remove, as a share of baseWords (default 0.15). */
  maxCutShare?: number;
  /** The draft's spoken words before any repair (default: this draft's). */
  baseWords?: number;
  /** Words already cut from it by an earlier pass. */
  alreadyCut?: number;
}

export interface LongRepairResult<T> {
  draft: T;
  repairs: LongRepair[];
  unrepaired: string[];
  /** Spoken words cut, this pass and any before it. */
  cut: number;
}

/** The spoken fields in the order the repair numbers them: intro, each entry as the draft holds them, outro. */
export const longFields = (d: LongDraft): string[] => [
  d.intro.narration,
  ...d.entries.map((e) => e.narration),
  d.outro.narration,
];

/** The draft's spoken words, the base the cut cap is measured against. */
export const longWords = (d: LongDraft): number =>
  words(longFields(d).join(" "));

function withField<T extends LongDraft>(d: T, i: number, text: string): T {
  if (i === 0) return { ...d, intro: { ...d.intro, narration: text } };
  if (i === d.entries.length + 1)
    return { ...d, outro: { ...d.outro, narration: text } };
  return {
    ...d,
    entries: d.entries.map((e, j) =>
      j === i - 1 ? { ...e, narration: text } : e,
    ),
  };
}

const normWords = (t: string) =>
  lower(t)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const NONE_CARD: LongCard = {
  kind: "none",
  primary: "",
  secondary: "",
  items: [],
};
const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];
const TENS: Record<string, number> = {
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
/** The figures a text says, digits or simple number words ("ten dollars" and "$10" both say 10). */
const digitsOf = (t: string) =>
  new Set([
    ...(t.match(/\d[\d,.]*/g) ?? []).map((x) =>
      x.replace(/[,.]+$/, "").replace(/,/g, ""),
    ),
    ...lower(t)
      .split(/[^a-z]+/)
      .flatMap((w) => {
        const i = NUMBER_WORDS.indexOf(w);
        if (i >= 0) return [String(i)];
        return TENS[w] ? [String(TENS[w])] : [];
      }),
  ]);

/**
 * Whether a card carries the blocked claim: a figure the quote says (as digits or words), or two or more of the
 * card's words inside the quote, as written or as spoken.
 */
export function cardCarries(
  card: LongCard,
  quote: string,
  speak: (t: string) => string = (t) => t,
): boolean {
  if (card.kind === "none") return false;
  const text = [card.primary, card.secondary, ...card.items].join(" ");
  const q = digitsOf(quote);
  if ([...digitsOf(text), ...digitsOf(speak(text))].some((d) => q.has(d)))
    return true;
  const nq = ` ${normWords(quote)} `;
  return [
    `${card.primary} ${card.secondary}`,
    card.primary,
    card.secondary,
    ...card.items,
  ]
    .map(normWords)
    .some((p) => p.split(" ").length >= 2 && nq.includes(` ${p} `));
}

/** The quote as the checker may print a card: "Half-Life 2: [stat] Story length a few hours" -> "story length a few hours". */
function cardQuote(quote: string, titles: readonly string[]): string {
  let q = quote.replace(/\[[a-z]+\]/gi, " ").trim();
  for (const t of [...titles].sort((a, b) => b.length - a.length)) {
    if (lower(q).startsWith(`${lower(t)}:`)) {
      q = q.slice(t.length + 1);
      break;
    }
  }
  return normWords(q);
}

/** The cards (entry index, moment index) whose text the quote reads. */
function cardsQuoted(d: LongDraft, quote: string): Array<[number, number]> {
  const q = cardQuote(
    quote,
    d.entries.map((e) => e.game_title),
  );
  if (!q || q.split(" ").length < 2) return [];
  const hits: Array<[number, number]> = [];
  d.entries.forEach((e, i) =>
    e.moments.forEach((m, j) => {
      const g = m.graphic;
      if (g.kind === "none") return;
      const parts = [
        [g.primary, g.secondary, ...g.items].join(" "),
        `${g.primary} ${g.secondary}`,
        g.primary,
      ]
        .map(normWords)
        .filter((p) => p.split(" ").length >= 2);
      if (
        parts.some(
          (p) => ` ${q} `.includes(` ${p} `) || ` ${p} `.includes(` ${q} `),
        )
      )
        hits.push([i, j]);
    }),
  );
  return hits;
}

/** A rank card with the wrong year: the quote names the entry and its year, and the problem gives exactly one other. */
function rankYearFix(
  d: LongDraft,
  quote: string,
  problem: string,
): { entry: number; year: number } | undefined {
  if (
    !/\b(?:year|date|released?|came out|launch(?:ed)?|belongs?)\b/i.test(
      problem,
    )
  )
    return undefined;
  const nq = ` ${normWords(quote)} `;
  // The longest title the quote names, so "Final Fantasy" never stands in for "Final Fantasy XVI".
  const entry = d.entries
    .map((e, i) => ({ i, t: normWords(e.game_title), y: String(e.year) }))
    .filter((x) => x.t && nq.includes(` ${x.t} `) && nq.includes(` ${x.y} `))
    .sort((a, b) => b.t.length - a.t.length)[0]?.i;
  if (entry === undefined) return undefined;
  const own = d.entries[entry]!.year;
  const years = [
    ...new Set(
      (problem.match(/\b(?:19[5-9]\d|20[0-3]\d)\b/g) ?? []).map(Number),
    ),
  ].filter((y) => y !== own);
  return years.length === 1 ? { entry, year: years[0]! } : undefined;
}

/**
 * A sentence opening on a word that leans on the one before it: cutting that one would leave it dangling ("He drew
 * every poster." after "Kojima hired Yoji Shinkawa."). "It" is left out: in an entry it is nearly always the game.
 */
export const LEANS_BACK =
  /^\s*["'“‘]?(?:that|this|these|those|which|even so|even then|because of (?:that|this)|despite (?:that|this)|he|she|they|his|her|their|them|but|and|so|still|yet|then|there|also)\b/i;

/** An opening subordinate or prepositional clause: what follows its comma is the main clause, never an aside. */
const SUBORDINATE_OPENING =
  /^\s*["'“‘]?(?:when|whenever|after|before|by the time|if|although|though|even though|as|since|once|while|because|until|unless|despite|in|on|at|by|with|during|from|for|under|over|for all)\b/i;

/** Mends the blockers on the structured draft; see the file comment. */
export function repairLongform<T extends LongDraft>(
  draft: T,
  blockers: readonly string[],
  speak: (t: string) => string = (t) => t,
  opts: LongRepairOptions = {},
): LongRepairResult<T> {
  const base = opts.baseWords ?? words(longFields(draft).join(" "));
  const budget = (opts.maxCutShare ?? 0.15) * base;
  let cut = opts.alreadyCut ?? 0;
  const maxBlockers = opts.maxBlockers ?? (opts.lastResort ? 8 : 4);
  const repairs: LongRepair[] = [];
  const unrepaired: string[] = [];
  if (!blockers.length) return { draft, repairs, unrepaired, cut };
  if (blockers.length > maxBlockers)
    return { draft, repairs, unrepaired: [...blockers], cut };
  let d = draft;
  for (const blocker of blockers) {
    const parsed = parseBlocker(blocker);
    if (!parsed) {
      unrepaired.push(blocker);
      continue;
    }
    const fields = longFields(d);
    const at = locate(fields, parsed.quote, speak);
    if (!at) {
      // Not a spoken line: a rank card's year, a card, or the description.
      const year = rankYearFix(d, parsed.quote, parsed.problem);
      if (year) {
        const e = d.entries[year.entry]!;
        repairs.push({
          quote: parsed.quote,
          kind: "card_year",
          from: `${e.game_title}: ${e.year}`,
          to: `${e.game_title}: ${year.year}`,
        });
        d = {
          ...d,
          entries: d.entries.map((x, i) =>
            i === year.entry ? { ...x, year: year.year } : x,
          ),
        };
        continue;
      }
      const cards = cardsQuoted(d, parsed.quote);
      if (cards.length) {
        for (const [i, j] of cards) {
          const g = d.entries[i]!.moments[j]!.graphic;
          repairs.push({
            quote: parsed.quote,
            kind: "drop_card",
            from: [g.primary, g.secondary, ...g.items]
              .filter(Boolean)
              .join(" | "),
            to: "",
          });
        }
        d = {
          ...d,
          entries: d.entries.map((e, i) => ({
            ...e,
            moments: e.moments.map((m, j) =>
              cards.some(([a, b]) => a === i && b === j)
                ? { ...m, graphic: { ...m.graphic, ...NONE_CARD } }
                : m,
            ),
          })),
        };
        continue;
      }
      const desc = d.youtube.description
        .split(SENTENCE_SPLIT)
        .filter((x) => x.trim());
      const q = lower(core(parsed.quote));
      const hit = q ? desc.filter((x) => lower(x).includes(q)) : [];
      if (hit.length === 1 && desc.length > 1) {
        repairs.push({
          quote: parsed.quote,
          kind: "drop_description",
          from: hit[0]!,
          to: "",
        });
        d = {
          ...d,
          youtube: {
            ...d.youtube,
            description: desc.filter((x) => x !== hit[0]).join(" "),
          },
        };
        continue;
      }
      unrepaired.push(blocker);
      continue;
    }
    const total = words(fields.join(" "));
    const left = Math.max(0, budget - cut);
    // The line-by-line rules first: hedge, soften, a clean clause cut, a side sentence dropped.
    const one = repairBlockers(fields, [blocker], speak, {
      maxBlockers: 1,
      maxCutShare: total ? left / total : 0,
    });
    let from: string | undefined;
    let to = "";
    let kind: LongRepair["kind"] | undefined;
    // In a long script a dropped sentence must not leave the next one leaning on it ("That choice shaped...").
    const fieldSentences = sentencesOf(at.field);
    const next = fieldSentences[fieldSentences.indexOf(at.sentence.trim()) + 1];
    const leans =
      !!next &&
      fieldSentences.includes(at.sentence.trim()) &&
      LEANS_BACK.test(next);
    if (
      one.fixes.length === 1 &&
      !one.unrepaired.length &&
      !(one.repairs[0]!.kind === "drop_sentence" && leans)
    ) {
      from = one.fixes[0]!.from;
      to = one.fixes[0]!.to;
      kind = one.repairs[0]!.kind;
    } else if (opts.lastResort) {
      const s = at.sentence;
      const isEntry = at.fieldIndex > 0 && at.fieldIndex <= d.entries.length;
      const qc = core(parsed.quote);
      const qAt = lower(s).indexOf(lower(qc));
      const before = qAt > 0 ? s.slice(0, qAt) : "";
      const after = qAt >= 0 ? s.slice(qAt + qc.length) : "";
      // "Ready at Dawn built it, the first God of War not made mainly by Santa Monica Studio." -> "Ready at Dawn built it."
      const appositive =
        qAt > 0 &&
        /,\s*$/.test(before) &&
        /^(?:the|a|an|its|their|his|her)\b/i.test(qc) &&
        /^\s*[.!?]?["'”’]?\s*$/.test(after) &&
        words(before) >= 4 &&
        // "When the sequel arrived in 2006, the series had sold..." would leave a fragment.
        !SUBORDINATE_OPENING.test(before);
      if (appositive && words(qc) <= left) {
        from = s;
        to = `${before.replace(/,\s*$/, "")}${after.trim() || "."}`;
        kind = "cut_appositive";
      } else {
        const idx = fieldSentences.indexOf(s.trim());
        const opener = at.fieldIndex === 0 && at.index === 0;
        const coherent =
          idx >= 0 &&
          !opener &&
          !RANK_LINE.test(s) &&
          fieldSentences.length - 1 >= (isEntry ? 3 : 2) &&
          !leans &&
          words(s) <= left;
        if (coherent) {
          const cand = idx > 0 ? ` ${s.trim()}` : `${s.trim()} `;
          if (at.field.split(cand).length === 2) {
            from = cand;
            to = "";
            kind = "cut_sentence";
          }
        }
      }
    }
    if (!from || !kind) {
      unrepaired.push(blocker);
      continue;
    }
    const holders = fields
      .map((f, i) => (f.includes(from!) ? i : -1))
      .filter((i) => i >= 0);
    if (holders.length !== 1) {
      unrepaired.push(blocker);
      continue;
    }
    const fi = holders[0]!;
    const old = fields[fi]!;
    const mended = old.replace(from, to);
    let nd = withField(d, fi, mended);
    // The entry's moments follow its sentences: one gone takes its moment; one edited loses a card that repeats it.
    let cardDropped: LongRepair | undefined;
    if (fi > 0 && fi <= d.entries.length) {
      const e = d.entries[fi - 1]!;
      const was = sentencesOf(old);
      const now = sentencesOf(mended);
      const anchor = from.trim();
      const idx = was.findIndex(
        (x) => x.includes(anchor) || anchor.includes(x),
      );
      let moments = e.moments;
      if (e.moments.length === was.length && idx >= 0) {
        if (now.length === was.length - 1)
          moments = e.moments.filter((_, j) => j !== idx);
        else if (now.length === was.length) {
          if (cardCarries(e.moments[idx]!.graphic, parsed.quote, speak)) {
            cardDropped = {
              quote: parsed.quote,
              kind: "drop_card",
              from: e.moments[idx]!.graphic.primary,
              to: "",
            };
            moments = e.moments.map((m, j) =>
              j === idx ? { ...m, graphic: { ...m.graphic, ...NONE_CARD } } : m,
            );
          }
        } else {
          unrepaired.push(blocker);
          continue;
        }
      }
      nd = {
        ...nd,
        entries: nd.entries.map((x, j) =>
          j === fi - 1 ? { ...x, moments } : x,
        ),
      };
    }
    cut += Math.max(0, words(old) - words(mended));
    repairs.push({ quote: parsed.quote, kind, from: from.trim(), to });
    if (cardDropped) repairs.push(cardDropped);
    d = nd;
  }
  return { draft: d, repairs, unrepaired, cut };
}
