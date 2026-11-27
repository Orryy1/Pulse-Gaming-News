// The stream index in short turns (26 Nov 2026). Two NVIDIA driver resets that morning (03:52 and 08:32, Xid 13 then a
// TDR) came while one stream-index turn held the GPU for 90 to 110 minutes. Both faults were inside Ollama's qwen3-vl
// picture step (llama-server: "CUDA error: an illegal memory access", Ollama logging CUDA out of memory before), with
// the stream index's own Whisper (faster-whisper on CUDA, a fresh model every 20-minute chunk) or tag requests running
// beside it. Now:
//   - Whisper and SigLIP run on the CPU for streams (VOD_WHISPER_DEVICE, VOD_SEMANTIC_DEVICE: cpu), so the only GPU
//     work left is the vision model's tags and descriptions, through Ollama, one request at a time;
//   - the work goes in slices of at most VOD_SLICE_MINUTES (18, never over 20), each in its own orchestrator turn with
//     an --est from the minutes each step has really taken (rates.json beside the indexes, learned as it goes), so a
//     render, the explainer or Pulse's voice gets the GPU between slices instead of waiting an hour.
// Pure planning here; src/tools/vodpc.ts takes the turns.

import fs from "node:fs/promises";
import path from "node:path";

/** The kinds of work on a recording's index, in the order vodIndexStep does them. */
export type VodWork =
  | "stretch"
  | "describe"
  | "tag"
  | "words"
  | "embed"
  | "done";
export type SliceWork = Exclude<VodWork, "done" | "words">;

/** Seconds each unit of work takes: a second of recording (stretch), a shot (describe, embed), a stretch (tag). */
export interface VodRates {
  stretch: number;
  describe: number;
  tag: number;
  embed: number;
}

/**
 * Measured on the PC, 26 Nov 2026: tags took 33 to 34 s a half-minute stretch (200 in 111 min, 116 in 66 min, with
 * the Mac's own vision calls sharing Ollama; D:\pulse-data\logs\vod-daily.log). Stretch (CPU Whisper medium.en int8,
 * the cut scan and the text reader) and embed (SigLIP 2 base on the CPU) are from the 26 Nov stress run. They are
 * only the starting point: every slice's real time is folded in (learnRate) and `vodpc.ts rates` shows them.
 */
export const DEFAULT_RATES: VodRates = {
  stretch: 0.2,
  describe: 20,
  tag: 34,
  embed: 0.3,
};

/** The longest turn a slice may plan for, minutes (VOD_SLICE_MINUTES, 5 to 20, default 18). */
export function sliceCap(
  env: Record<string, string | undefined> = process.env,
): number {
  const n = Number(env.VOD_SLICE_MINUTES);
  return Number.isFinite(n) && n > 0 ? Math.min(20, Math.max(5, n)) : 18;
}

/**
 * The orchestrator priority of every stream-index slice (VOD_PRIORITY, 20 to 40, default 40). 26 Nov 2026: orch.py's
 * _not_slot_work() keeps kinds starting "pulse:vod" out of Pulse's deadline and agreement windows, so the slices can sit
 * at the manual-tool tier (40) instead of the test tier (20). Never above 40: higher would compete with Pulse's own
 * p60 voice and renders.
 */
export function vodPriority(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.VOD_PRIORITY;
  const n = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(40, Math.max(20, Math.round(n))) : 40;
}

/** Every slice's orchestrator kind starts with this, so orch.py treats it as stream-index work, not Pulse's slot work. */
export const VOD_KIND_PREFIX = "pulse:vod";

/** Room for a slow unit: a slice plans at the rate times this, and its --est carries the same margin. */
export const SLICE_MARGIN = 1.15;

export interface SlicePlan {
  work: SliceWork;
  /** The orchestrator class: gpu for the vision model's work (and a step moved back to the GPU), cpu otherwise. */
  cls: "gpu" | "cpu";
  /** The orchestrator kind, one per step, so one step's learned length never stands in for another's. */
  kind: string;
  /** Units planned: stretch chunks (stretch), shots (describe, embed) or half-minute stretches (tag). */
  units: number;
  /** Seconds of recording one stretch chunk covers (stretch only). */
  chunkSeconds?: number;
  /** Honest --est in whole minutes, never over the cap. */
  est: number;
}

export interface PlanInput {
  work: SliceWork;
  /** Units still to do (seconds of recording still uncovered, for stretch). */
  left: number;
  rates: VodRates;
  capMinutes: number;
  /** The configured stretch chunk, seconds (VOD_MINER_CHUNK_MINUTES * 60). */
  chunkSeconds: number;
  whisperDevice: string;
  semanticDevice: string;
}

const onGpu = (device: string) => device !== "cpu";

/** The next slice of a step: as many units as fit the cap at the measured rate, at least one. */
export function planSlice(p: PlanInput): SlicePlan {
  const capSec = p.capMinutes * 60;
  const per = Math.max(1e-3, p.rates[p.work]) * SLICE_MARGIN;
  const est = (seconds: number) =>
    Math.min(p.capMinutes, Math.max(1, Math.ceil(seconds / 60)));
  if (p.work === "stretch") {
    // A chunk is cut down (whole minutes, two at least) when one of the usual size would not fit in a turn.
    const fits = Math.floor(capSec / per / 60) * 60;
    const chunk = Math.max(120, Math.min(p.chunkSeconds, fits));
    const left = Math.max(1, p.left);
    const units = Math.max(
      1,
      Math.min(Math.ceil(left / chunk), Math.floor(capSec / (chunk * per))),
    );
    return {
      work: "stretch",
      cls: onGpu(p.whisperDevice) ? "gpu" : "cpu",
      kind: "pulse:vodstretch",
      units,
      chunkSeconds: chunk,
      est: est(Math.min(left, units * chunk) * per),
    };
  }
  const units = Math.max(
    1,
    Math.min(Math.ceil(p.left), Math.floor(capSec / per)),
  );
  const cls = p.work === "embed" && !onGpu(p.semanticDevice) ? "cpu" : "gpu";
  return {
    work: p.work,
    cls,
    kind: `pulse:vod${p.work}`,
    units,
    est: est(units * per),
  };
}

/** A slice's measured rate folded into the learned one (a third of the new reading), kept inside sane bounds. */
export function learnRate(
  rates: VodRates,
  work: keyof VodRates,
  seconds: number,
  units: number,
): VodRates {
  if (!(units > 0) || !(seconds > 0)) return rates;
  const seen = seconds / units;
  const lo = DEFAULT_RATES[work] / 20;
  const hi = DEFAULT_RATES[work] * 20;
  const next = Math.min(hi, Math.max(lo, rates[work] * (2 / 3) + seen / 3));
  return { ...rates, [work]: Math.round(next * 10000) / 10000 };
}

const ratesFile = (dataDir: string) =>
  path.join(dataDir, "vodindex", "rates.json");

export async function loadRates(dataDir: string): Promise<VodRates> {
  const out = { ...DEFAULT_RATES };
  try {
    const raw = JSON.parse(
      await fs.readFile(ratesFile(dataDir), "utf8"),
    ) as Partial<VodRates>;
    for (const k of Object.keys(DEFAULT_RATES) as Array<keyof VodRates>) {
      const v = raw[k];
      if (typeof v === "number" && v > 0) out[k] = v;
    }
  } catch {
    // none yet: the measured defaults
  }
  return out;
}

export async function saveRates(
  dataDir: string,
  rates: VodRates,
): Promise<void> {
  const file = ratesFile(dataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(rates, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

/** Minutes one stream-hour costs at these rates, per step (about 680 shots and 120 stretches an hour of GTA VI). */
export function minutesPerStreamHour(
  r: VodRates,
  shotsPerHour = 680,
  stretchesPerHour = 120,
): { stretch: number; tag: number; embed: number } {
  const m = (s: number) => Math.round((s / 60) * 10) / 10;
  return {
    stretch: m(3600 * r.stretch),
    tag: m(stretchesPerHour * r.tag),
    embed: m(shotsPerHour * r.embed),
  };
}

export interface LeaseOptions {
  job: string;
  kind: string;
  est: number;
  priority: number;
  maxWait?: number;
}

export interface SliceDeps {
  /** An orchestrator turn; resolves with its release. */
  lease: (cls: "gpu" | "cpu", o: LeaseOptions) => Promise<() => void>;
  now: () => number;
  /** Where VOD_PRIORITY is read (default process.env); tests pass their own. */
  env?: Record<string, string | undefined>;
}

const unitName = (w: SliceWork) =>
  w === "stretch" ? "chunks" : w === "tag" ? "stretches" : "shots";

/** The orchestrator would not give a turn (as opposed to the work failing inside one). */
export class NoTurn extends Error {}

/**
 * One slice in its own turn: takes the lease, does the work (which must not start a new unit after `until`), gives
 * the lease back whatever happens, and answers the seconds the work took (the wait for the turn not counted). A lease
 * refused or not granted in time throws NoTurn; an error in the work itself is thrown as it is.
 */
export async function inTurn<T>(
  plan: SlicePlan,
  label: string,
  deps: SliceDeps,
  work: (until: number) => Promise<T>,
  maxWaitMinutes?: number,
): Promise<{ result: T; seconds: number }> {
  if (!plan.kind.startsWith(VOD_KIND_PREFIX))
    throw new Error(`a stream-index slice needs a "${VOD_KIND_PREFIX}" kind, not "${plan.kind}"`);
  let release: () => void;
  try {
    release = await deps.lease(plan.cls, {
      job: `vodpc: ${plan.work} ${label} (${plan.units} ${unitName(plan.work)}, ${plan.est} min)`,
      kind: plan.kind,
      est: plan.est,
      priority: vodPriority(deps.env ?? process.env),
      ...(maxWaitMinutes !== undefined ? { maxWait: Math.max(1, Math.round(maxWaitMinutes)) } : {}),
    });
  } catch (err) {
    throw new NoTurn(err instanceof Error ? err.message : String(err));
  }
  const t0 = deps.now();
  try {
    // A hard stop a little past the plan: a unit already started finishes, no new one starts after it.
    const result = await work(t0 + plan.est * 60_000 * 1.1);
    return { result, seconds: (deps.now() - t0) / 1000 };
  } finally {
    release();
  }
}

export interface SliceRunDeps extends SliceDeps {
  /** What the index needs next and how much is left of it (build.ts vodNextWork). */
  next: () => Promise<{ work: VodWork; left: number }>;
  /**
   * One piece of the index's work (build.ts vodIndexStep) with the slice's sizes; answers what it did. Called with no
   * plan only for "words", which is bookkeeping on the CPU.
   */
  step: (plan: SlicePlan | undefined, until: number | undefined) => Promise<string>;
  visionUp: () => Promise<boolean>;
  saveRates: (r: VodRates) => Promise<void>;
  log: (line: string) => void | Promise<void>;
}

export interface SliceRunSettings {
  label: string;
  /** Epoch ms the whole run ends by: no slice is asked for after it, and a turn is waited for until it at most. */
  until: number;
  rates: VodRates;
  capMinutes: number;
  chunkSeconds: number;
  whisperDevice: string;
  semanticDevice: string;
}

/**
 * Why a recording's slices stopped: done; the run's time is up; the vision model is away or no turn came (both stop
 * the whole run, as every other recording would meet the same); or this recording made no progress or its work failed
 * (the run goes on with the next recording).
 */
export type SliceStop = "done" | "time" | "vision-away" | "no-turn" | "no-progress" | "failed";

/** True when a stop means the whole run should end, not just this recording. */
export const stopsRun = (s: SliceStop) => s === "vision-away" || s === "no-turn" || s === "time";

/**
 * Works on one recording's index slice by slice until it is done, the run's time is up, the vision model is away, no
 * turn comes, or it stops getting anywhere. Every piece of work except the words bookkeeping runs inside an
 * orchestrator turn of its own, sized by planSlice; each slice's real time is learned into the rates.
 */
export async function indexInSlices(
  s: SliceRunSettings,
  d: SliceRunDeps,
): Promise<{ stopped: SliceStop; rates: VodRates; slices: number }> {
  let rates = s.rates;
  let slices = 0;
  for (let i = 0; i < 100000; i++) {
    if (d.now() > s.until) return { stopped: "time", rates, slices };
    const next = await d.next();
    if (next.work === "done") return { stopped: "done", rates, slices };
    if (next.work === "words") {
      // Bookkeeping that changed nothing would only be asked for again: this recording waits instead.
      if ((await d.step(undefined, undefined)) !== "tagged") return { stopped: "no-progress", rates, slices };
      continue;
    }
    if ((next.work === "tag" || next.work === "describe") && !(await d.visionUp())) {
      await d.log(`waiting: ${s.label}: the local vision model is not answering`);
      return { stopped: "vision-away", rates, slices };
    }
    const plan = planSlice({
      work: next.work,
      left: next.left,
      rates,
      capMinutes: s.capMinutes,
      chunkSeconds: s.chunkSeconds,
      whisperDevice: s.whisperDevice,
      semanticDevice: s.semanticDevice,
    });
    let turn: { result: string; seconds: number };
    try {
      turn = await inTurn(
        plan,
        s.label,
        d,
        async (stopAt) => {
          let did = "waiting";
          // A stretch slice is its planned number of chunks, one call each; the other steps do their units in one call.
          for (let k = 0; k < (plan.work === "stretch" ? plan.units : 1); k++) {
            if (k > 0 && d.now() > stopAt) break;
            did = await d.step(plan, stopAt);
            if (did !== "stretch") break;
          }
          return did;
        },
        (s.until - d.now()) / 60_000,
      );
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      if (err instanceof NoTurn) {
        await d.log(`no turn for ${plan.work} ${s.label}: ${why}`);
        return { stopped: "no-turn", rates, slices };
      }
      await d.log(`${plan.work} failed on ${s.label}: ${why}`);
      return { stopped: "failed", rates, slices: slices + 1 };
    }
    slices++;
    const after = await d.next();
    const done = after.work === next.work ? next.left - after.left : next.left;
    if (done > 0) {
      rates = learnRate(rates, plan.work, turn.seconds, done);
      await d.saveRates(rates);
    }
    await d.log(
      `${turn.result}: ${plan.work} slice of ${s.label}, ${Math.round(done)} ${plan.work === "stretch" ? "s of recording" : unitName(plan.work)} in ${(turn.seconds / 60).toFixed(1)} min (est ${plan.est}, ${plan.cls} turn)`,
    );
    if (turn.result === "waiting" || !(done > 0)) return { stopped: "no-progress", rates, slices };
  }
  return { stopped: "time", rates, slices };
}
