// Every vertical style by name ("Numbers/Mask", "Pulse/Phone"), for the Shorts' fact cards.
import { STYLES as NUMBERS } from "./VNumbers.tsx";
import { STYLES as WORDS } from "./VWords.tsx";
import { STYLES as PULSE } from "./VPulse.tsx";
import type { VStyle } from "./types.ts";

const tag = (pack: string, styles: Record<string, VStyle>) =>
  Object.fromEntries(Object.entries(styles).map(([k, v]) => [`${pack}/${k}`, v]));

/** The Numbers and Words packs: the cards every Short has rotated through since 28 Oct 2026. */
export const V_STYLES_CORE: Record<string, VStyle> = { ...tag("Numbers", NUMBERS), ...tag("Words", WORDS) };
/** The Pulse universe on the Shorts (31 Oct 2026), offered by the craft planner (src/render/shortcraft.ts). */
export const V_STYLES_PULSE: Record<string, VStyle> = tag("Pulse", PULSE);
export const V_STYLES: Record<string, VStyle> = { ...V_STYLES_CORE, ...V_STYLES_PULSE };
