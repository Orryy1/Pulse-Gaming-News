// Pure timing maths shared by the renderer and the tests: which spoken
// segment is on screen when, and how captions are paged.

import type { Word } from "../voice/elevenlabs.ts";

export type SegmentKind = "hook" | "beat" | "take" | "loop";

export interface Visual {
  kind: "title" | "stat" | "date" | "quote" | "list" | "none";
  primary: string;
  secondary: string;
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

const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length;

/**
 * Narration was synthesised as the segments joined by spaces, so the n-th
 * spoken word belongs to whichever segment contains word n.
 */
export function buildSegments(inputs: SegmentInput[], words: Word[], totalSeconds: number): Segment[] {
  const out: Segment[] = [];
  let idx = 0;
  for (let i = 0; i < inputs.length; i++) {
    const seg = inputs[i]!;
    const n = countWords(seg.text);
    if (n === 0) continue;
    const first = words[Math.min(idx, words.length - 1)];
    idx += n;
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
export function pageCaptions(words: Word[], maxWords = 3, maxChars = 18): CaptionPage[] {
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
  // Hold each page until the next one starts so captions never blink off mid-sentence.
  for (let i = 0; i < pages.length - 1; i++) {
    const gap = pages[i + 1]!.start - pages[i]!.end;
    if (gap < 0.6) pages[i]!.end = pages[i + 1]!.start;
  }
  return pages;
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
