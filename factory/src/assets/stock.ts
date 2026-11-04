// Licensed stock footage for the real-world part of a story. Only used for stories whose point is something in
// the real world, never in place of game footage, and always tagged on screen as illustrative. Three libraries
// (owner, 1 Nov 2026: more sources, same licence record, credit and vision screen):
//   Pexels (PEXELS_API_KEY): free for commercial use, no attribution required, credited anyway.
//   Pixabay (PIXABAY_API_KEY, LIBRARY_PIXABAY): the Pixabay Content License, the same terms; skipped without a key.
//   Internet Archive (LIBRARY_ARCHIVE): only films whose licence metadata is public domain, CC0 or CC BY (old
//     promotional films, computing and arcade history); never adverts, magazines, game footage someone else
//     uploaded, or anything without a clear licence.
// For each line every library is asked once; their results are interleaved (Pexels first) and the picture
// editor sees all the previews in one look, as it did for Pexels alone, so a second library costs no extra call.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import type { VisualAsset } from "./steam.ts";
import type { FootageTarget } from "./clipscore.ts";
import { freeName, samePath } from "./repeats.ts";
import { interleave } from "./libraries.ts";

const run = promisify(execFile);
const API = "https://api.pexels.com/videos/search";
export const STOCK_CLIP_SECONDS = 4;
/** Previews the picture editor sees per line, across all libraries. */
const MAX_PREVIEWS = 8;

export interface PexelsFile {
  link: string;
  width: number;
  height: number;
  quality?: string;
  file_type?: string;
}

export interface PexelsVideo {
  id: number;
  url: string;
  duration: number;
  user?: { name?: string };
  video_files: PexelsFile[];
  /** The video's preview picture. */
  image?: string;
}

/** One library's video, in the shape every library shares. */
export interface StockVideo {
  library: "Pexels" | "Pixabay" | "Internet Archive";
  /** Unique within its library. */
  id: string;
  /** The video's page. */
  url: string;
  duration: number;
  user?: string;
  title?: string;
  /** The preview picture; a remote film's preview is a frame grabbed where the clip will be cut. */
  image?: string;
  /** The file the clip is cut from. */
  fileUrl: string;
  /** Cut by seeking into the remote file rather than downloading it whole (an archive film runs for minutes). */
  remote?: boolean;
  /** The licence as recorded in the provenance: "public domain", "CC BY 4.0". */
  licence?: string;
}

/** A library a line's stock search asks. */
export interface StockLibrary {
  name: StockVideo["library"];
  search(query: string): Promise<StockVideo[]>;
}

/**
 * Looks at the preview pictures of a line's stock results and says which one shows what the line is about,
 * or none: the first search result used to go on screen unseen (29 Oct 2026 review: a woman on a phone for
 * a game's budget, PS4 pads for the PS3 era).
 */
export type StockPicker = (
  target: FootageTarget,
  previews: string[],
) => Promise<number | undefined>;

/** The smallest MP4 that is still at least 1080 px on its long side (or the largest there is). */
export function pickFile(v: PexelsVideo): PexelsFile | undefined {
  const mp4 = v.video_files.filter(
    (f) => (f.file_type ?? "video/mp4") === "video/mp4" && f.link,
  );
  const long = (f: PexelsFile) => Math.max(f.width, f.height);
  const big = mp4
    .filter((f) => long(f) >= 1080)
    .sort((a, b) => long(a) - long(b));
  return big[0] ?? mp4.sort((a, b) => long(b) - long(a))[0];
}

/** A stock search for a line: its keywords minus game words (stock has no games), at most four words. */
export function stockQuery(target: FootageTarget, gameWords: string[]): string {
  const skip = new Set(gameWords.map((w) => w.toLowerCase()));
  const words = target.keywords
    .join(" ")
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9'-]/g, ""))
    .filter((w) => w.length > 1 && !skip.has(w.toLowerCase()));
  return [...new Set(words)].slice(0, 4).join(" ");
}

export async function searchPexels(
  apiKey: string,
  query: string,
  perPage = 6,
): Promise<PexelsVideo[]> {
  const url = `${API}?query=${encodeURIComponent(query)}&per_page=${perPage}&size=medium`;
  const res = await fetchWithTimeout(
    url,
    { headers: { authorization: apiKey } },
    20_000,
  );
  if (!res.ok) throw new Error(`pexels HTTP ${res.status}`);
  return (
    ((await res.json()) as { videos?: PexelsVideo[] }).videos ?? []
  ).filter((v) => v.duration >= STOCK_CLIP_SECONDS + 1);
}

export function pexelsLibrary(apiKey: string): StockLibrary {
  return {
    name: "Pexels",
    search: async (q) =>
      (await searchPexels(apiKey, q)).flatMap((v) => {
        const f = pickFile(v);
        return f
          ? [
              {
                library: "Pexels" as const,
                id: String(v.id),
                url: v.url,
                duration: v.duration,
                user: v.user?.name,
                image: v.image,
                fileUrl: f.link,
              },
            ]
          : [];
      }),
  };
}

/** Pixabay's video search answer as stock videos: an MP4 at least 1080 px on its long side when there is one. */
export function parsePixabayVideos(json: any): StockVideo[] {
  const out: StockVideo[] = [];
  for (const h of (json?.hits ?? []) as any[]) {
    const duration = Number(h?.duration ?? 0);
    if (duration < STOCK_CLIP_SECONDS + 1) continue;
    const sizes = ["small", "medium", "large", "tiny"]
      .map((k) => h?.videos?.[k])
      .filter((v: any) => v?.url && v?.width);
    const long = (v: any) => Math.max(Number(v.width), Number(v.height ?? 0));
    const file =
      sizes
        .filter((v: any) => long(v) >= 1080)
        .sort((a, b) => long(a) - long(b))[0] ??
      sizes.sort((a, b) => long(b) - long(a))[0];
    const pageUrl = String(h?.pageURL ?? "");
    if (!file || !/^https?:/.test(pageUrl)) continue;
    const thumb =
      h?.videos?.medium?.thumbnail ??
      h?.videos?.small?.thumbnail ??
      (h?.picture_id
        ? `https://i.vimeocdn.com/video/${h.picture_id}_640x360.jpg`
        : undefined);
    out.push({
      library: "Pixabay",
      id: String(h.id),
      url: pageUrl,
      duration,
      user: h?.user ? String(h.user) : undefined,
      title: h?.tags ? String(h.tags) : undefined,
      image: thumb,
      fileUrl: String(file.url),
    });
  }
  return out;
}

export function pixabayLibrary(apiKey: string): StockLibrary {
  return {
    name: "Pixabay",
    search: async (q) => {
      const p = new URLSearchParams({
        key: apiKey,
        q: q.slice(0, 100),
        per_page: "6",
        safesearch: "true",
        video_type: "film",
      });
      const res = await fetchWithTimeout(
        `https://pixabay.com/api/videos/?${p}`,
        {},
        20_000,
      );
      if (!res.ok) throw new Error(`pixabay HTTP ${res.status}`);
      return parsePixabayVideos(await res.json());
    },
  };
}

/**
 * The licence an Internet Archive item's licence URL grants, or undefined when the channel may not use it:
 * only the public domain (the mark, CC0, the old dedication) and plain CC BY. Share-alike, NonCommercial,
 * NoDerivatives and anything unrecognised are refused.
 */
export function archiveLicence(
  licenseUrl: string | undefined,
): string | undefined {
  const u = String(licenseUrl ?? "").toLowerCase();
  if (!/creativecommons\.org\//.test(u)) return undefined;
  if (/\/publicdomain\/zero\//.test(u)) return "public domain (CC0)";
  if (/\/publicdomain\/mark\//.test(u) || /\/licenses\/publicdomain\/?/.test(u))
    return "public domain";
  const by = u.match(/\/licenses\/by\/([\d.]+)/);
  if (by) return `CC BY ${by[1]}`;
  return undefined;
}

/** Items the archive holds that are never the channel's to use, whatever their uploader tagged them. */
const ARCHIVE_REFUSE =
  /commercial|advert|\btv ads?\b|\bads?\b|reclame|werbung|publicit|\bspot\b|bumper|\bident\b|magazine|scan|gameplay|longplay|let'?s play|walkthrough|playthrough|speedrun|\breview\b|\brom\b|emulat|trailer|music video|full movie|episode|news broadcast|nsfw/i;

/** Seconds from an archive "length" field: "123.4" or "02:03" or "1:02:03". */
export function archiveSeconds(length: unknown): number {
  const t = String(length ?? "").trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(":").map(Number);
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((a, n) => a * 60 + n, 0);
}

/** The clip-ready film in an archive item's metadata, or undefined when it has none or its licence is not free. */
export function parseArchiveItem(meta: any): StockVideo | undefined {
  const m = meta?.metadata ?? {};
  const id = String(m.identifier ?? "");
  const licence = archiveLicence(m.licenseurl);
  if (!id || !licence) return undefined;
  const one = (v: unknown) =>
    Array.isArray(v) ? v.join(" ") : String(v ?? "");
  const title = one(m.title).slice(0, 120);
  if (ARCHIVE_REFUSE.test(`${title} ${one(m.subject)}`)) return undefined;
  if (String(m.mediatype ?? "movies") !== "movies") return undefined;
  const files = ((meta?.files ?? []) as any[]).filter(
    (f) =>
      /\.mp4$/i.test(String(f?.name ?? "")) &&
      /h\.264|mpeg4|mp4/i.test(String(f?.format ?? "mp4")),
  );
  const height = (f: any) => Number(f?.height ?? 0);
  // The sharpest copy up to 1080 lines; one that does not say is taken when it is all there is.
  const file =
    files
      .filter((f) => height(f) >= 360 && height(f) <= 1080)
      .sort((a, b) => height(b) - height(a))[0] ??
    files.find((f) => !height(f));
  if (!file) return undefined;
  const duration = archiveSeconds(file.length ?? m.runtime);
  if (duration < STOCK_CLIP_SECONDS + 2) return undefined;
  return {
    library: "Internet Archive",
    id,
    url: `https://archive.org/details/${id}`,
    duration,
    user: one(m.creator).slice(0, 60) || undefined,
    title,
    fileUrl: `https://archive.org/download/${id}/${encodeURIComponent(String(file.name)).replace(/%2F/g, "/")}`,
    remote: true,
    licence,
  };
}

export function archiveLibrary(fetchFn: typeof fetch = fetch): StockLibrary {
  return {
    name: "Internet Archive",
    search: async (query) => {
      const q = new URLSearchParams({
        q: `(${query}) AND mediatype:(movies) AND licenseurl:[* TO *]`,
        rows: "12",
        output: "json",
      });
      for (const f of ["identifier", "licenseurl", "title"])
        q.append("fl[]", f);
      const res = await fetchFn(`https://archive.org/advancedsearch.php?${q}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`archive.org HTTP ${res.status}`);
      const docs = (((await res.json()) as any)?.response?.docs ?? []) as any[];
      const out: StockVideo[] = [];
      // The licence is checked twice: in the search result and in the item's own metadata.
      for (const d of docs
        .filter(
          (d) =>
            archiveLicence(d?.licenseurl) &&
            !ARCHIVE_REFUSE.test(String(d?.title ?? "")),
        )
        .slice(0, 4)) {
        const r = await fetchFn(
          `https://archive.org/metadata/${encodeURIComponent(d.identifier)}`,
          {
            signal: AbortSignal.timeout(30_000),
          },
        ).catch(() => undefined);
        if (!r?.ok) continue;
        const v = parseArchiveItem(await r.json());
        if (v) out.push(v);
        if (out.length >= 2) break;
      }
      return out;
    },
  };
}

/** Where in a video the clip is cut: a quarter in, never past its end. */
export const cutAt = (duration: number) =>
  Math.max(0, Math.min(duration - STOCK_CLIP_SECONDS - 0.5, duration * 0.25));

/** The provenance a stock clip carries: the library, its page, the author and the licence. */
export function stockProvenance(v: StockVideo, key: string): string {
  if (v.library === "Pexels")
    return `Illustrative stock footage from Pexels (${v.url}) by ${v.user ?? "a Pexels contributor"}, free to use under the Pexels licence; chosen for ${key}`;
  if (v.library === "Pixabay")
    return `Illustrative stock footage from Pixabay (${v.url}) by ${v.user ?? "a Pixabay contributor"}, free to use under the Pixabay Content License; chosen for ${key}`;
  return `Archive footage from the Internet Archive (${v.url}): "${(v.title ?? "").replace(/"/g, "'")}" by ${v.user ?? "an unknown author"}, ${v.licence}; chosen for ${key}`;
}

/** The on-screen credit of a stock clip from its provenance; Pexels keeps the line it always had. */
export function stockCredit(provenance: string | undefined): string {
  const p = provenance ?? "";
  if (/^Illustrative stock footage from Pixabay/.test(p))
    return "ILLUSTRATIVE · STOCK FOOTAGE: PIXABAY";
  const a = p.match(
    /^Archive footage from the Internet Archive \([^)]*\): "[^"]*" by (.+?), ([^;]+); chosen/,
  );
  if (a)
    return /^CC BY/.test(a[2]!)
      ? `ILLUSTRATIVE · ARCHIVE FOOTAGE: ${a[1]!.slice(0, 40).toUpperCase()} / ${a[2]} / INTERNET ARCHIVE`
      : "ILLUSTRATIVE · ARCHIVE FOOTAGE: INTERNET ARCHIVE (PUBLIC DOMAIN)";
  return "ILLUSTRATIVE · STOCK FOOTAGE: PEXELS";
}

/** The description's credit lines for a video's stock clips, one per library; Pexels' line is unchanged. */
export function stockCreditLines(
  clips: Array<{ provenance: string }>,
): string[] {
  const urls = (re: RegExp) =>
    clips
      .filter((c) => re.test(c.provenance))
      .map((c) => c.provenance.match(/\((https?:[^)]+)\)/)?.[1])
      .filter(Boolean);
  const lines: string[] = [];
  const pexels = urls(/^Illustrative stock footage from Pexels/);
  if (pexels.length)
    lines.push(
      `Illustrative stock footage (not the real event): Pexels, ${pexels.join(", ")}.`,
    );
  const pixabay = urls(/^Illustrative stock footage from Pixabay/);
  if (pixabay.length)
    lines.push(
      `Illustrative stock footage (not the real event): Pixabay, ${pixabay.join(", ")}.`,
    );
  const archive = clips
    .map((c) =>
      c.provenance.match(
        /^Archive footage from the Internet Archive \((https?:[^)]+)\): "([^"]*)" by (.+?), ([^;]+); chosen/,
      ),
    )
    .filter((m): m is RegExpMatchArray => Boolean(m));
  if (archive.length)
    lines.push(
      `Archive footage (illustrative, not the real event): Internet Archive, ${[...new Set(archive.map((m) => `"${m[2]}" by ${m[3]}, ${m[4]} (${m[1]})`))].join("; ")}.`,
    );
  return lines;
}

/** A stock video's key across libraries. */
export const keyOf = (v: Pick<StockVideo, "library" | "id">) =>
  `${v.library}:${v.id}`;

/**
 * A line's candidates from every library, interleaved in library order (Pexels first), without any video
 * already used in this run or already in the episode (by its page).
 */
export function stockCandidates(
  found: StockVideo[][],
  used: Set<string>,
  avoid: Set<string>,
): StockVideo[] {
  return interleave(found).filter(
    (x) => !used.has(keyOf(x)) && !avoid.has(x.url),
  );
}

/** One preview picture on disk: the library's own, or for a remote film a frame grabbed where it will be cut. */
async function preview(v: StockVideo, dest: string): Promise<boolean> {
  try {
    if (v.remote) {
      await run(
        FFMPEG,
        [
          "-loglevel",
          "error",
          "-y",
          "-ss",
          cutAt(v.duration).toFixed(2),
          "-i",
          v.fileUrl,
          "-frames:v",
          "1",
          "-vf",
          "scale=640:-2",
          "-q:v",
          "4",
          dest,
        ],
        { timeout: 90_000 },
      );
      return true;
    }
    if (!v.image) return false;
    const r = await fetchWithTimeout(v.image, {}, 20_000);
    if (!r.ok) return false;
    await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

/**
 * One illustrative clip per real-world line, tagged with its beat, from every library given. Each video is used
 * once; a line with no match gets nothing (the planner falls back). A video already in the episode
 * (`avoidUrls`, its page URLs) is never picked again, and each clip is written under a name no file in the
 * folder has: a re-run used to restart at stock_0.mp4 and overwrite the clips an earlier run had placed
 * (31 Oct 2026, Vice City documentary).
 */
export async function libraryStockClips(
  libraries: StockLibrary[],
  episodeDir: string,
  targets: FootageTarget[],
  gameWords: string[],
  maxClips = 4,
  pick?: StockPicker,
  avoidUrls: Iterable<string> = [],
): Promise<VisualAsset[]> {
  const out: VisualAsset[] = [];
  const used = new Set<string>();
  const avoid = new Set(avoidUrls);
  const work = path.join(episodeDir, "stock");
  if (!libraries.length) return out;
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(path.join(episodeDir, "assets"), { recursive: true });
  const taken = new Set(
    (await fs.readdir(path.join(episodeDir, "assets")).catch(() => [])).map(
      (n) => samePath(n),
    ),
  );
  try {
    for (const t of targets) {
      if (out.length >= maxClips) break;
      const q = stockQuery(t, gameWords);
      if (!q) continue;
      try {
        const found = await Promise.all(
          libraries.map((lib) =>
            lib.search(q).catch((err) => {
              log("warn", "stock library failed", {
                library: lib.name,
                query: q,
                error: errorMessage(err),
              });
              return [] as StockVideo[];
            }),
          ),
        );
        const videos = stockCandidates(found, used, avoid);
        let v: StockVideo | undefined = videos[0];
        if (pick) {
          // Only a result whose preview shows the line goes on screen; with none, the line keeps its picture.
          const shown: StockVideo[] = [];
          const previews: string[] = [];
          for (const x of videos.filter((x) => x.image || x.remote)) {
            if (previews.length >= MAX_PREVIEWS) break;
            const f = path.join(work, `preview_${shown.length}.jpg`);
            if (!(await preview(x, f))) continue;
            shown.push(x);
            previews.push(f);
          }
          const i = previews.length ? await pick(t, previews) : undefined;
          v = i === undefined ? undefined : shown[i];
          if (!v) {
            log("info", "stock refused: no preview shows the line", {
              query: q,
              line: t.text.slice(0, 120),
              libraries: [...new Set(shown.map((x) => x.library))],
            });
            continue;
          }
        }
        if (!v) continue;
        used.add(keyOf(v));
        const at = cutAt(v.duration);
        const slug = `${v.library === "Pexels" ? "stock" : v.library === "Pixabay" ? "pixabay" : "archive"}-${v.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;
        const name = freeName(slug, ".mp4", taken);
        taken.add(samePath(name));
        const rel = path.join("assets", name);
        let input = v.fileUrl;
        if (!v.remote) {
          const raw = path.join(work, `${slug}.mp4`);
          const res = await fetchWithTimeout(v.fileUrl, {}, 60_000);
          if (!res.ok) continue;
          await fs.writeFile(raw, Buffer.from(await res.arrayBuffer()));
          input = raw;
        }
        await run(
          FFMPEG,
          [
            "-loglevel",
            "error",
            "-y",
            "-ss",
            at.toFixed(2),
            "-i",
            input,
            "-t",
            String(STOCK_CLIP_SECONDS),
            "-an",
            "-vf",
            "scale=-2:1080,fps=30",
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-preset",
            "fast",
            "-pix_fmt",
            "yuv420p",
            path.join(episodeDir, rel),
          ],
          { timeout: 180_000 },
        );
        const beatIndex = t.key.startsWith("beat:")
          ? Number.parseInt(t.key.slice(5), 10)
          : undefined;
        // "beat:3#m7": a documentary chapter's sentence 7 (its shot list asked for this B-roll).
        const sentence = t.key.match(/#m(\d+)$/)?.[1];
        out.push({
          kind: "clip",
          file: rel,
          sourceUrl: v.url,
          durationSeconds: STOCK_CLIP_SECONDS,
          beatIndex,
          ...(sentence !== undefined ? { moment: Number(sentence) } : {}),
          stock: true,
          label: q,
          reason: `stock: "${q}"`,
          provenance: stockProvenance(v, t.key),
        });
      } catch (err) {
        log("warn", "stock clip failed", {
          query: q,
          error: errorMessage(err),
        });
      }
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
  log("info", "stock clips", {
    count: out.length,
    targets: targets.length,
    libraries: libraries.map((l) => l.name),
  });
  return out;
}

/** Pexels alone, as before the other libraries. */
export function stockClips(
  apiKey: string,
  episodeDir: string,
  targets: FootageTarget[],
  gameWords: string[],
  maxClips = 4,
  pick?: StockPicker,
  avoidUrls: Iterable<string> = [],
): Promise<VisualAsset[]> {
  return libraryStockClips(
    [pexelsLibrary(apiKey)],
    episodeDir,
    targets,
    gameWords,
    maxClips,
    pick,
    avoidUrls,
  );
}
