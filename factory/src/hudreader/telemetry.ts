// The HUD reader's telemetry (HUD_READER): what the Python reader saw frame by frame (src/hudreader/py/hudread.py),
// turned into a clean per-VOD track and a list of events. Pure: the raw samples and the game's profile go in, the
// track and events come out, so the same rules run on a past VOD, a single clip and the live stream.
//
// The rules that keep a misread frame from becoming a fact:
//   - the wanted level changes only when a new count holds for STAR_HOLD samples in a row; GTA flashes the stars
//     while the police search, so dim stars with no bright ones are "searching", not cleared, and the level is
//     cleared only after CLEAR_SECONDS with no stars at all;
//   - a banner ("Wasted", "Mission passed", "22 / 50 Bridges flown under") counts once per BANNER_GAP seconds;
//   - a money change counts when the game prints it ("+$500") or two readings of the balance agree on a new value;
//   - frames that are not live play (menus, loading, the phone over a hidden HUD) change nothing: the state
//     carries across them.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RawPose {
  island?: number;
  x?: number;
  y?: number;
  heading?: number;
  zoom?: number;
  how: string;
  inliers?: number;
}

export interface RawSample {
  t: number;
  state: "hud" | "menu" | "black" | "other";
  stars?: number;
  dim?: number;
  starScore?: number;
  air?: boolean;
  mm?: RawPose;
  money?: number;
  moneyDelta?: number;
  texts?: Record<string, string[]>;
}

export interface RawPlace {
  name: string;
  island: number;
  x: number;
  y: number;
  seen: number;
}

export interface RawTelemetry {
  version: number;
  game: string;
  video: string;
  width: number;
  height: number;
  fps: number;
  start: number;
  duration: number;
  matcher: string;
  matcherFallback?: string | null;
  ocr: { engine: string; error?: string | null; reads: number };
  stats: Record<string, number>;
  seconds: number;
  places: RawPlace[];
  islands: Record<string, { coverage: number; bbox: number[] | null }>;
  samples: RawSample[];
}

export interface ProfileEvent {
  kind: string;
  region: string;
  pattern: string;
  label: string;
}

/** The parts of a game's HUD profile the TypeScript side reads (src/hudreader/profiles/<game>.json). */
export interface HudProfile {
  game: string;
  label: string;
  calibrated: boolean;
  events: ProfileEvent[];
  areaPattern?: string;
  ignoreText?: string;
  /** Metres per map unit, once measured (calibration); null: distances stay in map units. */
  metresPerUnit?: number | null;
  wanted?: { max?: number };
}

export type HudEventKind =
  | "wanted_start"
  | "wanted_up"
  | "wanted_down"
  | "searching"
  | "wanted_clear"
  | "wasted"
  | "busted"
  | "mission_passed"
  | "mission_failed"
  | "collectible"
  | "stunt"
  | "money"
  | "area"
  | "air_start"
  | "air_end";

export interface HudEvent {
  kind: HudEventKind;
  /** Seconds into the recording. */
  t: number;
  /** The wanted level after the change, the money change, or the collectible's count. */
  value?: number;
  /** The level before the change (wanted events). */
  from?: number;
  /** "22 / 50" style totals for collectibles. */
  total?: number;
  /** The words on screen that gave it away. */
  text?: string;
  detail: string;
}

export interface TrackPoint {
  t: number;
  state: RawSample["state"];
  stars: number;
  searching: boolean;
  air: boolean;
  island?: number;
  x?: number;
  y?: number;
  heading?: number;
  zoom?: number;
  /** Map units a second over the last second, when the track is sure of both ends. */
  speed?: number;
  area?: string;
}

export interface HudTrack {
  game: string;
  video: string;
  calibrated: boolean;
  points: TrackPoint[];
  events: HudEvent[];
  /** Share of samples that were live play, and of those, how many the minimap placed. */
  quality: { hudShare: number; placedShare: number; samples: number };
}

export const STAR_HOLD = 2;
export const CLEAR_SECONDS = 3;
export const BANNER_GAP = 8;
export const AREA_GAP = 20;
export const AIR_HOLD = 3;
/** A jump between two placed samples faster than this (map units a second) is a misplacement, not a drive. */
export const MAX_SPEED = 900;

export const PROFILE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "profiles",
);

export async function loadProfile(
  game: string,
  dir = PROFILE_DIR,
): Promise<HudProfile> {
  const raw = JSON.parse(
    await fs.readFile(path.join(dir, `${game}.json`), "utf8"),
  ) as HudProfile;
  return { ...raw, events: raw.events ?? [] };
}

const compile = (p: string | undefined, flags = "i") => {
  if (!p) return undefined;
  try {
    return new RegExp(p, flags);
  } catch {
    return undefined;
  }
};

/** The wanted level through the misreads (pure): debounced levels, the search phase and clearing. */
export function wantedEvents(samples: RawSample[]): {
  events: HudEvent[];
  level: Map<number, { stars: number; searching: boolean }>;
} {
  const events: HudEvent[] = [];
  const level = new Map<number, { stars: number; searching: boolean }>();
  let cur = 0;
  let searching = false;
  let lastSeen = -Infinity;
  let cand = -1;
  let candN = 0;
  for (const s of samples) {
    if (s.state !== "hud") {
      level.set(s.t, { stars: cur, searching });
      continue;
    }
    const bright = s.stars ?? 0;
    const dim = s.dim ?? 0;
    if (bright > 0 || dim > 0) lastSeen = s.t;
    if (bright > 0) {
      if (bright === cand) candN++;
      else {
        cand = bright;
        candN = 1;
      }
      if (candN >= STAR_HOLD && bright !== cur) {
        const kind: HudEventKind =
          cur === 0
            ? "wanted_start"
            : bright > cur
              ? "wanted_up"
              : "wanted_down";
        events.push({
          kind,
          t: Math.round((s.t - (STAR_HOLD - 1) / 2) * 100) / 100,
          value: bright,
          from: cur,
          detail: `${cur} to ${bright} star${bright === 1 ? "" : "s"}`,
        });
        cur = bright;
      }
      if (candN >= STAR_HOLD && searching) searching = false;
    } else {
      cand = -1;
      candN = 0;
      if (cur > 0 && dim > 0 && !searching) {
        searching = true;
        events.push({
          kind: "searching",
          t: s.t,
          value: cur,
          detail: `the police are searching (${cur} star${cur === 1 ? "" : "s"} flashing)`,
        });
      }
      if (cur > 0 && s.t - lastSeen >= CLEAR_SECONDS) {
        events.push({
          kind: "wanted_clear",
          t: Math.round(lastSeen * 100) / 100,
          from: cur,
          value: 0,
          detail: `lost the police at ${cur} star${cur === 1 ? "" : "s"}`,
        });
        cur = 0;
        searching = false;
      }
    }
    level.set(s.t, { stars: cur, searching });
  }
  return { events, level };
}

/** Banner and centre-screen events from the profile's patterns (pure), once per BANNER_GAP for the same words. */
export function textEvents(
  samples: RawSample[],
  profile: HudProfile,
): HudEvent[] {
  const out: HudEvent[] = [];
  const rules = profile.events
    .map((e) => ({
      ...e,
      re: compile(e.pattern),
      regions: e.region.split("|"),
    }))
    .filter((e) => e.re);
  const last = new Map<string, number>();
  for (const s of samples) {
    if (!s.texts) continue;
    for (const r of rules) {
      const text = r.regions
        .flatMap((reg) => s.texts?.[reg] ?? [])
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      const m = text.match(r.re!);
      if (!m) continue;
      const key = `${r.kind}|${r.kind === "collectible" ? m[0].replace(/\s/g, "") : ""}`;
      const prev = last.get(key);
      if (prev !== undefined && s.t - prev < BANNER_GAP) {
        last.set(key, s.t);
        continue;
      }
      last.set(key, s.t);
      const ev: HudEvent = {
        kind: r.kind as HudEventKind,
        t: s.t,
        text: text.slice(0, 120),
        detail: r.label,
      };
      if (r.kind === "collectible" && m[1] && m[2]) {
        ev.value = Number(m[1]);
        ev.total = Number(m[2]);
        if (!(ev.value >= 0 && ev.total > 0 && ev.value <= ev.total)) continue;
        ev.detail = `${r.label} ${ev.value} of ${ev.total}`;
      }
      out.push(ev);
    }
  }
  return out;
}

/** Money changes (pure): the game's own "+$X" line, or a new balance read twice in a row. */
export function moneyEvents(samples: RawSample[]): HudEvent[] {
  const out: HudEvent[] = [];
  let balance: number | undefined;
  let pending: number | undefined;
  let lastDeltaAt = -Infinity;
  for (const s of samples) {
    if (s.state !== "hud") continue;
    if (
      s.moneyDelta !== undefined &&
      s.moneyDelta !== 0 &&
      s.t - lastDeltaAt > 3
    ) {
      out.push({
        kind: "money",
        t: s.t,
        value: s.moneyDelta,
        detail: `${s.moneyDelta > 0 ? "+" : "-"}$${Math.abs(s.moneyDelta).toLocaleString("en-US")}`,
      });
      lastDeltaAt = s.t;
    }
    if (s.money === undefined) continue;
    if (balance === undefined) {
      if (pending === s.money) balance = s.money;
      pending = s.money;
      continue;
    }
    if (s.money === balance) {
      pending = undefined;
      continue;
    }
    if (pending === s.money) {
      const change = s.money - balance;
      if (s.t - lastDeltaAt > 6)
        out.push({
          kind: "money",
          t: s.t,
          value: change,
          detail: `${change > 0 ? "+" : "-"}$${Math.abs(change).toLocaleString("en-US")} (balance $${s.money.toLocaleString("en-US")})`,
        });
      balance = s.money;
      pending = undefined;
    } else pending = s.money;
  }
  return out;
}

/** Area names the game prints (bottom right in GTA V), each once per AREA_GAP unless it changes (pure). */
export function areaEvents(
  samples: RawSample[],
  profile: HudProfile,
): HudEvent[] {
  const re = compile(profile.areaPattern, "");
  const ignore = compile(profile.ignoreText);
  const out: HudEvent[] = [];
  let last: { name: string; t: number } | undefined;
  for (const s of samples) {
    for (const line of s.texts?.area ?? []) {
      const name = line.trim();
      if (!name || (re && !re.test(name)) || (ignore && ignore.test(name)))
        continue;
      if (last && last.name === name && s.t - last.t < AREA_GAP) {
        last.t = s.t;
        break;
      }
      out.push({ kind: "area", t: s.t, text: name, detail: `in ${name}` });
      last = { name, t: s.t };
      break;
    }
  }
  return out;
}

/** Flying (the altimeter drawn) starting and ending, held AIR_HOLD samples (pure). */
export function airEvents(samples: RawSample[]): HudEvent[] {
  const out: HudEvent[] = [];
  let air = false;
  let run = 0;
  for (const s of samples) {
    if (s.state !== "hud") continue;
    const a = !!s.air;
    if (a !== air) {
      run++;
      if (run >= AIR_HOLD) {
        air = a;
        run = 0;
        out.push({
          kind: a ? "air_start" : "air_end",
          t: s.t,
          detail: a ? "took to the air" : "back on the ground",
        });
      }
    } else run = 0;
  }
  return out;
}

/** The clean track (pure): one point per sample, positions checked for impossible jumps, speed over a second. */
export function buildTrack(raw: RawTelemetry, profile: HudProfile): HudTrack {
  const samples = [...raw.samples].sort((a, b) => a.t - b.t);
  const wanted = wantedEvents(samples);
  const events = [
    ...wanted.events,
    ...textEvents(samples, profile),
    ...moneyEvents(samples),
    ...areaEvents(samples, profile),
    ...airEvents(samples),
  ].sort((a, b) => a.t - b.t);
  const areas = events.filter((e) => e.kind === "area");
  const airs = events.filter(
    (e) => e.kind === "air_start" || e.kind === "air_end",
  );
  const points: TrackPoint[] = [];
  let lastPlaced: TrackPoint | undefined;
  let hud = 0;
  let placed = 0;
  for (const s of samples) {
    const lv = wanted.level.get(s.t) ?? { stars: 0, searching: false };
    const air = (() => {
      const before = airs.filter((e) => e.t <= s.t).pop();
      return before?.kind === "air_start";
    })();
    const area = areas.filter((e) => e.t <= s.t && s.t - e.t < 120).pop()?.text;
    const p: TrackPoint = {
      t: s.t,
      state: s.state,
      stars: lv.stars,
      searching: lv.searching,
      air,
      ...(area ? { area } : {}),
    };
    if (s.state === "hud") hud++;
    const m = s.mm;
    if (
      s.state === "hud" &&
      m &&
      m.island !== undefined &&
      m.x !== undefined &&
      m.y !== undefined
    ) {
      let ok = true;
      if (
        lastPlaced &&
        lastPlaced.island === m.island &&
        m.how !== "relocated" &&
        m.how !== "new_island"
      ) {
        const dt = s.t - lastPlaced.t;
        const d = Math.hypot(m.x - lastPlaced.x!, m.y - lastPlaced.y!);
        if (dt > 0 && dt <= 1.5) {
          if (d / dt > MAX_SPEED) ok = false;
          else p.speed = Math.round((d / dt) * 10) / 10;
        }
      }
      if (ok) {
        Object.assign(p, {
          island: m.island,
          x: m.x,
          y: m.y,
          heading: m.heading,
          zoom: m.zoom,
        });
        lastPlaced = p;
        placed++;
      }
    }
    points.push(p);
  }
  return {
    game: raw.game,
    video: raw.video,
    calibrated: !!profile.calibrated,
    points,
    events,
    quality: {
      hudShare: samples.length
        ? Math.round((hud / samples.length) * 1000) / 1000
        : 0,
      placedShare: hud ? Math.round((placed / hud) * 1000) / 1000 : 0,
      samples: samples.length,
    },
  };
}

/** The track's points inside a window of the recording (seconds, inclusive). */
export function window(track: HudTrack, from: number, to: number): HudTrack {
  return {
    ...track,
    points: track.points.filter((p) => p.t >= from && p.t <= to),
    events: track.events.filter((e) => e.t >= from && e.t <= to),
  };
}

// ------------------------------------------------------------------ files

/** Where a VOD's telemetry lives: <data>/hud/vods/<vodId>/. */
export const vodHudDir = (dataDir: string, vodId: string) =>
  path.join(dataDir, "hud", "vods", vodId);
/** A game's stitched map (the atlas, grown by every stream): <data>/hud/<game>/atlas/. */
export const atlasDir = (dataDir: string, game: string) =>
  path.join(dataDir, "hud", game, "atlas");

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 1));
  await fs.rename(tmp, file);
}
