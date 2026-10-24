// Structural rubric, scored from the RenderPlan before a frame is rendered.
// Red metrics reject the plan (the pipeline rebuilds it once with another
// variant, then fails the episode); ambers pass and are stored for
// correlation with audience data later.

import type { RenderPlan } from "../render/plan.ts";
import type { Segment } from "../render/timeline.ts";
import type { Word } from "../voice/elevenlabs.ts";
import { MIN_SHOT, MAX_SFX, STING_FRAMES, maxShotFor } from "../render/plan.ts";

export interface RubricMetric {
  name: string;
  value: number | string;
  grade: "green" | "amber" | "red";
  note?: string;
}

export interface Rubric {
  grade: "green" | "amber" | "red";
  metrics: RubricMetric[];
}

export interface RubricInput {
  plan: RenderPlan;
  segments: Segment[];
  words: Word[];
  footageSeconds: number;
  footageBudgetSeconds: number;
  hookWords: number;
}

const grade = (ok: boolean, warn: boolean): RubricMetric["grade"] =>
  ok ? "green" : warn ? "amber" : "red";

export function scorePlan(i: RubricInput): Rubric {
  const { plan, segments, words } = i;
  const m: RubricMetric[] = [];
  const seconds = plan.totalFrames / plan.fps;
  const speechSeconds = words.length
    ? words.at(-1)!.end - words[0]!.start
    : seconds;

  // First spoken word.
  const firstWord = words[0]?.start ?? 0;
  m.push({
    name: "first_word_seconds",
    value: Number(firstWord.toFixed(2)),
    grade: grade(firstWord <= 0.1, firstWord <= 0.3),
  });

  // Hook length.
  m.push({
    name: "hook_words",
    value: i.hookWords,
    grade: grade(i.hookWords >= 5 && i.hookWords <= 10, i.hookWords <= 12),
  });

  // Pace.
  const wpm = speechSeconds > 0 ? (words.length / speechSeconds) * 60 : 0;
  m.push({
    name: "wpm",
    value: Math.round(wpm),
    grade: grade(wpm >= 130 && wpm <= 175, wpm >= 115 && wpm <= 190),
  });

  // Cuts and visual events per minute.
  const cuts = plan.shots.length - 1;
  const cardLands = segments.filter(
    (s) => s.visual && s.visual.kind !== "none",
  ).length;
  const shelfChanges = plan.shelf.length;
  const cpm = (cuts / seconds) * 60;
  const epm = ((cuts + cardLands + shelfChanges) / seconds) * 60;
  m.push({
    name: "cuts_per_minute",
    value: Math.round(cpm),
    grade: grade(cpm >= 14, cpm >= 10),
  });
  m.push({
    name: "events_per_minute",
    value: Math.round(epm),
    grade: grade(epm >= 18, epm >= 12),
  });

  // Shot bounds.
  const bad = plan.shots.filter(
    (s, k) =>
      (s.end - s.start < MIN_SHOT &&
        !(k === 0 && s.end - s.start === STING_FRAMES)) ||
      s.end - s.start > maxShotFor(segments[s.segment]?.kind ?? "beat"),
  );
  m.push({
    name: "shots_out_of_bounds",
    value: bad.length,
    grade: grade(bad.length === 0, bad.length <= 1),
  });

  // Rhythm: shot lengths that vary with the line (a held opening, quick facts, a held verdict), not a metronome.
  const lengths = plan.shots.slice(1).map((s) => s.end - s.start);
  const meanLen = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const cv = meanLen ? Math.sqrt(lengths.reduce((a, l) => a + (l - meanLen) ** 2, 0) / lengths.length) / meanLen : 0;
  m.push({
    name: "shot_length_variety",
    value: Number(cv.toFixed(2)),
    grade: grade(cv >= 0.25, true),
  });

  // Beat awareness: cuts within 6 frames of a word end.
  const ends = new Set(words.map((w) => Math.round(w.end * plan.fps)));
  const inner = plan.shots.slice(1).map((s) => s.start);
  const aware = inner.filter((f) =>
    [...Array(13).keys()].some((d) => ends.has(f - 6 + d)),
  ).length;
  const awareness = inner.length ? aware / inner.length : 1;
  m.push({
    name: "beat_awareness",
    value: Number(awareness.toFixed(2)),
    grade: grade(awareness >= 0.6, awareness >= 0.4),
  });

  // Shelf occupancy over speech.
  const shelfFrames = plan.shelf
    .filter((s) => s.device !== "rail")
    .reduce((n, s) => n + (s.to - s.from), 0);
  const occupancy = plan.totalFrames ? shelfFrames / plan.totalFrames : 0;
  m.push({
    name: "shelf_occupancy",
    value: Number(occupancy.toFixed(2)),
    grade: grade(occupancy >= 0.85, occupancy >= 0.6),
  });

  // Media variety.
  const keys = plan.shots.map((s) => `${s.media.type}:${s.media.index}`);
  const unique = new Set(keys).size / Math.max(1, keys.length);
  // With little media there is nothing to vary with: variety metrics can only warn, not reject.
  const scarce = new Set(keys.filter((k) => !k.startsWith("plate"))).size < 4;
  const ranking = segments.some((s) => s.kind === "beat" && s.visual?.kind === "rank");
  m.push({
    name: "unique_media_ratio",
    value: Number(unique.toFixed(2)),
    grade: grade(
      unique >= 0.85 || plan.shots.every((s) => s.media.type === "plate"),
      scarce || unique >= 0.6,
    ),
  });
  const counts = new Map<string, number>();
  for (const k of keys)
    if (!k.startsWith("plate")) counts.set(k, (counts.get(k) ?? 0) + 1);
  const maxRepeat = Math.max(0, ...counts.values());
  m.push({
    name: "max_media_repeat",
    value: maxRepeat,
    // A ranking's winner is seen in its own line and again under the pick, by design.
    grade: grade(maxRepeat <= 2, scarce || maxRepeat <= (ranking ? 4 : 3)),
  });
  // The hero still closing the take and opening the loop is the designed return, not a repeat.
  const loopStart = plan.shots.findIndex(
    (s) => segments[s.segment]?.kind === "loop",
  );
  const adjacent = keys.filter(
    (k, n) =>
      n > 0 &&
      k === keys[n - 1] &&
      !k.startsWith("plate") &&
      n !== loopStart &&
      !(n === keys.length - 1),
  ).length;
  m.push({
    name: "adjacent_repeats",
    value: adjacent,
    grade: grade(adjacent === 0, scarce || adjacent <= 1),
  });

  // Adjacent same-kind cards.
  const kinds = segments
    .filter((s) => s.visual && s.visual.kind !== "none")
    .map((s) => s.visual!.kind);
  // A ranking Short is a run of rank cards by design.
  const sameKind = kinds.filter(
    (k, n) => n > 0 && k === kinds[n - 1] && k !== "rank",
  ).length;
  m.push({
    name: "adjacent_same_kind_cards",
    value: sameKind,
    grade: grade(sameKind === 0, sameKind <= 1),
  });

  // Footage against the publisher cap and the lane share.
  m.push({
    name: "footage_seconds",
    value: Number(i.footageSeconds.toFixed(1)),
    grade: grade(i.footageSeconds <= i.footageBudgetSeconds, false),
  });
  const share = seconds ? i.footageSeconds / seconds : 0;
  m.push({
    name: "footage_share",
    value: Number(share.toFixed(2)),
    grade: grade(share <= 0.35, share <= 0.45),
  });

  // Sound cues.
  m.push({
    name: "sfx_cues",
    value: plan.sfx.length,
    grade: grade(plan.sfx.length <= MAX_SFX, false),
  });

  // Duration integrity: the plan covers the narration.
  const lastWord = words.at(-1)?.end ?? 0;
  m.push({
    name: "covers_narration",
    value: lastWord <= seconds ? "yes" : "no",
    grade: grade(lastWord <= seconds, false),
  });

  const overall: Rubric["grade"] = m.some((x) => x.grade === "red")
    ? "red"
    : m.some((x) => x.grade === "amber")
      ? "amber"
      : "green";
  return { grade: overall, metrics: m };
}

export function rubricSummary(r: Rubric): string {
  return r.metrics
    .filter((x) => x.grade !== "green")
    .map((x) => `${x.name}=${x.value} (${x.grade})`)
    .join(", ");
}
