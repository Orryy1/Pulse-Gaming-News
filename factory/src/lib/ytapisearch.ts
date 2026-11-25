// YouTube searches through the Data API instead of YouTube's search pages (25 Nov 2026). The home IP's page requests
// were being bot-checked; a search is the easiest of them to move, because the Data API (YOUTUBE_API_KEY, 100 quota
// units a search and 1 for the videos' details) answers the same question. The guard (src/lib/ytguard.ts) hands it
// any yt-dlp search it understands: `ytsearchN:query`, `ytsearchdateN:query` or a results page with no filter, this
// week's uploads by views (sp=CAMSAggD) or Creative Commons (sp=EgIwAQ==), listed flat (--flat-playlist) with
// --dump-json or a plain --print template. The answer is printed in yt-dlp's own shape, so no caller changes. Anything
// else (another filter, a template it cannot fill, an unknown flag) goes the usual way. The key never appears in a log
// or an error.

/** The HTTP getter (tests give their own). */
export type ApiGet = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ApiSearchCall {
  query: string;
  max: number;
  order: "relevance" | "date" | "viewCount";
  /** RFC 3339 lower bound on the upload time (this week's uploads). */
  publishedAfter?: string;
  creativeCommons?: boolean;
  output: { kind: "dump" } | { kind: "print"; template: string };
}

/** Flags that change nothing about a flat search's answer. */
const PLAIN_FLAGS = new Set([
  "--no-warnings",
  "--flat-playlist",
  "--quiet",
  "-q",
  "--ignore-errors",
  "-i",
  "--no-progress",
]);
/** Flags with a value that change nothing about the answer (the cookies file: the API needs no sign-in). */
const VALUE_FLAGS = new Set(["--encoding", "--cookies"]);
/** The fields a --print template may use. */
const FIELDS = new Set([
  "id",
  "title",
  "channel",
  "uploader",
  "channel_id",
  "duration",
  "view_count",
  "url",
  "webpage_url",
  "description",
  "live_status",
]);

const DAY = 24 * 3_600_000;

const decodeAll = (v: string): string => {
  let out = v;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
};

/** True when every %(...) in the template is a plain field the API can fill (pure). */
export function printableTemplate(template: string): boolean {
  const rest = template.replace(/%\((\w+)\)[sd]/g, (_, f: string) =>
    FIELDS.has(f) ? "" : "\u0000",
  );
  // A template with no field at all ("id", yt-dlp's shorthand for %(id)s) is left to yt-dlp.
  return template.includes("%(") && !rest.includes("\u0000") && !rest.includes("%");
}

/**
 * The search a yt-dlp call asks for, when the Data API can answer it in the same shape (pure); undefined otherwise.
 * `now` places "this week" for the views filter.
 */
export function parseSearchCall(
  args: readonly string[],
  now: number,
): ApiSearchCall | undefined {
  let target: string | undefined;
  let playlistEnd: number | undefined;
  let template: string | undefined;
  let dump = false;
  let flat = false;
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === "--flat-playlist") flat = true;
    if (PLAIN_FLAGS.has(a)) continue;
    if (VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a === "--dump-json" || a === "-j") {
      dump = true;
      continue;
    }
    if (a === "--playlist-end") {
      playlistEnd = Number(args[++i]);
      if (!Number.isInteger(playlistEnd) || playlistEnd <= 0) return undefined;
      continue;
    }
    if (a === "--print" || a === "-O") {
      if (template !== undefined) return undefined; // two templates: leave it to yt-dlp
      template = String(args[++i] ?? "");
      continue;
    }
    if (a.startsWith("-")) return undefined; // anything else might change the answer
    if (target !== undefined) return undefined;
    target = a;
  }
  if (!flat || !target || dump === (template !== undefined)) return undefined;
  if (template !== undefined && !printableTemplate(template)) return undefined;
  const output: ApiSearchCall["output"] =
    template !== undefined ? { kind: "print", template } : { kind: "dump" };
  const cap = (n: number) =>
    Math.max(1, Math.min(50, playlistEnd ? Math.min(n, playlistEnd) : n));
  const ys = /^ytsearch(date)?(\d*):([\s\S]+)$/i.exec(target);
  if (ys) {
    const query = ys[3]!.trim();
    if (!query) return undefined;
    return {
      query,
      max: cap(ys[2] ? Number(ys[2]) : 1),
      order: ys[1] ? "date" : "relevance",
      output,
    };
  }
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return undefined;
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname) || url.pathname !== "/results")
    return undefined;
  const query = (url.searchParams.get("search_query") ?? "").trim();
  if (!query) return undefined;
  for (const k of url.searchParams.keys())
    if (k !== "search_query" && k !== "sp") return undefined;
  const call: ApiSearchCall = {
    query,
    max: cap(50),
    order: "relevance",
    output,
  };
  const sp = url.searchParams.get("sp");
  if (sp !== null) {
    const f = decodeAll(sp);
    if (f === "CAMSAggD") {
      call.order = "viewCount";
      call.publishedAfter = new Date(now - 7 * DAY)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z");
    } else if (f === "EgIwAQ==") call.creativeCommons = true;
    else return undefined;
  }
  return call;
}

/** Seconds in an ISO 8601 duration ("PT1H2M3S", "P1DT2H"); undefined when unreadable (pure). */
export function isoSeconds(d: string | undefined): number | undefined {
  const m =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      String(d ?? ""),
    );
  if (!m) return undefined;
  const [, dd, hh, mm, ss] = m;
  return (
    Number(dd ?? 0) * 86400 +
    Number(hh ?? 0) * 3600 +
    Number(mm ?? 0) * 60 +
    Number(ss ?? 0)
  );
}

/** The search API's snippets come HTML-escaped (pure). */
export function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** One video as yt-dlp's flat search entry. */
export interface FlatEntry {
  _type: "url";
  ie_key: "Youtube";
  id: string;
  url: string;
  webpage_url: string;
  title: string;
  description: string;
  duration: number | null;
  channel_id: string | null;
  channel: string | null;
  channel_url: string | null;
  uploader: string | null;
  view_count: number | null;
  live_status: string | null;
  is_live: boolean | null;
}

/** Fills a --print template from an entry, "NA" for a missing value as yt-dlp does (pure). */
export function renderTemplate(template: string, e: FlatEntry): string {
  return template.replace(/%\((\w+)\)([sd])/g, (_, f: string) => {
    const v = (e as unknown as Record<string, unknown>)[f];
    return v === null || v === undefined || v === "" ? "NA" : String(v);
  });
}

/** True for the API's "quota used up" answers (pure): the guard stops API searches until the Pacific day turns. */
export function isApiQuotaError(text: string): boolean {
  // A per-second rate limit (rateLimitExceeded) is not the day's quota: the next search may try again.
  return /quotaExceeded|dailyLimitExceeded/i.test(text);
}

async function getJson(
  get: ApiGet,
  base: string,
  params: Record<string, string>,
  key: string,
): Promise<any> {
  const q = new URLSearchParams({ ...params, key });
  const res = await get(`https://www.googleapis.com/youtube/v3/${base}?${q}`);
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const reason = String(
      body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "",
    );
    // Only the status and Google's reason word: the request (and its key) is never repeated.
    throw new Error(
      `YouTube Data API ${base} HTTP ${res.status}${reason ? ` ${reason}` : ""}`,
    );
  }
  return body;
}

/** Runs the search on the Data API and prints the answer as yt-dlp would have (one line per video). */
export async function apiSearch(
  call: ApiSearchCall,
  key: string,
  get: ApiGet,
): Promise<string> {
  const params: Record<string, string> = {
    part: "snippet",
    type: "video",
    maxResults: String(call.max),
    q: call.query,
    order: call.order,
  };
  if (call.publishedAfter) params.publishedAfter = call.publishedAfter;
  if (call.creativeCommons) params.videoLicense = "creativeCommon";
  const found = await getJson(get, "search", params, key);
  const hits: any[] = (Array.isArray(found?.items) ? found.items : []).filter(
    (i: any) =>
      typeof i?.id?.videoId === "string" && /^[\w-]{11}$/.test(i.id.videoId),
  );
  if (!hits.length) return "";
  const details = await getJson(
    get,
    "videos",
    {
      part: "snippet,contentDetails,statistics,liveStreamingDetails",
      id: hits.map((h) => h.id.videoId).join(","),
      maxResults: "50",
    },
    key,
  );
  const byId = new Map<string, any>(
    (Array.isArray(details?.items) ? details.items : []).map((v: any) => [
      String(v?.id),
      v,
    ]),
  );
  const entries: FlatEntry[] = hits.map((h) => {
    const id = String(h.id.videoId);
    const v = byId.get(id);
    const sn = v?.snippet ?? h.snippet ?? {};
    const fromSearch = !v?.snippet;
    const text = (s: unknown) =>
      typeof s === "string" ? (fromSearch ? unescapeHtml(s) : s) : "";
    const live = String(
      sn.liveBroadcastContent ?? h.snippet?.liveBroadcastContent ?? "none",
    );
    const views = Number(v?.statistics?.viewCount);
    const channelId =
      typeof sn.channelId === "string" && sn.channelId ? sn.channelId : null;
    const channel = text(sn.channelTitle) || null;
    return {
      _type: "url",
      ie_key: "Youtube",
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      webpage_url: `https://www.youtube.com/watch?v=${id}`,
      title: text(sn.title),
      description: text(sn.description),
      duration: isoSeconds(v?.contentDetails?.duration) ?? null,
      channel_id: channelId,
      channel,
      channel_url: channelId
        ? `https://www.youtube.com/channel/${channelId}`
        : null,
      uploader: channel,
      view_count: Number.isFinite(views) ? views : null,
      // A finished livestream is "was_live", as yt-dlp says, so callers drop it before asking for its details.
      live_status:
        live === "live"
          ? "is_live"
          : live === "upcoming"
            ? "is_upcoming"
            : v?.liveStreamingDetails?.actualEndTime
              ? "was_live"
              : null,
      is_live: live === "live" ? true : null,
    };
  });
  const lines =
    call.output.kind === "dump"
      ? entries.map((e) => JSON.stringify(e))
      : entries.map((e) =>
          renderTemplate((call.output as { template: string }).template, e),
        );
  return lines.join("\n") + "\n";
}
