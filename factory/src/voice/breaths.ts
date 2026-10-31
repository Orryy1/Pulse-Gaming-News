// Breaths between lines. ElevenLabs voices take audible in-breaths before sentences, and the
// narration chain's compressor lifts them further. The timestamps say roughly where each word
// starts and ends; the audio itself says where the breath is: between two words, everything
// far quieter than speech. Those spans are turned right down, with short ramps so nothing
// clicks. Speech is never touched: a span stops at the first window loud enough to be a word.
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import type { Word } from "./elevenlabs.ts";

const run = promisify(execFile);

const RATE = 16_000;
const WINDOW = 0.01; // 10 ms loudness windows
const LOOK_BACK = 0.15; // a word's end timestamp often runs into the breath after it
const BEFORE_WORD = 0.04; // a word's first sound starts a little before its timestamp
const MIN_GAP = 0.12; // shorter spans hold no breath worth touching
const QUIET_DB = 22; // this far under typical speech is breath or room tone, not a word
const RAMP = 0.03;
export const BREATH_GAIN = 0.08; // about -22 dB
// An in-breath before a new sentence or clause (31 Oct 2026, owner: "weird breathing"): the narration chain's
// compressor lifts it to 15-19 dB under the voice, inside QUIET_DB, so the loudness walk took it for a word.
const BOUNDARY_DB = 12; // at a clause boundary, this far under speech is breath, not a word
const BOUNDARY_MIN = 0.15; // shorter quiet runs are the gaps inside words (stop consonants)
const BOUNDARY_REACH = 0.6; // how far into the next word's timestamp its sound may start
const EDGE = 0.03; // kept clear of the words' own sound on each side
// The volume filter changes gain once per audio frame (about 23 ms at mp3 frame sizes), so a "ramp" was one
// or two hard steps that ticked when they landed on a word. Frames this short make the ramp truly smooth.
export const SMOOTH_FRAME = "asetnsamples=n=64:p=0";

/** Loudness in dB per 10 ms window of mono samples. */
export function loudness(samples: Int16Array, rate = RATE): number[] {
  const n = Math.round(rate * WINDOW);
  const out: number[] = [];
  for (let i = 0; i + n <= samples.length; i += n) {
    let sum = 0;
    for (let k = i; k < i + n; k++) sum += samples[k]! * samples[k]!;
    out.push(20 * Math.log10(Math.sqrt(sum / n) / 32768 + 1e-9));
  }
  return out;
}

/**
 * The breath spans, in seconds: for each pause between words, the run of quiet windows that
 * ends just before the next word, followed back (up to a little before the last word's
 * timestamped end) until the audio is loud enough to be speech.
 */
export function breathGaps(words: Word[], db: number[]): [number, number][] {
  if (!db.length) return [];
  const sorted = [...db].sort((a, b) => a - b);
  const speech = sorted[Math.floor(sorted.length * 0.9)]!;
  const quiet = (t: number) =>
    (db[Math.floor(t / WINDOW)] ?? -200) < speech - QUIET_DB;
  const gaps: [number, number][] = [];
  let prevEnd = 0;
  for (const [i, w] of words.entries()) {
    const b = w.start - BEFORE_WORD;
    const floor = i === 0 ? 0 : Math.max(0, prevEnd - LOOK_BACK);
    let a = b;
    while (a - WINDOW >= floor && quiet(a - WINDOW)) a -= WINDOW;
    if (b - a >= MIN_GAP) gaps.push([round(a + WINDOW), round(b)]);
    prevEnd = Math.max(prevEnd, w.end);
  }
  return mergeSpans([...gaps, ...clauseBreaths(words, db, speech)]);
}

/**
 * The in-breath at each sentence or clause boundary, found from the audio (31 Oct 2026): the timestamps fold
 * a breath into a neighbouring word ("co-writes." ran a full second; "His" started 0.4 s before its sound),
 * so the gap between timestamps is not where the breath is. Around a boundary, the breath is the quiet run
 * (under speech by BOUNDARY_DB, at least BOUNDARY_MIN long, so no stop consonant qualifies) that ends where the
 * next word's sound begins; it is turned down clear of both words' sound.
 */
export function clauseBreaths(
  words: Word[],
  db: number[],
  speech: number,
): [number, number][] {
  const quiet = (k: number) => (db[k] ?? -200) < speech - BOUNDARY_DB;
  const out: [number, number][] = [];
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]!;
    const w = words[i]!;
    if (!/[.!?,;:]["')\]]*$/.test(prev.text.trim())) continue;
    const lo = Math.floor(
      (prev.start + Math.min(0.15, (prev.end - prev.start) / 2)) / WINDOW,
    );
    const hi = Math.min(
      db.length,
      Math.ceil(Math.min(w.end, w.start + BOUNDARY_REACH) / WINDOW),
    );
    // The longest quiet run in the boundary's reach that is followed by sound.
    let best: [number, number] | undefined;
    for (let k = lo; k < hi; ) {
      if (!quiet(k)) {
        k++;
        continue;
      }
      let j = k;
      while (j < hi && quiet(j)) j++;
      if (j < hi && (!best || j - k > best[1] - best[0])) best = [k, j];
      k = j;
    }
    if (!best || (best[1] - best[0]) * WINDOW < BOUNDARY_MIN) continue;
    const a = best[0] * WINDOW + EDGE;
    const b = best[1] * WINDOW - EDGE;
    if (b - a >= MIN_GAP) out.push([round(a), round(b)]);
  }
  return out;
}

/** Overlapping or touching spans as one. */
function mergeSpans(spans: [number, number][]): [number, number][] {
  const s = [...spans].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out.at(-1);
    if (last && a <= last[1] + RAMP * 2) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Turns the breaths between words down, in place. Returns how many spans it quietened. */
export async function quietBreaths(
  file: string,
  words: Word[],
): Promise<number> {
  const { stdout } = await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-i",
      file,
      "-ac",
      "1",
      "-ar",
      String(RATE),
      "-f",
      "s16le",
      "-",
    ],
    {
      encoding: "buffer",
      maxBuffer: 512 * 1024 * 1024,
    },
  );
  const pcm = new Int16Array(
    stdout.buffer,
    stdout.byteOffset,
    Math.floor(stdout.byteLength / 2),
  );
  const gaps = breathGaps(words, loudness(pcm));
  if (!gaps.length) return 0;
  const dip = gaps
    .map(([a, b]) => `clip(min((t-${a})/${RAMP},(${b}-t)/${RAMP}),0,1)`)
    .join("+");
  const script = `${file}.breaths.txt`;
  const tmp = `${file}.breaths.mp3`;
  await fs.writeFile(
    script,
    `${SMOOTH_FRAME},volume=eval=frame:volume='1-${1 - BREATH_GAIN}*min(1,${dip})'`,
    "utf8",
  );
  try {
    await run(FFMPEG, [
      "-loglevel",
      "error",
      "-y",
      "-i",
      file,
      "-filter_script:a",
      script,
      "-ar",
      "44100",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      tmp,
    ]);
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(script, { force: true }).catch(() => undefined);
  }
  return gaps.length;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
