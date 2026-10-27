// 2.5D layers for a long video's stills (src/render/parallax.py): background, middle and foreground cut
// by a depth model on this machine's GPU, so the renderer can drift them at different speeds and key
// art moves like footage. One Python run per video (the model loads once); a failure leaves the stills
// flat, never stops the render.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, errorMessage } from "../lib/util.ts";

const run = promisify(execFile);
const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "parallax.py",
);

export interface Layers {
  bg: string;
  mid: string;
  fg: string;
  /** Where the foreground subject stands across the picture, 0 (left) to 1 (right). */
  fgx?: number;
}

/** Pictures worth layering: wide stills shown full bleed (not box art, archive prints or portraits). */
export const LAYERED_KINDS = new Set([
  "hero",
  "screenshot",
  "article",
  "header",
]);

/**
 * Layers for each file (paths relative to the episode folder), written beside it under assets/px.
 * Returns only the ones made; the rest stay flat.
 */
export async function makeParallax(
  python: string,
  episodeDir: string,
  files: string[],
): Promise<Map<string, Layers>> {
  const out = new Map<string, Layers>();
  if (!python || !files.length) return out;
  const pxDir = path.join(episodeDir, "assets", "px");
  await fs.mkdir(pxDir, { recursive: true });
  const jobs = files.map((f, i) => ({
    src: path.join(episodeDir, f),
    prefix: path.join(
      pxDir,
      `${i}_${path.basename(f).replace(/\.[^.]+$/, "")}`,
    ),
  }));
  const jobsFile = path.join(pxDir, "jobs.json");
  const resultFile = path.join(pxDir, "result.json");
  await fs.writeFile(jobsFile, JSON.stringify(jobs));
  try {
    await run(python, ["-I", SCRIPT, jobsFile, resultFile], {
      timeout: 30 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    const r = JSON.parse(await fs.readFile(resultFile, "utf8")) as {
      done: Array<{ src: string; bg: string; mid: string; fg: string; fgx?: number }>;
      skipped: Array<{ src: string; why: string }>;
    };
    const rel = (p: string) =>
      path.relative(episodeDir, p).split(path.sep).join("/");
    for (const d of r.done)
out.set(rel(d.src), { bg: rel(d.bg), mid: rel(d.mid), fg: rel(d.fg), fgx: d.fgx });
    log("info", "parallax layers", {
      made: r.done.length,
      skipped: r.skipped.length,
    });
  } catch (err) {
    log("warn", "parallax layers failed; stills stay flat", {
      error: errorMessage(err),
    });
  } finally {
    await fs.rm(jobsFile, { force: true }).catch(() => undefined);
    await fs.rm(resultFile, { force: true }).catch(() => undefined);
  }
  return out;
}
