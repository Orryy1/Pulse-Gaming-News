// The long video a story Short points to (owner, 1 Nov 2026): 772 long-video views in October matched the watch
// time of 18,000 Shorts views, so a Why Short about a game we have a documentary or a ranking on sends the
// viewer there, in its last line and its pinned comment. "The same game" is the same franchise ("Grand Theft
// Auto: San Andreas" finds "Why GTA 6 Had to Go Back to Vice City", game "Grand Theft Auto"); a documentary
// beats a ranking, the newest wins, and only a video already public counts. With none, the Short points to
// the daily series instead.

import type { Db } from "../db.ts";
import {
  franchiseWords,
  sameFranchise,
  type WhyFollow,
} from "../editorial/why.ts";

export interface LongRow {
  video_id: string;
  title: string | null;
  game: string | null;
  format: string | null;
}

/** The best long video for a game among published ones (newest first): a documentary, else a ranking. */
export function pickLong(game: string, rows: LongRow[]): WhyFollow | undefined {
  const same = rows.filter(
    (r) => r.title && r.game && sameFranchise(r.game, game),
  );
  const doc = same.find((r) => r.format === "documentary");
  const pick = doc ?? same[0];
  if (!pick) return undefined;
  return {
    kind: pick.format === "documentary" ? "documentary" : "ranking",
    title: pick.title!,
    videoId: pick.video_id,
    franchise: spokenFranchise(pick.game!),
  };
}

/** The franchise the way people say it: "Grand Theft Auto" is "GTA"; otherwise its title words, capitalised as written. */
export function spokenFranchise(game: string): string {
  const words = franchiseWords(game);
  if (words === "grand theft auto") return "GTA";
  if (words === "call of duty") return "Call of Duty";
  const cut = game.replace(/(:| - |\().*$/, "").trim();
  return cut.replace(/\s+([IVX]+|\d+)$/, "") || game;
}

/** Published long videos (documentaries and rankings) whose publish time has passed, newest first. */
export async function publicLongVideos(db: Db, now: Date): Promise<LongRow[]> {
  return db.query<LongRow>(
    `SELECT youtube_video_id AS video_id,
            script_json->'youtube'->>'title' AS title,
            script_json->>'game_title' AS game,
            script_json->>'evergreen_format' AS format
       FROM episodes
      WHERE status = 'published'
        AND youtube_video_id IS NOT NULL
        AND script_json->>'runtime' = 'long'
        AND script_json->'recap' IS NULL
        AND lane <> 'twin'
        AND (publish_at IS NULL OR publish_at <= $1::timestamptz)
      ORDER BY COALESCE(publish_at, updated_at) DESC
      LIMIT 60`,
    [now],
  );
}

/** What a Why Short about `game` points to: our long video on it, or the series. */
export async function followFor(
  db: Db,
  game: string,
  now: Date,
): Promise<WhyFollow> {
  return pickLong(game, await publicLongVideos(db, now)) ?? { kind: "series" };
}
