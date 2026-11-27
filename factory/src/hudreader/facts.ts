// Measured facts for "I measured it" Shorts (HUD_FACTS, formats research 14 Nov 2026, item 3): numbers read off the
// owner's own footage, never guessed. How long a wanted level lasted and how fast it climbed, how long a journey took
// and how far it went, how quickly collectibles fell. Pure.
//
// Honesty rules:
//   - a distance is said in metres or kilometres only once the game's map scale is measured (profile metresPerUnit,
//     set by calibration); until then a journey fact gives its time only;
//   - a fact carries its confidence (the share of its samples the reader was sure of) and the times it rests on, so the
//     Short can show the method on screen (a stopwatch from start to end) and the writer can cite the moment;
//   - numbers are rounded the way the channel says them ("just over 3 minutes", not "3 minutes 7 seconds").

import type { HudEvent, HudTrack } from "./telemetry.ts";

export interface WantedSpell {
  start: number;
  end: number;
  seconds: number;
  peak: number;
  /** Seconds from the first star to the peak. */
  toPeak: number;
  endedBy: "lost them" | "wasted" | "busted" | "still wanted";
}

export interface Journey {
  start: number;
  end: number;
  seconds: number;
  /** Map units along the path and as the crow flies. */
  distance: number;
  straight: number;
  island: number;
  air: boolean;
  /** Share of the journey's live-play samples the minimap placed. */
  placed: number;
}

export interface CollectibleRun {
  label: string;
  total: number;
  from: number;
  to: number;
  count: number;
  start: number;
  end: number;
  /** Seconds per item over the run. */
  each: number;
}

export interface MeasuredFact {
  kind: "wanted" | "wanted_climb" | "journey" | "collectibles";
  /** The line for the writer and the result card ("Lost a 3-star wanted level in 48 seconds"). */
  text: string;
  value: number;
  unit: "seconds" | "metres" | "items";
  /** Seconds into the recording the measurement starts and ends at (the on-screen stopwatch's span). */
  start: number;
  end: number;
  confidence: number;
}

/** Seconds as the channel says them (pure): "48 seconds", "just over 3 minutes", "about an hour and a half". */
export function sayDuration(s: number): string {
  if (s < 60) {
    const r = s < 10 ? Math.round(s * 10) / 10 : Math.round(s);
    return `${r} second${r === 1 ? "" : "s"}`;
  }
  const m = s / 60;
  if (m < 10) {
    const whole = Math.floor(m);
    const rest = s - whole * 60;
    const unit = `${whole} minute${whole === 1 ? "" : "s"}`;
    if (rest < 8) return `${unit}`;
    if (rest < 22) return `just over ${unit}`;
    if (rest < 38) return `${whole} and a half minutes`;
    if (rest < 52) return `just under ${whole + 1} minutes`;
    return `${whole + 1} minutes`;
  }
  if (m < 55) return `about ${Math.round(m / 5) * 5} minutes`;
  const h = m / 60;
  const half = Math.round(h * 2) / 2;
  if (half === 1) return "about an hour";
  if (half === 1.5) return "about an hour and a half";
  return `about ${half} hours`;
}

/** Metres as the channel says them (pure): "800 metres", "2.4 km". */
export function sayDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} metres`;
  return `${Math.round(m / 100) / 10} km`;
}

/** Every wanted spell in the track (pure), from first star to cleared, wasted or busted. */
export function wantedSpells(track: HudTrack): WantedSpell[] {
  const out: WantedSpell[] = [];
  let open: { start: number; peak: number; peakAt: number } | undefined;
  for (const e of track.events) {
    if (e.kind === "wanted_start")
      open = { start: e.t, peak: e.value ?? 1, peakAt: e.t };
    else if (open && e.kind === "wanted_up" && (e.value ?? 0) > open.peak) {
      open.peak = e.value!;
      open.peakAt = e.t;
    } else if (
      open &&
      (e.kind === "wanted_clear" || e.kind === "wasted" || e.kind === "busted")
    ) {
      out.push({
        start: open.start,
        end: e.t,
        seconds: Math.round((e.t - open.start) * 10) / 10,
        peak: open.peak,
        toPeak: Math.round((open.peakAt - open.start) * 10) / 10,
        endedBy: e.kind === "wanted_clear" ? "lost them" : e.kind,
      });
      open = undefined;
    }
  }
  const last = track.points[track.points.length - 1];
  if (open && last)
    out.push({
      start: open.start,
      end: last.t,
      seconds: Math.round((last.t - open.start) * 10) / 10,
      peak: open.peak,
      toPeak: Math.round((open.peakAt - open.start) * 10) / 10,
      endedBy: "still wanted",
    });
  return out;
}

/** Stretches the minimap followed without a break (pure): at least minSeconds, gaps up to maxGap allowed. */
export function journeys(
  track: HudTrack,
  minSeconds = 20,
  maxGap = 2.5,
): Journey[] {
  const out: Journey[] = [];
  let cur: { pts: typeof track.points; hud: number } | undefined;
  const close = () => {
    if (!cur || cur.pts.length < 2) return;
    const pts = cur.pts;
    const seconds = pts[pts.length - 1]!.t - pts[0]!.t;
    if (seconds < minSeconds) return;
    let distance = 0;
    for (let i = 1; i < pts.length; i++)
      distance += Math.hypot(
        pts[i]!.x! - pts[i - 1]!.x!,
        pts[i]!.y! - pts[i - 1]!.y!,
      );
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    out.push({
      start: a.t,
      end: b.t,
      seconds: Math.round(seconds * 10) / 10,
      distance: Math.round(distance),
      straight: Math.round(Math.hypot(b.x! - a.x!, b.y! - a.y!)),
      island: a.island!,
      air: pts.filter((p) => p.air).length > pts.length / 2,
      placed: Math.round((pts.length / Math.max(1, cur.hud)) * 100) / 100,
    });
  };
  for (const p of track.points) {
    if (p.state !== "hud") {
      if (
        cur &&
        cur.pts.length &&
        p.t - cur.pts[cur.pts.length - 1]!.t > maxGap
      ) {
        close();
        cur = undefined;
      }
      continue;
    }
    const placed = p.island !== undefined && p.x !== undefined;
    const last = cur?.pts[cur.pts.length - 1];
    if (
      placed &&
      cur &&
      last &&
      (last.island !== p.island || p.t - last.t > maxGap)
    ) {
      close();
      cur = undefined;
    }
    if (!cur) cur = { pts: [], hud: 0 };
    cur.hud++;
    if (placed) cur.pts.push(p);
  }
  close();
  return out;
}

/** Runs of a collectible counter ("22 / 50 Bridges flown under") going up (pure). */
export function collectibleRuns(events: HudEvent[]): CollectibleRun[] {
  const byTotal = new Map<number, HudEvent[]>();
  for (const e of events)
    if (e.kind === "collectible" && e.total && e.value !== undefined)
      byTotal.set(e.total, [...(byTotal.get(e.total) ?? []), e]);
  const out: CollectibleRun[] = [];
  for (const [total, evs] of byTotal) {
    const sorted = evs.sort((a, b) => a.t - b.t);
    // Only counts that go up are kept: a misread "12" in a run of 20s is dropped.
    const ups: HudEvent[] = [];
    for (const e of sorted)
      if (!ups.length || e.value! > ups[ups.length - 1]!.value!) ups.push(e);
    if (ups.length < 2) continue;
    const first = ups[0]!;
    const last = ups[ups.length - 1]!;
    const count = last.value! - first.value!;
    // "under the bridge 22 / 50 Bridges flown under": the words after the count name what is counted.
    const [before = "", after = ""] = (last.text ?? "").split(
      /\d{1,3}\s*\/\s*\d{1,3}/,
    );
    const label = (after.trim() || before.trim()).replace(/\s+/g, " ");
    out.push({
      label,
      total,
      from: first.value!,
      to: last.value!,
      count,
      start: first.t,
      end: last.t,
      each: Math.round((last.t - first.t) / Math.max(1, count)),
    });
  }
  return out;
}

/** The facts worth a Short (pure), strongest first. */
export function measuredFacts(
  track: HudTrack,
  o: { metresPerUnit?: number | null; minConfidence?: number } = {},
): MeasuredFact[] {
  const out: MeasuredFact[] = [];
  const conf = track.quality.placedShare;
  for (const w of wantedSpells(track)) {
    if (w.endedBy === "still wanted") continue;
    const stars = `${w.peak}-star`;
    out.push({
      kind: "wanted",
      text:
        w.endedBy === "lost them"
          ? `Lost a ${stars} wanted level in ${sayDuration(w.seconds)}`
          : `Lasted ${sayDuration(w.seconds)} at up to ${w.peak} star${w.peak === 1 ? "" : "s"} before being ${w.endedBy}`,
      value: w.seconds,
      unit: "seconds",
      start: w.start,
      end: w.end,
      confidence: 0.9,
    });
    if (w.peak >= 2 && w.toPeak > 0)
      out.push({
        kind: "wanted_climb",
        text: `0 to ${w.peak} stars in ${sayDuration(w.toPeak)}`,
        value: w.toPeak,
        unit: "seconds",
        start: w.start,
        end: w.start + w.toPeak,
        confidence: 0.85,
      });
  }
  for (const j of journeys(track)) {
    if (j.placed < 0.7) continue;
    const metres = o.metresPerUnit ? j.distance * o.metresPerUnit : undefined;
    const how = j.air ? "Flew" : "Travelled";
    out.push({
      kind: "journey",
      text: metres
        ? `${how} ${sayDistance(metres)} in ${sayDuration(j.seconds)}`
        : `${how} for ${sayDuration(j.seconds)} without a stop`,
      value: metres ?? j.seconds,
      unit: metres ? "metres" : "seconds",
      start: j.start,
      end: j.end,
      confidence: Math.round(Math.min(conf, j.placed) * 100) / 100,
    });
  }
  for (const r of collectibleRuns(track.events)) {
    if (r.count < 2) continue;
    const what = r.label || "Collectibles";
    out.push({
      kind: "collectibles",
      text: `${what}: ${r.count} more in ${sayDuration(r.end - r.start)}, one every ${sayDuration(r.each)} (${r.to} of ${r.total})`,
      value: r.count,
      unit: "items",
      start: r.start,
      end: r.end,
      confidence: 0.9,
    });
  }
  const min = o.minConfidence ?? 0;
  return out.filter((f) => f.confidence >= min);
}
