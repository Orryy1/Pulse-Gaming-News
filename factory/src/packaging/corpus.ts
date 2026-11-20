// The Packaging Lab's study corpus (pure parts; the tools in ./tools read and write the files). Two kinds of row:
//  - study rows: other gaming channels' titles from yt-dlp channel listings and vidIQ outlier searches. Views depend on
//    the channel and on when it was posted, so each title is scored against the median of its own channel's
//    neighbouring uploads (an "outlier score"): patterns only, never a title to copy.
//  - Pulse rows: the channel's own published videos with what happened to them (views at 72 hours, click-through on
//    thumbnail impressions, the share of views that were engaged views).

export type Format = "short" | "long";

export interface StudyRow {
  source: "ytdlp" | "vidiq";
  format: Format;
  channel: string;
  id: string;
  title: string;
  views: number;
  /** Views against the channel's neighbouring uploads, in robust standard deviations, clamped to +-3. */
  z: number;
  thumb?: string;
}

export interface PulseRow {
  id: string;
  videoId: string;
  format: Format;
  lane: string;
  liveAt: string;
  title: string;
  hook: string;
  thumbText?: string;
  game?: string;
  rumour: boolean;
  views72?: number;
  ctr?: number;
  impressions?: number;
  viewedRate?: number;
  avgViewPercent?: number;
}

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0;
};

/**
 * Outlier scores for one channel's uploads, newest first (pure). The newest `skip` are dropped (still growing); each
 * other upload is compared with the median of the `span` uploads either side of it, so a channel's growth over time
 * does not read as a title effect.
 */
export function neighbourScores(
  views: number[],
  span = 10,
  skip = 5,
): Array<number | undefined> {
  const lv = views.map((v) => Math.log10(Math.max(0, v) + 10));
  const usable = lv.slice(skip);
  const mad = median(usable.map((x) => Math.abs(x - median(usable)))) * 1.4826;
  const sd = Math.max(0.12, mad);
  return lv.map((x, i) => {
    if (i < skip) return undefined;
    const lo = Math.max(skip, i - span);
    const hi = Math.min(lv.length - 1, i + span);
    const around: number[] = [];
    for (let k = lo; k <= hi; k++) if (k !== i) around.push(lv[k]!);
    if (around.length < 4) return undefined;
    return Math.max(-3, Math.min(3, (x - median(around)) / sd));
  });
}

/** A yt-dlp flat channel listing (one tab) as study rows (pure). */
export function studyRowsFromListing(
  listing: {
    channel_id?: string;
    id?: string;
    entries?: Array<Record<string, any>>;
  },
  format: Format,
): StudyRow[] {
  const entries = (listing.entries ?? []).filter(
    (e) => e && typeof e.title === "string" && Number.isFinite(e.view_count),
  );
  const z = neighbourScores(entries.map((e) => Number(e.view_count)));
  const channel = String(listing.channel_id ?? listing.id ?? "");
  const out: StudyRow[] = [];
  entries.forEach((e, i) => {
    if (z[i] === undefined) return;
    out.push({
      source: "ytdlp",
      format,
      channel,
      id: String(e.id),
      title: String(e.title),
      views: Number(e.view_count),
      z: z[i]!,
      thumb:
        format === "short"
          ? `https://i.ytimg.com/vi/${e.id}/oardefault.jpg`
          : `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
    });
  });
  return out;
}

/**
 * vidIQ outlier rows (format, video id, title, views, breakout multiple), tab-separated (pure). A breakout multiple is
 * already views against the channel's typical video, so its log is the score, on roughly the same scale.
 */
export function studyRowsFromVidiq(tsv: string): StudyRow[] {
  return tsv
    .split(/\r?\n/)
    .map((l) => l.split("\t"))
    .filter((f) => f.length >= 5 && (f[0] === "short" || f[0] === "long"))
    .map((f) => ({
      source: "vidiq" as const,
      format: f[0] as Format,
      channel: `vidiq:${f[0]}`,
      id: f[1]!,
      title: f[2]!,
      views: Number(f[3]),
      z: Math.max(
        -3,
        Math.min(3, Math.log10(Math.max(0.1, Number(f[4]))) / 0.35),
      ),
      thumb: `https://i.ytimg.com/vi/${f[1]}/hqdefault.jpg`,
    }));
}

/** The factory's /routine/export rows as Pulse rows (pure). Rows without a video id or title are dropped. */
export function pulseRowsFromExport(
  rows: Array<Record<string, any>>,
): PulseRow[] {
  const out: PulseRow[] = [];
  for (const e of rows) {
    const s = e.script_json;
    if (!e.youtube_video_id || !s?.youtube?.title) continue;
    const m = (label: string) =>
      (e.metrics ?? []).find((x: any) => x.label === label);
    const views = m("72h") ?? m("24h");
    const ctr = m("ctr")?.raw;
    const ret = m("retention")?.raw;
    out.push({
      id: e.id,
      videoId: e.youtube_video_id,
      format: s.runtime === "long" ? "long" : "short",
      lane: e.lane ?? "",
      liveAt: e.live_at,
      title: s.youtube.title,
      hook: s.hook ?? "",
      thumbText: s.youtube.thumb_text || undefined,
      game: s.game_title || undefined,
      rumour: s.is_rumour === true,
      views72: views ? Number(views.views) : undefined,
      ctr: ctr && Number(ctr.impressions) > 0 ? Number(ctr.ctr) : undefined,
      impressions: ctr ? Number(ctr.impressions) : undefined,
      viewedRate:
        ret && Number(ret.views) > 0
          ? Number(ret.engagedViews) / Number(ret.views)
          : undefined,
      avgViewPercent: ret ? Number(ret.avgViewPercent) : undefined,
    });
  }
  return out;
}
