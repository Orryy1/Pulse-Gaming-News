// "I measured it" (PULSE_LAB_MEASURED; research 14 Nov section B: small channels that measure one thing get breakout
// scores, because the question has a number for an answer, the method is on screen and the answer arrives last).
// A Short states one number measured on the owner's own footage, shows how it was measured (a timer, a counter or a
// meter running on screen) and says the number only at the end.
//
// Where a number may come from, most trusted first:
//   1. the HUD reader's telemetry for the recording (src/pulselab/telemetry.ts, claude/hudreader), when it exists;
//   2. the owner's own count in the clip's meta.json ("lab_measure": { value, of?, unit? }), for counts on stream;
//   3. the clip's own clock, for a timer only: from where the attempt starts to where the outcome lands, as the
//      second look timed it (src/gameplaydirect.ts). Exact to a second or so, and said as "on the stream's clock".
// Counters and meters never come from a model's reading of frames: no telemetry and no owner count, no counter.

import type { HudTrack, TelemetryMeasure } from "./telemetry.ts";
import { measureTelemetry } from "./telemetry.ts";
import { NUMBER_GIVEAWAY } from "./identity.ts";
import { formatValue, readingAt } from "../render/labplan.ts";
import type { InstrumentKind, ValueFormat } from "../render/labplan.ts";

export { formatValue, readingAt };
export type { InstrumentKind, ValueFormat };


export interface MeasureSpec {
  kind: InstrumentKind;
  /** The instrument's label, in capitals: "TIME TO LOSE THE COPS". */
  label: string;
  unit: string;
  format: ValueFormat;
  /** What the HUD reader can measure for it, when it can. */
  telemetry?: TelemetryMeasure;
}

/** The stream-ask topics a number answers (src/streamasks/asks.ts TOPICS), and how each is measured. */
export const TOPIC_SPECS: Record<string, MeasureSpec> = {
  fuel: {
    kind: "timer",
    label: "DRIVING UNTIL EMPTY",
    unit: "",
    format: "clock",
    telemetry: { kind: "event_gap", from: "drive_start", to: "fuel_empty" },
  },
  "map-size": {
    kind: "timer",
    label: "EDGE TO EDGE",
    unit: "",
    format: "clock",
    telemetry: { kind: "event_gap", from: "edge_start", to: "edge_end" },
  },
  "lose-wanted": {
    kind: "timer",
    label: "TIME TO LOSE THE COPS",
    unit: "",
    format: "clock",
    telemetry: { kind: "wanted_lost" },
  },
  "swim-escape": {
    kind: "timer",
    label: "SWIMMING UNTIL THEY GIVE UP",
    unit: "",
    format: "clock",
    telemetry: { kind: "wanted_lost" },
  },
  "clothes-wanted": {
    kind: "timer",
    label: "TIME TO LOSE THE COPS",
    unit: "",
    format: "clock",
    telemetry: { kind: "wanted_lost" },
  },
  "day-length": {
    kind: "timer",
    label: "ONE IN-GAME DAY",
    unit: "",
    format: "clock",
    telemetry: { kind: "game_day" },
  },
  "car-delivery": {
    kind: "timer",
    label: "CALL TO KEYS",
    unit: "",
    format: "clock",
    telemetry: { kind: "event_gap", from: "call", to: "delivered" },
  },
  "car-explode": {
    kind: "counter",
    label: "HITS UNTIL IT BURNS",
    unit: "hits",
    format: "integer",
    telemetry: { kind: "count", event: "crash" },
  },
  "rob-stores": {
    kind: "counter",
    label: "STORES THAT LET YOU ROB THEM",
    unit: "stores",
    format: "integer",
    telemetry: { kind: "count", event: "robbery" },
  },
  "shopper-fights": {
    kind: "counter",
    label: "HOLD-UPS WHERE SOMEONE FOUGHT BACK",
    unit: "times",
    format: "integer",
    telemetry: { kind: "count", event: "resisted" },
  },
  disarm: {
    kind: "counter",
    label: "GUNS SHOT OUT OF HANDS",
    unit: "times",
    format: "integer",
    telemetry: { kind: "count", event: "disarmed" },
  },
  animals: {
    kind: "counter",
    label: "SPECIES LOGGED",
    unit: "species",
    format: "integer",
    telemetry: { kind: "count", event: "species_logged" },
  },
  interiors: {
    kind: "meter",
    label: "DOORS THAT OPEN",
    unit: "%",
    format: "percent",
  },
  "fall-damage": {
    kind: "meter",
    label: "HIGHEST SURVIVABLE FALL",
    unit: "m",
    format: "integer",
  },
};

const HOW_LONG = /\bhow (long|fast|quick(?:ly)?)\b|\btime (it|to)\b/i;
const HOW_MANY = /\bhow (many|often)\b|\bcount\b/i;
const HOW_FAR = /\bhow (far|high|big|deep)\b/i;
const FALL = /\b(fall|freefall|jump|drop)\w*\b/i;

/** How a question is measured (pure): its topic's spec, else what its words ask for. Undefined: no number answers it. */
export function specFor(
  question: string,
  topic?: string,
): MeasureSpec | undefined {
  if (topic && TOPIC_SPECS[topic]) return TOPIC_SPECS[topic];
  if (HOW_LONG.test(question))
    return {
      kind: "timer",
      label: FALL.test(question) ? "TIME IN THE AIR" : "TIME TAKEN",
      unit: "",
      format: "clock",
    };
  if (HOW_MANY.test(question))
    return { kind: "counter", label: "COUNT", unit: "", format: "integer" };
  if (HOW_FAR.test(question))
    return { kind: "meter", label: "MEASURED", unit: "", format: "integer" };
  return undefined;
}

export interface Measurement {
  question: string;
  spec: MeasureSpec;
  value: number;
  /** Out of how many tries, for a counter ("7 of 10 stores"). */
  of?: number;
  /** A number the claim gave, to compare with ("twice the size"). */
  claimed?: number;
  /** Where the number came from. */
  source: "telemetry" | "owner" | "clip";
  /** How it was measured, said on screen in small type and in the description. */
  method: string;
  /** The instrument's reading over the Short: [Short second, value]. The last point is the answer at the payoff. */
  samples: Array<[number, number]>;
  /** A counter's steps, on the Short's clock. */
  ticks?: number[];
}

/** The answer as the reveal card says it (pure): "2 MIN 41 S", "7 OF 10 STORES", "64%". */
export function revealText(
  m: Pick<Measurement, "value" | "of" | "spec">,
): string {
  const { value, of, spec } = m;
  if (spec.format === "clock") {
    const min = Math.floor(value / 60);
    const sec = Math.round(value - min * 60);
    if (min >= 1) return sec ? `${min} MIN ${sec} S` : `${min} MIN`;
    return `${Math.round(value * 10) / 10} SECONDS`;
  }
  const n = formatValue(value, spec.format);
  const unit =
    spec.unit && spec.unit !== "%" ? ` ${spec.unit.toUpperCase()}` : "";
  return of !== undefined ? `${n} OF ${of}${unit}` : `${n}${unit}`;
}

/** The answer in words for the narrator (pure): "two minutes and forty-one seconds" is left to the voice; this is plain. */
export function spokenAnswer(
  m: Pick<Measurement, "value" | "of" | "spec">,
): string {
  if (m.spec.format === "clock") {
    const min = Math.floor(m.value / 60);
    const sec = Math.round(m.value - min * 60);
    if (min >= 1)
      return `${min} minute${min === 1 ? "" : "s"}${sec ? ` and ${sec} second${sec === 1 ? "" : "s"}` : ""}`;
    return `${Math.round(m.value * 10) / 10} seconds`;
  }
  const n = formatValue(m.value, m.spec.format);
  return m.of !== undefined
    ? `${n} out of ${m.of}`
    : `${n}${m.spec.unit === "%" ? " per cent" : m.spec.unit ? ` ${m.spec.unit}` : ""}`;
}

export interface ClipTiming {
  /** The kept stretches of the source clip, in order (src/gameplaydirect.ts DirectCut). */
  segments: Array<{ start: number; end: number }>;
  /** The attempt's start and the outcome, in source-clip seconds (the second look). */
  actionStart: number;
  payoff: number;
  /** Where the outcome lands on the Short's clock. */
  payoffAt: number;
  /** The clip's start in the recording (meta.clip.start_in_source), for telemetry. */
  clipInSource?: number;
}

/** A source-clip second on the Short's clock (pure); undefined when that second was cut. */
export function shortClock(
  t: number,
  segments: ClipTiming["segments"],
): number | undefined {
  let at = 0;
  for (const s of segments) {
    if (t >= s.start && t <= s.end) return at + (t - s.start);
    at += s.end - s.start;
  }
  return undefined;
}

/**
 * The timer's readings across the Short from the clip's own clock (pure): it starts at 0 where the attempt starts and
 * runs with the source clock, so a cut-out dead stretch shows as a jump (never hidden), and it stops on the outcome.
 */
export function clipTimerSamples(c: ClipTiming): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const start = Math.max(c.actionStart, c.segments[0]?.start ?? 0);
  for (const s of c.segments) {
    const a = Math.max(s.start, start);
    const b = Math.min(s.end, c.payoff);
    if (b <= a) continue;
    const at = shortClock(a, c.segments)!;
    const bt = shortClock(b, c.segments)!;
    out.push([round(at), round(a - start)], [round(bt), round(b - start)]);
  }
  return out;
}

/**
 * A telemetry stretch on the Short's clock (pure): the reading's start lands where the attempt starts and its end on
 * the outcome. A stretch longer than the Short is compressed evenly (the instrument shows a fast-forward mark).
 */
export function compressSeries(
  series: Array<[number, number]>,
  startAt: number,
  payoffAt: number,
): Array<[number, number]> {
  if (!series.length) return [];
  const t0 = series[0]![0];
  const t1 = series[series.length - 1]![0];
  const span = Math.max(1e-6, t1 - t0);
  return series.map(([t, v]) => [
    round(startAt + ((t - t0) / span) * (payoffAt - startAt)),
    v,
  ]);
}

/** How many times faster than real time the instrument runs (pure): 1 for a clip's own clock. */
export function speedUp(
  samples: Array<[number, number]>,
  f: ValueFormat,
): number {
  if (f !== "clock" || samples.length < 2) return 1;
  const [a, b] = [samples[0]!, samples[samples.length - 1]!];
  const real = b[1] - a[1];
  const shown = b[0] - a[0];
  return shown > 0 ? Math.max(1, Math.round((real / shown) * 10) / 10) : 1;
}

export interface MeasureInput {
  question: string;
  topic?: string;
  timing: ClipTiming;
  track?: HudTrack;
  /** The owner's own count from the clip's meta.json. */
  owner?: { value: number; of?: number; unit?: string };
  claimed?: number;
}

/** The measurement a clip can honestly state (pure), or undefined with nothing measured. */
export function measure(i: MeasureInput): Measurement | undefined {
  const spec = specFor(i.question, i.topic);
  if (!spec) return undefined;
  const { timing } = i;
  const startAt = Math.max(
    0,
    shortClock(
      Math.max(timing.actionStart, timing.segments[0]?.start ?? 0),
      timing.segments,
    ) ?? 0,
  );
  // 1. The HUD reader: a long test (losing the cops, a drive across the map) starts well before the clip, so the reading is
  //    searched from 30 minutes before the outcome to just after it; the outcome itself is what the clip shows.
  if (i.track && spec.telemetry && timing.clipInSource !== undefined) {
    const from = timing.clipInSource + timing.payoff - 1800;
    const to = timing.clipInSource + timing.payoff + 5;
    const r = measureTelemetry(i.track, spec.telemetry, { from, to });
    if (r) {
      const samples = compressSeries(r.series, startAt, timing.payoffAt);
      const ticks = r.ticks?.length
        ? compressSeries(
            r.ticks.map((t, k) => [t, k + 1] as [number, number]),
            startAt,
            timing.payoffAt,
          ).map(([t]) => t)
        : undefined;
      return {
        question: i.question,
        spec,
        value: r.value,
        ...(i.owner?.of !== undefined ? { of: i.owner.of } : {}),
        ...(i.claimed !== undefined ? { claimed: i.claimed } : {}),
        source: "telemetry",
        method: methodLine(spec, "telemetry"),
        samples:
          samples.length === 1
            ? [
                [startAt, 0],
                [timing.payoffAt, r.value],
              ]
            : samples,
        ...(ticks ? { ticks } : {}),
      };
    }
  }
  // 2. The owner's own count.
  if (i.owner && Number.isFinite(i.owner.value) && i.owner.value >= 0) {
    const n = i.owner.value;
    const ticks =
      spec.kind === "counter" && n > 0
        ? Array.from({ length: Math.round(n) }, (_, k) =>
            round(
              startAt + ((k + 1) / (n + 0.5)) * (timing.payoffAt - startAt),
            ),
          )
        : undefined;
    return {
      question: i.question,
      spec: i.owner.unit ? { ...spec, unit: i.owner.unit } : spec,
      value: n,
      ...(i.owner.of !== undefined ? { of: i.owner.of } : {}),
      ...(i.claimed !== undefined ? { claimed: i.claimed } : {}),
      source: "owner",
      method: methodLine(spec, "owner"),
      samples: ticks
        ? [[startAt, 0], ...ticks.map((t, k) => [t, k + 1] as [number, number])]
        : [
            [startAt, 0],
            [timing.payoffAt, n],
          ],
      ...(ticks ? { ticks } : {}),
    };
  }
  // 3. A timer from the clip's own clock.
  if (spec.kind === "timer") {
    const samples = clipTimerSamples(timing);
    if (samples.length < 2) return undefined;
    const value = samples[samples.length - 1]![1];
    if (!(value >= 1)) return undefined; // under a second is not a measurement worth a Short
    return {
      question: i.question,
      spec,
      value,
      ...(i.claimed !== undefined ? { claimed: i.claimed } : {}),
      source: "clip",
      method: methodLine(spec, "clip"),
      samples,
    };
  }
  return undefined;
}

/** The small method line under the instrument (pure). */
export function methodLine(
  spec: MeasureSpec,
  source: Measurement["source"],
): string {
  if (source === "telemetry")
    return spec.kind === "timer"
      ? "TIMED FROM THE HUD, ON OUR OWN STREAM"
      : "READ OFF THE HUD, ON OUR OWN STREAM";
  if (source === "owner") return "COUNTED LIVE ON OUR OWN STREAM";
  return "TIMED ON THE STREAM'S OWN CLOCK";
}

/**
 * What would give the answer away before the end (pure): the number in the title, the hook or the setup. The payoff
 * line and the reveal card are where it belongs.
 */
export function measuredProblems(
  m: Pick<Measurement, "value" | "of" | "spec">,
  lines: { title?: string; hook?: string; setup?: string },
): string[] {
  const out: string[] = [];
  const shown = [
    formatValue(m.value, m.spec.format),
    String(Math.round(m.value)),
  ];
  for (const [where, text] of Object.entries(lines)) {
    if (!text) continue;
    if (
      shown.some(
        (s) =>
          s.length &&
          new RegExp(
            `(?<![\\d.:])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d])`,
          ).test(text),
      )
    )
      out.push(`The ${where} says the measured answer; it comes last.`);
    else if (
      where !== "title" &&
      NUMBER_GIVEAWAY.test(text) &&
      /\b(it took|it lasted|exactly|precisely|turns out)\b/i.test(text)
    )
      out.push(`The ${where} hints at the answer; it comes last.`);
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
