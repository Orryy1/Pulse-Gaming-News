// The factory: one idempotent state machine advanced by a periodic tick.
// Each step reads its inputs from Postgres/disk and writes its outputs before
// the status moves, so any step can crash and be retried safely.

import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { withLease } from "./db.ts";
import type { Llm } from "./editorial/llm.ts";
import type { StoryCluster } from "./discovery/cluster.ts";
import type { ArticleText } from "./discovery/article.ts";
import type { Narration } from "./voice/elevenlabs.ts";
import type { VisualAsset, SteamApp, SteamFacts } from "./assets/steam.ts";
import { factsText } from "./assets/steam.ts";
import { capFootage, footageBudgetSeconds } from "./assets/footage.ts";
import { targetsFor, type FootageTarget } from "./assets/clipscore.ts";
import { evergreenToScript, selectEvergreenTopic, validateEvergreen, writeEvergreen, type EvergreenCandidate } from "./editorial/evergreen.ts";
import type { RenderInput } from "./render/render.ts";
import type { TechQa } from "./qa/media.ts";
import type { VisionQa } from "./editorial/schema.ts";
import type { YouTubeClient } from "./youtube/upload.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { COLOURS } from "./approval/discord.ts";
import { selectStory, writeScript, factCheck, validateScript } from "./editorial/editorial.ts";
import { narrationOf, type Script } from "./editorial/schema.ts";
import { buildTags, hashtags, keywordLead, pinnedComment, polishTitle } from "./editorial/seo.ts";
import { pickVoice } from "./voice/index.ts";
import { buildSegments, srtFromWords, type SegmentInput } from "./render/timeline.ts";
import { buildPlan, TAIL_SECONDS } from "./render/plan.ts";
import { blurPlate } from "./assets/plates.ts";
import { scorePlan, rubricSummary } from "./qa/rubric.ts";
import { LANE_PRIORITY, QUOTA, QUOTA_RESERVE_FOR_UPLOAD, dueSlot, evergreenDue, franchiseKey, inWindow, isBreaking, lastPublishAt, nextWindowStart, quotaAdd, quotaResetAt, quotaUsed, type Sighting } from "./lanes.ts";
import { buildResource, markerTag, SessionGone } from "./youtube/upload.ts";
import { signToken } from "./lib/crypto.ts";
import { FatalError, errorMessage, log, shortId } from "./lib/util.ts";
import {
  type Episode,
  type EpisodeAssets,
  countToday,
  createEpisode,
  dueEpisodes,
  getEpisode,
  logEvent,
  markSeen,
  recentHeadlines,
  recordFailure,
  seenHashes,
  transition,
  countProducing,
  takenSlots,
} from "./episodes.ts";

export interface Services {
  db: Db;
  cfg: Config;
  llm: Llm;
  discover(): Promise<StoryCluster[]>;
  discoverEvergreen(): Promise<EvergreenCandidate[]>;
  fetchArticle(url: string): Promise<ArticleText | undefined>;
  synthesise(text: string, outPath: string, voice?: { id: string; name: string }): Promise<Narration & { voice?: { provider: "local" | "elevenlabs"; id: string; name: string } }>;
  findGame(term: string): Promise<SteamApp | undefined>;
  gameFacts(app: SteamApp): Promise<SteamFacts>;
  fetchArt(app: SteamApp, episodeDir: string): Promise<VisualAsset[]>;
  fetchClips(app: SteamApp, episodeDir: string, targets: FootageTarget[], maxClips: number): Promise<VisualAsset[]>;
  downloadImage(url: string, dest: string): Promise<boolean>;
  imageAspect(file: string): Promise<number>;
  render(input: RenderInput): Promise<void>;
  normalise(input: string, output: string): Promise<void>;
  technicalQa(file: string, expectedSeconds: number, band?: { minSeconds: number; maxSeconds: number }): Promise<TechQa>;
  extractFrames(file: string, outDir: string, times: number[]): Promise<string[]>;
  visionQa(frames: string[], ctx: { headline: string; gameTitle: string }): Promise<VisionQa>;
  youtube(): YouTubeClient;
  /** true = delivered, false = failed, undefined/void = Discord not configured. */
  notify(msg: DiscordMessage): Promise<boolean | undefined | void>;
  /** True when PUBLIC_URL answers (or is local), so approval links could have been used. */
  publicReachable(): Promise<boolean>;
  now(): Date;
}

const IN_FLIGHT = ["selected", "scripted", "voiced", "rendered", "awaiting_approval", "approved", "uploading"];

export function episodeDir(cfg: Config, id: string): string {
  return path.join(cfg.dataDir, "episodes", id);
}

export function approvalLinks(cfg: Config, id: string) {
  const ttl = 3 * 24 * 3600;
  const t = (action: string) => signToken(`${action}:${id}`, cfg.appSecret, ttl);
  return {
    approve: `${cfg.publicUrl}/episodes/${id}/approve?t=${t("approve")}`,
    reject: `${cfg.publicUrl}/episodes/${id}/reject?t=${t("reject")}`,
    preview: `${cfg.publicUrl}/episodes/${id}/video.mp4?t=${t("preview")}`,
  };
}

// ---------------------------------------------------------------- selection

/**
 * Discovery on its own clock: fetch the feeds, cluster, and remember when each
 * story was first seen. Selection reads these sightings and never refetches.
 */
export async function discoverTick(s: Services): Promise<number> {
  const clusters = await s.discover();
  const now = s.now();
  for (const c of clusters) {
    await s.db.query(
      `INSERT INTO cluster_sightings (hash, headline, first_seen, last_seen, item_count, has_official, max_score, cluster_json)
       VALUES ($1, $2, least($3::timestamptz, $8::timestamptz), $3, $4, $5, $6, $7)
       ON CONFLICT (hash) DO UPDATE SET last_seen = EXCLUDED.last_seen, item_count = EXCLUDED.item_count,
         has_official = cluster_sightings.has_official OR EXCLUDED.has_official,
         max_score = greatest(cluster_sightings.max_score, EXCLUDED.max_score), cluster_json = EXCLUDED.cluster_json, headline = EXCLUDED.headline`,
      // first_seen never predates the poll but never postdates the newest article either, so a
      // restart does not make every old story look minutes old.
      [c.hash, c.headline, now, c.items.length, c.hasOfficial, c.score, JSON.stringify(c), new Date(c.newestAt)],
    );
  }
  // Age is measured on the pipeline's clock (s.now()), the same one that stamped last_seen.
  await s.db.query(`DELETE FROM cluster_sightings WHERE last_seen < $1::timestamptz - interval '7 days'`, [now]);
  return clusters.length;
}

async function recentSightings(s: Services): Promise<Array<{ cluster: StoryCluster; sighting: Sighting }>> {
  const rows = await s.db.query<Sighting & { cluster_json: StoryCluster }>(
    // Judged by the factory's clock, like every other hold, so the scheduler is testable.
    `SELECT hash, first_seen, last_seen, item_count, has_official, max_score, cluster_json FROM cluster_sightings WHERE last_seen > $2::timestamptz - ($1 || ' hours')::interval ORDER BY max_score DESC`,
    [String(s.cfg.maxStoryAgeHours), s.now()],
  );
  return rows.map((r) => ({ cluster: r.cluster_json, sighting: r }));
}

async function createFromChoice(s: Services, candidates: StoryCluster[], lane: { lane: string; priority: number; slotAt?: Date }, why: string): Promise<string | undefined> {
  const { db } = s;
  const choice = await selectStory(s.llm, candidates, await recentHeadlines(db));
  const picked = candidates[choice.candidate_index];
  if (!picked) {
    log("info", "editor passed on every candidate", { lane: lane.lane, reason: choice.reason });
    return undefined;
  }
  const id = shortId();
  const created = await createEpisode(db, id, { ...picked, gameHint: choice.game_title || undefined }, lane);
  await markSeen(db, picked.hash, picked.headline, created ? "selected" : "duplicate", choice.reason);
  if (!created) return undefined;
  await logEvent(db, id, "selected", { headline: picked.headline, reason: choice.reason, story_type: choice.story_type, score: picked.score, lane: lane.lane, slot_at: lane.slotAt?.toISOString() ?? null, why });
  log("info", "story selected", { id, lane: lane.lane, headline: picked.headline, slot: lane.slotAt?.toISOString() });
  return id;
}

/**
 * Two lanes, one producer. The breaking lane fires on a massive official story
 * seen for the first time minutes ago, any time inside its window, at most a
 * few times a day with a per-franchise cooldown. The news lane fills fixed
 * daily slots: an episode is started a lead time before its slot and
 * publishes at the slot. Episodes waiting on approval or YouTube never block
 * the next one; only MAX_PRODUCING episodes are mid-production at once.
 */
export async function maybeSelect(s: Services): Promise<string | undefined> {
  const { db, cfg } = s;
  const now = s.now();
  const paused = await selectionPause(db, now);
  if (paused) {
    log("info", "story selection paused", { reason: paused });
    return undefined;
  }
  if ((await countProducing(db)) >= cfg.maxProducing) return undefined;
  const total = await countToday(db, cfg.timezone);
  if (total >= cfg.dailyTarget) return undefined;

  const seen = await seenHashes(db);
  const sightings = (await recentSightings(s)).filter((x) => !seen.has(x.cluster.hash));
  const eligible = sightings.filter((x) => x.cluster.corroborated || (cfg.includeRumours && x.cluster.rumourSignals)).filter((x) => x.cluster.score > 0);

  // 1. Breaking lane.
  if (cfg.breakingEnabled && (await countToday(db, cfg.timezone, "news_breaking")) < cfg.breakingPerDay) {
    const rule = { scoreMin: cfg.breakingScoreMin, maxAgeMinutes: cfg.breakingMaxAgeMinutes, window: cfg.breakingWindow, timeZone: cfg.timezone };
    const cooled = new Set((await db.query<{ franchise: string }>(`SELECT franchise FROM breaking_log WHERE fired_at > $2::timestamptz - ($1 || ' hours')::interval`, [String(cfg.breakingCooldownHours), now])).map((r) => r.franchise));
    const breaking = eligible.filter((x) => isBreaking(x.cluster, x.sighting, now, rule) && !cooled.has(franchiseKey(x.cluster))).map((x) => x.cluster).slice(0, 4);
    if (breaking.length) {
      const id = await createFromChoice(s, breaking, { lane: "news_breaking", priority: LANE_PRIORITY.news_breaking }, "breaking: official, fresh and scored above the bar");
      if (id) {
        const ep = await getEpisode(db, id);
        await db.query(`INSERT INTO breaking_log (story_hash, franchise, episode_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [ep!.story_hash, franchiseKey(ep!.story_json), id]);
        await s.notify({ content: `🚨 Breaking lane: "${ep!.story_json.headline}" is being produced now.` });
        return id;
      }
    }
  }

  // 2. News lane: the next slot whose lead time has begun.
  const slot = dueSlot(now, { slots: cfg.newsSlots, leadMinutes: cfg.slotLeadMinutes, graceMinutes: cfg.slotGraceMinutes, timeZone: cfg.timezone }, await takenSlots(db));
  if (!slot) return maybeSelectEvergreen(s);
  const candidates = eligible.map((x) => x.cluster).slice(0, 12);
  if (candidates.length === 0) {
    log("info", "no eligible stories for the slot", { slot: slot.toISOString(), sightings: sightings.length });
    return undefined;
  }
  return createFromChoice(s, candidates, { lane: "news", priority: LANE_PRIORITY.news, slotAt: slot }, `news slot ${slot.toISOString()}`);
}

/**
 * Evergreen lane: on its days, a lead time before its slot, pick a ranking
 * topic from what people are buying and the franchise seeds, avoiding topics
 * covered in the last six months.
 */
export async function maybeSelectEvergreen(s: Services): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.evergreenEnabled) return undefined;
  const now = s.now();
  const due = evergreenDue(now, { days: cfg.evergreenDays, slot: cfg.evergreenSlot, leadMinutes: cfg.slotLeadMinutes + 45, graceMinutes: cfg.slotGraceMinutes, timeZone: cfg.timezone }, await takenSlots(db));
  if (!due) return undefined;
  const covered = (await db.query<{ headline: string }>(`SELECT story_json->>'headline' AS headline FROM episodes WHERE lane = 'evergreen' AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '180 days'`, [now])).map((r) => r.headline);
  const candidates = await s.discoverEvergreen();
  if (!candidates.length) return undefined;
  const topic = await selectEvergreenTopic(s.llm, candidates, covered);
  if (topic.candidate_index < 0 || !candidates[topic.candidate_index]) {
    log("info", "editor passed on every evergreen candidate", { reason: topic.reason });
    return undefined;
  }
  const slug = topic.theme.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const cluster: StoryCluster = {
    hash: `evergreen:${topic.format}:${slug}:${now.toISOString().slice(0, 7)}`,
    headline: topic.title_idea,
    items: [],
    sources: ["Steam"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: topic.theme,
  };
  const id = shortId();
  const created = await createEpisode(db, id, cluster, { lane: "evergreen", priority: LANE_PRIORITY.evergreen, slotAt: due });
  if (!created) return undefined;
  await db.query(`UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`, [id, JSON.stringify({ topic })]);
  await logEvent(db, id, "selected", { headline: topic.title_idea, lane: "evergreen", format: topic.format, theme: topic.theme, criterion: topic.criterion, reason: topic.reason, slot_at: due.toISOString() });
  log("info", "evergreen topic selected", { id, format: topic.format, theme: topic.theme });
  return id;
}

/** Writes a ranking Short against live Steam facts for each entry, with one rewrite on problems. */
async function stepScriptEvergreen(s: Services, ep: Episode): Promise<void> {
  const topic = (ep.factcheck_json as { topic?: import("./editorial/evergreen.ts").EvergreenTopic } | null)?.topic;
  if (!topic) throw new FatalError("evergreen episode has no topic");
  let facts: Array<{ title: string; facts: SteamFacts }> = [];
  let feedback: string[] = [];
  let draft: import("./editorial/evergreen.ts").EvergreenScript | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    draft = await writeEvergreen(s.llm, topic, facts, feedback);
    const problems = validateEvergreen(draft);
    // Fetch the facts for the entries the writer chose, then rewrite once against them.
    if (attempt === 0) {
      facts = [];
      for (const entry of draft.entries) {
        if (!entry.steam_search_term) continue;
        try {
          const app = await s.findGame(entry.steam_search_term);
          if (app) facts.push({ title: entry.game_title, facts: await s.gameFacts(app) });
        } catch (err) {
          log("warn", "evergreen steam lookup failed", { game: entry.game_title, error: errorMessage(err) });
        }
      }
      feedback = [...problems, ...(facts.length ? ["Check every year, score and price against the Steam facts now provided and correct any that differ."] : [])];
      if (!feedback.length) break;
      continue;
    }
    if (problems.length) await logEvent(s.db, ep.id, "style_warnings", { problems });
  }
  if (!draft) throw new Error("evergreen script produced nothing");
  const script = evergreenToScript(draft);
  await transition(s.db, ep.id, "selected", "scripted", { script_json: script, factcheck_json: { topic, facts: facts.map((f) => ({ title: f.title, facts: f.facts })) } });
}

// --------------------------------------------------------------------- steps

async function stepScript(s: Services, ep: Episode): Promise<void> {
  if (ep.lane === "evergreen") return stepScriptEvergreen(s, ep);
  const cluster = ep.story_json;
  const items = [...cluster.items].sort((a, b) => (a.sourceKind === "official" ? -1 : 1) - (b.sourceKind === "official" ? -1 : 1)).slice(0, 4);
  const articles = (await Promise.all(items.map((i) => s.fetchArticle(i.url)))).filter((a): a is ArticleText => Boolean(a));
  const mustLabelRumour = !cluster.corroborated;

  // Live Steam numbers give the take something the headline doesn't have.
  let steam: EpisodeAssets["steam"];
  if (cluster.gameHint) {
    try {
      const app = await s.findGame(cluster.gameHint);
      if (app) steam = { appId: app.appId, name: app.name, facts: await s.gameFacts(app) };
    } catch (err) {
      log("warn", "steam lookup failed", { game: cluster.gameHint, error: errorMessage(err) });
    }
  }
  const storeData = steam ? factsText(steam.facts) : undefined;

  let script: Script | undefined;
  let feedback: string[] = [];
  let check;
  // Draft, check house rules, fact-check; one rewrite with the problems fed back.
  for (let attempt = 0; attempt < 2; attempt++) {
    script = await writeScript(s.llm, cluster, articles, { mustLabelRumour, feedback, storeData });
    const problems = validateScript(script);
    check = await factCheck(s.llm, script, cluster, articles, storeData);
    const blockers = check.issues.filter((i) => i.severity === "blocker").map((i) => `Fact-check: "${i.quote}" - ${i.problem}`);
    if (check.verdict === "pass" && check.rumour_labelling_ok && blockers.length === 0 && problems.length === 0) break;
    feedback = [...blockers, ...problems, ...(check.rumour_labelling_ok ? [] : ["Rumour labelling is inadequate."])];
    if (attempt === 1) {
      // House-style misses alone are accepted with a warning; facts are not.
      if (check.verdict === "fail" || blockers.length > 0 || !check.rumour_labelling_ok) {
        await markSeen(s.db, cluster.hash, cluster.headline, "rejected", "failed fact-check");
        await transition(s.db, ep.id, "selected", "rejected", { script_json: script, factcheck_json: check, last_error: feedback.join(" | ") });
        await s.notify({ embeds: [{ title: `🛑 Dropped: ${cluster.headline}`, description: `Failed fact-check twice.\n${feedback.slice(0, 6).map((f) => `• ${f}`).join("\n")}`, color: COLOURS.warn }] });
        return;
      }
      await logEvent(s.db, ep.id, "style_warnings", { problems });
    }
  }
  if (!script || !check) throw new Error("script step produced nothing");
  if ((script.is_rumour || mustLabelRumour) && !s.cfg.includeRumours) {
    await markSeen(s.db, cluster.hash, cluster.headline, "rejected", "rumour while INCLUDE_RUMOURS=false");
    await transition(s.db, ep.id, "selected", "rejected", { script_json: script, factcheck_json: check, last_error: "rumour story; rumours are disabled" });
    return;
  }
  await transition(s.db, ep.id, "selected", "scripted", { script_json: script, factcheck_json: check, assets_json: steam ? { steam } : null });
}

async function stepVoice(s: Services, ep: Episode): Promise<void> {
  const dir = episodeDir(s.cfg, ep.id);
  await fs.mkdir(dir, { recursive: true });
  // Voice rotation: the n-th Short the channel has made picks the n-th voice of the pool, so a few Shorts in a row share a voice and the analytics can say which one sticks.
  const [ord] = await s.db.query<{ n: string | number }>(`SELECT count(*) AS n FROM episodes WHERE created_at < $1 AND status NOT IN ('failed','rejected')`, [ep.created_at]);
  const voice = pickVoice(s.cfg, Number(ord?.n ?? 0));
  const narration = await s.synthesise(narrationOf(ep.script_json!), path.join(dir, "voice.mp3"), voice);
  await logEvent(s.db, ep.id, "voice", { provider: narration.voice?.provider ?? "unknown", id: narration.voice?.id, name: narration.voice?.name });
  const maxSeconds = ep.lane === "evergreen" ? s.cfg.evergreenMaxSeconds : 58;
  if (narration.durationSeconds > maxSeconds) throw new FatalError(`narration is ${narration.durationSeconds.toFixed(1)}s, over the ${maxSeconds}s cap for the ${ep.lane} lane`);
  await fs.writeFile(path.join(dir, "captions.srt"), srtFromWords(narration.words), "utf8");
  const assets: EpisodeAssets = { ...(ep.assets_json ?? {}), audio: "voice.mp3", words: narration.words, durationSeconds: narration.durationSeconds, srt: "captions.srt", voice: narration.voice };
  await transition(s.db, ep.id, "scripted", "voiced", { assets_json: assets });
}

async function gatherMedia(s: Services, ep: Episode, dir: string): Promise<Pick<EpisodeAssets, "images" | "clips">> {
  const script = ep.script_json!;
  // Prefer the exact store name resolved at script time so art and clips come from the same app as the facts.
  const term = ep.assets_json?.steam?.name || script.steam_search_term || script.game_title || ep.story_json.gameHint || "";
  const app = term ? await s.findGame(term).catch(() => undefined) : undefined;
  const art = app ? await s.fetchArt(app, dir).catch(() => [] as VisualAsset[]) : [];
  // Official trailer B-roll: short muted clips, at most MAX_TRAILER_CLIPS.
  // Beat-matched trailer moments: the hook and each beat ask for what they name.
  const clipAssets = app && s.cfg.footage && s.cfg.maxClips > 0 ? await s.fetchClips(app, dir, targetsFor(script), s.cfg.maxClips).catch((err) => { log("warn", "trailer clips failed", { episode: ep.id, error: errorMessage(err) }); return [] as VisualAsset[]; }) : [];
  // Per-publisher footage budget (Rockstar: about 6 s per Short). Clips beyond it are dropped, in order.
  const budget = app ? footageBudgetSeconds(app) : 0;
  const clips = capFootage(clipAssets, budget).map((c) => ({ file: c.file, sourceUrl: c.sourceUrl, provenance: c.provenance, durationSeconds: c.durationSeconds ?? 3.4, beatIndex: c.beatIndex, role: c.role, motion: c.motion, luma: c.luma, label: c.label, reason: c.reason, startSeconds: c.startSeconds }));
  if (clips.length < clipAssets.length) log("info", "footage capped", { episode: ep.id, budgetSeconds: budget, dropped: clipAssets.length - clips.length });
  const images = art.filter((a) => a.kind !== "logo");
  // First-party newsroom images (PlayStation Blog, Xbox Wire) are press
  // material meant for coverage. Outlet images are never used.
  {
    const official = ep.story_json.items.filter((i) => i.sourceKind === "official");
    for (const [n, item] of official.entries()) {
      const og = item.imageUrl ?? (await s.fetchArticle(item.url))?.ogImage;
      if (!og) continue;
      const file = path.join("assets", `official_${n}.jpg`);
      await fs.mkdir(path.join(dir, "assets"), { recursive: true });
      if (await s.downloadImage(og, path.join(dir, file))) {
        images.push({ kind: "article", file, sourceUrl: og, provenance: `Official press image from ${item.source} (${item.url})` });
      }
    }
  }
  // Ranking Shorts: each entry brings its own box art and one trailer moment, tagged with its line.
  if (script.entries?.length) {
    const sorted = [...script.entries].sort((a, b) => b.rank - a.rank);
    for (const [beatIndex, entry] of sorted.entries()) {
      if (!entry.steam_search_term) continue;
      try {
        const eapp = await s.findGame(entry.steam_search_term);
        if (!eapp) continue;
        const art = (await s.fetchArt(eapp, path.join(dir, `entry_${beatIndex}`))).filter((a) => a.kind === "capsule" || a.kind === "hero");
        for (const a of art) images.push({ ...a, file: path.join(`entry_${beatIndex}`, a.file), beatIndex });
        const want = script.beats[beatIndex]?.footage;
        const got = await s.fetchClips(eapp, path.join(dir, `entry_${beatIndex}`), [{ key: `beat:${beatIndex}`, text: entry.game_title, want: want?.want ?? "gameplay", energy: "medium", keywords: want?.keywords ?? [entry.game_title] }], 1);
        for (const c of got) clips.push({ file: path.join(`entry_${beatIndex}`, c.file), sourceUrl: c.sourceUrl, provenance: c.provenance, durationSeconds: Math.min(c.durationSeconds ?? 4, 4), beatIndex, role: undefined, motion: c.motion, luma: c.luma, label: c.label, reason: c.reason, startSeconds: c.startSeconds });
      } catch (err) {
        log("warn", "entry media failed", { game: entry.game_title, error: errorMessage(err) });
      }
    }
  }
  const out: NonNullable<EpisodeAssets["images"]> = [];
  for (const a of images) {
    out.push({ file: a.file, kind: a.kind, sourceUrl: a.sourceUrl, provenance: a.provenance, aspect: await s.imageAspect(path.join(dir, a.file)), beatIndex: a.beatIndex });
  }
  // Lead with the most cinematic art; screenshots fill the middle.
  const rank: Record<string, number> = { hero: 0, article: 1, capsule: 2, screenshot: 3, header: 4 };
  return { images: out.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)), clips };
}

export function segmentInputs(script: Script): SegmentInput[] {
  return [
    { kind: "hook", text: script.hook },
    ...script.beats.map((b) => ({ kind: "beat" as const, text: b.narration, visual: b.visual })),
    { kind: "take", text: script.pulse_take.narration, label: script.pulse_take.label, visual: { kind: "title" as const, primary: script.pulse_take.on_screen, secondary: "" } },
    { kind: "loop", text: script.loop_line },
  ];
}

/** Words the captions keep lit after they are spoken: the game title and the on-screen card text. */
export function emphasisWords(script: Script): string[] {
  const out = new Set<string>();
  const add = (t: string) => { for (const w of t.toLowerCase().split(/[^a-z0-9£$%']+/)) if (w.length > 2) out.add(w); };
  add(script.game_title);
  for (const b of script.beats) if (b.visual && b.visual.kind !== "none") add(b.visual.primary);
  return [...out];
}

/** One live number for the end of the take, if Steam has a good one. */
export function steamStat(f?: SteamFacts): { value: string; label: string } | null {
  if (!f) return null;
  if (f.currentPlayers && f.currentPlayers >= 1000) return { value: f.currentPlayers.toLocaleString("en-GB"), label: "playing on Steam right now" };
  if (f.positivePercent !== undefined && (f.totalReviews ?? 0) >= 500) return { value: `${f.positivePercent}%`, label: `positive Steam reviews (${f.reviewSummary})` };
  return null;
}

function variantOf(id: string): number {
  return [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % 4;
}

async function stepRender(s: Services, ep: Episode): Promise<void> {
  const dir = episodeDir(s.cfg, ep.id);
  const script = ep.script_json!;
  const assets = { ...(ep.assets_json ?? {}) };
  if (!assets.images) {
    Object.assign(assets, await gatherMedia(s, ep, dir));
    await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(assets)]);
  }
  const duration = (assets.durationSeconds ?? 30) + TAIL_SECONDS;
  const words = assets.words ?? [];
  const segments = buildSegments(segmentInputs(script), words, duration);
  const variant = variantOf(ep.id);
  const musicFile = s.cfg.musicBed ? `music_${variant + 1}.mp3` : null;
  // Blurred plates sit behind framed footage; made once per asset, idempotent on retry.
  for (const img of assets.images ?? []) if (!img.blurFile) img.blurFile = await blurPlate(dir, img.file).catch(() => undefined);
  for (const clip of assets.clips ?? []) if (!clip.blurFile) clip.blurFile = await blurPlate(dir, clip.file).catch(() => undefined);
  const steamLite = assets.steam?.facts ? { currentPlayers: assets.steam.facts.currentPlayers, positivePercent: assets.steam.facts.positivePercent, totalReviews: assets.steam.facts.totalReviews, price: assets.steam.facts.price, releaseDate: assets.steam.facts.releaseDate, metacritic: assets.steam.facts.metacritic } : null;
  // Plan then render: the plan is persisted so a retry renders the identical Short.
  // A red rubric rebuilds the plan once with another variant, then fails the episode.
  const planInput = {
    segments,
    words,
    durationSeconds: duration,
    images: (assets.images ?? []).map((i) => ({ kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex })),
    clips: (assets.clips ?? []).map((c) => ({ durationSeconds: c.durationSeconds, motion: c.motion, luma: c.luma, beatIndex: c.beatIndex, role: c.role })),
    storyType: script.is_rumour ? "rumour" : script.story_type,
    isRumour: script.is_rumour,
    attribution: script.attribution,
    variant,
    steam: steamLite,
  };
  const footageSeconds = (assets.clips ?? []).reduce((n, c) => n + c.durationSeconds, 0);
  const rubricFor = (plan: ReturnType<typeof buildPlan>) =>
    scorePlan({ plan, segments, words, footageSeconds, footageBudgetSeconds: 14, hookWords: script.hook.split(/\s+/).filter(Boolean).length });
  let plan = assets.plan ?? buildPlan(planInput);
  let rubric = rubricFor(plan);
  if (rubric.grade === "red" && !assets.plan) {
    log("warn", "plan rejected by rubric, rebuilding", { episode: ep.id, problems: rubricSummary(rubric) });
    plan = buildPlan({ ...planInput, variant: (variant + 1) % 4 });
    rubric = rubricFor(plan);
    if (rubric.grade === "red") throw new FatalError(`render plan fails the rubric: ${rubricSummary(rubric)}`);
  }
  await logEvent(s.db, ep.id, "rubric", { grade: rubric.grade, summary: rubricSummary(rubric) || "all green" });
  assets.plan = plan;
  await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(assets)]);
  const publisher = String((assets.steam ? (await s.findGame(assets.steam.name).catch(() => undefined))?.details?.publishers?.[0] : "") ?? "");
  const footageCredit = (assets.clips ?? []).length ? `Footage: ${publisher || script.game_title} · official trailer` : "";
  const year = assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0];
  const gameSubtitle = [publisher, year].filter(Boolean).join(" · ");

  const raw = path.join(dir, "render_raw.mp4");
  const final = path.join(dir, "short.mp4");
  await s.render({
    episodeDir: dir,
    outFile: raw,
    posterFile: path.join(dir, "poster.jpg"),
    concurrency: s.cfg.remotionConcurrency,
    gl: s.cfg.remotionGl,
    browserExecutable: s.cfg.browserExecutable,
    props: {
      headline: script.headline,
      storyType: script.is_rumour ? "rumour" : script.story_type,
      gameTitle: script.game_title,
      isRumour: script.is_rumour,
      attribution: script.attribution,
      gameSubtitle,
      footageCredit,
      segments,
      words,
      durationSeconds: duration,
      variant,
      audioFile: assets.audio ?? null,
      musicFile,
      imageFiles: (assets.images ?? []).map((i) => ({ file: i.file, kind: i.kind, aspect: i.aspect, blurFile: i.blurFile, beatIndex: i.beatIndex })),
      clipFiles: (assets.clips ?? []).map((c) => ({ file: c.file, durationSeconds: c.durationSeconds, blurFile: c.blurFile, beatIndex: c.beatIndex, role: c.role, motion: c.motion, luma: c.luma })),
      steam: steamLite,
      emphasis: emphasisWords(script),
      plan,
      renderDate: s.now().toISOString().slice(0, 10),
    },
  });
  await s.normalise(raw, final);
  await fs.rm(raw, { force: true });

  const tech = await s.technicalQa(final, duration, ep.lane === "evergreen" ? { minSeconds: 60, maxSeconds: 179 } : undefined);
  let vision: VisionQa | undefined;
  if (tech.ok && s.cfg.visionQa) {
    const times = [0.8, ...segments.slice(1).map((g) => g.start + 0.6), duration - 1].filter((t) => t < duration);
    const frames = await s.extractFrames(final, path.join(dir, "qa"), times.slice(0, 8));
    vision = await s.visionQa(frames, { headline: script.headline, gameTitle: script.game_title });
  }
  const qa = { technical: tech, vision: vision ?? null, rubric, checked_at: s.now().toISOString() };
  const visionProblems = vision?.verdict === "fail" ? (vision.problems.length ? vision.problems : [`vision QA failed: ${vision.notes || "no reason given"}`]) : [];
  const problems = [...tech.problems, ...visionProblems];
  if (problems.length > 0) {
    await s.db.query(`UPDATE episodes SET qa_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(qa)]);
    throw new Error(`QA failed: ${problems.join(" | ")}`);
  }
  await transition(s.db, ep.id, "voiced", "rendered", {
    assets_json: { ...assets, video: "short.mp4", poster: "poster.jpg", musicFile },
    qa_json: qa,
  });
}

async function stepRequestApproval(s: Services, ep: Episode): Promise<void> {
  const script = ep.script_json!;
  const links = approvalLinks(s.cfg, ep.id);
  // Rumours and anything not corroborated always wait for a human.
  const risky = script.is_rumour || !ep.story_json.corroborated;
  const mode = risky ? "manual" : ep.lane === "evergreen" ? s.cfg.evergreenApprovalMode : s.cfg.approvalMode;
  const when =
    mode === "auto"
      ? "Auto mode: publishing now."
      : mode === "timeout"
        ? `Publishes automatically in ${ep.lane === "news_breaking" ? s.cfg.breakingApprovalMinutes : s.cfg.approvalTimeoutMinutes} min unless rejected.`
        : "Waiting for your approval.";
  const dir = episodeDir(s.cfg, ep.id);
  const delivered = await s.notify({
    embeds: [
      {
        title: `🎬 ${script.youtube.title}`,
        url: links.preview,
        description: [
          `**Hook:** ${script.hook}`,
          `**Pulse take:** ${script.pulse_take.narration}`,
          `**Sources:** ${ep.story_json.sources.join(", ")}${ep.story_json.hasOfficial ? " (official)" : ""}`,
          `**Fact-check:** ${ep.factcheck_json?.summary ?? "n/a"}`,
          "",
          `▶️ [Watch preview](${links.preview})  ·  ✅ [Approve](${links.approve})  ·  ❌ [Reject](${links.reject})`,
          when,
        ].join("\n"),
        color: script.is_rumour ? COLOURS.alert : COLOURS.brand,
        image: { url: "attachment://poster.jpg" },
      },
    ],
    files: [path.join(dir, "poster.jpg")],
  });
  // Never start a publish countdown nobody was told about.
  if (delivered === false && mode === "timeout") throw new Error("approval notice could not be posted to Discord; retrying before any auto-publish");
  if (mode === "auto") {
    await transition(s.db, ep.id, "rendered", "approved", { approval_mode: mode, approved_by: "auto", approval_requested_at: s.now() });
  } else {
    await transition(s.db, ep.id, "rendered", "awaiting_approval", { approval_mode: mode, approval_requested_at: s.now() });
  }
}

const MANUAL_APPROVAL_EXPIRY_HOURS = 48; // the Discord links last 3 days

async function stepAwaitApproval(s: Services, ep: Episode): Promise<void> {
  if (!ep.approval_requested_at) return;
  const waited = s.now().getTime() - new Date(ep.approval_requested_at).getTime();
  if (ep.approval_mode === "manual") {
    // An unanswered episode must not block tomorrow's Short forever.
    if (waited >= MANUAL_APPROVAL_EXPIRY_HOURS * 3600_000 && (await transition(s.db, ep.id, "awaiting_approval", "rejected", { last_error: "approval expired unanswered" }))) {
      await logEvent(s.db, ep.id, "rejected", { by: "expiry" });
      await s.notify({ content: `⌛ "${ep.script_json?.youtube.title ?? ep.story_json.headline}" expired after ${MANUAL_APPROVAL_EXPIRY_HOURS}h without approval; moving on to new stories.` });
    }
    return;
  }
  if (ep.approval_mode !== "timeout") return;
  const timeoutMinutes = ep.lane === "news_breaking" ? s.cfg.breakingApprovalMinutes : ep.lane === "evergreen" ? s.cfg.evergreenApprovalMinutes : s.cfg.approvalTimeoutMinutes;
  if (waited >= timeoutMinutes * 60_000) {
    // The countdown only publishes if the owner could actually have tapped Reject: when the
    // public URL (the tunnel) is down the Discord links are dead, so the episode is held.
    if (!(await s.publicReachable())) {
      log("warn", "approval timeout held: public URL unreachable", { episode: ep.id, url: s.cfg.publicUrl });
      return;
    }
    if (await transition(s.db, ep.id, "awaiting_approval", "approved", { approved_by: "timeout" })) {
      await logEvent(s.db, ep.id, "approved", { by: "timeout" });
    }
  }
}

/** Publish now if inside the window, otherwise at the next window opening. */
/**
 * When this episode goes live: breaking publishes now inside its window (else
 * at the window's next opening); news publishes at its slot (now if the slot
 * has passed); every lane keeps MIN_UPLOAD_GAP_MINUTES after the last publish.
 * Returns undefined for "now".
 */
export function choosePublishAt(cfg: Config, now: Date, ep?: Pick<Episode, "lane" | "slot_at">, lastPublish?: Date): Date | undefined {
  let at: Date | undefined;
  if (ep?.lane === "news_breaking") {
    at = inWindow(now, cfg.breakingWindow, cfg.timezone) ? undefined : nextWindowStart(now, cfg.breakingWindow, cfg.timezone);
  } else if (ep?.slot_at) {
    const slot = new Date(ep.slot_at);
    at = slot > now ? slot : undefined;
  } else {
    // Legacy window behaviour for episodes without a slot.
    const earliest = new Date(now.getTime() + cfg.youtubeVetoMinutes * 60_000);
    const h = earliest.getUTCHours();
    if (h < cfg.publishWindowStartUtc) at = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), earliest.getUTCDate(), cfg.publishWindowStartUtc));
    else if (h >= cfg.publishWindowEndUtc) at = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), earliest.getUTCDate() + 1, cfg.publishWindowStartUtc));
    else if (cfg.youtubeVetoMinutes > 0) at = earliest;
  }
  if (lastPublish) {
    const gapEnd = new Date(lastPublish.getTime() + cfg.minUploadGapMinutes * 60_000);
    if (gapEnd > (at ?? now)) at = gapEnd;
  }
  // YouTube needs scheduled times comfortably in the future; otherwise go now.
  if (at && at.getTime() - now.getTime() < 15 * 60_000) return undefined;
  return at;
}

async function stepApproved(s: Services, ep: Episode): Promise<void> {
  const publishAt = choosePublishAt(s.cfg, s.now(), ep, await lastPublishAt(s.db));
  // Public uploads are scheduled on YouTube (private until publish_at). Anything else
  // cannot be scheduled there, so the upload itself waits until the slot.
  const holdUpload = publishAt && s.cfg.youtubePrivacy !== "public";
  await transition(s.db, ep.id, "approved", "uploading", { publish_at: publishAt ?? null, ...(holdUpload ? { next_attempt_at: publishAt } : {}) });
  if (publishAt) await logEvent(s.db, ep.id, "scheduled", { publish_at: publishAt.toISOString(), lane: ep.lane });
}

export function videoMetadata(ep: Episode, privacy: Config["youtubePrivacy"], syntheticMedia = true) {
  const script = ep.script_json!;
  const credits = ep.story_json.items
    .slice(0, 4)
    .map((i) => `• ${i.source}: ${i.url}`)
    .join("\n");
  const clips = ep.assets_json?.clips ?? [];
  const publisher = clips[0]?.provenance.match(/publisher[^:]*:\s*([^;)]+)/i)?.[1]?.trim();
  const footage = clips.length
    ? [
        `\nFootage: ${script.game_title} official trailer${publisher ? ` (${publisher})` : ""}, via Steam. Store art: Steam.`,
        /microsoft|xbox game studios|bethesda/i.test(`${publisher ?? ""} ${ep.story_json.headline}`) ? "Game footage used under Microsoft's Game Content Usage Rules: https://www.xbox.com/en-US/developers/rules" : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const body = script.youtube.description.trim().replace(/#\w+/g, "").replace(/\s{2,}/g, " ").trim();
  const description = [
    keywordLead(script),
    "",
    body,
    script.is_rumour ? "\nThis story is unconfirmed. We will update if it is confirmed or denied." : "",
    `\nSources:\n${credits}`,
    footage,
    "\nNarration: locally generated British synthetic voice. Visuals: official publisher material, credited.",
    "\nPulse Gaming News: fast gaming news, checked and explained. New Shorts every day.",
    hashtags(script).join(" "),
  ]
    .filter((line) => line !== "")
    .join("\n");
  return {
    title: polishTitle(script),
    description,
    tags: buildTags(script),
    categoryId: "20",
    privacyStatus: privacy,
    publishAt: ep.publish_at ? new Date(ep.publish_at).toISOString() : undefined,
    // The narrator is a cloned voice, so disclose it (as Codex did). The
    // label does not affect reach or monetisation.
    containsSyntheticMedia: syntheticMedia,
    defaultLanguage: "en-GB",
  };
}

async function stepUpload(s: Services, ep: Episode): Promise<void> {
  if (s.cfg.dryRun) {
    await transition(s.db, ep.id, "uploading", "published", { youtube_status: "dry_run" });
    await s.notify({ content: `🧪 DRY_RUN: "${ep.script_json!.youtube.title}" would have been uploaded now.` });
    return;
  }
  const used = await quotaUsed(s.db, s.now());
  if (used + QUOTA_RESERVE_FOR_UPLOAD > s.cfg.quotaUnitsPerDay) {
    const resetAt = quotaResetAt(s.now());
    log("warn", "YouTube quota nearly spent; upload deferred", { episode: ep.id, used, resetAt: resetAt.toISOString() });
    await s.db.query(`UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`, [ep.id, resetAt]);
    await logEvent(s.db, ep.id, "quota_deferred", { used, reset_at: resetAt.toISOString() });
    return;
  }
  const yt = s.youtube();
  const marker = markerTag(ep.id);
  const file = path.join(episodeDir(s.cfg, ep.id), "short.mp4");

  // Any previous attempt may have finished server-side without us hearing back.
  if (ep.attempts > 0 || ep.upload_session_uri) {
    const existing = await yt.findByMarker(marker);
    if (existing) {
      await transition(s.db, ep.id, "uploading", "uploaded", { youtube_video_id: existing });
    await quotaAdd(s.db, s.now(), QUOTA.upload);
      await logEvent(s.db, ep.id, "upload_adopted", { videoId: existing });
      return;
    }
  }
  let session = ep.upload_session_uri;
  if (!session) {
    const size = (await fs.stat(file)).size;
    session = await yt.createSession(buildResource(videoMetadata(ep, s.cfg.youtubePrivacy, s.cfg.syntheticMedia), marker), size);
    await s.db.query(`UPDATE episodes SET upload_session_uri = $2 WHERE id = $1 AND status = 'uploading'`, [ep.id, session]);
  }
  try {
    const videoId = await yt.uploadToSession(session, file);
    await transition(s.db, ep.id, "uploading", "uploaded", { youtube_video_id: videoId });
    await quotaAdd(s.db, s.now(), QUOTA.upload);
    await logEvent(s.db, ep.id, "uploaded", { videoId });
  } catch (err) {
    if (err instanceof SessionGone) {
      await s.db.query(`UPDATE episodes SET upload_session_uri = NULL WHERE id = $1`, [ep.id]);
    }
    throw err;
  }
}

/** Posts the channel's own first comment (the owner pins it from the app; the API cannot pin). Never blocks a live video. */
async function addPinnedComment(s: Services, ep: Episode): Promise<void> {
  try {
    const text = pinnedComment(ep.script_json!);
    const id = await s.youtube().insertComment(ep.youtube_video_id!, text);
    await quotaAdd(s.db, s.now(), QUOTA.comment);
    await logEvent(s.db, ep.id, "comment_posted", { id, text });
  } catch (err) {
    log("warn", "pinned comment failed", { episode: ep.id, error: errorMessage(err) });
    await logEvent(s.db, ep.id, "comment_failed", { error: errorMessage(err) });
  }
}

/** Uploads the SRT as the video's en-GB caption track. Captions are an enhancement: a failure is logged, never blocks a video that is already live. */
async function addCaptions(s: Services, ep: Episode): Promise<void> {
  const file = path.join(episodeDir(s.cfg, ep.id), ep.assets_json!.srt!);
  try {
    const yt = s.youtube();
    if ((await yt.listCaptions(ep.youtube_video_id!)).some((c) => c.language === "en-GB")) return;
    const id = await yt.insertCaption(ep.youtube_video_id!, file, "en-GB", "English");
    await quotaAdd(s.db, s.now(), QUOTA.captions);
    await logEvent(s.db, ep.id, "captions_uploaded", { id });
  } catch (err) {
    log("warn", "caption upload failed", { episode: ep.id, error: errorMessage(err) });
    await logEvent(s.db, ep.id, "captions_failed", { error: errorMessage(err) });
  }
}

async function stepConfirm(s: Services, ep: Episode): Promise<void> {
  const st = await s.youtube().status(ep.youtube_video_id!);
  await quotaAdd(s.db, s.now(), QUOTA.poll);
  if (!st) throw new Error("uploaded video not found yet");
  if (st.uploadStatus === "rejected" || st.uploadStatus === "failed") {
    await transition(s.db, ep.id, "uploaded", "failed", { youtube_status: st.uploadStatus, last_error: st.rejectionReason ?? st.failureReason ?? st.uploadStatus });
    throw new FatalError(`YouTube ${st.uploadStatus} the video: ${st.rejectionReason ?? st.failureReason ?? "no reason given"}`);
  }
  if (st.uploadStatus !== "processed") {
    await s.db.query(`UPDATE episodes SET youtube_status = $2, next_attempt_at = now() + interval '5 minutes' WHERE id = $1`, [ep.id, st.uploadStatus]);
    return;
  }
  if (ep.assets_json?.srt) await addCaptions(s, ep);
  await addPinnedComment(s, ep);
  await transition(s.db, ep.id, "uploaded", "published", { youtube_status: st.privacyStatus });
  const url = `https://youtube.com/shorts/${ep.youtube_video_id}`;
  const when = ep.publish_at ? `scheduled for ${new Date(ep.publish_at).toUTCString()}` : "live now";
  const voiceLine = ep.assets_json?.voice ? `\nVoice: ${ep.assets_json.voice.name}` : "";
  await s.notify({ embeds: [{ title: `✅ Published: ${ep.script_json!.youtube.title}`, url, description: `${url}\n${when}${voiceLine}`, color: COLOURS.ok }] });
}

const STEPS: Partial<Record<Episode["status"], (s: Services, ep: Episode) => Promise<void>>> = {
  selected: stepScript,
  scripted: stepVoice,
  voiced: stepRender,
  rendered: stepRequestApproval,
  awaiting_approval: stepAwaitApproval,
  approved: stepApproved,
  uploading: stepUpload,
  uploaded: stepConfirm,
};

/** Runs one step; on failure records it and backs off, alerting once it gives up. */
export async function advance(s: Services, ep: Episode): Promise<boolean> {
  const step = STEPS[ep.status];
  if (!step) return false;
  try {
    await step(s, ep);
    const after = await getEpisode(s.db, ep.id);
    return Boolean(after && after.status !== ep.status);
  } catch (err) {
    const msg = errorMessage(err);
    const fatal = err instanceof FatalError;
    const attempts = await recordFailure(s.db, ep.id, msg, Math.min(60, 5 * 2 ** ep.attempts));
    log("error", "step failed", { id: ep.id, status: ep.status, attempts, fatal, error: msg });
    if (fatal) {
      // A fatal error (credentials, quota, policy) would hit every new episode
      // too: stop picking stories until it is fixed rather than burn a story a tick.
      await pauseSelection(s.db, s.now(), FATAL_PAUSE_HOURS, msg);
    }
    if (fatal || attempts >= s.cfg.maxAttempts) {
      const fresh = await getEpisode(s.db, ep.id);
      if (fresh && !["failed", "published", "rejected"].includes(fresh.status)) {
        await transition(s.db, ep.id, fresh.status, "failed", { last_error: msg });
      }
      const where =
        (ep.status === "uploading" ? "\nThe upload may be incomplete; the next run will search the channel before re-uploading." : "") +
        (fatal ? `\nNew stories are paused for ${FATAL_PAUSE_HOURS}h (or until YouTube is reconnected) so this can be fixed.` : "");
      await s.notify({
        embeds: [{ title: `⚠️ Episode failed at "${ep.status}"`, description: `${ep.script_json?.headline ?? ep.story_json.headline}\n\n${msg.slice(0, 1500)}${where}`, color: COLOURS.alert }],
      });
    }
    return false;
  }
}

const FATAL_PAUSE_HOURS = 12;

export async function pauseSelection(db: Db, now: Date, hours: number, reason: string): Promise<void> {
  const value = JSON.stringify({ until: new Date(now.getTime() + hours * 3600_000).toISOString(), reason: reason.slice(0, 300) });
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('selection_pause', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [value],
  );
}

export async function clearSelectionPause(db: Db): Promise<void> {
  await db.query(`DELETE FROM settings WHERE key = 'selection_pause'`);
}

/** The pause reason while selection is paused, otherwise undefined. */
export async function selectionPause(db: Db, now: Date): Promise<string | undefined> {
  const [row] = await db.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'selection_pause'`);
  if (!row) return undefined;
  try {
    const p = JSON.parse(row.value) as { until: string; reason: string };
    return new Date(p.until).getTime() > now.getTime() ? p.reason : undefined;
  } catch {
    return undefined;
  }
}

/** Deletes media for finished episodes after two weeks so the volume never fills. */
export async function pruneMedia(s: Services, days = 14): Promise<number> {
  const rows = await s.db.query<{ id: string }>(
    `SELECT id FROM episodes WHERE status IN ('published','rejected','failed') AND updated_at < now() - make_interval(days => $1)`,
    [days],
  );
  let n = 0;
  for (const { id } of rows) {
    const dir = episodeDir(s.cfg, id);
    try {
      await fs.access(dir);
    } catch {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
    n++;
  }
  return n;
}

export async function tick(s: Services): Promise<{ ran: boolean; selected?: string }> {
  const result = await withLease(s.db, "tick", 45 * 60, async () => {
    let selected: string | undefined;
    try {
      await discoverTick(s);
      selected = await maybeSelect(s);
    } catch (err) {
      log("error", "selection failed", { error: errorMessage(err) });
      if (err instanceof FatalError) await s.notify({ content: `⚠️ Story selection failed: ${errorMessage(err)}` });
    }
    for (const ep of await dueEpisodes(s.db, s.now())) {
      // Push one episode as far as it can go this tick (script → upload);
      // it stops on its own at a wait (approval, processing, a slot, a quota reset) or a failure.
      let current: Episode | undefined = ep;
      for (let i = 0; i < 10 && current; i++) {
        const moved = await advance(s, current);
        if (!moved) break;
        current = await getEpisode(s.db, ep.id);
        if (current?.next_attempt_at && new Date(current.next_attempt_at) > s.now()) break;
      }
    }
    await pruneMedia(s).catch((err) => log("warn", "prune failed", { error: errorMessage(err) }));
    return { selected };
  });
  return result ? { ran: true, ...result } : { ran: false };
}
