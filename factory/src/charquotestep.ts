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
  prepareQuoteClip,
  type PreparedQuote,
  type QuoteClipDeps,
} from "./assets/quoteclip.ts";
import { loudness } from "./qa/media.ts";
import { openQuoteGaps } from "./voice/quotegap.ts";
import type { TimedWord } from "./voice/pauses.ts";
import { FFMPEG } from "./lib/bin.ts";
import { runCapped } from "./lib/child.ts";

/** The narration's usual loudness, for a clip made before the voice exists (matched exactly once it does). */
export const PROVISIONAL_LUFS = -16;
/** Words a minute the length estimate assumes before SHORT_SPEED (the Pulse voice measured 150-170). */
const ESTIMATE_WPM = 165;
/** A long video's first minute, in words (the narration runs about 150-170 a minute). */
const FIRST_MINUTE_WORDS = 160;
/** Seconds a Short keeps free under its narration cap once the quote is in: the estimate is only an estimate. */
const LENGTH_MARGIN = 2.5;

/** The footage credit a quote shows: the game's cutscenes, via YouTube (pure). */
export function quoteCredit(game: string): string {
  return `${game.replace(/\s*\([^)]*\)\s*$/, "").trim()} cutscenes, via YouTube`;
}

/** The scene index for a script's game: its own folder, or the one its name is the subtitle of. */
export async function quoteIndexFor(
  dataDir: string,
  game: string,
): Promise<SceneIndex | undefined> {
  if (!game.trim()) return undefined;
  const exact = await loadSceneIndex(dataDir, game);
  if (exact) return exact;
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

/** After a Short's script is settled: at most one quote, or the script unchanged. Never throws. */
export async function quoteScriptStep(
  s: Pick<Services, "cfg" | "db" | "llm" | "now">,
  ep: Pick<Episode, "id">,
  script: Script,
  o: QuoteStepOptions = {},
): Promise<Script> {
  if (!s.cfg.characterQuotes || script.character_quotes?.length) return script;
  if (
    script.entries?.length ||
    script.every_game ||
    script.gameplay ||
    script.cutdown ||
    script.twin
  )
    return script;
  try {
    const game = script.game_title;
    const index = await quoteIndexFor(s.cfg.dataDir, game);
    const skip = async (why: string) => {
      await logEvent(s.db, ep.id, "character_quote", {
        used: false,
        why,
      }).catch(() => undefined);
      return script;
    };
    if (!index) return skip(`no scene index for ${game}`);
    const recent =
      o.recentRelease ??
      /\b(remake|remaster(?:ed)?|reimagined)\b/i.test(
        [
          script.headline,
          script.hook,
          ...script.beats.map((b) => b.narration),
        ].join(" "),
      );
    if (!indexFitsRelease(index, recent))
      return skip("the index is of another release");
    const cap = o.footageCap ?? quoteFootageCap(game, o.publisherNames);
    if (cap.seconds <= 0) return skip(`${cap.key} allows no footage`);
    const now = s.now();
    // Fail closed (12 Nov 2026): with the guard on, no quote until the spoiler windows have loaded.
    if (s.cfg.spoilerGuard && !(o.windows ?? spoilerWindows()).length)
      return skip("spoiler windows not loaded yet");
    const window = s.cfg.spoilerGuard
      ? windowFor(o.windows ?? spoilerWindows(), game, now)
      : undefined;
    const narration = narrationOf({ ...script, voice_tags: undefined });
    const speed = Math.max(1, s.cfg.shortSpeed || 1);
    const estimate = (wordCount(narration) / (ESTIMATE_WPM * speed)) * 60;
    const room =
      (o.capSeconds ?? 58) -
      LENGTH_MARGIN -
      estimate -
      (24 / (ESTIMATE_WPM * speed)) * 60;
    const candidates = quoteCandidates(
      index,
      `${o.story ?? script.headline} ${narration}`,
      {
        window,
        now,
        use: "short",
        max: 10,
      },
    ).filter((c) => playedSeconds(index, c) <= Math.min(cap.seconds, room));
    if (!candidates.length)
      return skip(
        room < 1 ? "no room in the Short's length" : "no quotable line fits",
      );
    const r = await writeQuoteMoment(s.llm, script, candidates, {
      site: "quote.short",
      wordsMax: o.wordsMax,
      names: [...index.cast, ...index.places],
      house: o.house,
      beats: script.beats.map((_, i) => i),
      now,
    });
    if (!r.quote)
      return skip(`declined: ${r.why.slice(0, 3).join(" | ").slice(0, 300)}`);
    const check = verifyQuote(index, r.quote);
    if (!check.ok) return skip(`the quote failed its check: ${check.reason}`);
    await logEvent(s.db, ep.id, "character_quote", {
      used: true,
      id: r.quote.id,
      speaker: r.quote.speaker,
      text: r.quote.text,
      beat: r.quote.beat,
      before: r.quote.before,
      after: r.quote.after,
      why: r.why.slice(0, 3),
    }).catch(() => undefined);
    return r.script;
  } catch (err) {
    log("warn", "character quote skipped", {
      episode: ep.id,
      error: errorMessage(err),
    });
    return script;
  }
}

/**
 * The chapters of a long script (pure): each beat's chapter (a documentary's chapter card opens one) and the game
 * that chapter is about (its entry, in on-screen order). A script with no chapter cards is one chapter about its game.
 */
export function quoteChapters(
  script: Pick<Script, "beats" | "entries" | "game_title">,
): Array<{ game: string; beats: number[] }> {
  const games = [...(script.entries ?? [])]
    .sort((a, b) => b.rank - a.rank)
    .map((e) => e.game_title);
  const out: Array<{ game: string; beats: number[] }> = [];
  script.beats.forEach((b, i) => {
    if (!out.length || b.visual?.kind === "chapter")
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
  } = {},
): Promise<Script> {
  const max = s.cfg.characterQuotesLong;
  if (!s.cfg.characterQuotes || max <= 0 || script.character_quotes?.length)
    return script;
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
    const indexes = new Map<string, SceneIndex | undefined>();
    const used = new Map<string, number>();
    let next = script;
    let calls = 0;
    const tried = new Set<number>();
    while ((next.character_quotes?.length ?? 0) < max && calls < max + 2) {
      // The chapter whose game offers the best-fitting line, not yet tried.
      let best:
        | {
            k: number;
            candidates: QuoteCandidate[];
            index: SceneIndex;
            cap: { key: string; seconds: number };
          }
        | undefined;
      for (const [k, ch] of chapters.entries()) {
        if (tried.has(k) || !ch.beats.length) continue;
        if (!indexes.has(ch.game))
          indexes.set(ch.game, await quoteIndexFor(s.cfg.dataDir, ch.game));
        const index = indexes.get(ch.game);
        if (
          !index ||
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
        )
          continue;
        const cap = o.footageCap ?? quoteFootageCap(ch.game);
        const left = cap.seconds - (used.get(cap.key) ?? 0);
        if (left <= 0) continue;
        if (s.cfg.spoilerGuard && !(o.windows ?? spoilerWindows()).length) continue;
        const window = s.cfg.spoilerGuard
          ? windowFor(o.windows ?? spoilerWindows(), ch.game, now)
          : undefined;
        const taken = new Set((next.character_quotes ?? []).map((q) => q.id));
        const text = ch.beats.map((b) => next.beats[b]!.narration).join(" ");
        const candidates = quoteCandidates(index, text, {
          window,
          now,
          use: "long",
          warned,
          placedAt: LONG_SPOILER_FREE_SECONDS,
          max: 8,
        }).filter((c) => !taken.has(c.id) && playedSeconds(index, c) <= left);
        if (!candidates.length) continue;
        if (!best || candidates[0]!.score > best.candidates[0]!.score)
          best = { k, candidates, index, cap };
      }
      if (!best) break;
      tried.add(best.k);
      calls++;
      const r = await writeQuoteMoment(s.llm, next, best.candidates, {
        site: "quote.long",
        format: "documentary",
        names: [...best.index.cast, ...best.index.places],
        beats: chapters[best.k]!.beats,
        now,
      });
      if (!r.quote || !verifyQuote(best.index, r.quote).ok) {
        await logEvent(s.db, ep.id, "character_quote", {
          used: false,
          chapter: best.k,
          why: r.why.slice(0, 3),
        }).catch(() => undefined);
        continue;
      }
      next = r.script;
      used.set(
        best.cap.key,
        (used.get(best.cap.key) ?? 0) +
          playedSeconds(
            best.index,
            best.candidates.find((c) => c.id === r.quote!.id)!,
          ),
      );
      await logEvent(s.db, ep.id, "character_quote", {
        used: true,
        id: r.quote.id,
        speaker: r.quote.speaker,
        text: r.quote.text,
        beat: r.quote.beat,
        before: r.quote.before,
        after: r.quote.after,
      }).catch(() => undefined);
    }
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
  deps?: QuoteClipDeps,
): Promise<{ script: Script; prepared: PreparedQuote[] }> {
  const placed = script.character_quotes ?? [];
  if (!placed.length) return { script, prepared: [] };
  let next = script;
  const prepared: PreparedQuote[] = [];
  for (const q of placed) {
    try {
      if (!s.cfg.characterQuotes) throw new Error("CHARACTER_QUOTES is off");
      const index = await quoteIndexFor(s.cfg.dataDir, q.game);
      if (!index) throw new Error("the scene index is gone");
      const check = verifyQuote(index, q);
      if (!check.ok) throw new Error(check.reason);
      const cached = await readPrepared(dir, q.id);
      prepared.push(
        cached ??
          (await prepareQuoteClip({
            quote: q,
            index,
            episodeDir: dir,
            ytdlp: s.cfg.ytdlpPath,
            targetLufs: PROVISIONAL_LUFS,
            upright: ep.lane !== "longform",
            deps,
          })),
      );
      await writePrepared(dir, prepared.at(-1)!);
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
  if (voice.durationSeconds + added > capSeconds)
    await drop(
      placed.map((q) => q.id),
      `${(voice.durationSeconds + added).toFixed(1)} s with the quote, over the ${capSeconds} s cap`,
    );
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
      credit: quoteCredit(q.game),
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

/** The quotes as the Short's composition takes them (files relative to the episode folder). */
export function quoteRenderFiles(assets: Pick<EpisodeAssets, "quotes">):
  | Array<{
      file: string;
      start: number;
      seconds: number;
      speaker: string;
      text: string;
      credit: string;
      mode: "bleed" | "framed";
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
  quotes: ReadonlyArray<{ game: string; seconds: number }>,
  cutsceneLimit: number,
): T[] {
  if (!quotes.length) return clips;
  const used = new Map<string, number>();
  for (const q of quotes) {
    const cap = cutscenePublisher(q.game);
    used.set(cap.key, (used.get(cap.key) ?? 0) + q.seconds);
  }
  let cutscenes = quotes.reduce((n, q) => n + q.seconds, 0);
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
