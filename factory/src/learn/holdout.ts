// The holdout (LEARN_HOLDOUT_SHARE, research item 2): a share of news Shorts (10% is the plan) is made on a pinned
// baseline, the settings as they were when it was pinned, so the month of changes since can be compared with a control
// that did not get them. The pick is by a hash of the episode id, so a retry keeps its side.
//
// Safety: the baseline never reaches a gate. Every setting that gates, checks or guards a video (fact check, clarity,
// spoilers, the release gate, rumours...) and every piece of plumbing (slots, quotas, uploads, voices, models) always
// runs live, so a holdout Short answers to today's gates and goes out through today's pipes; only the creative choices
// are pinned. A holdout Short also gets no test arm, no bandit draw, no playbook and no hook breadth: it is the factory
// as it was. Code and prompt changes cannot be pinned; they show up in the stamps instead.

import { createHash } from "node:crypto";
import type { Db } from "../db.ts";
import {
  loadSnapshot,
  overrideSnapshot,
  saveSnapshot,
  settingsSnapshot,
  stableJson,
  type Json,
} from "./stamps.ts";
import { recordChange } from "./ledger.ts";

/** Settings that always run live on a holdout Short: gates, checks and guards. */
export const LIVE_GATES =
  /(gate|check|guard|audit|fact|spoiler|rumour|refuse|thin|clarity|vision|qa|rubric|release|attribution|writerNotes|primarySources|safety|privacy|approval|moderat|suggestive|repeat|blocklist|floor|minChars)/i;
/** Settings that always run live on a holdout Short: plumbing, platforms and the learning core itself. */
export const LIVE_PLUMBING =
  /(quota|slot|dryRun|upload|youtube|codex|voiceProvider|localTts|tts|eleven|discord|backup|prune|retry|attempt|timeout|port$|tick|timezone|tunnel|publicUrl|^mac|apple|whisper|ffmpeg|remotion|concurrency|gpu|^learn|twin|crosspost|tiktok|instagram|facebook|threads|buffer|bluesky|community|comment|engage|metrics|analytics|reach|subsLearn|growthTests|perDay|maxAttempts|lanes?$|enabled$|Enabled|model|keepDays|cache|parallel|worker|stream|schedule|cadence|calendar|daily|weekly|launch)/i;

/** Whether a pinned value may be applied to a holdout episode. */
export function pinnable(key: string): boolean {
  return !key
    .split(".")
    .some((part) => LIVE_GATES.test(part) || LIVE_PLUMBING.test(part));
}

/** A number in [0, 1) from the episode id, independent of every other split the factory makes. */
export function holdoutDraw(id: string): number {
  return (
    parseInt(
      createHash("sha256")
        .update(`learn-holdout:${id}`)
        .digest("hex")
        .slice(0, 8),
      16,
    ) /
    2 ** 32
  );
}

export function inHoldout(
  ep: { id: string; lane: string },
  s: { holdoutShare: number; holdoutLanes: string[] },
): boolean {
  return (
    s.holdoutShare > 0 &&
    s.holdoutLanes.includes(ep.lane) &&
    holdoutDraw(ep.id) < s.holdoutShare
  );
}

/** The pinned baseline: the settings snapshot, the runtime overrides and the growth tests' winners when pinned. */
export interface Baseline {
  config: Record<string, Json>;
  overrides: Record<string, Json>;
  growthDefaults: Array<{ key: string; variant: "A" | "B" }>;
  pinnedAt: string;
}

const BASELINE_KEY = "learn:baseline";

export async function currentBaseline(
  db: Db,
): Promise<{ hash: string; baseline: Baseline } | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [BASELINE_KEY],
  );
  if (!row) return undefined;
  try {
    const { hash } = JSON.parse(row.value) as { hash: string };
    const baseline = await loadSnapshot<Baseline>(db, hash);
    return baseline ? { hash, baseline } : undefined;
  } catch {
    return undefined;
  }
}

/** The growth tests' winners as the settings overrides hold them ("override:growth_hook_style" 1 is B). */
export function growthDefaultsFrom(
  overrides: Record<string, Json>,
): Baseline["growthDefaults"] {
  const out: Baseline["growthDefaults"] = [];
  for (const [k, v] of Object.entries(overrides)) {
    const m = k.match(/^override:growth_(.+)$/);
    if (m && typeof v === "number")
      out.push({ key: m[1]!, variant: v >= 1 ? "B" : "A" });
  }
  return out;
}

/** Pins the live settings as the new baseline and says so in the ledger. */
export async function pinBaseline(
  db: Db,
  cfg: object,
  now: Date,
  reason: string,
): Promise<{ hash: string; baseline: Baseline }> {
  const overrides = await overrideSnapshot(db);
  const baseline: Baseline = {
    config: settingsSnapshot(cfg),
    overrides,
    growthDefaults: growthDefaultsFrom(overrides),
    pinnedAt: now.toISOString(),
  };
  const hash = await saveSnapshot(
    db,
    baseline as unknown as Record<string, unknown>,
    now,
  );
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [BASELINE_KEY, JSON.stringify({ hash, pinnedAt: baseline.pinnedAt })],
  );
  await recordChange(db, {
    at: now,
    kind: "pin",
    key: "holdout_baseline",
    after: hash,
    summary: `The holdout's baseline was pinned to the live settings (${reason}).`,
    source: "holdout",
  });
  return { hash, baseline };
}

/** Re-pins when the baseline is older than the re-pin period; pins the first time. Returns whether it pinned. */
export async function maybeRepin(
  db: Db,
  cfg: object,
  now: Date,
  repinDays: number,
): Promise<boolean> {
  const cur = await currentBaseline(db);
  if (!cur) {
    await pinBaseline(db, cfg, now, "first pin");
    return true;
  }
  if (
    repinDays > 0 &&
    now.getTime() - Date.parse(cur.baseline.pinnedAt) >= repinDays * 86_400_000
  ) {
    await pinBaseline(db, cfg, now, `${repinDays}-day re-pin`);
    return true;
  }
  return false;
}

function setPath(
  obj: Record<string, unknown>,
  dotted: string,
  value: unknown,
): void {
  const parts = dotted.split(".");
  let at: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    const next = at[k];
    if (!next || typeof next !== "object" || Array.isArray(next)) return; // the shape changed since the pin: skip
    at[k] = { ...(next as Record<string, unknown>) };
    at = at[k] as Record<string, unknown>;
  }
  at[parts.at(-1)!] = value;
}

const isHashed = (v: Json): boolean =>
  !!v && typeof v === "object" && !Array.isArray(v) && "$sha" in v;

/** The keys a baseline would change on this config, with the pinned and the live value (pure). */
export function baselineDelta(
  cfg: object,
  baseline: Pick<Baseline, "config">,
): Array<{ key: string; live: Json | undefined; pinned: Json }> {
  const live = settingsSnapshot(cfg);
  const out: Array<{ key: string; live: Json | undefined; pinned: Json }> = [];
  for (const [key, pinned] of Object.entries(baseline.config)) {
    if (!pinnable(key) || isHashed(pinned) || !(key in live)) continue;
    if (stableJson(live[key]) === stableJson(pinned)) continue;
    // Only a value of the same kind is applied (a setting whose type changed since the pin stays live).
    if (
      typeof live[key] !== typeof pinned ||
      Array.isArray(live[key]) !== Array.isArray(pinned)
    )
      continue;
    out.push({ key, live: live[key], pinned });
  }
  return out;
}

export interface HoldoutContext {
  profileHash: string;
  growthDefaults: Baseline["growthDefaults"];
  applied: string[];
}

const contexts = new WeakMap<object, HoldoutContext>();

/** A copy of the config with the baseline's creative choices applied, tagged so the steps know it is a holdout. */
export function applyBaseline<C extends object>(
  cfg: C,
  hash: string,
  baseline: Baseline,
): C {
  const copy = { ...(cfg as Record<string, unknown>) };
  const delta = baselineDelta(cfg, baseline);
  for (const d of delta) setPath(copy, d.key, d.pinned);
  contexts.set(copy, {
    profileHash: hash,
    growthDefaults: baseline.growthDefaults,
    applied: delta.map((d) => d.key),
  });
  return copy as C;
}

/** The holdout context of a config made by applyBaseline; undefined for a live episode. */
export const holdoutOf = (cfg: object): HoldoutContext | undefined =>
  contexts.get(cfg);

export interface HoldoutDecision {
  profile: "live" | "holdout";
  hash?: string;
  baseline?: Baseline;
}

/**
 * Whether an episode is a holdout one: the side its first stamp recorded (so a changed share never moves an episode
 * half way), else the hash draw. A holdout episode with no baseline yet pins one now.
 */
export async function holdoutFor(
  db: Db,
  cfg: object & { learn: { holdoutShare: number; holdoutLanes: string[] } },
  ep: { id: string; lane: string },
  now: Date,
): Promise<HoldoutDecision> {
  const [row] = await db.query<{
    profile: string;
    profile_hash: string | null;
  }>(`SELECT profile, profile_hash FROM episode_stamps WHERE episode_id = $1`, [
    ep.id,
  ]);
  if (row) {
    if (row.profile !== "holdout" || !row.profile_hash)
      return { profile: "live" };
    const baseline = await loadSnapshot<Baseline>(db, row.profile_hash);
    return baseline
      ? { profile: "holdout", hash: row.profile_hash, baseline }
      : { profile: "live" };
  }
  if (!inHoldout(ep, cfg.learn)) return { profile: "live" };
  const cur =
    (await currentBaseline(db)) ??
    (await pinBaseline(db, cfg, now, "first holdout episode"));
  return { profile: "holdout", hash: cur.hash, baseline: cur.baseline };
}
