// robots.txt for the wiki art crawler (src/wikiart/crawl.ts), read the way RFC 9309 says: the group for our product
// token if there is one, else the "*" group; the longest matching rule wins and Allow wins a tie; "*" and "$" in
// paths. A robots.txt that answers 4xx means "no rules" (RFC 9309 2.3.1.3); a 5xx or no answer means "keep off"
// until it can be read. Crawl-delay is honoured when it is longer than our own gap.
//
// Fandom sits behind a Cloudflare challenge that answers every non-browser robots.txt request with 403 (which RFC
// 9309 would read as "no rules"). We do not lean on that: FANDOM_ROBOTS below is the "*" group Fandom actually
// serves, read in a real browser on 20 Nov 2026 (gta.fandom.com/robots.txt), and is used for *.fandom.com instead.

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface Robots {
  rules: RobotsRule[];
  /** Seconds, when the group sets one. */
  crawlDelay?: number;
  /** Where the rules came from, for the crawl log. */
  source: string;
  /** Keep off the whole host (robots.txt could not be read: 5xx or no answer). */
  blocked?: boolean;
}

/** The product token our User-Agent leads with; a robots.txt group naming it applies before "*". */
export const ROBOTS_TOKEN = "pulsewikiart";

/** The rules for a robots.txt body (pure). */
export function parseRobots(body: string, source = "robots.txt"): Robots {
  type Group = { agents: string[]; rules: RobotsRule[]; crawlDelay?: number };
  const groups: Group[] = [];
  let cur: Group | undefined;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
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
      // An empty Disallow allows everything; an empty Allow says nothing.
      if (value) cur.rules.push({ allow: key === "allow", path: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) cur.crawlDelay = n;
    }
  }
  const mine = groups.filter((g) =>
    g.agents.some(
      (a) =>
        // RFC 9309: the whole product token, case-insensitively (agents are lower-cased above).
        a.replace(/\/.*$/, "").trim() === ROBOTS_TOKEN,
    ),
  );
  const chosen = mine.length
    ? mine
    : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const delays = chosen
    .map((g) => g.crawlDelay)
    .filter((d): d is number => d !== undefined);
  return {
    rules,
    ...(delays.length ? { crawlDelay: Math.max(...delays) } : {}),
    source,
  };
}

/** A robots.txt path pattern as a regular expression ("*" any run, "$" the end). */
function patternRegex(p: string): RegExp {
  const anchored = p.endsWith("$");
  const body = (anchored ? p.slice(0, -1) : p)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Percent-encoding normalised so "/wiki/Special%3A" and "/wiki/Special:" compare alike. */
function norm(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** Whether a path with its query ("/api.php?action=query&...") may be fetched (pure). */
export function robotsAllows(robots: Robots, pathAndQuery: string): boolean {
  if (robots.blocked) return false;
  const target = norm(pathAndQuery);
  let best: RobotsRule | undefined;
  for (const r of robots.rules) {
    if (!patternRegex(norm(r.path)).test(target)) continue;
    // Lengths on the decoded path, the same form the match used.
    const len = norm(r.path).replace(/\$$/, "").length;
    const bestLen = best ? norm(best.path).replace(/\$$/, "").length : -1;
    if (len > bestLen || (len === bestLen && r.allow && !best!.allow)) best = r;
  }
  return best ? best.allow : true;
}

/** The "*" group Fandom serves (read in a browser on 20 Nov 2026; English paths, the language copies are alike). */
export const FANDOM_ROBOTS = `User-agent: *
Allow: /api.php?
Allow: /api.php?action=
Allow: /api.php?*&action=
Allow: /wiki/Special:CreateNewWiki
Allow: /wiki/Special:AllMaps
Allow: /wiki/Special:GameUtility/
Disallow: /wiki/Special:
Disallow: /wiki/User_talk:
Disallow: /wiki/Template:
Disallow: /wiki/Template_talk:
Disallow: /wiki/Help:
Disallow: /wiki/User:
Disallow: /wiki/UserProfile:
`;

/** Rules pinned for hosts whose robots.txt only a browser can read (pure). */
export function pinnedRobots(host: string): Robots | undefined {
  if (/(^|\.)fandom\.com$/i.test(host))
    return parseRobots(
      FANDOM_ROBOTS,
      "pinned copy of Fandom's robots.txt (read 20 Nov 2026)",
    );
  return undefined;
}

/** What a robots.txt answer means (pure): the rules, "no rules" for 4xx, "keep off" for 5xx or nothing. */
export function robotsFromResponse(
  host: string,
  status: number | undefined,
  contentType: string,
  body: string,
): Robots {
  const pinned = pinnedRobots(host);
  if (
    status !== undefined &&
    status >= 200 &&
    status < 300 &&
    /text\/plain/i.test(contentType)
  )
    return parseRobots(body);
  if (pinned) return pinned;
  if (status !== undefined && status >= 400 && status < 500)
    return {
      rules: [],
      source: `robots.txt answered ${status}: no rules (RFC 9309)`,
    };
  // A 2xx that is not text (a challenge page) tells us nothing either: keep off rather than guess.
  return {
    rules: [],
    blocked: true,
    source: `robots.txt unreadable (${status ?? "no answer"}${status && status < 300 ? `, ${contentType || "no type"}` : ""}): keeping off`,
  };
}
