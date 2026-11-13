// Simulcast prep (owner's brief, 12 Nov 2026): the owner may stream to Pulse Gaming's YouTube channel as well as
// Twitch, so the archived streams add public watch hours toward the Partner Programme. Pulse never starts, schedules
// or changes a broadcast and never touches channel settings: this file only writes text (a title and description for
// the day, chapters from the VOD index after the stream) and asks YouTube, read only, whether live streaming is on.

import type { VodIndex } from "../vodindex/schema.ts";

export interface Chapter {
  at: number;
  title: string;
}

/** "1:02:03" or "4:05" (pure). */
export function stamp(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const tidy = (s: string) =>
  s
    .replace(/[–—]/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
    .slice(0, 48)
    .replace(/[\s,;:.-]+$/, "");

/**
 * Chapters from a stream's index (pure): a new chapter where the place on screen changes, at least minGap seconds
 * after the last one, named after the place. YouTube shows chapters only when there are three or more, the first at
 * 0:00 and each at least 10 seconds long, so fewer than three gives none.
 */
export function chaptersFromIndex(
  index: Pick<VodIndex, "shots" | "duration">,
  minGap = 600,
): Chapter[] {
  const out: Chapter[] = [{ at: 0, title: "Stream starts" }];
  let where = "";
  for (const s of index.shots) {
    const place = tidy(s.where || s.tags[0] || "");
    if (!place || place.toLowerCase() === where.toLowerCase()) continue;
    where = place;
    const last = out[out.length - 1]!;
    if (s.start - last.at < minGap || index.duration - s.start < 60) continue;
    if (out.some((c) => c.title.toLowerCase() === place.toLowerCase()))
      out.push({ at: s.start, title: `Back to ${place}` });
    else out.push({ at: s.start, title: place });
  }
  return out.length >= 3 ? out : [];
}

/** The stream's YouTube title for a day (pure): under 100 characters, game first, no spoilers, no em dashes. */
export function streamTitle(o: {
  game: string;
  day: number;
  /** What today is about, in the owner's words ("escaping 5 stars on foot"); optional. */
  plan?: string;
}): string {
  const short = /grand theft auto vi\b/i.test(o.game) ? "GTA 6" : o.game;
  const plan = o.plan ? tidy(o.plan) : "First Playthrough";
  return `${short} LIVE Day ${o.day}: ${plan}`.slice(0, 99);
}

/** The stream's description (pure): keywords first, what to expect, the chapters once the stream is over. */
export function streamDescription(o: {
  game: string;
  day: number;
  date: string;
  chapters?: Chapter[];
  twitch?: string;
}): string {
  const short = /grand theft auto vi\b/i.test(o.game) ? "GTA 6" : o.game;
  const lines = [
    `${short} live gameplay, day ${o.day} (${o.date}): ${o.game} played live and unedited.`,
    "",
    "Pulse Gaming streams the game as it is played: the open world, the chases, the tests people ask about. The best moments become Shorts on this channel the same day.",
    "",
    "Heads up: the stream shows the story as it happens. Titles and Shorts never spoil it; the live stream itself can.",
  ];
  if (o.twitch)
    lines.push("", `Also live on Twitch: https://www.twitch.tv/${o.twitch}`);
  if (o.chapters?.length)
    lines.push(
      "",
      "Chapters",
      ...o.chapters.map((c) => `${stamp(c.at)} ${c.title}`),
    );
  lines.push(
    "",
    `#${short.replace(/\s+/g, "")} #${o.game.replace(/[^A-Za-z0-9]/g, "")} #GTAVI`,
  );
  return lines.join("\n");
}

export interface LiveEligibility {
  checkedAt: string;
  channel?: {
    id: string;
    title: string;
    subscribers?: number;
    madeForKids?: boolean;
    longUploads?: string;
  };
  /** true: live streaming is switched on; false: YouTube said it is not; undefined: could not tell (see note). */
  liveEnabled?: boolean;
  broadcasts?: number;
  streams?: number;
  note: string;
}

type Fetch = typeof fetch;

/**
 * Asks YouTube, read only, whether the channel the token belongs to can stream live (pure apart from the requests):
 * channels.list for the channel, then liveBroadcasts.list and liveStreams.list with mine=true. A 200 answer means live
 * streaming is enabled; 403 liveStreamingNotEnabled means it is not. Each call is 1 quota unit. Stream keys are never
 * asked for (no cdn part) and nothing is created or changed.
 */
export async function liveEligibility(
  token: string,
  fetchFn: Fetch = fetch,
  now = new Date(),
): Promise<LiveEligibility> {
  const get = async (p: string) => {
    const r = await fetchFn(`https://www.googleapis.com/youtube/v3/${p}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await r.json().catch(() => ({}))) as {
      items?: Array<Record<string, any>>;
      pageInfo?: { totalResults?: number };
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    return { status: r.status, body };
  };
  const out: LiveEligibility = { checkedAt: now.toISOString(), note: "" };
  const ch = await get("channels?part=snippet,status,statistics&mine=true");
  const c = ch.body.items?.[0];
  if (c)
    out.channel = {
      id: c.id,
      title: c.snippet?.title,
      subscribers: c.statistics?.hiddenSubscriberCount
        ? undefined
        : Number(c.statistics?.subscriberCount),
      madeForKids: c.status?.madeForKids,
      longUploads: c.status?.longUploadsStatus,
    };
  const b = await get(
    "liveBroadcasts?part=id,status&mine=true&broadcastType=all&maxResults=5",
  );
  const reasons = (x: typeof b) =>
    (x.body.error?.errors ?? []).map((e) => e.reason ?? "");
  if (b.status === 200) {
    out.liveEnabled = true;
    out.broadcasts = b.body.items?.length ?? 0;
    const s = await get("liveStreams?part=id,status&mine=true&maxResults=5");
    if (s.status === 200) out.streams = s.body.items?.length ?? 0;
    out.note = "Live streaming is enabled on this channel.";
  } else if (reasons(b).includes("liveStreamingNotEnabled")) {
    out.liveEnabled = false;
    out.note =
      "Live streaming is not enabled yet. Turn it on in YouTube Studio (Create > Go live); the first time can take up to 24 hours.";
  } else {
    out.note = `YouTube did not say (HTTP ${b.status}${reasons(b).length ? `: ${reasons(b).join(", ")}` : ""}${b.body.error?.message ? `, ${b.body.error.message}` : ""}).`;
  }
  return out;
}
