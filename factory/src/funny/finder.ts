// The funny-moment finder (FUNNY_SHORTS) for one of the owner's recordings: measure the sound and picture once, rank
// candidates by their signals, read the HUD around the best of them (when HUD_READER is on), ask the PC's local
// vision relay how funny each payoff looks, and rank again. The best one can then be cut into the gameplay lane's
// inbox as a "funny" clip (src/funny/review.ts takes it from there, with no paid model call).

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { measure } from "../liveclips/recorder.ts";
import { writeWhole, type GameplayMeta } from "../gameplay.ts";
import { measureBands, musicIn, soundCues, type SoundCue } from "./audio.ts";
import {
  finalRank,
  gatherEvidence,
  rankBySignals,
  type FunnyCandidate,
  type FunnyHud,
  type VisionVerdict,
} from "./moments.ts";
import { funnyPlan, pickCaption, type FunnyPlan } from "./edit.ts";

const run = promisify(execFile);

/** Seconds of recording each inbox clip holds, and where in it the payoff sits. */
export const FUNNY_CLIP_SECONDS = 30;
export const FUNNY_PAYOFF_IN_CLIP = 12;

export interface FinderDeps {
  /** HUD events in a stretch of the recording (absolute seconds), or undefined when the reader is off or failed. */
  readHud?: (
    start: number,
    duration: number,
  ) => Promise<FunnyHud[] | undefined>;
  /** The comedy check for frames (src/funny/vision.ts rateComedy). */
  rate?: (frames: string[]) => Promise<VisionVerdict | undefined>;
  log?: (line: string) => void;
}

export interface FinderResult {
  file: string;
  seconds: number;
  cues: SoundCue[];
  ranked: FunnyCandidate[];
  hudRead: boolean;
  visionChecked: number;
}

export async function durationOf(file: string): Promise<number> {
  const r = await run(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number(r.stdout.trim()) || 0;
}

/** Four frames around a payoff, one second apart (payoff - 1 to payoff + 2), 640 px wide. */
export async function payoffFrames(
  file: string,
  payoff: number,
  dir: string,
): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true });
  const out: string[] = [];
  for (const d of [-1, 0, 1, 2]) {
    const t = Math.max(0, payoff + d);
    const f = path.join(dir, `f_${Math.round(payoff * 10)}_${d + 1}.jpg`);
    await run(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-ss",
      t.toFixed(2),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-2",
      "-q:v",
      "4",
      f,
    ]);
    out.push(f);
  }
  return out;
}

/** When the owner's reaction around a payoff dies down: the last laugh or shout within six seconds after it. */
export function reactionEnd(
  cues: readonly SoundCue[],
  payoff: number,
): number | undefined {
  const r = cues.filter(
    (c) =>
      (c.kind === "laugh" || c.kind === "shout") &&
      c.t >= payoff &&
      c.t <= payoff + 6,
  );
  return r.length ? Math.max(...r.map((c) => c.t)) + 1 : undefined;
}

export async function findFunnyMoments(
  file: string,
  o: {
    work: string;
    candidates: number;
    inSpoilerWindow: boolean;
    visionMin: number;
    /** A radio-free copy exists for cutting (RADIO_STRIP), so licensed music is not a veto. */
    stripped?: boolean;
  },
  deps: FinderDeps = {},
): Promise<FinderResult> {
  const say = deps.log ?? (() => undefined);
  await fs.mkdir(o.work, { recursive: true });
  const seconds = await durationOf(file);
  const [bands, secs] = await Promise.all([
    measureBands(FFMPEG, file),
    measure(FFMPEG, file, 0, seconds),
  ]);
  const cues = soundCues(bands);
  say(`measured ${Math.round(seconds / 60)} min: ${cues.length} sound cues`);
  const evidence = gatherEvidence(
    cues,
    secs.map((s) => ({ t: s.at / 1000, motion: s.motion })),
    [],
  );
  let cands = rankBySignals(evidence, { top: o.candidates, duration: seconds });
  // The HUD around each candidate: Wasted, Busted, wanted jumps, stunts and flight, and the reader's own idea of
  // whether the screen is the game or a menu.
  let hudRead = false;
  if (deps.readHud) {
    const hud: FunnyHud[] = [];
    for (const c of cands) {
      const got = await deps
        .readHud(Math.max(0, c.payoff - 10), 20)
        .catch(() => undefined);
      if (got) {
        hudRead = true;
        hud.push(...got);
      }
    }
    if (hudRead) {
      const withHud = gatherEvidence(
        cues,
        secs.map((s) => ({ t: s.at / 1000, motion: s.motion })),
        hud,
      );
      cands = rankBySignals(withHud, { top: o.candidates, duration: seconds });
      say(`HUD read around ${cands.length} candidates: ${hud.length} events`);
    }
  }
  let visionChecked = 0;
  for (const c of cands) {
    c.music = musicIn(cues, c.payoff - 6, c.payoff + 6);
    if (!deps.rate) continue;
    const frames = await payoffFrames(
      file,
      c.payoff,
      path.join(o.work, "frames"),
    );
    const v = await deps.rate(frames).catch(() => undefined);
    if (v) {
      c.vision = v;
      visionChecked++;
    }
  }
  say(`local vision checked ${visionChecked} of ${cands.length}`);
  const ranked = finalRank(cands, {
    inSpoilerWindow: o.inSpoilerWindow,
    visionMin: o.visionMin,
    stripped: !!o.stripped,
  });
  return { file, seconds, cues, ranked, hudRead, visionChecked };
}

/** The "funny" block an inbox clip carries, which the lane uses in place of the paid reviewer and second look. */
export interface FunnyMeta {
  /** Seconds into the clip. */
  payoff_in_clip: number;
  reaction_end_in_clip?: number;
  buildup: boolean;
  score: number;
  signal_score: number;
  kind: string;
  caption: { hook: string; punch: string };
  reasons: string[];
  vision?: VisionVerdict;
  /** Minutes and seconds of the moment in the recording, for the owner. */
  at_in_source: number;
  plan: FunnyPlan;
}

/** Cuts the moment into <inbox>/<id>/ (clip.mp4, eight frames, meta.json) as a new clip for the gameplay lane. */
export async function cutFunnyClip(o: {
  file: string;
  title: string;
  recordedOn: string;
  candidate: FunnyCandidate;
  cues: readonly SoundCue[];
  inbox: string;
  id: string;
  now: Date;
}): Promise<{ dir: string; meta: GameplayMeta & { funny: FunnyMeta } }> {
  const c = o.candidate;
  const start = Math.max(0, c.payoff - FUNNY_PAYOFF_IN_CLIP);
  const dir = path.join(o.inbox, o.id);
  await fs.mkdir(path.join(dir, "frames"), { recursive: true });
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      start.toFixed(3),
      "-i",
      o.file,
      "-t",
      String(FUNNY_CLIP_SECONDS),
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      path.join(dir, "clip.mp4"),
    ],
    { maxBuffer: 1 << 26 },
  );
  await run(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-i",
    path.join(dir, "clip.mp4"),
    "-vf",
    `fps=8/${FUNNY_CLIP_SECONDS},scale=640:-2`,
    "-q:v",
    "4",
    path.join(dir, "frames", "%02d.jpg"),
  ]);
  const frames = (await fs.readdir(path.join(dir, "frames")))
    .filter((f) => f.endsWith(".jpg"))
    .sort()
    .map((f) => `frames/${f}`);
  const payoffIn = Math.round((c.payoff - start) * 100) / 100;
  const end = reactionEnd(o.cues, c.payoff);
  const buildup = c.evidence.some(
    (e) => e.kind === "hud" && /wanted|stars?/i.test(e.detail),
  );
  const plan = funnyPlan({
    payoff: payoffIn,
    clipSeconds: FUNNY_CLIP_SECONDS,
    ...(end !== undefined ? { reactionEnd: end - start } : {}),
    buildup,
  });
  const kind = c.vision?.kind ?? "none";
  const funny: FunnyMeta = {
    payoff_in_clip: payoffIn,
    ...(end !== undefined
      ? { reaction_end_in_clip: Math.round((end - start) * 100) / 100 }
      : {}),
    buildup,
    score: c.score,
    signal_score: c.signalScore,
    kind,
    caption: pickCaption(kind, o.id, c.vision?.caption),
    reasons: c.reasons,
    ...(c.vision ? { vision: c.vision } : {}),
    at_in_source: Math.round(c.payoff * 10) / 10,
    plan,
  };
  const meta: GameplayMeta & { funny: FunnyMeta } = {
    id: o.id,
    status: "new",
    source: {
      file: o.file,
      title: o.title,
      kind: "funny_vod",
      duration_seconds: FUNNY_CLIP_SECONDS,
    },
    clip: {
      file: "clip.mp4",
      start_in_source: start,
      peak_in_clip: payoffIn,
      seconds: FUNNY_CLIP_SECONDS,
    },
    score: c.score,
    frames,
    created_at: o.now.toISOString(),
    funny,
  };
  await writeWhole(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return { dir, meta };
}
