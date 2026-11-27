// STORE_TRAILERS (25 Nov 2026): official trailers straight from the platform stores' own public product data and CDNs,
// so the factory has publisher footage that does not depend on YouTube (its bot block refused our downloads eight
// times and holds until 26 Nov). We never work around a block: no proxies, no browser disguise, no tokens, no
// CAPTCHAs. The client below identifies itself honestly, reads robots.txt, waits at least 1.5 s between requests to
// one host (longer where robots.txt asks), caches every answer on disk and, on a 403 or 429, stops asking that host
// for a day.
//
// What works without signing in (researched 25 Nov 2026 from the PC):
//   - Microsoft Store / Xbox: the public catalog (displaycatalog.mp.microsoft.com) finds the product and lists its
//     trailers (CMSVideos) as HLS on cdn.trailers.xboxservices.com, up to 1080p. Some products host theirs on
//     cdn-dynmedia-1.microsoft.com instead, which answers this PC "Client IP address forbidden" (403): those are
//     skipped, never fetched another way (Halo Infinite's two trailers, 25 Nov).
//   - PlayStation: the game's page on playstation.com (found through its robots-listed sitemap) names the store
//     product; the store's product page carries its preview videos as plain mp4 files on vulcan.dl.playstation.net,
//     and the playstation.com page its own gameplay videos on gmedia.playstation.com. The store's GraphQL host
//     (web.np.playstation.com) refuses robots.txt itself, so it is not used.
//   - Epic Games Store: store-content-ipv4.ak.epicgames.com serves the product page data by its slug, with the
//     carousel's videos as HLS on media-cdn.epicgames.com. The storefront and its search sit behind a Cloudflare
//     challenge, so products are found by slug only (the game's name, or the asked store term).
//   - Nintendo eShop: the US store sitemap (listed in robots.txt) finds the product page, whose page data names its
//     trailers on assets.nintendo.com as mp4 files.
//   - Not used: Gamersyde (its robots.txt content signal allows reference use only, not re-use in our videos) and
//     GOG (its product videos are YouTube embeds).
//
// The trailers go through the same route as the publisher-site trailers of the game library
// (src/assets/officialTrailer.ts siteTrailerMedia): the same clip matching, text check, per-publisher budget
// (PUBLISHER_FOOTAGE_SECONDS) and rights label, here "Official trailer (<store>)". They run after Steam and the
// library and before any YouTube search. Pure parsers and the matcher are exported for the tests, which use recorded
// fixtures and make no network calls.

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { log, errorMessage } from "../lib/util.ts";
import { EDITION, steamEditionOf } from "./steamedition.ts";

/** The honest name every request carries (the factory's own bot name, with what this part does). */
export const STORE_USER_AGENT =
  "PulseGamingNewsBot/1.0 StoreTrailers (+https://pulsegmg.com)";
/** The token robots.txt groups are matched against. */
export const ROBOTS_TOKEN = "pulsegamingnewsbot";
/** The shortest wait between two requests to one host. */
export const MIN_GAP_MS = 1500;
/** After a 403 or 429 a host is left alone this long (a Retry-After header that asks for longer wins). */
export const BLOCK_HOURS = 24;
/** No single trailer file larger than this is downloaded. */
export const MAX_TRAILER_BYTES = 700 * 1024 * 1024;

export type StoreId = "playstation" | "xbox" | "epic" | "nintendo";
export const STORE_IDS: StoreId[] = ["playstation", "xbox", "epic", "nintendo"];

/** The store a rights label names. */
export const STORE_LABEL: Record<StoreId, string> = {
  playstation: "PlayStation Store",
  xbox: "Microsoft Store",
  epic: "Epic Games Store",
  nintendo: "Nintendo eShop",
};

/** The rights label of a store trailer, as it goes in provenance and the description. */
export function rightsLabel(host: string): string {
  return `Official trailer (${host})`;
}

// ---------------------------------------------------------------------------------------------------------
// robots.txt

export interface Robots {
  allowed(pathAndQuery: string): boolean;
  /** Seconds robots.txt asks between requests, for our group. */
  crawlDelay?: number;
}

const ALLOW_ALL: Robots = { allowed: () => true };
const DENY_ALL: Robots = { allowed: () => false };

/**
 * robots.txt for one agent (RFC 9309): the groups naming our token, else the "*" groups merged; the longest matching
 * rule wins and Allow wins a tie. `*` matches anything and a trailing `$` anchors the end (pure).
 */
export function parseRobots(text: string, token = ROBOTS_TOKEN): Robots {
  type Group = {
    agents: string[];
    rules: Array<{ allow: boolean; pattern: string }>;
    delay?: number;
  };
  const groups: Group[] = [];
  let cur: Group | undefined;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") {
      if (val) cur.rules.push({ allow: key === "allow", pattern: val });
      else if (key === "disallow") continue; // "Disallow:" with nothing allows everything
    } else if (key === "crawl-delay" && Number.isFinite(Number(val)))
      cur.delay = Number(val);
  }
  const mine = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && a === token),
  );
  const chosen = mine.length
    ? mine
    : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const delays = chosen
    .map((g) => g.delay)
    .filter((d): d is number => d !== undefined);
  const toRe = (p: string) => {
    const end = p.endsWith("$");
    const body = (end ? p.slice(0, -1) : p)
      .split("*")
      .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${body}${end ? "$" : ""}`);
  };
  const compiled = rules.map((r) => ({
    ...r,
    re: toRe(r.pattern),
    len: r.pattern.replace(/[*$]/g, "").length,
  }));
  return {
    crawlDelay: delays.length ? Math.max(...delays) : undefined,
    allowed(p: string) {
      let best: { allow: boolean; len: number } | undefined;
      for (const r of compiled)
        if (
          r.re.test(p) &&
          (!best || r.len > best.len || (r.len === best.len && r.allow))
        )
          best = { allow: r.allow, len: r.len };
      return best ? best.allow : true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// The polite client: robots.txt, a gap per host, a disk cache, and a stop on 403/429.

export interface PoliteOptions {
  /** Where answers, blocks and trailer files are kept. */
  cacheDir: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minGapMs?: number;
  blockHours?: number;
  timeoutMs?: number;
}

export interface Fetched {
  status: number;
  body?: string;
  /** From the disk cache, no request made. */
  cached?: boolean;
  /** Not asked: robots.txt forbids it, or the host is backed off. */
  refused?: "robots" | "blocked";
}

interface Block {
  until: number;
  status: number;
  url: string;
}

export class PoliteClient {
  readonly stats = {
    requests: 0,
    cacheHits: 0,
    refusedRobots: [] as string[],
    blocked: [] as string[],
  };
  private readonly fetchImpl: NonNullable<PoliteOptions["fetchImpl"]>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly gap: number;
  private readonly blockMs: number;
  private readonly timeoutMs: number;
  private readonly chains = new Map<string, Promise<void>>();
  private readonly last = new Map<string, number>();
  /** robots.txt per origin, re-read after a day (a failed read after ten minutes) in a long-running process. */
  private readonly robots = new Map<string, { at: number; ttl: number; p: Promise<Robots> }>();
  private blocks?: { at: number; map: Record<string, Block> };

  constructor(readonly o: PoliteOptions) {
    this.fetchImpl = o.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.gap = Math.max(MIN_GAP_MS, o.minGapMs ?? MIN_GAP_MS);
    this.blockMs = (o.blockHours ?? BLOCK_HOURS) * 3_600_000;
    this.timeoutMs = o.timeoutMs ?? 30_000;
  }

  private cachePath(url: string): string {
    return path.join(
      this.o.cacheDir,
      "http",
      `${crypto.createHash("sha1").update(url).digest("hex")}.json`,
    );
  }

  private async readBlocks(): Promise<Record<string, Block>> {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.o.cacheDir, "blocks.json"), "utf8"),
      ) as Record<string, Block>;
    } catch {
      return {};
    }
  }

  /** The blocks, re-read from disk at most once a minute so another process's stop is seen too. */
  private async loadBlocks(): Promise<Record<string, Block>> {
    if (this.blocks && this.now() - this.blocks.at < 60_000) return this.blocks.map;
    this.blocks = { at: this.now(), map: { ...(this.blocks?.map ?? {}), ...(await this.readBlocks()) } };
    return this.blocks.map;
  }

  /** True while a host is backed off after a 403 or 429. */
  async isBlocked(host: string): Promise<boolean> {
    const b = (await this.loadBlocks())[host];
    return !!b && b.until > this.now();
  }

  private async block(
    host: string,
    status: number,
    url: string,
    retryAfter: string | null,
  ): Promise<void> {
    const asked = Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : 0;
    const entry = { until: this.now() + Math.max(this.blockMs, asked), status, url };
    // Merged with what is on disk now, so another process's blocks are kept.
    const map = { ...(await this.readBlocks()), ...(this.blocks?.map ?? {}), [host]: entry };
    this.blocks = { at: this.now(), map };
    if (!this.stats.blocked.includes(host)) this.stats.blocked.push(host);
    log("warn", "store trailers: host refused us; leaving it alone", {
      host,
      status,
      url,
      hours: Math.round(Math.max(this.blockMs, asked) / 3_600_000),
    });
    await fs.mkdir(this.o.cacheDir, { recursive: true });
    const file = path.join(this.o.cacheDir, "blocks.json");
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
    await fs.writeFile(tmp, JSON.stringify(map, null, 1));
    await fs.rename(tmp, file);
  }

  /** Runs `fn` in this host's turn, at least the gap (or robots.txt's crawl delay) after the previous request ended. */
  private async inTurn<T>(
    host: string,
    delayMs: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.chains.get(host) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.chains.set(
      host,
      prev.then(() => mine),
    );
    await prev;
    try {
      const wait =
        (this.last.get(host) ?? Number.NEGATIVE_INFINITY) +
        delayMs -
        this.now();
      if (wait > 0) await this.sleep(wait);
      this.stats.requests++;
      return await fn();
    } finally {
      this.last.set(host, this.now());
      release();
    }
  }

  /**
   * One request in its host's turn, with the timeout running until `consume` has read the body. Redirects are not
   * followed blindly: each hop is asked again through robots.txt, the block list and its own host's turn (at most
   * three hops). A 403 or 429 stops the host that gave it.
   */
  private async request<T>(
    url: string,
    timeoutMs: number,
    consume: (res: Response, signal: AbortSignal) => Promise<T>,
    hops = 0,
  ): Promise<{ status: number; value?: T; refused?: Fetched["refused"] }> {
    const refused = await this.mayAsk(url);
    if (refused) return { status: 0, refused };
    const u = new URL(url);
    const gap = await this.gapFor(u.origin);
    const r = await this.inTurn(u.host, gap, async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          headers: { "user-agent": STORE_USER_AGENT },
          signal: ctrl.signal,
          redirect: "manual",
        });
        const loc = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && loc) {
          await res.body?.cancel().catch(() => undefined);
          return { status: res.status, next: new URL(loc, url).toString() };
        }
        if (res.status === 403 || res.status === 429) {
          await res.body?.cancel().catch(() => undefined);
          await this.block(u.host, res.status, url, res.headers.get("retry-after"));
          return { status: res.status };
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined);
          return { status: res.status };
        }
        return { status: res.status, value: await consume(res, ctrl.signal) };
      } finally {
        clearTimeout(timer);
      }
    });
    if ("next" in r && r.next) {
      if (hops >= 3) return { status: r.status };
      return this.request(r.next, timeoutMs, consume, hops + 1);
    }
    return r as { status: number; value?: T };
  }

  private robotsFor(origin: string): Promise<Robots> {
    const have = this.robots.get(origin);
    if (have && this.now() - have.at < have.ttl) return have.p;
    const entry = { at: this.now(), ttl: 24 * 3_600_000, p: Promise.resolve(DENY_ALL) };
    entry.p = this.fetchRobots(origin).then((r) => {
      if (r === DENY_ALL) entry.ttl = 10 * 60_000;
      return r;
    });
    this.robots.set(origin, entry);
    return entry.p;
  }

  private async fetchRobots(origin: string): Promise<Robots> {
    const url = `${origin}/robots.txt`;
    const host = new URL(origin).host;
    const file = this.cachePath(url);
    let entry: { status: number; body?: string; at: number } | undefined;
    try {
      entry = JSON.parse(await fs.readFile(file, "utf8"));
      if (!entry || this.now() - entry.at > 24 * 3_600_000) entry = undefined;
    } catch {
      entry = undefined;
    }
    if (!entry) {
      if (await this.isBlocked(host)) return DENY_ALL;
      try {
        // robots.txt itself may redirect (RFC 9309 allows following it); its body is read within the timeout.
        entry = await this.inTurn(host, this.gap, async () => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 20_000);
          try {
            const res = await this.fetchImpl(url, {
              headers: { "user-agent": STORE_USER_AGENT },
              signal: ctrl.signal,
              redirect: "follow",
            });
            if (res.status === 429)
              await this.block(host, 429, url, res.headers.get("retry-after"));
            const body = res.ok ? await res.text() : undefined;
            if (!res.ok) await res.body?.cancel().catch(() => undefined);
            return { status: res.status, body, at: this.now() };
          } finally {
            clearTimeout(timer);
          }
        });
      } catch (err) {
        log(
          "warn",
          "store trailers: robots.txt unreachable; not asking this host",
          { host, error: errorMessage(err) },
        );
        return DENY_ALL;
      }
      if (entry.status >= 500 || entry.status === 429) return DENY_ALL;
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ url, ...entry }));
    }
    // RFC 9309: a 4xx answer (no file; media-cdn.epicgames.com answers an S3 403 for any missing key) allows
    // everything; a server error or a 429 means nothing is allowed for now. A host that then refuses the real request
    // with a 403 or 429 is still stopped for a day by get/download.
    if (entry.status >= 200 && entry.status < 300)
      return parseRobots(entry.body ?? "");
    if (entry.status >= 400 && entry.status < 500 && entry.status !== 429)
      return ALLOW_ALL;
    return DENY_ALL;
  }

  /** The gap for a host: ours, or robots.txt's crawl delay where that is longer. */
  private async gapFor(origin: string): Promise<number> {
    const r = await this.robotsFor(origin);
    return Math.max(this.gap, (r.crawlDelay ?? 0) * 1000);
  }

  /** May this URL be asked for at all: robots.txt allows it and its host is not backed off. */
  async mayAsk(url: string): Promise<Fetched["refused"] | undefined> {
    const u = new URL(url);
    if (await this.isBlocked(u.host)) return "blocked";
    const r = await this.robotsFor(u.origin);
    if (!r.allowed(u.pathname + u.search)) {
      if (!this.stats.refusedRobots.includes(url))
        this.stats.refusedRobots.push(url);
      return "robots";
    }
    return undefined;
  }

  /** A page or JSON body: from the cache within ttlHours (failures too, so a missing slug is not asked again). */
  async get(url: string, ttlHours: number): Promise<Fetched> {
    const file = this.cachePath(url);
    try {
      const c = JSON.parse(await fs.readFile(file, "utf8")) as {
        status: number;
        body?: string;
        at: number;
      };
      if (this.now() - c.at <= ttlHours * 3_600_000) {
        this.stats.cacheHits++;
        return { status: c.status, body: c.body, cached: true };
      }
    } catch {
      /* not cached */
    }
    let r: Awaited<ReturnType<typeof this.request<string>>>;
    try {
      r = await this.request(url, this.timeoutMs, (res) => res.text());
    } catch (err) {
      log("warn", "store trailers: request failed", {
        url,
        error: errorMessage(err),
      });
      return { status: 0 };
    }
    if (r.refused) return { status: 0, refused: r.refused };
    const { status } = r;
    const body = r.value;
    // Server errors, stops and redirect loops are not remembered: a later run may ask again.
    if (status >= 200 && status < 500 && status !== 403 && status !== 429 && (status < 300 || status >= 400)) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(
        file,
        JSON.stringify({ url, status, at: this.now(), body }),
      );
    }
    return { status, body };
  }

  /** A body only when the answer was 200. */
  async text(url: string, ttlHours: number): Promise<string | undefined> {
    const r = await this.get(url, ttlHours);
    return r.status >= 200 && r.status < 300 ? r.body : undefined;
  }

  /** A file streamed to disk (appended when `append`); returns bytes written, 0 when refused or failed. */
  async download(
    url: string,
    dest: string,
    o: { maxBytes?: number; append?: boolean } = {},
  ): Promise<number> {
    const max = o.maxBytes ?? MAX_TRAILER_BYTES;
    try {
      const r = await this.request(url, 600_000, async (res) => {
        if (!res.body) return 0;
        const declared = Number(res.headers.get("content-length") ?? 0);
        if (declared > max) {
          await res.body.cancel().catch(() => undefined);
          log("warn", "store trailers: file too large, skipped", {
            url,
            bytes: declared,
          });
          return 0;
        }
        await fs.mkdir(path.dirname(dest), { recursive: true });
        let bytes = 0;
        const counted = Readable.fromWeb(res.body as any).on(
          "data",
          (c: Buffer) => {
            bytes += c.length;
            if (bytes > max)
              counted.destroy(new Error("file larger than the limit"));
          },
        );
        await streamPipeline(
          counted,
          createWriteStream(dest, { flags: o.append ? "a" : "w" }),
        );
        return bytes;
      });
      return r.value ?? 0;
    } catch (err) {
      log("warn", "store trailers: download failed", {
        url,
        error: errorMessage(err),
      });
      return 0;
    }
  }
}


// ---------------------------------------------------------------------------------------------------------
// Which store product is the game.

/** Platform words a store name carries that say nothing about which game it is. */
const PLATFORM =
  /\b(?:for\s+)?(?:nintendo\s+)?switch(?:\s*2)?(?:\s+edition)?\b|\b(?:ps4|ps5|playstation\s*[45]?)(?:\s*(?:&|and|\/)\s*(?:ps4|ps5))?\b|\bxbox(?:\s+one|\s+series\s+x\s*\|?\s*s|\s+series\s+[xs])?\b|\bwindows(?:\s+10)?\b|\bpc\b/gi;
/** Store listings that are not the game itself. */
const NOT_GAME =
  /\b(upgrade|pack|soundtrack|ost|dlc|demo|season pass|expansion pass|expansion|add-?on|v-?bucks|currency|points|amiibo|artbook|playtest|beta|trial|bonus|costume|skin|outfit|bundle pack)\b/i;
/** Series names that a short title may leave off ("Zelda: Tears of the Kingdom", "Spider-Man 2"). */
const SERIES_PREFIX = [
  ["legend", "of"],
  ["marvels"],
  ["tom", "clancys"],
  ["sid", "meiers"],
];

const ROMAN: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
  xiii: "13",
};

/** A title's identifying words: trademarks, platforms, editions and years gone, apostrophes dropped, numerals as digits (pure). */
export function coreWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[™®©]/g, " ")
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .replace(PLATFORM, " ")
    .replace(/\(\s*(19|20)\d\d\s*\)/g, " ")
    .replace(new RegExp(EDITION.source, "gi"), " ")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && w !== "the" && w !== "edition")
    .map((w) => ROMAN[w] ?? w);
}

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((w, i) => w === b[i]);

/** True when two titles name the same game, allowing a series name one of them leaves off (pure). */
export function sameCore(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  if (same(a, b)) return true;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return SERIES_PREFIX.some(
    (p) =>
      same(long.slice(0, p.length), p) && same(long.slice(p.length), short),
  );
}

export type StoreMatch = "same" | "edition" | "collection";

/** A game this many years old or newer cannot have a same-name remake on a store yet (used when a store has no date). */
export const RECENT_YEARS = 5;

/**
 * Whether a store product is the game (pure), by the same rules as STEAM_EDITIONS (src/assets/steamedition.ts):
 * - "same": its name is the game's (editions and platforms aside) and its year within one of the game's;
 * - "edition": a later re-release of the same game (a Legendary Edition, a remaster), when editions are allowed;
 * - "collection": a series collection asked for by name (`asked`, the writer's store term), when editions are allowed;
 * - undefined: anything else. A remake or reboot never stands in for the original, nor an older game for a newer one.
 */
export function matchStoreProduct(
  game: string,
  year: number | undefined,
  storeName: string,
  storeYear: number | undefined,
  o: { asked?: string; editions?: boolean; nowYear?: number } = {},
): StoreMatch | undefined {
  if (!storeName.trim() || !game.trim()) return undefined;
  if (NOT_GAME.test(storeName) && !NOT_GAME.test(game)) return undefined;
  if (
    /\b(remake|reboot|reimagined)\b/i.test(storeName) &&
    !/\b(remake|reboot|reimagined)\b/i.test(game)
  )
    return undefined;
  const editions = o.editions !== false;
  const gap =
    year !== undefined && storeYear !== undefined
      ? storeYear - year
      : undefined;
  const nameSame = sameCore(coreWords(game), coreWords(storeName));
  // A store page with no year cannot prove it is not a remake of an older game ("Resident Evil 4" 2005 and 2023): it is
  // taken only when the game's year is unknown, or the game is recent enough that no remake of it can exist yet.
  const recent =
    year === undefined ||
    year >= (o.nowYear ?? new Date().getFullYear()) - RECENT_YEARS;
  if (nameSame && (gap === undefined ? recent : Math.abs(gap) <= 1))
    return "same";
  if (!editions) return undefined;
  const plain = storeName
    .replace(/[™®©]/g, "")
    .replace(PLATFORM, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Without a store year the gap is unknown: no edition is taken (a "Definitive Edition" may be a remake); a series
  // collection still needs the writer to have asked for it by name.
  const kind = steamEditionOf(game, plain, gap ?? 0, o.asked, year);
  if (kind === "edition" && gap !== undefined && gap > 1 && nameSame)
    return "edition";
  if (kind === "collection") return "collection";
  return undefined;
}

/** How well a matching product fits: the plain game before its deluxe tiers (lower is better, pure). */
export function productRank(
  game: string,
  storeName: string,
  kind: StoreMatch,
): number {
  const extra = coreWordsLoose(storeName).length - coreWordsLoose(game).length;
  return (
    (kind === "same" ? 0 : kind === "edition" ? 10 : 20) +
    Math.max(0, extra) +
    (EDITION.test(storeName) ? 1 : 0)
  );
}
const coreWordsLoose = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/** A URL slug's words, with a store's platform and id suffixes gone ("...-kingdom-switch" is "... kingdom", pure). */
export function slugWords(slug: string): string[] {
  const s = slug
    .toLowerCase()
    .replace(/-\d{10,}(?=-|$)/g, "")
    .replace(/-(switch-2|switch|us|ps4|ps5|xbox)$/g, "")
    .replace(/-/g, " ");
  return coreWords(s);
}

/** A title as a likely store slug ("Marvel's Spider-Man 2" is "marvels-spider-man-2", pure). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Slugs from a list whose words could be the game, best first, at most n (pure). */
export function slugCandidates(
  slugs: string[],
  game: string,
  asked?: string,
  n = 4,
): string[] {
  const wants = [coreWords(game), ...(asked ? [coreWords(asked)] : [])].filter(
    (w) => w.length,
  );
  const scored: Array<{ slug: string; extra: number }> = [];
  for (const slug of new Set(slugs)) {
    const w = slugWords(slug);
    for (const want of wants) {
      if (sameCore(w, want)) {
        scored.push({ slug, extra: 0 });
        break;
      }
      // Leading or trailing extra words (an edition name the core missed): kept as weaker candidates; the product
      // page's own name decides.
      const at = w.findIndex((_, i) => same(w.slice(i, i + want.length), want));
      if (
        at >= 0 &&
        w.length - want.length <= 3 &&
        !NOT_GAME.test(slug.replace(/-/g, " "))
      ) {
        scored.push({ slug, extra: w.length - want.length });
        break;
      }
    }
  }
  return scored
    .sort((a, b) => a.extra - b.extra || a.slug.length - b.slug.length)
    .slice(0, n)
    .map((x) => x.slug);
}

// ---------------------------------------------------------------------------------------------------------
// The stores' public data (pure parsers).

export interface StoreVideo {
  /** The trailer's own name, as the store gives it. */
  caption: string;
  url: string;
  kind: "hls" | "mp4";
  /** Where the file is served from, for the rights label (a store, or playstation.com). */
  host: string;
  height?: number;
}

export interface StoreProduct {
  store: StoreId;
  id: string;
  name: string;
  url: string;
  year?: number;
  publisher?: string;
  videos: StoreVideo[];
}

const yearOf = (s: unknown): number | undefined => {
  const m = String(s ?? "").match(/\b(19|20)\d\d\b/);
  return m ? Number(m[0]) : undefined;
};

/** The Microsoft catalog's autosuggest answer: games only (pure). */
export function parseXboxSuggest(
  json: any,
): Array<{ id: string; title: string }> {
  const out: Array<{ id: string; title: string }> = [];
  for (const r of json?.Results ?? [])
    for (const p of r?.Products ?? [])
      if (p?.Type === "Game" && p.ProductId && p.Title)
        out.push({ id: String(p.ProductId), title: String(p.Title) });
  return out;
}

/** Hosts the Microsoft trailers come from that answer this PC; others (cdn-dynmedia-1, 403 by IP) are skipped. */
export const XBOX_VIDEO_HOSTS = /^https:\/\/cdn\.trailers\.xboxservices\.com\//;

/** The Microsoft catalog's products answer: names, years, publishers and trailers (pure). */
export function parseXboxProducts(json: any): StoreProduct[] {
  const out: StoreProduct[] = [];
  for (const p of json?.Products ?? []) {
    const L = p?.LocalizedProperties?.[0] ?? {};
    const videos: StoreVideo[] = [];
    for (const v of L.CMSVideos ?? []) {
      const url = String(v?.HLS ?? "");
      if (!url) continue;
      videos.push({
        caption: String(v.Caption ?? "Trailer"),
        url,
        kind: "hls",
        host: STORE_LABEL.xbox,
        height: Number(v.Height) || undefined,
      });
    }
    for (const v of L.Videos ?? []) {
      const url = String(v?.Uri ?? v?.Url ?? "").replace(/^\/\//, "https://");
      if (!/^https:.*\.(m3u8|mp4)(\?|$)/i.test(url)) continue;
      videos.push({
        caption: String(v.Caption ?? "Trailer"),
        url,
        kind: /\.m3u8/i.test(url) ? "hls" : "mp4",
        host: STORE_LABEL.xbox,
        height: Number(v.Height) || undefined,
      });
    }
    out.push({
      store: "xbox",
      id: String(p.ProductId),
      name: String(L.ProductTitle ?? ""),
      url: `https://www.xbox.com/en-US/games/store/x/${p.ProductId}`,
      year: yearOf(p?.MarketProperties?.[0]?.OriginalReleaseDate),
      publisher: L.PublisherName ? String(L.PublisherName) : undefined,
      videos,
    });
  }
  return out;
}

/** Page slugs under a sitemap's path (pure): "/en-us/games/<slug>/" or "/us/store/products/<slug>/". */
export function sitemapSlugs(xml: string, under: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(
    `<loc>\\s*https?://[^<]*${under.replace(/[/.]/g, (c) => `\\${c}`)}([a-z0-9-]+)/?\\s*</loc>`,
    "gi",
  );
  for (const m of xml.matchAll(re)) out.add(m[1]!.toLowerCase());
  return [...out];
}

const decodeEntities = (s: string) =>
  s
    .replace(/&#34;|&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&amp;/g, "&");

export interface PsGameProduct {
  productId: string;
  name: string;
  productType?: string;
  releaseDate?: string;
  publisher?: string;
}

/** A playstation.com game page: the store products it sells and its own gameplay videos (pure). */
export function parsePsGamePage(html: string): {
  products: PsGameProduct[];
  videos: StoreVideo[];
} {
  const products = new Map<string, PsGameProduct>();
  for (const m of html.matchAll(/data-product-info="([^"]+)"/g)) {
    try {
      const j = JSON.parse(decodeEntities(m[1]!));
      if (j?.productId && j?.name && !products.has(j.productId))
        products.set(j.productId, {
          productId: String(j.productId),
          name: String(j.name),
          productType: j.productType ? String(j.productType) : undefined,
          releaseDate: j.releaseDate ? String(j.releaseDate) : undefined,
          publisher: j.publisher ? String(j.publisher) : undefined,
        });
    } catch {
      /* not JSON */
    }
  }
  const videos = new Map<string, StoreVideo>();
  for (const m of decodeEntities(html).matchAll(
    /https:\/\/gmedia\.playstation\.com\/is\/content\/[^"'\s,<>&]+?\.mp4/g,
  )) {
    const url = m[0];
    // The mobile cuts ("-ma-", "-mobile") are the same video smaller.
    if (/-ma-|mobile(?!-feature)/i.test(url.split("/").pop() ?? "")) continue;
    const name = (url.split("/").pop() ?? "video").replace(/\.mp4$/, "");
    videos.set(url, {
      caption: name.replace(/[-_]+/g, " "),
      url,
      kind: "mp4",
      host: "PlayStation.com",
    });
  }
  return { products: [...products.values()], videos: [...videos.values()] };
}

/** The store's product page: its name, date, publisher and preview videos, from the page's own data (pure). */
export function parsePsProductPage(
  html: string,
  productId: string,
): {
  name?: string;
  releaseDate?: string;
  publisher?: string;
  videos: StoreVideo[];
} {
  const merged: Record<string, any> = {};
  // Each cache entry is a slice of the product; their media lists are joined, not overwritten.
  const media: any[] = [];
  for (const m of html.matchAll(
    /<script id="env:[^"]+"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      const cache = JSON.parse(m[1]!)?.cache ?? {};
      const p = cache[`Product:${productId}`];
      if (p && Array.isArray(p.media)) media.push(...p.media);
      if (p)
        Object.assign(
          merged,
          Object.fromEntries(
            Object.entries(p).filter(([, v]) => v !== undefined && v !== null),
          ),
        );
    } catch {
      /* not JSON */
    }
  }
  const videos: StoreVideo[] = [];
  const urls = [
    ...new Set(
      media.filter((x) => x?.type === "VIDEO" && x?.url).map((x) => String(x.url)),
    ),
  ];
  for (const [k, url] of urls.entries())
    videos.push({
      caption: `${merged.name ?? "Trailer"} video ${k + 1}`,
      url,
      kind: "mp4",
      host: STORE_LABEL.playstation,
    });
  return {
    name: merged.name ? String(merged.name) : undefined,
    releaseDate: merged.releaseDate
      ? String(merged.releaseDate?.value ?? merged.releaseDate)
      : undefined,
    publisher: merged.publisherName ? String(merged.publisherName) : undefined,
    videos,
  };
}

/** The Epic store's product page data: its name, publisher and carousel videos (HLS) (pure). */
export function parseEpicProduct(
  json: any,
  slug: string,
): StoreProduct | undefined {
  if (!json || typeof json !== "object" || json.error) return undefined;
  const name = String(
    json.productName ?? json.pages?.[0]?.data?.about?.title ?? "",
  );
  if (!name) return undefined;
  const about =
    json.pages?.find((p: any) => p?.type === "productHome")?.data?.about ??
    json.pages?.[0]?.data?.about ??
    {};
  const videos: StoreVideo[] = [];
  const seen = new Set<string>();
  const walk = (o: any) => {
    if (!o || typeof o !== "object") return;
    if (typeof o.recipes === "string") {
      try {
        const r = JSON.parse(o.recipes);
        const list = (r["en-US"] ?? Object.values(r)[0] ?? []) as any[];
        const hls = list.find((x) => x?.recipe === "video-hls");
        const url = hls?.outputs?.find((x: any) => x?.key === "manifest")?.url;
        if (url && !seen.has(url)) {
          seen.add(url);
          videos.push({
            caption: `${name} video ${videos.length + 1}`,
            url: String(url),
            kind: "hls",
            host: STORE_LABEL.epic,
          });
        }
      } catch {
        /* not JSON */
      }
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(json.pages ?? []);
  return {
    store: "epic",
    id: slug,
    name,
    url: `https://store.epicgames.com/en-US/p/${slug}`,
    year: yearOf(about?.releaseDate),
    publisher: about?.publisherAttribution
      ? String(about.publisherAttribution)
      : about?.developerAttribution
        ? String(about.developerAttribution)
        : undefined,
    videos,
  };
}

/** A Nintendo store product page: its name, date, publisher and trailers on assets.nintendo.com (pure). */
export function parseNintendoPage(
  html: string,
  slug: string,
): StoreProduct | undefined {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return undefined;
  let pp: any;
  try {
    pp = JSON.parse(m[1]!)?.props?.pageProps;
  } catch {
    return undefined;
  }
  if (!pp) return undefined;
  const ld = ((pp.linkedData ?? []) as any[]).flat().find((x) => {
    const t = x?.["@type"];
    return t === "VideoGame" || (Array.isArray(t) && t.includes("VideoGame"));
  });
  const apollo = pp.initialApolloState ?? {};
  const product = Object.entries(apollo).find(([k]) =>
    k.startsWith("Product:"),
  )?.[1] as any;
  const name = String(ld?.name ?? product?.name ?? "");
  if (!name) return undefined;
  const videos: StoreVideo[] = [];
  const seen = new Set<string>();
  const add = (publicId: string, caption: string) => {
    const id = publicId.replace(/^\/+/, "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    videos.push({
      caption,
      url: `https://assets.nintendo.com/video/upload/${id}.mp4`,
      kind: "mp4",
      host: STORE_LABEL.nintendo,
    });
  };
  for (const s of pp.marketingPage?.sections ?? [])
    for (const g of s?.gallery ?? [])
      if (g?.primary?.resourceType === "video" && g.primary.assetPath)
        add(
          String(g.primary.assetPath),
          String(g.primary.assetPath).split("/").pop()!.replace(/[_-]+/g, " "),
        );
  for (const [k, g] of ((product?.productGallery ?? []) as any[]).entries())
    if (g?.resourceType === "video" && g.publicId)
      add(String(g.publicId), `${name} video ${k + 1}`);
  const release = product?.releaseDate ?? ld?.datePublished ?? ld?.releaseDate;
  const pub =
    ld?.publisher?.name ??
    (Array.isArray(ld?.publisher) ? ld.publisher[0]?.name : undefined);
  return {
    store: "nintendo",
    id: slug,
    name,
    url: `https://www.nintendo.com/us/store/products/${slug}/`,
    year: yearOf(release),
    publisher: pub ? String(pub) : undefined,
    videos,
  };
}

/** The highest variant up to 1080p in an HLS master playlist, the higher bitrate on a tie (pure). */
export function pickHlsVariant(master: string): string | undefined {
  const lines = master.split(/\r?\n/);
  let best: { uri: string; h: number; bw: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const h = Number(line.match(/RESOLUTION=\d+x(\d+)/)?.[1] ?? 0);
    const bw = Number(line.match(/[:,]BANDWIDTH=(\d+)/)?.[1] ?? 0);
    const uri = lines[i + 1]?.trim();
    if (!uri || uri.startsWith("#") || !h || h > 1080) continue;
    if (!best || h > best.h || (h === best.h && bw > best.bw))
      best = { uri, h, bw };
  }
  return best?.uri;
}

export interface MediaPlaylist {
  init?: string;
  /** The init section is itself a byte range of a file (never fetched whole). */
  initRanged?: boolean;
  /** Segments are encrypted (#EXT-X-KEY other than NONE): not used. */
  encrypted?: boolean;
  segments: Array<{
    uri: string;
    duration: number;
    range?: { length: number; offset: number };
  }>;
}

/** An HLS media playlist: its init section and segments, with byte ranges (pure). */
export function parseHlsMedia(text: string): MediaPlaylist {
  let init: string | undefined;
  let initRanged = false;
  let encrypted = false;
  const segments: MediaPlaylist["segments"] = [];
  let dur: number | undefined;
  let range: { length: number; offset: number } | undefined;
  let nextOffset = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const map = line.match(/^#EXT-X-MAP:.*URI="([^"]+)"/);
    if (map) {
      init ??= map[1];
      if (/BYTERANGE=/.test(line)) initRanged = true;
    }
    if (/^#EXT-X-KEY:/.test(line) && !/METHOD=NONE/.test(line)) encrypted = true;
    const inf = line.match(/^#EXTINF:([\d.]+)/);
    if (inf) dur = Number(inf[1]);
    const br = line.match(/^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/);
    if (br) {
      const length = Number(br[1]);
      const offset = br[2] !== undefined ? Number(br[2]) : nextOffset;
      range = { length, offset };
      nextOffset = offset + length;
    }
    if (line && !line.startsWith("#") && dur !== undefined) {
      segments.push({ uri: line, duration: dur, ...(range ? { range } : {}) });
      dur = undefined;
      range = undefined;
    }
  }
  return {
    init,
    segments,
    ...(initRanged ? { initRanged } : {}),
    ...(encrypted ? { encrypted } : {}),
  };
}

/** When every segment is a contiguous byte range of one file from its start: that file and its length (pure). */
export function singleFile(
  pl: MediaPlaylist,
): { uri: string; bytes: number } | undefined {
  if (!pl.segments.length || pl.init) return undefined;
  const uri = pl.segments[0]!.uri;
  let at = 0;
  for (const s of pl.segments) {
    if (s.uri !== uri || !s.range || s.range.offset !== at) return undefined;
    at += s.range.length;
  }
  return { uri, bytes: at };
}

// ---------------------------------------------------------------------------------------------------------
// Finding a game's trailers on each store.

export interface StoreLookup {
  game: string;
  year?: number;
  /** The writer's store term (an entry's steam_search_term): a series collection is taken only when asked for. */
  asked?: string;
  /** STEAM_EDITIONS: later editions and asked-for collections count (default true). */
  editions?: boolean;
}

/** One store's matching product with its trailers, or undefined. */
export type StoreFinder = (
  http: PoliteClient,
  q: StoreLookup,
) => Promise<StoreProduct | undefined>;

const DAY = 24;
const WEEK = 7 * 24;

function bestOf(
  q: StoreLookup,
  products: StoreProduct[],
): StoreProduct | undefined {
  const ok = products
    .map((p) => ({
      p,
      kind: matchStoreProduct(q.game, q.year, p.name, p.year, {
        asked: q.asked,
        editions: q.editions,
      }),
    }))
    .filter((x): x is { p: StoreProduct; kind: StoreMatch } => !!x.kind)
    .sort(
      (a, b) =>
        productRank(q.game, a.p.name, a.kind) -
          productRank(q.game, b.p.name, b.kind) ||
        b.p.videos.length - a.p.videos.length,
    );
  for (const x of ok)
    log("info", "store trailers: product matched", {
      store: x.p.store,
      game: q.game,
      product: x.p.name,
      year: x.p.year,
      kind: x.kind,
      videos: x.p.videos.length,
    });
  for (const p of products.filter((p) => !ok.some((x) => x.p === p)))
    log("info", "store trailers: product refused", {
      store: p.store,
      game: q.game,
      product: p.name,
      year: p.year,
    });
  // The best match with trailers; a plain-name match with none still beats an edition only when it has some.
  return ok.find((x) => x.p.videos.length)?.p ?? ok[0]?.p;
}

export const findXbox: StoreFinder = async (http, q) => {
  const ids: string[] = [];
  for (const term of [
    ...new Set([q.game, q.asked].filter((t): t is string => !!t)),
  ]) {
    const body = await http.text(
      `https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?market=US&languages=en-us&query=${encodeURIComponent(term)}&productFamilyNames=Games`,
      WEEK,
    );
    if (!body) continue;
    let hits: Array<{ id: string; title: string }> = [];
    try {
      hits = parseXboxSuggest(JSON.parse(body));
    } catch {
      continue;
    }
    for (const h of hits)
      if (
        !ids.includes(h.id) &&
        matchStoreProduct(q.game, undefined, h.title, undefined, {
          asked: q.asked,
          editions: q.editions,
        })
      )
        ids.push(h.id);
  }
  if (!ids.length) return undefined;
  const body = await http.text(
    `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${ids.slice(0, 6).join(",")}&market=US&languages=en-us`,
    WEEK,
  );
  if (!body) return undefined;
  let products: StoreProduct[];
  try {
    products = parseXboxProducts(JSON.parse(body));
  } catch {
    return undefined;
  }
  for (const p of products) {
    const skipped = p.videos.filter((v) => !XBOX_VIDEO_HOSTS.test(v.url));
    if (skipped.length)
      log(
        "info",
        "store trailers: Microsoft trailers on a host that refuses us, skipped",
        {
          product: p.name,
          skipped: skipped.length,
          host: new URL(skipped[0]!.url).host,
        },
      );
    p.videos = p.videos.filter((v) => XBOX_VIDEO_HOSTS.test(v.url));
  }
  return bestOf(q, products);
};

export const findPlayStation: StoreFinder = async (http, q) => {
  const map = await http.text(
    "https://www.playstation.com/en-us/sitemap.xml",
    WEEK,
  );
  const slugs = map ? sitemapSlugs(map, "/en-us/games/") : [];
  const guesses = [slugify(q.game), ...(q.asked ? [slugify(q.asked)] : [])];
  const tryList = [
    ...new Set([
      ...slugCandidates(slugs, q.game, q.asked, 3),
      ...(slugs.length ? [] : guesses),
    ]),
  ];
  const products: StoreProduct[] = [];
  for (const slug of tryList) {
    const html = await http.text(
      `https://www.playstation.com/en-us/games/${slug}/`,
      WEEK,
    );
    if (!html) continue;
    const page = parsePsGamePage(html);
    const games = page.products.filter(
      (p) =>
        !p.productType ||
        /^(FULL_GAME|GAME_BUNDLE|PREMIUM_EDITION)$/.test(p.productType),
    );
    const fits = games
      .map((p) => ({
        p,
        kind: matchStoreProduct(q.game, q.year, p.name, yearOf(p.releaseDate), {
          asked: q.asked,
          editions: q.editions,
        }),
      }))
      .filter((x) => x.kind)
      .sort(
        (a, b) =>
          productRank(q.game, a.p.name, a.kind!) -
          productRank(q.game, b.p.name, b.kind!),
      );
    // The page itself is the game's: its own videos go with the best product, or alone when the store has none.
    const top = fits[0]?.p;
    if (!top) {
      for (const p of games)
        products.push({
          store: "playstation",
          id: p.productId,
          name: p.name,
          url: "",
          year: yearOf(p.releaseDate),
          videos: [],
        });
      continue;
    }
    const storeHtml = await http.text(
      `https://store.playstation.com/en-us/product/${top.productId}`,
      WEEK,
    );
    const sp = storeHtml
      ? parsePsProductPage(storeHtml, top.productId)
      : { videos: [] as StoreVideo[] };
    products.push({
      store: "playstation",
      id: top.productId,
      name: top.name,
      url: `https://store.playstation.com/en-us/product/${top.productId}`,
      year:
        yearOf(top.releaseDate) ??
        yearOf((sp as { releaseDate?: string }).releaseDate),
      publisher: top.publisher ?? (sp as { publisher?: string }).publisher,
      videos: [...sp.videos, ...page.videos],
    });
  }
  return bestOf(q, products);
};

export const findEpic: StoreFinder = async (http, q) => {
  const slugs = [
    ...new Set([
      slugify(q.game),
      slugify(q.game.replace(/^the\s+/i, "")),
      ...(q.asked ? [slugify(q.asked)] : []),
    ]),
  ].filter(Boolean);
  const products: StoreProduct[] = [];
  for (const slug of slugs) {
    const body = await http.text(
      `https://store-content-ipv4.ak.epicgames.com/api/en-US/content/products/${slug}`,
      WEEK,
    );
    if (!body) continue;
    try {
      const p = parseEpicProduct(JSON.parse(body), slug);
      if (p) products.push(p);
    } catch {
      /* not JSON */
    }
  }
  return bestOf(q, products);
};

export const findNintendo: StoreFinder = async (http, q) => {
  const map = await http.text(
    "https://www.nintendo.com/us/store/sitemap.xml",
    WEEK,
  );
  if (!map) return undefined;
  const products: StoreProduct[] = [];
  for (const slug of slugCandidates(
    sitemapSlugs(map, "/us/store/products/"),
    q.game,
    q.asked,
    3,
  )) {
    const html = await http.text(
      `https://www.nintendo.com/us/store/products/${slug}/`,
      WEEK,
    );
    const p = html ? parseNintendoPage(html, slug) : undefined;
    if (p) products.push(p);
  }
  return bestOf(q, products);
};

export const FINDERS: Record<StoreId, StoreFinder> = {
  playstation: findPlayStation,
  xbox: findXbox,
  epic: findEpic,
  nintendo: findNintendo,
};

/** The platform holder that publishes a game, so its own store is asked first (a Sony exclusive on PlayStation). */
export function storeOrder(
  publisher: string | undefined,
  stores: StoreId[] = STORE_IDS,
): StoreId[] {
  const first: StoreId | undefined =
    publisher === "PlayStation"
      ? "playstation"
      : publisher === "Xbox" || publisher === "Bethesda"
        ? "xbox"
        : publisher === "Nintendo"
          ? "nintendo"
          : publisher === "Epic Games"
            ? "epic"
            : undefined;
  return first && stores.includes(first)
    ? [first, ...stores.filter((s) => s !== first)]
    : stores;
}

/** Trailers before feature loops and short previews: a named trailer or gameplay video first (pure). */
export function rankVideos(videos: StoreVideo[]): StoreVideo[] {
  // The store's own trailers first: playstation.com's page videos are mostly short feature loops (4-8 s, 25 Nov 2026).
  const score = (v: StoreVideo) =>
    (v.host === "PlayStation.com" ? -4 : 0) +
    (/\btrailer\b/i.test(v.caption) ? 3 : 0) +
    (/gameplay|launch|reveal|story|campaign/i.test(v.caption) ? 1 : 0) -
    (/hero banner|banner|loop|teaser|accolade/i.test(v.caption) ? 2 : 0);
  return videos
    .map((v, i) => ({ v, i, s: score(v) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.v);
}

// ---------------------------------------------------------------------------------------------------------
// Downloading a store trailer into the cache.

export interface Remux {
  /** A transport-stream (or other) file rewritten as a video-only mp4; resolves once dest exists. */
  (src: string, dest: string): Promise<void>;
}

/** The trailer's cached file: downloaded once, kept for later runs. Undefined when it cannot be had politely. */
export async function cacheVideo(
  http: PoliteClient,
  v: StoreVideo,
  dir: string,
  remux: Remux,
): Promise<string | undefined> {
  const dest = path.join(
    dir,
    `${crypto.createHash("sha1").update(v.url).digest("hex").slice(0, 20)}.mp4`,
  );
  const st = await fs.stat(dest).catch(() => undefined);
  if (st && st.size > 100_000) {
    const t = new Date();
    await fs.utimes(dest, t, t).catch(() => undefined);
    return dest;
  }
  await fs.mkdir(dir, { recursive: true });
  // Unique per call: two lookups of one trailer at once never write the same file.
  const part = `${dest}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.part`;
  await fs.rm(part, { force: true });
  try {
    if (v.kind === "mp4") {
      if ((await http.download(v.url, part)) < 100_000) return undefined;
      await remux(part, dest);
      return (await fs.stat(dest).catch(() => undefined)) ? dest : undefined;
    }
    const master = await http.text(v.url, WEEK);
    if (!master) return undefined;
    const variant = master.includes("#EXT-X-STREAM-INF")
      ? pickHlsVariant(master)
      : v.url;
    if (!variant) return undefined;
    const variantUrl = new URL(variant, v.url).toString();
    const media =
      variantUrl === v.url ? master : await http.text(variantUrl, WEEK);
    if (!media) return undefined;
    const pl = parseHlsMedia(media);
    if (!pl.segments.length) return undefined;
    if (pl.encrypted) return undefined;
    const one = singleFile(pl);
    // Byte ranges that are not one whole file from its start (several files, a ranged init): asking for whole files per
    // segment would fetch the same file again and again, so the trailer is not taken.
    if (!one && (pl.initRanged || pl.segments.some((x) => x.range))) {
      log("info", "store trailers: byte-ranged playlist not one file, skipped", { url: v.url });
      return undefined;
    }
    let total = 0;
    if (one) {
      // One file holding every segment: one request for it, not one per segment.
      total = await http.download(
        new URL(one.uri, variantUrl).toString(),
        part,
      );
      if (total < one.bytes * 0.95) return undefined;
    } else {
      if (pl.init)
        total += await http.download(
          new URL(pl.init, variantUrl).toString(),
          part,
        );
      for (const s of pl.segments) {
        const n = await http.download(
          new URL(s.uri, variantUrl).toString(),
          part,
          { append: true },
        );
        if (!n) return undefined;
        total += n;
        if (total > MAX_TRAILER_BYTES) return undefined;
      }
    }
    if (total < 100_000) return undefined;
    await remux(part, dest);
    return (await fs.stat(dest).catch(() => undefined)) ? dest : undefined;
  } catch (err) {
    log("warn", "store trailers: trailer download failed", {
      url: v.url,
      error: errorMessage(err),
    });
    return undefined;
  } finally {
    await fs.rm(part, { force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------
// The whole lookup.

export interface StoreTrailer {
  /** Absolute path of the cached file. */
  file: string;
  /** The product's name and the trailer's own name. */
  name: string;
  /** The trailer's own URL on the store's CDN. */
  url: string;
  /** The footage owner, for the publisher budget. */
  publisher: string;
  store: StoreId;
  /** Where the file is served from ("PlayStation Store", "PlayStation.com", "Microsoft Store"...). */
  host: string;
  productUrl: string;
  match: StoreMatch;
}

export interface StoreTrailerOptions extends StoreLookup {
  http: PoliteClient;
  /** Stores asked, in order (the platform holder's own first). */
  stores?: StoreId[];
  /** Trailers wanted in all. */
  max?: number;
  /** The footage owner when known (franchisePublisher), else the store's publisher name. */
  publisher?: string;
  remux: Remux;
  /** Free bytes the cache's disk must keep: below it nothing is downloaded. */
  minFreeBytes?: number;
  /** Per store, what was found: for the report and the smoke run. */
  report?: Partial<
    Record<
      StoreId,
      { product?: string; videos: number; downloaded: number; why?: string }
    >
  >;
}

/** Free bytes on the disk holding `dir`. */
export async function freeBytes(dir: string): Promise<number> {
  await fs.mkdir(dir, { recursive: true });
  const s = await fs.statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}

/**
 * A game's official trailers from the stores, downloaded into the cache (files/), best first, at most `max`: the
 * stores are asked in order until enough are found. Never throws.
 */
export async function storeTrailersFor(
  o: StoreTrailerOptions,
): Promise<StoreTrailer[]> {
  const max = o.max ?? 4;
  const out: StoreTrailer[] = [];
  const report = o.report ?? {};
  for (const store of o.stores ?? storeOrder(o.publisher)) {
    if (out.length >= max) break;
    const r = (report[store] = { videos: 0, downloaded: 0 } as NonNullable<
      (typeof report)[StoreId]
    >);
    let product: StoreProduct | undefined;
    try {
      product = await FINDERS[store](o.http, o);
    } catch (err) {
      r.why = `lookup failed: ${errorMessage(err)}`;
      continue;
    }
    if (!product) {
      r.why = "no matching product";
      continue;
    }
    r.product = product.name;
    r.videos = product.videos.length;
    const kind = matchStoreProduct(o.game, o.year, product.name, product.year, {
      asked: o.asked,
      editions: o.editions,
    })!;
    const seen = new Set(out.map((t) => t.url));
    const perStore = Math.min(3, max - out.length);
    for (const v of rankVideos(product.videos)) {
      if (r.downloaded >= perStore || out.length >= max) break;
      if (seen.has(v.url)) continue;
      if (
        o.minFreeBytes &&
        (await freeBytes(o.http.o.cacheDir)) < o.minFreeBytes
      ) {
        r.why = "disk below its free-space floor";
        log(
          "warn",
          "store trailers: disk below the floor, nothing downloaded",
          { dir: o.http.o.cacheDir },
        );
        return out;
      }
      const file = await cacheVideo(
        o.http,
        v,
        path.join(o.http.o.cacheDir, "files", store),
        o.remux,
      );
      if (!file) continue;
      r.downloaded++;
      out.push({
        file,
        name: `${product.name.replace(/[™®©]/g, "").trim()}: ${v.caption}`,
        url: v.url,
        publisher:
          o.publisher ??
          ownerFromStorePublisher(product.publisher) ??
          product.publisher ??
          "",
        store,
        host: v.host,
        productUrl: product.url,
        match: kind,
      });
    }
    if (!r.downloaded && !r.why)
      r.why = product.videos.length
        ? "no trailer could be downloaded"
        : "the product lists no trailers this PC may fetch";
  }
  return out;
}

/** The footage owner a store's publisher name stands for, as the publisher budget names it (pure). */
export function ownerFromStorePublisher(
  name: string | undefined,
): string | undefined {
  if (!name) return undefined;
  const table: Array<[RegExp, string]> = [
    [
      /sony interactive|playstation|insomniac|naughty dog|santa monica|guerrilla|sucker punch/i,
      "PlayStation",
    ],
    [
      /microsoft|xbox game studios|343 industries|halo studios|mojang|playground games|the coalition/i,
      "Xbox",
    ],
    [/bethesda|zenimax|id software/i, "Bethesda"],
    [/nintendo/i, "Nintendo"],
    [/rockstar/i, "Rockstar Games"],
    [/electronic arts|\bea\b|bioware|respawn/i, "EA"],
    [/activision|blizzard/i, "Activision"],
    [/ubisoft/i, "Ubisoft"],
    [/capcom/i, "Capcom"],
    [/square enix/i, "Square Enix"],
    [/\bsega\b|atlus/i, "Sega"],
    [/bandai namco/i, "Bandai Namco"],
    [/epic games/i, "Epic Games"],
    [/cd projekt/i, "CD Projekt Red"],
    [/fromsoftware/i, "FromSoftware"],
    [/warner bros/i, "Warner Bros. Games"],
    [/\b2k\b|take-two/i, "2K"],
  ];
  return table.find(([re]) => re.test(name))?.[1];
}

/** ffmpeg's rewrite of a downloaded trailer: video only, at most 1080 lines, mp4 with its index up front. */
export function ffmpegFinish(ffmpeg: string, ffprobe: string): Remux {
  return async (src, dest) => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run(
      ffprobe,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=height",
        "-of",
        "default=nw=1:nk=1",
        src,
      ],
      { timeout: 60_000 },
    ).catch(() => ({ stdout: "0" }));
    const h = Number(String(stdout).trim()) || 0;
    if (h > 1080)
      // A copy, not a re-encode: the clip cutter scales to 1080 lines, and a long encode would need the orchestrator.
      log("info", "store trailers: file above 1080p kept as served", { file: dest, height: h });
    const tmp = `${dest}.${process.pid}.tmp.mp4`;
    const args = ["-y", "-loglevel", "error", "-i", src, "-map", "0:v:0", "-an", "-c", "copy", "-movflags", "+faststart", tmp];
    try {
      await run(ffmpeg, args, { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
    await fs.rename(tmp, dest);
  };
}

const clients = new Map<string, PoliteClient>();

/** One polite client per cache folder for the whole process, so the gap per host holds across every lookup. */
export function sharedClient(cacheDir: string): PoliteClient {
  let c = clients.get(cacheDir);
  if (!c) {
    c = new PoliteClient({ cacheDir });
    clients.set(cacheDir, c);
  }
  return c;
}

/**
 * The officialMedia hook (src/assets/officialTrailer.ts storeTrailers): a game's store trailers, with `hint` read as its
 * release year when it is one.
 */
export function storeTrailerSource(o: {
  cacheDir: string;
  stores: StoreId[];
  editions?: boolean;
  minFreeBytes?: number;
  remux: Remux;
  owner?: (game: string) => string | undefined;
}): (game: string, hint: string) => Promise<StoreTrailer[]> {
  let pruned = false;
  return async (game, hint) => {
    if (!pruned) {
      pruned = true;
      await pruneCache(o.cacheDir).catch(() => undefined);
    }
    const year = /^(19|20)\d\d$/.test(hint.trim())
      ? Number(hint.trim())
      : undefined;
    const publisher = o.owner?.(game);
    const report: StoreTrailerOptions["report"] = {};
    const got = await storeTrailersFor({
      http: sharedClient(o.cacheDir),
      game,
      year,
      editions: o.editions,
      stores: storeOrder(publisher, o.stores),
      publisher,
      remux: o.remux,
      minFreeBytes: o.minFreeBytes,
      report,
    }).catch((err) => {
      log("warn", "store trailers: lookup failed", {
        game,
        error: errorMessage(err),
      });
      return [] as StoreTrailer[];
    });
    log("info", "store trailers: looked up", {
      game,
      year,
      found: got.length,
      stores: report,
    });
    return got;
  };
}

/** Trailer files not used for this many days are removed from the cache (each use refreshes a file's time). */
export const CACHE_KEEP_DAYS = 30;

/** Removes cached trailers and answers older than CACHE_KEEP_DAYS, and stray part files. */
export async function pruneCache(cacheDir: string, now = Date.now()): Promise<number> {
  let removed = 0;
  for (const sub of ["files/playstation", "files/xbox", "files/epic", "files/nintendo", "http"]) {
    const dir = path.join(cacheDir, sub);
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      const f = path.join(dir, name);
      const st = await fs.stat(f).catch(() => undefined);
      if (!st?.isFile()) continue;
      const stale = now - st.mtimeMs > CACHE_KEEP_DAYS * 86_400_000;
      const strayPart = /\.part$|\.tmp\.mp4$/.test(name) && now - st.mtimeMs > 86_400_000;
      if (stale || strayPart) {
        await fs.rm(f, { force: true }).catch(() => undefined);
        removed++;
      }
    }
  }
  return removed;
}
