// Motifs: looks that belong to one game, series, console or genre (owner, 27 Oct 2026: "iconic things
// related to each topic ... like the classic GTA squares box art style ... xbox blades dashboards ...
// playstation and Nintendo based graphics"). A motif is an homage built from scratch: its layout, colour,
// type and motion, never a real logo, icon, font file or screenshot of a real menu.
import type React from "react";
import type { GfxStyle } from "../packs/types.ts";

/** What a motif knows about the game a moment is about. */
export type MotifGame = {
  /** The game's title as the video names it ("Grand Theft Auto: San Andreas"). */
  title: string;
  /** Its platforms as listed ("PS2, Xbox, PC"), or empty. */
  platforms: string;
  year?: number;
  /** The video's theme or franchise ("Grand Theft Auto", "Xbox 360"). */
  theme?: string;
};

/** A title card or chapter breather in the motif's look. Every word shown comes from these props. */
export type MotifCardProps = {
  /** The chapter's title, or the video's title on its opening card. */
  heading: string;
  /** A short line above it: "CHAPTER 3", "DOCUMENTARY", "RANKED". */
  kicker?: string;
  /** The game's title, when the card is about one game. */
  game?: string;
  year?: string;
  /** Wide pictures of the game or story (0-6), to fill panels, tiles or screens. */
  pictures: string[];
  /** Frames the card lasts (a chapter breather is about 120). */
  frames: number;
  variant?: number;
};

export interface Motif {
  id: string;
  /** Plain-English name for logs and previews. */
  name: string;
  /** Does this motif suit the game? Match on title, series, platform and era. */
  matches: (game: MotifGame) => boolean;
  /** The title card / chapter breather in this look. */
  card?: React.FC<MotifCardProps>;
  /** Graphic styles in this look (src/render/components/packs/types.ts), for sentences about a matching game. */
  styles?: Record<string, GfxStyle>;
}
