// More free picture libraries beside Wikimedia Commons, for the real-world things a game cannot show (a show
// floor at E3, Gamescom or The Game Awards, a studio building, an executive on stage, a console) and for the
// publishers' own press pictures (src/assets/press.ts). Owner, 1 Nov 2026: more sources, each with the same
// licence record, on-screen credit and vision screen as Commons and Pexels.
//
//   Openverse (api.openverse.org): the open index of Flickr and other archives, keyless. Only CC0, the public
//     domain mark, CC BY and CC BY-SA: the channel is commercial, so NC and ND never pass. Commons is skipped
//     there (it is searched directly). Flickr's Creative Commons pool arrives through it, credited to Flickr.
//   Pixabay (PIXABAY_API_KEY): photos under the Pixabay Content License, credited anyway.
//
// Every result is a CommonsImage, so the existing pickers, downloads, the picture editor (rankStills) and the
// real-world photo rule (src/render/longplan.ts realWorldImage: kind "photo", pinned to its sentence only) apply
// unchanged. The provenance line records the licence; photoCreditOf turns it into the on-screen credit.

import type { CommonsImage } from "./commons.ts";
import { fetchWithTimeout } from "../lib/util.ts";

const UA =
  "PulseGamingFactory/1.0 (https://pulse.orryy.com; documentary research)";
/** File names that are never a photo of the real thing. */
const SKIP =
  /logo|icon|screenshot|cover art|box ?art|signature|map of|flag of|coat of arms|clip ?art|vector|illustration|wallpaper|meme/i;

/**
 * The display name of a free licence ("CC BY-SA 2.0", "CC0 1.0", "Public domain"), or undefined for anything
 * the channel may not use: NonCommercial, NoDerivatives, sampling licences, unknown codes.
 */
export function openLicence(
  code: string | undefined,
  version?: string,
): string | undefined {
  const c = String(code ?? "")
    .toLowerCase()
    .trim();
  const v = version && version !== "" ? ` ${version}` : "";
  if (c === "cc0") return `CC0${v || " 1.0"}`;
  if (c === "pdm") return "Public domain";
  if (c === "by") return `CC BY${v}`;
  if (c === "by-sa") return `CC BY-SA${v}`;
  return undefined;
}

/** Openverse's provider codes as people know them. */
const OPENVERSE_NAMES: Record<string, string> = {
  flickr: "Flickr",
  geographorguk: "Geograph",
  smithsonian: "Smithsonian",
  nasa: "NASA",
  stocksnap: "StockSnap",
  rawpixel: "rawpixel",
  europeana: "Europeana",
  nappy: "nappy",
};

/** The usable, freely licensed landscape photos from an Openverse image search response. */
export function parseOpenverse(json: any): CommonsImage[] {
  const out: CommonsImage[] = [];
  for (const r of (json?.results ?? []) as any[]) {
    const license = openLicence(r?.license, r?.license_version);
    if (!license || r?.mature) continue;
    const source = String(r?.source ?? r?.provider ?? "").toLowerCase();
    if (source === "wikimedia" || source === "wikimedia_commons") continue; // searched directly
    const title = String(r?.title ?? "").trim();
    if (!title || SKIP.test(title)) continue;
    const width = Number(r?.width ?? 0);
    const height = Number(r?.height ?? 0);
    // Openverse does not always know the size: unknown passes, the download's measured shape decides later.
    if (width && height) {
      if (width < 1200 || width / height < 1.2 || width / height > 2.4)
        continue;
    }
    const url = String(r?.url ?? "");
    const pageUrl = String(r?.foreign_landing_url ?? "");
    if (!/^https?:/.test(url) || !/^https?:/.test(pageUrl)) continue;
    if (/\.(svg|gif)(\?|$)/i.test(url)) continue;
    const via =
      OPENVERSE_NAMES[source] ??
      (source ? source[0]!.toUpperCase() + source.slice(1) : "Openverse");
    const tags = ((r?.tags ?? []) as any[])
      .map((t) => String(t?.name ?? ""))
      .filter(Boolean)
      .slice(0, 12)
      .join(", ");
    out.push({
      title,
      url,
      width,
      height,
      artist:
        String(r?.creator ?? "")
          .trim()
          .slice(0, 80) || "Unknown author",
      license,
      pageUrl,
      description: tags.slice(0, 240),
      source: via === "Flickr" ? "flickr" : "openverse",
      via,
    });
  }
  // As with Commons: public domain and plain CC BY first, share-alike last.
  const tier = (l: string) => (/BY-SA/.test(l) ? 2 : /BY/.test(l) ? 1 : 0);
  return out.sort((a, b) => tier(a.license) - tier(b.license));
}

export async function searchOpenverse(
  query: string,
  limit = 20,
  fetchFn: typeof fetch = fetch,
): Promise<CommonsImage[]> {
  const q = new URLSearchParams({
    q: query,
    license: "cc0,pdm,by,by-sa",
    page_size: String(limit),
    mature: "false",
    excluded_source: "wikimedia",
  });
  // Openverse is slow to answer (often 10-30 s): a generous timeout; a failure throws, so the breaker in
  // src/services.ts can stop asking for a while.
  const res = await fetchFn(`https://api.openverse.org/v1/images/?${q}`, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`openverse HTTP ${res.status}`);
  return parseOpenverse(await res.json());
}

/** Pixabay photos, landscape and large enough for 1080p. */
export function parsePixabayImages(json: any): CommonsImage[] {
  const out: CommonsImage[] = [];
  for (const h of (json?.hits ?? []) as any[]) {
    const width = Number(h?.imageWidth ?? 0);
    const height = Number(h?.imageHeight ?? 0);
    if (width < 1200 || !height || width / height < 1.2 || width / height > 2.4)
      continue;
    const url = String(h?.largeImageURL ?? "");
    const pageUrl = String(h?.pageURL ?? "");
    if (!/^https?:/.test(url) || !/^https?:/.test(pageUrl)) continue;
    const tags = String(h?.tags ?? "");
    if (SKIP.test(tags) || String(h?.type ?? "photo") !== "photo") continue;
    out.push({
      // Pixabay has no titles: its tags are what the picture shows, and what the title checks read.
      title: tags,
      url,
      width,
      height,
      artist: String(h?.user ?? "").slice(0, 80) || "a Pixabay contributor",
      license: "Pixabay Content License",
      pageUrl,
      description: tags,
      source: "pixabay",
      via: "Pixabay",
    });
  }
  return out;
}

export async function searchPixabayImages(
  apiKey: string,
  query: string,
  limit = 20,
  fetchFn: typeof fetch = fetch,
): Promise<CommonsImage[]> {
  if (!apiKey) return [];
  const q = new URLSearchParams({
    key: apiKey,
    q: query.slice(0, 100),
    image_type: "photo",
    orientation: "horizontal",
    safesearch: "true",
    min_width: "1200",
    per_page: String(Math.max(3, Math.min(200, limit))),
  });
  const res = await fetchWithTimeout(
    `https://pixabay.com/api/?${q}`,
    {},
    20_000,
  );
  if (!res.ok) throw new Error(`pixabay HTTP ${res.status}`);
  return parsePixabayImages(await res.json());
}

/** Round robin over the libraries' results, the first library first: no library crowds out the others. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++)
    for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

/** The photo libraries one search asks, Commons first. Each is optional; a failing one gives nothing. */
export interface PhotoLibraries {
  commons: (q: string) => Promise<CommonsImage[]>;
  openverse?: (q: string) => Promise<CommonsImage[]>;
  pixabay?: (q: string) => Promise<CommonsImage[]>;
}

/** Every library's photos for a search, interleaved, each picture once (by its page). */
export async function searchLicensedPhotos(
  libs: PhotoLibraries,
  query: string,
): Promise<CommonsImage[]> {
  const asks = [libs.commons, libs.openverse, libs.pixabay].filter(
    (f): f is (q: string) => Promise<CommonsImage[]> => Boolean(f),
  );
  const got = await Promise.all(asks.map((f) => f(query).catch(() => [])));
  const seen = new Set<string>();
  return interleave(got).filter((i) => {
    const k = i.pageUrl || i.url;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A library's name in a photo's provenance and credit. */
export function libraryName(img: Pick<CommonsImage, "source" | "via">): string {
  if (!img.source || img.source === "commons") return "Wikimedia Commons";
  if (img.source === "pixabay") return "Pixabay";
  return img.via || "Openverse";
}

/**
 * The provenance line a photo carries: the library, author, licence and page. Wikimedia Commons keeps its
 * long-standing wording ("Wikimedia Commons photo by X, CC BY-SA 4.0: <page>"), which older episodes carry;
 * press pictures say whose press site offered them, and for what (src/assets/press.ts).
 */
export function photoProvenance(img: CommonsImage): string {
  if (img.source === "press")
    return `Press image from ${img.via ?? img.artist} press (${img.license}): ${img.pageUrl} [${img.url}]`;
  const via =
    img.source === "openverse" || img.source === "flickr"
      ? " (found through Openverse)"
      : "";
  return `${libraryName(img)} photo by ${img.artist}, ${img.license}: ${img.pageUrl}${via}`;
}

/** True for a picture from a publisher's press site. */
export const isPressProvenance = (p: string | undefined) =>
  /^Press image from /.test(p ?? "");

/**
 * The on-screen credit for a picture: "Steve Hammond / CC BY-SA 2.0 / Wikimedia Commons" for a licensed photo,
 * "Image: Xbox press" for a press picture, undefined for official game art (credited in the description).
 */
export function photoCreditOf(i: {
  kind: string;
  provenance?: string;
}): string | undefined {
  const p = i.provenance ?? "";
  const press = p.match(/^Press image from (.+?) press \(/);
  if (press) return `Image: ${press[1]!.slice(0, 40)} press`;
  if (i.kind !== "photo") return undefined;
  const m = p.match(/^(.+?) photo by (.+?), ([^,:]+): /);
  if (!m) return "Wikimedia Commons";
  const lib = m[1]!;
  if (lib === "Pixabay") return `${m[2]!.slice(0, 40)} / Pixabay`;
  return `${m[2]!.slice(0, 40)} / ${m[3]} / ${lib}`;
}

/** A Short's credit strip: licensed photos after "Photo:", press pictures as their own "Image: X press". */
export function photoCreditLine(credits: Array<string | undefined>): string {
  const all = [...new Set(credits.filter((c): c is string => Boolean(c)))];
  const press = all.filter((c) => c.startsWith("Image: "));
  const photos = all.filter((c) => !c.startsWith("Image: "));
  return [photos.length ? `Photo: ${photos.join(" · ")}` : "", ...press]
    .filter(Boolean)
    .join("   ");
}

/**
 * The description's photo line: the libraries the video's photos came from. With only Commons photos it is the
 * line the channel has always used.
 */
export function photoSourcesLine(
  images: Array<{ kind: string; provenance?: string }>,
  creditsUrl: string,
): string {
  const libs = new Set<string>();
  for (const i of images) {
    if (isPressProvenance(i.provenance)) {
      libs.add(
        `${i.provenance!.match(/^Press image from (.+?) press \(/)?.[1] ?? "publisher"} press site`,
      );
      continue;
    }
    if (i.kind !== "photo") continue;
    libs.add(
      i.provenance?.match(/^(.+?) photo by /)?.[1] ?? "Wikimedia Commons",
    );
  }
  if (!libs.size) return "";
  return `\nPhotos: ${[...libs].join(", ")}, credited on screen. Full photo and footage credits: ${creditsUrl}`;
}

/** What the extra libraries gave one video, counted by library, for the episode log and the owner's note. */
export function librarySummary(
  images: Array<{ kind: string; provenance?: string; moment?: number }>,
  clips: Array<{ provenance?: string; moment?: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (k: string) => (out[k] = (out[k] ?? 0) + 1);
  for (const i of images) {
    const p = i.provenance ?? "";
    const press = p.match(/^Press image from (.+?) press \(/);
    if (press) add(`${press[1]} press`);
    else if (/^Pixabay photo by /.test(p)) add("Pixabay photos");
    else if (/\(found through Openverse\)$/.test(p))
      add(`${p.match(/^(.+?) photo by /)?.[1] ?? "Openverse"} photos`);
  }
  for (const c of clips) {
    const p = c.provenance ?? "";
    if (/^Illustrative stock footage from Pixabay/.test(p))
      add("Pixabay clips");
    else if (/^Archive footage from the Internet Archive/.test(p))
      add("Internet Archive clips");
  }
  return out;
}

/** The owner's note for a video the new libraries supplied, or undefined when they gave nothing. */
export function librariesNote(
  what: string,
  counts: Record<string, number>,
): string | undefined {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`);
  if (!parts.length) return undefined;
  return `${what}: the newer picture libraries supplied ${parts.join(", ")}, each passed by the picture editor and credited on screen. Settings: LIBRARY_PRESS, LIBRARY_OPENVERSE, LIBRARY_PIXABAY, LIBRARY_ARCHIVE.`;
}
