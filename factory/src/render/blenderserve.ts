// The PC's 3D clip service: the Mac's factory asks for a Blender scene (src/render/blender.ts fetchBlenderClips),
// this renders it on the 4090 inside an orchestrator turn (gpu, Pulse's priority 60) and keeps the clip by its key.
// One render at a time; a clip already made is served at once. Listens on this machine only: the Mac reaches it
// through the orchestrator's LAN relay, like the voice, vision and game library services.
//   POST /render  {key, scene, seconds, params, images: [{name, b64}]}  -> {state}
//   GET  /status/<key>  -> {state: queued | rendering | done | failed | unknown, error?}
//   GET  /clip/<key>.mp4
//   GET  /health
import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { log, errorMessage } from "../lib/util.ts";
import { loadOrch } from "../lib/orch.ts";
import { renderScene } from "./blenderrun.ts";
import { EST_MINUTES, type BlenderScene } from "./blender.ts";

const SCENES = new Set<BlenderScene>([
  "podium",
  "data",
  "chapter",
  "desk",
  "globe",
  "sting",
]);
const KEY = /^[0-9a-f]{16}$/;
/** The fields a request may set per scene: nothing that names a file, sets the render size or changes the output. */
const ALLOWED: Record<BlenderScene, string[]> = {
  podium: ["rank", "title", "meta", "kicker"],
  data: ["mode", "title", "items", "unit", "highlight"],
  chapter: ["number", "title", "kicker", "year"],
  desk: ["title", "label", "captions"],
  globe: ["countries", "pins", "title"],
  sting: ["line"],
};

/** A request's parameters cut down to the scene's own fields (pure). */
export function safeParams(
  scene: BlenderScene,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const keep = new Set([...ALLOWED[scene], "accent", "seed"]);
  return Object.fromEntries(
    Object.entries(params).filter(([k]) => keep.has(k)),
  );
}

interface Job {
  key: string;
  scene: BlenderScene;
  seconds: number;
  params: Record<string, unknown>;
  /** Pictures written to disk when the request arrived (desk). */
  files: string[];
  state: "queued" | "rendering" | "done" | "failed";
  error?: string;
  at: number;
}

export interface ServeOptions {
  cacheDir: string;
  /** Minutes a job waits for its orchestrator turn before it fails (the Mac then keeps the flat graphic). */
  maxWaitMinutes?: number;
  render?: typeof renderScene;
  /** Tests: the orchestrator turn (default: the PC orchestrator through src/lib/orch.ts). */
  turn?: (job: string, est: number) => Promise<() => void>;
}

/** The PC orchestrator turn for one clip. On the PC a render never runs without one, unless this process already
 * runs inside an `orch run` turn (ORCH_HELD), as the proof and excerpt jobs do. */
async function orchTurn(
  job: string,
  est: number,
  maxWait: number,
): Promise<() => void> {
  const orch = await loadOrch().catch(() => undefined);
  if (!orch) {
    if (process.platform === "win32" && !process.env.ORCH_HELD)
      throw new Error("no orchestrator turn available");
    return () => {};
  }
  return orch.lease("gpu", {
    job,
    project: "pulse",
    priority: 60,
    kind: "pulse:blender",
    est,
    vram: 4,
    maxWait,
  });
}

export function createBlenderServer(opts: ServeOptions): http.Server {
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let busy = false;
  const clipPath = (k: string) => path.join(opts.cacheDir, `${k}.mp4`);
  const render = opts.render ?? renderScene;
  const turn =
    opts.turn ??
    ((job: string, est: number) =>
      orchTurn(job, est, opts.maxWaitMinutes ?? 30));

  async function work(): Promise<void> {
    if (busy) return;
    const job = queue.shift();
    if (!job) return;
    busy = true;
    job.state = "rendering";
    const workDir = path.join(opts.cacheDir, "work", job.key);
    let release = () => {};
    try {
      release = await turn(
        `3D clip: ${job.scene}`,
        Math.ceil(EST_MINUTES[job.scene]),
      );
      const params = {
        ...job.params,
        ...(job.files.length ? { images: job.files } : {}),
      };
      const res = await render({
        scene: job.scene,
        params,
        seconds: job.seconds,
        workDir,
        outFile: clipPath(job.key),
      });
      // A clip with black frames would show as a flash in the video: the beat keeps its flat graphic instead.
      if (res.black.length)
        throw new Error(`black frames at ${JSON.stringify(res.black)}`);
      job.state = "done";
      log("info", "3D clip rendered", {
        key: job.key,
        scene: job.scene,
        seconds: Math.round(res.renderSeconds + res.encodeSeconds),
      });
    } catch (err) {
      // The bad file goes before the job says "failed", so nobody asking in between can be handed it.
      await fs.rm(clipPath(job.key), { force: true }).catch(() => undefined);
      job.error = errorMessage(err).slice(0, 300);
      job.state = "failed";
      log("warn", "3D clip failed", {
        key: job.key,
        scene: job.scene,
        error: job.error,
      });
    } finally {
      release();
      await fs
        .rm(workDir, { recursive: true, force: true })
        .catch(() => undefined);
      await fs
        .rm(path.join(opts.cacheDir, "in", job.key), {
          recursive: true,
          force: true,
        })
        .catch(() => undefined);
      // Finished jobs are forgotten after a day (a made clip is still found on disk).
      for (const [k, j] of jobs)
        if (
          (j.state === "done" || j.state === "failed") &&
          Date.now() - j.at > 86_400_000
        )
          jobs.delete(k);
      busy = false;
      void work();
    }
  }

  const send = (res: http.ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname === "/health")
        return send(res, 200, { ok: true, queued: queue.length, busy });
      const st = /^\/status\/([0-9a-f]{16})$/.exec(url.pathname);
      if (req.method === "GET" && st) {
        const j = jobs.get(st[1]!);
        if (j)
          return send(res, 200, {
            state: j.state,
            ...(j.error ? { error: j.error } : {}),
          });
        const have = await fs.stat(clipPath(st[1]!)).catch(() => undefined);
        return send(res, 200, { state: have ? "done" : "unknown" });
      }
      const cl = /^\/clip\/([0-9a-f]{16})\.mp4$/.exec(url.pathname);
      if (req.method === "GET" && cl) {
        const f = clipPath(cl[1]!);
        const s = await fs.stat(f).catch(() => undefined);
        if (!s) return send(res, 404, { error: "no such clip" });
        res.writeHead(200, {
          "content-type": "video/mp4",
          "content-length": s.size,
        });
        return void createReadStream(f).pipe(res);
      }
      if (req.method === "POST" && url.pathname === "/render") {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 64 * 1024 * 1024)
            return send(res, 413, { error: "too large" });
        }
        const b = JSON.parse(raw) as {
          key?: string;
          scene?: string;
          seconds?: number;
          params?: unknown;
          images?: Array<{ name?: string; b64?: string }>;
        };
        const scene = b.scene as BlenderScene;
        const seconds = Number(b.seconds);
        if (
          !SCENES.has(scene) ||
          !(seconds >= 1 && seconds <= 12) ||
          !b.key ||
          !KEY.test(b.key) ||
          typeof b.params !== "object" ||
          !b.params ||
          Array.isArray(b.params)
        )
          return send(res, 400, { error: "bad request" });
        const known = jobs.get(b.key);
        // A "done" job whose clip has since been removed from the cache is made again, not reported done.
        const gone =
          known?.state === "done" &&
          !(await fs.stat(clipPath(b.key)).catch(() => undefined));
        if (known && known.state !== "failed" && !gone)
          return send(res, 200, { state: known.state });
        if (await fs.stat(clipPath(b.key)).catch(() => undefined))
          return send(res, 200, { state: "done" });
        await fs.mkdir(opts.cacheDir, { recursive: true });
        // Pictures go to disk now, not held in memory while the job waits its turn.
        const files: string[] = [];
        const images = Array.isArray(b.images) ? b.images.slice(0, 6) : [];
        if (scene === "desk" && images.length) {
          const dir = path.join(opts.cacheDir, "in", b.key);
          await fs.mkdir(dir, { recursive: true });
          for (const [i, im] of images.entries()) {
            if (!im || typeof im.b64 !== "string") continue;
            const ext =
              /\.(jpe?g|png|webp)$/i
                .exec(String(im.name ?? ""))?.[0]
                ?.toLowerCase() ?? ".jpg";
            const f = path.join(dir, `${i}${ext}`);
            await fs.writeFile(f, Buffer.from(im.b64, "base64"));
            files.push(f);
          }
        }
        const job: Job = {
          key: b.key,
          scene,
          seconds,
          params: safeParams(scene, b.params as Record<string, unknown>),
          files,
          state: "queued",
          at: Date.now(),
        };
        jobs.set(job.key, job);
        queue.push(job);
        void work();
        return send(res, 202, { state: "queued" });
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 500, { error: errorMessage(err).slice(0, 200) });
    }
  });
}
