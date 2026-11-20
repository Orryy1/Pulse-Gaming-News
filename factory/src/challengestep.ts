// The challenge series inside the factory (CHALLENGE_SERIES, src/challenge.ts): the gameplay lane gives a tagged clip
// its challenge, number and count; the upload adds the links; the first public moment links the episode before. The
// database parts (claims in the settings table) and the file reads (the VOD index, the HUD tracks) live here; the rules
// are in src/challenge.ts.

import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { logEvent, type Episode } from "./episodes.ts";
import type { Script } from "./editorial/schema.ts";
import type { GameplayMeta } from "./gameplay.ts";
import { dayKey } from "./lanes.ts";
import { errorMessage, log } from "./lib/util.ts";
import { readAsks } from "./streamasks/job.ts";
import {
  closeQuiet,
  ideasReport,
  rankChallengeIdeas,
  challengeEpisodeTitle,
  challengeForClip,
  challengePlaylist,
  challengeSeriesTitle,
  challengeTally,
  challengeTitleProblems,
  editRegistry,
  episodeKeyFor,
  finalKeyFor,
  nextEpisode,
  noteStream,
  parseChallengeTag,
  readRegistry,
  verdictLine,
  withNextEpisode,
  withPreviousEpisode,
  type Challenge,
  type ChallengeStory,
  type ChallengeTally,
} from "./challenge.ts";
import { listVodIndexes } from "./vodindex/schema.ts";
import { vodHudDir } from "./hudreader/telemetry.ts";
import {
  spoilerHits,
  spoilerNotes,
  spoilerWindows,
} from "./sceneindex/spoilers.ts";

type Deps = { db: Db; cfg: Config; now: () => Date };

// ------------------------------------------------------------------ claims

/** Episodes claimed for a challenge, after claims whose episode failed, was rejected or is gone are let go. */
export async function claimedEpisodes(
  db: Db,
  slug: string,
): Promise<Map<number, string>> {
  await db.query(
    `DELETE FROM settings s WHERE s.key LIKE $1
       AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.id = s.value AND e.status NOT IN ('rejected','failed'))`,
    [`challenge:${slug}:%`],
  );
  const rows = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key LIKE $1`,
    [`challenge:${slug}:ep:%`],
  );
  return new Map(rows.map((r) => [Number(r.key.split(":").at(-1)), r.value]));
}

/** Claims a key for an episode: true when it is now (or already was) this episode's (the primary key makes it atomic). */
async function claim(db: Db, key: string, episode: string): Promise<boolean> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    [key, episode],
  );
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [key],
  );
  return row?.value === episode;
}

/** The next free episode number of a challenge, claimed for this episode; undefined when three tries all lost. */
export async function claimEpisode(
  db: Db,
  slug: string,
  episode: string,
): Promise<number | undefined> {
  for (let i = 0; i < 3; i++) {
    const n = nextEpisode((await claimedEpisodes(db, slug)).keys());
    if (await claim(db, episodeKeyFor(slug, n), episode)) return n;
  }
  return undefined;
}

// ------------------------------------------------------------------ the count

/**
 * The count before this clip: every indexed recording of the challenge from an earlier day (its heard words and, when
 * the HUD reader has read it, its events), and the clip's own words.
 */
export async function tallyFor(
  cfg: Pick<Config, "dataDir">,
  slug: string,
  clipDate: string,
  clipWords: string | undefined,
): Promise<ChallengeTally> {
  const parts: Array<{ events?: Array<{ kind: string }>; words?: string }> = [];
  for (const v of await listVodIndexes(cfg.dataDir).catch(() => [])) {
    if (parseChallengeTag(v.title)?.slug !== slug) continue;
    if (!v.recordedOn || v.recordedOn >= clipDate) continue;
    const track = await fs
      .readFile(
        path.join(vodHudDir(cfg.dataDir, v.vodId), "track.json"),
        "utf8",
      )
      .then((t) => JSON.parse(t) as { events?: Array<{ kind: string }> })
      .catch(() => undefined);
    parts.push({
      words: v.lines.map((l) => l.text).join(" "),
      ...(Array.isArray(track?.events) ? { events: track!.events } : {}),
    });
  }
  if (clipWords?.trim()) parts.push({ words: clipWords });
  return challengeTally(parts);
}

// ------------------------------------------------------------------ the gameplay lane

/** The clip's own heard words (words.json beside it), for the count. */
async function clipWords(dir: string): Promise<string> {
  const w = await fs
    .readFile(path.join(dir, "words.json"), "utf8")
    .then((t) => JSON.parse(t) as Array<{ text: string }>)
    .catch(() => []);
  return w.map((x) => x.text).join(" ");
}

/**
 * CHALLENGE_SERIES: a gameplay clip whose stream title carries a challenge tag becomes that challenge's next episode,
 * or its final "verdict" once the challenge has ended. A rehearsal, a story spoiler during the window or a challenge
 * whose verdict is already made leaves the Short as it was. Returns true when the clip is now a challenge episode
 * (the GTA 6 Day N daily then leaves it alone).
 */
export async function applyChallenge(
  s: Deps,
  ep: Episode,
  script: Script,
  meta: Partial<Pick<GameplayMeta, "rehearsal" | "source" | "live">>,
): Promise<boolean> {
  if (!s.cfg.challenge.enabled) return false;
  const ref = ep.story_json.gameplay;
  if (!ref || ref.rehearsal || meta.rehearsal) return false;
  const had = ep.story_json.challenge;
  if (had) {
    // A retried step: the number is already this episode's.
    script.series = "challenge";
    script.youtube.title = challengeEpisodeTitle(
      had.series,
      had.episode,
      [script.youtube.title, ref.review.question],
      had.final,
    );
    return true;
  }
  const title = meta.source?.title ?? "";
  const found = challengeForClip(readRegistry(s.cfg.dataDir), title);
  if (!found) return false;
  const now = s.now();
  const game = ref.review.game_title || script.game_title;
  let challenge: Challenge | undefined = found.challenge;
  if (!challenge) {
    // The relay was not running when it was announced: the clip's own title starts it.
    const date = dayKey(now, s.cfg.timezone);
    challenge = editRegistry(s.cfg.dataDir, (r) =>
      noteStream(
        r,
        {
          id:
            meta.live?.stream_id ?? path.basename(meta.source?.file ?? ref.id),
          title,
          date,
          startedAt: meta.live?.moment_at ?? now.toISOString(),
          game,
        },
        now,
        meta.live ? "twitch" : "recording",
      ),
    ).challenge;
  }
  if (!challenge) return false;
  // During a spoiler window a challenge episode still keeps the story out (the gameplay lane's own hold applies too).
  const spoilers = spoilerNotes(
    spoilerHits(
      [
        script.youtube.title,
        script.headline,
        ref.review.question,
        ref.review.result,
        ref.review.description,
      ].join("\n"),
      s.cfg.spoilerGuard ? spoilerWindows() : [],
      now,
      [game],
    ),
  );
  if (ref.review.spoiler || spoilers.length) {
    await logEvent(s.db, ep.id, "challenge_skipped", {
      slug: challenge.slug,
      why: spoilers.slice(0, 3),
    });
    return false;
  }
  const series = challengeSeriesTitle(challenge.rule, challenge.game || game);
  const final = Boolean(challenge.ended);
  let episode: number | undefined;
  if (final) {
    if (!(await claim(s.db, finalKeyFor(challenge.slug), ep.id))) {
      await logEvent(s.db, ep.id, "challenge_skipped", {
        slug: challenge.slug,
        why: ["its verdict is already made"],
      });
      return false;
    }
    episode = nextEpisode((await claimedEpisodes(s.db, challenge.slug)).keys());
    await claim(s.db, episodeKeyFor(challenge.slug, episode), ep.id);
  } else episode = await claimEpisode(s.db, challenge.slug, ep.id);
  if (episode === undefined) return false;
  const tally = await tallyFor(
    s.cfg,
    challenge.slug,
    dayKey(now, s.cfg.timezone),
    await clipWords(ref.dir),
  );
  const story: ChallengeStory = {
    slug: challenge.slug,
    rule: challenge.rule,
    game: challenge.game || game,
    series,
    episode,
    tally,
    ...(final ? { final: true, outcome: challenge.ended!.outcome } : {}),
  };
  let t = challengeEpisodeTitle(
    series,
    episode,
    [script.youtube.title, ref.review.question],
    final,
  );
  if (challengeTitleProblems(t, series).length)
    t = challengeEpisodeTitle(series, episode, [], final);
  script.series = "challenge";
  script.youtube.title = t;
  if (final)
    script.youtube.description = `${verdictLine(story)}\n${script.youtube.description}`;
  await s.db.query(
    `UPDATE episodes SET story_json = story_json || jsonb_build_object('challenge', $2::jsonb) WHERE id = $1`,
    [ep.id, JSON.stringify(story)],
  );
  ep.story_json.challenge = story;
  await logEvent(s.db, ep.id, "challenge_numbered", {
    slug: challenge.slug,
    episode,
    final,
    title: t,
    tally,
  });
  return true;
}

// ------------------------------------------------------------------ links

async function playlistId(db: Db, series: string): Promise<string | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [`playlist:${series}`],
  );
  return row?.value || undefined;
}

/** The latest earlier episode of the challenge that is published by `now`. */
export async function previousEpisode(
  db: Db,
  slug: string,
  episode: number,
  now: Date,
): Promise<{ episode: number; videoId: string } | undefined> {
  const [row] = await db.query<{ n: string | number; video_id: string }>(
    `SELECT (story_json->'challenge'->>'episode')::int AS n, youtube_video_id AS video_id FROM episodes
      WHERE status = 'published' AND youtube_video_id IS NOT NULL
        AND story_json->'challenge'->>'slug' = $1
        AND (story_json->'challenge'->>'episode')::int < $2
        AND (publish_at IS NULL OR publish_at <= $3::timestamptz)
      ORDER BY (story_json->'challenge'->>'episode')::int DESC LIMIT 1`,
    [slug, episode, now],
  );
  return row ? { episode: Number(row.n), videoId: row.video_id } : undefined;
}

/** Just before upload: the episode before and the playlist, for the description. */
export async function refreshChallengeLinks(
  s: Deps,
  ep: Episode,
): Promise<Episode> {
  const story = ep.story_json.challenge;
  if (!story || !s.cfg.challenge.enabled) return ep;
  const prev = await previousEpisode(
    s.db,
    story.slug,
    story.episode,
    ep.publish_at ? new Date(ep.publish_at) : s.now(),
  );
  const id = await playlistId(s.db, story.series);
  const next: ChallengeStory = {
    ...story,
    ...(prev ? { previous: prev } : {}),
    ...(id ? { playlistId: id } : {}),
  };
  await s.db.query(
    `UPDATE episodes SET story_json = story_json || jsonb_build_object('challenge', $2::jsonb) WHERE id = $1`,
    [ep.id, JSON.stringify(next)],
  );
  return { ...ep, story_json: { ...ep.story_json, challenge: next } };
}

/** Whether the episode after this one is already made and claimed (so the comment may say it is coming). */
export async function nextEpisodeMade(
  db: Db,
  story: ChallengeStory,
): Promise<boolean> {
  const claimed = await claimedEpisodes(db, story.slug);
  return [...claimed.keys()].some((n) => n > story.episode);
}

/** The playlist an episode joins (filed by addToSeries). */
export const challengeShelf = (story: ChallengeStory) =>
  challengePlaylist(story);

/**
 * Once an episode is public: the one before gets its "Next episode:" line, and this one's "Previous episode:" line is
 * put right when the one before went up after it was uploaded. Once per episode; a failure is logged, never fatal.
 */
export async function linkChallenge(
  s: Deps,
  ep: Episode,
  yt: Partial<{
    rewriteDescriptions: (
      id: string,
      fn: (d: string, lang: string) => string,
    ) => Promise<number>;
  }>,
  spend: (units: number) => Promise<void>,
): Promise<void> {
  const story = ep.story_json.challenge;
  if (
    !story ||
    !ep.youtube_video_id ||
    !s.cfg.challenge.enabled ||
    s.cfg.dryRun ||
    !yt.rewriteDescriptions
  )
    return;
  const [done] = await s.db.query(
    `SELECT 1 FROM events WHERE episode_id = $1 AND kind = 'challenge_linked' LIMIT 1`,
    [ep.id],
  );
  if (done) return;
  const prev = await previousEpisode(s.db, story.slug, story.episode, s.now());
  try {
    if (prev) {
      await yt.rewriteDescriptions(prev.videoId, (d) =>
        withNextEpisode(d, ep.youtube_video_id!),
      );
      await spend(51);
      if (story.previous?.videoId !== prev.videoId) {
        await yt.rewriteDescriptions(ep.youtube_video_id, (d) =>
          withPreviousEpisode(d, prev.videoId),
        );
        await spend(51);
      }
    }
    await logEvent(s.db, ep.id, "challenge_linked", {
      slug: story.slug,
      episode: story.episode,
      previous: prev?.episode ?? null,
    });
  } catch (err) {
    log("warn", "challenge link failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
    await logEvent(s.db, ep.id, "challenge_link_failed", {
      error: errorMessage(err).slice(0, 300),
    });
  }
}

/** The counter for the render (pure): shown after the hook, gone before the last half second; undefined when empty. */
export function challengeCounter(
  story: ChallengeStory | undefined,
  hookEnd: number,
  duration: number,
):
  | import("./render/components/ChallengeCounter.tsx").ChallengeCounterProps
  | undefined {
  if (!story) return undefined;
  const items = [
    ...(story.tally.attempt !== undefined
      ? [{ label: "ATTEMPT", value: story.tally.attempt }]
      : []),
    ...(story.tally.missions !== undefined
      ? [{ label: "MISSIONS", value: story.tally.missions }]
      : []),
    ...(story.tally.ruleBreaks !== undefined
      ? [{ label: "RULE BREAKS", value: story.tally.ruleBreaks }]
      : []),
  ];
  const from = Math.max(0, hookEnd);
  const until = Math.max(from, duration - 0.5);
  if (until - from < 2) return undefined;
  return {
    title: story.final ? "THE VERDICT" : `EP ${story.episode}`,
    rule: story.rule.toUpperCase().slice(0, 24),
    items,
    from,
    until,
  };
}

// ------------------------------------------------------------------ housekeeping and ideas

/** Where the ideas report goes: CHALLENGE_IDEAS_FILE, else <data>/reports/Challenge ideas.md. */
export const ideasFileFor = (cfg: Pick<Config, "dataDir" | "challenge">) =>
  cfg.challenge.ideasFile || path.join(cfg.dataDir, "reports", "Challenge ideas.md");

/**
 * The factory's own pass (every few hours, CHALLENGE_SERIES on): recordings whose names carry a tag file their
 * challenge (the relay may not have been running), quiet challenges close, and the ideas report is written from the
 * stream asks and the last 30 days of comments. Returns what it did, for the log.
 */
export async function challengeHousekeeping(
  cfg: Config,
  db: Db,
  notify: (m: { content: string; level?: "info" }) => Promise<unknown>,
  now: Date,
): Promise<{ filed: number; closed: number; ideas: string }> {
  let filed = 0;
  for (const v of await listVodIndexes(cfg.dataDir).catch(() => [])) {
    if (!parseChallengeTag(v.title)) continue;
    const r = editRegistry(cfg.dataDir, (reg) =>
      noteStream(
        reg,
        {
          id: v.vodId,
          title: v.title,
          date: v.recordedOn || dayKey(now, cfg.timezone),
          startedAt: v.recordedOn ? `${v.recordedOn}T12:00:00.000Z` : now.toISOString(),
          game: v.game || "Grand Theft Auto VI",
        },
        now,
        "recording",
      ),
    );
    if (r.started) {
      filed++;
      await notify({
        content: `🎯 A recording carries a challenge tag: "${challengeSeriesTitle(r.challenge!.rule, r.challenge!.game)}" is now a numbered series.`,
      });
    }
  }
  const q = editRegistry(cfg.dataDir, (reg) => closeQuiet(reg, now, cfg.challenge.quietDays));
  for (const c of q.closed)
    await notify({
      level: "info",
      content: `🏁 No "[CHALLENGE: ${c.rule}]" stream for ${cfg.challenge.quietDays} days, so that challenge is closed; its next clip is the final episode.`,
    });
  const texts: Array<{ text: string; weight?: number }> = [];
  const store = await readAsks(cfg.dataDir).catch(() => ({ asks: [] as Array<{ question: string; claim: string; mentions: Array<{ text: string }>; mentionCount: number }> }));
  for (const a of store.asks) {
    texts.push({ text: `${a.question} ${a.claim}`, weight: Math.max(1, a.mentionCount) });
    for (const m of a.mentions ?? []) texts.push({ text: m.text });
  }
  const comments = await db
    .query<{ comment: string }>(`SELECT comment FROM comment_replies WHERE created_at > $1::timestamptz - interval '30 days'`, [now])
    .catch(() => [] as Array<{ comment: string }>);
  for (const c of comments) texts.push({ text: c.comment });
  const done = readRegistry(cfg.dataDir).challenges.map((c) => c.rule);
  const file = ideasFileFor(cfg);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, ideasReport(rankChallengeIdeas(texts, done), now));
  return { filed, closed: q.closed.length, ideas: file };
}
