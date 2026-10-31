// A documentary sentence's filler visual, as the chooser (src/assets/fillers.ts) stores it on the shot list and
// the planner (./longplan.ts) and the composition (./Long.tsx) read it back (31 Oct 2026: about one sentence in
// five describes something nothing filmed can show and sat on the chapter's generic footage or repeated stock).
// One of six families answers such a line: kinetic type, an explainer diagram, an archive document, a drawn
// period scene, a silhouette scene, or an in-game reconstruction. This file is the shared, render-safe half:
// the stored shape, how long a filler shot may run, the frame by which each family has settled (where the
// graphics check and the release gate look), the reconstruction's playback rate and each family's entry sound.
// Pure and free of node modules, so both the Remotion bundle and the pipeline import it.

import type { KineticData } from "./components/kinetic/choose.ts";
import type { DiagramData } from "./components/diagram/choose.ts";
import type { DocScene } from "./components/docs/choose.ts";
import type { ReconTag } from "../assets/recon.ts";

export const FILLER_FAMILIES = [
  "kinetic",
  "diagram",
  "document",
  "objects",
  "silhouettes",
  "recon",
] as const;
export type FillerFamily = (typeof FILLER_FAMILIES)[number];

/** Each family's data, as the component that draws it needs it. Picture fields are indices into assets.images. */
export interface KineticFillerData {
  card: KineticData;
  backdrop?: number;
}
export interface DiagramFillerData {
  diagram: DiagramData;
  backdrop?: number;
}
export interface DocumentFillerData {
  scene: DocScene;
}
export interface SceneFillerData {
  year?: number;
  month?: string;
  variant: number;
  /** A picture of the chapter's game for a disc print or a box cover. */
  picture?: number;
}
export interface ReconFillerData {
  /** Index into assets.clips. */
  clip: number;
  tags: ReconTag[];
  hud: boolean;
  /** The clip's length in seconds: the shot never outruns it at the slowest rate. */
  clipSeconds: number;
  game: string;
  year?: number;
}

/** The decision on one shot-list moment: which family, which registry style, its data, and why. */
export interface MomentFiller {
  family: FillerFamily;
  /** The registry key of the component that draws it ("land", "orgChart", "memo", "Objects/fax", "scope"). */
  style: string;
  data:
    | KineticFillerData
    | DiagramFillerData
    | DocumentFillerData
    | SceneFillerData
    | ReconFillerData;
  confidence: number;
  reason: string;
}

/** A filler shot never runs longer than this: past it the sentence goes back to its chapter's pictures. */
export const FILLER_MAX_SECONDS = 12;
/** Shorter than this and a filler cannot land: the sentence keeps its ordinary shot. */
export const FILLER_MIN_FRAMES = 60;

// The reconstruction's rate (src/assets/recon.ts RECON_RATE and RECON_MIN_RATE, kept equal by a test).
export const RECON_FILL_RATE = 0.85;
export const RECON_FILL_MIN_RATE = 0.75;

/** The slow rate a reconstruction clip plays at to fill a shot of shotFrames. */
export function reconFillRate(
  clipSeconds: number,
  shotFrames: number,
  fps: number,
): number {
  const shot = shotFrames / fps;
  if (!(shot > 0)) return RECON_FILL_RATE;
  const r = Math.max(
    RECON_FILL_MIN_RATE,
    Math.min(RECON_FILL_RATE, clipSeconds / shot),
  );
  return Math.round(r * 1000) / 1000;
}

/** The most frames a filler shot may last: FILLER_MAX_SECONDS, or what a reconstruction clip can fill. */
export function fillerMaxFrames(f: MomentFiller, fps: number): number {
  const most = Math.round(FILLER_MAX_SECONDS * fps);
  if (f.family !== "recon") return most;
  const d = f.data as ReconFillerData;
  return Math.min(
    most,
    Math.floor(((d.clipSeconds || 0) / RECON_FILL_MIN_RATE) * fps) - 2,
  );
}

// Each family's settle frame (the frame its build is complete and the pre-check may look):
// diagrams from their registry (src/render/components/diagram/index.ts DIAGRAMS[].settled), documents from
// docs/layout.ts SETTLED, drawn scenes by DRAWN_BY (the walkout's figure holds to frame 110), the
// reconstruction once its bars and tag are in (reconplan.ts TAG_IN ends at 26). A test keeps these equal.
export const DIAGRAM_SETTLED: Record<string, number> = {
  orgChart: 80,
  timeline: 74,
  split: 92,
  flow: 90,
  beforeAfter: 64,
};
export const DOCUMENT_SETTLED = 98;
export const SCENE_SETTLED = 100;
export const RECON_SETTLED = 40;
/** kinetic/kit.tsx landFrames' pacing when the voice timings are missing (packs/fit.ts DRAWN_BY). */
const KINETIC_DRAWN_BY = 100;

/** The frames each shown kinetic word lands on (src/render/components/kinetic/kit.tsx landFrames). */
export function kineticLandFrames(
  d: KineticData,
  times: number[] | undefined,
  fps: number,
  len: number,
): number[] {
  const last = Math.max(4, len - 24);
  if (!times || times.length !== d.tokens.length) {
    const n = d.shown.length;
    const step = Math.min(14, (KINETIC_DRAWN_BY - 30) / Math.max(1, n));
    return d.shown.map((_, k) => Math.min(last, Math.round(8 + k * step)));
  }
  return d.shown.map((i) =>
    Math.min(last, Math.max(4, Math.round((times[i] ?? 0) * fps) - 1)),
  );
}

/**
 * The frame of a filler shot of `len` frames by which it is fully drawn: its last kinetic word down plus a
 * second, a diagram's or document's build done, a drawn scene's camera in. Never past the shot's last 12 frames.
 */
export function fillerSettle(
  f: MomentFiller,
  len: number,
  fps: number,
  times?: number[],
): number {
  let at: number;
  if (f.family === "kinetic") {
    const d = (f.data as KineticFillerData).card;
    at = Math.max(...kineticLandFrames(d, times, fps, len)) + 30;
  } else if (f.family === "diagram") at = DIAGRAM_SETTLED[f.style] ?? 92;
  else if (f.family === "document") at = DOCUMENT_SETTLED;
  else if (f.family === "recon") at = RECON_SETTLED;
  else at = SCENE_SETTLED;
  return Math.max(0, Math.min(len - 12, at));
}

/** A spoken word with its time in seconds from the start of the narration. */
export type TimedWord = { text: string; start: number; end: number };

/** The narrator's words of a sentence window, in seconds from `origin` (the filler shot's first frame). */
export function shotWords(
  words: TimedWord[],
  start: number,
  end: number,
  origin: number,
): TimedWord[] {
  return words
    .filter((w) => w.start >= start - 0.05 && w.start < end)
    .map((w) => ({
      text: w.text,
      start: w.start - origin,
      end: w.end - origin,
    }));
}

/** The entry sound for a filler (the graphic packs' vocabulary); a reconstruction cuts in silently. */
export function fillerSound(
  f: MomentFiller,
): "pop" | "glint" | "stamp" | undefined {
  if (f.family === "recon") return undefined;
  if (f.family === "kinetic")
    return (
      (
        {
          land: "stamp",
          typeUnderline: "glint",
          highlight: "glint",
        } as Record<string, "stamp" | "glint">
      )[f.style] ?? "pop"
    );
  if (f.family === "diagram") return f.style === "timeline" ? "glint" : "pop";
  if (f.family === "document") return "pop";
  const scene = f.style.split("/")[1] ?? "";
  if (scene === "discs") return "stamp";
  if (["calendar", "clock", "handshake"].includes(scene)) return "glint";
  return "pop";
}

/** The family in plain English, for the owner's notice and the event log. */
export const FAMILY_WORDS: Record<FillerFamily, [string, string]> = {
  kinetic: ["kinetic type card", "kinetic type cards"],
  diagram: ["explainer diagram", "explainer diagrams"],
  document: ["archive document", "archive documents"],
  objects: ["drawn period scene", "drawn period scenes"],
  silhouettes: ["silhouette scene", "silhouette scenes"],
  recon: ["in-game reconstruction", "in-game reconstructions"],
};
