// A small ComfyUI client for the GPU picture tools (src/gpuvis): upload a picture, queue an API-format workflow,
// wait for it in the history and download what it saved. The server is the PC's own ComfyUI
// (C:\Users\MORR\ComfyUI, models in D:\AI\ComfyUI-models), the one other projects on the machine use; when it is
// not running, ensureComfy starts it with the desktop app's Python and remembers that it did, so stopComfy only
// ever stops a server this process started (never someone else's). Jobs are queued under their own client id
// and a job past its timeout is dropped from the queue, so nobody else's work is touched.

import { spawn, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchWithTimeout, log } from "../lib/util.ts";

export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
export const COMFY_DIR = process.env.COMFY_DIR || "C:/Users/MORR/ComfyUI";
// The PC's Python 3.14 has torch 2.11 (CUDA 12.8) and ComfyUI's frontend package; the desktop app's own venv
// (Documents\ComfyUI\.venv) lacks the frontend package this ComfyUI 0.18.1 checkout needs and exits at start
// (20 Nov 2026). Other projects on the PC run it the same way (ai-babe).
export const COMFY_PYTHON =
  process.env.COMFY_PYTHON || "C:/Python314/python.exe";
/** ComfyUI's own output when this module starts it, for diagnosis. */
export const COMFY_LOG = path.join(os.tmpdir(), "pulse-gpuvis-comfyui.log");

export type Workflow = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

export interface ComfyImage {
  filename: string;
  subfolder: string;
  type: string;
}

let started: ChildProcess | undefined;

export async function comfyUp(
  url = DEFAULT_COMFY_URL,
  timeoutMs = 4000,
): Promise<boolean> {
  try {
    return (await fetchWithTimeout(`${url}/system_stats`, {}, timeoutMs)).ok;
  } catch {
    return false;
  }
}

/** The ComfyUI server answers at url, starting the PC's own one (loopback only) when nothing does. */
export async function ensureComfy(
  url = DEFAULT_COMFY_URL,
  waitMs = 180_000,
): Promise<void> {
  if (await comfyUp(url)) return;
  const port = new URL(url).port || "8188";
  log("info", "starting ComfyUI for the GPU picture tools", {
    dir: COMFY_DIR,
    port,
  });
  const logFd = openSync(COMFY_LOG, "a");
  started = spawn(
    COMFY_PYTHON,
    [
      "main.py",
      "--listen",
      "127.0.0.1",
      "--port",
      port,
      "--disable-auto-launch",
    ],
    {
      cwd: COMFY_DIR,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
      detached: false,
    },
  );
  const child = started;
  child.on("error", (err) =>
    log("warn", "ComfyUI did not start", { error: String(err) }),
  );
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    if (await comfyUp(url)) return;
    // Gone already (a missing package, a bad Python): say so now rather than wait out the clock.
    if (child.exitCode !== null)
      throw new Error(
        `ComfyUI exited with code ${child.exitCode} before answering; its log is ${COMFY_LOG}`,
      );
  }
  throw new Error(
    `ComfyUI did not answer at ${url} within ${Math.round(waitMs / 1000)}s; its log is ${COMFY_LOG}`,
  );
}

/** Asks ComfyUI to drop its loaded models (frees the 4090's memory for the next job); never throws. */
export async function freeComfy(url = DEFAULT_COMFY_URL): Promise<void> {
  // Also a ComfyUI someone else started: our models must not sit in the 4090's memory once our GPU turn is given
  // back (another project's next job reloads its own, which costs it seconds; our 15 GB left behind costs it the card).
  try {
    await fetchWithTimeout(
      `${url}/free`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      },
      15_000,
    );
  } catch {
    /* already gone */
  }
}

/** Stops the ComfyUI this process started (by its own PID), if any; a server someone else started stays up. */
export function stopComfy(): void {
  if (started && started.exitCode === null) {
    try {
      started.kill();
    } catch {
      /* already stopped */
    }
  }
  started = undefined;
}

/** Uploads a picture to ComfyUI's input folder under a unique name and returns that name. */
export async function uploadImage(
  url: string,
  file: string,
  name?: string,
): Promise<string> {
  const form = new FormData();
  const bytes = await fs.readFile(file);
  const upName =
    name ?? `pulse_gpuvis_${process.pid}_${Date.now()}_${path.basename(file)}`;
  form.append("image", new Blob([bytes]), upName);
  form.append("overwrite", "true");
  const res = await fetchWithTimeout(
    `${url}/upload/image`,
    { method: "POST", body: form },
    60_000,
  );
  if (!res.ok)
    throw new Error(
      `comfyui upload ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  const body = (await res.json()) as { name: string; subfolder?: string };
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

/**
 * Deletes a picture this process uploaded from ComfyUI's input folder (on C:, which must not fill up); ComfyUI has
 * no route for it, so this works on the PC that runs ComfyUI and is a no-op elsewhere. Never throws.
 */
export async function removeUpload(name: string): Promise<void> {
  if (!/^pulse_gpuvis_/.test(path.basename(name))) return;
  await fs
    .rm(path.join(COMFY_DIR, "input", name), { force: true })
    .catch(() => undefined);
}

/** Queues a workflow, waits for it and returns the images it saved (first output node with images). */
export async function runWorkflow(
  url: string,
  workflow: Workflow,
  timeoutMs = 300_000,
): Promise<ComfyImage[]> {
  const deadline = Date.now() + timeoutMs;
  const queued = await fetchWithTimeout(
    `${url}/prompt`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: workflow,
        client_id: `pulse-gpuvis-${process.pid}`,
      }),
    },
    30_000,
  );
  if (!queued.ok)
    throw new Error(
      `comfyui ${queued.status}: ${(await queued.text()).slice(0, 400)}`,
    );
  const { prompt_id: id } = (await queued.json()) as { prompt_id: string };
  if (!id) throw new Error("comfyui gave no prompt id");
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetchWithTimeout(
      `${url}/history/${id}`,
      {},
      30_000,
    ).catch(() => undefined);
    if (!res?.ok) continue;
    const hist = (await res.json()) as Record<
      string,
      {
        outputs?: Record<string, { images?: ComfyImage[] }>;
        status?: { status_str?: string; messages?: unknown[] };
      }
    >;
    const entry = hist[id];
    if (!entry) continue;
    if (entry.status?.status_str === "error")
      throw new Error(
        `comfyui job failed: ${JSON.stringify(entry.status.messages ?? []).slice(0, 600)}`,
      );
    if (entry.outputs) {
      const images = Object.values(entry.outputs).flatMap(
        (o) => o.images ?? [],
      );
      if (!images.length) throw new Error("comfyui job saved no image");
      return images;
    }
  }
  await fetchWithTimeout(
    `${url}/queue`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: [id] }),
    },
    10_000,
  ).catch(() => undefined);
  // Only our own job is stopped: ComfyUI interrupts just the named prompt when it is the one running (a shared
  // ComfyUI may be drawing another project's picture).
  await fetchWithTimeout(
    `${url}/interrupt`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt_id: id }),
    },
    10_000,
  ).catch(() => undefined);
  throw new Error(
    `comfyui job ${id} took longer than ${Math.round(timeoutMs / 1000)}s`,
  );
}

/** Downloads one saved image to dest. */
export async function downloadImage(
  url: string,
  img: ComfyImage,
  dest: string,
): Promise<string> {
  const q = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder,
    type: img.type,
  });
  const res = await fetchWithTimeout(`${url}/view?${q}`, {}, 120_000);
  if (!res.ok) throw new Error(`comfyui view ${res.status}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}
