// The explainers' registry (EXPLAINERS): each shape's component, its plain-English name, its entry sound and the
// frame (after its last item lands) by which its build has settled. ExplainerShot draws a line's explainer with its
// items timed to the narrator's words; the Short (src/render/Short.tsx) and the long video's filler shots
// (src/render/Long.tsx) both use it.
import React from "react";
import { Anatomy } from "./Anatomy.tsx";
import { Cycle } from "./Cycle.tsx";
import { CauseChain, StepFlow } from "./Flow.tsx";
import { explainerAt, type TimedWord } from "./ground.ts";
import { HowMuch } from "./HowMuch.tsx";
import { Object3D } from "./Object3D.tsx";
import { Playhead } from "./Playhead.tsx";
import {
  EXPLAINER_SOUND,
  EXPLAINER_WORDS,
  type Explainer,
  type ExplainerProps,
  type ExplainerType,
} from "./types.ts";
import { Versus } from "./Versus.tsx";

export interface ExplainerEntry {
  component: React.FC<ExplainerProps>;
  label: string;
  sound: "pop" | "glint" | "stamp";
  /** Frames after the last item lands by which every connector, counter and label has finished. */
  settleAfter: number;
}

export const EXPLAINERS: Record<ExplainerType, ExplainerEntry> = {
  steps: {
    component: StepFlow,
    label: EXPLAINER_WORDS.steps,
    sound: EXPLAINER_SOUND.steps,
    settleAfter: 24,
  },
  versus: {
    component: Versus,
    label: EXPLAINER_WORDS.versus,
    sound: EXPLAINER_SOUND.versus,
    settleAfter: 32,
  },
  chain: {
    component: CauseChain,
    label: EXPLAINER_WORDS.chain,
    sound: EXPLAINER_SOUND.chain,
    settleAfter: 24,
  },
  timeline: {
    component: Playhead,
    label: EXPLAINER_WORDS.timeline,
    sound: EXPLAINER_SOUND.timeline,
    settleAfter: 20,
  },
  howmuch: {
    component: HowMuch,
    label: EXPLAINER_WORDS.howmuch,
    sound: EXPLAINER_SOUND.howmuch,
    settleAfter: 30,
  },
  cycle: {
    component: Cycle,
    label: EXPLAINER_WORDS.cycle,
    sound: EXPLAINER_SOUND.cycle,
    settleAfter: 34,
  },
  anatomy: {
    component: Anatomy,
    label: EXPLAINER_WORDS.anatomy,
    sound: EXPLAINER_SOUND.anatomy,
    settleAfter: 26,
  },
  object3d: {
    component: Object3D,
    label: EXPLAINER_WORDS.object3d,
    sound: EXPLAINER_SOUND.object3d,
    settleAfter: 26,
  },
};

/** The frame (from the explainer's first frame) by which it is fully drawn: its last item down plus its settle. */
export function explainerSettle(
  e: Explainer,
  at: number[],
  len: number,
): number {
  return Math.max(
    0,
    Math.min(len - 10, (at.at(-1) ?? 0) + EXPLAINERS[e.type].settleAfter),
  );
}

/**
 * A line's explainer for `len` frames. `words` are the narrator's words of the window in seconds from its first
 * frame; without them the items build evenly.
 */
export const ExplainerShot: React.FC<{
  e: Explainer;
  len: number;
  words: TimedWord[];
  fps: number;
  accent: string;
  backdrop?: string;
  seed?: number;
}> = ({ e, len, words, fps, accent, backdrop, seed = 0 }) => {
  const entry = EXPLAINERS[e.type];
  if (!entry) return null;
  const at = explainerAt(e, words, fps, len);
  return React.createElement(entry.component, {
    e,
    len,
    at,
    accent,
    backdrop,
    seed,
  });
};

export {
  EXPLAINER_TYPES,
  type Explainer,
  type ExplainerType,
} from "./types.ts";
export {
  anatomyReady,
  explainerAt,
  explainerWindow,
  groundExplainer,
} from "./ground.ts";
