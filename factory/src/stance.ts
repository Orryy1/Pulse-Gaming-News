// Rankings with a stance, and one "complete" compilation per series (upgrade queue item 21, from the 11 Nov niche
// research, changes 16, 22 and 26). Three launch-window "every [thing] ranked" videos did 274K to 611K on a channel
// with an 18K median, while anonymous top-10 brands draw 3% to 4% of their subscribers per video. Numbered parts shed
// about half (sequels at 51% and 54% of the first part), while one channel's "complete" compilations did 228K to 4.0M
// against 3K to 15K for its separate episodes (old videos, so a test).
//
// RANKING_STANCE (off by default):
// - a ranking's title argues something (a claim, a why or how, a downfall or comeback), never a "top N", a year or a
//   bare "Every X Ranked"; the writer is sent back once with the reason, as the title-shape rule does;
// - no long video is numbered past Part 2: multi-part ideas ship as complete films;
// - once COMPLETE_CUT_MIN (4 to 6) long films of one series are public, a 60 to 100 minute "complete" cut is proposed
//   to the owner once (the films in release order, trimmed to fit); it activates from the data, not a date.
// Pure functions first; the proposal step reads the database and keeps a small ledger in the data folder.

import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "./db.ts";
import {
  titleAngle,
  titleShapeProblems,
  winningAngle,
} from "./editorial/titleshape.ts";

/** "Every GTA Game Ranked", "GTA Games Ranked": a list's name, not an argument. */
const BARE_RANKED =
  /^(?:every|all(?: the)?|the)?\s*[\w' :.-]{0,40}\b(?:games?|missions?|characters?|entries|cities|maps)\s+ranked$/i;
/** "Part 3", "Pt. 4", "Episode 5" and on. */
const LATE_PART =
  /\b(?:part|pt\.?|episode|ep\.?|chapter)\s*(?:[3-9]|\d{2,}|three|four|five|six|seven|eight|nine|ten|iii|iv|v|vi|vii|viii|ix|x)\b/i;

/** What keeps a ranking's title from taking a stance (pure); empty when it argues something. */
export function stanceProblems(title: string): string[] {
  const t = title.trim();
  const out = [...titleShapeProblems(t)];
  if (BARE_RANKED.test(t))
    out.push(
      `The title "${t}" names the list but takes no side. Say what the ranking argues: "GTA San Andreas Is Still the One to Beat", "Why Vice City Beats Every 3D GTA".`,
    );
  else if (!winningAngle(titleAngle(t)))
    out.push(
      `The title "${t}" does not argue anything. A ranking's title takes a side: a claim about one entry, or a why or how.`,
    );
  out.push(...partProblems(t));
  return out;
}

/** A long video numbered past Part 2 (pure): multi-part ideas ship as complete films. */
export function partProblems(title: string): string[] {
  return LATE_PART.test(title)
    ? [
        `"${title.trim()}" is numbered past Part 2; numbered parts shed about half their viewers. Make it one complete film.`,
      ]
    : [];
}

export interface SeriesFilm {
  videoId: string;
  title: string;
  minutes: number;
  liveAt: string;
}

export interface CompleteCut {
  series: string;
  title: string;
  films: SeriesFilm[];
  minutes: number;
  /** Minutes to trim from the films' own length to land inside 60 to 100. */
  trim: number;
}

export const COMPLETE_MIN_MINUTES = 60;
export const COMPLETE_MAX_MINUTES = 100;

/**
 * The "complete" cut for a series (pure), once at least `min` films are public: every film in release order, its
 * length and how much to trim to land at 100 minutes at most. Undefined below the count or under 60 minutes in all.
 */
export function completeCut(
  series: string,
  films: readonly SeriesFilm[],
  min: number,
): CompleteCut | undefined {
  const list = [...films].sort(
    (a, b) => new Date(a.liveAt).getTime() - new Date(b.liveAt).getTime(),
  );
  if (list.length < min) return undefined;
  const total = Math.round(list.reduce((a, f) => a + f.minutes, 0));
  if (total < COMPLETE_MIN_MINUTES) return undefined;
  return {
    series,
    title: `${series}: The Complete Story`,
    films: list,
    minutes: Math.min(total, COMPLETE_MAX_MINUTES),
    trim: Math.max(0, total - COMPLETE_MAX_MINUTES),
  };
}

/** The series a long video belongs to, from its game title (pure): GTA for now, the strand that has the films. */
export function seriesOf(game: string): string | undefined {
  return /\b(gta|grand theft auto)\b/i.test(game) ? "GTA" : undefined;
}

/**
 * Proposes each series' complete cut to the owner once, when the films exist (reads the database). Off: nothing.
 * Returns the proposals made this time.
 */
export async function proposeCompleteCuts(s: {
  db: Db;
  cfg: { rankingStance: boolean; completeCutMin: number; dataDir: string };
  notify(m: { level: "info"; content: string }): Promise<unknown>;
}): Promise<CompleteCut[]> {
  if (!s.cfg.rankingStance) return [];
  const rows = await s.db.query<{
    video_id: string;
    title: string;
    game: string;
    seconds: string | null;
    live_at: string;
  }>(
    `SELECT youtube_video_id AS video_id, COALESCE(script_json->'youtube'->>'title', story_json->>'headline') AS title,
            script_json->>'game_title' AS game, assets_json->>'durationSeconds' AS seconds,
            COALESCE(publish_at, updated_at)::text AS live_at
       FROM episodes
      WHERE lane = 'longform' AND status = 'published' AND youtube_video_id IS NOT NULL
        AND COALESCE(publish_at, updated_at) <= now()`,
  );
  const ledgerFile = path.join(s.cfg.dataDir, "complete_cuts.json");
  const ledger: string[] = JSON.parse(
    await fs.readFile(ledgerFile, "utf8").catch(() => "[]"),
  );
  const bySeries = new Map<string, SeriesFilm[]>();
  for (const r of rows) {
    const series = seriesOf(r.game ?? "");
    if (!series) continue;
    const list = bySeries.get(series) ?? [];
    list.push({
      videoId: r.video_id,
      title: r.title,
      minutes: Number(r.seconds ?? 0) / 60,
      liveAt: r.live_at,
    });
    bySeries.set(series, list);
  }
  const made: CompleteCut[] = [];
  for (const [series, films] of bySeries) {
    if (ledger.includes(series)) continue;
    const cut = completeCut(series, films, s.cfg.completeCutMin);
    if (!cut) continue;
    made.push(cut);
    ledger.push(series);
    await s
      .notify({
        level: "info",
        content: `${cut.films.length} ${series} films are now public, enough for one "complete" cut: "${cut.title}", about ${cut.minutes} minutes${cut.trim ? ` (${Math.round(cut.trim)} minutes trimmed)` : ""}, from ${cut.films.map((f) => `"${f.title}"`).join(", ")}. Reply "make it" and it is built.`,
      })
      .catch(() => undefined);
  }
  if (made.length)
    await fs.writeFile(ledgerFile, JSON.stringify(ledger, null, 2));
  return made;
}
