// The PC's read-only server for the master game library (src/assets/gamelibstore.ts): files by HTTP with byte ranges,
// so the Mac's ffmpeg can seek straight to one scene of a trailer or proxy and read only that, plus /health and /games.
// It serves nothing outside the library root, never writes, and needs no login: it is meant to listen on the PC only
// (127.0.0.1) and be reached from the Mac through the orchestrator's LAN relay, as the vision and voice ports are.
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { handleWikiart } from "../wikiart/serve.ts";
import { handleVod, type VodServeContext } from "../vodindex/serve.ts";

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

/**
 * The PC orchestrator's reading of Claude's week (C:\Claude\orchestrator\state\claude_budget.json, written by
 * claude_budget.py), trimmed to the fields the Mac's Max guard reads (src/editorial/maxplan.ts) (pure). Nothing else
 * in that file leaves the PC.
 */
export function budgetView(raw: unknown): Record<string, unknown> {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof d.weekly === "number") out.weekly = d.weekly;
  if (typeof d.resets_at === "string") out.resets_at = d.resets_at;
  if (typeof d.read_at === "number") out.read_at = d.read_at;
  if (typeof d.limited_until === "string") out.limited_until = d.limited_until;
  return out;
}

/** Where the orchestrator keeps that reading: ORCH_STATE, else its own state folder. */
export function budgetFile(env: Record<string, string | undefined> = process.env): string {
  return path.join(env.ORCH_STATE || "C:\\Claude\\orchestrator\\state", "claude_budget.json");
}

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
};

/** lan_relay's vision guard file (C:/Claude/orchestrator/state/vision_guard.json unless VISION_GUARD_FILE says). */
export function visionGuardFile(): string {
  return process.env.VISION_GUARD_FILE || "C:/Claude/orchestrator/state/vision_guard.json";
}

/**
 * The guard file's view for the Mac (pure). A reading older than 150 s means the relay may be dead, so it never says
 * "guard on" then (stale: true, guard: false). Unreadable or missing: undefined (404).
 */
export function visionGuardView(
  raw: string | undefined,
  nowSec: number,
): { guard: boolean; why: string; at: number; stale: boolean } | undefined {
  if (!raw) return undefined;
  let j: { guard?: unknown; why?: unknown; at?: unknown };
  try {
    j = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const at = typeof j.at === "number" ? j.at : 0;
  // A reading from the future (the clock stepped back) is not trusted either.
  const age = nowSec - at;
  const stale = !(at > 0 && age <= 150 && age >= -5);
  return { guard: !stale && j.guard === true, why: typeof j.why === "string" ? j.why : "", at, stale };
}

export function createLibraryServer(root: string, vod?: VodServeContext): http.Server {
  return http.createServer(async (req, res) => {
    // The stream recordings and their clips (src/vodindex/serve.ts), the only routes that take a POST.
    if (vod && req.url?.startsWith("/vod/") && (await handleVod(req, res, vod))) return;
    if (req.method !== "GET" && req.method !== "HEAD")
      return res.writeHead(405).end();
    if (req.url === "/health")
      return res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    // Claude's weekly reading for the Mac's Max guard (CLAUDE_VIA_MAX); 404 while the PC has none.
    if (req.url === "/claude-budget") {
      const raw = await fsp.readFile(budgetFile(), "utf8").catch(() => undefined);
      let body: Record<string, unknown> | undefined;
      try {
        body = raw ? budgetView(JSON.parse(raw)) : undefined;
      } catch {
        body = undefined;
      }
      if (!body) return res.writeHead(404).end();
      return res
        .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify(body));
    }
    // Whether the orchestrator's render guard is refusing Mac vision now (written by lan_relay every 60 s and at each
    // refusal); the Mac's vision alert says "expected" only on a fresh {"guard": true}. 404 when there is no file.
    if (req.url === "/vision-guard") {
      const raw = await fsp.readFile(visionGuardFile(), "utf8").catch(() => undefined);
      const body = visionGuardView(raw, Date.now() / 1000);
      if (!body) return res.writeHead(404).end();
      return res
        .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify(body));
    }
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
