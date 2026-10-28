// Every vertical style by name ("Numbers/Mask"), for the Shorts' fact cards.
import { STYLES as NUMBERS } from "./VNumbers.tsx";
import { STYLES as WORDS } from "./VWords.tsx";
import type { VStyle } from "./types.ts";

const tag = (pack: string, styles: Record<string, VStyle>) =>
  Object.fromEntries(Object.entries(styles).map(([k, v]) => [`${pack}/${k}`, v]));

export const V_STYLES: Record<string, VStyle> = { ...tag("Numbers", NUMBERS), ...tag("Words", WORDS) };
