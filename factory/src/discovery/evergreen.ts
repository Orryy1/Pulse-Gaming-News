// Where evergreen topics come from: what people are buying on Steam right
// now, plus the franchises that always pull viewers. No news feeds involved.

import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";
import type { EvergreenCandidate } from "../editorial/evergreen.ts";

/** Franchises and themes that make strong ranking Shorts whatever the week's news. */
export const FRANCHISE_SEEDS: string[] = [
  "Grand Theft Auto",
  "The Legend of Zelda",
  "Resident Evil",
  "Call of Duty",
  "Final Fantasy",
  "The Elder Scrolls",
  "Fallout",
  "Assassin's Creed",
  "Halo",
  "God of War",
  "Metal Gear",
  "Mass Effect",
  "The Witcher",
  "Dark Souls and Elden Ring",
  "Super Mario",
  "Pokemon",
  "Street Fighter",
  "Mortal Kombat",
  "Forza",
  "Gran Turismo",
  "Batman Arkham",
  "BioShock",
  "Half-Life and Portal",
  "Uncharted",
  "Monster Hunter",
  "Persona",
  "Civilization",
  "Doom",
  "open-world games of the 2010s",
  "co-op games to play with friends",
  "indie games that beat the big studios",
  "remakes that beat the originals",
];

/** Current Steam top sellers (names only), or an empty list when the store does not answer. */
export async function steamTopSellers(
  limit = 20,
): Promise<EvergreenCandidate[]> {
  try {
    const res = await fetchWithTimeout(
      "https://store.steampowered.com/api/featuredcategories?cc=gb&l=english",
      {},
      15_000,
    );
    if (!res.ok) return [];
    const j = (await res.json()) as {
      top_sellers?: { items?: Array<{ name?: string; discounted?: boolean }> };
    };
    const items = (j.top_sellers?.items ?? [])
      .map((i) => i.name)
      .filter((n): n is string => Boolean(n));
    return [...new Set(items)]
      .slice(0, limit)
      .map((name) => ({ name, source: "steam top sellers" }));
  } catch (err) {
    log("warn", "steam top sellers unavailable", { error: errorMessage(err) });
    return [];
  }
}

/** Candidates for the editor: Steam's top sellers first, then the franchise seeds, rotated by the day so the list is not identical every time. */
export async function evergreenCandidates(
  dayKey: string,
): Promise<EvergreenCandidate[]> {
  const sellers = await steamTopSellers();
  const rotate = Number(dayKey.replace(/-/g, "")) % FRANCHISE_SEEDS.length;
  const seeds = [
    ...FRANCHISE_SEEDS.slice(rotate),
    ...FRANCHISE_SEEDS.slice(0, rotate),
  ]
    .slice(0, 12)
    .map((name) => ({ name, source: "franchise seed" }));
  return [...sellers.slice(0, 8), ...seeds];
}
