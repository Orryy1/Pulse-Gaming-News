import type { Db } from "./db.ts";
import type { StoryCluster } from "./discovery/cluster.ts";
import type { Script, FactCheck } from "./editorial/schema.ts";

export const STATUSES = [
  "selected", //    story chosen, nothing produced yet
  "scripted", //    script written and fact-checked
  "voiced", //      narration + timings on disk
  "rendered", //    MP4 rendered and passed QA
  "awaiting_approval",
  "approved",
  "uploading", //   session may exist; never create a second one blindly
  "uploaded", //    video id known; waiting for processing
  "published", //   terminal success
  "rejected", //    terminal: editorial or human decision
  "failed", //      terminal: gave up after retries or a fatal error
] as const;
export type Status = (typeof STATUSES)[number];

export interface Episode {
  id: string;
  story_hash: string;
  status: Status;
  story_json: StoryCluster;
  script_json: Script | null;
  factcheck_json: FactCheck | null;
  assets_json: EpisodeAssets | null;
  qa_json: Record<string, unknown> | null;
  approval_mode: string | null;
  approved_by: string | null;
  approval_requested_at: string | null;
  upload_session_uri: string | null;
  youtube_video_id: string | null;
  youtube_status: string | null;
  publish_at: string | null;
  lane: string;
  priority: number;
  slot_at: string | null;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EpisodeAssets {
  /** Media was gathered a second time, richer, after a red media rubric. */
  rich?: boolean;
  /** A Short cut from a long ranking: the section's seconds in the long video and the files cut from it. */
  cutdown?: { start: number; end: number; video: string; background: string };
  audio?: string;
  words?: Array<{ text: string; start: number; end: number }>;
  durationSeconds?: number;
  srt?: string; // captions.srt, uploaded as the video's English caption track
  voice?: { provider: "local" | "elevenlabs"; id: string; name: string }; // who narrated, for the Discord card and analytics
  /** The desk experiment: a second presenter asked the viewer's question before the take. */
  desk?: { voice: { id: string; name: string }; question: string };
  /** The new-look test: this Short got the editor's dressing (src/render/Short.tsx `suite`). */
  suite?: boolean;
  /** The new-look opening: the hero art's subject cut out by the depth model (src/render/parallax.ts). */
  heroCut?: { fg: string; x?: number };
  plan?: import("./render/plan.ts").RenderPlan; // the render plan, persisted so a retried render is identical
  images?: Array<{
    file: string;
    kind: string;
    aspect: number;
    sourceUrl: string;
    provenance: string;
    blurFile?: string;
    beatIndex?: number;
    moment?: number;
    label?: string;
    wordy?: boolean;
    layers?: { bg: string; mid: string; fg: string; fgx?: number }; // 2.5D depth layers (src/render/parallax.ts)
  }>; // wordy: the local screen saw menu or HUD text on it
  video?: string;
  poster?: string;
  musicFile?: string | null;
  clips?: Array<{
    file: string;
    sourceUrl: string;
    provenance: string;
    durationSeconds: number;
    blurFile?: string;
    beatIndex?: number;
    role?: "hook";
    stock?: boolean;
    audio?: boolean;
    motion?: number;
    luma?: number;
    label?: string;
    reason?: string;
    startSeconds?: number;
    moment?: number;
    credit?: string;
  }>;
  steam?: {
    appId: number;
    name: string;
    facts: import("./assets/steam.ts").SteamFacts;
  };
  longPlan?: import("./render/longplan.ts").LongPlan; // the long-form render plan
  /** Zoom-to-the-detail annotations (src/assets/annotate.ts): the sentence, its picture and where the named thing sits. */
  annotations?: Array<{ entry: number; moment: number; image: number; box: [number, number, number, number]; label: string }>;
  breaks?: Array<{ start: number; end: number }>; // a documentary's breathers before each chapter (seconds, narration silent)
  thumb?: string; // thumb.jpg for the long-form video
  thumbVariants?: string[]; // thumb_b.jpg, thumb_c.jpg: extra designs for YouTube's Test & compare
  officialTrailer?: {
    videoId: string;
    title: string;
    publisher: string;
    channelTitle: string;
    url: string;
    clipSeconds: number;
  }; // the publisher's YouTube trailer, for games not on Steam
}

export async function getEpisode(
  db: Db,
  id: string,
): Promise<Episode | undefined> {
  const [row] = await db.query<Episode>(
    `SELECT * FROM episodes WHERE id = $1`,
    [id],
  );
  return row;
}

export async function listEpisodes(db: Db, limit = 20): Promise<Episode[]> {
  return db.query<Episode>(
    `SELECT * FROM episodes ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
}

/** Episodes that can be advanced right now, oldest first. */
export async function dueEpisodes(
  db: Db,
  now = new Date(),
): Promise<Episode[]> {
  // The clock is passed in so holds (a slot, a quota reset) are judged by the factory's time, not the database's.
  return db.query<Episode>(
    `SELECT * FROM episodes
     WHERE status NOT IN ('published','rejected','failed')
       AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
     ORDER BY priority DESC, created_at ASC`,
    [now],
  );
}

export async function createEpisode(
  db: Db,
  id: string,
  cluster: StoryCluster,
  lane: { lane: string; priority: number; slotAt?: Date } = {
    lane: "news",
    priority: 50,
  },
): Promise<boolean> {
  // cluster may carry gameHint from the editor's selection.
  const rows = await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, priority, slot_at) VALUES ($1, $2, 'selected', $3, $4, $5, $6)
     ON CONFLICT (story_hash) DO NOTHING RETURNING id`,
    [
      id,
      cluster.hash,
      JSON.stringify(cluster),
      lane.lane,
      lane.priority,
      lane.slotAt ?? null,
    ],
  );
  return rows.length === 1;
}

/**
 * Compare-and-set transition: only moves the row if it is still in `from`,
 * so a duplicate worker can never advance (or upload) the same step twice.
 */
export async function transition(
  db: Db,
  id: string,
  from: Status,
  to: Status,
  fields: Partial<Record<keyof Episode, unknown>> = {},
): Promise<boolean> {
  const cols = Object.keys(fields);
  const sets = cols.map((c, i) => `${c} = $${i + 4}`);
  const values = cols.map((c) => {
    const v = (fields as Record<string, unknown>)[c];
    return v !== null && typeof v === "object" && !(v instanceof Date)
      ? JSON.stringify(v)
      : v;
  });
  // A step change resets the retry bookkeeping unless the caller sets it.
  const defaults = [
    "attempts" in fields ? "" : "attempts = 0",
    "last_error" in fields ? "" : "last_error = NULL",
    "next_attempt_at" in fields ? "" : "next_attempt_at = NULL",
  ].filter(Boolean);
  const rows = await db.query(
    `UPDATE episodes SET ${["status = $3", "updated_at = now()", ...defaults, ...sets].join(", ")}
     WHERE id = $1 AND status = $2 RETURNING id`,
    [id, from, to, ...values],
  );
  return rows.length === 1;
}

export async function recordFailure(
  db: Db,
  id: string,
  error: string,
  retryInMinutes: number,
): Promise<number> {
  const [row] = await db.query<{ attempts: number }>(
    `UPDATE episodes SET attempts = attempts + 1, last_error = $2, updated_at = now(),
       next_attempt_at = now() + make_interval(mins => $3)
     WHERE id = $1 RETURNING attempts`,
    [id, error.slice(0, 2000), retryInMinutes],
  );
  return row?.attempts ?? 0;
}

export async function logEvent(
  db: Db,
  episodeId: string | null,
  kind: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO events (episode_id, kind, detail) VALUES ($1, $2, $3)`,
    [episodeId, kind, JSON.stringify(detail)],
  );
}

export async function markSeen(
  db: Db,
  hash: string,
  title: string,
  decision: string,
  reason = "",
): Promise<void> {
  await db.query(
    `INSERT INTO seen_stories (story_hash, title, decision, reason) VALUES ($1, $2, $3, $4)
     ON CONFLICT (story_hash) DO UPDATE SET decision = EXCLUDED.decision, reason = EXCLUDED.reason`,
    [hash, title.slice(0, 300), decision, reason.slice(0, 500)],
  );
}

export async function seenHashes(db: Db): Promise<Set<string>> {
  const rows = await db.query<{ story_hash: string }>(
    `SELECT story_hash FROM seen_stories WHERE seen_at > now() - interval '7 days'`,
  );
  return new Set(rows.map((r) => r.story_hash));
}

export async function recentHeadlines(db: Db, days = 5): Promise<string[]> {
  const rows = await db.query<{ h: string }>(
    `SELECT COALESCE(script_json->>'headline', story_json->>'headline') AS h FROM episodes
     WHERE created_at > now() - make_interval(days => $1) AND status <> 'failed' ORDER BY created_at DESC LIMIT 30`,
    [days],
  );
  return rows.map((r) => r.h).filter(Boolean);
}

/** Episodes started today (UTC) that have not failed or been rejected. */
/** Episodes created today in the owner's day (Europe/London), excluding failed and rejected. */
/** Episodes made today (all lanes but the owner's gameplay Shorts, which are extra), or one lane's. */
export async function countToday(
  db: Db,
  timeZone = "Europe/London",
  lane?: string,
): Promise<number> {
  // The owner's day: "today" rolls over at local midnight in winter and summer alike.
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes
      WHERE created_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
        AND status NOT IN ('failed','rejected')
        AND (($2::text IS NULL AND lane NOT IN ('gameplay','twin')) OR lane = $2)`,
    [timeZone, lane ?? null],
  );
  return Number(row?.n ?? 0);
}

/** Episodes mid-production (not waiting on approval, YouTube or a terminal state). Gameplay Shorts are extra and never hold the news back. */
export async function countProducing(db: Db): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE status IN ('selected','scripted','voiced','rendered') AND lane NOT IN ('gameplay','twin')`,
  );
  return Number(row?.n ?? 0);
}

/** Slot instants already claimed by live episodes. */
export async function takenSlots(db: Db): Promise<Date[]> {
  const rows = await db.query<{ slot_at: string }>(
    `SELECT slot_at FROM episodes WHERE slot_at IS NOT NULL AND status NOT IN ('failed','rejected')`,
  );
  return rows.map((r) => new Date(r.slot_at));
}
