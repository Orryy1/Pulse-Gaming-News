// Version stamps (LEARN_STAMPS, research item 2): every episode records which writer and judge prompts made it (a hash
// of each system prompt), the model that answered each call, the active settings (non-secret keys only) and the code
// commit. An improvement ships every four hours; without this nothing can be credited or blamed.
//
// How the prompts are caught: src/editorial/llm.ts tells its listeners about every model call (Claude and Codex alike)
// with the system prompt. While an episode's step runs, an AsyncLocalStorage scope names the episode, so each call is
// filed under it without touching a single writer or judge. Calls outside a step (weekly jobs) are not filed.

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db.ts";
import { tapUsage, type UsageLine } from "../editorial/llm.ts";

// ---- Secret filter ---------------------------------------------------------------------------------
// A settings snapshot must never hold the value of a key, token, id, address or path. A field is left out when its
// name says it is one of those, or when its value looks like one, whatever its name.

/** Names of fields whose values are secrets or identities. */
export const SECRET_NAME =
  /(key|token|secret|passw|credential|webhook|cookie|auth(?!or)|session|salt|signature|private|dsn|email|phone|account|client|handle|refresh|bearer|login|oauth|cert)/i;
/** Names that are ids: "channelId", "facebookPageIds", "id". */
export const ID_NAME = /(Id|Ids|ID|IDs)$|^id$|_id$|_ids$/;
/** Names that are addresses. */
export const ADDRESS_NAME = /(url|uri|host|endpoint|address|domain|origin)s?$/i;
/** Names that are this machine's paths and programs: not settings of the videos, and they differ between machines. */
export const MACHINE_NAME =
  /(dir|path|file|files|python|binary|exe|runner|folder|bin|executable|socket)$/i;
/** Values that look like a key or token: long runs of letters and digits. */
export const SECRET_VALUE = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_\-+/=.:]{24,}$/;
/** Values with a scheme ("https://", "postgres://"). */
export const URL_VALUE = /[a-z][a-z0-9+.-]*:\/\//i;
/** Values that are paths. */
export const PATH_VALUE =
  /^(~|\.{0,2}[\\/]|[A-Za-z]:[\\/])|[\\/][^\\/\s]+[\\/]/;
/** Values that are email addresses. */
export const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

export function safeName(name: string): boolean {
  return (
    !SECRET_NAME.test(name) &&
    !ID_NAME.test(name) &&
    !ADDRESS_NAME.test(name) &&
    !MACHINE_NAME.test(name)
  );
}

export function safeValue(v: string): boolean {
  return (
    !SECRET_VALUE.test(v) &&
    !URL_VALUE.test(v) &&
    !PATH_VALUE.test(v) &&
    !EMAIL_VALUE.test(v)
  );
}

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };

/** Long strings are kept as a hash: they are lists or texts whose change matters, not their words. */
const LONG = 200;

export const sha = (s: string, n = 16): string =>
  createHash("sha256").update(s).digest("hex").slice(0, n);

/** JSON with sorted keys, so the same settings always hash the same. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

function scalar(v: unknown): Json | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    if (!safeValue(v)) return undefined;
    return v.length > LONG ? { $sha: sha(v) } : v;
  }
  if (v === null) return null;
  return undefined;
}

/**
 * The settings snapshot: every field of the config (dotted names for nested settings) whose name and value are safe,
 * flattened. Functions, dates, maps and secrets are left out; a list keeps only its safe items.
 */
export function settingsSnapshot(cfg: object): Record<string, Json> {
  const out: Record<string, Json> = {};
  const walk = (
    obj: Record<string, unknown>,
    prefix: string,
    depth: number,
  ) => {
    for (const name of Object.keys(obj).sort()) {
      if (!safeName(name)) continue;
      const v = obj[name];
      const key = prefix ? `${prefix}.${name}` : name;
      if (Array.isArray(v)) {
        const items = v
          .slice(0, 60)
          .map(scalar)
          .filter((x): x is Json => x !== undefined);
        if (items.length || !v.length) out[key] = items;
        continue;
      }
      if (v && typeof v === "object") {
        if (depth < 3 && Object.getPrototypeOf(v) === Object.prototype)
          walk(v as Record<string, unknown>, key, depth + 1);
        continue;
      }
      const s = scalar(v);
      if (s !== undefined) out[key] = s;
    }
  };
  walk(cfg as Record<string, unknown>, "", 0);
  return out;
}

export const snapshotHash = (snap: unknown): string => sha(stableJson(snap));

/** The runtime overrides the experiments and growth tests write (numbers only; the settings table also holds tokens). */
export async function overrideSnapshot(db: Db): Promise<Record<string, Json>> {
  const rows = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key LIKE 'override:%' ORDER BY key`,
  );
  const out: Record<string, Json> = {};
  for (const r of rows) {
    const n = Number(r.value);
    if (Number.isFinite(n)) out[r.key] = n;
  }
  return out;
}

export interface FullSnapshot {
  config: Record<string, Json>;
  overrides: Record<string, Json>;
}

/** Saves a snapshot once and returns its hash. */
export async function saveSnapshot(
  db: Db,
  snap: FullSnapshot | Record<string, unknown>,
  at?: Date,
): Promise<string> {
  const hash = snapshotHash(snap);
  await db.query(
    `INSERT INTO settings_snapshots (hash, snapshot, first_seen) VALUES ($1, $2, COALESCE($3::timestamptz, now())) ON CONFLICT (hash) DO NOTHING`,
    [hash, JSON.stringify(snap), at ? at.toISOString() : null],
  );
  return hash;
}

export async function loadSnapshot<T = FullSnapshot>(
  db: Db,
  hash: string,
): Promise<T | undefined> {
  const [row] = await db.query<{ snapshot: unknown }>(
    `SELECT snapshot FROM settings_snapshots WHERE hash = $1`,
    [hash],
  );
  if (!row) return undefined;
  return (
    typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot
  ) as T;
}

// ---- Code commit -----------------------------------------------------------------------------------

const COMMIT = /^[0-9a-f]{7,40}$/;
let commitCache:
  | { dataDir: string; value: string | undefined; at: number }
  | undefined;

/**
 * The commit this process runs: data/admin/release (written by the Mac's deploy hook), else git's HEAD here. Read at
 * most once a minute, since a deploy restarts the process anyway.
 */
export function codeCommit(
  dataDir: string,
  now = Date.now(),
): string | undefined {
  if (
    commitCache &&
    commitCache.dataDir === dataDir &&
    now - commitCache.at < 60_000
  )
    return commitCache.value;
  let value: string | undefined;
  try {
    const rel = fs
      .readFileSync(path.join(dataDir, "admin", "release"), "utf8")
      .trim();
    if (COMMIT.test(rel)) value = rel;
  } catch {
    // no release file: a PC checkout
  }
  if (!value)
    try {
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      if (COMMIT.test(head)) value = head;
    } catch {
      // not a git checkout either
    }
  commitCache = { dataDir, value, at: now };
  return value;
}

// ---- Prompt capture --------------------------------------------------------------------------------

/** Call sites and jobs that judge rather than write. */
export const JUDGE_SITE =
  /(judge|check|fact|vision|gate|audit|review|verify|score|critic|qa\b|look|grade|rubric|spoiler)/i;
/** Call sites and jobs that write what viewers hear or read. */
export const WRITER_SITE =
  /(write|rewrite|script|hook|title|friend|revise|editorial|draft|chapter|outline|locali[sz]e|seo|caption|reply|documentary|evergreen|recap|why|explained|longform|cutdown)/i;

export function roleOf(
  site: string,
  job: string,
): "writer" | "judge" | "other" {
  if (JUDGE_SITE.test(site) || JUDGE_SITE.test(job)) return "judge";
  if (WRITER_SITE.test(site) || WRITER_SITE.test(job)) return "writer";
  return "other";
}

/** Frames that are plumbing, never the step that made the call. */
const PLUMBING = new Set([
  "llm",
  "codex",
  "stamps",
  "scope",
  "tags",
  "util",
  "breaker",
  "retry",
  "node:internal",
]);
const FRAME = /([\w.-]+)\.(?:ts|mts|js|mjs|tsx):\d+:\d+/;

/** The first non-plumbing module in a stack (async frames included): the site of an untagged Claude call. */
export function siteFromStack(stack: string): string {
  for (const line of stack.split("\n")) {
    const m = line.match(FRAME);
    if (!m) continue;
    const name = m[1]!;
    if (
      PLUMBING.has(name) ||
      name.startsWith("node_modules") ||
      line.includes("node_modules")
    )
      continue;
    return name;
  }
  return "unknown";
}

export interface PromptCall {
  site: string;
  promptHash: string;
  model: string;
  role: "writer" | "judge" | "other";
  job: string;
  calls: number;
  first: string;
  last: string;
}

export interface PromptScope {
  episodeId: string;
  step: string;
  calls: Map<string, PromptCall>;
  texts: Map<string, { site: string; text: string }>;
}

const scopes = new AsyncLocalStorage<PromptScope>();
let tapped = false;

/** Files one model call under the running step's episode (exported for tests). */
export function fileCall(
  sc: PromptScope,
  line: UsageLine,
  system: string,
  stack = "",
): void {
  const site = line.site || siteFromStack(stack);
  const promptHash = sha(system || "(none)");
  const key = `${site}|${promptHash}|${line.model}`;
  const prev = sc.calls.get(key);
  if (prev) {
    prev.calls++;
    prev.last = line.t;
  } else
    sc.calls.set(key, {
      site,
      promptHash,
      model: line.model,
      role: roleOf(site, line.job),
      job: line.job,
      calls: 1,
      first: line.t,
      last: line.t,
    });
  if (system && !sc.texts.has(promptHash))
    sc.texts.set(promptHash, { site, text: system });
}

/** Listens for model calls once per process. */
export function installPromptTap(): void {
  if (tapped) return;
  tapped = true;
  tapUsage((line, system) => {
    const sc = scopes.getStore();
    if (!sc) return;
    fileCall(sc, line, system, line.site ? "" : (new Error().stack ?? ""));
  });
}

export function newScope(episodeId: string, step: string): PromptScope {
  return { episodeId, step, calls: new Map(), texts: new Map() };
}

/** Runs fn with every model call it makes filed under the scope. */
export function inScope<T>(sc: PromptScope, fn: () => Promise<T>): Promise<T> {
  installPromptTap();
  return scopes.run(sc, fn);
}

export const currentScope = (): PromptScope | undefined => scopes.getStore();

/** Writes a step's calls: folded by site, prompt and model, with each prompt's text kept once. */
export async function flushPrompts(db: Db, sc: PromptScope): Promise<number> {
  for (const c of sc.calls.values())
    await db.query(
      `INSERT INTO episode_prompts (episode_id, site, prompt_hash, model, role, step, job, calls, first_at, last_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (episode_id, site, prompt_hash, model)
       DO UPDATE SET calls = episode_prompts.calls + EXCLUDED.calls, last_at = EXCLUDED.last_at`,
      [
        sc.episodeId,
        c.site,
        c.promptHash,
        c.model,
        c.role,
        sc.step,
        c.job.slice(0, 120),
        c.calls,
        c.first,
        c.last,
      ],
    );
  for (const [hash, t] of sc.texts)
    await db.query(
      `INSERT INTO prompt_texts (prompt_hash, site, chars, text) VALUES ($1, $2, $3, $4) ON CONFLICT (prompt_hash) DO NOTHING`,
      [hash, t.site, t.text.length, t.text],
    );
  return sc.calls.size;
}

// ---- The episode stamp -----------------------------------------------------------------------------

export interface StepStamp {
  commit?: string;
  settings: string;
  at: string;
  calls?: number;
}

/** Records one step of an episode: the commit and settings it ran with, and whether it is a holdout episode. */
export async function stampStep(
  db: Db,
  episodeId: string,
  step: string,
  stamp: StepStamp,
  profile: { name: "live" | "holdout"; hash?: string },
): Promise<void> {
  await db.query(
    `INSERT INTO episode_stamps (episode_id, code_commit, settings_hash, profile, profile_hash, steps)
     VALUES ($1, $2, $3, $4, $5, jsonb_build_object($6::text, $7::jsonb))
     ON CONFLICT (episode_id) DO UPDATE SET
       steps = episode_stamps.steps || EXCLUDED.steps,
       code_commit = COALESCE(episode_stamps.code_commit, EXCLUDED.code_commit),
       settings_hash = COALESCE(episode_stamps.settings_hash, EXCLUDED.settings_hash),
       updated_at = now()`,
    [
      episodeId,
      stamp.commit ?? null,
      stamp.settings,
      profile.name,
      profile.hash ?? null,
      step,
      JSON.stringify(stamp),
    ],
  );
}

/** What an episode was made with (for reports and the other helpers: the retention model, the packaging lab). */
export async function episodeStamp(
  db: Db,
  episodeId: string,
): Promise<
  | {
      commit?: string;
      settings?: string;
      profile: string;
      prompts: Array<{
        site: string;
        prompt_hash: string;
        model: string;
        role: string;
      }>;
    }
  | undefined
> {
  const [row] = await db.query<{
    code_commit: string | null;
    settings_hash: string | null;
    profile: string;
  }>(
    `SELECT code_commit, settings_hash, profile FROM episode_stamps WHERE episode_id = $1`,
    [episodeId],
  );
  if (!row) return undefined;
  const prompts = await db.query<{
    site: string;
    prompt_hash: string;
    model: string;
    role: string;
  }>(
    `SELECT site, prompt_hash, model, role FROM episode_prompts WHERE episode_id = $1 ORDER BY first_at`,
    [episodeId],
  );
  return {
    commit: row.code_commit ?? undefined,
    settings: row.settings_hash ?? undefined,
    profile: row.profile,
    prompts,
  };
}
