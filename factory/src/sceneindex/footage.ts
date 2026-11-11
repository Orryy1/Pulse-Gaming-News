// The scene index as the first place cutscene footage is looked for (the hook into src/services.ts
// fetchCutscenes). With an index for the game, each line that wants a picture is looked up, and the exact shot it
// names is fetched at full quality (yt-dlp --download-sections, a few seconds around the shot), cut on the shot's
// own start, muted and screened like every other cutscene clip. A line the index is not sure about is left to the
// existing search, which still runs for whatever is missing. Nothing about rights changes: the clips carry the same
// provenance, credit and source fields as src/assets/cutscenes.ts, so the per-video budget, the publisher caps
// (Rockstar's 10 seconds) and the "<Game> cutscenes, via YouTube" credit are applied by the same code as before.

import fs from "node:fs/promises";
import path from "node:path";
import { runCapped } from "../lib/child.ts";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import {
  cleanFrameReason,
  cutsceneDownloadArgs,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  type CutsceneClip,
} from "../assets/cutscenes.ts";
import {
  CLIP_SECONDS,
  DARK_LUMA,
  darkestLuma,
  MIN_CLIP_SECONDS,
  type FootageTarget,
} from "../assets/clipscore.ts";
import { clipBigText } from "../assets/cliptext.ts";
import { findQuote, findShots } from "./lookup.ts";
import { loadSceneIndex, sceneSlug, type SceneIndex } from "./schema.ts";
import { requestSceneIndex } from "./job.ts";
import type { Config } from "../config.ts";

export interface PlannedClip {
  key: string;
  shot: number;
  /** Seconds into the source where the clip starts, and how long it runs. */
  from: number;
  seconds: number;
  confidence: number;
  label: string;
  /** Set when the line quotes dialogue and the clip is the moment the words are on screen or said. */
  quote?: string;
}

/** Words in quotation marks in a narration line, four words or more: a line of the game's dialogue being quoted. */
export function quotedWords(text: string): string[] {
  return [...text.matchAll(/["“]([^"”]{12,160})["”]/g)]
    .map((m) => m[1]!.trim())
    .filter((q) => q.split(/\s+/).length >= 4);
}

/**
 * Which shot each line gets (pure): a line that quotes the game's dialogue gets the shot the words are said in;
 * otherwise the best shot the index is confident of. No moment is used twice (or within three seconds of another),
 * a clip opens just after the cut and ends before the next one, never longer than a matcher clip, and the total
 * stays inside the seconds allowed.
 */
export function planIndexedClips(
  index: SceneIndex,
  targets: FootageTarget[],
  o: {
    maxClips: number;
    maxSeconds: number;
    minConfidence: number;
    clipSeconds?: number;
  },
): PlannedClip[] {
  const clipSeconds = o.clipSeconds ?? CLIP_SECONDS;
  const out: PlannedClip[] = [];
  let total = 0;
  const free = (from: number) => out.every((c) => Math.abs(c.from - from) >= 3);
  for (const t of targets) {
    if (out.length >= o.maxClips || o.maxSeconds - total < MIN_CLIP_SECONDS)
      break;
    const candidates: Array<{
      shot: number;
      confidence: number;
      quote?: string;
    }> = [];
    for (const q of quotedWords(t.text)) {
      const hit = findQuote(index, q, { max: 1, minConfidence: 0.8 })[0];
      if (hit)
        candidates.push({
          shot: hit.shot,
          confidence: hit.confidence,
          quote: hit.text,
        });
    }
    for (const h of findShots(index, t, {
      max: 4,
      minConfidence: o.minConfidence,
      minSeconds: MIN_CLIP_SECONDS + 0.3,
    }))
      candidates.push({ shot: h.shot, confidence: h.confidence });
    for (const c of candidates) {
      const shot = index.shots[c.shot];
      if (!shot || shot.blank || shot.menu) continue;
      const from = Math.round((shot.start + 0.1) * 100) / 100;
      const seconds =
        Math.round(
          Math.min(clipSeconds, shot.end - from - 0.1, o.maxSeconds - total) *
            30,
        ) / 30;
      if (seconds < MIN_CLIP_SECONDS || !free(from)) continue;
      out.push({
        key: t.key,
        shot: shot.id,
        from,
        seconds,
        confidence: c.confidence,
        label: shot.desc.slice(0, 80),
        ...(c.quote ? { quote: c.quote } : {}),
      });
      total += seconds;
      break;
    }
  }
  return out;
}

const label = (value: string) =>
  value.replace(/[\r\n"]/g, " ").replace(/\bpublisher\s*:/gi, "publisher ");

export interface IndexedOptions {
  index: SceneIndex;
  gameTitle: string;
  episodeDir: string;
  targets: FootageTarget[];
  maxClips: number;
  maxSeconds: number;
  minConfidence: number;
  ytdlp: string;
  publisher?: string;
  textCheck?: boolean;
  deps?: {
    /** Fetches [from, to) of the source at full quality into `file`. */
    download?: (
      videoId: string,
      from: number,
      to: number,
      file: string,
    ) => Promise<void>;
    /** Cuts `seconds` from `at` of a downloaded section into the muted 1080p clip. */
    cut?: (
      section: string,
      at: number,
      seconds: number,
      file: string,
    ) => Promise<void>;
    /** True when the finished clip may be used (no overlay, not blank, not dark). */
    screen?: (file: string, seconds: number) => Promise<boolean>;
  };
}

async function download(
  videoId: string,
  from: number,
  to: number,
  file: string,
  ytdlp: string,
): Promise<void> {
  await runCapped(
    ytdlp,
    cutsceneDownloadArgs(
      { videoId, title: "", uploader: "", duration: to },
      from,
      to,
      file,
    ),
    { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
  );
}

async function cut(
  section: string,
  at: number,
  seconds: number,
  file: string,
): Promise<void> {
  await runCapped(
    FFMPEG,
    [
      "-loglevel",
      "error",
      "-y",
      "-ss",
      at.toFixed(2),
      "-i",
      section,
      "-t",
      seconds.toFixed(2),
      "-an",
      "-sn",
      "-dn",
      "-vf",
      "scale=-2:1080,fps=30",
      "-c:v",
      "libx264",
      "-crf",
      "17",
      "-preset",
      "fast",
      "-pix_fmt",
      "yuv420p",
      file,
    ],
    { timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
}

async function screen(
  file: string,
  seconds: number,
  textCheck: boolean,
): Promise<boolean> {
  const raw = `${file}.gray`;
  try {
    await runCapped(
      FFMPEG,
      [
        "-v",
        "error",
        "-y",
        "-i",
        file,
        "-vf",
        `fps=${(5 / Math.max(1, seconds)).toFixed(4)},scale=${FRAME_WIDTH}:${FRAME_HEIGHT},format=gray`,
        "-frames:v",
        "5",
        "-an",
        "-f",
        "rawvideo",
        raw,
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    const data = await fs.readFile(raw);
    const size = FRAME_WIDTH * FRAME_HEIGHT;
    const frames: Uint8Array[] = [];
    for (let at = 0; at + size <= data.length; at += size)
      frames.push(data.subarray(at, at + size));
    if (cleanFrameReason(frames)) return false;
    const darkest = await darkestLuma(file);
    if (darkest !== undefined && darkest < DARK_LUMA) return false;
    if (textCheck && !(await clipBigText(file, seconds)).clean) return false;
    return true;
  } finally {
    await fs.rm(raw, { force: true }).catch(() => undefined);
  }
}

/**
 * Cutscene clips for the lines the index knows the exact shot of, in target order, each tagged with its line.
 * Returns nothing when the index has no confident shot for any line; a failed download or a clip that does not
 * pass the screen is simply left out (the caller's ordinary cutscene search covers what is missing).
 */
export async function indexedCutsceneClips(
  o: IndexedOptions,
): Promise<CutsceneClip[]> {
  const plan = planIndexedClips(o.index, o.targets, o);
  if (!plan.length) return [];
  const src = o.index.source;
  const url = `https://www.youtube.com/watch?v=${src.videoId}`;
  const assets = path.join(o.episodeDir, "assets");
  await fs.mkdir(assets, { recursive: true });
  const work = await fs.mkdtemp(path.join(o.episodeDir, "sceneindex_work_"));
  const out: CutsceneClip[] = [];
  try {
    for (const [i, p] of plan.entries()) {
      const section = path.join(work, `section_${i}.mp4`);
      const lead = Math.min(2, p.from);
      const rel = path.join(
        "assets",
        `sceneindex_${path.basename(work).slice(-6)}_${i}.mp4`,
      );
      const file = path.join(o.episodeDir, rel);
      try {
        await (
          o.deps?.download ?? ((id, a, b, f) => download(id, a, b, f, o.ytdlp))
        )(
          src.videoId,
          Math.round((p.from - lead) * 100) / 100,
          Math.round(Math.min(src.duration, p.from + p.seconds + 2) * 100) / 100,
          section,
        );
        await (o.deps?.cut ?? cut)(section, lead, p.seconds, file);
        if (
          !(await (
            o.deps?.screen ?? ((f, s) => screen(f, s, o.textCheck !== false))
          )(file, p.seconds))
        ) {
          await fs.rm(file, { force: true }).catch(() => undefined);
          log("info", "scene index: clip screened out", {
            game: o.gameTitle,
            at: p.from,
          });
          continue;
        }
      } catch (err) {
        log("warn", "scene index: clip not fetched", {
          game: o.gameTitle,
          at: p.from,
          error: errorMessage(err),
        });
        await fs.rm(file, { force: true }).catch(() => undefined);
        continue;
      } finally {
        await fs.rm(section, { force: true }).catch(() => undefined);
      }
      const shot = o.index.shots[p.shot]!;
      const beatIndex = p.key.startsWith("beat:")
        ? Number.parseInt(p.key.slice(5), 10)
        : undefined;
      const moment = p.key.match(/#m(\d+)$/)?.[1];
      out.push({
        kind: "clip",
        file: rel,
        sourceUrl: url,
        durationSeconds: p.seconds,
        beatIndex,
        moment: moment === undefined ? undefined : Number(moment),
        role: p.key === "hook" ? "hook" : undefined,
        startSeconds: p.from,
        motion: Math.min(1, shot.motion / 40),
        luma: shot.luma,
        label: p.label,
        reason: `scene index: ${p.quote ? `the line "${p.quote.slice(0, 60)}"` : p.label} (confidence ${p.confidence})`,
        provenance: `Cutscenes for "${label(o.gameTitle)}" from YouTube video "${label(src.title)}" by ${label(src.uploader)}, video ID: ${src.videoId}${o.publisher ? `, publisher: ${o.publisher}` : ""} (${url}), ${p.seconds}s, section start: ${(p.from - lead).toFixed(2)}s, source time: ${p.from.toFixed(2)}s, muted; chosen for ${p.key} by the scene index (${p.label})`,
        audio: false,
        credit: `FOOTAGE: ${o.gameTitle.toUpperCase()} CUTSCENES / YOUTUBE`,
        youtubeSource: {
          videoId: src.videoId,
          title: src.title,
          uploader: src.uploader,
        },
        span: { source: url, from: p.from, to: p.from + p.seconds },
      });
    }
    return out;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Index first, search second (the wiring used by src/services.ts): the indexed clips, then the ordinary cutscene
 * search for the lines still without a clip and the seconds still allowed. With no index, or the setting off, this
 * is the ordinary search alone.
 */
export async function cutscenesIndexFirst<
  O extends { targets: FootageTarget[]; maxClips: number; maxSeconds: number },
>(
  options: O,
  indexed: ((o: O) => Promise<CutsceneClip[]>) | undefined,
  search: (o: O) => Promise<CutsceneClip[]>,
): Promise<CutsceneClip[]> {
  const first = indexed
    ? await indexed(options).catch(() => [] as CutsceneClip[])
    : [];
  if (!first.length) return search(options);
  const used = first.reduce((n, c) => n + (c.durationSeconds ?? 0), 0);
  const has = new Set(
    first.map((c) =>
      c.role === "hook"
        ? "hook"
        : c.beatIndex === undefined
          ? ""
          : `beat:${c.beatIndex}${c.moment === undefined ? "" : `#m${c.moment}`}`,
    ),
  );
  const rest = options.targets.filter((t) => !has.has(t.key));
  const left = options.maxSeconds - used;
  if (
    !rest.length ||
    left < MIN_CLIP_SECONDS ||
    options.maxClips - first.length <= 0
  )
    return first;
  const more = await search({
    ...options,
    targets: rest,
    maxClips: options.maxClips - first.length,
    maxSeconds: left,
  }).catch(() => [] as CutsceneClip[]);
  // The search samples the same upload: never the same moment twice.
  return [
    ...first,
    ...more.filter((m) =>
      first.every(
        (f) =>
          f.span.source !== m.span.source ||
          Math.abs(f.span.from - m.span.from) >= 3,
      ),
    ),
  ];
}

const EDITION = /\b(remaster(?:ed)?|remake|reimagined|definitive\s+edition)\b/i;

/**
 * Whether an index is of the release a video is about (pure): an index built from a remake's or remaster's upload
 * serves only videos about that recent release (or a game whose own name says so); the 1998 game must not be shown
 * with the 2026 remake's pictures. The cutscene search then looks for the original's own upload, as before.
 */
export function indexFitsRelease(index: Pick<SceneIndex, "source" | "game">, recentRelease: boolean | undefined): boolean {
  if (!EDITION.test(index.source.title)) return true;
  return Boolean(recentRelease) || EDITION.test(index.game);
}

/**
 * The stored game folder for a title as a script writes it (pure): the same name, or one being the other's
 * subtitle of two words or more ("Ocarina of Time" for "The Legend of Zelda: Ocarina of Time"), the rule the
 * cutscene picker uses for upload titles. Never a longer, different game ("Halo 3" is not "Halo 3: ODST").
 */
export function matchingSlug(slugs: string[], game: string): string | undefined {
  const want = sceneSlug(game);
  if (!want) return undefined;
  if (slugs.includes(want)) return want;
  const sub = game.includes(":") ? sceneSlug(game.split(":").pop()!) : "";
  return slugs.find((s) => {
    if (sub && sub.split("-").length >= 2 && (s === sub || s.endsWith(`-${sub}`))) return true;
    return want.split("-").length >= 2 && want.length >= 8 && s.endsWith(`-${want}`);
  });
}

async function findIndex(dataDir: string, game: string): Promise<SceneIndex | undefined> {
  const exact = await loadSceneIndex(dataDir, game);
  if (exact) return exact;
  const slugs = await fs.readdir(path.join(dataDir, "sceneindex")).catch(() => [] as string[]);
  const slug = matchingSlug(slugs, game);
  if (!slug) return undefined;
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dataDir, "sceneindex", slug, "index.json"), "utf8"));
    return typeof raw?.game === "string" ? loadSceneIndex(dataDir, raw.game) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * fetchCutscenes with the scene index in front (src/services.ts). SCENE_INDEX off: exactly the search. On: a game
 * with a usable index gets its exact shots first; a game without one is queued for indexing and gets the search.
 */
export async function indexFirstCutscenes<
  O extends {
    gameTitle: string;
    recentRelease?: boolean;
    episodeDir: string;
    targets: FootageTarget[];
    maxClips: number;
    maxSeconds: number;
    publisher?: string;
  },
>(
  cfg: Pick<Config, "sceneIndex" | "sceneIndexMinConfidence" | "dataDir" | "ytdlpPath">,
  options: O,
  search: (o: O) => Promise<CutsceneClip[]>,
  deps?: IndexedOptions["deps"],
): Promise<CutsceneClip[]> {
  if (!cfg.sceneIndex) return search(options);
  return cutscenesIndexFirst(
    options,
    async (o) => {
      const index = await findIndex(cfg.dataDir, o.gameTitle);
      if (!index) {
        await requestSceneIndex(cfg, o.gameTitle, "a video about it", Boolean(o.recentRelease));
        return [];
      }
      if (!indexFitsRelease(index, o.recentRelease)) return [];
      return indexedCutsceneClips({
        index,
        gameTitle: o.gameTitle,
        episodeDir: o.episodeDir,
        targets: o.targets,
        maxClips: o.maxClips,
        maxSeconds: o.maxSeconds,
        minConfidence: cfg.sceneIndexMinConfidence,
        ytdlp: cfg.ytdlpPath,
        publisher: o.publisher,
        deps,
      });
    },
    search,
  );
}
