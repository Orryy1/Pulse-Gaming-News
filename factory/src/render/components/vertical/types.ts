// The Shorts' graphic suite (owner, 28 Oct 2026: the channel-wide pass). A vertical style draws a beat's
// fact inside the fact-card box of the 1080x1920 Short (952 wide, 500 tall, its top-left at x 64, y 380),
// clear of the captions, the shelf and the Shorts interface; the Short places it there. A "full" style
// (the Pulse universe's devices, 31 Oct 2026) draws over the hero and shelf bands (VFULL) instead, the shelf
// stepping back while it holds, and never over the captions.
import type React from "react";

export const VBOX = { left: 64, top: 380, width: 952, height: 500 } as const;
/** The full-width area a "full" style draws in: the hero and shelf bands, above the captions (y 1180). */
export const VFULL = { left: 0, top: 360, width: 1080, height: 810 } as const;

export type VGfxProps = {
  /** The beat's fact: every word and figure on screen comes from here or a fixed generic label. */
  v: {
    kind: string;
    primary: string;
    secondary: string;
    items: string[];
    /** timeline and countdown: the beat's ISO date. */
    date_to?: string;
    /** price: the region or platform. */
    region?: string;
  };
  /** Frames the beat lasts; build within about 12 frames (a Short moves fast), exit over the last 10. */
  len: number;
  /** The Short's accent colour (amber, or the rumour/story colour). */
  accent: string;
  variant?: number;
  /** A picture of the story's game, when one is on hand. */
  src?: string;
  /** The game's release year, when known. */
  year?: number;
  /** The year the story itself is from (the year it names, else the year the Short is made): the era looks. */
  storyYear?: number;
};

export interface VStyle {
  /** The beat visual kind it draws (src/editorial/schema.ts VISUAL_KINDS). */
  kind: string;
  component: React.FC<VGfxProps>;
  /** Whether it can draw this beat; `storyYear` is the year the story is from, for the era looks. */
  fits?: (v: VGfxProps["v"], ctx?: { storyYear?: number }) => boolean;
  /** "box" (the default): inside VBOX. "full": over VFULL. */
  frame?: "box" | "full";
}
