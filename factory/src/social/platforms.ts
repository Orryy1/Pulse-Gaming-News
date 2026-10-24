// Posting a finished Short to the other platforms: Facebook Reels and
// Instagram Reels through Meta's Graph API (the same three-step flow the old
// pipeline proved), TikTok through the Content Posting API, and X as a link
// to the YouTube Short. Each returns the platform's id for the post, or throws
// with the platform's own error text.

import fs from "node:fs/promises";
import { oauth1Header, type OAuth1Keys } from "./oauth1.ts";

type FetchLike = typeof fetch;
const GRAPH = "https://graph.facebook.com/v21.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json(res: Response, what: string): Promise<any> {
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (
    !res.ok ||
    body?.error?.message ||
    (body?.error && body.error.code && body.error.code !== "ok")
  )
    throw new Error(
      `${what} failed (HTTP ${res.status}): ${JSON.stringify(body?.error ?? body).slice(0, 400)}`,
    );
  return body;
}

// ------------------------------------------------------------------ Facebook

export interface FacebookReel {
  pageId: string;
  token: string;
  file: string;
  title: string;
  description: string;
}

/** start → upload the bytes → finish with PUBLISHED, then wait until Meta says the Reel is live. */
export async function postFacebookReel(
  r: FacebookReel,
  fetchFn: FetchLike = fetch,
  pollMs = 10_000,
): Promise<string> {
  const start = await json(
    await fetchFn(`${GRAPH}/${r.pageId}/video_reels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upload_phase: "start", access_token: r.token }),
    }),
    "facebook start",
  );
  const videoId: string = start.video_id;
  if (!videoId || !start.upload_url)
    throw new Error(
      `facebook start returned no upload URL: ${JSON.stringify(start).slice(0, 200)}`,
    );
  const data = await fs.readFile(r.file);
  await json(
    await fetchFn(start.upload_url, {
      method: "POST",
      headers: {
        authorization: `OAuth ${r.token}`,
        offset: "0",
        file_size: String(data.length),
        "content-type": "application/octet-stream",
      },
      body: data,
    }),
    "facebook upload",
  );
  await json(
    await fetchFn(`${GRAPH}/${r.pageId}/video_reels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upload_phase: "finish",
        video_id: videoId,
        video_state: "PUBLISHED",
        title: r.title.slice(0, 100),
        description: r.description.slice(0, 2000),
        access_token: r.token,
      }),
    }),
    "facebook finish",
  );
  // Finish says success even when processing later fails: wait for ready and published.
  for (let i = 0; i < 36; i++) {
    await sleep(pollMs);
    const st = await json(
      await fetchFn(
        `${GRAPH}/${videoId}?fields=status&access_token=${encodeURIComponent(r.token)}`,
      ),
      "facebook status",
    );
    const video = st.status?.video_status;
    const publishing = st.status?.publishing_phase?.status;
    if (video === "error" || st.status?.processing_phase?.status === "error")
      throw new Error(
        `facebook processing failed: ${JSON.stringify(st.status).slice(0, 300)}`,
      );
    if (
      video === "ready" &&
      (publishing === "complete" || publishing === "published" || !publishing)
    )
      return videoId;
  }
  throw new Error(
    `facebook reel ${videoId} still processing after six minutes`,
  );
}

// ------------------------------------------------------------------ Instagram

export interface InstagramReel {
  accountId: string;
  token: string;
  file: string;
  caption: string;
  videoUrl?: string; // a signed public link to the same file, for the fallback
}

/**
 * A REELS container from the file bytes (resumable upload); when Meta's upload
 * service refuses the bytes, a second container from a signed link to the same
 * file on this PC, which Instagram fetches itself. Then wait for FINISHED and publish.
 */
export async function postInstagramReel(
  r: InstagramReel,
  fetchFn: FetchLike = fetch,
  pollMs = 10_000,
): Promise<string> {
  const fromLink = async () =>
    (
      await json(
        await fetchFn(`${GRAPH}/${r.accountId}/media`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            media_type: "REELS",
            video_url: r.videoUrl,
            caption: r.caption.slice(0, 2200),
            share_to_feed: true,
            access_token: r.token,
          }),
        }),
        "instagram container (link)",
      )
    ).id as string;
  let id: string;
  try {
    id = await instagramFromBytes(r, fetchFn);
  } catch (err) {
    if (!r.videoUrl) throw err;
    id = await fromLink();
  }
  try {
    return await instagramFinish(r, id, fetchFn, pollMs);
  } catch (err) {
    // Processing refused the uploaded bytes (error 2207076 and kin) or never got going: Instagram gets one
    // more go fetching the file itself.
    if (!r.videoUrl || !/processing failed|still processing/.test(String(err)))
      throw err;
    return instagramFinish(r, await fromLink(), fetchFn, pollMs);
  }
}

async function instagramFinish(
  r: InstagramReel,
  id: string,
  fetchFn: FetchLike,
  pollMs: number,
): Promise<string> {
  let status = "IN_PROGRESS";
  for (let i = 0; i < 40 && status !== "FINISHED"; i++) {
    await sleep(pollMs);
    const st = await json(
      await fetchFn(
        `${GRAPH}/${id}?fields=status_code,status&access_token=${encodeURIComponent(r.token)}`,
      ),
      "instagram status",
    );
    status = st.status_code ?? "IN_PROGRESS";
    if (status === "ERROR" || status === "EXPIRED")
      throw new Error(`instagram processing failed: ${st.status ?? status}`);
  }
  if (status !== "FINISHED")
    throw new Error(
      `instagram container ${id} still processing after the wait`,
    );
  const pub = await json(
    await fetchFn(`${GRAPH}/${r.accountId}/media_publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creation_id: id, access_token: r.token }),
    }),
    "instagram publish",
  );
  return pub.id;
}

async function instagramFromBytes(
  r: InstagramReel,
  fetchFn: FetchLike,
): Promise<string> {
  const container = await json(
    await fetchFn(`${GRAPH}/${r.accountId}/media`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        upload_type: "resumable",
        caption: r.caption.slice(0, 2200),
        share_to_feed: true,
        access_token: r.token,
      }),
    }),
    "instagram container",
  );
  const id: string = container.id;
  const uploadUrl: string =
    container.uri || `https://rupload.facebook.com/ig-api-upload/v21.0/${id}`;
  const data = await fs.readFile(r.file);
  const up = await fetchFn(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `OAuth ${r.token}`,
      offset: "0",
      file_size: String(data.length),
      "content-type": "application/octet-stream",
    },
    body: data,
  });
  // The upload host answers 400 "ProcessingFailedError" even when the bytes arrived and the container
  // goes on to finish (tested 22 Oct 2026), so its status decides, not this reply; the caller falls
  // back to a link upload if the container errors or never progresses.
  if (!up.ok && !/ProcessingFailedError/.test(await up.text()))
    throw new Error(`instagram upload: HTTP ${up.status}`);
  return id;
}

// ------------------------------------------------------------------ TikTok

export interface TikTokToken {
  access_token: string;
  refresh_token: string;
  expires_at?: number | string; // seconds or ISO
  [k: string]: unknown;
}

/** Reads the saved token, refreshes it when it has under an hour left, and saves the new one. */
export async function tiktokAccessToken(
  tokenPath: string,
  clientKey: string,
  clientSecret: string,
  fetchFn: FetchLike = fetch,
  now = Date.now(),
): Promise<string> {
  const t = JSON.parse(await fs.readFile(tokenPath, "utf8")) as TikTokToken;
  const exp =
    typeof t.expires_at === "number"
      ? t.expires_at * (t.expires_at < 1e12 ? 1000 : 1)
      : t.expires_at
        ? Date.parse(String(t.expires_at))
        : 0;
  if (t.access_token && exp - now > 3_600_000) return t.access_token;
  const res = await fetchFn("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: t.refresh_token,
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token)
    throw new Error(
      `tiktok refresh failed: ${j.error ?? res.status} ${j.error_description ?? ""}`.trim(),
    );
  const next = {
    ...t,
    ...j,
    expires_at: Math.floor(now / 1000) + Number(j.expires_in ?? 86400),
    saved_at: new Date(now).toISOString(),
  };
  await fs.writeFile(tokenPath, JSON.stringify(next, null, 2));
  return j.access_token;
}

export interface TikTokPost {
  accessToken: string;
  file: string;
  title: string; // the caption, hashtags included, up to 2200 characters
  inbox?: boolean; // send to the creator's TikTok inbox as a draft instead of posting
}

/** Direct post from a file: init, upload the bytes in one or more chunks, then wait for PUBLISH_COMPLETE. */
export async function postTikTok(
  p: TikTokPost,
  fetchFn: FetchLike = fetch,
  pollMs = 10_000,
): Promise<string> {
  const data = await fs.readFile(p.file);
  const size = data.length;
  // One chunk up to 64 MB; above that, 10 MB chunks with the remainder folded into the last.
  // One chunk up to 64 MB (a single chunk must be the whole file); above that, 32 MB chunks with the
  // remainder folded into the last, which TikTok allows up to 128 MB.
  const chunk = size <= 64 * 1024 * 1024 ? size : 32 * 1024 * 1024;
  const count = Math.max(1, Math.floor(size / chunk));
  const headers = {
    authorization: `Bearer ${p.accessToken}`,
    "content-type": "application/json; charset=UTF-8",
  };
  const source_info = {
    source: "FILE_UPLOAD",
    video_size: size,
    chunk_size: chunk,
    total_chunk_count: count,
  };
  const init = await json(
    p.inbox
      ? await fetchFn(
          "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
          { method: "POST", headers, body: JSON.stringify({ source_info }) },
        )
      : await fetchFn(
          "https://open.tiktokapis.com/v2/post/publish/video/init/",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              post_info: {
                title: p.title.slice(0, 2200),
                privacy_level: "PUBLIC_TO_EVERYONE",
                disable_comment: false,
                disable_duet: false,
                disable_stitch: false,
                video_cover_timestamp_ms: 1500,
                is_aigc: true,
              },
              source_info,
            }),
          },
        ),
    "tiktok init",
  );
  const publishId: string = init.data?.publish_id;
  const uploadUrl: string = init.data?.upload_url;
  if (!publishId || !uploadUrl)
    throw new Error(
      `tiktok init returned no upload URL: ${JSON.stringify(init).slice(0, 200)}`,
    );
  for (let i = 0; i < count; i++) {
    const from = i * chunk;
    const to = i === count - 1 ? size : from + chunk;
    // TikTok's upload hosts throw the odd 5xx: try a chunk up to three times.
    let res: Response | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      res = await fetchFn(uploadUrl, {
        method: "PUT",
        headers: {
          "content-type": "video/mp4",
          "content-length": String(to - from),
          "content-range": `bytes ${from}-${to - 1}/${size}`,
        },
        body: data.subarray(from, to),
      });
      if (res.status < 500) break;
      await sleep(attempt * 5000);
    }
    if (![200, 201, 206].includes(res!.status))
      throw new Error(
        `tiktok upload chunk ${i + 1}/${count} failed (HTTP ${res!.status}): ${(await res!.text()).slice(0, 200)}`,
      );
  }
  for (let i = 0; i < 40; i++) {
    await sleep(pollMs);
    const st = await json(
      await fetchFn(
        "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ publish_id: publishId }),
        },
      ),
      "tiktok status",
    );
    const status = st.data?.status;
    if (status === "PUBLISH_COMPLETE")
      return String(st.data?.publicaly_available_post_id?.[0] ?? publishId);
    if (status === "SEND_TO_USER_INBOX") return `inbox:${publishId}`;
    if (status === "FAILED")
      throw new Error(
        `tiktok publish failed: ${st.data?.fail_reason ?? "no reason given"}`,
      );
  }
  // The bytes are in: an inbox draft arrives once TikTok finishes processing, however long that takes.
  if (p.inbox) return `inbox:${publishId}`;
  throw new Error(`tiktok post ${publishId} still processing after the wait`);
}

// ------------------------------------------------------------------ X

/** A post on X: the headline and the link to the YouTube Short (X turns it into a playable card). */
export async function postX(
  keys: OAuth1Keys,
  text: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const url = "https://api.twitter.com/2/tweets";
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      authorization: oauth1Header("POST", url, keys),
      "content-type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.data?.id)
    throw new Error(
      `x post failed (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 300)}`,
    );
  return body.data.id;
}

// ------------------------------------------------------------------ community posts

/** A photo post on the Facebook page from a public image URL; returns the post id. */
export async function postFacebookPhoto(
  pageId: string,
  token: string,
  imageUrl: string,
  message: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const r = await json(
    await fetchFn(`${GRAPH}/${pageId}/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: imageUrl,
        message: message.slice(0, 5000),
        access_token: token,
      }),
    }),
    "facebook photo",
  );
  return String(r.post_id ?? r.id);
}

/** A single-image Instagram post from a public image URL; returns the media id. */
export async function postInstagramImage(
  accountId: string,
  token: string,
  imageUrl: string,
  caption: string,
  fetchFn: FetchLike = fetch,
  pollMs = 5_000,
): Promise<string> {
  const c = await json(
    await fetchFn(`${GRAPH}/${accountId}/media`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption.slice(0, 2200),
        access_token: token,
      }),
    }),
    "instagram image container",
  );
  for (let i = 0; i < 24; i++) {
    const st = await json(
      await fetchFn(
        `${GRAPH}/${c.id}?fields=status_code&access_token=${encodeURIComponent(token)}`,
      ),
      "instagram image status",
    );
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR")
      throw new Error("instagram image processing failed");
    await sleep(pollMs);
  }
  const pub = await json(
    await fetchFn(`${GRAPH}/${accountId}/media_publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creation_id: c.id, access_token: token }),
    }),
    "instagram image publish",
  );
  return String(pub.id);
}

/** The page's own comment under a Facebook post or an Instagram media. */
export async function graphComment(
  objectId: string,
  token: string,
  text: string,
  instagram: boolean,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const r = await json(
    await fetchFn(
      `${GRAPH}/${objectId}/${instagram ? "comments" : "comments"}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          instagram
            ? { message: text, access_token: token }
            : { message: text, access_token: token },
        ),
      },
    ),
    instagram ? "instagram comment" : "facebook comment",
  );
  return String(r.id);
}

/** How many comments a post has drawn. */
export async function graphCommentCount(
  objectId: string,
  token: string,
  instagram: boolean,
  fetchFn: FetchLike = fetch,
): Promise<number> {
  const r = await json(
    await fetchFn(
      `${GRAPH}/${objectId}?fields=${instagram ? "comments_count" : "comments.summary(true).limit(0)"}&access_token=${encodeURIComponent(token)}`,
    ),
    "comment count",
  );
  return (
    Number(instagram ? r.comments_count : r.comments?.summary?.total_count) || 0
  );
}
