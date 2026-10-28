// Motifs: Xbox. Each entry of MOTIFS is one homage look (./types.ts), one per era of the console's home
// screen (owner, 27 Oct 2026: "Old Xbox 360 topics having like Xbox Blades dashboard style graphics and
// the New Xbox Experience etc."): the 2001 green orb, the 2005 blades, the 2008 carousel and today's
// tiled home. All are built from scratch (./xbox): layout, colour, type and motion, never a logo, icon,
// sound or screenshot of a real menu.
import type { Motif } from "./types.ts";
import { OrbCard, ORB_STYLES } from "./xbox/Orb.tsx";
import { BladesCard, BLADES_STYLES } from "./xbox/Blades.tsx";
import { NxeCard, NXE_STYLES } from "./xbox/Nxe.tsx";
import { ModernCard, MODERN_STYLES } from "./xbox/Modern.tsx";
import { isBladesEra, isModernEra, isNxeEra, isOrbEra } from "./xbox/util.ts";

export const MOTIFS: Motif[] = [
  {
    id: "xbox-orb",
    name: "Original Xbox green orb dashboard (2001-2005)",
    matches: isOrbEra,
    card: OrbCard,
    styles: ORB_STYLES,
  },
  {
    id: "x360-blades",
    name: "Xbox 360 blades dashboard (2005-2008)",
    matches: isBladesEra,
    card: BladesCard,
    styles: BLADES_STYLES,
  },
  {
    id: "x360-nxe",
    name: "Xbox 360 New Xbox Experience carousel (2008-2011)",
    matches: isNxeEra,
    card: NxeCard,
    styles: NXE_STYLES,
  },
  {
    id: "xbox-modern",
    name: "Modern console home screen (2013 on)",
    matches: isModernEra,
    card: ModernCard,
    styles: MODERN_STYLES,
  },
];
