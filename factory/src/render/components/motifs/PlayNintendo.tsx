// Motifs: PlayNintendo. Each entry of MOTIFS is one homage look (./types.ts): a console's own menu rebuilt
// from scratch (layout, colour, type and motion), never a real logo, icon, sound, font or screenshot.
// The looks live in ./playnintendo/; platform reading is in ./playnintendo/shared.tsx.
import type { Motif } from "./types.ts";
import {
  isDualScreen,
  isPs1,
  isPs2,
  isPs3OrPsp,
  isSwitch,
  isWii,
} from "./playnintendo/shared.tsx";
import { PS1_CARD, PS1_STYLES } from "./playnintendo/Ps1.tsx";
import { PS2_CARD, PS2_STYLES } from "./playnintendo/Ps2.tsx";
import { PS3_CARD, PS3_STYLES } from "./playnintendo/Ps3.tsx";
import { WII_CARD, WII_STYLES } from "./playnintendo/Wii.tsx";
import { DS_CARD, DS_STYLES } from "./playnintendo/DualScreen.tsx";
import { SWITCH_CARD, SWITCH_STYLES } from "./playnintendo/Switch.tsx";

export const MOTIFS: Motif[] = [
  {
    // PlayStation (1994-2001): "PS1", "PSX", "PlayStation 1", or a bare "PlayStation" from 2001 or earlier.
    id: "ps1-memory",
    name: "PlayStation memory card manager",
    matches: isPs1,
    card: PS1_CARD,
    styles: PS1_STYLES,
  },
  {
    // PlayStation 2 (2000-2006): "PS2" or "PlayStation 2" in the platforms or the theme.
    id: "ps2-towers",
    name: "PlayStation 2 boot towers",
    matches: isPs2,
    card: PS2_CARD,
    styles: PS2_STYLES,
  },
  {
    // PlayStation 3 and PSP (2005-2013).
    id: "ps3-xmb",
    name: "PlayStation 3 cross media bar",
    matches: isPs3OrPsp,
    card: PS3_CARD,
    styles: PS3_STYLES,
  },
  {
    // Wii (2006-2012), never the Wii U.
    id: "wii-channels",
    name: "Wii channel grid",
    matches: isWii,
    card: WII_CARD,
    styles: WII_STYLES,
  },
  {
    // Nintendo DS, DSi, 3DS and 2DS (2004-2020).
    id: "dual-screen",
    name: "Two-screen handheld",
    matches: isDualScreen,
    card: DS_CARD,
    styles: DS_STYLES,
  },
  {
    // Nintendo Switch (2017 on), and Switch 2.
    id: "switch-home",
    name: "Switch home screen",
    matches: isSwitch,
    card: SWITCH_CARD,
    styles: SWITCH_STYLES,
  },
];
