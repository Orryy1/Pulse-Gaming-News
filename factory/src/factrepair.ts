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
  kind: "rounding" | "soften" | "drop_sentence" | "drop_clause";
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
  /**
   * More blockers than this and nothing is repaired: the draft has deeper problems than a line or two.
   * Default 2 for a Short; 4 for a long video (LONG_SCRIPT_WORDS or more spoken words), where four lines are a
   * small share of the whole (21 Nov 2026: six long rankings in a night were lost on 3 to 7 lines each).
   */
  maxBlockers?: number;
  /** The most of the narration's words the cuts may remove (0-1). */
  maxCutShare?: number;
}

const NUMBER_WORD =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion";

/** A figure that can be rounded: "$30", "$1.99", "30 dollars", "thirty dollars", "forty percent", "12%". */
const FIGURE = new RegExp(
  [
    String.raw`[$£€]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand|k|m|bn)\b)?`,
    String.raw`\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b|dollars?\b|euros?\b|pounds?\b|bucks\b)`,
    String.raw`\b(?:${NUMBER_WORD})(?:[\s-](?:${NUMBER_WORD}|and|point))*\s+(?:dollars?|euros?|pounds?|percent|bucks)\b`,
    // Counts: "350,000 copies", "1.2 million players".
    String.raw`\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s?(?:million|billion|thousand)\b`,
  ].join("|"),
  "gi",
);

/** Already hedged: "about thirty dollars", "under two dollars". */
const HEDGED_BEFORE =
  /\b(?:about|around|almost|nearly|roughly|under|over|approximately|close to|more than|less than|just over|just under|some)\s*$/i;

/** The fact-check's own words for a figure said without its rounding. */
const ROUNDING_PROBLEM = /\bround(?:ing|ed|s)?\b/i;
/** "this is not a rounding difference": a wrong figure, which must never just get "about". */
const NOT_ROUNDING =
  /\bnot\s+(?:a\s+|just\s+|simply\s+|merely\s+)?(?:a\s+)?round/i;

/** A line that announces a rank: cutting it would leave a hole in the countdown. */
const ORDINAL =
  "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|last|\\d+(?:st|nd|rd|th)";
export const RANK_LINE = new RegExp(
  [
    String.raw`\bnumber\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\b`,
    String.raw`\bno\.\s?\d`,
    String.raw`#\s?\d`,
    String.raw`\b(?:${ORDINAL}|top)\s+(?:place|spot|position|pick)\b`,
    String.raw`\bcom(?:ing|es)\s+in\s+(?:at\s+)?(?:${ORDINAL}|number|\d)`,
    String.raw`\bat\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b`,
    String.raw`\b(?:in|takes?|grabs?|claims?)\s+(?:${ORDINAL})\b`,
  ].join("|"),
  "i",
);

/** A script this long (spoken words) is a long video, and more of its lines may be mended. */
export const LONG_SCRIPT_WORDS = 600;

/**
 * An absolute the checker objects to, and its softer word: "The quest marker always shows you where to go" ->
 * "usually shows you" (21 Nov 2026: the checker itself wrote 'Use "usually."'). Only when the problem calls the
 * claim an absolute, quotes the word, or offers the softer word, so a plainly wrong line is never just softened.
 */
const SOFTER: ReadonlyArray<readonly [RegExp, string]> = [
  [/\balways\b/i, "usually"],
  [/\bnever\b/i, "rarely"],
];
const ABSOLUTE_PROBLEM =
  /\b(?:an|this|that|the) absolute\b(?!\s+(?:number|terms|figures?|sales|value|amount|count|total)\b)|\babsolute (?:claim|statement|language|wording|assertion)\b|\babsolutes\b|\b(?:universal|sweeping) (?:claim|statement|assertion)\b|["'“‘]\s*(?:always|never)\s*["'”’]|\buse\s+["'“‘]?(?:usually|often|rarely|seldom|mostly)\b/i;

/** The sentence with its one quoted absolute softened, or undefined when there is not exactly one to soften. */
function softenAbsolute(sentence: string, quote: string): string | undefined {
  const q = lower(core(quote));
  if (!lower(sentence).includes(q)) return undefined;
  const found = SOFTER.flatMap(([re, to]) => {
    const all = [...q.matchAll(new RegExp(re.source, "gi"))];
    return all.length ? [{ re, to, n: all.length }] : [];
  });
  if (found.length !== 1 || found[0]!.n !== 1) return undefined;
  const { re, to } = found[0]!;
  // The absolute inside the quoted part of the sentence, and only there.
  const at = lower(sentence).indexOf(q);
  const part = sentence.slice(at, at + q.length);
  if (lower(part) !== q) return undefined;
  // Only a bare "always"/"never": "almost always", "as always", "never once", "never-ending" would read wrongly.
  const m = re.exec(part);
  if (!m) return undefined;
  const pre = part.slice(0, m.index);
  const post = part.slice(m.index + m[0].length);
  if (/\b(?:almost|nearly|virtually|practically|as|like|quite|not)\s*$/i.test(pre)) return undefined;
  if (/^(?:-|\s+(?:once|ever|again|mind)\b)/i.test(post)) return undefined;
  // Shouted "ALWAYS" would come back as "Usually": leave it to the cut.
  if (m[0] === m[0].toUpperCase()) return undefined;
  const softened = part.replace(re, (w) => (w[0] === w[0]!.toUpperCase() ? to[0]!.toUpperCase() + to.slice(1) : to));
  if (softened === part) return undefined;
  return sentence.slice(0, at) + softened + sentence.slice(at + q.length);
}

/** "but I put Vice City first": what is left after the cut clause must still be a sentence of its own. */
const LEADING_JOIN = /^\s*[,;:]\s*(?:but|yet|though|although|still)\b[\s,]*/i;
const TRAILING_JOIN =
  /\s*[,;:]\s*(?:but|yet|and|so|though|although|while)\s*$/i;

export const SENTENCE_SPLIT = /(?<=[.?!])\s+/;
const TRAILING_PUNCT = /[\s.,;:!?"'“”‘’]+$/;
const LEADING_PUNCT = /^[\s"'“”‘’]+/;

export const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
export const core = (t: string) =>
  t.replace(TRAILING_PUNCT, "").replace(LEADING_PUNCT, "").trim();
export const lower = (t: string) =>
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

export interface Located {
  field: string;
  sentence: string;
  index: number; // sentence position within the field
  fieldIndex: number;
}

/** The raw sentence whose spoken form contains the quote (the checker reads the spoken script). */
export function locate(
  fields: readonly string[],
  quote: string,
  speak: (t: string) => string,
): Located | undefined {
  const q = lower(core(quote));
  if (!q) return undefined;
  const hits: Located[] = [];
  for (let f = 0; f < fields.length; f++) {
    const sentences = fields[f]!.split(SENTENCE_SPLIT).filter((x) => x.trim());
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i]!;
      if (lower(s).includes(q) || lower(speak(s)).includes(q))
        hits.push({ field: fields[f]!, sentence: s, index: i, fieldIndex: f });
    }
  }
  // A quote found in two different sentences is ambiguous: never guess which one the checker meant.
  return new Set(hits.map((h) => h.sentence)).size === 1 ? hits[0] : undefined;
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
  // Only the figure the checker quoted, never a neighbour that happens to be the sentence's only figure.
  const pick = quoted.length === 1 ? quoted[0] : undefined;
  if (!pick || pick.index === undefined) return undefined;
  let at = pick.index;
  // "US$30", "C$30": the currency prefix belongs to the figure.
  while (at > 0 && /[A-Za-z]/.test(sentence[at - 1]!)) at--;
  let before = sentence.slice(0, at);
  if (at > 0 && /\S/.test(sentence[at - 1]!)) return undefined; // glued to a word: can't place "about"
  if (HEDGED_BEFORE.test(before)) return undefined;
  // "costs a hundred dollars" -> "costs about a hundred dollars" would read oddly: "costs about one hundred dollars".
  let rest = sentence.slice(at);
  if (
    /\ba\s+$/i.test(before) &&
    /^(?:hundred|thousand|million|billion)\b/i.test(rest)
  ) {
    before = before.replace(/\ba\s+$/i, "");
    rest = `one ${rest}`;
  }
  const word = at === 0 || /^\s*["'“‘]?$/.test(before) ? "About" : "about";
  return `${before}${word} ${rest}`;
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
  // The cut opening clause must be a whole subject and claim (3+ words), not just "Most critics".
  if (!before.trim() && words(q) >= 3 && LEADING_JOIN.test(after)) {
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
  const total = words(fields.join(" "));
  const maxBlockers = opts.maxBlockers ?? (total >= LONG_SCRIPT_WORDS ? 4 : 2);
  const maxCutShare = opts.maxCutShare ?? 0.15;
  const out: RepairResult = { fixes: [], repairs: [], unrepaired: [] };
  if (!blockers.length) return out;
  if (blockers.length > maxBlockers)
    return { ...out, unrepaired: [...blockers] };
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
    if (
      ROUNDING_PROBLEM.test(parsed.problem) &&
      NOT_ROUNDING.test(parsed.problem)
    ) {
      out.unrepaired.push(blocker);
      continue;
    }
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
    // An absolute the checker objects to is softened in place (nothing is cut, so the hook and rank lines may take it).
    if (ABSOLUTE_PROBLEM.test(parsed.problem)) {
      const to = softenAbsolute(at.sentence, parsed.quote);
      if (to) {
        touched.add(at.sentence);
        out.fixes.push({ from: at.sentence, to });
        out.repairs.push({ quote: parsed.quote, kind: "soften", from: at.sentence, to });
        continue;
      }
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
      // Take the space before a later sentence (it may end its field, as a long video's outro does), or the
      // space after an opening one; either way the cut text must occur only once in its field.
      const once = (x: string) => field.split(x).length === 2;
      if (at.index > 0 && once(` ${at.sentence}`)) from = ` ${at.sentence}`;
      else if (at.index === 0 && once(`${at.sentence} `))
        from = `${at.sentence} `;
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
