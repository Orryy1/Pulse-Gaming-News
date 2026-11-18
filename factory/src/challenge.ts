// "Can I beat GTA 6 without...?" (CHALLENGE_SERIES, owner, 14 Nov 2026): numbered challenge series cut from the
// owner's own streams. The owner's one job is a tag in his Twitch stream title, for example "[CHALLENGE: no cars]".
//
//   - Detection: the stream relay (src/relay/job.ts) reads the live title every pass and files the challenge in
//     <data>/challenges/registry.json; the gameplay lane also reads the tag straight off a clip's source title (a live
//     clip carries the stream title, a VOD clip its recording's name, which is the stream title), so a clip is placed
//     even when the relay was not running. /admin/challenge starts or ends one by hand.
//   - Each challenge is its own numbered series and playlist ("Can I Beat GTA 6 Without Cars?"), episode N claimed in
//     the settings table ("challenge:<slug>:ep:N"), so a restart never renumbers. Previous and next links reuse the
//     GTA 6 Day N pattern (src/gtadaily.ts): "Previous episode:" from upload, "Next episode:" written into the one
//     before once this one is public.
//   - The running count on screen is measured, never guessed: missions passed from the HUD reader (src/hudreader),
//     restarts and rule breaks from what the owner says on stream (the VOD index and the clip's own words). A count
//     with nothing to measure it from is left off.
//   - The end: a tag with an outcome ("[CHALLENGE: no cars, done]" or "failed") or CHALLENGE_END_DAYS without the tag
//     closes the challenge; the next clip of it becomes the final "did I make it" episode, and nothing follows it.
//   - Ideas: a ranked list of strong challenge ideas from the stream asks and the comments, in a report file.
// Pure functions first; the small file helpers are at the end. Off until CHALLENGE_SERIES=true.

import fs from "node:fs";
import path from "node:path";
import { TITLE_MAX, titleProblems } from "./editorial/seo.ts";

// ------------------------------------------------------------------ the tag

/**
 * The tag in a stream title: "[CHALLENGE: no cars]", "[Challenge - no guns, failed]", "(challenge no dying)". A file
 * name may have lost the colon ("[CHALLENGE_ no cars]", "[CHALLENGE no cars]"), so any separator is accepted.
 */
export const CHALLENGE_TAG =
  /[[(]\s*challenge\s*(?:[:：_\-–—|]\s*|\s+)([^\])]{2,60}?)\s*[\])]/i;
/** An outcome after the rule: "no cars, done" or "no cars | failed". */
const OUTCOME =
  /\s*[,;|/]\s*(done|made it|beaten|beat it|complete[d]?|won|success|final|failed|fail|over|lost|ended|end)\s*$/i;
const MADE = /^(done|made it|beaten|beat it|complete[d]?|won|success)$/i;
const FAILED = /^(failed|fail|over|lost)$/i;

export type ChallengeOutcome = "made it" | "failed" | "unknown";

export interface ChallengeTag {
  /** The rule as the owner wrote it, tidied: "no cars". */
  rule: string;
  slug: string;
  /** The tag also said how it ended ("done", "failed", "final"). */
  end?: ChallengeOutcome;
}

export const challengeSlug = (rule: string): string =>
  rule
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** The challenge a stream title announces, or undefined (pure). */
export function parseChallengeTag(title: string): ChallengeTag | undefined {
  const m = title.match(CHALLENGE_TAG);
  if (!m) return undefined;
  let rule = m[1]!.replace(/\s+/g, " ").trim();
  let end: ChallengeOutcome | undefined;
  const o = rule.match(OUTCOME);
  if (o) {
    rule = rule.slice(0, o.index).trim();
    end = MADE.test(o[1]!)
      ? "made it"
      : FAILED.test(o[1]!)
        ? "failed"
        : "unknown";
  }
  rule = rule
    .replace(/^["'“‘]+|["'”’.!?]+$/g, "")
    .trim()
    .toLowerCase();
  const slug = challengeSlug(rule);
  if (slug.length < 2) return undefined;
  return { rule, slug, ...(end ? { end } : {}) };
}

// ------------------------------------------------------------------ titles

const cap = (s: string) =>
  s
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(A|An|The|Of|And|Or|In|On|To)\b/g, (w, _x, i) =>
      i === 0 ? w : w.toLowerCase(),
    )
    .replace(/\b(Hud|Npc)\b/g, (w) => w.toUpperCase());

/** Single things read with their article after "Without" ("Without a Phone", "Without the HUD"). */
const ARTICLE: Record<string, string> = {
  phone: "a Phone",
  "wanted level": "a Wanted Level",
  "wanted levels": "a Wanted Level",
  hud: "the HUD",
  map: "the Map",
  minimap: "the Minimap",
  car: "a Car",
  gun: "a Gun",
  weapon: "a Weapon",
};

/** What people call the game in a title ("GTA 6" for GTA VI). */
export function gameShort(game: string): string {
  if (/\b(gta\s*(?:vi|6)|grand theft auto\s*(?:vi|6))\b/i.test(game))
    return "GTA 6";
  if (/\b(gta\s*(?:v|5)|grand theft auto\s*(?:v|5))\b/i.test(game))
    return "GTA 5";
  return game.trim();
}

/**
 * The series title (pure): "Can I Beat GTA 6 Without Cars?" for "no cars", "Without Dying" for "without dying",
 * "With Only Melee" for "only melee", otherwise the rule after a colon: "Can I Beat GTA 6: Pacifist Run?".
 */
export function challengeSeriesTitle(rule: string, game: string): string {
  const g = gameShort(game);
  const r = rule.trim();
  const neg = r.match(
    /^(?:no|without|zero|never|not)\s+(?:using\s+|any\s+)?(.+)$/i,
  );
  if (neg) {
    const thing = neg[1]!.toLowerCase();
    return `Can I Beat ${g} Without ${ARTICLE[thing] ?? cap(thing)}?`;
  }
  if (/^only\s+/i.test(r)) return `Can I Beat ${g} With ${cap(r)}?`;
  if (/^(with|using|on|in|as|obeying|keeping)\s+/i.test(r)) return `Can I Beat ${g} ${cap(r)}?`;
  return `Can I Beat ${g}: ${cap(r)}?`;
}

const DASHES = /\s*[–—]\s*/g;
const ADVERTISER =
  /\b(death|dead|kill(?:s|ed|ing)?|war|attack|crisis|horror|scary|murder|gore)\b/i;

/**
 * An episode's title (pure): "Can I Beat GTA 6 Without Cars? Ep 3: The Airport Run", the claim only when it fits
 * whole within TITLE_MAX; "Ep 3" alone otherwise. The final episode is "...? The Verdict" (did I make it).
 */
export function challengeEpisodeTitle(
  series: string,
  episode: number,
  claims: Array<string | undefined>,
  final = false,
): string {
  if (final) {
    const v = `${series} The Verdict`;
    return v.length <= TITLE_MAX ? v : `${series.replace(/\?$/, "")}? Final`;
  }
  const lead = `${series} Ep ${episode}`;
  for (const c of claims) {
    const claim = (c ?? "")
      .replace(DASHES, ": ")
      .replace(
        /^\s*(?:gta\s*(?:vi|6)|grand theft auto\s*(?:vi|6))\s*[:,.\-|]?\s*/i,
        "",
      )
      .replace(/\s+/g, " ")
      .trim();
    if (!claim || claim === claim.toUpperCase()) continue;
    const t = `${lead}: ${claim[0]!.toUpperCase()}${claim.slice(1)}`;
    if (t.length <= TITLE_MAX && !ADVERTISER.test(t)) return t;
  }
  return lead;
}

/** House rules for a challenge title, on top of the channel's own (pure). */
export function challengeTitleProblems(
  title: string,
  series: string,
): string[] {
  const out = [...titleProblems(title)];
  if (!title.startsWith(series.replace(/\?$/, "")))
    out.push(`The title must open "${series}".`);
  if (/[–—]/.test(title)) out.push("No em or en dashes in the title.");
  const bad = title.match(ADVERTISER);
  if (bad)
    out.push(`"${bad[0]}" is not advertiser-friendly; say it another way.`);
  return out;
}

// ------------------------------------------------------------------ the registry

export interface ChallengeStream {
  /** The Twitch stream id, a VOD id or "admin". */
  id: string;
  title: string;
  /** The owner's local date. */
  date: string;
  startedAt: string;
}

export interface Challenge {
  slug: string;
  rule: string;
  game: string;
  /** The order the owner started challenges in: Challenge 1, 2, ... */
  number: number;
  startedAt: string;
  lastSeenAt: string;
  how: "twitch" | "recording" | "admin";
  streams: ChallengeStream[];
  ended?: {
    at: string;
    outcome: ChallengeOutcome;
    how: "tag" | "quiet" | "admin";
  };
}

export interface ChallengeRegistry {
  challenges: Challenge[];
}

export const emptyRegistry = (): ChallengeRegistry => ({ challenges: [] });

const clone = (r: ChallengeRegistry): ChallengeRegistry =>
  JSON.parse(JSON.stringify(r)) as ChallengeRegistry;

/** The challenge with this slug that is still open, else the latest with it. */
export function findChallenge(
  reg: ChallengeRegistry,
  slug: string,
): Challenge | undefined {
  const all = reg.challenges.filter((c) => c.slug === slug);
  return all.find((c) => !c.ended) ?? all.at(-1);
}

/**
 * A stream (live or recorded) seen with its title (pure). A tag opens the challenge when it is new (or the last one
 * of that rule has ended and this stream is later), records the stream, and closes it when the tag carries an
 * outcome. No tag: nothing changes. `started` and `ended` say what just happened, for the Discord line.
 */
export function noteStream(
  reg: ChallengeRegistry,
  s: ChallengeStream & { game: string },
  now: Date,
  how: Challenge["how"] = "twitch",
): {
  reg: ChallengeRegistry;
  challenge?: Challenge;
  started?: boolean;
  ended?: boolean;
} {
  const tag = parseChallengeTag(s.title);
  if (!tag) return { reg };
  const out = clone(reg);
  let c = findChallenge(out, tag.slug);
  let started = false;
  // A challenge closed only because the tag went quiet carries on when the tag comes back.
  if (c?.ended?.how === "quiet" && !tag.end) delete c.ended;
  if (!c || (c.ended && Date.parse(s.startedAt) > Date.parse(c.ended.at))) {
    c = {
      slug: tag.slug,
      rule: tag.rule,
      game: s.game,
      number: out.challenges.length + 1,
      startedAt: s.startedAt,
      lastSeenAt: now.toISOString(),
      how,
      streams: [],
    };
    out.challenges.push(c);
    started = true;
  }
  if (!c.streams.some((x) => x.id === s.id))
    c.streams.push({
      id: s.id,
      title: s.title,
      date: s.date,
      startedAt: s.startedAt,
    });
  if (!c.ended) c.lastSeenAt = now.toISOString();
  let ended = false;
  if (tag.end && !c.ended) {
    c.ended = { at: now.toISOString(), outcome: tag.end, how: "tag" };
    ended = true;
  }
  return { reg: out, challenge: c, started, ended };
}

/** Open challenges with no tagged stream for `quietDays` are closed, outcome unknown (pure). */
export function closeQuiet(
  reg: ChallengeRegistry,
  now: Date,
  quietDays: number,
): { reg: ChallengeRegistry; closed: Challenge[] } {
  const out = clone(reg);
  const closed: Challenge[] = [];
  for (const c of out.challenges) {
    if (c.ended || quietDays <= 0) continue;
    if (now.getTime() - Date.parse(c.lastSeenAt) >= quietDays * 86_400_000) {
      c.ended = { at: now.toISOString(), outcome: "unknown", how: "quiet" };
      closed.push(c);
    }
  }
  return { reg: out, closed };
}

/** The owner's hand: start a challenge from the admin page (pure). */
export function startByHand(
  reg: ChallengeRegistry,
  rule: string,
  game: string,
  now: Date,
  date: string,
) {
  return noteStream(
    reg,
    {
      id: `admin:${now.getTime()}`,
      title: `[CHALLENGE: ${rule}]`,
      date,
      startedAt: now.toISOString(),
      game,
    },
    now,
    "admin",
  );
}

/** The owner's hand: end a challenge with its outcome (pure). */
export function endByHand(
  reg: ChallengeRegistry,
  slug: string,
  outcome: ChallengeOutcome,
  now: Date,
): { reg: ChallengeRegistry; challenge?: Challenge } {
  const out = clone(reg);
  const c = findChallenge(out, slug);
  if (!c) return { reg };
  c.ended = { at: now.toISOString(), outcome, how: "admin" };
  return { reg: out, challenge: c };
}

/** The challenge a clip belongs to (pure): its source title's tag, matched to the registry, else a fresh one. */
export function challengeForClip(
  reg: ChallengeRegistry,
  sourceTitle: string,
): { tag: ChallengeTag; challenge?: Challenge } | undefined {
  const tag = parseChallengeTag(sourceTitle);
  if (!tag) return undefined;
  return { tag, challenge: findChallenge(reg, tag.slug) };
}

// ------------------------------------------------------------------ the running count

/** The owner restarting the run: "restart", "start again", "new save", "attempt 3". */
export const RESTART_WORDS =
  /\b(restart(?:ing|ed)?(?: the (?:run|challenge))?|start(?:ing)? (?:again|over)|new save|from scratch|attempt (?:number )?(?:two|three|four|five|\d+))\b/gi;
/** The owner calling a rule break: "that's a rule break", "I broke the rule", "that doesn't count". */
export const RULE_BREAK_WORDS =
  /\b(rule break|broke the rules?|breaking the rules?|that(?:'s| is) cheating|doesn'?t count|that counts as a (?:break|fail)|disqualif(?:ied|y)|i failed the challenge)\b/gi;

export interface ChallengeTally {
  /** 1 + restarts, from the owner's own words; undefined when nothing he said was heard. */
  attempt?: number;
  /** Missions passed, from the HUD reader; undefined when no HUD track was read. */
  missions?: number;
  /** Rule breaks, from the owner's own words; undefined when nothing he said was heard. */
  ruleBreaks?: number;
}

const count = (text: string, re: RegExp) =>
  (text.match(new RegExp(re.source, re.flags)) ?? []).length;

/**
 * The count so far (pure): HUD events from every recording of the challenge up to the clip and the words heard in
 * them. A part with no measurement stays undefined, so the screen never shows a made-up zero.
 */
export function challengeTally(
  parts: Array<{ events?: Array<{ kind: string }>; words?: string }>,
): ChallengeTally {
  const tracked = parts.filter((p) => p.events);
  const heard = parts.filter((p) => p.words !== undefined && p.words.trim());
  const words = heard.map((p) => p.words!).join("\n");
  return {
    ...(heard.length
      ? {
          attempt: 1 + count(words, RESTART_WORDS),
          ruleBreaks: count(words, RULE_BREAK_WORDS),
        }
      : {}),
    ...(tracked.length
      ? {
          missions: tracked.reduce(
            (n, p) =>
              n + p.events!.filter((e) => e.kind === "mission_passed").length,
            0,
          ),
        }
      : {}),
  };
}

/** The counter's lines for the screen (pure): "ATTEMPT 2", "MISSIONS 14", "RULE BREAKS 1"; only measured ones. */
export function counterItems(
  t: ChallengeTally,
): Array<{ label: string; value: number }> {
  const out: Array<{ label: string; value: number }> = [];
  if (t.attempt !== undefined) out.push({ label: "ATTEMPT", value: t.attempt });
  if (t.missions !== undefined)
    out.push({ label: "MISSIONS", value: t.missions });
  if (t.ruleBreaks !== undefined)
    out.push({ label: "RULE BREAKS", value: t.ruleBreaks });
  return out;
}

// ------------------------------------------------------------------ the episode, playlist and links

/** What an episode keeps on the story (story_json.challenge). */
export interface ChallengeStory {
  slug: string;
  rule: string;
  game: string;
  /** The playlist and every episode's title lead. */
  series: string;
  episode: number;
  final?: boolean;
  outcome?: ChallengeOutcome;
  tally: ChallengeTally;
  previous?: { episode: number; videoId: string };
  playlistId?: string;
}

export const episodeKeyFor = (slug: string, n: number) =>
  `challenge:${slug}:ep:${n}`;
export const finalKeyFor = (slug: string) => `challenge:${slug}:final`;

/** The next free episode number (pure): one past the highest claimed. */
export const nextEpisode = (claimed: Iterable<number>): number =>
  Math.max(0, ...claimed) + 1;

export function challengePlaylist(
  story: Pick<ChallengeStory, "series" | "rule" | "game">,
): {
  title: string;
  description: string;
} {
  return {
    title: story.series,
    description: `${story.series} Every episode in order, cut from real play on our own streams, with the running count on screen: attempts, missions and rule breaks. The rule: ${story.rule}. From Pulse Gaming.`,
  };
}

export const videoUrl = (id: string) => `https://youtu.be/${id}`;
export const playlistUrl = (id: string) =>
  `https://www.youtube.com/playlist?list=${id}`;

const PREVIOUS_LINE = /^Previous episode: \S+$/;
const NEXT_LINE = /^Next episode: \S+$/;

/** The description's lines (pure): the episode before and the whole series in order. */
export function challengeDescriptionLines(story: ChallengeStory): string[] {
  const out: string[] = [];
  if (story.previous)
    out.push(`Previous episode: ${videoUrl(story.previous.videoId)}`);
  out.push(
    story.playlistId
      ? `Every episode in order: ${playlistUrl(story.playlistId)}`
      : `Every episode is in the "${story.series}" playlist on our channel.`,
  );
  const items = counterItems(story.tally);
  if (items.length)
    out.push(
      `So far: ${items.map((i) => `${i.label.toLowerCase()} ${i.value}`).join(", ")} (missions from the game's own screen, the rest from what I said on stream).`,
    );
  return out;
}

function withLine(description: string, re: RegExp, line: string): string {
  const lines = description.split("\n");
  const at = lines.findIndex((l) => re.test(l.trim()));
  if (at >= 0) {
    lines[at] = line;
    return lines.join("\n");
  }
  if (!description.trim()) return line;
  lines.splice(1, 0, line);
  return lines.join("\n");
}

/** A live description with its "Next episode:" line (pure, idempotent). */
export const withNextEpisode = (d: string, videoId: string) =>
  withLine(d, NEXT_LINE, `Next episode: ${videoUrl(videoId)}`);
/** A live description with its "Previous episode:" line (pure, idempotent). */
export const withPreviousEpisode = (d: string, videoId: string) =>
  withLine(d, PREVIOUS_LINE, `Previous episode: ${videoUrl(videoId)}`);

/** The first comment's line (pure): the next episode when it is already made, the playlist; never a subscribe ask. */
export function challengeCommentLine(
  story: ChallengeStory,
  nextMade: boolean,
): string {
  const where = story.playlistId
    ? `Every episode in order: ${playlistUrl(story.playlistId)}`
    : `Every episode is in the "${story.series}" playlist.`;
  if (story.final)
    return `That was the verdict on "${story.rule}". ${where} What should I try next?`;
  return nextMade
    ? `Episode ${story.episode + 1} is already made and on its way. ${where}`
    : `That was episode ${story.episode}. ${where}`;
}

/** The final episode's line for the writer and the description: what happened, plainly (pure). */
export function verdictLine(
  story: Pick<ChallengeStory, "rule" | "outcome" | "tally">,
): string {
  const items = counterItems(story.tally);
  const counts = items.length
    ? ` The count at the end: ${items.map((i) => `${i.label.toLowerCase()} ${i.value}`).join(", ")}.`
    : "";
  const what =
    story.outcome === "made it"
      ? `I made it: the run is done with the rule "${story.rule}" kept.`
      : story.outcome === "failed"
        ? `I did not make it: the run with the rule "${story.rule}" ended before the end.`
        : `The run with the rule "${story.rule}" is over.`;
  return `${what}${counts}`;
}

// ------------------------------------------------------------------ ideas for the owner

export interface ChallengeIdea {
  rule: string;
  /** Words that count as people asking for it. */
  cues: RegExp;
  why: string;
}

/** Strong ideas the owner can pick from; ranked by what people ask. */
export const CHALLENGE_IDEAS: ChallengeIdea[] = [
  {
    rule: "no cars",
    cues: /\b(no cars?|without (?:a )?cars?|on foot only|walk everywhere|no driving)\b/i,
    why: "the map is huge and on foot everything changes",
  },
  {
    rule: "no guns",
    cues: /\b(no guns?|without guns?|melee only|fists only|no shooting)\b/i,
    why: "every shootout becomes a puzzle",
  },
  {
    rule: "no wanted level",
    cues: /\b(no wanted|never wanted|no (?:police|cops)|zero stars|without (?:getting )?wanted)\b/i,
    why: "a clean-record run tests how strict the police are",
  },
  {
    rule: "no dying",
    cues: /\b(no deaths?|without dying|never die|one life|permadeath|no wasted)\b/i,
    why: "one life makes every mission tense",
  },
  {
    rule: "no hud",
    cues: /\b(no hud|without (?:the )?hud|no minimap|no map)\b/i,
    why: "shows how well the world guides you by itself",
  },
  {
    rule: "only stolen cars",
    cues: /\b(stolen cars? only|only stolen|never buy)\b/i,
    why: "turns every trip into a hunt",
  },
  {
    rule: "no fast travel",
    cues: /\b(no fast travel|without fast travel|no taxis?)\b/i,
    why: "shows the real size of Leonida",
  },
  {
    rule: "only melee",
    cues: /\b(only melee|melee only|bat only|knife only)\b/i,
    why: "close-quarters missions are the hardest to plan",
  },
  {
    rule: "as a pacifist",
    cues: /\b(pacifist|no killing|without hurting|non[- ]?violent)\b/i,
    why: "how far can the story go without harming anyone",
  },
  {
    rule: "no phone",
    cues: /\b(no phone|without (?:the )?phone|no apps?)\b/i,
    why: "GTA 6 leans on the phone more than ever",
  },
  {
    rule: "in first person only",
    cues: /\b(first[- ]person only|only first[- ]person)\b/i,
    why: "the most immersive way to see the city",
  },
  {
    rule: "obeying the speed limit",
    cues: /\b(speed limits?|obey (?:the )?(?:traffic|law)|traffic laws?|law[- ]abiding)\b/i,
    why: "a law-abiding run is funny and shows the traffic AI",
  },
];

export interface RankedIdea {
  rule: string;
  title: string;
  mentions: number;
  why: string;
  examples: string[];
  done: boolean;
}

/** The ideas ranked by mentions in the stream asks and the comments, ideas already run marked done (pure). */
export function rankChallengeIdeas(
  texts: Array<{ text: string; weight?: number }>,
  done: readonly string[],
  game = "Grand Theft Auto VI",
): RankedIdea[] {
  const doneSlugs = new Set(done.map(challengeSlug));
  return CHALLENGE_IDEAS.map((idea) => {
    const hits = texts.filter((t) => idea.cues.test(t.text));
    return {
      rule: idea.rule,
      title: challengeSeriesTitle(idea.rule, game),
      mentions: hits.reduce((n, t) => n + Math.max(1, t.weight ?? 1), 0),
      why: idea.why,
      examples: hits
        .slice(0, 2)
        .map((t) => t.text.replace(/\s+/g, " ").slice(0, 140)),
      done: doneSlugs.has(challengeSlug(idea.rule)),
    };
  })
    .map((x, i) => ({ x, i }))
    .sort(
      (a, b) =>
        Number(a.x.done) - Number(b.x.done) ||
        b.x.mentions - a.x.mentions ||
        a.i - b.i,
    )
    .map((y) => y.x);
}

/** The report file (pure markdown): what to put in the stream title, ranked. */
export function ideasReport(ideas: RankedIdea[], now: Date): string {
  const lines = [
    "# Challenge ideas for the stream",
    "",
    `Ranked ${now.toISOString().slice(0, 10)} from the stream asks and the comments. To start one, put its tag in the Twitch stream title, for example \`[CHALLENGE: ${ideas.find((i) => !i.done)?.rule ?? "no cars"}]\`. Add ", done" or ", failed" to the tag on the last stream, or just stop using the tag.`,
    "",
    "| Rank | Tag for the stream title | Series title | Asked | Why it works |",
    "| --- | --- | --- | --- | --- |",
    ...ideas.map(
      (i, k) =>
        `| ${k + 1} | [CHALLENGE: ${i.rule}]${i.done ? " (already run)" : ""} | ${i.title} | ${i.mentions} | ${i.why} |`,
    ),
    "",
  ];
  if (ideas.every((i) => !i.mentions))
    lines.splice(
      4,
      0,
      "Nobody has asked for a challenge by name yet, so this is the house order: the ones most likely to work as a series first. The counts update as asks and comments come in.",
      "",
    );
  const quoted = ideas.filter((i) => i.examples.length && !i.done).slice(0, 5);
  if (quoted.length) {
    lines.push("## What people said", "");
    for (const i of quoted)
      for (const e of i.examples) lines.push(`- ${i.rule}: "${e}"`);
    lines.push("");
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ files

export const challengeDir = (dataDir: string) =>
  path.join(dataDir, "challenges");
const registryFile = (dataDir: string) =>
  path.join(challengeDir(dataDir), "registry.json");

export function readRegistry(dataDir: string): ChallengeRegistry {
  try {
    const o = JSON.parse(
      fs.readFileSync(registryFile(dataDir), "utf8"),
    ) as ChallengeRegistry;
    return { challenges: Array.isArray(o.challenges) ? o.challenges : [] };
  } catch {
    return emptyRegistry();
  }
}

/** Written beside itself and renamed, so the relay and the factory never read half a file. */
export function writeRegistry(dataDir: string, reg: ChallengeRegistry): void {
  const file = registryFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2));
  fs.renameSync(tmp, file);
}

/** Read, change, write (the relay and the factory both edit it). Returns the change's own result. */
export function editRegistry<T extends { reg: ChallengeRegistry }>(
  dataDir: string,
  change: (r: ChallengeRegistry) => T,
): T {
  const r = change(readRegistry(dataDir));
  writeRegistry(dataDir, r.reg);
  return r;
}
