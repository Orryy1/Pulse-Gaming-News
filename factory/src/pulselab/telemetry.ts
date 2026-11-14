// The HUD reader's telemetry, as the Lab consumes it. Another helper (branch claude/hudreader) is building a reader for
// GTA's HUD and minimap that turns a recording into measured numbers. The Lab never depends on it: with no reading
// for a recording, "I measured it" falls back to what the clip's own clock can measure (a timer from the attempt to the
// outcome), and counters and meters wait for a reading or for the owner's own count in the clip's meta.json.
//
// The contract (one file per recording, JSON, written by the reader):
//   <PULSE_LAB_TELEMETRY_DIR or DATA_DIR/hudreader>/<vodId>.json
//   {
//     "vodId": "v2917738469", "game": "Grand Theft Auto V", "version": 1,
//     "samples": [ { "t": 812.4, "wanted": 2, "speed": 74, "cash": 15200, "health": 0.8,
//                    "clock": 1310, "pos": { "x": 0.41, "y": 0.63 } } ],
//     "events":  [ { "t": 815.0, "kind": "wanted_cleared", "value": 0 } ]
//   }
// t is seconds into the recording; every reading is optional (a frame the reader could not read leaves it out);
// clock is in-game minutes past midnight; pos is the player's place on the full map, 0 to 1 on each axis; speed is in
// the unit the HUD shows (unit, default "mph"). Unknown fields are ignored, so the reader can grow without breaking us.

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const Num = z.number().finite();

export const HudSampleSchema = z
  .object({
    t: Num,
    wanted: Num.optional(),
    speed: Num.optional(),
    cash: Num.optional(),
    health: Num.optional(),
    clock: Num.optional(),
    pos: z.object({ x: Num, y: Num }).optional(),
  })
  .passthrough();

export const HudEventSchema = z
  .object({ t: Num, kind: z.string(), value: Num.optional() })
  .passthrough();

export const HudTrackSchema = z
  .object({
    vodId: z.string(),
    game: z.string().optional(),
    version: Num.optional(),
    unit: z.string().optional(),
    /** Metres across the full map on the x axis, when the reader knows the game's scale. */
    mapWidthMetres: Num.optional(),
    samples: z.array(HudSampleSchema).default([]),
    events: z.array(HudEventSchema).default([]),
  })
  .passthrough();

export type HudSample = z.infer<typeof HudSampleSchema>;
export type HudEvent = z.infer<typeof HudEventSchema>;
export type HudTrack = z.infer<typeof HudTrackSchema>;

export const telemetryDir = (dataDir: string, dir: string) =>
  dir || path.join(dataDir, "hudreader");

const SAFE_ID = /^[A-Za-z0-9_.-]{1,80}$/;

/** A recording's reading, or undefined (none yet, unreadable, or a wrong shape). Never throws. */
export async function loadTelemetry(
  dir: string,
  vodId: string,
): Promise<HudTrack | undefined> {
  if (!SAFE_ID.test(vodId)) return undefined;
  try {
    const raw = JSON.parse(
      await fs.readFile(path.join(dir, `${vodId}.json`), "utf8"),
    );
    const t = HudTrackSchema.safeParse(raw);
    if (!t.success) return undefined;
    return {
      ...t.data,
      samples: [...t.data.samples].sort((a, b) => a.t - b.t),
      events: [...t.data.events].sort((a, b) => a.t - b.t),
    };
  } catch {
    return undefined;
  }
}

/** The readings between two seconds of the recording (pure). */
export function samplesBetween(
  track: HudTrack,
  from: number,
  to: number,
): HudSample[] {
  return track.samples.filter((s) => s.t >= from && s.t <= to);
}

/** What a reading can measure. */
export type TelemetryMeasure =
  | { kind: "wanted_lost" } //   seconds from the first star to the stars clearing
  | { kind: "event_gap"; from: string; to: string } // seconds between two events
  | { kind: "count"; event: string } // events of a kind in the window
  | { kind: "top_speed" }
  | { kind: "distance" } //       along the minimap path, in metres (needs mapWidthMetres)
  | { kind: "game_day" }; //      real seconds for one in-game day (24 h of clock)

export interface TelemetryResult {
  value: number;
  /** Seconds into the recording where the measured stretch starts and ends. */
  from: number;
  to: number;
  /** The value over time across the stretch: [recording second, value]. */
  series: Array<[number, number]>;
  /** For counts: each counted moment. */
  ticks?: number[];
}

/**
 * Measures one thing in a window of a recording (pure). Undefined when the reading cannot answer it: no stars seen, no
 * cleared moment, too few positions. Never a guess.
 */
export function measureTelemetry(
  track: HudTrack,
  m: TelemetryMeasure,
  window: { from: number; to: number },
): TelemetryResult | undefined {
  const s = samplesBetween(track, window.from, window.to);
  const ev = track.events.filter((e) => e.t >= window.from && e.t <= window.to);
  switch (m.kind) {
    case "wanted_lost": {
      const start = s.find((x) => (x.wanted ?? 0) > 0);
      if (!start) return undefined;
      const end = s.find((x) => x.t > start.t && x.wanted === 0);
      if (!end) return undefined;
      return {
        value: round(end.t - start.t),
        from: start.t,
        to: end.t,
        series: [
          [start.t, 0],
          [end.t, round(end.t - start.t)],
        ],
      };
    }
    case "event_gap": {
      const a = ev.find((e) => e.kind === m.from);
      const b = a && ev.find((e) => e.t > a.t && e.kind === m.to);
      if (!a || !b) return undefined;
      return {
        value: round(b.t - a.t),
        from: a.t,
        to: b.t,
        series: [
          [a.t, 0],
          [b.t, round(b.t - a.t)],
        ],
      };
    }
    case "count": {
      const hits = ev.filter((e) => e.kind === m.event).map((e) => e.t);
      if (!hits.length)
        return {
          value: 0,
          from: window.from,
          to: window.to,
          series: [[window.from, 0]],
          ticks: [],
        };
      return {
        value: hits.length,
        from: window.from,
        to: hits[hits.length - 1]!,
        series: hits.map((t, i) => [t, i + 1] as [number, number]),
        ticks: hits,
      };
    }
    case "top_speed": {
      const sp = s.filter((x) => typeof x.speed === "number");
      if (sp.length < 2) return undefined;
      let best = 0;
      const series: Array<[number, number]> = sp.map((x) => {
        best = Math.max(best, x.speed!);
        return [x.t, best];
      });
      return {
        value: round(best),
        from: sp[0]!.t,
        to: sp[sp.length - 1]!.t,
        series,
      };
    }
    case "distance": {
      const p = s.filter((x) => x.pos);
      if (p.length < 2 || !track.mapWidthMetres) return undefined;
      let d = 0;
      const series: Array<[number, number]> = [[p[0]!.t, 0]];
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1]!.pos!;
        const b = p[i]!.pos!;
        d += Math.hypot(b.x - a.x, b.y - a.y) * track.mapWidthMetres;
        series.push([p[i]!.t, round(d)]);
      }
      return { value: round(d), from: p[0]!.t, to: p[p.length - 1]!.t, series };
    }
    case "game_day": {
      const c = s.filter((x) => typeof x.clock === "number");
      if (c.length < 2) return undefined;
      // Unwrap the clock past midnight, then find where 24 in-game hours have passed.
      let add = 0;
      const un = c.map((x, i) => {
        if (i > 0 && x.clock! + add < c[i - 1]!.clock! + add - 600) add += 1440;
        return { t: x.t, m: x.clock! + add };
      });
      const first = un[0]!;
      const end = un.find((x) => x.m - first.m >= 1440);
      if (!end) return undefined;
      // Interpolate the exact second the 24th hour ends.
      const prev = un[un.indexOf(end) - 1]!;
      const frac = (first.m + 1440 - prev.m) / Math.max(1e-6, end.m - prev.m);
      const at = prev.t + frac * (end.t - prev.t);
      return {
        value: round(at - first.t),
        from: first.t,
        to: at,
        series: [
          [first.t, 0],
          [at, round(at - first.t)],
        ],
      };
    }
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
