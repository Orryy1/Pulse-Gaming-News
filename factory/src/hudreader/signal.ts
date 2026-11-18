// HUD events as the live-clip detector's fourth signal (HUD_LIVE_SIGNAL, src/liveclips/detect.ts): game state that
// is often quiet on chat and on the microphone. Pure: events in, scored signals out.
//
// Scores sit on the detector's scale, where 1 is one clear signal on its own:
//   Wasted / Busted                         1.2  (a payoff the viewer understands at once)
//   wanted level reaches 3 stars or more    0.8 + 0.2 a star over 3, +0.4 when it climbed 2 or more in one go
//   lost the police from 3 stars or more    1.0  (the escape is the story)
//   mission passed, stunt, under the bridge 0.8
//   mission failed                          0.6
//   a collectible                           0.5
//   a money change of $10,000 or more       0.6
// Lower events (1 or 2 stars, area names, flying) are not moments on their own.

import {
  moneyEvents,
  textEvents,
  wantedEvents,
  type HudEvent,
  type HudProfile,
  type RawSample,
} from "./telemetry.ts";

export interface HudSignal {
  /** Seconds into the recording (or ms since 1970 once placed on the stream's clock by the caller). */
  t: number;
  score: number;
  detail: string;
}

export function scoreHudEvent(e: HudEvent): number {
  switch (e.kind) {
    case "wasted":
    case "busted":
      return 1.2;
    case "wanted_start":
    case "wanted_up": {
      const v = e.value ?? 0;
      if (v < 3) return 0;
      const climb = v - (e.from ?? 0) >= 2 ? 0.4 : 0;
      return Math.round((0.8 + 0.2 * (v - 3) + climb) * 100) / 100;
    }
    case "wanted_clear":
      return (e.from ?? 0) >= 3 ? 1 : 0;
    case "mission_passed":
    case "stunt":
      return 0.8;
    case "mission_failed":
      return 0.6;
    case "collectible":
      return 0.5;
    case "money":
      return Math.abs(e.value ?? 0) >= 10_000 ? 0.6 : 0;
    default:
      return 0;
  }
}

/** The events worth a signal (pure), each with its score; events within 3 s of a stronger one fold into it. */
export function hudSignals(events: HudEvent[]): HudSignal[] {
  const out: HudSignal[] = [];
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const score = scoreHudEvent(e);
    if (score <= 0) continue;
    const detail = e.text ? `${e.detail} ("${e.text.slice(0, 60)}")` : e.detail;
    const near = out.find((s) => Math.abs(s.t - e.t) <= 3);
    if (near) {
      if (score > near.score)
        Object.assign(near, {
          t: e.t,
          score,
          detail: `${detail}; ${near.detail}`,
        });
      else near.detail = `${near.detail}; ${detail}`;
      continue;
    }
    out.push({ t: e.t, score, detail });
  }
  return out;
}

/**
 * The live stream is read ten seconds at a time; the HUD's rules need what came before (a wanted level carried
 * over is not a new one). Given the samples kept from earlier pieces (on the stream's clock, seconds) and a new
 * piece's, returns the signals that fall in the new piece and the samples to keep (the last KEEP_SECONDS). Pure.
 */
export const KEEP_SECONDS = 90;

export function liveHudSignals(
  kept: RawSample[],
  fresh: RawSample[],
  profile: HudProfile,
): { signals: HudSignal[]; kept: RawSample[] } {
  const all = [...kept, ...fresh].sort((a, b) => a.t - b.t);
  if (!fresh.length) return { signals: [], kept };
  const from = Math.min(...fresh.map((s) => s.t));
  const events = [
    ...wantedEvents(all).events,
    ...textEvents(all, profile),
    ...moneyEvents(all),
  ].filter((e) => e.t >= from - 0.01);
  const last = all[all.length - 1]!.t;
  return {
    signals: hudSignals(events),
    kept: all.filter((s) => s.t >= last - KEEP_SECONDS),
  };
}
