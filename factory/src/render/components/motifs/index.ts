// Every motif (./types.ts), most specific first: a series beats a console, a console beats a genre.
import { MOTIFS as FRANCHISES } from "./Franchises.tsx";
import { MOTIFS as SERIES } from "./Series.tsx";
import { MOTIFS as XBOX } from "./Xbox.tsx";
import { MOTIFS as PLAY_NINTENDO } from "./PlayNintendo.tsx";
import { MOTIFS as GENRES } from "./Genres.tsx";
import type { Motif, MotifGame } from "./types.ts";

// PlayStation and Nintendo before Xbox: the Xbox file's modern home screen also takes PS4, PS5 and
// Switch 2 games, which should get their own console's look first where one exists.
export const ALL_MOTIFS: Motif[] = [...FRANCHISES, ...SERIES, ...PLAY_NINTENDO, ...XBOX, ...GENRES];

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
