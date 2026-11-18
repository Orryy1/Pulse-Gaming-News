// The Studio-only steps (STUDIO_PLANS, research of 14 Nov 2026, section 3.12). The YouTube Data API has no field for
// a video's game title (the Gaming category's link to YouTube's game page, Help answer 9076561) and none for Shorts
// series (playlists organised as seasons and episodes): neither the videos resource nor the playlists resource carries
// them (https://developers.google.com/youtube/v3/docs/videos, /docs/playlists, checked 14 Nov 2026). So the factory
// plans them and the Brave Studio routine clicks them, the way the related-video links already work:
//   /routine/gametitle     recent published videos about one game, with the game to pick in Studio;
//   /routine/shortsseries  the series playlists to turn into Shorts series once Studio offers it on the channel.
// Each has a ledger the routine posts to when done (/routine/done?kind=gametitle|shortsseries).

export interface GameTitleRow {
  youtube_video_id: string | null;
  lane: string;
  script_json?: {
    game_title?: string;
    runtime?: string;
    evergreen_format?: string;
    entries?: unknown[];
    youtube?: { title?: string };
    headline?: string;
  } | null;
}

export interface GameTitleItem {
  video: string;
  title: string;
  game: string;
  /** What to type in Studio's "Game title" box (the full name YouTube's list uses). */
  search: string;
}

/** Titles that name a roundup or hardware, not one game (no game page to link). */
const NOT_ONE_GAME =
  /^(gaming|gaming news|this week|new games?|various|multiple|several|free games?|steam|playstation|xbox|nintendo|switch 2|ps5|pc)\b/i;
const SHORT_NAMES: Array<[RegExp, string]> = [
  [/^gta\s*(6|vi)\b/i, "Grand Theft Auto VI"],
  [/^gta\s*(5|v)\b/i, "Grand Theft Auto V"],
  [/^rdr\s*2\b/i, "Red Dead Redemption 2"],
];

/** The game YouTube's list would know it by (pure): short forms written out. */
export function gameSearchName(game: string): string {
  const g = game.replace(/[®™©]/g, "").trim();
  for (const [re, full] of SHORT_NAMES) if (re.test(g)) return full;
  return g;
}

/**
 * The videos whose game title Studio should set (pure): published, about exactly one game (not a ranking of many,
 * not a roundup), not already done, newest first as given.
 */
export function planGameTitles(
  rows: GameTitleRow[],
  done: ReadonlySet<string>,
): GameTitleItem[] {
  return rows.flatMap((r) => {
    const s = r.script_json ?? {};
    const game = (s.game_title ?? "").trim();
    if (
      !r.youtube_video_id ||
      done.has(r.youtube_video_id) ||
      r.lane === "twin"
    )
      return [];
    if (!game || NOT_ONE_GAME.test(game) || (s.entries?.length ?? 0) > 1)
      return [];
    if (
      s.evergreen_format &&
      /radar|recap|climbers|deals|hardest/.test(s.evergreen_format)
    )
      return [];
    return [
      {
        video: r.youtube_video_id,
        title: s.youtube?.title ?? s.headline ?? "",
        game,
        search: gameSearchName(game),
      },
    ];
  });
}

export interface SeriesItem {
  key: string;
  playlist: string;
  series: string;
  season: number;
  note: string;
}

/** The playlists to make Shorts series of (pure), less those done. Only playlists of Shorts alone qualify. */
export function planShortsSeries(
  playlists: { daily: string; why: string },
  done: ReadonlySet<string>,
): SeriesItem[] {
  const all: SeriesItem[] = [
    {
      key: "gta-6-day-by-day",
      playlist: playlists.daily,
      series: "GTA 6 Diaries",
      season: 1,
      note: "One Short a day from launch; episodes in day order.",
    },
    {
      key: "the-why",
      playlist: playlists.why,
      series: "The Why",
      season: 1,
      note: "Numbered Why Shorts; remove any long video from the playlist first (a Shorts series holds Shorts only).",
    },
  ];
  return all.filter((x) => !done.has(x.key));
}
