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
import { downloadSectionRetrying, streamRefused } from "../lib/ytsection.ts";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import {
  cleanFrameReason,
  cropClipInPlace,
  cutsceneDownloadArgs,
  overlayCornerCrop,
  screenFramesOf,
  type CutsceneClip,
  type FrameCrop,
} from "../assets/cutscenes.ts";
import {
  CLIP_SECONDS,
  DARK_LUMA,
  darkestLuma,
  MIN_CLIP_SECONDS,
  type FootageTarget,
} from "../assets/clipscore.ts";
import { clipBigText, clipOverlayText } from "../assets/cliptext.ts";
import { checkClip, hasSubjectFallback, lookSubject, namedSubjects, SUBJECT_CONFIDENCE, type SubjectAsk } from "../assets/scenecheck.ts";
import { rejectReason, screenFrames, subjectFrames, type FrameFlags, type SubjectLook } from "../assets/localvision.ts";
import type { VisualAsset } from "../assets/steam.ts";
import { brollShotAtPlace, findQuote, findShots, shotAtPlace } from "./lookup.ts";
import { loadSceneIndex, sceneSlug, type SceneIndex, type SceneShot } from "./schema.ts";
import { requestSceneIndex } from "./job.ts";
import { sectionArgs } from "./build.ts";
import {
  footageAllowed,
  LONG_SPOILER_FREE_SECONDS,
  spoilerWindows,
  windowFor,
  type SpoilerWindow,
} from "./spoilers.ts";
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
  /** SCENE_MATCH: the names the line asks to see; the clip is used only once the picture check sees them. */
  names?: string[];
  /** SCENE_MATCH: the next best shots for the same line, tried in order when the picture check refuses this one. */
  alternates?: PlannedClip[];
}

/**
 * The longest part of a shot with no dialogue written over the picture (pure): the shot minus the time each line
 * read off the screen is up (a box stays about a second after its last word). Undefined when no part is at least
 * `min` seconds long; the whole shot when nothing is written during it.
 */
export function clearStretch(
  index: Pick<SceneIndex, "lines">,
  shot: { start: number; end: number; written?: Array<{ from: number; to: number }> },
  min: number,
): { start: number; end: number } | undefined {
  const boxes = index.lines
    .filter((l) => l.via !== "voice" && l.start < shot.end && l.end + 1 > shot.start)
    .map((l) => ({ from: l.start - 0.3, to: l.end + 1 }))
    .concat((shot.written ?? []).map((w) => ({ from: w.from - 0.5, to: w.to + 0.5 })))
    .sort((a, b) => a.from - b.from);
  let best: { start: number; end: number } | undefined;
  let at = shot.start;
  for (const b of [...boxes, { from: shot.end, to: shot.end }]) {
    const end = Math.min(shot.end, b.from);
    if (end - at >= min && (!best || end - at > best.end - best.start)) best = { start: at, end };
    at = Math.max(at, b.to);
  }
  return best;
}

/**
 * SCENE_MATCH: a line that names a moment is offered shots from this confidence up. The words only point; the picture
 * check decides, so the courtyard window (said "Take a look through this window") is not lost below the usual bar.
 */
export const NAMED_MIN_CONFIDENCE = 0.25;

/** Every name the index knows (pure): its cast and places, the people it saw in shots and the speakers it heard. */
export function knownNames(index: Pick<SceneIndex, "cast" | "places" | "shots" | "lines">): string[] {
  return [
    ...new Set([
      ...index.cast,
      ...index.places,
      ...index.shots.flatMap((s) => s.who),
      ...index.lines.flatMap((l) => (l.speaker && !l.speakerGuessed ? [l.speaker] : [])),
    ]),
  ].filter((n) => n && !/^narrator$/i.test(n));
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
    /** SPOILER_GUARD: whether a shot may be used for a line (src/sceneindex/spoilers.ts); unset: every shot. */
    allow?: (shot: SceneShot, key: string) => boolean;
    /** SCENE_MATCH: for a line that names someone or somewhere, this many next-best shots ride along as alternates. */
    alternates?: number;
    gameTitle?: string;
  },
): PlannedClip[] {
  const clipSeconds = o.clipSeconds ?? CLIP_SECONDS;
  const out: PlannedClip[] = [];
  let total = 0;
  const free = (from: number) => out.every((c) => Math.abs(c.from - from) >= 3);
  const known = o.alternates ? knownNames(index) : [];
  for (const t of targets) {
    const names = o.alternates ? namedSubjects(t, known, o.gameTitle ?? index.game) : [];
    const extra = names.length ? (o.alternates ?? 0) : 0;
    let picked: PlannedClip | undefined;
    if (out.length >= o.maxClips || o.maxSeconds - total < MIN_CLIP_SECONDS)
      break;
    const candidates: Array<{
      shot: number;
      confidence: number;
      quote?: string;
    }> = [];
    // A retrospective's story line looks only inside its act (FootageTarget.within), a little slack either side.
    const within = t.within
      ? { from: t.within.from - 2, to: t.within.to + 2 }
      : undefined;
    const insideAct = (shot: number) => {
      const s = index.shots[shot];
      return !within || Boolean(s && s.start >= within.from && s.end <= within.to);
    };
    for (const q of quotedWords(t.text)) {
      const hit = findQuote(index, q, { max: 1, minConfidence: 0.8 })[0];
      if (hit && insideAct(hit.shot))
        candidates.push({
          shot: hit.shot,
          confidence: hit.confidence,
          quote: hit.text,
        });
    }
    for (const h of findShots(index, t, {
      max: 4 + extra * 2,
      minConfidence: extra ? Math.min(o.minConfidence, NAMED_MIN_CONFIDENCE) : o.minConfidence,
      minSeconds: MIN_CLIP_SECONDS + 0.3,
      ...(within ? { within } : {}),
    }))
      candidates.push({ shot: h.shot, confidence: h.confidence });
    // Nothing in the act matched by name or words: the act's own scene at the line's place in the chapter (a chapter
    // about the game rather than its story takes the liveliest shot near that place: brollShotAtPlace).
    if (t.within) {
      const at = (t.within.broll ? brollShotAtPlace : shotAtPlace)(index, t.within, MIN_CLIP_SECONDS + 0.3);
      if (at !== undefined && !candidates.some((c) => c.shot === at))
        candidates.push({ shot: at, confidence: 0.3 });
    }
    for (const c of candidates) {
      const shot = index.shots[c.shot];
      if (!shot || shot.blank || shot.menu || (o.allow && !o.allow(shot, t.key))) continue;
      // A quoted line is shown while it is on screen; any other line gets the part of its shot with no words
      // over the picture when there is one (the clean-frame screen drops a clip with subtitles across it).
      const span = c.quote
        ? { start: shot.start, end: shot.end }
        : (clearStretch(index, shot, MIN_CLIP_SECONDS + 0.3) ?? { start: shot.start, end: shot.end });
      const from = Math.round((span.start + 0.1) * 100) / 100;
      const seconds =
        Math.round(
          Math.min(clipSeconds, span.end - from - 0.1, o.maxSeconds - total) *
            30,
        ) / 30;
      if (seconds < MIN_CLIP_SECONDS || !free(from)) continue;
      const clip: PlannedClip = {
        key: t.key,
        shot: shot.id,
        from,
        seconds,
        confidence: c.confidence,
        label: (shot.desc || shot.who.join(", ") || shot.text).slice(0, 80),
        ...(c.quote ? { quote: c.quote } : {}),
        ...(names.length ? { names } : {}),
      };
      if (!picked) {
        picked = clip;
        out.push(clip);
        total += seconds;
        if (!extra) break;
        continue;
      }
      // An alternate replaces the pick, so it never runs longer than the seconds the pick was given.
      if (picked.alternates?.some((a) => a.shot === clip.shot || Math.abs(a.from - clip.from) < 3) || clip.shot === picked.shot) continue;
      const s = Math.min(clip.seconds, picked.seconds);
      if (s < MIN_CLIP_SECONDS) continue;
      (picked.alternates ??= []).push({ ...clip, seconds: s });
      if (picked.alternates.length >= extra) break;
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
  /**
   * LONG_INWORLD_TEXT (long videos): the text check refuses only writing that is not from the game (a channel mark,
   * a link, the uploader's name, a caption fixed at the edge); the game's own signs, HUD and subtitles pass.
   */
  inWorldText?: boolean;
  /** LONG_WATERMARK_CROP (long videos): a clip with one small corner mark is cut again cropped clear of it. */
  watermarkCropKeep?: number;
  /** SPOILER_GUARD: whether a shot may be used for a line. */
  allow?: (shot: SceneShot, key: string) => boolean;
  /**
   * SCENE_MATCH: a line that names someone or somewhere gets its clip only once this picture check sees them in it
   * (src/assets/scenecheck.ts checkClip on the local model); refused, the next best shot is tried, then the search.
   */
  check?: (file: string, seconds: number, ask: SubjectAsk) => Promise<boolean | "unchecked">;
  /** SCENE_MATCH: how many next-best shots a named line may try after its first. */
  alternates?: number;
  /**
   * SCENE_MATCH: a cheap first look at a shot on the index's own low-resolution proxy, before anything is downloaded;
   * a shot it refuses is skipped (the clip itself is still checked after the cut). Unset: every shot is fetched.
   */
  precheck?: (from: number, seconds: number, ask: SubjectAsk) => Promise<boolean>;
  /**
   * SCENE_MATCH_UNCHECKED: a named moment nobody could check (the local model down, Codex not answering) is kept at
   * the index's matched time as a lower-confidence pick: said so in its reason, never locked to its line.
   */
  uncheckedOk?: boolean;
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
    /** True (or a verdict) when the finished clip may be used (no overlay, not blank, not dark). */
    screen?: (file: string, seconds: number) => Promise<boolean | ScreenVerdict>;
    /** Crops a cut clip in place (LONG_WATERMARK_CROP). */
    crop?: (file: string, crop: FrameCrop) => Promise<void>;
  };
}

async function download(
  videoId: string,
  from: number,
  to: number,
  file: string,
  ytdlp: string,
): Promise<void> {
  // A 403 on the stream link is tried again with fresh formats, then another format (src/lib/ytsection.ts).
  await downloadSectionRetrying(
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

/** How a cut clip fared on the screen: kept, or refused with the crop that might save it (LONG_WATERMARK_CROP). */
export interface ScreenVerdict {
  ok: boolean;
  why?: string;
  crop?: FrameCrop;
}

async function screen(
  file: string,
  seconds: number,
  o: { textCheck: boolean; inWorldText?: boolean; uploader?: string; cropKeep?: number },
): Promise<ScreenVerdict> {
  const frames = await screenFramesOf(file, seconds);
  const reason = cleanFrameReason(frames);
  if (reason) {
    const crop = reason === "persistent corner overlay" && o.cropKeep ? overlayCornerCrop(frames, o.cropKeep) : undefined;
    return { ok: false, why: reason, ...(crop ? { crop } : {}) };
  }
  const darkest = await darkestLuma(file);
  if (darkest !== undefined && darkest < DARK_LUMA) return { ok: false, why: "dark" };
  if (o.textCheck) {
    const read = o.inWorldText ? await clipOverlayText(file, seconds, { uploader: o.uploader }) : await clipBigText(file, seconds);
    if (!read.clean) return { ok: false, why: `text: ${read.words.slice(0, 4).join(" ")}` };
  }
  return { ok: true };
}

/** A screen given as a plain yes or no (tests, older callers) as a verdict. */
const verdictOf = (v: boolean | ScreenVerdict): ScreenVerdict => (typeof v === "boolean" ? { ok: v } : v);

/**
 * Cutscene clips for the lines the index knows the exact shot of, in target order, each tagged with its line.
 * Returns nothing when the index has no confident shot for any line; a failed download or a clip that does not
 * pass the screen is simply left out (the caller's ordinary cutscene search covers what is missing).
 */
export async function indexedCutsceneClips(
  o: IndexedOptions,
): Promise<CutsceneClip[]> {
  const plan = planIndexedClips(o.index, o.targets, {
    ...o,
    alternates: o.check ? (o.alternates ?? 5) : undefined,
    gameTitle: o.gameTitle,
  });
  if (!plan.length) return [];
  const src = o.index.source;
  const url = `https://www.youtube.com/watch?v=${src.videoId}`;
  const assets = path.join(o.episodeDir, "assets");
  await fs.mkdir(assets, { recursive: true });
  const work = await fs.mkdtemp(path.join(o.episodeDir, "sceneindex_work_"));
  const out: CutsceneClip[] = [];
  try {
    let n = 0;
    // The index's upload refused on every retry, twice: the rest of the lines go to the next upload (the search).
    let refused = 0;
    const lineOf = new Map(o.targets.map((t) => [t.key, t.text]));
    for (const first of plan) {
      if (refused >= 2) break;
      let p: PlannedClip | undefined;
      let rel = "";
      let confirmed = false;
      let unchecked = false;
      let cropped: FrameCrop | undefined;
      for (const c of [first, ...(first.alternates ?? [])]) {
        const i = n++;
        const section = path.join(work, `section_${i}.mp4`);
        const lead = Math.min(2, c.from);
        rel = path.join(
          "assets",
          `sceneindex_${path.basename(work).slice(-6)}_${i}.mp4`,
        );
        const file = path.join(o.episodeDir, rel);
        const ask = { game: o.gameTitle, line: lineOf.get(c.key) ?? c.label, names: c.names ?? [] };
        if (o.check && o.precheck && c.names?.length && !(await o.precheck(c.from, c.seconds, ask).catch(() => true))) {
          log("info", "scene index: named moment not on the proxy, next shot", { game: o.gameTitle, key: c.key, at: c.from });
          continue;
        }
        try {
          await (
            o.deps?.download ?? ((id, a, b, f) => download(id, a, b, f, o.ytdlp))
          )(
            src.videoId,
            Math.round((c.from - lead) * 100) / 100,
            Math.round(Math.min(src.duration, c.from + c.seconds + 2) * 100) / 100,
            section,
          );
          await (o.deps?.cut ?? cut)(section, lead, c.seconds, file);
          const screenOf = (f: string, n: number) =>
            (o.deps?.screen ?? ((x: string, y: number) => screen(x, y, { textCheck: o.textCheck !== false, inWorldText: o.inWorldText, uploader: src.uploader, cropKeep: o.watermarkCropKeep })))(f, n);
          let verdict = verdictOf(await screenOf(file, c.seconds));
          cropped = undefined;
          // LONG_WATERMARK_CROP: one small corner mark is cropped away and the clip screened once more.
          if (!verdict.ok && verdict.crop && o.watermarkCropKeep) {
            const crop = verdict.crop;
            await (o.deps?.crop ?? cropClipInPlace)(file, crop);
            verdict = verdictOf(await screenOf(file, c.seconds));
            if (verdict.ok) cropped = crop;
            log("info", verdict.ok ? "scene index: corner mark cropped away" : "scene index: cropped, still screened out", {
              game: o.gameTitle,
              at: c.from,
              corner: crop.corner,
              keeps: crop.keeps,
              ...(verdict.ok ? {} : { why: verdict.why }),
            });
          }
          if (!verdict.ok) {
            await fs.rm(file, { force: true }).catch(() => undefined);
            log("info", "scene index: clip screened out", {
              game: o.gameTitle,
              at: c.from,
              why: verdict.why,
            });
            continue;
          }
          // SCENE_MATCH: the named moment must be seen in the clip itself, or the next best shot is tried.
          unchecked = false;
          if (o.check && c.names?.length) {
            const ok = await o.check(file, c.seconds, ask).catch(() => false as const);
            if (ok === "unchecked" && o.uncheckedOk) {
              unchecked = true;
              log("info", "scene index: named moment kept unchecked (no picture check answered)", {
                game: o.gameTitle,
                key: c.key,
                names: c.names,
                at: c.from,
              });
            } else if (ok !== true) {
              await fs.rm(file, { force: true }).catch(() => undefined);
              log("info", "scene index: named moment not seen, next shot", {
                game: o.gameTitle,
                key: c.key,
                names: c.names,
                at: c.from,
              });
              continue;
            } else confirmed = true;
          }
        } catch (err) {
          if (streamRefused(err)) refused++;
          log("warn", "scene index: clip not fetched", {
            game: o.gameTitle,
            at: c.from,
            error: errorMessage(err),
          });
          await fs.rm(file, { force: true }).catch(() => undefined);
          if (refused >= 2) break;
          continue;
        } finally {
          await fs.rm(section, { force: true }).catch(() => undefined);
        }
        p = c;
        break;
      }
      if (!p) continue;
      const lead = Math.min(2, p.from);
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
        reason: `scene index: ${p.quote ? `the line "${p.quote.slice(0, 60)}"` : p.label} (confidence ${p.confidence}${confirmed ? `, ${p.names!.join(", ")} seen by the picture check` : ""}${unchecked ? `, unchecked: lower confidence, no picture check answered for ${p.names!.join(", ")}` : ""})`,
        provenance: `Cutscenes for "${label(o.gameTitle)}" from YouTube video "${label(src.title)}" by ${label(src.uploader)}, video ID: ${src.videoId}${o.publisher ? `, publisher: ${o.publisher}` : ""} (${url}), ${p.seconds}s, section start: ${(p.from - lead).toFixed(2)}s, source time: ${p.from.toFixed(2)}s, muted${cropped ? `, cropped clear of a ${cropped.corner} corner mark (${Math.round(cropped.keeps * 100)}% of the picture kept)` : ""}; chosen for ${p.key} by the scene index (${p.label})`,
        audio: false,
        credit: `FOOTAGE: ${o.gameTitle.toUpperCase()} CUTSCENES / YOUTUBE`,
        youtubeSource: {
          videoId: src.videoId,
          title: src.title,
          uploader: src.uploader,
        },
        span: { source: url, from: p.from, to: p.from + p.seconds },
        // A confirmed named moment is that line's alone: the planner never lends it to another line.
        ...(confirmed ? { cutsceneMatch: { targetKey: p.key, how: "index" as const } } : {}),
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

/** True when a game has a scene index here that fits the release a video is about (LONG_INDEX_FIRST). */
export async function hasUsableIndex(dataDir: string, game: string, recentRelease?: boolean): Promise<boolean> {
  const index = await findIndex(dataDir, game).catch(() => undefined);
  return Boolean(index && indexFitsRelease(index, recentRelease));
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
 * SCENE_MATCH: the picture check run on the index's low-resolution proxy (when it is on this machine): the same three
 * frames the clip would be judged on, cut from the proxy at the shot's time. Undefined when there is no proxy here.
 */
export async function proxyPrecheck(
  dataDir: string,
  index: SceneIndex,
  workDir: string,
  /** ARCHIVE_SECTIONS: with no proxy here, the shot's seconds are fetched small from YouTube instead. */
  sectionsVia?: string,
  /**
   * The local model could not look (the relay is down): pass the shot on to the check after the cut, which a fallback
   * (SCENE_MATCH_CODEX) or SCENE_MATCH_UNCHECKED may settle, instead of refusing it unseen. Off: refused as before.
   */
  passWhenDown = false,
): Promise<IndexedOptions["precheck"]> {
  const proxy = path.join(dataDir, "sceneindex", index.slug || sceneSlug(index.game), index.proxy?.file || "proxy.mp4");
  const here = await fs.stat(proxy).then((s) => s.size > 0).catch(() => false);
  if (!here && !sectionsVia) return undefined;
  return async (from, seconds, ask) => {
    const dir = await fs.mkdtemp(path.join(workDir, "scenematch_"));
    try {
      // Without the proxy: the shot's own seconds at 360p (a few hundred kilobytes), its times from zero.
      let video = proxy;
      let offset = from;
      if (!here) {
        video = path.join(dir, "section.mp4");
        await downloadSectionRetrying(sectionsVia!, sectionArgs(index.source.videoId, from, from + seconds, 360, video), {
          timeout: 300_000,
          maxBuffer: 8 * 1024 * 1024,
        });
        offset = 0;
      }
      const r = await checkClip(video, seconds, ask, {
        // The cheap first look is the local model's alone: a fallback looks once, at the cut clip.
        look: subjectFrames,
        // The frames go to this run's own folder, never beside the index.
        grab: async (_f, times) => {
          const out: string[] = [];
          for (const [i, t] of times.entries()) {
            const jpg = path.join(dir, `proxy_${i}.jpg`);
            await runCapped(FFMPEG, ["-v", "error", "-y", "-ss", (offset + t).toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", jpg], {
              timeout: 60_000,
              maxBuffer: 1024 * 1024,
            });
            out.push(jpg);
          }
          return out;
        },
      });
      return r.ok || (passWhenDown && Boolean(r.unchecked));
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

/** The key a cutscene clip was fetched for, as the targets name it ("hook", "beat:3"). */
function clipKey(c: CutsceneClip): string {
  return c.role === "hook" ? "hook" : c.beatIndex === undefined ? "" : `beat:${c.beatIndex}`;
}

/**
 * Whether a moment may fill a line during a game's spoiler window (pure): the hook is a first frame; in a long
 * video the hook and the first beat are its first minute; everything else follows footageAllowed.
 */
export function spoilerAllow(
  w: SpoilerWindow,
  o: { long?: boolean; spoilerWarned?: boolean },
  now: Date,
): (index: SceneIndex, at: number, key: string) => boolean {
  return (index, at, key) => {
    const first = key === "hook" || /^beat:0(?!\d)/.test(key);
    return footageAllowed(w, index, at, key === "hook" ? "first-frame" : o.long ? "long" : "short", now, {
      warned: o.spoilerWarned,
      placedAt: first ? 0 : LONG_SPOILER_FREE_SECONDS,
    }).ok;
  };
}

/**
 * fetchCutscenes with the scene index in front (src/services.ts). SCENE_INDEX off: exactly the search. On: a game
 * with a usable index gets its exact shots first; a game without one is queued for indexing and gets the search.
 * SPOILER_GUARD, during a game's spoiler window: indexed shots only where the story position allows them, and the
 * ordinary search keeps only moments of the index's own upload that the index places where they are allowed (a
 * search clip the index cannot place could be from anywhere in the story: it is dropped).
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
    /** A long video (late-story footage may follow its spoiler warning) and whether it opens with one. */
    long?: boolean;
    spoilerWarned?: boolean;
  },
>(
  cfg: Pick<Config, "sceneIndex" | "sceneIndexMinConfidence" | "dataDir" | "ytdlpPath"> &
    Partial<
      Pick<Config, "spoilerGuard" | "sceneMatch" | "sceneMatchUnchecked" | "archiveSections" | "longInWorldText" | "longWatermarkCrop" | "longWatermarkCropKeep">
    >,
  options: O,
  search: (o: O) => Promise<CutsceneClip[]>,
  deps?: IndexedOptions["deps"],
  now = new Date(),
  windows: readonly SpoilerWindow[] = spoilerWindows(),
): Promise<CutsceneClip[]> {
  const w = cfg.spoilerGuard ? windowFor(windows, options.gameTitle, now) : undefined;
  const allow = w ? spoilerAllow(w, options, now) : undefined;
  const known = w ? await findIndex(cfg.dataDir, options.gameTitle) : undefined;
  const searched = allow
    ? async (o: O) =>
        (await search(o)).filter((c) => {
          const ok = Boolean(
            known &&
              c.youtubeSource?.videoId === known.source.videoId &&
              allow(known, c.span.from, clipKey(c)) &&
              allow(known, Math.max(c.span.from, c.span.to - 0.05), clipKey(c)),
          );
          if (!ok)
            log("info", "spoiler guard: cutscene clip left out", {
              game: o.gameTitle,
              video: c.youtubeSource?.videoId,
              at: c.span.from,
            });
          return ok;
        })
    : search;
  if (!cfg.sceneIndex) return searched(options);
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
        // A long video shows the whole picture: the game's own writing stays, and a small corner mark can be cropped.
        ...(o.long && cfg.longInWorldText ? { inWorldText: true } : {}),
        ...(o.long && cfg.longWatermarkCrop ? { watermarkCropKeep: cfg.longWatermarkCropKeep ?? 0.78 } : {}),
        // SCENE_MATCH: a named moment is used only once the free local vision model sees it in the clip.
        ...(cfg.sceneMatch
          ? {
              check: async (file: string, seconds: number, ask: SubjectAsk) => {
                const r = await checkClip(file, seconds, ask);
                return r.ok ? true : r.unchecked ? ("unchecked" as const) : false;
              },
              precheck: await proxyPrecheck(
                cfg.dataDir,
                index,
                o.episodeDir,
                cfg.archiveSections ? cfg.ytdlpPath : undefined,
                hasSubjectFallback() || Boolean(cfg.sceneMatchUnchecked),
              ),
              ...(cfg.sceneMatchUnchecked ? { uncheckedOk: true } : {}),
            }
          : {}),
        ...(allow
          ? {
              allow: (shot: SceneShot, key: string) =>
                allow(index, shot.start, key) && allow(index, Math.max(shot.start, shot.end - 0.05), key),
            }
          : {}),
        deps,
      });
    },
    searched,
  );
}
/** SCENE_MATCH stills: a still is one frame, checked on its own (the frame on the word is the whole picture). */
export function stillConfirmed(
  look: SubjectLook | undefined,
  flags: FrameFlags | undefined,
): boolean {
  if (!look?.shows || look.confidence < SUBJECT_CONFIDENCE) return false;
  // The game's own small HUD is fine; anything else the screen rejects (text across it, dark, blurred) is not.
  return !flags || !rejectReason(flags);
}

/** The earliest of a line's names as it is spoken (pure): the words a still is placed on. */
export function firstSpoken(
  text: string,
  names: readonly string[],
): string | undefined {
  const low = ` ${text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ")} `;
  let best: { at: number; name: string } | undefined;
  for (const n of names) {
    const at = low.indexOf(
      ` ${n
        .toLowerCase()
        .replace(/[^a-z0-9' ]+/g, " ")
        .trim()} `,
    );
    if (at >= 0 && (!best || at < best.at)) best = { at, name: n };
  }
  return best?.name ?? names[0];
}

export interface SceneStillOptions {
  gameTitle: string;
  recentRelease?: boolean;
  episodeDir: string;
  targets: FootageTarget[];
  /** At most this many stills. */
  max: number;
  long?: boolean;
  spoilerWarned?: boolean;
}

/**
 * SCENE_MATCH for a stills-only publisher (Nintendo: PUBLISHER_CHANNELS clipSeconds 0, so no cutscene clip may play):
 * each line that names a moment gets one still of that exact scene from the game's index, placed on the name as it
 * is said (forWords). The index proposes shots; the proxy (when on this machine) and then the full-quality frame
 * must show the named subject to the free local vision model, cleanly. A line with no confirmed frame gets nothing
 * here and keeps the ordinary art. Off (SCENE_INDEX or SCENE_MATCH), no index, or the wrong release: nothing.
 */
export async function indexedSceneStills(
  cfg: Pick<
    Config,
    "sceneIndex" | "sceneIndexMinConfidence" | "dataDir" | "ytdlpPath"
  > &
    Partial<Pick<Config, "spoilerGuard" | "sceneMatch" | "archiveSections">>,
  o: SceneStillOptions,
  deps: {
    /** Fetches [from, to) of the source at full quality into `file`. */
    download?: (
      videoId: string,
      from: number,
      to: number,
      file: string,
    ) => Promise<void>;
    /** One full-resolution frame `at` seconds into a downloaded section. */
    grab?: (section: string, at: number, file: string) => Promise<void>;
    look?: (file: string, ask: SubjectAsk) => Promise<SubjectLook | undefined>;
    screen?: (file: string) => Promise<FrameFlags | undefined>;
    /** null: no proxy look even when the proxy is here. */
    precheck?: IndexedOptions["precheck"] | null;
  } = {},
  now = new Date(),
  windows: readonly SpoilerWindow[] = spoilerWindows(),
): Promise<VisualAsset[]> {
  if (!cfg.sceneIndex || !cfg.sceneMatch || o.max <= 0 || !o.targets.length)
    return [];
  const index = await findIndex(cfg.dataDir, o.gameTitle);
  if (!index) {
    await requestSceneIndex(
      cfg,
      o.gameTitle,
      "a video about it",
      Boolean(o.recentRelease),
    );
    return [];
  }
  if (!indexFitsRelease(index, o.recentRelease)) return [];
  const w = cfg.spoilerGuard ? windowFor(windows, o.gameTitle, now) : undefined;
  const allow = w ? spoilerAllow(w, o, now) : undefined;
  const plan = planIndexedClips(index, o.targets, {
    maxClips: o.max,
    maxSeconds: o.max * CLIP_SECONDS,
    minConfidence: cfg.sceneIndexMinConfidence,
    alternates: 5,
    gameTitle: o.gameTitle,
    ...(allow
      ? {
          allow: (shot: SceneShot, key: string) =>
            allow(index, shot.start, key) &&
            allow(index, Math.max(shot.start, shot.end - 0.05), key),
        }
      : {}),
  }).filter((p) => p.names?.length);
  if (!plan.length) return [];
  const precheck =
    deps.precheck === null
      ? undefined
      : (deps.precheck ??
        (await proxyPrecheck(cfg.dataDir, index, o.episodeDir, cfg.archiveSections ? cfg.ytdlpPath : undefined)));
  const src = index.source;
  const url = `https://www.youtube.com/watch?v=${src.videoId}`;
  await fs.mkdir(path.join(o.episodeDir, "assets"), { recursive: true });
  const work = await fs.mkdtemp(path.join(o.episodeDir, "scenestill_work_"));
  const lineOf = new Map(o.targets.map((t) => [t.key, t.text]));
  const out: VisualAsset[] = [];
  let n = 0;
  try {
    for (const first of plan) {
      for (const c of [first, ...(first.alternates ?? [])]) {
        const ask = {
          game: o.gameTitle,
          line: lineOf.get(c.key) ?? c.label,
          names: c.names ?? [],
        };
        if (
          precheck &&
          !(await precheck(c.from, c.seconds, ask).catch(() => true))
        )
          continue;
        const i = n++;
        const section = path.join(work, `section_${i}.mp4`);
        const rel = path.join(
          "assets",
          `scenestill_${path.basename(work).slice(-6)}_${i}.jpg`,
        );
        const file = path.join(o.episodeDir, rel);
        // The frame in the middle of the clear stretch: away from the cut either side.
        const at =
          Math.round((c.from + Math.min(c.seconds / 2, 1.5)) * 100) / 100;
        const lead = Math.min(1, at);
        try {
          await (
            deps.download ??
            ((id, a, b, f) => download(id, a, b, f, cfg.ytdlpPath))
          )(
            src.videoId,
            Math.round((at - lead) * 100) / 100,
            Math.round(Math.min(src.duration, at + 1) * 100) / 100,
            section,
          );
          await (deps.grab ?? grabStill)(section, lead, file);
          const [look, flags] = await Promise.all([
            (
              deps.look ??
              (async (f: string, a: SubjectAsk) =>
                (await lookSubject([f], a))[0])
            )(file, ask),
            (
              deps.screen ?? (async (f: string) => (await screenFrames([f]))[0])
            )(file),
          ]);
          if (!stillConfirmed(look, flags)) {
            await fs.rm(file, { force: true }).catch(() => undefined);
            log("info", "scene still: named moment not seen, next shot", {
              game: o.gameTitle,
              key: c.key,
              at,
              seen: look?.seen,
            });
            continue;
          }
          const forWords = firstSpoken(ask.line, ask.names);
          const beatIndex = c.key.startsWith("beat:")
            ? Number.parseInt(c.key.slice(5), 10)
            : undefined;
          const moment = c.key.match(/#m(\d+)$/)?.[1];
          out.push({
            kind: "screenshot",
            file: rel,
            sourceUrl: url,
            provenance: `Cutscene still for "${label(o.gameTitle)}" from YouTube video "${label(src.title)}" by ${label(src.uploader)}, video ID: ${src.videoId} (${url}), source time: ${at.toFixed(2)}s; chosen for ${c.key} by the scene index, ${ask.names.join(", ")} seen by the picture check`,
            youtubeSource: {
              videoId: src.videoId,
              title: src.title,
              uploader: src.uploader,
            },
            beatIndex,
            ...(moment === undefined ? {} : { moment: Number(moment) }),
            ...(c.key === "hook" ? { role: "hook" as const } : {}),
            ...(forWords ? { forWords } : {}),
            label: look!.seen || c.label,
            reason: `scene index still: ${ask.names.join(", ")} (confidence ${look!.confidence})`,
            startSeconds: at,
            luma: index.shots[c.shot]?.luma,
          });
          break;
        } catch (err) {
          log("warn", "scene still: not fetched", {
            game: o.gameTitle,
            at,
            error: errorMessage(err),
          });
          await fs.rm(file, { force: true }).catch(() => undefined);
        } finally {
          await fs.rm(section, { force: true }).catch(() => undefined);
        }
      }
      if (out.length >= o.max) break;
    }
    return out;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function grabStill(
  section: string,
  at: number,
  file: string,
): Promise<void> {
  await runCapped(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      at.toFixed(2),
      "-i",
      section,
      "-frames:v",
      "1",
      "-vf",
      "scale=-2:'min(1080,ih)'",
      "-q:v",
      "2",
      file,
    ],
    { timeout: 60_000, maxBuffer: 1024 * 1024 },
  );
}
