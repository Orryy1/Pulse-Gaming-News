/**
 * Documentary chapter checkpoints (DOC_CHAPTER_CHECKPOINT, on by default).
 *
 * A documentary writes its outline and then each chapter in turn, about ten minutes a chapter. On 25 Nov 2026 the
 * Cyberpunk 2077 documentary (ep_20261125_87abc5a2) started its chapters over four times, because every factory
 * restart (16 that day) threw away the chapters already written, and it missed its 19:00 slot. The outline and every
 * finished chapter are now kept on disk as they are made, and a run of the same episode and topic picks up where the
 * last one stopped.
 *
 * Only a run that was cut off resumes. When the writing finishes, or fails after every chapter was written (a
 * script-level check, which a fresh draft may pass), the checkpoint is removed, so a failed script is written again
 * from the start rather than repeated. A checkpoint older than `maxAgeHours` is ignored.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DocDraft, DocOutline } from "./documentary.ts";
import type { OpenLoop } from "./openloops.ts";

export const DOC_CHECKPOINT_VERSION = 1;

export interface DocCheckpoint {
  version: number;
  episode: string;
  /** What the episode was asked to make; a different topic under the same id never resumes. */
  topicKey: string;
  savedAt: string;
  outline: DocOutline;
  openLoops: { loops: OpenLoop[]; removed: string[] };
  /** Outline indices already settled: written or dropped. */
  done: number[];
  chapters: DocDraft["chapters"];
  written: number[];
  droppedRefused: number[];
  warnings: string[];
  ruleRevisions: number;
}

export function docTopicKey(topic: {
  franchise: string;
  kind?: string;
  format?: string;
  wiki?: string;
  title_idea?: string;
  planned?: unknown;
  roster?: unknown;
}): string {
  // A re-planned entry under the same episode id (new chapters, roster or title) never resumes the old outline.
  const plan = createHash("sha1")
    .update(JSON.stringify([topic.title_idea ?? "", topic.planned ?? null, topic.roster ?? null]))
    .digest("hex")
    .slice(0, 12);
  return [topic.franchise, topic.kind ?? "", topic.format ?? "", topic.wiki ?? "", plan].join("|");
}

export function docCheckpointPath(dataDir: string, episode: string): string {
  return path.join(
    dataDir,
    "doc_checkpoints",
    `${episode.replace(/[^\w.-]/g, "_")}.json`,
  );
}

/** The checkpoint to resume from, or undefined when there is none, it is for another topic, too old or unreadable. */
export function loadDocCheckpoint(
  dataDir: string,
  episode: string,
  topicKey: string,
  now: Date,
  maxAgeHours: number,
): DocCheckpoint | undefined {
  const file = docCheckpointPath(dataDir, episode);
  let cp: DocCheckpoint;
  try {
    cp = JSON.parse(fs.readFileSync(file, "utf8")) as DocCheckpoint;
  } catch {
    return undefined;
  }
  if (
    !cp ||
    cp.version !== DOC_CHECKPOINT_VERSION ||
    cp.episode !== episode ||
    cp.topicKey !== topicKey ||
    !cp.outline ||
    !Array.isArray(cp.outline.chapters) ||
    !Array.isArray(cp.chapters) ||
    !Array.isArray(cp.done)
  )
    return undefined;
  const age = (now.getTime() - Date.parse(cp.savedAt)) / 3_600_000;
  if (!Number.isFinite(age) || age < 0 || age > maxAgeHours) return undefined;
  return cp;
}

/** Writes the checkpoint atomically (a temp file, then a rename), so a restart mid-write never leaves half a file. */
export function saveDocCheckpoint(dataDir: string, cp: DocCheckpoint): void {
  const file = docCheckpointPath(dataDir, cp.episode);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cp));
  fs.renameSync(tmp, file);
}

export function clearDocCheckpoint(dataDir: string, episode: string): void {
  try {
    fs.rmSync(docCheckpointPath(dataDir, episode), { force: true });
  } catch {
    // Nothing to remove.
  }
}

/** Removes checkpoints older than `maxAgeHours` (an episode that was abandoned never clears its own). */
export function pruneDocCheckpoints(
  dataDir: string,
  now: Date,
  maxAgeHours: number,
): number {
  const dir = path.join(dataDir, "doc_checkpoints");
  let removed = 0;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const age = (now.getTime() - fs.statSync(file).mtimeMs) / 3_600_000;
      if (age > maxAgeHours) {
        fs.rmSync(file, { force: true });
        removed++;
      }
    } catch {
      // Gone already.
    }
  }
  return removed;
}

/**
 * The kept chapters with each plan swapped back for the outline's own object (pure). A plan read from JSON is a copy,
 * and open loops are pinned to chapters by identity (placeDocLoops), so a copy would lose every loop it carries.
 */
export function relinkPlans(cp: Pick<DocCheckpoint, "chapters" | "written">, outline: DocOutline): DocDraft["chapters"] {
  return cp.chapters.map((c, k) => ({ ...c, plan: outline.chapters[cp.written[k]!] ?? c.plan }));
}
