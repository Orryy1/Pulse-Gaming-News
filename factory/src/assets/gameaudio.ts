// The game's own sound under the narration (GAME_AUDIO_BED, off by default; owner, 12 Nov 2026: "we want bits of
// game audio too, characters talking to or complementing the narration as much as possible"). Clips were silent
// (audio: false); with the bed on, a test half of videos (GAME_AUDIO_SHARE) hears the footage itself:
//   - which clips may be heard (clipSoundKind): the game's cutscenes and the owner's own capture, and gameplay whose
//     sound was already vetted as talk-free (audio: true). Trailers and publisher posts carry licensed music, so
//     they stay silent unless GAME_AUDIO_TRAILERS (then 8 dB lower and never swelling); stock and illustrations
//     have nothing to hear. On the Mac, Apple's sound classifier also hears each clip: mostly music is skipped,
//     some music is lowered and kept down in the gaps, dialogue sits a little lower under the voice;
//   - the clip's sound (clipSound): a cutscene's stretch is cut from the scene index's proxy when it is the same
//     upload, otherwise fetched audio-only with yt-dlp; a clip that already has sound gives its own;
//   - a Short's bed (buildShortBed): one file, mixed sample by sample from the render plan's own cuts, each piece
//     loudness-matched, ducked under the voice (GAME_AUDIO_UNDER_LUFS, about 14 dB under the -16 LUFS narration),
//     up in the gaps between sentences (GAME_AUDIO_GAP_LUFS, from the word timings), silent under a character
//     quote (whose own clip plays alone) and faded over 2 frames at every cut so no cut clicks. The composition
//     plays it as it is and dips the music where it sounds (GAME_AUDIO_MUSIC_DIP);
//   - a long video (longSoundClips): each heard cutscene clip gets its sound muxed in, loudness-matched to the long
//     render's own game-sound levels (soundfx.ts GAME_UNDER and GAME_POCKET), so its envelope does the rest.
// Nothing here can fail a video: any clip that cannot be heard stays silent, and any failure leaves the old mix.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FFMPEG } from "../lib/bin.ts";
import { runCapped } from "../lib/child.ts";
import { errorMessage, log } from "../lib/util.ts";
import { loudness } from "../qa/media.ts";
import { classifySound } from "../../mac/gameplay/soundtags.mjs";

export { musicDipAt } from "../render/gamebed.ts";

export type ClipSound = "cutscene" | "own" | "gameplay" | "trailer" | "none";

export interface SoundClip {
  file: string;
  provenance: string;
  durationSeconds: number;
  audio?: boolean;
  stock?: boolean;
  sourceUrl?: string;
  youtubeSource?: { videoId: string };
  span?: { source: string; from: number; to: number };
}

/** What a clip's sound is (pure), from its provenance and whether its file already has vetted sound. */
export function clipSoundKind(
  c: Pick<SoundClip, "provenance" | "audio" | "stock">,
): ClipSound {
  if (c.stock) return "none";
  const p = c.provenance ?? "";
  if (/^Cutscenes for "/.test(p)) return "cutscene";
  if (
    /^(Official (trailer|post|gameplay)\b|Official Steam trailer|Frame of official trailer)/i.test(
      p,
    ) ||
    /\btrailer\b/i.test(p)
  )
    return "trailer";
  if (/^Pulse's own gameplay capture/.test(p)) return c.audio ? "own" : "none";
  return c.audio ? "gameplay" : "none";
}

/** A cutscene clip's upload and where in it the clip starts (pure), from its span or its provenance. */
export function cutsceneSource(
  c: SoundClip,
): { videoId: string; from: number } | undefined {
  const p = c.provenance ?? "";
  const videoId =
    c.youtubeSource?.videoId ??
    p.match(/video ID: ([\w-]{11})/)?.[1] ??
    (c.span?.source ?? c.sourceUrl ?? "").match(/[?&]v=([\w-]{11})/)?.[1];
  const from = c.span?.from ?? Number(p.match(/source time: ([\d.]+)s/)?.[1]);
  return videoId && Number.isFinite(from) ? { videoId, from } : undefined;
}

/** A clip's sound as the mix uses it. */
export interface HeardClip {
  index: number;
  kind: ClipSound;
  /** The sound file, relative to the episode folder; time 0 is the clip's first frame. */
  file: string;
  lufs: number;
  /** Shares of Apple's windows heard as music and as speech (undefined off the Mac). */
  music?: number;
  speech?: number;
  /** Extra gain in dB on top of the loudness match (negative lowers it). */
  trimDb: number;
  /** False: kept at its under-the-voice level in the gaps too (trailers, music). */
  swell: boolean;
}

/** Music share at which a clip is not used, and at which it is lowered and kept down. */
export const MUSIC_SKIP = 0.75;
export const MUSIC_LOWER = 0.4;
/** Speech share at which a clip's dialogue sits lower under the narrator. */
export const SPEECH_LOWER = 0.35;
export const TRAILER_DB = -8;
export const MUSIC_DB = -8;
export const SPEECH_DB = -4;
/** The most a quiet clip is lifted to reach the bed's level, and the loudness under which it counts as silent. */
export const MAX_LIFT_DB = 12;
export const SILENT_LUFS = -55;

/** How a clip with these measurements is used (pure), or why it is skipped. */
export function soundPolicy(
  kind: ClipSound,
  m: { lufs: number; music?: number; speech?: number },
  o: { trailers: boolean },
): { trimDb: number; swell: boolean } | { skip: string } {
  if (kind === "none") return { skip: "nothing to hear" };
  if (kind === "trailer" && !o.trailers) return { skip: "trailer music" };
  if (!Number.isFinite(m.lufs) || m.lufs < SILENT_LUFS)
    return { skip: "silent" };
  if ((m.music ?? 0) >= MUSIC_SKIP)
    return { skip: `mostly music (${Math.round((m.music ?? 0) * 100)}%)` };
  let trimDb = 0;
  let swell = true;
  if (kind === "trailer") {
    trimDb += TRAILER_DB;
    swell = false;
  }
  if ((m.music ?? 0) >= MUSIC_LOWER) {
    trimDb += MUSIC_DB;
    swell = false;
  }
  if ((m.speech ?? 0) >= SPEECH_LOWER) trimDb += SPEECH_DB;
  return { trimDb, swell };
}

/** The share of Apple's sound windows with one of `labels` at or above `min` (pure). */
export function labelShare(
  windows: ReadonlyArray<{ top: Array<[string, number]> }>,
  labels: readonly string[],
  min = 0.5,
): number {
  if (!windows.length) return 0;
  return (
    windows.filter((w) =>
      w.top.some(([l, c]) => labels.includes(l) && c >= min),
    ).length / windows.length
  );
}

const sidecarOf = (file: string) =>
  file.replace(/\.[a-z0-9]+$/i, "") + ".sound.m4a";

const exists = (f: string) =>
  fs.access(f).then(
    () => true,
    () => false,
  );

/** The scene index proxy that is this upload, if there is one on disk. */
async function proxyFor(
  dataDir: string,
  videoId: string,
): Promise<string | undefined> {
  const root = path.join(dataDir, "sceneindex");
  for (const slug of await fs.readdir(root).catch(() => [] as string[])) {
    try {
      const idx = JSON.parse(
        await fs.readFile(path.join(root, slug, "index.json"), "utf8"),
      );
      if (idx?.source?.videoId !== videoId || !idx?.proxy?.file) continue;
      const file = path.join(root, slug, idx.proxy.file);
      if (await exists(file)) return file;
    } catch {
      // not an index
    }
  }
  return undefined;
}

const AAC = [
  "-vn",
  "-sn",
  "-dn",
  "-ac",
  "2",
  "-ar",
  "48000",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
];

/**
 * A clip's sound, made once and kept beside the clip (`clip_3.sound.m4a`), or undefined when there is none to have.
 * Its time 0 is the clip file's first frame.
 */
export async function clipSound(
  dir: string,
  c: SoundClip,
  kind: ClipSound,
  o: { dataDir: string; ytdlp: string },
): Promise<string | undefined> {
  const rel = sidecarOf(c.file);
  const out = path.join(dir, rel);
  if (await exists(out)) return rel;
  const seconds = Math.max(0.5, c.durationSeconds) + 0.3;
  if (kind === "own" || kind === "gameplay") {
    await runCapped(
      FFMPEG,
      ["-v", "error", "-y", "-i", path.join(dir, c.file), ...AAC, out],
      { timeout: 120_000 },
    );
    return rel;
  }
  if (kind !== "cutscene" && kind !== "trailer") return undefined;
  const src = cutsceneSource(c);
  if (!src) return undefined;
  const proxy = await proxyFor(o.dataDir, src.videoId);
  if (proxy) {
    try {
      await runCapped(
        FFMPEG,
        [
          "-v",
          "error",
          "-y",
          "-ss",
          src.from.toFixed(3),
          "-i",
          proxy,
          "-t",
          seconds.toFixed(3),
          "-map",
          "0:a:0",
          ...AAC,
          out,
        ],
        { timeout: 120_000 },
      );
      return rel;
    } catch {
      // a proxy without sound: fetched instead
    }
  }
  const tmp = `${out}.download`;
  try {
    await runCapped(
      o.ytdlp,
      [
        "--no-playlist",
        "--no-warnings",
        "-f",
        "ba[ext=m4a]/ba",
        "--download-sections",
        `*${src.from.toFixed(2)}-${(src.from + seconds).toFixed(2)}`,
        "-o",
        tmp,
        `https://www.youtube.com/watch?v=${src.videoId}`,
      ],
      { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
    );
    await runCapped(
      FFMPEG,
      ["-v", "error", "-y", "-i", tmp, "-t", seconds.toFixed(3), ...AAC, out],
      { timeout: 120_000 },
    );
    return rel;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Hears every clip that may be heard: its sound file, loudness and (on the Mac) music and speech. Never throws. */
export async function hearClips(
  dir: string,
  clips: readonly SoundClip[],
  o: {
    dataDir: string;
    ytdlp: string;
    trailers: boolean;
    only?: ReadonlySet<number>;
  },
): Promise<{
  heard: HeardClip[];
  skipped: Array<{ index: number; why: string }>;
}> {
  const heard: HeardClip[] = [];
  const skipped: Array<{ index: number; why: string }> = [];
  for (const [index, c] of clips.entries()) {
    if (o.only && !o.only.has(index)) continue;
    const kind = clipSoundKind(c);
    try {
      const pre = soundPolicy(kind, { lufs: -20 }, o);
      if ("skip" in pre) {
        skipped.push({ index, why: pre.skip });
        continue;
      }
      const file = await clipSound(dir, c, kind, o);
      if (!file) {
        skipped.push({ index, why: "no source for its sound" });
        continue;
      }
      const lufs = await loudness(path.join(dir, file));
      const windows = await classifySound(path.join(dir, file), {
        ffmpeg: FFMPEG,
      }).catch(() => undefined);
      const music = windows
        ? labelShare(windows, ["music", "singing", "song"])
        : undefined;
      const speech = windows
        ? labelShare(windows, ["speech", "whispering", "conversation"])
        : undefined;
      const p = soundPolicy(kind, { lufs, music, speech }, o);
      if ("skip" in p) {
        skipped.push({ index, why: p.skip });
        continue;
      }
      heard.push({ index, kind, file, lufs, music, speech, ...p });
    } catch (err) {
      skipped.push({ index, why: errorMessage(err).slice(0, 160) });
    }
  }
  return { heard, skipped };
}

// ---------------------------------------------------------------- the Short's bed

export const RATE = 48_000;
/** The envelope's control rate (a step every 10 ms). */
export const CONTROL_HZ = 100;
/** A word's sound reaches this far either side of its timing. */
export const WORD_LEAD = 0.08;
export const WORD_TAIL = 0.12;
/** A gap this long between words lets the game sound up; shorter ones stay under. */
export const GAP_MIN_SECONDS = 0.25;
/** Seconds the bed takes to rise in a gap, and to fall back before the next word (it is down as the word starts). */
export const RISE_SECONDS = 0.15;
export const FALL_SECONDS = 0.1;
/** Seconds of fade either side of a character quote, outside it: the quote's own sound plays alone. */
export const QUOTE_FADE_SECONDS = 0.08;

export interface BedPiece {
  clip: number;
  /** Seconds on the Short's timeline, seconds into the clip, and how long. */
  at: number;
  from: number;
  seconds: number;
}

type PlanShot = {
  start: number;
  end: number;
  media: { type: string; index: number; trimFrom?: number };
};

/**
 * The bed's pieces (pure): every clip shot of the plan, in seconds, with the stretch of its clip it shows; a shot
 * that simply carries on the shot before it (same clip, next frame) joins it, so only a real cut gets a fade.
 */
export function bedPieces(shots: readonly PlanShot[], fps: number): BedPiece[] {
  const out: BedPiece[] = [];
  for (const s of shots) {
    if (s.media.type !== "clip" || s.end <= s.start) continue;
    const at = s.start / fps;
    const from = (s.media.trimFrom ?? 0) / fps;
    const seconds = (s.end - s.start) / fps;
    const last = out.at(-1);
    if (
      last &&
      last.clip === s.media.index &&
      Math.abs(last.at + last.seconds - at) < 0.5 / fps &&
      Math.abs(last.from + last.seconds - from) < 0.5 / fps
    )
      last.seconds += seconds;
    else out.push({ clip: s.media.index, at, from, seconds });
  }
  return out;
}

/** Merged spans [from, to) in seconds (pure). */
function merge(spans: Array<[number, number]>): Array<[number, number]> {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of s) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * The bed's level relative to its gap level, in dB, at CONTROL_HZ (pure): `underDb` (negative) while the voice
 * speaks and in short pauses, 0 in a gap of GAP_MIN_SECONDS or more (rising over RISE_SECONDS, back down by the next
 * word over FALL_SECONDS), and silent (-Infinity) over every quote, faded just outside it.
 */
export function bedLevels(
  words: ReadonlyArray<{ start: number; end: number }>,
  quotes: ReadonlyArray<{ start: number; seconds: number }>,
  seconds: number,
  underDb: number,
): Float32Array {
  const n = Math.max(1, Math.ceil(seconds * CONTROL_HZ) + 1);
  const target = new Float32Array(n).fill(0);
  const speech = merge(
    words.map((w) => [w.start - WORD_LEAD, w.end + WORD_TAIL]),
  );
  // The pauses too short to carry stay under: speech is joined across them.
  const held: Array<[number, number]> = [];
  for (const sp of speech) {
    const last = held.at(-1);
    if (last && sp[0] - last[1] < GAP_MIN_SECONDS)
      last[1] = Math.max(last[1], sp[1]);
    else held.push([sp[0], sp[1]]);
  }
  for (const [a, b] of held)
    for (
      let i = Math.max(0, Math.floor(a * CONTROL_HZ));
      i < Math.min(n, Math.ceil(b * CONTROL_HZ));
      i++
    )
      target[i] = underDb;
  const out = new Float32Array(n);
  const up = -underDb / Math.max(1, RISE_SECONDS * CONTROL_HZ);
  const down = -underDb / Math.max(1, FALL_SECONDS * CONTROL_HZ);
  let level = target[0]!;
  for (let i = 0; i < n; i++) {
    level = target[i]! > level ? Math.min(target[i]!, level + up) : target[i]!;
    out[i] = level;
  }
  // Down before the word, not on it.
  for (let i = n - 2; i >= 0; i--)
    out[i] = Math.min(out[i]!, out[i + 1]! + down);
  // Quotes: silent through them, the fade done before each starts and begun after it ends.
  const fade = Math.max(1, Math.round(QUOTE_FADE_SECONDS * CONTROL_HZ));
  for (const q of quotes) {
    const a = Math.floor(q.start * CONTROL_HZ);
    const b = Math.ceil((q.start + q.seconds) * CONTROL_HZ);
    for (let i = Math.max(0, a - fade); i < Math.min(n, b + fade); i++) {
      const k = i < a ? (a - i) / fade : i >= b ? (i - b + 1) / fade : 0;
      out[i] = k <= 0 ? -Infinity : out[i]! + 20 * Math.log10(Math.min(1, k));
    }
  }
  return out;
}

const dbToGain = (db: number) =>
  Number.isFinite(db) ? Math.pow(10, db / 20) : 0;

/**
 * Mixes the pieces into one interleaved stereo buffer (pure): each piece's samples at its gain, under the envelope
 * (a piece that never swells is held at the under level), with a `fadeSeconds` ramp at both ends so no cut clicks.
 */
export function mixBed(
  pieces: readonly BedPiece[],
  sources: ReadonlyMap<
    number,
    { samples: Float32Array; gainDb: number; swell: boolean }
  >,
  levels: Float32Array,
  underDb: number,
  totalSeconds: number,
  fadeSeconds: number,
): Float32Array {
  const frames = Math.ceil(totalSeconds * RATE);
  const out = new Float32Array(frames * 2);
  const fadeN = Math.max(1, Math.round(fadeSeconds * RATE));
  for (const p of pieces) {
    const src = sources.get(p.clip);
    if (!src) continue;
    const start = Math.round(p.at * RATE);
    const from = Math.round(p.from * RATE);
    const len = Math.min(
      Math.round(p.seconds * RATE),
      frames - start,
      Math.floor(src.samples.length / 2) - from,
    );
    if (len <= 0) continue;
    for (let i = 0; i < len; i++) {
      const t = start + i;
      const c = (t / RATE) * CONTROL_HZ;
      const k = Math.min(levels.length - 1, Math.floor(c));
      const a = levels[k]!;
      const b = levels[Math.min(levels.length - 1, k + 1)]!;
      let env =
        Number.isFinite(a) && Number.isFinite(b)
          ? a + (b - a) * (c - k)
          : Math.min(a, b);
      if (!src.swell) env = Math.min(env, underDb);
      const edge = Math.min(1, i / fadeN, (len - 1 - i) / fadeN);
      const g = dbToGain(src.gainDb + env) * Math.max(0, edge);
      if (g === 0) continue;
      out[t * 2] = out[t * 2]! + src.samples[(from + i) * 2]! * g;
      out[t * 2 + 1] = out[t * 2 + 1]! + src.samples[(from + i) * 2 + 1]! * g;
    }
  }
  // A safety ceiling, about -1 dBFS: the bed sits far lower, but a gunshot's peak must never clip.
  for (let i = 0; i < out.length; i++)
    out[i] = Math.max(-0.89, Math.min(0.89, out[i]!));
  return out;
}

/** The stretches where the game is heard, in seconds (pure): the pieces that have a sound, merged. */
export function heardSpans(
  pieces: readonly BedPiece[],
  heard: ReadonlySet<number>,
): Array<{ from: number; to: number }> {
  return merge(
    pieces
      .filter((p) => heard.has(p.clip))
      .map((p) => [p.at, p.at + p.seconds]),
  ).map(([from, to]) => ({
    from: Math.round(from * 1000) / 1000,
    to: Math.round(to * 1000) / 1000,
  }));
}

async function decode(file: string, work: string): Promise<Float32Array> {
  const raw = path.join(work, `${path.basename(file)}.f32`);
  await runCapped(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      file,
      "-ac",
      "2",
      "-ar",
      String(RATE),
      "-f",
      "f32le",
      raw,
    ],
    { timeout: 120_000 },
  );
  const b = await fs.readFile(raw);
  await fs.rm(raw, { force: true });
  const copy = new Uint8Array(b.byteLength - (b.byteLength % 4));
  copy.set(b.subarray(0, copy.byteLength));
  return new Float32Array(copy.buffer);
}

export interface ShortBed {
  /** The bed's file, relative to the episode folder. */
  file: string;
  /** Where the game is heard, in seconds: the music dips there. */
  spans: Array<{ from: number; to: number }>;
  heard: Array<Omit<HeardClip, "file">>;
  skipped: Array<{ index: number; why: string }>;
  seconds: number;
}

/**
 * A Short's game-sound bed (`game_bed.wav`), mixed from the plan's own cuts, or undefined when no clip on screen can
 * be heard. Never throws.
 */
export async function buildShortBed(o: {
  dir: string;
  dataDir: string;
  ytdlp: string;
  clips: readonly SoundClip[];
  plan: { fps: number; totalFrames: number; shots: readonly PlanShot[] };
  words: ReadonlyArray<{ start: number; end: number }>;
  quotes: ReadonlyArray<{ start: number; seconds: number }>;
  underLufs: number;
  gapLufs: number;
  trailers: boolean;
}): Promise<ShortBed | undefined> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bed-"));
  try {
    const pieces = bedPieces(o.plan.shots, o.plan.fps);
    if (!pieces.length) return undefined;
    const used = new Set(pieces.map((p) => p.clip));
    const { heard, skipped } = await hearClips(o.dir, o.clips, {
      dataDir: o.dataDir,
      ytdlp: o.ytdlp,
      trailers: o.trailers,
      only: used,
    });
    if (!heard.length) {
      log("info", "game audio: no clip on screen can be heard", { skipped });
      return undefined;
    }
    const underDb = Math.min(0, o.underLufs - o.gapLufs);
    const sources = new Map<
      number,
      { samples: Float32Array; gainDb: number; swell: boolean }
    >();
    for (const h of heard)
      sources.set(h.index, {
        samples: await decode(path.join(o.dir, h.file), work),
        gainDb: Math.min(MAX_LIFT_DB, o.gapLufs - h.lufs) + h.trimDb,
        swell: h.swell,
      });
    const seconds = o.plan.totalFrames / o.plan.fps;
    const levels = bedLevels(o.words, o.quotes, seconds, underDb);
    const mixed = mixBed(
      pieces,
      sources,
      levels,
      underDb,
      seconds,
      2 / o.plan.fps,
    );
    const raw = path.join(work, "bed.f32");
    await fs.writeFile(
      raw,
      Buffer.from(mixed.buffer, mixed.byteOffset, mixed.byteLength),
    );
    const file = "game_bed.wav";
    await runCapped(
      FFMPEG,
      [
        "-v",
        "error",
        "-y",
        "-f",
        "f32le",
        "-ar",
        String(RATE),
        "-ac",
        "2",
        "-i",
        raw,
        "-c:a",
        "pcm_s16le",
        path.join(o.dir, file),
      ],
      { timeout: 120_000 },
    );
    const spans = heardSpans(pieces, new Set(heard.map((h) => h.index)));
    return {
      file,
      spans,
      heard: heard.map(({ file: _f, ...h }) => h),
      skipped,
      seconds:
        Math.round(spans.reduce((n, s) => n + s.to - s.from, 0) * 10) / 10,
    };
  } catch (err) {
    log("warn", "game audio bed skipped", { error: errorMessage(err) });
    return undefined;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- the long video

/**
 * A long video's clips with the heard cutscenes' sound muxed in (`clip_3.sound.mp4`, audio: true), loudness-matched
 * so the long render's game-sound level under the voice (`underGain`, soundfx.ts GAME_UNDER) lands at `underLufs`.
 * Clips that already have sound, or cannot be heard, come back as they were. Never throws.
 */
export async function longSoundClips<T extends SoundClip>(o: {
  dir: string;
  dataDir: string;
  ytdlp: string;
  clips: T[];
  underLufs: number;
  underGain: number;
  trailers: boolean;
}): Promise<{
  clips: T[];
  heard: number;
  skipped: Array<{ index: number; why: string }>;
}> {
  const target = o.underLufs - 20 * Math.log10(o.underGain);
  const only = new Set(
    o.clips.flatMap((c, i) =>
      !c.audio && clipSoundKind(c) !== "none" ? [i] : [],
    ),
  );
  try {
    const { heard, skipped } = await hearClips(o.dir, o.clips, {
      dataDir: o.dataDir,
      ytdlp: o.ytdlp,
      trailers: o.trailers,
      only,
    });
    const out = [...o.clips];
    for (const h of heard) {
      const c = o.clips[h.index]!;
      const file = c.file.replace(/\.[a-z0-9]+$/i, "") + ".sound.mp4";
      const gain = Math.min(MAX_LIFT_DB, target - h.lufs) + h.trimDb;
      try {
        if (!(await exists(path.join(o.dir, file))))
          await runCapped(
            FFMPEG,
            [
              "-v",
              "error",
              "-y",
              "-i",
              path.join(o.dir, c.file),
              "-i",
              path.join(o.dir, h.file),
              "-map",
              "0:v:0",
              "-map",
              "1:a:0",
              "-c:v",
              "copy",
              "-af",
              `volume=${gain.toFixed(2)}dB,alimiter=limit=0.89:level=0`,
              "-c:a",
              "aac",
              "-b:a",
              "192k",
              "-ar",
              "48000",
              "-shortest",
              "-movflags",
              "+faststart",
              path.join(o.dir, file),
            ],
            { timeout: 180_000 },
          );
        out[h.index] = { ...c, file, audio: true };
      } catch (err) {
        skipped.push({ index: h.index, why: errorMessage(err).slice(0, 160) });
      }
    }
    return {
      clips: out,
      heard: out.filter((c, i) => c !== o.clips[i]).length,
      skipped,
    };
  } catch (err) {
    log("warn", "game audio for the long video skipped", {
      error: errorMessage(err),
    });
    return { clips: o.clips, heard: 0, skipped: [] };
  }
}
