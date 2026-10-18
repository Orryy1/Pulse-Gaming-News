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
    ) ?? pickIgdb(await q(`search "${safe}"; ${fields} limit 20;`), title, year)
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
  for (const [k, w] of want.entries()) {
    const url = IMG(w.id, w.size);
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const file = path.join("assets", `igdb_${k}.jpg`);
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
