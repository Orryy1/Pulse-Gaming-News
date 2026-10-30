// Every graphic style from every pack, by name ("Data/Bars"): the renderer rotates between the styles
// that fit a graphic, and the PulseGfx composition previews any one of them.
import { STYLES as DATA } from "./GfxData.tsx";
import { STYLES as PAPER } from "./GfxPaper.tsx";
import { STYLES as SCREEN } from "./GfxScreen.tsx";
import { STYLES as GAME } from "./GfxGame.tsx";
import { STYLES as MAP } from "./GfxMap.tsx";
import { STYLES as EDITORIAL } from "./GfxEditorial.tsx";
import { STYLES as TYPE } from "./GfxType.tsx";
// The Pulse universe (owner, 30 Oct 2026): consoles, social and mail, phone apps, press and shops, every one
// a Pulse-branded homage of its era.
import { STYLES as PULSE_CONSOLES } from "./pulse/consoles.ts";
import { STYLES as PULSE_SOCIAL } from "./pulse/social.ts";
import { STYLES as PULSE_APPS } from "./pulse/apps.ts";
import { STYLES as PULSE_PRESS } from "./pulse/press.ts";
import type { GfxStyle } from "./types.ts";

const tag = (pack: string, styles: Record<string, GfxStyle>) =>
  Object.fromEntries(
    Object.entries(styles).map(([k, v]) => [`${pack}/${k}`, v]),
  );

export const ALL_STYLES: Record<string, GfxStyle> = {
  ...tag("Data", DATA),
  ...tag("Paper", PAPER),
  ...tag("Screen", SCREEN),
  ...tag("Game", GAME),
  ...tag("Map", MAP),
  ...tag("Editorial", EDITORIAL),
  ...tag("Type", TYPE),
  ...tag("Pulse", {
    ...PULSE_CONSOLES,
    ...PULSE_SOCIAL,
    ...PULSE_APPS,
    ...PULSE_PRESS,
  }),
};
