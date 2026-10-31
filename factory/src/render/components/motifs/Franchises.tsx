// Motifs: Franchises. Each entry of MOTIFS is one homage look (./types.ts), built in ./franchises:
// Grand Theft Auto's box-art grid, Red Dead Redemption's frontier poster, Fallout's phosphor terminal
// and the Souls games' announcement band.
import type { Motif } from "./types.ts";
import { GTA } from "./franchises/Gta.tsx";
import { RED_DEAD } from "./franchises/RedDead.tsx";
import { FALLOUT } from "./franchises/Fallout.tsx";
import { SOULS } from "./franchises/Souls.tsx";

export const MOTIFS: Motif[] = [GTA, RED_DEAD, FALLOUT, SOULS];
