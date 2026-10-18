// Freely licensed photos from Wikimedia Commons for documentaries: the real
// studios, people, places and events a chapter talks about. Only public-domain
// and Creative Commons BY / BY-SA / CC0 files, landscape and large enough for
// 1080p, and every one carries its author and licence for the credits.

import fs from "node:fs/promises";
import path from "node:path";

export interface CommonsImage {
  title: string; // "File:Rockstar North office.jpg"
  url: string; // a 1920 px rendition
  width: number;
  height: number;
  artist: string;
  license: string; // "CC BY-SA 4.0"
  pageUrl: string;
  description: string;
}

const API = "https://commons.wikimedia.org/w/api.php";
const UA =
  "PulseGamingFactory/1.0 (https://pulse.orryy.com; documentary research)";
const FREE = /^(cc0|cc[ -]by(-sa)?([ -][\d.]+)?|public domain|pd\b|pd-)/i;
const SKIP =
  /logo|icon|screenshot|cover art|box ?art|\.svg|\.gif|signature|map of|flag of|coat of arms/i;

const strip = (t: string) =>
  t
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The usable, freely licensed landscape photos from a Commons search response. */
export function parseCommons(json: any): CommonsImage[] {
  const pages = Object.values(json?.query?.pages ?? {}) as any[];
  const out: CommonsImage[] = [];
  for (const p of pages) {
    const info = p?.imageinfo?.[0];
    if (!info) continue;
    const meta = info.extmetadata ?? {};
    const license = strip(String(meta.LicenseShortName?.value ?? ""));
    const title = String(p.title ?? "");
    const width = Number(info.width ?? 0);
    const height = Number(info.height ?? 1);
    if (!FREE.test(license) || /fair use|non-free/i.test(license)) continue;
    if (SKIP.test(title)) continue;
    if (width < 1200 || width / height < 1.2 || width / height > 2.4) continue;
    if (!/\.(jpe?g|png|webp|tiff?)$/i.test(title)) continue;
    out.push({
      title,
      url: String(info.thumburl ?? info.url),
      width,
      height,
      artist:
        strip(String(meta.Artist?.value ?? "Unknown author")).slice(0, 80) ||
        "Unknown author",
      license,
      pageUrl: String(
        info.descriptionurl ??
          `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      ),
      description: strip(String(meta.ImageDescription?.value ?? "")).slice(
        0,
        240,
      ),
    });
  }
  return out;
}

export async function searchCommons(
  query: string,
  limit = 20,
  fetchFn: typeof fetch = fetch,
): Promise<CommonsImage[]> {
  const q = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "1920",
    format: "json",
  });
  const res = await fetchFn(`${API}?${q}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  return parseCommons(await res.json());
}

export async function downloadCommons(
  img: CommonsImage,
  dest: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(img.url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return false;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

/** The credit line a photo carries on screen and in the credits. */
export function commonsCredit(
  img: Pick<CommonsImage, "artist" | "license">,
): string {
  return `${img.artist} / ${img.license} / Wikimedia Commons`;
}

/** The distinguishing words of a game's title within its franchise: "Vice City", "2", "III". */
export function distinguishing(game: string, franchise: string): string[] {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[®™©:–—-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const f = new Set(norm(franchise).split(" "));
  return norm(game)
    .split(" ")
    .filter(
      (w) =>
        w &&
        !f.has(w) &&
        ![
          "the",
          "of",
          "and",
          "edition",
          "definitive",
          "remastered",
          "complete",
        ].includes(w),
    );
}

const ROMAN: Record<string, string> = {
  "2": "ii",
  ii: "2",
  "3": "iii",
  iii: "3",
  "4": "iv",
  iv: "4",
  "5": "v",
  v: "5",
  "6": "vi",
  vi: "6",
};

/** True when a trailer title names this game, not another entry in the series. */
export function trailerMatchesGame(
  trailerTitle: string,
  game: string,
  franchise: string,
): boolean {
  const words = distinguishing(game, franchise);
  if (!words.length) return false; // the first game shares the series name: no trailer can be told apart safely
  const t = ` ${trailerTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return words.every(
    (w) =>
      t.includes(` ${w} `) ||
      (ROMAN[w] !== undefined && t.includes(` ${ROMAN[w]} `)),
  );
}
