// The sound cues of a funny moment, read off a recording's one mixed track (the owner's microphone and the game are
// mixed together by the Xbox's own Twitch broadcast). Two bands are measured ten times a second:
//   voice   300-3,400 Hz, where a human voice lives: the owner's laugh comes in short rhythmic bursts ("ha-ha-ha",
//           about 3 to 7 a second), a shout is a sustained jump well over the last minute's usual level;
//   low     under 120 Hz, where impacts live: a crash, an explosion or a hard landing is a sudden onset there.
// Each cue is scored about 1 when clear on its own, like the near-live detector's signals (src/liveclips/detect.ts).
// The measuring is one cheap audio-only decode per band; everything after it is pure and tested.
//
// Honest limits: game characters speak in the same band as the owner, so a cue is a pointer, never proof. The
// vision check and the HUD reader confirm, and the lane's Whisper pass still checks language.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** How far over the last minute's usual voice level a shout holds (game sound shares the band: 8 dB is rare). */
export const SHOUT_DB = 8;

/** Frames a second in the band envelopes. */
export const ENV_HZ = 10;

export interface BandEnvelopes {
  /** RMS dB per 100 ms in the voice band (-90 for silence). */
  voice: number[];
  /** RMS dB per 100 ms under 120 Hz. */
  low: number[];
  /** Spectral flatness 0-1 per 100 ms over the whole band (low and steady across seconds: music). */
  flat: number[];
}

export type CueKind = "laugh" | "shout" | "impact" | "music";

export interface SoundCue {
  kind: CueKind;
  /** Seconds into the recording. */
  t: number;
  score: number;
  detail: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return -90;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The RMS levels ffmpeg's astats prints, in frame order (pure). */
export function parseRms(stderr: string): number[] {
  const out: number[] = [];
  for (const m of stderr.matchAll(
    /lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf|inf|nan)/g,
  )) {
    const v = Number(m[1]);
    out.push(Number.isFinite(v) ? Math.max(-90, v) : -90);
  }
  return out;
}

/** The flatness values ffmpeg's aspectralstats prints for channel 1, in frame order (pure). */
export function parseFlatness(stderr: string): number[] {
  const out: number[] = [];
  for (const m of stderr.matchAll(
    /lavfi\.aspectralstats\.1\.flatness=(-?[\d.e+-]+|nan)/g,
  )) {
    const v = Number(m[1]);
    out.push(Number.isFinite(v) ? v : 1);
  }
  return out;
}

/** The two band envelopes and the flatness, for the whole recording or a stretch of it. */
export async function measureBands(
  ffmpeg: string,
  file: string,
  o: { start?: number; duration?: number } = {},
): Promise<BandEnvelopes> {
  const seek = [
    ...(o.start ? ["-ss", String(o.start)] : []),
    ...(o.duration ? ["-t", String(o.duration)] : []),
  ];
  const n = Math.round(16000 / ENV_HZ);
  const band = (filter: string, key: string) =>
    run(
      ffmpeg,
      [
        "-hide_banner",
        "-nostats",
        ...seek,
        "-i",
        file,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-af",
        // The resample comes first: "-ar" alone applies after the filters, which would then run at the source's
        // 48 kHz and make each "100 ms" frame 33 ms long.
        `aresample=16000,${filter}asetnsamples=${n},${key}`,
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 1 << 28 },
    ).then(
      (r) => r.stderr,
      (e: { stderr?: string }) => e.stderr ?? "",
    );
  const rms =
    "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level";
  const [v, l, f] = await Promise.all([
    band("highpass=f=300,lowpass=f=3400,", rms),
    band("lowpass=f=120,", rms),
    band(
      "",
      "aspectralstats=win_size=1600:overlap=0:measure=flatness,ametadata=print:key=lavfi.aspectralstats.1.flatness",
    ),
  ]);
  return { voice: parseRms(v), low: parseRms(l), flat: parseFlatness(f) };
}

/**
 * Laugh bursts in a stretch of the voice envelope (pure): local peaks at least `rise` dB over the dips either side,
 * 1.5 to 3.5 frames apart (about 3 to 7 a second), all well over the usual level.
 */
export function burstCount(
  voice: number[],
  from: number,
  to: number,
  base: number,
  rise = 4,
): number {
  let n = 0;
  let last = -10;
  for (let i = Math.max(1, from); i < Math.min(voice.length - 1, to); i++) {
    const v = voice[i]!;
    if (v < base + 6) continue;
    if (v < voice[i - 1]! || v < voice[i + 1]!) continue;
    const dipL = Math.min(...voice.slice(Math.max(0, i - 3), i));
    const dipR = Math.min(...voice.slice(i + 1, i + 4));
    if (v - dipL < rise || v - dipR < rise) continue;
    if (i - last < 1.5) continue;
    if (n > 0 && i - last > 6) n = 0; // a gap of over 0.6 s breaks the run
    n++;
    last = i;
  }
  return n;
}

/**
 * The cues in a recording's envelopes (pure). `offset` is the seconds of the envelopes' first frame in the recording.
 * Each kind fires at most once in any 4 seconds (its strongest), so one long laugh is one cue.
 */
export function soundCues(env: BandEnvelopes, offset = 0): SoundCue[] {
  const { voice, low, flat } = env;
  const raw: SoundCue[] = [];
  const BASE = 60 * ENV_HZ; // the last minute is the usual level
  for (let i = 10; i < voice.length; i += 5) {
    const t = round2(offset + i / ENV_HZ);
    // The usual level counts only sound (a silent start would make everything look loud), and needs 10 s of it.
    const heard = voice.slice(Math.max(0, i - BASE), i).filter((v) => v > -60);
    if (heard.length < 10 * ENV_HZ || voice[i]! <= -60) continue;
    const base = median(heard);
    // Laughter: a run of bursts in the next 2 s, well over the usual voice level.
    const bursts = burstCount(voice, i, i + 2 * ENV_HZ, base);
    if (bursts >= 4) {
      const lift = Math.max(...voice.slice(i, i + 20)) - base;
      raw.push({
        kind: "laugh",
        t,
        score: round2(
          Math.min(2, 0.5 + bursts * 0.15 + Math.max(0, lift - 6) * 0.04),
        ),
        detail: `${bursts} voice bursts in 2 s, ${Math.round(lift)} dB over the usual`,
      });
    }
    // A shout: the voice band held at least SHOUT_DB over the usual for 0.6 s or more.
    const held = voice.slice(i, i + 10).filter((v) => v >= base + SHOUT_DB).length;
    if (held >= 6) {
      const lift = median(voice.slice(i, i + 10)) - base;
      raw.push({
        kind: "shout",
        t,
        score: round2(
          Math.min(1.6, 0.6 + (lift - SHOUT_DB) * 0.05 + (held - 6) * 0.08),
        ),
        detail: `voice ${Math.round(lift)} dB over the usual for ${(held / ENV_HZ).toFixed(1)} s`,
      });
    }
  }
  // Impacts: a sudden onset under 120 Hz, checked every frame (they are short).
  for (let i = 6; i < low.length; i++) {
    const before = Math.max(...low.slice(i - 6, i - 1));
    const jump = low[i]! - before;
    // From sound, not from silence: a menu or a load ending is not a crash.
    if (low[i]! > -38 && before > -55 && jump >= 12)
      raw.push({
        kind: "impact",
        t: round2(offset + i / ENV_HZ),
        score: round2(Math.min(1.5, 0.5 + (jump - 12) * 0.05)),
        detail: `a ${Math.round(jump)} dB thump under 120 Hz`,
      });
  }
  // Music: ten seconds of low, steady flatness with sound throughout (a song, the car radio).
  const W = 10 * ENV_HZ;
  for (let i = 0; i + W <= flat.length; i += W / 2) {
    const f = flat.slice(i, i + W);
    const v = voice.slice(i, i + W);
    const tonal = f.filter((x) => x < 0.12).length / f.length;
    const voiced = v.filter((x) => x > -45).length / Math.max(1, v.length);
    const mean = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    const sd = Math.sqrt(
      v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length),
    );
    if (tonal >= 0.75 && voiced >= 0.9 && sd < 5)
      raw.push({
        kind: "music",
        t: round2(offset + i / ENV_HZ),
        score: round2(tonal),
        detail: `10 s of steady tonal sound (${Math.round(tonal * 100)}% tonal, level spread ${sd.toFixed(1)} dB)`,
      });
  }
  // One per kind per 4 s: the strongest.
  const out: SoundCue[] = [];
  for (const c of raw.sort((a, b) => b.score - a.score)) {
    if (out.some((o) => o.kind === c.kind && Math.abs(o.t - c.t) < 4)) continue;
    out.push(c);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Whether a stretch of the recording is likely to carry licensed music (pure). */
export function musicIn(
  cues: readonly SoundCue[],
  from: number,
  to: number,
): boolean {
  return cues.some((c) => c.kind === "music" && c.t < to && c.t + 10 > from);
}
