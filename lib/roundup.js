/**
 * lib/roundup.js — Phase 6b weekly longform compiler (selection layer).
 *
 * The V4 brief wants a 10-12 minute YouTube *long-form* every week, anchored
 * off the week's scored stories. The roundups table (migration 007) stores
 * one row per (channel, week_start) with chapters + segments; this module
 * populates it from the story_scores table and returns a selection the
 * downstream script writer (weekly_compile.js) can render to audio+video.
 *
 * Pipeline:
 *   1. Resolve the current week window (Mon..Sun in UTC unless overridden).
 *   2. Pull the week's stories + latest score for each.
 *   3. Filter out hard-stopped, rejected, already-reused-this-week stories.
 *   4. Rank by `total` with diversity penalties so we don't pick 6 posts
 *      about the same game.
 *   5. Slot 6 main segments (main-1..main-6) + up to 3 quickfire picks.
 *   6. Open a roundup row + persist roundup_items with chapter plan.
 *
 * Re-runnable within a week — items are UPSERTed on (roundup_id, slot).
 * The existing weekly_compile pipeline can read this selection (if it
 * wants to) or keep its legacy virality ranking (USE_SCORED_ROUNDUP=true
 * flips the switch).
 *
 * Chapter timing heuristic (matches assemble_longform expectations):
 *   intro          0..40s       chapter "Intro"
 *   main-1..6      40..~560s    ~80s per segment including transitions
 *   quickfire      ~560..680s   ~40s per pick, 3 picks max
 *   outro          last 20-30s  chapter "That's your week"
 */

const MAIN_SLOT_COUNT = 6;
const QUICKFIRE_SLOT_COUNT = 3;
const MAIN_SEGMENT_SECONDS = 80;
const QUICKFIRE_SEGMENT_SECONDS = 40;
const INTRO_SECONDS = 40;

function isoWeekStart(ref = new Date()) {
  const d = new Date(
    Date.UTC(
      ref.getUTCFullYear(),
      ref.getUTCMonth(),
      ref.getUTCDate(),
      0,
      0,
      0,
    ),
  );
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = (dayOfWeek + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function formatIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const nd = new Date(d);
  nd.setUTCDate(nd.getUTCDate() + n);
  return nd;
}

/**
 * Read the week's candidate stories + their latest score row.
 * Excludes stories already attached to a previous roundup (via
 * roundup_items on the same channel).
 */
function listWeekCandidates(repos, { channelId, weekStart, weekEnd }) {
  const fromIso = `${weekStart} 00:00:00`;
  const toIso = `${weekEnd} 23:59:59`;
  const rows = repos.db
    .prepare(
      `
        SELECT
          s.id                    AS id,
          s.title                 AS title,
          s.subreddit             AS subreddit,
          s.flair                 AS flair,
          s.url                   AS url,
          s.body                  AS body,
          s.full_script           AS full_script,
          s.timestamp             AS timestamp,
          s.created_at            AS created_at,
          s.channel_id            AS channel_id,
          s.breaking_score        AS breaking_score,
          sc.total                AS total,
          sc.decision             AS decision,
          sc.hard_stops           AS hard_stops,
          sc.roundup_suitability  AS roundup_suitability,
          sc.source_confidence    AS source_confidence,
          sc.story_importance     AS story_importance
        FROM stories s
        LEFT JOIN (
          SELECT story_id, MAX(scored_at) AS last_scored
          FROM story_scores
          GROUP BY story_id
        ) latest ON latest.story_id = s.id
        LEFT JOIN story_scores sc
               ON sc.story_id = latest.story_id
              AND sc.scored_at = latest.last_scored
        WHERE COALESCE(s.timestamp, s.created_at) >= ?
          AND COALESCE(s.timestamp, s.created_at) <= ?
          AND (s.channel_id IS NULL OR s.channel_id = COALESCE(?, s.channel_id))
          AND NOT EXISTS (
            SELECT 1 FROM roundup_items ri
            JOIN roundups r ON r.id = ri.roundup_id
            WHERE ri.story_id = s.id AND r.channel_id = COALESCE(?, r.channel_id)
          )
        ORDER BY COALESCE(sc.total, 0) DESC, s.breaking_score DESC
      `,
    )
    .all(fromIso, toIso, channelId, channelId);

  return rows.map((r) => ({
    ...r,
    hard_stops: safeParseArray(r.hard_stops),
  }));
}

function safeParseArray(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Diversity-aware greedy slotting. Given a ranked list of candidates,
 * pick main + quickfire slots while penalising repeated topics.
 *
 * Topic signature: first non-trivial word of the title (good enough to
 * keep us from picking "GTA 6 X", "GTA 6 Y", "GTA 6 Z" back-to-back).
 */
function slotCandidates(candidates, { mainN, quickfireN }) {
  const pool = candidates
    .filter((c) => !c.hard_stops || c.hard_stops.length === 0)
    .filter((c) => c.decision !== "reject" && c.decision !== "defer")
    // require at least a weakly-scored story (avoid picking a 0-scored stub)
    .filter((c) => (c.total || 0) >= 35);

  const selected = [];
  const topicCount = new Map();

  function topicKey(c) {
    const t = (c.title || "").toLowerCase();
    // strip filler words + punctuation
    const words = t
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
    return words.slice(0, 2).join(" ") || t.slice(0, 16);
  }

  function canTake(c) {
    const key = topicKey(c);
    return (topicCount.get(key) || 0) < 2; // never same topic 3+ times
  }

  function recordPick(c) {
    const key = topicKey(c);
    topicCount.set(key, (topicCount.get(key) || 0) + 1);
  }

  // Main slots: highest-scored stories, topic-diverse, must be at least
  // "review" quality (decision != defer && total >= 55 ideally).
  for (const c of pool) {
    if (selected.length >= mainN) break;
    if ((c.total || 0) < 55) continue;
    if (!canTake(c)) continue;
    selected.push({ ...c, __kind: "main" });
    recordPick(c);
  }

  // Backfill main from whatever's left if we didn't reach mainN.
  if (selected.length < mainN) {
    for (const c of pool) {
      if (selected.length >= mainN) break;
      if (selected.some((s) => s.id === c.id)) continue;
      if (!canTake(c)) continue;
      selected.push({ ...c, __kind: "main" });
      recordPick(c);
    }
  }

  const quickfire = [];
  // Quickfire picks: prefer stories with high roundup_suitability
  // (evergreen flavour) and different topics from the main picks.
  const quickfirePool = pool
    .filter((c) => !selected.some((s) => s.id === c.id))
    .sort(
      (a, b) =>
        (b.roundup_suitability || 0) - (a.roundup_suitability || 0) ||
        (b.total || 0) - (a.total || 0),
    );

  for (const c of quickfirePool) {
    if (quickfire.length >= quickfireN) break;
    if (!canTake(c)) continue;
    quickfire.push({ ...c, __kind: "quickfire" });
    recordPick(c);
  }

  return { main: selected, quickfire };
}

const STOP_WORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "into",
  "just",
  "will",
  "have",
  "been",
  "your",
  "they",
  "their",
  "what",
  "when",
  "where",
  "which",
  "about",
  "after",
  "before",
  "over",
  "report",
  "reports",
  "rumour",
  "rumor",
  "leak",
  "leaked",
  "news",
  "says",
  "said",
  "breaking",
]);

/**
 * Build the chapter plan for the roundup. Returns an array of
 * `{ slot, chapter_title, chapter_start_s }` objects matching the
 * roundup_items schema. The script writer downstream will fill in the
 * segment_script field.
 */
function buildChapters(selection) {
  const chapters = [];
  let cursor = INTRO_SECONDS;
  chapters.push({
    slot: "intro",
    chapter_title: "Intro",
    chapter_start_s: 0,
  });
  for (let i = 0; i < selection.main.length; i++) {
    const s = selection.main[i];
    chapters.push({
      slot: `main-${i + 1}`,
      story_id: s.id,
      chapter_title: truncateTitle(s.title),
      chapter_start_s: cursor,
    });
    cursor += MAIN_SEGMENT_SECONDS;
  }
  if (selection.quickfire.length) {
    chapters.push({
      slot: "quickfire-header",
      chapter_title: "Quickfire",
      chapter_start_s: cursor,
    });
    for (let i = 0; i < selection.quickfire.length; i++) {
      const s = selection.quickfire[i];
      chapters.push({
        slot: `quickfire-${i + 1}`,
        story_id: s.id,
        chapter_title: truncateTitle(s.title),
        chapter_start_s: cursor,
      });
      cursor += QUICKFIRE_SEGMENT_SECONDS;
    }
  }
  chapters.push({
    slot: "outro",
    chapter_title: "That's your week",
    chapter_start_s: cursor,
  });
  return { chapters, total_duration_s: cursor + 25 };
}

function truncateTitle(t) {
  if (!t) return "Untitled";
  return t.length > 55 ? t.slice(0, 52).trimEnd() + "..." : t;
}

/**
 * Main entry point. Builds (or updates) the roundup row for the current
 * ISO week. Re-runnable — existing items get UPSERTed, not duplicated.
 *
 * Options:
 *   now         override "today" for backfill / testing
 *   channelId   restrict to one channel (defaults to process.env.CHANNEL)
 *   mainN       override main-slot count
 *   quickfireN  override quickfire count
 *   dryRun      compute selection but don't touch the DB
 *   log         logger (defaults to console)
 */
function buildWeeklyRoundup({
  repos,
  now = new Date(),
  channelId = process.env.CHANNEL || null,
  mainN = MAIN_SLOT_COUNT,
  quickfireN = QUICKFIRE_SLOT_COUNT,
  dryRun = false,
  log = console,
} = {}) {
  if (!repos) repos = require("./repositories").getRepos();

  const weekStart = isoWeekStart(now);
  const weekEnd = addDays(weekStart, 6);
  const weekStartIso = formatIsoDate(weekStart);
  const weekEndIso = formatIsoDate(weekEnd);

  const candidates = listWeekCandidates(repos, {
    channelId,
    weekStart: weekStartIso,
    weekEnd: weekEndIso,
  });
  log.log(
    `[roundup] week ${weekStartIso}..${weekEndIso} channel=${channelId || "*"} ` +
      `candidates=${candidates.length}`,
  );

  if (!candidates.length) {
    log.log(
      "[roundup] no candidates for this week — either nothing scored yet " +
        "or all stories rejected/hard-stopped",
    );
    return { skipped: true, reason: "no_candidates" };
  }

  const selection = slotCandidates(candidates, { mainN, quickfireN });

  if (!selection.main.length) {
    log.log(
      "[roundup] no story met the main-slot threshold (total >= 55) — " +
        "skipping for the week",
    );
    return { skipped: true, reason: "below_threshold" };
  }

  const { chapters, total_duration_s } = buildChapters(selection);

  log.log(
    `[roundup] selected ${selection.main.length} main + ${selection.quickfire.length} quickfire, ` +
      `planned duration ~${Math.round(total_duration_s / 60)} min`,
  );

  if (dryRun) {
    return { dryRun: true, selection, chapters, total_duration_s };
  }

  // Persist the roundup + items. openWeek is idempotent; addItem UPSERTs
  // on (roundup_id, slot), so running this multiple times per week just
  // refreshes the slotting.
  const roundup = repos.roundups.openWeek(
    channelId || "pulse-gaming",
    weekStartIso,
    weekEndIso,
  );

  // Capture chapter metadata on the roundup row so the downstream
  // renderer has one artefact to read from.
  repos.roundups.update(roundup.id, {
    chapters,
  });

  for (let i = 0; i < selection.main.length; i++) {
    const s = selection.main[i];
    repos.roundups.addItem(roundup.id, {
      story_id: s.id,
      slot: `main-${i + 1}`,
      chapter_title: truncateTitle(s.title),
      chapter_start_s: chapters.find((c) => c.slot === `main-${i + 1}`)
        .chapter_start_s,
    });
  }
  for (let i = 0; i < selection.quickfire.length; i++) {
    const s = selection.quickfire[i];
    repos.roundups.addItem(roundup.id, {
      story_id: s.id,
      slot: `quickfire-${i + 1}`,
      chapter_title: truncateTitle(s.title),
      chapter_start_s: chapters.find((c) => c.slot === `quickfire-${i + 1}`)
        .chapter_start_s,
    });
  }

  log.log(`[roundup] persisted roundup #${roundup.id} with chapter plan`);

  return {
    roundup_id: roundup.id,
    week_start: weekStartIso,
    week_end: weekEndIso,
    main_count: selection.main.length,
    quickfire_count: selection.quickfire.length,
    total_duration_s,
    selection,
    chapters,
  };
}

/**
 * Read a roundup back with its fully-hydrated items (story rows + slot
 * metadata). Used by the downstream script compiler and the Phase 7
 * repurposing pipeline.
 */
function loadRoundup(repos, roundupId) {
  const roundup = repos.roundups.get(roundupId);
  if (!roundup) return null;
  const items = repos.roundups.items(roundupId);
  const storyIds = items.map((i) => i.story_id);
  const stories = storyIds.length ? repos.stories.listByIds(storyIds) : [];
  const storyById = Object.fromEntries(stories.map((s) => [s.id, s]));
  return {
    ...roundup,
    items: items.map((i) => ({ ...i, story: storyById[i.story_id] || null })),
  };
}

module.exports = {
  buildWeeklyRoundup,
  loadRoundup,
  listWeekCandidates,
  slotCandidates,
  buildChapters,
  isoWeekStart,
  MAIN_SLOT_COUNT,
  QUICKFIRE_SLOT_COUNT,
};
