// FRAME_FOCUS's place in the factory (src/qa/framefocus.ts): at the end of a Short's render step, once the render has
// passed QA and before it is marked rendered. Off, nothing here runs. The arm's frames go to the free local vision model
// (src/assets/localvision.ts) one spoken line at a time, inside a time box; the result is kept on assets.frame_focus and
// logged as a "frame_focus" event. The control arm records only its arm. Never throws and never changes the video.

import path from "node:path";
import type { Db } from "./db.ts";
import type { Segment } from "./render/timeline.ts";
import { logEvent } from "./episodes.ts";
import { errorMessage, log } from "./lib/util.ts";
import {
  FOCUS_SCHEMA,
  FOCUS,
  focusEvent,
  frameFocusArm,
  runFrameFocus,
  type FocusMode,
  type FrameFocusRecord,
} from "./qa/framefocus.ts";

/** What the step may call; tests pass their own, the factory uses the local model. */
export interface FocusDeps {
  ready: () => Promise<boolean>;
  ask: (file: string, prompt: string) => Promise<unknown>;
}

async function localDeps(): Promise<FocusDeps> {
  const { focusAsk, focusReady } = await import("./assets/localvision.ts");
  return {
    ready: focusReady,
    ask: (file, prompt) =>
      focusAsk(file, prompt, FOCUS_SCHEMA, FOCUS.frameTimeoutMs),
  };
}

export async function frameFocusStep(
  s: {
    db: Db;
    cfg: { frameFocus: FocusMode; frameFocusShare: number };
    now: () => Date;
    extractFrames(
      file: string,
      outDir: string,
      times: number[],
    ): Promise<string[]>;
  },
  ep: { id: string; lane: string },
  x: {
    assets: { frame_focus?: FrameFocusRecord };
    game: string;
    segments: Segment[];
    duration: number;
    /** The final render. */
    video: string;
    /** The episode's folder; frames go under qa/focus. */
    dir: string;
  },
  deps?: FocusDeps,
): Promise<void> {
  const mode = s.cfg.frameFocus;
  if (mode === "off" || ep.lane === "longform" || x.assets.frame_focus?.at)
    return;
  try {
    const arm = frameFocusArm(ep.id, s.cfg.frameFocusShare);
    const d = arm === "check" ? (deps ?? (await localDeps())) : undefined;
    const record = await runFrameFocus({
      mode,
      arm,
      game: x.game,
      segments: x.segments,
      duration: x.duration,
      extract: (times) =>
        s.extractFrames(x.video, path.join(x.dir, "qa", "focus"), times),
      ready: d ? d.ready : async () => false,
      ask: d ? d.ask : async () => undefined,
      now: s.now,
    });
    x.assets.frame_focus = record;
    await logEvent(s.db, ep.id, "frame_focus", focusEvent(record)).catch(
      () => undefined,
    );
    log("info", "frame focus", {
      episode: ep.id,
      arm,
      mode,
      checked: record.summary?.checked ?? 0,
      mean: record.summary?.mean,
      weak: record.summary?.weak_share,
      ms: record.ms,
    });
  } catch (err) {
    log("warn", "frame focus failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
  }
}
