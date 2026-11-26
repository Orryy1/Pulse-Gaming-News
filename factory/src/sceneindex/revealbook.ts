// The reveal book (owner, 26 Nov 2026, "Early story free" for GTA VI): for one scene index, which stretches of its
// upload show or tell a big reveal (a character's death, a twist, a betrayal, the ending, a major identity reveal)
// and which are safe. Written beside the index as reveals.json by the reveal classifier (src/sceneindex/reveals.ts)
// and read here by the spoiler guard (src/sceneindex/spoilers.ts footageAllowed and streamClipHold). Pure apart from
// the small cached reader at the end, which the server points at its data folder each pass.

import fsSync from "node:fs";
import path from "node:path";
import { sceneIndexDir, type SceneIndex } from "./schema.ts";

export const REVEAL_BOOK_VERSION = 1;

export type RevealKind = "death" | "twist" | "betrayal" | "ending" | "identity";

export interface RevealScene {
  /** Seconds into the index's upload; scenes are contiguous and in order. */
  start: number;
  end: number;
  /** A fingerprint of the words the scene was judged on: new descriptions or lines make it be judged again. */
  hash: string;
  reveal: boolean;
  kind?: RevealKind;
  /** "rules": a spoiling phrase in its own words; "model": the classifier; "pending": not judged yet (counts as a reveal). */
  by: "rules" | "model" | "pending";
  why: string;
}

export interface RevealBook {
  version: number;
  game: string;
  /** The upload the scenes belong to: a book for another upload says nothing about this one. */
  videoId: string;
  sceneSeconds: number;
  madeAt: string;
  scenes: RevealScene[];
}

export function revealsFile(dataDir: string, game: string): string {
  return path.join(sceneIndexDir(dataDir, game), "reveals.json");
}

/** A stored book, or undefined when it is not one this code can read. */
export function parseRevealBook(raw: unknown): RevealBook | undefined {
  const b = raw as RevealBook | null;
  if (
    !b ||
    b.version !== REVEAL_BOOK_VERSION ||
    typeof b.videoId !== "string" ||
    !Array.isArray(b.scenes)
  )
    return undefined;
  const scenes = b.scenes.filter(
    (s) =>
      s &&
      Number.isFinite(s.start) &&
      Number.isFinite(s.end) &&
      s.end > s.start &&
      typeof s.reveal === "boolean",
  );
  return { ...b, scenes };
}

/** The scene of the book that holds a moment (pure), or undefined. */
export function revealSceneAt(
  book: RevealBook | undefined,
  index: Pick<SceneIndex, "source">,
  at: number,
): RevealScene | undefined {
  if (!book || book.videoId !== index.source.videoId || !Number.isFinite(at))
    return undefined;
  const last = book.scenes[book.scenes.length - 1];
  return (
    book.scenes.find((s) => at >= s.start && at < s.end) ??
    (last && at === last.end ? last : undefined)
  );
}

/**
 * Whether a moment of an index is a big reveal (pure): true for a reveal or a stretch not judged yet (unsure counts
 * as a reveal), false for a safe one, undefined when there is no book for this upload or it does not reach the moment.
 */
export function revealAt(
  book: RevealBook | undefined,
  index: Pick<SceneIndex, "source">,
  at: number,
): boolean | undefined {
  const s = revealSceneAt(book, index, at);
  if (!s) return undefined;
  return s.by === "pending" ? true : s.reveal;
}

// ---------------------------------------------------------------- the live books

let dataDir: string | undefined;
const cache = new Map<string, { at: number; book?: RevealBook }>();
const TTL = 60_000;

/** The server's data folder (gamefetch's pass, SPOILER_GUARD on); undefined turns the live lookups off. */
export function setRevealDir(dir: string | undefined): void {
  if (dir !== dataDir) cache.clear();
  dataDir = dir;
}

/** Forgets the books read so far (after the classifier writes one). */
export function forgetRevealBooks(): void {
  cache.clear();
}

/** The live book of an index, read at most once a minute; undefined when there is none or no data folder is set. */
export function liveRevealBook(game: string): RevealBook | undefined {
  if (!dataDir) return undefined;
  const hit = cache.get(game);
  const now = Date.now();
  if (hit && now - hit.at < TTL) return hit.book;
  let book: RevealBook | undefined;
  try {
    book = parseRevealBook(
      JSON.parse(fsSync.readFileSync(revealsFile(dataDir, game), "utf8")),
    );
  } catch {
    book = undefined;
  }
  cache.set(game, { at: now, book });
  return book;
}
