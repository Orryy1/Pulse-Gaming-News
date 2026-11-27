/**
 * DOC_FACT_DISCIPLINE (src/config.ts, default on): a chapter of a documentary, weekly explainer or weekly recap never
 * keeps a line its fact-check says the source does not support.
 *
 * Until 25 Nov 2026 those three lanes wrote a chapter up to three times and then kept whatever the checker still
 * disputed, with a Discord note ("the fact check still disputes 18 lines after the rewrites, and they stay in"). That
 * day "The Fall and Return of Cyberpunk 2077" reached the voice with 18 disputed lines, the first a Matrix Online
 * claim the Eurogamer source did not support, and was rejected by hand. Verified sources only is a cardinal rule.
 *
 * The approach is LONG_FACT_DISCIPLINE's for long rankings (src/longrepair.ts): each disputed line is mended without a
 * model where a line rule fits (src/factrepair.ts: "about" before a rounded figure, an absolute softened, a side clause
 * cut), otherwise its sentence is cut whole. Never the chapter's opening sentence, never a character-quote paragraph,
 * never leaving the next sentence leaning on nothing ("That...", "He..."), never past the per-chapter cut cap. Then the
 * chapter is fact-checked once more and kept only when that check comes back clean. Anything else is a failure the
 * caller turns into a dropped chapter (where DOC_DROP_REFUSED_CHAPTER allows it) or a failed episode, never a
 * warning. `repairDocChapter` is pure and deterministic; `disciplineChapter` adds the one re-check.
 */
import type { DocChapter } from "./editorial/documentary.ts";
import {
  SENTENCE_SPLIT,
  core,
  locate,
  lower,
  repairBlockers,
  words,
  type Repair,
} from "./factrepair.ts";
import { LEANS_BACK } from "./longrepair.ts";

/**
 * In a chapter "It", "Its", "The game" or "That year" after a cut line would point at whatever is left before it
 * ("The Matrix Online launched in 2005. It closed four years later." loses its first line and the closure lands on
 * the chapter's game). A ranking's LEANS_BACK leaves "it" out because there it is the entry's game.
 */
const DOC_LEANS_BACK =
  /^\s*["'“‘]?(?:it|its|it's|the game|the same|that year|the year|the next|the following|two years later|a year later|years later|months later|soon after|afterwards?)\b/i;
const leansBack = (t: string) => LEANS_BACK.test(t) || DOC_LEANS_BACK.test(t);

/** A sentence the splitter may have cut short ("the U.S." "Dr."): never cut a piece that ends on one. */
const CLIPPED_END = /\b(?:U\.S|U\.K|Dr|Mr|Mrs|Ms|St|No|vs|Jr|Sr|Inc|Ltd|Co)\.\s*$/;
/** How a whole sentence starts: a capital, a figure, a currency sign or an opening quote or bracket. */
const SENTENCE_START = /^\s*["'“‘(]?[A-Z0-9$£€]/;

/** One line the fact-check disputes, as checkChapterItems returns it. */
export interface DocFactItem {
  quote: string;
  problem: string;
}

export interface DocFactRepair {
  quote: string;
  kind: Repair["kind"] | "cut_sentence";
  from: string;
  to: string;
}

export interface DocFactRepairResult {
  chapter: DocChapter;
  repairs: DocFactRepair[];
  /** Disputed lines it could not mend or cut safely, each with the reason. Any here and the chapter can't ship. */
  unrepaired: Array<DocFactItem & { why: string }>;
  /** Spoken words cut. */
  cut: number;
  /** The chapter's spoken words before any repair, the base of the cap. */
  base: number;
}

/** The default share of a chapter's spoken words the cuts may take (DOC_FACT_CUT_SHARE). */
export const DOC_FACT_CUT_SHARE = 0.2;

const blockerOf = (i: DocFactItem) => `Fact-check: "${i.quote}" - ${i.problem}`;
const splitSentences = (t: string) =>
  t.split(SENTENCE_SPLIT).filter((x) => x.trim());
const fold = (t: string) =>
  lower(t)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The sentences (paragraph, sentence index) a quote covers: one sentence, or each of several the checker quoted together. */
function sentencesQuoted(
  fields: readonly string[],
  quote: string,
): Array<[number, number]> | undefined {
  const one = locate(fields, quote, (t) => t);
  if (one) {
    // locate() takes the same sentence said twice as one; here it is two places, so it is not guessed at.
    const q = lower(core(quote));
    const places = fields.reduce(
      (n, f) => n + splitSentences(f).filter((x) => lower(x).includes(q)).length,
      0,
    );
    return places === 1 ? [[one.fieldIndex, one.index]] : undefined;
  }
  // "Number 8 is the new 2D game. It came out in 2026." quoted as one: every piece must be found, once each.
  const pieces = splitSentences(core(quote))
    .map(fold)
    .filter((p) => p.split(" ").length >= 3);
  if (pieces.length < 2) return undefined;
  const hits: Array<[number, number]> = [];
  for (const p of pieces) {
    const found: Array<[number, number]> = [];
    fields.forEach((f, fi) =>
      splitSentences(f).forEach((s, si) => {
        if (fold(s).includes(p)) found.push([fi, si]);
      }),
    );
    if (found.length !== 1) return undefined;
    hits.push(found[0]!);
  }
  return hits;
}

/**
 * Mends or cuts each disputed line of a chapter; see the file comment. Line rules first (one blocker at a time, inside
 * what is left of the cap), then the whole sentence. A quote that can't be found, or is found in two places, is never
 * guessed at: it stays unrepaired.
 */
export function repairDocChapter(
  chapter: DocChapter,
  items: readonly DocFactItem[],
  opts: { maxCutShare?: number } = {},
): DocFactRepairResult {
  const fields = chapter.paragraphs.map((p) => p.narration);
  const base = words(fields.join(" "));
  const budget = (opts.maxCutShare ?? DOC_FACT_CUT_SHARE) * base;
  let cut = 0;
  const repairs: DocFactRepair[] = [];
  const unrepaired: DocFactRepairResult["unrepaired"] = [];
  const fail = (i: DocFactItem, why: string) => unrepaired.push({ ...i, why });
  // The sentences already mended or cut in this pass, as they were: a second quote inside one is settled with it
  // (the checker often flags two claims in one sentence). The caller's re-check still reads the result.
  const settled: string[] = [];
  const settledBy = (quote: string) => {
    const q = fold(core(quote));
    return !!q && settled.some((x) => fold(x).includes(q));
  };
  // Last line first: a cut never shifts a line still to be settled, and a disputed line that leans on an earlier
  // disputed one ("That's why..." after "If you remember The Matrix Online...") is gone before the earlier is judged.
  const pos = (i: DocFactItem) => {
    const at = sentencesQuoted(fields, i.quote)?.[0];
    return at ? at[0] * 10_000 + at[1] : -1;
  };
  const order = items
    .map((item) => ({ item, at: pos(item) }))
    .sort((a, b) => b.at - a.at)
    .map((x) => x.item);
  for (const item of order) {
    const at = sentencesQuoted(fields, item.quote);
    if (!at && settledBy(item.quote)) continue;
    if (!at) {
      fail(
        item,
        "the disputed words are not in the chapter once and once only",
      );
      continue;
    }
    if (at.some(([fi]) => chapter.paragraphs[fi]!.quote)) {
      fail(
        item,
        "it sits in a character-quote paragraph, whose words are the game's own",
      );
      continue;
    }
    const left = Math.max(0, budget - cut);
    // The line rules: rounding, a softened absolute, a side clause. A whole-sentence drop is judged below instead.
    if (at.length === 1) {
      const total = words(fields.join(" "));
      const tryRules = (quote: string) =>
        repairBlockers(fields, [blockerOf({ ...item, quote })], (t) => t, {
          maxBlockers: 1,
          maxCutShare: total ? left / total : 0,
        });
      let one = tryRules(item.quote);
      // "and the Xbox One was the same age.": the checker took the joining word too; the clause rule wants it left.
      const joined = /^\s*(?:and|but|yet|while|so|though)\s+/i;
      if (!one.fixes.length && joined.test(item.quote))
        one = tryRules(item.quote.replace(joined, ""));
      const r = one.repairs[0];
      if (
        one.fixes.length === 1 &&
        !one.unrepaired.length &&
        r &&
        r.kind !== "drop_sentence"
      ) {
        const fix = one.fixes[0]!;
        const holders = fields
          .map((f, i) => (f.includes(fix.from) ? i : -1))
          .filter((i) => i >= 0);
        if (holders.length === 1) {
          const fi = holders[0]!;
          const was = fields[fi]!;
          settled.push(fix.from);
          fields[fi] = was.replace(fix.from, fix.to);
          cut += Math.max(0, words(was) - words(fields[fi]!));
          repairs.push({
            quote: item.quote,
            kind: r.kind,
            from: fix.from.trim(),
            to: fix.to,
          });
          continue;
        }
      }
    }
    // The last resort: the sentence (or sentences) the quote covers go whole.
    const opener = fields.findIndex((f) => f.trim());
    if (at.some(([fi, si]) => fi === opener && si === 0)) {
      fail(item, "it is the chapter's opening sentence");
      continue;
    }
    const doomed = new Set(at.map(([fi, si]) => `${fi}:${si}`));
    const sentenceWords = at.reduce(
      (n, [fi, si]) => n + words(splitSentences(fields[fi]!)[si]!),
      0,
    );
    if (sentenceWords > left) {
      fail(
        item,
        `cutting it would take the chapter past its ${Math.round((opts.maxCutShare ?? DOC_FACT_CUT_SHARE) * 100)}% cut cap`,
      );
      continue;
    }
    // What would be said next after the cut, in the order the narration runs: it must not lean on the cut line.
    const flat = fields.flatMap((f, fi) =>
      splitSentences(f).map((s, si) => ({ fi, si, s })),
    );
    const isDoomed = (x: { fi: number; si: number }) => doomed.has(`${x.fi}:${x.si}`);
    // After each cut piece (a quote may cover sentences apart from each other), the next line kept.
    const afterCuts = flat
      .map((x, k) => (isDoomed(x) && !isDoomed(flat[k + 1] ?? { fi: -1, si: -1 }) ? flat[k + 1] : undefined))
      .filter((x): x is (typeof flat)[number] => !!x);
    const leaning = afterCuts.find((x) => leansBack(x.s) || !SENTENCE_START.test(x.s));
    if (leaning) {
      fail(item, `the next sentence leans on it ("${leaning.s.slice(0, 60)}")`);
      continue;
    }
    // A piece the splitter cut out of a longer sentence: it ends on an abbreviation, has no end, starts in lower case,
    // or the line before it ends on an abbreviation ("Sales in the U.S." + "topped 2 million.").
    const clipped = flat.find(
      (x, k) =>
        isDoomed(x) &&
        (CLIPPED_END.test(x.s) ||
          !/[.!?]["'”’)]?\s*$/.test(x.s) ||
          !SENTENCE_START.test(x.s) ||
          (k > 0 && flat[k - 1]!.fi === x.fi && CLIPPED_END.test(flat[k - 1]!.s))),
    );
    if (clipped) {
      fail(item, `its sentence can't be told apart cleanly ("${clipped.s.slice(0, 60)}")`);
      continue;
    }
    // A paragraph left empty goes, but the chapter keeps at least two.
    const emptied = new Set(
      fields
        .map((f, fi) => fi)
        .filter((fi) =>
          splitSentences(fields[fi]!).every((_, si) =>
            doomed.has(`${fi}:${si}`),
          ),
        ),
    );
    if (fields.filter((f, fi) => f.trim() && !emptied.has(fi)).length < 2) {
      fail(item, "the chapter would be left with fewer than two paragraphs");
      continue;
    }
    const removed: string[] = [];
    for (const fi of new Set(at.map(([f]) => f))) {
      const kept = splitSentences(fields[fi]!).filter((s, si) => {
        if (!doomed.has(`${fi}:${si}`)) return true;
        removed.push(s.trim());
        settled.push(s);
        return false;
      });
      fields[fi] = kept.join(" ");
    }
    cut += sentenceWords;
    repairs.push({
      quote: item.quote,
      kind: "cut_sentence",
      from: removed.join(" "),
      to: "",
    });
  }
  const paragraphs = chapter.paragraphs
    .map((p, i) => ({ ...p, narration: fields[i]! }))
    .filter((p) => p.narration.trim());
  return {
    chapter: { ...chapter, paragraphs },
    repairs,
    unrepaired,
    cut,
    base,
  };
}

export type DocFactOutcome =
  | {
      ok: true;
      chapter: DocChapter;
      repairs: DocFactRepair[];
      cut: number;
      base: number;
    }
  | {
      ok: false;
      why: string;
      /** The fact check itself could not run: not a verdict, so the caller retries the step rather than drop or fail. */
      errored?: boolean;
      repairs: DocFactRepair[];
      /** What is still disputed (or could not be mended), for the record. */
      left: DocFactItem[];
    };

/**
 * DOC_FACT_DISCIPLINE's gate on a written chapter. `disputed` is the last check's list (undefined when that check could
 * not run, so the chapter is checked here first). Clean: kept as it is. Disputed: repaired and cut (repairDocChapter)
 * and checked once more; only a clean re-check keeps it. A check that cannot run is never read as clean.
 */
export async function disciplineChapter(o: {
  chapter: DocChapter;
  disputed: DocFactItem[] | undefined;
  check: (c: DocChapter) => Promise<DocFactItem[]>;
  maxCutShare?: number;
}): Promise<DocFactOutcome> {
  let disputed = o.disputed;
  if (!disputed) {
    try {
      disputed = await o.check(o.chapter);
    } catch {
      return {
        ok: false,
        why: "the fact check could not run on it",
        errored: true,
        repairs: [],
        left: [],
      };
    }
  }
  const base = words(o.chapter.paragraphs.map((p) => p.narration).join(" "));
  if (!disputed.length)
    return { ok: true, chapter: o.chapter, repairs: [], cut: 0, base };
  const r = repairDocChapter(o.chapter, disputed, {
    maxCutShare: o.maxCutShare,
  });
  if (r.unrepaired.length) {
    const first = r.unrepaired[0]!;
    return {
      ok: false,
      why: `${r.unrepaired.length} of ${disputed.length} disputed line${disputed.length === 1 ? "" : "s"} could not be mended or cut safely (first: "${first.quote.slice(0, 120)}", ${first.why})`,
      repairs: r.repairs,
      left: r.unrepaired.map(({ quote, problem }) => ({ quote, problem })),
    };
  }
  let again: DocFactItem[];
  try {
    again = await o.check(r.chapter);
  } catch {
    return {
      ok: false,
      why: "the re-check after the cuts could not run",
      errored: true,
      repairs: r.repairs,
      left: [],
    };
  }
  if (again.length)
    return {
      ok: false,
      why: `the re-check after the cuts still disputes ${again.length} line${again.length === 1 ? "" : "s"} (first: "${again[0]!.quote.slice(0, 120)}": ${again[0]!.problem.slice(0, 160)})`,
      repairs: r.repairs,
      left: again,
    };
  return {
    ok: true,
    chapter: r.chapter,
    repairs: r.repairs,
    cut: r.cut,
    base: r.base,
  };
}

/** One line for the record and Discord: what the gate mended and cut in a chapter. */
export function docFactLine(
  label: string,
  repairs: readonly DocFactRepair[],
): string {
  const cuts = repairs.filter(
    (r) => r.kind === "cut_sentence" || r.kind === "drop_clause",
  ).length;
  const mended = repairs.length - cuts;
  const parts = [
    ...(cuts ? [`${cuts} cut`] : []),
    ...(mended ? [`${mended} mended`] : []),
  ];
  const first = repairs[0];
  return `${label}: fact check: ${repairs.length} disputed line${repairs.length === 1 ? "" : "s"} settled (${parts.join(", ")})${first ? ` (first: "${first.from.slice(0, 140)}"${first.to ? ` -> "${first.to.slice(0, 140)}"` : ""})` : ""}.`;
}
