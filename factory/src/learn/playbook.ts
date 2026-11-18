// The lesson playbook (LEARN_PLAYBOOK, research item 5, after ACE: Zhang et al. 2025). The weekly reports wrote the
// writers' lessons afresh each week, so a good lesson vanished in a thin week and nothing knew whether a lesson had
// helped. Here each lesson is an item with an id, its evidence, when it was first seen and last confirmed, and tallies
// of weeks it helped, hurt or made no difference. Updates are incremental: a lesson seen again is confirmed (its
// evidence grows), a new one is added, one that contradicts an older lesson retires the older one. A lesson's text is
// never rewritten (ACE's "context collapse": rewriting the whole memory loses detail).
//
// Credit: each week, Shorts whose writer saw a lesson are compared on the 3-second hold with Shorts that did not (the
// holdout, and Shorts made before the lesson existed). A lesson retires when it has hurt two weeks more than it has
// helped, when nothing re-confirms it for LEARN_PLAYBOOK_STALE_DAYS, or when better-proven lessons crowd it out of the
// LEARN_PLAYBOOK_MAX shown per scope.

import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db.ts";
import { sha } from "./stamps.ts";
import { mean } from "./stats.ts";
import type { Outcome } from "./outcomes.ts";

export type Scope = "news" | "social" | "long";

export interface Proposal {
  text: string;
  scope: Scope;
  source: string;
  evidence?: Record<string, unknown>;
}

/** Report bookkeeping that is not part of a lesson: "(weekly report 2026-11-11)", "Evidence: moderate, 35 against 56". */
const BOOKKEEPING =
  /\((weekly report|retention curves)[^)]*\)|evidence:[^.]*\.?/gi;
/** Figures and their units. */
const FIGURES = /[$£€]?\d[\d,.]*\s*(%|s\b|points?\b|pts?\b|of\b)?/gi;
const PUNCT = /[^a-z\s]/g;
/** Words that only say which way a lesson points. */
const POLARITY_UP =
  /\b(better|more|gains?|gained|holds?|held|higher|up|wins?|won|best|keeps?|kept)\b/g;
const POLARITY_DOWN =
  /\b(worse|less|fewer|loses?|lost|lower|down|drops?|dropped|stop|avoid|never|worst)\b/g;

/** The lesson with its figures and bookkeeping removed, lower case: a lesson seen again has the same key. */
export function lessonKey(text: string): string {
  return text
    .toLowerCase()
    .replace(BOOKKEEPING, " ")
    .replace(FIGURES, " ")
    .replace(PUNCT, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The key with the direction words removed: two lessons on one topic pointing opposite ways share it. */
export function topicKey(key: string): string {
  return key
    .replace(POLARITY_UP, " ")
    .replace(POLARITY_DOWN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comparatives decide the direction ("held worse" points down); the plain verbs only break a tie. */
const STRONG_UP = /\b(better|more|higher|best)\b/g;
const STRONG_DOWN = /\b(worse|less|fewer|lower|worst|stop|avoid|never)\b/g;

export function polarity(key: string): 1 | -1 | 0 {
  const n = (re: RegExp) => (key.match(re) ?? []).length;
  const up = 2 * n(STRONG_UP) + n(POLARITY_UP);
  const down = 2 * n(STRONG_DOWN) + n(POLARITY_DOWN);
  return up > down ? 1 : down > up ? -1 : 0;
}

const PLATFORM = /^(instagram|tiktok|facebook|threads|x|bluesky)\b/i;

export function scopeOf(text: string, fallback: Scope = "news"): Scope {
  return PLATFORM.test(text.trim()) ? "social" : fallback;
}

export const lessonId = (key: string): string => `L-${sha(key, 6)}`;

export interface LessonRow {
  id: string;
  key: string;
  text: string;
  scope: Scope;
  source: string;
  evidence: Array<Record<string, unknown>>;
  first_seen: string;
  last_confirmed: string;
  confirmations: number;
  helpful: number;
  harmful: number;
  neutral: number;
  status: "active" | "retired";
  retired_reason: string | null;
}

const parseRow = (r: any): LessonRow => ({
  ...r,
  evidence:
    typeof r.evidence === "string" ? JSON.parse(r.evidence) : r.evidence,
});

export async function allLessons(db: Db): Promise<LessonRow[]> {
  return (await db.query(`SELECT * FROM lessons ORDER BY first_seen, id`)).map(
    parseRow,
  );
}

export interface CurateResult {
  added: string[];
  confirmed: string[];
  retired: Array<{ id: string; reason: string }>;
}

/**
 * Applies a week's proposals as deltas: confirm a lesson seen again, add a new one, retire an older active lesson the
 * new one contradicts. A stale-retired lesson that comes back is made active again; a harmful one stays retired.
 */
export async function curate(
  db: Db,
  proposals: Proposal[],
  now: Date,
): Promise<CurateResult> {
  const res: CurateResult = { added: [], confirmed: [], retired: [] };
  const existing = await allLessons(db);
  const byKey = new Map(existing.map((l) => [l.key, l]));
  for (const p of proposals) {
    const key = lessonKey(p.text);
    if (key.split(" ").length < 3) continue;
    const ev = {
      at: now.toISOString(),
      source: p.source,
      text: p.text.slice(0, 300),
      ...(p.evidence ?? {}),
    };
    const hit = byKey.get(key);
    if (hit) {
      if (res.confirmed.includes(hit.id)) continue;
      const revive = hit.status === "retired" && hit.retired_reason === "stale";
      const evidence = [...hit.evidence, ev].slice(-12);
      await db.query(
        `UPDATE lessons SET last_confirmed = $2, confirmations = confirmations + 1, evidence = $3,
           status = CASE WHEN $4 THEN 'active' ELSE status END, retired_at = CASE WHEN $4 THEN NULL ELSE retired_at END,
           retired_reason = CASE WHEN $4 THEN NULL ELSE retired_reason END
         WHERE id = $1`,
        [hit.id, now.toISOString(), JSON.stringify(evidence), revive],
      );
      res.confirmed.push(hit.id);
      continue;
    }
    const id = lessonId(key);
    // A new lesson on the same topic pointing the other way retires the older one.
    const topic = topicKey(key);
    const pol = polarity(key);
    for (const old of existing)
      if (
        old.status === "active" &&
        pol !== 0 &&
        topicKey(old.key) === topic &&
        polarity(old.key) === -pol
      ) {
        await retire(db, old.id, `contradicted by ${id}`, now);
        old.status = "retired";
        res.retired.push({ id: old.id, reason: `contradicted by ${id}` });
      }
    await db.query(
      `INSERT INTO lessons (id, key, text, scope, source, evidence, first_seen, last_confirmed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT DO NOTHING`,
      [
        id,
        key,
        p.text.trim().slice(0, 500),
        p.scope,
        p.source,
        JSON.stringify([ev]),
        now.toISOString(),
      ],
    );
    const row: LessonRow = {
      id,
      key,
      text: p.text,
      scope: p.scope,
      source: p.source,
      evidence: [ev],
      first_seen: now.toISOString(),
      last_confirmed: now.toISOString(),
      confirmations: 1,
      helpful: 0,
      harmful: 0,
      neutral: 0,
      status: "active",
      retired_reason: null,
    };
    existing.push(row);
    byKey.set(key, row);
    res.added.push(id);
  }
  return res;
}

async function retire(
  db: Db,
  id: string,
  reason: string,
  now: Date,
): Promise<void> {
  await db.query(
    `UPDATE lessons SET status = 'retired', retired_at = $2, retired_reason = $3 WHERE id = $1 AND status = 'active'`,
    [id, now.toISOString(), reason],
  );
}

/** Net proof of a lesson: weeks helped minus weeks hurt, then how often it was re-confirmed. */
const rank = (l: LessonRow) => (l.helpful - l.harmful) * 100 + l.confirmations;

/**
 * The retirement rules: harmful (hurt two weeks more than helped), stale (not confirmed in staleDays) and crowded out
 * (beyond the max per scope, the least proven go). Returns what retired.
 */
export async function retireLessons(
  db: Db,
  now: Date,
  o: { staleDays: number; max: number },
): Promise<Array<{ id: string; reason: string }>> {
  const out: Array<{ id: string; reason: string }> = [];
  const active = (await allLessons(db)).filter((l) => l.status === "active");
  const keep: LessonRow[] = [];
  for (const l of active) {
    if (l.harmful >= l.helpful + 2) out.push({ id: l.id, reason: "harmful" });
    else if (
      now.getTime() - Date.parse(l.last_confirmed) >
      o.staleDays * 86_400_000
    )
      out.push({ id: l.id, reason: "stale" });
    else keep.push(l);
  }
  for (const scope of ["news", "social", "long"] as Scope[]) {
    const mine = keep
      .filter((l) => l.scope === scope)
      .sort((a, b) => rank(b) - rank(a));
    for (const l of mine.slice(o.max))
      out.push({ id: l.id, reason: "crowded out" });
  }
  for (const r of out) await retire(db, r.id, r.reason, now);
  return out;
}

/** The lessons a writer sees, most proven first, with their ids. */
export async function playbookFor(
  db: Db,
  scopes: Scope[],
  max: number,
): Promise<{ ids: string[]; text: string }> {
  const rows = (await allLessons(db))
    .filter((l) => l.status === "active" && scopes.includes(l.scope))
    .sort((a, b) => rank(b) - rank(a));
  const shown = rows.slice(0, max);
  if (!shown.length) return { ids: [], text: "" };
  return {
    ids: shown.map((l) => l.id),
    text: [
      "The channel's lesson playbook (tracked lessons from its own numbers; learn the pattern, never copy wording):",
      ...shown.map(
        (l) =>
          `- [${l.id}] ${l.text.replace(BOOKKEEPING, "").replace(/\s+/g, " ").trim()}`,
      ),
    ].join("\n"),
  };
}

export async function recordExposure(
  db: Db,
  episodeId: string,
  ids: string[],
  now: Date,
): Promise<void> {
  for (const id of ids)
    await db.query(
      `INSERT INTO lesson_exposures (episode_id, lesson_id, shown_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [episodeId, id, now.toISOString()],
    );
}

/** One week's credit for one lesson (pure): helped, hurt or no difference, from the two groups' 3-second holds. */
export function creditOf(
  exposed: number[],
  control: number[],
  o: { min?: number; margin?: number } = {},
): "helpful" | "harmful" | "neutral" | "too_few" {
  const min = o.min ?? 4;
  const margin = o.margin ?? 0.01;
  if (exposed.length < min || control.length < min) return "too_few";
  const d = mean(exposed) - mean(control);
  return d > margin ? "helpful" : d < -margin ? "harmful" : "neutral";
}

/** Weekly credit: each active lesson's exposed Shorts against the others, over Shorts published 2 to 9 days ago. */
export async function creditLessons(
  db: Db,
  outcomes: Outcome[],
  now: Date,
  week: string,
): Promise<
  Array<{ id: string; credit: string; exposed: number; control: number }>
> {
  const done = await db.query(`SELECT 1 FROM settings WHERE key = $1`, [
    `learn:playbook_credit:${week}`,
  ]);
  if (done.length) return [];
  const from = now.getTime() - 9 * 86_400_000;
  const to = now.getTime() - 2 * 86_400_000;
  const window = outcomes.filter((o) => {
    const t = Date.parse(o.publishedAt ?? "");
    return (
      o.hold3 !== undefined &&
      t >= from &&
      t < to &&
      (o.lane === "news" || o.lane === "news_breaking")
    );
  });
  const exp = await db.query<{ episode_id: string; lesson_id: string }>(
    `SELECT episode_id, lesson_id FROM lesson_exposures WHERE episode_id = ANY($1::text[])`,
    [window.map((o) => o.episodeId)],
  );
  const saw = new Map<string, Set<string>>();
  for (const e of exp)
    saw.set(e.lesson_id, (saw.get(e.lesson_id) ?? new Set()).add(e.episode_id));
  const out: Array<{
    id: string;
    credit: string;
    exposed: number;
    control: number;
  }> = [];
  for (const l of (await allLessons(db)).filter((x) => x.status === "active")) {
    const ids = saw.get(l.id) ?? new Set();
    const exposed = window
      .filter((o) => ids.has(o.episodeId))
      .map((o) => o.hold3!);
    const control = window
      .filter((o) => !ids.has(o.episodeId))
      .map((o) => o.hold3!);
    const credit = creditOf(exposed, control);
    out.push({
      id: l.id,
      credit,
      exposed: exposed.length,
      control: control.length,
    });
    if (credit === "too_few") continue;
    await db.query(
      `UPDATE lessons SET ${credit} = ${credit} + 1 WHERE id = $1`,
      [l.id],
    );
  }
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    [`learn:playbook_credit:${week}`, now.toISOString()],
  );
  return out;
}

/** The week's proposals from the weekly analytics report (its lessons and the retention curves' lessons). */
export function proposalsFromReport(dataDir: string): Proposal[] {
  const file = path.join(dataDir, "reports", "analytics", "latest.json");
  let j: any;
  try {
    j = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const out: Proposal[] = [];
  const blocked: string[] = (j.lessons_blocklist ?? []).map((b: string) =>
    String(b).toLowerCase(),
  );
  const ok = (t: string) =>
    !blocked.some((b) => b && t.toLowerCase().includes(b));
  for (const t of (j.feedback?.lessons ?? j.lessons ?? []) as string[])
    if (typeof t === "string" && ok(t))
      out.push({
        text: t,
        scope: scopeOf(t),
        source: "analytics_loop",
        evidence: { report: j.run_at },
      });
  for (const t of (j.retention?.lessons ?? []) as string[])
    if (typeof t === "string" && ok(t))
      out.push({
        text: t,
        scope: "news",
        source: "retention_learn",
        evidence: { report: j.run_at },
      });
  for (const t of (j.retentionModel?.lessons ?? []) as string[])
    if (typeof t === "string" && ok(t))
      out.push({
        text: t,
        scope: "news",
        source: "retention_model",
        evidence: { report: j.run_at },
      });
  return out;
}
