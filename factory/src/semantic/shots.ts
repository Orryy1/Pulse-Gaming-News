// Meaning vectors for every shot of a scene index or a stream index (MATCH_SEMANTIC, VOD_TAGS). One frame from the
// middle of each clean shot is cut from the index's proxy (or the recording) by ffmpeg in a child process, embedded
// once and kept beside the index: <index dir>/semantic.<model>.json, keyed by the shot's start and end (shot ids move
// when a stretch is re-indexed, times do not). A line's vector is then compared with every shot's: the shots that show
// what the line is about score high, whatever words their descriptions happen to use.

import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "../lib/bin.ts";
import { runCapped } from "../lib/child.ts";
import { errorMessage, log } from "../lib/util.ts";
import { modelSlug, type Embedder } from "./embed.ts";
import {
  cosine,
  fromBase64,
  lineQuery,
  lineScores,
  meanVector,
  toBase64,
} from "./match.ts";

export interface ShotLike {
  id: number;
  start: number;
  end: number;
  blank?: boolean;
  menu?: boolean;
}

/** A shot's key in the vector file (pure). */
export const shotKey = (s: Pick<ShotLike, "start" | "end">) =>
  `${s.start.toFixed(2)}|${s.end.toFixed(2)}`;

export const vectorFile = (indexDir: string, model: string) =>
  path.join(indexDir, `semantic.${modelSlug(model)}.json`);

export async function loadShotVectors(
  file: string,
): Promise<Map<string, Float32Array>> {
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as {
      shots?: Record<string, string>;
    };
    return new Map(
      Object.entries(raw.shots ?? {}).map(([k, v]) => [k, fromBase64(v)]),
    );
  } catch {
    return new Map();
  }
}

/** Shots tried and not embeddable (their frame could not be cut or read): counted as done, never retried for ever. */
export async function loadFailedShots(file: string): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as { failed?: string[] };
    return new Set(Array.isArray(raw.failed) ? raw.failed.map(String) : []);
  } catch {
    return new Set();
  }
}

async function saveShotVectors(
  file: string,
  model: string,
  vecs: Map<string, Float32Array>,
  failed: ReadonlySet<string> = new Set(),
): Promise<void> {
  const shots: Record<string, string> = {};
  for (const [k, v] of vecs) shots[k] = toBase64(v);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ model, shots, failed: [...failed] }));
  await fs.rename(tmp, file);
}

/** The clean shots still without a vector (pure). */
export function unembedded<T extends ShotLike>(
  shots: readonly T[],
  vecs: ReadonlyMap<string, Float32Array>,
  failed: ReadonlySet<string> = new Set(),
): T[] {
  return shots.filter(
    (s) =>
      !s.blank &&
      !s.menu &&
      s.end - s.start >= 0.5 &&
      !vecs.has(shotKey(s)) &&
      !failed.has(shotKey(s)),
  );
}

/**
 * Embeds up to `limit` shots not yet embedded and keeps their vectors. `video` is the index's proxy or the recording;
 * the frame is cut at the middle of the shot, 384 pixels wide (the model sees 224). Saves every 200 shots, so a long
 * index can be done over several turns.
 */
export async function embedShots(o: {
  shots: readonly ShotLike[];
  video: string;
  vectorsFile: string;
  embedder: Embedder;
  model: string;
  work: string;
  limit?: number;
  /** Epoch ms after which no new batch is started (a stream-index slice's turn is nearly over). */
  until?: number;
  grab?: (video: string, at: number, file: string) => Promise<void>;
}): Promise<{ added: number; total: number; left: number }> {
  const vecs = await loadShotVectors(o.vectorsFile);
  const failed = await loadFailedShots(o.vectorsFile);
  const todo = unembedded(o.shots, vecs, failed);
  const batch = todo.slice(0, o.limit ?? todo.length);
  if (!batch.length) return { added: 0, total: vecs.size, left: 0 };
  const dir = await fs.mkdtemp(path.join(o.work, "semshots_"));
  const grab =
    o.grab ??
    (async (video: string, at: number, file: string) => {
      await runCapped(
        FFMPEG,
        [
          "-loglevel",
          "error",
          "-y",
          "-ss",
          at.toFixed(2),
          "-i",
          video,
          "-frames:v",
          "1",
          "-vf",
          "scale=384:-2",
          "-q:v",
          "4",
          file,
        ],
        { timeout: 60_000, maxBuffer: 1024 * 1024 },
      );
    });
  let added = 0;
  try {
    for (let b = 0; b < batch.length; b += 64) {
      if (o.until !== undefined && b > 0 && Date.now() > o.until) break;
      const chunk = batch.slice(b, b + 64);
      const files: string[] = [];
      const kept: ShotLike[] = [];
      for (const s of chunk) {
        const f = path.join(dir, `s_${s.id}.jpg`);
        try {
          await grab(o.video, (s.start + s.end) / 2, f);
          files.push(f);
          kept.push(s);
        } catch (err) {
          failed.add(shotKey(s));
          log("info", "semantic: shot frame not cut", {
            at: s.start,
            error: errorMessage(err),
          });
        }
      }
      if (!files.length) {
        await saveShotVectors(o.vectorsFile, o.model, vecs, failed);
        continue;
      }
      // Keyed by the shot, not the frame's bytes: the frame is thrown away.
      const got = await o.embedder.images(
        files,
        kept.map((s) =>
          `shot-${shotKey(s)}-${path.basename(o.video)}`.replace(
            /[^\w.-]/g,
            "_",
          ),
        ),
      );
      if (got.every((v) => !v)) break; // the model is down: the rest waits
      got.forEach((v, i) => {
        if (v) {
          vecs.set(shotKey(kept[i]!), v);
          added++;
        } else failed.add(shotKey(kept[i]!)); // the model answered for the others: this frame cannot be read
      });
      for (const f of files)
        await fs.rm(f, { force: true }).catch(() => undefined);
      if (added && (b / 64) % 3 === 2)
        await saveShotVectors(o.vectorsFile, o.model, vecs, failed);
    }
    if (added || failed.size) await saveShotVectors(o.vectorsFile, o.model, vecs, failed);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return { added, total: vecs.size, left: unembedded(o.shots, vecs, failed).length };
}

/**
 * Each shot's meaning score for one line (pure): its cosine with the line's vector, made relative across every shot
 * of the index (lineScores). Shots with no vector are left out of the map, so the words alone judge them.
 */
export function shotMeaning(
  shots: readonly ShotLike[],
  vecs: ReadonlyMap<string, Float32Array>,
  query: Float32Array,
): Map<number, number> {
  const ids: number[] = [];
  const cos: number[] = [];
  for (const s of shots) {
    if (s.blank || s.menu) continue;
    const v = vecs.get(shotKey(s));
    if (!v) continue;
    ids.push(s.id);
    cos.push(cosine(v, query));
  }
  const scores = lineScores(cos);
  return new Map(ids.map((id, i) => [id, scores[i]!]));
}

/**
 * A scorer for footage targets against one index: each target's text (and its keywords, the writer's shot note)
 * embedded once, then compared with the index's shot vectors. Undefined when the index has no vectors yet or the model
 * is down, so the caller falls back to the words.
 */
export async function targetScorer(
  embedder: Embedder,
  shots: readonly ShotLike[],
  vecs: ReadonlyMap<string, Float32Array>,
  targets: ReadonlyArray<{ key: string; text: string; keywords?: string[] }>,
): Promise<
  ((t: { key: string }) => Map<number, number> | undefined) | undefined
> {
  if (!vecs.size || !targets.length) return undefined;
  const asks = targets.map((t) =>
    lineQuery(t.text, (t.keywords ?? []).join(", ")),
  );
  const flat = asks.flat();
  const got = await embedder.texts(flat);
  if (!got) return undefined;
  const byKey = new Map<string, Map<number, number>>();
  let at = 0;
  for (const [i, t] of targets.entries()) {
    const q = meanVector(got.slice(at, at + asks[i]!.length));
    at += asks[i]!.length;
    if (q) byKey.set(t.key, shotMeaning(shots, vecs, q));
  }
  return (t) => byKey.get(t.key);
}
