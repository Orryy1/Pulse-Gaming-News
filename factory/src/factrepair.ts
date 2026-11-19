/**
 * FACT_REPAIR: a last, surgical fix for a script whose fact-check still fails after the writer's one rewrite.
 *
 * On 19 Nov three ranking Shorts in a row were thrown away over a single line each: "now costs thirty dollars"
 * (the store says $29.99, said without "about"), "Most lists rank Grand Theft Auto 5 higher" and "one pick goes
 * against the usual order" (an unsupported consensus). Rather than lose the whole Short, this module mends just
 * those lines without a model: a rounded figure gets "about" in front, and a side line the sources don't support
 * is cut (the whole sentence, or the clause before "but" or after a comma). The caller fact-checks the mended
 * script again and only ships it if that check passes, so nothing unsupported can go out this way.
 *
 * Pure and deterministic. It refuses (leaves the blocker unrepaired) whenever a cut could break the script:
 * the hook, a rank announcement, a field that would be left empty, too many blockers or too many words cut.
 */

export interface RepairFix {
  from: string;
  to: string;
}

export interface Repair {
  quote: string;
  kind: "rounding" | "drop_sentence" | "drop_clause";
  from: string;
  to: string;
}

export interface RepairResult {
  fixes: RepairFix[];
  repairs: Repair[];
  /** The blockers it could not mend safely; any here means the script must still fail. */
  unrepaired: string[];
}

export interface RepairOptions {
  /** More blockers than this and nothing is repaired: the draft has deeper problems than a line or two. */
  maxBlockers?: number;
  /** The most of the narration's words the cuts may remove (0-1). */
  maxCutShare?: number;
}

const NUMBER_WORD =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion";

/** A figure that can be rounded: "$30", "$1.99", "30 dollars", "thirty dollars", "forty percent", "12%". */
const FIGURE = new RegExp(
  [
    String.raw`[$£€]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand|k|m|bn))?`,
    String.raw`\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b|dollars?\b|euros?\b|pounds?\b|bucks\b)`,
    String.raw`\b(?:${NUMBER_WORD})(?:[\s-](?:${NUMBER_WORD}|and|point))*\s+(?:dollars?|euros?|pounds?|percent|bucks)\b`,
  ].join("|"),
  "gi",
);

/** Already hedged: "about thirty dollars", "under two dollars". */
const HEDGED_BEFORE =
  /\b(?:about|around|almost|nearly|roughly|under|over|approximately|close to|more than|less than|just over|just under|some)\s*$/i;

/** The fact-check's own words for a figure said without its rounding. */
const ROUNDING_PROBLEM = /\bround(?:ing|ed|s)?\b/i;

/** A line that announces a rank: cutting it would leave a hole in the countdown. */
const RANK_LINE =
  /\bnumber\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b|\b(?:first|top|last)\s+(?:place|spot)\b|#\s?\d|\bat\s+(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

/** "but I put Vice City first": what is left after the cut clause must still be a sentence of its own. */
const LEADING_JOIN =
  /^\s*[,;:]?\s*(?:but|yet|though|although|and|so|still)\b[\s,]*/i;
const TRAILING_JOIN =
  /\s*[,;:]\s*(?:but|yet|and|so|though|although|while|which)?\s*$/i;

const SENTENCE_SPLIT = /(?<=[.?!])\s+/;
const TRAILING_PUNCT = /[\s.,;:!?"'“”‘’]+$/;
const LEADING_PUNCT = /^[\s"'“”‘’]+/;

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const core = (t: string) =>
  t.replace(TRAILING_PUNCT, "").replace(LEADING_PUNCT, "").trim();
const lower = (t: string) =>
  t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

/** Splits "Fact-check: "<quote>" - <problem>" into its parts; anything else is not a repairable blocker. */
export function parseBlocker(
  blocker: string,
): { quote: string; problem: string } | undefined {
  const head = 'Fact-check: "';
  if (!blocker.startsWith(head)) return undefined;
  const end = blocker.indexOf('" - ', head.length);
  if (end < 0) return undefined;
  const quote = blocker.slice(head.length, end).trim();
  const problem = blocker.slice(end + 4).trim();
  return quote ? { quote, problem } : undefined;
}

interface Located {
  field: string;
  sentence: string;
  index: number; // sentence position within the field
  fieldIndex: number;
}

/** The raw sentence whose spoken form contains the quote (the checker reads the spoken script). */
function locate(
  fields: readonly string[],
  quote: string,
  speak: (t: string) => string,
): Located | undefined {
  const q = lower(core(quote));
  if (!q) return undefined;
  for (let f = 0; f < fields.length; f++) {
    const sentences = fields[f]!.split(SENTENCE_SPLIT).filter((x) => x.trim());
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i]!;
      if (lower(s).includes(q) || lower(speak(s)).includes(q))
        return { field: fields[f]!, sentence: s, index: i, fieldIndex: f };
    }
  }
  return undefined;
}

/** "about" before the rounded figure the quote says; undefined when the figure can't be pinned down. */
function hedgeFigure(
  sentence: string,
  quote: string,
  speak: (t: string) => string,
): string | undefined {
  const q = lower(core(quote));
  const figures = [...sentence.matchAll(FIGURE)];
  // The figure the checker quoted: in the quote as written, or as it is spoken.
  const quoted = figures.filter(
    (m) => q.includes(lower(m[0])) || q.includes(lower(speak(m[0]))),
  );
  const pick =
    quoted.length === 1
      ? quoted[0]
      : figures.length === 1
        ? figures[0]
        : undefined;
  if (!pick || pick.index === undefined) return undefined;
  const before = sentence.slice(0, pick.index);
  if (HEDGED_BEFORE.test(before)) return undefined;
  return `${before}about ${sentence.slice(pick.index)}`;
}

const capitalise = (t: string) =>
  t.replace(
    /^(\s*["'“‘]?)([a-z])/,
    (_m, p: string, c: string) => p + c.toUpperCase(),
  );

/** The sentence with the quoted clause cut, or undefined when the cut would not leave a clean sentence. */
function cutClause(sentence: string, quote: string): string | undefined {
  const q = core(quote);
  const at = lower(sentence).indexOf(lower(q));
  if (at < 0) return undefined;
  const before = sentence.slice(0, at);
  const after = sentence.slice(at + q.length);
  const end = (sentence.match(/[.?!]["'”’]?\s*$/)?.[0] ?? ".").trim();
  // Opening clause: "Most lists rank GTA 5 higher, but I put Vice City first."
  if (!before.trim() && LEADING_JOIN.test(after)) {
    const rest = after.replace(LEADING_JOIN, "").trim();
    if (words(rest) >= 3) return capitalise(rest);
  }
  // Closing clause: "Vice City tops my list, and one pick goes against the usual order."
  if (!core(after) && TRAILING_JOIN.test(before)) {
    const rest = before.replace(TRAILING_JOIN, "").trim();
    if (words(rest) >= 3) return `${rest}${end}`;
  }
  return undefined;
}

/**
 * Mends the blockers it can. `fields` are the script's spoken strings exactly as the writer's draft holds them
 * (hook, each beat's narration, the take, the loop line); `speak` turns raw text into what the checker heard.
 */
export function repairBlockers(
  fields: readonly string[],
  blockers: readonly string[],
  speak: (t: string) => string = (t) => t,
  opts: RepairOptions = {},
): RepairResult {
  const maxBlockers = opts.maxBlockers ?? 2;
  const maxCutShare = opts.maxCutShare ?? 0.15;
  const out: RepairResult = { fixes: [], repairs: [], unrepaired: [] };
  if (!blockers.length) return out;
  if (blockers.length > maxBlockers)
    return { ...out, unrepaired: [...blockers] };
  const total = words(fields.join(" "));
  let cut = 0;
  const firstField = fields.findIndex((f) => f.trim());
  const touched = new Set<string>();
  for (const blocker of blockers) {
    const parsed = parseBlocker(blocker);
    const at = parsed && locate(fields, parsed.quote, speak);
    if (!parsed || !at || touched.has(at.sentence)) {
      out.unrepaired.push(blocker);
      continue;
    }
    // A rounded figure: hedge it, never cut it.
    if (ROUNDING_PROBLEM.test(parsed.problem)) {
      const to = hedgeFigure(at.sentence, parsed.quote, speak);
      if (!to) {
        out.unrepaired.push(blocker);
        continue;
      }
      touched.add(at.sentence);
      out.fixes.push({ from: at.sentence, to });
      out.repairs.push({
        quote: parsed.quote,
        kind: "rounding",
        from: at.sentence,
        to,
      });
      continue;
    }
    // Anything else is cut, but never the hook, a rank announcement or a whole field.
    const isHook = at.fieldIndex === firstField && at.index === 0;
    if (isHook || RANK_LINE.test(at.sentence)) {
      out.unrepaired.push(blocker);
      continue;
    }
    const qWords = words(core(parsed.quote));
    const sWords = words(at.sentence);
    if (qWords >= 0.7 * sWords) {
      const field = at.field;
      let from: string | undefined;
      if (field.includes(`${at.sentence} `)) from = `${at.sentence} `;
      else if (field.includes(` ${at.sentence}`)) from = ` ${at.sentence}`;
      if (!from || cut + sWords > maxCutShare * total) {
        out.unrepaired.push(blocker);
        continue;
      }
      cut += sWords;
      touched.add(at.sentence);
      out.fixes.push({ from, to: "" });
      out.repairs.push({
        quote: parsed.quote,
        kind: "drop_sentence",
        from: at.sentence,
        to: "",
      });
      continue;
    }
    const to = cutClause(at.sentence, parsed.quote);
    if (!to || cut + qWords > maxCutShare * total) {
      out.unrepaired.push(blocker);
      continue;
    }
    cut += qWords;
    touched.add(at.sentence);
    out.fixes.push({ from: at.sentence, to });
    out.repairs.push({
      quote: parsed.quote,
      kind: "drop_clause",
      from: at.sentence,
      to,
    });
  }
  return out;
}
