// Motifs: Series. Each entry of MOTIFS is one homage look (./types.ts): a radio call screen for Metal
// Gear, a briefing dossier for the military shooters, a helmet visor for the sci-fi shooters and space
// epics, and a parchment map for the high-fantasy role-playing series. The looks live in ./series/.
import type { Motif, MotifGame } from "./types.ts";
import { CodecCard, CODEC_STYLES } from "./series/Codec.tsx";
import { MilitaryCard, MILITARY_STYLES } from "./series/Military.tsx";
import { ScifiCard, SCIFI_STYLES } from "./series/Scifi.tsx";
import { FantasyCard, FANTASY_STYLES } from "./series/Fantasy.tsx";
import { named } from "./series/common.ts";

const METAL_GEAR = /metal\s*gear|\bMGS\s?\d?\b|\bMGSV\b/;
const MILITARY =
  /call\s+of\s+duty|\bbattlefield\b|medal\s+of\s+hono(u)?r|rainbow\s+(six|6)\b|ghost\s+recon|splinter\s+cell|\barma\s*(\d|ii|iii|reforger|armed|:|$)|\bmodern\s+warfare\b|\bblack\s+ops\b/i;
const SCIFI =
  /\bhalo\b(?!\s*(effect|of))|^(bungie'?s\s+)?destiny\b(?!\s*child)|\bdestiny\s+2\b|mass\s+effect|\bstarfield\b|dead\s+space|metroid\s+prime|\btitanfall\b/i;
const FANTASY =
  /elder\s+scrolls|\bskyrim\b|\boblivion\b(?!\s+song)|\bmorrowind\b|\bdaggerfall\b|\bwitcher\b|dragon\s+age|baldur.?s\s+gate|\bdiablo\b|world\s+of\s+warcraft|\bwarcraft\b|\bdivinity\b|pillars\s+of\s+eternity/i;
/** Souls games and Elden Ring belong to another motif, even when a title names a fantasy series too. */
const NOT_FANTASY =
  /\bsouls\b|elden\s+ring|bloodborne|sekiro|demon'?s\s+souls/i;

export const MOTIFS: Motif[] = [
  {
    id: "codec",
    name: "Metal Gear radio call",
    matches: (g: MotifGame) =>
      named(METAL_GEAR, g) || named(/metal\s*gear/i, g),
    card: CodecCard,
    styles: CODEC_STYLES,
  },
  {
    id: "military",
    name: "Military shooter briefing dossier",
    matches: (g: MotifGame) => named(MILITARY, g),
    card: MilitaryCard,
    styles: MILITARY_STYLES,
  },
  {
    id: "scifi",
    name: "Sci-fi helmet visor",
    matches: (g: MotifGame) => named(SCIFI, g),
    card: ScifiCard,
    styles: SCIFI_STYLES,
  },
  {
    id: "fantasy",
    name: "Fantasy parchment map",
    matches: (g: MotifGame) => named(FANTASY, g) && !named(NOT_FANTASY, g),
    card: FantasyCard,
    styles: FANTASY_STYLES,
  },
];
