// Every motif (./types.ts), most specific first: a series beats a console, a console beats a genre.
import { MOTIFS as FRANCHISES } from "./Franchises.tsx";
import { MOTIFS as SERIES } from "./Series.tsx";
import { MOTIFS as XBOX } from "./Xbox.tsx";
import { MOTIFS as PLAY_NINTENDO } from "./PlayNintendo.tsx";
import { MOTIFS as GENRES } from "./Genres.tsx";
import type { Motif, MotifGame } from "./types.ts";

export const ALL_MOTIFS: Motif[] = [...FRANCHISES, ...SERIES, ...XBOX, ...PLAY_NINTENDO, ...GENRES];

/** The motifs that suit a game, most specific first. */
export function motifsFor(game: MotifGame): Motif[] {
  return ALL_MOTIFS.filter((m) => {
    try {
      return m.matches(game);
    } catch {
      return false;
    }
  });
}
