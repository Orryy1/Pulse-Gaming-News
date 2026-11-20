// Every line of dialogue in a game movie, from the two places a line can be (pure, tested on recorded outputs):
//   - read off the screen: the text recogniser's words and boxes for frames sampled a few times a second (Apple's
//     Vision on the Mac through src/assets/ocr.ts). Unvoiced games (Zelda) speak only this way; voiced games show
//     the same words as subtitles, which gives the exact spelling of names Whisper mishears.
//   - heard: Whisper's word timings (src/qa/whisperwords.py), grouped into lines at the speaker's pauses.
// A line's speaker is the name plate the game shows beside its text, when it shows one; a line heard and read at
// the same moment becomes one line with the screen's spelling and the voice's word timings.

import type { OcrPage, OcrWord } from "../assets/ocr.ts";
import type { DialogueLine, TimedWord } from "./schema.ts";

export interface OcrSample {
  /** Seconds into the source. */
  time: number;
  page: OcrPage;
}

export interface BoxRead {
  text: string;
  speaker?: string;
  /** Other writing in the frame that is not the dialogue: a place card, a title, an item name. */
  other: string[];
  /** The height of the dialogue's lettering as a share of the picture's height. */
  size: number;
}

/**
 * Running words, not a card: a title or place card is set in capitals ("KOKIRI FOREST", "OCARINA OF TIME") and a
 * misread scrap of one has no ordinary word in it ("DaGG"). A line of dialogue has at least one word in lower case.
 */
export function isDialogue(text: string): boolean {
  const only = text.replace(/[^\p{L}]/gu, "");
  if (only.length < 2) return false;
  const upper = only.replace(/[^\p{Lu}]/gu, "").length;
  if (only.length >= 6 && upper / only.length > 0.7) return false;
  return (
    /\p{Ll}{3}/u.test(text) ||
    (/\p{Ll}{2}/u.test(text) && /[.!?…,]/.test(text)) ||
    /^(I|OK|No|Hm+|Oh|Ah)\b.*[.!?…]$/.test(text.trim())
  );
}

interface Row {
  words: OcrWord[];
  text: string;
  x1: number;
  x2: number;
  yc: number;
  h: number;
}

const letters = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, "");
const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** The recogniser's words as rows of text, top to bottom, each row left to right. */
export function ocrRows(page: OcrPage): Row[] {
  const words = page.words
    .filter((w) => w.text.trim() && w.h > 0 && w.w > 0)
    .sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: Array<{ words: OcrWord[]; yc: number; h: number }> = [];
  for (const w of words) {
    const yc = w.y + w.h / 2;
    const row = rows.find(
      (r) =>
        Math.abs(r.yc - yc) < Math.max(r.h, w.h) * 0.55 &&
        // Two columns of writing on one height (a HUD left and right) are still one row; a row is split by gaps later.
        true,
    );
    if (row) {
      row.words.push(w);
      row.yc =
        row.words.reduce((n, x) => n + x.y + x.h / 2, 0) / row.words.length;
      row.h = median(row.words.map((x) => x.h));
    } else rows.push({ words: [w], yc, h: w.h });
  }
  return rows
    .map((r) => {
      const ws = [...r.words].sort((a, b) => a.x - b.x);
      return {
        words: ws,
        text: ws.map((w) => w.text).join(" "),
        x1: Math.min(...ws.map((w) => w.x)),
        x2: Math.max(...ws.map((w) => w.x + w.w)),
        yc: r.yc,
        h: r.h,
      };
    })
    .sort((a, b) => a.yc - b.yc);
}

/** Recogniser slips that are always wrong in running English: a lone "l" for "I", "lim" or "Iim" for "I'm". */
export function tidyLine(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/(^|[\s"“(])[lI|][il'’][mM](?=$|[\s.,!?])/g, "$1I'm")
    .replace(/(^|[\s"“(])[l|](?=$|[\s.,!?'’])/g, "$1I")
    .replace(/(^|[\s"“(])[l|]['’](ll|ve|d|m)\b/g, "$1I'$2")
    .replace(/\s+([.,!?…])/g, "$1")
    .trim();
}

export interface BoxOptions {
  /** Dialogue sits below this share of the picture's height. */
  top?: number;
  /** A dialogue row's middle is within this share of the picture's width from the centre. */
  centre?: number;
}

/**
 * The dialogue in one frame: the lowest block of one to four rows of centred text of one size in the lower part of
 * the picture, with the name plate just above it when there is one (a shorter row in smaller lettering or off to
 * the side: "Great Deku Tree" over "I will entrust everything to the child."). Text written as "Name: words" gives
 * the speaker too. Undefined when the frame shows no dialogue.
 */
export function readBox(
  page: OcrPage,
  o: BoxOptions = {},
): BoxRead | undefined {
  const W = page.width;
  const H = page.height;
  if (!W || !H) return undefined;
  const top = o.top ?? 0.5;
  const centre = o.centre ?? 0.1;
  const rows = ocrRows(page).filter((r) => letters(r.text).length >= 1);
  const sized = (r: Row) => r.h / H >= 0.018 && r.h / H <= 0.1;
  const centred = (r: Row) => Math.abs((r.x1 + r.x2) / 2 / W - 0.5) <= centre;
  const low = rows.filter((r) => r.yc / H >= top && sized(r) && centred(r));
  // Blocks of consecutive rows in one size of lettering.
  const blocks: Row[][] = [];
  for (const r of low) {
    const cur = blocks[blocks.length - 1];
    const prev = cur?.[cur.length - 1];
    if (
      prev &&
      cur.length < 4 &&
      r.yc - prev.yc < Math.max(prev.h, r.h) * 2.4 &&
      r.h / prev.h > 0.7 &&
      r.h / prev.h < 1.45
    )
      cur.push(r);
    else blocks.push([r]);
  }
  const worth = blocks.filter((b) => {
    const text = b.map((r) => r.text).join(" ");
    return letters(text).length >= 3 && isDialogue(text);
  });
  // The lowest block that reads as a sentence; a lone short scrap higher up is a sign or a HUD.
  const block = worth[worth.length - 1];
  const other = (skip: Set<Row>) =>
    rows
      .filter(
        (r) => !skip.has(r) && r.h / H >= 0.03 && letters(r.text).length >= 4,
      )
      .map((r) => r.text.trim());
  if (!block) return undefined;
  const first = block[0]!;
  let speaker: string | undefined;
  let plate: Row | undefined;
  for (const r of rows) {
    if (block.includes(r) || r.yc >= first.yc) continue;
    if (first.yc - r.yc > first.h * 4.5) continue;
    const text = r.text.trim();
    if (!isName(text)) continue;
    // A name plate is smaller than the line or sits to one side of it; a centred row the size of the line is the
    // line's own first row cut off by the size rule above.
    const smaller = r.h < first.h * 0.92;
    const aside = Math.abs((r.x1 + r.x2) / 2 / W - 0.5) > 0.06;
    if (!smaller && !aside) continue;
    if (!plate || r.yc > plate.yc) plate = r;
  }
  if (plate) speaker = plate.text.trim();
  let text = tidyLine(block.map((r) => r.text).join(" "));
  if (!speaker) {
    const named = text.match(
      /^([A-Z][\p{L}'’.-]*(?: [A-Z][\p{L}'’.-]*){0,3}):\s+(.{2,})$/u,
    );
    if (named && isName(named[1]!)) {
      speaker = named[1]!;
      text = named[2]!;
    }
  }
  if (letters(text).length < 3) return undefined;
  return {
    text,
    ...(speaker ? { speaker } : {}),
    other: other(new Set([...block, ...(plate ? [plate] : [])])),
    size: median(block.map((r) => r.h)) / H,
  };
}

/** One to four words, capitalised, no sentence punctuation: "Navi", "Great Deku Tree", "Kaepora Gaebora". */
export function isName(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 32) return false;
  if (/[.!?,;:…]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 4) return false;
  // Two words or more all in capitals is a card ("KOKIRI FOREST"), not a name plate.
  if (words.length >= 2 && t === t.toUpperCase()) return false;
  if (!/^[\p{Lu}?]/u.test(words[0]!)) return false;
  return words.every((w) => /^[\p{L}\p{N}'’&-]+$/u.test(w));
}

const key = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** How alike two readings are, 0 to 1: shared letter pairs over all letter pairs (Dice). */
export function alike(a: string, b: string): number {
  const x = key(a);
  const y = key(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i + 1 < x.length; i++) {
    const p = x.slice(i, i + 2);
    pairs.set(p, (pairs.get(p) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i + 1 < y.length; i++) {
    const p = y.slice(i, i + 2);
    const n = pairs.get(p) ?? 0;
    if (n > 0) {
      shared++;
      pairs.set(p, n - 1);
    }
  }
  return (2 * shared) / (x.length - 1 + (y.length - 1));
}

/** The reading seen most often; the longest among equals (a line still being typed out is shorter). */
function vote(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return (
    [...counts].sort(
      (a, b) => b[1] - a[1] || b[0].length - a[0].length,
    )[0]?.[0] ?? ""
  );
}

export type TextLine = Omit<DialogueLine, "id" | "shot">;

export interface TextBoxOptions extends BoxOptions {
  /** Seconds between samples. */
  step: number;
  /** Writing that stays this long without changing is an overlay (a watermark, a channel name), not a line. */
  overlaySeconds?: number;
}

/**
 * The text-box lines of a stretch, from frames read in time order. Consecutive frames showing the same words are
 * one line (a line being typed out letter by letter grows; the recogniser wobbles on a letter or two); the line
 * starts half a step before the first frame that shows it and ends half a step after the last. One frame without
 * text in the middle of a line is a recogniser miss, not the end of it. A new line starts when the words change.
 */
export function textBoxLines(
  samples: OcrSample[],
  o: TextBoxOptions,
): TextLine[] {
  const step = o.step;
  const overlay = o.overlaySeconds ?? 45;
  const out: TextLine[] = [];
  let cur:
    | {
        first: number;
        last: number;
        texts: string[];
        speakers: string[];
        longest: string;
      }
    | undefined;
  const close = () => {
    if (!cur) return;
    const c = cur;
    cur = undefined;
    // A line being typed out: the complete readings are the long ones. Vote among readings near the longest.
    const full = c.texts.filter(
      (t) => key(t).length >= key(c.longest).length * 0.9,
    );
    const text = vote(full.length ? full : c.texts);
    if (c.last - c.first > overlay) return;
    // One frame of a few letters is a flicker (a sign caught mid-pan), not a line.
    if (c.texts.length < 2 && key(text).length < 12) return;
    const speaker = vote(c.speakers);
    out.push({
      start: Math.max(0, Math.round((c.first - step / 2) * 100) / 100),
      end: Math.round((c.last + step / 2) * 100) / 100,
      text,
      ...(speaker ? { speaker } : {}),
      via: "textbox",
    });
  };
  let missed = 0;
  const reads = [...samples]
    .sort((a, b) => a.time - b.time)
    .map((s) => ({ s, read: readBox(s.page, o) }));
  // A game sets all its dialogue in one size of lettering: a card in bigger or smaller letters is not a line.
  const sizes = reads.flatMap((r) => (r.read ? [r.read.size] : []));
  const usual = sizes.length >= 12 ? median(sizes) : 0;
  for (const { s, read: raw } of reads) {
    const read =
      raw && usual && (raw.size < usual * 0.6 || raw.size > usual * 1.6)
        ? undefined
        : raw;
    if (!read) {
      missed++;
      if (cur && (missed >= 2 || s.time - cur.last > step * 2.5)) close();
      continue;
    }
    missed = 0;
    const k = key(read.text);
    const ck = cur ? key(cur.longest) : "";
    const grows =
      cur !== undefined &&
      Math.min(k.length, ck.length) >= 3 &&
      (ck.startsWith(k.slice(0, Math.max(3, Math.floor(k.length * 0.9)))) ||
        k.startsWith(ck.slice(0, Math.max(3, Math.floor(ck.length * 0.9)))));
    const same =
      cur !== undefined &&
      s.time - cur.last <= step * 2.5 &&
      (grows || alike(read.text, cur.longest) >= 0.8);
    if (!same) {
      close();
      cur = {
        first: s.time,
        last: s.time,
        texts: [],
        speakers: [],
        longest: "",
      };
    }
    cur!.last = s.time;
    cur!.texts.push(read.text);
    if (read.speaker) cur!.speakers.push(read.speaker);
    if (k.length > key(cur!.longest).length) cur!.longest = read.text;
  }
  close();
  return out;
}

/** Whisper inventing words over music or silence: the classic phrases, and nothing else in the line. */
const HALLUCINATED =
  /^(thanks?( you)?( so much)?( for (watching|listening))?|(please )?(like and )?subscribe.*|you|bye( bye)?|okay|so|i'?m sorry|music|applause|\[.*\]|\(.*\)|subtitles by.*|www\..*)[.!?]*$/i;

export interface VoiceOptions {
  /** Added to every time: where the transcribed audio starts in the source. */
  offset?: number;
  /** A silence this long between words ends a line. */
  pause?: number;
  maxSeconds?: number;
}

/**
 * Spoken lines from Whisper's word timings: a line ends at a pause, at the end of a sentence followed by a short
 * breath, or when it has run long. Words with no usable timing are dropped; so are lines Whisper is known to make
 * up over music, and the same line repeated over and over (a loop it falls into on silence).
 */
export function voiceLines(
  words: TimedWord[],
  o: VoiceOptions = {},
): TextLine[] {
  const offset = o.offset ?? 0;
  const pause = o.pause ?? 0.8;
  const maxSeconds = o.maxSeconds ?? 12;
  const clean = words
    .filter(
      (w) =>
        w &&
        typeof w.text === "string" &&
        w.text.trim() &&
        Number.isFinite(w.start) &&
        Number.isFinite(w.end) &&
        w.end >= w.start,
    )
    .map((w) => ({
      text: w.text.trim(),
      start: w.start + offset,
      end: w.end + offset,
    }))
    .sort((a, b) => a.start - b.start)
    // Whisper can hand a word over in two pieces, the second starting with its apostrophe ("Na" + "'vi", "I" +
    // "'m"): one word again.
    .reduce<TimedWord[]>((list, w) => {
      const prev = list[list.length - 1];
      if (prev && /^['’]\p{L}/u.test(w.text) && w.start - prev.end < 0.3) {
        prev.text += w.text;
        prev.end = w.end;
      } else list.push({ ...w });
      return list;
    }, []);
  const groups: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  for (const w of clean) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const gap = w.start - prev.end;
      const sentenceEnd = /[.!?…]["'”’)]?$/.test(prev.text);
      if (
        gap >= pause ||
        (sentenceEnd && gap >= 0.25) ||
        w.end - cur[0]!.start > maxSeconds
      ) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  const out: TextLine[] = [];
  let repeats = 0;
  for (const g of groups) {
    const text = g
      .map((w) => w.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!letters(text)) continue;
    if (HALLUCINATED.test(text)) continue;
    const seconds = Math.max(0.2, g[g.length - 1]!.end - g[0]!.start);
    // More than seven words a second is not speech.
    if (g.length / seconds > 7) continue;
    const last = out[out.length - 1];
    if (last && key(last.text) === key(text)) {
      if (++repeats >= 2) continue;
    } else repeats = 0;
    out.push({
      start: Math.round(g[0]!.start * 100) / 100,
      end: Math.round(g[g.length - 1]!.end * 100) / 100,
      text,
      via: "voice",
      words: g.map((w) => ({
        text: w.text,
        start: Math.round(w.start * 100) / 100,
        end: Math.round(w.end * 100) / 100,
      })),
    });
  }
  return out;
}

const spoken = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Which of `words` (in order) say the tokens of a line: the indexes of the longest in-order match. */
function saidBy(tokens: string[], words: string[]): Array<[number, number]> {
  const n = tokens.length;
  const m = words.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i]![j] = tokens[i] === words[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const out: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (tokens[i] === words[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/**
 * Read and heard lines as one list in time order. Each line read off the screen looks for its own words among the
 * words heard around the time it was shown: when most of them are there, it becomes one line with the screen's
 * spelling and speaker and the voice's start, end and word timings (a sentence heard in two breaths, or one breath
 * shown as two boxes, lands where it belongs). Heard lines no box claimed stay as voice lines, unless the game
 * plainly subtitles its speech (most of what was heard matched a box): then an unmatched one is Whisper hearing
 * words in music and grunts, and is dropped. The same holds for a game that speaks only through text boxes.
 */
export function mergeDialogue(read: TextLine[], heard: TextLine[]): TextLine[] {
  const pool = heard
    .flatMap((h, line) => (h.words ?? []).map((w) => ({ ...w, line, token: spoken(w.text).join("") })))
    .filter((w) => w.token)
    .sort((x, y) => x.start - y.start);
  const taken = new Set<number>();
  const out: TextLine[] = [];
  for (const r of [...read].sort((x, y) => x.start - y.start)) {
    const tokens = spoken(r.text);
    const from = pool.findIndex((w, i) => !taken.has(i) && w.end >= r.start - 2.5);
    const idx: number[] = [];
    for (let i = Math.max(0, from); from >= 0 && i < pool.length && pool[i]!.start <= r.end + 2.5; i++)
      if (!taken.has(i)) idx.push(i);
    const pairs = saidBy(
      tokens,
      idx.map((i) => pool[i]!.token),
    );
    const hit = pairs.map(([, k]) => idx[k]!);
    const enough = hit.length >= Math.max(1, Math.ceil(tokens.length * 0.5)) && (hit.length >= 2 || tokens.length <= 2);
    if (!enough) {
      out.push(r);
      continue;
    }
    let first = hit[0]!;
    let last = hit[hit.length - 1]!;
    // The line's first or last words were heard a little differently ("You" for "You've"): the words spoken right
    // before and after the matched ones, in the same breath, are the line's too.
    for (let need = pairs[0]![0]; need > 0; need--) {
      const before = pool[first - 1];
      if (!before || taken.has(first - 1) || before.line !== pool[first]!.line || pool[first]!.start - before.end > 0.5) break;
      first--;
    }
    for (let need = tokens.length - 1 - pairs[pairs.length - 1]![0]; need > 0; need--) {
      const after = pool[last + 1];
      if (!after || taken.has(last + 1) || after.line !== pool[last]!.line || after.start - pool[last]!.end > 0.5) break;
      last++;
    }
    const words = [];
    for (let i = first; i <= last; i++) {
      taken.add(i);
      words.push({ text: pool[i]!.text, start: pool[i]!.start, end: pool[i]!.end });
    }
    out.push({
      start: pool[first]!.start,
      end: pool[last]!.end,
      text: r.text,
      ...(r.speaker ? { speaker: r.speaker } : {}),
      via: "both",
      words,
    });
  }
  // What was heard and no box claimed.
  const left = heard.filter((h, line) => {
    const mine = pool.map((w, i) => ({ w, i })).filter((x) => x.w.line === line);
    if (!mine.length) return !h.words?.length;
    return mine.filter((x) => taken.has(x.i)).length / mine.length < 0.4;
  });
  const matched = pool.length ? taken.size / pool.length : 0;
  const subtitled = read.length >= 8 && matched >= 0.6;
  const textOnly = read.length >= 20 && heard.length < read.length * 0.5;
  if (!subtitled && !textOnly) out.push(...left);
  return out.sort((x, y) => x.start - y.start);
}

/**
 * Writing that is not dialogue, for one shot: the readings seen in at least two of its frames (or its only frame),
 * most seen first. A place card ("Kokiri Forest") names where the shot is.
 */
export function shotText(samples: OcrSample[], o: BoxOptions = {}): string {
  const reads = samples
    .map((s) => (readBox(s.page, o)?.other ?? fallbackOther(s.page)).join(" "))
    .filter((t) => t.trim());
  if (!reads.length) return "";
  // A card's row reads a little differently in every frame (ornaments become stray letters): the words that
  // come back in at least half the frames are the card.
  const counts = new Map<string, number>();
  for (const text of reads)
    for (const k of new Set(text.split(/\s+/).map(key)))
      if (k.length >= 3 && /\p{L}{3}/u.test(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  const need = reads.length === 1 ? 1 : Math.max(2, Math.ceil(reads.length / 2));
  const kept = (text: string) =>
    text.split(/\s+/).filter((w) => (counts.get(key(w)) ?? 0) >= need);
  const best = reads
    .map(kept)
    .sort((x, y) => y.length - x.length)[0]!;
  return [...new Map(best.map((w) => [key(w), w])).values()].join(" ").slice(0, 160);
}

function fallbackOther(page: OcrPage): string[] {
  if (!page.height) return [];
  return ocrRows(page)
    .filter((r) => r.h / page.height >= 0.03 && letters(r.text).length >= 4)
    .map((r) => r.text.trim());
}
