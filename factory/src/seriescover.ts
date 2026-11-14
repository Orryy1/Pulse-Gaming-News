// Which series a Short belongs to, for its cover strip (format plan, 11 Nov 2026, item 5) and its playlist (item 8).
// The series tag itself is written on the script by the series build (items 1-4: `series`, one of "why", "gta_file",
// "verdict", "news_control"); this file only reads it. A Short written before the tag existed still finds its
// series from what it is: a Why topic, or a Buy, Wait or Skip verdict. The control arm has no strip: it is the
// unchanged format on purpose.
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { Episode } from "./episodes.ts";
import type { Script } from "./editorial/schema.ts";
import type { SeriesCover } from "./render/seriesstrip.ts";

export const SERIES_TAGS = [
  "why",
  "gta_file",
  "verdict",
  "news_control",
] as const;
export type SeriesTag = (typeof SERIES_TAGS)[number];

/** The strip's words per series. The control arm keeps the current cover. */
export const SERIES_LABELS: Partial<Record<SeriesTag, string>> = {
  why: "THE WHY",
  gta_file: "THE GTA FILE",
  verdict: "BUY, WAIT OR SKIP?",
};

/** The evergreen format the Buy, Wait or Skip writer stamps on its scripts. */
export const VERDICT_FORMAT = "buy_wait_skip";

/** A Short's series tag (pure): the script's own tag first, then what the Short is. */
export function seriesTagOf(
  script: { evergreen_format?: string } | null | undefined,
  storyHash?: string | null,
): SeriesTag | undefined {
  const tag = (script as { series?: unknown } | null | undefined)?.series;
  if (
    typeof tag === "string" &&
    (SERIES_TAGS as readonly string[]).includes(tag)
  )
    return tag as SeriesTag;
  if (script?.evergreen_format === VERDICT_FORMAT) return "verdict";
  if (storyHash?.startsWith("why:")) return "why";
  return undefined;
}

/**
 * The cover strip for a Short (pure), or nothing: SERIES_COVER_STYLE off, no series, or the control arm. The part
 * number shows only with SERIES_EPISODE_NUMBERS on and a count to show; the price only on a verdict.
 */
export function seriesCoverFor(
  cfg: Pick<Config, "seriesCoverStyle" | "seriesEpisodeNumbers">,
  tag: SeriesTag | undefined,
  opts: { number?: number; price?: string } = {},
): SeriesCover | undefined {
  if (cfg.seriesCoverStyle !== "strip" || !tag) return undefined;
  const label = SERIES_LABELS[tag];
  if (!label) return undefined;
  const number =
    cfg.seriesEpisodeNumbers &&
    typeof opts.number === "number" &&
    Number.isInteger(opts.number) &&
    opts.number > 0
      ? opts.number
      : undefined;
  const price = tag === "verdict" ? opts.price?.trim() || undefined : undefined;
  return {
    label,
    ...(number ? { number } : {}),
    ...(price ? { price } : {}),
  };
}

/** The SQL test for "this episode is in the series", matching seriesTagOf's fallbacks. */
function seriesWhere(tag: SeriesTag): string {
  const own = `script_json->>'series' = $1`;
  if (tag === "why") return `(${own} OR story_hash LIKE 'why:%')`;
  if (tag === "verdict")
    return `(${own} OR script_json->>'evergreen_format' = '${VERDICT_FORMAT}')`;
  return own;
}

/**
 * This Short's part number: one more than the series' Shorts that already went out (uploaded or published, not a
 * dry run, not a twin), counted from before this one was made. A Short that failed never took a number.
 */
export async function seriesEpisodeNumber(
  db: Db,
  tag: SeriesTag,
  episodeId: string,
): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes
      WHERE ${seriesWhere(tag)} AND id <> $2 AND lane <> 'twin'
        AND status IN ('uploading','uploaded','published') AND youtube_status IS DISTINCT FROM 'dry_run'
        AND created_at < COALESCE((SELECT created_at FROM episodes WHERE id = $2), now())`,
    [tag, episodeId],
  );
  return Number(row?.n ?? 0) + 1;
}

/** A verdict's price for the strip (pure): the price card's figure, dollars first, as the writer's grounding set it. */
export function coverPrice(script: Pick<Script, "beats">): string | undefined {
  return script.beats.find((b) => b.visual.kind === "price")?.visual.primary?.trim() || undefined;
}

/** The strip for an episode about to render: its series, the part number when numbering is on, a verdict's price. */
export async function seriesCoverOf(
  db: Db,
  cfg: Pick<Config, "seriesCoverStyle" | "seriesEpisodeNumbers">,
  ep: Pick<Episode, "id" | "story_hash"> & { story_json?: Episode["story_json"] | null },
  script: Script,
): Promise<SeriesCover | undefined> {
  if (cfg.seriesCoverStyle !== "strip") return undefined;
  const tag = seriesTagOf(script, ep.story_hash);
  if (!tag || !SERIES_LABELS[tag]) return undefined;
  // A GTA File part and a numbered Why already carry the number their title says ("GTA VI File #7", "The Why #3"):
  // the strip shows the same one. Only a Short without its own number is counted.
  const own = tag === "gta_file" ? ep.story_json?.gtaFile?.part : tag === "why" ? ep.story_json?.why?.serial?.number : undefined;
  const number = cfg.seriesEpisodeNumbers
    ? own ?? (await seriesEpisodeNumber(db, tag, ep.id).catch(() => undefined))
    : undefined;
  return seriesCoverFor(cfg, tag, { number, price: coverPrice(script) });
}
