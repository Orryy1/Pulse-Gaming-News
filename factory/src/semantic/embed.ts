// The embedder's client (MATCH_SEMANTIC, VOD_TAGS): starts src/semantic/embed.py once, asks it for picture and text
// vectors, and keeps every answer on disk so nothing is ever embedded twice. Where it runs (decided 20 Nov 2026): on
// the machine the factory runs on, the Mac mini, on its own GPU (Apple MPS). SigLIP 2 base answers 64 pictures in
// about 1.6 s there and the process holds about 1.9 GB while it is asked; it ends after SEMANTIC_IDLE_SECONDS without
// a question, so it costs nothing between videos. On the PC the same client takes an orchestrator turn (class gpu,
// SEMANTIC_PRIORITY: 60 for production, 20 for tests) around every batch.
// Nothing here touches /Volumes on the main thread: pictures are read by the child process, and a file is hashed with
// an asynchronous read only when it is not on an external drive (those are keyed by their name alone).
// When the model cannot start (no Python, no weights, no memory) every call answers undefined and the factory picks
// pictures the way it did before.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { errorMessage, log } from "../lib/util.ts";
import { leaseStrict, loadOrch, NoOrchestrator } from "../lib/orch.ts";
import { fromBase64, toBase64, type EmbedInfo } from "./match.ts";

export interface EmbedderOptions {
  python: string;
  model: string;
  /** Where the vectors are kept: <dir>/<model>/{img,txt}/<aa>/<key>.f32 and <dir>/<model>/info.json. */
  cacheDir: string;
  device?: string;
  idleSeconds?: number;
  /** Orchestrator priority on the PC (60 production, 20 tests); unused on the Mac. */
  priority?: number;
  /** Tests: a stand-in for the Python process. */
  spawnWorker?: () => ChildProcessWithoutNullStreams;
  /** Tests: a stand-in for the orchestrator turn. */
  lease?: () => Promise<() => void>;
}

const FAILED_RETRY_MS = 10 * 60_000;

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "embed.py",
);

export const modelSlug = (model: string) =>
  model
    .replace(/[^a-z0-9.]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const isExternal = (file: string) => /^\/Volumes\//.test(file);

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class Embedder {
  private proc?: ChildProcessWithoutNullStreams;
  private ready?: Promise<EmbedInfo | undefined>;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private idle?: NodeJS.Timeout;
  /** When the model last failed to start: tried again after FAILED_RETRY_MS (a start during a render can run out of memory). */
  private failedAt = 0;
  private get failed(): boolean {
    return Date.now() - this.failedAt < FAILED_RETRY_MS;
  }
  private infoCache?: EmbedInfo;

  constructor(private o: EmbedderOptions) {}

  private dir(kind: "img" | "txt", key: string): string {
    return path.join(
      this.o.cacheDir,
      modelSlug(this.o.model),
      kind,
      key.slice(0, 2),
      `${key}.f32`,
    );
  }

  /** The model's size and sigmoid, from the cache or the process (undefined when the model cannot run). */
  async info(): Promise<EmbedInfo | undefined> {
    if (this.infoCache) return this.infoCache;
    const file = path.join(
      this.o.cacheDir,
      modelSlug(this.o.model),
      "info.json",
    );
    const saved = await fs
      .readFile(file, "utf8")
      .then((t) => JSON.parse(t) as EmbedInfo)
      .catch(() => undefined);
    if (saved?.dim) return (this.infoCache = saved);
    return this.start();
  }

  private start(): Promise<EmbedInfo | undefined> {
    if (this.failed) return Promise.resolve(undefined);
    if (this.ready) return this.ready;
    this.ready = new Promise<EmbedInfo | undefined>((resolve) => {
      let proc: ChildProcessWithoutNullStreams;
      try {
        proc =
          this.o.spawnWorker?.() ??
          spawn(
            this.o.python,
            [
              SCRIPT,
              "--model",
              this.o.model,
              ...(this.o.device ? ["--device", this.o.device] : []),
            ],
            {
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
              env: {
                ...process.env,
                TOKENIZERS_PARALLELISM: "false",
                HF_HUB_DISABLE_TELEMETRY: "1",
              },
            },
          );
      } catch (err) {
        this.failedAt = Date.now();
        log("warn", "semantic: embedder did not start", {
          error: errorMessage(err),
        });
        return resolve(undefined);
      }
      this.proc = proc;
      // Each process answers only its own questions: a closed one ending late never touches its successor's.
      const pending = new Map<number, Pending>();
      this.pending = pending;
      // Writing to a process that has just died must not become an uncaught error: its exit rejects what waits.
      proc.stdin.on("error", () => undefined);
      let said = "";
      proc.stderr.on("data", (d) => (said = (said + String(d)).slice(-600)));
      const lines = createInterface({ input: proc.stdout });
      let first = true;
      lines.on("line", (line) => {
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (first && msg.ready) {
          first = false;
          const info: EmbedInfo = {
            model: String(msg.model),
            dim: Number(msg.dim),
            scale: Number(msg.scale),
            bias: Number(msg.bias),
          };
          this.infoCache = info;
          const file = path.join(
            this.o.cacheDir,
            modelSlug(this.o.model),
            "info.json",
          );
          void fs
            .mkdir(path.dirname(file), { recursive: true })
            .then(() => fs.writeFile(file, JSON.stringify(info)))
            .catch(() => undefined);
          log("info", "semantic: embedder ready", {
            model: info.model,
            device: msg.device,
            dim: info.dim,
          });
          return resolve(info);
        }
        const p = pending.get(Number(msg.id));
        if (!p) return;
        pending.delete(Number(msg.id));
        if (msg.error) p.reject(new Error(String(msg.error)));
        else p.resolve(msg);
      });
      const down = (why: string) => {
        if (first) {
          first = false;
          this.failedAt = Date.now();
          log("warn", "semantic: embedder could not load its model", {
            why,
            said: said.trim().slice(-300),
          });
          resolve(undefined);
        }
        for (const p of pending.values())
          p.reject(new Error(`embedder ended: ${why}`));
        pending.clear();
        if (this.proc === proc) {
          this.proc = undefined;
          this.ready = undefined;
        }
      };
      proc.on("error", (err) => down(errorMessage(err)));
      proc.on("exit", (code) => down(`exit ${code}`));
    });
    return this.ready;
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(
      () => this.close(),
      (this.o.idleSeconds ?? 60) * 1000,
    );
    this.idle.unref?.();
  }

  private async ask(
    op: "image" | "text",
    payload: Record<string, unknown>,
  ): Promise<Array<string | null>> {
    const info = await this.start();
    if (!info || !this.proc) throw new Error("embedder not running");
    const id = this.nextId++;
    const answer = new Promise<any>((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
    this.proc.stdin.write(`${JSON.stringify({ id, op, ...payload })}\n`);
    this.touch();
    const msg = await answer;
    this.touch();
    return Array.isArray(msg.vectors) ? msg.vectors : [];
  }

  private async turn<T>(work: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    try {
      release = this.o.lease
        ? await this.o.lease()
        : await leaseStrict(await loadOrch(), "gpu", {
            project: "pulse",
            job: "semantic embeddings",
            priority: this.o.priority ?? 60,
            est: 2,
          });
    } catch (err) {
      if (!(err instanceof NoOrchestrator))
        log("warn", "semantic: no orchestrator turn, going ahead", {
          error: errorMessage(err),
        });
    }
    try {
      return await work();
    } finally {
      release?.();
    }
  }

  /** A picture's cache key: its bytes (local files), or its name alone (an external drive). */
  async imageKey(file: string): Promise<string | undefined> {
    try {
      // Never even a stat on an external drive from this process (it can hang under launchd): keyed by its name.
      if (isExternal(file))
        return createHash("sha1").update(`external|${file}`).digest("hex");
      return createHash("sha1")
        .update(await fs.readFile(file))
        .digest("hex");
    } catch {
      return undefined;
    }
  }

  private async cached(
    kind: "img" | "txt",
    key: string,
    dim: number,
  ): Promise<Float32Array | undefined> {
    const buf = await fs.readFile(this.dir(kind, key)).catch(() => undefined);
    if (!buf || buf.length !== dim * 4) return undefined;
    return new Float32Array(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
    );
  }

  private async keep(
    kind: "img" | "txt",
    key: string,
    v: Float32Array,
  ): Promise<void> {
    const file = this.dir(kind, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(v.buffer, v.byteOffset, v.byteLength));
  }

  /** Unit vectors for pictures, in order; undefined for one that cannot be read, all undefined when the model is down. */
  async images(
    files: string[],
    keys?: Array<string | undefined>,
  ): Promise<Array<Float32Array | undefined>> {
    const out: Array<Float32Array | undefined> = files.map(() => undefined);
    const info = await this.info();
    if (!info) return out;
    const k = keys ?? (await Promise.all(files.map((f) => this.imageKey(f))));
    const todo: number[] = [];
    for (const [i, key] of k.entries()) {
      if (!key) continue;
      const hit = await this.cached("img", key, info.dim);
      if (hit) out[i] = hit;
      else todo.push(i);
    }
    for (let b = 0; b < todo.length; b += 64) {
      const chunk = todo.slice(b, b + 64);
      try {
        const vecs = await this.turn(() =>
          this.ask("image", { files: chunk.map((i) => files[i]!) }),
        );
        for (const [j, i] of chunk.entries()) {
          const raw = vecs[j];
          if (!raw) continue;
          out[i] = fromBase64(raw);
          await this.keep("img", k[i]!, out[i]!).catch(() => undefined);
        }
      } catch (err) {
        log("warn", "semantic: picture batch not embedded", {
          error: errorMessage(err),
          pictures: chunk.length,
        });
        break;
      }
    }
    return out;
  }

  /** Unit vectors for texts, in order; undefined when the model is down. */
  async texts(texts: string[]): Promise<Float32Array[] | undefined> {
    const info = await this.info();
    if (!info) return undefined;
    const keys = texts.map((t) => createHash("sha1").update(t).digest("hex"));
    const out: Array<Float32Array | undefined> = await Promise.all(
      keys.map((key) => this.cached("txt", key, info.dim)),
    );
    const todo = out.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    if (todo.length) {
      try {
        const vecs = await this.turn(() =>
          this.ask("text", { texts: todo.map((i) => texts[i]!) }),
        );
        for (const [j, i] of todo.entries()) {
          if (!vecs[j]) continue;
          out[i] = fromBase64(vecs[j]!);
          await this.keep("txt", keys[i]!, out[i]!).catch(() => undefined);
        }
      } catch (err) {
        log("warn", "semantic: texts not embedded", {
          error: errorMessage(err),
        });
        return undefined;
      }
    }
    return out.every((v): v is Float32Array => Boolean(v)) ? out : undefined;
  }

  close(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = undefined;
    const p = this.proc;
    this.proc = undefined;
    this.ready = undefined;
    if (p) {
      p.stdin.end();
      setTimeout(() => p.kill(), 5000).unref?.();
    }
  }
}

export { toBase64 };

/** The embedder for the factory's settings (one per process). */
let shared: Embedder | undefined;
export function sharedEmbedder(o: EmbedderOptions): Embedder {
  shared ??= new Embedder(o);
  return shared;
}
