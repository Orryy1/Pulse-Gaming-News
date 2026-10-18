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
import { PUBLISHER_CHANNELS } from "./officialTrailer.ts";
import { trailerMatchesGame, distinguishing } from "./commons.ts";
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

async function search(
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
    opts: { max?: number; quotaOk?: () => Promise<boolean>; year?: number; llm?: Llm; scope?: "campaign" } = {},
): Promise<GameplaySource[]> {
  const max = opts.max ?? 2;
  const out: GameplaySource[] = [];
    const q = `${game}${opts.year ? ` ${opts.year}` : ""} ${opts.scope === "campaign" ? "campaign mission" : ""} gameplay`.replace(/\s+/g, " ");
  const judged = async <
    T extends { title: string; description: string; channelTitle: string },
  >(
    items: T[],
  ): Promise<T[]> => {
    if (!opts.llm || !items.length) return items;
    const keep = await judgeGameplay(opts.llm, game, opts.year, items, opts.scope).catch(
      () => items.map((_, k) => k),
    );
    return keep.map((k) => items[k]!);
  };
  if (!opts.quotaOk || (await opts.quotaOk())) {
    const items = await judged(
      (
        await search(
          token,
          q,
          "&videoLicense=creativeCommon&videoDuration=medium",
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
      });
      if (out.length >= max) return out;
    }
  }
  if (!opts.quotaOk || (await opts.quotaOk())) {
    const items = await judged(
      (await search(token, `${game} official gameplay`, "")).filter(
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
      "bv*[height<=720][ext=mp4][vcodec^=avc1]/bv*[height<=720][ext=mp4]/b[height<=720][ext=mp4]",
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

/** The credit a gameplay clip carries on screen. */
export function gameplayCredit(
  src: Pick<GameplaySource, "channelTitle" | "kind">,
): string {
  return src.kind === "cc"
    ? `GAMEPLAY: ${src.channelTitle.toUpperCase().slice(0, 40)} / CC BY`
    : `GAMEPLAY: ${src.channelTitle.toUpperCase().slice(0, 40)}`;
}

/** Gameplay moments matched to the given lines; each clip names its source and credit. */
export async function gameplayClips(o: {
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
}): Promise<Array<VisualAsset & { credit: string }>> {
  if (!o.targets.length || o.maxClips <= 0) return [];
  const sources = await findGameplay(o.token, o.game, o.franchise, { max: 2, quotaOk: o.quotaOk, year: o.year, llm: o.llm, scope: o.scope }).catch((err) => {
    log("warn", "gameplay search failed", {
      game: o.game,
      error: errorMessage(err),
    });
    return [] as GameplaySource[];
  });
  if (!sources.length) {
    log("info", "no licensed gameplay found", { game: o.game });
    return [];
  }
  const work = path.join(o.episodeDir, "gameplay");
  const files: Array<{
    file: string;
    name: string;
    url: string;
    total: number;
    src: GameplaySource;
  }> = [];
  for (const [i, src] of sources.entries()) {
    const file = path.join(work, `gameplay_${i}.mp4`);
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
    targets: o.targets,
        maxClips: o.maxClips,
    llm: o.llm,
    prefix: "gameplay",
    // Gameplay has long unbroken shots: up to six seconds a moment.
    clipSeconds: 6,
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
  return clips.map((c) => {
    const src =
      files.find((f) => c.provenance.includes(f.url))?.src ?? files[0]!.src;
    return { ...c, credit: gameplayCredit(src) };
  });
}
