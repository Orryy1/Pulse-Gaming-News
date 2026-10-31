// Data for the weekly lanes. Release Radar: Steam's most-wishlisted upcoming
// games that actually release in the next seven days. Free This Week: what
// the Epic Games Store gives away now, and what it gives next. The Weekly
// Recap reads the factory's own sightings table, so it needs nothing here.

import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";

export interface RadarGame {
  name: string;
  appId: number;
  date: string; // ISO YYYY-MM-DD
  price?: string;
  developer?: string;
}

export interface FreeGame {
  title: string;
  url: string;
  until?: string; // ISO instant the offer ends
  starts?: string; // ISO instant, for next week's game
  originalPrice?: string; // "$19.99"
  description: string;
  imageUrl?: string;
  seller?: string;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Steam's "Oct 23, 2026" or "23 Oct, 2026" to "2026-10-23"; vague dates ("Q4 2026", "Coming soon") are undefined. */
export function parseSteamDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const a = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  const b = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/);
  const [mon, day, year] = a
    ? [a[1]!, a[2]!, a[3]!]
    : b
      ? [b[2]!, b[1]!, b[3]!]
      : [];
  const m = mon ? MONTHS[mon.toLowerCase()] : undefined;
  if (!m || !day || !year) return undefined;
  return `${year}-${String(m).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

/** App ids from the search result capsule URLs (".../apps/4435490/..."). */
export function appIdsFromSearch(json: {
  items?: Array<{ name?: string; logo?: string }>;
}): Array<{ name: string; appId: number }> {
  const out: Array<{ name: string; appId: number }> = [];
  for (const it of json.items ?? []) {
    const id = Number(it.logo?.match(/\/apps\/(\d+)\//)?.[1]);
    if (it.name && Number.isFinite(id) && id > 0)
      out.push({ name: it.name, appId: id });
  }
  return out;
}

/** Popular upcoming Steam games releasing between `from` and `from + days`, earliest first. */
export async function releaseRadar(
  from: Date,
  days = 7,
  max = 8,
): Promise<RadarGame[]> {
  try {
    const res = await fetchWithTimeout(
      "https://store.steampowered.com/search/results/?query&start=0&count=50&filter=popularcomingsoon&json=1&cc=us&l=english",
      {},
      20_000,
    );
    if (!res.ok) throw new Error(`steam search HTTP ${res.status}`);
    const apps = appIdsFromSearch(
      (await res.json()) as { items?: Array<{ name?: string; logo?: string }> },
    );
    const start = from.toISOString().slice(0, 10);
    const end = new Date(from.getTime() + days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const out: RadarGame[] = [];
    for (const a of apps.slice(0, 40)) {
      const d = await fetchWithTimeout(
        `https://store.steampowered.com/api/appdetails?appids=${a.appId}&cc=us&l=english`,
        {},
        15_000,
      )
        .then((r) => (r.ok ? r.json() : undefined))
        .catch(() => undefined);
      const data = (d as Record<string, any> | undefined)?.[String(a.appId)]
        ?.data;
      const date = parseSteamDate(data?.release_date?.date);
      if (!date || date < start || date >= end) continue;
      out.push({
        name: data?.name ?? a.name,
        appId: a.appId,
        date,
        price: data?.price_overview?.final_formatted,
        developer: data?.developers?.[0],
      });
      if (out.length >= max) break;
    }
    return out.sort((x, y) => x.date.localeCompare(y.date));
  } catch (err) {
    log("warn", "release radar unavailable", { error: errorMessage(err) });
    return [];
  }
}

/** Epic's free-games feed: what is free to keep now, and what is free next. */
export function parseEpic(
  json: any,
  now: Date,
): { now: FreeGame[]; next: FreeGame[] } {
  const els: any[] = json?.data?.Catalog?.searchStore?.elements ?? [];
  const nowList: FreeGame[] = [];
  const next: FreeGame[] = [];
  for (const g of els) {
    const offer = (
      g.promotions?.promotionalOffers?.[0]?.promotionalOffers ?? []
    ).find((o: any) => o?.discountSetting?.discountPercentage === 0);
    const soon = (
      g.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers ?? []
    ).find((o: any) => o?.discountSetting?.discountPercentage === 0);
    const slug =
      g.productSlug ||
      g.catalogNs?.mappings?.[0]?.pageSlug ||
      g.offerMappings?.[0]?.pageSlug ||
      g.urlSlug;
    if (!slug || (!offer && !soon)) continue;
    const wide =
      (g.keyImages ?? []).find((k: any) => k.type === "OfferImageWide") ??
      (g.keyImages ?? []).find((k: any) => k.type === "DieselStoreFrontWide");
    const game: FreeGame = {
      title: String(g.title ?? "").trim(),
      url: `https://store.epicgames.com/en-US/p/${String(slug).replace(/\/home$/, "")}`,
      originalPrice:
        g.price?.totalPrice?.fmtPrice?.originalPrice &&
        g.price.totalPrice.fmtPrice.originalPrice !== "0"
          ? g.price.totalPrice.fmtPrice.originalPrice
          : undefined,
      description: String(g.description ?? "").trim(),
      imageUrl: wide?.url,
      seller: g.seller?.name,
    };
    if (!game.title || /mystery game/i.test(game.title)) continue;
    if (
      offer &&
      new Date(offer.startDate) <= now &&
      new Date(offer.endDate) > now
    )
      nowList.push({ ...game, until: offer.endDate });
    else if (soon)
      next.push({ ...game, starts: soon.startDate, until: soon.endDate });
  }
  return { now: nowList, next };
}

export async function freeGames(
  now: Date,
): Promise<{ now: FreeGame[]; next: FreeGame[] }> {
  try {
    const res = await fetchWithTimeout(
      "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US",
      {},
      20_000,
    );
    if (!res.ok) throw new Error(`epic HTTP ${res.status}`);
    return parseEpic(await res.json(), now);
  } catch (err) {
    log("warn", "epic free games unavailable", { error: errorMessage(err) });
    return { now: [], next: [] };
  }
}
