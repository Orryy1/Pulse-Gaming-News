// Does every take of a long narration sound like the same person on the same day? (30 Oct 2026, owner: the
// voice "changes noticeably between sentences/paragraphs".) The Halo ranking's 21 takes all sat at -14 LUFS,
// yet their median pitch ran 116-128 Hz and their brightness (spectral centroid, energy above 3 kHz) swung
// by 5-19%: each ElevenLabs request samples the voice afresh. This module measures each take's character in
// three numbers and picks the takes that stray from the rest, so the long narrator can re-voice them once.
//
// The analysis is plain TypeScript over 16 kHz mono PCM (decoded with ffmpeg, as breaths.ts does):
// autocorrelation pitch on voiced 40 ms frames, and a 512-point FFT for the centroid and the high-band share.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";

const run = promisify(execFile);

export const RATE = 16_000;
const FRAME = 640; // 40 ms: two periods of the lowest pitch searched
const FFT_SIZE = 512;
const MIN_HZ = 60;
const MAX_HZ = 400;
const HIGH_HZ = 3000;
const MAX_FRAMES = 2500; // analysis budget per take; frames are spread evenly across it
const SPEECH_DB = 30; // frames this far under the loud frames are pauses or breaths, not speech
const VOICED_R = 0.5; // normalised autocorrelation a frame needs to count as voiced
/** A take this far from the narration's median pitch, or centroid, is re-voiced (VOICE_TAKE_CHECK). */
export const PITCH_LIMIT = 0.05;
export const CENTROID_LIMIT = 0.1;
/** Never more than this many re-voiced takes in one narration. */
export const MAX_REVOICES = 3;

export interface TakeMeasure {
  /** Median voiced pitch, Hz (0 when the take had no voiced frames). */
  pitchHz: number;
  /** Median spectral centroid of the speech frames, Hz. */
  centroidHz: number;
  /** Share of the speech frames' energy above 3 kHz, 0-1. */
  highShare: number;
  voicedFrames: number;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** In-place radix-2 FFT (re, im of length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/**
 * The frame's pitch in Hz, or 0 when it is not voiced. The smallest lag whose normalised autocorrelation is
 * a local peak within 10% of the best is the period: the best alone is often a multiple of it.
 */
function framePitch(x: Float64Array, rate: number): number {
  const minLag = Math.floor(rate / MAX_HZ);
  const maxLag = Math.min(x.length - 2, Math.ceil(rate / MIN_HZ));
  const r = new Float64Array(maxLag + 2);
  let best = 0;
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = 0; i + lag < x.length; i++) {
      const a = x[i]!;
      const b = x[i + lag]!;
      xy += a * b;
      xx += a * a;
      yy += b * b;
    }
    r[lag] = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
    if (lag <= maxLag && r[lag]! > best) best = r[lag]!;
  }
  if (best < VOICED_R) return 0;
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    const v = r[lag]!;
    if (v >= best * 0.9 && v >= r[lag - 1]! && v >= r[lag + 1]!) {
      // Parabolic interpolation for a sub-sample period.
      const a = r[lag - 1]!;
      const c = r[lag + 1]!;
      const den = a - 2 * v + c;
      const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
      return rate / (lag + Math.max(-0.5, Math.min(0.5, shift)));
    }
  }
  return 0;
}

/** A take's character from its mono samples (Int16 or floats in -1..1). */
export function analyseVoice(
  samples: Int16Array | Float32Array,
  rate = RATE,
): TakeMeasure {
  const scale = samples instanceof Int16Array ? 1 / 32768 : 1;
  const frames = Math.floor(samples.length / FRAME);
  if (!frames)
    return { pitchHz: 0, centroidHz: 0, highShare: 0, voicedFrames: 0 };
  // Frame loudness first: only speech frames are measured.
  const db = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) {
      const v = samples[i]! * scale;
      sum += v * v;
    }
    db[f] = 10 * Math.log10(sum / FRAME + 1e-12);
  }
  const sorted = [...db].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.9)]!;
  const speech: number[] = [];
  for (let f = 0; f < frames; f++)
    if (db[f]! > loud - SPEECH_DB) speech.push(f);
  const step = Math.max(1, speech.length / MAX_FRAMES);
  const pitches: number[] = [];
  const centroids: number[] = [];
  let high = 0;
  let total = 0;
  const x = new Float64Array(FRAME);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const binHz = rate / FFT_SIZE;
  for (let k = 0; k < speech.length; k += step) {
    const f = speech[Math.floor(k)]!;
    const at = f * FRAME;
    let mean = 0;
    for (let i = 0; i < FRAME; i++) mean += samples[at + i]! * scale;
    mean /= FRAME;
    for (let i = 0; i < FRAME; i++) x[i] = samples[at + i]! * scale - mean;
    const p = framePitch(x, rate);
    if (p > 0) pitches.push(p);
    // Spectrum of the frame's middle 512 samples, Hann windowed.
    const off = (FRAME - FFT_SIZE) >> 1;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] =
        x[off + i]! *
        (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
      im[i] = 0;
    }
    fft(re, im);
    // The centroid weights each bin by its magnitude (the usual definition, as librosa); the high-band
    // share is of energy (power).
    let num = 0;
    let den = 0;
    for (let b = 1; b < FFT_SIZE / 2; b++) {
      const hz = b * binHz;
      if (hz < 80) continue;
      const pw = re[b]! * re[b]! + im[b]! * im[b]!;
      const mag = Math.sqrt(pw);
      num += hz * mag;
      den += mag;
      total += pw;
      if (hz >= HIGH_HZ) high += pw;
    }
    if (den > 0) centroids.push(num / den);
  }
  return {
    pitchHz: median(pitches),
    centroidHz: median(centroids),
    highShare: total > 0 ? high / total : 0,
    voicedFrames: pitches.length,
  };
}

/** Decodes a take to 16 kHz mono and measures it. */
export async function measureTake(file: string): Promise<TakeMeasure> {
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
  const buf = stdout as unknown as Buffer;
  return analyseVoice(
    new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2)),
  );
}

export interface Norm {
  pitchHz: number;
  centroidHz: number;
  highShare: number;
}

/** The narration's own voice: the median of each measure across its takes (takes without a voice ignored). */
export function normOf(takes: TakeMeasure[]): Norm {
  const ok = takes.filter((t) => t.voicedFrames > 0);
  return {
    pitchHz: median(ok.map((t) => t.pitchHz)),
    centroidHz: median(ok.map((t) => t.centroidHz)),
    highShare: median(ok.map((t) => t.highShare)),
  };
}

/** How far a take strays: 1 is exactly at a limit, under 1 is fine. Pitch and centroid as fractions of the norm. */
export function deviation(
  t: TakeMeasure,
  norm: Norm,
): { pitch: number; centroid: number; score: number } {
  const pitch =
    norm.pitchHz > 0 && t.pitchHz > 0 ? t.pitchHz / norm.pitchHz - 1 : 0;
  const centroid =
    norm.centroidHz > 0 && t.centroidHz > 0
      ? t.centroidHz / norm.centroidHz - 1
      : 0;
  return {
    pitch,
    centroid,
    score: Math.max(
      Math.abs(pitch) / PITCH_LIMIT,
      Math.abs(centroid) / CENTROID_LIMIT,
    ),
  };
}

/**
 * The takes to re-voice, worst first: more than 5% off the median pitch or 10% off the median centroid, at
 * most `max`. Fewer than three measured takes have no meaningful median, so nothing is picked.
 */
export function outliers(takes: TakeMeasure[], max = MAX_REVOICES): number[] {
  if (takes.filter((t) => t.voicedFrames > 0).length < 3) return [];
  const norm = normOf(takes);
  return takes
    .map((t, i) => ({
      i,
      score: t.voicedFrames > 0 ? deviation(t, norm).score : 0,
    }))
    .filter((x) => x.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, max))
    .map((x) => x.i);
}

/** Of a take and its re-voice, the one closer to the norm. */
export function closer(
  original: TakeMeasure,
  revoice: TakeMeasure,
  norm: Norm,
): "original" | "revoice" {
  if (revoice.voicedFrames === 0) return "original";
  return deviation(revoice, norm).score < deviation(original, norm).score
    ? "revoice"
    : "original";
}

/** Spread across takes, max minus min as a percentage of the median, for each measure. */
export function spread(takes: TakeMeasure[]): {
  pitchPct: number;
  centroidPct: number;
  highPct: number;
} {
  const ok = takes.filter((t) => t.voicedFrames > 0);
  const pct = (xs: number[]) => {
    const m = median(xs);
    return m > 0
      ? Math.round(((Math.max(...xs) - Math.min(...xs)) / m) * 1000) / 10
      : 0;
  };
  if (!ok.length) return { pitchPct: 0, centroidPct: 0, highPct: 0 };
  return {
    pitchPct: pct(ok.map((t) => t.pitchHz)),
    centroidPct: pct(ok.map((t) => t.centroidHz)),
    highPct: pct(ok.map((t) => t.highShare)),
  };
}
