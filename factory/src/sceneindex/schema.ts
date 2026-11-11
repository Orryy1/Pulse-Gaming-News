// The per-game scene index (owner, 11 Nov 2026): one file a game, made once from a clean full movie or
// no-commentary playthrough, that says what every shot shows and what every line of dialogue says. Every Short,
// long video and documentary about the game looks its moments up here instead of searching footage per line.
// On disk: <data>/sceneindex/<game-slug>/index.json beside a low-resolution proxy of the source (proxy.mp4);
// full-quality sections are fetched on demand with yt-dlp, so a game costs well under a gigabyte.
// This file is the shape, its version and the rules for reading, replacing and storing it (pure except the two
// small file helpers at the end).

import fs from "node:fs/promises";
import path from "node:path";

/** Raised whenever the shape changes in a way old readers or old files cannot bridge (see parseSceneIndex). */
export const SCENE_INDEX_VERSION = 1;

export interface SceneSource {
  videoId: string;
  title: string;
  uploader: string;
  /** Seconds. */
  duration: number;
  height?: number;
  /** A cutscene movie is every player's game; a playthrough is mostly the uploader's own play. */
  kind: "movie" | "playthrough";
  pickedAt: string;
}

export interface SceneShot {
  id: number;
  /** Seconds into the source. */
  start: number;
  end: number;
  /** Seconds into the source of the frames the description was made from. */
  keyframes: number[];
  /** One plain sentence: who does what, where. Empty until the shot has been looked at. */
  desc: string;
  /** Characters on screen, named against the game's cast list where the picture or its text shows them. */
  who: string[];
  /** The place, named against the game's location list where known. */
  where: string;
  mood: string;
  /** Search words the description did not use (objects, actions, synonyms). */
  tags: string[];
  /** Writing on screen that is not dialogue: a place card, a title, an item name. */
  text: string;
  /** When the game's own messages are written over the shot ("You got the Master Sword!"), in source seconds. */
  written?: Array<{ from: number; to: number }>;
  /** Mean brightness 0-255 and mean frame difference 0-255 over the shot. */
  luma: number;
  motion: number;
  /** Not a picture a video can use: a fade, a loading screen, a menu. Still indexed, never returned as footage. */
  blank?: boolean;
  menu?: boolean;
}

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface DialogueLine {
  id: number;
  /** Seconds into the source: when the line starts being said or shown, and when it ends. */
  start: number;
  end: number;
  text: string;
  speaker?: string;
  /**
   * True when the game did not show who speaks and the speaker is taken from the picture: the only character in
   * the shot the line is said in. Right most of the time, wrong when the speaker is off screen: never treat it
   * as the game's own attribution.
   */
  speakerGuessed?: boolean;
  /** "voice": heard (Whisper); "textbox": read off the screen (text recognition); "both": heard and read. */
  via: "voice" | "textbox" | "both";
  /** The shot the line starts in. */
  shot: number;
  /** Word timings, for voiced lines. */
  words?: TimedWord[];
}

export interface SceneIndex {
  version: number;
  game: string;
  slug: string;
  source: SceneSource;
  builtAt: string;
  /** The stretches of the source that have been indexed, merged and in order. A finished index is one stretch, 0 to the end. */
  coverage: Array<{ from: number; to: number }>;
  proxy?: { file: string; height: number; bytes: number };
  /** The game's characters and places (Wikipedia), used to name what the model and the text reader saw. */
  cast: string[];
  places: string[];
  shots: SceneShot[];
  lines: DialogueLine[];
}

/** A game's folder name: lower case words joined by dashes, numerals kept ("Grand Theft Auto VI" -> "grand-theft-auto-vi"). */
export function sceneSlug(game: string): string {
  return game
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function sceneIndexDir(dataDir: string, game: string): string {
  return path.join(dataDir, "sceneindex", sceneSlug(game));
}

export function emptySceneIndex(
  game: string,
  source: SceneSource,
  now: Date,
): SceneIndex {
  return {
    version: SCENE_INDEX_VERSION,
    game,
    slug: sceneSlug(game),
    source,
    builtAt: now.toISOString(),
    coverage: [],
    cast: [],
    places: [],
    shots: [],
    lines: [],
  };
}

const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * An index file as this code can use it, or undefined when it cannot: not an index, written by a newer factory
 * (a rollback must not misread it), or broken. Undefined means "build it again", never a crash. Shots and lines
 * that are malformed are dropped one by one, so a single bad row does not cost the whole game.
 */
export function parseSceneIndex(raw: unknown): SceneIndex | undefined {
  const o = raw as Partial<SceneIndex> | null;
  if (!o || typeof o !== "object") return undefined;
  if (!num(o.version) || o.version < 1 || o.version > SCENE_INDEX_VERSION)
    return undefined;
  if (typeof o.game !== "string" || !o.game.trim()) return undefined;
  const s = o.source as Partial<SceneSource> | undefined;
  if (!s || !/^[\w-]{11}$/.test(String(s.videoId ?? "")) || !num(s.duration))
    return undefined;
  const shots: SceneShot[] = [];
  for (const x of Array.isArray(o.shots) ? o.shots : []) {
    if (!x || !num(x.start) || !num(x.end) || x.end <= x.start) continue;
    shots.push({
      id: shots.length,
      start: x.start,
      end: x.end,
      keyframes: Array.isArray(x.keyframes) ? x.keyframes.filter(num) : [],
      desc: String(x.desc ?? ""),
      who: strs(x.who),
      where: String(x.where ?? ""),
      mood: String(x.mood ?? ""),
      tags: strs(x.tags),
      text: String(x.text ?? ""),
      luma: num(x.luma) ? x.luma : 0,
      motion: num(x.motion) ? x.motion : 0,
      ...(Array.isArray(x.written) && x.written.length
        ? { written: x.written.filter((w) => w && num(w.from) && num(w.to) && w.to > w.from) }
        : {}),
      ...(x.blank ? { blank: true } : {}),
      ...(x.menu ? { menu: true } : {}),
    });
  }
  shots.sort((a, b) => a.start - b.start);
  shots.forEach((shot, i) => (shot.id = i));
  const lines: DialogueLine[] = [];
  for (const x of Array.isArray(o.lines) ? o.lines : []) {
    if (!x || !num(x.start) || !num(x.end) || x.end < x.start) continue;
    const text = String(x.text ?? "").trim();
    if (!text) continue;
    const words = Array.isArray(x.words)
      ? x.words.filter(
          (w) => w && typeof w.text === "string" && num(w.start) && num(w.end),
        )
      : [];
    lines.push({
      id: lines.length,
      start: x.start,
      end: x.end,
      text,
      ...(typeof x.speaker === "string" && x.speaker.trim()
        ? {
            speaker: x.speaker.trim(),
            ...(x.speakerGuessed ? { speakerGuessed: true } : {}),
          }
        : {}),
      via: x.via === "voice" || x.via === "both" ? x.via : "textbox",
      shot: shotAt(shots, x.start),
      ...(words.length ? { words } : {}),
    });
  }
  lines.sort((a, b) => a.start - b.start);
  lines.forEach((line, i) => (line.id = i));
  return {
    version: SCENE_INDEX_VERSION,
    game: o.game.trim(),
    slug: sceneSlug(o.game),
    source: {
      videoId: String(s.videoId),
      title: String(s.title ?? ""),
      uploader: String(s.uploader ?? ""),
      duration: s.duration,
      ...(num(s.height) ? { height: s.height } : {}),
      kind: s.kind === "playthrough" ? "playthrough" : "movie",
      pickedAt: String(s.pickedAt ?? ""),
    },
    builtAt: String(o.builtAt ?? ""),
    coverage: mergeCoverage(
      (Array.isArray(o.coverage) ? o.coverage : []).filter(
        (c) => c && num(c.from) && num(c.to),
      ),
    ),
    ...(o.proxy && typeof o.proxy.file === "string"
      ? {
          proxy: {
            file: o.proxy.file,
            height: Number(o.proxy.height) || 0,
            bytes: Number(o.proxy.bytes) || 0,
          },
        }
      : {}),
    cast: strs(o.cast),
    places: strs(o.places),
    shots,
    lines,
  };
}

/** The shot a moment falls in (the last one starting at or before it); 0 when there are none. */
export function shotAt(
  shots: readonly Pick<SceneShot, "start">[],
  time: number,
): number {
  let lo = 0;
  let hi = shots.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (shots[mid]!.start <= time + 1e-6) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Stretches in order with overlapping or touching ones (within half a second) joined. */
export function mergeCoverage(
  spans: Array<{ from: number; to: number }>,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  for (const s of [...spans]
    .filter((x) => x.to > x.from)
    .sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to + 0.5) last.to = Math.max(last.to, s.to);
    else out.push({ from: s.from, to: s.to });
  }
  return out;
}

/** Seconds of the source that are indexed. */
export function coveredSeconds(index: Pick<SceneIndex, "coverage">): number {
  return index.coverage.reduce((n, c) => n + (c.to - c.from), 0);
}

/** True when (nearly) the whole source is indexed: the last few seconds of an upload are often an end card. */
export function indexComplete(
  index: Pick<SceneIndex, "coverage" | "source">,
): boolean {
  return (
    coveredSeconds(index) >=
    index.source.duration - Math.max(5, index.source.duration * 0.01)
  );
}

/** The next stretch to index: the first gap in the coverage, at most `chunk` seconds long; undefined when done. */
export function nextGap(
  index: Pick<SceneIndex, "coverage" | "source">,
  chunk: number,
): { from: number; to: number } | undefined {
  if (indexComplete(index)) return undefined;
  let from = 0;
  for (const c of index.coverage) {
    if (c.from > from + 0.5) break;
    from = Math.max(from, c.to);
  }
  const end =
    index.coverage.find((c) => c.from > from + 0.5)?.from ??
    index.source.duration;
  const to = Math.min(end, from + chunk);
  return to - from > 1 ? { from, to } : undefined;
}

/**
 * Whether a newly found upload should replace the one a game's index was built from (the index is rebuilt only
 * then). A cutscene movie beats a playthrough; after that only a clearly better picture of the same kind counts,
 * and the same upload never replaces itself. More views or a different length are not reasons: rebuilding costs
 * hours of the GPU.
 */
export function betterSource(
  current: Pick<SceneSource, "videoId" | "kind" | "height">,
  candidate: Pick<SceneSource, "videoId" | "kind" | "height">,
): boolean {
  if (candidate.videoId === current.videoId) return false;
  if (candidate.kind !== current.kind) return candidate.kind === "movie";
  return (current.height ?? 0) < 1080 && (candidate.height ?? 0) >= 1080;
}

/**
 * Replaces everything inside [from, to) with freshly indexed shots and lines, renumbers and extends the coverage.
 * A new shot with exactly the span of an old one keeps what was already seen in it (its description, names and
 * tags): reading a stretch again, with a better text reader or to add the voice, must not cost the GPU's work.
 */
export function mergeStretch(
  index: SceneIndex,
  stretch: { from: number; to: number },
  shots: Array<Omit<SceneShot, "id">>,
  lines: Array<Omit<DialogueLine, "id" | "shot">>,
): SceneIndex {
  const inside = (t: number) =>
    t >= stretch.from - 1e-6 && t < stretch.to - 1e-6;
  const span = (s: { start: number; end: number }) =>
    `${s.start.toFixed(2)}|${s.end.toFixed(2)}`;
  const seen = new Map(
    index.shots
      .filter((s) => inside(s.start) && s.desc)
      .map((s) => [span(s), s]),
  );
  const allShots = [
    ...index.shots.filter((s) => !inside(s.start)),
    ...shots.map((s) => {
      const old = s.desc ? undefined : seen.get(span(s));
      return old
        ? {
            ...s,
            id: 0,
            desc: old.desc,
            who: old.who,
            where: old.where || s.where,
            mood: old.mood,
            tags: old.tags,
            ...(old.menu ? { menu: true } : {}),
          }
        : { ...s, id: 0 };
    }),
  ].sort((a, b) => a.start - b.start);
  allShots.forEach((s, i) => (s.id = i));
  const allLines = [
    ...index.lines.filter((l) => !inside(l.start)),
    ...lines.map((l) => ({ ...l, id: 0, shot: 0 })),
  ].sort((a, b) => a.start - b.start);
  allLines.forEach((l, i) => {
    l.id = i;
    l.shot = shotAt(allShots, l.start);
  });
  return {
    ...index,
    shots: allShots,
    lines: allLines,
    coverage: mergeCoverage([...index.coverage, stretch]),
  };
}

/** The stored index for a game, or undefined when there is none this code can read. */
export async function loadSceneIndex(
  dataDir: string,
  game: string,
): Promise<SceneIndex | undefined> {
  try {
    return parseSceneIndex(
      JSON.parse(
        await fs.readFile(
          path.join(sceneIndexDir(dataDir, game), "index.json"),
          "utf8",
        ),
      ),
    );
  } catch {
    return undefined;
  }
}

/** Written beside itself first and renamed, so a reader never sees half a file. */
export async function saveSceneIndex(
  dataDir: string,
  index: SceneIndex,
): Promise<string> {
  const dir = sceneIndexDir(dataDir, index.game);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "index.json");
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(index));
  await fs.rename(tmp, file);
  return file;
}
