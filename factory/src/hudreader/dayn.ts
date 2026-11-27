// The HUD graphics for one GTA 6 Day N Short (HUD_PIN, HUD_TICKER, HUD_END_MAP), put together just before its
// render (src/pipeline.ts stepRenderGameplayDirect). The source clip (16:9, HUD intact) is read on the spot, the
// pin is placed on the stitched map, the day's spot is filed for the "every spot so far" map, and the pictures the
// renderer needs (the pin's map disc, the end map) are written into the episode's folder. Anything that fails or is
// unsure leaves that graphic out: the Short renders exactly as before.

import fs from "node:fs/promises";
import path from "node:path";
import { log, errorMessage } from "../lib/util.ts";
import { readClip, profilePath } from "./job.ts";
import { loadProfile, atlasDir, readJson, type HudTrack } from "./telemetry.ts";
import { pinFor } from "./where.ts";
import { addSpot, spotFromPin, type SpotBook } from "./spots.ts";
import {
  auditOverlay,
  buildOverlay,
  hasOverlay,
  type HudOverlayProps,
} from "./overlay.ts";
import { runHud } from "./run.ts";
import type { HudSettings } from "./settings.ts";
import type { GfxFinding } from "../qa/gfxaudit.ts";

export interface Segment {
  start: number;
  end: number;
}

/** A source-clip second as a second of the Short (pure): where it first appears in the cut's segments. */
export function sourceToShort(
  segments: Segment[],
  t: number,
): number | undefined {
  let at = 0;
  for (const s of segments) {
    if (t >= s.start && t <= s.end)
      return Math.round((at + t - s.start) * 100) / 100;
    at += s.end - s.start;
  }
  return undefined;
}

/** The wanted level through the Short (pure): one entry per change, on the Short's own clock. */
export function starsOnShort(
  track: HudTrack,
  segments: Segment[],
): Array<{ t: number; stars: number }> {
  const out: Array<{ t: number; stars: number }> = [];
  let at = 0;
  for (const s of segments) {
    for (const p of track.points) {
      if (p.t < s.start || p.t > s.end) continue;
      const t = Math.round((at + p.t - s.start) * 100) / 100;
      if (!out.length || out[out.length - 1]!.stars !== p.stars)
        out.push({ t, stars: p.stars });
    }
    at += s.end - s.start;
  }
  return out;
}

/** Spots on one island as fractions of its end-map picture (pure). */
export function spotsOnPicture(
  book: SpotBook,
  island: number,
  pic: { x0: number; y0: number; scale: number; width: number; height: number },
  today: number,
): Array<{
  x: number;
  y: number;
  day: number;
  label?: string;
  today: boolean;
}> {
  return book.spots
    .filter((s) => s.island === island)
    .map((s) => ({
      x: Math.round((((s.x - pic.x0) * pic.scale) / pic.width) * 1000) / 1000,
      y: Math.round((((s.y - pic.y0) * pic.scale) / pic.height) * 1000) / 1000,
      day: s.day,
      ...(s.label ? { label: s.label } : {}),
      today: s.day === today,
    }))
    .filter((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1);
}

export interface DayNInput {
  hud: HudSettings;
  dataDir: string;
  episodeDir: string;
  episode: string;
  day: number;
  game: string;
  clipFile: string;
  segments: Segment[];
  durationSeconds: number;
  hookEnd: number;
  payoffAt: number;
  accent: string;
  /** Spots of episodes that were rejected or failed are left off the map. */
  liveEpisodes?: (ids: string[]) => Promise<Set<string>>;
  now: Date;
}

export interface DayNResult {
  props?: HudOverlayProps;
  findings: GfxFinding[];
  why?: string;
  pin?: {
    label?: string;
    confidence: number;
    x: number;
    y: number;
    island: number;
  };
}

export async function dayNOverlay(i: DayNInput): Promise<DayNResult> {
  const s = i.hud;
  if (!s.enabled || !(s.pin || s.ticker || s.endMap))
    return { findings: [], why: "off" };
  try {
    const profile = await loadProfile(i.game).catch(() => undefined);
    if (!profile) return { findings: [], why: `no HUD profile for ${i.game}` };
    if (!profile.calibrated)
      return {
        findings: [],
        why: `the ${profile.label} HUD is not calibrated yet (npx tsx src/tools/hudreader.ts calibrate)`,
      };
    const work = path.join(i.episodeDir, "hud");
    await fs.mkdir(work, { recursive: true });
    const from = Math.min(...i.segments.map((x) => x.start));
    const to = Math.max(...i.segments.map((x) => x.end));
    const read = await readClip(s, i.dataDir, {
      file: i.clipFile,
      game: i.game,
      out: path.join(work, "raw.json"),
      start: Math.max(0, from - 2),
      duration: to - from + 4,
    });
    if (!read) return { findings: [], why: "the clip could not be read" };
    const { track, raw } = read;
    const pin = pinFor(track, from, to, raw.places);
    let crop: { image: string; x: number; y: number } | undefined;
    const atlas = atlasDir(i.dataDir, i.game);
    if (pin && s.pin) {
      const r = await runHud(
        s,
        [
          "crop",
          "--atlas",
          atlas,
          "--island",
          String(pin.island),
          "--x",
          String(pin.x),
          "--y",
          String(pin.y),
          "--size",
          "600",
          "--px",
          "360",
          "--out",
          path.join(work, "pin.png"),
        ],
        { job: "pin", est: 1, runner: "direct", timeoutMs: 120_000 },
      );
      if (r.code === 0) crop = { image: "hud/pin.png", x: 0.5, y: 0.5 };
    }
    let endMap:
      | {
          image: string;
          width: number;
          height: number;
          spots: ReturnType<typeof spotsOnPicture>;
        }
      | undefined;
    if (pin && s.endMap && pin.confidence >= s.minConfidence) {
      let book = await addSpot(
        i.dataDir,
        i.game,
        spotFromPin(pin, {
          day: i.day,
          episode: i.episode,
          video: path.basename(i.clipFile),
          at: i.now,
        }),
      );
      if (i.liveEpisodes) {
        const keep = await i.liveEpisodes(book.spots.map((x) => x.episode));
        book = {
          ...book,
          spots: book.spots.filter(
            (x) => keep.has(x.episode) || x.episode === i.episode,
          ),
        };
      }
      const r = await runHud(
        s,
        [
          "atlas",
          "--atlas",
          atlas,
          "--out",
          path.join(work, "atlas"),
          "--scale",
          "0.5",
        ],
        {
          job: "end map",
          est: 1,
          runner: "direct",
          timeoutMs: 180_000,
        },
      );
      const meta =
        r.code === 0
          ? await readJson<{
              islands: Record<
                string,
                {
                  x0: number;
                  y0: number;
                  scale: number;
                  width: number;
                  height: number;
                }
              >;
            }>(path.join(work, "atlas", "islands.json"))
          : undefined;
      const pic = meta?.islands[String(pin.island)];
      if (pic)
        endMap = {
          image: `hud/atlas/island_${pin.island}.png`,
          width: pic.width,
          height: pic.height,
          spots: spotsOnPicture(book, pin.island, pic, i.day),
        };
    }
    const built = buildOverlay({
      durationSeconds: i.durationSeconds,
      clipStart: 0,
      day: i.day,
      ...(pin
        ? {
            pin: {
              ...(pin.label ? { label: pin.label } : {}),
              confidence: pin.confidence,
              ...(crop ? { crop } : {}),
            },
          }
        : {}),
      stars: starsOnShort(track, i.segments),
      ...(endMap ? { endMap } : {}),
      switches: { pin: s.pin, ticker: s.ticker, endMap: s.endMap },
      minConfidence: s.minConfidence,
      accent: i.accent,
    });
    const audited = auditOverlay(built, {
      durationSeconds: i.durationSeconds,
      hookEnd: i.hookEnd,
      payoffAt: i.payoffAt,
    });
    return {
      ...(hasOverlay(audited.props) ? { props: audited.props } : {}),
      findings: audited.findings,
      ...(pin
        ? {
            pin: {
              ...(pin.label ? { label: pin.label } : {}),
              confidence: pin.confidence,
              x: pin.x,
              y: pin.y,
              island: pin.island,
            },
          }
        : {}),
      ...(hasOverlay(audited.props)
        ? {}
        : {
            why: pin
              ? "nothing passed the graphics rules"
              : "the minimap could not be placed",
          }),
    };
  } catch (err) {
    log("warn", "hud overlay failed; the Short renders without it", {
      episode: i.episode,
      error: errorMessage(err),
    });
    return { findings: [], why: errorMessage(err) };
  }
}

export { profilePath };
