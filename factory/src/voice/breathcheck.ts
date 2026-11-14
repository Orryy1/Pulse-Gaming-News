// How a finished narration sounds, measured rather than heard: its pace and its audible breaths. The owner
// found the new voice's intakes of breath off-putting (30 Oct 2026); ducking them after the fact never
// found them, so each take is measured and a breathy one is taken again.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG, audioFilterScriptArgs, installedFfmpegMajor } from "../lib/bin.ts";

const run = promisify(execFile);

const FRAME = 0.02; // 20 ms of loudness per sample
const RATE = 48000;

/** The loudness envelope of a file, one RMS level (dBFS) per 20 ms. */
export async function envelope(file: string): Promise<number[]> {
  const { stdout } = await run(
    FFMPEG,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-af",
      // Resampled inside the chain: as output options the rate would apply after the stats, and a 44.1 kHz
      // file's frames would then be 9% longer than 20 ms (every timestamp drifted; caught 30 Oct 2026).
      `aformat=channel_layouts=mono,aresample=${RATE},asetnsamples=${RATE * FRAME}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 1 << 28 },
  );
  return [...stdout.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) =>
    m[1] === "-inf" ? -99 : +m[1]!,
  );
}

/** A breath this close under the speech level is one a listener notices. */
const LOUD_DB = -16;
/**
 * A breath this far under that line is turned down with the audible ones. Breaths bunch just below it, and the re-encode
 * moves a level by up to 0.3 dB (measured across 36 real narrations, 4 Nov 2026), so one left at -16.2 can read -15.9 after
 * the others have been dealt with: the Elder Scrolls Short was reported for exactly that.
 */
const NEAR_DB = 3;

export interface BreathReport {
  minutes: number;
  /** The level speech sits at (dBFS). */
  speechDb: number;
  breaths: number;
  /** Breaths within 16 dB of the speech: the ones a listener notices. */
  loudBreaths: number;
  loudPerMinute: number;
  /** The loudest few, as "m:ss level length". */
  loudest: string[];
  /** Every breath to turn down (seconds): the audible ones and those just under the line. */
  spans: Array<{ start: number; end: number }>;
}

/**
 * Breaths in a loudness envelope: a run of 120-700 ms sitting 10-30 dB under the speech level with speech
 * within 160 ms on both sides. Checked against last night's samples: the take the owner rejected measured
 * 6.8 loud breaths a minute, the one they chose none, the old narrator's documentary 0.3.
 */
export function breathsIn(env: number[]): BreathReport {
  const sorted = env.filter((v) => v > -60).sort((a, b) => a - b);
  const speech = sorted[Math.floor(sorted.length * 0.7)] ?? -20;
  const isSpeech = (v: number) => v >= speech - 8;
  const inBand = (v: number) => v >= speech - 30 && v < speech - 10;
  const found: Array<{ at: number; len: number; level: number }> = [];
  let i = 0;
  while (i < env.length) {
    if (!inBand(env[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < env.length && inBand(env[j]!)) j++;
    const len = (j - i) * FRAME;
    const before = env.slice(Math.max(0, i - 8), i).some(isSpeech);
    const after = env.slice(j, j + 8).some(isSpeech);
    if (len >= 0.12 && len <= 0.7 && before && after)
      found.push({
        at: i * FRAME,
        len,
        level: Math.max(...env.slice(i, j)) - speech,
      });
    i = j;
  }
  const minutes = Math.max(1 / 60, (env.length * FRAME) / 60);
  const loud = found.filter((b) => b.level >= LOUD_DB);
  return {
    minutes: Math.round(minutes * 100) / 100,
    speechDb: Math.round(speech * 10) / 10,
    breaths: found.length,
    loudBreaths: loud.length,
    loudPerMinute: Math.round((loud.length / minutes) * 10) / 10,
    loudest: [...found]
      .sort((a, b) => b.level - a.level)
      .slice(0, 5)
      .map(
        (b) =>
          `${Math.floor(b.at / 60)}:${String(Math.floor(b.at % 60)).padStart(2, "0")} ${b.level.toFixed(1)} dB ${b.len.toFixed(2)} s`,
      ),
    spans: found
      .filter((b) => b.level >= LOUD_DB - NEAR_DB)
      .map((b) => ({ start: b.at, end: b.at + b.len })),
  };
}

export async function breathReport(file: string): Promise<BreathReport> {
  return breathsIn(await envelope(file));
}

/** How far an audible breath is turned down: 14 dB puts it under the music, not into silence. */
const DUCK = 0.2;

/**
 * Turns every audible breath down in place, with 25 ms ramps either side; timings are untouched, so the
 * word list and captions stay right. The file is re-encoded once, at the same rate.
 */
export async function quietenBreaths(
  file: string,
  report: BreathReport,
): Promise<number> {
  if (!report.spans.length) return 0;
  // One timeline-enabled volume filter per breath, read from a script file: a documentary has a couple of
  // hundred, more than a command line or one expression takes. The step lands on a signal 10-30 dB under
  // the speech, so it needs no ramp.
  // Cut into 6 ms pieces first: the filter switches per piece of audio, and an MP3's come in 26 ms, which left the
  // first moments of a breath at full level for the re-measure to report again.
  const chain = [
    "asetnsamples=n=256:p=0",
    ...report.spans.map(
      ({ start, end }) =>
        `volume=enable='between(t,${start.toFixed(3)},${end.toFixed(3)})':volume=${DUCK}`,
    ),
  ].join(",\n");
  const fs = await import("node:fs/promises");
  const script = `${file}.breaths.txt`;
  const tmp = `${file}.ducked.mp3`;
  await fs.writeFile(script, chain, "utf8");
  try {
    await run(FFMPEG, [
      "-y",
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      ...audioFilterScriptArgs(script, installedFfmpegMajor()),
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "2",
      tmp,
    ]);
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(script, { force: true });
    await fs.rm(tmp, { force: true });
  }
  return report.spans.length;
}

/** Rounds of turning down a take gets: each one re-encodes it, and the second only ever has stragglers to do. */
const MAX_PASSES = 2;

/**
 * Measures a take and turns its breaths down in place until none is audible. Any breath at all is worth it: the old
 * test, more than 1.5 a minute, let a single one through untouched in any clip over 40 s (a -10.4 dB breath went out on
 * 3 Nov 2026), and a Short has no room to hide one. What comes back as after is what the listener gets.
 */
export async function turnDownBreaths(
  file: string,
): Promise<{ before: BreathReport; after: BreathReport; passes: number }> {
  const before = await breathReport(file);
  let after = before;
  let passes = 0;
  while (
    passes < MAX_PASSES &&
    after.spans.length &&
    (passes === 0 || after.loudBreaths > 0)
  ) {
    await quietenBreaths(file, after);
    after = await breathReport(file);
    passes++;
  }
  return { before, after, passes };
}

/** Spoken words a minute while speaking (pauses over 0.35 s left out), from the narration's word timings. */
export function wordsPerMinute(
  words: ReadonlyArray<{ start: number; end: number }>,
): number {
  if (words.length < 2) return 0;
  let spoken = 0;
  for (const [k, w] of words.entries()) {
    spoken += Math.max(0, w.end - w.start);
    const next = words[k + 1];
    if (next) spoken += Math.min(0.35, Math.max(0, next.start - w.end));
  }
  return spoken > 0 ? Math.round(words.length / (spoken / 60)) : 0;
}

/** Too fast, or breathing the listener can hear: what to say about a take, or nothing when it passes. */
export function voiceProblems(report: BreathReport, wpm: number, wpmMax = 190): string[] {
  const p: string[] = [];
  if (report.loudPerMinute > 1.5)
    p.push(
      `${report.loudPerMinute} audible breaths a minute (${report.loudest.slice(0, 3).join(", ")})`,
    );
  if (wpm > wpmMax) p.push(`${wpm} words a minute while speaking`);
  return p;
}
