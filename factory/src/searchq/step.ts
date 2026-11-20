// The search lane (SEARCH_SHORTS, 12 Nov 2026): one Short answers one thing people search, titled in their words.
// At each SEARCH_SLOTS slot (apart from the news and Why slots), up to the day's allowance (SEARCH_PER_DAY, or
// SEARCH_PER_DAY_LAUNCH in the launch week), the best makeable query from the last harvest becomes a Short. It is made
// like any news-lane Short (the writer, the friend voice, the fact check, the spoiler guard, the game sound bed and
// the graphics audit all run as usual) with three differences:
//   - its sources are the confirmed lines that answer the query (each official link, plus the lines themselves, so a
//     page that will not load still leaves the facts in front of the writer and the fact check) and, after launch,
//     the owner's own play notes; a rumour line keeps its label;
//   - the writer's brief says: answer the search in the first three seconds and title it in the searcher's words; a
//     title that drops the query's words is replaced by the planned one, which keeps them;
//   - with a clip of the game in the owner's gameplay inbox, the Short opens on his own footage.
// Search Shorts count neither towards the news cap nor the daily target: they never crowd out a news slot.

import type { Db } from "../db.ts";
import type { StoryCluster } from "../discovery/cluster.ts";
import type { ArticleText } from "../discovery/article.ts";
import type { Llm } from "../editorial/llm.ts";
import {
  factCheck,
  validateScript,
  writeScript,
} from "../editorial/editorial.ts";
import {
  narrationOf,
  type FactCheck,
  type Script,
} from "../editorial/schema.ts";
import { spoilerProblems } from "../sceneindex/spoilers.ts";
import { createEpisode, logEvent, takenSlots } from "../episodes.ts";
import { LANE_PRIORITY, dayKey, evergreenDue } from "../lanes.ts";
import { log, shortId } from "../lib/util.ts";
import { searchMadeToday } from "./count.ts";
import {
  displayName,
  makeable,
  searchSlug,
  searchTitleProblems,
  type QueryCluster,
} from "./rank.ts";
import { searchTitleFor, type SearchStory } from "./brief.ts";
import { factsFileFor, outletOf, readFacts, type Fact } from "./facts.ts";
import { sameName } from "./job.ts";
import { readQueries, searchDir } from "./store.ts";
import { searchCapFor, type SearchShortsSettings } from "./settings.ts";

const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
/** The writer's site and the fact check's, so CODEX_CALLS=search sends both to Codex. */
export const SEARCH_WRITE_SITE = "search.write";
export const SEARCH_CHECK_SITE = "search.check";

/** The story for one query (pure): an item per official link, one with the lines themselves, one with the play notes. */
export function searchCluster(
  q: QueryCluster,
  now: Date,
  ownFootage: boolean,
  /** Every other confirmed line on the game, so the fact check can see a date or price that contradicts them. */
  context: Fact[] = [],
): StoryCluster {
  const at = now.toISOString();
  const slug = searchSlug(q.game, q.key);
  const byUrl = new Map<string, Fact[]>();
  for (const f of q.facts)
    for (const u of f.urls.slice(0, 1))
      byUrl.set(u, [...(byUrl.get(u) ?? []), f]);
  const line = (f: Fact) =>
    `${f.rumour ? "REPORTED, NOT CONFIRMED: " : ""}${f.text}${f.urls[0] ? ` (${f.source}: ${f.urls[0]})` : ` (${f.source})`}`;
  const items: StoryCluster["items"] = [...byUrl.entries()].map(
    ([url, fs]) => ({
      title: fs[0]!.text.slice(0, 90),
      url,
      summary: fs.map(line).join("\n"),
      publishedAt: at,
      source: outletOf(url),
      sourceKind: fs.every((f) => f.rumour)
        ? ("outlet" as const)
        : ("official" as const),
    }),
  );
  // The lines as collected, under a link that is never fetched as a page: the writer and the check always see them.
  items.push({
    title: `${displayName(q.game)}: the confirmed facts that answer "${q.query}"`,
    url: `https://pulsegmg.com/facts/${slug}`,
    summary: [
      q.facts.map(line).join("\n") || "(no fact lines)",
      ...(context.some((f) => !f.rumour && !q.facts.some((x) => x.text === f.text))
        ? [
            "Other confirmed facts on the game (for checking only; the Short answers the search above):",
            ...context.filter((f) => !f.rumour && !q.facts.some((x) => x.text === f.text)).map(line),
          ]
        : []),
    ].join("\n"),
    publishedAt: at,
    source: "Pulse fact file",
    sourceKind: "outlet",
  });
  if (q.playNotes.length)
    items.push({
      title: `What Pulse found playing ${displayName(q.game)}`,
      url: `https://pulsegmg.com/play-notes/${slug}`,
      summary: q.playNotes.map((n) => `${n.text} (${n.from})`).join("\n"),
      publishedAt: at,
      source: "Pulse's own play",
      sourceKind: "outlet",
    });
  const official = q.facts.some((f) => !f.rumour && f.urls.length);
  const search: SearchStory = {
    query: q.query,
    title: q.title,
    key: q.key,
    intent: q.intent,
    facts: q.facts,
    playNotes: q.playNotes,
    rumour: q.rumour,
    ownFootage,
    score: q.score,
  };
  return {
    hash: `search:${slug}`,
    headline: q.title,
    items,
    sources: [...new Set(items.map((i) => i.source))],
    hasOfficial: official,
    // Confirmed lines, or the owner's own play: anything else is labelled a rumour by the writer.
    corroborated: !q.rumour,
    rumourSignals: q.rumour,
    newestAt: at,
    score: q.score,
    gameHint: q.game,
    visualNeed: "game_footage",
    run: true,
    search,
  };
}

/** House problems a search Short adds to the usual ones (pure): the spoiler guard and the title. */
export function searchProblems(
  sc: Script,
  s: SearchStory,
  game: string,
  now = new Date(),
): string[] {
  return [
    ...spoilerProblems(
      [sc.hook, narrationOf(sc), sc.youtube.title, sc.youtube.description].join(
        "\n",
      ),
      now,
      [game],
    ),
    ...searchTitleProblems(sc.youtube.title, s.query, game).map(
      (p) => `Title: ${p}`,
    ),
  ];
}

export interface SampleResult {
  query: string;
  title: string;
  verdict: "pass" | "fail" | "error";
  script?: Script;
  check?: FactCheck;
  problems: string[];
  sources: Array<{ url: string; source: string; read: boolean }>;
  markdown: string[];
}

/**
 * A sample script for one query, the way the lane writes it (the hand tool's proof): the sources read, the Short
 * writer and the fact check on the search sites, one rewrite with the problems if the first draft fails.
 */
export async function writeSearchSample(
  llm: Llm,
  cluster: StoryCluster,
  read: (url: string) => Promise<ArticleText | undefined>,
  now = new Date(),
): Promise<SampleResult> {
  const s = cluster.search!;
  const game = cluster.gameHint ?? "";
  const articles = (
    await Promise.all(
      cluster.items.map((i) =>
        /pulsegmg\.com\/(facts|play-notes)\//.test(i.url)
          ? undefined
          : read(i.url).catch(() => undefined),
      ),
    )
  ).filter((a): a is ArticleText => Boolean(a));
  const sources = cluster.items.map((i) => ({
    url: i.url,
    source: i.source,
    read: articles.some((a) => a.url === i.url),
  }));
  let script: Script | undefined;
  let check: FactCheck | undefined;
  let problems: string[] = [];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      script = await writeScript(llm, cluster, articles, {
        mustLabelRumour: !cluster.corroborated,
        desk: false,
        feedback: problems,
        draft: attempt > 0 ? script : undefined,
        site: SEARCH_WRITE_SITE,
      });
      script = {
        ...script,
        youtube: {
          ...script.youtube,
          title: searchTitleFor(script.youtube.title, s, game),
        },
      };
      check = await factCheck(
        llm,
        script,
        cluster,
        articles,
        undefined,
        SEARCH_CHECK_SITE,
      );
      problems = [
        ...check.issues
          .filter((i) => i.severity === "blocker")
          .map((i) => `Fact-check: "${i.quote}" - ${i.problem}`),
        ...validateScript(script),
        ...searchProblems(script, s, game, now),
      ];
      if (
        check.verdict === "pass" &&
        check.rumour_labelling_ok &&
        !problems.some((p) => p.startsWith("Fact-check"))
      )
        break;
    }
  } catch (err) {
    return {
      query: s.query,
      title: s.title,
      verdict: "error",
      problems: [String((err as Error)?.message ?? err)],
      sources,
      markdown: [
        `## ${s.query}`,
        "",
        `Writer failed: ${String((err as Error)?.message ?? err)}`,
      ],
    };
  }
  const passed =
    check?.verdict === "pass" &&
    check.rumour_labelling_ok &&
    !problems.some((p) => p.startsWith("Fact-check"));
  const sc = script!;
  const markdown = [
    `## "${s.query}" (score ${s.score})`,
    "",
    `**Title:** ${sc.youtube.title}`,
    `**Fact check:** ${passed ? "pass" : "fail"}${check?.issues.length ? ` (${check.issues.map((i) => `${i.severity}: ${i.problem}`).join("; ")})` : ""}`,
    `**House notes:** ${problems.length ? problems.join(" ") : "none"}`,
    "",
    `**Hook:** ${sc.hook}`,
    ...sc.beats.map(
      (b, i) =>
        `**Beat ${i + 1}:** ${b.narration}  _[card: ${b.visual.kind} "${b.visual.primary}"]_`,
    ),
    `**Take:** ${sc.pulse_take.narration}`,
    `**Loop:** ${sc.loop_line}`,
    "",
    `**Description:** ${sc.youtube.description}`,
    "",
    `Sources: ${sources.map((x) => `${x.source} (${x.read ? "read" : "lines only"})`).join(", ")}`,
  ];
  return {
    query: s.query,
    title: sc.youtube.title,
    verdict: passed ? "pass" : "fail",
    script: sc,
    check,
    problems,
    sources,
    markdown,
  };
}

// ---------------------------------------------------------------- the lane

export { searchMadeToday };

/** The search Shorts on a slot's day (by their slots, so a Short made before midnight counts on its own day). */
async function searchOnDay(
  db: Db,
  day: string,
  timeZone: string,
): Promise<number> {
  const rows = await db.query<{ slot_at: string | Date | null }>(
    `SELECT slot_at FROM episodes WHERE story_json ? 'search' AND status NOT IN ('failed','rejected')
        AND slot_at > now() - interval '3 days'`,
  );
  return rows.filter(
    (r) => r.slot_at && dayKey(new Date(r.slot_at), timeZone) === day,
  ).length;
}

export interface SearchLaneDeps {
  db: Db;
  cfg: {
    searchShorts: SearchShortsSettings;
    dataDir: string;
    timezone: string;
    slotLeadMinutes: number;
    slotGraceMinutes: number;
  };
  now: () => Date;
  /** Whether the owner's gameplay inbox holds a clip of this game. */
  ownFootage?: (game: string) => Promise<boolean>;
  notify?: (m: { level?: "info"; content: string }) => Promise<unknown>;
}

/** The search slot due now, if any, with the day's allowance left: the slot. */
export async function searchSlotDue(
  d: SearchLaneDeps,
): Promise<Date | undefined> {
  const { cfg } = d;
  const s = cfg.searchShorts;
  if (!s.enabled || !s.slots.length) return undefined;
  const now = d.now();
  const taken = await takenSlots(d.db);
  for (const slot of s.slots) {
    const due = evergreenDue(
      now,
      {
        days: ALL_DAYS,
        slot,
        leadMinutes: cfg.slotLeadMinutes + 30,
        graceMinutes: cfg.slotGraceMinutes,
        timeZone: cfg.timezone,
      },
      taken,
    );
    if (!due) continue;
    const day = dayKey(due, cfg.timezone);
    if ((await searchOnDay(d.db, day, cfg.timezone)) >= searchCapFor(s, day))
      return undefined;
    return due;
  }
  return undefined;
}

/**
 * The search lane's turn: at a due SEARCH_SLOTS slot with allowance left, the best makeable query of the last harvest
 * not made before becomes an episode. Nothing makeable: the slot stays empty (it was never a news slot).
 */
export async function maybeSelectSearch(
  d: SearchLaneDeps,
): Promise<string | undefined> {
  const due = await searchSlotDue(d);
  if (!due) return undefined;
  const file = await readQueries(searchDir(d.cfg.dataDir));
  if (!file?.queries.length) return undefined;
  // One look per slot and harvest: a slot with nothing makeable is not asked again every tick, only after a new harvest.
  const [fresh] = await d.db.query(
    `INSERT INTO settings (key, value) VALUES ($1, 'yes') ON CONFLICT (key) DO NOTHING RETURNING key`,
    [`search_tried:${due.toISOString()}:${file.harvestedAt}`],
  );
  if (!fresh) return undefined;
  const rows = await d.db.query<{
    hash: string;
    game: string | null;
    intent: string | null;
    recent: boolean;
  }>(
    `SELECT story_hash AS hash, story_json->>'gameHint' AS game, story_json->'search'->>'intent' AS intent,
            (created_at > now() - interval '3 days' AND status NOT IN ('failed','rejected')) AS recent
       FROM episodes WHERE story_hash LIKE 'search:%'`,
  );
  const made = rows.map((r) => r.hash.replace(/^search:/, ""));
  // No two search Shorts on the same ask of a game within three days ("gta 6 pre order", then its price).
  const recentIntents = rows
    .filter((r) => r.recent && r.game && r.intent)
    .map((r) => `${r.game}|${r.intent}`);
  const pick = makeable(
    file.queries,
    d.cfg.searchShorts.minScore,
    made,
    recentIntents,
  )[0];
  if (!pick) {
    log("info", "search: nothing makeable for the slot", {
      slot: due.toISOString(),
    });
    return undefined;
  }
  const own = (await d.ownFootage?.(pick.game).catch(() => false)) ?? false;
  const cluster = searchCluster(
    pick,
    d.now(),
    own,
    readFacts(factsFileFor(d.cfg.searchShorts.facts, pick.game, sameName)),
  );
  const id = shortId();
  if (
    !(await createEpisode(d.db, id, cluster, {
      lane: "news",
      priority: LANE_PRIORITY.news,
      slotAt: due,
    }))
  )
    return undefined;
  await logEvent(d.db, id, "selected", {
    headline: cluster.headline,
    lane: "search",
    query: pick.query,
    score: pick.score,
    intent: pick.intent,
    game: pick.game,
    own_footage: own,
    slot_at: due.toISOString(),
  });
  log("info", "search query selected", {
    id,
    query: pick.query,
    slot: due.toISOString(),
  });
  return id;
}
