// Buffer's GraphQL API (developers.buffer.com, 6 Nov 2026): TikTok has approved Buffer for public posting, which
// Pulse's own TikTok app is not, so a Short goes out with no tap. Buffer fetches the video itself from the same
// signed public link Instagram and Threads use, and publishes it straight away.

import { fetchWithTimeout } from "../lib/util.ts";

const API = "https://api.buffer.com";

/** Posts a video to one Buffer channel now; returns Buffer's post id. */
export async function bufferPostVideo(
  apiKey: string,
  channelId: string,
  videoUrl: string,
  text: string,
): Promise<string> {
  const query = `mutation Post($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess { post { id } }
      ... on MutationError { message }
    }
  }`;
  const input = {
    channelId,
    text,
    schedulingType: "automatic",
    mode: "shareNow",
    needsApproval: false,
    assets: [{ video: { url: videoUrl } }],
  };
  const res = await fetchWithTimeout(
    API,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { input } }),
    },
    60_000,
  );
  const j = (await res.json().catch(() => ({}))) as {
    data?: { createPost?: { post?: { id?: string }; message?: string } };
    errors?: Array<{ message?: string }>;
  };
  const id = j.data?.createPost?.post?.id;
  if (!res.ok || !id)
    throw new Error(
      `buffer post failed: ${j.data?.createPost?.message ?? j.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`}`.slice(0, 300),
    );
  return `buffer:${id}`;
}

// ------------------------------------------------------------------ post statistics (the weekly analytics loop)

/** One post's numbers as Buffer reports them; `metrics` keyed by Buffer's metric type, lower case. */
export interface BufferPostStat {
  id: string;
  status: string;
  via: string;
  text: string;
  sentAt?: Date;
  externalLink?: string;
  metricsUpdatedAt?: Date;
  metrics: Record<string, number>;
}

const POSTS_QUERY = `query($i: PostsInput!, $a: String) { posts(first: 50, after: $a, input: $i) { pageInfo { hasNextPage endCursor } edges { node { id status via text sentAt externalLink metricsUpdatedAt metrics { type value unit } } } } }`;

const date = (v: unknown): Date | undefined => {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) return undefined;
  return new Date(v);
};

/** One page of the posts query, parsed (pure, for the tests); a GraphQL error throws with Buffer's own words. */
export function parseBufferPosts(body: unknown): {
  posts: BufferPostStat[];
  next?: string;
} {
  const b = (body ?? {}) as {
    data?: { posts?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string }; edges?: Array<{ node?: any }> } };
    errors?: Array<{ message?: string }>;
  };
  if (b.errors?.length && !b.data?.posts)
    throw new Error(`buffer posts query failed: ${b.errors.map((e) => e.message).join("; ")}`.slice(0, 300));
  const page = b.data?.posts;
  const posts: BufferPostStat[] = [];
  for (const e of page?.edges ?? []) {
    const n = e?.node;
    if (!n?.id) continue;
    const metrics: Record<string, number> = {};
    for (const m of Array.isArray(n.metrics) ? n.metrics : []) {
      const v = typeof m?.value === "string" ? Number(m.value) : m?.value;
      if (m?.type && typeof v === "number" && Number.isFinite(v)) metrics[String(m.type).toLowerCase()] = v;
    }
    posts.push({
      id: String(n.id),
      status: String(n.status ?? ""),
      via: String(n.via ?? ""),
      text: typeof n.text === "string" ? n.text : "",
      sentAt: date(n.sentAt),
      externalLink: typeof n.externalLink === "string" ? n.externalLink : undefined,
      metricsUpdatedAt: date(n.metricsUpdatedAt),
      metrics,
    });
  }
  return {
    posts,
    next: page?.pageInfo?.hasNextPage && page.pageInfo.endCursor ? page.pageInfo.endCursor : undefined,
  };
}

/**
 * A post's numbers in the factory's terms, or undefined for "no reading yet": Buffer refreshes about once a
 * day, so a post under a day old (or never refreshed since it went out) reads 0 and that 0 is not a result.
 * Buffer gives watch time in minutes (total) and seconds (average).
 */
export function bufferNumbers(
  p: BufferPostStat,
  now: Date,
):
  | {
      views?: number;
      reach?: number;
      likes?: number;
      comments?: number;
      shares?: number;
      avgWatchSeconds?: number;
      totalWatchSeconds?: number;
      extra: Record<string, unknown>;
    }
  | undefined {
  if (!p.sentAt || now.getTime() - p.sentAt.getTime() < 24 * 3_600_000) return undefined;
  if (!p.metricsUpdatedAt || p.metricsUpdatedAt.getTime() <= p.sentAt.getTime()) return undefined;
  const m = p.metrics;
  const total = m.totaltimewatched;
  return {
    views: m.views,
    reach: m.reach,
    likes: m.reactions ?? m.likes,
    comments: m.comments,
    shares: m.shares,
    avgWatchSeconds: m.averagetimewatched,
    totalWatchSeconds: total === undefined ? undefined : total * 60,
    extra: {
      source: "buffer",
      engagement_rate: m.engagementrate,
      metrics_updated_at: p.metricsUpdatedAt.toISOString(),
      posted_at: p.sentAt.toISOString(),
      caption: p.text.slice(0, 200),
    },
  };
}

async function bufferQuery(apiKey: string, query: string, variables: Record<string, unknown>, fetchFn: typeof fetch): Promise<unknown> {
  const res = await fetchFn(API, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`buffer query failed: HTTP ${res.status}`);
  return j;
}

/**
 * Every post on one Buffer channel sent since `since`, newest first, with its numbers (posts made in the TikTok
 * app before Buffer was connected included). The same Buffer login holds another project's channels, so the
 * query is always filtered to the one channel id given and nothing else is read.
 */
export async function bufferPostStats(
  apiKey: string,
  channelId: string,
  since: Date,
  fetchFn: typeof fetch = fetch,
  maxPages = 8,
): Promise<BufferPostStat[]> {
  if (!apiKey || !channelId) throw new Error("buffer is not set up (BUFFER_API_KEY, BUFFER_TIKTOK_CHANNEL)");
  const org = (await bufferQuery(apiKey, `{ account { organizations { id } } }`, {}, fetchFn)) as {
    data?: { account?: { organizations?: Array<{ id?: string }> } };
  };
  const organizationId = org.data?.account?.organizations?.[0]?.id;
  if (!organizationId) throw new Error("buffer returned no organisation");
  const input = { organizationId, filter: { channelIds: [channelId] }, sort: [{ field: "createdAt", direction: "desc" }] };
  const out: BufferPostStat[] = [];
  let after: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = parseBufferPosts(await bufferQuery(apiKey, POSTS_QUERY, { i: input, a: after ?? null }, fetchFn));
    out.push(...page.posts);
    // Newest first: once a page reaches past the window the rest is older still.
    const sent = page.posts.filter((p) => p.sentAt).map((p) => p.sentAt!.getTime());
    const oldest = sent.length ? new Date(Math.min(...sent)) : undefined;
    if (!page.next || (oldest && oldest < since)) break;
    after = page.next;
  }
  // Drafts and queued posts have no send time and no numbers.
  return out.filter((p) => p.sentAt && p.sentAt >= since);
}
