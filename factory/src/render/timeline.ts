// Pure timing maths shared by the renderer and the tests: which spoken
// segment is on screen when, and how captions are paged.

import type { Word } from "../voice/elevenlabs.ts";

export type SegmentKind = "hook" | "beat" | "take" | "loop";

export interface Visual {
  kind: "title" | "stat" | "date" | "quote" | "list" | "none" | "timeline" | "price" | "score" | "countdown" | "compare" | "rank";
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
export function buildSegments(inputs: SegmentInput[], words: Word[], totalSeconds: number): Segment[] {
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
        if (j > 0 && j < words.length && norm(words[j]!.text) === want) { at = j; break; }
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
export function pageCaptions(words: Word[], maxWords = 4, maxChars = 30, minSeconds = 0.33): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    pages.push({ start: cur[0]!.start, end: cur.at(-1)!.end, words: cur });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const chars = cur.reduce((s, x) => s + x.text.length + 1, 0) + w.text.length;
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
    const chars = [...a.words, ...b.words].reduce((n, w) => n + w.text.length + 1, 0);
    if (a.end - a.start < minSeconds && a.words.length + b.words.length <= maxWords + 1 && chars <= maxChars + 6) {
      pages.splice(i, 2, { start: a.start, end: b.end, words: [...a.words, ...b.words] });
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
  for (const p of pageCaptions(words, 8, 40)) {
    const text = p.words.map((w) => w.text).join(" ");
    const last = cues.at(-1);
    if (last && p.end - p.start < 0.7 && `${last.text} ${text}`.length <= 64) {
      last.text += ` ${text}`;
      last.end = Math.max(last.end, p.end);
      continue;
    }
    cues.push({ start: p.start, end: Math.max(p.end, p.start + 0.7), text });
  }
  for (let i = 0; i < cues.length - 1; i++) if (cues[i]!.end > cues[i + 1]!.start) cues[i]!.end = cues[i + 1]!.start;
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n") + (cues.length ? "\n" : "");
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
