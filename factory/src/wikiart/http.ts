// The wiki art crawler's only way onto the web: one polite client per run. Every request names the tool in its
// User-Agent (no personal details), checks the host's robots.txt first, waits at least WIKIART_GAP_MS (default
// 1.5 s, never under 1 s) since the last request to the same host (longer when robots.txt asks), and backs off on
// 429 and 5xx (Retry-After honoured, doubling waits, then the host is rested for the rest of the run). A 403 rests
// the host too: we never push past a site that turns us away.

import { errorMessage, fetchWithTimeout } from "../lib/util.ts";
import { robotsAllows, robotsFromResponse, type Robots } from "./robots.ts";

export const USER_AGENT =
  "PulseWikiArt/1.0 (official game art indexer for a gaming news channel; MediaWiki API, 1 request per 1.5 s per site)";

export interface PoliteOptions {
  /** The least gap between two requests to one host, in ms (floored at 1000). */
  gapMs?: number;
  /** Retries after a 429 or 5xx before the host is rested for the run. */
  retries?: number;
  /** For tests: the fetch to use and a clock. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

export class HostRested extends Error {}
export class RobotsDenied extends Error {}

export class PoliteClient {
  private robots = new Map<string, Promise<Robots>>();
  private last = new Map<string, number>();
  private queue = new Map<string, Promise<unknown>>();
  private rested = new Map<string, string>();
  readonly gapMs: number;
  private retries: number;
  private fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private log: (line: string) => void;
  /** Requests made, by host, for the run report. */
  readonly counts = new Map<string, number>();

  constructor(o: PoliteOptions = {}) {
    this.gapMs = Math.max(
      1000,
      o.gapMs ?? Number(process.env.WIKIART_GAP_MS ?? 1500),
    );
    this.retries = o.retries ?? 3;
    this.fetchImpl =
      o.fetchImpl ?? ((url, init) => fetchWithTimeout(url, init, 60_000));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((l) => console.log(l));
  }

  /** Why a host is rested for this run, if it is. */
  restedWhy(host: string): string | undefined {
    return this.rested.get(host);
  }

  private async robotsFor(origin: string, host: string): Promise<Robots> {
    let p = this.robots.get(host);
    if (!p) {
      p = (async () => {
        let status: number | undefined;
        let type = "";
        let body = "";
        try {
          const res = await this.timed(host, () =>
            this.fetchImpl(`${origin}/robots.txt`, {
              headers: { "user-agent": USER_AGENT },
            }),
          );
          status = res.status;
          type = res.headers.get("content-type") ?? "";
          body = await res.text();
        } catch (err) {
          this.log(`  robots.txt for ${host}: ${errorMessage(err)}`);
        }
        const r = robotsFromResponse(host, status, type, body);
        this.log(
          `  robots.txt for ${host}: ${r.source}${r.crawlDelay ? `, crawl-delay ${r.crawlDelay}s` : ""}`,
        );
        return r;
      })();
      this.robots.set(host, p);
    }
    return p;
  }

  /** Runs one request for a host after its gap; requests to one host go one at a time. */
  private timed<T>(
    host: string,
    go: () => Promise<T>,
    extraGapMs = 0,
  ): Promise<T> {
    const prev = this.queue.get(host) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const wait =
          (this.last.get(host) ?? 0) + this.gapMs + extraGapMs - this.now();
        if (wait > 0) await this.sleep(wait);
        try {
          return await go();
        } finally {
          this.last.set(host, this.now());
          this.counts.set(host, (this.counts.get(host) ?? 0) + 1);
        }
      });
    this.queue.set(host, next);
    return next;
  }

  /** Whether robots.txt lets us fetch this URL (reads robots.txt once per host per run). */
  async allowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const r = await this.robotsFor(u.origin, u.host);
    return robotsAllows(r, u.pathname + u.search);
  }

  /** Keeps every caller off a host for a backoff wait, not only the one that was told to wait. */
  private holdHost(host: string, ms: number): void {
    this.last.set(host, Math.max(this.last.get(host) ?? 0, this.now() + ms));
  }

  /** A polite GET: robots first, the host's gap, backoff on 429/5xx. Throws RobotsDenied or HostRested. */
  async get(
    url: string,
    accept = "application/json",
    hops = 0,
  ): Promise<Response> {
    const u = new URL(url);
    const host = u.host;
    const why = this.rested.get(host);
    if (why) throw new HostRested(`${host} is rested for this run: ${why}`);
    const robots = await this.robotsFor(u.origin, host);
    if (!robotsAllows(robots, u.pathname + u.search))
      throw new RobotsDenied(
        `robots.txt (${robots.source}) keeps us off ${u.pathname}`,
      );
    const extra = Math.max(0, (robots.crawlDelay ?? 0) * 1000 - this.gapMs);
    let backoff = 30_000;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.timed(
          host,
          () =>
            // Redirects are followed here, not by fetch, so the new host's robots.txt and gap apply too.
            this.fetchImpl(url, {
              headers: { "user-agent": USER_AGENT, accept },
              redirect: "manual",
            }),
          extra,
        );
      } catch (err) {
        if (attempt >= this.retries) {
          this.rested.set(
            host,
            `no answer after ${attempt + 1} tries (${errorMessage(err)})`,
          );
          throw new HostRested(this.rested.get(host));
        }
        this.log(`  ${host}: ${errorMessage(err)}; waiting ${backoff / 1000}s`);
        this.holdHost(host, backoff);
        await this.sleep(backoff);
        backoff *= 2;
        continue;
      }
      if (res.status === 403) {
        await res.body?.cancel().catch(() => undefined);
        this.rested.set(host, "403 (the site turned us away)");
        throw new HostRested(`${host}: 403, rested for this run`);
      }
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel().catch(() => undefined);
        if (attempt >= this.retries) {
          this.rested.set(host, `${res.status} after ${attempt + 1} tries`);
          throw new HostRested(`${host}: ${res.status}, rested for this run`);
        }
        const ra = Number(res.headers.get("retry-after"));
        const wait =
          Number.isFinite(ra) && ra > 0
            ? Math.min(ra * 1000, 15 * 60_000)
            : backoff;
        this.log(
          `  ${host}: ${res.status}; waiting ${Math.round(wait / 1000)}s`,
        );
        this.holdHost(host, wait);
        await this.sleep(wait);
        backoff *= 2;
        continue;
      }
      if (
        res.status >= 300 &&
        res.status < 400 &&
        res.headers.get("location")
      ) {
        await res.body?.cancel().catch(() => undefined);
        if (hops >= 5) throw new Error(`${host}: too many redirects`);
        return this.get(
          new URL(res.headers.get("location")!, url).href,
          accept,
          hops + 1,
        );
      }
      return res;
    }
  }

  /** A MediaWiki API call (formatversion 2, maxlag 5 so a busy wiki can ask us to wait). */
  async api(apiUrl: string, params: Record<string, string>): Promise<any> {
    const qs = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      maxlag: "5",
      ...params,
    });
    for (let lag = 0; lag < 4; lag++) {
      const res = await this.get(`${apiUrl}?${qs}`);
      if (!res.ok)
        throw new Error(`${new URL(apiUrl).host} answered ${res.status}`);
      const json = (await res.json()) as any;
      if (json?.error?.code === "maxlag") {
        this.log(`  ${new URL(apiUrl).host}: the wiki is lagging; waiting 30s`);
        this.holdHost(new URL(apiUrl).host, 30_000);
        await this.sleep(30_000);
        continue;
      }
      if (json?.error)
        throw new Error(
          `${new URL(apiUrl).host}: ${json.error.code}: ${json.error.info}`,
        );
      return json;
    }
    throw new Error(`${new URL(apiUrl).host}: still lagging after four waits`);
  }
}
