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

export function markerTag(episodeId: string): string {
  return `pulseref${episodeId.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
}

export function buildResource(meta: VideoMetadata, marker: string) {
  const tags = [...new Set([...meta.tags.map((t) => t.replace(/[<>]/g, "").slice(0, 60)), marker])];
  // YouTube caps the combined tag length at 500 characters; keep the marker.
  while (tags.join(",").length > 480 && tags.length > 1) tags.splice(tags.length - 2, 1);
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
      privacyStatus: meta.publishAt && meta.privacyStatus === "public" ? "private" : meta.privacyStatus,
      ...(meta.publishAt && meta.privacyStatus === "public" ? { publishAt: meta.publishAt } : {}),
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
  const msg = `${what}: HTTP ${res.status} ${reason} ${text.slice(0, 300)}`.trim();
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
    const ch = await this.fetchFn(`${API}/channels?part=contentDetails&mine=true`, { headers: h });
    if (!ch.ok) throw await apiError(ch, "channels.list");
    const uploads = ((await ch.json()) as any).items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return undefined;
    const pl = await this.fetchFn(`${API}/playlistItems?part=contentDetails&maxResults=25&playlistId=${uploads}`, { headers: h });
    if (!pl.ok) throw await apiError(pl, "playlistItems.list");
    const ids: string[] = (((await pl.json()) as any).items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length === 0) return undefined;
    const vids = await this.fetchFn(`${API}/videos?part=snippet&id=${ids.join(",")}`, { headers: h });
    if (!vids.ok) throw await apiError(vids, "videos.list");
    const hit = (((await vids.json()) as any).items ?? []).find((v: any) => (v.snippet?.tags ?? []).includes(marker));
    return hit?.id;
  }

  async createSession(resource: object, size: number): Promise<string> {
    const res = await this.fetchFn(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        ...(await this.auth()),
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": "video/mp4",
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify(resource),
    });
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
      headers: { ...(await this.auth()), "content-length": "0", "content-range": `bytes */${size}` },
    });
    if (statusRes.status === 200 || statusRes.status === 201) return this.idFrom(statusRes);
    if (statusRes.status === 404 || statusRes.status === 410) throw new SessionGone(`upload session expired (HTTP ${statusRes.status})`);
    if (statusRes.status !== 308) throw await apiError(statusRes, "upload status");
    const range = statusRes.headers.get("range"); // e.g. "bytes=0-1048575"
    const offset = range ? Number(range.split("-")[1]) + 1 : 0;

    const res = await this.fetchFn(sessionUri, {
      method: "PUT",
      headers: {
        ...(await this.auth()),
        "content-type": "video/mp4",
        "content-length": String(size - offset),
        ...(offset > 0 ? { "content-range": `bytes ${offset}-${size - 1}/${size}` } : {}),
      },
      body: data.subarray(offset),
    });
    if (res.status === 200 || res.status === 201) return this.idFrom(res);
    if (res.status === 404 || res.status === 410) throw new SessionGone(`upload session expired (HTTP ${res.status})`);
    throw await apiError(res, "upload");
  }

  private async idFrom(res: Response): Promise<string> {
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new Error("upload finished but returned no video id");
    return body.id;
  }

  /** Caption tracks already on a video, so a retried confirm step never uploads twice. */
  async listCaptions(videoId: string): Promise<Array<{ id: string; language: string; name: string }>> {
    const res = await this.fetchFn(`${API}/captions?part=snippet&videoId=${videoId}`, { headers: await this.auth() });
    if (!res.ok) throw await apiError(res, "captions.list");
    return (((await res.json()) as any).items ?? []).map((c: any) => ({ id: c.id, language: c.snippet?.language ?? "", name: c.snippet?.name ?? "" }));
  }

  /** Uploads an SRT file as a published caption track (400 quota units). Returns the caption id. */
  async insertCaption(videoId: string, file: string, language = "en-GB", name = "English"): Promise<string> {
    const srt = await fs.readFile(file);
    const boundary = "pulse_caption_boundary";
    const meta = JSON.stringify({ snippet: { videoId, language, name, isDraft: false } });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`),
      srt,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await this.fetchFn(`${CAPTIONS_UPLOAD}?part=snippet&uploadType=multipart`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": `multipart/related; boundary=${boundary}`, "content-length": String(body.length) },
      body,
    });
    if (!res.ok) throw await apiError(res, "captions.insert");
    const id = ((await res.json()) as { id?: string }).id;
    if (!id) throw new Error("captions.insert returned no id");
    return id;
  }

  async status(videoId: string): Promise<{ uploadStatus: string; privacyStatus: string; failureReason?: string; rejectionReason?: string } | undefined> {
    const res = await this.fetchFn(`${API}/videos?part=status,processingDetails&id=${videoId}`, { headers: await this.auth() });
    if (!res.ok) throw await apiError(res, "videos.list");
    const v = ((await res.json()) as any).items?.[0];
    if (!v) return undefined;
    return {
      uploadStatus: v.status?.uploadStatus,
      privacyStatus: v.status?.privacyStatus,
      failureReason: v.status?.failureReason,
      rejectionReason: v.status?.rejectionReason,
    };
  }
}
