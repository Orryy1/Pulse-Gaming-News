// Radio stripping (RADIO_STRIP, off by default). A gameplay clip with licensed car-radio music used to be thrown
// away (library.ts inboxFiles, the gameplay lane's radio flag), and GTA driving clips nearly always have the radio
// on. With this on, the clip's sound is split into dialogue, effects and music (src/assets/avtools/radiostrip.py:
// the CDX23 cinematic demixer, a Mel-Band RoFormer lyric pass, all MIT), the music is dropped and the engine,
// sirens, ambience and voices are kept. Then the residue check listens to what is left (AudioSet per second plus a
// fingerprint against the removed music) and a clip with music left is rejected, never used.
// The stripped copy sits beside the clip as <id>.radiofree.mp4 and every clip cut from it carries radioStripped,
// so the upload goes private first and waits for a clean copyright check (src/youtube/copyrightgate.ts).
// Removing the music is not a licence: the clip's rights are unchanged, this only keeps the song out of it.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FFMPEG } from "../lib/bin.ts";
import { loadOrch } from "../lib/orch.ts";
import { errorMessage, log } from "../lib/util.ts";
import type { AvToolsSettings } from "./avtools/settings.ts";

const run = promisify(execFile);
export const AVTOOLS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "avtools",
);
const SCRIPT = path.join(AVTOOLS_DIR, "radiostrip.py");

/** What the residue check measured on one sound (radiostrip.py summarise). */
export interface SoundSummary {
  seconds: number;
  /** Share of loud seconds the AudioSet model hears as music at 0.5 or more. */
  musicShare: number;
  musicMean: number;
  musicP95: number;
  speechShare: number;
  vehicleShare: number;
}

export interface FingerprintMatch {
  blocks: number;
  /** Share of ~3 s blocks whose bit error rate against the removed music is under 0.35 (a match). */
  matchShare: number;
  minBer: number;
  meanBer: number;
}

/** One clip's result from radiostrip.py separate. */
export interface StripJobResult {
  src: string;
  ok: boolean;
  error?: string;
  kept?: string;
  music?: string;
  seconds?: number;
  before?: SoundSummary;
  after?: SoundSummary;
  fingerprint?: { kept: FingerprintMatch; original: FingerprintMatch };
  sungSeconds?: number[];
  verdict?: "clean" | "music_remains";
  rtf?: number;
}

export interface StripLimits {
  maxResidue: number;
  maxFingerprint: number;
}

/**
 * Whether a stripped clip may be used (pure), decided here from the measurements rather than taken from the
 * script's own verdict, so the thresholds are the factory's settings. Every reason it may not is listed.
 */
export function stripVerdict(
  r: Pick<StripJobResult, "ok" | "after" | "fingerprint" | "error">,
  limits: StripLimits,
): { clean: boolean; reasons: string[] } {
  if (!r.ok || !r.after)
    return {
      clean: false,
      reasons: [`stripping failed: ${r.error ?? "no result"}`],
    };
  const reasons: string[] = [];
  if (r.after.musicShare > limits.maxResidue)
    reasons.push(
      `music still heard in ${pct(r.after.musicShare)} of the clip (allowed ${pct(limits.maxResidue)})`,
    );
  const fp = r.fingerprint?.kept;
  if (!fp) reasons.push("no fingerprint comparison");
  else if (fp.matchShare > limits.maxFingerprint)
    reasons.push(
      `the removed song's fingerprint still matches ${pct(fp.matchShare)} of the clip (allowed ${pct(limits.maxFingerprint)})`,
    );
  return { clean: reasons.length === 0, reasons };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The stripped copy's file name beside the clip: unique per clip, so clips cut from it can be told apart. */
export const radioFreeName = (id: string) =>
  `${id.replace(/[^\w-]+/g, "_")}.radiofree.mp4`;

/** Whether a file name, URL or provenance names a radio-stripped recording (pure). */
export function isRadioFree(text: string | undefined): boolean {
  return RADIO_FREE.test(text ?? "");
}
const RADIO_FREE = /\.radiofree\.mp4\b/i;

/** The record kept in an inbox clip's meta.json after stripping. */
export interface StripRecord {
  at: string;
  verdict: "clean" | "music_remains" | "failed";
  /** The radio-free copy, relative to the clip's folder (only when clean). */
  file?: string;
  reasons: string[];
  before?: SoundSummary;
  after?: SoundSummary;
  fingerprint?: FingerprintMatch;
  model: string;
}

/** A turn on the PC's GPU from the orchestrator at Pulse's priority; on the Mac mini (no orchestrator) none is needed. */
async function gpuTurn(job: string, est: number): Promise<() => void> {
  try {
    const orch = await loadOrch();
    return (await orch.lease("gpu", {
      job,
      project: "pulse",
      priority: 60,
      kind: "pulse:avtools",
      est,
      vram: 6,
      ram: 6,
      maxWait: 90,
    })) as () => void;
  } catch (err) {
    log("info", "radio strip: no orchestrator turn; going ahead", {
      error: errorMessage(err),
    });
    return () => undefined;
  }
}

/** Runs radiostrip.py separate on some clips. Throws only when the script itself cannot run. */
export async function separateClips(
  s: Pick<AvToolsSettings, "python" | "models" | "radioStrip">,
  jobs: Array<{
    src: string;
    outDir: string;
    start?: number;
    seconds?: number;
  }>,
  work: string,
): Promise<StripJobResult[]> {
  if (!jobs.length) return [];
  await fs.mkdir(work, { recursive: true });
  const jobsFile = path.join(work, "strip_jobs.json");
  const resultFile = path.join(work, "strip_result.json");
  await fs.writeFile(
    jobsFile,
    JSON.stringify({
      models: s.models,
      ffmpeg: FFMPEG,
      nModels: s.radioStrip.checkpoints,
      lyricPass: s.radioStrip.lyricPass,
      maxResidueShare: s.radioStrip.maxResidue,
      maxFingerprintShare: s.radioStrip.maxFingerprint,
      jobs,
    }),
  );
  const release = await gpuTurn(
    "radio strip",
    Math.max(2, Math.ceil(jobs.length * 0.5)),
  );
  try {
    await run(s.python, ["-I", SCRIPT, "separate", jobsFile, resultFile], {
      cwd: AVTOOLS_DIR,
      timeout: 30 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
  } finally {
    release();
  }
  const out = JSON.parse(await fs.readFile(resultFile, "utf8")) as {
    results: StripJobResult[];
  };
  return out.results;
}

/** The clip's picture with the kept sound under it (video copied, sound AAC). */
export async function muxKept(
  video: string,
  keptWav: string,
  out: string,
): Promise<void> {
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      video,
      "-i",
      keptWav,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-shortest",
      "-movflags",
      "+faststart",
      out,
    ],
    { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
  );
}

/**
 * Strips one inbox clip: the radio-free copy beside it when the residue check passes, and the record either way.
 * Never throws: a failure is a "failed" record and the clip stays out, as it always did.
 */
export async function stripInboxClip(
  s: Pick<AvToolsSettings, "python" | "models" | "radioStrip">,
  dir: string,
  id: string,
  clipFile: string,
  now: Date,
): Promise<StripRecord> {
  const model = `CDX23 x${s.radioStrip.checkpoints}${s.radioStrip.lyricPass ? " + Mel-Band RoFormer lyric pass" : ""}`;
  const work = path.join(dir, "strip");
  try {
    const [r] = await separateClips(
      s,
      [{ src: path.join(dir, clipFile), outDir: work }],
      work,
    );
    if (!r) throw new Error("no result");
    const v = stripVerdict(r, s.radioStrip);
    const base: StripRecord = {
      at: now.toISOString(),
      verdict: v.clean ? "clean" : r.ok ? "music_remains" : "failed",
      reasons: v.reasons,
      before: r.before,
      after: r.after,
      fingerprint: r.fingerprint?.kept,
      model,
    };
    if (!v.clean) return base;
    const file = radioFreeName(id);
    await muxKept(
      path.join(dir, clipFile),
      path.join(work, r.kept ?? "kept.wav"),
      path.join(dir, file),
    );
    log("info", "radio stripped", {
      id,
      residue: r.after?.musicShare,
      fingerprint: r.fingerprint?.kept.matchShare,
    });
    return { ...base, file };
  } catch (err) {
    log("warn", "radio strip failed; the clip stays out", {
      id,
      error: errorMessage(err),
    });
    return {
      at: now.toISOString(),
      verdict: "failed",
      reasons: [errorMessage(err).slice(0, 300)],
      model,
    };
  } finally {
    // The stems are large and the copy has what is needed.
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The line for the owner's card about a stripped clip (pure). */
export function stripCardLine(r: StripRecord | undefined): string | undefined {
  if (!r) return undefined;
  if (r.verdict !== "clean")
    return `⚠️ Radio music could not be removed cleanly (${r.reasons.join("; ") || r.verdict}), so this clip is not used.`;
  const before = r.before ? pct(r.before.musicShare) : "?";
  const after = r.after ? pct(r.after.musicShare) : "?";
  return `🎵 Radio music removed (music heard in ${before} of the clip before, ${after} after). It uploads private first and only goes public after a clean copyright check.`;
}
