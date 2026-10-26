// YouTube resumable upload with the three properties that matter for an
// unattended publisher:
//  1. the session URI is persisted before any bytes move, so a crash resumes
//     the same upload instead of starting a second one;
//  2. every video carries a private marker tag, so after an ambiguous failure
//     we can find an upload that did complete before trying again;
//  3. hard failures (quota, auth, policy) are surfaced, never retried blindly.

import fs from "node:fs/promises";
import { FatalError } from "../lib/util.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";
const CAPTIONS_UPLOAD = "https://www.googleapis.com/upload/youtube/v3/captions";

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: "public" | "unlisted" | "private";
  publishAt?: string; // ISO; only honoured with privacyStatus private
  containsSyntheticMedia: boolean;
  defaultLanguage: string;
}

export class SessionGone extends Error {}

/** Video bytes being sent to YouTube right now, in this process. */
let uploadsActive = 0;
export const activeUploads = () => uploadsActive;

/** Characters YouTube counts for a tag list: each tag, two quotes for one with a space, a comma between. */
export const tagChars = (tags: string[]) =>
  tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) +
  Math.max(0, tags.length - 1);

export function markerTag(episodeId: string): string {
  return `pulseref${episodeId.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
}

export function buildResource(meta: VideoMetadata, marker: string) {
  const tags = [
    ...new Set([
      ...meta.tags.map((t) => t.replace(/[<>]/g, "").slice(0, 60)),
      marker,
    ]),
  ];
  // YouTube caps the combined tag length at 500 characters, counting the quotes around a tag with a
  // space (tagChars); keep the marker.
  while (tagChars(tags) > 490 && tags.length > 1)
    tags.splice(tags.length - 2, 1);
  return {
    snippet: {
      title: meta.title.replace(/[<>]/g, "").slice(0, 100),
      description: meta.description.replace(/[<>]/g, "").slice(0, 4900),
      tags,
      categoryId: meta.categoryId,
      defaultLanguage: meta.defaultLanguage,
      defaultAudioLanguage: meta.defaultLanguage,
    },
    status: {
      // Scheduling makes a video public at publishAt, so only schedule public uploads.
      privacyStatus:
        meta.publishAt && meta.privacyStatus === "public"
          ? "private"
          : meta.privacyStatus,
      ...(meta.publishAt && meta.privacyStatus === "public"
        ? { publishAt: meta.publishAt }
        : {}),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: meta.containsSyntheticMedia,
      embeddable: true,
    },
  };
}

async function apiError(res: Response, what: string): Promise<Error> {
  const text = await res.text();
  let reason = "";
  try {
    reason = (JSON.parse(text) as any)?.error?.errors?.[0]?.reason ?? "";
  } catch {
    /* not JSON */
  }
  const msg =
    `${what}: HTTP ${res.status} ${reason} ${text.slice(0, 300)}`.trim();
  if (res.status === 401) return new FatalError(msg);
  if (res.status === 403 || res.status === 400) return new FatalError(msg); // quota, scope, policy or bad metadata
  return new Error(msg);
}

export class YouTubeClient {
  constructor(
    private token: () => Promise<string>,
    private fetchFn: FetchLike = fetch,
  ) {}

  private async auth(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.token()}` };
  }

  /** Looks through the channel's most recent uploads for one carrying our marker tag. */
  async findByMarker(marker: string): Promise<string | undefined> {
    const h = await this.auth();
    const ch = await this.fetchFn(
      `${API}/channels?part=contentDetails&mine=true`,
      { headers: h },
    );
    if (!ch.ok) throw await apiError(ch, "channels.list");
    const uploads = ((await ch.json()) as any).items?.[0]?.contentDetails
      ?.relatedPlaylists?.uploads;
    if (!uploads) return undefined;
    const pl = await this.fetchFn(
      `${API}/playlistItems?part=contentDetails&maxResults=25&playlistId=${uploads}`,
      { headers: h },
    );
    if (!pl.ok) throw await apiError(pl, "playlistItems.list");
    const ids: string[] = (((await pl.json()) as any).items ?? [])
      .map((i: any) => i.contentDetails?.videoId)
      .filter(Boolean);
    if (ids.length === 0) return undefined;
    const vids = await this.fetchFn(
      `${API}/videos?part=snippet&id=${ids.join(",")}`,
      { headers: h },
    );
    if (!vids.ok) throw await apiError(vids, "videos.list");
    const hit = (((await vids.json()) as any).items ?? []).find((v: any) =>
      (v.snippet?.tags ?? []).includes(marker),
    );
    return hit?.id;
  }

  async createSession(resource: object, size: number): Promise<string> {
    const res = await this.fetchFn(
      `${UPLOAD}?uploadType=resumable&part=snippet,status`,
      {
        method: "POST",
        headers: {
          ...(await this.auth()),
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-type": "video/mp4",
          "x-upload-content-length": String(size),
        },
        body: JSON.stringify(resource),
      },
    );
    if (!res.ok) throw await apiError(res, "videos.insert (session)");
    const loc = res.headers.get("location");
    if (!loc) throw new Error("videos.insert returned no session URI");
    return loc;
  }

  /** Sends whatever the server is missing. Returns the new video id. */
  async uploadToSession(sessionUri: string, file: string): Promise<string> {
    const data = await fs.readFile(file);
    const size = data.length;
    // Ask the server how much it already has.
    const statusRes = await this.fetchFn(sessionUri, {
      method: "PUT",
      headers: {
        ...(await this.auth()),
        "content-length": "0",
        "content-range": `bytes */${size}`,
      },
    });
    if (statusRes.status === 200 || statusRes.status === 201)
      return this.idFrom(statusRes);
    if (statusRes.status === 404 || statusRes.status === 410)
      throw new SessionGone(
        `upload session expired (HTTP ${statusRes.status})`,
      );
    if (statusRes.status !== 308)
      throw await apiError(statusRes, "upload status");
    const range = statusRes.headers.get("range"); // e.g. "bytes=0-1048575"
    const offset = range ? Number(range.split("-")[1]) + 1 : 0;

    // Counted so a restart waits for the bytes to finish (/health uploads_active): three videos sat at
    // "Processing will begin shortly" after restarts and a dropped connection cut their uploads (26 Oct 2026).
    uploadsActive++;
    const res = await this.fetchFn(sessionUri, {
      method: "PUT",
      headers: {
        ...(await this.auth()),
        "content-type": "video/mp4",
        "content-length": String(size - offset),
        ...(offset > 0
          ? { "content-range": `bytes ${offset}-${size - 1}/${size}` }
          : {}),
      },
      body: data.subarray(offset),
    }).finally(() => {
      uploadsActive--;
    });
    if (res.status === 200 || res.status === 201) return this.idFrom(res);
    if (res.status === 404 || res.status === 410)
      throw new SessionGone(`upload session expired (HTTP ${res.status})`);
    throw await apiError(res, "upload");
  }

  private async idFrom(res: Response): Promise<string> {
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new Error("upload finished but returned no video id");
    return body.id;
  }

  /** The channel's playlist with this title, created public when missing. created says whether it cost an insert (50 units). */
  async findOrCreatePlaylist(
    title: string,
    description: string,
  ): Promise<{ id: string; created: boolean }> {
    const list = await this.fetchFn(
      `${API}/playlists?part=snippet&mine=true&maxResults=50`,
      { headers: await this.auth() },
    );
    if (!list.ok) throw await apiError(list, "playlists.list");
    const found = (((await list.json()) as any).items ?? []).find(
      (p: any) => p.snippet?.title === title,
    );
    if (found?.id) return { id: found.id, created: false };
    const res = await this.fetchFn(`${API}/playlists?part=snippet,status`, {
      method: "POST",
      headers: {
        ...(await this.auth()),
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        snippet: { title, description },
        status: { privacyStatus: "public" },
      }),
    });
    if (!res.ok) throw await apiError(res, "playlists.insert");
    const id = ((await res.json()) as { id?: string }).id;
    if (!id) throw new Error("playlists.insert returned no id");
    return { id, created: true };
  }

  /** Adds a video to a playlist (playlistItems.insert, 50 quota units). */
  async addToPlaylist(playlistId: string, videoId: string): Promise<void> {
    const res = await this.fetchFn(`${API}/playlistItems?part=snippet`, {
      method: "POST",
      headers: {
        ...(await this.auth()),
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
      }),
    });
    if (!res.ok) throw await apiError(res, "playlistItems.insert");
  }

  /** Posts a top-level comment as the channel (commentThreads.insert, 50 quota units). Returns the comment id. */
  async insertComment(videoId: string, text: string): Promise<string> {
    const res = await this.fetchFn(`${API}/commentThreads?part=snippet`, {
      method: "POST",
      headers: {
        ...(await this.auth()),
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        snippet: {
          videoId,
          topLevelComment: { snippet: { textOriginal: text.slice(0, 1000) } },
        },
      }),
    });
    if (!res.ok) throw await apiError(res, "commentThreads.insert");
    const id = ((await res.json()) as { id?: string }).id;
    if (!id) throw new Error("commentThreads.insert returned no id");
    return id;
  }

  /** The newest published top-level comments on a video (commentThreads.list, one quota unit). */
  /** The newest comment threads across every video on a channel (one request, one quota unit). */
  async listChannelComments(channelId: string): Promise<
    Array<{
      id: string;
      videoId: string;
      text: string;
      authorChannelId: string;
      likes: number;
      replies: number;
      publishedAt: string;
    }>
  > {
    const q = new URLSearchParams({
      part: "snippet",
      allThreadsRelatedToChannelId: channelId,
      order: "time",
      maxResults: "50",
      textFormat: "plainText",
    });
    const res = await this.fetchFn(`${API}/commentThreads?${q}`, {
      headers: await this.auth(),
    });
    if (!res.ok) throw await apiError(res, "commentThreads.list (channel)");
    return (((await res.json()) as any).items ?? []).map((t: any) => {
      const c = t.snippet?.topLevelComment?.snippet ?? {};
      return {
        id: String(t.snippet?.topLevelComment?.id ?? t.id),
        videoId: String(t.snippet?.videoId ?? c.videoId ?? ""),
        text: String(c.textOriginal ?? c.textDisplay ?? ""),
        authorChannelId: String(c.authorChannelId?.value ?? ""),
        likes: Number(c.likeCount ?? 0),
        replies: Number(t.snippet?.totalReplyCount ?? 0),
        publishedAt: String(c.publishedAt ?? ""),
      };
    });
  }

  async listComments(videoId: string): Promise<
    Array<{
      id: string;
      text: string;
      authorChannelId: string;
      likes: number;
      replies: number;
      publishedAt: string;
    }>
  > {
    const q = new URLSearchParams({
      part: "snippet",
      videoId,
      order: "time",
      maxResults: "50",
      textFormat: "plainText",
    });
    const res = await this.fetchFn(`${API}/commentThreads?${q}`, {
      headers: await this.auth(),
    });
    if (!res.ok) throw await apiError(res, "commentThreads.list");
    return (((await res.json()) as any).items ?? []).map((t: any) => {
      const c = t.snippet?.topLevelComment?.snippet ?? {};
      return {
        id: String(t.snippet?.topLevelComment?.id ?? t.id),
        text: String(c.textOriginal ?? c.textDisplay ?? ""),
        authorChannelId: String(c.authorChannelId?.value ?? ""),
        likes: Number(c.likeCount ?? 0),
        replies: Number(t.snippet?.totalReplyCount ?? 0),
        publishedAt: String(c.publishedAt ?? ""),
      };
    });
  }

  /** Replies to a comment as the channel (comments.insert, 50 quota units). Returns the reply id. */
  async replyToComment(parentId: string, text: string): Promise<string> {
    const res = await this.fetchFn(`${API}/comments?part=snippet`, {
      method: "POST",
      headers: {
        ...(await this.auth()),
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        snippet: { parentId, textOriginal: text.slice(0, 1000) },
      }),
    });
    if (!res.ok) throw await apiError(res, "comments.insert");
    const id = ((await res.json()) as { id?: string }).id;
    if (!id) throw new Error("comments.insert returned no id");
    return id;
  }

  /** The channel's own id (channels.list, one quota unit), so its own comments are never answered. */
  async myChannelId(): Promise<string> {
    const res = await this.fetchFn(`${API}/channels?part=id&mine=true`, {
      headers: await this.auth(),
    });
    if (!res.ok) throw await apiError(res, "channels.list");
    return String(((await res.json()) as any).items?.[0]?.id ?? "");
  }

  /** Caption tracks already on a video, so a retried confirm step never uploads twice. */
  /** Sets a custom thumbnail (JPEG under 2 MB); needs a phone-verified channel. */
  async setThumbnail(videoId: string, file: string): Promise<void> {
    const body = await fs.readFile(file);
    const res = await this.fetchFn(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`,
      {
        method: "POST",
        headers: {
          ...(await this.auth()),
          "content-type": "image/jpeg",
          "content-length": String(body.length),
        },
        body,
      },
    );
    if (!res.ok) throw await apiError(res, "thumbnails.set");
  }

  async listCaptions(
    videoId: string,
  ): Promise<Array<{ id: string; language: string; name: string }>> {
    const res = await this.fetchFn(
      `${API}/captions?part=snippet&videoId=${videoId}`,
      { headers: await this.auth() },
    );
    if (!res.ok) throw await apiError(res, "captions.list");
    return (((await res.json()) as any).items ?? []).map((c: any) => ({
      id: c.id,
      language: c.snippet?.language ?? "",
      name: c.snippet?.name ?? "",
    }));
  }

  /** Uploads an SRT file as a published caption track (400 quota units). Returns the caption id. */
  async insertCaption(
    videoId: string,
    file: string,
    language = "en",
    name = "English",
  ): Promise<string> {
    const srt = await fs.readFile(file);
    const boundary = "pulse_caption_boundary";
    const meta = JSON.stringify({
      snippet: { videoId, language, name, isDraft: false },
    });
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`,
      ),
      srt,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await this.fetchFn(
      `${CAPTIONS_UPLOAD}?part=snippet&uploadType=multipart`,
      {
        method: "POST",
        headers: {
          ...(await this.auth()),
          "content-type": `multipart/related; boundary=${boundary}`,
          "content-length": String(body.length),
        },
        body,
      },
    );
    if (!res.ok) throw await apiError(res, "captions.insert");
    const id = ((await res.json()) as { id?: string }).id;
    if (!id) throw new Error("captions.insert returned no id");
    return id;
  }

  /** Public view, like and comment counts for up to fifty videos (one quota unit). */
  async stats(
    videoIds: string[],
  ): Promise<
    Map<
      string,
      { views: number; likes: number; comments: number; privacyStatus: string }
    >
  > {
    const out = new Map<
      string,
      { views: number; likes: number; comments: number; privacyStatus: string }
    >();
    if (!videoIds.length) return out;
    const res = await this.fetchFn(
      `${API}/videos?part=statistics,status&id=${videoIds.slice(0, 50).join(",")}`,
      { headers: await this.auth() },
    );
    if (!res.ok) throw await apiError(res, "videos.list");
    for (const v of ((await res.json()) as any).items ?? []) {
      out.set(String(v.id), {
        views: Number(v.statistics?.viewCount ?? 0),
        likes: Number(v.statistics?.likeCount ?? 0),
        comments: Number(v.statistics?.commentCount ?? 0),
        privacyStatus: String(v.status?.privacyStatus ?? ""),
      });
    }
    return out;
  }

  /**
   * Watch behaviour from YouTube Analytics (needs yt-analytics.readonly): how
   * much of each video people watched and the subscribers it brought, from
   * `start` to `end` (YYYY-MM-DD). Analytics lags by about two days.
   */
  async retention(
    videoIds: string[],
    start: string,
    end: string,
  ): Promise<
    Map<
      string,
      {
        views: number;
        avgViewSeconds: number;
        avgViewPercent: number;
        subscribersGained: number;
        engagedViews: number;
      }
    >
  > {
    const out = new Map<
      string,
      {
        views: number;
        avgViewSeconds: number;
        avgViewPercent: number;
        subscribersGained: number;
        engagedViews: number;
      }
    >();
    if (!videoIds.length) return out;
    const q = new URLSearchParams({
      ids: "channel==MINE",
      startDate: start,
      endDate: end,
      metrics:
        "views,averageViewDuration,averageViewPercentage,subscribersGained,engagedViews",
      dimensions: "video",
      filters: `video==${videoIds.slice(0, 200).join(",")}`,
      maxResults: "200",
    });
    const res = await this.fetchFn(
      `https://youtubeanalytics.googleapis.com/v2/reports?${q}`,
      { headers: await this.auth() },
    );
    if (!res.ok) throw await apiError(res, "analytics.reports");
    for (const r of (((await res.json()) as any).rows ?? []) as Array<
      [string, number, number, number, number, number]
    >) {
      out.set(String(r[0]), {
        views: Number(r[1]),
        avgViewSeconds: Number(r[2]),
        avgViewPercent: Number(r[3]),
        subscribersGained: Number(r[4]),
        engagedViews: Number(r[5] ?? 0),
      });
    }
    return out;
  }

  /**
   * Every video on the channel with its numbers for a window (YouTube Analytics, one request): views,
   * engaged views (the Shorts "stayed to watch" count), watch time, subscribers, likes, comments, shares.
   */
  async channelReport(
    start: string,
    end: string,
  ): Promise<Array<Record<string, number | string>>> {
    const metrics =
      "views,engagedViews,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments,shares,estimatedMinutesWatched";
    const q = new URLSearchParams({
      ids: "channel==MINE",
      startDate: start,
      endDate: end,
      metrics,
      dimensions: "video",
      sort: "-views",
      maxResults: "200",
    });
    const res = await this.fetchFn(
      `https://youtubeanalytics.googleapis.com/v2/reports?${q}`,
      { headers: await this.auth() },
    );
    if (!res.ok) throw await apiError(res, "analytics.reports (channel)");
    const names = ["video", ...metrics.split(",")];
    return ((((await res.json()) as any).rows ?? []) as unknown[][]).map((r) =>
      Object.fromEntries(r.map((v, i) => [names[i]!, v as number | string])),
    );
  }

  /** Where a video's views came from (Shorts feed, search, suggested, browse, external...), one request. */
  async trafficSources(
    videoId: string,
    start: string,
    end: string,
  ): Promise<Record<string, number>> {
    const q = new URLSearchParams({
      ids: "channel==MINE",
      startDate: start,
      endDate: end,
      metrics: "views",
      dimensions: "insightTrafficSourceType",
      filters: `video==${videoId}`,
    });
    const res = await this.fetchFn(
      `https://youtubeanalytics.googleapis.com/v2/reports?${q}`,
      { headers: await this.auth() },
    );
    if (!res.ok) throw await apiError(res, "analytics.reports (traffic)");
    return Object.fromEntries(
      ((((await res.json()) as any).rows ?? []) as Array<[string, number]>).map(
        ([k, v]) => [k, Number(v)],
      ),
    );
  }

  /** Every upload's title, publish time, length, tags and public counts (about 2 quota units per 50 videos). */
  async allUploads(): Promise<Array<Record<string, unknown>>> {
    const h = await this.auth();
    const ch = await this.fetchFn(
      `${API}/channels?part=contentDetails&mine=true`,
      { headers: h },
    );
    if (!ch.ok) throw await apiError(ch, "channels.list");
    const uploads = ((await ch.json()) as any).items?.[0]?.contentDetails
      ?.relatedPlaylists?.uploads;
    if (!uploads) return [];
    const ids: string[] = [];
    let page = "";
    for (let i = 0; i < 20; i++) {
      const pl = await this.fetchFn(
        `${API}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${page ? `&pageToken=${page}` : ""}`,
        { headers: h },
      );
      if (!pl.ok) throw await apiError(pl, "playlistItems.list");
      const body = (await pl.json()) as any;
      ids.push(
        ...(body.items ?? [])
          .map((x: any) => x.contentDetails?.videoId)
          .filter(Boolean),
      );
      page = body.nextPageToken ?? "";
      if (!page) break;
    }
    const out: Array<Record<string, unknown>> = [];
    for (let i = 0; i < ids.length; i += 50) {
      const v = await this.fetchFn(
        `${API}/videos?part=snippet,contentDetails,statistics,status&id=${ids.slice(i, i + 50).join(",")}`,
        { headers: h },
      );
      if (!v.ok) throw await apiError(v, "videos.list");
      for (const it of ((await v.json()) as any).items ?? [])
        out.push({
          id: it.id,
          title: it.snippet?.title,
          publishedAt: it.snippet?.publishedAt,
          duration: it.contentDetails?.duration,
          tags: it.snippet?.tags ?? [],
          privacy: it.status?.privacyStatus,
          views: Number(it.statistics?.viewCount ?? 0),
          likes: Number(it.statistics?.likeCount ?? 0),
          comments: Number(it.statistics?.commentCount ?? 0),
        });
    }
    return out;
  }

  /**
   * A video's audience retention curve (YouTube Analytics, one request per video): at each 1% of its length,
   * the share of viewers still watching and how that compares with similar videos (1 = typical).
   */
  async retentionCurve(
    videoId: string,
    start: string,
    end: string,
  ): Promise<Array<{ at: number; watch: number; relative: number }>> {
    const q = new URLSearchParams({
      ids: "channel==MINE",
      startDate: start,
      endDate: end,
      metrics: "audienceWatchRatio,relativeRetentionPerformance",
      dimensions: "elapsedVideoTimeRatio",
      filters: `video==${videoId}`,
    });
    const res = await this.fetchFn(
      `https://youtubeanalytics.googleapis.com/v2/reports?${q}`,
      { headers: await this.auth() },
    );
    if (!res.ok)
      throw await apiError(res, "analytics.reports (retention curve)");
    return (
      (((await res.json()) as any).rows ?? []) as Array<
        [number, number, number]
      >
    ).map((r) => ({
      at: Number(r[0]),
      watch: Number(r[1]),
      relative: Number(r[2]),
    }));
  }

  async status(videoId: string): Promise<
    | {
        uploadStatus: string;
        privacyStatus: string;
        failureReason?: string;
        rejectionReason?: string;
        processingStatus?: string;
        partsProcessed?: number;
      }
    | undefined
  > {
    const res = await this.fetchFn(
      `${API}/videos?part=status,processingDetails&id=${videoId}`,
      { headers: await this.auth() },
    );
    if (!res.ok) throw await apiError(res, "videos.list");
    const v = ((await res.json()) as any).items?.[0];
    if (!v) return undefined;
    return {
      uploadStatus: v.status?.uploadStatus,
      privacyStatus: v.status?.privacyStatus,
      failureReason: v.status?.failureReason,
      rejectionReason: v.status?.rejectionReason,
      processingStatus: v.processingDetails?.processingStatus,
      partsProcessed: Number(
        v.processingDetails?.processingProgress?.partsProcessed ?? 0,
      ),
    };
  }

  /**
   * Sets a video's title and description in other languages (videos.update with the localizations part,
   * 50 units). YouTube shows the matching one to viewers whose interface is in that language.
   */
  async setLocalizations(
    videoId: string,
    localizations: Record<string, { title: string; description: string }>,
  ): Promise<void> {
    const put = await this.fetchFn(`${API}/videos?part=localizations`, {
      method: "PUT",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify({ id: videoId, localizations }),
    });
    if (!put.ok) throw await apiError(put, "videos.update (localizations)");
  }

  /** Makes a video public now, keeping its other status fields as they are. */
  async makePublic(videoId: string): Promise<void> {
    await this.setPrivacy(videoId, "public");
  }

  /** Sets a video's privacy (private hides it from everyone and can be undone), keeping its other status fields. */
  async setPrivacy(
    videoId: string,
    privacy: "public" | "unlisted" | "private",
  ): Promise<void> {
    const res = await this.fetchFn(`${API}/videos?part=status&id=${videoId}`, {
      headers: await this.auth(),
    });
    if (!res.ok) throw await apiError(res, "videos.list");
    const st = ((await res.json()) as any).items?.[0]?.status;
    if (!st) throw new Error(`video ${videoId} not found`);
    const put = await this.fetchFn(`${API}/videos?part=status`, {
      method: "PUT",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify({
        id: videoId,
        status: {
          privacyStatus: privacy,
          embeddable: st.embeddable,
          license: st.license,
          publicStatsViewable: st.publicStatsViewable,
          selfDeclaredMadeForKids: st.madeForKids ?? false,
          containsSyntheticMedia: st.containsSyntheticMedia,
        },
      }),
    });
    if (!put.ok) throw await apiError(put, "videos.update");
  }
}
