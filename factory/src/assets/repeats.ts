// Repeats a viewer notices across one long video (31 Oct 2026, the owner on the Vice City documentary: "what's
// with the constant repeated random property photos"). Two causes live here, as pure rules:
//  - generic stock came back theme after theme: "office at night" 7 times, "people queueing at shop" 6,
//    "counting cash" 5, "game developers at desks" 5 out of 57 clips. A video now takes at most a couple of clips
//    per theme; past that the sentence goes to the graphics pass or stays on the chapter's game footage.
//  - the sentence top-up (src/assets/fill.ts) named its downloads from 0 on every run, so a second run wrote new
//    clips over the first run's files and the episode listed one file twice with two different labels. Files
//    are now named by what they hold or by the next free name, and the repair keeps only the entry whose file
//    is the one on disk.
// The real-world photo rule (photos only on their own sentence) is in src/render/longplan.ts (realWorldImage).

import { createHash } from "node:crypto";

const THEME_STOP = new Set([
  "a",
  "an",
  "the",
  "at",
  "of",
  "in",
  "on",
  "with",
  "and",
  "to",
  "for",
  "by",
  "from",
  "near",
  "into",
  "over",
]);

/** One word as a theme counts it: lower case, singular, the "-ing" form folded ("counting" is "count"). */
export function themeWord(w: string): string {
  let t = w.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (/(ss|sh|ch|x)es$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss"))
    t = t.slice(0, -1);
  return t;
}

/** A stock search's theme: its telling words, normalised ("Game developers at desks" -> game, developer, desk). */
export function stockTheme(query: string): string[] {
  return [
    ...new Set(
      query
        .split(/\s+/)
        .map(themeWord)
        .filter((w) => w && !THEME_STOP.has(w)),
    ),
  ];
}

/**
 * Whether two stock searches are one theme to a viewer: they share most of the smaller one's words, at least two
 * of them (or its only word). "game developers at desks" and "game developers working" are one theme; "office
 * at night" and "office building windows" are not.
 */
export function sameStockTheme(a: string, b: string): boolean {
  const x = stockTheme(a);
  const y = new Set(stockTheme(b));
  if (!x.length || !y.size) return false;
  const shared = x.filter((w) => y.has(w)).length;
  const small = Math.min(x.length, y.size);
  return shared >= Math.min(2, small) && shared / small >= 0.6;
}

/** How many of the given themes are the same theme as `query`. */
export function themeCount(query: string, themes: string[]): number {
  return themes.filter((t) => sameStockTheme(query, t)).length;
}

/**
 * The stock searches a video may still make: each one only while fewer than `max` clips of its theme are
 * already in the video (counting stock clips by their label, which is their search) or kept earlier in this
 * list. `query` turns a target into its search (stockQuery). Order is kept; the rest are returned as dropped.
 */
export function capStockTargets<T>(
  targets: T[],
  existing: Array<{ stock?: unknown; label?: unknown } | Record<string, unknown>>,
  query: (t: T) => string,
  max: number,
): { kept: T[]; dropped: T[] } {
  const themes = (existing as Array<{ stock?: unknown; label?: unknown }>)
    .filter((c) => c.stock && typeof c.label === "string" && c.label.trim())
    .map((c) => c.label as string);
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const t of targets) {
    const q = query(t);
    if (max > 0 && q && themeCount(q, themes) >= max) {
      dropped.push(t);
      continue;
    }
    kept.push(t);
    if (q) themes.push(q);
  }
  return { kept, dropped };
}

/** The stock clips a video keeps under the cap, in order (the first `max` of each theme); for audits and tests. */
export function capStockClips<C extends { stock?: unknown; label?: unknown }>(
  clips: C[],
  max: number,
): C[] {
  const themes: string[] = [];
  return clips.filter((c) => {
    if (!c.stock || typeof c.label !== "string" || !c.label.trim()) return true;
    if (max > 0 && themeCount(c.label, themes) >= max) return false;
    themes.push(c.label);
    return true;
  });
}

/** A path as Windows compares it: one slash style, any case. */
export const samePath = (p: string) => p.replace(/\\/g, "/").toLowerCase();

/** A short stable name for a download, from what identifies it (its source page or URL). */
export function shortHash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 10);
}

/**
 * `${base}${ext}`, or `${base}-2${ext}`, `-3` and so on: the first name no file already takes. `taken` holds
 * names compared with samePath (the files in the folder, and the names chosen so far).
 */
export function freeName(
  base: string,
  ext: string,
  taken: Set<string>,
): string {
  const has = (n: string) => taken.has(samePath(n));
  if (!has(`${base}${ext}`)) return `${base}${ext}`;
  for (let k = 2; ; k++)
    if (!has(`${base}-${k}${ext}`)) return `${base}-${k}${ext}`;
}

/** File paths more than one clip points to (each listed once, as first written). */
export function duplicateFiles(clips: Array<{ file?: unknown }>): string[] {
  const seen = new Map<string, number>();
  const first = new Map<string, string>();
  for (const c of clips) {
    if (typeof c.file !== "string") continue;
    const k = samePath(c.file);
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (!first.has(k)) first.set(k, c.file);
  }
  return [...seen].filter(([, n]) => n > 1).map(([k]) => first.get(k)!);
}

/**
 * The clips with each file path once: of two entries for one file the later is kept, since a later run wrote
 * that file last and what is on disk is its clip. Everything else keeps its place.
 */
export function keepLatestPerFile<C extends { file?: unknown }>(
  clips: C[],
): C[] {
  const last = new Map<string, number>();
  clips.forEach((c, i) => {
    if (typeof c.file === "string") last.set(samePath(c.file), i);
  });
  return clips.filter(
    (c, i) => typeof c.file !== "string" || last.get(samePath(c.file)) === i,
  );
}

type Placed = { beatIndex?: unknown; moment?: unknown };

/** Stock clips grouped by theme: each joins the first group whose first search is the same theme. */
export function stockThemeGroups<C extends { stock?: unknown; label?: unknown }>(
  clips: C[],
): Array<{ theme: string; members: number[] }> {
  const groups: Array<{ theme: string; members: number[] }> = [];
  clips.forEach((c, i) => {
    if (!c.stock || typeof c.label !== "string" || !c.label.trim()) return;
    const g = groups.find((x) => sameStockTheme(x.theme, c.label as string));
    if (g) g.members.push(i);
    else groups.push({ theme: c.label, members: [i] });
  });
  return groups;
}

/**
 * Trims a video's existing stock to `max` clips per theme (the Vice City repair). Within a theme the clips
 * kept are first those whose sentence has no other picture or clip of its own (dropping them would leave the
 * line bare), then the earliest in the video (chapter, then sentence). Repeated until no theme is over, so a
 * second run drops nothing. A dropped clip's sentence is left for the graphics pass; the order of what is kept
 * does not change.
 */
export function trimStockThemes<C extends Placed & { stock?: unknown; label?: unknown }>(
  clips: C[],
  images: Placed[],
  max: number,
): { kept: C[]; dropped: C[] } {
  let kept = [...clips];
  const dropped: C[] = [];
  if (max <= 0) return { kept, dropped };
  for (;;) {
    const out = new Set<number>();
    for (const g of stockThemeGroups(kept)) {
      if (g.members.length <= max) continue;
      const sole = (i: number) => {
        const c = kept[i]!;
        if (c.moment === undefined) return false;
        const same = (x: Placed) => x.beatIndex === c.beatIndex && x.moment === c.moment;
        return !images.some(same) && !kept.some((x, k) => k !== i && !out.has(k) && same(x));
      };
      const at = (i: number) => [Number(kept[i]!.beatIndex ?? 1e9), Number(kept[i]!.moment ?? 1e9), i];
      const order = [...g.members].sort((x, y) => {
        const s = Number(sole(y)) - Number(sole(x));
        if (s) return s;
        const [a, b] = [at(x), at(y)];
        return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
      });
      for (const i of order.slice(max)) out.add(i);
    }
    if (!out.size) return { kept, dropped };
    dropped.push(...kept.filter((_, i) => out.has(i)));
    kept = kept.filter((_, i) => !out.has(i));
  }
}
