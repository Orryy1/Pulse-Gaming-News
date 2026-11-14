// The change ledger (LEARN_STAMPS, research item 2): every shipped change with the time it went live. The factory
// watches itself: a new code commit (a deploy), a changed setting (an .env edit and restart) and a changed runtime
// override (a test verdict) are each written once, with the commits' own subjects where git can say them. The
// improvement engine can add why it made a change (its intent and the number it expects to move) by appending a JSON
// line to data/admin/learn-changes.jsonl, which works while the factory runs. flightsim's canary rollbacks and any
// other helper write here through recordChange.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db } from "../db.ts";
import {
  codeCommit,
  overrideSnapshot,
  saveSnapshot,
  settingsSnapshot,
  snapshotHash,
  stableJson,
  type FullSnapshot,
  type Json,
} from "./stamps.ts";

export type ChangeKind =
  | "baseline"
  | "deploy"
  | "commit"
  | "setting"
  | "override"
  | "intent"
  | "pin"
  | "rollback"
  | "note";

export interface LedgerEntry {
  at: Date;
  kind: ChangeKind;
  key?: string;
  before?: string | null;
  after?: string | null;
  commit?: string;
  summary: string;
  source: string;
  detail?: Record<string, unknown>;
}

export interface LedgerRow {
  id: number;
  at: string;
  kind: ChangeKind;
  key: string | null;
  before: string | null;
  after: string | null;
  code_commit: string | null;
  summary: string;
  source: string;
  detail: Record<string, unknown> | null;
}

const MAX_TEXT = 300;
const text = (v: Json | undefined | null): string | null =>
  v === undefined || v === null
    ? null
    : (typeof v === "string" ? v : stableJson(v)).slice(0, MAX_TEXT);

export async function recordChange(db: Db, e: LedgerEntry): Promise<void> {
  await db.query(
    `INSERT INTO change_ledger (at, kind, key, before, after, code_commit, summary, source, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      e.at.toISOString(),
      e.kind,
      e.key ?? null,
      e.before ?? null,
      e.after ?? null,
      e.commit ?? null,
      e.summary.slice(0, 500),
      e.source,
      e.detail ? JSON.stringify(e.detail) : null,
    ],
  );
}

export async function changesBetween(
  db: Db,
  from: Date,
  to: Date,
): Promise<LedgerRow[]> {
  return db.query<LedgerRow>(
    `SELECT id, at, kind, key, before, after, code_commit, summary, source, detail FROM change_ledger
      WHERE at >= $1 AND at < $2 ORDER BY at, id`,
    [from.toISOString(), to.toISOString()],
  );
}

/** Every key whose value differs between two snapshots, in name order. */
export function diffSnapshots(
  a: Record<string, Json>,
  b: Record<string, Json>,
): Array<{ key: string; before: Json | undefined; after: Json | undefined }> {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys
    .filter((k) => stableJson(a[k] ?? null) !== stableJson(b[k] ?? null))
    .map((k) => ({ key: k, before: a[k], after: b[k] }));
}

export interface Commit {
  hash: string;
  at: string;
  subject: string;
}

const LOG_LINE = /^([0-9a-f]{7,40})\t([^\t]+)\t(.*)$/;

/** Parses `git log --format=%H%x09%cI%x09%s` output. */
export function parseGitLog(out: string): Commit[] {
  const commits: Commit[] = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(LOG_LINE);
    if (m)
      commits.push({ hash: m[1]!, at: m[2]!, subject: m[3]!.slice(0, 200) });
  }
  return commits;
}

/**
 * The commits between two releases, newest first, from the Mac's bare repository (PULSE_ROOT/repo.git) or the git
 * checkout the factory runs in. Empty when git cannot say (never throws).
 */
export function gitCommitsBetween(
  from: string,
  to: string,
  cwd = process.cwd(),
): Commit[] {
  const root =
    process.env.PULSE_ROOT || path.join(os.homedir(), "PulseFactory");
  const tries: string[][] = [];
  if (process.env.PULSE_GIT_DIR)
    tries.push(["--git-dir", process.env.PULSE_GIT_DIR]);
  const bare = path.join(root, "repo.git");
  if (fs.existsSync(bare)) tries.push(["--git-dir", bare]);
  tries.push(["-C", cwd]);
  for (const where of tries)
    try {
      const out = execFileSync(
        "git",
        [
          ...where,
          "log",
          "--format=%H%x09%cI%x09%s",
          "-n",
          "60",
          `${from}..${to}`,
          "--",
          ":(top)factory/",
        ],
        { timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
      ).toString();
      const commits = parseGitLog(out);
      if (commits.length) return commits;
    } catch {
      // next place
    }
  return [];
}

export interface Observed {
  commit?: string;
  hash: string;
  snapshot: FullSnapshot;
  at: string;
}

const OBSERVED_KEY = "learn:observed";

async function readObserved(db: Db): Promise<Observed | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [OBSERVED_KEY],
  );
  try {
    return row ? (JSON.parse(row.value) as Observed) : undefined;
  } catch {
    return undefined;
  }
}

async function writeObserved(db: Db, o: Observed): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [OBSERVED_KEY, JSON.stringify(o)],
  );
}

/** When this process started: a new commit or .env took effect then. */
export const processStartedAt = (): Date =>
  new Date(Date.now() - process.uptime() * 1000);

/** The ledger entries between what was observed last and what runs now (pure). */
export function changeEntries(
  prev: Observed | undefined,
  now: Observed,
  o: {
    bootAt: Date;
    at: Date;
    commits?: (from: string, to: string) => Commit[];
  },
): LedgerEntry[] {
  if (!prev)
    return [
      {
        at: o.at,
        kind: "baseline",
        commit: now.commit,
        summary: `The change ledger started watching: code ${now.commit?.slice(0, 9) ?? "unknown"}, settings ${now.hash}.`,
        source: "observed",
        detail: { settings: now.hash },
      },
    ];
  const out: LedgerEntry[] = [];
  if (now.commit && prev.commit !== now.commit) {
    const commits =
      prev.commit && o.commits ? o.commits(prev.commit, now.commit) : [];
    out.push({
      at: o.bootAt,
      kind: "deploy",
      key: "code",
      before: prev.commit ?? null,
      after: now.commit,
      commit: now.commit,
      summary: `New code went live: ${prev.commit?.slice(0, 9) ?? "unknown"} to ${now.commit.slice(0, 9)}${commits.length ? ` (${commits.length} commit${commits.length === 1 ? "" : "s"})` : ""}.`,
      source: "observed",
      detail: { commits: commits.length },
    });
    for (const c of commits.slice().reverse())
      out.push({
        at: o.bootAt,
        kind: "commit",
        commit: c.hash,
        summary: c.subject,
        source: "observed",
        detail: { committed_at: c.at },
      });
  }
  for (const d of diffSnapshots(prev.snapshot.config, now.snapshot.config))
    out.push({
      at: o.bootAt,
      kind: "setting",
      key: d.key,
      before: text(d.before),
      after: text(d.after),
      commit: now.commit,
      summary: `Setting ${d.key}: ${text(d.before) ?? "unset"} to ${text(d.after) ?? "unset"}.`,
      source: "observed",
    });
  for (const d of diffSnapshots(
    prev.snapshot.overrides,
    now.snapshot.overrides,
  ))
    out.push({
      at: o.at,
      kind: "override",
      key: d.key,
      before: text(d.before),
      after: text(d.after),
      commit: now.commit,
      summary: `Runtime override ${d.key}: ${text(d.before) ?? "unset"} to ${text(d.after) ?? "unset"}.`,
      source: "observed",
    });
  return out;
}

/**
 * Compares what runs now with what ran at the last look and writes the differences to the ledger. Cheap: one settings
 * query and a hash; git is asked only when the commit changed.
 */
export async function observeChanges(
  db: Db,
  cfg: { dataDir: string },
  now: Date,
  o: {
    commits?: (from: string, to: string) => Commit[];
    bootAt?: Date;
    commit?: string;
  } = {},
): Promise<LedgerEntry[]> {
  const snapshot: FullSnapshot = {
    config: settingsSnapshot(cfg),
    overrides: await overrideSnapshot(db),
  };
  const hash = snapshotHash(snapshot);
  const current: Observed = {
    commit: o.commit ?? codeCommit(cfg.dataDir),
    hash,
    snapshot,
    at: now.toISOString(),
  };
  const prev = await readObserved(db);
  if (prev && prev.hash === hash && prev.commit === current.commit) return [];
  const entries = changeEntries(prev, current, {
    bootAt: o.bootAt ?? processStartedAt(),
    at: now,
    commits: o.commits ?? gitCommitsBetween,
  });
  await saveSnapshot(db, snapshot, now);
  for (const e of entries) await recordChange(db, e);
  await writeObserved(db, current);
  return entries;
}

// ---- Intents from the improvement engine -------------------------------------------------------------

export const INTENT_FILE = "learn-changes.jsonl";
const OFFSET_KEY = "learn:intent_offset";

export interface Intent {
  at?: string;
  intent: string;
  metric?: string;
  setting?: string;
  commit?: string;
  by?: string;
}

/** Reads the improvement engine's new lines (data/admin/learn-changes.jsonl) into the ledger, once each. */
export async function ingestIntents(
  db: Db,
  dataDir: string,
  now: Date,
): Promise<number> {
  const file = path.join(dataDir, "admin", INTENT_FILE);
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return 0;
  }
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [OFFSET_KEY],
  );
  let offset = Number(row?.value ?? 0);
  if (!Number.isFinite(offset) || offset > buf.length) offset = 0; // the file was replaced
  const fresh = buf.subarray(offset).toString("utf8");
  const end = fresh.lastIndexOf("\n");
  if (end < 0) return 0;
  let n = 0;
  for (const line of fresh.slice(0, end).split("\n")) {
    if (!line.trim()) continue;
    let j: Intent;
    try {
      j = JSON.parse(line) as Intent;
    } catch {
      continue;
    }
    if (!j.intent || typeof j.intent !== "string") continue;
    const at = j.at && Number.isFinite(Date.parse(j.at)) ? new Date(j.at) : now;
    await recordChange(db, {
      at,
      kind: "intent",
      key: j.setting,
      commit: j.commit,
      summary: j.intent.slice(0, 500),
      source: "intent",
      detail: { metric: j.metric ?? null, by: j.by ?? null },
    });
    n++;
  }
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [
      OFFSET_KEY,
      String(offset + Buffer.byteLength(fresh.slice(0, end + 1), "utf8")),
    ],
  );
  return n;
}

// ---- Backfill from the proof tool (src/tools/learn-proof.ts) ---------------------------------------

export const BACKFILL_STAMPS = "learn-backfill-stamps.json";
export const BACKFILL_LEDGER = "learn-backfill-ledger.json";

/**
 * Loads the reconstructed stamps and ledger the proof tool wrote (copied to data/admin), once each: a stamp only for
 * an episode with none, every ledger line marked as backfill. The files are renamed ".done" afterwards.
 */
export async function ingestBackfill(db: Db, dataDir: string): Promise<{ stamps: number; ledger: number }> {
  const out = { stamps: 0, ledger: 0 };
  const stampsFile = path.join(dataDir, "admin", BACKFILL_STAMPS);
  if (fs.existsSync(stampsFile)) {
    const rows = JSON.parse(fs.readFileSync(stampsFile, "utf8")) as Array<{
      episode_id: string;
      code_commit: string | null;
      codex_sites: string[] | null;
      arms: Record<string, unknown>;
      confidence: string;
    }>;
    for (const r of rows) {
      const res = await db.query(
        `INSERT INTO episode_stamps (episode_id, code_commit, steps, source, confidence)
         VALUES ($1, $2, $3, 'backfill', $4) ON CONFLICT (episode_id) DO NOTHING RETURNING episode_id`,
        [r.episode_id, r.code_commit, JSON.stringify({ backfill: { codex_sites: r.codex_sites, arms: r.arms } }), r.confidence],
      );
      out.stamps += res.length;
    }
    fs.renameSync(stampsFile, `${stampsFile}.done`);
  }
  const ledgerFile = path.join(dataDir, "admin", BACKFILL_LEDGER);
  if (fs.existsSync(ledgerFile)) {
    const rows = JSON.parse(fs.readFileSync(ledgerFile, "utf8")) as Array<{ at: string; kind: string; commit?: string; summary: string }>;
    for (const r of rows) {
      await recordChange(db, {
        at: new Date(r.at),
        kind: (r.kind === "restart" ? "note" : r.kind) as ChangeKind,
        commit: r.commit,
        summary: r.summary,
        source: "backfill",
      });
      out.ledger++;
    }
    fs.renameSync(ledgerFile, `${ledgerFile}.done`);
  }
  return out;
}
