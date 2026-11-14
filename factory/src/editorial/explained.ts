// "The week's biggest gaming story, explained" (owner-approved test, 1 Nov 2026): the weekly long video as ONE
// story told in depth instead of a round-up of five. Our documentary study (single stories broke out far more
// often than surveys) and a faceless commentary channel that grew on "one big story, explained" both point the
// same way. This module holds the pure parts: picking the week's story from the factory's own data (the news
// clusters, their breaking scores, how our Shorts on it did, the YouTube demand check), the fixed five-part shape
// (a cold open on the sharpest fact, then what happened, why it happened, what it means for players and what to
// watch next), the packaging rules ("Why X Really ...", never "This week") and the checks a draft must pass.
// The writing goes through the documentary's machinery (chapter schema, fact check, grounded callouts, the shot
// list with on-screen evidence, docToScript), so everything downstream of the script (fill pass, fillers, camera,
// structure, sound craft, footage first, release gate, chapters, pinned comment, next-video link) treats it as a
// documentary. Its model sites are named "doc.explained.*" so CODEX_CALLS=doc routes them to Codex as well.

import { z } from "zod";
import { youRule } from "./longrules.ts";
import type { Llm } from "./llm.ts";
import type { Script } from "./schema.ts";
import type { WikiArticle } from "../discovery/wikipedia.ts";
import type { Demand } from "../discovery/searchdemand.ts";
import {
  advertiserProblems,
  phraseProblems,
  stockSegueProblems,
  voiceFor,
  writingProblems,
} from "./voice.ts";
import {
  DocBookendsSchema,
  DocChapterSchema,
  docToScript,
  type DocBookends,
  type DocChapter,
  type DocChapterPlan,
  type DocDraft,
  type DocMoment,
  type DocOutline,
} from "./documentary.ts";

// ---------------------------------------------------------------- length

/** 15-20 minutes at the narrator's 140-155 words a minute. */
export const EXPLAINED_WORDS_MIN = 2200;
export const EXPLAINED_WORDS_MAX = 3000;
export const EXPLAINED_CHAPTER_WORDS_MIN = 430;
export const EXPLAINED_CHAPTER_WORDS_MAX = 720;
export const EXPLAINED_PARAGRAPHS_MIN = 4;
export const EXPLAINED_PARAGRAPHS_MAX = 7;

/** The four chapters after the cold open (the intro bookend), in order. */
export const EXPLAINED_PARTS = [
  {
    key: "what",
    label: "What Happened",
    job: "What happened, in order: who announced or did what, when, through which statement, post or report, and the plain facts a viewer needs (dates, prices, platforms, numbers). Name the outlets and the official statements as the sources do.",
  },
  {
    key: "why",
    label: "Why It Happened",
    job: "Why it happened: the real causes the sources give (money, timing, technology, contracts, a company's strategy, earlier decisions), each one attributed to whoever says it. Where the sources disagree, give both sides. Never guess a motive the sources do not state.",
  },
  {
    key: "means",
    label: "What It Means for Players",
    job: "What it means for players: what changes for someone who owns, plays or was waiting for the game (access, money, dates, saves, servers, platforms), and how players and the industry have responded in the sources. Calm and specific; judge decisions, never people.",
  },
  {
    key: "next",
    label: "What to Watch Next",
    job: "What to watch next: the dates, decisions and open questions the sources point to, what would change the picture, and what the company has and has not confirmed. End on the single thing worth watching.",
  },
] as const;
export type ExplainedPartKey = (typeof EXPLAINED_PARTS)[number]["key"];

// ---------------------------------------------------------------- picking the story

/** Words that mark industry conflict: the stories one explained video can carry for 15-20 minutes. */
const CONFLICT =
  /\b(shut(ting|s)? down|shutdown|closes?|closing|closure|layoffs?|laid off|job cuts?|cuts? jobs|voluntary exit|redundanc\w*|delay(ed|s)?|postpone\w*|pushed back|cancel(led|ed|s|lation)?|scrapped|petition|backlash|boycott|review[- ]bomb\w*|refunds?|dispute|lawsuit|sued|sues|court|legal|exclusiv\w*|price (rise|hike|increase)|raises? (the )?prices?|more expensive|servers?|delist\w*|removed from sale|input lag|broken|performance issues|failed|flop|struggl\w*|controvers\w*|criticis\w*|walk(s|ed)? back|revers\w*|u-turn|acquisition|acquire[sd]?|merger|unioni[sz]\w*|walkout|leak(ed|s)?|banned)\b/gi;

/** Topics the channel does not build a whole video on: harm to people, abuse, tragedy. */
const UNSAFE =
  /\b(abuse\w*|harass\w*|assault\w*|misconduct|sexual\w*|allegations?|accused|died|dies|death|dead|killed|shooting|suicid\w*|arrest\w*|charged|jail\w*|prison|tragedy|tragic|passed away|funeral|threats?|doxx\w*|racis\w*|hate)\b/i;

/** A story mainly about one person's career move: thin for 15 minutes, and too close to a private life. */
const PERSON_MOVE =
  /\b(leaves|left|steps? down|stepping down|resign\w*|retir\w*|fired|ousted|departs?|departure|joins|hired|appointed|promoted)\b/i;

/** One of our Shorts on the story, with what it did. */
export interface StoryShort {
  id: string;
  game: string;
  headline: string;
  score: number;
  views: number;
  /** Average percentage viewed (0-100), once captured. */
  pct?: number;
  rumour: boolean;
  urls: Array<{ url: string; source: string; title: string }>;
  /** The Short's own fact-checked narration. */
  narration?: string;
}

/** A news cluster the discovery poll saw this week (cluster_sightings). */
export interface StorySighting {
  hash: string;
  headline: string;
  score: number;
  items: number;
  official: boolean;
  sources: string[];
  rumour: boolean;
  game?: string;
  summaries: string[];
  urls: Array<{ url: string; source: string; title: string }>;
}

/** One candidate story for the week: our Shorts on it and every cluster that covered it. */
export interface StoryCandidate {
  key: string;
  game: string;
  headline: string;
  headlines: string[];
  shorts: StoryShort[];
  sightings: StorySighting[];
  rumour: boolean;
}

export interface StoryScore {
  /** 0-100. */
  total: number;
  parts: {
    breaking: number;
    coverage: number;
    performance: number;
    demand: number;
    conflict: number;
  };
  conflictTerms: string[];
  /** Why the story cannot carry the video, when it cannot. */
  excluded?: string;
}

/** How much each signal counts, out of 100. */
export const STORY_WEIGHTS = {
  breaking: 25,
  coverage: 15,
  performance: 25,
  demand: 15,
  conflict: 20,
} as const;
/** A rumour can win, labelled, but it starts behind a confirmed story. */
export const RUMOUR_FACTOR = 0.85;
/** The least a story must score to be made; below it the round-up runs that week instead. */
export const STORY_MIN_SCORE = 35;
/** Outlets a story needs (or an official statement) before it can carry 15 minutes. */
export const STORY_MIN_OUTLETS = 2;

const keyOf = (t: string) =>
  t
    .toLowerCase()
    .replace(/[™®:'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const tokensOf = (t: string) => new Set(keyOf(t).split(" ").filter(Boolean));
const subset = (a: Set<string>, b: Set<string>) =>
  a.size > 0 && [...a].every((x) => b.has(x));

/**
 * Groups the week's Shorts and clusters into stories (pure). A Short's game is a story; a game whose name sits
 * inside another's ("Mass Effect" in "Mass Effect 5") is the same story; a cluster joins the story whose game it
 * names (or whose game the editor gave it); a cluster that names none of them stands alone under its own game hint
 * or headline.
 */
export function groupStories(
  shorts: StoryShort[],
  sightings: StorySighting[],
): StoryCandidate[] {
  const groups: StoryCandidate[] = [];
  const byKey = new Map<string, StoryCandidate>();
  const sorted = [...shorts].sort(
    (a, b) => keyOf(a.game).length - keyOf(b.game).length,
  );
  for (const sh of sorted) {
    const k = keyOf(sh.game || sh.headline);
    const t = tokensOf(k);
    const into =
      byKey.get(k) ??
      groups.find(
        (g) => subset(tokensOf(g.key), t) || subset(t, tokensOf(g.key)),
      );
    if (into) {
      into.shorts.push(sh);
      into.headlines.push(sh.headline);
      into.rumour = into.rumour && sh.rumour;
      continue;
    }
    const g: StoryCandidate = {
      key: k,
      game: sh.game,
      headline: sh.headline,
      headlines: [sh.headline],
      shorts: [sh],
      sightings: [],
      rumour: sh.rumour,
    };
    groups.push(g);
    byKey.set(k, g);
  }
  for (const si of sightings) {
    const h = tokensOf(si.headline);
    const hint = si.game ? keyOf(si.game) : "";
    const into =
      (hint && byKey.get(hint)) ||
      groups.find((g) => subset(tokensOf(g.key), h));
    if (into) {
      into.sightings.push(si);
      into.headlines.push(si.headline);
      continue;
    }
    const k = hint || `cluster ${si.hash}`;
    const own = byKey.get(k);
    if (own) {
      own.sightings.push(si);
      own.headlines.push(si.headline);
      own.rumour = own.rumour && si.rumour;
      continue;
    }
    const g: StoryCandidate = {
      key: k,
      game: si.game ?? "",
      headline: si.headline,
      headlines: [si.headline],
      shorts: [],
      sightings: [si],
      rumour: si.rumour,
    };
    groups.push(g);
    byKey.set(k, g);
  }
  // The headline that leads is the strongest cluster's (else the best Short's): it names the story best.
  for (const g of groups) {
    const top = [...g.sightings].sort((a, b) => b.score - a.score)[0];
    const short = [...g.shorts].sort((a, b) => b.views - a.views)[0];
    g.headline = top?.headline ?? short?.headline ?? g.headline;
    g.rumour =
      g.shorts.every((s) => s.rumour) && g.sightings.every((s) => s.rumour);
  }
  return groups;
}

const DEMAND_LEVEL = { none: 0, low: 1 / 3, medium: 2 / 3, high: 1 } as const;

/** Every outlet that covered the story, once. */
export function outletsOf(c: StoryCandidate): string[] {
  return [
    ...new Set([
      ...c.sightings.flatMap((s) => s.sources),
      ...c.shorts.flatMap((s) => s.urls.map((u) => u.source)),
    ]),
  ].filter(Boolean);
}

/**
 * The story's score (pure): its breaking score, how widely it was covered, how our own Shorts on it did (views
 * against the week's best, and the share of each Short watched), the YouTube demand check, and whether it is
 * industry conflict. A story about harm to people, abuse or tragedy, or mainly one person's career move, is
 * excluded however it scores; so is one with a single outlet and no official word.
 */
export function scoreStory(
  c: StoryCandidate,
  ctx: { weekBestViews: number; demand?: Demand },
): StoryScore {
  const text = c.headlines.join(" \n ");
  const breaking = Math.min(
    1,
    Math.max(
      0,
      ...c.sightings.map((s) => s.score),
      ...c.shorts.map((s) => s.score),
    ) / 120,
  );
  const outlets = outletsOf(c);
  const official = c.sightings.some((s) => s.official);
  const coverage = Math.min(1, outlets.length / 6 + (official ? 0.2 : 0));
  const best = Math.max(0, ...c.shorts.map((s) => s.views));
  const viewsRel =
    ctx.weekBestViews > 0 ? Math.sqrt(best / ctx.weekBestViews) : 0;
  const pcts = c.shorts.flatMap((s) => (s.pct !== undefined ? [s.pct] : []));
  const pct = pcts.length ? Math.min(1, Math.max(...pcts) / 100) : undefined;
  const performance = pct === undefined ? viewsRel : 0.7 * viewsRel + 0.3 * pct;
  const demand = ctx.demand ? DEMAND_LEVEL[ctx.demand.level] : 0.5;
  const terms = [
    ...new Set((text.match(CONFLICT) ?? []).map((t) => t.toLowerCase())),
  ];
  // How much of the coverage is about the conflict: a launch with one input-lag headline among fifteen is a
  // launch, a server shutdown every outlet reports as one is the story.
  const share = c.headlines.length
    ? c.headlines.filter((h) => new RegExp(CONFLICT.source, "i").test(h))
        .length / c.headlines.length
    : 0;
  const conflict = terms.length ? 0.4 + 0.6 * share : 0;
  const parts = {
    breaking: round1(breaking * STORY_WEIGHTS.breaking),
    coverage: round1(coverage * STORY_WEIGHTS.coverage),
    performance: round1(performance * STORY_WEIGHTS.performance),
    demand: round1(demand * STORY_WEIGHTS.demand),
    conflict: round1(conflict * STORY_WEIGHTS.conflict),
  };
  const sum = Object.values(parts).reduce((n, x) => n + x, 0);
  const total = round1(c.rumour ? sum * RUMOUR_FACTOR : sum);
  const unsafe = withoutName(text, c.game).match(UNSAFE)?.[0];
  let excluded: string | undefined;
  if (unsafe) excluded = `about harm to people ("${unsafe}")`;
  else if (PERSON_MOVE.test(c.headline) && !terms.length)
    excluded = "mainly one person's career move";
  else if (outlets.length < STORY_MIN_OUTLETS && !official)
    excluded = `only ${outlets.length} outlet and no official word`;
  else if (
    !c.shorts.some((s) => s.urls.length) &&
    !c.sightings.some((s) => s.urls.length)
  )
    excluded = "no article to write from";
  return { total, parts, conflictTerms: terms, excluded };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export interface RankedStory {
  story: StoryCandidate;
  score: StoryScore;
}

/** Stories best first (pure); excluded ones last, in score order, so the report can show why they lost. */
export function rankStories(
  stories: StoryCandidate[],
  demand: Map<string, Demand> = new Map(),
): RankedStory[] {
  const weekBestViews = Math.max(
    0,
    ...stories.flatMap((s) => s.shorts.map((x) => x.views)),
  );
  return stories
    .map((story) => ({
      story,
      score: scoreStory(story, {
        weekBestViews,
        demand: demand.get(demandQuery(story)),
      }),
    }))
    .sort(
      (a, b) =>
        Number(!!a.score.excluded) - Number(!!b.score.excluded) ||
        b.score.total - a.score.total,
    );
}

/** The pick: the best story that is not excluded and clears STORY_MIN_SCORE; undefined sends the round-up. */
export function pickStory(ranked: RankedStory[]): RankedStory | undefined {
  const top = ranked[0];
  return top && !top.score.excluded && top.score.total >= STORY_MIN_SCORE
    ? top
    : undefined;
}

/** What the demand check searches for: the game, else the headline. */
export const demandQuery = (c: StoryCandidate): string =>
  c.game || c.headline.split(/\s+/).slice(0, 6).join(" ");

/** The scoring as the Discord line and the smoke print show it. */
export function scoreLine(r: RankedStory): string {
  const p = r.score.parts;
  const views = Math.max(0, ...r.story.shorts.map((s) => s.views));
  return `${r.score.total.toFixed(1)} = breaking ${p.breaking} + coverage ${p.coverage} (${outletsOf(r.story).length} outlets) + our Shorts ${p.performance} (${r.story.shorts.length} Short${r.story.shorts.length === 1 ? "" : "s"}, best ${views} views) + demand ${p.demand} + conflict ${p.conflict}${r.score.conflictTerms.length ? ` (${r.score.conflictTerms.slice(0, 4).join(", ")})` : ""}${r.story.rumour ? `, x${RUMOUR_FACTOR} as a rumor` : ""}${r.score.excluded ? `; skipped: ${r.score.excluded}` : ""}`;
}

/** What the episode keeps of the pick (factcheck_json.story): enough to write it without re-ranking. */
export interface ExplainedStory {
  key: string;
  game: string;
  steamTerm: string;
  headline: string;
  headlines: string[];
  shortIds: string[];
  urls: Array<{ url: string; source: string; title: string }>;
  summaries: string[];
  rumour: boolean;
  score: number;
  scoreLine: string;
}

export function explainedStoryOf(r: RankedStory): ExplainedStory {
  const s = r.story;
  const urls = new Map<
    string,
    { url: string; source: string; title: string }
  >();
  for (const u of [
    ...[...s.sightings]
      .sort((a, b) => b.score - a.score)
      .flatMap((x) => x.urls),
    ...s.shorts.flatMap((x) => x.urls),
  ])
    if (u.url && !urls.has(u.url)) urls.set(u.url, u);
  return {
    key: s.key,
    game: s.game,
    steamTerm: s.game,
    headline: s.headline,
    headlines: [...new Set(s.headlines)].slice(0, 12),
    shortIds: [...s.shorts].sort((a, b) => b.views - a.views).map((x) => x.id),
    urls: [...urls.values()].slice(0, 8),
    summaries: [...new Set(s.sightings.flatMap((x) => x.summaries))]
      .filter(Boolean)
      .slice(0, 10),
    rumour: s.rumour,
    score: r.score.total,
    scoreLine: scoreLine(r),
  };
}

// ---------------------------------------------------------------- packaging

const HOUSE = `You write long explainer videos for Pulse Gaming News, a YouTube channel about video games.

${voiceFor("documentary")}
This is one big story of the past few days, explained in depth like the best commentary channels do it: what happened, why, what it means and what comes next. Describe disputes, layoffs, delays, failures and criticism factually and calmly, attributed to whoever said them; judge decisions, never people. No inflammatory words.`;

/** Title, description and thumbnail words the channel keeps out (owner's monetisation rules). */
const INFLAMMATORY =
  /\b(death|dead|dies|died|war|wars|kill(s|ed|ing|er|ers)?|horror|scary|crisis|attack\w*|destroy\w*|disaster|scandal|outrage\w*|betray\w*|slams?|furious|exposed|lies|lied|greed\w*|shameful|insane|massive)\b/i;

export const ExplainedPackagingSchema = z.object({
  question: z
    .string()
    .describe(
      "The one question the video answers, as a viewer would ask it, e.g. 'Why did FromSoftware switch off Dark Souls servers?'",
    ),
  title: z.string().describe("On-screen title, 3-8 words"),
  kicker: z.string().describe("3-8 word line under the title"),
  chapter_titles: z
    .array(z.string())
    .min(4)
    .max(4)
    .describe(
      "Four chapter titles, one per part in the given order, 2-6 searchable words that name the subject and the turn, e.g. 'The Servers Go Dark'. Never 'Part 2' and never the bare part name",
    ),
  youtube: z.object({
    title: z
      .string()
      .describe(
        "Under 70 characters: one named subject and its downfall, fight or hidden side, e.g. 'Why FromSoftware Really Switched Off Dark Souls' or 'What Really Happened to Mass Effect'. Never 'This Week', 'weekly' or a date",
      ),
    thumb_text: z
      .string()
      .describe(
        "1-4 words in capitals that add the hook and do not restate the whole title (one strong word from its promise is fine)",
      ),
    description: z
      .string()
      .describe(
        "3-5 sentences: the story, its angle and what the video explains. No hashtags, no timestamps",
      ),
    tags: z.array(z.string()).max(15),
  }),
});
export type ExplainedPackaging = z.infer<typeof ExplainedPackagingSchema>;

export function packagingPrompt(): string {
  return `${HOUSE}

Package the video: its question, on-screen title and kicker, a title for each of its four chapters (${EXPLAINED_PARTS.map((p) => p.label).join(", ")}) and the YouTube metadata. The YouTube title names one subject plus its downfall, fight or hidden side ("Why X Really ...", "What Really Happened to X", "The Real Reason X ..."); in a study of 1,573 long gaming videos that shape carried the strongest. Never frame it as "this week" or a weekly show, never a date or a count. Accurate to the sources; a rumor is labeled in the title ("Reportedly", "Rumor") and the description.`;
}

export async function packageExplained(
  llm: Llm,
  story: ExplainedStory,
  source: WikiArticle,
  feedback: string[] = [],
): Promise<ExplainedPackaging> {
  const fb = feedback.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    site: "doc.explained.package",
    system: packagingPrompt(),
    content: `Story: ${story.headline}\nGame or company: ${story.game || "(none named)"}${story.rumour ? "\nThis story is a RUMOR: label it." : ""}\nHeadlines:\n${story.headlines.map((h) => `- ${h}`).join("\n")}\n\nSOURCES:\n${source.text.slice(0, 6000)}${fb}`,
    schema: ExplainedPackagingSchema,
    effort: "low",
    tier: "mid",
  });
}

/** Problems with the packaging (pure), worded for the rewrite. */
export function packagingProblems(
  p: ExplainedPackaging,
  story: Pick<ExplainedStory, "rumour" | "game">,
): string[] {
  const out: string[] = [];
  const t = p.youtube.title.trim();
  if (t.length > 70)
    out.push(`The title is ${t.length} characters; keep it under 70.`);
  for (const [name, text] of [
    ["title", t],
    ["on-screen title", p.title],
    ["kicker", p.kicker],
  ] as const)
    if (/\b(this|last|the) week\b|\bweekly\b|\bweek in\b/i.test(text))
      out.push(
        `The ${name} "${text}" frames it as a weekly show; name the story itself.`,
      );
  if (
    /\b\d{4}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
      t,
    )
  )
    out.push(`The title "${t}" carries a date; leave dates out of the title.`);
  const safe = (x: string) => withoutName(x, story.game);
  for (const [name, text] of [
    ["title", t],
    ["thumbnail text", p.youtube.thumb_text],
    ["description", p.youtube.description],
    ["kicker", p.kicker],
  ] as const) {
    const bad = safe(text).match(INFLAMMATORY)?.[0];
    if (bad)
      out.push(`"${bad}" in the ${name} is inflammatory; use a calm word.`);
  }
  out.push(
    ...advertiserProblems(
      `${t} ${p.youtube.description} ${p.youtube.thumb_text}`,
    ),
  );
  if (
    story.rumour &&
    !/\b(rumou?r\w*|reported(ly)?|report)\b/i.test(`${t} ${p.kicker}`)
  )
    out.push(
      'This story is a rumor: the title or the kicker says so ("Reportedly", "Rumor").',
    );
  if (
    story.rumour &&
    !/\b(rumou?r\w*|reported(ly)?|report|unconfirmed)\b/i.test(
      p.youtube.description,
    )
  )
    out.push(
      "This story is a rumor: the description says it is reported, not confirmed.",
    );
  if (p.chapter_titles.some((c) => /^part\b|^chapter\b/i.test(c.trim())))
    out.push('A chapter title is "Part"/"Chapter"; name the turn instead.');
  return out;
}

/** A text with the game's own name taken out, so "Gears of War" never reads as the word "war". */
function withoutName(text: string, game: string): string {
  if (!game) return text;
  // The full title and its main part before a subtitle ("Gears of War" of "Gears of War: E-Day").
  const names = [game, game.split(":")[0]!.trim()].filter((n) => n.length > 2);
  return names.reduce(
    (t, n) =>
      t.replace(
        new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        " ",
      ),
    text,
  );
}

// ---------------------------------------------------------------- outline and chapters

/** The outline (pure): the fixed four parts, each a chapter about the same story. No model call. */
export function explainedOutline(
  story: ExplainedStory,
  p: ExplainedPackaging,
  year: number,
): DocOutline {
  const chapters: DocChapterPlan[] = EXPLAINED_PARTS.map((part, i) => ({
    chapter_title: p.chapter_titles[i] ?? part.label,
    game_title: story.game || p.title,
    wiki_title: "",
    steam_search_term: story.steamTerm,
    year,
    platforms: "",
    focus: part.job,
    photo_searches: [],
  }));
  return {
    question: p.question,
    title: p.title,
    kicker: p.kicker,
    franchise_wiki_title: "",
    chapters,
    youtube: p.youtube,
  };
}

export function explainedChapterPrompt(youFloor = 0): string {
  return `${HOUSE}

Write one chapter of the explainer, ${EXPLAINED_CHAPTER_WORDS_MIN}-${EXPLAINED_CHAPTER_WORDS_MAX} spoken words in ${EXPLAINED_PARAGRAPHS_MIN}-${EXPLAINED_PARAGRAPHS_MAX} paragraphs of 45-140 words. You are told which part of the story this chapter tells; tell only that part, and never repeat what earlier chapters said (listed below).
Show the evidence: when a source quotes an official statement, a post or a report, say who said it and where, and put the most telling one on screen as a quote callout copied word for word. Name the outlets the way the sources do ("according to Eurogamer").
A hard number or a two-sided contrast at least every other paragraph, always from the sources; never more than two figures in one sentence.
Re-hook the viewer two or three times inside the chapter with a specific question the next lines answer; the chapter's last sentence leans into the next part without saying how it ends (the last chapter ends on the one thing to watch).
Every fact, number, date, name and quote must come from the SOURCES. If the sources do not say it, do not say it. A rumor stays a rumor: say who reported it, every time it comes up.
Callouts put a real fact on screen: at most half the paragraphs carry one. footage names what the picture should show for that paragraph, with 1-4 keywords.
List every factual claim in "claims" with the outlet it came from as the section.${youFloor ? `\n${youRule(youFloor)}` : ""}`;
}

export async function writeExplainedChapter(
  llm: Llm,
  ctx: {
    story: ExplainedStory;
    outline: DocOutline;
    index: number;
    source: WikiArticle;
    earlier: DocChapter[];
    feedback?: string[];
    /** LONG_YOU_PER_1000 (src/editorial/longrules.ts). */
    youFloor?: number;
  },
): Promise<DocChapter> {
  const part = EXPLAINED_PARTS[ctx.index]!;
  const list = ctx.outline.chapters
    .map(
      (c, i) =>
        `${i + 1}. ${c.chapter_title} (${EXPLAINED_PARTS[i]?.label})${i === ctx.index ? "  <- this chapter" : ""}`,
    )
    .join("\n");
  const said = ctx.earlier
    .flatMap((c) => c.claims.map((x) => x.claim))
    .slice(-60);
  const fb = ctx.feedback?.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${ctx.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    site: "doc.explained.chapter",
    system: explainedChapterPrompt(ctx.youFloor),
    content: `Video: ${ctx.outline.title}\nThe question it answers: ${ctx.outline.question}\nChapters:\n${list}\n\nThis chapter tells: ${part.job}${ctx.story.rumour ? "\nThis story is a RUMOR: keep it labeled." : ""}${said.length ? `\n\nAlready said (do not say again):\n${said.map((x) => `- ${x}`).join("\n")}` : ""}\n\nSOURCES:\n${ctx.source.text}${fb}`,
    schema: DocChapterSchema,
    effort: "medium",
    maxTokens: 10000,
  });
}

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Problems with one chapter (pure), worded for the rewrite. */
export function validateExplainedChapter(
  c: DocChapter,
  o: {
    earlier?: DocChapter[];
    rumour?: boolean;
    game?: string;
    index?: number;
  } = {},
): string[] {
  const p: string[] = [];
  const text = c.paragraphs.map((x) => x.narration).join(" ");
  p.push(...phraseProblems(text), ...writingProblems(text, { long: true }));
  p.push(
    ...stockSegueProblems(
      [
        ...(o.earlier ?? []).flatMap((x) =>
          x.paragraphs.map((y) => y.narration),
        ),
        text,
      ].join(" "),
    ),
  );
  const words = wordCount(text);
  if (
    words < EXPLAINED_CHAPTER_WORDS_MIN ||
    words > EXPLAINED_CHAPTER_WORDS_MAX
  )
    p.push(
      `The chapter is ${words} words; it must be ${EXPLAINED_CHAPTER_WORDS_MIN}-${EXPLAINED_CHAPTER_WORDS_MAX}.`,
    );
  if (
    c.paragraphs.length < EXPLAINED_PARAGRAPHS_MIN ||
    c.paragraphs.length > EXPLAINED_PARAGRAPHS_MAX
  )
    p.push(
      `Use ${EXPLAINED_PARAGRAPHS_MIN}-${EXPLAINED_PARAGRAPHS_MAX} paragraphs.`,
    );
  const callouts = c.paragraphs.filter((x) => x.callout.kind !== "none").length;
  if (callouts > Math.ceil(c.paragraphs.length / 2))
    p.push("Too many callouts: at most half the paragraphs carry one.");
  const onScreen = c.paragraphs
    .map((x) => `${x.narration} ${x.callout.primary} ${x.callout.secondary}`)
    .join(" ");
  p.push(...advertiserProblems(onScreen));
  const bad = withoutName(text, o.game ?? "").match(INFLAMMATORY)?.[0];
  if (bad) p.push(`"${bad}" is inflammatory; say it in calm, factual words.`);
  if (
    /let me know in the comments|like and subscribe|without further ado|buckle up/i.test(
      text,
    )
  )
    p.push("Banned phrase.");
  if (/\bthis week'?s?\b/i.test(text) && o.index === 0)
    p.push('Do not frame the story as "this week"; tell the story itself.');
  // A rumor is labeled in the first chapter's opening and stays labeled.
  if (
    o.rumour &&
    o.index === 0 &&
    !/\b(reported(ly)?|according to|rumou?r\w*|unconfirmed|sources say)\b/i.test(
      c.paragraphs
        .slice(0, 2)
        .map((x) => x.narration)
        .join(" "),
    )
  )
    p.push(
      'This story is a rumor: the first two paragraphs say who reported it ("according to", "reportedly").',
    );
  return p;
}

/** The cold open and the close, as the documentary's bookends. */
export async function writeExplainedBookends(
  llm: Llm,
  outline: DocOutline,
  chapters: DocChapter[],
  story: Pick<ExplainedStory, "rumour">,
  feedback: string[] = [],
): Promise<DocBookends> {
  const digest = chapters
    .map(
      (c, i) =>
        `${i + 1}. ${outline.chapters[i]?.chapter_title} (${EXPLAINED_PARTS[i]?.label}): ${c.claims
          .slice(0, 6)
          .map((x) => x.claim)
          .join("; ")}`,
    )
    .join("\n");
  const fb = feedback.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    site: "doc.explained.bookends",
    system: `${HOUSE}

Write the cold open and the close of the finished explainer.
The cold open starts on the story's single sharpest fact (a figure, a date or a statement from the chapter notes) in its first sentence, then by about word 60 the stakes for players, then one line that names the question this video answers, in your own words. Never "In this video", never a greeting, never "this week".${story.rumour ? " The story is a rumor: the cold open says who reported it." : ""}
The close answers the question in its first two sentences, then says what to watch next with a date when the notes give one, and may end on one question to the viewer. The close's label is 2-4 words, e.g. "WHAT TO WATCH". Use only facts from the chapter notes.`,
    content: `Video: ${outline.title}\nThe question it answers: ${outline.question}\n\nChapters and their facts:\n${digest}${fb}`,
    schema: DocBookendsSchema,
    effort: "medium",
  });
}

/** Problems with the bookends beyond the documentary's own check (pure). */
export function explainedBookendProblems(
  b: DocBookends,
  story: Pick<ExplainedStory, "rumour" | "game">,
): string[] {
  const out: string[] = [];
  if (/\bthis week\b/i.test(b.intro.narration))
    out.push('The cold open says "this week"; open on the fact itself.');
  if (/\bin this video\b|\bwelcome\b/i.test(b.intro.narration))
    out.push("The cold open greets the viewer; open on the sharpest fact.");
  const bad = withoutName(
    `${b.intro.narration} ${b.outro.narration}`,
    story.game,
  ).match(INFLAMMATORY)?.[0];
  if (bad) out.push(`"${bad}" is inflammatory; say it in calm, factual words.`);
  if (
    story.rumour &&
    !/\b(reported(ly)?|according to|rumou?r\w*|unconfirmed)\b/i.test(
      b.intro.narration,
    )
  )
    out.push("This story is a rumor: the cold open says who reported it.");
  return out;
}

// ---------------------------------------------------------------- assembly

/**
 * The explainer in the common Script shape through the documentary's converter (pure), so every later step treats
 * it as a documentary. `explained` marks it for the end card, the report and the weekly test.
 */
export function explainedToScript(
  story: ExplainedStory,
  outline: DocOutline,
  chapters: Array<{
    chapter: DocChapter;
    source: WikiArticle;
    moments?: DocMoment[];
  }>,
  bookends: DocBookends,
): Script {
  const draft: DocDraft = {
    topic: {
      kind: "story",
      franchise_index: -1,
      story_index: -1,
      title_idea: outline.title,
      angle: outline.question,
      reason: "the week's biggest story, explained",
      franchise: story.game || outline.title,
    },
    outline,
    chapters: chapters.map((c, i) => ({
      plan: outline.chapters[i]!,
      chapter: c.chapter,
      source: c.source,
      moments: c.moments,
    })),
    bookends,
  };
  const script = docToScript(draft);
  return {
    ...script,
    is_rumour: story.rumour,
    attribution:
      "Sources: the outlets and statements credited on screen / Pulse",
    sources: [...new Set(story.urls.map((u) => u.url))],
    claims: script.claims.map((c) => ({
      ...c,
      source_url: story.urls[0]?.url ?? c.source_url,
    })),
    explained: true,
  } as Script;
}

/** The words of the whole explainer, for the length check. */
export function explainedWords(
  chapters: DocChapter[],
  bookends: DocBookends,
): number {
  return wordCount(
    [
      bookends.intro.narration,
      ...chapters.flatMap((c) => c.paragraphs.map((p) => p.narration)),
      bookends.outro.narration,
    ].join(" "),
  );
}

/** The SOURCES block every chapter is written and checked against (pure). */
export function explainedSource(
  story: ExplainedStory,
  articles: Array<{ source: string; title: string; url: string; text: string }>,
  shortsNarration: string[],
  background?: WikiArticle,
  maxChars = 16_000,
): WikiArticle {
  const parts = [
    ...articles.map(
      (a) => `[${a.source}] ${a.title}\n${a.text.slice(0, 3500)}`,
    ),
    ...(story.summaries.length
      ? [
          `[Coverage summaries]\n${story.summaries.map((s) => `- ${s}`).join("\n")}`,
        ]
      : []),
    ...shortsNarration.map(
      (n) => `[Pulse Short, fact-checked against its sources] ${n}`,
    ),
    ...(background
      ? [
          `[Background: research notes, "${background.title}"]\n${background.text.slice(0, 3000)}`,
        ]
      : []),
  ];
  return {
    title:
      [...new Set(articles.map((a) => a.source))].slice(0, 4).join(" / ") ||
      "the coverage",
    url: articles[0]?.url ?? story.urls[0]?.url ?? "",
    text: parts.join("\n\n").slice(0, maxChars),
  };
}
