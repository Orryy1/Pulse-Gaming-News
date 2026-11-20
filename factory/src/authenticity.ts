// Authenticity safeguards (owner, 1 Nov 2026). The main risk to an automated channel is YouTube's policy on
// repetitious, mass-produced content: many uploads that read as one template with the names swapped. The
// audit of the last 30 days (data/smoke/authenticity.mts on a database copy) found the risk in the words, not
// the disclosures: the synthetic-media flag is set on every narrated upload and every description says the
// narration is an AI voice, but deal titles were "<Game> Is $X Right Now, Plus 4 More Steam Deals" five times,
// ranking titles opened "Ranking EVERY" six times, and loop lines kept closing on the same "X, or Y?" fork.
//
// So the writers get one more house rule: a title or hook may not reuse a phrase (two or three words, the
// game's own name, platforms and figures set aside) that this many of the last 30 days' Shorts already used
// (REPEAT_MAX, 3; 0 turns it off). A draft that does is sent back once with the phrase named, like any other
// house-style miss, and kept with a warning if the rewrite repeats it too, so it never blocks a Short.

import type { Db } from "./db.ts";

/** Words that carry no shape of their own. */
const STOP = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "in",
  "on",
  "for",
  "and",
  "or",
  "is",
  "it",
  "its",
  "at",
  "by",
  "as",
  "with",
  "be",
  "are",
  "was",
  "this",
  "that",
  "from",
  "s",
  "you",
  "your",
]);
/** Platforms and stores: a news channel names them all the time, which is not a template. */
const PLATFORM = new Set([
  "ps5",
  "ps4",
  "playstation",
  "xbox",
  "series",
  "switch",
  "nintendo",
  "pc",
  "steam",
  "epic",
  "game",
  "pass",
]);

/** A line's words for shape: lowercased, possessives cut, figures as "#", the game's own words removed. */
export function shapeTokens(text: string, game = ""): string[] {
  const own = new Set(
    game
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9$.,' ]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.,']+|[.,']+$/g, ""))
    .filter((w) => w && !own.has(w))
    .map((w) => (/^\$?\d/.test(w) ? "#" : w.replace(/[^a-z0-9]/g, "")))
    .filter(Boolean);
}

/** The two- and three-word phrases of a line that could make a template: at least one word of substance. */
export function shapePhrases(text: string, game = ""): Set<string> {
  const t = shapeTokens(text, game);
  const out = new Set<string>();
  for (const n of [2, 3])
    for (let i = 0; i + n <= t.length; i++) {
      const run = t.slice(i, i + n);
      const real = run.filter(
        (w) => w !== "#" && !STOP.has(w) && !PLATFORM.has(w),
      );
      if (real.length >= (n === 2 ? 2 : 1)) out.add(run.join(" "));
    }
  return out;
}

export interface ShortText {
  title: string;
  hook: string;
  game: string;
}

/** Phrases of `line` that `max` or more of the recent lines already carry, most used first. */
export function repeatedPhrases(
  line: string,
  game: string,
  recent: Array<{ line: string; game: string }>,
  max: number,
): Array<{ phrase: string; count: number }> {
  if (max <= 0) return [];
  const mine = shapePhrases(line, game);
  const counts = new Map<string, number>();
  for (const r of recent)
    for (const p of shapePhrases(r.line, r.game))
      if (mine.has(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
  const hits = [...counts]
    .filter(([, n]) => n >= max)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count || b.phrase.length - a.phrase.length);
  // "plus # more" inside "plus # more steam": name the longest, once.
  return hits.filter(
    (h) =>
      !hits.some(
        (o) => o !== h && o.phrase.includes(h.phrase) && o.count >= h.count,
      ),
  );
}

/** The house-rule misses for a draft's title and hook against the last 30 days' Shorts; empty when fresh. */
export function repetitionProblems(
  draft: ShortText,
  recent: ShortText[],
  max: number,
): string[] {
  const out: string[] = [];
  const title = repeatedPhrases(
    draft.title,
    draft.game,
    recent.map((r) => ({ line: r.title, game: r.game })),
    max,
  )[0];
  if (title)
    out.push(
      `The YouTube title reuses "${title.phrase}", which ${title.count} Shorts in the last 30 days already used; write this title in its own words so the channel never reads as one template.`,
    );
  const hook = repeatedPhrases(
    draft.hook,
    draft.game,
    recent.map((r) => ({ line: r.hook, game: r.game })),
    max,
  )[0];
  if (hook)
    out.push(
      `The hook reuses "${hook.phrase}", which ${hook.count} Shorts in the last 30 days already used; open with this story's own words.`,
    );
  return out;
}

/** Titles, hooks and games of the Shorts written in the last 30 days (any lane, failures left out). */
export async function recentShortTexts(
  db: Db,
  exceptId: string,
  now: Date,
): Promise<ShortText[]> {
  const rows = await db.query<{
    title: string | null;
    hook: string | null;
    game: string | null;
  }>(
    `SELECT script_json->'youtube'->>'title' AS title, script_json->>'hook' AS hook, script_json->>'game_title' AS game
       FROM episodes
      WHERE script_json IS NOT NULL AND id <> $1 AND status NOT IN ('failed','rejected')
        AND COALESCE(script_json->>'runtime', 'short') = 'short' AND lane <> 'twin'
        AND created_at > $2::timestamptz - interval '30 days'
      ORDER BY created_at DESC LIMIT 200`,
    [exceptId, now],
  );
  return rows.map((r) => ({
    title: r.title ?? "",
    hook: r.hook ?? "",
    game: r.game ?? "",
  }));
}

export interface RepetitionAudit {
  items: number;
  /** Share of items whose line carries a phrase used by `max` or more of the items before it in the window. */
  repeatShare: number;
  /** The most repeated phrases over the whole set, with how many items carry each. */
  top: Array<{ phrase: string; count: number }>;
}

/**
 * The repetition of one kind of line (titles, hooks, loop lines) across a set of Shorts, oldest first: each
 * judged against the ones before it inside 30 days, as the writer's check would have judged it.
 */
export function auditLines(
  items: Array<{ line: string; game: string; at: Date }>,
  max: number,
): RepetitionAudit {
  let flagged = 0;
  const all = new Map<string, number>();
  items.forEach((it, i) => {
    const before = items
      .slice(0, i)
      .filter((b) => it.at.getTime() - b.at.getTime() <= 30 * 86400_000);
    if (
      repeatedPhrases(
        it.line,
        it.game,
        before.map((b) => ({ line: b.line, game: b.game })),
        max,
      ).length
    )
      flagged++;
    for (const p of shapePhrases(it.line, it.game))
      all.set(p, (all.get(p) ?? 0) + 1);
  });
  const top = [...all]
    .filter(([, n]) => n >= 3)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  return {
    items: items.length,
    repeatShare: items.length ? flagged / items.length : 0,
    top,
  };
}

/** Lines that recur word for word across a set (two or more items), for the verbatim-template audit. */
export function verbatimLines(
  lines: string[],
  min = 2,
): Array<{ line: string; count: number }> {
  const counts = new Map<string, number>();
  for (const l of lines) {
    const k = l.trim();
    if (k.length >= 12) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, n]) => n >= min)
    .map(([line, count]) => ({ line, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * A description that keeps its disclosure. The AI-voice line and the channel line sit at the end, after the
 * chapters and the footage credits, and the old cut at 4,950 characters (then 4,900 at the upload) took them
 * off a documentary whose Pexels credits ran long (27 Oct). So the head is cut, at a line, to leave room for
 * the tail, measured in bytes as YouTube measures its 5,000 limit.
 */
export function fitDescription(
  head: string[],
  tail: string[],
  maxBytes = 4900,
): string {
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");
  const end = tail.filter((l) => l !== "").join("\n");
  const lines = head.filter((l) => l !== "");
  const room = maxBytes - bytes(end) - 1;
  const kept: string[] = [];
  let used = 0;
  for (const l of lines) {
    const add = bytes(l) + (kept.length ? 1 : 0);
    if (used + add > room) {
      // The first line that does not fit is cut at a word with an ellipsis; the rest is left out.
      const left = room - used - (kept.length ? 1 : 0) - 3;
      if (left > 40) {
        let cut = l;
        while (bytes(cut) > left)
          cut = cut.slice(
            0,
            cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length - 1,
          );
        kept.push(`${cut}...`);
      }
      break;
    }
    kept.push(l);
    used += add;
  }
  return [...kept, ...(end ? [end] : [])].join("\n");
}
