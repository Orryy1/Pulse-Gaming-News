// Search Shorts counted on their own (SEARCH_SHORTS): apart from the lane so the news cap (src/cadence.ts) can read it
// without importing the lane.

import type { Db } from "../db.ts";

/** Search Shorts started today (owner's day): they sit outside the news cap and the daily target. */
export async function searchMadeToday(
  db: Db,
  timeZone: string,
): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes
      WHERE created_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
        AND status NOT IN ('failed','rejected') AND story_json ? 'search'`,
    [timeZone],
  );
  return Number(row?.n ?? 0);
}
