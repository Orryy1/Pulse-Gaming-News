// The voice sometimes stops for a second in the middle of a sentence ("Pulse is
// ranking eight ... Call of Duty campaigns"). After voicing, silences inside a
// sentence are cut to a natural beat and long silences between sentences are
// shortened; the word timings shift with the audio so captions and pictures
// stay in sync.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { FFMPEG } from "../lib/bin.ts";

const run = promisify(execFile);

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface Cut {
  from: number; // seconds in the original audio
  to: number;
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
    if (to - from > 0.05) cuts.push({ from, to });
  }
  return cuts;
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
  const cuts = pauseCuts(words);
  if (!cuts.length) return { words, durationSeconds, removedSeconds: 0 };
  await cutAudio(file, cuts);
  const removed = cuts.reduce((n, c) => n + (c.to - c.from), 0);
  return {
    words: shiftWords(words, cuts),
    durationSeconds: durationSeconds - removed,
    removedSeconds: removed,
  };
}
