// Pure timing maths shared by the renderer and the tests: which spoken
// segment is on screen when, and how captions are paged.

import type { Word } from "../voice/elevenlabs.ts";

export type SegmentKind = "hook" | "beat" | "desk" | "take" | "loop";

export interface Visual {
  kind:
    | "title"
    | "stat"
    | "date"
    | "quote"
    | "list"
    | "none"
    | "timeline"
    | "price"
    | "score"
    | "countdown"
    | "compare"
    | "rank"
    | "platforms"
    | "versus"
    | "specs"
    | "milestones"
    | "chapter"
    | "report";
  primary: string;
  secondary: string;
  date_from?: string;
  date_to?: string;
  was?: string;
  region?: string;
  value_a?: number;
  items?: string[];
}

export interface Segment {
  kind: SegmentKind;
  text: string;
  start: number; // seconds
  end: number;
  visual?: Visual;
  label?: string;
}

export interface SegmentInput {
  kind: SegmentKind;
  text: string;
  visual?: Visual;
  label?: string;
}

const tokensOf = (t: string) => t.split(/\s+/).filter(Boolean);
const countWords = (t: string) => tokensOf(t).length;
const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Narration was synthesised as the segments joined by spaces, so the n-th
 * spoken word belongs to whichever segment contains word n. If the aligner
 * split or merged a token somewhere earlier (hyphens, numerals), the exact
 * index drifts, so the segment's first word is looked for within a few
 * positions of where it should be before falling back to the raw index.
 */
export function buildSegments(
  inputs: SegmentInput[],
  words: Word[],
  totalSeconds: number,
): Segment[] {
  const out: Segment[] = [];
  let idx = 0;
  for (let i = 0; i < inputs.length; i++) {
    const seg = inputs[i]!;
    const toks = tokensOf(seg.text);
    const n = toks.length;
    if (n === 0) continue;
    let at = Math.min(idx, words.length - 1);
    const want = norm(toks[0]!);
    if (want && out.length > 0 && norm(words[at]?.text ?? "") !== want) {
      for (const d of [1, -1, 2, -2, 3, -3]) {
        const j = at + d;
        if (j > 0 && j < words.length && norm(words[j]!.text) === want) {
          at = j;
          break;
        }
      }
    }
    const first = words[at];
    idx = at + n;
    const start = out.length === 0 ? 0 : (first?.start ?? out.at(-1)!.end);
    out.push({ ...seg, start, end: totalSeconds });
    const prev = out.at(-2);
    if (prev) prev.end = start;
  }
  return out;
}

export interface CaptionPage {
  start: number;
  end: number;
  words: Word[];
}

/** Groups words into short caption pages, breaking on punctuation and pauses. */
export function pageCaptions(
  words: Word[],
  // One to three words at a time: the caption style of the gaming Shorts that travel (7 of 10 studied).
  maxWords = 3,
  maxChars = 22,
  minSeconds = 0.33,
): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    pages.push({ start: cur[0]!.start, end: cur.at(-1)!.end, words: cur });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const chars =
      cur.reduce((s, x) => s + x.text.length + 1, 0) + w.text.length;
    if (cur.length >= maxWords || (cur.length > 0 && chars > maxChars)) flush();
    cur.push(w);
    const next = words[i + 1];
    const pause = next ? next.start - w.end : 0;
    if (/[.!?;:,]$/.test(w.text) || pause > 0.35) flush();
  }
  flush();
  // A page shorter than minSeconds flickers; merge it forward into the next page when that fits.
  for (let i = 0; i < pages.length - 1; ) {
    const a = pages[i]!;
    const b = pages[i + 1]!;
    const chars = [...a.words, ...b.words].reduce(
      (n, w) => n + w.text.length + 1,
      0,
    );
    if (
      a.end - a.start < minSeconds &&
      a.words.length + b.words.length <= maxWords + 1 &&
      chars <= maxChars + 6
    ) {
      pages.splice(i, 2, {
        start: a.start,
        end: b.end,
        words: [...a.words, ...b.words],
      });
    } else i++;
  }
  // Hold each page until the next one starts so captions never blink off mid-sentence.
  for (let i = 0; i < pages.length - 1; i++) {
    const gap = pages[i + 1]!.start - pages[i]!.end;
    if (gap < 0.6) pages[i]!.end = pages[i + 1]!.start;
  }
  return pages;
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(sec, 2)},${pad(ms % 1000, 3)}`;
}

/**
 * SubRip captions from word timings for YouTube's own caption track: longer
 * cues than the on-screen karaoke (up to 8 words / 40 chars), each held at
 * least 0.7 s, tiny fragments merged into the previous cue, never overlapping.
 */
export function srtFromWords(words: Word[]): string {
  const cues: Array<{ start: number; end: number; text: string }> = [];
  for (const p of pageCaptions(displayWords(words), 8, 40)) {
    const text = p.words.map((w) => w.text).join(" ");
    const last = cues.at(-1);
    if (last && p.end - p.start < 0.7 && `${last.text} ${text}`.length <= 64) {
      last.text += ` ${text}`;
      last.end = Math.max(last.end, p.end);
      continue;
    }
    cues.push({ start: p.start, end: Math.max(p.end, p.start + 0.7), text });
  }
  for (let i = 0; i < cues.length - 1; i++)
    if (cues[i]!.end > cues[i + 1]!.start) cues[i]!.end = cues[i + 1]!.start;
  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`,
      )
      .join("\n") + (cues.length ? "\n" : "")
  );
}

/** Background shots: change picture at every segment boundary and every ~3.2s within long segments. */
export function shotTimes(segments: Segment[], maxShot = 3.2): number[] {
  const cuts: number[] = [];
  for (const s of segments) {
    const len = s.end - s.start;
    const parts = Math.max(1, Math.round(len / maxShot));
    for (let p = 0; p < parts; p++) cuts.push(s.start + (len * p) / parts);
  }
  return cuts;
}

const UNITS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};
const TEENS: Record<string, number> = {
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
};
const TENS_W: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SMALL: Record<string, number> = { zero: 0, ...UNITS, ...TEENS };
const SCALES: Record<string, number> = {
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};
const CURRENCY: Record<string, string> = {
  dollar: "$",
  dollars: "$",
  pound: "£",
  pounds: "£",
  euro: "€",
  euros: "€",
};

/** A whole number spoken in words from words[i] ("one thousand two hundred ninety-nine"), or undefined. */
function spokenNumber(
  words: Word[],
  i: number,
): { value: number; used: number } | undefined {
  let total = 0;
  let current = 0;
  let used = 0;
  let any = false;
  for (let k = i; k < words.length; k++) {
    const raw = words[k]!.text;
    const w = raw.toLowerCase().replace(/[^a-z-]/g, "");
    const [t, u] = w.split("-");
    if (SMALL[w] !== undefined) current += SMALL[w]!;
    else if (TENS_W[t!] !== undefined && (!u || UNITS[u] !== undefined))
      current += TENS_W[t!]! + (u ? UNITS[u]! : 0);
    else if (w === "hundred" && any) current *= 100;
    else if (SCALES[w] !== undefined && any && SCALES[w]! < 1_000_000) {
      total += current * SCALES[w]!;
      current = 0;
    } else break;
    any = true;
    used++;
    if (/[.,;:!?)"”’]$/.test(raw)) break; // a number never runs across punctuation
  }
  return any ? { value: total + current, used } : undefined;
}

/**
 * A count or decimal the voice says in words (speakNumbers in src/voice/speakable.ts) as the screen should
 * show it: "thirty-two thousand six hundred nineteen" is "32,619", "four point five" is "4.5", "forty-seven
 * point five percent" is "47.5%", "one point two million" is "1.2 million". Only a phrase that is plainly a
 * number (hundred, thousand or more in it, a decimal point, or "percent" after it) turns back, so "one of
 * the best" stays words.
 */
export function spokenCount(
  words: Word[],
  i: number,
): { text: string; used: number } | undefined {
  const bare = (k: number) =>
    (words[k]?.text ?? "").toLowerCase().replace(/[^a-z-]/g, "");
  const stops = (k: number) => /[.,;:!?)"”’]$/.test(words[k]?.text ?? "");
  let total = 0;
  let current = 0;
  let used = 0;
  let scaled = false;
  for (let k = i; k < words.length; k++) {
    const w = bare(k);
    const [t, u] = w.split("-");
    if (SMALL[w] !== undefined) current += SMALL[w]!;
    else if (TENS_W[t!] !== undefined && (!u || UNITS[u] !== undefined))
      current += TENS_W[t!]! + (u ? UNITS[u]! : 0);
    else if (w === "hundred" && used) {
      current *= 100;
      scaled = true;
    } else if (SCALES[w] !== undefined && used) {
      total += current * SCALES[w]!;
      current = 0;
      scaled = true;
    } else break;
    used++;
    if (stops(k)) break;
  }
  if (!used) return undefined;
  let k = i + used;
  let frac = "";
  if (!stops(k - 1) && bare(k) === "point") {
    let j = k + 1;
    let d = "";
    while (j < words.length && (SMALL[bare(j)] ?? 10) < 10) {
      d += String(SMALL[bare(j)]);
      j++;
      if (stops(j - 1)) break;
    }
    if (d) {
      frac = d;
      k = j;
    }
  }
  let scale = "";
  if (
    frac &&
    !stops(k - 1) &&
    (bare(k) === "million" || bare(k) === "billion")
  ) {
    scale = bare(k);
    k++;
  }
  const percent = !stops(k - 1) && bare(k) === "percent";
  if (percent) k++;
  if (!scaled && !frac && !percent) return undefined;
  const tail = (words[k - 1]?.text ?? "").match(/[.,;:!?)"”’]+$/)?.[0] ?? "";
  const value = total + current;
  // Round millions and billions read better as "20 million" than "20,000,000".
  const whole =
    !frac && value >= 1e9 && value % 1e9 === 0
      ? `${value / 1e9} billion`
      : !frac && value >= 1e6 && value % 1e6 === 0
        ? `${value / 1e6} million`
        : value.toLocaleString("en-US");
  const shown = `${whole}${frac ? `.${frac}` : ""}${scale ? ` ${scale}` : ""}${percent ? "%" : ""}`;
  return { text: shown + tail, used: k - i };
}

/**
 * A price the voice says in words ("forty-nine dollars ninety-nine", "one point five billion
 * dollars") as the screen should show it ("$49.99", "$1.5 billion"), with the words it used.
 */
export function spokenMoney(
  words: Word[],
  i: number,
): { text: string; used: number } | undefined {
  const n = spokenNumber(words, i);
  if (!n) return undefined;
  let k = i + n.used;
  let decimal = "";
  const bare = (j: number) =>
    (words[j]?.text ?? "").toLowerCase().replace(/[^a-z-]/g, "");
  if (bare(k) === "point" && !/[.,;:!?]$/.test(words[k - 1]!.text)) {
    let d = "";
    let j = k + 1;
    while (
      j < words.length &&
      SMALL[bare(j)] !== undefined &&
      SMALL[bare(j)]! < 10
    )
      d += String(SMALL[bare(j++)]);
    if (d) {
      decimal = `.${d}`;
      k = j;
    }
  }
  let scale = "";
  if (SCALES[bare(k)] !== undefined && SCALES[bare(k)]! >= 1_000_000)
    scale = ` ${bare(k++)}`;
  const symbol = CURRENCY[bare(k)];
  if (!symbol || /[.,;:!?]$/.test(words[k - 1]!.text)) return undefined;
  const currencyWord = words[k]!.text;
  k++;
  let cents = "";
  if (!scale && !decimal && !/[.,;:!?)"”’]$/.test(currencyWord)) {
    const c = twoDigit(words.slice(k, k + 2).map((x) => x.text));
    if (c && c.value > 0 && c.value < 100) {
      cents = `.${String(c.value).padStart(2, "0")}`;
      k += c.used;
    }
  }
  const tail = (words[k - 1]!.text.match(/[.,;:!?)"”’]+$/) ?? [""])[0];
  return {
    text: `${symbol}${n.value.toLocaleString("en-US")}${decimal}${cents}${scale}${tail}`,
    used: k - i,
  };
}

/** "sixteen", "ninety-seven", "oh five" as 16, 97, 5; undefined for anything else. */
function twoDigit(
  words: string[],
): { value: number; used: number } | undefined {
  // "eighteen's" is eighteen: the possessive is put back on the figure by the caller.
  const a = words[0]
    ?.toLowerCase()
    .replace(/['’]s\b/, "")
    .replace(/[^a-z-]/g, "");
  if (!a) return undefined;
  if (a === "oh" && UNITS[words[1]?.toLowerCase().replace(/[^a-z]/g, "") ?? ""])
    return {
      value: UNITS[words[1]!.toLowerCase().replace(/[^a-z]/g, "")]!,
      used: 2,
    };
  if (TEENS[a] !== undefined) return { value: TEENS[a]!, used: 1 };
  const [t, u] = a.split("-");
  // The aligner sometimes splits "twenty-four's" into "twenty" "four's": the Astro Bot Short showed
  // "2020 4's" for "2024's" (28 Oct 2026). Only when nothing separates them ("twenty, four" stays apart).
  const next = words[1]
    ?.toLowerCase()
    .replace(/['’]s\b/, "")
    .replace(/[^a-z]/g, "");
  if (
    TENS_W[t!] !== undefined &&
    !u &&
    /^[a-z]+$/i.test(words[0]!) &&
    next &&
    UNITS[next]
  )
    return { value: TENS_W[t!]! + UNITS[next]!, used: 2 };
  if (TENS_W[t!] !== undefined)
    return { value: TENS_W[t!]! + (u ? (UNITS[u] ?? 0) : 0), used: 1 };
  return undefined;
}

/**
 * What the screen shows for spoken words: "47 percent" is "47%", prices the voice says in words
 * ("forty-nine dollars ninety-nine") are "$49.99" again, and years the voice says in words
 * ("twenty sixteen", "two thousand seven") are digits again.
 * Timings merge, so a caption still lights when its words are spoken.
 */
/** The possessive on a spoken number ("twenty eighteen's"), kept on the figure ("2018's"). */
const possessive = (text: string | undefined) =>
  (text ?? "").match(/(['’]s)[.,;:!?)"”’]*$/)?.[1] ?? "";

export function displayWords(words: Word[]): Word[] {
  const out: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const bare = (k: number) =>
      (words[k]?.text ?? "").toLowerCase().replace(/[^a-z-]/g, "");
    const tail = (k: number) =>
      (words[k]?.text ?? "").match(/[.,;:!?)"”’]+$/)?.[0] ?? "";
    // Series X and S (speakTitles) is written Series X|S
    if (
      bare(i) === "series" &&
      words[i + 1]?.text === "X" &&
      bare(i + 2) === "and" &&
      /^S[.,;:!?)"”’]*$/.test(words[i + 3]?.text ?? "")
    ) {
      out.push(
        { ...w },
        {
          text: `X|S${tail(i + 3)}`,
          start: words[i + 1]!.start,
          end: words[i + 3]!.end,
        },
      );
      i += 3;
      continue;
    }
    // 47 percent
    if (
      /^\d[\d,.]*$/.test(w.text.replace(/[^\d,.]/g, "") || "x") &&
      /^\d/.test(w.text) &&
      /^percent[.,;:!?)"”’]*$/i.test(words[i + 1]?.text ?? "")
    ) {
      out.push({
        text: `${w.text.replace(/[.,;:!?]+$/, "")}%${tail(i + 1)}`,
        start: w.start,
        end: words[i + 1]!.end,
      });
      i++;
      continue;
    }
    // forty-nine dollars ninety-nine
    const money = spokenMoney(words, i);
    if (money) {
      out.push({
        text: money.text,
        start: w.start,
        end: words[i + money.used - 1]!.end,
      });
      i += money.used - 1;
      continue;
    }
    // two thousand seven
    if (bare(i) === "two" && bare(i + 1) === "thousand") {
      const u =
        tail(i + 1) || ["hundred", "thousand"].includes(bare(i + 3))
          ? undefined
          : (UNITS[bare(i + 2).replace(/s$/, "")] ??
            (possessive(words[i + 2]?.text) ? undefined : UNITS[bare(i + 2)]));
      if (u !== undefined) {
        out.push({
          text: `200${u}${possessive(words[i + 2]?.text)}${tail(i + 2)}`,
          start: w.start,
          end: words[i + 2]!.end,
        });
        i += 2;
        continue;
      }
      // the year 2000: "Majora's Mask, two thousand." or "in two thousand" (a count, "two thousand players", stays in words)
      const next = bare(i + 2);
      const year = [
        "in",
        "since",
        "from",
        "until",
        "by",
        "of",
        "year",
        "early",
        "late",
        "around",
      ].includes(bare(i - 1));
      if (
        tail(i + 1) ||
        (year &&
          !(
            next in UNITS ||
            next in TEENS ||
            next in TENS_W ||
            next === "hundred"
          ))
      ) {
        out.push({
          text: `2000${tail(i + 1)}`,
          start: w.start,
          end: words[i + 1]!.end,
        });
        i += 1;
        continue;
      }
    }
    // nineteen ninety-seven, twenty sixteen, twenty oh five
    const hi =
      bare(i) === "nineteen" ? 19 : bare(i) === "twenty" ? 20 : undefined;
    if (hi !== undefined) {
      // a decade: "the nineteen nineties" is "the 1990s"
      const decade = TENS_W[bare(i + 1).replace(/ies$/, "y")];
      if (
        decade !== undefined &&
        /ies$/.test(bare(i + 1)) &&
        hi * 100 + decade >= 1950
      ) {
        out.push({
          text: `${hi * 100 + decade}s${tail(i + 1)}`,
          start: w.start,
          end: words[i + 1]!.end,
        });
        i += 1;
        continue;
      }
      const lo = twoDigit(words.slice(i + 1, i + 3).map((x) => x.text));
      if (
        (lo && lo.value >= 10) ||
        (lo && words[i + 1]?.text.toLowerCase() === "oh")
      ) {
        const last = i + lo!.used;
        const year = hi * 100 + lo!.value;
        if (year >= 1950 && year <= 2099) {
          out.push({
            text: `${year}${possessive(words[last]?.text)}${tail(last)}`,
            start: w.start,
            end: words[last]!.end,
          });
          i = last;
          continue;
        }
      }
    }
    // thirty-two thousand six hundred nineteen, four point five, forty-seven point five percent
    const count = spokenCount(words, i);
    if (count) {
      out.push({
        text: count.text,
        start: w.start,
        end: words[i + count.used - 1]!.end,
      });
      i += count.used - 1;
      continue;
    }
    // A title's number the voice says as a word to avoid a pause ("GTA four's", speakCadence): a figure again
    // after a capitalised name. Not "one" ("Xbox One's" is the console's name).
    const own = possessive(w.text);
    const prev = out[out.length - 1]?.text ?? "";
    if (own && /^[A-Z0-9]/.test(prev) && !/[.!?:]["”’)]*$/.test(prev)) {
      const unit = UNITS[w.text.toLowerCase().replace(/['’]s.*$/, "")];
      const n =
        unit !== undefined ? { value: unit, used: 1 } : twoDigit([w.text]);
      if (n && n.used === 1 && n.value >= 2) {
        out.push({
          text: `${n.value}${own}${tail(i)}`,
          start: w.start,
          end: w.end,
        });
        continue;
      }
    }
    // A number from 10 to 99 said on its own ("fifteen radio stations") is a figure, as people write it,
    // except at the start of a sentence ("Ten years after...").
    {
      const n = twoDigit([w.text]);
      const starts = !prev || /[.!?:]["”’)]*$/.test(prev);
      // "twenty-first" is an ordinal (below), not 20: the part after a hyphen must be a plain digit word.
      const part = bare(i).split("-")[1];
      const plain = part === undefined || UNITS[part] !== undefined;
      if (
        n &&
        n.used === 1 &&
        n.value >= 10 &&
        plain &&
        !starts &&
        !own &&
        /^[a-z]+(-[a-z]+)?[.,;:!?)"”’]*$/.test(w.text)
      ) {
        out.push({ text: `${n.value}${tail(i)}`, start: w.start, end: w.end });
        continue;
      }
    }
    // An ordinal said in words ("the fourteenth of March", "twenty-first") is shown as people write it:
    // "14th", "21st". "First", "second" and "third" are ordinary words too often ("the first time"), so
    // they only turn when a month or "the ... of" marks a date.
    const ord = spokenOrdinal(words, i, out[out.length - 1]?.text);
    if (ord) {
      out.push({ text: `${ord}${tail(i)}`, start: w.start, end: w.end });
      continue;
    }
    out.push(w);
  }
  // "134 gigabytes" (speakUnits in speakable.ts) is shown as "134GB".
  const UNIT_BACK: Record<string, string> = {
    terabyte: "TB",
    terabytes: "TB",
    gigabyte: "GB",
    gigabytes: "GB",
    gig: "GB",
    gigs: "GB",
    megabyte: "MB",
    megabytes: "MB",
    meg: "MB",
    megs: "MB",
    kilobyte: "KB",
    kilobytes: "KB",
    gigahertz: "GHz",
    megahertz: "MHz",
    hertz: "Hz",
  };
  const merged: Word[] = [];
  for (let k = 0; k < out.length; k++) {
    const w = out[k]!;
    const next = out[k + 1];
    const m = next?.text.match(/^([a-z]+)([.,;:!?)"”’]*)$/i);
    const unit = m ? UNIT_BACK[m[1]!.toLowerCase()] : undefined;
    if (unit && /^\d[\d,]*(?:\.\d+)?$/.test(w.text)) {
      merged.push({
        text: `${w.text}${unit}${m![2]}`,
        start: w.start,
        end: next!.end,
      });
      k++;
    } else merged.push(w);
  }
  // A word respelt for the voice ("pollish", speakable.ts RESPELL) is shown as written ("polish").
  const SPOKEN_BACK: Record<string, string> = {
    pollish: "polish",
    obbuh: "Obbe",
    tohst: "t0st",
  };
  return merged.map((w) => {
    const m = w.text.match(/^([A-Za-z]+)(.*)$/);
    const back = m ? SPOKEN_BACK[m[1]!.toLowerCase()] : undefined;
    return back ? { ...w, text: `${back}${m![2]}` } : w;
  });
}

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
  fortieth: 40,
  fiftieth: 50,
};
const MONTHS_RE =
  /^(january|february|march|april|may|june|july|august|september|october|november|december)[.,;:!?)"”’]*$/i;

/** "14th" for 14: the suffix people write. */
export function ordinalSuffix(n: number): string {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * The ordinal words[i] says, as "14th", or undefined. Anything from "fourth" up turns on its own;
 * "first", "second" and "third" only next to a month name or in "the ... of <month>".
 */
export function spokenOrdinal(
  words: Word[],
  i: number,
  previous?: string,
): string | undefined {
  const raw = words[i]?.text ?? "";
  const w = raw.toLowerCase().replace(/[^a-z-]/g, "");
  const [t, u] = w.split("-");
  let n: number | undefined;
  if (ORDINALS[w] !== undefined) n = ORDINALS[w];
  else if (
    u &&
    TENS_W[t!] !== undefined &&
    ORDINALS[u] !== undefined &&
    ORDINALS[u]! < 10
  )
    n = TENS_W[t!]! + ORDINALS[u]!;
  if (n === undefined) return undefined;
  if (n <= 3) {
    const prev = (previous ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const next = words[i + 1]?.text ?? "";
    const dated =
      MONTHS_RE.test(previous ?? "") ||
      MONTHS_RE.test(next) ||
      (prev === "the" &&
        /^of$/i.test(next) &&
        MONTHS_RE.test(words[i + 2]?.text ?? ""));
    if (!dated) return undefined;
  }
  return ordinalSuffix(n);
}

/** On-screen text: "47 percent" is "47%". */
export function displayText(t: string): string {
  return t.replace(/(\d[\d,.]*)\s?percent\b/gi, "$1%");
}
