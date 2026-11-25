// The PC's GPU picture service: the factory (on the Mac mini, or on this PC) sends a picture and gets it back
// filled, upscaled, or a light plate, made on the 4090 through ComfyUI. One job at a time. The first job takes a GPU
// turn from the PC orchestrator at Pulse's priority (60, like the factory's other PC GPU steps) and the turn is held
// while jobs keep coming; after GPUVIS_IDLE_SECONDS without one it is given back, ComfyUI's models are unloaded and
// a ComfyUI this service started is stopped. With no turn within GPUVIS_MAX_WAIT minutes a job answers 503 and the
// factory keeps its usual picture.
//
//   node --import tsx src/gpuvis/server.ts            (listens on 127.0.0.1:8797, GPUVIS_PORT to change)
//
// Endpoints (the picture is the request body; answers are the picture bytes):
//   GET  /health                                          { ok, comfy }
//   POST /fill?outW=1080&outH=1920&place=hero            200 JPEG (X-Gpuvis: JSON of the geometry), 204 fits already, 422 rejected
//   POST /upscale?frameW=1920&frameH=1080&year=2004      200 JPEG or PNG (X-Gpuvis: method), 204 needs nothing
//   POST /plate?seed=1&variant=0                          200 PNG (no body needed)
//   POST /ask   {prompt, schema, images: [base64]}        200 JSON: the thumbnail judge (GPUVIS_RANK_MODEL), in the turn
// The Mac reaches it over the cable the way it reaches the PC's vision and voice: through the orchestrator's
// lan_relay.py, once port 8797 is added to its PORTS (a one-line change in the Master orchestrator's area).

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrch } from "../lib/orch.ts";
import { errorMessage, log } from "../lib/util.ts";
import {
  comfyUp,
  DEFAULT_COMFY_URL,
  ensureComfy,
  freeComfy,
  stopComfy,
} from "./comfy.ts";
import { fillFrame, type FillPlace } from "./fill.ts";
import { drawPlate } from "./thumbs.ts";
import { upscaleStill } from "./upscale.ts";
import { askImages, GPUVIS_RANK_MODEL } from "./vision.ts";

export const GPUVIS_PORT = Number(process.env.GPUVIS_PORT || 8797);
const IDLE_MS = Number(process.env.GPUVIS_IDLE_SECONDS || 90) * 1000;
const MAX_WAIT = Number(process.env.GPUVIS_MAX_WAIT || 30);
const MAX_BODY = 40 * 1024 * 1024;

let release: (() => void) | undefined;
let idleTimer: NodeJS.Timeout | undefined;
let chain: Promise<unknown> = Promise.resolve();
let queued = 0;
/** True while a job waits for its GPU turn: /health says so, so the factory gives up instead of queueing behind it. */
let waitingForTurn = false;

async function turn(
  job: string,
  maxWait: number,
  needsComfy = true,
): Promise<void> {
  if (!release) {
    const orch = await loadOrch().catch(() => undefined);
    waitingForTurn = true;
    try {
      release = orch
        ? await orch.lease("gpu", {
            job,
            project: "pulse",
            priority: 60,
            kind: "pulse:gpuvis",
            est: 5,
            vram: 18,
            ram: 8,
            maxWait,
            onWait: (why: string) =>
              log("info", "GPU picture job waiting for its turn", { why }),
          })
        : () => undefined;
    } finally {
      waitingForTurn = false;
    }
  }
  // Every ComfyUI job, held turn or not: ComfyUI may have stopped or crashed since the last one. The ranking (Ollama)
  // does not need it, so it neither waits for a ComfyUI start nor fails with one.
  if (needsComfy) await ensureComfy(DEFAULT_COMFY_URL);
}

/** Gives the turn back and unloads ComfyUI; runs on the job chain, so it never overlaps a job. */
async function teardown(): Promise<void> {
  if (queued > 0) return;
  await freeComfy(DEFAULT_COMFY_URL);
  stopComfy();
  release?.();
  release = undefined;
}

function idle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    chain = chain.then(teardown).catch(() => undefined);
  }, IDLE_MS);
}

/**
 * One job at a time, each inside the held GPU turn. The idle teardown is armed after every job, also a failed one
 * (a turn granted before ComfyUI failed to start is still given back). `gone` skips a job its caller abandoned.
 */
function serial<T>(
  job: string,
  fn: () => Promise<T>,
  maxWait = MAX_WAIT,
  gone: () => boolean = () => false,
  needsComfy = true,
): Promise<T> {
  queued++;
  if (idleTimer) clearTimeout(idleTimer);
  const next = chain.then(async () => {
    try {
      if (gone()) throw new Error("caller gone");
      await turn(job, maxWait, needsComfy);
      return await fn();
    } finally {
      queued--;
      idle();
    }
  });
  chain = next.catch(() => undefined);
  return next;
}

async function body(req: http.IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY) throw new Error("picture too large");
    parts.push(c as Buffer);
  }
  return Buffer.concat(parts);
}

const PLACES: FillPlace[] = ["centre", "hero", "left", "right"];

export function createGpuvisServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const q = (k: string) => url.searchParams.get(k) ?? undefined;
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-gpuvis-"));
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            comfy: await comfyUp(DEFAULT_COMFY_URL),
            busy: waitingForTurn,
            queued,
          }),
        );
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      // The factory's own wait for a GPU turn (minutes): short, so a busy PC never holds up a render.
      const maxWait = Math.max(
        1,
        Math.min(MAX_WAIT, Number(q("maxWait") || MAX_WAIT)),
      );
      let closed = false;
      res.on("close", () => {
        if (!res.writableEnded) closed = true;
      });
      const gone = () => closed;
      const input = path.join(work, "in");
      if (url.pathname !== "/plate" && url.pathname !== "/ask")
        await fs.writeFile(input, await body(req));
      if (url.pathname === "/fill") {
        const place = (PLACES as string[]).includes(q("place") ?? "")
          ? (q("place") as FillPlace)
          : "hero";
        const out = path.join(work, "fill.jpg");
        const r = await serial(
          "Pulse picture fill",
          () =>
            fillFrame(input, out, {
              outW: Number(q("outW") || 1080),
              outH: Number(q("outH") || 1920),
              place,
            }),
          maxWait,
          gone,
        ).catch((e) => e as Error);
        if (r instanceof Error) {
          res.writeHead(/rejected/.test(r.message) ? 422 : 503, {
            "content-type": "text/plain",
          });
          res.end(r.message);
          return;
        }
        if (!r) {
          res.writeHead(204).end();
          return;
        }
        res.writeHead(200, {
          "content-type": "image/jpeg",
          "x-gpuvis": JSON.stringify({
            geometry: r.geometry,
            seam: r.seam,
            seconds: r.seconds,
            pixel: r.pixel,
          }),
        });
        res.end(await fs.readFile(out));
        return;
      }
      if (url.pathname === "/upscale") {
        const year = q("year") ? Number(q("year")) : undefined;
        // The plan (size, pixel art) and the Lanczos and whole-pixel paths run here; only Real-ESRGAN takes the turn.
        const r = await upscaleStill(input, path.join(work, "up.png"), {
          frameW: Number(q("frameW") || 1920),
          frameH: Number(q("frameH") || 1080),
          year,
          gpu: (fn) => serial("Pulse picture upscale", fn, maxWait, gone),
        }).catch((e) => e as Error);
        if (r instanceof Error) {
          res.writeHead(503, { "content-type": "text/plain" }).end(r.message);
          return;
        }
        if (!r) {
          res.writeHead(204).end();
          return;
        }
        res.writeHead(200, {
          "content-type": "image/png",
          "x-gpuvis": JSON.stringify({
            method: r.method,
            sharpRatio: r.sharpRatio,
            seconds: r.seconds,
          }),
        });
        res.end(await fs.readFile(r.file));
        return;
      }
      if (url.pathname === "/ask") {
        const q2 = JSON.parse((await body(req)).toString("utf8")) as {
          prompt?: string;
          schema?: Record<string, unknown>;
          images?: string[];
        };
        if (!q2.prompt || !Array.isArray(q2.images) || !q2.images.length) {
          res.writeHead(400).end();
          return;
        }
        const answer = await serial(
          "Pulse thumbnail ranking",
          async () => {
            // klein (about 15 GB) leaves the 4090 before the 30B judge (about 20 GB) loads: together they do not fit
            // in 24 GB, Ollama would spill to the CPU and every round would time out. The judge itself is unloaded
            // as soon as it answers (keep_alive 0), so the next fill finds the card free.
            await freeComfy(DEFAULT_COMFY_URL);
            return askImages(
              GPUVIS_RANK_MODEL,
              4096,
              300_000,
              0,
            )(q2.images!, q2.prompt!, q2.schema ?? {});
          },
          maxWait,
          gone,
          false,
        ).catch((e) => e as Error);
        if (answer instanceof Error) {
          res
            .writeHead(503, { "content-type": "text/plain" })
            .end(answer.message);
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(answer ?? {}));
        return;
      }
      if (url.pathname === "/plate") {
        const out = path.join(work, "plate.png");
        await serial(
          "Pulse thumbnail light plate",
          () =>
            drawPlate(out, Number(q("seed") || 1), Number(q("variant") || 0)),
          maxWait,
          gone,
        );
        res.writeHead(200, { "content-type": "image/png" });
        res.end(await fs.readFile(out));
        return;
      }
      res.writeHead(404).end();
    } catch (err) {
      log("warn", "GPU picture job failed", {
        path: url.pathname,
        error: errorMessage(err),
      });
      if (!res.headersSent)
        res.writeHead(500, { "content-type": "text/plain" });
      res.end(errorMessage(err));
    } finally {
      await fs
        .rm(work, { recursive: true, force: true })
        .catch(() => undefined);
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  createGpuvisServer().listen(GPUVIS_PORT, "127.0.0.1", () =>
    log("info", "GPU picture service listening", { port: GPUVIS_PORT }),
  );
}
