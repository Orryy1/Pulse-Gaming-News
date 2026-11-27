// The evidence board style's step in the pipeline (EVIDENCE_STYLE, src/evidencestyle.ts): whether the episode is a
// mystery or lore story, its arm of the EVIDENCE_STYLE_SHARE test, the face check on the pictures it might pin (Apple
// Vision on the Mac), and the plan the render draws. Off, ineligible or in the plain arm: no plan, and the render is
// exactly what it was. The arm and the pass mark are logged with every eligible episode ("evidence_style").

import type { Config } from "./config.ts";
import type { Word } from "./voice/elevenlabs.ts";
import type { Segment } from "./render/timeline.ts";
import type { BoardFrame, EvidenceBoardPlan } from "./render/evidenceboard.ts";
import { log } from "./lib/util.ts";
import {
  EVIDENCE_PASS_MARK,
  boardDrawsAnything,
  boardModeFor,
  evidenceArm,
  faceShares,
  pinnable,
  planEvidenceBoard,
  type BoardModeInput,
  type EvidenceArm,
  type PinCandidate,
  type PlanShotLike,
} from "./evidencestyle.ts";

export interface EvidencePrepInput extends BoardModeInput {
  cfg: Pick<Config, "evidenceStyle" | "evidenceStyleShare">;
  episodeId: string;
  frame: BoardFrame;
  fps: number;
  words: Word[];
  segments: Segment[];
  /** The episode's pictures: file (for the face check, relative to `dir`), kind and provenance. */
  images: Array<{ file: string; kind: string; provenance?: string }>;
  dir: string;
  /** Frames where nothing new lands (the opening poster and loop, the Short's own word stamp). */
  avoid?: Array<[number, number]>;
  breaks?: Array<{ start: number; end: number }>;
  /** Files an event: the arm, why, the pass mark and what the plan holds. */
  event: (kind: string, detail: Record<string, unknown>) => Promise<unknown>;
  /** The face finder (tests pass a fake); Apple Vision on the Mac when absent. */
  faces?: (
    files: string[],
  ) => Promise<{ checked: boolean; shares: Map<string, number> }>;
}

export interface EvidencePrep {
  arm: EvidenceArm;
  /** The plan for these shots (the long video's plan can be made again after its graphics check). */
  plan(
    shots: PlanShotLike[],
    totalFrames: number,
  ): EvidenceBoardPlan | undefined;
}

/**
 * The style's decision and face check for one episode, once (async). Undefined when the style is off or the episode
 * is not a mystery or lore story: nothing is recorded and nothing changes.
 */
export async function prepareEvidence(
  input: EvidencePrepInput,
): Promise<EvidencePrep | undefined> {
  if (!input.cfg.evidenceStyle) return undefined;
  const mode = boardModeFor(input);
  if (!mode.on) return undefined;
  const arm = evidenceArm(input.episodeId, input.cfg.evidenceStyleShare);
  const base = {
    arm,
    reason: mode.reason,
    share: input.cfg.evidenceStyleShare,
    passMark: EVIDENCE_PASS_MARK.text,
  };
  log("info", "evidence style", {
    episode: input.episodeId,
    frame: input.frame,
    ...base,
  });
  if (arm === "plain") {
    await input.event("evidence_style", base).catch(() => undefined);
    return { arm, plan: () => undefined };
  }
  // Only pictures that already pass the kind and provenance rules are looked at for faces.
  const sep = input.dir.includes("\\") ? "\\" : "/";
  const first = input.images.map(
    (i) => ({ kind: i.kind, provenance: i.provenance }) as PinCandidate,
  );
  const files = input.images.flatMap((i, k) =>
    pinnable(first[k]!) ? [`${input.dir}${sep}${i.file}`] : [],
  );
  const faces = await (input.faces ?? faceShares)(files).catch(() => ({
    checked: false,
    shares: new Map<string, number>(),
  }));
  // Fail closed: a picture the face finder did not answer for (off the Mac, a crash, a file it skipped) counts as a
  // likeness and is never pinned, so no picture reaches the board without the face check.
  const candidates: PinCandidate[] = input.images.map((i, k) => ({
    ...first[k]!,
    faceShare: faces.shares.get(`${input.dir}${sep}${i.file}`) ?? 1,
  }));
  const unchecked = input.images.filter(
    (i, k) => pinnable(first[k]!) && !faces.shares.has(`${input.dir}${sep}${i.file}`),
  ).length;
  const faceDropped = candidates.filter((c, k) => pinnable(first[k]!) && !pinnable(c)).length - unchecked;
  const planFor = (shots: PlanShotLike[], totalFrames: number) => {
    const plan = planEvidenceBoard({
      frame: input.frame,
      fps: input.fps,
      totalFrames,
      episodeId: input.episodeId,
      mode: true,
      words: input.words,
      segments: input.segments,
      headline: input.headline,
      shots,
      images: candidates,
      avoid: input.avoid,
      breaks: input.breaks,
    });
    return boardDrawsAnything(plan) ? plan : undefined;
  };
  let logged = false;
  return {
    arm,
    plan(shots, totalFrames) {
      const plan = planFor(shots, totalFrames);
      // Filed once: a long video asks again for its stills and its render.
      if (logged) return plan;
      logged = true;
      void input
        .event("evidence_style", {
          ...base,
          facesChecked: faces.checked,
          faceDropped,
          unchecked,
          pinnable: plan?.allowed.length ?? 0,
          dates:
            plan?.dates.map((d) => [d.big, d.sub ?? ""].join(" ").trim()) ?? [],
          cases: plan?.cases.map((c) => c.topic) ?? [],
          stamps: plan?.stamps.map((s) => s.text) ?? [],
          pins: plan?.pins.length ?? 0,
          windows: plan?.windows.length ?? 0,
        })
        .catch(() => undefined);
      return plan;
    },
  };
}
