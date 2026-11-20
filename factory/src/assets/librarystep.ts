// The pipeline's two touch points for the newer picture libraries (src/assets/libraries.ts, press.ts, stock.ts),
// kept here so src/pipeline.ts only calls them:
//   pressForShort: a news Short's publisher press pictures (LIBRARY_PRESS), downloaded, measured and kept only
//     when large enough for the frame; they lead the Short like the newsroom images of an official story.
//   reportLibraries: what the libraries gave a video, in the episode log ("libraries") and in the owner's
//     evening note, so nothing they add to what the channel publishes goes unseen.

import fs from "node:fs/promises";
import path from "node:path";
import type { CommonsImage } from "./commons.ts";
import type { VisualAsset } from "./steam.ts";
import { librariesNote, librarySummary, photoProvenance } from "./libraries.ts";
import { shortHash } from "./repeats.ts";
import { logEvent } from "../episodes.ts";
import type { Db } from "../db.ts";
import { errorMessage, log } from "../lib/util.ts";
import { probe } from "../qa/media.ts";

/** A picture narrower than this is not used: it would be upscaled across a 1080 px frame. */
export const PRESS_MIN_WIDTH = 1000;

export interface PressDeps {
  searchPress?(game: string): Promise<CommonsImage[]>;
  downloadPhoto(img: CommonsImage, dest: string): Promise<boolean>;
  /** Width and height of a downloaded picture (default: ffprobe). */
  measure?(file: string): Promise<{ width?: number; height?: number }>;
}

/** Whether a downloaded press picture is usable: big enough, and landscape or square enough to frame. */
export function pressUsable(
  width: number | undefined,
  height: number | undefined,
): boolean {
  if (!width || !height) return false;
  return (
    width >= PRESS_MIN_WIDTH && width / height >= 0.9 && width / height <= 2.6
  );
}

/**
 * Up to `max` press pictures of a Short's game (kind "article", as the newsroom images of an official story
 * are), skipping any already in the Short. Never throws: a press site that fails gives nothing.
 */
export async function pressForShort(
  deps: PressDeps,
  dir: string,
  game: string,
  have: Set<string>,
  max = 3,
  sub = "assets",
): Promise<VisualAsset[]> {
  if (!deps.searchPress || !game.trim()) return [];
  const out: VisualAsset[] = [];
  try {
    const found = (await deps.searchPress(game)).filter(
      (i) => !have.has(i.url),
    );
    await fs.mkdir(path.join(dir, sub), { recursive: true });
    for (const img of found) {
      if (out.length >= max) break;
      const file = path.join(sub, `press_${shortHash(img.url)}.jpg`);
      const abs = path.join(dir, file);
      if (!(await deps.downloadPhoto(img, abs).catch(() => false))) continue;
      const size = await (deps.measure ?? probe)(abs).catch(
        () => ({}) as { width?: number; height?: number },
      );
      if (!pressUsable(size.width, size.height)) {
        await fs.rm(abs, { force: true }).catch(() => undefined);
        continue;
      }
      out.push({
        kind: "article",
        file,
        sourceUrl: img.url,
        provenance: photoProvenance(img),
        width: size.width,
        height: size.height,
      });
    }
  } catch (err) {
    log("warn", "press pictures failed", { game, error: errorMessage(err) });
  }
  return out;
}

/** Logs and notes what the newer libraries supplied a video; nothing when they supplied nothing. */
export async function reportLibraries(
  s: {
    db: Db;
    notify(m: { level: "info"; content: string }): Promise<unknown>;
  },
  episodeId: string,
  what: string,
  images: Array<{ kind: string; provenance?: string; moment?: number }>,
  clips: Array<{ provenance?: string; moment?: number }>,
): Promise<Record<string, number>> {
  const counts = librarySummary(images, clips);
  const note = librariesNote(what, counts);
  if (!note) return counts;
  await logEvent(s.db, episodeId, "libraries", counts).catch(() => undefined);
  await s.notify({ level: "info", content: note }).catch(() => undefined);
  return counts;
}
