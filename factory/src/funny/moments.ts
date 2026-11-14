// Funny-moment finding (FUNNY_SHORTS), pure: everything measured goes in, ranked candidates with reasons come out.
//
// What points at a funny moment, each about 1 when clear on its own:
//   sound    the owner laughing (rhythmic voice bursts) or shouting, and impact thumps (src/funny/audio.ts);
//   picture  a sudden burst of on-screen action (the near-live detector's scene-change measure);
//   HUD      the game saying so itself (src/hudreader): "Wasted" or "Busted", the wanted level jumping two or more
//            stars at once, a stunt or a flight starting;
//   vision   the PC's local vision model rating the payoff frames for physics chaos, NPC weirdness, glitches and fails
//            (src/funny/vision.ts). It also vetoes: a menu, a load, a cutscene, gore or a radio station on screen.
// A reaction comes after what caused it, so a laugh or shout points about a second back; an impact or a HUD event
// knows its own second. Moments are kept 30 s apart (one long chase is one moment).

import type { SoundCue } from "./audio.ts";

export interface FunnyHud {
  /** Seconds into the recording. */
  t: number;
  kind: string;
  value?: number;
  from?: number;
  detail: string;
}

export interface FunnySecond {
  /** Seconds into the recording. */
  t: number;
  /** Scene change 0-1 (src/liveclips/recorder.ts measure). */
  motion: number;
}

export interface Evidence {
  kind: "laugh" | "shout" | "impact" | "action" | "hud" | "vision";
  t: number;
  score: number;
  detail: string;
}

export interface VisionVerdict {
  /** 0-10: how funny a gamer would find the payoff. */
  funny: number;
  /** physics | npc | glitch | fail | near_miss | none */
  kind: string;
  why: string;
  /** A caption the model offered, checked before use. */
  caption?: string;
  menu: boolean;
  cutscene: boolean;
  gore: boolean;
  radio_on_screen: boolean;
}

export interface FunnyCandidate {
  /** The payoff: the second the funny thing happens. */
  payoff: number;
  /** The signal-only score (no vision). */
  signalScore: number;
  /** The final score: signals plus the vision rating, after vetoes (0 when vetoed). */
  score: number;
  evidence: Evidence[];
  vision?: VisionVerdict;
  /** Why it was set aside, when it was. */
  veto?: string;
  /** Licensed music likely in the cut (a stripped stem or a skip). */
  music: boolean;
  /** Plain reasons, best first, for the owner's ranking. */
  reasons: string[];
}

/** Reaction lag: a laugh or a shout comes about this long after what caused it. */
export const REACTION_LAG = 1.2;
/** Moments closer than this are one moment. */
export const MOMENT_GAP = 30;
/** Evidence within this many seconds of a moment counts towards it. */
export const CLUSTER = 6;

const WEIGHT: Record<SoundCue["kind"], number> = {
  laugh: 1.5,
  shout: 1,
  impact: 0.7,
  music: 0,
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A HUD event's weight as a funny signal (pure): fails and chaos, not progress. */
export function hudWeight(
  e: Pick<FunnyHud, "kind" | "value" | "from">,
): number {
  switch (e.kind) {
    case "wasted":
      return 1.6;
    case "busted":
      return 1.4;
    case "wanted_start":
    case "wanted_up": {
      const climb = (e.value ?? 0) - (e.from ?? 0);
      return climb >= 2 ? 1 : (e.value ?? 0) >= 3 ? 0.5 : 0;
    }
    case "mission_failed":
      return 0.8;
    case "stunt":
      return 0.5;
    case "air_start":
      return 0.4;
    default:
      return 0;
  }
}

/** Bursts of on-screen action (pure): a second whose scene change is well over the half minute around it. */
export function actionBursts(seconds: readonly FunnySecond[]): Evidence[] {
  const out: Evidence[] = [];
  for (let i = 0; i < seconds.length; i++) {
    const around = seconds
      .slice(Math.max(0, i - 15), i + 15)
      .map((s) => s.motion)
      .sort((a, b) => a - b);
    const med = around[Math.floor(around.length / 2)] ?? 0;
    const m = seconds[i]!.motion;
    if (m >= 0.35 && m >= med * 3 + 0.1)
      out.push({
        kind: "action",
        t: seconds[i]!.t,
        score: round2(Math.min(1, m)),
        detail: `a sudden burst of action on screen (scene change ${m.toFixed(2)})`,
      });
  }
  return out;
}

/** All the evidence, each on the second of the moment itself (pure). */
export function gatherEvidence(
  cues: readonly SoundCue[],
  seconds: readonly FunnySecond[],
  hud: readonly FunnyHud[],
): Evidence[] {
  const ev: Evidence[] = [];
  for (const c of cues) {
    if (c.kind === "music") continue;
    const reaction = c.kind === "laugh" || c.kind === "shout";
    ev.push({
      kind: c.kind,
      t: round2(Math.max(0, c.t - (reaction ? REACTION_LAG : 0))),
      score: round2(c.score * WEIGHT[c.kind]),
      detail: reaction
        ? `${c.kind === "laugh" ? "laughter-like bursts" : "a shout"} in the voice band, the owner's or the game's (${c.detail})`
        : c.detail,
    });
  }
  ev.push(...actionBursts(seconds));
  for (const h of hud) {
    const w = hudWeight(h);
    if (w > 0)
      ev.push({
        kind: "hud",
        t: h.t,
        score: w,
        detail: `the HUD: ${h.detail}`,
      });
  }
  return ev.sort((a, b) => a.t - b.t);
}

/**
 * The payoff second of a cluster (pure): the strongest event that knows its own time (an impact, the HUD, a burst of
 * action); failing that, the reaction's estimate.
 */
export function payoffOf(cluster: readonly Evidence[]): number {
  const timed = cluster.filter(
    (e) => e.kind === "impact" || e.kind === "hud" || e.kind === "action",
  );
  const pick = (timed.length ? timed : cluster).reduce((a, b) =>
    b.score > a.score ? b : a,
  );
  return pick.t;
}

/**
 * The signal-ranked candidates (pure): every evidence second scores the evidence within CLUSTER seconds of it (a
 * reaction only counts after its cause, the kinds' best each), the best seconds are kept MOMENT_GAP apart.
 * `blocked` says a second may not be a payoff (a menu or a load found earlier).
 */
export function rankBySignals(
  evidence: readonly Evidence[],
  o: {
    top: number;
    duration: number;
    edge?: number;
    blocked?: (t: number) => boolean;
  },
): FunnyCandidate[] {
  const edge = o.edge ?? 8;
  const scored = evidence
    .filter((e) => e.t >= edge && e.t <= o.duration - edge && !o.blocked?.(e.t))
    .map((anchor) => {
      const near = evidence.filter((e) => Math.abs(e.t - anchor.t) <= CLUSTER);
      // The best of each kind, so one long laugh does not count six times.
      const best = new Map<Evidence["kind"], Evidence>();
      for (const e of near)
        if ((best.get(e.kind)?.score ?? -1) < e.score) best.set(e.kind, e);
      const parts = [...best.values()];
      const score = parts.reduce((a, e) => a + e.score, 0);
      // Two different kinds agreeing (a thump and a laugh) is worth more than either.
      const bonus = parts.length >= 2 ? 0.3 * (parts.length - 1) : 0;
      return { anchor, parts, score: round2(score + bonus) };
    })
    .sort((a, b) => b.score - a.score);
  const out: FunnyCandidate[] = [];
  for (const s of scored) {
    if (out.length >= o.top) break;
    const payoff = payoffOf(s.parts);
    if (out.some((c) => Math.abs(c.payoff - payoff) < MOMENT_GAP)) continue;
    out.push({
      payoff,
      signalScore: s.score,
      score: s.score,
      evidence: s.parts.sort((a, b) => b.score - a.score),
      music: false,
      reasons: s.parts.sort((a, b) => b.score - a.score).map((e) => e.detail),
    });
  }
  return out;
}

/** Why the vision verdict rules a moment out, or undefined (pure). */
export function visionVeto(
  v: VisionVerdict,
  inSpoilerWindow: boolean,
): string | undefined {
  if (v.menu) return "a menu, map or loading screen, not gameplay";
  if (v.gore) return "gore on screen (not advertiser-safe)";
  if (v.cutscene && inSpoilerWindow)
    return "a story cutscene inside the spoiler window";
  if (v.radio_on_screen) return "a radio station on screen (licensed music)";
  return undefined;
}

/**
 * The final ranking (pure): the vision rating joins the signals (rating x 0.5, so a 10 adds 5), vetoes drop to the
 * bottom with the reason, licensed music without a stripped stem is a veto too. With no vision verdict (the relay down
 * or vision off) a candidate keeps its signal score and says so.
 */
export function finalRank(
  cands: readonly FunnyCandidate[],
  o: { inSpoilerWindow: boolean; visionMin: number; stripped: boolean },
): FunnyCandidate[] {
  const out = cands.map((c) => {
    const reasons = [...c.reasons];
    let score = c.signalScore;
    let veto: string | undefined;
    if (c.vision) {
      veto = visionVeto(c.vision, o.inSpoilerWindow);
      score = round2(c.signalScore + c.vision.funny * 0.5);
      reasons.unshift(
        `local vision ${c.vision.funny}/10, ${c.vision.kind.replace("_", " ")}: ${c.vision.why}`,
      );
      if (!veto && c.vision.funny < o.visionMin)
        veto = `local vision rated it ${c.vision.funny}/10 (needs ${o.visionMin})`;
    } else reasons.push("no vision check (signals only)");
    if (!veto && c.music && !o.stripped)
      veto = "licensed music likely in the cut and no stripped stem";
    return { ...c, score: veto ? 0 : score, veto, reasons };
  });
  return out.sort((a, b) => b.score - a.score || b.signalScore - a.signalScore);
}
