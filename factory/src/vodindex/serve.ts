// The stream recordings served to the Mac mini (owner, 25 Nov 2026: "use my own GTA VI streams first, without YouTube").
// The recordings and their indexes live on the PC (D:\pulse-data\vods); the Mac's disk has no room for them. The game
// library server (src/assets/gamelibserve.ts, port 8793, relayed to the Mac as GAMELIB_REMOTE) answers these too:
//   GET  /vod/list[?game=]              the recordings fully tagged, owner's channel first
//   GET  /vod/index?vod=<id>            one recording's index and tags (the Mac plans its clips from them)
//   POST /vod/score  {vod, builtAt, targets}   each line's meaning score for every shot (the vectors stay here)
//   POST /vod/search {game, text, keywords?, max?}   the best moments for one line, each marked when held
//   GET  /vod/clip?vod=<id>&from=<s>&to=<s>   a short muted cut made here with ffmpeg (cached for a day)
// Nothing here writes outside the clip cache, and a clip is at most MAX_CLIP_SECONDS long, inside the recording.

import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { parseFetchTitles } from "../sceneindex/gamefetch.ts";
import { spoilerWindow, type SpoilerWindow } from "../sceneindex/spoilers.ts";
import { recordingsOf } from "../semantic/hook.ts";
import type { Embedder } from "../semantic/embed.ts";
import {
  loadShotVectors,
  targetScorer,
  vectorFile,
} from "../semantic/shots.ts";
import { sourceByChannel, vodSources, type VodSource } from "./sources.ts";
import {
  listVodIndexes,
  loadVodIndex,
  vodIndexDir,
  type VodIndex,
} from "./schema.ts";
import { findVodMoments, loadVodTags, tagFile, untagged } from "./tags.ts";

const exec = promisify(execFile);

export const MAX_CLIP_SECONDS = 30;
/** The PC's spoiler windows when GAME_FETCH_TITLES is not set here: the Mac's own GTA VI window (until 18 Dec). */
export const DEFAULT_SPOILER_TITLES =
  "Grand Theft Auto VI@2026-11-18T11:00Z~2026-12-17";

export interface VodServeContext {
  /** Where the stream indexes are (<data>/vodindex/<id>). */
  dataDir: string;
  /** Where cut clips are kept for a day. */
  clipDir: string;
  model: string;
  embedder?: () => Embedder;
  windows: () => readonly SpoilerWindow[];
  sources: VodSource[];
  now?: () => Date;
}

/** The serve settings from the environment (pure but for the path defaults). */
export function vodServeContext(
  env: NodeJS.ProcessEnv,
  o: {
    model: string;
    embedder?: () => Embedder;
    spoilerDays?: number;
    openingShare?: number;
  },
): VodServeContext {
  const root = env.VOD_ROOT || "D:\\pulse-data\\vods";
  const titles = parseFetchTitles(
    env.GAME_FETCH_TITLES || env.VOD_SPOILER_TITLES || DEFAULT_SPOILER_TITLES,
  );
  const windows = titles.flatMap((t) => {
    if (!t.release) return [];
    const w = spoilerWindow(t.game, t.release, {
      days: o.spoilerDays ?? 28,
      openingShare: o.openingShare ?? 0.1,
      ...(t.until ? { until: t.until } : {}),
    });
    return w ? [w] : [];
  });
  return {
    dataDir: env.VOD_DATA_DIR || path.join(root, "data"),
    clipDir: env.VOD_CLIP_DIR || path.join(root, "clips"),
    model: o.model,
    ...(o.embedder ? { embedder: o.embedder } : {}),
    windows: () => windows,
    sources: vodSources(env),
  };
}

/** A recording the Mac may use (pure over its tags): every described stretch tagged. */
export function vodReady(
  v: VodIndex,
  tags: Awaited<ReturnType<typeof loadVodTags>>,
): boolean {
  return (
    v.shots.some((s) => s.desc && s.desc !== "-") &&
    Object.keys(tags.stretches).length > 0 &&
    untagged(v, tags).length === 0
  );
}

/** The clip span a request asks for, checked against the recording (pure); undefined when it is not allowed. */
export function clipSpan(
  fromRaw: string | null,
  toRaw: string | null,
  duration: number,
): { from: number; to: number } | undefined {
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from)
    return undefined;
  if (to - from > MAX_CLIP_SECONDS || to > duration + 0.5) return undefined;
  return {
    from: Math.round(from * 100) / 100,
    to: Math.round(Math.min(to, duration) * 100) / 100,
  };
}

const json = (res: http.ServerResponse, code: number, body: unknown) =>
  res
    .writeHead(code, {
      "content-type": "application/json",
      "cache-control": "no-store",
    })
    .end(JSON.stringify(body));

async function readBody(
  req: http.IncomingMessage,
  max = 256 * 1024,
): Promise<any> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > max) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const fileThere = (f: string) =>
  fsp
    .stat(f)
    .then((s) => s.isFile() && s.size > 0)
    .catch(() => false);

/** The recordings ready to serve, the owner's channel first, each still on the disk. */
export async function readyRecordings(
  ctx: VodServeContext,
  game?: string,
): Promise<VodIndex[]> {
  const all = await listVodIndexes(ctx.dataDir).catch(() => [] as VodIndex[]);
  const out: VodIndex[] = [];
  for (const v of game ? recordingsOf(all, game, ctx.sources) : all) {
    if (!(await fileThere(v.file))) continue;
    if (vodReady(v, await loadVodTags(ctx.dataDir, v.vodId))) out.push(v);
  }
  return out;
}

/** Two cuts at a time; past MAX_WAITING more in line, a cut is refused (busy) rather than queued without end. */
export const MAX_WAITING = 8;
export class BusyError extends Error {}
let cutting = 0;
const waiting: Array<() => void> = [];
async function oneOfTwo<T>(fn: () => Promise<T>): Promise<T> {
  if (cutting >= 2) {
    if (waiting.length >= MAX_WAITING) throw new BusyError("the PC is busy cutting clips");
    // The finishing cut hands its slot straight over, so no newcomer slips in between.
    await new Promise<void>((r) => waiting.push(r));
  } else cutting++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else cutting--;
  }
}

/** Cuts [from, to) of a recording, muted, into the cache (once; a second ask is served from the file). */
export async function cutClip(
  ctx: VodServeContext,
  v: VodIndex,
  from: number,
  to: number,
): Promise<string> {
  await fsp.mkdir(ctx.clipDir, { recursive: true });
  const file = path.join(
    ctx.clipDir,
    `${v.vodId.replace(/[^\w-]/g, "_")}_${from.toFixed(2)}_${to.toFixed(2)}.mp4`,
  );
  if (await fileThere(file)) return file;
  return oneOfTwo(async () => {
    if (await fileThere(file)) return file;
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp.mp4`;
    try {
      await exec(
        FFMPEG,
        [
          "-loglevel",
          "error",
          "-y",
          "-ss",
          from.toFixed(2),
          "-i",
          v.file,
          "-t",
          (to - from).toFixed(2),
          "-an",
          "-sn",
          "-dn",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "16",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          tmp,
        ],
        {
          timeout: 180_000,
          windowsHide: true,
          killSignal: "SIGKILL",
          maxBuffer: 1024 * 1024,
        },
      );
      await fsp.rename(tmp, file);
      return file;
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  });
}

/** Cached clips older than a day go (called now and then by the server). */
export async function pruneClips(
  ctx: VodServeContext,
  maxAgeMs = 86_400_000,
): Promise<number> {
  const now = (ctx.now?.() ?? new Date()).getTime();
  let n = 0;
  for (const f of await fsp.readdir(ctx.clipDir).catch(() => [] as string[])) {
    const p = path.join(ctx.clipDir, f);
    const st = await fsp.stat(p).catch(() => undefined);
    if (st?.isFile() && now - st.mtimeMs > maxAgeMs) {
      await fsp.rm(p, { force: true }).catch(() => undefined);
      n++;
    }
  }
  return n;
}

/** Answers a /vod/ request; false when the path is not one of these. */
export async function handleVod(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: VodServeContext,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://pc");
  if (!url.pathname.startsWith("/vod/")) return false;
  try {
    const route = `${req.method} ${url.pathname}`;
    if (route === "GET /vod/list") {
      const list = await readyRecordings(
        ctx,
        url.searchParams.get("game") ?? undefined,
      );
      // The tags' own time too: re-tagging (a story or overlay fix) changes tags.json, not the index.
      const stamps = await Promise.all(
        list.map((v) => fsp.stat(tagFile(ctx.dataDir, v.vodId)).then((s) => Math.round(s.mtimeMs)).catch(() => 0)),
      );
      json(
        res,
        200,
        list.map((v, i) => ({
          tagsStamp: stamps[i],
          vodId: v.vodId,
          channel: v.channel ?? "tinotv",
          title: v.title,
          game: v.game,
          recordedOn: v.recordedOn,
          duration: v.duration,
          builtAt: v.builtAt,
          shots: v.shots.length,
        })),
      );
      return true;
    }
    if (route === "GET /vod/index") {
      const v = await loadVodIndex(
        ctx.dataDir,
        url.searchParams.get("vod") ?? "",
      );
      if (!v) return (json(res, 404, { error: "no such recording" }), true);
      json(res, 200, {
        index: v,
        tags: await loadVodTags(ctx.dataDir, v.vodId),
      });
      return true;
    }
    if (route === "POST /vod/score") {
      const body = await readBody(req);
      const v = await loadVodIndex(ctx.dataDir, String(body.vod ?? ""));
      if (!v) return (json(res, 404, { error: "no such recording" }), true);
      if (body.builtAt && body.builtAt !== v.builtAt)
        return (
          json(res, 409, { error: "index changed", builtAt: v.builtAt }),
          true
        );
      const targets = (Array.isArray(body.targets) ? body.targets : [])
        .slice(0, 64)
        .map((t: any) => ({
          key: String(t?.key ?? ""),
          text: String(t?.text ?? "").slice(0, 600),
          keywords: Array.isArray(t?.keywords)
            ? t.keywords.map(String).slice(0, 12)
            : [],
        }))
        .filter((t: { key: string; text: string }) => t.key && t.text);
      const vecs = await loadShotVectors(
        vectorFile(vodIndexDir(ctx.dataDir, v.vodId), ctx.model),
      );
      if (!vecs.size || !ctx.embedder)
        return (json(res, 200, { scores: {} }), true);
      const scorer = await targetScorer(ctx.embedder(), v.shots, vecs, targets);
      if (!scorer)
        return (
          json(res, 503, { error: "the meaning model is not answering" }),
          true
        );
      const scores: Record<string, Array<number | null>> = {};
      for (const t of targets) {
        const m = scorer(t);
        if (!m) continue;
        scores[t.key] = v.shots.map((s) => {
          const x = m.get(s.id);
          return x === undefined ? null : Math.round(x * 1000) / 1000;
        });
      }
      json(res, 200, { builtAt: v.builtAt, scores });
      return true;
    }
    if (route === "POST /vod/search") {
      const body = await readBody(req);
      const game = String(body.game ?? "");
      const text = String(body.text ?? "").slice(0, 600);
      if (!game || !text)
        return (json(res, 400, { error: "game and text wanted" }), true);
      const vods = await readyRecordings(ctx, game);
      const moments = await findVodMoments(
        vods,
        {
          key: "search",
          text,
          keywords: Array.isArray(body.keywords)
            ? body.keywords.map(String).slice(0, 12)
            : [],
        },
        {
          dataDir: ctx.dataDir,
          ...(ctx.embedder
            ? { embedder: ctx.embedder(), model: ctx.model }
            : {}),
          now: ctx.now?.() ?? new Date(),
          windows: ctx.windows(),
          max: Math.min(20, Math.max(1, Number(body.max) || 5)),
        },
      );
      json(res, 200, {
        moments: moments.map((m) => {
          const v = vods.find((x) => x.vodId === m.vodId);
          const src = sourceByChannel(v?.channel, ctx.sources);
          return {
            ...m,
            file: path.win32.basename(m.file),
            channel: v?.channel ?? "tinotv",
            credit: src?.credit ?? "",
            clip: `/vod/clip?vod=${encodeURIComponent(m.vodId)}&from=${m.start.toFixed(2)}&to=${Math.min(m.end, m.start + MAX_CLIP_SECONDS).toFixed(2)}`,
          };
        }),
      });
      return true;
    }
    if (route === "GET /vod/clip" || route === "HEAD /vod/clip") {
      const v = await loadVodIndex(
        ctx.dataDir,
        url.searchParams.get("vod") ?? "",
      );
      if (!v || !(await fileThere(v.file)))
        return (json(res, 404, { error: "no such recording" }), true);
      const span = clipSpan(
        url.searchParams.get("from"),
        url.searchParams.get("to"),
        v.duration,
      );
      if (!span)
        return (
          json(res, 400, {
            error: `a span inside the recording, at most ${MAX_CLIP_SECONDS} s`,
          }),
          true
        );
      const file = await cutClip(ctx, v, span.from, span.to);
      const st = await fsp.stat(file);
      res.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": st.size,
        "cache-control": "no-store",
      });
      if (req.method === "HEAD") return (res.end(), true);
      fs.createReadStream(file)
        .on("error", () => res.destroy())
        .pipe(res);
      return true;
    }
    json(res, 404, { error: "unknown /vod/ route" });
    return true;
  } catch (err) {
    log("warn", "vod serve: request failed", {
      url: req.url,
      error: errorMessage(err),
    });
    if (!res.headersSent) json(res, err instanceof BusyError ? 503 : 500, { error: errorMessage(err) });
    else res.destroy();
    return true;
  }
}
