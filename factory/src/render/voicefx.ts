// The narration's texture slices (31 Oct 2026, creator study #22): Remotion's audio cannot filter, so the few
// lines that get a texture are cut from the narration and processed here with ffmpeg before the render, and
// the composition crossfades to them (src/render/soundfx.ts voiceFxPlan decides which, dryLevel and the
// REVERB_WET levels how). A message quote is heard through a telephone band (300 Hz to 3.4 kHz, a touch of
// soft saturation) at the dry line's own loudness, so it is no quieter than the narration around it; a reveal
// line gets a reverb tail, wet only (the dry voice keeps playing), from a fixed seeded impulse response.
// CPU only, a second or two a slice; a slice that fails is left out and the line plays dry as before.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { loudness } from "../qa/media.ts";
import { momentKeys, momentWindows, type MomentKeySource } from "./longplan.ts";
import { beatCuesFrom } from "./musicplan.ts";
import {
  chapterButtons,
  jlCuts,
  riserPeaks,
  voiceFxPlan,
  type SoundCraft,
  type VoiceFxSpan,
} from "./soundfx.ts";
import type { Segment } from "./timeline.ts";

const run = promisify(execFile);

/** The reverb tail the wet slice runs past the sentence's end (seconds). */
export const REVERB_TAIL_SECONDS = 1.6;
/** The telephone band's filter chain: two poles each side, then a soft clip driven 6 dB for the line's grit. */
export const PHONE_FILTER =
  "highpass=f=300,highpass=f=300,lowpass=f=3400,lowpass=f=3400,volume=6dB,asoftclip=type=tanh,volume=-6dB";
/** The impulse response: 1.4 s of seeded pink noise, rolled off both ends, decaying exponentially (a soft room). */
const IR_SOURCE =
  "anoisesrc=d=1.4:c=pink:r=48000:a=0.5:seed=7,highpass=f=200,lowpass=f=3500,afade=t=out:st=0:d=1.4:curve=exp";

export interface VoiceFxFile extends VoiceFxSpan {
  /** The slice, relative to the episode folder. */
  file: string;
}

async function ffmpeg(args: string[]): Promise<void> {
  await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Plain gain (dB) to bring `file` to `target` LUFS; 0 when either cannot be measured. */
async function matchGain(file: string, target: number): Promise<number> {
  const got = await loudness(file);
  if (!Number.isFinite(got) || !Number.isFinite(target)) return 0;
  return Math.max(-12, Math.min(12, target - got));
}

/**
 * Each span's slice, made into `<episodeDir>/voicefx/` (any older slices there are replaced). Returns the
 * slices that were made, in span order; a failure leaves that span out and never throws.
 */
export async function makeVoiceFx(
  episodeDir: string,
  voiceFile: string,
  spans: readonly VoiceFxSpan[],
): Promise<{ made: VoiceFxFile[]; failed: number }> {
  const made: VoiceFxFile[] = [];
  let failed = 0;
  if (!spans.length) return { made, failed };
  const dir = path.join(episodeDir, "voicefx");
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const voice = path.isAbsolute(voiceFile)
    ? voiceFile
    : path.join(episodeDir, voiceFile);
  const ir = path.join(dir, "ir.wav");
  try {
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      IR_SOURCE,
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      ir,
    ]);
  } catch {
    return { made, failed: spans.length };
  }
  for (const [i, s] of spans.entries()) {
    const rel = path.join("voicefx", `${s.kind}_${i}.wav`);
    const out = path.join(episodeDir, rel);
    const dry = path.join(dir, `dry_${i}.wav`);
    const raw = path.join(dir, `raw_${i}.wav`);
    try {
      const len = Math.max(0.1, s.to - s.from);
      // The dry cut, decoded from the same file the render plays, sample-accurate (-ss after -i).
      await ffmpeg([
        "-i",
        voice,
        "-ss",
        s.from.toFixed(4),
        "-t",
        len.toFixed(4),
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        dry,
      ]);
      const target = await loudness(dry);
      if (s.kind === "phone") {
        await ffmpeg([
          "-i",
          dry,
          "-af",
          PHONE_FILTER,
          "-ac",
          "1",
          "-ar",
          "48000",
          "-c:a",
          "pcm_s16le",
          raw,
        ]);
      } else {
        await ffmpeg([
          "-i",
          dry,
          "-i",
          ir,
          "-filter_complex",
          `[0:a]apad=pad_dur=${REVERB_TAIL_SECONDS}[d];[d][1:a]afir=gtype=none[w]`,
          "-map",
          "[w]",
          "-ac",
          "1",
          "-ar",
          "48000",
          "-c:a",
          "pcm_s16le",
          raw,
        ]);
      }
      // Both at the dry line's loudness: the phone line as loud as the voice around it, the reverb at full
      // scale so the composition's REVERB_WET share alone sets how much is heard.
      const gain = await matchGain(raw, target);
      await ffmpeg([
        "-i",
        raw,
        "-af",
        `volume=${gain.toFixed(2)}dB,alimiter=limit=0.95:level=false`,
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        out,
      ]);
      made.push({ ...s, file: rel });
    } catch {
      failed++;
    } finally {
      await fs.rm(dry, { force: true }).catch(() => undefined);
      await fs.rm(raw, { force: true }).catch(() => undefined);
    }
  }
  await fs.rm(ir, { force: true }).catch(() => undefined);
  return { made, failed };
}

/** A shot-list moment as the planner reads it: what it shows, its graphic and the writer's beat. */
type CraftMoment = MomentKeySource & { keywords?: string[]; beat?: string };

export interface SoundCraftPrep {
  voiceFxFiles: VoiceFxFile[];
  counts: {
    jl: number;
    risers: number;
    buttons: number;
    phone: number;
    reverb: number;
  };
  /** Slices that could not be made (their lines play dry). */
  failed: number;
}

/**
 * Everything the documentary's sound craft needs before its render, from the same inputs the composition
 * gets: the texture slices made (SOUND_VOICE_FX), and how many J/L cuts, risers and chapter buttons the
 * composition will place, for the episode's log and the owner's one Discord line. The composition makes
 * the same decisions from the same pure functions (src/render/soundfx.ts).
 */
export async function prepareSoundCraft(o: {
  episodeDir: string;
  voiceFile: string | undefined;
  craft: SoundCraft;
  segments: Segment[];
  words: Array<{ text?: string; start: number; end: number }>;
  moments: CraftMoment[][];
  breaks: Array<{ start: number; end: number }> | undefined;
  shots: ReadonlyArray<{
    start: number;
    end: number;
    media: { type: string; index: number };
  }>;
  clips: ReadonlyArray<{ durationSeconds: number; audio?: boolean }>;
  fps: number;
}): Promise<SoundCraftPrep> {
  const windows = momentWindows(
    o.segments,
    o.words,
    o.moments.map((m) => m.length),
    o.moments.map((e) => e.map(momentKeys)),
  );
  const cues = beatCuesFrom(
    windows,
    o.moments,
    o.fps,
    (o.breaks ?? []).map((b) => ({
      from: Math.round(b.start * o.fps),
      to: Math.round(b.end * o.fps),
    })),
  );
  const entryFrames = o.segments
    .map((s, i) =>
      s.kind === "beat" &&
      (s.visual?.kind === "rank" || s.visual?.kind === "chapter") &&
      i > 0
        ? Math.round(s.start * o.fps)
        : -1,
    )
    .filter((f) => f >= 0);
  const spans = o.craft.voiceFx
    ? voiceFxPlan(windows, o.moments, o.words, cues, o.fps)
    : [];
  const { made, failed } =
    spans.length && o.voiceFile
      ? await makeVoiceFx(o.episodeDir, o.voiceFile, spans)
      : { made: [] as VoiceFxFile[], failed: 0 };
  const buttons = o.craft.buttons
    ? chapterButtons(
        entryFrames,
        o.words.map((w) => w.end * o.fps),
        o.fps,
      ).filter((b, n) => b !== entryFrames[n]).length
    : 0;
  return {
    voiceFxFiles: made,
    failed,
    counts: {
      jl: o.craft.jl ? jlCuts(o.shots, o.clips, o.fps, entryFrames).size : 0,
      risers: o.craft.risers ? riserPeaks(cues).length : 0,
      buttons,
      phone: made.filter((m) => m.kind === "phone").length,
      reverb: made.filter((m) => m.kind === "reverb").length,
    },
  };
}
