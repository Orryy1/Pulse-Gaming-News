// Trailer voice lines (TRAILER_QUOTES, on by default; owner, 15 Nov 2026: "Shorts should use the game's own audio:
// characters talking to the narrator, real voice lines from game footage, trailers and cutscenes"). In practice no
// character quote had fired in days: every GTA VI Short asked for a scene index the game cannot have before launch, and
// the game sound bed heard nothing because every clip on screen was a trailer (trailer music stays silent).
//
// An official trailer is public marketing, not a story spoiler, so its spoken lines may be quoted inside the spoiler
// window. Each library trailer is processed once on the PC (src/tools/trailerlines.ts): its sound is fetched from the
// publisher's own file (the library keeps the picture only), Demucs splits the voice from the music, Whisper times the
// words of the voice, and the lines are stored beside the library item:
//   <library>/<game>/voicelines/<item>.json   the lines, their word timings, how sung each sounds, and the voice and
//                                             music level every quarter second;
//   <library>/<game>/voicelines/<item>.voice.m4a  the voice at full level over the music 20 dB down, time-aligned
//                                             with the library's picture, so no licensed song plays under a line.
// A trailer's lines then look like a scene index (trailerSceneIndex), so the cutscene quote path picks, checks and
// cuts them unchanged; and a trailer clip on screen whose stretch is mostly speech can be heard in the game sound bed
// through the same voice mix (trailerSoundFor). Lines that are sung (a held, steady pitch) are never quotable: they
// are the licensed song, not a character.
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "../lib/bin.ts";
import { runCapped } from "../lib/child.ts";
import { voiceLines } from "../sceneindex/dialogue.ts";
import type {
  DialogueLine,
  SceneIndex,
  TimedWord,
} from "../sceneindex/schema.ts";
import { sceneSlug, SCENE_INDEX_VERSION } from "../sceneindex/schema.ts";
import {
  canonicalGame,
  libraryDir,
  libraryRoot,
  readLibrary,
  type GameLibrary,
  type LibItem,
} from "./gamelib.ts";

export const TRAILER_LINES_VERSION = 1;
export const VOICELINES_DIR = "voicelines";
/** The music under the isolated voice in a trailer's voice mix, dB. */
export const MUSIC_UNDER_DB = -20;
/** The step of the stored voice and music levels, seconds. */
export const LEVEL_STEP = 0.25;
/** A line whose held, steady pitch covers this share of its voiced frames is sung, not said. */
export const SUNG_SUSTAIN = 0.4;
/** Words held this long on average are sung too (a lyric drawn out over the beat). */
export const SUNG_WORD_SECONDS = 0.6;
/** A line whose voice is this much under the music was split badly: its words cannot be trusted. */
export const VOICE_UNDER_MUSIC_DB = -12;
/** A trailer clip whose stretch is at least this share clean speech may be heard in the game sound bed. */
export const DIALOGUE_MIN_SHARE = 0.3;
/** The synthetic upload ID of a trailer's lines: "tr-" and the library item's first eight characters. */
export const TRAILER_ID_PREFIX = "tr-";

export interface TrailerLine {
  start: number;
  end: number;
  text: string;
  words: TimedWord[];
  /** Mean voice and music level over the line, dB, and the share of its voiced frames held on a steady pitch. */
  voiceDb: number;
  musicDb: number;
  sustain: number;
  /** Why it is never quoted (sung, buried under the music), or undefined when it may be. */
  unusable?: string;
}

export interface TrailerLines {
  version: number;
  game: string;
  item: string;
  /** The trailer's own name ("Trailer 2"), its publisher's file and the publisher. */
  name: string;
  sourceUrl: string;
  publisher: string;
  duration: number;
  /** The voice mix, relative to the game's library folder. */
  voiceFile: string;
  builtAt: string;
  lines: TrailerLine[];
  levels: { step: number; voice: number[]; music: number[] };
}

export const trailerVideoId = (item: string): string =>
  `${TRAILER_ID_PREFIX}${item.replace(/[^\w]/g, "").slice(0, 8).padEnd(8, "0")}`;
export const isTrailerVideoId = (v: string | undefined): boolean =>
  !!v && /^tr-\w{8}$/.test(v);

/** A trailer item of a library (pure): an official, usable video named "trailer". */
export const isLibraryTrailer = (i: LibItem): boolean =>
  i.kind === "video" &&
  i.source !== "own" &&
  i.named.includes("trailer") &&
  !i.unusable;

/** The trailer's own name from its provenance ('Official trailer "Trailer 2" from ...'), else its ID (pure). */
export const trailerName = (i: Pick<LibItem, "provenance" | "id">): string =>
  i.provenance.match(/"([^"]+)"/)?.[1] ?? i.id;

// ---------------------------------------------------------------- pure measurements

/** Mean of the dB values between `from` and `to` seconds, on a grid of `step` (pure); -100 when none. */
export function meanDb(
  levels: readonly number[],
  step: number,
  from: number,
  to: number,
): number {
  const a = Math.max(0, Math.floor(from / step));
  const b = Math.min(levels.length, Math.max(a + 1, Math.ceil(to / step)));
  if (a >= levels.length) return -100;
  // Averaged as power, so one loud word is not drowned by the breaths around it.
  let sum = 0;
  for (let i = a; i < b; i++) sum += Math.pow(10, levels[i]! / 10);
  return Math.round(10 * Math.log10(sum / (b - a) + 1e-12) * 10) / 10;
}

/**
 * The share of a stretch's voiced frames that sit in a held, steady note (pure): runs of frames whose pitch moves
 * under 0.6 of a semitone from frame to frame, lasting at least `minRun` seconds. Speech glides and breaks off; a
 * sung lyric holds its notes. `f0` is the pitch every `hop` seconds, 0 where nothing is voiced.
 */
export function sustainShare(
  f0: readonly number[],
  hop: number,
  from: number,
  to: number,
  minRun = 0.3,
): number {
  const a = Math.max(0, Math.floor(from / hop));
  const b = Math.min(f0.length, Math.ceil(to / hop));
  let voiced = 0;
  let held = 0;
  let run = 0;
  const close = () => {
    if (run * hop >= minRun) held += run;
    run = 0;
  };
  for (let i = a; i < b; i++) {
    const f = f0[i]!;
    if (!(f > 0)) {
      close();
      continue;
    }
    voiced++;
    const prev = i > a ? f0[i - 1]! : 0;
    if (prev > 0 && Math.abs(12 * Math.log2(f / prev)) < 0.6) run++;
    else {
      close();
      run = 1;
    }
  }
  close();
  return voiced ? Math.round((held / voiced) * 100) / 100 : 0;
}

/**
 * Heard lines cut into single sentences (pure): a trailer's speakers trade lines fast, and a quote is one sentence.
 * A word ending a sentence closes its piece whenever more words follow.
 */
export function sentencePieces(
  lines: ReadonlyArray<{ words?: TimedWord[] }>,
): TimedWord[][] {
  const out: TimedWord[][] = [];
  for (const l of lines) {
    let cur: TimedWord[] = [];
    for (const w of l.words ?? []) {
      cur.push(w);
      if (/[.!?…]["'”’)]?$/.test(w.text)) {
        out.push(cur);
        cur = [];
      }
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

/**
 * A trailer's lines from Whisper's words on its isolated voice (pure): grouped at the speakers' pauses, cut into
 * sentences, each measured (voice and music level, how held its pitch is) and marked unusable when it is sung or its
 * voice is buried under the music.
 */
export function buildTrailerLines(
  words: readonly TimedWord[],
  m: {
    f0: readonly number[];
    hop: number;
    voice: readonly number[];
    music: readonly number[];
    step: number;
  },
): TrailerLine[] {
  const heard = voiceLines([...words], { pause: 0.6, maxSeconds: 10 });
  const r = (x: number) => Math.round(x * 100) / 100;
  return sentencePieces(heard).map((g) => {
    const start = g[0]!.start;
    const end = g.at(-1)!.end;
    const voiceDb = meanDb(m.voice, m.step, start, end);
    const musicDb = meanDb(m.music, m.step, start, end);
    const sustain = sustainShare(m.f0, m.hop, start, end);
    const perWord = (end - start) / g.length;
    const unusable =
      sustain >= SUNG_SUSTAIN || (g.length >= 3 && perWord >= SUNG_WORD_SECONDS)
        ? "sung"
        : voiceDb - musicDb < VOICE_UNDER_MUSIC_DB
          ? "the voice is buried under the music"
          : undefined;
    return {
      start: r(start),
      end: r(end),
      text: g
        .map((w) => w.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      words: g.map((w) => ({ text: w.text, start: r(w.start), end: r(w.end) })),
      voiceDb,
      musicDb,
      sustain,
      ...(unusable ? { unusable } : {}),
    };
  });
}

/**
 * A trailer's lines as a scene index (pure), so the cutscene quote path picks, checks and cuts them unchanged. The
 * speaker is the trailer itself ("Trailer 2"): a trailer never names who speaks, and a guess could be wrong. Unusable
 * lines stay in, without a speaker, so they are never quoted but still keep a quote's cut off their words.
 */
export function trailerSceneIndex(tl: TrailerLines): SceneIndex {
  const lines: DialogueLine[] = tl.lines.map((l, id) => ({
    id,
    start: l.start,
    end: l.end,
    text: l.text,
    ...(l.unusable ? {} : { speaker: tl.name }),
    via: "voice" as const,
    shot: 0,
    words: l.words,
  }));
  return {
    version: SCENE_INDEX_VERSION,
    origin: "trailer",
    game: tl.game,
    slug: sceneSlug(tl.game),
    source: {
      videoId: trailerVideoId(tl.item),
      title: tl.name,
      uploader: tl.publisher,
      duration: tl.duration,
      kind: "movie",
      pickedAt: tl.builtAt,
    },
    builtAt: tl.builtAt,
    coverage: [{ from: 0, to: tl.duration }],
    cast: [],
    places: [],
    shots: [],
    lines,
  };
}

/** The share of a trailer stretch that is clean speech (pure): seconds of usable lines inside it over its length. */
export function dialogueShare(
  tl: Pick<TrailerLines, "lines">,
  from: number,
  to: number,
): number {
  if (!(to > from)) return 0;
  let said = 0;
  for (const l of tl.lines) {
    if (l.unusable) continue;
    said += Math.max(0, Math.min(to, l.end) - Math.max(from, l.start));
  }
  return Math.round((said / (to - from)) * 100) / 100;
}

/** A stored lines file as this code can use it, or undefined (pure). */
export function parseTrailerLines(raw: unknown): TrailerLines | undefined {
  const o = raw as Partial<TrailerLines> | null;
  if (!o || o.version !== TRAILER_LINES_VERSION) return undefined;
  if (
    typeof o.item !== "string" ||
    typeof o.game !== "string" ||
    typeof o.voiceFile !== "string"
  )
    return undefined;
  if (!Array.isArray(o.lines) || !(Number(o.duration) > 0)) return undefined;
  return o as TrailerLines;
}

// ---------------------------------------------------------------- reading the library

export const voicelinesFile = (item: string): string =>
  path.join(VOICELINES_DIR, `${item}.json`);
export const voiceMixFile = (item: string): string =>
  path.join(VOICELINES_DIR, `${item}.voice.m4a`);

/** Every processed trailer of a game: its lines and its library item. Never throws. */
export async function readTrailerLines(
  root: string,
  game: string,
  lib?: GameLibrary,
): Promise<Array<{ lines: TrailerLines; item: LibItem }>> {
  const library = lib ?? (await readLibrary(root, game));
  if (!library) return [];
  const dir = libraryDir(root, library.game);
  const out: Array<{ lines: TrailerLines; item: LibItem }> = [];
  for (const item of library.items.filter(isLibraryTrailer)) {
    try {
      const tl = parseTrailerLines(
        JSON.parse(
          await fs.readFile(path.join(dir, voicelinesFile(item.id)), "utf8"),
        ),
      );
      if (tl) out.push({ lines: tl, item });
    } catch {
      // not processed yet
    }
  }
  return out;
}

/** The trailer scene indexes of a game ("GTA 6" finds Grand Theft Auto VI's library). Never throws. */
export async function trailerIndexes(
  dataDir: string,
  game: string,
): Promise<SceneIndex[]> {
  if (!game.trim()) return [];
  return (
    await readTrailerLines(libraryRoot(dataDir), canonicalGame(game))
  ).map((t) => trailerSceneIndex(t.lines));
}

/** One trailer's scene index by its synthetic upload ID, or undefined. */
export async function trailerIndexFor(
  dataDir: string,
  game: string,
  videoId: string,
): Promise<SceneIndex | undefined> {
  return (await trailerIndexes(dataDir, game)).find(
    (i) => i.source.videoId === videoId,
  );
}

/** The game whose library holds a trailer with this file URL, and its lines (a clip carries only the URL). */
async function trailerByUrl(
  root: string,
  sourceUrl: string,
): Promise<{ game: string; lines: TrailerLines; item: LibItem } | undefined> {
  for (const slug of await fs.readdir(root).catch(() => [] as string[])) {
    try {
      const lib = JSON.parse(
        await fs.readFile(path.join(root, slug, "library.json"), "utf8"),
      ) as GameLibrary;
      if (!lib?.items?.some((i) => i.sourceUrl === sourceUrl)) continue;
      const hit = (await readTrailerLines(root, lib.game, lib)).find(
        (t) => t.item.sourceUrl === sourceUrl,
      );
      if (hit) return { game: lib.game, ...hit };
    } catch {
      // not a library
    }
  }
  return undefined;
}

async function readableFile(
  root: string,
  game: string,
  file: string,
): Promise<string | undefined> {
  const { sourceOf, storeSettings } = await import("./gamelibstore.ts");
  const from = await sourceOf(root, game, file, storeSettings());
  return from?.local ?? from?.url;
}

/**
 * A quote's section of a trailer (section.mkv for src/assets/quoteclip.ts): the library's picture of [from, to) with
 * the voice mix's sound of the same stretch, so the line plays over the music 20 dB down. Throws when either part
 * cannot be read.
 */
export async function trailerQuoteSection(
  dataDir: string,
  game: string,
  videoId: string,
  from: number,
  to: number,
  out: string,
): Promise<void> {
  const root = libraryRoot(dataDir);
  const hit = (await readTrailerLines(root, canonicalGame(game))).find(
    (t) => trailerVideoId(t.item.id) === videoId,
  );
  if (!hit) throw new Error(`no trailer lines for ${videoId}`);
  const picture = await readableFile(root, canonicalGame(game), hit.item.file);
  const sound = await readableFile(
    root,
    canonicalGame(game),
    hit.lines.voiceFile,
  );
  if (!picture || !sound)
    throw new Error("the trailer's picture or voice mix cannot be read");
  const seconds = Math.max(0.5, to - from);
  await runCapped(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      from.toFixed(3),
      "-i",
      picture,
      "-ss",
      from.toFixed(3),
      "-i",
      sound,
      "-t",
      seconds.toFixed(3),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "14",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      out,
    ],
    { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
  );
}

/**
 * The sound of a trailer clip on screen for the game sound bed, when its stretch is mostly speech: the voice mix of
 * that stretch, written beside the clip (`clip_3.sound.m4a`), time 0 the clip's first frame. Undefined when the clip
 * is not a processed library trailer or its stretch is mostly music. Never throws.
 */
export async function trailerSoundFor(
  dir: string,
  c: {
    file: string;
    sourceUrl?: string;
    startSeconds?: number;
    durationSeconds: number;
  },
  dataDir: string,
): Promise<{ file: string; share: number } | undefined> {
  try {
    if (!c.sourceUrl || typeof c.startSeconds !== "number") return undefined;
    const root = libraryRoot(dataDir);
    const hit = await trailerByUrl(root, c.sourceUrl);
    if (!hit) return undefined;
    const seconds = Math.max(0.5, c.durationSeconds);
    const share = dialogueShare(
      hit.lines,
      c.startSeconds,
      c.startSeconds + seconds,
    );
    if (share < DIALOGUE_MIN_SHARE) return undefined;
    const sound = await readableFile(root, hit.game, hit.lines.voiceFile);
    if (!sound) return undefined;
    const rel = c.file.replace(/\.[a-z0-9]+$/i, "") + ".sound.m4a";
    await runCapped(
      FFMPEG,
      [
        "-v",
        "error",
        "-y",
        "-ss",
        c.startSeconds.toFixed(3),
        "-i",
        sound,
        "-t",
        (seconds + 0.3).toFixed(3),
        "-vn",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        path.join(dir, rel),
      ],
      { timeout: 120_000 },
    );
    return { file: rel, share };
  } catch {
    return undefined;
  }
}
