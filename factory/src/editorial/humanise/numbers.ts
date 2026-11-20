// Human numbers (rule 6), relative dates (rule 7) and callbacks (rule 8), all pure.
//
// Numbers: only exact spoken forms are used here ("1.5 million" is "one and a half million", "50% of" is "half of"),
// so no value ever changes; counts and prices are already rounded for the ear at voice time (roundCounts and
// roundPrices in src/voice/speakable.ts, the 23 and 25 Oct rules). A figure that is the point of the story (on the
// stamp, a card or in the hook) is never touched.
// Dates: a past date close to the publish date is said the way people say it ("yesterday", "on Tuesday", "back in
// March"), computed against the scheduled publish time, never the time of writing; future dates and release dates
// stay exact, and the pipeline's air-time check still reads the result.
// Callbacks: in a long video, a figure said again minutes later gets a "Remember," at most once every few minutes.

import { numberWords } from "../../voice/speakable.ts";
import type { Finding, RuleContext, RuleOutput } from "./rules.ts";
import {
  capitalise,
  maskQuotes,
  sentences,
  unmaskQuotes,
  wordsOf,
} from "./text.ts";

const FRACTION: Record<string, string> = {
  "5": "a half",
  "25": "a quarter",
  "75": "three quarters",
};
const PERCENT: Record<string, string> = {
  "50": "half",
  "25": "a quarter",
  "75": "three quarters",
};

export interface NumberContext extends RuleContext {
  /** Figures that carry the story (stamp, cards, headline): never respoken. */
  pointFigures?: string[];
  /** Segments never touched by numbers or dates (the hook states the news exactly). */
  exact?: number[];
}

const isPoint = (figure: string, ctx: NumberContext) =>
  (ctx.pointFigures ?? []).some((p) =>
    p.replace(/[,\s]/g, "").includes(figure.replace(/[,\s]/g, "")),
  );

/** Exact spoken forms of halves, quarters and simple percentages (pure). */
export function humanNumbers(
  segments: string[],
  ctx: NumberContext,
): RuleOutput {
  const findings: Finding[] = [];
  const out = segments.map((s, i) => {
    if (ctx.locked?.[i] || ctx.exact?.includes(i)) return s;
    const m = maskQuotes(s);
    const t = m.text
      .replace(
        /(?<![\w$£€¥.,])(\d{1,3})\.(5)\s+(million|billion|thousand)\b/g,
        (whole: string, n: string, f: string, scale: string) => {
          if (isPoint(`${n}.${f}`, ctx)) return whole;
          findings.push({
            rule: "numbers",
            text: `"${whole}" said as a fraction`,
          });
          return `${numberWords(Number(n))} and ${FRACTION[f]} ${scale}`;
        },
      )
      .replace(
        /(?<![\w.,])(50|25|75)\s?(?:%|percent)\s+of\b/g,
        (whole: string, n: string) => {
          if (isPoint(`${n}%`, ctx) || isPoint(n, ctx)) return whole;
          findings.push({
            rule: "numbers",
            text: `"${whole}" said as "${PERCENT[n]} of"`,
          });
          return `${PERCENT[n]} of`;
        },
      );
    return ctx.fix && t !== m.text ? unmaskQuotes(t, m.quotes) : s;
  });
  return { segments: out, findings };
}

/** The figures a human-number rewrite turns into words, so the fact guard reads "one and a half million" as 1.5. */
export function spokenFiguresBack(text: string): string {
  return text
    .replace(
      /\b(\w+(?:-\w+)?) and (a half|a quarter|three quarters) (million|billion|thousand)\b/g,
      (whole: string, n: string, f: string, scale: string) => {
        const v = wordNumber(n);
        if (v === undefined) return whole;
        return `${v}.${{ "a half": "5", "a quarter": "25", "three quarters": "75" }[f]} ${scale}`;
      },
    )
    .replace(
      /\b(half|a quarter|three quarters) of\b/g,
      (_m, f: string) =>
        `${{ half: "50", "a quarter": "25", "three quarters": "75" }[f]}% of`,
    );
}

function wordNumber(w: string): number | undefined {
  for (let n = 0; n < 1000; n++)
    if (numberWords(n) === w.toLowerCase()) return n;
  return undefined;
}

// ---------------------------------------------------------------- relative dates

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const SHORT_MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH_RE = `(${MONTHS.join("|")}|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?`;

const monthIndex = (m: string) => {
  const full = MONTHS.findIndex((x) => x.toLowerCase() === m.toLowerCase());
  return full >= 0
    ? full
    : (SHORT_MONTHS[m.toLowerCase().slice(0, 4).replace(/\.$/, "")] ??
        SHORT_MONTHS[m.toLowerCase().slice(0, 3)]);
};

/** The publish date as a US Eastern calendar day (the audience is US-first): year, month index, day. */
export function publishDay(at: Date): {
  y: number;
  m: number;
  d: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const y = Number(get("year"));
  const m = Number(get("month")) - 1;
  const d = Number(get("day"));
  return { y, m, d, weekday: new Date(Date.UTC(y, m, d)).getUTCDay() };
}

export interface DateContext extends NumberContext {
  publishAt?: Date;
  /** The story is about a date (a release date, a delay): every date stays exact. */
  exactDates?: boolean;
}

/** Past dates near the publish date said relatively (pure). Figures removed are listed for the fact guard. */
export function relativeDates(
  segments: string[],
  ctx: DateContext,
): RuleOutput & { removed: string[] } {
  const findings: Finding[] = [];
  const removed: string[] = [];
  if (!ctx.publishAt || ctx.exactDates) return { segments, findings, removed };
  const pub = publishDay(ctx.publishAt);
  const pubUtc = Date.UTC(pub.y, pub.m, pub.d);
  const out = segments.map((s, i) => {
    if (ctx.locked?.[i] || ctx.exact?.includes(i)) return s;
    const m = maskQuotes(s);
    let t = m.text.replace(
      new RegExp(
        `\\b([Oo]n) ${MONTH_RE} (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b`,
        "g",
      ),
      (
        whole: string,
        on: string,
        mon: string,
        day: string,
        year: string | undefined,
      ) => {
        const mi = monthIndex(mon);
        if (mi === undefined) return whole;
        const y = year ? Number(year) : pub.y;
        const diff = Math.round(
          (pubUtc - Date.UTC(y, mi, Number(day))) / 86_400_000,
        );
        if (
          diff < 0 ||
          diff > 6 ||
          isPoint(day, ctx) ||
          isPoint(`${mon} ${day}`, ctx)
        )
          return whole;
        const said =
          diff === 0
            ? "today"
            : diff === 1
              ? "yesterday"
              : `${on} ${WEEKDAYS[(pub.weekday - diff + 7) % 7]}`;
        findings.push({ rule: "dates", text: `"${whole}" said as "${said}"` });
        removed.push(day, mon.replace(/\.$/, ""), ...(year ? [year] : []));
        return /^O/.test(on) && diff <= 1 ? capitalise(said) : said;
      },
    );
    t = t.replace(
      new RegExp(
        `\\b([Ii]n) ${MONTH_RE}(?:,? (\\d{4}))?(?![\\w\\d]| \\d)`,
        "g",
      ),
      (
        whole: string,
        inWord: string,
        mon: string,
        year: string | undefined,
      ) => {
        const mi = monthIndex(mon);
        if (mi === undefined || mon.length < 4) return whole;
        if (year && Number(year) !== pub.y) return whole;
        if (pub.m - mi < 2) return whole;
        if (isPoint(mon, ctx)) return whole;
        const said = `${inWord === "In" ? "Back" : "back"} in ${MONTHS[mi]}`;
        findings.push({ rule: "dates", text: `"${whole}" said as "${said}"` });
        if (year) removed.push(year);
        return said;
      },
    );
    return ctx.fix && t !== m.text ? unmaskQuotes(t, m.quotes) : s;
  });
  return { segments: out, findings, removed };
}

// ---------------------------------------------------------------- callbacks (long videos)

const FIGURE = /\$\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?%/g;
/** Words a callback must be apart from the first mention, and from the last callback: about three minutes at 150 wpm. */
export const CALLBACK_GAP = 450;

/** A figure said again minutes later gets "Remember," once every few minutes (pure; long videos only). */
export function callbacks(
  segments: string[],
  ctx: RuleContext & { earlier?: string },
): RuleOutput {
  const findings: Finding[] = [];
  if (ctx.format !== "long") return { segments, findings };
  const firstAt = new Map<string, number>();
  let word = 0;
  let lastCallback = -Infinity;
  const scan = (text: string, edit: boolean) => {
    const ss = sentences(text);
    const outS = ss.map((sentence) => {
      const startWord = word;
      word += wordsOf(sentence).length;
      if (/\bremember\b|\bearlier\b|\bas we saw\b/i.test(sentence))
        lastCallback = startWord;
      let callback = false;
      for (const f of sentence.match(FIGURE) ?? []) {
        const first = firstAt.get(f);
        if (first === undefined) firstAt.set(f, startWord);
        else if (
          startWord - first >= CALLBACK_GAP &&
          startWord - lastCallback >= CALLBACK_GAP &&
          !callback
        )
          callback = true;
      }
      if (
        !callback ||
        /^(?:And|But|So|Remember)\b/.test(sentence) ||
        /\?["”]?$/.test(sentence)
      )
        return sentence;
      lastCallback = startWord;
      findings.push({
        rule: "callback",
        text: `callback on "${sentence.slice(0, 40)}"`,
      });
      const firstWord = sentence.match(/^[A-Za-z'’]+/)?.[0] ?? "";
      const lead = /^(?:The|A|An|It|This|That|There|Its|Their|They|We|You|He|She|In|On|At|For|Some|Most)$/.test(firstWord)
        ? `${sentence[0]!.toLowerCase()}${sentence.slice(1)}`
        : sentence;
      return edit ? `Remember, ${lead}` : sentence;
    });
    return outS.join(" ");
  };
  if (ctx.earlier) scan(maskQuotes(ctx.earlier).text, false);
  const out = segments.map((s, i) => {
    const m = maskQuotes(s);
    const t = scan(m.text, ctx.fix && !ctx.locked?.[i]);
    return ctx.fix && t !== sentences(m.text).join(" ")
      ? unmaskQuotes(t, m.quotes)
      : s;
  });
  return { segments: out, findings };
}
