// The humaniser's sentence rules (pure): repetition (rule 3), spoken register (rule 4), AI tells and em dashes
// (rule 5), filler (rule 9) and attribution variety (rule 10). Each rule reports what it finds; in fix mode it also
// makes the changes it can make safely (a contraction, a plainer connective, a dropped filler word) and leaves the
// rest as exact notes for one rewrite by the writer. No rule ever changes a figure, a name or a quotation.

import {
  atSentenceStart,
  capitalise,
  maskQuotes,
  sentences,
  stem,
  tidy,
  unmaskQuotes,
  wordsOf,
} from "./text.ts";

export type RuleId =
  | "naming"
  | "repetition.near"
  | "repetition.opening"
  | "repetition.connective"
  | "repetition.shape"
  | "register.contraction"
  | "register.formal"
  | "register.rhythm"
  | "aitell"
  | "emdash"
  | "numbers"
  | "dates"
  | "callback"
  | "filler"
  | "attribution";

export interface Finding {
  rule: RuleId;
  /** What was found, quoted where it helps. */
  text: string;
  /** The exact note for the writer when the fix needs a rewrite. */
  note?: string;
}

export interface RuleOutput {
  segments: string[];
  findings: Finding[];
}

export interface RuleContext {
  fix: boolean;
  format: "short" | "long";
  /** Segments never edited. */
  locked?: boolean[];
}

/** Runs a per-segment text transform on unlocked segments with quotations masked (pure). */
function mapSegments(
  segments: string[],
  ctx: RuleContext,
  f: (text: string, index: number) => string,
): string[] {
  if (!ctx.fix) return segments;
  return segments.map((s, i) => {
    if (ctx.locked?.[i]) return s;
    const m = maskQuotes(s);
    const t = f(m.text, i);
    return t === m.text ? s : unmaskQuotes(t, m.quotes);
  });
}

const keepCase = (from: string, to: string) =>
  /^[A-Z]/.test(from) ? to[0]!.toUpperCase() + to.slice(1) : to;

// ---------------------------------------------------------------- rule 5: em dashes and AI tells

/** Em dashes, and spaced en dashes used as dashes, said as the pause they are: a comma. */
export function emDashes(segments: string[], ctx: RuleContext): RuleOutput {
  const findings: Finding[] = [];
  for (const s of segments)
    for (const _ of maskQuotes(s).text.matchAll(/—|\s–\s/g))
      findings.push({ rule: "emdash", text: "em dash" });
  // A pair of dashes around an aside becomes a pair of commas; a single dash joining two thoughts becomes a full
  // stop ("returning—don't expect it soon" is "returning. Don't expect it soon."), never a comma splice.
  const DASH = /\s*—\s*|\s+–\s+/g;
  const out = mapSegments(segments, ctx, (t) =>
    sentences(t)
      .map((sentence) => {
        const n = (sentence.match(DASH) ?? []).length;
        if (!n) return sentence;
        if (n % 2 === 0)
          return sentence.replace(DASH, ", ").replace(/,\s*([.!?;:])/g, "$1");
        return sentence
          .replace(DASH, (_m: string) => ". ")
          .replace(
            /\.\s+([a-z])/g,
            (_m: string, c: string) => `. ${c.toUpperCase()}`,
          )
          .replace(/\.\s*([.!?])/g, "$1");
      })
      .join(" "),
  );
  return { segments: out, findings };
}

interface Tell {
  re: RegExp;
  /** The plain wording; undefined means a writer note only. */
  to?: string | ((m: string, ...g: string[]) => string);
  note: string;
}

/** Words and patterns that read as machine-written, with the plain wording where a swap is safe. */
export const AI_TELLS: Tell[] = [
  {
    re: /\bdelv(e|es|ed|ing)\s+into\b/gi,
    to: (m, g: string) =>
      keepCase(
        m,
        `${{ e: "dig", es: "digs", ed: "dug", ing: "digging" }[g.toLowerCase()] ?? "dig"} into`,
      ),
    note: 'Say "dig into", not "delve into".',
  },
  {
    re: /\b(?:a |is a |stands as a )?testament to\b/gi,
    to: (m) => keepCase(m, /^is /i.test(m) ? "says a lot about" : "proof of"),
    note: 'Drop "testament to"; say what it proves.',
  },
  {
    re: /\bgame[- ]changers?\b/gi,
    to: (m) => keepCase(m, /s$/i.test(m) ? "big deals" : "big deal"),
    note: 'Say "big deal" or what changes, not "game-changer".',
  },
  {
    re: /\bgame[- ]changing\b/gi,
    to: (m) => keepCase(m, "huge"),
    note: 'Say what changes, not "game-changing".',
  },
  {
    re: /\b(?:a |the )?(?:rich |vibrant )?tapestry of\b/gi,
    to: (m) => keepCase(m, /^the /i.test(m) ? "the mix of" : "a mix of"),
    note: 'Say "mix of", not "tapestry".',
  },
  {
    re: /\b(gaming|industry|console|games|competitive|esports|indie|streaming|media|tech|modding|market|current|modern|live-service|AAA) landscape\b/gi,
    to: (_m, g: string) => `${g} scene`,
    note: 'Say "scene" or "market", not "landscape" (unless it is real scenery).',
  },
  {
    re: /\b(?:it(?:'s| is) )?worth noting(?: that)?,?\s*/gi,
    to: "",
    note: 'Drop "it\'s worth noting"; just say it.',
  },
  {
    re: /\blet'?s dive (?:right )?in\b[.!]?\s*/gi,
    to: "",
    note: 'Drop "let\'s dive in".',
  },
  {
    re: /\bdiv(e|es|ing) (?:deep )?into\b/gi,
    to: (m, g: string) =>
      keepCase(
        m,
        `${{ e: "get", es: "gets", ing: "getting" }[g.toLowerCase()] ?? "get"} into`,
      ),
    note: 'Say "get into", not "dive into".',
  },
  { re: /\bbuckle up\b[,.!]?\s*/gi, to: "", note: 'Drop "buckle up".' },
  { re: /\bboasts\b/g, to: "has", note: 'Say "has", not "boasts".' },
  {
    re: /\b(?:a )?(?:plethora|myriad) of\b/gi,
    to: (m) => keepCase(m, "loads of"),
    note: 'Say "loads of", not "plethora" or "myriad".',
  },
  {
    re: /\bpivotal\b/gi,
    to: (m) => keepCase(m, "key"),
    note: 'Say "key", not "pivotal".',
  },
  {
    re: /\bseamless(ly)?\b/gi,
    to: (m, ly?: string) => keepCase(m, ly ? "smoothly" : "smooth"),
    note: 'Say "smooth", not "seamless".',
  },
  {
    re: /\bever-evolving\b/gi,
    to: (m) => keepCase(m, "always changing"),
    note: 'Say "always changing", not "ever-evolving".',
  },
  {
    re: /\b(stands|serves) as (a|an|the)\b/gi,
    to: (m, _v: string, a: string) => keepCase(m, `is ${a}`),
    note: 'Say "is", not "stands as" or "serves as".',
  },
  { re: /\bembark(?:s|ed|ing)? on\b/gi, note: 'Say "start", not "embark on".' },
  {
    re: /\bin a world where\b/gi,
    note: 'Cut "in a world where"; start with the fact.',
  },
  {
    re: /\bunleash(?:es|ed|ing)?\b/gi,
    note: 'Say what it does, not "unleash".',
  },
  {
    re: /\belevat(?:e|es|ed|ing)\b/gi,
    note: 'Say what gets better, not "elevate".',
  },
  { re: /\brealm of\b/gi, note: 'Cut "the realm of".' },
  {
    re: /\bnavigat(?:e|es|ing) the (?:complexities|challenges|world)\b/gi,
    note: 'Cut "navigate the complexities"; say the problem.',
  },
];

const TELL_PROBE = (t: Tell) =>
  new RegExp(
    t.re.source,
    t.re.flags.includes("g") ? t.re.flags : `${t.re.flags}g`,
  );

export function aiTells(segments: string[], ctx: RuleContext): RuleOutput {
  const findings: Finding[] = [];
  const all = segments.map((s) => maskQuotes(s).text).join(" ");
  for (const t of AI_TELLS)
    for (const m of all.matchAll(TELL_PROBE(t)))
      findings.push({
        rule: "aitell",
        text: `"${m[0].trim()}"`,
        ...(t.to === undefined ? { note: t.note } : {}),
      });
  // "Not just X but Y" once is a turn of phrase; twice is a template.
  const notJust =
    all.match(/\bnot (?:just|only|merely)\b[^.?!]*?\bbut\b/gi) ?? [];
  if (notJust.length > 1)
    findings.push({
      rule: "aitell",
      text: `"not just X but Y" ${notJust.length} times`,
      note: `"Not just X, but Y" comes ${notJust.length} times; keep one and say the others straight.`,
    });
  // Lists of three everywhere: one is natural, a habit is a tell.
  const triples =
    all.match(
      /\b[\w'’-]+(?: [\w'’-]+){0,2}, [\w'’-]+(?: [\w'’-]+){0,2},? and [\w'’-]+/g,
    ) ?? [];
  const tripleCap =
    ctx.format === "short"
      ? 1
      : Math.max(2, Math.ceil(wordsOf(all).length / 250));
  if (triples.length > tripleCap)
    findings.push({
      rule: "aitell",
      text: `${triples.length} lists of three`,
      note: `There are ${triples.length} lists of three ("${triples[1]}"); keep ${tripleCap === 1 ? "one" : tripleCap} and give the rest two items or one strong one.`,
    });
  // Rhetorical questions stacked back to back.
  const ss = sentences(all);
  for (let i = 1; i < ss.length; i++)
    if (/\?["”]?$/.test(ss[i]!) && /\?["”]?$/.test(ss[i - 1]!))
      findings.push({
        rule: "aitell",
        text: `stacked questions "${ss[i - 1]} ${ss[i]}"`,
        note: `Two questions in a row ("${ss[i - 1]} ${ss[i]}"); keep one and answer it.`,
      });
  const out = mapSegments(segments, ctx, (t) => {
    let x = t;
    for (const tell of AI_TELLS)
      if (tell.to !== undefined)
        x = x.replace(TELL_PROBE(tell), tell.to as never);
    return x === t ? t : tidy(x);
  });
  return { segments: out, findings };
}

// ---------------------------------------------------------------- rule 4: spoken register

const CONTRACT: Array<[RegExp, (m: string, ...g: string[]) => string]> = [
  [
    /\b(it|that|there|here|what|he|she) is not\b(?! only)/gi,
    (_m, a: string) => `${a}'s not`,
  ],
  [/\b(you|we|they) are not\b(?! only)/gi, (_m, a: string) => `${a}'re not`],
  [/\bwill not\b/gi, (m) => keepCase(m, "won't")],
  [/\b(?:cannot|can not)\b/gi, (m) => keepCase(m, "can't")],
  [
    /\b(do|does|did|is|are|was|were|has|have|had|could|would|should) not\b(?! only)/gi,
    (_m, a: string) => `${a}n't`,
  ],
  [
    /\b(it|that|there|here|what|who|he|she) is\b(?!\s*(?:[,.;:!?]|$))(?! (?:not only|to be))/gi,
    (_m, a: string) => `${a}'s`,
  ],
  [
    /\b(you|we|they) are\b(?!\s*(?:[,.;:!?]|$))/gi,
    (_m, a: string) => `${a}'re`,
  ],
  [/\bI am\b(?!\s*(?:[,.;:!?]|$))/g, () => "I'm"],
  [
    /\b(I|you|we|they) have (been|got|had|seen|never|always|just|already|done|made|played|heard|waited)\b/gi,
    (_m, a: string, b: string) => `${a}'ve ${b}`,
  ],
  [
    /\b(it|that|there|he|she) has (been|got|had|never|always|just|already|become|gone|come|made|sold|done)\b/gi,
    (_m, a: string, b: string) => `${a}'s ${b}`,
  ],
  [
    /\b(I|you|we|they|it|that|there|he|she) will (?=[a-z])/gi,
    (_m, a: string) => `${a}'ll `,
  ],
  [/\b(I|you|we|they|he|she) would (?=[a-z])/gi, (_m, a: string) => `${a}'d `],
  [/\blet us (?=[a-z])/gi, (m) => keepCase(m, "let's ")],
];

const FORMAL: Array<[RegExp, string, string]> = [
  [/(^|[.!?]["”]?\s+)However,\s+/g, "$1But ", '"However"'],
  [
    /(^|[.!?]["”]?\s+)(?:Additionally|Furthermore|Moreover|In addition),\s+/g,
    "$1Plus, ",
    '"Additionally"',
  ],
  [
    /(^|[.!?]["”]?\s+)(?:Consequently|Therefore|Thus|Hence),\s+/g,
    "$1So ",
    '"Therefore"',
  ],
  [
    /(^|[.!?]["”]?\s+)(?:Nevertheless|Nonetheless),\s+/g,
    "$1Still, ",
    '"Nevertheless"',
  ],
  [/(^|[.!?]["”]?\s+)In conclusion,\s+/g, "$1", '"In conclusion"'],
  [/\bin order to\b/g, "to", '"in order to"'],
  [/\bprior to\b/g, "before", '"prior to"'],
  [/\bapproximately\b/g, "about", '"approximately"'],
  [/\butili[sz](e|es|ed|ing)\b/g, "us$1", '"utilize"'],
  [/\bcommence(s|d)?\b/g, "start", '"commence"'],
  [/\bto purchase\b/g, "to buy", '"to purchase"'],
  [/\bindividuals\b/g, "people", '"individuals"'],
];

export function register(segments: string[], ctx: RuleContext): RuleOutput {
  const findings: Finding[] = [];
  const all = segments.map((s) => maskQuotes(s).text).join(" ");
  for (const [re] of CONTRACT)
    for (const m of all.matchAll(re))
      findings.push({ rule: "register.contraction", text: `"${m[0].trim()}"` });
  for (const [re, , label] of FORMAL)
    for (const _ of all.matchAll(re))
      findings.push({ rule: "register.formal", text: label });
  // Rhythm: every sentence the same length is a drone; a spoken script mixes short and long.
  const lens = sentences(all).map((s) => wordsOf(s).length);
  if (lens.length >= 5) {
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(
      lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length,
    );
    if (sd / mean < 0.3)
      findings.push({
        rule: "register.rhythm",
        text: `flat rhythm (${Math.round(mean)} words a sentence, little variation)`,
        note: `Every sentence runs about ${Math.round(mean)} words; break one into a short punchy line and let another run longer.`,
      });
    if (mean > 22)
      findings.push({
        rule: "register.rhythm",
        text: `long sentences (${Math.round(mean)} words on average)`,
        note: `Sentences average ${Math.round(mean)} words; split the longest so each says one thing.`,
      });
  }
  const out = mapSegments(segments, ctx, (t) => {
    let x = t;
    for (const [re, to] of CONTRACT) x = x.replace(re, to as never);
    for (const [re, to] of FORMAL) x = x.replace(re, to);
    return x;
  });
  return { segments: out, findings };
}

// ---------------------------------------------------------------- rule 9: filler

const FILLERS = [
  "honestly",
  "here's the thing",
  "look",
  "listen",
  "basically",
  "literally",
  "frankly",
  "to be fair",
  "let's be real",
  "real talk",
  "i mean",
  "you know what",
  "simply put",
  "truth be told",
  "at the end of the day",
  "make no mistake",
];
const FILLER_RE = new RegExp(
  `\\b(${FILLERS.map((f) => f.replace(/'/g, "['’]").replace(/ /g, "\\s+")).join("|")})\\b`,
  "gi",
);
// "Look" and "listen" are filler only as an opener with a comma ("Look, ..."), never "look at" or "listen to".
const isFiller = (text: string, index: number, word: string) =>
  !/^(look|listen)$/i.test(word) ||
  (atSentenceStart(text, index) &&
    /^[,]/.test(text.slice(index + word.length)));

/** Filler words: a few make it sound human, a habit makes it a tic. Caps total and per phrase (pure). */
export function filler(segments: string[], ctx: RuleContext): RuleOutput {
  const findings: Finding[] = [];
  const words = wordsOf(segments.join(" ")).length;
  const totalCap =
    ctx.format === "short" ? 1 : Math.max(1, Math.ceil(words / 150));
  const eachCap =
    ctx.format === "short" ? 1 : Math.max(1, Math.ceil(words / 600));
  let total = 0;
  const per = new Map<string, number>();
  const over = (key: string) => {
    total++;
    per.set(key, (per.get(key) ?? 0) + 1);
    return total > totalCap || per.get(key)! > eachCap;
  };
  const out = segments.map((s, i) => {
    const m = maskQuotes(s);
    let t = m.text;
    const hits = [...t.matchAll(FILLER_RE)].filter((h) =>
      isFiller(t, h.index!, h[0]),
    );
    const drop: Array<[number, number]> = [];
    for (const h of hits) {
      const key = h[0].toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ");
      if (!over(key)) continue;
      // Only an opener with its comma or question mark can go without a rewrite ("Honestly, it's late" or "Honestly?").
      const opener =
        atSentenceStart(t, h.index!) &&
        /^[,?]\s*/.test(t.slice(h.index! + h[0].length));
      findings.push({
        rule: "filler",
        text: `"${h[0]}" over the cap`,
        ...(opener
          ? {}
          : {
              note: `"${h[0]}" is used past the cap (${totalCap} a ${ctx.format === "short" ? "Short" : "stretch"}); cut it or say something specific.`,
            }),
      });
      if (opener)
        drop.push([
          h.index!,
          h.index! +
            h[0].length +
            (t.slice(h.index! + h[0].length).match(/^[,?]\s*/)?.[0].length ??
              0),
        ]);
    }
    if (!ctx.fix || ctx.locked?.[i] || !drop.length) return s;
    for (const [a, b] of drop.reverse()) t = t.slice(0, a) + t.slice(b);
    return unmaskQuotes(tidy(t), m.quotes);
  });
  return { segments: out, findings };
}

// ---------------------------------------------------------------- rule 10: attribution variety

/** A repeated "According to X," said the way a person would the second time: "X says" (pure). */
export function attribution(segments: string[], ctx: RuleContext): RuleOutput {
  const findings: Finding[] = [];
  const seen = new Map<string, number>();
  const ACC =
    /(^|[.!?]["”]?\s+)According to ((?:the )?[A-Z][\w'’&+-]*(?:\s+[A-Z][\w'’&+-]*){0,3}),\s+/g;
  const out = segments.map((s, i) => {
    const m = maskQuotes(s);
    const t = m.text.replace(
      ACC,
      (
        whole: string,
        lead: string,
        who: string,
        offset: number,
        all: string,
      ) => {
        const key = who.toLowerCase().replace(/^the /, "");
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        if (n < 2) return whole;
        findings.push({
          rule: "attribution",
          text: `"According to ${who}" again`,
        });
        if (!ctx.fix || ctx.locked?.[i]) return whole;
        // "According to IGN, the game..." becomes "IGN says the game...": the credit stays, the frame changes.
        return `${lead}${who.replace(/^the /, "The ")} says `;
      },
    );
    // The word after "says" goes lower case unless it is a name.
    const fixed = t.replace(
      /(\bsays )([A-Z])([a-z]+)\b/g,
      (whole: string, says: string, c: string, rest: string) =>
        /^(?:The|A|An|It|This|That|These|Those|There|Its|Their|They|He|She|We|You)$/.test(
          c + rest,
        )
          ? `${says}${c.toLowerCase()}${rest}`
          : whole,
    );
    return fixed === m.text ? s : unmaskQuotes(fixed, m.quotes);
  });
  // A "says" frame three times is a template even with different names.
  const all = out.join(" ");
  const says =
    all.match(
      /\b[A-Z][\w'’&+-]*(?:\s+[A-Z][\w'’&+-]*){0,2} (?:says|said)\b/g,
    ) ?? [];
  const cap =
    ctx.format === "short"
      ? 2
      : Math.max(3, Math.ceil(wordsOf(all).length / 300));
  if (says.length > cap)
    findings.push({
      rule: "attribution",
      text: `${says.length} "X says" credits`,
      note: `"... says" credits ${says.length} times; vary them ("told IGN", "in its own post", "on the earnings call") or drop the credit on a settled fact that isn't a number or a quote.`,
    });
  return { segments: ctx.fix ? out : segments, findings };
}

// ---------------------------------------------------------------- rule 3: repetition

const STOP = new Set(
  "about above after again against all also always among another around because before being below between both cannot could doing during each either every everyone everything first from further going gonna great having here hers herself himself however into itself just least less little maybe might more most much must myself never next none nothing other others ought ours ourselves over really right same several shall should since some something still such than that that's their theirs them themselves then there there's these they they're thing things think this those though through today under until upon very what what's when where whether which while whole whose with within without would years year yours yourself game games player players people still those every first while again it's isn't doesn't don't won't can't you're you've we're they've".split(
    " ",
  ),
);

// Everyday verbs repeat in speech without anyone noticing; the rule is for nouns and names.
const COMMON_VERBS = new Set(
  "make start mean include confirm keep take give come leave bring show find look feel seem play change need want check choose think know"
    .split(" ")
    .flatMap((v) => [v, stem(`${v}s`)]),
);

const STARTERS = new Set(
  "and but so plus also still then now it it's that that's this there there's i i'd i'm you here what honestly meanwhile because if when".split(
    " ",
  ),
);
const DROPPABLE_STARTERS =
  /^(?:And|Plus,?|Also,?|Now,?|Meanwhile,?|Then,?|Honestly,?|On top of that,?|What's more,?)\s+/;

const CONNECTIVES = [
  "but",
  "so",
  "and",
  "plus",
  "also",
  "still",
  "yet",
  "then",
  "now",
  "meanwhile",
  "however",
  "instead",
  "besides",
  "even so",
  "that said",
  "on top of that",
  "what's more",
  "which means",
  "that means",
  "in fact",
  "after all",
  "of course",
];
const ADDITIVE = new Set([
  "and",
  "plus",
  "also",
  "now",
  "meanwhile",
  "on top of that",
  "what's more",
  "in fact",
  "of course",
  "then",
]);
const CONNECTIVE_RE = new RegExp(
  `^(${CONNECTIVES.map((c) => c.replace(/'/g, "['’]").replace(/ /g, "\\s+")).join("|")})\\b,?\\s*`,
  "i",
);

const FUNCTION_START = new Set(
  "the a an this that these those it its it's there there's here i i'm i'd you your we they he she his her their our my and but so plus also still yet then now in on at by for from with without after before when while if because as since until what which who why how not no every each all some most many one two three four five".split(
    " ",
  ),
);

/** A sentence's rough shape: how it opens and how long it runs. */
function shapeOf(sentence: string): string {
  const first = (sentence.match(/[A-Za-z'’]+/)?.[0] ?? "")
    .toLowerCase()
    .replace(/’/g, "'");
  const start = CONNECTIVE_RE.test(sentence)
    ? "connective"
    : FUNCTION_START.has(first)
      ? first
      : "name";
  const n = wordsOf(sentence).length;
  const bucket =
    n <= 6 ? "short" : n <= 12 ? "mid" : n <= 20 ? "long" : "very long";
  return `${start}/${bucket}${/\?["”]?$/.test(sentence) ? "/question" : ""}`;
}

export function repetition(segments: string[], ctx: RuleContext): RuleOutput {
  const findings: Finding[] = [];
  let segs = segments;
  // Near repeats: the same word or name inside about 15 words (stems, so "campaign" and "campaigns" are one).
  const all = segments.map((s) => maskQuotes(s).text).join(" ");
  // A name of several words is one unit ("Grand Theft Auto"), so its words don't count against each other.
  const raw = wordsOf(all).map((w) => w.replace(/^[^\w$£€]+|[^\w%]+$/g, ""));
  const toks: string[] = [];
  raw.forEach((w, i) => {
    const prev = raw[i - 1] ?? "";
    if (
      /^[A-Z]/.test(w) &&
      /^[A-Z]/.test(prev) &&
      !/[.!?,;:]$/.test(wordsOf(all)[i - 1] ?? "")
    )
      toks[toks.length - 1] += ` ${w}`;
    else toks.push(w);
  });
  const lastAt = new Map<string, number>();
  const flagged = new Set<string>();
  toks.forEach((w, i) => {
    if (w.length < 5 || /\d/.test(w)) return;
    const st = stem(w);
    if (STOP.has(w.toLowerCase()) || STOP.has(st) || COMMON_VERBS.has(st))
      return;
    const prev = lastAt.get(st);
    if (prev !== undefined && i - prev <= 15 && !flagged.has(st)) {
      flagged.add(st);
      findings.push({
        rule: "repetition.near",
        text: `"${w}" twice within ${i - prev} words`,
        note: `"${w}" comes twice within ${i - prev} words; use a pronoun, a different word, or drop one.`,
      });
    }
    lastAt.set(st, i);
  });
  // The same opening twice in a row.
  const flat: Array<{ seg: number; text: string }> = [];
  segments.forEach((s, seg) =>
    sentences(maskQuotes(s).text).forEach((text) => flat.push({ seg, text })),
  );
  const openingOf = (s: string) => {
    const ws = wordsOf(
      s
        .toLowerCase()
        .replace(/’/g, "'")
        .replace(/[^a-z0-9' ]/g, " "),
    );
    return STARTERS.has(ws[0] ?? "") ? (ws[0] ?? "") : ws.slice(0, 2).join(" ");
  };
  const dropOpening = new Set<number>();
  for (let i = 1; i < flat.length; i++) {
    const a = openingOf(flat[i - 1]!.text);
    if (a && a === openingOf(flat[i]!.text)) {
      const droppable = DROPPABLE_STARTERS.test(flat[i]!.text);
      findings.push({
        rule: "repetition.opening",
        text: `two sentences open "${a}"`,
        ...(droppable
          ? {}
          : {
              note: `Two sentences in a row open with "${a}" ("${flat[i]!.text.slice(0, 50)}"); start the second differently.`,
            }),
      });
      if (droppable) dropOpening.add(i);
    }
  }
  // The same connective more than twice (per Short, or per 500 words of a long video).
  const cap =
    ctx.format === "short"
      ? 2
      : Math.max(2, Math.ceil((wordsOf(all).length / 500) * 2));
  const used = new Map<string, number>();
  const dropConnective = new Set<number>();
  flat.forEach((f, i) => {
    const m = f.text.match(CONNECTIVE_RE);
    if (!m) return;
    const key = m[1]!.toLowerCase().replace(/\s+/g, " ").replace(/’/g, "'");
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    if (n <= cap) return;
    const droppable = ADDITIVE.has(key);
    findings.push({
      rule: "repetition.connective",
      text: `"${key}" ${n} times`,
      ...(droppable
        ? {}
        : {
            note: `"${capitalise(key)}" opens ${n} sentences; keep ${cap} and join or reword the rest.`,
          }),
    });
    if (droppable) dropConnective.add(i);
  });
  // The same sentence shape three times running.
  for (let i = 2; i < flat.length; i++) {
    const s = shapeOf(flat[i]!.text);
    if (
      s === shapeOf(flat[i - 1]!.text) &&
      s === shapeOf(flat[i - 2]!.text) &&
      (i < 3 || s !== shapeOf(flat[i - 3]!.text))
    )
      findings.push({
        rule: "repetition.shape",
        text: `three ${s} sentences in a row`,
        note: `Three sentences in a row have the same shape ("${flat[i - 2]!.text.slice(0, 40)}...", "${flat[i]!.text.slice(0, 40)}..."); vary one: a short fragment, a question, or a different opening.`,
      });
  }
  if (ctx.fix && (dropOpening.size || dropConnective.size)) {
    // Rebuild each segment with the droppable openers removed.
    let k = 0;
    segs = segments.map((s, seg) => {
      const m = maskQuotes(s);
      const ss = sentences(m.text);
      let changed = false;
      const rebuilt = ss.map((text) => {
        const i = k++;
        if (ctx.locked?.[seg]) return text;
        if (dropOpening.has(i) || dropConnective.has(i)) {
          const re = dropOpening.has(i) ? DROPPABLE_STARTERS : CONNECTIVE_RE;
          const next = capitalise(text.replace(re, ""));
          if (next !== text && wordsOf(next).length >= 3) {
            changed = true;
            return next;
          }
        }
        return text;
      });
      return changed ? unmaskQuotes(rebuilt.join(" "), m.quotes) : s;
    });
  }
  return { segments: segs, findings };
}
