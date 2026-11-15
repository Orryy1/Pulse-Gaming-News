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
import { readableLibrary, storeSettings } from "./gamelibstore.ts";
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
  // Only what can be read now: the Mac's cache, or the PC's master copy while the PC answers (gamelibstore.ts).
  return readableLibrary(
    libraryRoot(dataDir),
    { version: 1, game: canonicalGame(game), items, updatedAt: lib?.updatedAt ?? "" },
    storeSettings(),
  );
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
  /** Clips cut from untagged videos for lines the tags could not serve. */
  untagged: number;
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
    untagged: 0,
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
        ((i.scenes ?? []).some((s) => s.seen && s.tags.length) || untaggedVideo(i)),
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
    // UNTAGGED FALLBACK (15 Nov 2026: the Mac's GTA VI library had its trailers but no tags yet, so Shorts got no clips
    // and the footage gate held them): the main game's sentences that got no tagged scene take evenly spread segments
    // from the middle of its untagged videos, a different video each time, never a dark, near-still or lettered one,
    // and not one the game's recent Shorts showed.
    const covered = new Set(picks.filter((p) => p.scene).map((p) => p.sentence));
    const needing = wants.filter((w) => canonicalGame(w.game) === canonicalGame(o.script.game_title) && !covered.has(w.sentence));
    if (needing.length && main && seconds < cap) {
      const spots = untaggedSpots(main.items, needing.length * 3, recent);
      let k = 0;
      for (const w of needing) {
        if (seconds >= cap) break;
        while (k < spots.length) {
          const s = spots[k++]!;
          const pick: LibPick = { key: w.key, sentence: w.sentence, game: main.game, item: s.item, scene: { at: s.at, end: s.end, tags: [], seen: "" }, score: 0 };
          const made = await materialise(libraryRoot(o.dataDir), pick, o.episodeDir, Math.min(4.2, cap - seconds));
          if (!made || (made.durationSeconds ?? 0) < 3) continue;
          if (!(await segmentUsable(path.join(o.episodeDir, made.file)))) {
            await fs.rm(path.join(o.episodeDir, made.file), { force: true }).catch(() => undefined);
            continue;
          }
          seconds += made.durationSeconds ?? 0;
          out.clips.push({
            file: made.file,
            sourceUrl: s.item.sourceUrl,
            provenance: pickProvenance(pick),
            durationSeconds: made.durationSeconds ?? 3,
            beatIndex: beatOf(w.key),
            ...(w.key === "hook" ? { role: "hook" as const } : {}),
            forWords: w.sentence,
            libKey: assetKey(s.item, { at: s.at }),
            reason: "library (untagged)",
            startSeconds: s.at,
            motion: 0.5,
          });
          out.untagged++;
          break;
        }
      }
    }
    // A map line with a size figure and a second game to compare with: the honest to-scale graphic, unless the
    // library already gave that sentence a real map.
    const other = comparedGames(o.script)[0];
    for (const w of wants) {
      const scale = mapScale(w.sentence);
      if (!scale || !other) continue;
      const gotMap = picks.some((p) => p.sentence === w.sentence && realMap(p.scene?.seen ?? p.item.seen));
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

/**
 * Whether a picture's description shows a real map (pure): the tagger also says "map" for a corner minimap or an aerial
 * view (15 Nov 2026: 53 of GTA V's 170 items), which is not the map a line about the map's size needs.
 */
export function realMap(seen: string): boolean {
  const s = seen.toLowerCase().replace(/minimap|mini-map|mini map/g, "");
  return /\b(in-game map|map screen|pause map|world map|full map|map of|map showing|map view)\b/.test(s);
}

/** Whether moving footage of the game exists in its library or a local scene index (the publish gate asks). */
export async function libraryHasFootage(dataDir: string, game: string): Promise<boolean> {
  const lib = await libraryWithIndexes(dataDir, game).catch(() => undefined);
  return !!lib?.items.some(
    (i) => i.kind === "video" && !i.unusable && ((i.scenes ?? []).some((s) => s.seen && !s.seen.startsWith("unusable")) || untaggedVideo(i)),
  );
}

/** A video long enough to cut untagged segments from (pure): a trailer or recording, not a one-second site loop. */
export function untaggedVideo(i: LibItem): boolean {
  return i.kind === "video" && !i.unusable && (i.durationSeconds ?? 0) >= 12 && !(i.scenes ?? []).some((s) => s.seen);
}

/**
 * Segments to try from untagged videos (pure): evenly spread over the middle 10% to 90% of each, taken one video at
 * a time in turn so consecutive lines show different videos, and anything the game's recent Shorts showed last.
 */
export function untaggedSpots(
  items: LibItem[],
  max: number,
  recent: Map<string, number> = new Map(),
  o: { seconds?: number; perVideo?: number } = {},
): Array<{ item: LibItem; at: number; end: number }> {
  const seconds = o.seconds ?? 4.2;
  const videos = items.filter(untaggedVideo).sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0));
  const lists = videos.map((v) => {
    const d = v.durationSeconds ?? 0;
    const n = o.perVideo ?? Math.max(3, Math.min(12, Math.floor((d * 0.8) / 8)));
    return Array.from({ length: n }, (_, k) => {
      const at = Math.round((d * 0.1 + ((d * 0.8 - seconds) * (k + 0.5)) / n) * 10) / 10;
      return { item: v, at, end: Math.round((at + seconds) * 10) / 10 };
    });
  });
  const turns: Array<{ item: LibItem; at: number; end: number }> = [];
  for (let k = 0; lists.some((l) => k < l.length); k++) for (const l of lists) if (l[k]) turns.push(l[k]!);
  const fresh = turns.filter((t) => !recent.has(assetKey(t.item, { at: t.at })));
  const stale = turns.filter((t) => recent.has(assetKey(t.item, { at: t.at })));
  return [...fresh, ...stale].slice(0, max);
}

/** A cut segment is usable: not dark, not near-still, no big lettering in its middle frame (cheap local checks). */
export async function segmentUsable(file: string): Promise<boolean> {
  const { darkestLuma, DARK_LUMA, segmentMotion } = await import("./clipscore.ts");
  const dark = await darkestLuma(file).catch(() => undefined);
  if (dark !== undefined && dark < DARK_LUMA) return false;
  const motion = await segmentMotion(file).catch(() => undefined);
  if (motion !== undefined && motion < STILL_MOTION) return false;
  const frame = `${file}.mid.jpg`;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { FFMPEG } = await import("../lib/bin.ts");
    await promisify(execFile)(FFMPEG, ["-y", "-v", "error", "-ss", "1.5", "-i", file, "-frames:v", "1", "-q:v", "3", frame]);
    const { stillBigText } = await import("./cliptext.ts");
    return (await stillBigText(frame).catch(() => [] as string[])).length === 0;
  } catch {
    return true;
  } finally {
    await fs.rm(frame, { force: true }).catch(() => undefined);
  }
}

/** Below this mean frame difference (0-255) a segment reads as a still picture: a title card or a held frame. */
export const STILL_MOTION = 1.5;

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
