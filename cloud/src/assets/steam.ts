// Official store art from the Steam storefront. These are publisher-supplied
// marketing assets; every one is recorded with its source URL so provenance
// travels with the episode. Nothing here is footage.

import fs from "node:fs/promises";
import path from "node:path";
import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";
import { tokens } from "../discovery/cluster.ts";

export interface VisualAsset {
  kind: "hero" | "header" | "capsule" | "screenshot" | "logo" | "article";
  file: string; // path relative to the episode directory
  sourceUrl: string;
  provenance: string;
  width?: number;
  height?: number;
}

interface StoreSearchItem {
  id: number;
  name: string;
  type: string;
}

export function bestMatch(term: string, items: StoreSearchItem[]): StoreSearchItem | undefined {
  const want = tokens(term);
  if (want.size === 0) return undefined;
  let best: StoreSearchItem | undefined;
  let bestScore = 0;
  for (const it of items) {
    if (it.type !== "app") continue;
    const have = tokens(it.name);
    let shared = 0;
    for (const t of want) if (have.has(t)) shared++;
    // Penalise extra words so "Hades" doesn't pick "Hades II Soundtrack".
    const score = shared / want.size - Math.max(0, have.size - want.size) * 0.08;
    if (score > bestScore) {
      bestScore = score;
      best = it;
    }
  }
  return bestScore >= 0.75 ? best : undefined;
}

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, {}, 30_000);
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8_000) return false; // placeholders and 1px trackers
    await fs.writeFile(dest, buf);
    return true;
  } catch (err) {
    log("warn", "asset download failed", { url, error: errorMessage(err) });
    return false;
  }
}

export async function fetchSteamArt(term: string, episodeDir: string, maxScreens = 4): Promise<VisualAsset[]> {
  if (!term.trim()) return [];
  const search = await fetchWithTimeout(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=gb&l=english`);
  if (!search.ok) return [];
  const found = bestMatch(term, ((await search.json()) as { items?: StoreSearchItem[] }).items ?? []);
  if (!found) return [];
  const appId = found.id;
  const detailsRes = await fetchWithTimeout(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=gb&l=english`);
  const details = detailsRes.ok ? (((await detailsRes.json()) as Record<string, any>)[String(appId)]?.data ?? {}) : {};
  const prov = `Steam store asset for "${found.name}" (app ${appId}), publisher-supplied marketing art`;

  const cdn = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}`;
  const candidates: Array<Pick<VisualAsset, "kind" | "sourceUrl">> = [
    { kind: "hero", sourceUrl: `${cdn}/library_hero.jpg` },
    { kind: "capsule", sourceUrl: `${cdn}/library_600x900_2x.jpg` },
    { kind: "header", sourceUrl: details.header_image ?? `${cdn}/header.jpg` },
    { kind: "logo", sourceUrl: `${cdn}/logo.png` },
    ...((details.screenshots ?? []) as Array<{ path_full: string }>).slice(0, maxScreens).map((s) => ({ kind: "screenshot" as const, sourceUrl: s.path_full })),
  ];
  const dir = path.join(episodeDir, "assets");
  await fs.mkdir(dir, { recursive: true });
  const out: VisualAsset[] = [];
  let n = 0;
  for (const c of candidates) {
    const ext = c.sourceUrl.includes(".png") ? "png" : "jpg";
    const file = path.join("assets", `${c.kind}_${n++}.${ext}`);
    if (await download(c.sourceUrl, path.join(episodeDir, file))) out.push({ ...c, file, provenance: prov });
  }
  // The 460px header only looks acceptable when there is nothing better.
  return out.some((a) => a.kind === "hero" || a.kind === "screenshot") ? out.filter((a) => a.kind !== "header") : out;
}
