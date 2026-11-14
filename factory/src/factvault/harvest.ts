// How the vault grows: from Wikipedia's citations (followed to the primary source and verified there), from Steam's
// store data, from the articles behind every story, and from every fact check's rejected claims.

import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../lib/util.ts";
import {
  marksIn,
  stripRefMarks,
  sentencesCiting,
  type WikiRef,
} from "../discovery/wikirefs.ts";
import { formatPrice, type SteamFacts } from "../assets/steam.ts";
import { extractClaims, outletIn, regionIn } from "./claims.ts";
import {
  dateWords,
  entityKey,
  datesIn,
  isoOf,
  moneyValue,
  normaliseQuote,
  normaliseText,
  originalUrl,
  sourceAllowed,
  sourceTypeOf,
  SOURCE_TRUST,
  wordsToNumber,
} from "./normalise.ts";
import {
  ARCHIVE_URL,
  AWARD_CONTEXT,
  COUNT_SPOKEN,
  ENGINE_CONTEXT,
  PERSON_ROLE,
  QUOTE_SPAN,
  RELEASE_CONTEXT,
  REVIEW_SCORE,
  REVIEW_URL,
  SALES_CONTEXT,
  SALES_DIGITS,
  SERIES_CONTEXT,
  SERIES_TOTAL,
  RELEASE_VERB_AT,
  CITED_PORT,
  REPORTING_VERB,
  VERDICT_WORDS,
} from "./patterns.ts";
import { parseBlocker, type VaultContext, entitiesIn } from "./check.ts";
import type { EntityKind, FactInput, FactKind, FactVault } from "./store.ts";

/** A page's readable text, whole (reviews run long: a stored quote must be findable anywhere in it). */
export interface PageText {
  url: string;
  title: string;
  text: string;
  published?: string;
}

export type PageReader = (url: string) => Promise<PageText | undefined>;

const UA =
  "Mozilla/5.0 (compatible; PulseFactVault/1.0; fact checking for a gaming news channel)";

/** Reads a page's paragraphs (no length cap beyond 120,000 characters); undefined when it won't open. */
export async function readPage(url: string): Promise<PageText | undefined> {
  const res = await fetchWithTimeout(
    url,
    {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    },
    25_000,
  ).catch(() => undefined);
  if (!res?.ok) return undefined;
  const type = res.headers.get("content-type") ?? "";
  if (!/html|xml|text/i.test(type)) return undefined;
  return pageFromHtml(await res.text(), url);
}

/** A page's text from its HTML (pure). */
export function pageFromHtml(html: string, url: string): PageText {
  const $ = cheerio.load(html);
  $(
    "script, style, noscript, nav, header, footer, aside, form, iframe",
  ).remove();
  const title = (
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text() ||
    ""
  ).trim();
  const published =
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[name="date"]').attr("content") ||
    $("time[datetime]").first().attr("datetime") ||
    undefined;
  const text = $("p, li, h1, h2, h3, blockquote, td")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((p) => p.length > 20)
    .join("\n")
    .slice(0, 120_000);
  return {
    url,
    title,
    text,
    ...(published ? { published: published.slice(0, 10) } : {}),
  };
}

/** Reads the original, then its archived copy. */
export async function readWithArchive(
  read: PageReader,
  ref: Pick<WikiRef, "url" | "archive">,
): Promise<PageText | undefined> {
  for (const u of [ref.url, ref.archive].filter((x): x is string =>
    Boolean(x),
  )) {
    const p = await read(u).catch(() => undefined);
    if (p && p.text.length > 300)
      return { ...p, url: ref.url ?? originalUrl(u) };
  }
  return undefined;
}

/** A claim a cited sentence makes, and the words its source must contain for it to count as verified. */
export interface CitedClaim {
  kind: FactKind;
  claim: string;
  value: string;
  valueJson?: Record<string, unknown>;
  region?: string;
  quote?: string;
  outlet?: string;
  /** Every one of these must appear in the source's text (normalised). */
  needs: string[];
  /** At least one of these must appear too, when given (a month written out or as a number). */
  anyOf?: string[];
  review?: boolean;
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** The claims one Wikipedia sentence makes that a source can verify (pure). */
export function citedClaims(sentence: string, game: string, aliases: readonly string[] = []): CitedClaim[] {
  const s = stripRefMarks(sentence).replace(/\s+/g, " ").trim();
  if (s.length < 20 || s.length > 600) return [];
  const out: CitedClaim[] = [];
  // Dates, sales, awards and credits only from a sentence that names the game ("It sold 5 million" may be another game).
  const key = `-${entityKey(s)}-`;
  const named = [game, ...aliases].some((n) => { const k = entityKey(n); return k.length > 0 && key.includes(`-${k}-`); });
  const outlet = outletIn(s);
  // Review quotes: "GameSpot's Greg Kasavin called it "a fine action game"". A reporting verb must introduce it, and a
  // quoted name ("Best Platformer", "Power Moons") or an aggregate's label ("universal acclaim") is not a critic's words.
  if (
    outlet &&
    REPORTING_VERB.test(s) &&
    !/metacritic|opencritic|gamerankings/i.test(outlet)
  )
    for (const m of s.matchAll(QUOTE_SPAN)) {
      const words = m[1]!.trim().replace(/[,;:]+$/, "");
      const ws = words.split(/\s+/);
      if (ws.length < 3) continue;
      if (
        ws.every(
          (w) =>
            /^[A-Z0-9&'’:-]/.test(w) ||
            /^(of|the|and|a|an|in|on|for|to)$/i.test(w),
        )
      )
        continue;
      out.push({
        kind: "review_quote",
        claim: `${outlet} on ${game}: “${words}”`,
        value: words,
        quote: words,
        outlet,
        needs: [words],
        review: true,
      });
    }
  const score = outlet ? s.match(REVIEW_SCORE) : null;
  if (outlet && score)
    out.push({
      kind: "review_score",
      claim: `${outlet} scored ${game} ${score[1]}/${score[2]}`,
      value: `${score[1]}/${score[2]}`,
      valueJson: { score: Number(score[1]), outOf: Number(score[2]) },
      outlet,
      needs: [score[1]!],
      review: true,
    });
  // A release date is the first full date after a release verb, in a sentence that is not about sales or a port.
  const verb = named ? s.match(RELEASE_VERB_AT) : null;
  if (verb && !SALES_CONTEXT.test(s) && !CITED_PORT.test(s)) {
    const after = s.slice(verb.index ?? 0, (verb.index ?? 0) + 90);
    const region = regionIn(s);
    for (const d of datesIn(after).filter((x) => x.month)) {
      out.push({
        kind: "release_date",
        claim: `${game} was released on ${dateWords(d)}${region ? ` (${region})` : ""}`,
        value: isoOf(d),
        valueJson: {
          year: d.year,
          month: d.month,
          ...(d.day ? { day: d.day } : {}),
        },
        ...(region ? { region } : {}),
        needs: [String(d.year)],
        anyOf: [
          MONTH_NAMES[d.month! - 1]!,
          MONTH_NAMES[d.month! - 1]!.slice(0, 3),
          `${d.year}-${String(d.month).padStart(2, "0")}`,
        ],
      });
      break; // the first date in a release sentence is the release; later ones are ports and regions
    }
  }
  // A sales figure for this game, not the series' or a publisher's combined total.
  if (named && SALES_CONTEXT.test(s) && !SERIES_TOTAL.test(s)) {
    const m = [...s.matchAll(SALES_DIGITS)][0];
    const spoken = !m ? [...s.matchAll(COUNT_SPOKEN)][0] : undefined;
    const count = m
      ? Number(m[1]!.replace(",", ".")) * (/^b/i.test(m[2]!) ? 1e9 : 1e6)
      : spoken
        ? wordsToNumber([...spoken[1]!.split(/\s+/), spoken[2]!])
        : undefined;
    if (count && count >= 10_000) {
      const asOf = datesIn(s).at(-1);
      out.push({
        kind: "sales",
        claim: s,
        value: m ? `${m[1]} ${m[2]}` : `${spoken![1]} ${spoken![2]}`,
        valueJson: { count, ...(asOf ? { asOf: isoOf(asOf) } : {}) },
        needs: m ? [m[1]!] : [spoken![1]!],
      });
    }
  }
  if (!named) return out;
  const award = s.match(AWARD_CONTEXT);
  if (award)
    out.push({ kind: "award", claim: s, value: award[2]!, needs: [award[2]!] });
  for (const m of s.matchAll(PERSON_ROLE)) {
    const name = (m[2] ?? m[4])?.trim();
    const role = (m[1] ?? m[3])?.toLowerCase();
    if (!name || name.split(" ").length < 2) continue;
    out.push({
      kind: "person",
      claim: s,
      value: `${name} (${role})`,
      valueJson: { name, role },
      needs: [name.split(" ").at(-1)!],
    });
  }
  const engine = s.match(ENGINE_CONTEXT);
  const engineName = engine?.[3]?.trim()
    ? `${engine[3].trim()} engine`
    : engine?.[4];
  if (engineName)
    out.push({
      kind: "engine",
      claim: s,
      value: engineName,
      needs: [engineName.replace(/\s*engine$/i, "")],
    });
  const series = s.match(SERIES_CONTEXT);
  if (series)
    out.push({
      kind: "series",
      claim: s,
      value: `${series[1]} ${series[2]!.trim()}`,
      valueJson: { relation: series[1], other: series[2]!.trim() },
      needs: [series[2]!.trim().split(" ").slice(0, 2).join(" ")],
    });
  return out;
}

/** Whether a source's text backs a cited claim (pure). */
export function verifiedBy(text: string, c: CitedClaim): boolean {
  const t = ` ${normaliseText(text)} `;
  const has = (w: string) => {
    const n = normaliseQuote(w);
    return (
      n.length > 0 &&
      (/^\d/.test(n)
        ? new RegExp(`(^|[^0-9.])${n.replace(/\./g, "\\.")}([^0-9]|$)`).test(t)
        : t.includes(n))
    );
  };
  if (!c.needs.every(has)) return false;
  if (c.anyOf?.length && !c.anyOf.some(has)) return false;
  return true;
}

export interface CitedHarvest {
  candidates: number;
  fetched: number;
  verified: number;
  stored: number;
  refused: number;
}

/**
 * Wikipedia as the map: each cited sentence's claim is checked in the source the sentence cites, and only a claim
 * found in that source's own text is stored, credited to that source. At most `maxFetch` sources read.
 */
export async function harvestCited(
  vault: FactVault,
  game: {
    name: string;
    kind?: EntityKind;
    aliases?: string[];
    external?: Record<string, unknown>;
  },
  page: { url: string; text: string; refs: readonly WikiRef[] },
  read: PageReader,
  opts: { maxFetch?: number; origin?: FactInput["origin"]; now?: Date } = {},
): Promise<CitedHarvest> {
  const stats: CitedHarvest = {
    candidates: 0,
    fetched: 0,
    verified: 0,
    stored: 0,
    refused: 0,
  };
  const byN = new Map(page.refs.map((r) => [r.n, r]));
  // Each reference with the claims its sentences make.
  const work = new Map<number, CitedClaim[]>();
  for (const n of marksIn(page.text)) {
    const ref = byN.get(n);
    if (
      !ref ||
      !(ref.url || ref.archive) ||
      !sourceAllowed(ref.url ?? ref.archive ?? "")
    )
      continue;
    const claims = sentencesCiting(page.text, n).flatMap((s) =>
      citedClaims(s, game.name, game.aliases ?? []),
    );
    if (claims.length) work.set(n, claims);
  }
  // Reviews and release dates first: they are what the writers reach for and what fact checks fail on.
  const priority = (cs: CitedClaim[]) =>
    Math.max(
      ...cs.map((c) =>
        c.kind === "review_quote"
          ? 5
          : c.kind === "release_date"
            ? 4
            : c.kind === "sales"
              ? 4
              : c.kind === "review_score"
                ? 3
                : 1,
      ),
    );
  const order = [...work.entries()].sort(
    (a, b) => priority(b[1]) - priority(a[1]),
  );
  stats.candidates = order.reduce((n, [, cs]) => n + cs.length, 0);
  const entity = await vault.upsertEntity({
    kind: game.kind ?? "game",
    name: game.name,
    aliases: game.aliases,
    external: { ...(game.external ?? {}), wikipedia: page.url },
  });
  for (const [n, claims] of order.slice(0, opts.maxFetch ?? 12)) {
    const ref = byN.get(n)!;
    const src = await readWithArchive(read, ref);
    if (!src) continue;
    stats.fetched++;
    const url = ref.url ?? originalUrl(src.url);
    for (const c of claims) {
      if (!verifiedBy(src.text, c)) continue;
      stats.verified++;
      const type = sourceTypeOf(url, {
        review: c.review || REVIEW_URL.test(url),
      });
      // A review quote is only a review quote when the source is a review by that outlet.
      if (
        c.kind === "review_quote" &&
        c.outlet &&
        !ref.outlet
          .toLowerCase()
          .includes(c.outlet.toLowerCase().slice(0, 5)) &&
        !url.toLowerCase().includes(
          c.outlet
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .slice(0, 6),
        )
      ) {
        stats.refused++;
        continue;
      }
      const r = await vault.addFact({
        entity,
        kind: c.kind,
        claim: c.claim,
        value: c.value,
        valueJson: c.valueJson,
        region: c.region,
        quote: c.quote,
        outlet: c.outlet ?? ref.outlet,
        sourceUrl: url,
        sourceType:
          c.kind === "review_quote" || c.kind === "review_score"
            ? "review"
            : type,
        discoveredVia: page.url,
        origin: opts.origin ?? "research",
        publishedAt: ref.date?.slice(0, 10) ?? src.published,
        checkedAt: opts.now,
        confidence:
          c.kind === "review_quote" || c.kind === "review_score"
            ? 0.9
            : SOURCE_TRUST[type],
      });
      if (r) stats.stored++;
      else stats.refused++;
    }
  }
  return stats;
}

// ---------------------------------------------------------------- Steam

/** Steam's store data as vault facts: price per currency, release date, developer, publisher, Metacritic. */
export async function harvestSteam(
  vault: FactVault,
  game: string,
  f: SteamFacts,
  details?: {
    developers?: string[];
    publishers?: string[];
    metacritic?: { score?: number; url?: string };
    steam_appid?: number;
    platforms?: Record<string, boolean>;
  },
  opts: { origin?: FactInput["origin"]; now?: Date } = {},
): Promise<number> {
  if (!f.storeUrl) return 0;
  const fromUrl = Number(f.storeUrl.match(/\/app\/(\d+)/)?.[1]);
  const appid =
    details?.steam_appid ?? (Number.isFinite(fromUrl) ? fromUrl : undefined);
  const entity = await vault.upsertEntity({
    kind: "game",
    name: game,
    aliases: f.name && f.name !== game ? [f.name] : [],
    external: appid ? { steam_appid: appid } : {},
  });
  const base: Omit<FactInput, "kind" | "claim" | "value"> = {
    entity,
    sourceUrl: f.storeUrl,
    sourceType: "store_page",
    outlet: "Steam",
    origin: opts.origin ?? "steam",
    checkedAt: opts.now ?? new Date(f.fetchedAt),
    confidence: 0.85,
  };
  let n = 0;
  const add = async (
    x: Partial<FactInput> & Pick<FactInput, "kind" | "claim" | "value">,
  ) => {
    if (await vault.addFact({ ...base, ...x })) n++;
  };
  for (const [cur, v] of Object.entries(f.prices ?? {}) as Array<
    [string, string | undefined]
  >) {
    const amount = v ? moneyValue(v.replace(/[^0-9.,]/g, "")) : NaN;
    if (!v || !Number.isFinite(amount)) continue;
    const currency = cur === "usd" ? "USD" : cur === "gbp" ? "GBP" : "EUR";
    await add({
      kind: "price",
      claim: `${game} costs ${v} on Steam (${currency})`,
      value: v,
      valueJson: { amount, currency },
      region: currency === "USD" ? "US" : currency === "GBP" ? "UK" : "EU",
      confidence: 0.9,
    });
  }
  if (f.price === "Free")
    await add({
      kind: "price",
      claim: `${game} is free to play on Steam`,
      value: "Free",
      valueJson: { amount: 0, currency: "USD" },
      region: "US",
      confidence: 0.9,
    });
  const d =
    f.releaseDate && !f.comingSoon ? datesIn(f.releaseDate)[0] : undefined;
  // Steam's date is the PC release, which is often a later port: kept as the PC date, never the original release.
  if (d)
    await add({
      kind: "platform",
      claim: `${game} came to PC on Steam on ${dateWords(d)}`,
      value: `PC (Steam) ${isoOf(d)}`,
      valueJson: { platform: "PC", year: d.year, month: d.month, day: d.day },
    });
  for (const dev of details?.developers ?? [])
    await add({
      kind: "developer",
      claim: `${game} was developed by ${dev}`,
      value: dev,
      confidence: 0.8,
    });
  for (const pub of details?.publishers ?? [])
    await add({
      kind: "publisher",
      claim: `${game} is published by ${pub}`,
      value: pub,
      confidence: 0.8,
    });
  const mc = details?.metacritic?.score ?? f.metacritic;
  if (mc)
    await add({
      kind: "review_score",
      claim: `${game} has a Metacritic score of ${mc}`,
      value: `${mc}/100`,
      valueJson: { score: mc, outOf: 100, aggregate: true },
      outlet: "Metacritic",
      sourceUrl: details?.metacritic?.url?.split("?")[0] || f.storeUrl,
      sourceType: "review_aggregate",
    });
  return n;
}

/** A store page's current prices from Steam's own data (the integrity job's price reader). */
export async function steamPrices(
  storeUrl: string,
): Promise<{ usd?: string; gbp?: string; eur?: string } | undefined> {
  const appid = storeUrl.match(/\/app\/(\d+)/)?.[1];
  if (!appid) return undefined;
  const get = async (cc: string) => {
    const res = await fetchWithTimeout(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${cc}&filters=price_overview`,
      {},
      15_000,
    ).catch(() => undefined);
    if (!res?.ok) return undefined;
    const body = (await res.json()) as Record<
      string,
      {
        success?: boolean;
        data?: { price_overview?: { currency?: string; final?: number } };
      }
    >;
    return body[appid]?.success
      ? formatPrice(body[appid]?.data?.price_overview)
      : undefined;
  };
  const [usd, gbp, eur] = await Promise.all([get("us"), get("gb"), get("de")]);
  return usd || gbp || eur ? { usd, gbp, eur } : undefined;
}

// ---------------------------------------------------------------- articles

const sentencesOf = (text: string) =>
  text
    .split(/\n+/)
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z“"])/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 400);

/**
 * A story's article as facts: sales milestones and release dates that name the game, and, for a review, its score
 * and its verdict sentences word for word (a review's own words are the only quotes the writers may use).
 */
export async function harvestArticle(
  vault: FactVault,
  game: string,
  a: {
    url: string;
    title: string;
    text: string;
    outlet?: string;
    published?: string;
    official?: boolean;
    /** Known to be a review (a Wikipedia review table cites it as one). */
    review?: boolean;
  },
  opts: { origin?: FactInput["origin"]; now?: Date; maxQuotes?: number } = {},
): Promise<number> {
  if (!sourceAllowed(a.url) || a.text.length < 200) return 0;
  const review =
    a.review || REVIEW_URL.test(a.url) || /\breview\b/i.test(a.title);
  const type = sourceTypeOf(a.url, { review, outletIsPublisher: a.official });
  const entity = await vault.upsertEntity({ kind: "game", name: game });
  const outlet = a.outlet;
  let n = 0;
  const add = async (
    x: Omit<
      FactInput,
      "entity" | "sourceUrl" | "sourceType" | "origin" | "confidence"
    > & { confidence?: number; sourceType?: FactInput["sourceType"] },
  ) => {
    if (
      await vault.addFact({
        entity,
        sourceUrl: a.url,
        sourceType: type,
        origin: opts.origin ?? "article",
        publishedAt: a.published,
        checkedAt: opts.now,
        confidence: SOURCE_TRUST[type],
        ...x,
      })
    )
      n++;
  };
  const gameWords = game
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  const namesGame = (s: string) =>
    gameWords.length > 0 &&
    gameWords.filter((w) => s.toLowerCase().includes(w)).length >=
      Math.min(2, gameWords.length);
  for (const s of sentencesOf(a.text)) {
    if (!namesGame(s) && !review) continue;
    for (const c of citedClaims(s, game)) {
      if (c.kind === "review_quote" || c.kind === "review_score") continue; // a review's words are taken below, from the review itself
      if (c.kind === "release_date" || c.kind === "sales")
        await add({
          kind: c.kind,
          claim: c.claim,
          value: c.value,
          valueJson: c.valueJson,
          region: c.region,
          outlet,
        });
    }
  }
  if (review && outlet) {
    const score = a.text.match(REVIEW_SCORE);
    if (score)
      await add({
        kind: "review_score",
        claim: `${outlet} scored ${game} ${score[1]}/${score[2]}`,
        value: `${score[1]}/${score[2]}`,
        valueJson: { score: Number(score[1]), outOf: Number(score[2]) },
        outlet,
        sourceType: "review",
        confidence: 0.85,
      });
    const verdicts = sentencesOf(a.text)
      .filter(
        (s) =>
          VERDICT_WORDS.test(s) &&
          s.split(/\s+/).length >= 6 &&
          s.split(/\s+/).length <= 40 &&
          !/[“"]/.test(s),
      )
      .slice(0, opts.maxQuotes ?? 25);
    for (const q of verdicts)
      await add({
        kind: "review_quote",
        claim: `${outlet} on ${game}: “${q}”`,
        value: q,
        quote: q,
        outlet,
        sourceType: "review",
        confidence: 0.9,
      });
  }
  return n;
}

// ---------------------------------------------------------------- review tables

/** One row of a Wikipedia "Reception" score table: the outlet, its score and the review it cites. */
export interface ReviewRow {
  outlet: string;
  score: string;
  url?: string;
  archive?: string;
}

/**
 * The review scores table on a game's Wikipedia page (pure). The table is the map to each outlet's own review: the
 * vault never stores the table's score, only what the review page it cites says.
 */
export function reviewTable(html: string): ReviewRow[] {
  const $ = cheerio.load(html);
  const notes = new Map<string, { url?: string; archive?: string }>();
  $('li[id^="cite_note"]').each((_, li) => {
    const links = $(li)
      .find("a.external, a[href^='http']")
      .map((_, a) => $(a).attr("href") ?? "")
      .get()
      .filter(
        (h) =>
          /^https?:/.test(h) &&
          !/wikipedia\.org|wikidata|doi\.org|worldcat|isbn/i.test(h),
      );
    const archive = links.find((h) => ARCHIVE_URL.test(h));
    const url =
      links.find((h) => !ARCHIVE_URL.test(h)) ??
      (archive ? originalUrl(archive) : undefined);
    notes.set($(li).attr("id") ?? "", {
      ...(url ? { url } : {}),
      ...(archive ? { archive } : {}),
    });
  });
  const rows: ReviewRow[] = [];
  const seen = new Set<string>();
  $(".video-game-reviews tr").each(
    (_, tr) => {
      const cells = $(tr).children("th, td");
      if (cells.length < 2) return;
      const outlet = cells
        .first()
        .text()
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\(.*?\)/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (
        !outlet ||
        outlet.length > 40 ||
        /^(publication|aggregator|aggregate|score|reviewer)s?$/i.test(outlet)
      )
        return;
      let hit:
        | { score: string; note?: { url?: string; archive?: string } }
        | undefined;
      cells.slice(1).each((_, td) => {
        if (hit) return;
        const sup = $(td)
          .find("sup.reference a")
          .first()
          .attr("href")
          ?.replace(/^#/, "");
        const score = $(td)
          .clone()
          .find("sup")
          .remove()
          .end()
          .text()
          .replace(/\s+/g, " ")
          .trim();
        if (sup && score) hit = { score, note: notes.get(sup) };
      });
      if (!hit?.note?.url || seen.has(hit.note.url)) return;
      seen.add(hit.note.url);
      rows.push({
        outlet,
        score: hit.score,
        url: hit.note.url,
        ...(hit.note.archive ? { archive: hit.note.archive } : {}),
      });
    },
  );
  return rows;
}

/**
 * Each review the table cites, read at the outlet (or its archived copy): the score when the page itself shows it, and
 * the reviewer's verdict sentences word for word, the only critic's words the writers may quote.
 */
export async function harvestReviews(
  vault: FactVault,
  game: string,
  rows: readonly ReviewRow[],
  read: PageReader,
  opts: {
    max?: number;
    origin?: FactInput["origin"];
    now?: Date;
    discoveredVia?: string;
  } = {},
): Promise<{ read: number; stored: number }> {
  let readN = 0;
  let stored = 0;
  const entity = await vault.upsertEntity({ kind: "game", name: game });
  for (const r of rows
    .filter((x) => !/metacritic|opencritic|gamerankings/i.test(x.outlet))
    .slice(0, opts.max ?? 8)) {
    const page = await readWithArchive(read, r);
    if (!page || !r.url) continue;
    readN++;
    const score =
      r.score.match(REVIEW_SCORE) ??
      r.score.match(/^(\d{1,3}(?:\.\d)?)\s*(?:\/\s*(10|100|5))?/);
    if (
      score?.[1] &&
      verifiedBy(page.text, {
        kind: "review_score",
        claim: "",
        value: score[1],
        needs: [score[1]],
      })
    ) {
      const outOf = score[2] ?? (Number(score[1]) > 10 ? "100" : "10");
      if (
        await vault.addFact({
          entity,
          kind: "review_score",
          claim: `${r.outlet} scored ${game} ${score[1]}/${outOf}`,
          value: `${score[1]}/${outOf}`,
          valueJson: { score: Number(score[1]), outOf: Number(outOf) },
          outlet: r.outlet,
          sourceUrl: r.url,
          sourceType: "review",
          discoveredVia: opts.discoveredVia,
          origin: opts.origin ?? "research",
          publishedAt: page.published,
          checkedAt: opts.now,
          confidence: 0.9,
        })
      )
        stored++;
    }
    stored += await harvestArticle(
      vault,
      game,
      {
        url: r.url,
        title: page.title,
        text: page.text,
        outlet: r.outlet,
        published: page.published,
        review: true,
      },
      { origin: opts.origin ?? "research", now: opts.now },
    );
  }
  return { read: readN, stored };
}

// ---------------------------------------------------------------- fact checks

/** Every blocker a fact check raised becomes a dispute on its game, so the writers are told and a repeat is caught. */
export async function harvestBlockers(
  vault: FactVault,
  ctx: VaultContext,
  blockers: readonly string[],
  episodeId?: string,
): Promise<number> {
  let n = 0;
  for (const raw of blockers) {
    const b = parseBlocker(raw);
    if (!b) continue;
    const ents = entitiesIn(`${b.quote} ${b.problem}`, ctx);
    await vault.addDispute({
      entityId: ents.length === 1 ? ents[0]!.id : undefined,
      claim: b.quote,
      reason: b.problem,
      episodeId,
    });
    n++;
  }
  return n;
}

/** The quotes a passed script used, when they match a stored review quote: confirmation that raises the fact's confidence. */
export function quotesUsed(texts: readonly string[]): string[] {
  return texts.flatMap((t) =>
    extractClaims(t)
      .filter((c) => c.kind === "quote")
      .map((c) => (c as { words: string }).words),
  );
}
