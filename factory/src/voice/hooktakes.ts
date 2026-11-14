// Multi-take hooks (HOOK_TAKES, off by default; research 14 Nov 2026, tech.md item 3.9). The first line of a
// Short decides whether anyone stays, and one ElevenLabs take is one roll of the dice: the same line can come
// out flat, rushed, breathy or slurred. So the hook alone is voiced a few more times, each take is measured
// against the read already inside the narration, and the best is spliced in front of the rest.
//
// What a take is scored on, all measured, none judged by ear:
//   energy   its intonation range (semitones between the 10th and 90th percentile of the voiced pitch) and its
//            speech level against the loudest take of the set
//   clarity  the share of the hook's words Whisper hears back (the narration check's own recogniser)
//   pace     words a minute as heard (after SHORT_SPEED) against HOOK_TARGET_WPM
//   breaths  audible intakes, by the narration's breath detector (src/voice/breathcheck.ts)
//   match    pitch and brightness against the rest of the narration (src/voice/takecheck.ts): a spliced hook
//            must sound like the same read, so a take that strays is never used
// The read already in the narration competes too and wins ties: a splice is only worth it for a clear gain.
//
// Spend: only the hook's characters, once per extra take, checked against the balance first, and every take is
// written to data/hooktakes.jsonl with the characters it used. No delivery tags (eleven_v4 reads them out).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "../lib/bin.ts";
import { log, errorMessage } from "../lib/util.ts";
import { breathsIn, envelope } from "./breathcheck.ts";
import {
  decodeMono,
  deviation,
  measureTake,
  RATE,
  voicedPitches,
  type TakeMeasure,
} from "./takecheck.ts";
import { tokens, transcribeWords } from "../qa/narration.ts";
import type { Word } from "./elevenlabs.ts";

const run = promisify(execFile);

/** A hook outside these lengths (words) is not retaken: too short to vary, or not a hook. */
export const HOOK_MIN_WORDS = 3;
export const HOOK_MAX_WORDS = 25;
/** A new take must beat the read in the narration by this much (0-1 score) to be spliced in. */
export const SPLICE_MARGIN = 0.05;
/** Under this share of the words heard back, a take is out. */
export const CLARITY_FLOOR = 0.8;
/** Over this deviation (1 = takecheck's limit: 5% pitch or 10% brightness), a take is out. */
export const MATCH_CEILING = 1.6;
/** Seconds of fade either side of the splice, inside the pause between the hook and the next word. */
export const SPLICE_FADE = 0.015;

export const WEIGHTS = {
  energy: 0.3,
  clarity: 0.35,
  pace: 0.2,
  breaths: 0.15,
} as const;

/** The hook: the spoken text's first sentence, when it is a hook-sized one (pure). */
export function hookOf(spoken: string): string | undefined {
  const text = spoken.trim();
  const m = text.match(/^[\s\S]*?[.!?…]+["”’)]?(?=\s|$)/);
  const hook = (m?.[0] ?? "").trim();
  const n = hook.split(/\s+/).filter(Boolean).length;
  if (!hook || hook === text || n < HOOK_MIN_WORDS || n > HOOK_MAX_WORDS)
    return undefined;
  return hook;
}

/** Comparable tokens of a text (the narration check's normaliser). */
const toks = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => tokens(w));

/**
 * Where the hook ends in a narration's word timings (pure): the hook's words must be its first words, as the
 * narration check reads them. `cut` is the middle of the pause after the hook, `tail` how far past its last
 * word that is. Undefined when the timings do not start with the hook or nothing follows it.
 */
export function hookSplit(
  words: Word[],
  hook: string,
): { count: number; end: number; cut: number; tail: number } | undefined {
  const count = hook.split(/\s+/).filter(Boolean).length;
  if (words.length <= count) return undefined;
  const heard = toks(
    words
      .slice(0, count)
      .map((w) => w.text)
      .join(" "),
  );
  if (heard.join(" ") !== toks(hook).join(" ")) return undefined;
  const end = words[count - 1]!.end;
  const next = words[count]!.start;
  if (next <= end) return undefined;
  const cut = (end + next) / 2;
  return { count, end, cut, tail: cut - end };
}

/** Share of the hook's tokens found in order in what was heard (longest common subsequence), 0-1 (pure). */
export function clarityOf(hook: string, heard: string): number {
  const a = toks(hook);
  const b = toks(heard);
  if (!a.length) return 0;
  const dp: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[b.length]! / a.length;
}

export interface HookMeasure {
  label: string;
  /** Words a minute as the viewer hears them (after the Short's speed-up). */
  wpm: number;
  /** Semitones between the 10th and 90th percentile of the voiced pitch. */
  rangeSt: number;
  /** Speech level, dBFS (the 70th percentile of the 20 ms loudness on speech). */
  levelDb: number;
  loudBreaths: number;
  /** Share of the hook's words Whisper heard, or undefined when no recogniser ran. */
  clarity?: number;
  /** takecheck deviation from the rest of the narration (1 = at the limit), when measured. */
  match?: number;
}

export interface HookScore {
  label: string;
  total: number;
  parts: { energy: number; clarity?: number; pace: number; breaths: number };
  out?: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * The takes' scores (pure), 0-1 each part, weighted by WEIGHTS (a part that was not measured drops out and the
 * rest are re-weighted). Energy reads intonation range (4 to 12 semitones) and level against the set's loudest
 * (3 dB below it scores nothing); pace loses all its marks 40 wpm off the target; one audible breath halves
 * the breath marks and two take them all. A take under the clarity floor or past the match ceiling is out.
 */
export function scoreHooks(
  takes: HookMeasure[],
  targetWpm: number,
): HookScore[] {
  const top = Math.max(...takes.map((t) => t.levelDb));
  return takes.map((t) => {
    const energy =
      0.6 * clamp01((t.rangeSt - 4) / 8) +
      0.4 * clamp01(1 - (top - t.levelDb) / 3);
    const pace = clamp01(1 - Math.abs(t.wpm - targetWpm) / 40);
    const breaths = t.loudBreaths <= 0 ? 1 : t.loudBreaths === 1 ? 0.5 : 0;
    const parts = {
      energy,
      pace,
      breaths,
      ...(t.clarity === undefined ? {} : { clarity: t.clarity }),
    };
    let sum = 0;
    let weight = 0;
    for (const [k, w] of Object.entries(WEIGHTS)) {
      const v = (parts as Record<string, number | undefined>)[k];
      if (v === undefined) continue;
      sum += w * v;
      weight += w;
    }
    const out =
      t.clarity !== undefined && t.clarity < CLARITY_FLOOR
        ? `only ${Math.round(t.clarity * 100)}% of the words heard`
        : t.match !== undefined && t.match > MATCH_CEILING
          ? `sounds unlike the rest of the read (${t.match.toFixed(2)})`
          : undefined;
    return {
      label: t.label,
      total: weight ? sum / weight : 0,
      parts,
      ...(out ? { out } : {}),
    };
  });
}

/**
 * The take to keep (pure): index 0 is the read already in the narration and wins unless a take that is not
 * out scores SPLICE_MARGIN more. A narration read that is itself out loses to the best take that is not.
 */
export function chooseHook(
  scores: HookScore[],
  margin = SPLICE_MARGIN,
): number {
  const ok = scores.map((s, i) => ({ s, i })).filter((x) => !x.s.out);
  if (!ok.length) return 0;
  const best = ok.reduce((a, b) => (b.s.total > a.s.total ? b : a));
  if (best.i === 0) return 0;
  const base = scores[0]!;
  if (base.out) return best.i;
  return best.s.total >= base.total + margin ? best.i : 0;
}

/**
 * The narration's words with a new hook (pure): the take's own timings for the hook, the rest moved by how
 * much longer or shorter the hook became.
 */
export function spliceWords(
  main: Word[],
  take: Word[],
  count: number,
  mainCut: number,
  takeCut: number,
): Word[] {
  const shift = takeCut - mainCut;
  return [
    ...take.slice(0, count),
    ...main
      .slice(count)
      .map((w) => ({ ...w, start: w.start + shift, end: w.end + shift })),
  ];
}

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[
    Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))
  ]!;
};

/** Cuts [from, to) seconds of a file to a WAV (for measuring), keeping the source rate. */
export async function cutAudio(
  src: string,
  dest: string,
  from: number,
  to: number,
): Promise<void> {
  await run(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-i",
    src,
    "-af",
    `atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)},asetpts=PTS-STARTPTS`,
    "-c:a",
    "pcm_s16le",
    dest,
  ]);
}

/** One hook read's measurements (the file holds the hook alone). */
export async function measureHook(
  file: string,
  label: string,
  hook: string,
  speed: number,
  opts: { whisperPython?: string; norm?: TakeMeasure } = {},
): Promise<HookMeasure & { measure: TakeMeasure }> {
  const samples = await decodeMono(file);
  const pitches = voicedPitches(samples, RATE);
  const p10 = percentile(pitches, 0.1);
  const p90 = percentile(pitches, 0.9);
  const env = await envelope(file);
  const speech = env.filter((v) => v > -60);
  const breaths = breathsIn(env);
  const seconds = samples.length / RATE;
  // Pace over the words themselves: leading and trailing silence trimmed from the 20 ms envelope.
  const top = percentile(speech, 0.7);
  const first = env.findIndex((v) => v >= top - 20);
  let last = env.length - 1;
  while (last > 0 && env[last]! < top - 20) last--;
  const spoken =
    first >= 0 && last > first ? (last - first + 1) * 0.02 : seconds;
  const words = hook.split(/\s+/).filter(Boolean).length;
  const measure = await measureTake(file);
  let clarity: number | undefined;
  if (opts.whisperPython) {
    try {
      const heard = await transcribeWords(file, opts.whisperPython);
      clarity = clarityOf(hook, heard.map((w) => w.text).join(" "));
    } catch (err) {
      log("warn", "hook take not transcribed; scored without clarity", {
        error: errorMessage(err),
      });
    }
  }
  return {
    label,
    wpm: (words / Math.max(0.3, spoken)) * 60 * speed,
    rangeSt: p10 > 0 && p90 > 0 ? 12 * Math.log2(p90 / p10) : 0,
    levelDb: top,
    loudBreaths: breaths.loudBreaths,
    ...(clarity === undefined ? {} : { clarity }),
    ...(opts.norm ? { match: deviation(measure, opts.norm).score } : {}),
    measure,
  };
}

/**
 * Replaces the start of `main` (up to `mainCut` s) with the start of `take` (up to `takeCut` s): short fades
 * inside the silence either side, re-encoded at the narration's rate. Writes over `main`.
 */
export async function spliceAudio(
  main: string,
  take: string,
  mainCut: number,
  takeCut: number,
): Promise<void> {
  const tmp = `${main}.hook.mp3`;
  const f = SPLICE_FADE;
  await run(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-i",
    take,
    "-i",
    main,
    "-filter_complex",
    `[0:a]atrim=end=${takeCut.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,afade=t=out:st=${Math.max(0, takeCut - f).toFixed(3)}:d=${f}[a];` +
      `[1:a]atrim=start=${mainCut.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,afade=t=in:d=${f}[b];[a][b]concat=n=2:v=0:a=1[o]`,
    "-map",
    "[o]",
    "-ac",
    "1",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    tmp,
  ]);
  await fs.rename(tmp, main);
}

export interface HookTakeResult {
  chosen: number;
  scores: HookScore[];
  measures: HookMeasure[];
  characters: number;
  words?: Word[];
  shift?: number;
}

/**
 * Voices `takes` more reads of the hook, scores them with the read inside the narration and splices the best
 * in. `voice(text, out)` makes one take (ElevenLabs with the narration's settings) and returns its words.
 * Returns the new word timings when a take was spliced, and always the scores and the characters spent.
 */
export async function bestHook(o: {
  audio: string;
  words: Word[];
  spoken: string;
  takes: number;
  speed: number;
  targetWpm: number;
  whisperPython?: string;
  voice: (
    text: string,
    out: string,
    n: number,
  ) => Promise<{ words: Word[]; durationSeconds: number }>;
  ledger?: string;
  meta?: Record<string, unknown>;
  /** Keep the take files beside the narration (the proof keeps them to listen to). */
  keep?: boolean;
}): Promise<HookTakeResult | undefined> {
  const hook = hookOf(o.spoken);
  if (!hook || o.takes <= 0) return undefined;
  const split = hookSplit(o.words, hook);
  if (!split) return undefined;
  const dir = path.dirname(o.audio);
  const base = path.join(dir, "hooktake");
  // The rest of the narration is the voice to match: from the first word after the hook to the end.
  const restFile = `${base}_rest.wav`;
  await cutAudio(o.audio, restFile, split.cut, 1e6);
  const norm = await measureTake(restFile);
  const files: string[] = [];
  const takeWords: Word[][] = [];
  const cuts: number[] = [];
  const mainHook = `${base}_0.wav`;
  await cutAudio(o.audio, mainHook, 0, split.cut);
  files.push(mainHook);
  takeWords.push(o.words);
  cuts.push(split.cut);
  let characters = 0;
  for (let n = 1; n <= o.takes; n++) {
    const raw = `${base}_${n}.mp3`;
    try {
      const t = await o.voice(hook, raw, n);
      characters += hook.length;
      const last = t.words[split.count - 1];
      if (!last || t.words.length < split.count) continue;
      const cut = Math.min(t.durationSeconds, last.end + split.tail);
      const wav = `${base}_${n}.wav`;
      await cutAudio(raw, wav, 0, cut);
      files.push(wav);
      takeWords.push(t.words);
      cuts.push(cut);
    } catch (err) {
      log("warn", "hook take failed", { take: n, error: errorMessage(err) });
    }
  }
  const measures: HookMeasure[] = [];
  for (let i = 0; i < files.length; i++) {
    const { measure: _m, ...m } = await measureHook(
      files[i]!,
      i === 0 ? "narration" : `take ${i}`,
      hook,
      o.speed,
      {
        whisperPython: o.whisperPython,
        norm,
      },
    );
    measures.push(m);
  }
  const scores = scoreHooks(measures, o.targetWpm);
  const chosen = chooseHook(scores);
  const result: HookTakeResult = { chosen, scores, measures, characters };
  if (chosen > 0) {
    const takeFile = files[chosen]!.replace(/\.wav$/, ".mp3");
    await spliceAudio(o.audio, takeFile, split.cut, cuts[chosen]!);
    result.words = spliceWords(
      o.words,
      takeWords[chosen]!,
      split.count,
      split.cut,
      cuts[chosen]!,
    );
    result.shift = cuts[chosen]! - split.cut;
  }
  if (o.ledger)
    await fs
      .appendFile(
        o.ledger,
        JSON.stringify({
          at: new Date().toISOString(),
          ...o.meta,
          hook,
          takes: o.takes,
          characters,
          chosen: chosen === 0 ? "narration" : `take ${chosen}`,
          scores: scores.map((s) => ({
            ...s,
            total: Math.round(s.total * 1000) / 1000,
          })),
          measures,
        }) + "\n",
      )
      .catch(() => undefined);
  const raws = Array.from(
    { length: o.takes },
    (_, i) => `${base}_${i + 1}.mp3`,
  );
  if (!o.keep)
    for (const f of [restFile, ...files, ...raws])
      await fs.rm(f, { force: true }).catch(() => undefined);
  return result;
}
