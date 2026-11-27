// The two pipeline steps of "the week's biggest gaming story, explained" (src/editorial/explained.ts), kept out of
// src/pipeline.ts so its edits stay a few lines: choosing the story when the weekly slot's production starts, and
// writing the script. Choosing costs no model call (the factory's own data plus the cached YouTube demand check);
// writing is one packaging call, four chapters with the documentary's fact check and shot list, and the bookends,
// all on sites named "doc.explained.*" or the documentary's own, so CODEX_CALLS=doc sends them to Codex.
import type { Db } from "./db.ts";
import type { Services } from "./pipeline.ts";
import type { Episode } from "./episodes.ts";
import { createEpisode, logEvent, transition } from "./episodes.ts";
import type { StoryCluster } from "./discovery/cluster.ts";
import { LANE_PRIORITY } from "./lanes.ts";
import { shortId } from "./lib/util.ts";
import { recordWeeklyArm } from "./weeklytest.ts";
import type { Script } from "./editorial/schema.ts";
import { narrationOf } from "./editorial/schema.ts";
import type { SegmentInput } from "./render/timeline.ts";
import type { EvergreenCandidate } from "./editorial/evergreen.ts";
import {
  dbDemandBudget,
  dbDemandCache,
  demandFor,
  demandSearchers,
  type Demand,
} from "./discovery/searchdemand.ts";
import { guardScript } from "./writerguard.ts";
import { spoilerProblems } from "./sceneindex/spoilers.ts";
import {
  chapterRefusal,
  checkChapter,
  checkChapterItems,
  groundCallouts,
  groundDocMoments,
  validateBookends,
  writeDocMoments,
  type DocChapter,
  type DocMoment,
} from "./editorial/documentary.ts";
import { sentencesOf } from "./editorial/longform.ts";
import { visualLessons } from "./analytics.ts";
import {
  EXPLAINED_PARTS,
  EXPLAINED_WORDS_MAX,
  EXPLAINED_WORDS_MIN,
  demandQuery,
  explainedBookendProblems,
  explainedOutline,
  explainedSource,
  explainedStoryOf,
  explainedToScript,
  explainedWords,
  groupStories,
  packageExplained,
  packagingProblems,
  pickStory,
  rankStories,
  scoreLine,
  validateExplainedChapter,
  writeExplainedBookends,
  writeExplainedChapter,
  type ExplainedStory,
  type RankedStory,
  type StoryShort,
  type StorySighting,
} from "./editorial/explained.ts";
import { longRulesFor, youShortfall } from "./editorial/longrules.ts";
import { excludeDropStories } from "./editorial/dropangle.ts";
import { dayKey } from "./lanes.ts";
import { errorMessage, FatalError, log } from "./lib/util.ts";
import { disciplineChapter, docFactLine, type DocFactItem } from "./docfacts.ts";

type Url = { url: string; source: string; title: string };

/** The week's published news Shorts and corroborated clusters, as the picker reads them (one query each). */
export async function weekStories(
  db: Db,
  now: Date,
): Promise<{ shorts: StoryShort[]; sightings: StorySighting[] }> {
  const rows = await db.query<{
    id: string;
    game: string | null;
    headline: string | null;
    score: string | null;
    rumour: string | null;
    views: number | null;
    pct: string | null;
    items: Array<{ url?: string; source?: string; title?: string }> | null;
    script: Script | null;
  }>(
    `SELECT e.id, e.script_json->>'game_title' AS game, e.story_json->>'headline' AS headline,
            e.story_json->>'score' AS score, e.script_json->>'is_rumour' AS rumour,
            (SELECT max(m.views) FROM video_metrics m WHERE m.episode_id = e.id AND m.label <> 'retention') AS views,
            (SELECT m.raw->>'avgViewPercent' FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'retention') AS pct,
            e.story_json->'items' AS items, e.script_json AS script
       FROM episodes e
      WHERE e.lane IN ('news','news_breaking') AND e.status = 'published' AND e.youtube_video_id IS NOT NULL
        AND coalesce(e.publish_at, e.updated_at) > $1::timestamptz - interval '7 days'
        AND coalesce(e.publish_at, e.updated_at) <= $1::timestamptz`,
    [now],
  );
  const urls = (
    items: Array<{ url?: string; source?: string; title?: string }> | null,
  ): Url[] =>
    (items ?? [])
      .filter((i) => i.url)
      .slice(0, 4)
      .map((i) => ({
        url: i.url!,
        source: i.source ?? "",
        title: i.title ?? "",
      }));
  const shorts: StoryShort[] = rows.map((r) => ({
    id: r.id,
    game: r.game ?? "",
    headline: r.headline ?? r.script?.headline ?? r.id,
    score: Math.max(0, Number(r.score ?? 0) || 0),
    views: Number(r.views ?? 0),
    pct: r.pct !== null && r.pct !== undefined ? Number(r.pct) : undefined,
    rumour: r.rumour === "true",
    urls: urls(r.items),
    narration: r.script
      ? narrationOf({ ...r.script, beats: r.script.beats ?? [] })
      : undefined,
  }));
  const sight = await db.query<{
    hash: string;
    headline: string;
    max_score: number;
    item_count: number;
    has_official: boolean;
    cluster_json: {
      sources?: string[];
      rumourSignals?: boolean;
      gameHint?: string;
      items?: Array<{
        url?: string;
        source?: string;
        title?: string;
        summary?: string;
      }>;
    };
  }>(
    `SELECT hash, headline, max_score, item_count, has_official, cluster_json FROM cluster_sightings
      WHERE first_seen > $1::timestamptz - interval '7 days' AND first_seen <= $1::timestamptz
        AND (has_official OR item_count >= 2)
      ORDER BY max_score DESC LIMIT 80`,
    [now],
  );
  const sightings: StorySighting[] = sight.map((r) => ({
    hash: r.hash,
    headline: r.headline,
    score: r.max_score,
    items: r.item_count,
    official: r.has_official,
    sources: r.cluster_json?.sources ?? [],
    rumour: !!r.cluster_json?.rumourSignals,
    game: r.cluster_json?.gameHint,
    summaries: (r.cluster_json?.items ?? [])
      .map((i) => (i.summary ?? "").slice(0, 300))
      .filter(Boolean)
      .slice(0, 3),
    urls: urls(r.cluster_json?.items ?? null),
  }));
  return { shorts, sightings };
}

/**
 * The week's story, ranked (no model call). The demand check runs on the five best stories only (cached a day,
 * DEMAND_LOOKUPS pages at most); off or unavailable, every story counts as unknown demand.
 */
export async function chooseWeekStory(
  s: Pick<Services, "db" | "cfg" | "searchDemand" | "searchDemandMany">,
  now: Date,
): Promise<{
  pick?: RankedStory;
  ranked: RankedStory[];
  demand: Map<string, Demand>;
}> {
  const { shorts, sightings } = await weekStories(s.db, now);
  // With rumours off (INCLUDE_RUMOURS=false) a rumoured story is never the week's explainer.
  const stories = groupStories(shorts, sightings).filter(
    (st) => s.cfg.includeRumours || !st.rumour,
  );
  // DROP_ANGLE (src/editorial/dropangle.ts): a trailer or screenshot drop is never the week's long video.
  const rank = (d?: Map<string, Demand>) =>
    s.cfg.dropAngle
      ? excludeDropStories(rankStories(stories, d))
      : rankStories(stories, d);
  const first = rank();
  let demand = new Map<string, Demand>();
  if (s.cfg.demandCheck && (s.searchDemand || s.searchDemandMany)) {
    const top = first
      .filter((r) => !r.score.excluded)
      .slice(0, 5)
      .map((r) => ({ name: demandQuery(r.story) }) as EvergreenCandidate);
    demand = await demandFor(top, {
      ...demandSearchers(s),
      budget: dbDemandBudget(s.db, s.cfg.demandApiPerDay, () => now),
      label: "explained",
      cache: dbDemandCache(s.db, () => now, (s.cfg.demandCacheDays ?? 7) * 24),
      lookups: s.cfg.demandLookups,
      minViews: s.cfg.demandMinViews,
      now,
      staleDays: s.cfg.demandStaleDays,
    }).catch((err) => {
      log("warn", "explained demand check failed", {
        error: errorMessage(err),
      });
      return new Map<string, Demand>();
    });
  }
  const ranked = rank(demand);
  return { pick: pickStory(ranked), ranked, demand };
}

/** The Discord line for the pick: the story, its score and the runners-up. */
export function pickNotice(pick: RankedStory, ranked: RankedStory[]): string {
  const others = ranked
    .filter((r) => r !== pick)
    .slice(0, 3)
    .map(
      (r) =>
        `- ${r.story.headline.slice(0, 80)}: ${r.score.total.toFixed(1)}${r.score.excluded ? ` (skipped: ${r.score.excluded})` : ""}`,
    )
    .join("\n");
  return `Weekly growth test, explainer week: the story is **${pick.story.headline}**${pick.story.rumour ? " (a rumor, labeled throughout)" : ""}. Score ${scoreLine(pick)}.${others ? `\nRunners-up:\n${others}` : ""}`;
}

/**
 * An explainer week's selection: picks the story and creates the long-form episode in the weekly slot, recording
 * it as the explainer arm. With no story strong and safe enough it returns the reason, and the round-up runs.
 */
export async function selectExplainedEpisode(
  s: Services,
  now: Date,
  due: Date,
  today: string,
): Promise<{ id?: string; reason?: string }> {
  const { pick, ranked } = await chooseWeekStory(s, now);
  log("info", "explained story ranking", {
    top: ranked
      .slice(0, 5)
      .map((r) => `${r.story.headline.slice(0, 60)}: ${scoreLine(r)}`),
  });
  if (!pick) {
    const top = ranked[0];
    return {
      reason: top
        ? `best was "${top.story.headline.slice(0, 70)}" at ${top.score.total.toFixed(1)}${top.score.excluded ? `, skipped as ${top.score.excluded}` : ""}`
        : "no stories this week",
    };
  }
  const story = explainedStoryOf(pick);
  const id = shortId();
  const cluster: StoryCluster = {
    hash: `weekly:explained:${today}`,
    headline: story.headline,
    items: [],
    sources: [...new Set(story.urls.map((u) => u.source))],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: story.rumour,
    newestAt: now.toISOString(),
    score: Math.round(story.score),
    gameHint: story.game,
  };
  if (
    !(await createEpisode(s.db, id, cluster, {
      lane: "longform",
      priority: LANE_PRIORITY.longform,
      slotAt: due,
    }))
  )
    return { reason: "the slot was already taken" };
  await s.db.query(
    `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
    [id, JSON.stringify({ explained: true, story })],
  );
  await logEvent(s.db, id, "selected", {
    headline: story.headline,
    lane: "longform",
    explained: true,
    score: story.score,
    scoring: story.scoreLine,
    slot_at: due.toISOString(),
  });
  await recordWeeklyArm(s.db, s.cfg, id, "explained", now);
  await s.notify({ content: pickNotice(pick, ranked) }).catch(() => undefined);
  log("info", "weekly explainer selected", { id, story: story.headline });
  return { id };
}

/**
 * Writes the explainer: sources, packaging (one rewrite on problems), the fixed outline, four chapters each with
 * the documentary's fact check (up to two rewrites), grounded callouts and shot list, then the bookends.
 */
export async function stepScriptExplained(
  s: Services,
  ep: Episode,
  story: ExplainedStory,
  deps: { segmentInputs: (script: Script) => SegmentInput[] },
): Promise<void> {
  const articles: Array<Url & { text: string }> = [];
  for (const u of story.urls.slice(0, 6)) {
    const a = await s.fetchArticle(u.url).catch(() => undefined);
    if (a?.text)
      articles.push({ ...u, title: a.title || u.title, text: a.text });
  }
  const narrations: string[] = [];
  for (const id of story.shortIds.slice(0, 3)) {
    const [row] = await s.db.query<{ script_json: Script | null }>(
      `SELECT script_json FROM episodes WHERE id = $1`,
      [id],
    );
    if (row?.script_json)
      narrations.push(
        narrationOf({ ...row.script_json, beats: row.script_json.beats ?? [] }),
      );
  }
  const background = story.game
    ? await s
        .research(story.game, `${story.game} video game`, 3000)
        .catch(() => undefined)
    : undefined;
  if (!articles.length && !narrations.length)
    throw new FatalError("the explained story has no article to write from");
  const source = explainedSource(story, articles, narrations, background);
  const warnings: string[] = [];
  let packaging = await packageExplained(s.llm, story, source);
  const packSpoilers = (p: typeof packaging) =>
    spoilerProblems(
      [p.title, p.kicker, p.youtube.title, p.youtube.description, ...(p.chapter_titles ?? [])].filter(Boolean).join(". "),
      s.now(),
      [story.game],
    );
  const pp = [...packagingProblems(packaging, story), ...packSpoilers(packaging)];
  if (pp.length) {
    packaging = await packageExplained(s.llm, story, source, pp);
    warnings.push(...packagingProblems(packaging, story), ...packSpoilers(packaging));
  }
  const year = Number(dayKey(s.now(), s.cfg.timezone).slice(0, 4));
  const outline = explainedOutline(story, packaging, year);
  const done: Array<{
    chapter: DocChapter;
    source: typeof source;
    moments?: DocMoment[];
  }> = [];
  const games = [story.game || outline.title];
  const youFloor = longRulesFor(s.cfg, "explained").youFloor;
  // Parts dropped because the writer still found no source for them (20 Nov 2026: one part stopped the whole weekly
  // explainer). At most one, never the first, and only with DOC_DROP_REFUSED_CHAPTER on, as for documentaries.
  const dropped = new Set<number>();
  for (const [index] of EXPLAINED_PARTS.entries()) {
    let chapter: DocChapter | undefined;
    let feedback: string[] = [];
    // DOC_FACT_DISCIPLINE: the last check's disputed lines, undefined when that check could not run.
    let disputed: DocFactItem[] | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      chapter = await writeExplainedChapter(s.llm, {
        story,
        outline,
        index,
        source,
        earlier: done.map((d) => d.chapter),
        feedback,
        youFloor,
      });
      // LONG_YOU_PER_1000: on the first draft only, so it costs one revision at most.
      const you =
        attempt === 0
          ? youShortfall(
              done.map((d) => d.chapter.paragraphs.map((x) => x.narration).join(" ")),
              chapter.paragraphs.map((x) => x.narration).join(" "),
              youFloor,
            )
          : undefined;
      let unsupported: string[];
      if (s.cfg.docFactDiscipline) {
        disputed = await checkChapterItems(s.llm, chapter, source).catch(() => undefined);
        unsupported = (disputed ?? []).map((u) => `"${u.quote}": ${u.problem}`);
      } else
        unsupported = await checkChapter(s.llm, chapter, source).catch(
          () => [] as string[],
        );
      const others = [
        ...validateExplainedChapter(chapter, {
          earlier: done.map((d) => d.chapter),
          rumour: story.rumour,
          game: story.game,
          index,
        }),
        ...(you ? [you] : []),
        // Story spoilers go back to the writer on every draft, not to the final door (20 Nov 2026: one
        // "how the game ends" in part 4 stopped the whole weekly explainer).
        ...spoilerProblems(
          chapter.paragraphs
            .map((x) => [x.narration, x.callout?.primary, x.callout?.secondary].filter(Boolean).join(". "))
            .join(" "),
          s.now(),
          games,
        ),
      ];
      feedback = [
        ...others,
        ...unsupported.map(
          (u) => `Not supported by the sources, remove or correct it: ${u}`,
        ),
      ];
      if (!feedback.length) break;
      // Under DOC_FACT_DISCIPLINE the disputed lines are settled just below, never kept as a warning.
      if (attempt === 2)
        warnings.push(
          ...(s.cfg.docFactDiscipline ? others : feedback).map((f) => `${EXPLAINED_PARTS[index]!.label}: ${f}`),
        );
    }
    // DOC_FACT_DISCIPLINE (src/docfacts.ts): what the fact check still disputes is mended or its sentence cut within
    // the part's cap, then checked once more; a part that still isn't clean is dropped as a refused part would be
    // (at most one, never the first, DOC_DROP_REFUSED_CHAPTER), or the explainer stops. A refusal is handled below.
    if (s.cfg.docFactDiscipline && !(s.cfg.writerNotesGuard && chapterRefusal(chapter!).length)) {
      const label = EXPLAINED_PARTS[index]!.label;
      const settled = await disciplineChapter({
        chapter: chapter!,
        disputed,
        check: (c) => checkChapterItems(s.llm, c, source),
        maxCutShare: s.cfg.docFactCutPercent / 100,
      });
      await logEvent(s.db, ep.id, "doc_fact_discipline", {
        part: label,
        ok: settled.ok,
        disputed: disputed?.length ?? null,
        repairs: settled.repairs,
        ...(settled.ok ? { cut_words: settled.cut, of_words: settled.base } : { why: settled.why, left: settled.left }),
      }).catch(() => undefined);
      if (settled.ok) {
        if (settled.repairs.length) {
          chapter = settled.chapter;
          warnings.push(docFactLine(label, settled.repairs));
        }
      } else if (settled.errored) {
        // The check itself could not run: no verdict, so the step is tried again later.
        throw new Error(`explainer part "${label}": ${settled.why}; trying again later`);
      } else if (s.cfg.docDropRefusedChapter && index > 0 && dropped.size === 0) {
        dropped.add(index);
        warnings.push(`${label}: dropped, its fact check still disputes it after the rewrites and the cuts (${settled.why.slice(0, 200)})`);
        await logEvent(s.db, ep.id, "explained_part_dropped", { part: label, why: settled.why.slice(0, 300), facts: true }).catch(() => undefined);
        log("warn", "explained part dropped", { episode: ep.id, part: label, facts: true });
        continue;
      } else
        throw new FatalError(
          `explainer part "${label}" fails its fact check after rewrites and cuts: ${settled.why.slice(0, 220)}`,
        );
    }
    // A spoiler that survives the last rewrite: its sentences are cut, so one phrase never stops the whole video.
    chapter = {
      ...chapter!,
      paragraphs: chapter!.paragraphs.map((p) => {
        const kept = sentencesOf(p.narration).filter((x) => !spoilerProblems(x, s.now(), games).length);
        return kept.length === sentencesOf(p.narration).length ? p : { ...p, narration: kept.join(" ") };
      }),
    };
    if (s.cfg.writerNotesGuard && chapterRefusal(chapter!).length && s.cfg.docDropRefusedChapter && index > 0 && dropped.size === 0) {
      dropped.add(index);
      warnings.push(`${EXPLAINED_PARTS[index]!.label}: dropped, the writer found no source for it (${chapterRefusal(chapter!)[0]!.slice(0, 160)})`);
      await logEvent(s.db, ep.id, "explained_part_dropped", { part: EXPLAINED_PARTS[index]!.label, why: chapterRefusal(chapter!)[0]!.slice(0, 300) }).catch(() => undefined);
      log("warn", "explained part dropped", { episode: ep.id, part: EXPLAINED_PARTS[index]!.label });
      continue;
    }
    if (s.cfg.writerNotesGuard && chapterRefusal(chapter!).length)
      throw new FatalError(
        `explainer part "${EXPLAINED_PARTS[index]!.label}" refused: ${chapterRefusal(chapter!)[0]!.slice(0, 200)}`,
      );
    const grounded = groundCallouts(chapter!, source);
    warnings.push(
      ...grounded.removed.map(
        (r) =>
          `${EXPLAINED_PARTS[index]!.label}: on-screen ${r} not in the sources, removed`,
      ),
    );
    let moments: DocMoment[] | undefined;
    try {
      const sentences = grounded.chapter.paragraphs.flatMap((p) =>
        sentencesOf(p.narration),
      );
      const shot = groundDocMoments(
        await writeDocMoments(s.llm, {
          game: story.game || outline.title,
          chapterTitle: outline.chapters[index]!.chapter_title,
          sentences,
          source,
          games,
          lessons: await visualLessons(s.db, s.now(), deps.segmentInputs).catch(
            () => "",
          ),
        }),
        source,
        games,
        sentences,
      );
      moments = shot.moments;
      warnings.push(
        ...shot.removed.map(
          (r) =>
            `${EXPLAINED_PARTS[index]!.label}: on-screen ${r} not in the sources, removed`,
        ),
      );
    } catch (err) {
      log("warn", "explained shot list failed", {
        episode: ep.id,
        chapter: index + 1,
        error: errorMessage(err),
      });
    }
    done.push({ chapter: grounded.chapter, source, moments });
    log("info", "explained chapter written", {
      episode: ep.id,
      chapter: index + 1,
    });
  }
  const chapters = done.map((d) => d.chapter);
  // The plan without the dropped part, so each written part keeps its own title.
  const plan = dropped.size ? { ...outline, chapters: outline.chapters.filter((_, i) => !dropped.has(i)) } : outline;
  let bookends = await writeExplainedBookends(s.llm, plan, chapters, story);
  const bookendSpoilers = (b: typeof bookends) =>
    spoilerProblems(
      [b.intro.narration, b.intro.on_screen, b.outro.narration, b.outro.on_screen].filter(Boolean).join(" "),
      s.now(),
      games,
    );
  const endProblems = [
    ...validateBookends(bookends),
    ...explainedBookendProblems(bookends, story),
    ...bookendSpoilers(bookends),
  ];
  if (endProblems.length) {
    bookends = await writeExplainedBookends(
      s.llm,
      plan,
      chapters,
      story,
      endProblems,
    );
    warnings.push(
      ...validateBookends(bookends),
      ...explainedBookendProblems(bookends, story),
      ...bookendSpoilers(bookends),
    );
  }
  const words = explainedWords(chapters, bookends);
  if (words < EXPLAINED_WORDS_MIN || words > EXPLAINED_WORDS_MAX)
    warnings.push(
      `The explainer is ${words} words (aim ${EXPLAINED_WORDS_MIN}-${EXPLAINED_WORDS_MAX}, 15-20 minutes).`,
    );
  if (warnings.length)
    await logEvent(s.db, ep.id, "style_warnings", { problems: warnings });
  const script = explainedToScript(story, plan, done, bookends);
  await guardScript(s, ep, script, "after writing");
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      explained: true,
      // Parts dropped for want of a source, so the weekly round-up test can tell a shorter explainer apart.
      ...(dropped.size ? { dropped: [...dropped].map((i) => EXPLAINED_PARTS[i]!.label) } : {}),
      story,
      words,
      sources: script.sources,
      warnings,
    },
  });
}
