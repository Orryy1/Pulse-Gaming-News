// Meaning-based matching (MATCH_SEMANTIC, 20 Nov 2026; owner on a GTA 6 Short: the footage "had nothing to do with the
// script"). The gatherers matched pictures to lines by the names they share, so a line about a phone app that brings
// your car got a controller press shot because both said "GTA 6". A picture-and-words model (SigLIP 2, src/semantic/
// embed.py) puts a line and a picture in one space, so the factory can ask what the line is ABOUT and which picture
// shows that. This file is the arithmetic and the choosing (pure). It never widens what may be shown: every candidate
// has already passed the right-game, spoiler, footage-cap, face and picture rules before it gets here, and a caller's
// `allowed` can veto any pairing.

/** What the model said about itself: its vector size and the sigmoid it was trained with. */
export interface EmbedInfo {
  model: string;
  dim: number;
  scale: number;
  bias: number;
}

/** A unit vector from the embedder's base64 float32 bytes (pure). */
export function fromBase64(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

export function toBase64(v: Float32Array): string {
  const buf = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) buf.writeFloatLE(v[i]!, i * 4);
  return buf.toString("base64");
}

/** The cosine of two unit vectors (their dot product); 0 when the sizes differ. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** The mean of unit vectors, made unit again (a line and its shot note asked together). */
export function meanVector(vs: Float32Array[]): Float32Array | undefined {
  const xs = vs.filter((v) => v.length);
  if (!xs.length) return undefined;
  const out = new Float32Array(xs[0]!.length);
  for (const v of xs)
    if (v.length === out.length)
      for (let i = 0; i < out.length; i++) out[i]! += v[i]!;
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i]! * out[i]!;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i]! /= n;
  return out;
}

/** The model's own probability that a picture shows the words (SigLIP's sigmoid; pure). */
export function probability(
  cos: number,
  info: Pick<EmbedInfo, "scale" | "bias">,
): number {
  return 1 / (1 + Math.exp(-(info.scale * cos + info.bias)));
}

/**
 * The meaning score of each candidate for one line, 0 to 1 (pure). SigLIP's raw cosines for a game picture against a
 * spoken sentence are small and shift from line to line (measured 20 Nov 2026 on GTA VI's 2,097 indexed shots: the
 * median sits between 0.00 and 0.10 depending on the line, the top 1% about 0.05 above it, the best shot 0.06 to 0.14
 * above it), so the score is relative: how far the candidate's cosine sits above the line's typical picture, against
 * SPREAD. The typical picture is the pool's median when the pool is big enough to have one (MIN_POOL), else `base`
 * (the line's median over a background set, such as the game's scene index), else the floor. A cosine at or under
 * FLOOR (no likeness at all) scores 0 however it ranks.
 */
export const SEMANTIC_FLOOR = 0;
export const SEMANTIC_SPREAD = 0.1;
export const MIN_POOL = 20;

export function lineScores(
  cosines: readonly number[],
  o: { floor?: number; spread?: number; base?: number } = {},
): number[] {
  const floor = o.floor ?? SEMANTIC_FLOOR;
  const spread = o.spread ?? SEMANTIC_SPREAD;
  if (!cosines.length) return [];
  const sorted = [...cosines].sort((a, b) => a - b);
  // The lower middle: in a pool of two the weaker one is the typical picture, not the stronger.
  const median = sorted[Math.floor((sorted.length - 1) / 2)]!;
  const typical =
    cosines.length >= MIN_POOL ? median : (o.base ?? Math.max(floor, median));
  const base = Math.max(floor, typical);
  return cosines.map((c) =>
    c <= floor ? 0 : Math.max(0, Math.min(1, (c - base) / spread)),
  );
}

export interface Assignment {
  line: number;
  candidate: number;
  score: number;
  cosine: number;
}

export interface AssignOptions {
  /** A pairing is made only from this meaning score up (0-1). */
  minScore?: number;
  /** The winner must beat the line's next best candidate by this much, or the line is left to the other rules. */
  margin?: number;
  /** How many lines one candidate may serve (a still twice, a clip once). */
  uses?: (candidate: number) => number;
  /** Any rule the caller keeps (right game, spoiler window, footage cap, faces): false vetoes the pairing. */
  allowed?: (line: number, candidate: number) => boolean;
  /** Lines already served by the older rules: never reassigned here. */
  taken?: ReadonlySet<number>;
  /** A line's typical cosine over a background set, for pools too small to have their own (lineScores). */
  base?: (line: number) => number | undefined;
}

/**
 * Which candidate each line gets (pure): the strongest pairings first across the whole video, each candidate used at
 * most `uses` times, a line only when its best is clearly its best (margin) and strong enough (minScore). Lines the
 * model is unsure of are left alone: the older rules (and the chapter's general footage) carry them as before.
 */
export function assign(
  sims: readonly (readonly number[])[],
  o: AssignOptions = {},
): Assignment[] {
  const minScore = o.minScore ?? 0.5;
  const margin = o.margin ?? 0.1;
  const scores = sims.map((row, line) => lineScores(row, { base: o.base?.(line) }));
  const pairs: Array<Assignment & { gap: number }> = [];
  scores.forEach((row, line) => {
    if (o.taken?.has(line)) return;
    const allowedIdx = row
      .map((_, c) => c)
      .filter((c) => !o.allowed || o.allowed(line, c));
    const ranked = allowedIdx.sort((a, b) => row[b]! - row[a]!);
    for (const [k, c] of ranked.entries()) {
      const next = ranked[k + 1];
      pairs.push({
        line,
        candidate: c,
        score: row[c]!,
        cosine: sims[line]![c]!,
        // Against the line's best other candidate: a near-tie means the model cannot tell them apart.
        gap:
          row[c]! -
          (k === 0 ? (next === undefined ? 0 : row[next]!) : row[ranked[0]!]!),
      });
    }
  });
  pairs.sort((a, b) => b.score - a.score || b.cosine - a.cosine);
  const used = new Map<number, number>();
  const done = new Set<number>();
  const out: Assignment[] = [];
  for (const p of pairs) {
    if (done.has(p.line) || p.score < minScore) continue;
    const cap = o.uses ? o.uses(p.candidate) : 1;
    if ((used.get(p.candidate) ?? 0) >= cap) continue;
    // Only a clear winner among what is still free for this line.
    const rivals = pairs.filter(
      (q) =>
        q.line === p.line &&
        q.candidate !== p.candidate &&
        (used.get(q.candidate) ?? 0) < (o.uses ? o.uses(q.candidate) : 1),
    );
    const best = rivals.reduce((m, q) => Math.max(m, q.score), 0);
    if (p.score - best < margin) continue;
    used.set(p.candidate, (used.get(p.candidate) ?? 0) + 1);
    done.add(p.line);
    out.push({
      line: p.line,
      candidate: p.candidate,
      score: Math.round(p.score * 1000) / 1000,
      cosine: Math.round(p.cosine * 10000) / 10000,
    });
  }
  return out.sort((a, b) => a.line - b.line);
}

/**
 * A word-matching score blended with the meaning score (pure). The meaning score counts as much as WEIGHT of the
 * word score's scale, so a shot the words found and the model agrees with rises to the top, a shot only the words
 * found (a name said over an unrelated picture) sinks, and a shot only the model found can still be offered.
 */
export const SEMANTIC_WEIGHT = 0.6;

export function blend(
  word: number,
  meaning: number | undefined,
  weight = SEMANTIC_WEIGHT,
): number {
  if (meaning === undefined) return word;
  return (1 - weight) * word + weight * meaning;
}

/** The text asked of the model for a line: its words, and the writer's shot note when there is one (pure). */
export function lineQuery(sentence: string, note?: string): string[] {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const out = [clean(sentence)].filter(Boolean);
  const n = clean(note ?? "");
  if (n && n.toLowerCase() !== out[0]?.toLowerCase()) out.push(n);
  return out;
}
