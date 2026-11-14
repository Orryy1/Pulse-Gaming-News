// YouTube Live for the relay (Data API v3, the factory's own login with the youtube scope). It makes one reusable
// stream (the ingest point the relay pushes to), a broadcast per Twitch stream (public, not made for kids, DVR on,
// auto start and auto stop, recorded from the start so the archive stays), binds them, and reads their state.
// The ingest key is read from the API each time it is needed and is never logged, saved or returned in an error.
//
// Quota: an insert, bind, update or transition costs 50 units, a list 1. A stream day is about 200 units to set up
// plus 2 a minute of health checks (about 1,000 for an 8-hour stream).

type Fetch = typeof fetch;

/** The reusable stream's title: the relay finds its own stream by it and never touches anyone else's. */
export const RELAY_STREAM_TITLE = "Pulse relay (Twitch mirror)";
/** YouTube's Gaming category. */
export const GAMING_CATEGORY = "20";

export class YouTubeApiError extends Error {
  constructor(
    public status: number,
    public reasons: string[],
    message: string,
  ) {
    super(message);
  }
}

export interface Ingest {
  streamId: string;
  /** rtmps:// (or rtmp://) address plus key: a secret, never logged. */
  url: string;
}

export interface BroadcastState {
  id: string;
  /** created, ready, testing, live, complete, revoked, testStarting, liveStarting */
  lifeCycle: string;
  privacy: string;
  boundStreamId?: string;
}

export interface StreamState {
  /** active, created, error, inactive, ready */
  status: string;
  /** good, ok, bad, noData */
  health?: string;
}

export interface NewBroadcast {
  title: string;
  description: string;
  privacy: "public" | "unlisted" | "private";
  start: Date;
}

export interface LiveApi {
  ingest(): Promise<Ingest>;
  createBroadcast(b: NewBroadcast): Promise<string>;
  bind(broadcastId: string, streamId: string): Promise<void>;
  broadcast(id: string): Promise<BroadcastState | undefined>;
  stream(id: string): Promise<StreamState | undefined>;
  end(id: string): Promise<void>;
}

export class YouTubeLive implements LiveApi {
  constructor(
    private token: () => Promise<string>,
    private fetchFn: Fetch = fetch,
  ) {}

  private async call<T>(
    method: "GET" | "POST" | "PUT",
    pathAndQuery: string,
    body?: unknown,
  ): Promise<T> {
    const r = await this.fetchFn(
      `https://www.googleapis.com/youtube/v3/${pathAndQuery}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      },
    );
    const j = (await r.json().catch(() => ({}))) as T & {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    if (!r.ok) {
      const reasons = (j.error?.errors ?? []).map((e) => e.reason ?? "");
      throw new YouTubeApiError(
        r.status,
        reasons,
        `YouTube ${method} ${pathAndQuery.split("?")[0]} ${r.status}${reasons.length ? ` (${reasons.join(", ")})` : ""}`,
      );
    }
    return j;
  }

  /** The relay's reusable stream (made once), with its ingest address read fresh from the API. */
  async ingest(): Promise<Ingest> {
    type S = {
      id: string;
      snippet?: { title?: string };
      cdn?: {
        ingestionInfo?: {
          ingestionAddress?: string;
          rtmpsIngestionAddress?: string;
          streamName?: string;
        };
      };
    };
    const list = await this.call<{ items?: S[] }>(
      "GET",
      "liveStreams?part=id,snippet,cdn&mine=true&maxResults=50",
    );
    let s = list.items?.find((x) => x.snippet?.title === RELAY_STREAM_TITLE);
    s ??= await this.call<S>(
      "POST",
      "liveStreams?part=id,snippet,cdn,contentDetails,status",
      {
        snippet: { title: RELAY_STREAM_TITLE },
        cdn: {
          ingestionType: "rtmp",
          resolution: "variable",
          frameRate: "variable",
        },
        contentDetails: { isReusable: true },
      },
    );
    const info = s.cdn?.ingestionInfo;
    const base = info?.rtmpsIngestionAddress || info?.ingestionAddress;
    if (!base || !info?.streamName)
      throw new Error("YouTube gave the relay's stream no ingest address");
    return {
      streamId: s.id,
      url: `${base.replace(/\/$/, "")}/${info.streamName}`,
    };
  }

  async createBroadcast(b: NewBroadcast): Promise<string> {
    const made = await this.call<{ id: string }>(
      "POST",
      "liveBroadcasts?part=id,snippet,status,contentDetails",
      {
        snippet: {
          title: b.title,
          description: b.description,
          scheduledStartTime: b.start.toISOString(),
        },
        status: { privacyStatus: b.privacy, selfDeclaredMadeForKids: false },
        contentDetails: {
          enableAutoStart: true,
          enableAutoStop: true,
          enableDvr: true,
          recordFromStart: true,
          enableEmbed: true,
          latencyPreference: "normal",
          monitorStream: { enableMonitorStream: false },
        },
      },
    );
    // A broadcast takes no category; its video does (Gaming). Not fatal: the stream runs without it.
    await this.call("PUT", "videos?part=snippet", {
      id: made.id,
      snippet: {
        title: b.title,
        description: b.description,
        categoryId: GAMING_CATEGORY,
      },
    }).catch(() => undefined);
    return made.id;
  }

  async bind(broadcastId: string, streamId: string): Promise<void> {
    await this.call(
      "POST",
      `liveBroadcasts/bind?id=${encodeURIComponent(broadcastId)}&part=id,contentDetails&streamId=${encodeURIComponent(streamId)}`,
    );
  }

  async broadcast(id: string): Promise<BroadcastState | undefined> {
    const j = await this.call<{
      items?: Array<{
        id: string;
        status?: { lifeCycleStatus?: string; privacyStatus?: string };
        contentDetails?: { boundStreamId?: string };
      }>;
    }>(
      "GET",
      `liveBroadcasts?part=id,status,contentDetails&id=${encodeURIComponent(id)}`,
    );
    const b = j.items?.[0];
    return b
      ? {
          id: b.id,
          lifeCycle: b.status?.lifeCycleStatus ?? "",
          privacy: b.status?.privacyStatus ?? "",
          boundStreamId: b.contentDetails?.boundStreamId,
        }
      : undefined;
  }

  async stream(id: string): Promise<StreamState | undefined> {
    const j = await this.call<{
      items?: Array<{
        status?: {
          streamStatus?: string;
          healthStatus?: { status?: string };
        };
      }>;
    }>("GET", `liveStreams?part=status&id=${encodeURIComponent(id)}`);
    const s = j.items?.[0];
    return s
      ? {
          status: s.status?.streamStatus ?? "",
          health: s.status?.healthStatus?.status,
        }
      : undefined;
  }

  /** Ends a broadcast now (the archive is kept). */
  async end(id: string): Promise<void> {
    await this.call(
      "POST",
      `liveBroadcasts/transition?broadcastStatus=complete&id=${encodeURIComponent(id)}&part=id,status`,
    );
  }
}

/** A short-lived access token from the factory's refresh token (YOUTUBE_CLIENT_ID, _SECRET, _REFRESH_TOKEN). */
export function tokenFromEnv(
  env: NodeJS.ProcessEnv,
  fetchFn: Fetch = fetch,
): () => Promise<string> {
  let have: { token: string; until: number } | undefined;
  return async () => {
    if (have && have.until > Date.now() + 60_000) return have.token;
    const r = await fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID || env.YOUTUBE_CLIENT_ID || "",
        client_secret:
          env.GOOGLE_CLIENT_SECRET || env.YOUTUBE_CLIENT_SECRET || "",
        refresh_token: env.YOUTUBE_REFRESH_TOKEN || "",
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!j.access_token)
      throw new Error(`YouTube login failed (${j.error ?? r.status})`);
    have = {
      token: j.access_token,
      until: Date.now() + (j.expires_in ?? 3600) * 1000,
    };
    return have.token;
  };
}
