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
  return gaps;
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
    `volume=eval=frame:volume='1-${1 - BREATH_GAIN}*(${dip})'`,
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
