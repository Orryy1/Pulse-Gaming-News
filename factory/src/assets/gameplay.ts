// Real gameplay for long videos and documentaries, beyond trailers, from two
// sources the channel is entitled to use:
//   1. Creative Commons (CC BY) gameplay on YouTube: the uploader has licensed
//      reuse. The licence is confirmed on the video itself before any download,
//      and every clip carries the creator's credit on screen and in the
//      description.
//   2. The publisher's own gameplay uploads (reveals, walkthroughs, mission
//      showcases) on its official channel.
// Only a slice of each video is downloaded, then moments are matched to the
// narration exactly as trailer moments are.

import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Llm } from "../editorial/llm.ts";
import type { VisualAsset } from "./steam.ts";
import {
  matchClips,
  parseSignalStats,
  MIN_CLIP_SECONDS,
  type FootageTarget,
} from "./clipscore.ts";
import { keepGameSound } from "./talk.ts";
import { screenFrames } from "./localvision.ts";
import { FFMPEG, FFPROBE, YTDLP_TEXT } from "../lib/bin.ts";
import { PUBLISHER_CHANNELS } from "./officialTrailer.ts";
import { trailerMatchesGame, distinguishing } from "./commons.ts";
import { normTitle } from "./igdb.ts";
import { fetchWithTimeout, errorMessage, log } from "../lib/util.ts";

const run = promisify(execFile);
const API = "https://www.googleapis.com/youtube/v3";

export interface GameplaySource {
  videoId: string;
  title: string;
  channelTitle: string;
  url: string;
  kind: "cc" | "official";
  durationSeconds: number;
  /** The video's own chapter list from its description ("12:34 Phnom Penh"), when it has one. */
  chapters?: Array<{ at: number; title: string }>;
}

const NOT_GAMEPLAY =
  /\b(reaction|reacts?|review|explained|analysis|trailer|teaser|meme|funny|top \d+|ranking|ranked|tier list|news|podcast|stream highlights|mod|modded|speedrun|glitch|tutorial|how to|asmr|music|ost|soundtrack|cinematic movie|all cutscenes)\b/i;
const GAMEPLAY =
  /\b(gameplay|walkthrough|playthrough|mission|level|no commentary|full game|campaign|chapter|part \d+)\b/i;

/** Does a video title name this game (and not a sibling in its series) and promise gameplay? */
export function gameplayTitleFits(
  title: string,
  game: string,
  franchise: string,
): boolean {
  if (NOT_GAMEPLAY.test(title) || !GAMEPLAY.test(title)) return false;
  const words = distinguishing(game, franchise);
  if (words.length) return trailerMatchesGame(title, game, franchise);
  // The first game shares the series name: the title must name the series and no numbered sibling.
  const t = title.toLowerCase();
  return (
    t.includes(franchise.toLowerCase()) &&
    !/\b(2|3|4|5|6|ii|iii|iv|v|vi)\b/.test(
      t.replace(franchise.toLowerCase(), ""),
    )
  );
}

/** ISO 8601 duration ("PT1H2M3S") in seconds. */
export function isoSeconds(d: string): number {
  const m = d.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m
    ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
    : 0;
}

/** YouTube's own search page through yt-dlp: no API quota. Creative Commons uses the page's own licence filter. */
async function pageSearch(
  q: string,
  creativeCommons: boolean,
): Promise<
  | Array<{
      videoId: string;
      title: string;
      description: string;
      channelId: string;
      channelTitle: string;
    }>
  | undefined
> {
  const ytdlp = process.env.YTDLP_PATH || "yt-dlp";
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}${creativeCommons ? "&sp=EgIwAQ%253D%253D" : ""}`;
  try {
    const { stdout } = await run(
      ytdlp,
      [
        ...YTDLP_TEXT.args,
        "--no-warnings",
        "--flat-playlist",
        "--playlist-end",
        "15",
        "--print",
        "%(id)s\t%(channel_id)s\t%(channel)s\t%(title)s",
        url,
      ],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: YTDLP_TEXT.env },
    );
    const rows = String(stdout)
      .split(/\r?\n/)
      .map((l) => l.split("\t"))
      .filter((r) => r.length >= 4 && /^[\w-]{11}$/.test(r[0]!))
      .map(([videoId, channelId, channelTitle, ...title]) => ({
        videoId: videoId!,
        channelId: channelId === "NA" ? "" : channelId!,
        channelTitle: channelTitle === "NA" ? "" : channelTitle!,
        title: title.join("\t"),
        description: "",
      }));
    return rows.length ? rows : undefined;
  } catch (err) {
    log("warn", "page search failed; using the API", {
      q,
      error: errorMessage(err).split("\n").pop(),
    });
    return undefined;
  }
}

/** A "no HUD" search first, then the plain one, merged: clean recordings lead the list. */
async function cleanFirst(
  token: () => Promise<string>,
  q: string,
  extra: string,
  quotaOk?: () => Promise<boolean>,
): Promise<Awaited<ReturnType<typeof search>>> {
  const clean = await search(token, `${q} no hud`, extra, quotaOk).catch(
    () => [],
  );
  const plain = await search(token, q, extra, quotaOk).catch(() => []);
  const seen = new Set<string>();
  return [...clean, ...plain].filter(
    (i) => !seen.has(i.videoId) && seen.add(i.videoId),
  );
}

/** Free search first; the Data API (about 100 quota units a call) only when the page search fails. */
async function search(
  token: () => Promise<string>,
  q: string,
  extra: string,
  quotaOk?: () => Promise<boolean>,
): Promise<
  Array<{
    videoId: string;
    title: string;
    description: string;
    channelId: string;
    channelTitle: string;
  }>
> {
  const free = await pageSearch(q, /videoLicense=creativeCommon/.test(extra));
  if (free) return free;
  if (quotaOk && !(await quotaOk())) return [];
  return apiSearch(token, q, extra);
}

async function apiSearch(
  token: () => Promise<string>,
  q: string,
  extra: string,
): Promise<
  Array<{
    videoId: string;
    title: string;
    description: string;
    channelId: string;
    channelTitle: string;
  }>
> {
  const res = await fetchWithTimeout(
    `${API}/search?part=snippet&type=video&maxResults=15&order=relevance&q=${encodeURIComponent(q)}${extra}`,
    { headers: { authorization: `Bearer ${await token()}` } },
    20_000,
  );
  if (!res.ok) throw new Error(`youtube search HTTP ${res.status}`);
  return (((await res.json()) as any).items ?? [])
    .map((i: any) => ({
      videoId: String(i.id?.videoId ?? ""),
      title: String(i.snippet?.title ?? ""),
      description: String(i.snippet?.description ?? ""),
      channelId: String(i.snippet?.channelId ?? ""),
      channelTitle: String(i.snippet?.channelTitle ?? ""),
    }))
    .filter((i: { videoId: string }) => i.videoId);
}

/** The licence and length of each video, from the video itself (1 unit). */
async function details(
  token: () => Promise<string>,
  ids: string[],
): Promise<
  Map<
    string,
    {
      license: string;
      seconds: number;
      embeddable: boolean;
      description: string;
    }
  >
> {
  const out = new Map<
    string,
    {
      license: string;
      seconds: number;
      embeddable: boolean;
      description: string;
    }
  >();
  if (!ids.length) return out;
  const res = await fetchWithTimeout(
    `${API}/videos?part=status,contentDetails,snippet&id=${ids.join(",")}`,
    { headers: { authorization: `Bearer ${await token()}` } },
    20_000,
  );
  if (!res.ok) return out;
  for (const v of ((await res.json()) as any).items ?? [])
    out.set(String(v.id), {
      license: String(v.status?.license ?? ""),
      seconds: isoSeconds(String(v.contentDetails?.duration ?? "")),
      embeddable: Boolean(v.status?.embeddable),
      description: String(v.snippet?.description ?? ""),
    });
  return out;
}

export const GameplayJudgeSchema = z.object({
  keep: z
    .array(z.number().int())
    .describe(
      "Indices of videos that show gameplay of exactly this game, best first",
    ),
});

/**
 * Titles alone cannot tell Black Ops from Black Ops 6, or Call of Duty 4 (2007)
 * from Modern Warfare 4 (2026): a reader checks each title and description.
 */
const ROMAN_N: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
  xiii: "13",
  xiv: "14",
  xv: "15",
  xvi: "16",
};
const SEQUEL_RE =
  /(?<![a-z0-9])(?:(\d{1,2})|(ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi))(?![a-z0-9])/g;

/**
 * The entry number a title gives a series: the first number or Roman numeral after the series name,
 * as digits ("GTA VI" and "GTA 6" both give "6"; "GTA 6 Trailer 2" gives "6"; "Hades" gives undefined).
 * `series` is the name without its number; an empty series takes the title's first number.
 */
export function entryNumber(title: string, series = ""): string | undefined {
  const t = title.toLowerCase();
  const at = series
    ? t.indexOf(
        series
          .toLowerCase()
          .replace(/[®™©:]/g, "")
          .trim(),
      )
    : 0;
  if (at < 0) return undefined;
  const tail = t.slice(at + series.length);
  const m = SEQUEL_RE.exec(tail);
  SEQUEL_RE.lastIndex = 0;
  if (!m) return undefined;
  // The number must come straight after the series name (a word or two of edition text at most), and
  // not after a word that numbers something else: "part 2", "trailer 2", "mission 4".
  const gap = tail
    .slice(0, m.index)
    .replace(/[^a-z]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (
    gap.length > 2 ||
    /^(part|episode|ep|trailer|chapter|mission|level|day|act|season|vol|volume)$/.test(
      gap[gap.length - 1] ?? "",
    )
  )
    return undefined;
  const n = m[1] ?? ROMAN_N[m[2]!];
  return n && Number(n) <= 16 ? String(Number(n)) : undefined;
}

/** The series name of a game: its title with the entry number and anything after it removed. */
export function seriesName(game: string): string {
  const g = game.replace(/[®™©]/g, "");
  const m = new RegExp(SEQUEL_RE.source, "i").exec(g.toLowerCase());
  return (m ? g.slice(0, m.index) : g).replace(/[:\-–—\s]+$/, "").trim();
}

/** Short series names as fans write them, so "GTA 6" matches "Grand Theft Auto VI". */
const SHORT: Record<string, string> = {
  "grand theft auto": "gta",
  "call of duty": "cod",
  "final fantasy": "ff",
  "resident evil": "re",
  "the legend of zelda": "zelda",
  "assassin's creed": "ac",
};

/**
 * A title that names a different entry in the series than the one wanted. "GTA VI" requested and a
 * "GTA V" trailer supplied passed the model's judgement once (audit, 24 Oct 2026); this is the hard rule,
 * applied before and after the model's opinion.
 */
export function wrongEntry(game: string, title: string): boolean {
  const series = seriesName(game);
  const want = entryNumber(game, series);
  // The series as the title may write it: the full name, its last part ("Modern Warfare" for
  // "Call of Duty: Modern Warfare"), or the fans' short form; the longest one present decides.
  const parts = series.split(/\s*[:\-–—]\s*/).filter(Boolean);
  const names = [
    series,
    ...parts.slice(1),
    parts[0],
    SHORT[series.toLowerCase()],
    SHORT[(parts[0] ?? "").toLowerCase()],
  ]
    .filter((x): x is string => !!x && x.length >= 3)
    .sort((a, b) => b.length - a.length);
  const found = names.find((n) =>
    title.toLowerCase().includes(n.toLowerCase()),
  );
  if (!found) return false; // the title does not name the series at all: the model decides
  const have = entryNumber(title, found);
  return (want ?? "1") !== (have ?? "1");
}

export async function judgeGameplay(
  llm: Llm,
  game: string,
  year: number | undefined,
  items: Array<{ title: string; description: string; channelTitle: string }>,
  scope?: "campaign",
): Promise<number[]> {
  if (!items.length) return [];
  // The hard rule first: nothing naming a different entry reaches the model, and nothing it keeps may either.
  const allowed = new Set(
    items.map((v, i) => i).filter((i) => !wrongEntry(game, items[i]!.title)),
  );
  if (!allowed.size) return [];
  const r = await llm.structured({
    tier: "low",
    system:
      'You check YouTube search results for a video editor. Keep only videos that show gameplay of exactly the named game (that release, not another entry in the series, a remake or remaster with rebuilt visuals under a different name, a sequel, a mod, a reaction, a compilation of several games or a news video). An official re-release of the same game that keeps its look counts as that game: an anniversary edition, a port or an HD re-release ("Grand Theft Auto III: 10 Year Anniversary Edition" shows Grand Theft Auto III).',
    content: `Game: ${game}${year ? ` (${year})` : ""}${scope === "campaign" ? "\nThe video is about the single-player campaign: keep only campaign or story footage; reject multiplayer, Zombies, Warzone, co-op and Spec Ops videos." : ""}\n\nVideos:\n${items.map((v, i) => `${i}. "${v.title}" by ${v.channelTitle}: ${v.description.slice(0, 200)}`).join("\n")}`,
    schema: GameplayJudgeSchema,
    effort: "low",
  });
  return [...new Set(r.keep)].filter(
    (i) => i >= 0 && i < items.length && allowed.has(i),
  );
}

/** Up to `max` gameplay videos of the game: Creative Commons first, then the publisher's own uploads. */
export async function findGameplay(
  token: () => Promise<string>,
  game: string,
  franchise: string,
  opts: {
    max?: number;
    quotaOk?: () => Promise<boolean>;
    year?: number;
    llm?: Llm;
    scope?: "campaign";
  } = {},
): Promise<GameplaySource[]> {
  const max = opts.max ?? 2;
  const out: GameplaySource[] = [];
  const q =
    `${game}${opts.year ? ` ${opts.year}` : ""} ${opts.scope === "campaign" ? "campaign mission" : ""} gameplay`.replace(
      /\s+/g,
      " ",
    );
  const judged = async <
    T extends { title: string; description: string; channelTitle: string },
  >(
    items: T[],
  ): Promise<T[]> => {
    if (!opts.llm || !items.length) return items;
    const keep = await judgeGameplay(
      opts.llm,
      game,
      opts.year,
      items,
      opts.scope,
    ).catch(() => items.map((_, k) => k));
    return keep.map((k) => items[k]!);
  };
  {
    const items = await judged(
      (
        await cleanFirst(
          token,
          q,
          "&videoLicense=creativeCommon&videoDuration=medium",
          opts.quotaOk,
        )
      ).filter((i) => gameplayTitleFits(i.title, game, franchise)),
    );
    const meta = await details(
      token,
      items.map((i) => i.videoId),
    );
    for (const i of items) {
      const m = meta.get(i.videoId);
      // The licence is read from the video, not trusted from the search filter.
      if (!m || m.license !== "creativeCommon" || m.seconds < 120) continue;
      out.push({
        videoId: i.videoId,
        title: i.title,
        channelTitle: i.channelTitle,
        url: `https://www.youtube.com/watch?v=${i.videoId}`,
        kind: "cc",
        durationSeconds: m.seconds,
        chapters: videoChapters(m.description),
      });
      if (out.length >= max) return out;
    }
  }
  {
    const items = await judged(
      (
        await search(token, `${game} official gameplay`, "", opts.quotaOk)
      ).filter(
        // Publishers that cap or forbid footage (Rockstar, Nintendo) are left out here.
        (i) =>
          PUBLISHER_CHANNELS.some(
            (r) => r.match.test(i.channelTitle.trim()) && r.clipSeconds >= 10,
          ) && gameplayTitleFits(i.title, game, franchise),
      ),
    );
    const meta = await details(
      token,
      items.map((i) => i.videoId),
    );
    for (const i of items) {
      const m = meta.get(i.videoId);
      if (!m || m.seconds < 60) continue;
      out.push({
        videoId: i.videoId,
        title: i.title,
        channelTitle: i.channelTitle,
        url: `https://www.youtube.com/watch?v=${i.videoId}`,
        kind: "official",
        durationSeconds: m.seconds,
        chapters: videoChapters(m.description),
      });
      if (out.length >= max) break;
    }
  }
  return out;
}

/** A video's chapter list from its description: lines such as "12:34 Phnom Penh" or "1:02:03 - Finale". */
export function videoChapters(
  description: string,
): Array<{ at: number; title: string }> {
  const out: Array<{ at: number; title: string }> = [];
  for (const line of description.split(/\r?\n/)) {
    const m = line.match(
      /^\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:|]?\s*(.{2,80})$/,
    );
    if (!m) continue;
    const at = m[1]!
      .split(":")
      .map(Number)
      .reduce((n, x) => n * 60 + x, 0);
    if (out.length && at <= out[out.length - 1]!.at) continue;
    out.push({ at, title: m[2]!.trim() });
  }
  return out.length >= 3 ? out : [];
}

const CHAPTER_STOP = new Set(
  "the a an of and in on to for with at by from is it its this that part mission chapter level gameplay walkthrough".split(
    " ",
  ),
);
const chapterWords = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !CHAPTER_STOP.has(w));

/**
 * The chapter of a long playthrough that the lines name ("the Phnom Penh mission", "the Heist"), so that
 * part is downloaded instead of the game's opening minutes (29 Oct 2026 review: every gameplay clip came
 * from the first five minutes). The game's own name never counts as a match.
 */
export function chapterFor(
  chapters: Array<{ at: number; title: string }>,
  targets: Array<{ text: string; keywords: string[] }>,
  game: string,
): { at: number; title: string } | undefined {
  if (!chapters.length) return undefined;
  const skip = new Set(chapterWords(game));
  const want = new Map<string, number>();
  for (const t of targets)
    for (const w of chapterWords(`${t.keywords.join(" ")} ${t.text}`))
      if (!skip.has(w)) want.set(w, (want.get(w) ?? 0) + 1);
  let best: { at: number; title: string } | undefined;
  let bestScore = 0;
  for (const c of chapters) {
    const score = chapterWords(c.title)
      .filter((w) => !skip.has(w))
      .reduce((n, w) => n + (want.get(w) ?? 0), 0);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** A slice of the video (skipping the intro, or the chapter the lines name), video only, at most 720p. */
async function downloadSlice(
  src: GameplaySource,
  dest: string,
  ytdlp: string,
  aim?: { targets: Array<{ text: string; keywords: string[] }>; game: string },
): Promise<number> {
  const named = aim && chapterFor(src.chapters ?? [], aim.targets, aim.game);
  const next = named && src.chapters!.find((c) => c.at > named.at);
  const from = named
    ? Math.min(named.at, Math.max(0, src.durationSeconds - 60))
    : Math.min(60, Math.floor(src.durationSeconds * 0.1));
  const to = Math.min(
    src.durationSeconds - 15,
    from + 300,
    next ? Math.max(from + 60, next.at) : Infinity,
  );
  if (named)
    log("info", "gameplay chapter chosen", {
      video: src.videoId,
      chapter: named.title,
      from,
    });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await run(
    ytdlp,
    [
      "--no-playlist",
      "--no-warnings",
      "-f",
      "bv*[height<=720][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=720][ext=mp4]+ba/b[height<=720][ext=mp4]",
      "--merge-output-format",
      "mp4",
      "--download-sections",
      `*${from}-${to}`,
      "-o",
      dest,
      src.url,
    ],
    { timeout: 240_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return to - from;
}

/**
 * Crops the edge where on-screen text sits off a clip, in place: the bottom quarter (subtitles, older
 * games' mission and pager text) or the top quarter (tutorial prompts, objective lines).
 */
export async function cropEdge(
  file: string,
  edge: "top" | "bottom",
): Promise<boolean> {
  const tmp = file.replace(/\.mp4$/, ".crop.mp4");
  try {
    await run(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-i",
      file,
      "-vf",
      edge === "bottom"
        ? "crop=iw:trunc(ih*0.74/2)*2:0:0"
        : "crop=iw:trunc(ih*0.74/2)*2:0:trunc(ih*0.26/2)*2",
      "-c:v",
      "libx264",
      "-crf",
      "17",
      "-preset",
      "fast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      tmp,
    ]);
    await fs.rename(tmp, file);
    return true;
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    return false;
  }
}

export type FrameVerdict =
  | "facecam"
  | "gore"
  | "text-top"
  | "text-bottom"
  | "text-both"
  | undefined;

/** Where text was seen across a clip's sampled frames, as a verdict: both edges loses the clip. */
export function textVerdict(top: boolean, bottom: boolean): FrameVerdict {
  return top && bottom
    ? "text-both"
    : top
      ? "text-top"
      : bottom
        ? "text-bottom"
        : undefined;
}

/**
 * Three full-size frames from a clip (early, middle, late), through the local screen in one batch: a
 * facecam or overlay, gore, or writing along the top or bottom centre (subtitles, tutorial prompts,
 * objective lines). One frame at 0.8 s missed a cutscene's subtitles later in a clip and a tutorial
 * line along the top (GTA ranking, 21 Oct 2026). HUD in the corners does not count.
 */
export async function frameProblem(file: string): Promise<FrameVerdict> {
  const frames = [0, 1, 2].map((k) => file.replace(/\.mp4$/, `.check${k}.jpg`));
  const bands: string[] = [];
  try {
    const { stdout } = await run(FFPROBE, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ]);
    const seconds = Number(String(stdout).trim()) || 3;
    const at = [
      Math.min(0.8, seconds * 0.2),
      seconds * 0.5,
      Math.max(0, seconds - 0.8),
    ];
    for (const [k, t] of at.entries())
      await run(FFMPEG, [
        "-v",
        "error",
        "-y",
        "-ss",
        t.toFixed(2),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "scale=960:-2",
        frames[k]!,
      ]);
    const flags = await screenFrames(frames);
    if (flags.some((f) => f?.webcam)) return "facecam";
    if (flags.some((f) => f?.gore)) return "gore";
    // Only writing in the centre of the top or bottom band counts: the whole-frame text flag also
    // fires on objective markers and HUD.
    const texty = frames.filter((_, k) => flags[k]?.text);
    if (!texty.length) return undefined;
    const pairs: Array<["top" | "bottom", string]> = [];
    for (const [k, f] of texty.entries())
      for (const edge of ["top", "bottom"] as const) {
        const b = file.replace(/\.mp4$/, `.band${k}${edge[0]}.jpg`);
        await run(FFMPEG, [
          "-v",
          "error",
          "-y",
          "-i",
          f,
          "-vf",
          edge === "bottom"
            ? "crop=iw*0.5:ih*0.22:iw*0.25:ih*0.76"
            : "crop=iw*0.5:ih*0.22:iw*0.25:0",
          b,
        ]);
        bands.push(b);
        pairs.push([edge, b]);
      }
    const seen = await screenFrames(pairs.map(([, b]) => b));
    // Subtitles and prompts persist; a misread (HUD numbers, a passing sign) flickers. One frame of
    // "text" at each edge dropped 46 of 98 GTA clips (23 Oct 2026); it now takes two of the three
    // sampled frames (or the only one, for a clip with a single texty frame sampled).
    const need = Math.min(2, texty.length);
    const has = (edge: "top" | "bottom") =>
      pairs.filter(([e], k) => e === edge && seen[k]?.text && !seen[k]?.hud)
        .length >= need;
    return textVerdict(has("top"), has("bottom"));
  } catch {
    return undefined;
  } finally {
    for (const f of [...frames, ...bands])
      await fs.rm(f, { force: true }).catch(() => undefined);
  }
}

/**
 * Edits inside a gameplay clip (seconds). Recordings were treated as one continuous take, but
 * many uploads are edited: a jump inside the same street read as a glitch (GTA ranking at 9:59,
 * 23 Oct 2026). A jump is a scene score of 0.3 or more, or one at least three times the typical
 * score around it; a run of moderate scores is fast motion (a turn, an explosion), not an edit.
 */
export function clipJumps(
  rows: Array<{ time: number; scene?: number }>,
): number[] {
  const end = rows.at(-1)?.time ?? 0;
  const out: number[] = [];
  for (const [i, r] of rows.entries()) {
    const sc = r.scene ?? 0;
    if (sc < 0.12 || r.time <= 0.1 || r.time >= end - 0.1) continue;
    const near = rows
      .filter((x, k) => k !== i && Math.abs(x.time - r.time) <= 0.5)
      .map((x) => x.scene ?? 0)
      .sort((a, b) => a - b);
    const typical = near.length ? near[Math.floor(near.length / 2)]! : 0;
    if (sc >= 0.3 || sc >= 3 * typical) {
      if (out.length && r.time - out[out.length - 1]! <= 0.25)
        out[out.length - 1] = r.time;
      else out.push(r.time);
    }
  }
  return out;
}

/** The longest stretch of a clip with no jump in it, as [start, length] in seconds. */
export function longestRun(jumps: number[], seconds: number): [number, number] {
  const edges = [0, ...jumps, seconds];
  let best: [number, number] = [0, 0];
  for (let k = 0; k + 1 < edges.length; k++) {
    // A frame either side of the edit stays out: the cut frame belongs to neither shot.
    const a = k === 0 ? 0 : edges[k]! + 1 / 30;
    const b = k + 1 === edges.length - 1 ? seconds : edges[k + 1]! - 1 / 30;
    if (b - a > best[1]) best = [a, b - a];
  }
  return best;
}

/**
 * Trims a gameplay clip, in place, to its longest stretch without an edit. Returns its new length,
 * the old one when it had no jump, or undefined when no stretch is long enough to use.
 */
export async function trimToJumpFree(
  file: string,
): Promise<number | undefined> {
  const dir = path.dirname(file);
  const stats = `${path.basename(file)}.scenes.txt`;
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      path.basename(file),
      "-vf",
      `scale=320:-2,select='gte(scene,0)',signalstats,metadata=print:file=${stats}`,
      "-an",
      "-f",
      "null",
      "-",
    ],
    { cwd: dir, maxBuffer: 32 * 1024 * 1024 },
  );
  const rows = parseSignalStats(
    await fs.readFile(path.join(dir, stats), "utf8"),
  );
  await fs.rm(path.join(dir, stats), { force: true });
  const seconds = (rows.at(-1)?.time ?? 0) + 1 / 30;
  const jumps = clipJumps(rows);
  if (!jumps.length) return seconds;
  const [from, len] = longestRun(jumps, seconds);
  if (len < MIN_CLIP_SECONDS) return undefined;
  const tmp = file.replace(/\.mp4$/, ".trim.mp4");
  await run(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-ss",
    from.toFixed(3),
    "-i",
    file,
    "-t",
    len.toFixed(3),
    "-c:v",
    "libx264",
    "-crf",
    "17",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    tmp,
  ]);
  await fs.rename(tmp, file);
  return Math.round(len * 30) / 30;
}

/** The credit a gameplay clip carries on screen. */
export function gameplayCredit(
  src: Pick<GameplaySource, "channelTitle" | "kind">,
): string {
  return src.kind === "cc"
    ? `GAMEPLAY: ${src.channelTitle.toUpperCase().slice(0, 40)} / CC BY`
    : `GAMEPLAY: ${src.channelTitle.toUpperCase().slice(0, 40)}`;
}

/** Gameplay moments matched to the given lines; each clip names its source and credit. */
/**
 * Missions, levels and set pieces the shot list names ("All Ghillied Up",
 * "Clean House"): capitalised multi-word keywords that are not just the
 * game's own name, with the lines that ask for each. Names the shot list
 * calls a mission or level come first.
 */
const GENERIC_WORDS =
  /^(campaign|campaigns|mission|missions|level|levels|game|games|story|series|studio|trilogy|remaster|remastered|edition|version|reboot|sequel|original|new|\d{4}|[ivx]+|\d+)$/i;
const STUDIOS =
  /\b(infinity ward|treyarch|sledgehammer( games)?|raven software|activision|blizzard|ubisoft|electronic arts|bethesda|rockstar( games)?|naughty dog|bungie|343 industries|respawn|bioware|cd projekt|square enix|capcom|nintendo|sony|microsoft|xbox game studios|playstation studios|epic games|valve|beenox|high moon)\b/i;

export function namedThings(
  targets: FootageTarget[],
  game: string,
  franchise: string,
): Array<{ name: string; keys: string[] }> {
  const gameWords = new Set(normTitle(`${game} ${franchise}`).split(" "));
  const found = new Map<
    string,
    { name: string; keys: string[]; mission: boolean }
  >();
  for (const t of targets) {
    for (const raw of t.keywords) {
      // The game's own name in front ("World at War Makin Atoll") is dropped: the search adds it anyway.
      const all = raw
        .trim()
        .replace(/^["'“‘]|["'”’]$/g, "")
        .split(/\s+/);
      while (all.length > 2 && gameWords.has(normTitle(all[0]!))) all.shift();
      const name = all.join(" ");
      const words = name.split(/\s+/);
      if (words.length < 2 || words.length > 5) continue;
      const caps = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
      if (caps < Math.ceil(words.length * 0.6)) continue;
      // Nothing left once the game's own words and generic words are taken out ("Modern Warfare 2019", "Cold War campaign").
      const distinct = words.filter(
        (w) => !gameWords.has(normTitle(w)) && !GENERIC_WORDS.test(w),
      );
      if (!distinct.length) continue;
      // Studios and publishers are not footage.
      if (STUDIOS.test(name)) continue;
      const key = normTitle(name);
      const hit = found.get(key) ?? { name, keys: [], mission: false };
      if (!hit.keys.includes(t.key)) hit.keys.push(t.key);
      if (
        new RegExp(
          `(mission|level|chapter|act)[^.]{0,30}${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^.]{0,20}(mission|level|chapter)`,
          "i",
        ).test(t.text)
      )
        hit.mission = true;
      found.set(key, hit);
    }
  }
  return [...found.values()]
    .sort(
      (x, y) =>
        Number(y.mission) - Number(x.mission) || y.keys.length - x.keys.length,
    )
    .map(({ name, keys }) => ({ name, keys }));
}

/** Licensed gameplay of one named mission: a Creative Commons video whose title names both the game and the mission. */
export async function findMissionGameplay(
  token: () => Promise<string>,
  game: string,
  franchise: string,
  mission: string,
  opts: {
    quotaOk?: () => Promise<boolean>;
    year?: number;
    llm?: Llm;
    scope?: "campaign";
  } = {},
): Promise<GameplaySource | undefined> {
  const want = normTitle(mission);
  const items = (
    await cleanFirst(
      token,
      `${game} ${mission}`,
      "&videoLicense=creativeCommon",
      opts.quotaOk,
    )
  ).filter((i) => {
    const t = normTitle(i.title);
    return (
      t.includes(want) &&
      !NOT_GAMEPLAY.test(i.title) &&
      (trailerMatchesGame(i.title, game, franchise) ||
        gameplayTitleFits(`${i.title} gameplay`, game, franchise))
    );
  });
  const kept =
    opts.llm && items.length
      ? (
          await judgeGameplay(
            opts.llm,
            game,
            opts.year,
            items,
            opts.scope,
          ).catch(() => items.map((_, k) => k))
        ).map((k) => items[k]!)
      : items;
  const meta = await details(
    token,
    kept.map((i) => i.videoId),
  );
  for (const i of kept) {
    const m = meta.get(i.videoId);
    // The licence is read from the video, not trusted from the search filter.
    if (!m || m.license !== "creativeCommon" || m.seconds < 45) continue;
    return {
      videoId: i.videoId,
      title: i.title,
      channelTitle: i.channelTitle,
      url: `https://www.youtube.com/watch?v=${i.videoId}`,
      kind: "cc",
      durationSeconds: m.seconds,
      chapters: videoChapters(m.description),
    };
  }
  return undefined;
}

type GameplayClipOpts = {
  token: () => Promise<string>;
  llm?: Llm;
  ytdlp: string;
  game: string;
  franchise: string;
  year?: number;
  episodeDir: string;
  targets: FootageTarget[];
  maxClips: number;
  quotaOk?: () => Promise<boolean>;
  scope?: "campaign";
};

/** Downloads a section of each source and matches its moments to the lines. */
async function clipsFrom(
  o: GameplayClipOpts,
  sources: GameplaySource[],
  targets: FootageTarget[],
  maxClips: number,
  prefix: string,
): Promise<Array<VisualAsset & { credit: string }>> {
  if (!sources.length || !targets.length || maxClips <= 0) return [];
  const work = path.join(o.episodeDir, prefix);
  const files: Array<{
    file: string;
    name: string;
    url: string;
    total: number;
    src: GameplaySource;
  }> = [];
  for (const [i, src] of sources.entries()) {
    const file = path.join(work, `${prefix}_${i}.mp4`);
    try {
      const total = await downloadSlice(src, file, o.ytdlp, {
        targets,
        game: o.game,
      });
      files.push({ file, name: src.title, url: src.url, total, src });
    } catch (err) {
      log("warn", "gameplay download failed", {
        videoId: src.videoId,
        error: errorMessage(err).split("\n").pop(),
      });
    }
  }
  if (!files.length) return [];
  const clips = await matchClips({
    trailers: files.map((f) => ({
      file: f.file,
      name: f.name,
      url: f.url,
      total: f.total,
    })),
    episodeDir: o.episodeDir,
    targets,
    maxClips,
    llm: o.llm,
    prefix,
    // Gameplay has long unbroken shots: up to eight seconds a moment.
    clipSeconds: 8,
    continuous: true,
    describe: (t, seconds, at) => {
      const src = files.find((f) => f.url === t.url)!.src;
      return src.kind === "cc"
        ? `Gameplay "${t.name.slice(0, 80)}" by ${src.channelTitle}, Creative Commons Attribution licence (CC BY) (${t.url}), ${seconds}s at ${at.toFixed(1)}s of the downloaded section, muted`
        : `Official gameplay "${t.name.slice(0, 80)}" from the ${src.channelTitle} YouTube channel, publisher: ${src.channelTitle} (${t.url}), ${seconds}s at ${at.toFixed(1)}s of the downloaded section, muted`;
    },
  }).catch((err) => {
    log("warn", "gameplay matching failed", {
      game: o.game,
      error: errorMessage(err),
    });
    return [] as VisualAsset[];
  });
  await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  const out: Array<VisualAsset & { credit: string }> = [];
  const streamed = new Set<string>();
  for (const c of clips) {
    const src =
      files.find((f) => c.provenance.includes(f.url))?.src ?? files[0]!.src;
    // A full-size look at the finished clip: a small facecam is a few pixels in the matcher's
    // 320 px keyframes. A facecam or gore drops the clip and every other clip from that channel.
    const file = path.join(o.episodeDir, c.file);
    let verdict: FrameVerdict = streamed.has(src.url)
      ? "facecam"
      : await frameProblem(file);
    // Text along one edge (subtitles, mission text, a tutorial prompt) is cropped away instead of
    // losing the clip: the rest of the picture is still good footage. Text at both edges loses it.
    const edge =
      verdict === "text-top"
        ? "top"
        : verdict === "text-bottom"
          ? "bottom"
          : undefined;
    if (edge && (await cropEdge(file, edge))) {
      log("info", `gameplay clip cropped clear of its ${edge} text`, {
        game: o.game,
        source: src.channelTitle,
      });
      verdict = undefined;
    }
    if (verdict) {
      // A facecam or gore condemns the channel; burned-in text only this clip.
      if (verdict === "facecam" || verdict === "gore") streamed.add(src.url);
      await fs.rm(file, { force: true }).catch(() => undefined);
      log("info", "gameplay clip dropped", {
        game: o.game,
        source: src.channelTitle,
        reason: verdict,
      });
      continue;
    }
    // An edit inside the recording would read as a glitch: the clip keeps its longest unbroken stretch.
    const length = await trimToJumpFree(file).catch(() => c.durationSeconds);
    if (length === undefined) {
      await fs.rm(file, { force: true }).catch(() => undefined);
      log("info", "gameplay clip dropped", {
        game: o.game,
        source: src.channelTitle,
        reason: "edits",
      });
      continue;
    }
    if (length < (c.durationSeconds ?? length) - 0.05) {
      log("info", "gameplay clip trimmed clear of an edit", {
        game: o.game,
        source: src.channelTitle,
        seconds: length,
      });
      c.durationSeconds = length;
    }
    // Game sound stays when nobody talks over it (commentary or cutscene dialogue would fight the narrator).
    const audio = await keepGameSound(path.join(o.episodeDir, c.file)).catch(
      () => false,
    );
    out.push({
      ...c,
      audio,
      provenance: audio
        ? c.provenance.replace(/, muted$/, ", with game sound")
        : c.provenance,
      credit: gameplayCredit(src),
    });
  }
  const sound = out.filter((c) => c.audio).length;
  if (out.length)
    log("info", "gameplay sound", {
      game: o.game,
      clips: out.length,
      withSound: sound,
    });
  return out;
}

/**
 * Gameplay moments matched to the given lines; each clip names its source and
 * credit. A mission the narration names is searched for on its own first, so
 * the line about "All Ghillied Up" shows All Ghillied Up; the game's general
 * gameplay covers the rest.
 */
export async function gameplayClips(
  o: GameplayClipOpts,
): Promise<Array<VisualAsset & { credit: string }>> {
  if (!o.targets.length || o.maxClips <= 0) return [];
  const out: Array<VisualAsset & { credit: string }> = [];
  for (const [k, n] of namedThings(o.targets, o.game, o.franchise)
    .slice(0, 3)
    .entries()) {
    if (out.length >= o.maxClips) break;
    const src = await findMissionGameplay(
      o.token,
      o.game,
      o.franchise,
      n.name,
      { quotaOk: o.quotaOk, year: o.year, llm: o.llm, scope: o.scope },
    ).catch(() => undefined);
    if (!src) {
      log("info", "no licensed footage of a named mission", {
        game: o.game,
        mission: n.name,
      });
      continue;
    }
    const targets = o.targets.filter((t) => n.keys.includes(t.key));
    const got = await clipsFrom(
      o,
      [src],
      targets,
      Math.min(targets.length, o.maxClips - out.length),
      `gameplay_m${k}`,
    );
    log("info", "named mission footage", {
      game: o.game,
      mission: n.name,
      clips: got.length,
    });
    out.push(...got);
  }
  const covered = new Set(
    out.map((c) => c.moment).filter((m): m is number => m !== undefined),
  );
  const rest = o.targets.filter((t) => {
    const m = t.key.match(/#m(\d+)$/)?.[1];
    return m === undefined || !covered.has(Number(m));
  });
  if (out.length >= o.maxClips || !rest.length) return out;
  const sources = await findGameplay(o.token, o.game, o.franchise, {
    max: 4,
    quotaOk: o.quotaOk,
    year: o.year,
    llm: o.llm,
    scope: o.scope,
  }).catch((err) => {
    log("warn", "gameplay search failed", {
      game: o.game,
      error: errorMessage(err),
    });
    return [] as GameplaySource[];
  });
  if (!sources.length) {
    log("info", "no licensed gameplay found", { game: o.game });
    return out;
  }
  out.push(
    ...(await clipsFrom(o, sources, rest, o.maxClips - out.length, "gameplay")),
  );
  return out;
}
