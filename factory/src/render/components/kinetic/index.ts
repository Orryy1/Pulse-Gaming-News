// The kinetic-typography registry: every style by the name `kineticFor` puts on its candidate
// (./choose.ts), so the integration step renders `KINETIC[candidate.style].component` with the candidate's
// data and the sentence's word times. The chooser and the word functions are re-exported for one import.
import type React from "react";
import type { KineticStyle } from "./choose.ts";
import type { KineticProps } from "./kit.tsx";
import {
  Highlight,
  Land,
  Scale,
  Split,
  Stack,
  TypeUnderline,
} from "./styles.tsx";

export interface KineticEntry {
  component: React.FC<KineticProps>;
  /** One line for the logs and the owner. */
  label: string;
  /** Sound on entry, as the graphic packs name them: "pop" (a whoosh), "glint" (a tick) or "stamp" (a low hit). */
  sound?: "pop" | "glint" | "stamp";
}

export const KINETIC: Record<KineticStyle, KineticEntry> = {
  land: { component: Land, label: "words landing one by one", sound: "stamp" },
  scale: {
    component: Scale,
    label: "one word scaling up through the frame",
    sound: "pop",
  },
  typeUnderline: {
    component: TypeUnderline,
    label: "the line typed, then underlined",
    sound: "glint",
  },
  stack: {
    component: Stack,
    label: "words stacking into a block",
    sound: "pop",
  },
  split: {
    component: Split,
    label: "the two halves of the line facing off",
    sound: "pop",
  },
  highlight: {
    component: Highlight,
    label: "a highlighter sweeping the key word",
    sound: "glint",
  },
};

export {
  kineticFor,
  kineticVerdict,
  KINETIC_STYLES,
  type KineticData,
  type KineticStyle,
} from "./choose.ts";
export { keyWords, wordTimes, wordsIn, type SpokenWord } from "./words.ts";
export { kineticSettle, landFrames, type KineticProps } from "./kit.tsx";
export type {
  Candidate,
  FillerAt,
  FillerChapter,
  FillerMoment,
  Verdict,
} from "./types.ts";
export { backdropFor, backdropScore, type BackdropImage } from "./backdrop.ts";
