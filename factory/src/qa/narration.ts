// The narration check: what the voice actually says (Whisper) against what it was given. It catches
// dropped or garbled words and word timings drifting away from the audio. Both slipped through on the
// GTA ranking (23 Oct 2026): a pause trim cut into words ("San Andreas" came out as "Sayus") because
// the timings ran a second late, and nothing listened to the result. Formatting is not a problem:
// "1997" against "nineteen ninety-seven", "Rockstar" against "rock star", "touch-screen" against
// "touch screen" all count as the same.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { numberWords, speakExact } from "../voice/speakable.ts";

const run = promisify(execFile);
const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "whisperwords.py",
);

export interface TimedWord {
  text: string;
  start: number;
  end?: number;
}

export interface NarrationIssue {
  at: number; // seconds into the narration
  meant: string;
  heard: string;
}

export interface NarrationCheck {
  ok: boolean;
  issues: NarrationIssue[];
  drift: number; // seconds the timings wander from the audio across the narration
  matched: number; // share of the script's words heard as written
}

/** Whisper's word timings for an audio file, through the given Python (faster-whisper or MLX Whisper). */
export async function transcribeWords(
  file: string,
  python: string,
): Promise<TimedWord[]> {
  const out = `${file}.words.json`;
  try {
    await run(python, ["-I", SCRIPT, file, out], {
      timeout: 20 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return (
      JSON.parse(await fs.readFile(out, "utf8")) as { words: TimedWord[] }
    ).words;
  } finally {
    await fs.rm(out, { force: true }).catch(() => undefined);
  }
}

const NUMBERISH = new Set(
  "zero oh one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion point dollars dollar cents cent pounds euros percent and a".split(
    " ",
  ),
);
const FILLER = new Set("a an the and of to its it is was that this".split(" "));

/** A word as comparable tokens: figures in words, hyphens split, lower case letters and digits only. */
const ROMAN: Record<string, number> = {
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
};

export function tokens(word: string): string[] {
  // Whisper writes "GTA 5" as "GTA V": a capital Roman numeral (never "I" or "X", which are words) is its number.
  const roman = word.replace(/[.,;:!?)"”’]+$/, "");
  if (ROMAN[roman] !== undefined)
    return numberWords(ROMAN[roman]!).split(/[\s-]+/);
  const out: string[] = [];
  for (const piece of speakExact(word.replace(/%/g, " percent")).split(
    /[\s\-–—]+/,
  )) {
    let t = piece
      .toLowerCase()
      .replace(/[’']s$/, "s")
      .replace(/[^a-z0-9]/g, "");
    const ord = t.match(/^(\d+)(st|nd|rd|th)$/);
    if (ord) t = ord[1]!;
    if (/^\d+$/.test(t) && t.length <= 9) {
      out.push(...numberWords(Number(t)).split(/[\s-]+/));
      continue;
    }
    if (t) out.push(t);
  }
  return out;
}

const similar = (a: string, b: string) => {
  if (!a || !b) return false;
  const m = a.length,
    n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [
    i,
    ...new Array<number>(n).fill(0),
  ]);
  for (let j = 1; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return 1 - d[m]![n]! / Math.max(m, n) >= 0.7;
};

/** Whisper splits figures ("8" then ",049", "$59" then ".99"): joined back into one word. */
export function joinFigures(words: TimedWord[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && /^[,.]\d/.test(w.text) && /\d$/.test(prev.text))
      out[out.length - 1] = { ...prev, text: prev.text + w.text, end: w.end };
    else out.push({ ...w });
  }
  return out;
}

/** Is a stretch where script and transcript differ only a matter of writing it down? */
function benign(meant: string[], heard: string[]): boolean {
  // One word heard as another ("Lee" as "Li", "seed" as "seat") is Whisper mishearing, not a voice fault:
  // a garbled voice loses or mangles more than one word ("San Andreas" as "Sayus").
  if (meant.length === 1 && heard.length === 1) return true;
  const a = meant.join(""),
    b = heard.join("");
  if (a === b || similar(a, b)) return true; // compounds and spellings: "rockstar"/"rock star", "cel"/"cell"
  const content = (xs: string[]) => xs.filter((x) => !FILLER.has(x));
  if (!content(meant).length && !content(heard).length) return true; // "and", "the"
  // Figures written differently on both sides ("ten thousand" against "10,000" read back) are fine;
  // a figure that is simply missing is not.
  if (
    meant.length &&
    heard.length &&
    [...meant, ...heard].every((x) => NUMBERISH.has(x) || FILLER.has(x))
  )
    return true;
  return false;
}

/** Compares the script's words (with their timings) with what Whisper heard. Pure. */
export function checkNarration(
  meant: TimedWord[],
  heard: TimedWord[],
  maxDrift = 0.35,
): NarrationCheck {
  const A: Array<{ t: string; at: number; w: string }> = [];
  for (const w of meant)
    for (const t of tokens(w.text)) A.push({ t, at: w.start, w: w.text });
  const B: Array<{ t: string; at: number; w: string }> = [];
  for (const w of joinFigures(heard))
    for (const t of tokens(w.text)) B.push({ t, at: w.start, w: w.text });
  const n = A.length,
    m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i]![j] =
        A[i]!.t === B[j]!.t
          ? L[i + 1]![j + 1]! + 1
          : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const issues: NarrationIssue[] = [];
  const pairs: Array<[number, number]> = [];
  let i = 0,
    j = 0;
  let miss: typeof A = [],
    extra: typeof B = [];
  const flush = () => {
    if (
      (miss.length || extra.length) &&
      !benign(
        miss.map((x) => x.t),
        extra.map((x) => x.t),
      )
    ) {
      const words = (xs: Array<{ w: string }>) =>
        xs
          .map((x) => x.w)
          .filter((w, k, all) => all.indexOf(w) === k)
          .join(" ");
      issues.push({
        at: (miss[0] ?? extra[0])!.at,
        meant: words(miss),
        heard: words(extra),
      });
    }
    miss = [];
    extra = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && A[i]!.t === B[j]!.t) {
      flush();
      pairs.push([A[i]!.at, B[j]!.at]);
      i++;
      j++;
    } else if (j >= m || (i < n && L[i + 1]![j]! >= L[i]![j + 1]!))
      miss.push(A[i++]!);
    else extra.push(B[j++]!);
  }
  flush();
  // Drift: the median offset per minute, and how far it wanders. A steady offset is Whisper's own habit.
  const medians: number[] = [];
  const end = pairs.length ? pairs[pairs.length - 1]![0] : 0;
  for (let t = 0; t <= end; t += 60) {
    const d = pairs
      .filter(([a]) => a >= t && a < t + 60)
      .map(([a, b]) => b - a)
      .sort((x, y) => x - y);
    if (d.length >= 20) medians.push(d[Math.floor(d.length / 2)]!);
  }
  const drift = medians.length
    ? Math.max(...medians) - Math.min(...medians)
    : 0;
  return {
    ok: !issues.length && drift <= maxDrift,
    issues,
    drift: Math.round(drift * 100) / 100,
    matched: n ? L[0]![0]! / n : 1,
  };
}

/** One line for logs and Discord. */
export function narrationSummary(c: NarrationCheck): string {
  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const parts = c.issues
    .slice(0, 6)
    .map(
      (x) =>
        `${mmss(x.at)} "${x.meant || "(nothing)"}" came out as "${x.heard || "(nothing)"}"`,
    );
  if (c.drift > 0.35) parts.push(`timings drift ${c.drift.toFixed(2)} s`);
  return parts.join("; ");
}
