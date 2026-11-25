// The explainers' shared shape (EXPLAINERS, 20 Nov 2026): when a line explains HOW something works (an app that
// brings your car for a fee, a launch that unlocks at midnight local time, a price that climbs by $20, a camera that
// cycles between three characters), the line gets a clean code-drawn animated explainer instead of a random still.
// The writer's explainer pass (src/editorial/explainers.ts) marks the beat, ./ground.ts keeps only what the script and
// its sources say, and ./index.ts draws it. Pure and free of node modules: the bundle and the pipeline both import it.

import type { IconName } from "./icons.ts";

/** The eight explainer shapes, in registry order (./index.ts draws them). */
export const EXPLAINER_TYPES = [
  "steps",
  "versus",
  "chain",
  "timeline",
  "howmuch",
  "cycle",
  "anatomy",
  "object3d",
] as const;
export type ExplainerType = (typeof EXPLAINER_TYPES)[number];

/** The simple objects the 3D explainer builds from primitives (never a copy of a real product's design). */
export const OBJECT_KINDS = [
  "console",
  "controller",
  "disc",
  "handheld",
] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

export interface ExplainerItem {
  /** The words on screen for this step, side, stop, block or part: 1-5 words from the script or its sources. */
  label: string;
  /** A figure or time beside the label ("$79.99", "6 a.m. ET", "30 FPS target"); empty when the type has none. */
  value?: string;
  /** A generic icon from the vendored set (./icons.ts). */
  icon?: IconName;
  /** 1-4 words of the line's own narration this item lands on, so it builds as the narrator says it. */
  cue?: string;
  /** versus: the side the line is about, drawn in the accent. */
  lead?: boolean;
}

export interface Explainer {
  type: ExplainerType;
  /** A 1-5 word heading from the line; empty draws none. */
  title: string;
  items: ExplainerItem[];
  /** object3d: what is built. */
  object?: ObjectKind;
  /** anatomy: the picture the callouts point into (a URL or a path the render serves). */
  picture?: string;
  /** anatomy: where each item points, 0-1 across and down the picture, in item order (the local vision model). */
  points?: Array<{ x: number; y: number }>;
  /** anatomy: the picture's width over its height (the board cover-crops it). */
  aspect?: number;
}

/** How many items each shape draws: below the floor it says nothing, above the ceiling it cannot be read. */
export const ITEM_COUNTS: Record<ExplainerType, [number, number]> = {
  steps: [2, 4],
  versus: [2, 2],
  chain: [2, 4],
  timeline: [2, 4],
  howmuch: [2, 3],
  cycle: [3, 4],
  anatomy: [2, 4],
  object3d: [2, 3],
};

/** The shapes that set a figure or time beside each label; the rest draw labels alone. */
export const VALUE_TYPES: ReadonlySet<ExplainerType> = new Set([
  "versus",
  "timeline",
  "howmuch",
]);

/** The words a label may run to; the layout then fits it on at most two lines (./layout.ts). */
export const LABEL_WORDS = 5;
export const LABEL_CHARS = 30;
export const VALUE_CHARS = 16;
export const TITLE_WORDS = 5;

/** The frame (from the explainer's first frame) by which an item lands when no voice timing is known. */
export const UNTIMED_STEP = 18;
/** Each type's entry sound, in the graphic packs' vocabulary. */
export const EXPLAINER_SOUND: Record<ExplainerType, "pop" | "glint" | "stamp"> =
  {
    steps: "pop",
    versus: "pop",
    chain: "pop",
    timeline: "glint",
    howmuch: "stamp",
    cycle: "glint",
    anatomy: "pop",
    object3d: "glint",
  };

/** What every explainer component receives. */
export type ExplainerProps = {
  e: Explainer;
  /** Frames the explainer is on screen. */
  len: number;
  /** Per item, the frame (from the explainer's first frame) it lands on: from the narrator's words (./ground.ts). */
  at: number[];
  accent: string;
  /** A picture of the story's game, blurred behind the board; absent: the plain ink board. */
  backdrop?: string;
  seed: number;
};

/** The small channel label over each board (house chrome, not a claim). */
export const EXPLAINER_KICKER: Record<ExplainerType, string> = {
  steps: "HOW IT WORKS",
  versus: "SIDE BY SIDE",
  chain: "WHAT LEADS TO WHAT",
  timeline: "WHEN IT HAPPENS",
  howmuch: "HOW IT ADDS UP",
  cycle: "THE LOOP",
  anatomy: "LOOK CLOSER",
  object3d: "UP CLOSE",
};

/** Plain-English names, for the logs and the owner's notices. */
export const EXPLAINER_WORDS: Record<ExplainerType, string> = {
  steps: "step flow",
  versus: "side-by-side comparison",
  chain: "cause-and-effect chain",
  timeline: "timeline with a playhead",
  howmuch: "price or number build",
  cycle: "cycle",
  anatomy: "labelled picture",
  object3d: "3D object with labelled parts",
};
