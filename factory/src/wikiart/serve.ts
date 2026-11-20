// The wiki art library over the PC's game library server (src/assets/gamelibserve.ts), under /wikiart/:
//   /wikiart/games.json                  the games with an index, with entity and image counts
//   /wikiart/lookup?game=&name=[&prefer=logo,artwork]   lookupArt's answer as JSON (null when nothing matches)
//   /wikiart/<slug>/index.json, /wikiart/<slug>/img/<file>   the index and the pictures, read-only
// Like the library server it never writes and serves nothing outside the library root. state.json and the
// rejection log stay on the PC.

import fs from "node:fs";
import fsp from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { canonicalGame } from "../assets/gamelib.ts";
import { lookupInIndex } from "./lookup.ts";
import { artSlug, wikiartRoot, type ArtImage, type ArtIndex } from "./store.ts";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json",
};

const indexes = new Map<string, { mtime: number; idx: ArtIndex }>();

async function loadIndex(
  root: string,
  slug: string,
): Promise<ArtIndex | undefined> {
  const file = path.join(root, slug, "index.json");
  const st = await fsp.stat(file).catch(() => undefined);
  if (!st) return undefined;
  const hit = indexes.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.idx;
  try {
    const idx = JSON.parse(await fsp.readFile(file, "utf8")) as ArtIndex;
    indexes.set(file, { mtime: st.mtimeMs, idx });
    return idx;
  } catch {
    return undefined;
  }
}

/** The file a /wikiart/ path names, only index.json or a picture under img/ (pure). */
export function wikiartFile(root: string, rel: string): string | undefined {
  const m =
    /^([a-z0-9-]{1,80})\/(index\.json|img\/[a-f0-9]{12}\.(?:jpg|png))$/.exec(
      rel,
    );
  return m ? path.join(root, m[1]!, ...m[2]!.split("/")) : undefined;
}

/** Handles a /wikiart/ request; returns false when the URL is not ours. */
export async function handleWikiart(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  root = wikiartRoot(),
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://x");
  if (!url.pathname.startsWith("/wikiart/")) return false;
  const rel = url.pathname.slice("/wikiart/".length);
  const json = (code: number, v: unknown) =>
    res
      .writeHead(code, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      .end(JSON.stringify(v));
  if (rel === "games.json") {
    const out = [];
    for (const d of await fsp
      .readdir(root, { withFileTypes: true })
      .catch(() => [])) {
      if (!d.isDirectory()) continue;
      const idx = await loadIndex(root, d.name);
      if (idx?.entities.length)
        out.push({
          game: idx.game,
          slug: idx.slug,
          entities: idx.entities.length,
          images: idx.images.length,
          updatedAt: idx.updatedAt,
        });
    }
    json(200, out);
    return true;
  }
  if (rel === "lookup") {
    const game = url.searchParams.get("game") ?? "";
    const name = url.searchParams.get("name") ?? "";
    const prefer = (url.searchParams.get("prefer") ?? "")
      .split(",")
      .filter(Boolean) as ArtImage["kind"][];
    const idx = game
      ? await loadIndex(root, artSlug(canonicalGame(game)))
      : undefined;
    const host = req.headers.host ?? "127.0.0.1:8793";
    const hit =
      idx && name
        ? lookupInIndex(idx, name, {
            base: `http://${host}/wikiart`,
            ...(prefer.length ? { prefer } : {}),
          })
        : undefined;
    json(200, hit ?? null);
    return true;
  }
  const file = wikiartFile(root, rel);
  const st = file ? await fsp.stat(file).catch(() => undefined) : undefined;
  if (!file || !st?.isFile()) {
    res.writeHead(404).end();
    return true;
  }
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "content-length": st.size,
    "cache-control": "no-store",
  });
  if (req.method === "HEAD") res.end();
  else
    fs.createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  return true;
}
