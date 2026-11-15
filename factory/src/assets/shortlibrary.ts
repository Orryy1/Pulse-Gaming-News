// A Short's pictures from the game libraries and the scene indexes, sentence by sentence (GAME_LIBRARY, 15 Nov 2026).
// gatherMedia calls this for a Short about one game (news, why, evergreen): every sentence gets the best-fitting
// moving scene from the game it is about (a comparison's sentence from the other game), a still beside it, a picture
// of the title's subject for the thumbnail, and an honest to-scale graphic for a map line with a size figure. What
// was picked is remembered per Short (src/assets/gamelib.ts usage ledger), so the next Shorts about the game show
// other things.
import fs from "node:fs/promises";
import path from "node:path";
import { errorMessage, log } from "../lib/util.ts";
import { franchisePublisher } from "./officialTrailer.ts";
import {
  baseGameOf,
  gameplayIndexName,
  loadSceneIndex,
  sceneIndexDir,
  type SceneIndex,
} from "../sceneindex/schema.ts";
import {
  assetKey,
  canonicalGame,
  libraryRoot,
  materialise,
  pickForLines,
  pickProvenance,
  readLibrary,
  readUsage,
  recentUses,
  tagsForSentence,
  type GameLibrary,
  type LibItem,
  type LibPick,
} from "./gamelib.ts";
import {
  comparedGames,
  hardwareStory,
  isHardwareAsset,
  mapScale,
  mapScaleGraphic,
  sentenceWants,
  type ScriptLike,
} from "./linevisuals.ts";

/** A scene index's described shots as one library video (pure): its proxy, each usable shot a tagged scene. */
export function indexAsLibraryItem(
  index: SceneIndex,
  proxyFile: string,
): LibItem | undefined {
  const scenes = index.shots
    .filter(
      (s) =>
        s.desc &&
        s.desc !== "-" &&
        !s.blank &&
        !s.menu &&
        s.luma >= 35 &&
        s.luma <= 235 &&
        s.end - s.start >= 1.2 &&
        !(s.text ?? "").trim(),
    )
    .map((s) => ({
      at: s.start + 0.1,
      end: Math.min(s.end - 0.1, s.start + 6),
      tags: tagsForSentence(`${s.desc} ${s.tags.join(" ")} ${s.where}`),
      seen: s.desc,
    }));
  if (!scenes.length) return undefined;
  const game = baseGameOf(index.game);
  const publisher = franchisePublisher(game);
  return {
    id: `idx-${index.slug}`,
    kind: "video",
    file: proxyFile,
    sourceUrl: `https://www.youtube.com/watch?v=${index.source.videoId}`,
    provenance: `Scene index of ${game} (${index.source.kind === "playthrough" ? "no-commentary playthrough" : "cutscene movie"} "${index.source.title}" by ${index.source.uploader})`,
    source: publisher ?? "scene index",
    named: [...new Set(index.shots.flatMap((s) => s.who))].slice(0, 40),
    tags: [],
    seen: "",
    scenes,
    addedAt: index.builtAt,
  };
}

/** The game's library with its scene indexes (cutscene and gameplay) folded in, when they have a local proxy. */
export async function libraryWithIndexes(
  dataDir: string,
  game: string,
): Promise<GameLibrary | undefined> {
  const lib = (await readLibrary(libraryRoot(dataDir), game)) ?? undefined;
  const items: LibItem[] = [...(lib?.items ?? [])];
  for (const name of [game, gameplayIndexName(game)]) {
    const index = await loadSceneIndex(dataDir, name).catch(() => undefined);
    if (!index) continue;
    const proxy = path.join(
      sceneIndexDir(dataDir, name),
      index.proxy?.file || "proxy.mp4",
    );
    if (!(await fs.stat(proxy).catch(() => undefined))) continue; // no YouTube pull at render time: local proxies only
    const item = indexAsLibraryItem(index, proxy);
    if (item) items.push(item);
  }
  if (!items.length) return undefined;
  return {
    version: 1,
    game: canonicalGame(game),
    items,
    updatedAt: lib?.updatedAt ?? "",
  };
}

export interface ShortLibraryMedia {
  clips: Array<{
    file: string;
    sourceUrl: string;
    provenance: string;
    durationSeconds: number;
    beatIndex?: number;
    role?: "hook";
    forWords: string;
    libKey: string;
    label?: string;
    reason?: string;
    startSeconds?: number;
    motion?: number;
    audio?: boolean;
  }>;
  images: Array<{
    kind: "screenshot";
    file: string;
    sourceUrl: string;
    provenance: string;
    forWords?: string;
    role?: "hook";
    libKey: string;
    label?: string;
  }>;
  games: string[];
  /** Whether the game has moving footage in its library at all (the publish gate asks). */
  footageExists: boolean;
  picks: number;
}

const beatOf = (key: string): number | undefined =>
  key.startsWith("beat:") ? Number(key.slice(5)) : undefined;

/**
 * The library's picks for a Short, copied into its folder. Never throws: a game with no library gives nothing and
 * the gather goes on as before.
 */
export async function shortLibraryMedia(o: {
  dataDir: string;
  episodeId: string;
  episodeDir: string;
  script: ScriptLike & { youtube?: { title?: string } };
  /** Narration seconds of footage the Short may carry from libraries (the publisher caps still apply after). */
  maxClipSeconds?: number;
}): Promise<ShortLibraryMedia> {
  const out: ShortLibraryMedia = {
    clips: [],
    images: [],
    games: [],
    footageExists: false,
    picks: 0,
  };
  try {
    const games = [o.script.game_title, ...comparedGames(o.script)];
    const libs = new Map<string, GameLibrary>();
    for (const g of games) {
      const lib = await libraryWithIndexes(o.dataDir, g);
      if (lib) libs.set(canonicalGame(g), lib);
    }
    out.games = [...libs.keys()];
    if (!libs.size) return out;
    const main = libs.get(canonicalGame(o.script.game_title));
    out.footageExists = !!main?.items.some(
      (i) =>
        i.kind === "video" &&
        !i.unusable &&
        (i.scenes ?? []).some((s) => s.seen && s.tags.length),
    );
    const names = [
      ...new Set(
        [...libs.values()].flatMap((l) => l.items.flatMap((i) => i.named)),
      ),
    ].filter((n) => !/^(trailer|screenshot|gameplay|site clip)$/i.test(n));
    const wants = sentenceWants(o.script, names);
    const ledger = await readUsage(libraryRoot(o.dataDir));
    const recent = new Map<string, number>();
    for (const g of libs.keys())
      for (const [k, n] of recentUses(ledger, g, undefined, o.episodeId))
        recent.set(k, n);
    const allowHardware = hardwareStory(o.script);
    const ok = (p: LibPick) =>
      allowHardware ||
      !isHardwareAsset({
        provenance: p.item.provenance,
        sourceUrl: p.item.sourceUrl,
        file: p.item.file,
      });
    // The thumbnail and opening picture: a still of what the title is about, on its own (no words tie it to a line).
    const title = o.script.youtube?.title || o.script.headline || o.script.hook;
    const heroWant = {
      key: "hook",
      sentence: title,
      game: o.script.game_title,
      tags: tagsForSentence(title, o.script.hook_footage?.keywords ?? []),
      names: names.filter(
        (n) => n.length > 3 && title.toLowerCase().includes(n.toLowerCase()),
      ),
    };
    const hero = pickForLines(libs, [heroWant], {
      recent,
      preferVideo: false,
    }).filter(ok)[0];
    const picks = pickForLines(libs, wants, {
      recent,
      preferVideo: true,
      stillsToo: true,
      exclude: hero ? [assetKey(hero.item, hero.scene)] : [],
    }).filter(ok);
    out.picks = picks.length;
    let seconds = 0;
    const cap = o.maxClipSeconds ?? 40;
    for (const p of [
      ...(hero ? [{ ...p0(hero), isHero: true }] : []),
      ...picks.map((p) => ({ ...p0(p), isHero: false })),
    ]) {
      const key = assetKey(p.item, p.scene);
      if (p.scene) {
        if (seconds >= cap) continue;
        const made = await materialise(
          libraryRoot(o.dataDir),
          p,
          o.episodeDir,
          Math.min(4.2, cap - seconds),
        );
        if (!made) continue;
        seconds += made.durationSeconds ?? 0;
        out.clips.push({
          file: made.file,
          sourceUrl: p.item.sourceUrl,
          provenance: pickProvenance(p),
          durationSeconds: made.durationSeconds ?? 3,
          beatIndex: beatOf(p.key),
          ...(p.key === "hook" ? { role: "hook" as const } : {}),
          forWords: p.sentence,
          libKey: key,
          label: p.scene.seen.slice(0, 80),
          reason: `library: ${p.scene.tags.join(", ")}`,
          startSeconds: p.scene.at,
          motion: 0.5,
          ...(p.item.source === "own" ? { audio: false } : {}),
        });
      } else {
        const made = await materialise(libraryRoot(o.dataDir), p, o.episodeDir);
        if (!made) continue;
        out.images.push({
          kind: "screenshot",
          file: made.file,
          sourceUrl: p.item.sourceUrl,
          provenance: pickProvenance(p),
          ...(p.isHero ? { role: "hook" as const } : { forWords: p.sentence }),
          libKey: key,
          label: p.item.seen.slice(0, 80),
        });
      }
    }
    // A map line with a size figure and a second game to compare with: the honest to-scale graphic, unless the
    // library already gave that sentence a real map.
    const other = comparedGames(o.script)[0];
    for (const w of wants) {
      const scale = mapScale(w.sentence);
      if (!scale || !other) continue;
      const gotMap = picks.some(
        (p) =>
          p.sentence === w.sentence &&
          (p.scene?.tags ?? p.item.tags).includes("map"),
      );
      if (gotMap) continue;
      const file = path.join("assets", "map_scale.jpg");
      const short = (g: string) =>
        g
          .replace(/^Grand Theft Auto /, "GTA ")
          .replace(/ VI$/, " 6")
          .replace(/ V$/, " 5")
          .replace(/ IV$/, " 4");
      const source = /\bedge\b/i.test(w.sentence) ? "Edge" : "the preview";
      if (
        await mapScaleGraphic(path.join(o.episodeDir, file), {
          small: short(other),
          big: short(o.script.game_title),
          factor: scale.factor,
          source,
        })
      ) {
        out.images.push({
          kind: "screenshot",
          file,
          sourceUrl: "pulse:map-scale",
          provenance: `Pulse comparison graphic: map areas to scale from the figure the script cites (${scale.factor}x, ${source}); not a map`,
          forWords: w.sentence,
          libKey: `map-scale:${scale.factor}`,
        });
      }
      break;
    }
    log("info", "library media for a Short", {
      episode: o.episodeId,
      games: out.games,
      clips: out.clips.length,
      images: out.images.length,
      recentAvoided: recent.size,
    });
  } catch (err) {
    log("warn", "library media failed; the Short gathers as before", {
      episode: o.episodeId,
      error: errorMessage(err),
    });
  }
  return out;
}

const p0 = (p: LibPick) => p;

/** Whether moving footage of the game exists in its library or a local scene index (the publish gate asks). */
export async function libraryHasFootage(dataDir: string, game: string): Promise<boolean> {
  const lib = await libraryWithIndexes(dataDir, game).catch(() => undefined);
  return !!lib?.items.some((i) => i.kind === "video" && !i.unusable && (i.scenes ?? []).some((s) => s.seen && !s.seen.startsWith("unusable")));
}

/**
 * The publish gate's verdict (pure): a Short whose plan shows no moving footage, or that cannot open on footage, is
 * held when footage of its game should exist; once after a second, richer gather, then for good.
 */
export function footageGate(o: {
  footageShare: number;
  openingOk: boolean | undefined;
  footageExists: boolean;
  alreadyRich: boolean;
}): "pass" | "regather" | "hold" {
  const failed = o.footageShare <= 0 || o.openingOk === false;
  if (!failed || !o.footageExists) return "pass";
  return o.alreadyRich ? "hold" : "regather";
}
