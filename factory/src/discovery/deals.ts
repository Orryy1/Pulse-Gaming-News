// Today's best Steam deals for the daily deals Short. CheapShark (free, keyless) ranks Steam's
// sales by deal quality; every pick is then checked against Steam's own US price, and Steam's UK
// and euro prices ride along so the screen can show dollars first with pounds and euros beside.
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";

export interface Deal {
  appId: number;
  name: string;
  year?: number;
  usd: { final: string; initial: string; pct: number };
  gbp?: string;
  eur?: string;
  rating: number; // Steam review percentage
  reviews: number;
  /** When the prices were read from Steam. */
  checkedAt?: string;
  /** When Steam says the US discount ends, if it says. */
  endsAt?: string;
}

const UA = { "user-agent": "PulseGamingNews/1.0 (+https://pulsegmg.com)" };

async function getJson(url: string): Promise<any> {
  const res = await fetchWithTimeout(url, { headers: UA }, 15_000);
  return res.ok ? res.json() : undefined;
}

const money = (cents: number, symbol: string) =>
  `${symbol}${(cents / 100).toFixed(2)}`;

/** Steam's live price in one country, or undefined when the store has none. */
async function steamPrice(
  appId: number,
  cc: string,
): Promise<
  { final: number; initial: number; pct: number; formatted: string } | undefined
> {
  const p = (
    await getJson(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${cc}&filters=price_overview`,
    ).catch(() => undefined)
  )?.[String(appId)]?.data?.price_overview;
  if (!p) return undefined;
  return {
    final: Number(p.final),
    initial: Number(p.initial),
    pct: Number(p.discount_percent),
    formatted: String(p.final_formatted ?? ""),
  };
}

/** When Steam's current US discount on the game ends (its store API, no key needed), if it gives one. */
async function steamSaleEnd(appId: number): Promise<string | undefined> {
  const q = encodeURIComponent(
    JSON.stringify({ ids: [{ appid: appId }], context: { language: "english", country_code: "US" }, data_request: { include_all_purchase_options: true } }),
  );
  const item = (await getJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=${q}`).catch(() => undefined))?.response
    ?.store_items?.[0];
  const ends = (item?.best_purchase_option?.active_discounts ?? [])
    .map((d: { discount_end_date?: number }) => Number(d.discount_end_date))
    .filter((t: number) => t > 0);
  return ends.length ? new Date(Math.min(...ends) * 1000).toISOString() : undefined;
}

/** Score for a deal: a big cut on a game people love, with enough reviews to trust the score. */
export function dealScore(d: {
  pct: number;
  rating: number;
  reviews: number;
}): number {
  return d.pct * (d.rating / 100) ** 2 * Math.log10(Math.max(10, d.reviews));
}

/**
 * Up to `n` well-reviewed Steam games at least half off, skipping any name in `exclude` (featured
 * recently). Each is confirmed on sale in the US by Steam itself.
 */
/**
 * The game's name as Steam writes it. CheapShark drops apostrophes ("Dragons Dogma: Dark Arisen"), which
 * the vision check failed as a misspelt card beside a caption that had it right (QA notes, 26 Oct 2026).
 */
export function steamName(steam: unknown, fallback: string): string {
  return typeof steam === "string" && steam.trim() ? steam.trim() : fallback;
}

export async function steamDeals(exclude: string[], n = 5): Promise<Deal[]> {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const skip = new Set(exclude.map(norm));
  try {
    const raw = ((await getJson(
      "https://www.cheapshark.com/api/1.0/deals?storeID=1&onSale=1&sortBy=Deal%20Rating&pageSize=60&steamRating=85",
    )) ?? []) as any[];
    const seen = new Set<string>();
    const candidates = raw
      .map((d) => ({
        appId: Number(d.steamAppID),
        name: String(d.title ?? "").trim(),
        pct: Math.round(Number(d.savings)),
        rating: Number(d.steamRatingPercent),
        reviews: Number(d.steamRatingCount),
        year: Number(d.releaseDate)
          ? new Date(Number(d.releaseDate) * 1000).getUTCFullYear()
          : undefined,
      }))
      .filter(
        (d) =>
          d.appId &&
          d.name &&
          d.pct >= 50 &&
          d.rating >= 85 &&
          d.reviews >= 3000 &&
          !skip.has(norm(d.name)),
      )
      .filter((d) => !seen.has(norm(d.name)) && seen.add(norm(d.name)))
      .sort((a, b) => dealScore(b) - dealScore(a));
    const out: Deal[] = [];
    for (const c of candidates) {
      const us = await steamPrice(c.appId, "us");
      // Steam is the truth: no US discount there (ended, or a different edition) means no pick.
      if (!us || us.pct < 50 || us.final <= 0) continue;
      // Advertiser-safe picks only: Steam's own flags for sexual content (1, 3, 4) and frequent gore (2).
      const details = (
        await getJson(`https://store.steampowered.com/api/appdetails?appids=${c.appId}&cc=us&filters=basic,content_descriptors`).catch(() => undefined)
      )?.[String(c.appId)]?.data;
      const flags: number[] = details?.content_descriptors?.ids ?? [];
      if (flags.some((f) => [1, 2, 3, 4].includes(Number(f)))) continue;
      const gb = await steamPrice(c.appId, "gb");
      const de = await steamPrice(c.appId, "de");
      const endsAt = await steamSaleEnd(c.appId);
      out.push({
        appId: c.appId,
        name: steamName(details?.name, c.name),
        year: c.year,
        usd: {
          final: money(us.final, "$"),
          initial: money(us.initial, "$"),
          pct: us.pct,
        },
        gbp: gb?.formatted || undefined,
        eur: de?.formatted || undefined,
        rating: c.rating,
        reviews: c.reviews,
        checkedAt: new Date().toISOString(),
        ...(endsAt ? { endsAt } : {}),
      });
      if (out.length >= n) break;
    }
    return out;
  } catch (err) {
    log("warn", "steam deals unavailable", { error: errorMessage(err) });
    return [];
  }
}
