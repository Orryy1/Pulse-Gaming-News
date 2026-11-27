// The HUD reader's jobs (HUD_READER, off by default):
//   - hudVodTick: one GTA recording at a time from the owner's VOD folder (VOD_MINER_DIR) gets a telemetry track
//     (<data>/hud/vods/<vod>/: raw.json from the reader, track.json, facts.json and signals.json), and grows that
//     game's stitched map. Heavy, so it takes its turn (src/hudreader/run.ts).
//   - readClip: a short clip read on the spot (a Day N Short's source clip, or a 10-second live piece), small enough
//     to run without a turn.
// Nothing here publishes or changes an episode; the outputs are files the render step and the detector read.

import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config.ts";
import { errorMessage, log } from "../lib/util.ts";
import { listRecordings, type Recording } from "../vodindex/vods.ts";
import { measuredFacts } from "./facts.ts";
import { estimateMinutes, readArgs, readFps, runHud } from "./run.ts";
import type { HudSettings } from "./settings.ts";
import { hudSignals } from "./signal.ts";
import {
  PROFILE_DIR,
  atlasDir,
  buildTrack,
  loadProfile,
  readJson,
  vodHudDir,
  writeJson,
  type HudTrack,
  type RawTelemetry,
} from "./telemetry.ts";

/** The games the reader knows, by the names the VOD folder's titles use (vodindex detectGame). */
export const HUD_GAMES: Record<string, string> = {
  "Grand Theft Auto V": "gta5",
  "Grand Theft Auto VI": "gta6",
};

/** The profile for a game title (pure): GTA VI before GTA V, so "GTA VI" never reads as "GTA V". */
export function profileFor(game: string | undefined): string | undefined {
  if (!game) return undefined;
  const g = game.toLowerCase();
  if (/\b(gta\s*(vi|6)|grand theft auto\s*(vi|6))\b/.test(g)) return "gta6";
  if (/\b(gta\s*(v|5)|grand theft auto\s*(v|5))\b/.test(g)) return "gta5";
  return HUD_GAMES[game];
}

export const profilePath = (game: string) =>
  path.join(PROFILE_DIR, `${game}.json`);

export interface VodOutputs {
  track: HudTrack;
  raw: RawTelemetry;
}

/** Turns a raw read into the track, facts and signals beside it. */
export async function finishVod(
  dir: string,
  raw: RawTelemetry,
): Promise<VodOutputs> {
  const profile = await loadProfile(raw.game);
  const track = buildTrack(raw, profile);
  await writeJson(path.join(dir, "track.json"), track);
  await writeJson(
    path.join(dir, "facts.json"),
    measuredFacts(track, { metresPerUnit: profile.metresPerUnit ?? null }),
  );
  await writeJson(path.join(dir, "signals.json"), hudSignals(track.events));
  return { track, raw };
}

/** Reads one recording into <data>/hud/vods/<vod>/. */
export async function readVod(
  s: HudSettings,
  dataDir: string,
  rec: Pick<Recording, "file" | "vodId"> & { game: string; seconds: number },
  o: {
    runner?: HudSettings["runner"];
    start?: number;
    duration?: number;
    keyframes?: boolean;
  } = {},
): Promise<VodOutputs | undefined> {
  const keyframes = o.keyframes ?? s.vodKeyframes;
  const dir = vodHudDir(dataDir, rec.vodId);
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, "raw.json");
  const r = await runHud(
    s,
    readArgs(s, {
      video: rec.file,
      profile: profilePath(rec.game),
      out,
      atlas: atlasDir(dataDir, rec.game),
      start: o.start,
      duration: o.duration,
      keyframes,
    }),
    {
      job: `read ${rec.vodId}`,
      est: estimateMinutes(o.duration || rec.seconds, readFps(s, keyframes)),
      runner: o.runner,
    },
  );
  if (r.code !== 0) {
    log("warn", "hud reader: read failed", {
      vod: rec.vodId,
      code: r.code,
      error: r.stderr.slice(-600),
    });
    return undefined;
  }
  const raw = await readJson<RawTelemetry>(out);
  if (!raw) return undefined;
  return finishVod(dir, raw);
}

let busy = false;

/** One recording a pass, newest first, skipping any already read. */
export async function hudVodTick(
  cfg: Pick<Config, "hud" | "dataDir" | "streamAsks">,
): Promise<void> {
  const s = cfg.hud;
  if (!s.enabled || busy) return;
  busy = true;
  try {
    const recs = await listRecordings(
      cfg.streamAsks.vodDir,
      Object.keys(HUD_GAMES),
    );
    for (const rec of recs) {
      const game = profileFor(rec.game ?? rec.title);
      if (!game || !s.games.includes(game)) continue;
      const profile = await loadProfile(game).catch(() => undefined);
      if (!profile?.calibrated) continue;
      const done = await fs
        .stat(path.join(vodHudDir(cfg.dataDir, rec.vodId), "track.json"))
        .then(() => true)
        .catch(() => false);
      if (done) continue;
      const seconds = Math.max(60, rec.bytes / 600_000); // about 4.8 Mbit/s when the length is not known yet
      log("info", "hud reader: reading a recording", { vod: rec.vodId, game });
      await readVod(s, cfg.dataDir, {
        file: rec.file,
        vodId: rec.vodId,
        game,
        seconds,
      });
      break;
    }
  } catch (err) {
    log("warn", "hud reader pass failed", { error: errorMessage(err) });
  } finally {
    busy = false;
  }
}

/** Reads a short clip (up to a couple of minutes) straight away and returns its track; the atlas grows with it. */
export async function readClip(
  s: HudSettings,
  dataDir: string,
  o: {
    file: string;
    game: string;
    out: string;
    start?: number;
    duration?: number;
  },
): Promise<VodOutputs | undefined> {
  const r = await runHud(
    s,
    readArgs(s, {
      video: o.file,
      profile: profilePath(o.game),
      out: o.out,
      atlas: atlasDir(dataDir, o.game),
      start: o.start,
      duration: o.duration,
    }),
    {
      job: `clip ${path.basename(path.dirname(o.out))}`,
      est: 2,
      runner: "direct",
      timeoutMs: 10 * 60_000,
    },
  );
  if (r.code !== 0) {
    log("warn", "hud reader: clip read failed", {
      file: o.file,
      error: r.stderr.slice(-400),
    });
    return undefined;
  }
  const raw = await readJson<RawTelemetry>(o.out);
  if (!raw) return undefined;
  const profile = await loadProfile(o.game);
  return { raw, track: buildTrack(raw, profile) };
}

/**
 * HUD_FACTS: what the reader measures in a gameplay clip, as lines for the reviewer (measured facts and the HUD's
 * own moments). Undefined when off, not a GTA clip, not calibrated or unreadable.
 */
export async function clipFacts(
  s: HudSettings,
  dataDir: string,
  o: { file: string; title: string; work: string },
): Promise<{ facts: string[]; events: string[] } | undefined> {
  if (!s.enabled || !s.facts) return undefined;
  const game = profileFor(o.title);
  if (!game || !s.games.includes(game)) return undefined;
  const profile = await loadProfile(game).catch(() => undefined);
  if (!profile?.calibrated) return undefined;
  const read = await readClip(s, dataDir, { file: o.file, game, out: path.join(o.work, "hud_raw.json") }).catch(() => undefined);
  if (!read || read.track.quality.hudShare < 0.3) return undefined;
  const facts = measuredFacts(read.track, { metresPerUnit: profile.metresPerUnit ?? null, minConfidence: s.minConfidence }).map((f) => f.text);
  const events = hudSignals(read.track.events).map((e) => `${e.detail} at ${Math.round(e.t)} s`);
  return { facts, events };
}
