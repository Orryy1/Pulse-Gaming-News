// How good a picture looks, by Apple's own judge on the Mac mini (APPLE_AESTHETICS, 12 Nov 2026): Vision's
// aesthetics score (macOS 15+, the one Photos uses for its best shots) ranks candidate pictures for the Short's
// opening frame (src/render/plan.ts pickHero), its designed search tile (src/shortthumb.ts) and other covers.
// Runs src/assets/appleaesthetics.py through the Python that reads picture text (MAC_OCR_PYTHON). Off, anywhere
// but the Mac, or on any failure, it scores nothing and every choice is made as before.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage, log } from "../lib/util.ts";
import { MAC_OCR_PYTHON } from "./ocr.ts";

const run = promisify(execFile);
const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "appleaesthetics.py",
);

export interface Aesthetics {
  /** -1 (poor) to 1 (striking). */
  score: number;
  /** A document, receipt or screen grab rather than a scene: never a cover. */
  utility: boolean;
}

/** The command for one scoring run on this machine; undefined off the Mac. */
export function aestheticsCommand(
  platform: string,
  list: string,
  python = MAC_OCR_PYTHON,
): { cmd: string; args: string[] } | undefined {
  if (platform !== "darwin") return undefined;
  return { cmd: python, args: ["-I", SCRIPT, list] };
}

/** appleaesthetics.py's output, by file; pictures it could not score are left out. */
export function parseAesthetics(raw: string): Map<string, Aesthetics> {
  const out = new Map<string, Aesthetics>();
  const body = JSON.parse(raw) as {
    results?: Array<{
      file: string;
      score?: number;
      utility?: boolean;
      error?: string;
    }>;
  };
  for (const r of body.results ?? []) {
    if (r.error || typeof r.score !== "number" || !Number.isFinite(r.score))
      continue;
    out.set(r.file, { score: r.score, utility: r.utility === true });
  }
  return out;
}

/** A cover's worth (pure): the score, with a screen grab or document pushed below every scene. */
export function coverWorth(a: Aesthetics | undefined): number | undefined {
  if (!a) return undefined;
  return a.utility ? a.score - 2 : a.score;
}

/**
 * Candidates best first (pure). Unscored pictures keep their order after the scored ones. With `group` (the clip or
 * source a frame came from), the first pass takes each group's best once, so near-identical neighbours from one
 * shot do not fill the top of the list.
 */
export function rankByAesthetics<T>(
  items: T[],
  scoreOf: (item: T) => number | undefined,
  group?: (item: T) => string,
): T[] {
  const scored = items
    .map((item, i) => ({ item, i, s: scoreOf(item) }))
    .filter((x): x is { item: T; i: number; s: number } => x.s !== undefined)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const rest = items.filter((item) => scoreOf(item) === undefined);
  if (!group) return [...scored.map((x) => x.item), ...rest];
  const first: T[] = [];
  const later: T[] = [];
  const seen = new Set<string>();
  for (const x of scored) {
    const g = group(x.item);
    (seen.has(g) ? later : first).push(x.item);
    seen.add(g);
  }
  return [...first, ...later, ...rest];
}

let warned = false;

/**
 * Scores for the given pictures (absolute paths), or an empty map when the setting is off, off the Mac, under test,
 * or on any failure. One run for the whole list: about 25 ms a picture on the M4.
 */
export async function scoreAesthetics(
  enabled: boolean,
  files: string[],
): Promise<Map<string, Aesthetics>> {
  if (
    !enabled ||
    !files.length ||
    process.platform !== "darwin" ||
    process.env.NODE_TEST_CONTEXT
  )
    return new Map();
  const list = path.join(
    os.tmpdir(),
    `pulse-aesthetics-${process.pid}-${Date.now()}.json`,
  );
  const command = aestheticsCommand(process.platform, list);
  if (!command) return new Map();
  try {
    await fs.writeFile(list, JSON.stringify(files));
    const { stdout } = await run(command.cmd, command.args, {
      timeout: 60_000 + files.length * 2_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseAesthetics(stdout);
  } catch (err) {
    if (!warned) {
      warned = true;
      log(
        "warn",
        "Apple aesthetics scoring failed; pictures are chosen as before",
        {
          error: errorMessage(err),
        },
      );
    }
    return new Map();
  } finally {
    await fs.rm(list, { force: true }).catch(() => undefined);
  }
}
