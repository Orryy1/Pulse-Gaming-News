// The HUD graphics on a GTA 6 Day N Short (HUD_PIN, HUD_TICKER, HUD_END_MAP): what the renderer draws
// (src/render/components/hud/HudOverlay.tsx) and the audit that keeps it honest. Pure, and free of Node imports so
// the Remotion bundle can share the types.
//
//   pin       seconds 0 to 2: a minimap-style disc cut from the stitched map, a pin on the spot and its name
//             ("Vespucci Canals" or "near Vespucci Canals"), so a viewer knows the place before the line lands;
//   ticker    while the clip runs: the wanted level as the reader measured it, pulsing on each change;
//   end map   the last seconds: every Day N spot so far on the stitched map, today's lit, "Day N: N spots so far".
//
// The audit follows the channel's graphics rules (src/qa/gfxaudit.ts: reading time per word, no clash with the
// hook or the result stamp, every figure from a measurement): a graphic that cannot meet them is dropped, never
// squeezed.

import { READ_FLOOR, readNeed, type GfxFinding } from "../qa/gfxaudit.ts";

export interface HudPinProps {
  label: string;
  /** The small line under it: "GTA 6 Day 3". */
  sub: string;
  from: number;
  until: number;
  /** A square crop of the stitched map around the spot (served file), and where the spot is in it (0-1). */
  mapImage?: string;
  dot?: { x: number; y: number };
}

export interface HudTickerProps {
  /** Seconds into the Short and the level from then on. */
  changes: Array<{ t: number; stars: number }>;
  max: number;
  from: number;
  until: number;
}

export interface HudEndMapProps {
  image: string;
  width: number;
  height: number;
  /** Spot positions as fractions of the image. */
  spots: Array<{
    x: number;
    y: number;
    day: number;
    label?: string;
    today: boolean;
  }>;
  title: string;
  from: number;
  until: number;
}

export interface HudOverlayProps {
  pin?: HudPinProps;
  ticker?: HudTickerProps;
  endMap?: HudEndMapProps;
  accent: string;
}

export const PIN_SECONDS = 2;
export const END_MAP_SECONDS = 2.6;
export const LABEL_MAX = 28;
/** A place name in the first 2 seconds: three words at most, so it is read before the pin goes. */
export const LABEL_WORDS = 3;
/** What the pin says when the place has no name it can show. */
export const PLAIN_LABEL = "Today's spot";
/** The result stamp's time on screen (src/render/GameplayShort.tsx). */
export const STAMP_SECONDS = 2.4;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export interface OverlayInput {
  durationSeconds: number;
  /** Seconds of the recording the Short's first frame is. */
  clipStart: number;
  day: number;
  pin?: {
    label?: string;
    confidence: number;
    crop?: { image: string; x: number; y: number };
  };
  /** The wanted level through the clip (recording seconds), from the track. */
  stars?: Array<{ t: number; stars: number }>;
  endMap?: {
    image: string;
    width: number;
    height: number;
    spots: HudEndMapProps["spots"];
  };
  switches: { pin: boolean; ticker: boolean; endMap: boolean };
  minConfidence: number;
  accent: string;
}

/** The overlay for a Short (pure): only the parts switched on and sure enough. */
export function buildOverlay(o: OverlayInput): HudOverlayProps {
  const out: HudOverlayProps = { accent: o.accent };
  if (o.switches.pin && o.pin && o.pin.confidence >= o.minConfidence) {
    out.pin = {
      label: o.pin.label ?? PLAIN_LABEL,
      sub: `GTA 6 Day ${o.day}`,
      from: 0,
      until: PIN_SECONDS,
      ...(o.pin.crop
        ? {
            mapImage: o.pin.crop.image,
            dot: { x: o.pin.crop.x, y: o.pin.crop.y },
          }
        : {}),
    };
  }
  if (o.switches.ticker && o.stars?.length) {
    const changes: HudTickerProps["changes"] = [];
    for (const s of o.stars) {
      const t = Math.max(0, Math.round((s.t - o.clipStart) * 100) / 100);
      if (t > o.durationSeconds) break;
      if (!changes.length || changes[changes.length - 1]!.stars !== s.stars)
        changes.push({ t, stars: s.stars });
    }
    // Shown only when the clip has a wanted level at some point: a row of empty stars says nothing.
    if (changes.some((c) => c.stars > 0))
      out.ticker = { changes, max: 5, from: 0, until: o.durationSeconds };
  }
  if (o.switches.endMap && o.endMap && o.endMap.spots.length) {
    const n = o.endMap.spots.length;
    out.endMap = {
      ...o.endMap,
      title: `Day ${o.day}: ${n} spot${n === 1 ? "" : "s"} so far`,
      from: Math.max(0, o.durationSeconds - END_MAP_SECONDS),
      until: o.durationSeconds,
    };
  }
  return out;
}

/** The audit (pure): findings in the graphics audit's terms, and the overlay with anything failing dropped or fixed. */
export function auditOverlay(
  props: HudOverlayProps,
  ctx: { durationSeconds: number; hookEnd: number; payoffAt: number },
): { props: HudOverlayProps; findings: GfxFinding[] } {
  const findings: GfxFinding[] = [];
  const out: HudOverlayProps = { ...props };
  if (out.pin) {
    const p = { ...out.pin };
    if (p.label.length > LABEL_MAX || words(p.label) > LABEL_WORDS) {
      // A place name cut half way reads as nonsense (the titles' rule too): the plain label stands in.
      findings.push({
        key: "hud_pin",
        kind: "card",
        check: "fit",
        level: "fix",
        t: p.from,
        detail: `"${p.label}" is too long to read in 2 seconds; shown as "${PLAIN_LABEL}"`,
        action: "trim",
      });
      p.label = PLAIN_LABEL;
    }
    // The series chip ("GTA 6 DAY 4") is the same every day and is recognised, not read: it counts as one word.
    const need = readNeed(words(p.label) + 1);
    if (p.from > 0.2)
      findings.push({
        key: "hud_pin",
        kind: "card",
        check: "alignment",
        level: "fix",
        t: p.from,
        detail: "the pin must be there from the first frame",
        action: "move",
      });
    p.from = 0;
    if (p.until - p.from < need) {
      findings.push({
        key: "hud_pin",
        kind: "card",
        check: "reading",
        level: "fix",
        t: 0,
        detail: `held to ${need.toFixed(1)} s to be read`,
        action: "hold",
      });
      p.until = need;
    }
    if (p.until > PIN_SECONDS + 0.6) {
      findings.push({
        key: "hud_pin",
        kind: "card",
        check: "reading",
        level: "wrong",
        t: 0,
        detail: "too many words to read in the first 2 seconds",
        action: "drop",
      });
      delete out.pin;
    } else out.pin = p;
  }
  if (out.ticker) {
    const t = { ...out.ticker, changes: [...out.ticker.changes] };
    const merged: HudTickerProps["changes"] = [];
    for (const c of t.changes) {
      const last = merged[merged.length - 1];
      if (last && c.t - last.t < READ_FLOOR) {
        findings.push({
          key: "hud_ticker",
          kind: "card",
          check: "reading",
          level: "fix",
          t: c.t,
          detail: `star change at ${c.t}s merged: under ${READ_FLOOR}s after the last`,
          action: "drop",
        });
        last.stars = c.stars;
        continue;
      }
      merged.push({ ...c });
    }
    if (merged.some((c) => c.stars > (t.max || 5) || c.stars < 0)) {
      findings.push({
        key: "hud_ticker",
        kind: "card",
        check: "figures",
        level: "wrong",
        t: 0,
        detail: "a star count outside 0 to 5",
        action: "drop",
      });
      delete out.ticker;
    } else out.ticker = { ...t, changes: merged };
  }
  if (out.endMap) {
    const e = { ...out.endMap };
    const need = Math.max(2, readNeed(words(e.title)));
    const stampEnd = ctx.payoffAt + STAMP_SECONDS;
    if (e.from < stampEnd && e.until > ctx.payoffAt) {
      e.from = stampEnd;
      findings.push({
        key: "hud_endmap",
        kind: "card",
        check: "clash",
        level: "fix",
        t: e.from,
        detail: "end map moved after the result stamp",
        action: "move",
      });
    }
    if (e.until - e.from < need) {
      findings.push({
        key: "hud_endmap",
        kind: "card",
        check: "reading",
        level: "wrong",
        t: e.from,
        detail: `only ${(e.until - e.from).toFixed(1)} s left after the stamp; needs ${need.toFixed(1)} s`,
        action: "drop",
      });
      delete out.endMap;
    } else if (!e.spots.some((s) => s.today)) {
      findings.push({
        key: "hud_endmap",
        kind: "card",
        check: "meaning",
        level: "wrong",
        t: e.from,
        detail: "today's spot is not on the map",
        action: "drop",
      });
      delete out.endMap;
    } else out.endMap = e;
  }
  return { props: out, findings };
}

/** Whether anything is left to draw. */
export const hasOverlay = (p: HudOverlayProps | undefined): boolean =>
  !!p && !!(p.pin || p.ticker || p.endMap);
