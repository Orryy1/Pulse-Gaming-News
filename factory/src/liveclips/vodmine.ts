// The back catalogue (owner, 26 Nov 2026: "the main reason for the streams anyway is for you to have my own footage to
// use"): past recordings of the owner's channel and his cousin's, replayed through the live-clip detector
// (src/liveclips/detect.ts) with the HUD reader's events as a signal (src/hudreader/signal.ts), so the game's own moments
// (Wasted, Busted, a wanted level climbing or lost) become gameplay Short candidates for the lane's normal review and
// the owner's tap. Pure: measures and signals in, ranked moments and inbox entries out (src/tools/hudmine.ts does the
// files). Chat is left out: the owner's past chats are near empty (spam only, 26 Nov 2026).
//
// Rules:
//   - a window the nightly finder, a live clip or an earlier run already took is never filed again (taken spans);
//   - the owner's recordings were mined by loudness every night already, so only moments the HUD backs are filed
//     from them; the cousin's were never mined, so his loudest moments count too;
//   - a story moment (a mission passed or failed) is filed held until the spoiler window closes, the lane's own
//     spoiler mechanism, so it is looked at again after that date and not before.

import crypto from "node:crypto";
import type { GameplayMeta } from "../gameplay.ts";
import type { HudSignal } from "../hudreader/signal.ts";
import type { HudEvent } from "../hudreader/telemetry.ts";
import {
  CLIP_SECONDS,
  LiveDetector,
  type Moment,
  type SecondSample,
} from "./detect.ts";

export interface BackMoment {
  /** Seconds into the recording. */
  at: number;
  start: number;
  end: number;
  peakInClip: number;
  score: number;
  kinds: string[];
  details: string[];
  /** A story beat (mission passed or failed): held for spoilers. */
  story: boolean;
}

/** Replays a recording's per-second measures and HUD signals (seconds into it) through the detector (pure). */
export function backMoments(
  samples: SecondSample[],
  hud: HudSignal[],
  o: { startMs: number; minScore: number },
): BackMoment[] {
  // Caps are the caller's business here: the detector only merges signals and scores them.
  const det = new LiveDetector({
    minScore: o.minScore,
    perHour: 60,
    perDay: 1000,
    gapMinutes: 0,
    warmupMinutes: 8,
    chatLagSeconds: 8,
    clipLagSeconds: 15,
    dayStart: () => 0,
  });
  const found: Moment[] = [];
  const hudMs = [...hud]
    .map((h) => ({ ...h, at: o.startMs + h.t * 1000 }))
    .sort((a, b) => a.at - b.at);
  let hi = 0;
  let nextPoll = 0;
  for (const s of samples) {
    det.addSecond(s);
    while (hi < hudMs.length && hudMs[hi]!.at <= s.at) det.addHud(hudMs[hi++]!);
    if (s.at >= nextPoll) {
      nextPoll = s.at + 15_000;
      found.push(...det.poll(s.at));
    }
  }
  while (hi < hudMs.length) det.addHud(hudMs[hi++]!);
  const lastAt = (samples[samples.length - 1]?.at ?? o.startMs) + 10 * 60_000;
  found.push(...det.poll(lastAt));
  const sec = (ms: number) => Math.round((ms - o.startMs) / 100) / 10;
  return found.map((m) => {
    // Whole seconds, the clip cut from exactly where meta.json says; a moment in the first seconds starts at 0, so
    // its place in the clip is worked out again.
    const start = Math.max(0, Math.round(sec(m.start)));
    const at = sec(m.at);
    return {
      at,
      start,
      end: start + CLIP_SECONDS,
      peakInClip: Math.round((at - start) * 10) / 10,
      score: m.score,
      kinds: [...new Set(m.signals.map((s) => s.kind))],
      details: m.signals.map((s) => s.detail),
      story: m.signals.some(
        (s) => s.kind === "hud" && /mission (passed|failed)/i.test(s.detail),
      ),
    };
  });
}

/** Whether [start, end) overlaps a taken span, with `pad` seconds either side (pure). */
export function overlapsTaken(
  start: number,
  end: number,
  taken: Array<[number, number]>,
  pad = 20,
): boolean {
  return taken.some(([a, b]) => start < b + pad && end > a - pad);
}

/**
 * The moments to file from one recording (pure): HUD-backed only when `hudOnly` (the owner's, mined nightly by
 * loudness already), none overlapping what is taken, at least `gapSeconds` apart, strongest first, at most `top`.
 */
export function pickMoments(
  moments: BackMoment[],
  taken: Array<[number, number]>,
  o: { top: number; hudOnly: boolean; gapSeconds: number; minScore: number },
): BackMoment[] {
  const out: BackMoment[] = [];
  const ranked = moments
    .filter((m) => m.score >= o.minScore)
    .filter((m) => !o.hudOnly || m.kinds.includes("hud"))
    .filter((m) => !overlapsTaken(m.start, m.end, taken))
    .sort(
      (a, b) =>
        Number(b.kinds.includes("hud")) - Number(a.kinds.includes("hud")) ||
        b.score - a.score,
    );
  for (const m of ranked) {
    if (out.length >= o.top) break;
    if (out.some((x) => Math.abs(x.at - m.at) < o.gapSeconds)) continue;
    out.push(m);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The taken spans per recording from inbox entries and live_taken.json (pure): VOD id -> [start, end] seconds. */
export function takenFrom(
  metas: Array<Pick<GameplayMeta, "source" | "clip">>,
  liveTaken: Record<string, Array<[number, number]>> = {},
): Record<string, Array<[number, number]>> {
  const out: Record<string, Array<[number, number]>> = {};
  for (const [vod, spans] of Object.entries(liveTaken))
    out[vod] = [...(out[vod] ?? []), ...spans];
  for (const m of metas) {
    const vod = m.source?.file?.match(/\[(v\d+)\]/)?.[1];
    const from = m.clip?.start_in_source;
    if (!vod || typeof from !== "number") continue;
    (out[vod] ??= []).push([from, from + (m.clip.seconds || CLIP_SECONDS)]);
  }
  return out;
}

/** The inbox entry for a back-catalogue moment (pure). `heldUntil`: the spoiler window's end, for a story moment. */
export function backMeta(
  m: BackMoment,
  rec: {
    file: string;
    title: string;
    vodId: string;
    seconds: number;
    credit: string;
  },
  frames: string[],
  now: Date,
  heldUntil?: string,
): GameplayMeta {
  const id = `gp_hud_${crypto
    .createHash("sha1")
    .update(`${rec.vodId}|${Math.round(m.start)}`)
    .digest("hex")
    .slice(0, 10)}`;
  const held = m.story && heldUntil && Date.parse(heldUntil) > now.getTime();
  return {
    id,
    status: held ? "rejected" : "new",
    source: {
      file: rec.file,
      title: rec.title,
      kind: "twitch_vod",
      duration_seconds: Math.round(rec.seconds),
      ...(rec.credit ? { credit: rec.credit } : {}),
    },
    clip: {
      file: "clip.mp4",
      start_in_source: Math.round(m.start),
      peak_in_clip: m.peakInClip,
      seconds: CLIP_SECONDS,
    },
    score: m.score,
    frames,
    created_at: now.toISOString(),
    // The reviewer is told what the HUD saw (gameplay.ts reviewClip), to use only if the frames agree.
    hud: {
      facts: [],
      events: m.details
        .filter((d) => d.startsWith("on screen: "))
        .map((d) => d.slice(11)),
    },
    ...(held
      ? {
          review: {
            at: now.toISOString(),
            keep: false,
            reason:
              "A story moment (a mission result or dialogue on screen): held until the spoiler window closes.",
            spoiler_held_until: heldUntil,
          },
        }
      : {}),
  };
}

/**
 * Escapes as back-catalogue signals (pure). The live scoring counts a wanted level only from 3 stars, but the owner's
 * play is mostly 1 and 2 stars, and the lane keeps a clean escape at any level (his 23 Nov boat escape from 1 star was
 * kept: "the wanted indicator disappears"). A spell of at least `minSeconds` that ends with the police lost is one
 * clear signal (1.0) at the moment the stars went, so the cut holds the run-up and the escape.
 */
export function escapeSignals(events: HudEvent[], minSeconds = 30): HudSignal[] {
  const out: HudSignal[] = [];
  let since: number | undefined;
  let top = 0;
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.kind === "wanted_start") {
      since = e.t;
      top = e.value ?? 0;
    } else if (e.kind === "wanted_up") top = Math.max(top, e.value ?? 0);
    else if (e.kind === "wanted_clear" && since !== undefined) {
      const lasted = e.t - since;
      // A clear from 3 stars or more the live rule already scores (src/hudreader/signal.ts); a chase that came down
      // from 3 to 2 before it was lost is counted here.
      if (lasted >= minSeconds && top > 0 && (e.from ?? 0) < 3)
        out.push({
          t: e.t,
          score: 1,
          detail: `lost the police at ${top} star${top === 1 ? "" : "s"} after ${Math.round(lasted)} s`,
        });
      since = undefined;
      top = 0;
    }
  }
  return out;
}

/**
 * What the reader saw over a clip's window (pure): the share of live play and the share with subtitles on screen.
 * A window that is mostly cutscene is no gameplay Short (an "escape" is often the stars vanishing as a cutscene
 * starts), and one full of dialogue is a story moment, held for spoilers.
 */
export function windowShares(
  samples: Array<{ t: number; state: string; talk?: boolean }>,
  start: number,
  end: number,
): { hud: number; talk: number } | undefined {
  const inside = samples.filter((s) => s.t >= start && s.t < end);
  if (!inside.length) return undefined;
  return {
    hud: inside.filter((s) => s.state === "hud").length / inside.length,
    talk: inside.filter((s) => s.talk).length / inside.length,
  };
}

/** Moments whose window is mostly live play, story-marked when dialogue fills it (pure). */
export function judgeWindows(
  moments: BackMoment[],
  samples: Array<{ t: number; state: string; talk?: boolean }>,
  o: { minHud: number; storyTalk: number } = { minHud: 0.4, storyTalk: 0.3 },
): BackMoment[] {
  return moments.flatMap((m) => {
    const w = windowShares(samples, m.start, m.end);
    // No reading over the window (a failed or short read): the moment is kept as the detector found it.
    if (!w) return [m];
    if (w.hud < o.minHud) return [];
    return [{ ...m, story: m.story || w.talk >= o.storyTalk }];
  });
}
