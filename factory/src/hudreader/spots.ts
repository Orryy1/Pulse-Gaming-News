// "Every spot so far" (HUD_END_MAP): the GTA 6 Day N series' accumulating map. Each Day N episode's pin is kept here
// (one per day, the latest render wins), and the end map draws them all on the stitched map with today's spot lit,
// a binge hook into the playlist. Stored at <data>/hud/<game>/spots.json; the pure helpers do the merging.

import path from "node:path";
import type { Pin } from "./where.ts";
import { readJson, writeJson } from "./telemetry.ts";

export interface Spot {
  day: number;
  episode: string;
  island: number;
  x: number;
  y: number;
  label?: string;
  /** The recording and second the pin came from. */
  video: string;
  t: number;
  at: string;
}

export interface SpotBook {
  game: string;
  spots: Spot[];
}

export const spotsFile = (dataDir: string, game: string) =>
  path.join(dataDir, "hud", game, "spots.json");

/** The book with this day's spot set (pure): one spot a day, a later render of the same day replaces it. */
export function withSpot(book: SpotBook, spot: Spot): SpotBook {
  const spots = book.spots.filter((s) => s.day !== spot.day);
  spots.push(spot);
  spots.sort((a, b) => a.day - b.day);
  return { ...book, spots };
}

/** A pin as a day's spot (pure). */
export function spotFromPin(
  pin: Pin,
  o: { day: number; episode: string; video: string; at: Date },
): Spot {
  return {
    day: o.day,
    episode: o.episode,
    island: pin.island,
    x: pin.x,
    y: pin.y,
    ...(pin.label ? { label: pin.label } : {}),
    video: o.video,
    t: pin.t,
    at: o.at.toISOString(),
  };
}

/** Island merges move spots too: map positions of an island joined into another (pure). */
export function moveSpots(
  book: SpotBook,
  merges: Array<[number, number, number[][]]>,
): SpotBook {
  let spots = book.spots;
  for (const [src, dst, M] of merges)
    spots = spots.map((s) =>
      s.island === src
        ? {
            ...s,
            island: dst,
            x: Math.round(M[0]![0]! * s.x + M[0]![1]! * s.y + M[0]![2]!),
            y: Math.round(M[1]![0]! * s.x + M[1]![1]! * s.y + M[1]![2]!),
          }
        : s,
    );
  return { ...book, spots };
}

export async function readSpots(
  dataDir: string,
  game: string,
): Promise<SpotBook> {
  return (
    (await readJson<SpotBook>(spotsFile(dataDir, game))) ?? { game, spots: [] }
  );
}

export async function addSpot(
  dataDir: string,
  game: string,
  spot: Spot,
): Promise<SpotBook> {
  const book = withSpot(await readSpots(dataDir, game), spot);
  await writeJson(spotsFile(dataDir, game), book);
  return book;
}
