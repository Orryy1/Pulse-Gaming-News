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
import { matchClips, type FootageTarget } from "./clipscore.ts";
import { keepGameSound } from "./talk.ts";
import { screenFrames } from "./localvision.ts";
import { FFMPEG } from "../lib/bin.ts";
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
): Promise<Array<{ videoId: string; title: string; description: string; channelId: string; channelTitle: string }> | undefined> {
  const ytdlp = process.env.YTDLP_PATH || "yt-dlp";
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}${creativeCommons ? "&sp=EgIwAQ%253D%253D" : ""}`;
  try {
    const { stdout } = await run(
      ytdlp,
      ["--no-warnings", "--flat-playlist", "--playlist-end", "15", "--print", "%(id)s\t%(channel_id)s\t%(channel)s\t%(title)s", url],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
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
    log("warn", "page search failed; using the API", { q, error: errorMessage(err).split("\n").pop() });
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
  const clean = await search(token, `${q} no hud`, extra, quotaOk).catch(() => []);
  const plain = await search(token, q, extra, quotaOk).catch(() => []);
  const seen = new Set<string>();
  return [...clean, ...plain].filter((i) => !seen.has(i.videoId) && seen.add(i.videoId));
}

/** Free search first; the Data API (about 100 quota units a call) only when the page search fails. */
async function search(
  token: () => Promise<string>,
  q: string,
  extra: string,
  quotaOk?: () => Promise<boolean>,
): Promise<Array<{ videoId: string; title: string; description: string; channelId: string; channelTitle: string }>> {
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
  Map<string, { license: string; seconds: number; embeddable: boolean }>
> {
  const out = new Map<
    string,
    { license: string; seconds: number; embeddable: boolean }
  >();
  if (!ids.length) return out;
  const res = await fetchWithTimeout(
    `${API}/videos?part=status,contentDetails&id=${ids.join(",")}`,
    { headers: { authorization: `Bearer ${await token()}` } },
    20_000,
  );
  if (!res.ok) return out;
  for (const v of ((await res.json()) as any).items ?? [])
    out.set(String(v.id), {
      license: String(v.status?.license ?? ""),
      seconds: isoSeconds(String(v.contentDetails?.duration ?? "")),
      embeddable: Boolean(v.status?.embeddable),
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
export async function judgeGameplay(
  llm: Llm,
  game: string,
  year: number | undefined,
  items: Array<{ title: string; description: string; channelTitle: string }>,
  scope?: "campaign",
): Promise<number[]> {
  if (!items.length) return [];
  const r = await llm.structured({
    tier: "low",
    system:
      "You check YouTube search results for a video editor. Keep only videos that show gameplay of exactly the named game (that release, not another entry in the series, a remake or remaster under a different name, a sequel, a mod, a reaction, a compilation of several games or a news video).",
    content: `Game: ${game}${year ? ` (${year})` : ""}${scope === "campaign" ? "\nThe video is about the single-player campaign: keep only campaign or story footage; reject multiplayer, Zombies, Warzone, co-op and Spec Ops videos." : ""}\n\nVideos:\n${items.map((v, i) => `${i}. "${v.title}" by ${v.channelTitle}: ${v.description.slice(0, 200)}`).join("\n")}`,
    schema: GameplayJudgeSchema,
    effort: "low",
  });
  return [...new Set(r.keep)].filter((i) => i >= 0 && i < items.length);
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
        await cleanFirst(token, q, "&videoLicense=creativeCommon&videoDuration=medium", opts.quotaOk)
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
      });
      if (out.length >= max) return out;
    }
  }
  {
    const items = await judged(
      (await search(token, `${game} official gameplay`, "", opts.quotaOk)).filter(
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
      });
      if (out.length >= max) break;
    }
  }
  return out;
}

/** A slice of the video (skipping the intro), video only, at most 720p. */
async function downloadSlice(
  src: GameplaySource,
  dest: string,
  ytdlp: string,
): Promise<number> {
  const from = Math.min(60, Math.floor(src.durationSeconds * 0.1));
  const to = Math.min(src.durationSeconds - 15, from + 300);
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

/** One full-size frame from the middle of a clip, through the local screen: a facecam or overlay, gore, or burned-in subtitles. */
async function frameProblem(file: string): Promise<"facecam" | "gore" | "subtitles" | undefined> {
  const frame = file.replace(/\.mp4$/, ".check.jpg");
  const band = file.replace(/\.mp4$/, ".band.jpg");
  try {
    await run(FFMPEG, ["-v", "error", "-y", "-ss", "0.8", "-i", file, "-frames:v", "1", "-vf", "scale=960:-2", frame]);
    const [flags] = await screenFrames([frame]);
    if (flags?.webcam) return "facecam";
    if (flags?.gore) return "gore";
    // Subtitles sit centred along the bottom; HUD (ammo, minimap) sits in the corners. Only writing
    // in that centre-bottom band counts: the whole-frame text flag also fires on objective markers.
    if (flags?.text) {
      await run(FFMPEG, ["-v", "error", "-y", "-i", frame, "-vf", "crop=iw*0.6:ih*0.22:iw*0.2:ih*0.76", band]);
      const [b] = await screenFrames([band]);
      if (b?.text && !b.hud) return "subtitles";
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await fs.rm(frame, { force: true }).catch(() => undefined);
    await fs.rm(band, { force: true }).catch(() => undefined);
  }
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
      const all = raw.trim().replace(/^["'“‘]|["'”’]$/g, "").split(/\s+/);
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
    await cleanFirst(token, `${game} ${mission}`, "&videoLicense=creativeCommon", opts.quotaOk)
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
      const total = await downloadSlice(src, file, o.ytdlp);
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
    const verdict = streamed.has(src.url) ? "facecam" : await frameProblem(file);
    if (verdict) {
      // A facecam or gore condemns the channel; burned-in subtitles only this clip.
      if (verdict !== "subtitles") streamed.add(src.url);
      await fs.rm(file, { force: true }).catch(() => undefined);
      log("info", "gameplay clip dropped", { game: o.game, source: src.channelTitle, reason: verdict });
      continue;
    }
    // Game sound stays when nobody talks over it (commentary or cutscene dialogue would fight the narrator).
    const audio = await keepGameSound(path.join(o.episodeDir, c.file)).catch(() => false);
    out.push({
      ...c,
      audio,
      provenance: audio ? c.provenance.replace(/, muted$/, ", with game sound") : c.provenance,
      credit: gameplayCredit(src),
    });
  }
  const sound = out.filter((c) => c.audio).length;
  if (out.length) log("info", "gameplay sound", { game: o.game, clips: out.length, withSound: sound });
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
