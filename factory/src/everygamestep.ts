// The every-game steps the pipeline runs (src/editorial/everygame.ts has the format, src/everygame.ts the plan):
// the roster from IGDB, each beat's era-true pictures, and the audit before the render.
//
// A beat's pictures, in order of preference:
//  1. That game's own screenshots from IGDB, matched by exact title and release year. A handheld game's are put on
//     a handheld (src/render/EraFrame.tsx): the hardware itself says the era.
//  2. With no screenshot of its own: its box art on the television or monitor of its day.
//  3. A moment of the publisher's own trailer of that game, for the newest entries only and inside the publisher's
//     cap (Rockstar: 10 s a video, applied by gatherMedia's capPublisherTotal as for every Short).
// Never the store page (an old game's Steam page is its remaster) and never a neighbouring entry's picture.

import path from "node:path";
import type { Services } from "./pipeline.ts";
import type { EpisodeAssets } from "./episodes.ts";
import type { VisualAsset } from "./assets/steam.ts";
import type { Script } from "./editorial/schema.ts";
import { capFootage } from "./assets/footage.ts";
import { log, errorMessage } from "./lib/util.ts";
import {
  HARDWARE_PROVENANCE,
  REMASTER_WORDS,
  eraAudit,
  eraProblems,
  eraTrue,
  provenanceSource,
  rosterFromIgdb,
  type BeatAudit,
  type SeriesRoster,
} from "./editorial/everygame.ts";
import { rosterTweaks, type EveryGameEntry } from "./everygame.ts";

/** Trailer moments go to the newest entries only: this many, none older than this many years. */
export const EVERY_FOOTAGE_ENTRIES = 3;
export const EVERY_FOOTAGE_YEARS = 10;
/** Screenshots a beat keeps: two shots a beat, and one spare. */
export const EVERY_SCREENS = 3;

type Clips = NonNullable<EpisodeAssets["clips"]>;

/** The series' roster: IGDB's entries through the format's filter and the plan's own tweaks. */
export async function loadEveryGameRoster(
  s: Pick<Services, "igdbSeries" | "now">,
  entry: EveryGameEntry,
): Promise<SeriesRoster> {
  if (!s.igdbSeries)
    throw new Error("this build cannot read a series from IGDB");
  const rows = await s.igdbSeries(entry.series);
  return rosterFromIgdb(entry.series, rows, s.now(), rosterTweaks(entry));
}

/** Whether a beat may carry a trailer moment: the newest entry always, then the few newest of the last years. */
export function footageBeat(
  beats: Array<{ year: number }>,
  beatIndex: number,
  nowYear: number,
): boolean {
  const fromEnd = beats.length - 1 - beatIndex;
  if (fromEnd === 0) return true;
  return (
    fromEnd < EVERY_FOOTAGE_ENTRIES &&
    nowYear - (beats[beatIndex]?.year ?? 0) <= EVERY_FOOTAGE_YEARS
  );
}

/** One beat's pictures and clips, pushed into the gather's lists tagged with the beat. */
export async function gatherEveryGameEntry(
  s: Pick<
    Services,
    "igdbArt" | "fetchOfficialMedia" | "renderEraFrame" | "cfg" | "now"
  >,
  script: Script,
  entry: { game_title: string; year: number },
  beatIndex: number,
  dir: string,
  images: VisualAsset[],
  clips: Clips,
): Promise<void> {
  const meta = script.every_game?.beats[beatIndex];
  if (!meta) return;
  const rel = `entry_${beatIndex}`;
  const edir = path.join(dir, rel);
  const own = (a: VisualAsset) => {
    const src = provenanceSource(a.provenance);
    return Boolean(src && eraTrue(src, meta));
  };
  const art = (
    await s
      .igdbArt(entry.game_title, entry.year, edir, EVERY_SCREENS + 1)
      .catch(() => [] as VisualAsset[])
  ).filter(own);
  const cover = art.find((a) => a.kind === "capsule");
  const screens = art.filter((a) => a.kind === "screenshot");
  const tagged = (a: VisualAsset): VisualAsset => ({
    ...a,
    file: path.join(rel, a.file),
    beatIndex,
  });
  // The picture on the hardware of its day, as one still; a failed render falls back to the plain picture.
  const onHardware = async (
    a: VisualAsset,
    mode: "screen" | "box",
    k: number,
  ): Promise<VisualAsset | undefined> => {
    if (!s.renderEraFrame) return undefined;
    const out = path.join("assets", `era_${k}.jpg`);
    try {
      await s.renderEraFrame({
        episodeDir: edir,
        outFile: path.join(edir, out),
        imageFile: a.file,
        mode,
        device: meta.device,
        gl: s.cfg.remotionGl,
        browserExecutable: s.cfg.browserExecutable,
      });
    } catch (err) {
      log("warn", "era frame failed", {
        game: entry.game_title,
        error: errorMessage(err),
      });
      return undefined;
    }
    return {
      kind: "screenshot",
      file: path.join(rel, out),
      sourceUrl: a.sourceUrl,
      provenance: `${a.provenance}, shown ${HARDWARE_PROVENANCE}`,
      beatIndex,
    };
  };
  if (cover) images.push(tagged(cover));
  if (meta.handheld && screens.length) {
    for (const [k, a] of screens.slice(0, 2).entries())
      images.push((await onHardware(a, "screen", k)) ?? tagged(a));
  } else if (screens.length) {
    for (const a of screens.slice(0, EVERY_SCREENS)) images.push(tagged(a));
  } else if (cover) {
    // No picture of its own era: its box art on its console, or, if that cannot be drawn, the box art alone.
    images.push(
      (await onHardware(cover, "box", 0)) ?? {
        ...tagged(cover),
        kind: "hero",
      },
    );
  }
  // The story starts on the first game, on the hardware of its day: the Short's opening picture.
  if (beatIndex === 0) {
    const first = screens[0] ?? cover;
    const opener = first
      ? await onHardware(first, screens[0] ? "screen" : "box", 9)
      : undefined;
    if (opener) images.push({ ...opener, kind: "hero", beatIndex: undefined });
  }
  if (
    !s.cfg.footage ||
    !footageBeat(script.every_game!.beats, beatIndex, s.now().getUTCFullYear())
  )
    return;
  const want = script.beats[beatIndex]?.footage;
  const om = await s
    .fetchOfficialMedia(
      entry.game_title,
      edir,
      [
        {
          key: `beat:${beatIndex}`,
          text: entry.game_title,
          want: want?.want ?? "gameplay",
          energy: "medium",
          keywords: want?.keywords ?? [entry.game_title],
        },
      ],
      1,
      String(entry.year),
    )
    .catch((err) => {
      log("warn", "every-game trailer failed", {
        game: entry.game_title,
        error: errorMessage(err),
      });
      return undefined;
    });
  if (!om?.trailer) return;
  // A remaster's trailer is a later game's footage, whatever the search returned.
  if (
    REMASTER_WORDS.test(om.trailer.title) &&
    !REMASTER_WORDS.test(entry.game_title)
  ) {
    log("info", "every-game trailer refused: a later version", {
      game: entry.game_title,
      trailer: om.trailer.title,
    });
    return;
  }
  for (const c of capFootage(om.clips, om.trailer.clipSeconds))
    clips.push({
      file: path.join(rel, c.file),
      sourceUrl: c.sourceUrl,
      // The game and year first, so the audit reads whose footage it is; the publisher's name stays for its cap.
      provenance: `Official trailer for "${entry.game_title}" (${entry.year}): ${c.provenance}`,
      durationSeconds: Math.min(c.durationSeconds ?? 4, 4),
      beatIndex,
      role: undefined,
      motion: c.motion,
      luma: c.luma,
      label: c.label,
      reason: c.reason,
      startSeconds: c.startSeconds,
    });
}

/**
 * The audit before the render (pure): media of another release is dropped from the assets, and what is left is
 * judged. `problems` is empty when every beat shows its own game.
 */
export function auditEveryGameAssets(
  script: Pick<Script, "every_game">,
  assets: Pick<EpisodeAssets, "images" | "clips">,
): {
  audit: BeatAudit[];
  dropped: string[];
  problems: string[];
  images: NonNullable<EpisodeAssets["images"]>;
  clips: Clips;
} {
  const meta = script.every_game!;
  const first = eraAudit(meta, assets.images ?? [], assets.clips ?? []);
  const wrong = new Set(first.flatMap((a) => a.wrong));
  const images = (assets.images ?? []).filter((i) => !wrong.has(i.file));
  const clips = (assets.clips ?? []).filter((c) => !wrong.has(c.file));
  const audit = eraAudit(meta, images, clips);
  return {
    audit,
    dropped: [...wrong],
    problems: eraProblems(audit),
    images,
    clips,
  };
}
