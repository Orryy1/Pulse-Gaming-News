// The series channel page (format plan, 11 Nov 2026, item 8): a new visitor should see the three series in five
// seconds. One tool applies it through the YouTube API when SERIES_CHANNEL_PAGE is on: the series banner, the
// description (the positioning line, then the three series with their days and times, US first, then the voice
// disclosure and the site), the featured Short for new visitors, the two new series playlists and the shelf order
// (The GTA File, The Why, Buy, Wait or Skip, Gaming Documentaries, Every Game Ranked). It never changes a video.
// Without --apply, or with the flag off, it reads only and prints what it would change. Run by
// src/tools/channel-page.ts through the running factory (only it holds the login).
import type { Config } from "./config.ts";
import { dayKey, localTime } from "./lanes.ts";
import { SERIES_SHELF_DESCRIPTIONS, SERIES_SHELF_TITLES } from "./pipeline.ts";
import type { ChannelSection } from "./youtube/branding.ts";
import { errorMessage } from "./lib/util.ts";

export const CHANNEL_POSITIONING =
  "The why behind the games you love. One straight verdict, every day.";

/** The banner's one line (the plan's wording), drawn by SeriesBanner in src/render/BrandConcepts.tsx. */
export const BANNER_LINE =
  "The Why. The GTA File. Buy, Wait or Skip. New every day.";

/** The series banner, rendered from src/render/BrandConcepts.tsx (SeriesBanner) into brand/final. */
export const SERIES_BANNER_FILE = "youtube-banner-series-2560x1440.png";

/** The shelves top to bottom, as the plan orders them. */
export const SHELF_ORDER: string[] = [
  SERIES_SHELF_TITLES.gtaFile,
  SERIES_SHELF_TITLES.why,
  SERIES_SHELF_TITLES.verdict,
  SERIES_SHELF_TITLES.docs,
  SERIES_SHELF_TITLES.rankedLong,
];

const DAY_NAMES: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** "7am ET / 12pm UK" for a London "HH:MM" slot on the given day (pure; US first, as the audience is). */
export function slotLabel(hhmm: string, timeZone: string, now: Date): string {
  const at = localTime(dayKey(now, timeZone), hhmm, timeZone);
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .format(at)
      .replace(":00", "")
      .replace(/\s/g, "")
      .toLowerCase();
  return `${fmt("America/New_York")} ET / ${fmt(timeZone)} UK`;
}

/** "Tuesday, Thursday and Saturday" (pure; British English, no serial comma). */
export function dayList(days: string[]): string {
  const names = days.map((d) => DAY_NAMES[d] ?? d);
  if (names.length === 7) return "every day";
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The channel description (pure): positioning, the three series with days and times, disclosure, site. */
export function channelDescription(
  cfg: Pick<
    Config,
    | "timezone"
    | "whySlots"
    | "seriesVerdictDays"
    | "dealsSlot"
    | "siteUrl"
    | "publicUrl"
  >,
  now: Date,
  gtaFileSlot = process.env.SERIES_GTA_FILE_SLOT || "18:30",
): string {
  const whySlot = cfg.whySlots[0] ?? "12:00";
  const site = cfg.siteUrl || "";
  return [
    CHANNEL_POSITIONING,
    "",
    `The Why: one big question about a game you love, answered in under a minute. Every day, ${slotLabel(whySlot, cfg.timezone, now)}.`,
    `The GTA File: the one GTA VI thing worth knowing today, confirmed facts only. A new numbered part every day, ${slotLabel(gtaFileSlot, cfg.timezone, now)}.`,
    `Buy, Wait or Skip: one game, one price, one straight verdict. ${dayList(cfg.seriesVerdictDays)}, ${slotLabel(cfg.dealsSlot, cfg.timezone, now)}.`,
    "",
    "Narration is an AI-generated synthetic voice, and every Short is checked against its sources. Visuals are official publisher material, credited in every description. Rumours are always labelled and never presented as fact. Prices are in US dollars first, with pounds and euros on screen.",
    ...(site ? ["", site] : []),
  ].join("\n");
}

export interface SectionOp {
  id?: string;
  playlistId: string;
  position: number;
  title: string;
}

/**
 * The shelf moves (pure): each wanted playlist at its place from the top, a shelf already showing it moved rather
 * than doubled, one already in place left alone. Shelves the plan does not name are left where they are, below.
 */
export function planSections(
  existing: ChannelSection[],
  wanted: Array<{ title: string; playlistId: string }>,
): SectionOp[] {
  const ops: SectionOp[] = [];
  wanted.forEach((w, position) => {
    const have = existing.find(
      (s) => s.type === "singlePlaylist" && s.playlists[0] === w.playlistId,
    );
    if (have && have.position === position) return;
    ops.push({
      ...(have ? { id: have.id } : {}),
      playlistId: w.playlistId,
      position,
      title: w.title,
    });
  });
  return ops;
}

/** The YouTube calls the tool makes. Only the write calls change the page, and only with apply. */
export interface ChannelPageYouTube {
  findOrCreatePlaylist(
    title: string,
    description: string,
  ): Promise<{ id: string; created: boolean }>;
  /** Read-only: the playlist id with this title, or undefined (dry runs never create one). */
  findPlaylist(title: string): Promise<string | undefined>;
  listSections(): Promise<ChannelSection[]>;
  putSection(op: SectionOp): Promise<void>;
  setText(o: { description?: string; trailer?: string }): Promise<void>;
  setBanner(file: string): Promise<void>;
}

export interface ChannelPageReport {
  apply: boolean;
  enabled: boolean;
  description: string;
  banner: string | null;
  featured: string | null;
  playlists: Array<{ title: string; id: string | null; created: boolean }>;
  sections: SectionOp[];
  applied: string[];
  errors: string[];
}

/** One pass. With apply off (or SERIES_CHANNEL_PAGE off) it reads and reports; nothing on the page changes. */
export async function channelPage(o: {
  cfg: Pick<
    Config,
    | "timezone"
    | "whySlots"
    | "seriesVerdictDays"
    | "dealsSlot"
    | "siteUrl"
    | "publicUrl"
    | "seriesChannelPage"
    | "seriesFeaturedVideo"
  >;
  now: Date;
  yt: ChannelPageYouTube;
  apply: boolean;
  bannerFile: string | null;
  held?: boolean;
}): Promise<ChannelPageReport> {
  const { cfg, yt } = o;
  const write = o.apply && cfg.seriesChannelPage && !o.held;
  const report: ChannelPageReport = {
    apply: write,
    enabled: cfg.seriesChannelPage,
    description: channelDescription(cfg, o.now),
    banner: o.bannerFile,
    featured: cfg.seriesFeaturedVideo || null,
    playlists: [],
    sections: [],
    applied: [],
    errors: [],
  };
  if (o.apply && !cfg.seriesChannelPage)
    report.errors.push("SERIES_CHANNEL_PAGE is off: nothing applied");
  if (o.apply && o.held)
    report.errors.push("the owner's publishing hold is on: nothing applied");
  try {
    for (const title of SHELF_ORDER) {
      if (write) {
        const made = await yt.findOrCreatePlaylist(
          title,
          SERIES_SHELF_DESCRIPTIONS[title] ?? "",
        );
        report.playlists.push({ title, id: made.id, created: made.created });
      } else
        report.playlists.push({
          title,
          id: (await yt.findPlaylist(title)) ?? null,
          created: false,
        });
    }
    const known = report.playlists.filter(
      (p): p is { title: string; id: string; created: boolean } => !!p.id,
    );
    report.sections = planSections(
      await yt.listSections(),
      known.map((p) => ({ title: p.title, playlistId: p.id })),
    );
  } catch (err) {
    report.errors.push(errorMessage(err));
    return report;
  }
  if (!write) return report;
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      report.applied.push(name);
    } catch (err) {
      report.errors.push(`${name}: ${errorMessage(err)}`);
    }
  };
  if (o.bannerFile) await step("banner", () => yt.setBanner(o.bannerFile!));
  await step("description", () =>
    yt.setText({
      description: report.description,
      ...(cfg.seriesFeaturedVideo ? { trailer: cfg.seriesFeaturedVideo } : {}),
    }),
  );
  for (const op of report.sections)
    await step(`shelf ${op.position + 1}: ${op.title}`, () =>
      yt.putSection(op),
    );
  return report;
}
