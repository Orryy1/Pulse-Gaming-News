// Polite fetching for the new source harvesters (press kits, achievement data, wiki leads; 20 Nov 2026). Every
// request names itself, reads the host's robots.txt first and keeps to it, waits between requests to one host (the
// host's Crawl-delay when it gives one, else POLITE_GAP_MS) and never follows a login wall. A host whose robots.txt
// without one (404) is treated as allowing everything; one whose robots.txt cannot be reached (a network error or a
// 5xx) as allowing nothing for now, as RFC 9309 says, and asked again next time; a host that answers robots.txt with a
// bot challenge (403/429/503 HTML) is treated as refusing automated readers, unless its rules were read by hand.
// robots.txt is kept for a day. Every redirect hop is checked too. One shared fetcher (sharedPolite) paces each host
// across every harvester in the process.
//
// The parser follows RFC 9309: the group for our own token wins over "*", the longest matching rule wins, Allow wins
// a tie, "*" and "$" work as wildcards.

import { fetchWithTimeout, log } from "../lib/util.ts";

/** Our name in every request and the token robots.txt groups are matched against. */
export const POLITE_TOKEN = "PulseGamingFactory";
export const POLITE_UA = `${POLITE_TOKEN}/1.0 (+https://pulsegmg.com; editorial research for a gaming news channel)`;
/** The least time between two requests to one host. */
export const POLITE_GAP_MS = 1500;

export interface RobotsRules {
  /** Rules for the group that applies to us, in file order. */
  rules: Array<{ allow: boolean; path: string }>;
  crawlDelaySeconds?: number;
  /** The host turned automated readers away at robots.txt itself (a bot challenge): nothing may be fetched. */
  refused?: boolean;
}

/** The rules for `token` in a robots.txt (pure): our own group if there is one, else "*", else none. */
export function parseRobots(text: string, token = POLITE_TOKEN): RobotsRules {
  type Group = {
    agents: string[];
    rules: RobotsRules["rules"];
    delay?: number;
  };
  const groups: Group[] = [];
  let cur: Group | undefined;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") {
      if (value === "" && key === "disallow") continue; // "Disallow:" with nothing allows everything
      cur.rules.push({ allow: key === "allow", path: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) cur.delay = n;
    }
  }
  const t = token.toLowerCase();
  const mine = groups.filter((g) =>
    g.agents.some((a) => a !== "" && a !== "*" && t.startsWith(a)),
  );
  const chosen = mine.length
    ? mine
    : groups.filter((g) => g.agents.includes("*"));
  const delay = chosen.map((g) => g.delay).find((d) => d !== undefined);
  return {
    rules: chosen.flatMap((g) => g.rules),
    ...(delay !== undefined ? { crawlDelaySeconds: delay } : {}),
  };
}

/** A robots.txt path pattern as a regular expression ("*" any run, "$" the end). */
function patternOf(p: string): RegExp {
  const anchored = p.endsWith("$");
  const body = (anchored ? p.slice(0, -1) : p)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Whether a URL's path and query may be fetched under these rules (pure). */
export function robotsAllows(rules: RobotsRules, url: string): boolean {
  if (rules.refused) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const target = `${u.pathname}${u.search}`;
  let best: { allow: boolean; len: number } | undefined;
  for (const r of rules.rules) {
    if (!r.path) continue;
    if (!patternOf(r.path).test(target)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow))
      best = { allow: r.allow, len };
  }
  return best ? best.allow : true;
}

/** Pages that ask for a sign-in: never followed, whatever robots.txt says. */
export const LOGIN_WALL =
  /\/(log-?in|sign-?in|signin|account\/login|user\/login|auth|register|sso)(\/|\?|$)|[?&](returnurl|redirect_uri)=/i;

export interface PoliteOptions {
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  gapMs?: number;
  timeoutMs?: number;
  /** A clock and a sleep, for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Rules read by hand for hosts whose robots.txt sits behind a bot challenge (by host name), used instead of
   * treating the challenge as a refusal. Each must record what the file said and when it was read.
   */
  robotsByHand?: (host: string) => RobotsRules | undefined;
}

/**
 * Fandom's robots.txt answers automated readers with a bot challenge, but read in a browser on 20 Nov 2026 it says,
 * for every user agent: "Allow: /api.php?" and "Allow: /api.php?action=" (and the same for each language path).
 * Only the API is opened here; every other Fandom path stays closed to us.
 */
export const FANDOM_ROBOTS: RobotsRules = {
  rules: [
    { allow: true, path: "/api.php?" },
    { allow: false, path: "/" },
  ],
};

/** The hand-read rules the harvesters use (pure). */
export const robotsByHand = (host: string): RobotsRules | undefined =>
  /(^|\.)fandom\.com$/i.test(host) ? FANDOM_ROBOTS : undefined;

export class RobotsRefused extends Error {
  constructor(url: string, why: string) {
    super(`not fetched (${why}): ${url}`);
    this.name = "RobotsRefused";
  }
}


/** robots.txt is read again after this long. */
export const ROBOTS_TTL_MS = 24 * 3_600_000;
/** The longest a request waits for its turn at a host; a longer Crawl-delay queue refuses instead of stalling. */
export const MAX_WAIT_MS = 20_000;

export interface PoliteState {
  robots: Map<string, { at: number; rules: Promise<RobotsRules> }>;
  nextAt: Map<string, number>;
  warned: Set<string>;
}

export const newPoliteState = (): PoliteState => ({ robots: new Map(), nextAt: new Map(), warned: new Set() });

/**
 * A fetcher that keeps to robots.txt and a per-host pace. A refused URL throws RobotsRefused (callers treat it like a
 * failed request). Fetchers built on the same `state` share their pacing and robots.txt cache.
 */
export function politeFetcher(o: PoliteOptions & { state?: PoliteState; maxWaitMs?: number } = {}) {
  const raw =
    o.fetchFn ?? ((url: string, init?: RequestInit) => fetchWithTimeout(url, init ?? {}, o.timeoutMs ?? 30_000));
  const now = o.now ?? (() => Date.now());
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const state = o.state ?? newPoliteState();
  const maxWait = o.maxWaitMs ?? MAX_WAIT_MS;
  const headers = { "user-agent": POLITE_UA };

  const pace = async (url: string, origin: string, rules?: RobotsRules) => {
    const gap = Math.max(o.gapMs ?? POLITE_GAP_MS, (rules?.crawlDelaySeconds ?? 0) * 1000);
    const at = state.nextAt.get(origin) ?? 0;
    const t = now();
    if (at - t > maxWait) throw new RobotsRefused(url, "the host's pace would keep it waiting too long");
    state.nextAt.set(origin, Math.max(t, at) + gap);
    if (at > t) await sleep(at - t);
  };

  const readRules = async (origin: string): Promise<RobotsRules & { retry?: boolean }> => {
    await pace(`${origin}/robots.txt`, origin);
    const res = await raw(`${origin}/robots.txt`, { headers, redirect: "follow" }).catch(() => undefined);
    // Unreachable: nothing is allowed for now, and robots.txt is asked again next time (RFC 9309).
    if (!res) return { rules: [{ allow: false, path: "/" }], retry: true };
    const type = res.headers.get("content-type") ?? "";
    const body = await res.text().catch(() => "");
    // A bot challenge in place of robots.txt: the host does not want automated readers (unless read by hand).
    if ([403, 429, 503].includes(res.status) && /html/i.test(type) && /just a moment|cf-challenge|captcha/i.test(body)) {
      const host = new URL(origin).hostname;
      const byHand = (o.robotsByHand ?? robotsByHand)(host);
      if (!byHand && !state.warned.has(host)) {
        state.warned.add(host);
        log("info", "host answers robots.txt with a bot challenge: not asked", { host });
      }
      return byHand ?? { rules: [], refused: true };
    }
    if (res.status >= 500) return { rules: [{ allow: false, path: "/" }], retry: true };
    if (!res.ok || /html/i.test(type)) return { rules: [] }; // no robots.txt: everything allowed
    return parseRobots(body);
  };

  const rulesFor = async (origin: string): Promise<RobotsRules> => {
    const hit = state.robots.get(origin);
    if (hit && now() - hit.at < ROBOTS_TTL_MS) return hit.rules;
    const p = readRules(origin);
    state.robots.set(origin, { at: now(), rules: p });
    const r = await p;
    if (r.retry) state.robots.delete(origin);
    return r;
  };

  const check = async (url: string): Promise<RobotsRules> => {
    if (LOGIN_WALL.test(url)) throw new RobotsRefused(url, "login wall");
    const rules = await rulesFor(new URL(url).origin);
    if (!robotsAllows(rules, url)) throw new RobotsRefused(url, rules.refused ? "bot challenge" : "robots.txt");
    return rules;
  };

  const fetchPolitely = async (url: string, init: RequestInit = {}): Promise<Response> => {
    let at = url;
    // Redirects are followed by hand so every hop meets robots.txt and the login-wall rule.
    for (let hop = 0; hop < 6; hop++) {
      const rules = await check(at);
      await pace(at, new URL(at).origin, rules);
      const res = await raw(at, { ...init, redirect: "manual", headers: { ...headers, ...(init.headers ?? {}) } });
      const next = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && next) {
        at = new URL(next, at).toString();
        continue;
      }
      return res;
    }
    throw new RobotsRefused(url, "too many redirects");
  };

  return Object.assign(fetchPolitely, {
    /** Whether robots.txt lets us fetch this URL (reads robots.txt once per host a day). */
    allowed: async (url: string) => {
      try {
        await check(url);
        return true;
      } catch {
        return false;
      }
    },
  });
}

export type PoliteFetch = ReturnType<typeof politeFetcher>;

let shared: PoliteFetch | undefined;
/** The process's one polite fetcher: every harvester shares its per-host pace and robots.txt cache. */
export function sharedPolite(): PoliteFetch {
  return (shared ??= politeFetcher());
}