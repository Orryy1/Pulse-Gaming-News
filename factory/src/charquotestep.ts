// Character quotes in the pipeline (CHARACTER_QUOTES, off by default; owner, 12 Nov 2026, after the Deku Tree demo:
// the narrator sets up a moment, a real character line plays in the game's own voice with its cutscene, the narrator
// reacts). Four small hooks, each a no-op with the setting off or nothing to do, none of which can fail a video:
//   quoteScriptStep  after the Short's script is settled: the game's scene index offers its quotable lines that fit
//                    the story (voiced, named speaker, inside the story's opening during the spoiler window, within
//                    the publisher's footage cap and the Short's length), the writer declines or writes the setup and
//                    the reaction around one (src/editorial/charquote.ts), and the words are checked against the index;
//   prepareQuotes    before the voice: each quote's clip is fetched, cut and framed (src/assets/quoteclip.ts); a quote
//                    whose clip cannot be made is taken out of the script again, so the voice never sets up a silence;
//   openQuotes       after the voice: the clips are brought to the narration's loudness, the silences go in and every
//                    later word timing moves (src/voice/quotegap.ts); a quote that no longer fits goes and the Short
//                    is voiced again without it;
//   quoteRenderFiles and fitClipsAroundQuotes  at the render: the clips for the composition, and the gathered clips
//                    of the same publisher trimmed so the quote and they stay inside its cap (Rockstar: 10 s a video).

import fs from "node:fs/promises";
import path from "node:path";
import type { Services } from "./pipeline.ts";
import type { Episode, EpisodeAssets } from "./episodes.ts";
import { logEvent } from "./episodes.ts";
import { errorMessage, log } from "./lib/util.ts";
import { narrationOf, wordCount, type Script } from "./editorial/schema.ts";
import {
  withoutQuote,
  writeQuoteMoment,
  type CharacterQuote,
} from "./editorial/charquote.ts";
import { loadSceneIndex, type SceneIndex } from "./sceneindex/schema.ts";
import { indexFitsRelease, matchingSlug } from "./sceneindex/footage.ts";
import {
  quoteCandidates,
  quoteSpan,
  verifyQuote,
  type QuoteCandidate,
} from "./sceneindex/quotepick.ts";
import {
  hasSpoilerWarning,
  LONG_SPOILER_FREE_SECONDS,
  spoilerWindows,
  windowFor,
  type SpoilerWindow,
} from "./sceneindex/spoilers.ts";
import { cutscenePublisher } from "./assets/cutscenes.ts";
import { PUBLISHER_CHANNELS } from "./assets/officialTrailer.ts";
import {
  heardMatchesLine,
  prepareQuoteClip,
  sectionWithProxyFallback,
  youtubeSection,
  type PreparedQuote,
  type QuoteClipDeps,
} from "./assets/quoteclip.ts";
import {
  nameSpeakersOnDemand,
  withDemandSpeakers,
} from "./sceneindex/speakerdemand.ts";
import { sceneIndexDir } from "./sceneindex/schema.ts";
import { transcribeWords } from "./qa/narration.ts";
import { loudness } from "./qa/media.ts";
import { openQuoteGaps } from "./voice/quotegap.ts";
import type { TimedWord } from "./voice/pauses.ts";
import { FFMPEG } from "./lib/bin.ts";
import { runCapped } from "./lib/child.ts";
import {
  isTrailerVideoId,
  trailerIndexes,
  trailerIndexFor,
  trailerQuoteSection,
  SUNG_WORD_SECONDS,
} from "./assets/trailerlines.ts";
import { canonicalGame } from "./assets/gamelib.ts";

/** GAME_SPEECH_DIALOGUE on (with CHARACTER_QUOTES): quotes as exchanges with the narrator. */
export const dialogueOn = (cfg: {
  characterQuotes: boolean;
  gameSpeechDialogue?: boolean;
}): boolean => cfg.characterQuotes && Boolean(cfg.gameSpeechDialogue);
/** Official trailer lines count as a source: TRAILER_QUOTES, or GAME_SPEECH_DIALOGUE. */
export const trailersOn = (cfg: {
  characterQuotes: boolean;
  trailerQuotes: boolean;
  gameSpeechDialogue?: boolean;
}): boolean => cfg.trailerQuotes || dialogueOn(cfg);
/** The most exchanges in one Short and in one long video while GAME_SPEECH_DIALOGUE is on. */
export const DIALOGUE_SHORT_MAX = 2;
export const DIALOGUE_LONG_MAX = 12;
/** Chapters of a long video whose speakers may be named on demand (one call each). */
const DEMAND_CHAPTERS = 6;

/** The narration's usual loudness, for a clip made before the voice exists (matched exactly once it does). */
export const PROVISIONAL_LUFS = -16;
/** Words a minute the length estimate assumes before SHORT_SPEED (the Pulse voice measured 150-170). */
const ESTIMATE_WPM = 165;
/** A long video's first minute, in words (the narration runs about 150-170 a minute). */
const FIRST_MINUTE_WORDS = 160;
/** Seconds a Short keeps free under its narration cap once the quote is in: the estimate is only an estimate. */
const LENGTH_MARGIN = 2.5;

/**
 * Quotes moved by the silence put into the narration after they were placed (pure): each by the seconds of every gap
 * at or before its start, like the words (src/voice/pauses.ts openWords). A long video's chapter breathers go in
 * after the quotes are opened, so without this every quote after a breather played early, over the narrator.
 */
export function quotesAfterGaps<T extends { start: number; end?: number }>(
  quotes: readonly T[],
  gaps: ReadonlyArray<{ at: number; seconds: number }>,
): T[] {
  return quotes.map((q) => {
    const add = gaps.filter((g) => g.at <= q.start + 1e-6).reduce((n, g) => n + g.seconds, 0);
    if (!add) return q;
    return { ...q, start: q.start + add, ...(typeof q.end === "number" ? { end: q.end + add } : {}) };
  });
}

/** The footage credit a quote shows: the game's cutscenes, via YouTube, or its official trailer (pure). */
export function quoteCredit(game: string, origin?: "trailer"): string {
  const name = game.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return origin === "trailer" ? `${name} official trailer` : `${name} cutscenes, via YouTube`;
}

/** Whether a placed quote is an official trailer's line (pure). */
export const isTrailerQuote = (q: { origin?: string; videoId?: string }): boolean =>
  q.origin === "trailer" || isTrailerVideoId(q.videoId);

/**
 * Candidates from several indexes as one list (pure): every line that fits the story, best first, then the filler
 * lines taken from each index in turn, at most `max`; an ID offered twice keeps its first.
 */
export function mergeCandidates(
  lists: ReadonlyArray<readonly QuoteCandidate[]>,
  max: number,
): QuoteCandidate[] {
  const seen = new Set<string>();
  const keep = (c: QuoteCandidate) => (seen.has(c.id) ? false : (seen.add(c.id), true));
  const story = lists
    .flatMap((l) => l.filter((c) => c.fit === "story"))
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .filter(keep);
  const general: QuoteCandidate[] = [];
  const rest = lists.map((l) => l.filter((c) => c.fit !== "story"));
  for (let k = 0; rest.some((l) => k < l.length); k++)
    for (const l of rest) if (l[k] && keep(l[k]!)) general.push(l[k]!);
  return [...story, ...general].slice(0, max);
}

/** The index a placed quote was taken from: its game's scene index, or the official trailer it is from. */
export async function indexForQuote(
  dataDir: string,
  q: { game: string; videoId: string; origin?: string },
): Promise<SceneIndex | undefined> {
  return isTrailerQuote(q)
    ? trailerIndexFor(dataDir, q.game, q.videoId)
    : quoteIndexFor(dataDir, q.game);
}

/**
 * The scene index for a script's game: its own folder, or the one its name is the subtitle of, with any speakers
 * named on demand laid over it (src/sceneindex/speakerdemand.ts), so the check before the voice sees them too.
 */
export async function quoteIndexFor(
  dataDir: string,
  game: string,
): Promise<SceneIndex | undefined> {
  const index = await rawQuoteIndexFor(dataDir, game);
  return index ? withDemandSpeakers(dataDir, index) : undefined;
}

async function rawQuoteIndexFor(
  dataDir: string,
  game: string,
): Promise<SceneIndex | undefined> {
  if (!game.trim()) return undefined;
  const exact = await loadSceneIndex(dataDir, game);
  if (exact) return exact;
  // "Grand Theft Auto 6" and "GTA 6" are Grand Theft Auto VI's index.
  const canonical = canonicalGame(game);
  if (canonical !== game.trim()) {
    const named = await loadSceneIndex(dataDir, canonical);
    if (named) return named;
  }
  const slugs = await fs
    .readdir(path.join(dataDir, "sceneindex"))
    .catch(() => [] as string[]);
  const slug = matchingSlug(slugs, game);
  if (!slug) return undefined;
  try {
    const raw = JSON.parse(
      await fs.readFile(
        path.join(dataDir, "sceneindex", slug, "index.json"),
        "utf8",
      ),
    );
    return typeof raw?.game === "string"
      ? loadSceneIndex(dataDir, raw.game)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The seconds of footage a game's publisher allows in one video (Rockstar 10, Nintendo stills only). */
export function quoteFootageCap(
  game: string,
  publisherNames: string[] = [],
): { key: string; seconds: number } {
  return cutscenePublisher(game, publisherNames);
}

/** The words a quote's length check runs on (pure): a candidate's played stretch, its lead-in and tail included. */
export function playedSeconds(
  index: SceneIndex,
  c: Pick<QuoteCandidate, "line">,
): number {
  const line = index.lines[c.line];
  if (!line) return Infinity;
  const s = quoteSpan(index, line);
  return s.to - s.from;
}

export interface QuoteStepOptions {
  /** The Short's house rules, so a quote cannot break one the script kept. */
  house?: (s: Script) => string[];
  wordsMax?: number;
  /** The narration cap in seconds (SHORT_NARRATION_CAP_SECONDS or the length lane's). */
  capSeconds?: number;
  /** The game's publishers and developers as the store lists them, for the footage cap. */
  publisherNames?: string[];
  /** The story's own text (headline, sources) besides the script, for the fit. */
  story?: string;
  /** A remake's or remaster's story (the index must be of that release). */
  recentRelease?: boolean;
  windows?: readonly SpoilerWindow[];
  /** The footage cap when the caller knows better than the publisher table (a licensed source, a sandbox). */
  footageCap?: { key: string; seconds: number };
}

/**
 * After a Short's script is settled: up to CHARACTER_QUOTES_SHORT quotes (default one), or the script unchanged.
 * A second quote is offered only lines that fit the story itself (never a filler line), in a beat at least two
 * away from the first, inside what is left of the publisher's footage cap and the Short's length; the writer may
 * decline it. Never throws.
 */
export async function quoteScriptStep(
  s: Pick<Services, "cfg" | "db" | "llm" | "now">,
  ep: Pick<Episode, "id">,
  script: Script,
  o: QuoteStepOptions = {},
): Promise<Script> {
  if (!s.cfg.characterQuotes || script.character_quotes?.length) return script;
  const format = script.entries?.length
    ? "a ranking"
    : script.every_game
      ? "an every-game Short"
      : script.gameplay
        ? "a gameplay Short"
        : script.cutdown
          ? "a cut-down"
          : script.twin
            ? "a twin"
            : "";
  if (format) {
    // Logged, so the quote funnel can tell a format that takes no quote from a quote that failed.
    await logEvent(s.db, ep.id, "character_quote", {
      used: false,
      why: `${format} takes no quote`,
    }).catch(() => undefined);
    return script;
  }
  try {
    const game = script.game_title;
    const dialogue = dialogueOn(s.cfg);
    let demand: { asked: number; named: number } | undefined;
    const skip = async (why: string) => {
      await logEvent(s.db, ep.id, "character_quote", {
        used: false,
        why,
        ...(dialogue ? { dialogue: true } : {}),
        ...(demand ? { speakers: demand } : {}),
      }).catch(() => undefined);
      return script;
    };
    // The sources: the game's scene index (its cutscenes), and with TRAILER_QUOTES (or GAME_SPEECH_DIALOGUE) its
    // official trailers' spoken lines (src/assets/trailerlines.ts). A trailer is public marketing, so its lines need
    // no spoiler window.
    const withTrailers = trailersOn(s.cfg);
    const found = await quoteIndexFor(s.cfg.dataDir, game);
    const trailers = withTrailers
      ? await trailerIndexes(s.cfg.dataDir, game)
      : [];
    if (!found && !trailers.length)
      return skip(
        `no scene index for ${game}${withTrailers ? " and no trailer lines" : ""}`,
      );
    const recent =
      o.recentRelease ??
      /\b(remake|remaster(?:ed)?|reimagined)\b/i.test(
        [
          script.headline,
          script.hook,
          ...script.beats.map((b) => b.narration),
        ].join(" "),
      );
    const notes: string[] = [];
    let index = found;
    if (index && !indexFitsRelease(index, recent)) {
      index = undefined;
      notes.push("the index is of another release");
    }
    const cap = o.footageCap ?? quoteFootageCap(game, o.publisherNames);
    if (cap.seconds <= 0) return skip(`${cap.key} allows no footage`);
    const now = s.now();
    // Fail closed (12 Nov 2026): with the guard on, no cutscene quote until the spoiler windows have loaded.
    if (index && s.cfg.spoilerGuard && !(o.windows ?? spoilerWindows()).length) {
      index = undefined;
      notes.push("spoiler windows not loaded yet");
    }
    if (!index && !trailers.length) return skip(notes[0] ?? "no source");
    const window =
      index && s.cfg.spoilerGuard
        ? windowFor(o.windows ?? spoilerWindows(), game, now)
        : undefined;
    // GAME_SPEECH_DIALOGUE: the story's best speakerless lines get their speakers named from the dialogue, once.
    if (dialogue && index) {
      const d = await nameSpeakersOnDemand(
        s.llm,
        s.cfg.dataDir,
        index,
        `${o.story ?? script.headline} ${narrationOf({ ...script, voice_tags: undefined })}`,
        { window, now, use: "short", verbatim: true },
      );
      index = d.index;
      if (d.asked) demand = { asked: d.asked, named: d.named };
    }
    const sources: Array<{ index: SceneIndex; window?: SpoilerWindow }> = [
      ...(index ? [{ index, window }] : []),
      ...trailers.map((t) => ({ index: t })),
    ];
    const indexOf = (videoId: string) =>
      sources.find((x) => x.index.source.videoId === videoId)?.index;
    const names = [
      ...new Set(sources.flatMap((x) => [...x.index.cast, ...x.index.places])),
    ];
    const speed = Math.max(1, s.cfg.shortSpeed || 1);
    const max = dialogue
      ? DIALOGUE_SHORT_MAX
      : Math.max(1, s.cfg.characterQuotesShort ?? 1);
    const story = o.story ?? script.headline;
    let next = script;
    let used = 0; // seconds of quotes placed so far
    for (let k = 0; k < max; k++) {
      const narration = narrationOf({ ...next, voice_tags: undefined });
      const estimate = (wordCount(narration) / (ESTIMATE_WPM * speed)) * 60;
      const room =
        (o.capSeconds ?? 58) -
        LENGTH_MARGIN -
        estimate -
        used -
        (24 / (ESTIMATE_WPM * speed)) * 60;
      const taken = new Set((next.character_quotes ?? []).map((q) => q.id));
      // A second quote keeps a beat's distance from the first: two lines back to back read as a montage.
      const placedBeats = (next.character_quotes ?? []).map((q) => q.beat);
      const beats = script.beats
        .map((_, i) => i)
        .filter((i) => placedBeats.every((b) => Math.abs(b - i) >= 2));
      const candidates = mergeCandidates(
        sources.map((x) =>
          quoteCandidates(x.index, `${story} ${narration}`, {
            window: x.window,
            now,
            use: "short",
            verbatim: dialogue,
            max: 10,
            // The second only when the story genuinely calls for it: lines that fit the story, never the filler.
            ...(k > 0 ? { general: 0 } : {}),
          }).filter(
            (c) =>
              !taken.has(c.id) &&
              playedSeconds(x.index, c) <= Math.min(cap.seconds - used, room),
          ),
        ),
        10,
      );
      if (!candidates.length || !beats.length) {
        if (k === 0)
          return skip(
            room < 1
              ? "no room in the Short's length"
              : ["no quotable line fits", ...notes].join("; "),
          );
        await logEvent(s.db, ep.id, "character_quote", {
          used: false,
          second: true,
          why: !beats.length
            ? "no beat far enough from the first quote"
            : room < 1
              ? "no room left in the Short's length"
              : "no second line fits the story",
        }).catch(() => undefined);
        break;
      }
      const r = await writeQuoteMoment(s.llm, next, candidates, {
        site: "quote.short",
        wordsMax: o.wordsMax,
        names,
        house: o.house,
        beats,
        now,
        dialogue,
      });
      const from = r.quote ? indexOf(r.quote.videoId) : undefined;
      const check =
        r.quote && from ? verifyQuote(from, r.quote, { verbatim: dialogue }) : undefined;
      if (!r.quote || !check?.ok) {
        const why = !r.quote
          ? `declined: ${r.why.slice(0, 3).join(" | ").slice(0, 300)}`
          : `the quote failed its check: ${check?.reason ?? "its source is gone"}`;
        if (k === 0) return skip(why);
        await logEvent(s.db, ep.id, "character_quote", {
          used: false,
          second: true,
          why,
        }).catch(() => undefined);
        break;
      }
      next = r.script;
      const picked = candidates.find((c) => c.id === r.quote!.id);
      used += picked && from ? playedSeconds(from, picked) : 0;
      await logEvent(s.db, ep.id, "character_quote", {
        used: true,
        ...(k > 0 ? { second: true } : {}),
        ...(dialogue ? { dialogue: true } : {}),
        ...(demand && k === 0 ? { speakers: demand } : {}),
        ...(r.quote.origin ? { origin: r.quote.origin } : {}),
        id: r.quote.id,
        speaker: r.quote.speaker,
        text: r.quote.text,
        beat: r.quote.beat,
        before: r.quote.before,
        after: r.quote.after,
        why: r.why.slice(0, 3),
      }).catch(() => undefined);
    }
    return next;
  } catch (err) {
    log("warn", "character quote skipped", {
      episode: ep.id,
      error: errorMessage(err),
    });
    return script;
  }
}

/**
 * The chapters of a long script (pure): each beat's chapter (a documentary's chapter card or a ranking's rank card
 * opens one) and the game that chapter is about (its entry, in on-screen order). A script with neither is one chapter
 * about its game. 20 Nov 2026: a long ranking's beats open on "rank" cards, so all eleven GTA games read as one
 * chapter about "Grand Theft Auto", which has no index: no ranking ever took a quote.
 */
export function quoteChapters(
  script: Pick<Script, "beats" | "entries" | "game_title">,
): Array<{ game: string; beats: number[] }> {
  const games = [...(script.entries ?? [])]
    .sort((a, b) => b.rank - a.rank)
    .map((e) => e.game_title);
  const out: Array<{ game: string; beats: number[] }> = [];
  script.beats.forEach((b, i) => {
    if (!out.length || b.visual?.kind === "chapter" || b.visual?.kind === "rank")
      out.push({ game: games[out.length] ?? script.game_title, beats: [] });
    out.at(-1)!.beats.push(i);
  });
  return out.filter((c) => c.game?.trim());
}

/**
 * After a long video's script is settled: up to CHARACTER_QUOTES_LONG quotes, each in a different chapter and
 * never in the opening beat, from the scene index of the chapter's game; during that game's spoiler window only
 * from the story's opening unless the video opens with a spoiler warning (then after its first minute). The quotes
 * of one publisher stay inside its footage cap together. Never throws.
 */
export async function quoteLongStep(
  s: Pick<Services, "cfg" | "db" | "llm" | "now">,
  ep: Pick<Episode, "id">,
  script: Script,
  o: {
    windows?: readonly SpoilerWindow[];
    footageCap?: { key: string; seconds: number };
    /**
     * A retrospective (src/editorial/retrospective.ts): the most quotes each chapter may take, by chapter (one each
     * when unset), each story chapter's act of the scene index (its lines are offered only from there) and the most
     * in the whole video (CHARACTER_QUOTES_LONG when unset).
     */
    perChapter?: readonly number[];
    ranges?: ReadonlyArray<{ from: number; to: number } | undefined>;
    max?: number;
  } = {},
): Promise<Script> {
  const dialogue = dialogueOn(s.cfg);
  const max = o.max ?? (dialogue ? DIALOGUE_LONG_MAX : s.cfg.characterQuotesLong);
  if (!s.cfg.characterQuotes || max <= 0 || script.character_quotes?.length)
    return script;
  // Why each chapter gave no quote, for the log (20 Nov 2026: a long video that placed none logged nothing at all).
  const misses = new Map<string, string>();
  const miss = (game: string, why: string) => {
    if (!misses.has(game)) misses.set(game, why);
  };
  try {
    const now = s.now();
    const warned = hasSpoilerWarning([script.hook, script.beats[0]?.narration]);
    // Never in the first minute (about 160 words in): the opening is a first frame, as the spoiler guard has it.
    const before: number[] = [];
    let n = wordCount(script.hook);
    for (const b of script.beats) {
      before.push(n);
      n += wordCount(b.narration);
    }
    const chapters = quoteChapters(script).map((c) => ({
      ...c,
      beats: c.beats.filter(
        (b) => b > 0 && (before[b] ?? 0) >= FIRST_MINUTE_WORDS,
      ),
    }));
    // Trailer lines in a long video come with GAME_SPEECH_DIALOGUE only: TRAILER_QUOTES alone keeps long videos as
    // they were (cutscene lines only).
    const withTrailers = dialogue;
    // Each game's sources once: its scene index (speakers named on demand per chapter) and its trailers' lines.
    const indexes = new Map<string, SceneIndex | undefined>();
    const trailerSets = new Map<string, SceneIndex[]>();
    const demanded = new Set<number>();
    const used = new Map<string, number>();
    let next = script;
    let calls = 0;
    // Each chapter is tried as often as it may take quotes (once by default); a decline uses up a try.
    const tries = new Map<number, number>();
    const exhausted = (k: number) => (tries.get(k) ?? 0) >= (o.perChapter?.[k] ?? 1);
    // A second quote in a chapter keeps a beat away from the chapter's first.
    const freeBeats = (k: number) =>
      chapters[k]!.beats.filter(
        (b) =>
          !(next.character_quotes ?? []).some(
            (q) => chapters[k]!.beats.includes(q.beat) && Math.abs(q.beat - b) < 2,
          ),
      );
    while ((next.character_quotes?.length ?? 0) < max && calls < max + 4) {
      // The chapter whose game offers the best-fitting line, not yet tried.
      let best:
        | {
            k: number;
            candidates: QuoteCandidate[];
            indexOf: (videoId: string) => SceneIndex | undefined;
            names: string[];
            cap: { key: string; seconds: number };
          }
        | undefined;
      for (const [k, ch] of chapters.entries()) {
        if (exhausted(k) || !freeBeats(k).length) continue;
        if (!indexes.has(ch.game))
          indexes.set(ch.game, await quoteIndexFor(s.cfg.dataDir, ch.game));
        if (withTrailers && !trailerSets.has(ch.game))
          trailerSets.set(ch.game, await trailerIndexes(s.cfg.dataDir, ch.game));
        const text = ch.beats.map((b) => next.beats[b]!.narration).join(" ");
        let index = indexes.get(ch.game);
        if (
          index &&
          !indexFitsRelease(
            index,
            // About the remake: the chapter's game, the video's opening or the chapter's words say so.
            /\b(remake|remaster(?:ed)?|reimagined)\b/i.test(
              [
                ch.game,
                script.headline,
                script.hook,
                ...ch.beats.map((b) => next.beats[b]!.narration),
              ].join(" "),
            ),
          )
        ) {
          miss(ch.game, "the index is of another release");
          index = undefined;
        }
        const cap = o.footageCap ?? quoteFootageCap(ch.game);
        const left = cap.seconds - (used.get(cap.key) ?? 0);
        if (left <= 0) {
          miss(ch.game, `${cap.key}'s footage cap is used up`);
          continue;
        }
        if (index && s.cfg.spoilerGuard && !(o.windows ?? spoilerWindows()).length) {
          miss(ch.game, "spoiler windows not loaded yet");
          index = undefined;
        }
        const window =
          index && s.cfg.spoilerGuard
            ? windowFor(o.windows ?? spoilerWindows(), ch.game, now)
            : undefined;
        if (dialogue && index && !demanded.has(k) && demanded.size < DEMAND_CHAPTERS) {
          demanded.add(k);
          const d = await nameSpeakersOnDemand(s.llm, s.cfg.dataDir, index, text, {
            window,
            now,
            use: "long",
            warned,
            placedAt: LONG_SPOILER_FREE_SECONDS,
            verbatim: true,
          });
          index = d.index;
          indexes.set(ch.game, d.index);
        }
        // A retrospective's story chapters stay inside their act of the scene index; trailers only elsewhere.
        const range = o.ranges?.[k];
        const sources: Array<{ index: SceneIndex; window?: SpoilerWindow }> = [
          ...(index ? [{ index, window }] : []),
          ...(range ? [] : (trailerSets.get(ch.game) ?? []).map((t) => ({ index: t }))),
        ];
        if (!sources.length) {
          miss(ch.game, `no scene index${withTrailers ? " and no trailer lines" : ""}`);
          continue;
        }
        const taken = new Set((next.character_quotes ?? []).map((q) => q.id));
        const candidates = mergeCandidates(
          sources.map((x) =>
            quoteCandidates(x.index, text, {
              window: x.window,
              now,
              use: "long",
              warned,
              placedAt: LONG_SPOILER_FREE_SECONDS,
              verbatim: dialogue,
              max: range ? 80 : 8,
            })
              .filter((c) => !taken.has(c.id) && playedSeconds(x.index, c) <= left)
              .filter((c) => {
                if (!range || x.index.origin === "trailer") return true;
                const at = x.index.lines[c.line]?.start ?? -1;
                return at >= range.from && at < range.to;
              }),
          ),
          8,
        );
        if (!candidates.length) {
          miss(ch.game, "no quotable line fits");
          continue;
        }
        if (!best || candidates[0]!.score > best.candidates[0]!.score)
          best = {
            k,
            candidates,
            indexOf: (videoId) => sources.find((x) => x.index.source.videoId === videoId)?.index,
            names: [...new Set(sources.flatMap((x) => [...x.index.cast, ...x.index.places]))],
            cap,
          };
      }
      if (!best) break;
      tries.set(best.k, (tries.get(best.k) ?? 0) + 1);
      calls++;
      const r = await writeQuoteMoment(s.llm, next, best.candidates, {
        site: "quote.long",
        format: "documentary",
        names: best.names,
        beats: freeBeats(best.k),
        now,
        dialogue,
      });
      const from = r.quote ? best.indexOf(r.quote.videoId) : undefined;
      if (!r.quote || !from || !verifyQuote(from, r.quote, { verbatim: dialogue }).ok) {
        await logEvent(s.db, ep.id, "character_quote", {
          used: false,
          long: true,
          chapter: best.k,
          why: r.why.slice(0, 3),
        }).catch(() => undefined);
        continue;
      }
      next = r.script;
      const picked = best.candidates.find((c) => c.id === r.quote!.id);
      used.set(
        best.cap.key,
        (used.get(best.cap.key) ?? 0) + (picked ? playedSeconds(from, picked) : 0),
      );
      await logEvent(s.db, ep.id, "character_quote", {
        used: true,
        long: true,
        ...(dialogue ? { dialogue: true } : {}),
        ...(r.quote.origin ? { origin: r.quote.origin } : {}),
        id: r.quote.id,
        speaker: r.quote.speaker,
        text: r.quote.text,
        beat: r.quote.beat,
        before: r.quote.before,
        after: r.quote.after,
      }).catch(() => undefined);
    }
    if (!next.character_quotes?.length)
      await logEvent(s.db, ep.id, "character_quote", {
        used: false,
        long: true,
        why: misses.size
          ? [...misses.entries()].map(([g, w]) => `${g}: ${w}`).join("; ").slice(0, 400)
          : chapters.some((c) => c.beats.length)
            ? "every chapter was tried and declined"
            : "no chapter past the first minute",
      }).catch(() => undefined);
    return next;
  } catch (err) {
    log("warn", "character quotes skipped", {
      episode: ep.id,
      error: errorMessage(err),
    });
    return script;
  }
}

/**
 * Before the voice: each placed quote's clip, made now so the voice can leave its exact length. A quote that cannot
 * be played is taken out of the script (saved), so the narrator never sets up a silence. Returns the script as it
 * now stands and the prepared clips. Never throws.
 */
export async function prepareQuotes(
  s: Pick<Services, "cfg" | "db">,
  ep: Pick<Episode, "id" | "lane">,
  script: Script,
  dir: string,
  deps?: QuoteClipDeps & { hear?: (file: string) => Promise<string[]> },
): Promise<{ script: Script; prepared: PreparedQuote[] }> {
  const placed = script.character_quotes ?? [];
  if (!placed.length) return { script, prepared: [] };
  let next = script;
  const prepared: PreparedQuote[] = [];
  for (const q of placed) {
    try {
      if (!s.cfg.characterQuotes) throw new Error("CHARACTER_QUOTES is off");
      const trailer = isTrailerQuote(q);
      if (trailer && !trailersOn(s.cfg)) throw new Error("TRAILER_QUOTES is off");
      const dialogue = dialogueOn(s.cfg);
      const index = await indexForQuote(s.cfg.dataDir, q);
      if (!index)
        throw new Error(trailer ? "the trailer's lines are gone" : "the scene index is gone");
      const check = verifyQuote(index, q, { verbatim: dialogue });
      if (!check.ok) throw new Error(check.reason);
      const cached = await readPrepared(dir, q.id);
      // GAME_SPEECH_DIALOGUE: a cutscene line YouTube will not serve is cut from the index's own proxy instead.
      const proxy =
        dialogue && !trailer ? await proxyFile(s.cfg.dataDir, index) : undefined;
      let fellBack = "";
      const made =
        cached ??
        (await prepareQuoteClip({
          quote: q,
          index,
          episodeDir: dir,
          ytdlp: s.cfg.ytdlpPath,
          targetLufs: PROVISIONAL_LUFS,
          upright: ep.lane !== "longform",
          // A trailer's section is cut from the library's picture and its voice mix, never fetched from YouTube.
          deps: trailer
            ? {
                ...deps,
                download:
                  deps?.download ??
                  ((videoId, from, to, file) =>
                    trailerQuoteSection(s.cfg.dataDir, q.game, videoId, from, to, file)),
              }
            : proxy
              ? {
                  ...deps,
                  download: sectionWithProxyFallback(
                    deps?.download ?? youtubeSection(s.cfg.ytdlpPath),
                    proxy,
                    (err) => (fellBack = errorMessage(err).slice(0, 200)),
                  ),
                }
              : deps,
        }));
      if (fellBack)
        await logEvent(s.db, ep.id, "character_quote_fallback", {
          id: q.id,
          source: "proxy",
          why: fellBack,
        }).catch(() => undefined);
      // GAME_SPEECH_DIALOGUE: the clip is heard before the voice (a cached clip too, unless it was heard already);
      // words that are not the line, or a line that sounds sung, drop it.
      let ready = made;
      if (dialogue && !made.heard) {
        await checkHeard(s.cfg.whisperPython, dir, made, q.text, deps?.hear, Boolean(fellBack));
        ready = { ...made, heard: true };
      }
      prepared.push(ready);
      await writePrepared(dir, ready);
    } catch (err) {
      next = withoutQuote(next, q.id);
      await logEvent(s.db, ep.id, "character_quote_dropped", {
        id: q.id,
        why: errorMessage(err),
      }).catch(() => undefined);
      log("warn", "character quote dropped before the voice", {
        episode: ep.id,
        id: q.id,
        error: errorMessage(err),
      });
    }
  }
  if (next !== script)
    await s.db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(next),
    ]);
  return { script: next, prepared };
}

/** The scene index's own proxy of its upload, when it is on this machine (same timeline as the index). */
async function proxyFile(
  dataDir: string,
  index: SceneIndex,
): Promise<string | undefined> {
  if (index.origin === "trailer" || index.proxy?.released) return undefined;
  const file = path.join(
    sceneIndexDir(dataDir, index.game),
    index.proxy?.file || "proxy.mp4",
  );
  return (await fs.stat(file).then((st) => st.size > 0).catch(() => false))
    ? file
    : undefined;
}

/**
 * GAME_SPEECH_DIALOGUE: Whisper hears the clip as made, and anything but the line (another voice, a cut into the
 * next sentence, words the captions misheard) throws so the quote goes. A Whisper that cannot run is logged and the
 * clip kept: its words were already timed by Whisper when the index was built.
 */
async function checkHeard(
  python: string,
  dir: string,
  p: PreparedQuote,
  text: string,
  hear?: (file: string) => Promise<string[]>,
  fromProxy = false,
): Promise<void> {
  // Sung, not said: words held over the beat (the trailer lines' measure, src/assets/trailerlines.ts).
  const w = p.words ?? [];
  if (w.length >= 3) {
    const perWord = (w.at(-1)!.end - w[0]!.start) / w.length;
    if (perWord >= SUNG_WORD_SECONDS) throw new Error(`sounds sung (${perWord.toFixed(2)} s a word)`);
  }
  let heard: string[];
  try {
    heard = hear
      ? await hear(path.join(dir, p.file))
      : (await transcribeWords(path.join(dir, p.file), python)).map((w) => w.text);
  } catch (err) {
    // A clip cut from the proxy has only this check to prove its cut: no Whisper, no quote.
    if (fromProxy) throw new Error(`Whisper could not hear the proxy clip: ${errorMessage(err).slice(0, 120)}`);
    log("warn", "character quote: Whisper could not hear the clip; kept", {
      id: p.id,
      error: errorMessage(err),
    });
    return;
  }
  const r = heardMatchesLine(text, heard);
  if (!r.ok) throw new Error(`Whisper: ${r.reason}`);
}

const sidecar = (dir: string, id: string) => path.join(dir, `quote_${id}.json`);
async function readPrepared(
  dir: string,
  id: string,
): Promise<PreparedQuote | undefined> {
  try {
    const p = JSON.parse(
      await fs.readFile(sidecar(dir, id), "utf8"),
    ) as PreparedQuote;
    await fs.access(path.join(dir, p.file));
    return p;
  } catch {
    return undefined;
  }
}
async function writePrepared(dir: string, p: PreparedQuote): Promise<void> {
  await fs.writeFile(sidecar(dir, p.id), JSON.stringify(p, null, 2));
}

/** Brings a clip's sound to `target` LUFS in place (picture copied), and returns its loudness after. */
export async function matchQuoteLoudness(
  dir: string,
  p: PreparedQuote,
  target: number,
): Promise<PreparedQuote> {
  const file = path.join(dir, p.file);
  const now = await loudness(file);
  if (!Number.isFinite(now) || Math.abs(now - target) < 0.3)
    return { ...p, lufs: Math.round(now * 10) / 10, targetLufs: target };
  const tmp = file.replace(/\.mp4$/, ".gain.mp4");
  await runCapped(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      file,
      "-c:v",
      "copy",
      "-af",
      `volume=${(target - now).toFixed(2)}dB,alimiter=limit=0.89:level=0`,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-movflags",
      "+faststart",
      tmp,
    ],
    { timeout: 120_000 },
  );
  await fs.rename(tmp, file);
  const after = await loudness(file);
  return {
    ...p,
    lufs: Math.round(after * 10) / 10,
    targetLufs: Math.round(target * 10) / 10,
  };
}

export class QuoteRevoice extends Error {}

/**
 * After the voice (and its checks): the silences go in and the clips match the narration's loudness. A quote whose
 * place cannot be found in the voice, or one that would take the narration past `capSeconds`, is taken out of the
 * script (saved) and QuoteRevoice is thrown, so the step voices again without it. Returns the new timings and the
 * quotes as the episode keeps them.
 */
export async function openQuotes(
  s: Pick<Services, "db">,
  ep: Pick<Episode, "id">,
  script: Script,
  dir: string,
  voice: { file: string; words: TimedWord[]; durationSeconds: number },
  prepared: PreparedQuote[],
  capSeconds: number,
): Promise<
  | {
      words: TimedWord[];
      durationSeconds: number;
      quotes: NonNullable<EpisodeAssets["quotes"]>;
      /** The narration's words with each quote's own words in its slot: the captions file carries the line too. */
      captionWords: TimedWord[];
    }
  | undefined
> {
  const placed = (script.character_quotes ?? []).filter((q) =>
    prepared.some((p) => p.id === q.id),
  );
  if (!placed.length) return undefined;
  const added = prepared
    .filter((p) => placed.some((q) => q.id === p.id))
    .reduce((n, p) => n + p.seconds, 0);
  const drop = async (ids: string[], why: string) => {
    let next = script;
    for (const id of ids) next = withoutQuote(next, id);
    await s.db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(next),
    ]);
    await logEvent(s.db, ep.id, "character_quote_dropped", { ids, why }).catch(
      () => undefined,
    );
    throw new QuoteRevoice(
      `character quote taken out (${why}); voicing again without it`,
    );
  };
  if (voice.durationSeconds + added > capSeconds) {
    // Over the cap: the later quotes go first, so a Short with two keeps the one that still fits.
    const seconds = (id: string) =>
      prepared.find((p) => p.id === id)?.seconds ?? 0;
    const order = [...placed].sort((a, b) => b.beat - a.beat);
    const ids: string[] = [];
    let total = voice.durationSeconds + added;
    for (const q of order) {
      if (total <= capSeconds) break;
      ids.push(q.id);
      total -= seconds(q.id);
    }
    await drop(
      ids,
      `${(voice.durationSeconds + added).toFixed(1)} s with the quote${placed.length > 1 ? "s" : ""}, over the ${capSeconds} s cap`,
    );
  }
  const target = await loudness(voice.file);
  const matched: PreparedQuote[] = [];
  for (const p of prepared)
    matched.push(
      Number.isFinite(target) ? await matchQuoteLoudness(dir, p, target) : p,
    );
  const opened = await openQuoteGaps(
    voice.file,
    voice.words,
    voice.durationSeconds,
    script,
    matched,
  );
  if (opened.missing.length)
    await drop(opened.missing, "its place in the voice was not found");
  const quotes = opened.slots.map((slot) => {
    const p = matched.find((m) => m.id === slot.id)!;
    const q = placed.find((x) => x.id === slot.id) as CharacterQuote;
    return {
      ...p,
      start: slot.start,
      end: slot.end,
      speaker: q.speaker,
      text: q.text,
      game: q.game,
      credit: quoteCredit(q.game, isTrailerQuote(q) ? "trailer" : undefined),
      ...(isTrailerQuote(q) ? { origin: "trailer" as const } : {}),
    };
  });
  await logEvent(s.db, ep.id, "character_quote_placed", {
    quotes: quotes.map((q) => ({
      id: q.id,
      start: q.start,
      seconds: q.seconds,
      lufs: q.lufs,
      target: q.targetLufs,
      mode: q.mode,
      keep: q.keep,
    })),
  }).catch(() => undefined);
  const captionWords = [
    ...opened.words,
    ...quotes.flatMap((q) => {
      const first = q.words[0]?.start ?? 0.2;
      const last = q.words.at(-1)?.end ?? q.seconds - 0.2;
      return quoteCaptionWords(
        q.text,
        q.speaker,
        q.start + first,
        q.start + last,
      );
    }),
  ].sort((a, b) => a.start - b.start);
  return {
    words: opened.words,
    durationSeconds: opened.durationSeconds,
    quotes,
    captionWords,
  };
}

/**
 * A quote as caption words (pure): the index's own text (never what Whisper heard), the speaker's name on the
 * first word, spread evenly over the spoken stretch, so the captions file names who says it.
 */
export function quoteCaptionWords(
  text: string,
  speaker: string,
  start: number,
  end: number,
): TimedWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length || !(end > start)) return [];
  const per = (end - start) / tokens.length;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return tokens.map((t, i) => ({
    text: i === 0 ? `${speaker.toUpperCase()}: ${t}` : t,
    start: r(start + i * per),
    end: r(start + (i + 1) * per - per * 0.1),
  }));
}

/** GAME_SPEECH_DIALOGUE: the music bed under the character's voice, as a share of its level (-14 dB). */
export const DIALOGUE_BED_UNDER = 0.2;

/** The quotes as the Short's composition takes them (files relative to the episode folder). */
export function quoteRenderFiles(
  assets: Pick<EpisodeAssets, "quotes">,
  o: { dialogue?: boolean } = {},
):
  | Array<{
      file: string;
      start: number;
      seconds: number;
      speaker: string;
      text: string;
      credit: string;
      mode: "bleed" | "framed";
      bedUnder?: number;
    }>
  | undefined {
  const q = assets.quotes ?? [];
  return q.length
    ? q.map((x) => ({
        file: x.file,
        start: x.start,
        seconds: x.seconds,
        speaker: x.speaker,
        text: x.text,
        credit: x.credit,
        mode: x.mode,
        ...(o.dialogue ? { bedUnder: DIALOGUE_BED_UNDER } : {}),
      }))
    : undefined;
}

/**
 * The gathered clips with the quotes counted against their publisher's cap (pure): a capped publisher's clips are
 * kept, in the order capPublisherTotal keeps them, only while they and the quotes of that publisher's game stay
 * inside the cap; and cutscene clips likewise inside the per-Short cutscene budget.
 */
export function fitClipsAroundQuotes<
  T extends { provenance: string; durationSeconds: number; beatIndex?: number },
>(
  clips: T[],
  quotes: ReadonlyArray<{ game: string; seconds: number; origin?: string }>,
  cutsceneLimit: number,
): T[] {
  if (!quotes.length) return clips;
  const used = new Map<string, number>();
  for (const q of quotes) {
    const cap = cutscenePublisher(q.game);
    used.set(cap.key, (used.get(cap.key) ?? 0) + q.seconds);
  }
  // A trailer's line is the publisher's footage (counted above) but not a cutscene.
  let cutscenes = quotes
    .filter((q) => q.origin !== "trailer")
    .reduce((n, q) => n + q.seconds, 0);
  const order = [...clips].sort(
    (a, b) =>
      Number(b.beatIndex === undefined) - Number(a.beatIndex === undefined) ||
      (b.beatIndex ?? 0) - (a.beatIndex ?? 0),
  );
  const keep = new Set<T>();
  for (const c of order) {
    const rule = PUBLISHER_CHANNELS.find((r) =>
      c.provenance.includes(`publisher: ${r.name}`),
    );
    const game = c.provenance.match(/^Cutscenes for "([^"]+)"/)?.[1];
    const key = rule?.name ?? (game ? cutscenePublisher(game).key : undefined);
    const limit =
      rule?.clipSeconds ?? (game ? cutscenePublisher(game).seconds : Infinity);
    if (
      key &&
      used.has(key) &&
      (used.get(key) ?? 0) + c.durationSeconds > limit
    )
      continue;
    if (game && cutscenes + c.durationSeconds > cutsceneLimit) continue;
    if (key && used.has(key))
      used.set(key, (used.get(key) ?? 0) + c.durationSeconds);
    if (game) cutscenes += c.durationSeconds;
    keep.add(c);
  }
  return clips.filter((c) => keep.has(c));
}
