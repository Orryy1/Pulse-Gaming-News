// The AI motion clip area's registry, for the integration step that wires filler visuals into the long plan.
// Render side only (this file is bundled by Remotion, so nothing here imports node modules): the shot
// component, its treatments and the clip detector. The chooser for bare sentences,
// localvideoFor(sentence, moment, chapter), and the clip maker live in src/assets/localvideo.ts.
//
// Integration in three steps: (1) after the sketch pass, createLocalVideoRun(...).animateAll(items, clips)
// adds clip records to assets.clips, pinned to their sentence like any clip (beatIndex + moment); (2) the long
// plan, finding isLocalVideo(clip) on a moment, gives that shot kind "localvideo" instead of footage; (3)
// Long.tsx draws it with <LocalVideoShot treatment="print"> (the clip animates a sketch) for the shot's len.

import { LocalVideoShot, type LocalVideoShotProps } from "./LocalVideoShot.tsx";
import {
  LOCALVIDEO_PREFIX,
  clipTiming,
  isLocalVideo,
  treatmentFor,
  type LocalVideoTreatment,
} from "./plan.ts";

export const LOCALVIDEO_REGISTRY = {
  area: "localvideo" as const,
  kind: "localvideo" as const,
  /** On screen with every clip. */
  tag: "ILLUSTRATION" as const,
  treatments: ["print", "bleed"] as LocalVideoTreatment[],
  component: LocalVideoShot,
  treatmentFor,
  isLocalVideo,
  clipTiming,
};

export {
  LOCALVIDEO_PREFIX,
  LocalVideoShot,
  clipTiming,
  isLocalVideo,
  treatmentFor,
  type LocalVideoShotProps,
  type LocalVideoTreatment,
};
