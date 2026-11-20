// The PC's read-only server for the master game library (src/assets/gamelibstore.ts): files by HTTP with byte ranges,
// so the Mac's ffmpeg can seek straight to one scene of a trailer or proxy and read only that, plus /health and /games.
// It serves nothing outside the library root, never writes, and needs no login: it is meant to listen on the PC only
// (127.0.0.1) and be reached from the Mac through the orchestrator's LAN relay, as the vision and voice ports are.
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { handleWikiart } from "../wikiart/serve.ts";

/** A Range header against a file of `size` bytes (pure): the inclusive span, "bad" when it cannot be met, undefined when absent. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "bad" | undefined {
  if (!header) return undefined;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return "bad";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : "bad";
}

/** The library file a request path names, or undefined when it would leave the root (pure). */
export function resolveInRoot(
  root: string,
  urlPath: string,
): string | undefined {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.split("?")[0]!);
  } catch {
    return undefined;
  }
  const abs = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
  const base = path.resolve(root);
  return abs === base || !abs.startsWith(base + path.sep) ? undefined : abs;
}

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
};

export function createLibraryServer(root: string): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD")
      return res.writeHead(405).end();
    if (req.url === "/health")
      return res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    // The wiki art library (src/wikiart/serve.ts) rides on the same port the Mac already reaches.
    if (req.url?.startsWith("/wikiart/") && (await handleWikiart(req, res)))
      return;
    if (req.url === "/games") {
      const dirs = (
        await fsp.readdir(root, { withFileTypes: true }).catch(() => [])
      )
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      const games = [];
      for (const d of dirs)
        if (fs.existsSync(path.join(root, d, "library.json"))) games.push(d);
      return res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(games));
    }
    const file = resolveInRoot(root, req.url ?? "/");
    const st = file ? await fsp.stat(file).catch(() => undefined) : undefined;
    if (!file || !st?.isFile()) return res.writeHead(404).end();
    const type =
      TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const range = parseRange(req.headers.range, st.size);
    if (range === "bad")
      return res
        .writeHead(416, { "content-range": `bytes */${st.size}` })
        .end();
    const head = {
      "content-type": type,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    };
    if (!range) {
      res.writeHead(200, { ...head, "content-length": st.size });
      if (req.method === "HEAD") return res.end();
      return fs
        .createReadStream(file)
        .on("error", () => res.destroy())
        .pipe(res);
    }
    res.writeHead(206, {
      ...head,
      "content-length": range.end - range.start + 1,
      "content-range": `bytes ${range.start}-${range.end}/${st.size}`,
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file, { start: range.start, end: range.end })
      .on("error", () => res.destroy())
      .pipe(res);
  });
}
