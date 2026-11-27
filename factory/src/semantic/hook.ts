// Where meaning-based matching and the stream tags meet the footage search (src/sceneindex/footage.ts
// indexFirstCutscenes calls these):
//   - indexScorer (MATCH_SEMANTIC): the scene index's shot vectors against each line, blended into the index's word
//     lookup. No vectors yet for the index (the background turn has not reached it): undefined, the words alone.
//   - ownStreamClips (VOD_TAGS): the owner's own tagged recordings of the game searched first, the exact moment cut
//     from the recording on this machine and screened like any other clip, its story stretches held by the spoiler
//     guard. Lines it serves never go to someone else's upload.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import type { CutsceneClip } from "../assets/cutscenes.ts";
import type { FootageTarget } from "../assets/clipscore.ts";
import {
  sceneSlug,
  type SceneIndex,
  type SceneShot,
} from "../sceneindex/schema.ts";
import type { SpoilerWindow } from "../sceneindex/spoilers.ts";
import { gameAliases, windowFor } from "../sceneindex/spoilers.ts";
import {
  listVodIndexes,
  vodIndexDir,
  type VodIndex,
} from "../vodindex/schema.ts";
import {
  untagged,
  loadVodTags,
  readableInTime,
  taggedSceneIndex,
  tagsAt,
  vodMomentBlocked,
  vodMomentHeld,
  type VodTagFile,
} from "../vodindex/tags.ts";
import { sourceByChannel, vodSources, type VodSource } from "../vodindex/sources.ts";
import { sharedEmbedder, type Embedder } from "./embed.ts";
import type { SemanticSettings } from "./settings.ts";
import { loadShotVectors, targetScorer, vectorFile } from "./shots.ts";

const exec = promisify(execFile);

/** Recordings of a game searched per fetch, newest first. */
export const MAX_RECORDINGS = 10;

export type Scorer = (
  t: FootageTarget,
) => ReadonlyMap<number, number> | undefined;

export function embedderFor(dataDir: string, s: SemanticSettings): Embedder {
  return sharedEmbedder({
    python: s.python,
    model: s.model,
    device: s.device,
    cacheDir: path.join(dataDir, "semantic"),
    idleSeconds: s.idleSeconds,
    priority: s.priority,
  });
}

/** MATCH_SEMANTIC: the meaning scorer for one scene index's shots, or undefined (off, no vectors, model down). */
export async function indexScorer(
  cfg: { dataDir: string; semantic?: SemanticSettings },
  index: SceneIndex,
  targets: FootageTarget[],
  embedder?: Embedder,
): Promise<Scorer | undefined> {
  const s = cfg.semantic;
  if (!s?.enabled || !targets.length) return undefined;
  const dir = path.join(
    cfg.dataDir,
    "sceneindex",
    index.slug || sceneSlug(index.game),
  );
  const vecs = await loadShotVectors(vectorFile(dir, s.model));
  // Only a (nearly) fully embedded index: while half of it has vectors, the half without would be judged differently.
  const clean = index.shots.filter((x) => !x.blank && !x.menu).length;
  if (!vecs.size || vecs.size < 0.95 * clean) {
    log("info", "semantic: shot vectors for this index not complete yet, words alone", {
      game: index.game,
      vectors: vecs.size,
      shots: clean,
    });
    return undefined;
  }
  return targetScorer(
    embedder ?? embedderFor(cfg.dataDir, s),
    index.shots,
    vecs,
    targets,
  ).catch((err) => {
    log("warn", "semantic: line scoring failed, words alone", {
      error: errorMessage(err),
    });
    return undefined;
  });
}

/**
 * The recordings of a game (pure over the list), however either side spells it ("GTA 6" finds Grand Theft Auto VI):
 * the owner's own channel first, then the permitted channels in their order, each newest first.
 */
export function recordingsOf(
  vods: readonly VodIndex[],
  game: string,
  sources: readonly VodSource[] = [],
): VodIndex[] {
  const want = new Set(gameAliases(game).map(sceneSlug));
  const rank = (v: VodIndex) => sourceByChannel(v.channel, sources)?.rank ?? 99;
  return vods
    .filter((v) => v.game && (want.has(sceneSlug(v.game)) || gameAliases(v.game).some((a) => sceneSlug(a) === sceneSlug(game))))
    .map((v, i) => ({ v, i }))
    .sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
    .map((x) => x.v);
}

/** The provenance of a clip cut from the owner's own recording (the "own capture" prefix keeps it out of every cap). */
export function ownStreamProvenance(
  v: Pick<VodIndex, "title" | "vodId" | "recordedOn">,
  game: string,
  from: number,
  seconds: number,
): string {
  const title = v.title.replace(/[\r\n"]/g, " ");
  return `Pulse's own gameplay capture of ${game} (stream recording "${title}", ${v.vodId}${v.recordedOn ? `, ${v.recordedOn}` : ""}), ${seconds}s at ${from.toFixed(1)}s, muted`;
}

/**
 * The provenance of a clip cut from a permitted channel's recording (spencey96, owner, 25 Nov 2026): the handle and
 * Twitch only, never a personal name. The "Permitted stream capture" prefix keeps it out of the footage caps.
 */
export function permittedStreamProvenance(
  v: Pick<VodIndex, "title" | "vodId" | "recordedOn" | "channel">,
  game: string,
  from: number,
  seconds: number,
  credit: string,
): string {
  const title = v.title.replace(/[\r\n"]/g, " ");
  return `Permitted stream capture of ${game} (${credit}; stream recording "${title}", ${v.vodId}${v.recordedOn ? `, ${v.recordedOn}` : ""}), ${seconds}s at ${from.toFixed(1)}s, muted; used with the streamer's permission`;
}

/** Where ownStreamClips reads recordings from: this machine's own indexes by default, the PC's with VOD_REMOTE. */
export interface OwnStreamDeps {
  list?: (dataDir: string) => Promise<VodIndex[]>;
  readable?: typeof readableInTime;
  embedder?: Embedder;
  /** A recording's tags; this machine's tags.json by default. */
  tags?: (v: VodIndex) => Promise<VodTagFile>;
  /** The meaning scorer for a recording's shots (VOD_REMOTE: asked of the PC); unset: this machine's vectors. */
  scorer?: (v: VodIndex, targets: FootageTarget[]) => Promise<Scorer | undefined>;
  /** Cuts [from, to) of the recording into `file` (VOD_REMOTE: cut on the PC and fetched); unset: ffmpeg here. */
  cut?: (v: VodIndex, from: number, to: number, file: string) => Promise<void>;
  /** The channels and their order (src/vodindex/sources.ts); unset: from the environment. */
  sources?: VodSource[];
}

export interface OwnStreamOptions {
  gameTitle: string;
  episodeDir: string;
  targets: FootageTarget[];
  maxClips: number;
  maxSeconds: number;
  /** A long video: same rules, the story stretches stay held during the window either way. */
  long?: boolean;
}

/**
 * VOD_TAGS: clips of the owner's own play for the lines his tagged recordings show, cut from the recording itself.
 * `indexed` is src/sceneindex/footage.ts indexedCutsceneClips (passed in, so this file does not import it back).
 */
export async function ownStreamClips(
  cfg: {
    dataDir: string;
    semantic?: SemanticSettings;
    sceneIndexMinConfidence: number;
    ytdlpPath: string;
  },
  o: OwnStreamOptions,
  indexed: (x: {
    index: SceneIndex;
    gameTitle: string;
    episodeDir: string;
    targets: FootageTarget[];
    maxClips: number;
    maxSeconds: number;
    minConfidence: number;
    ytdlp: string;
    allow: (shot: SceneShot, key: string) => boolean;
    semantic?: Scorer;
    edgeText?: boolean;
    deps: {
      download: (
        videoId: string,
        from: number,
        to: number,
        file: string,
      ) => Promise<void>;
    };
  }) => Promise<CutsceneClip[]>,
  now: Date,
  windows: readonly SpoilerWindow[],
  deps: OwnStreamDeps = {},
): Promise<CutsceneClip[]> {
  const s = cfg.semantic;
  if (!s?.vodTags || !o.targets.length) return [];
  const sources = deps.sources ?? vodSources(process.env);
  // The ten newest recordings of the game at most: older moments are rarely what a line wants, and each costs a read.
  const vods = recordingsOf(
    await (deps.list ?? listVodIndexes)(cfg.dataDir).catch(() => []),
    o.gameTitle,
    sources,
  ).slice(0, MAX_RECORDINGS);
  // One drive test per folder per fetch: recordings side by side share a drive.
  const readable = new Map<string, Promise<boolean>>();
  const canRead = (file: string) => {
    const dir = path.dirname(file);
    if (!readable.has(dir)) readable.set(dir, (deps.readable ?? readableInTime)(file));
    return readable.get(dir)!;
  };
  const w = windowFor(windows, o.gameTitle, now);
  const out: CutsceneClip[] = [];
  let targets = o.targets;
  let seconds = o.maxSeconds;
  for (const v of vods) {
    if (!targets.length || out.length >= o.maxClips || seconds < 1.5) break;
    const tags = await (deps.tags ?? ((x: VodIndex) => loadVodTags(cfg.dataDir, x.vodId)))(v);
    const source = sourceByChannel(v.channel, sources);
    const own = source?.own ?? !v.channel;
    // Only a recording tagged all through: an untagged stretch could be story the guard has not seen.
    if (!Object.keys(tags.stretches).length || untagged(v, tags).length) continue;
    // The drive may be unplugged or not yet allowed for this process: tested in a child with a time limit.
    if (!(await canRead(v.file))) {
      log("info", "stream tags: recording not readable here, skipped", {
        vod: v.vodId,
      });
      continue;
    }
    const index = taggedSceneIndex(v, tags);
    // Meaning joins the words only with MATCH_SEMANTIC on; off, the tags and descriptions alone find the moment.
    // Remote recordings (VOD_REMOTE) are scored on the PC, where their shot vectors are.
    const semantic = !s.enabled
      ? undefined
      : deps.scorer
        ? await deps.scorer(v, targets).catch(() => undefined)
        : await (async () => {
            const vecs = await loadShotVectors(vectorFile(vodIndexDir(cfg.dataDir, v.vodId), s.model));
            return vecs.size
              ? targetScorer(deps.embedder ?? embedderFor(cfg.dataDir, s), index.shots, vecs, targets).catch(() => undefined)
              : undefined;
          })();
    const clips = await indexed({
      index,
      gameTitle: o.gameTitle,
      episodeDir: o.episodeDir,
      targets,
      maxClips: o.maxClips - out.length,
      maxSeconds: seconds,
      minConfidence: cfg.sceneIndexMinConfidence,
      ytdlp: cfg.ytdlpPath,
      ...(o.long ? { edgeText: false } : {}),
      allow: (shot) => {
        const tag = tagsAt(tags, (shot.start + shot.end) / 2);
        return !vodMomentBlocked(tag, own) && !vodMomentHeld(w, tag, now);
      },
      ...(semantic ? { semantic } : {}),
      deps: {
        download: async (_id, from, to, file) => {
          if (deps.cut) return deps.cut(v, from, to, file);
          await exec(
            FFMPEG,
            [
              "-loglevel",
              "error",
              "-y",
              "-ss",
              from.toFixed(2),
              "-i",
              v.file,
              "-t",
              (to - from).toFixed(2),
              "-an",
              "-sn",
              "-dn",
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "16",
              file,
            ],
            {
              timeout: 180_000,
              windowsHide: true,
              killSignal: "SIGKILL",
              maxBuffer: 1024 * 1024,
            },
          );
        },
      },
    }).catch((err) => {
      log("warn", "stream tags: own clips failed for a recording", {
        vod: v.vodId,
        error: errorMessage(err),
      });
      return [] as CutsceneClip[];
    });
    for (const c of clips) {
      const from = c.startSeconds ?? c.span.from;
      const secs = c.durationSeconds ?? 0;
      out.push({
        ...c,
        // The PC's recordings have Windows paths, which the Mac's own basename would not split.
        sourceUrl: `file:${path.win32.basename(v.file)}`,
        provenance: own
          ? ownStreamProvenance(v, o.gameTitle, from, secs)
          : permittedStreamProvenance(v, o.gameTitle, from, secs, source?.credit || `Gameplay: ${v.channel} on Twitch`),
        credit: own ? "" : source?.credit || `Gameplay: ${v.channel} on Twitch`,
        youtubeSource: undefined,
        span: { source: `vod:${v.vodId}`, from, to: from + secs },
        reason: `own stream: ${c.reason?.replace(/^scene index: /, "") ?? c.label ?? ""}`,
      });
      seconds -= secs;
    }
    const has = new Set(
      clips.map((c) =>
        c.role === "hook"
          ? "hook"
          : c.beatIndex === undefined
            ? ""
            : `beat:${c.beatIndex}${c.moment === undefined ? "" : `#m${c.moment}`}`,
      ),
    );
    targets = targets.filter((t) => !has.has(t.key));
  }
  if (out.length)
    log("info", "stream tags: own stream moments used", {
      game: o.gameTitle,
      clips: out.length,
    });
  return out;
}


/**
 * Up to `max` shot vectors of the game's scene index, evenly spread, as the background a small pool's lines are
 * measured against (src/semantic/stills.ts); undefined when the game has no index or no vectors yet.
 */
export async function backgroundFor(
  dataDir: string,
  s: Pick<SemanticSettings, "model">,
  game: string,
  max = 600,
): Promise<Float32Array[] | undefined> {
  if (!game) return undefined;
  const slug = sceneSlug(game);
  const vecs = [...(await loadShotVectors(vectorFile(path.join(dataDir, "sceneindex", slug), s.model))).values()];
  if (!vecs.length) return undefined;
  const step = Math.max(1, Math.floor(vecs.length / max));
  return vecs.filter((_, i) => i % step === 0).slice(0, max);
}
