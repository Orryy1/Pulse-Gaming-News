// The few YouTube calls the platform levers make, with the fetch passed in so the tests run without a network. What
// it can never do is part of its shape: it has no call that changes a video's privacy, deletes anything, or starts,
// stops or schedules a broadcast. Writes are a video's snippet (title and description, keeping its category, tags and
// languages) and a playlist's podcast flag (keeping its privacy as it is). Tokens are never logged or returned.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";

export class YtApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reasons: string[],
  ) {
    super(message);
  }
}

export interface Broadcast {
  id: string;
  title: string;
  description: string;
  actualStartTime?: string;
  actualEndTime?: string;
  lifeCycleStatus?: string;
  privacyStatus?: string;
  /** contentDetails.recordFromStart: false means YouTube keeps no archive. */
  recordFromStart?: boolean;
}

export interface VideoInfo {
  id: string;
  title: string;
  description: string;
  categoryId?: string;
  tags?: string[];
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  privacyStatus?: string;
  liveBroadcastContent?: string;
  durationSeconds?: number;
}

export interface PlaylistInfo {
  id: string;
  title: string;
  privacyStatus?: string;
  podcastStatus?: string;
}

/** "PT1H2M3S" in seconds (pure). */
export function isoSeconds(iso: string | undefined): number | undefined {
  const m = String(iso ?? "").match(
    /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/,
  );
  if (!m) return undefined;
  return (
    Number(m[1] ?? 0) * 86400 +
    Number(m[2] ?? 0) * 3600 +
    Number(m[3] ?? 0) * 60 +
    Number(m[4] ?? 0)
  );
}

export class LeverApi {
  constructor(
    private token: () => Promise<string>,
    private fetchFn: FetchLike = fetch,
  ) {}

  private async call(url: string, init: RequestInit = {}): Promise<any> {
    const res = await this.fetchFn(url, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.token()}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const reasons: string[] = (body?.error?.errors ?? []).map(
        (e: { reason?: string }) => String(e.reason ?? ""),
      );
      const what = url.replace(/\?.*$/, "").split("/").slice(-2).join("/");
      throw new YtApiError(
        `${init.method ?? "GET"} ${what}: HTTP ${res.status}${reasons.length ? ` (${reasons.join(", ")})` : ""}${body?.error?.message ? `: ${String(body.error.message).slice(0, 200)}` : ""}`,
        res.status,
        reasons,
      );
    }
    return body;
  }

  private static broadcast(b: any): Broadcast {
    return {
      id: String(b.id),
      title: String(b.snippet?.title ?? ""),
      description: String(b.snippet?.description ?? ""),
      actualStartTime: b.snippet?.actualStartTime,
      actualEndTime: b.snippet?.actualEndTime,
      lifeCycleStatus: b.status?.lifeCycleStatus,
      privacyStatus: b.status?.privacyStatus,
      recordFromStart: b.contentDetails?.recordFromStart,
    };
  }

  /** The channel's broadcasts in one state (liveBroadcasts.list, 1 unit): "active" or "completed". */
  async broadcasts(
    state: "active" | "completed",
    max = 5,
  ): Promise<Broadcast[]> {
    const q = new URLSearchParams({
      part: "id,snippet,status,contentDetails",
      broadcastStatus: state,
      broadcastType: "all",
      maxResults: String(max),
    });
    const body = await this.call(`${API}/liveBroadcasts?${q}`);
    return (body.items ?? []).map(LeverApi.broadcast);
  }

  /** Broadcasts by id (1 unit). */
  async broadcastsById(ids: string[]): Promise<Broadcast[]> {
    if (!ids.length) return [];
    const q = new URLSearchParams({
      part: "id,snippet,status,contentDetails",
      id: ids.slice(0, 50).join(","),
    });
    const body = await this.call(`${API}/liveBroadcasts?${q}`);
    return (body.items ?? []).map(LeverApi.broadcast);
  }

  /** Videos with their snippet, status and length (videos.list, 1 unit per 50). A deleted video is simply absent. */
  async videos(ids: string[]): Promise<VideoInfo[]> {
    const out: VideoInfo[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const q = new URLSearchParams({
        part: "snippet,status,contentDetails",
        id: ids.slice(i, i + 50).join(","),
        maxResults: "50",
      });
      const body = await this.call(`${API}/videos?${q}`);
      for (const v of body.items ?? [])
        out.push({
          id: String(v.id),
          title: String(v.snippet?.title ?? ""),
          description: String(v.snippet?.description ?? ""),
          categoryId: v.snippet?.categoryId,
          tags: v.snippet?.tags,
          defaultLanguage: v.snippet?.defaultLanguage,
          defaultAudioLanguage: v.snippet?.defaultAudioLanguage,
          privacyStatus: v.status?.privacyStatus,
          liveBroadcastContent: v.snippet?.liveBroadcastContent,
          durationSeconds: isoSeconds(v.contentDetails?.duration),
        });
    }
    return out;
  }

  /**
   * Sets a video's title and description (videos.update with the snippet part only, 50 units), keeping its category,
   * tags and languages as read. The status part is never sent, so privacy and the synthetic-media flag are untouched.
   */
  async setSnippet(
    v: VideoInfo,
    title: string,
    description: string,
  ): Promise<void> {
    await this.call(`${API}/videos?part=snippet`, {
      method: "PUT",
      body: JSON.stringify({
        id: v.id,
        snippet: {
          title: title.slice(0, 100),
          description: description.replace(/[<>]/g, "").slice(0, 4900),
          categoryId: v.categoryId || "20",
          ...(v.tags ? { tags: v.tags } : {}),
          ...(v.defaultLanguage ? { defaultLanguage: v.defaultLanguage } : {}),
          ...(v.defaultAudioLanguage
            ? { defaultAudioLanguage: v.defaultAudioLanguage }
            : {}),
        },
      }),
    });
  }

  /** The channel's playlists (playlists.list, 1 unit per 50). */
  async playlists(): Promise<PlaylistInfo[]> {
    const out: PlaylistInfo[] = [];
    let page = "";
    do {
      const q = new URLSearchParams({
        part: "snippet,status",
        mine: "true",
        maxResults: "50",
        ...(page ? { pageToken: page } : {}),
      });
      const body = await this.call(`${API}/playlists?${q}`);
      for (const p of body.items ?? [])
        out.push({
          id: String(p.id),
          title: String(p.snippet?.title ?? ""),
          privacyStatus: p.status?.privacyStatus,
          podcastStatus: p.status?.podcastStatus,
        });
      page = body.nextPageToken ?? "";
    } while (page);
    return out;
  }

  /**
   * Marks a playlist as a podcast (playlists.update with the status part, 50 units): status.podcastStatus "enabled",
   * with the playlist's own privacy sent back unchanged (the status part needs it). YouTube refuses it for a playlist
   * without a playlist image.
   */
  async enablePodcast(p: PlaylistInfo): Promise<void> {
    if (!p.privacyStatus)
      throw new Error(`playlist ${p.id}: privacy unknown, not sent`);
    await this.call(`${API}/playlists?part=status`, {
      method: "PUT",
      body: JSON.stringify({
        id: p.id,
        status: { privacyStatus: p.privacyStatus, podcastStatus: "enabled" },
      }),
    });
  }

  /** The channel's subscriber count (channels.list, 1 unit). */
  async subscribers(): Promise<number | undefined> {
    const body = await this.call(`${API}/channels?part=statistics&mine=true`);
    const s = body.items?.[0]?.statistics;
    return s && !s.hiddenSubscriberCount
      ? Number(s.subscriberCount)
      : undefined;
  }

  /** A YouTube Analytics report (needs yt-analytics.readonly; its own quota, apart from the Data API's). */
  async report(
    params: Record<string, string>,
  ): Promise<{ headers: string[]; rows: Array<Array<string | number>> }> {
    const q = new URLSearchParams({ ids: "channel==MINE", ...params });
    const body = await this.call(`${ANALYTICS}?${q}`);
    return {
      headers: (body.columnHeaders ?? []).map((h: { name?: string }) =>
        String(h.name ?? ""),
      ),
      rows: body.rows ?? [],
    };
  }
}
