// IGDB (Twitch's games database) for pictures of games Steam cannot supply:
// console exclusives, Nintendo titles, delisted classics, unreleased games.
// Official screenshots, key art and box covers, matched by exact title (and
// release year when known) so a search for "Grand Theft Auto" can never hand
// back GTA V. Needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.

import fs from "node:fs/promises";
import path from "node:path";
import type { VisualAsset } from "./steam.ts";

export interface IgdbGame {
  id: number;
  name: string;
  year?: number;
  category?: number; // 0 main game
  screenshots: string[]; // image ids
  artworks: string[];
  cover?: string;
}

let token: { value: string; until: number } | undefined;

async function accessToken(
  clientId: string,
  secret: string,
  fetchFn: typeof fetch,
): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const res = await fetchFn(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`,
    { method: "POST" },
  );
  const j = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!j.access_token) throw new Error("IGDB: Twitch token refused");
  token = {
    value: j.access_token,
    until: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
  return j.access_token;
}

export const normTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The entry that is exactly this game: same title, a main game first, nearest release year. */
const ROMAN: Array<[string, string]> = [
  ["2", "II"], ["3", "III"], ["4", "IV"], ["5", "V"], ["6", "VI"], ["7", "VII"], ["8", "VIII"], ["9", "IX"], ["10", "X"],
];

/**
 * The same title with its number written the other way: "Grand Theft Auto 6" is "Grand Theft Auto VI" on IGDB. On
 * 5 Nov 2026 a GTA 6 Short found no art at all under the writer's spelling, and stopped at 71% empty panel.
 */
export function numberVariant(title: string): string | undefined {
  for (const [digit, roman] of ROMAN) {
    const d = new RegExp(`\\b${digit}\\b(?=[^\\d]*$)`);
    if (d.test(title)) return title.replace(d, roman);
    const r = new RegExp(`\\b${roman}\\b(?=[^IVXivx]*$)`);
    if (r.test(title)) return title.replace(r, digit);
  }
  return undefined;
}

export function pickIgdb(
  games: IgdbGame[],
  title: string,
  year?: number,
): IgdbGame | undefined {
  const want = normTitle(title);
  const exact = games.filter((g) => normTitle(g.name) === want);
  return exact.sort(
    (a, b) =>
      Number((a.category ?? 0) !== 0) - Number((b.category ?? 0) !== 0) ||
      (year
        ? Math.abs((a.year ?? 0) - year) - Math.abs((b.year ?? 0) - year)
        : 0) ||
      b.screenshots.length +
        b.artworks.length -
        (a.screenshots.length + a.artworks.length),
  )[0];
}

export function parseIgdb(rows: any[]): IgdbGame[] {
  return (rows ?? []).map((g) => ({
    id: Number(g.id),
    name: String(g.name ?? ""),
    year: g.first_release_date
      ? new Date(g.first_release_date * 1000).getUTCFullYear()
      : undefined,
    category: typeof g.category === "number" ? g.category : g.game_type,
    screenshots: (g.screenshots ?? [])
      .map((s: any) => String(s.image_id))
      .filter(Boolean),
    artworks: (g.artworks ?? [])
      .map((s: any) => String(s.image_id))
      .filter(Boolean),
    cover: g.cover?.image_id ? String(g.cover.image_id) : undefined,
  }));
}

export async function findIgdbGame(
  creds: { clientId: string; secret: string },
  title: string,
  year?: number,
  fetchFn: typeof fetch = fetch,
): Promise<IgdbGame | undefined> {
  if (!creds.clientId || !creds.secret) return undefined;
  const bearer = await accessToken(creds.clientId, creds.secret, fetchFn);
  const fields =
    "fields name,first_release_date,category,screenshots.image_id,artworks.image_id,cover.image_id;";
  const q = async (body: string) => {
    const res = await fetchFn("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": creds.clientId,
        Authorization: `Bearer ${bearer}`,
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? parseIgdb((await res.json()) as any[]) : [];
  };
  const safe = title.replace(/"/g, "");
  // Exact name first (a plain search ranks sequels above the original), then a search filtered to exact matches.
  return (
    pickIgdb(
      await q(`${fields} where name ~ "${safe}"; limit 20;`),
      title,
      year,
    ) ??
    pickIgdb(await q(`search "${safe}"; ${fields} limit 20;`), title, year) ??
    (await (async () => {
      // The number written the other way, then the name without its subtitle ("Street Fighter II: The World Warrior"
      // is "Street Fighter II" on IGDB; that one entry left a ranking 12% empty panel, 3 Nov 2026).
      const short = safe.includes(":") ? safe.split(":")[0]!.trim() : undefined;
      for (const other of [numberVariant(safe), short].filter(Boolean) as string[]) {
        const hit =
          pickIgdb(
            await q(`${fields} where name ~ "${other}"; limit 20;`),
            other,
            year,
          ) ??
          pickIgdb(await q(`search "${other}"; ${fields} limit 20;`), other, year);
        if (hit) return hit;
      }
      return undefined;
    })())
  );
}

const IMG = (id: string, size: string) =>
  `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg`;

/** Downloads up to `max` pictures of the game: screenshots first, then key art, plus the cover as box art. */
export async function fetchIgdbArt(
  game: IgdbGame,
  episodeDir: string,
  max = 10,
  fetchFn: typeof fetch = fetch,
): Promise<VisualAsset[]> {
  const out: VisualAsset[] = [];
  const dir = path.join(episodeDir, "assets");
  await fs.mkdir(dir, { recursive: true });
  const want: Array<{ id: string; kind: VisualAsset["kind"]; size: string }> = [
    ...game.screenshots.map((id) => ({
      id,
      kind: "screenshot" as const,
      size: "t_1080p",
    })),
    ...game.artworks.map((id) => ({
      id,
      kind: "hero" as const,
      size: "t_1080p",
    })),
  ].slice(0, max);
  if (game.cover)
    want.push({ id: game.cover, kind: "capsule", size: "t_cover_big_2x" });
  for (const w of want) {
    const url = IMG(w.id, w.size);
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      // Named by IGDB's own picture id, so a second fetch into the same folder rewrites a file with the same
      // picture and never puts a different one under a name an earlier pass placed (it was igdb_<k>).
      const file = path.join("assets", `igdb-${w.id}.jpg`);
      await fs.writeFile(
        path.join(episodeDir, file),
        Buffer.from(await res.arrayBuffer()),
      );
      out.push({
        kind: w.kind,
        file,
        sourceUrl: url,
        provenance: `IGDB ${w.kind === "capsule" ? "cover" : w.kind === "hero" ? "key art" : "screenshot"} for "${game.name}"${game.year ? ` (${game.year})` : ""}, publisher material via igdb.com`,
      });
    } catch {
      // one missing picture never fails the rest
    }
  }
  return out;
}

// ---------------------------------------------------------------- series
// Every game of a series, for the "Story of Every [series] Game" format (src/editorial/everygame.ts): one row per
// IGDB entry filed under the franchise or collection of that name, with the platforms each first came out on.

export interface IgdbSeriesRow {
  id: number;
  name: string;
  /** First release, ISO date; absent for an entry IGDB has no date for (cancelled, rumoured). */
  date?: string;
  year?: number;
  /** IGDB's game type: 0 main game, 1 DLC, 2 expansion, 3 bundle, 4 standalone expansion, 8 remake, 9 remaster, 10 expanded, 11 port, 13 pack, 14 update. */
  type: number;
  /** An edition of another entry (a special edition, a bundle with a currency card). */
  edition: boolean;
  /** Platforms it first came out on (within 13 months of the first release), earliest first, as IGDB abbreviates them. */
  platforms: string[];
  /** Every platform it has ever been on. */
  allPlatforms: string[];
  ratings: number;
  screenshots: number;
  cover?: string;
}

const LEAD_WINDOW_SECONDS = 400 * 86_400;

export function parseIgdbSeries(rows: any[]): IgdbSeriesRow[] {
  return (rows ?? []).map((g) => {
    const first: number | undefined = g.first_release_date;
    const byPlatform = new Map<string, number>();
    for (const r of g.release_dates ?? []) {
      const p = String(r.platform?.abbreviation ?? r.platform?.name ?? "");
      if (!p || typeof r.date !== "number") continue;
      byPlatform.set(p, Math.min(byPlatform.get(p) ?? Infinity, r.date));
    }
    const all = (g.platforms ?? [])
      .map((p: any) => String(p.abbreviation ?? p.name ?? ""))
      .filter(Boolean);
    const lead = [...byPlatform.entries()]
      .filter(([, d]) => first === undefined || d - first <= LEAD_WINDOW_SECONDS)
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(([p]) => p);
    return {
      id: Number(g.id),
      name: String(g.name ?? ""),
      ...(first
        ? {
            date: new Date(first * 1000).toISOString().slice(0, 10),
            year: new Date(first * 1000).getUTCFullYear(),
          }
        : {}),
      type: typeof g.game_type === "number" ? g.game_type : Number(g.category ?? 0),
      edition: Boolean(g.version_parent),
      platforms: lead.length ? lead : all,
      allPlatforms: all,
      ratings: Number(g.total_rating_count ?? 0),
      screenshots: (g.screenshots ?? []).length,
      cover: g.cover?.image_id ? String(g.cover.image_id) : undefined,
    };
  });
}

/** Every IGDB entry filed under the series' franchise or collection, oldest first (undated last). */
export async function findIgdbSeries(
  creds: { clientId: string; secret: string },
  series: string,
  fetchFn: typeof fetch = fetch,
): Promise<IgdbSeriesRow[]> {
  if (!creds.clientId || !creds.secret) return [];
  const bearer = await accessToken(creds.clientId, creds.secret, fetchFn);
  const safe = series.replace(/"/g, "");
  const res = await fetchFn("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "Client-ID": creds.clientId, Authorization: `Bearer ${bearer}` },
    body: `fields name,first_release_date,game_type,category,version_parent,platforms.name,platforms.abbreviation,release_dates.date,release_dates.platform.name,release_dates.platform.abbreviation,total_rating_count,screenshots.image_id,cover.image_id; where (franchises.name ~ "${safe}" | collections.name ~ "${safe}" | franchise.name ~ "${safe}"); sort first_release_date asc; limit 300;`,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`IGDB series lookup failed: ${res.status}`);
  const rows = parseIgdbSeries((await res.json()) as any[]);
  return rows.sort(
    (a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.id - b.id,
  );
}
