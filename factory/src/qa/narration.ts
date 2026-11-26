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
import {
  numberWords,
  romanValue,
  SAID_AS_LETTERS,
  speakExact,
  SPOKEN_BACK,
} from "../voice/speakable.ts";

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
  /** Pauses of 0.45 s or more where the script has no punctuation: the voice phrasing a line oddly. */
  pauses: NarrationPause[];
  /** Everything the recogniser heard, for the check on what was actually said (src/editorial/writernotes.ts). */
  heard?: string;
  /** Capitals the voice read letter by letter that are not said that way (the letter watch, letterReadings). */
  letters?: LetterReading[];
}

/**
 * A token the voice spelled out letter by letter where players say a word ("GOTY" read G-O-T-Y in the Resident
 * Evil Short, 12 Nov 2026). `clean` is true when the letters heard are exactly the token's own, false when the
 * reading was garbled (some letters, a different run).
 */
export interface LetterReading {
  token: string;
  at: number;
  heard: string;
  clean: boolean;
}

const coreOf = (t: string) =>
  t
    .replace(/^[("“‘'[]+/, "")
    .replace(/[)"”’'\].,!?;:…]+$/, "")
    .replace(/['’]s$/, "");

/**
 * LETTER_WATCH_NAMES (src/config.ts, default on): a token built from capitalised word parts ("McCoy", "YouTube",
 * "GameSpot", "LeBron") is a name, not letters, so the letter watch leaves it alone. On 25 Nov 2026 "McCoy's line" in
 * the Titanfall 2 Short was logged and alerted as spelled letter by letter: its two capitals made it "MCCOY", and a
 * name held before a pause looks as long as five letters. Every capital must start a lowercase run and the last part
 * must have three letters or more, so "PvP", "PvPs", "LoL", "WoW" and "DeNA" stay watched.
 */
export interface LetterWatchOptions {
  names?: boolean;
}

export const NAME_SHAPED = /^(?:[A-Z][a-z]+)+[A-Z][a-z]{2,}$/;

export function nameShaped(core: string): boolean {
  return NAME_SHAPED.test(core.replace(/['’]s$/, ""));
}

/** The letters of a capitalised token as said ("PS5" is "PS", "NPCs" is "NPC"), or undefined when it is not one. */
export function lettersOf(core: string, opts: LetterWatchOptions = {}): string | undefined {
  if (!/^[A-Za-z0-9]{2,9}$/.test(core)) return undefined;
  if ((opts.names ?? true) && nameShaped(core)) return undefined;
  if ((core.match(/[A-Z]/g) ?? []).length < 2) return undefined;
  const letters = core.replace(/\d+/g, "").replace(/(?<=[A-Z])s$/, "");
  if (!/^[A-Za-z]{2,7}$/.test(letters)) return undefined;
  if (romanValue(letters) !== undefined) return undefined;
  return letters.toUpperCase();
}

/**
 * The letter watch: every capitalised token in what the voice was given that is not on the said-as-letters list
 * (SAID_AS_LETTERS), and that the voice read as separate letters. Found from the word timings: Whisper writes a
 * spelled token as single letters in a row ("G", "O", "T", "Y"), as dotted or hyphened letters ("G-O-T-Y"), or as
 * the capitals themselves held as long as spelled letters take at the take's own pace (LETTER_SHARE). Pure.
 */
export function letterReadings(
  meant: TimedWord[],
  heard: TimedWord[],
  opts: LetterWatchOptions = {},
): LetterReading[] {
  // The two clocks can sit a little apart (Whisper's own habit): their median offset on matching long words.
  const offs: number[] = [];
  let from = 0;
  for (const m of meant) {
    const t = coreOf(m.text).toLowerCase();
    if (t.length <= 3) continue;
    for (let k = from; k < Math.min(heard.length, from + 8); k++)
      if (coreOf(heard[k]!.text).toLowerCase() === t) {
        offs.push(heard[k]!.start - m.start);
        from = k + 1;
        break;
      }
  }
  offs.sort((a, b) => a - b);
  const off = offs.length ? offs[Math.floor(offs.length / 2)]! : 0;
  const pace = syllablePace(heard);
  const out: LetterReading[] = [];
  for (const m of meant) {
    const core = coreOf(m.text);
    const letters = lettersOf(core, opts);
    if (
      !letters ||
      SAID_AS_LETTERS.has(letters) ||
      SAID_AS_LETTERS.has(core.toUpperCase())
    )
      continue;
    const s = m.start + off - 0.2;
    const e = (m.end ?? m.start + 0.3) + off + 0.2;
    const hs = heard.filter((h) => (h.end ?? h.start + 0.2) > s && h.start < e);
    if (!hs.length) continue;
    const heardText = hs.map((h) => h.text).join(" ");
    let spelled: string | undefined;
    // Single letters in a row.
    let run = "";
    for (const h of hs) {
      const c = coreOf(h.text).replace(/\.$/, "");
      if (/^[A-Za-z]$/.test(c) && c !== "a" && c !== "I")
        run += c.toUpperCase();
      else if (run.length >= 2) break;
      else run = "";
    }
    if (run.length >= 2) spelled = run;
    // Dotted or hyphened letters in one word.
    for (const h of hs) {
      const c = coreOf(h.text);
      if (!spelled && /^(?:[A-Za-z][.-]){1,}[A-Za-z]\.?$/.test(c))
        spelled = c.replace(/[.-]/g, "").toUpperCase();
    }
    // The capitals themselves, held as long as letters take at this take's own pace.
    if (!spelled) {
      const k = heard.findIndex(
        (h) => hs.includes(h) && lettersOf(coreOf(h.text), opts) === letters,
      );
      if (k >= 0) {
        const same = heard[k]!;
        // Whisper can stretch a word over the silence after it: it ends where the next word starts at the latest.
        const end = Math.min(
          same.end ?? same.start,
          (heard[k + 1]?.start ?? Infinity) + 0.02,
        );
        const units = (end - same.start) / pace;
        if (
          units >= LETTER_SHARE * letterSyllables(letters) &&
          units >= WORD_STRETCH * wordSyllables(letters)
        )
          spelled = letters;
      }
    }
    if (!spelled) continue;
    out.push({
      token: core,
      at: Math.round(m.start * 100) / 100,
      heard: heardText,
      clean: spelled === letters,
    });
  }
  return out;
}

/**
 * How long a spelled token holds, in syllables of the take's own pace (the audit, 12 Nov 2026, 125 voiced episodes):
 * capitals said as letters held 0.6 to 1 syllable a letter (GTA 2.3, ESRB 4.0, IWGB 4.4, "GOTY" in the Requiem Short
 * 3.8), names read as words about their own syllables (GameSpot 2.0, PlayStation 2.3, "PUBG" as "pub-G" 2.0 to 2.3,
 * confirmed against a spelled reference take). A token is spelled when it holds at least LETTER_SHARE of its letters'
 * syllables and WORD_STRETCH times the syllables it would have as a word.
 */
export const LETTER_SHARE = 0.7;
export const WORD_STRETCH = 1.5;

/** Syllables a run of letters takes spelled out: W is three ("double-u"), every other letter one. */
export function letterSyllables(letters: string): number {
  return [...letters].reduce((n, c) => n + (c === "W" ? 3 : 1), 0);
}

/** Syllables of a token said as a word (its vowel groups, at least one). */
export function wordSyllables(token: string): number {
  return Math.max(1, (token.toLowerCase().match(/[aeiouy]+/g) ?? []).length);
}

/** Seconds per syllable in a take: the median over its ordinary lower-case words (0.2 s when it has none). */
export function syllablePace(heard: TimedWord[]): number {
  const r = heard
    .filter(
      (h) =>
        /^[a-z][a-z'’]+[.,!?]?$/.test(h.text) &&
        h.end !== undefined &&
        h.end - h.start > 0 &&
        h.end - h.start < 1.2,
    )
    .map((h) => {
      const w = h.text
        .toLowerCase()
        .replace(/[^a-z]/g, "")
        .replace(/e$/, "");
      return (
        (h.end! - h.start) / Math.max(1, (w.match(/[aeiouy]+/g) ?? []).length)
      );
    })
    .sort((a, b) => a - b);
  return r.length >= 5 ? r[Math.floor(r.length / 2)]! : 0.2;
}

export interface NarrationPause {
  at: number; // seconds into the narration
  seconds: number;
  before: string;
  after: string;
}

/**
 * Mid-sentence pauses: a gap of `minGap` seconds or more between two heard words where the script's own
 * word at that point carries no punctuation. The Modern Warfare Short (25 Oct 2026) paused half a second
 * between "Warfare" and "4's". Informational: the check still passes, the pauses are logged and learned from.
 */
export function midSentencePauses(
  meant: TimedWord[],
  heard: TimedWord[],
  minGap = 0.45,
): NarrationPause[] {
  const out: NarrationPause[] = [];
  for (let k = 1; k < heard.length; k++) {
    const prev = heard[k - 1]!;
    const gap = heard[k]!.start - (prev.end ?? prev.start);
    if (gap < minGap) continue;
    // The script word the previous heard word belongs to: the nearest by start time.
    let best = -1;
    for (let i = 0; i < meant.length; i++)
      if (
        best < 0 ||
        Math.abs(meant[i]!.start - prev.start) <
          Math.abs(meant[best]!.start - prev.start)
      )
        best = i;
    if (best < 0) continue;
    const before = meant[best]!.text;
    const after = meant[best + 1]?.text ?? "";
    if (!after || /[.,!?;:…—–)"”’]$/.test(before)) continue;
    out.push({
      at: Math.round(prev.start * 100) / 100,
      seconds: Math.round(gap * 100) / 100,
      before,
      after,
    });
  }
  return out;
}

/** Whisper's word timings for an audio file, through the given Python (faster-whisper or MLX Whisper). */
export async function transcribeWords(
  file: string,
  python: string,
  o: { device?: string; model?: string; beam?: number; timeoutMs?: number } = {},
): Promise<TimedWord[]> {
  const out = `${file}.words.json`;
  try {
    await run(python, ["-I", SCRIPT, file, out], {
      timeout: o.timeoutMs ?? 20 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
      // WHISPER_DEVICE=cpu: the stream index's CPU Whisper (src/qa/whisperwords.py); unset keeps CUDA.
      ...(o.device || o.model || o.beam
        ? {
            env: {
              ...process.env,
              ...(o.device ? { WHISPER_DEVICE: o.device } : {}),
              ...(o.model ? { WHISPER_MODEL: o.model } : {}),
              ...(o.beam ? { WHISPER_BEAM: String(o.beam) } : {}),
            },
          }
        : {}),
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
const SCALES = new Set(["hundred", "thousand", "million", "billion"]);
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

const UNIT_SAME: Record<string, string> = {
  gig: "gigabytes",
  gigs: "gigabytes",
  gigabyte: "gigabytes",
  meg: "megabytes",
  megs: "megabytes",
  megabyte: "megabytes",
  // Respelt for the voice (speakable.ts RESPELL): the same word to the check.
  pollish: "polish",
  // "8.0" is said "eight point oh" (speakSymbols); a script that said "point zero" is the same figure.
  oh: "zero",
  // Sounds the same, so the ear cannot tell them apart: "Switch 2" heard as "Switch too" (pronunciation audit, 12 Nov 2026).
  too: "two",
};

// "2nd" read aloud is "second": the same number to the check, however Whisper writes it (FFXIV doc,
// 4 Nov 2026: three correct readings cost a second voicing and raised a false alert). The figure still
// has to match, so "second" heard as "third" is still a fault.
const ORDINAL_SAME: Record<string, string> = {
  first: "one",
  second: "two",
  third: "three",
  fourth: "four",
  fifth: "five",
  sixth: "six",
  seventh: "seven",
  eighth: "eight",
  ninth: "nine",
  tenth: "ten",
  eleventh: "eleven",
  twelfth: "twelve",
  thirteenth: "thirteen",
  fourteenth: "fourteen",
  fifteenth: "fifteen",
  sixteenth: "sixteen",
  seventeenth: "seventeen",
  eighteenth: "eighteen",
  nineteenth: "nineteen",
  twentieth: "twenty",
  thirtieth: "thirty",
  fortieth: "forty",
  fiftieth: "fifty",
  sixtieth: "sixty",
  seventieth: "seventy",
  eightieth: "eighty",
  ninetieth: "ninety",
  hundredth: "hundred",
  thousandth: "thousand",
  millionth: "million",
};

export function tokens(word: string): string[] {
  // Whisper writes "GTA 5" as "GTA V": a capital Roman numeral (never "I" or "X", which are words) is its number.
  // Letters Whisper wrote with dots or hyphens ("G-O-T-Y", "U.S.") are the token itself ("GOTY", "US").
  const dotted = /^(?:[A-Za-z][.-]){1,}[A-Za-z]\.?[,;:!?)"”’]*$/.exec(
    word,
  )?.[0];
  if (dotted && !/[a-z]{2}/.test(dotted))
    return [dotted.replace(/[^A-Za-z]/g, "").toLowerCase()];
  const roman = word.replace(/[.,;:!?)"”’]+$/, "");
  if (ROMAN[roman] !== undefined)
    return numberWords(ROMAN[roman]!).split(/[\s-]+/);
  // "64's" and "V's" are how Whisper writes "sixty-four's" and "five's" (false alarms on 2 and 3 Nov 2026, each costing
  // a second voicing): the number's words with the last one possessive, as the script spells it. A year goes through the voice's own reading below.
  const owned = /^(\d{1,3}|[IVX]+)['’]s$/.exec(roman)?.[1];
  // "XIV's" too (the FFXIV documentary and Short, 31 Oct and 4 Nov 2026: "fourteen's" heard as "XIV's" was a fault).
  const ownedNumber =
    owned && (ROMAN[owned] ?? romanValue(owned) ?? Number(owned));
  if (ownedNumber) {
    const said = numberWords(ownedNumber).split(/[\s-]+/);
    said[said.length - 1] += "s";
    return said;
  }
  const out: string[] = [];
  // A figure run into its unit ("30fps", "4GB") is the number then the unit, as the voice says it
  // (it failed a good narration against "30 fps", QA notes 26 Oct 2026). Ordinals stay whole.
  const split = word
    .replace(/%/g, " percent")
    .replace(/(\d)(?!(?:st|nd|rd|th)\b)([a-z]{2,})/gi, "$1 $2");
  for (const piece of speakExact(split).split(/[\s\-–—]+/)) {
    let t = piece
      .toLowerCase()
      .replace(/[’']s$/, "s")
      .replace(/[^a-z0-9]/g, "");
    // "gigs" and "gigabytes" are the same word to the check (the voice shortens repeats, speakUnits).
    // A word respelt for the voice ("pollish", "obbuh") is the written word to the check (speakable.ts SPOKEN_BACK).
    const back = SPOKEN_BACK[t]?.toLowerCase().replace(/[^a-z0-9]/g, "");
    t = UNIT_SAME[t] ?? ORDINAL_SAME[t] ?? back ?? t;
    // The letter V inside a word ("V-Gauge") and Whisper's lone "V" for it are one sound; a lone capital V already reads
    // as five above, so the two have to meet or every "V-" name is a fault.
    if (t === "v") t = "five";
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

/**
 * Whisper splits figures ("8" then ",049", "$59" then ".99"): joined back into one word. It also writes dotted
 * initials as "A" then ".V.": the Cyberpunk 2077 documentary (26 Nov 2026) logged "AV." heard as "A .V." as a voice
 * fault. Dotted letters after a lone capital go back onto it ("A.V."), which tokens() reads as "av". Only letters:
 * any other word starting with a stop (".NET", ".hack") stays apart, so a glued word never hides a dropped one.
 */
export function joinFigures(words: TimedWord[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    const glued =
      prev &&
      /^\.(?:[A-Za-z]\.)*[A-Za-z]\.?[,;:!?]?$/.test(w.text) &&
      /^(?:[A-Z]\.)*[A-Z]$/.test(prev.text);
    if (glued || (prev && /^[,.]\d/.test(w.text) && /\d$/.test(prev.text)))
      out[out.length - 1] = { ...prev, text: prev.text + w.text, end: w.end };
    else out.push({ ...w });
  }
  return joinMoneyScale(out);
}

/**
 * Money then its scale ("$1.85" then "billion"; only million and billion, the scales speakable.ts reads) is one figure, read the way the voice reads it: "one point eight
 * five billion dollars" (speakable.ts). Word by word, "$1.85" alone is a price ("one dollar eighty-five"), so the
 * Cyberpunk 2077 documentary (25 Nov 2026) failed its narration check on a correctly spoken figure.
 */
export function joinMoneyScale(words: TimedWord[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (
      prev &&
      /^[$£€]\d[\d,]*(?:\.\d+)?$/.test(prev.text) &&
      /^(?:million|billion)\b/i.test(w.text)
    )
      out[out.length - 1] = {
        ...prev,
        text: `${prev.text} ${w.text}`,
        end: w.end,
      };
    else out.push({ ...w });
  }
  return out;
}

/**
 * Single capital letters in a row are one token: "T G G" (a token spelled out on purpose for the voice) against
 * Whisper's "TGG", or Whisper's "G O T Y" against "GOTY". "I" is a word, never a letter here.
 */
export function joinLetters(words: TimedWord[]): TimedWord[] {
  const out: TimedWord[] = [];
  const letter = (t: string) => /^[A-HJ-Z][.,;:!?)"”’]*$/.test(t);
  // Initials written with full stops ("A. V.", 25 Nov 2026: heard as "AV") are one token too; a stop after one
  // letter only joins when the next word is also a dotted letter, so "Plan B. A new..." stays apart.
  const dotted = (t: string) => /^[A-HJ-Z]\.[,;:!?)"”’]*$/.test(t);
  for (let i = 0; i < words.length; i++) {
    let j = i;
    while (
      j + 1 < words.length &&
      letter(words[j]!.text) &&
      letter(words[j + 1]!.text) &&
      (!/[.,;:!?]$/.test(words[j]!.text) ||
        (/^[A-Z]\.$/.test(words[j]!.text) && dotted(words[j + 1]!.text)))
    )
      j++;
    if (j > i) {
      const run = words.slice(i, j + 1);
      out.push({
        text:
          run.map((w) => w.text.replace(/[^A-Z]/g, "")).join("") +
          (run.at(-1)!.text.match(/[.,;:!?)"”’]+$/)?.[0] ?? ""),
        start: run[0]!.start,
        end: run.at(-1)!.end,
      });
      i = j;
    } else out.push({ ...words[i]! });
  }
  return out;
}

/** Is a stretch where script and transcript differ only a matter of writing it down? */
/**
 * Words whose swap changes what a sentence claims: figures (both sides are already in words, so a
 * different figure is a different word), negations and status words, and platforms. A swap of one of
 * these is never forgiven as a mishearing: "fifteen dollars" heard as "fifty dollars", or "confirmed"
 * as "cancelled", passed the first version of this check (audit, 24 Oct 2026).
 */
const PROTECTED = new Set([
  ...NUMBERISH,
  ..."not no never none nothing nobody neither nor without cancel cancels cancelled canceled confirm confirms confirmed unconfirmed deny denies denied delay delays delayed official unofficial rumor rumors rumored rumour rumours rumoured leak leaked free paid only first last before after more less up down higher lower".split(
    " ",
  ),
  ..."isnt wasnt arent werent wont doesnt dont didnt cant couldnt shouldnt wouldnt hasnt havent hadnt".split(
    " ",
  ),
  ..."xbox playstation ps4 ps5 switch nintendo pc steam mac ios android".split(
    " ",
  ),
]);
PROTECTED.delete("a");
PROTECTED.delete("and");

/** A word in one spelling for both sides of the Atlantic: rumoured/rumored, realise/realize, centre/center, travelled/traveled. */
export function usUk(w: string): string {
  return w
    .replace(/our(s|ed|ing|ite|ites|able)?$/, "or$1")
    .replace(/is(e|es|ed|ing|ation|ations)$/, "iz$1")
    .replace(/ys(e|es|ed|ing)$/, "yz$1")
    .replace(/tre(s)?$/, "ter$1")
    .replace(/ogue(s)?$/, "og$1")
    .replace(/ll(ed|ing|er|ers)$/, "l$1");
}

const DIGIT_WORDS = [
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
/** Figures up to 20 as words, and no spaces, hyphens or apostrophes, so "a6's" and "asixs" compare equal. */
export function spellDigits(s: string): string {
  return s
    .replace(/\d+/g, (n) => DIGIT_WORDS[Number(n)] ?? n)
    .replace(/[\s'’-]/g, "");
}

/** Abbreviations Whisper writes for a word the voice said in full. Only unambiguous ones: "St" (Saint or Street) is left out. */
const SPOKEN_ABBREVIATIONS: Record<string, string> = {
  mt: "mount",
  mr: "mister",
  mrs: "missus",
  dr: "doctor",
  ft: "feet",
  vs: "versus",
};

/** How a run of words sounds, roughly: abbreviations spelt out, and hard C, CK, Q and PH written one way. */
export function soundKey(words: string[]): string {
  return spellDigits(
    words
      .map((w) => SPOKEN_ABBREVIATIONS[w.replace(/\.$/, "")] ?? w)
      .map(usUk)
      .join(""),
  )
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/qu/g, "kw")
    .replace(/c(?=[aoulr]|$)/g, "k");
}

function benign(meant: string[], heard: string[]): boolean {
  const a = meant.join(""),
    b = heard.join("");
  if (a === b) return true; // compounds: "rockstar"/"rock star"
  // The same word in US and UK spelling ("rumored" heard as "rumoured", 15 Nov 2026) is no voice fault.
  if (usUk(a) === usUk(b)) return true;
  // The same number written as a figure or a word, split anywhere ("GTA six's" heard as "GT A6's", 15 Nov 2026).
  const spoken = (xs: string[]) => spellDigits(xs.map(usUk).join(""));
  if (spoken(meant) === spoken(heard)) return true;
  // Whisper's own spelling of the same sounds: "Mount Kalaga" written as "Mt. Calaga" (20 Nov 2026) was logged as a
  // voice fault and the video went ahead with a warning. Abbreviations it writes, and a hard C, CK, Q or PH spelt
  // differently, are the same words spoken.
  if (soundKey(meant) === soundKey(heard)) return true;
  const content = (xs: string[]) => xs.filter((x) => !FILLER.has(x));
  if (!content(meant).length && !content(heard).length) return true; // "and", "the"
  // Nothing that changes the claim may differ, a number's possessive ("five's", "sixty-four's") included.
  const claims = (x: string) =>
    PROTECTED.has(x) ||
    (x.endsWith("s") &&
      NUMBERISH.has(x.slice(0, -1)) &&
      PROTECTED.has(x.slice(0, -1)));
  if ([...meant, ...heard].some(claims)) return false;
  if (similar(a, b)) return true; // spellings: "cel"/"cell", "huangli"/"huang lee"
  // One ordinary word heard as another ("Lee" as "Li", "seed" as "seat") is Whisper mishearing, not a
  // voice fault: a garbled voice loses or mangles more than one word ("San Andreas" as "Sayus").
  return meant.length === 1 && heard.length === 1;
}

/**
 * What Whisper heard minus the sounds it writes as cues ("(laughs)", "[chuckles]", "*sighs*"): a delivery tag
 * the voice acted (src/voice/tags.ts) is not a word the script left out, and must not cost a second voicing.
 */
export function heardSpeech(heard: TimedWord[]): TimedWord[] {
  return heard.filter(
    (w) => !/^[[(*][a-z ]+[\])*][.,!?]*$/i.test(w.text.trim()),
  );
}

/** Compares the script's words (with their timings) with what Whisper heard. Pure. */
export function checkNarration(
  meant: TimedWord[],
  allHeard: TimedWord[],
  maxDrift = 0.35,
  opts: LetterWatchOptions = {},
): NarrationCheck {
  const heard = heardSpeech(allHeard);
  const A: Array<{ t: string; at: number; w: string }> = [];
  for (const w of joinLetters(meant))
    for (const t of tokens(w.text)) A.push({ t, at: w.start, w: w.text });
  const B: Array<{ t: string; at: number; w: string }> = [];
  for (const w of joinLetters(joinFigures(heard)))
    for (const t of tokens(w.text)) B.push({ t, at: w.start, w: w.text });
  // "a hundred" is "one hundred": the voice said "100" as people do, and Whisper wrote "a" (it failed
  // a good narration and paid for a second voicing, QA notes 26 Oct 2026). Only before a scale word.
  for (const xs of [A, B])
    xs.forEach((x, k) => {
      if (x.t === "a" && SCALES.has(xs[k + 1]?.t ?? "")) x.t = "one";
    });
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
  const real = dropShuffles(issues);
  return {
    heard: heard.map((w) => w.text).join(" "),
    letters: letterReadings(meant, heard, opts),
    ok: !real.length && drift <= maxDrift,
    issues: real,
    drift: Math.round(drift * 100) / 100,
    matched: n ? L[0]![0]! / n : 1,
    pauses: midSentencePauses(meant, heard),
  };
}

/**
 * Alignment shuffles that are not faults: the same word missed in one place and heard a moment later
 * ("million" either side of "$1 million"), and gaps made only of figure words, currency and digits
 * ("$1" against "dollars"). They failed the check on four Shorts in a week (QA notes, 26 Oct 2026),
 * each time paying for a second voicing of a narration that was fine.
 */
export function dropShuffles(issues: NarrationIssue[]): NarrationIssue[] {
  const toks = (s: string) => tokens(s);
  // Only scale and currency words: a changed figure ("four" against "five") is never forgiven.
  const UNITS = new Set([
    "million",
    "billion",
    "thousand",
    "dollars",
    "dollar",
    "cents",
    "pounds",
    "euros",
    "percent",
  ]);
  const unitOnly = (s: string) => toks(s).every((t) => UNITS.has(t));
  const gone = new Set<number>();
  issues.forEach((a, i) => {
    if (gone.has(i)) return;
    if (unitOnly(a.meant) && unitOnly(a.heard)) {
      gone.add(i);
      return;
    }
    // "$1" heard where the script said the amount in words and "dollars" went missing nearby.
    if (
      !a.meant &&
      /^\$\d[\d.,]*$/.test(a.heard.trim()) &&
      issues.some(
        (b) =>
          /dollars?/.test(b.meant) && !b.heard && Math.abs(b.at - a.at) <= 2,
      )
    ) {
      gone.add(i);
      return;
    }
    issues.forEach((b, j) => {
      if (j === i || gone.has(j) || gone.has(i)) return;
      const same =
        a.meant &&
        !a.heard &&
        !b.meant &&
        b.heard &&
        toks(a.meant).join(" ") === toks(b.heard).join(" ");
      if (same && Math.abs(a.at - b.at) <= 2) {
        gone.add(i);
        gone.add(j);
      }
    });
  });
  return issues.filter((_, i) => !gone.has(i));
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
