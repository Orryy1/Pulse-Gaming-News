// The game for a Buy, Wait or Skip Short (src/editorial/verdict.ts). CheapShark (free, keyless) lists Steam's
// current sales with Steam's own review share; every pick is then read from Steam itself (the US price, the UK and
// euro prices, the Metacritic figure on the store page, Steam's content flags) and from CheapShark's price history
// (the lowest US price it has tracked). A game Steam does not confirm is never picked. The pool is wider than the
// deals Short's (60% positive and up, 20% off and up), so a verdict can honestly come out WAIT or SKIP.
import {
  decideVerdict,
  type Verdict,
  type VerdictData,
} from "../editorial/verdict.ts";
import { errorMessage, log } from "../lib/util.ts";
import { getJson, money, steamName, steamPrice } from "./deals.ts";

export interface VerdictPoolItem {
  appId: number;
  gameId: string;
  name: string;
  pct: number;
  rating: number;
  reviews: number;
  year?: number;
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The pool (pure): a sale people have heard of, not featured lately, one row per game, best known first. */
export function verdictPool(
  raw: unknown[],
  exclude: string[],
): VerdictPoolItem[] {
  const skip = new Set(exclude.map(norm));
  const seen = new Set<string>();
  return (raw as Array<Record<string, unknown>>)
    .map((d) => ({
      appId: Number(d.steamAppID),
      gameId: String(d.gameID ?? ""),
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
        d.gameId &&
        d.name &&
        d.pct >= 20 &&
        d.rating >= 60 &&
        d.reviews >= 5000 &&
        !skip.has(norm(d.name)),
    )
    .filter((d) => !seen.has(norm(d.name)) && seen.add(norm(d.name)))
    .sort((a, b) => b.reviews - a.reviews);
}

/**
 * The game to judge (pure): the best known of the checked candidates, but not a third verdict in a row the same
 * as the last two, so the series does not read as a deals list with a stamp.
 */
export function pickVerdict(
  checked: VerdictData[],
  recentVerdicts: Verdict[],
): { data: VerdictData; verdict: Verdict; reason: string } | undefined {
  const judged = checked.map((data) => ({ data, ...decideVerdict(data) }));
  if (!judged.length) return undefined;
  const [a, b] = recentVerdicts;
  const tired = a && a === b ? a : undefined;
  return judged.find((j) => j.verdict !== tired) ?? judged[0];
}

/** CheapShark's lowest tracked US price for a game, any store, and its date. */
async function lowestEver(
  gameId: string,
): Promise<{ price: string; date?: string } | undefined> {
  const g = await getJson(
    `https://www.cheapshark.com/api/1.0/games?id=${encodeURIComponent(gameId)}`,
  ).catch(() => undefined);
  const c = g?.cheapestPriceEver;
  const price = Number(c?.price);
  if (!Number.isFinite(price) || price <= 0) return undefined;
  return {
    price: `$${price.toFixed(2)}`,
    date: Number(c?.date)
      ? new Date(Number(c.date) * 1000).toISOString().slice(0, 10)
      : undefined,
  };
}

/** Up to `n` candidates confirmed on Steam, each with every figure a verdict needs. */
export async function verdictCandidates(
  exclude: string[],
  n = 6,
): Promise<VerdictData[]> {
  try {
    const raw = ((await getJson(
      "https://www.cheapshark.com/api/1.0/deals?storeID=1&onSale=1&sortBy=Reviews&pageSize=60&steamRating=60",
    )) ?? []) as unknown[];
    const out: VerdictData[] = [];
    for (const c of verdictPool(raw, exclude)) {
      const us = await steamPrice(c.appId, "us");
      // Steam is the truth for the price: none there (a different edition, a delisted game) means no pick.
      if (!us || us.final <= 0) continue;
      const details = (
        await getJson(
          `https://store.steampowered.com/api/appdetails?appids=${c.appId}&cc=us&filters=basic,content_descriptors,metacritic`,
        ).catch(() => undefined)
      )?.[String(c.appId)]?.data;
      // Advertiser-safe picks only: Steam's own flags for sexual content (1, 3, 4) and frequent gore (2).
      const flags: number[] = details?.content_descriptors?.ids ?? [];
      if (flags.some((f) => [1, 2, 3, 4].includes(Number(f)))) continue;
      const gb = await steamPrice(c.appId, "gb");
      const de = await steamPrice(c.appId, "de");
      const low = await lowestEver(c.gameId);
      const meta = Number(details?.metacritic?.score);
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
        ...(Number.isFinite(meta) && meta > 0 ? { metacritic: meta } : {}),
        ...(low ? { lowest: low.price, lowestDate: low.date } : {}),
        checkedAt: new Date().toISOString(),
      });
      if (out.length >= n) break;
    }
    return out;
  } catch (err) {
    log("warn", "verdict candidates unavailable", { error: errorMessage(err) });
    return [];
  }
}
