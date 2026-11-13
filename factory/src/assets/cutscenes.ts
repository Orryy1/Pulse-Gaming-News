// Short, muted sections of a game's cutscenes, screened before they enter the footage pool.

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCapped } from "../lib/child.ts";
import { FFMPEG, YTDLP_TEXT } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { orchClientUrl } from "../platform.ts";
import {
  appleSoundReady,
  appleSpeech,
  overlapsSpeech,
  type SpeechSpan,
} from "./applesound.ts";
import { capFootage, DEFAULT_FOOTAGE_SECONDS } from "./footage.ts";
import { franchisePublisher, PUBLISHER_CHANNELS } from "./officialTrailer.ts";
import {
  matchClips,
  type FootageTarget,
  type MatchClipsOptions,
  type TrailerFile,
} from "./clipscore.ts";
import type { VisualAsset } from "./steam.ts";
import type { Llm } from "../editorial/llm.ts";
import { localSceneReview } from "./scenecheck.ts";
import { safeCutsceneQuote, type CutsceneQuote } from "../editorial/quotes.ts";

export interface CutsceneChapter { title: string; start: number; end?: number }
export interface CutsceneCaption { text: string; start: number; end: number }

export interface CutsceneUpload {
  videoId: string;
  title: string;
  uploader: string;
  duration: number;
  height?: number;
  viewCount?: number;
  isLive?: boolean;
  liveStatus?: string;
  /** YYYY-MM-DD, from an upload's own details (the launch fetcher refuses uploads older than the game). */
  uploadDate?: string;
  chapters?: CutsceneChapter[];
}

const SCENE_STOP = new Set("a an and are as at be been but by for from game gameplay he her his in into is it its of on or our over scene scenes she that the their them there they this to was were what when where who with you your all new full cutscene cutscenes movie".split(" "));
const sceneWords = (text: string) => titleWords(text.replace(/['’]s\b/gi, ""))
  .split(" ").filter((word) => word.length >= 3 && !SCENE_STOP.has(word));

export function sceneQueries(gameTitle: string, target: FootageTarget): string[] {
  const game = gameTitle.trim();
  if (!game) return [];
  const gameWords = new Set(sceneWords(game));
  const useful = (word: string) => {
    const words = sceneWords(word);
    return words.length > 0 && words.some((part) => !gameWords.has(part));
  };
  let names = [...new Set(target.keywords.map((word) => word.trim()).filter(useful))];
  if (!names.length)
    names = [...new Set((target.text.match(/\b[A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*/g) ?? []).filter(useful))];
  names = names.slice(0, 4);
  return names.flatMap((name) => [`${game} ${name} scene`, `${game} all ${name} scenes`]);
}

export function findCutsceneMoment(
  target: FootageTarget,
  chapters: readonly CutsceneChapter[],
  captions: readonly CutsceneCaption[],
  gameTitle = "",
): { how: "chapter" | "caption"; time: number } | undefined {
  const gameWords = new Set(sceneWords(gameTitle));
  const keywords = new Set(target.keywords.flatMap(sceneWords).filter((word) => !gameWords.has(word)));
  const words = new Set(sceneWords(target.text).filter((word) => !gameWords.has(word)));
  const best = <T extends { text: string; start: number }>(items: readonly T[]) => {
    let found: { time: number; score: number } | undefined;
    for (const item of items) {
      if (!Number.isFinite(item.start) || item.start < 0) continue;
      const present = new Set(sceneWords(item.text));
      const keyMatches = [...keywords].filter((word) => present.has(word)).length;
      const textMatches = [...words].filter((word) => present.has(word)).length;
      if (keywords.size ? !keyMatches : textMatches < 2) continue;
      const score = keyMatches * 3 + textMatches;
      if (!found || score > found.score) found = { time: item.start, score };
    }
    return found;
  };
  const chapter = best(chapters.map((item) => ({ text: item.title, start: item.start })));
  const caption = best(captions);
  if (chapter && (!caption || chapter.score >= caption.score)) return { how: "chapter", time: chapter.time };
  return caption ? { how: "caption", time: caption.time } : undefined;
}

function vttTime(value: string): number {
  const parts = value.split(":").map(Number);
  return parts.reduce((sum, part) => sum * 60 + part, 0);
}

export function parseCutsceneVtt(vtt: string): CutsceneCaption[] {
  const out: CutsceneCaption[] = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((line) => /^\s*(?:\d+:)?\d{2}:\d{2}\.\d+\s+-->/.test(line));
    if (i < 0) continue;
    const timing = lines[i]!.match(/^\s*((?:\d+:)?\d{2}:\d{2}\.\d+)\s+-->\s+((?:\d+:)?\d{2}:\d{2}\.\d+)/);
    if (!timing) continue;
    const start = vttTime(timing[1]!);
    const end = vttTime(timing[2]!);
    const text = lines.slice(i + 1).join(" ").replace(/<[^>]*>/g, "")
      .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) =>
        ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " })[entity] ?? entity)
      .replace(/\s+/g, " ").trim();
    if (text && Number.isFinite(start) && end > start) out.push({ text, start, end });
  }
  return out;
}

export function extractCutsceneQuotes(captions: readonly CutsceneCaption[], videoId: string): CutsceneQuote[] {
  const seen = new Set<string>();
  return captions.flatMap(({ text, start, end }) => {
    const quote = { id: `${videoId}:${start.toFixed(3)}-${end.toFixed(3)}`, videoId, text, start, end };
    const key = text.toLowerCase();
    if (seen.has(key) || !safeCutsceneQuote(quote)) return [];
    seen.add(key);
    return [quote];
  });
}

export function cutsceneQueries(gameTitle: string): string[] {
  const game = gameTitle.trim();
  return game
    ? [
        `${game} all cutscenes no commentary`,
        `${game} full movie`,
        `${game} cutscenes 4K`,
        `${game} game movie`,
      ]
    : [];
}

const NUMERALS: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
};
function titleWords(title: string): string {
  return title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => NUMERALS[word] ?? word)
    .join(" ");
}

const DISTRACTIONS =
  /\b(commentar\w*|reactions?|reacts?|reacting|face\s*cam|web\s*cam|lets?\s+play|review\w*|explained|lore|theor(?:y|ies)|fan\s*(?:films?|movies?|made)|mods?|modded|rank(?:ed|ing|ings)?|top\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty)|live\s*(?:stream|broadcast)|stream(?:ed|ing))\b/i;
const EDITIONS =
  /\b(remaster(?:ed)?|remake|reimagined|definitive\s+edition)\b/i;

/**
 * Requires the game's name (or its subtitle of two words or more: uploads say "Zelda: Ocarina of Time Remake", the
 * factory "The Legend of Zelda: Ocarina of Time"); preference scores never make a rejected upload eligible. A remake
 * or remaster upload passes only for a recent release (the 2026 Ocarina remake carries the original's name, and the
 * 1998 cutscenes would be the wrong game), and then it is preferred.
 */
export function pickCutsceneUpload(
  candidates: CutsceneUpload[],
  gameTitle: string,
  opts: { recentRelease?: boolean; sceneKeyword?: string } = {},
): CutsceneUpload | undefined {
  const game = titleWords(gameTitle);
  if (!game) return undefined;
  const subtitle = gameTitle.includes(":")
    ? titleWords(gameTitle.split(":").pop()!)
    : "";
  const names = [game, ...(subtitle.split(" ").length >= 2 ? [subtitle] : [])];
  const edition = (item: CutsceneUpload) =>
    EDITIONS.test(titleWords(item.title));
  const cutsceneWords = /\b(cut\s*scenes?|movies?)\b/i;
  return candidates
    .filter((item) => {
      if (
        !/^[\w-]{11}$/.test(item.videoId) ||
        !Number.isFinite(item.duration) ||
        item.duration < 6
      )
        return false;
      if (item.isLive || (item.liveStatus && item.liveStatus !== "not_live"))
        return false;
      const title = titleWords(item.title);
      if (!names.some((name) => ` ${title} `.includes(` ${name} `)))
        return false;
      if (!/\b(cut\s*scenes?|movies?|no\s+commentary)\b/i.test(title) &&
          !(opts.sceneKeyword && /\bscenes?\b/i.test(title)))
        return false;
      if (opts.sceneKeyword && !` ${title} `.includes(` ${titleWords(opts.sceneKeyword)} `)) return false;
      if (DISTRACTIONS.test(title.replace(/\bno\s+commentary\b/g, "")))
        return false;
      if (EDITIONS.test(title) && !EDITIONS.test(game) && !opts.recentRelease)
        return false;
      return true;
    })
    .sort(
      (a, b) =>
        (opts.recentRelease ? Number(edition(b)) - Number(edition(a)) : 0) ||
        // A cutscene compilation beats a "no commentary" walkthrough, which is mostly the uploader's own play.
        Number(cutsceneWords.test(b.title)) -
          Number(cutsceneWords.test(a.title)) ||
        Number(b.duration >= 1200) - Number(a.duration >= 1200) ||
        Number((b.height ?? 0) >= 1080) - Number((a.height ?? 0) >= 1080) ||
        (b.viewCount ?? 0) - (a.viewCount ?? 0) ||
        b.duration - a.duration,
    )[0];
}

// The picture must move before a stable textured corner is treated as an overlay. The texture floor
// excludes plain black bars; the edge threshold looks for persistent white lettering with dark outlines.
export const FRAME_WIDTH = 160;
export const FRAME_HEIGHT = 90;
export const MIN_SCREEN_FRAMES = 3;
export const PICTURE_MOTION = 10;
export const CORNER_STABILITY = 4;
export const CORNER_TEXTURE = 12;
// A nearly flat frame (a white dialogue card, a fade, a loading screen) carries no picture: the 8 Nov Ocarina trial
// kept a white "Go, Link." card. Real scenes, dark ones included, sit well above this spread of brightness.
export const BLANK_TEXTURE = 14;
export const TEXT_EDGE_FRACTION = 0.018;
export const TEXT_EDGE_PERSISTENCE = 0.6;
export const TEXT_PIXEL_TOLERANCE = 16;

/** A reason to drop the sampled segment, or undefined when no persistent overlay is detected. */
export function cleanFrameReason(
  frames: readonly Uint8Array[],
  width = FRAME_WIDTH,
  height = FRAME_HEIGHT,
): string | undefined {
  if (
    width < 20 ||
    height < 20 ||
    frames.length < MIN_SCREEN_FRAMES ||
    frames.some((f) => f.length !== width * height)
  )
    return "too few valid frames";
  const region = (x0: number, y0: number, x1: number, y1: number) => {
    let diff = 0,
      sum = 0,
      square = 0,
      count = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const p = y * width + x;
        const value = frames[0]![p]!;
        sum += value;
        square += value * value;
        count++;
        for (let k = 1; k < frames.length; k++)
          diff += Math.abs(frames[k]![p]! - frames[k - 1]![p]!);
      }
    const mean = sum / count;
    return {
      motion: diff / (count * (frames.length - 1)),
      texture: Math.sqrt(Math.max(0, square / count - mean * mean)),
    };
  };
  const picture = region(
    Math.floor(width * 0.25),
    Math.floor(height * 0.2),
    Math.floor(width * 0.75),
    Math.floor(height * 0.7),
  );
  const whole = region(0, 0, width, height);
  if (whole.texture < BLANK_TEXTURE) return "nearly blank picture";
  const cw = Math.floor(width * 0.2),
    ch = Math.floor(height * 0.2);
  if (picture.motion >= PICTURE_MOTION)
    for (const [x, y] of [
      [0, 0],
      [width - cw, 0],
      [0, height - ch],
      [width - cw, height - ch],
    ]) {
      const corner = region(x!, y!, x! + cw, y! + ch);
      if (corner.motion <= CORNER_STABILITY && corner.texture >= CORNER_TEXTURE)
        return "persistent corner overlay";
      // Smaller tiles catch a logo occupying only part of the corner.
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const tile = region(
            x! + Math.floor((dx * cw) / 2),
            y! + Math.floor((dy * ch) / 2),
            x! + Math.floor(((dx + 1) * cw) / 2),
            y! + Math.floor(((dy + 1) * ch) / 2),
          );
          if (tile.motion <= CORNER_STABILITY && tile.texture >= CORNER_TEXTURE)
            return "persistent corner overlay";
        }
    }
  let persistent = 0,
    possible = 0;
  for (let y = Math.floor(height * 0.72); y < Math.floor(height * 0.92); y++)
    for (
      let x = Math.floor(width * 0.2);
      x < Math.floor(width * 0.8) - 1;
      x++
    ) {
      const p = y * width + x;
      const edge = (f: Uint8Array) =>
        Math.max(f[p]!, f[p + 1]!) >= 220 && Math.min(f[p]!, f[p + 1]!) <= 90;
      possible++;
      if (
        frames.some(
          (reference) =>
            edge(reference) &&
            frames.filter(
              (frame) =>
                edge(frame) &&
                Math.abs(frame[p]! - reference[p]!) <= TEXT_PIXEL_TOLERANCE &&
                Math.abs(frame[p + 1]! - reference[p + 1]!) <=
                  TEXT_PIXEL_TOLERANCE,
            ).length >= Math.ceil(frames.length * TEXT_EDGE_PERSISTENCE),
        )
      )
        persistent++;
    }
  if (persistent / possible >= TEXT_EDGE_FRACTION)
    return "persistent bottom text";
  return undefined;
}

/** A crop of the picture as shares of its width and height: keep `w` x `h` starting at (`x`, `y`). */
export interface FrameCrop {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The share of the picture kept (w x h). */
  keeps: number;
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

/**
 * LONG_WATERMARK_CROP (pure): where to crop a clip refused for a persistent corner overlay so the mark is gone and the
 * picture keeps its shape. Only one corner may carry the mark, and only as far as the smaller tiles show it (a channel
 * logo in a tenth of the frame); the crop drops that much of the width and the height on that side, plus a margin,
 * and is refused when it would keep less than `keep` of the picture. Undefined when no corner is marked, two are, or
 * the mark is too big to crop away.
 */
export function overlayCornerCrop(
  frames: readonly Uint8Array[],
  keep: number,
  width = FRAME_WIDTH,
  height = FRAME_HEIGHT,
): FrameCrop | undefined {
  if (width < 20 || height < 20 || frames.length < MIN_SCREEN_FRAMES || frames.some((f) => f.length !== width * height))
    return undefined;
  const region = (x0: number, y0: number, x1: number, y1: number) => {
    let diff = 0,
      sum = 0,
      square = 0,
      count = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const p = y * width + x;
        const value = frames[0]![p]!;
        sum += value;
        square += value * value;
        count++;
        for (let k = 1; k < frames.length; k++) diff += Math.abs(frames[k]![p]! - frames[k - 1]![p]!);
      }
    const mean = sum / count;
    return {
      motion: diff / (count * (frames.length - 1)),
      texture: Math.sqrt(Math.max(0, square / count - mean * mean)),
    };
  };
  const still = (r: { motion: number; texture: number }) => r.motion <= CORNER_STABILITY && r.texture >= CORNER_TEXTURE;
  const picture = region(Math.floor(width * 0.25), Math.floor(height * 0.2), Math.floor(width * 0.75), Math.floor(height * 0.7));
  if (picture.motion < PICTURE_MOTION) return undefined;
  const cw = Math.floor(width * 0.2),
    ch = Math.floor(height * 0.2);
  const corners = [
    { name: "top-left" as const, x: 0, y: 0, right: false, bottom: false },
    { name: "top-right" as const, x: width - cw, y: 0, right: true, bottom: false },
    { name: "bottom-left" as const, x: 0, y: height - ch, right: false, bottom: true },
    { name: "bottom-right" as const, x: width - cw, y: height - ch, right: true, bottom: true },
  ];
  const marked: Array<{ name: FrameCrop["corner"]; right: boolean; bottom: boolean; fx: number; fy: number }> = [];
  for (const c of corners) {
    // How far into the frame the mark reaches from this corner's own edges, in tiles of half the corner.
    let fx = 0,
      fy = 0;
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const x0 = c.x + Math.floor((dx * cw) / 2);
        const y0 = c.y + Math.floor((dy * ch) / 2);
        const x1 = c.x + Math.floor(((dx + 1) * cw) / 2);
        const y1 = c.y + Math.floor(((dy + 1) * ch) / 2);
        if (!still(region(x0, y0, x1, y1))) continue;
        fx = Math.max(fx, (c.right ? width - x0 : x1) / width);
        fy = Math.max(fy, (c.bottom ? height - y0 : y1) / height);
      }
    if (!fx && still(region(c.x, c.y, c.x + cw, c.y + ch))) {
      fx = cw / width;
      fy = ch / height;
    }
    if (fx) marked.push({ name: c.name, right: c.right, bottom: c.bottom, fx, fy });
  }
  if (marked.length !== 1) return undefined;
  const m = marked[0]!;
  // The same share off the width and the height keeps the 16:9 shape; a small margin past the mark's tile.
  const cut = Math.max(m.fx, m.fy) + 0.01;
  const kept = (1 - cut) * (1 - cut);
  if (kept < keep) return undefined;
  return {
    x: m.right ? 0 : cut,
    y: m.bottom ? 0 : cut,
    w: 1 - cut,
    h: 1 - cut,
    keeps: Math.round(kept * 1000) / 1000,
    corner: m.name,
  };
}

/** The ffmpeg crop filter for a FrameCrop (pure), before any scaling: even sizes, the offsets in whole pixels. */
export function cropFilter(c: Pick<FrameCrop, "x" | "y" | "w" | "h">): string {
  const f = (n: number) => n.toFixed(4);
  return `crop=trunc(iw*${f(c.w)}/2)*2:trunc(ih*${f(c.h)}/2)*2:trunc(iw*${f(c.x)}):trunc(ih*${f(c.y)})`;
}

/** Re-encodes `file` in place with a crop, scaled back to 1080 lines; on failure the file is left as it was. */
export async function cropClipInPlace(file: string, crop: FrameCrop): Promise<void> {
  const tmp = `${file}.crop.mp4`;
  try {
    await runCapped(
      FFMPEG,
      ["-loglevel", "error", "-y", "-i", file, "-an", "-sn", "-dn", "-vf", `${cropFilter(crop)},scale=-2:1080`, "-c:v", "libx264", "-crf", "17", "-preset", "fast", "-pix_fmt", "yuv420p", tmp],
      { timeout: 180_000, maxBuffer: 1024 * 1024 },
    );
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Five grey frames of a clip at the screen's size, for cleanFrameReason and overlayCornerCrop. */
export async function screenFramesOf(file: string, seconds: number): Promise<Uint8Array[]> {
  const raw = `${file}.gray`;
  try {
    await runCapped(
      FFMPEG,
      ["-v", "error", "-y", "-i", file, "-vf", `fps=${(5 / Math.max(1, seconds)).toFixed(4)},scale=${FRAME_WIDTH}:${FRAME_HEIGHT},format=gray`, "-frames:v", "5", "-an", "-f", "rawvideo", raw],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    const data = await fs.readFile(raw);
    const size = FRAME_WIDTH * FRAME_HEIGHT;
    const frames: Uint8Array[] = [];
    for (let at = 0; at + size <= data.length; at += size) frames.push(data.subarray(at, at + size));
    return frames;
  } finally {
    await fs.rm(raw, { force: true }).catch(() => undefined);
  }
}

/** A long video gets up to six times the Short allowance, still a single per-video ceiling. */
export function cutsceneBudgetSeconds(
  shortSeconds: number,
  videoSeconds: number,
): number {
  return (
    Math.max(0, shortSeconds) *
    Math.min(6, Math.max(1, (videoSeconds || 0) / 60))
  );
}

/** The same owner's cap applies regardless of the YouTube uploader. */
export function cutscenePublisher(
  gameTitle: string,
  names: string[] = [],
): { key: string; seconds: number } {
  const owner = franchisePublisher(gameTitle);
  const rule = owner
    ? PUBLISHER_CHANNELS.find((r) => r.name === owner)
    : PUBLISHER_CHANNELS.find((r) =>
        names.some((name) => {
          const n = name.toLowerCase().trim();
          return (
            r.match.test(name.trim()) ||
            n === r.name.toLowerCase() ||
            n.startsWith(`${r.name.toLowerCase()} `) ||
            (r.name === "Rockstar Games" && n.startsWith("rockstar"))
          );
        }),
      );
  return rule
    ? { key: rule.name, seconds: rule.clipSeconds }
    : {
        key: `game:${gameTitle.toLowerCase().trim()}`,
        seconds: DEFAULT_FOOTAGE_SECONDS,
      };
}

export function cutsceneAllowance(
  videoLimit: number,
  videoUsed: number,
  publisherLimit: number,
  publisherUsed: number,
): number {
  return Math.max(
    0,
    Math.min(videoLimit - videoUsed, publisherLimit - publisherUsed),
  );
}

/** A fail-open or forced turn cannot protect another render on the shared PC. */
export function cutsceneGrant(line: string): boolean {
  return line.trim() === "GRANTED";
}

async function cutsceneLease(est: number): Promise<() => void> {
  const held = new Set((process.env.ORCH_HELD ?? "").split(","));
  if (["gpu", "cpu", "ram"].every((token) => held.has(token)))
    return () => undefined;
  const client = orchClientUrl(process.platform, process.env);
  if (!client) return () => undefined; // The Mac runs under its own turn-taking wrapper.
  const script = path.join(path.dirname(fileURLToPath(client)), "orch.py");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.ORCH_PYTHON || "C:/Python314/python.exe",
      [
        script,
        "hold",
        "--class",
        "heavy",
        "--project",
        "pulse",
        "--job",
        "cutscene footage",
        "--priority",
        "60",
        "--est",
        String(est),
        "--max-wait",
        "1",
        "--owner-pid",
        String(process.pid),
      ],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
    child.stdin.on("error", () => undefined);
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("cutscene PC turn timed out"));
    }, 80_000);
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      reject(new Error(message));
    };
    child.on("error", (err) => fail(errorMessage(err)));
    child.on("exit", () =>
      fail("cutscene PC turn ended before it was granted"),
    );
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line.startsWith("GRANTED")) {
          if (!cutsceneGrant(line)) {
            fail("cutscene PC turn was not reserved");
            return;
          }
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(() => child.stdin.end());
          }
        } else if (line.startsWith("TIMEOUT"))
          fail("cutscene PC turn timed out");
      }
    });
  });
}

async function searchCutscenes(
  query: string,
  ytdlp: string,
): Promise<CutsceneUpload[]> {
  const { stdout } = await runCapped(
    ytdlp,
    [
      ...YTDLP_TEXT.args,
      "--no-warnings",
      "--flat-playlist",
      "--dump-json",
      `ytsearch15:${query}`,
    ],
    { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env: YTDLP_TEXT.env },
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
  const { stdout } = await runCapped(
    ytdlp,
    [
      ...YTDLP_TEXT.args,
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
      "--dump-single-json",
      `https://www.youtube.com/watch?v=${upload.videoId}`,
    ],
    { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, env: YTDLP_TEXT.env },
  );
  const item = JSON.parse(stdout);
  if (
    item.id !== upload.videoId ||
    item.was_live === true ||
    !(
      item.live_status === "not_live" ||
      (item.is_live === false && item.was_live === false)
    )
  )
    return undefined;
  const heights = (Array.isArray(item.formats) ? item.formats : [])
    .filter((format: { vcodec?: string }) => format.vcodec !== "none")
    .map((format: { height?: number }) => Number(format.height) || 0);
  return {
    videoId: upload.videoId,
    title: String(item.title ?? ""),
    uploader: String(item.uploader ?? item.channel ?? ""),
    duration: Number(item.duration) || 0,
    height: Math.max(Number(item.height) || 0, ...heights) || undefined,
    viewCount: Number(item.view_count) || undefined,
    isLive: item.is_live === true,
    liveStatus: item.live_status || undefined,
    chapters: (Array.isArray(item.chapters) ? item.chapters : []).flatMap((chapter: { title?: unknown; start_time?: unknown; end_time?: unknown }) => {
      const start = Number(chapter.start_time);
      return typeof chapter.title === "string" && Number.isFinite(start) && start >= 0
        ? [{ title: chapter.title, start, end: Number(chapter.end_time) || undefined }]
        : [];
    }),
  };
}

/** The download's formats: the picture only, or (APPLE_SOUND_TAGS, to hear the spoken lines) picture and sound. */
export const CUTSCENE_VIDEO_FORMAT =
  "bv*[height<=1080][ext=mp4][vcodec^=avc1]/bv*[height<=1080][ext=mp4]/b[height<=1080][ext=mp4]";
export const CUTSCENE_HEARD_FORMAT =
  "bv*[height<=1080][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height<=1080][ext=mp4]/" + CUTSCENE_VIDEO_FORMAT;

async function uploadCaptions(upload: CutsceneUpload, work: string, ytdlp: string): Promise<string> {
  await runCapped(ytdlp, [
    ...YTDLP_TEXT.args, "--no-warnings", "--no-playlist", "--write-subs", "--write-auto-subs",
    "--sub-langs", "en.*,en", "--sub-format", "vtt", "--skip-download",
    "-o", path.join(work, `captions_${upload.videoId}.%(ext)s`),
    `https://www.youtube.com/watch?v=${upload.videoId}`,
  ], { timeout: 90_000, maxBuffer: 4 * 1024 * 1024, env: YTDLP_TEXT.env });
  const file = (await fs.readdir(work)).find((name) => name.startsWith(`captions_${upload.videoId}.en`) && name.endsWith(".vtt"));
  return file ? fs.readFile(path.join(work, file), "utf8") : "";
}

export function cutsceneDownloadArgs(
  upload: CutsceneUpload,
  from: number,
  to: number,
  file: string,
  withSound = false,
): string[] {
  return [
    "--no-playlist",
    "--no-warnings",
    "-f",
    withSound ? CUTSCENE_HEARD_FORMAT : CUTSCENE_VIDEO_FORMAT,
    "--download-sections",
    `*${from.toFixed(2)}-${to.toFixed(2)}`,
    "-o",
    file,
    `https://www.youtube.com/watch?v=${upload.videoId}`,
  ];
}

export function silentSectionArgs(source: string, file: string): string[] {
  return [
    "-v",
    "error",
    "-y",
    "-i",
    source,
    "-map",
    "0:v:0",
    "-c:v",
    "copy",
    "-an",
    "-sn",
    "-dn",
    file,
  ];
}

/**
 * One section, muted. With `hear` (APPLE_SOUND_TAGS) it is fetched with its sound first and Apple's Sound Analysis
 * finds its spoken lines (seconds within the section) before the sound is dropped; undefined when not heard.
 */
async function downloadSection(
  upload: CutsceneUpload,
  from: number,
  to: number,
  file: string,
  ytdlp: string,
  hear = false,
): Promise<SpeechSpan[] | undefined> {
  const downloaded = `${file}.download.mp4`;
  try {
    await runCapped(
      ytdlp,
      cutsceneDownloadArgs(upload, from, to, downloaded, hear),
      {
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
      },
    );
    const heard = hear
      ? await appleSpeech(downloaded, { enabled: true }).catch(() => undefined)
      : undefined;
    await runCapped(FFMPEG, silentSectionArgs(downloaded, file), {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return heard?.spans;
  } finally {
    await fs.rm(downloaded, { force: true }).catch(() => undefined);
  }
}

/**
 * Screens a downloaded section. LONG_WATERMARK_CROP (`cropKeep`, long videos only): a section refused for one small
 * corner mark is cut again cropped away from it (overlayCornerCrop) and screened once more, so every clip cut from it
 * is clean; a section that still fails, or whose mark is too big, goes as before.
 */
async function screenSection(file: string, seconds: number, cropKeep?: number): Promise<boolean> {
  const frames = await screenFramesOf(file, seconds);
  const reason = cleanFrameReason(frames);
  if (reason === "persistent corner overlay" && cropKeep) {
    const crop = overlayCornerCrop(frames, cropKeep);
    if (crop) {
      try {
        await cropClipInPlace(file, crop);
        const again = cleanFrameReason(await screenFramesOf(file, seconds));
        log("info", again ? "cutscene section: cropped, still screened out" : "cutscene section: corner mark cropped away", {
          file: path.basename(file),
          corner: crop.corner,
          keeps: crop.keeps,
          ...(again ? { reason: again } : {}),
        });
        return again === undefined;
      } catch (err) {
        log("warn", "cutscene section: crop failed", { file: path.basename(file), error: errorMessage(err) });
        return false;
      }
    }
  }
  if (reason) log("info", "cutscene section screened out", { file: path.basename(file), reason });
  return reason === undefined;
}

export interface CutsceneOptions {
  enabled: boolean;
  scenes?: boolean;
  /** SCENE_MATCH: a located scene is confirmed by the free local vision model, never by `llm` (src/assets/scenecheck.ts). */
  sceneCheck?: boolean;
  quotes?: boolean;
  gameTitle: string;
  recentRelease?: boolean;
  episodeDir: string;
  targets: FootageTarget[];
  maxClips: number;
  maxSeconds: number;
  ytdlp: string;
  publisher?: string;
  llm?: Llm;
  /** APPLE_SOUND_TAGS (Mac only): hear each section's spoken lines and flag the clips that cut into one. */
  soundTags?: boolean;
  /** LONG_WATERMARK_CROP: a section with one small corner mark is cropped clear of it when this much picture stays. */
  watermarkCropKeep?: number;
  deps?: {
    search?: (query: string) => Promise<CutsceneUpload[]>;
    details?: (
      upload: CutsceneUpload,
      ytdlp: string,
    ) => Promise<CutsceneUpload | undefined>;
    download?: (
      upload: CutsceneUpload,
      from: number,
      to: number,
      file: string,
      ytdlp: string,
    ) => Promise<void | SpeechSpan[] | undefined>;
    screen?: (file: string, seconds: number) => Promise<boolean>;
    captions?: (upload: CutsceneUpload, work: string, ytdlp: string) => Promise<string>;
    match?: (options: MatchClipsOptions) => Promise<VisualAsset[]>;
    lease?: (est: number) => Promise<() => void>;
  };
}

export type CutsceneClip = VisualAsset & {
  credit: string;
  span: { source: string; from: number; to: number };
  /** APPLE_SOUND_TAGS: a character speaks during this clip in the original (the clip itself stays muted). */
  spokenLine?: boolean;
};

// Source text must not masquerade as the publisher field used by the existing cap.
function provenanceLabel(value: string): string {
  return value
    .replace(/[\r\n"]/g, " ")
    .replace(/\bpublisher\s*:/gi, "publisher ");
}

export interface CutsceneJob {
  gameTitle: string;
  /** The video is about a release from the last year or so, or names its remake or remaster (pickCutsceneUpload). */
  recentRelease?: boolean;
  episodeDir: string;
  pathPrefix?: string;
  beatIndex?: number;
  targets: FootageTarget[];
  publisherNames?: string[];
  /**
   * A retrospective's chapter (src/editorial/retrospective.ts): the publisher footage this chapter alone may carry, in
   * place of the publisher's one allowance for the whole video. Counted against this chapter's own clips only (the
   * owner's own capture never counts: it is his footage).
   */
  ownSeconds?: number;
  /** The most clips this job may fetch (LONG_MOVING_FIRST retrospectives); unset: 24. */
  maxClips?: number;
}

/** Publisher footage already on a chapter (pure): its clips, never stock or the owner's own capture. */
export function chapterFootageUsed(
  clips: ReadonlyArray<{ provenance: string; durationSeconds?: number; beatIndex?: number; stock?: boolean }>,
  beatIndex: number | undefined,
): number {
  return clips.reduce(
    (n, c) =>
      c.beatIndex === beatIndex && !c.stock && !/^Pulse's own gameplay capture/.test(c.provenance)
        ? n + (c.durationSeconds ?? 0)
        : n,
    0,
  );
}

/** Drop or shorten only cutscenes if a later footage pass has spent their allowance. */
export function reconcileCutsceneBudgets<
  T extends {
    provenance: string;
    durationSeconds: number;
    beatIndex?: number;
    stock?: boolean;
    span?: { source: string; from: number; to: number };
  },
>(
  clips: T[],
  jobs: Array<Pick<CutsceneJob, "gameTitle" | "beatIndex" | "publisherNames" | "ownSeconds">>,
  videoLimit: number,
): T[] {
  // A retrospective's chapters each carry their own allowance (CutsceneJob.ownSeconds).
  const ownByBeat = new Map(
    jobs.flatMap((job) =>
      job.beatIndex === undefined || job.ownSeconds === undefined ? [] : [[job.beatIndex, job.ownSeconds] as const],
    ),
  );
  const isCutscene = (clip: T) => /^Cutscenes for "/.test(clip.provenance);
  const ownerByBeat = new Map(
    jobs.flatMap((job) =>
      job.beatIndex === undefined
        ? []
        : [
            [
              job.beatIndex,
              cutscenePublisher(job.gameTitle, job.publisherNames).key,
            ] as const,
          ],
    ),
  );
  const explicitOwner = (clip: T) =>
    PUBLISHER_CHANNELS.find((rule) =>
      clip.provenance.includes(`publisher: ${rule.name}`),
    );
  for (const clip of clips) {
    const owner = isCutscene(clip) ? explicitOwner(clip) : undefined;
    if (owner && clip.beatIndex !== undefined)
      ownerByBeat.set(clip.beatIndex, owner.name);
  }
  const other = clips.filter((clip) => !isCutscene(clip));
  const kept = new Map<T, T>();
  let videoUsed = 0;
  for (const clip of clips.filter(isCutscene)) {
    const game = clip.provenance.match(/^Cutscenes for "([^"]+)"/)?.[1] ?? "";
    const rule = explicitOwner(clip);
    const owner = rule
      ? { key: rule.name, seconds: rule.clipSeconds }
      : cutscenePublisher(game);
    const used = [...other, ...kept.values()].reduce((sum, item) => {
      if (item.stock) return sum;
      const known =
        explicitOwner(item)?.name ??
        (item.beatIndex === undefined
          ? undefined
          : ownerByBeat.get(item.beatIndex));
      return sum + (!known || known === owner.key ? item.durationSeconds : 0);
    }, 0);
    const own = clip.beatIndex === undefined ? undefined : ownByBeat.get(clip.beatIndex);
    const allowed =
      own !== undefined
        ? cutsceneAllowance(videoLimit, videoUsed, own, chapterFootageUsed([...other, ...kept.values()], clip.beatIndex))
        : cutsceneAllowance(videoLimit, videoUsed, owner.seconds, used);
    const next = capFootage([clip], allowed, 4.8, true)[0];
    if (!next) continue;
    const duration = next.durationSeconds;
    const adjusted = next.span
      ? { ...next, span: { ...next.span, to: next.span.from + duration } }
      : next;
    kept.set(clip, adjusted);
    videoUsed += duration;
  }
  return clips.flatMap((clip) =>
    isCutscene(clip) ? (kept.has(clip) ? [kept.get(clip)!] : []) : [clip],
  );
}

/** The episode-level allowance is shared by every game and every clip already gathered for its publisher. */
export async function gatherCutsceneSources(o: {
  enabled: boolean;
  videoLimit: number;
  jobs: CutsceneJob[];
  existing: Array<{
    provenance: string;
    durationSeconds: number;
    beatIndex?: number;
    stock?: boolean;
  }>;
  fetch: (
    job: CutsceneJob & { maxSeconds: number; publisher?: string },
  ) => Promise<CutsceneClip[]>;
  shouldStop?: () => boolean;
}): Promise<CutsceneClip[]> {
  if (!o.enabled || o.videoLimit < 1.6) return [];
  const owners = o.jobs.map((job) =>
    cutscenePublisher(job.gameTitle, job.publisherNames),
  );
  const ownerByBeat = new Map(
    o.jobs.flatMap((job, i) =>
      job.beatIndex === undefined
        ? []
        : [[job.beatIndex, owners[i]!.key] as const],
    ),
  );
  let videoUsed = o.existing
    .filter((c) => /^Cutscenes for "/.test(c.provenance))
    .reduce((n, c) => n + c.durationSeconds, 0);
  const added: CutsceneClip[] = [];
  for (const [i, job] of o.jobs.entries()) {
    if (o.shouldStop?.()) break;
    const owner = owners[i]!;
    const used = [...o.existing, ...added].reduce((sum, clip) => {
      if (clip.stock) return sum;
      const explicit = PUBLISHER_CHANNELS.find((r) =>
        clip.provenance.includes(`publisher: ${r.name}`),
      )?.name;
      const known =
        explicit ??
        (clip.beatIndex === undefined
          ? undefined
          : ownerByBeat.get(clip.beatIndex));
      // An untagged hook can belong to any entry, so count it against each publisher until its owner is known.
      return (
        sum + (!known || known === owner.key ? (clip.durationSeconds ?? 0) : 0)
      );
    }, 0);
    const maxSeconds =
      job.ownSeconds !== undefined
        ? cutsceneAllowance(o.videoLimit, videoUsed, job.ownSeconds, chapterFootageUsed([...o.existing, ...added], job.beatIndex))
        : cutsceneAllowance(o.videoLimit, videoUsed, owner.seconds, used);
    if (maxSeconds < 1.6 || !job.targets.length) continue;
    const found = await o
      .fetch({
        ...job,
        maxSeconds,
        publisher: owner.key.startsWith("game:") ? undefined : owner.key,
      })
      .catch((err) => {
        log("warn", "cutscene media failed", {
          game: job.gameTitle,
          error: errorMessage(err),
        });
        return [] as CutsceneClip[];
      });
    for (const clip of capFootage(found, maxSeconds, 4.8, true)) {
      const durationSeconds = clip.durationSeconds ?? 4.8;
      added.push({
        ...clip,
        file: job.pathPrefix ? path.join(job.pathPrefix, clip.file) : clip.file,
        beatIndex: job.beatIndex ?? clip.beatIndex,
        durationSeconds,
        audio: false,
        span: { ...clip.span, to: clip.span.from + durationSeconds },
      });
      videoUsed += durationSeconds;
    }
  }
  return added;
}

/** Scene uploads ("All Ganondorf Scenes") tried per line before it falls back to spread footage. */
export const SCENE_UPLOADS_PER_TARGET = 2;

/** Searches metadata first and downloads only small, bounded sections of the chosen upload. */
export async function cutsceneMedia(
  o: CutsceneOptions,
): Promise<CutsceneClip[]> {
  if (
    !o.enabled ||
    !o.gameTitle.trim() ||
    !o.targets.length ||
    o.maxClips <= 0 ||
    o.maxSeconds < 1.6
  )
    return [];
  const hits: CutsceneUpload[] = [];
  for (const query of cutsceneQueries(o.gameTitle)) {
    try {
      hits.push(
        ...(await (o.deps?.search?.(query) ?? searchCutscenes(query, o.ytdlp))),
      );
    } catch (err) {
      log("warn", "cutscene search failed", {
        game: o.gameTitle,
        error: errorMessage(err),
      });
    }
  }
  // Flat search results often lack resolution or complete live status. Confirm the best few before downloading.
  const pending = [...new Map(hits.map((hit) => [hit.videoId, hit])).values()];
  const detailed: CutsceneUpload[] = [];
  for (let i = 0; i < 6; i++) {
    const hit = pickCutsceneUpload(pending, o.gameTitle, { recentRelease: o.recentRelease });
    if (!hit) break;
    pending.splice(pending.indexOf(hit), 1);
    try {
      const item = await (o.deps?.details ?? uploadDetails)(hit, o.ytdlp);
      if (item && item.videoId === hit.videoId) detailed.push(item);
    } catch (err) {
      log("warn", "cutscene metadata failed", {
        videoId: hit.videoId,
        error: errorMessage(err),
      });
    }
  }
  const upload = pickCutsceneUpload(detailed, o.gameTitle, { recentRelease: o.recentRelease });
  if (!upload && !o.scenes) return [];
  let release: () => void;
  try {
    release = await (o.deps?.lease ?? cutsceneLease)(
      Math.max(5, Math.min(30, Math.ceil(o.maxSeconds / 4))),
    );
  } catch (err) {
    log("warn", "cutscene footage skipped: PC turn unavailable", {
      game: o.gameTitle,
      error: errorMessage(err),
    });
    return [];
  }
  let work: string | undefined;
  const sections = new Map<string, { upload: CutsceneUpload; from: number; how: "chapter" | "caption" | "scene upload" | "spread"; targetKey?: string }>();
  const trailers: TrailerFile[] = [];
  // APPLE_SOUND_TAGS: each kept section's spoken lines, by the section's start in the source.
  const spoken = new Map<string, SpeechSpan[]>();
  const hear = Boolean(o.soundTags) && appleSoundReady(true);
  try {
    await fs.mkdir(o.episodeDir, { recursive: true });
    work = await fs.mkdtemp(path.join(o.episodeDir, "cutscene_work_"));
    const workDir = work;
    const count = upload ? Math.min(
      12,
      Math.max(2, Math.ceil(o.maxSeconds / 4.8) + 1),
      Math.max(1, Math.floor(upload.duration / 10)),
    ) : 0;
    let captions: CutsceneCaption[] = [];
    if (upload && (o.scenes || o.quotes)) {
      try {
        captions = parseCutsceneVtt(await (o.deps?.captions ?? uploadCaptions)(upload, workDir, o.ytdlp));
      } catch (err) {
        log("warn", "cutscene captions unavailable", { videoId: upload.videoId, error: errorMessage(err) });
      }
    }
    if (o.quotes && upload) {
      await fs.writeFile(path.join(o.episodeDir, "cutscene_quotes.json"), JSON.stringify({
        gameTitle: o.gameTitle, source: { videoId: upload.videoId, title: upload.title, uploader: upload.uploader },
        quotes: extractCutsceneQuotes(captions, upload.videoId),
      }, null, 2), "utf8");
    }
    // chapterStart: the moment is a chapter, which begins at `time` and runs on from there.
    type SectionPlan = { upload: CutsceneUpload; time: number; how: "chapter" | "caption" | "scene upload" | "spread"; targetKey?: string; chapterStart?: boolean };
    // Scene uploads already tried per target, and targets with none left: a rejected upload (another channel's
    // watermark on every frame, the wrong moment) gives way to the next one.
    const triedScenes = new Map<string, Set<string>>();
    const noMoreScenes = new Set<string>();
    const scenePlan = async (target: FootageTarget): Promise<SectionPlan | undefined> => {
      const tried = triedScenes.get(target.key) ?? new Set<string>();
      triedScenes.set(target.key, tried);
      if (noMoreScenes.has(target.key) || tried.size >= SCENE_UPLOADS_PER_TARGET) return undefined;
      let scene: CutsceneUpload | undefined;
      for (const query of sceneQueries(o.gameTitle, target)) {
        const keyword = query.slice(o.gameTitle.trim().length + 1).replace(/^all /i, "").replace(/ scenes?$/i, "");
        try {
          const hits = (await (o.deps?.search?.(query) ?? searchCutscenes(query, o.ytdlp))).filter((hit) => !tried.has(hit.videoId));
          const pick = pickCutsceneUpload(hits, o.gameTitle, { recentRelease: o.recentRelease, sceneKeyword: keyword });
          if (!pick) continue;
          const item = await (o.deps?.details ?? uploadDetails)(pick, o.ytdlp);
          if (item && item.videoId === pick.videoId && pickCutsceneUpload([item], o.gameTitle, { recentRelease: o.recentRelease, sceneKeyword: keyword })) {
            scene = item;
            break;
          }
        } catch (err) {
          log("warn", "cutscene scene search failed", { query, error: errorMessage(err) });
        }
      }
      if (scene) {
        tried.add(scene.videoId);
        let time = scene.duration / 2;
        let chapterStart = false;
        try {
          const sceneCaptions = parseCutsceneVtt(await (o.deps?.captions ?? uploadCaptions)(scene, workDir, o.ytdlp));
          const precise = findCutsceneMoment(target, scene.chapters ?? [], sceneCaptions, o.gameTitle);
          if (precise && precise.time < scene.duration) {
            time = precise.time;
            chapterStart = precise.how === "chapter";
          }
        } catch (err) {
          log("warn", "scene-upload captions unavailable", { videoId: scene.videoId, error: errorMessage(err) });
        }
        return { upload: scene, time, how: "scene upload", targetKey: target.key, chapterStart };
      }
      noMoreScenes.add(target.key);
      return undefined;
    };
    const clean: CutsceneClip[] = [];
    let sectionNumber = 0;
    let pass = 0;
    const maxSections = Math.max(12, o.targets.length * 3);
    const runPlans = async (plans: SectionPlan[], targets: FootageTarget[], fill = false) => {
      const batch: TrailerFile[] = [];
      const remaining = o.maxSeconds - clean.reduce((sum, clip) => sum + (clip.durationSeconds ?? 0), 0);
      if (!plans.length || clean.length >= o.maxClips || remaining < 1.6) return;
      for (const plan of plans) {
        if (sectionNumber >= maxSections) break;
        const length = Math.min(30, plan.upload.duration);
        // A chapter's moment follows its start (a second earlier allows for a late timestamp); a caption's or a
        // guess's sits in the middle of the section. Centring a chapter put half the section in the one before.
        const lead = plan.chapterStart || plan.how === "chapter" ? 1 : length / 2;
        const from = Math.max(0, Math.min(plan.upload.duration - length, plan.time - lead));
        const file = path.join(workDir, `section_${sectionNumber++}.mp4`);
      try {
        const heard = await (o.deps?.download ??
          ((u, f, t, out, y) => downloadSection(u, f, t, out, y, hear)))(
          plan.upload,
          from,
            Math.min(plan.upload.duration, from + length),
          file,
          o.ytdlp,
        );
        if (Array.isArray(heard)) spoken.set(from.toFixed(2), heard);
        if (!(await (o.deps?.screen ?? ((f, n) => screenSection(f, n, o.watermarkCropKeep)))(file, length))) {
          await fs.rm(file, { force: true });
          continue;
        }
          sections.set(file, { upload: plan.upload, from, how: plan.how, targetKey: plan.targetKey });
          batch.push({ file, sectionId: path.basename(file), name: plan.upload.title, url: `https://www.youtube.com/watch?v=${plan.upload.videoId}`, total: length,
            ...(plan.targetKey ? { targetKey: plan.targetKey, anchor: plan.time - from, sceneMethod: plan.how as "chapter" | "caption" | "scene upload" } : {}) });
      } catch (err) {
        log("warn", "cutscene section rejected", {
            videoId: plan.upload.videoId,
          error: errorMessage(err),
        });
        await fs.rm(file, { force: true }).catch(() => undefined);
      }
    }
      trailers.push(...batch);
      if (!batch.length) return;
    const clips = await (o.deps?.match ?? matchClips)({
        trailers: batch,
      episodeDir: o.episodeDir,
        targets,
        maxClips: o.maxClips - clean.length,
      llm: o.llm,
        ...(o.sceneCheck ? { sceneReview: localSceneReview(o.gameTitle) } : {}),
        prefix: `${path.basename(workDir)}_${pass++}`,
      textCheck: true,
        preserveWork: true,
        fillSeconds: fill ? remaining : undefined,
        describe: (t, seconds, at) => {
          const section = sections.get(t.file)!;
          const source = section.upload;
          return `Cutscenes for "${provenanceLabel(o.gameTitle)}" from YouTube video "${provenanceLabel(source.title)}" by ${provenanceLabel(source.uploader)}, video ID: ${source.videoId}${o.publisher ? `, publisher: ${o.publisher}` : ""} (${t.url}), ${seconds}s, section start: ${section.from.toFixed(2)}s, source time: ${(section.from + at).toFixed(2)}s, found by: ${section.how}${section.targetKey ? `, target: ${section.targetKey}` : ""}, muted`;
        },
      }).catch((err) => {
        log("warn", "cutscene matching failed", { game: o.gameTitle, error: errorMessage(err) });
        return [] as VisualAsset[];
    });
    for (const clip of clips) {
      const file = path.join(o.episodeDir, clip.file);
        if (!(await (o.deps?.screen ?? screenSection)(file, clip.durationSeconds ?? 4.8).catch(() => false))) {
        await fs.rm(file, { force: true }).catch(() => undefined);
        continue;
      }
        const sectionStart = Number(clip.provenance.match(/section start: ([\d.]+)s/)?.[1]);
        const matching = batch.filter((t) => t.url === clip.sourceUrl && Math.abs((sections.get(t.file)?.from ?? -1) - sectionStart) < 0.02);
        const source = clip.sourceSectionId ? batch.find((t) => t.sectionId === clip.sourceSectionId && t.url === clip.sourceUrl)
          : matching.length === 1 ? matching[0] : undefined;
        const section = source && sections.get(source.file);
        if (!source || !section) continue;
        const from = clip.startSeconds !== undefined
          ? Math.round((section.from + clip.startSeconds) * 100) / 100
          : Number(clip.provenance.match(/source time: ([\d.]+)s/)?.[1]);
      if (!Number.isFinite(from)) continue;
        // The fill pass can land on a moment already taken.
        if (clean.some((c) => c.span.source === source.url && Math.abs(c.span.from - from) < 3)) {
        await fs.rm(file, { force: true }).catch(() => undefined);
        continue;
      }
      const lines = Number.isFinite(sectionStart)
        ? spoken.get(sectionStart.toFixed(2))
        : undefined;
      const at = clip.startSeconds ?? 0;
      const spokenLine = lines
        ? overlapsSpeech(lines, at, at + (clip.durationSeconds ?? 4.8))
        : undefined;
      if (spokenLine)
        log("info", "cutscene clip cuts into a spoken line", {
          file: clip.file,
          videoId: section?.upload.videoId,
          sourceTime: from,
        });
      clean.push({
        ...clip,
        ...(spokenLine !== undefined ? { spokenLine } : {}),
        provenance: clip.provenance.replace(
          /source time: [\d.]+s/,
          `source time: ${from.toFixed(2)}s`,
        ),
        audio: false,
        credit: `FOOTAGE: ${o.gameTitle.toUpperCase()} CUTSCENES / YOUTUBE`,
          youtubeSource: { videoId: section.upload.videoId, title: section.upload.title, uploader: section.upload.uploader },
          cutsceneMatch: { targetKey: section.targetKey ?? clip.assignedTargetKey,
            ...(section.targetKey ? {} : { requestedTarget: clip.assignedTargetKey ?? (targets.length === 1 ? targets[0]!.key : undefined) }), how: section.how },
          span: { source: source.url, from, to: from + (clip.durationSeconds ?? 0) },
      });
    }
    };
    if (!o.scenes && upload) {
      const length = Math.min(30, upload.duration);
      await runPlans(Array.from({ length: count }, (_, i) => ({ upload, how: "spread" as const,
        time: ((upload.duration - length) * (i + 1)) / (count + 1) + length / 2 })), o.targets, true);
    } else {
      const batchSize = Math.min(24, Math.max(1, Math.floor(o.maxClips)));
      for (let first = 0; first < o.targets.length; first += batchSize) {
        if (clean.length >= o.maxClips || o.maxSeconds - clean.reduce((sum, clip) => sum + (clip.durationSeconds ?? 0), 0) < 1.6) break;
        const sceneTargets = o.targets.slice(first, first + batchSize);
        const initial: SectionPlan[] = [];
        for (const target of sceneTargets) {
          const found = upload && findCutsceneMoment(target, upload.chapters ?? [], captions, o.gameTitle);
          if (upload && found && found.time < upload.duration) initial.push({ upload, ...found, targetKey: target.key });
          else {
            const scene = await scenePlan(target);
            if (scene) initial.push(scene);
          }
        }
        await runPlans(initial, sceneTargets);
        const remainingTargets = () => sceneTargets.filter((target) => !clean.some((clip) =>
          (clip.cutsceneMatch?.targetKey ?? clip.cutsceneMatch?.requestedTarget) === target.key));
        for (let round = 0; round < SCENE_UPLOADS_PER_TARGET; round++) {
          const retries: SectionPlan[] = [];
          for (const target of remainingTargets()) {
            const scene = await scenePlan(target);
            if (scene) retries.push(scene);
          }
          if (!retries.length) break;
          await runPlans(retries, remainingTargets());
        }
        const missing = remainingTargets();
        if (upload) {
          const length = Math.min(30, upload.duration);
          for (const [i, target] of missing.entries()) {
            const time = ((upload.duration - length) * (i + 1)) / (missing.length + 1) + length / 2;
            await runPlans([{ upload, time, how: "spread" }], [target]);
          }
        }
      }
    }
    log("info", "cutscene sections kept", { videoId: upload?.videoId, kept: trailers.length, tried: sectionNumber });
    return capFootage(clean, o.maxSeconds, 4.8, true);
  } finally {
    if (work)
      await fs
        .rm(work, { recursive: true, force: true })
        .catch(() => undefined);
    release();
  }
}
