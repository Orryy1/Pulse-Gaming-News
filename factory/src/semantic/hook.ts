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
import { windowFor } from "../sceneindex/spoilers.ts";
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
  vodMomentHeld,
} from "../vodindex/tags.ts";
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

/** The owner's recordings of a game with tags, newest first (pure over the list). */
export function recordingsOf(
  vods: readonly VodIndex[],
  game: string,
): VodIndex[] {
  const want = sceneSlug(game);
  return vods.filter((v) => v.game && sceneSlug(v.game) === want);
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
  deps: {
    list?: typeof listVodIndexes;
    readable?: typeof readableInTime;
    embedder?: Embedder;
  } = {},
): Promise<CutsceneClip[]> {
  const s = cfg.semantic;
  if (!s?.vodTags || !o.targets.length) return [];
  // The ten newest recordings of the game at most: older moments are rarely what a line wants, and each costs a read.
  const vods = recordingsOf(
    await (deps.list ?? listVodIndexes)(cfg.dataDir).catch(() => []),
    o.gameTitle,
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
    const tags = await loadVodTags(cfg.dataDir, v.vodId);
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
    const vecs = await loadShotVectors(
      vectorFile(vodIndexDir(cfg.dataDir, v.vodId), s.model),
    );
    // Meaning joins the words only with MATCH_SEMANTIC on; off, the tags and descriptions alone find the moment.
    const semantic = s.enabled && vecs.size
      ? await targetScorer(
          deps.embedder ?? embedderFor(cfg.dataDir, s),
          index.shots,
          vecs,
          targets,
        ).catch(() => undefined)
      : undefined;
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
      allow: (shot) =>
        !vodMomentHeld(w, tagsAt(tags, (shot.start + shot.end) / 2), now),
      ...(semantic ? { semantic } : {}),
      deps: {
        download: async (_id, from, to, file) => {
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
        sourceUrl: `file:${path.basename(v.file)}`,
        provenance: ownStreamProvenance(v, o.gameTitle, from, secs),
        credit: "",
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
