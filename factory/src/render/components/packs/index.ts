// Every graphic style from every pack, by name ("Data/Bars"): the renderer rotates between the styles
// that fit a graphic, and the PulseGfx composition previews any one of them.
import { STYLES as DATA } from "./GfxData.tsx";
import { STYLES as PAPER } from "./GfxPaper.tsx";
import { STYLES as SCREEN } from "./GfxScreen.tsx";
import { STYLES as GAME } from "./GfxGame.tsx";
import { STYLES as MAP } from "./GfxMap.tsx";
import { STYLES as EDITORIAL } from "./GfxEditorial.tsx";
import type { GfxStyle } from "./types.ts";

const tag = (pack: string, styles: Record<string, GfxStyle>) =>
  Object.fromEntries(Object.entries(styles).map(([k, v]) => [`${pack}/${k}`, v]));

export const ALL_STYLES: Record<string, GfxStyle> = {
  ...tag("Data", DATA),
  ...tag("Paper", PAPER),
  ...tag("Screen", SCREEN),
  ...tag("Game", GAME),
  ...tag("Map", MAP),
  ...tag("Editorial", EDITORIAL),
};
