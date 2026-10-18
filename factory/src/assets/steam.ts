// Official Steam storefront material: publisher-supplied key art, trailer
// B-roll (short, muted, credited clips) and live store data (price, reviews,
// current players). Everything is recorded with its source URL.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";
import { tokens } from "../discovery/cluster.ts";
import { FFMPEG } from "../lib/bin.ts";

const run = promisify(execFile);

export interface VisualAsset {
  kind: "hero" | "header" | "capsule" | "screenshot" | "logo" | "article" | "clip" | "photo"; // photo: a freely licensed archive photo (Wikimedia Commons)
  file: string; // path relative to the episode directory
  sourceUrl: string;
  provenance: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  // Beat-matched clips (src/assets/clipscore.ts)
  beatIndex?: number; // clips: the line; images: the ranking entry
  role?: "hook";
  stock?: boolean; // licensed stock footage, shown with an ILLUSTRATIVE tag
  startSeconds?: number;
  motion?: number; // 0-1
  luma?: number; // 0-255
  label?: string;
  reason?: string;
  moment?: number; // long-form: the sentence of the entry this picture was picked for
}

interface StoreSearchItem {
  id: number;
  name: string;
  type: string;
}

export interface SteamApp {
  appId: number;
  name: string;
  details: Record<string, any>;
}

export interface SteamFacts {
  name: string;
  storeUrl: string;
  price?: string; // US price, the channel's lead currency
  prices?: { usd?: string; gbp?: string; eur?: string };
  releaseDate?: string;
  comingSoon?: boolean;
  metacritic?: number;
  reviewSummary?: string;
  positivePercent?: number;
  totalReviews?: number;
  currentPlayers?: number;
  fetchedAt: string;
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

export async function findSteamApp(term: string): Promise<SteamApp | undefined> {
  if (!term.trim()) return undefined;
  const search = await fetchWithTimeout(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=english`);
  if (!search.ok) return undefined;
  const found = bestMatch(term, ((await search.json()) as { items?: StoreSearchItem[] }).items ?? []);
  if (!found) return undefined;
  const res = await fetchWithTimeout(`https://store.steampowered.com/api/appdetails?appids=${found.id}&cc=us&l=english`);
  const details = res.ok ? (((await res.json()) as Record<string, any>)[String(found.id)]?.data ?? {}) : {};
  return { appId: found.id, name: details.name ?? found.name, details };
}

async function json(url: string): Promise<any> {
  try {
    const res = await fetchWithTimeout(url, {}, 15_000);
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

const SYMBOL: Record<string, string> = { USD: "$", GBP: "£", EUR: "€" };

/** "$69.99" / "£59.99" / "€69.99" from Steam's price_overview (amounts in cents), whatever its own formatting. */
export function formatPrice(p: { currency?: string; final?: number } | undefined): string | undefined {
  if (!p || typeof p.final !== "number" || !p.currency || !SYMBOL[p.currency]) return undefined;
  return `${SYMBOL[p.currency]}${(p.final / 100).toFixed(2)}`;
}

/** Live numbers a viewer can't get from the headline: the raw material for a data card. */
export async function steamFacts(app: SteamApp): Promise<SteamFacts> {
  const d = app.details;
  const [reviews, players, gb, de] = await Promise.all([
    json(`https://store.steampowered.com/appreviews/${app.appId}?json=1&language=all&purchase_type=all&num_per_page=0`),
    json(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${app.appId}`),
    json(`https://store.steampowered.com/api/appdetails?appids=${app.appId}&cc=gb&filters=price_overview`),
    json(`https://store.steampowered.com/api/appdetails?appids=${app.appId}&cc=de&filters=price_overview`),
  ]);
  const regional = (r: any) => r?.[String(app.appId)]?.data?.price_overview;
  const prices = d.is_free
    ? undefined
    : { usd: formatPrice(d.price_overview), gbp: formatPrice(regional(gb)), eur: formatPrice(regional(de)) };
  const q = reviews?.query_summary;
  return {
    name: app.name,
    storeUrl: `https://store.steampowered.com/app/${app.appId}/`,
    price: d.is_free ? "Free" : formatPrice(d.price_overview) || d.price_overview?.final_formatted || undefined,
    prices: prices && (prices.usd || prices.gbp || prices.eur) ? prices : undefined,
    releaseDate: d.release_date?.date || undefined,
    comingSoon: d.release_date?.coming_soon,
    metacritic: d.metacritic?.score,
    reviewSummary: q?.total_reviews ? q.review_score_desc : undefined,
    positivePercent: q?.total_reviews ? Math.round((q.total_positive / q.total_reviews) * 100) : undefined,
    totalReviews: q?.total_reviews || undefined,
    currentPlayers: players?.response?.player_count || undefined,
    fetchedAt: new Date().toISOString(),
  };
}

export function factsText(f: SteamFacts): string {
  const lines = [
    `Game: ${f.name}`,
    f.price && `Current Steam price: ${[f.prices?.usd && `${f.prices.usd} (US)`, f.prices?.gbp && `${f.prices.gbp} (UK)`, f.prices?.eur && `${f.prices.eur} (EU)`].filter(Boolean).join(", ") || f.price}`,
    f.releaseDate && `Release date: ${f.releaseDate}${f.comingSoon ? " (upcoming)" : ""}`,
    f.metacritic && `Metacritic: ${f.metacritic}`,
    f.reviewSummary && `Steam user reviews: ${f.reviewSummary}, ${f.positivePercent}% positive of ${f.totalReviews?.toLocaleString("en-US")}`,
    f.currentPlayers && `Players on Steam right now: ${f.currentPlayers.toLocaleString("en-US")}`,
    `Data fetched: ${f.fetchedAt}`,
  ];
  return lines.filter(Boolean).join("\n");
}

async function download(url: string, dest: string, minBytes = 8_000, kind = "image/"): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, {}, 30_000);
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    if (kind && !type.startsWith(kind)) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < minBytes) return false; // placeholders and 1px trackers
    await fs.writeFile(dest, buf);
    return true;
  } catch (err) {
    log("warn", "asset download failed", { url, error: errorMessage(err) });
    return false;
  }
}

export async function fetchSteamArt(app: SteamApp, episodeDir: string, maxScreens = 4): Promise<VisualAsset[]> {
  const { appId, details, name } = app;
  const prov = `Steam store asset for "${name}" (app ${appId}), publisher-supplied marketing art`;
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

// ------------------------------------------------------------ trailer B-roll

export interface HlsSegment {
  uri: string;
  duration: number;
}

export function parseMediaPlaylist(text: string): { init?: string; segments: HlsSegment[] } {
  const lines = text.split(/\r?\n/);
  let init: string | undefined;
  const segments: HlsSegment[] = [];
  let pending: number | undefined;
  for (const line of lines) {
    const map = line.match(/^#EXT-X-MAP:.*URI="([^"]+)"/);
    if (map) init = map[1];
    const inf = line.match(/^#EXTINF:([\d.]+)/);
    if (inf) pending = Number(inf[1]);
    else if (line && !line.startsWith("#") && pending !== undefined) {
      segments.push({ uri: line.trim(), duration: pending });
      pending = undefined;
    }
  }
  return { init, segments };
}

/** Picks the highest variant up to 1080p from an HLS master playlist. */
export function pickVariant(master: string): string | undefined {
  const lines = master.split(/\r?\n/);
  let best: { uri: string; h: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^#EXT-X-STREAM-INF:.*RESOLUTION=\d+x(\d+)/);
    if (!m) continue;
    const h = Number(m[1]);
    const uri = lines[i + 1]?.trim();
    if (uri && h <= 1080 && (!best || h > best.h)) best = { uri, h };
  }
  return best?.uri;
}

/** Windows into a trailer that avoid rating cards up front and end slates. */
export function clipWindows(totalSeconds: number, count: number, clipSeconds: number): number[] {
  const start = Math.min(8, totalSeconds * 0.15);
  const end = totalSeconds - Math.max(12, totalSeconds * 0.15);
  if (end - start < clipSeconds) return [];
  return Array.from({ length: count }, (_, i) => start + ((end - start - clipSeconds) * (i + 1)) / (count + 1));
}

async function grabClip(variantUrl: string, at: number, seconds: number, dest: string): Promise<boolean> {
  const res = await fetchWithTimeout(variantUrl, {}, 20_000);
  if (!res.ok) return false;
  const { init, segments } = parseMediaPlaylist(await res.text());
  if (!init || segments.length === 0) return false;
  const base = new URL(variantUrl);
  const parts: Buffer[] = [];
  const initRes = await fetchWithTimeout(new URL(init, base).toString(), {}, 20_000);
  if (!initRes.ok) return false;
  parts.push(Buffer.from(await initRes.arrayBuffer()));
  let t = 0;
  let offset = 0;
  let got = 0;
  for (const seg of segments) {
    const segEnd = t + seg.duration;
    if (segEnd > at && t < at + seconds + 0.5) {
      if (got === 0) offset = at - t;
      const r = await fetchWithTimeout(new URL(seg.uri, base).toString(), {}, 30_000);
      if (!r.ok) return false;
      parts.push(Buffer.from(await r.arrayBuffer()));
      got += seg.duration;
    }
    t = segEnd;
    if (got >= seconds + offset + 0.5) break;
  }
  if (got < seconds) return false;
  const raw = `${dest}.raw.mp4`;
  await fs.writeFile(raw, Buffer.concat(parts));
  try {
    await run(FFMPEG, [
      "-loglevel", "error", "-y", "-ss", offset.toFixed(2), "-i", raw, "-t", seconds.toFixed(2),
      "-an", "-vf", "scale=-2:1080,fps=30", "-c:v", "libx264", "-crf", "17", "-preset", "fast", "-pix_fmt", "yuv420p", dest,
    ]);
  } finally {
    await fs.rm(raw, { force: true });
  }
  return true;
}

/**
 * Up to `count` short muted clips from the game's official Steam trailers.
 * Each clip is kept brief so footage stays subordinate to the reporting.
 */
export async function fetchSteamClips(app: SteamApp, episodeDir: string, count = 4, clipSeconds = 3.4): Promise<VisualAsset[]> {
  const movies = ((app.details.movies ?? []) as Array<Record<string, any>>).filter((m) => m.hls_h264);
  movies.sort((a, b) => Number(Boolean(b.highlight)) - Number(Boolean(a.highlight)));
  const dir = path.join(episodeDir, "assets");
  await fs.mkdir(dir, { recursive: true });
  const out: VisualAsset[] = [];
  for (const movie of movies.slice(0, 2)) {
    try {
      const masterRes = await fetchWithTimeout(movie.hls_h264, {}, 20_000);
      if (!masterRes.ok) continue;
      const variant = pickVariant(await masterRes.text());
      if (!variant) continue;
      const variantUrl = new URL(variant, movie.hls_h264).toString();
      const plRes = await fetchWithTimeout(variantUrl, {}, 20_000);
      if (!plRes.ok) continue;
      const total = parseMediaPlaylist(await plRes.text()).segments.reduce((s, x) => s + x.duration, 0);
      const perMovie = Math.ceil(count / Math.min(2, movies.length));
      for (const at of clipWindows(total, perMovie, clipSeconds)) {
        if (out.length >= count) break;
        const file = path.join("assets", `clip_${out.length}.mp4`);
        if (await grabClip(variantUrl, at, clipSeconds, path.join(episodeDir, file))) {
          out.push({
            kind: "clip",
            file,
            sourceUrl: movie.hls_h264,
            durationSeconds: clipSeconds,
            provenance: `Official Steam trailer "${movie.name}" for "${app.name}" (app ${app.appId}), ${clipSeconds}s at ${at.toFixed(1)}s, muted`,
          });
        }
      }
    } catch (err) {
      log("warn", "trailer clip failed", { movie: movie.name, error: errorMessage(err) });
    }
    if (out.length >= count) break;
  }
  return out;
}
