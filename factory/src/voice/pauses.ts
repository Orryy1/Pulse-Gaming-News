// The voice sometimes stops for a second in the middle of a sentence ("Pulse is
// ranking eight ... Call of Duty campaigns"). After voicing, silences inside a
// sentence are cut to a natural beat and long silences between sentences are
// shortened; the word timings shift with the audio so captions and pictures
// stay in sync.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { FFMPEG } from "../lib/bin.ts";
import { loudness } from "./breaths.ts";

const run = promisify(execFile);

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface Cut {
  from: number; // seconds in the original audio
  to: number;
  keep?: number; // the silence left in place, split either side
}

const SENTENCE_END = /[.!?…:;]["”’')\]]*$/;
const CLAUSE_END = /[,—–-]["”’')\]]*$/;

/** The silences to remove: inside a sentence anything over 0.45 s is cut to 0.12 s (0.25 s after a comma); between sentences anything over 0.9 s is cut to 0.6 s. */
export function pauseCuts(words: TimedWord[]): Cut[] {
  const cuts: Cut[] = [];
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]!;
    const gap = words[i]!.start - prev.end;
    const keep = SENTENCE_END.test(prev.text)
      ? 0.6
      : CLAUSE_END.test(prev.text)
        ? 0.25
        : 0.12;
    const limit = SENTENCE_END.test(prev.text) ? 0.9 : 0.45;
    if (gap <= limit) continue;
    // Cut from the middle of the silence, leaving `keep` seconds split either side.
    const from = prev.end + keep / 2;
    const to = words[i]!.start - keep / 2;
    if (to - from > 0.05) cuts.push({ from, to, keep });
  }
  return cuts;
}

const WINDOW = 0.01; // the loudness windows (breaths.ts)
const SEARCH = 0.6; // how far a cut may move to find the real silence
const QUIET_DB = 25; // this far under typical speech is silence or room tone

/**
 * Moves each cut onto the silence the audio actually has. The word timings only say roughly
 * where a pause is; when they ran late the trim cut into the next words ("San Andreas" came out
 * as "Sayus", GTA ranking, 23 Oct 2026). A cut now lands inside the longest quiet run near it,
 * keeps its margin of silence either side, shrinks to fit, and is dropped when there is no
 * real pause there. db is loudness per 10 ms window.
 */
export function fitCutsToAudio(cuts: Cut[], db: number[]): Cut[] {
  if (!db.length) return [];
  const sorted = [...db].sort((a, b) => a - b);
  const speech = sorted[Math.floor(sorted.length * 0.9)]!;
  const quiet = (k: number) => (db[k] ?? 0) < speech - QUIET_DB;
  const out: Cut[] = [];
  for (const c of cuts) {
    const keep = c.keep ?? 0.12;
    const lo = Math.max(0, Math.floor((c.from - keep / 2 - SEARCH) / WINDOW));
    const hi = Math.min(
      db.length,
      Math.ceil((c.to + keep / 2 + SEARCH) / WINDOW),
    );
    // The longest quiet run in reach, preferring the one nearest the planned cut on a tie.
    let best: [number, number] | undefined;
    for (let k = lo; k < hi; k++) {
      if (!quiet(k)) continue;
      let e = k;
      while (e < hi && quiet(e)) e++;
      const len = e - k;
      const mid = (k + e) / 2;
      const want = (c.from + c.to) / 2 / WINDOW;
      if (
        !best ||
        len > best[1] - best[0] ||
        (len === best[1] - best[0] &&
          Math.abs(mid - want) < Math.abs((best[0] + best[1]) / 2 - want))
      )
        best = [k, e];
      k = e;
    }
    if (!best) continue;
    const qs = best[0] * WINDOW;
    const qe = best[1] * WINDOW;
    const room = qe - qs - keep;
    const len = Math.min(c.to - c.from, room);
    if (len <= 0.05) continue;
    const from = Math.round((qs + (qe - qs - len) / 2) * 1000) / 1000;
    const prev = out[out.length - 1];
    if (prev && from < prev.to) continue;
    out.push({ from, to: Math.round((from + len) * 1000) / 1000, keep });
  }
  return out;
}

/** Word timings after the cuts. */
export function shiftWords(words: TimedWord[], cuts: Cut[]): TimedWord[] {
  return words.map((w) => {
    const before = cuts
      .filter((c) => c.to <= w.start + 1e-6)
      .reduce((n, c) => n + (c.to - c.from), 0);
    return { ...w, start: w.start - before, end: w.end - before };
  });
}

/** Loudness per 10 ms window of a file. */
async function loudnessOf(file: string): Promise<number[]> {
  const { stdout } = await run(
    FFMPEG,
    ["-v", "error", "-i", file, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
    {
      encoding: "buffer",
      maxBuffer: 512 * 1024 * 1024,
    },
  );
  const buf = stdout as unknown as Buffer;
  return loudness(
    new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2)),
  );
}

/** Cuts the silences out of the audio file in place. */
export async function cutAudio(file: string, cuts: Cut[]): Promise<void> {
  if (!cuts.length) return;
  const expr = cuts
    .map((c) => `between(t,${c.from.toFixed(3)},${c.to.toFixed(3)})`)
    .join("+");
  const tmp = file.replace(/\.mp3$/i, ".tight.mp3");
  await run(
    FFMPEG,
    [
      "-loglevel",
      "error",
      "-y",
      "-i",
      file,
      "-af",
      `aselect='not(${expr})',asetpts=N/SR/TB`,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      tmp,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  await fs.rename(tmp, file);
}

/** A breather put into the narration: `seconds` of silence at `at` (seconds in the audio before it). */
export interface Gap {
  at: number;
  seconds: number;
}

/** Word timings after silence is put in: every word at or after a gap moves later by it. */
export function openWords(words: TimedWord[], gaps: Gap[]): TimedWord[] {
  return words.map((w) => {
    const after = gaps
      .filter((g) => g.at <= w.start + 1e-6)
      .reduce((n, g) => n + g.seconds, 0);
    return { ...w, start: w.start + after, end: w.end + after };
  });
}

/**
 * Where a documentary's breathers go: in the silence before each chapter's first word (the word
 * indices given), so no word is split. The narration is wall-to-wall otherwise (owner, 27 Oct 2026).
 */
export function chapterGaps(
  words: TimedWord[],
  firstWords: number[],
  seconds: number,
): Gap[] {
  return firstWords
    .filter((k) => k > 0 && k < words.length)
    .map((k) => ({
      at: Math.round(((words[k - 1]!.end + words[k]!.start) / 2) * 1000) / 1000,
      seconds,
    }));
}

/** Puts silence into the audio file in place, one stretch per gap (mono 44.1 kHz, as the narration is). */
export async function insertSilence(file: string, gaps: Gap[]): Promise<void> {
  if (!gaps.length) return;
  const sorted = [...gaps].sort((a, b) => a.at - b.at);
  const n = sorted.length + 1;
  const parts: string[] = [
    `[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono,asplit=${n}${Array.from({ length: n }, (_, k) => `[s${k}]`).join("")}`,
  ];
  const chain: string[] = [];
  for (let k = 0; k < n; k++) {
    const from = k === 0 ? 0 : sorted[k - 1]!.at;
    const to = sorted[k]?.at;
    parts.push(
      `[s${k}]atrim=start=${from.toFixed(3)}${to !== undefined ? `:end=${to.toFixed(3)}` : ""},asetpts=PTS-STARTPTS[p${k}]`,
    );
    chain.push(`[p${k}]`);
    if (k < sorted.length) {
      parts.push(
        `anullsrc=r=44100:cl=mono,atrim=0:${sorted[k]!.seconds.toFixed(3)},aformat=sample_fmts=fltp[z${k}]`,
      );
      chain.push(`[z${k}]`);
    }
  }
  parts.push(`${chain.join("")}concat=n=${chain.length}:v=0:a=1[out]`);
  const tmp = file.replace(/\.mp3$/i, ".open.mp3");
  await run(
    FFMPEG,
    [
      "-loglevel",
      "error",
      "-y",
      "-i",
      file,
      "-filter_complex",
      parts.join(";"),
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      tmp,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  await fs.rename(tmp, file);
}

/** Tightens a narration's pauses; returns its new words and duration (unchanged when nothing needed cutting). */
export async function tightenPauses(
  file: string,
  words: TimedWord[],
  durationSeconds: number,
): Promise<{
  words: TimedWord[];
  durationSeconds: number;
  removedSeconds: number;
}> {
  const planned = pauseCuts(words);
  if (!planned.length) return { words, durationSeconds, removedSeconds: 0 };
  const cuts = fitCutsToAudio(planned, await loudnessOf(file));
  if (!cuts.length) return { words, durationSeconds, removedSeconds: 0 };
  await cutAudio(file, cuts);
  const removed = cuts.reduce((n, c) => n + (c.to - c.from), 0);
  return {
    words: shiftWords(words, cuts),
    durationSeconds: durationSeconds - removed,
    removedSeconds: removed,
  };
}
