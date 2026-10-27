// The shared contract of the graphic packs (src/render/components/packs): every style of every graphic
// takes the same props, so the renderer can rotate between them and a sentence's facts never change.
import type React from "react";
import type { MomentGraphic } from "../LongMoments.tsx";
import type { BackgroundKind } from "../Backgrounds.tsx";

export type GfxProps = {
  /** The sentence's graphic: every word, figure and name on screen comes from here (or a fixed label). */
  g: MomentGraphic;
  /** Frames the moment lasts; a graphic holds at most what its useStage hold allows, then fades. */
  len: number;
  /** A texture to set it on (src/render/components/Backgrounds.tsx); else the picture behind is dimmed. */
  bg?: BackgroundKind;
  /** Rotates small choices (tilt, colourway) so two of the same style never look identical. */
  variant?: number;
  /** A picture of the sentence's game, when one is on hand. */
  src?: string;
  /** The game's release year, when known: older games may get a period look. */
  year?: number;
  /** Portraits by lower-case name, for people. */
  photos?: Record<string, string>;
};

/** One style: the kind it draws, and whether it can draw this graphic (a bar chart needs numbers). */
export interface GfxStyle {
  kind: MomentGraphic["kind"];
  component: React.FC<GfxProps>;
  fits?: (g: MomentGraphic) => boolean;
  /** Sound on entry: "pop" (a whoosh), "glint" (a tick) or "stamp" (a low hit 34 frames in). */
  sound?: "pop" | "glint" | "stamp";
}
