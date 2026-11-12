// Building a game's scene index (the part that touches yt-dlp, ffmpeg, the text reader, Whisper and the vision
// model; the rules it applies live in the pure modules beside it). One call does one bounded piece of work and
// saves, so the job can stop after any piece and pick up later (renders always win on the Mac):
//   1. choose the source once: the cutscene picker's rules, a full movie before a playthrough;
//   2. fetch a low-resolution proxy of it once (about 0.3 GB an hour at 480p, sound included);
//   3. stretch by stretch: find the cuts, read the text on screen twice a second, transcribe the sound,
//      and store the shots and the dialogue lines;
//   4. describe each shot from its keyframes with the free local vision model, whenever the PC answers.
// Steps 3 and 4 are separate on purpose: reading and listening need only this machine, looking needs the PC's GPU.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG, YTDLP_TEXT } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import {
  cutsceneQueries,
  pickCutsceneUpload,
  type CutsceneUpload,
} from "../assets/cutscenes.ts";
import { parseSignalStats } from "../assets/clipscore.ts";
import { readText, type OcrPage } from "../assets/ocr.ts";
import { transcribeWords } from "../qa/narration.ts";
import {
  betterSource,
  emptySceneIndex,
  indexComplete,
  loadSceneIndex,
  mergeStretch,
  nextGap,
  saveSceneIndex,
  sceneIndexDir,
  type SceneIndex,
  type SceneShot,
  type SceneSource,
  type TimedWord,
} from "./schema.ts";
import { keyframeTimes, shotsFromScan } from "./shots.ts";
import {
  mergeDialogue,
  shotText,
  textBoxLines,
  voiceLines,
  type OcrSample,
  type TextLine,
} from "./dialogue.ts";
import { gameNames, knownName, mergeNames } from "./names.ts";
import { canonicalGame } from "./gamefetch.ts";
import { lookAtShot, visionUp, type ShotLook } from "./describe.ts";
import { groundedCast, tidyIndex } from "./tidy.ts";

const exec = promisify(execFile);
const run = (
  cmd: string,
  args: string[],
  o: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {},
) =>
  exec(cmd, args, {
    cwd: o.cwd,
    env: o.env,
    timeout: o.timeout ?? 30 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    killSignal: "SIGKILL",
  });

/** Frames a second the cut scan looks at: enough to place a cut within a tenth of a second, a third of the decoding. */
export const SCAN_FPS = 10;

export interface BuildSettings {
  dataDir: string;
  ytdlp: string;
  /** Python with Whisper (src/qa/whisperwords.py); empty: dialogue is read off the screen only. */
  whisperPython: string;
  /** The proxy's picture height. 480 keeps text boxes readable for the text reader; 360 does not. */
  proxyHeight: number;
  /** Frames a second the text reader looks at. */
  ocrFps: number;
  /** Seconds of the source indexed in one piece of work. */
  chunkSeconds: number;
  /** No source longer than this many hours (a 19-hour playthrough is 6 GB of proxy and days of the GPU). */
  maxHours: number;
}

export interface BuildDeps {
  search?: (query: string) => Promise<CutsceneUpload[]>;
  details?: (upload: CutsceneUpload) => Promise<CutsceneUpload | undefined>;
  names?: (game: string) => Promise<{ cast: string[]; places: string[] }>;
  readText?: (files: string[]) => Promise<Map<string, OcrPage>>;
  hear?: (wav: string) => Promise<TimedWord[]>;
  look?: typeof lookAtShot;
  visionUp?: () => Promise<boolean>;
  now?: () => Date;
}

/** A cutscene movie or a playthrough, by what the upload calls itself. */
export function sourceKind(title: string): SceneSource["kind"] {
  return /\b(cut\s*scenes?|cinematics?|(?:game|full)\s+movie|the\s+movie|movie)\b/i.test(
    title,
  ) && !/\b(walkthrough|playthrough|longplay|full\s+gameplay)\b/i.test(title)
    ? "movie"
    : "playthrough";
}

/** The launch fetcher's searches: full movies and all cutscenes, then no-commentary full playthroughs. */
export function launchQueries(game: string): string[] {
  const g = game.trim();
  return g
    ? [
        `${g} full movie all cutscenes`,
        `${g} all cutscenes no commentary`,
        `${g} full game movie 4K`,
        `${g} no commentary full playthrough`,
        `${g} full game walkthrough no commentary 4K`,
        `${g} longplay no commentary`,
      ]
    : [];
}

/** Every launch search's results, one entry per upload (the fetcher's dry run prints its verdicts on them). */
export async function launchCandidates(
  game: string,
  ytdlp: string,
  search?: (query: string) => Promise<CutsceneUpload[]>,
): Promise<CutsceneUpload[]> {
  const hits: CutsceneUpload[] = [];
  for (const query of launchQueries(game))
    hits.push(...(await (search?.(query) ?? searchUploads(query, ytdlp)).catch(() => [] as CutsceneUpload[])));
  return [...new Map(hits.map((h) => [h.videoId, h])).values()];
}

/** One upload's full details (height from its formats), for the dry run. */
export function launchDetails(upload: CutsceneUpload, ytdlp: string): Promise<CutsceneUpload | undefined> {
  return uploadDetails(upload, ytdlp);
}

export function sourceQueries(game: string): string[] {
  const g = game.trim();
  return g
    ? [
        ...cutsceneQueries(g),
        `${g} full game walkthrough no commentary`,
        `${g} longplay no commentary`,
      ]
    : [];
}

/**
 * The upload to index, by the cutscene picker's rules (the game's name, clean, no commentary, the remake for a
 * recent release) with two of the index's own: a full movie of twenty minutes or more beats any playthrough, and
 * nothing longer than `maxHours` is taken.
 */
export function pickSource(
  candidates: CutsceneUpload[],
  game: string,
  o: { recentRelease?: boolean; maxHours?: number; complete?: boolean; releasedOn?: string; siblings?: string[] } = {},
): (CutsceneUpload & { kind: SceneSource["kind"] }) | undefined {
  if (o.complete) return pickComplete(candidates, game, o);
  const max = (o.maxHours ?? 12) * 3600;
  const fits = candidates.filter((c) => c.duration <= max);
  const movie = pickCutsceneUpload(
    fits.filter((c) => sourceKind(c.title) === "movie" && c.duration >= 1200),
    game,
    o,
  );
  if (movie) return { ...movie, kind: "movie" };
  const play = pickCutsceneUpload(
    fits.filter(
      (c) => sourceKind(c.title) === "playthrough" && c.duration >= 1800,
    ),
    game,
    o,
  );
  return play ? { ...play, kind: "playthrough" } : undefined;
}

// ---------------------------------------------------------------- launch fetching (GAME_FETCH)

/** Part of a series, not the whole game: early launch uploads are "Part 1" while the uploader is still playing. */
const PARTIAL =
  /\b(?:part|pt|ep(?:isode)?|chapter|mission|act|day)\s*#?\s*\d+\b|\b(?:first|opening)\s+\d+\s+(?:hours?|minutes?|missions?)\b/i;
/** Burned-in subtitles, captions, translations or a channel's own extras over the picture. */
const SUBTITLED =
  /\b(?:subtitles?|subtitled|subbed|eng(?:lish)?\s*subs?|with\s+subs|cc|captions?|dubbed|dublado|doblado|legendado|subtitulado|sous[-\s]titres?|untertitel\w*|sottotitoli|napisy|altyaz\w*|espanol|latino|deutsch|italiano|portugues|pt[-\s]?br)\b|(?:türkçe|español|français|português|русск|日本語|中文|한국어)/i;
/** "No subtitles" is what a clean upload says about itself: never read as subtitles. */
const NO_SUBTITLES = /\b(?:no|without|w\/o|sin)\s+(?:subtitles?|subs|captions?|hud)\b/gi;
/** Not footage of the game itself, or not the released game: marketing, previews, leaks, fan work. */
const NOT_THE_GAME =
  /\b(?:trailers?|teasers?|leaks?|leaked|concept|fan[-\s]?made|predictions?|everything\s+we\s+know|recreat\w*|remade\s+in|unreal\s+engine\s*5?|ue5|ai\s+generated|parody|speedrun|any%|reshade|graphics\s+mod|comparison|vs\.?|extended\s+look|premiere|reveal\w*|showcase|preview|first\s+look|netflix|beta|demo)\b/i;
/** One character's scenes, not the whole story. */
const ONE_CHARACTER =
  /\ball\s+(?!cut\s*scenes\b|scenes\b)[\p{L}'’]+(?:\s+[\p{L}'’]+)?\s+(?:cut\s*scenes?|scenes)\b/iu;
/** One ending, unless the title says the whole game is there too. */
const ONE_ENDING = /\b(?:full|good|bad|true|secret)\s+ending\b/i;
const WHOLE_GAME = /\ball\s+cut\s*scenes\b|\bfull\s+(?:game\s+)?movie\b|\bfull\s+game\b|\bfull\s+playthrough\b|\bcomplete\s+story\b/i;
/** Languages other than English: a dub or burned-in subtitles in another language. */
const OTHER_LANGUAGE =
  /\b(?:german|french|spanish|russian|italian|portuguese|japanese|korean|chinese|polish|turkish|arabic|hindi|brazilian|castellano|vietnamese|thai|indonesian)\b/i;
/** A cutscene compilation, not a playthrough with the uploader's play in it. */
const CUTSCENE_WORDS = /\bcut\s*scenes?\b/i;

/**
 * The sibling game an upload's title names instead of this one (pure), or undefined: a longer title of the same
 * series that contains this game's name ("GTA Vice City Stories" when "GTA Vice City" is asked for, "Half-Life 2"
 * for "Half-Life"). Matched however the names are written (canonicalGame), as the full name or as this name's last
 * two words followed by the sibling's own ending ("Vice City Stories").
 */
export function siblingNamed(title: string, game: string, siblings: string[]): string | undefined {
  const t = ` ${canonicalGame(title)} `;
  const g = canonicalGame(game);
  if (!g) return undefined;
  for (const sib of siblings) {
    const k = canonicalGame(sib);
    if (!k || k === g || !k.startsWith(`${g} `)) continue;
    if (t.includes(` ${k} `) || t.includes(` ${g.split(" ").slice(-2).join(" ")} ${k.slice(g.length + 1)} `)) return sib;
  }
  return undefined;
}

export interface UploadVerdict {
  upload: CutsceneUpload;
  ok: boolean;
  kind: SceneSource["kind"];
  reason: string;
}

/**
 * Every candidate with the reason it is or is not a launch source (pure), for the fetcher and its dry run. The
 * cutscene picker's clean-upload rules first (the game's name, cutscenes or no commentary, no commentary, reaction,
 * face cam, mods or live streams, the remake's upload for a recent release), then launch rules: the whole game, not
 * a part; no burned-in subtitles; the game itself, not trailers, leaks or fan remakes; 1080p or better once the
 * height is known; a movie of 20 minutes or more, a playthrough of an hour or more; nothing over `maxHours`.
 * A face cam, a corner logo or subtitles the title does not admit are caught later on each clip by the clean-frame
 * screen, as for every cutscene clip.
 */
export function judgeUploads(
  candidates: CutsceneUpload[],
  game: string,
  o: { recentRelease?: boolean; maxHours?: number; releasedOn?: string; siblings?: string[] } = {},
): UploadVerdict[] {
  const max = (o.maxHours ?? 12) * 3600;
  // Uploaded at least the day before the release day: anything older is marketing, not the released game.
  const earliest = o.releasedOn ? Date.parse(`${o.releasedOn.slice(0, 10)}T00:00:00Z`) - 86_400_000 : NaN;
  return candidates.map((upload) => {
    // "Full Game Movie | Cinematic Gameplay" is a playthrough, whatever it calls itself.
    const kind = /\bgameplay\b/i.test(upload.title) ? "playthrough" : sourceKind(upload.title);
    const no = (reason: string): UploadVerdict => ({
      upload,
      ok: false,
      kind,
      reason,
    });
    if (
      upload.isLive ||
      (upload.liveStatus && upload.liveStatus !== "not_live")
    )
      return no("a live stream");
    if (!pickCutsceneUpload([upload], game, o)) {
      const t = upload.title.toLowerCase();
      if (
        /commentar|reaction|react|face\s*cam|web\s*cam|let'?s\s+play|stream/.test(
          t.replace(/no\s+commentary/g, ""),
        )
      )
        return no("commentary, reaction, face cam or stream");
      if (!/(cut\s*scenes?|movies?|no\s+commentary)/.test(t))
        return no("neither cutscenes nor no commentary");
      if (/remaster|remake|reimagined|definitive/.test(t))
        return no("another edition");
      return no("not this game, or mods, reviews, lore or rankings");
    }
    const sibling = siblingNamed(upload.title, game, o.siblings ?? []);
    if (sibling) return no(`another game of the series (${sibling})`);
    if (NOT_THE_GAME.test(upload.title))
      return no("not the game itself (trailers, leaks, fan remakes)");
    if (SUBTITLED.test(upload.title.replace(NO_SUBTITLES, " "))) return no("burned-in subtitles, a dub or another language");
    if (OTHER_LANGUAGE.test(upload.title)) return no("another language");
    if (ONE_CHARACTER.test(upload.title)) return no("one character's scenes, not the whole story");
    if (ONE_ENDING.test(upload.title) && !WHOLE_GAME.test(upload.title)) return no("one ending, not the whole story");
    if (upload.uploadDate && Number.isFinite(earliest) && Date.parse(`${upload.uploadDate}T00:00:00Z`) < earliest)
      return no(`uploaded ${upload.uploadDate}, before the game came out`);
    if (PARTIAL.test(upload.title))
      return no("part of a series, not the whole game");
    if (upload.duration > max)
      return no(`longer than ${o.maxHours ?? 12} hours`);
    if (kind === "movie" && upload.duration < 1200)
      return no("a movie under 20 minutes");
    if (kind === "playthrough" && upload.duration < 3600)
      return no("a playthrough under an hour");
    if (
      upload.height !== undefined &&
      upload.height > 0 &&
      upload.height < 1080
    )
      return no(`${upload.height}p, under 1080p`);
    return {
      upload,
      ok: true,
      kind,
      reason:
        kind === "movie"
          ? "clean full movie"
          : "clean no-commentary playthrough",
    };
  });
}

/**
 * The most complete clean upload (pure): a movie before a playthrough, one that calls itself cutscenes before
 * any other, then the longest (people finish the game over days: the longest clean upload covers the most of the
 * story), then 1080p or better, then views.
 */
export function pickComplete(
  candidates: CutsceneUpload[],
  game: string,
  o: { recentRelease?: boolean; maxHours?: number; releasedOn?: string; siblings?: string[] } = {},
): (CutsceneUpload & { kind: SceneSource["kind"] }) | undefined {
  const best = judgeUploads(candidates, game, o)
    .filter((v) => v.ok)
    .sort(
      (a, b) =>
        Number(b.kind === "movie") - Number(a.kind === "movie") ||
        Number(CUTSCENE_WORDS.test(b.upload.title)) - Number(CUTSCENE_WORDS.test(a.upload.title)) ||
        b.upload.duration - a.upload.duration ||
        Number((b.upload.height ?? 0) >= 1080) -
          Number((a.upload.height ?? 0) >= 1080) ||
        (b.upload.viewCount ?? 0) - (a.upload.viewCount ?? 0),
    )[0];
  return best ? { ...best.upload, kind: best.kind } : undefined;
}

/**
 * Whether a launch upload replaces the one an index was built from (pure): betterSource's rules, and also a clean
 * upload of the same kind at least 15% longer (a finished movie after a part-way one), never a shorter one.
 */
export function moreCompleteSource(
  current: Pick<SceneSource, "videoId" | "kind" | "height" | "duration">,
  candidate: Pick<SceneSource, "videoId" | "kind" | "height" | "duration">,
): boolean {
  if (candidate.videoId === current.videoId) return false;
  if (candidate.kind !== current.kind) return candidate.kind === "movie";
  if (candidate.duration >= current.duration * 1.15) return true;
  return (
    betterSource(current, candidate) &&
    candidate.duration >= current.duration * 0.9
  );
}

/** One YouTube search (flat results), as the launch picker reads them. */
export function launchSearch(query: string, ytdlp: string): Promise<CutsceneUpload[]> {
  return searchUploads(query, ytdlp);
}

async function searchUploads(
  query: string,
  ytdlp: string,
): Promise<CutsceneUpload[]> {
  const { stdout } = await run(
    ytdlp,
    [
      ...YTDLP_TEXT.args,
      "--no-warnings",
      "--flat-playlist",
      "--dump-json",
      `ytsearch15:${query}`,
    ],
    { timeout: 90_000, env: YTDLP_TEXT.env },
  );
  return stdout.split(/\r?\n/).flatMap((line) => {
    try {
      const item = JSON.parse(line);
      return [
        {
          videoId: String(item.id ?? ""),
          title: String(item.title ?? ""),
          uploader: String(item.uploader ?? item.channel ?? ""),
          duration: Number(item.duration) || 0,
          height: Number(item.height) || undefined,
          viewCount: Number(item.view_count) || undefined,
          isLive: item.is_live === true,
          liveStatus: item.live_status || undefined,
        },
      ];
    } catch {
      return [];
    }
  });
}

async function uploadDetails(
  upload: CutsceneUpload,
  ytdlp: string,
): Promise<CutsceneUpload | undefined> {
  const { stdout } = await run(
    ytdlp,
    [
      ...YTDLP_TEXT.args,
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
      "--dump-single-json",
      `https://www.youtube.com/watch?v=${upload.videoId}`,
    ],
    { timeout: 90_000, env: YTDLP_TEXT.env },
  );
  const item = JSON.parse(stdout);
  if (
    item.id !== upload.videoId ||
    item.was_live === true ||
    item.is_live === true
  )
    return undefined;
  const heights = (Array.isArray(item.formats) ? item.formats : [])
    .filter((f: { vcodec?: string }) => f.vcodec !== "none")
    .map((f: { height?: number }) => Number(f.height) || 0);
  return {
    videoId: upload.videoId,
    title: String(item.title ?? ""),
    uploader: String(item.uploader ?? item.channel ?? ""),
    duration: Number(item.duration) || 0,
    height: Math.max(Number(item.height) || 0, ...heights) || undefined,
    viewCount: Number(item.view_count) || undefined,
    isLive: false,
    liveStatus: "not_live",
    ...(/^\d{8}$/.test(String(item.upload_date ?? ""))
      ? { uploadDate: `${item.upload_date.slice(0, 4)}-${item.upload_date.slice(4, 6)}-${item.upload_date.slice(6, 8)}` }
      : {}),
  };
}

/** Searches, confirms the best few uploads' details and picks one. Undefined when nothing clean is found. */
export async function chooseSource(
  game: string,
  s: Pick<BuildSettings, "ytdlp" | "maxHours">,
  o: { recentRelease?: boolean; complete?: boolean; releasedOn?: string; siblings?: string[] } = {},
  deps: BuildDeps = {},
): Promise<SceneSource | undefined> {
  const hits: CutsceneUpload[] = [];
  for (const query of o.complete ? launchQueries(game) : sourceQueries(game)) {
    try {
      hits.push(
        ...(await (deps.search?.(query) ?? searchUploads(query, s.ytdlp))),
      );
    } catch (err) {
      log("warn", "scene index: source search failed", {
        game,
        error: errorMessage(err),
      });
    }
  }
  const pending = [...new Map(hits.map((h) => [h.videoId, h])).values()];
  const detailed: CutsceneUpload[] = [];
  for (let i = 0; i < 5; i++) {
    const hit = pickSource(pending, game, { ...o, maxHours: s.maxHours });
    if (!hit) break;
    pending.splice(
      pending.findIndex((p) => p.videoId === hit.videoId),
      1,
    );
    try {
      const item = await (deps.details?.(hit) ?? uploadDetails(hit, s.ytdlp));
      if (item) detailed.push(item);
    } catch (err) {
      log("warn", "scene index: source details failed", {
        videoId: hit.videoId,
        error: errorMessage(err),
      });
    }
  }
  // A launch source must prove its 1080p once its details are in: a flat search result rarely says.
  const pick = pickSource(
    o.complete ? detailed.filter((d) => (d.height ?? 0) >= 1080) : detailed,
    game,
    { ...o, maxHours: s.maxHours },
  );
  if (!pick) return undefined;
  return {
    videoId: pick.videoId,
    title: pick.title,
    uploader: pick.uploader,
    duration: pick.duration,
    ...(pick.height ? { height: pick.height } : {}),
    kind: pick.kind,
    pickedAt: (deps.now?.() ?? new Date()).toISOString(),
  };
}

/** yt-dlp arguments for the proxy: H.264 at the proxy height with the smallest sound, one mp4 (pure). */
export function proxyArgs(
  videoId: string,
  height: number,
  file: string,
): string[] {
  return [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "-f",
    `bv*[height<=${height}][vcodec^=avc1]+wa[ext=m4a]/bv*[height<=${height}]+wa/b[height<=${height}]`,
    "--merge-output-format",
    "mp4",
    "-o",
    file,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
}

async function ensureProxy(
  index: SceneIndex,
  s: BuildSettings,
): Promise<string> {
  const dir = sceneIndexDir(s.dataDir, index.game);
  const file = path.join(dir, "proxy.mp4");
  const have = await fs.stat(file).catch(() => undefined);
  if (have && have.size > 1_000_000) {
    index.proxy = {
      file: "proxy.mp4",
      height: index.proxy?.height || s.proxyHeight,
      bytes: have.size,
    };
    return file;
  }
  await fs.mkdir(dir, { recursive: true });
  log("info", "scene index: fetching the proxy", {
    game: index.game,
    videoId: index.source.videoId,
  });
  await run(s.ytdlp, proxyArgs(index.source.videoId, s.proxyHeight, file), {
    timeout: 6 * 3_600_000,
  });
  const size = (await fs.stat(file)).size;
  index.proxy = { file: "proxy.mp4", height: s.proxyHeight, bytes: size };
  return file;
}

/** yt-dlp arguments for a short low-resolution section of the source, [from, to) (pure); `format` overrides the picture-only pick. */
export function sectionArgs(videoId: string, from: number, to: number, height: number, file: string, format?: string): string[] {
  return [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "-f",
    format ?? `bv*[height<=${height}][vcodec^=avc1]/bv*[height<=${height}]/b[height<=${height}]`,
    "--download-sections",
    `*${from.toFixed(2)}-${to.toFixed(2)}`,
    "--force-keyframes-at-cuts",
    "-o",
    file,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
}

/** True when the index's proxy is on this machine. */
export async function proxyHere(dataDir: string, index: Pick<SceneIndex, "game" | "proxy">): Promise<boolean> {
  const file = path.join(sceneIndexDir(dataDir, index.game), index.proxy?.file || "proxy.mp4");
  return fs
    .stat(file)
    .then((st) => st.size > 1_000_000)
    .catch(() => false);
}

/** Seconds of the source one section fetch covers when describing without the proxy. */
export const SECTION_SECONDS = 300;

/**
 * Frames at given source times for describing (ARCHIVE_PROXY / ARCHIVE_BACKLOG): from the proxy when it is here;
 * for a light index, the storyboard frames; for a full index whose proxy was removed, five-minute low-resolution
 * sections fetched from YouTube one at a time (only the section in use is on disk).
 */
export function frameSource(
  index: SceneIndex,
  s: BuildSettings,
  work: string,
  proxy: string | undefined,
): { grab: (times: number[], tag: string) => Promise<string[]>; close: () => Promise<void> } {
  if (proxy)
    return {
      grab: async (times, tag) => {
        const out: string[] = [];
        for (const [k, time] of times.entries()) {
          const file = path.join(work, `${tag}_${k}.jpg`);
          await run(FFMPEG, frameArgs(proxy, time, file), { timeout: 60_000 });
          out.push(file);
        }
        return out;
      },
      close: async () => undefined,
    };
  if (index.tier === "light")
    return {
      grab: async (times) => {
        const { lightFrames } = await import("./light.ts");
        const map = await lightFrames(index, times, work, s.ytdlp);
        return times.flatMap((t) => (map.get(t) ? [map.get(t)!] : []));
      },
      close: async () => undefined,
    };
  let current: { from: number; file: string } | undefined;
  return {
    grab: async (times, tag) => {
      const out: string[] = [];
      for (const [k, time] of times.entries()) {
        const from = Math.floor(time / SECTION_SECONDS) * SECTION_SECONDS;
        if (current?.from !== from) {
          if (current) await fs.rm(current.file, { force: true }).catch(() => undefined);
          const file = path.join(work, `section_${from}.mp4`);
          await run(
            s.ytdlp,
            sectionArgs(index.source.videoId, from, Math.min(index.source.duration, from + SECTION_SECONDS), s.proxyHeight, file),
            { timeout: 20 * 60_000 },
          );
          current = { from, file };
        }
        const file = path.join(work, `${tag}_${k}.jpg`);
        await run(FFMPEG, frameArgs(current.file, time - from, file), { timeout: 60_000 });
        out.push(file);
      }
      return out;
    },
    close: async () => {
      if (current) await fs.rm(current.file, { force: true }).catch(() => undefined);
    },
  };
}

/**
 * ARCHIVE_PROXY=delete: a full index's proxy removed once every stretch of the source is indexed (the index keeps
 * what it was; describing and prechecks fetch short sections from YouTube instead). Returns the bytes freed.
 */
export async function releaseProxy(index: SceneIndex, s: Pick<BuildSettings, "dataDir">, now: Date): Promise<number> {
  if (!indexComplete(index) || index.tier === "light" || index.tier === "upgrading") return 0;
  const file = path.join(sceneIndexDir(s.dataDir, index.game), index.proxy?.file || "proxy.mp4");
  const st = await fs.stat(file).catch(() => undefined);
  if (!st) return 0;
  await fs.rm(file, { force: true });
  const fresh = (await loadSceneIndex(s.dataDir, index.game)) ?? index;
  fresh.proxy = { file: "proxy.mp4", height: fresh.proxy?.height ?? 0, bytes: st.size, released: now.toISOString() };
  await saveSceneIndex(s.dataDir, fresh);
  log("info", "scene index: proxy removed after indexing", { game: index.game, mb: Math.round(st.size / 1e6) });
  return st.size;
}

/** ffmpeg arguments for the cut scan of one stretch; run inside the work folder (pure). */
export function scanArgs(
  proxy: string,
  from: number,
  seconds: number,
  statsName: string,
): string[] {
  return [
    "-loglevel",
    "error",
    "-y",
    "-ss",
    from.toFixed(2),
    "-t",
    seconds.toFixed(2),
    "-i",
    proxy,
    "-vf",
    `fps=${SCAN_FPS},scale=160:-2,select='gte(scene,0)',signalstats,metadata=print:file=${statsName}`,
    "-an",
    "-f",
    "null",
    "-",
  ];
}

/** ffmpeg arguments for the frames the text reader sees: the whole picture at twice the proxy's size (pure). */
export function ocrFrameArgs(
  proxy: string,
  from: number,
  seconds: number,
  fps: number,
  pattern: string,
): string[] {
  return [
    "-loglevel",
    "error",
    "-y",
    "-ss",
    from.toFixed(2),
    "-t",
    seconds.toFixed(2),
    "-i",
    proxy,
    "-vf",
    `fps=${fps},scale=-2:960:flags=lanczos`,
    "-q:v",
    "3",
    pattern,
  ];
}

/** ffmpeg arguments for one keyframe as the vision model sees it (pure). */
export function frameArgs(proxy: string, time: number, file: string): string[] {
  return ["-loglevel", "error", "-y", "-ss", time.toFixed(2), "-i", proxy, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3", file];
}

/** ffmpeg arguments for several moments side by side in one picture, for a contact sheet (pure). */
export function stripArgs(
  proxy: string,
  times: number[],
  file: string,
): string[] {
  const inputs = times.flatMap((t) => ["-ss", t.toFixed(2), "-i", proxy]);
  const scaled = times.map((_, i) => `[${i}:v]scale=448:-2[v${i}]`).join(";");
  const graph =
    times.length > 1
      ? `${scaled};${times.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${times.length}[out]`
      : `[0:v]scale=448:-2[out]`;
  return [
    "-loglevel",
    "error",
    "-y",
    ...inputs,
    "-filter_complex",
    graph,
    "-map",
    "[out]",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    file,
  ];
}

async function ocrStretch(
  proxy: string,
  from: number,
  to: number,
  work: string,
  s: BuildSettings,
  deps: BuildDeps,
): Promise<OcrSample[]> {
  const dir = path.join(work, "ocr");
  await fs.mkdir(dir, { recursive: true });
  await run(
    FFMPEG,
    ocrFrameArgs(
      proxy,
      from,
      to - from,
      s.ocrFps,
      path.join(dir, "f_%06d.jpg"),
    ),
  );
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".jpg"))
    .sort();
  const samples: OcrSample[] = [];
  const read =
    deps.readText ?? ((list: string[]) => readText(list, { sentences: true }));
  for (let i = 0; i < files.length; i += 120) {
    const batch = files.slice(i, i + 120).map((f) => path.join(dir, f));
    const pages = await read(batch);
    batch.forEach((file, k) => {
      const page = pages.get(file);
      if (page)
        samples.push({
          time: Math.round((from + (i + k) / s.ocrFps) * 100) / 100,
          page,
        });
    });
  }
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  return samples;
}

async function hearStretch(
  proxy: string,
  from: number,
  to: number,
  work: string,
  s: BuildSettings,
  deps: BuildDeps,
): Promise<TextLine[]> {
  if (!deps.hear && !s.whisperPython) return [];
  const wav = path.join(work, "sound.wav");
  try {
    await run(FFMPEG, [
      "-loglevel",
      "error",
      "-y",
      "-ss",
      from.toFixed(2),
      "-t",
      (to - from).toFixed(2),
      "-i",
      proxy,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      wav,
    ]);
    const words = await (deps.hear?.(wav) ??
      transcribeWords(wav, s.whisperPython));
    return voiceLines(
      words.map((w) => ({ text: w.text, start: w.start, end: w.end ?? w.start + 0.3 })),
      { offset: from },
    );
  } catch (err) {
    // No sound in the proxy, or Whisper is busy: the stretch keeps the lines read off the screen.
    log("warn", "scene index: sound not transcribed", {
      from,
      error: errorMessage(err),
    });
    return [];
  } finally {
    await fs.rm(wav, { force: true }).catch(() => undefined);
  }
}

/**
 * Listens to a stretch that is already indexed and merges what was said into its lines (a stretch first indexed
 * while Whisper was busy or not installed). The shots and the lines read off the screen stay as they are.
 */
export async function hearInto(
  index: SceneIndex,
  s: BuildSettings,
  stretch: { from: number; to: number },
  deps: BuildDeps = {},
): Promise<{ index: SceneIndex; heard: number }> {
  const dir = sceneIndexDir(s.dataDir, index.game);
  const work = await fs.mkdtemp(path.join(dir, "hear_"));
  try {
    // A removed proxy: the stretch alone is fetched from YouTube (small picture, its sound), times shifted back.
    const released = !!index.proxy?.released && !(await proxyHere(s.dataDir, index));
    let heard: TextLine[];
    if (released) {
      const file = path.join(work, "stretch.mp4");
      await run(s.ytdlp, sectionArgs(index.source.videoId, stretch.from, stretch.to, 360, file, "bv*[height<=360]+wa/b"), {
        timeout: 30 * 60_000,
      });
      heard = (await hearStretch(file, 0, stretch.to - stretch.from, work, s, deps)).map((l) => ({
        ...l,
        start: l.start + stretch.from,
        end: l.end + stretch.from,
        ...(l.words ? { words: l.words.map((w) => ({ ...w, start: w.start + stretch.from, end: w.end + stretch.from })) } : {}),
      }));
    } else heard = await hearStretch(await ensureProxy(index, s), stretch.from, stretch.to, work, s, deps);
    const base = (await loadSceneIndex(s.dataDir, index.game)) ?? index;
    const inside = (t: number) => t >= stretch.from && t < stretch.to;
    const read = base.lines
      .filter((l) => inside(l.start) && l.via !== "voice")
      .map(({ id: _id, shot: _shot, words: _words, ...l }) => ({ ...l, via: "textbox" as const }));
    const next = tidyIndex(
      mergeStretch(
        base,
        stretch,
        base.shots.filter((x) => inside(x.start)).map(({ id: _id, ...x }) => x),
        mergeDialogue(read, heard),
      ),
    );
    await saveSceneIndex(s.dataDir, next);
    return { index: next, heard: heard.length };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface BuildResult {
  index?: SceneIndex;
  /** What this call did: "source" (none found), "stretch", "described", "done" or "waiting" (vision not reachable). */
  did: "no-source" | "stretch" | "described" | "done" | "waiting";
  detail?: Record<string, unknown>;
}

/** Shots that are pictures (not fades or menus) and have not been looked at yet. */
export function undescribed(index: SceneIndex): SceneShot[] {
  return index.shots.filter((s) => !s.blank && !s.menu && !s.desc);
}

/** True when every stretch is indexed and every shot that can be described has been. */
export function sceneIndexReady(index: SceneIndex): boolean {
  return indexComplete(index) && undescribed(index).length === 0;
}

/**
 * Indexes one stretch of the source: cuts, text on screen, sound. `stretch` defaults to the first gap in the
 * coverage. Returns the index with the stretch merged in (saved).
 */
export async function indexStretch(
  index: SceneIndex,
  s: BuildSettings,
  stretch: { from: number; to: number },
  deps: BuildDeps = {},
): Promise<SceneIndex> {
  const proxy = await ensureProxy(index, s);
  const dir = sceneIndexDir(s.dataDir, index.game);
  const work = await fs.mkdtemp(path.join(dir, "work_"));
  try {
    const from = Math.max(0, stretch.from);
    const to = Math.min(index.source.duration, stretch.to);
    await run(FFMPEG, scanArgs(proxy, from, to - from, "scan.txt"), {
      cwd: work,
    });
    const rows = parseSignalStats(
      await fs.readFile(path.join(work, "scan.txt"), "utf8"),
    ).map((r) => ({
      ...r,
      time: r.time + from,
    }));
    const spans = shotsFromScan(rows, from, to);
    const samples = await ocrStretch(proxy, from, to, work, s, deps);
    const read = textBoxLines(samples, { step: 1 / s.ocrFps });
    const heard = await hearStretch(proxy, from, to, work, s, deps);
    const lines = mergeDialogue(read, heard);
    const shots = spans.map((sp) => ({
      start: sp.start,
      end: sp.end,
      keyframes: keyframeTimes(sp.start, sp.end),
      desc: "",
      who: [] as string[],
      where: "",
      mood: "",
      tags: [] as string[],
      text: shotText(
        samples.filter((x) => x.time >= sp.start && x.time < sp.end),
      ),
      luma: sp.luma,
      motion: sp.motion,
      ...(sp.blank ? { blank: true } : {}),
    }));
    // Read again just before writing: another pass (describing shots) may have saved while this one worked.
    const base = (await loadSceneIndex(s.dataDir, index.game)) ?? index;
    const next = tidyIndex(
      mergeStretch(
        {
          ...base,
          proxy: index.proxy ?? base.proxy,
          cast: base.cast,
        },
        { from, to },
        shots,
        lines,
      ),
    );
    next.builtAt = (deps.now?.() ?? new Date()).toISOString();
    await saveSceneIndex(s.dataDir, next);
    log("info", "scene index: stretch indexed", {
      game: index.game,
      from,
      to,
      shots: shots.length,
      read: read.length,
      heard: heard.length,
    });
    return next;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Looks at up to `limit` undescribed shots with the local vision model and stores what it saw. Stops quietly when
 * the model stops answering (three failures in a row): the rest wait for the next pass.
 */
export async function describeShots(
  index: SceneIndex,
  s: BuildSettings,
  limit: number,
  deps: BuildDeps = {},
  o: { from?: number; to?: number; concurrency?: number } = {},
): Promise<{ index: SceneIndex; described: number; failed: number }> {
  // SCENE_INDEX_DESCRIBE=false (12 Nov 2026, orchestrator): no bulk looking on the PC model while it is needed for
  // renders; single picture checks elsewhere still run. Lookups keep working on names, lines and on-screen text.
  if (process.env.SCENE_INDEX_DESCRIBE === "false") return { index, described: 0, failed: 0 };
  const todo = undescribed(index)
    .filter(
      (shot) => shot.start >= (o.from ?? 0) && shot.start < (o.to ?? Infinity),
    )
    .slice(0, limit);
  if (!todo.length) return { index, described: 0, failed: 0 };
  // The proxy when it is here or still to be fetched; a light index or a removed proxy reads frames elsewhere.
  const released = index.tier === "light" || (!!index.proxy?.released && !(await proxyHere(s.dataDir, index)));
  const proxy = released ? undefined : await ensureProxy(index, s);
  const dir = sceneIndexDir(s.dataDir, index.game);
  const work = await fs.mkdtemp(path.join(dir, "look_"));
  const frameGrab = frameSource(index, s, work, proxy);
  const look = deps.look ?? lookAtShot;
  const cast = groundedCast(index);
  // What was seen is written onto the index as it is on disk now, shot by shot: a stretch indexed meanwhile by
  // another pass is kept, not overwritten with this pass's older copy.
  const persist = async (): Promise<SceneIndex> => {
    const fresh = (await loadSceneIndex(s.dataDir, index.game)) ?? index;
    const at = (x: { start: number; end: number }) =>
      `${x.start.toFixed(2)}|${x.end.toFixed(2)}`;
    const mine = new Map(todo.filter((t) => t.desc).map((t) => [at(t), t]));
    for (const shot of fresh.shots) {
      const t = mine.get(at(shot));
      if (!t) continue;
      shot.desc = t.desc;
      shot.who = t.who;
      shot.where = t.where;
      shot.mood = t.mood;
      shot.tags = t.tags;
      if (t.menu) shot.menu = true;
    }
    fresh.proxy = index.proxy ?? fresh.proxy;
    fresh.builtAt = (deps.now?.() ?? new Date()).toISOString();
    const tidy = tidyIndex(fresh);
    await saveSceneIndex(s.dataDir, tidy);
    return tidy;
  };
  let described = 0;
  let failed = 0;
  let streak = 0;
  let next = 0;
  let sinceSave = 0;
  const worker = async () => {
    while (next < todo.length && streak < 3) {
      const shot = todo[next++]!;
      const frames: string[] = [];
      try {
        const times = shot.keyframes.length
          ? shot.keyframes
          : keyframeTimes(shot.start, shot.end);
        frames.push(...(await frameGrab.grab(times, `s_${shot.id}`)));
        if (!frames.length) throw new Error("no frames for the shot");
        const dialogue = index.lines
          .filter((l) => l.start < shot.end && l.end > shot.start)
          .map((l) => `${l.speaker ? `${l.speaker}: ` : ""}${l.text}`);
        const seen: ShotLook | undefined = await look(frames, {
          game: index.game,
          cast,
          places: index.places,
          dialogue,
          text: shot.text,
          frames: times.length,
        });
        streak = 0;
        if (!seen) {
          // Looked at, nothing usable said: do not ask again every pass.
          shot.desc = "-";
          failed++;
        } else {
          shot.desc = seen.desc;
          shot.who = seen.who;
          shot.where = seen.where;
          shot.mood = seen.mood;
          shot.tags = seen.tags;
          if (seen.menu) shot.menu = true;
          described++;
        }
        if (++sinceSave >= 40) {
          sinceSave = 0;
          await persist();
        }
      } catch (err) {
        streak++;
        failed++;
        if (streak === 3)
          log(
            "warn",
            "scene index: vision model not answering; shots wait for the next pass",
            {
              error: errorMessage(err),
            },
          );
      } finally {
        for (const file of frames) await fs.rm(file, { force: true }).catch(() => undefined);
      }
    }
  };
  try {
    // Without the proxy, sections are fetched in order by a single worker.
    await Promise.all(
      Array.from({ length: proxy ? Math.min(o.concurrency ?? 2, todo.length) : 1 }, worker),
    );
  } finally {
    await frameGrab.close();
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
  return { index: await persist(), described, failed };
}

/**
 * One bounded piece of work on a game's index, in order: choose the source and fetch the names, index the next
 * stretch, describe a batch of shots. Call it again until it answers "done". A better source found on a later
 * search (a movie where there was a playthrough) starts the index again; nothing else does.
 */
export async function buildStep(
  game: string,
  s: BuildSettings,
  o: {
    recentRelease?: boolean;
    describeBatch?: number;
    refreshSource?: boolean;
    /** GAME_FETCH: the most complete clean upload, replaced by a clearly longer one on a later search. */
    complete?: boolean;
    /** GAME_FETCH: the release day; uploads from before it are marketing, not the game. */
    releasedOn?: string;
    /** ARCHIVE_PROXY=delete: remove the proxy once every stretch is indexed. */
    releaseProxy?: boolean;
  } = {},
  deps: BuildDeps = {},
): Promise<BuildResult> {
  let index = await loadSceneIndex(s.dataDir, game);
  if (!index || o.refreshSource) {
    const source = await chooseSource(game, s, o, deps);
    if (!source && !index) return { did: "no-source" };
    const better = o.complete ? moreCompleteSource : betterSource;
    if (source && (!index || better(index.source, source))) {
      if (index) {
        log("info", "scene index: a better source replaces the old one", {
          game,
          from: index.source.videoId,
          to: source.videoId,
        });
        await fs
          .rm(path.join(sceneIndexDir(s.dataDir, game), "proxy.mp4"), {
            force: true,
          })
          .catch(() => undefined);
      }
      index = emptySceneIndex(game, source, deps.now?.() ?? new Date());
      const names = await (deps.names ?? gameNames)(game).catch(() => ({
        cast: [],
        places: [],
      }));
      index.cast = names.cast;
      index.places = names.places;
      await saveSceneIndex(s.dataDir, index);
    }
  }
  if (!index) return { did: "no-source" };
  // A light index asked to build is upgraded to the full one on the same upload, stretch by stretch: each stretch's
  // light shots and caption lines are replaced as it is indexed, so lookups keep working meanwhile.
  if (index.tier === "light") {
    index = { ...index, tier: "upgrading", coverage: [] };
    await saveSceneIndex(s.dataDir, index);
  }
  const gap = nextGap(index, s.chunkSeconds);
  if (gap) {
    index = await indexStretch(index, s, gap, deps);
    return { index, did: "stretch", detail: gap };
  }
  if (index.tier === "upgrading") {
    index = { ...((await loadSceneIndex(s.dataDir, index.game)) ?? index), tier: "full" };
    await saveSceneIndex(s.dataDir, index);
  }
  if (o.releaseProxy && (await releaseProxy(index, s, deps.now?.() ?? new Date())))
    index = (await loadSceneIndex(s.dataDir, index.game)) ?? index;
  if (undescribed(index).length) {
    if (!(await (deps.visionUp ?? visionUp)()))
      return { index, did: "waiting" };
    const r = await describeShots(index, s, o.describeBatch ?? 300, deps);
    return {
      index: r.index,
      did: r.described ? "described" : "waiting",
      detail: { described: r.described, failed: r.failed },
    };
  }
  return { index, did: "done" };
}
