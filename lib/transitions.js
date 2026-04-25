/**
 * lib/transitions.js — mixed transition strategy.
 *
 * Replaces the legacy "every transition is a 0.5s dissolve" loop in
 * assemble.js. For a 60s short with 8 segments, that meant 4 full
 * seconds of dissolve blur — 7% of the runtime. This module mixes:
 *
 *   - hard cuts (zero-duration)         — feel snappy, broadcast-y
 *   - short dissolves (0.20–0.30s)      — soften scene changes
 *   - occasional slide (every 4th)      — adds motion variety
 *
 * The mix is deterministic per (segmentCount, totalDuration) so the
 * same video always renders identically.
 *
 * The first transition (hook → second segment) is always a HARD CUT
 * so the opening feels punchy. The last transition (into the outro
 * fade) is always a soft 0.30s dissolve so the close feels calm.
 */

"use strict";

const TRANSITION_TYPES = {
  CUT: "cut",
  DISSOLVE: "dissolve",
  SLIDE_LEFT: "slideleft",
  SLIDE_UP: "slideup",
};

/**
 * Build the per-edge transition spec list.
 *
 * @param {object} args
 * @param {number} args.segmentCount   number of visual segments (>=1)
 * @param {number} args.segmentDuration   seconds per segment
 * @returns {Array<{type, duration, offset}>}
 *   one entry per edge between adjacent segments. Length = segmentCount - 1.
 *   `offset` is the absolute timeline second at which the transition begins.
 */
function buildTransitionStrategy({ segmentCount, segmentDuration }) {
  if (segmentCount < 2) return [];

  const out = [];
  // Track running duration of the in-progress concatenated stream.
  // Starts at segmentDuration (the full duration of v0).
  let runningDur = segmentDuration;
  for (let i = 0; i < segmentCount - 1; i++) {
    let type;
    let duration;

    if (i === 0) {
      // First transition (hook → second shot): hard cut, punchy.
      type = TRANSITION_TYPES.CUT;
      duration = 0;
    } else if (i === segmentCount - 2) {
      // Last transition (into the outro): calm dissolve.
      type = TRANSITION_TYPES.DISSOLVE;
      duration = 0.3;
    } else if (i % 4 === 3) {
      // Every 4th edge: slide. Adds variety without dominating.
      type =
        i % 8 === 3 ? TRANSITION_TYPES.SLIDE_LEFT : TRANSITION_TYPES.SLIDE_UP;
      duration = 0.25;
    } else if (i % 2 === 0) {
      // Even edges (every 2nd, after the hook cut): hard cut for energy.
      type = TRANSITION_TYPES.CUT;
      duration = 0;
    } else {
      // Default: short dissolve, faster than the legacy 0.5s.
      type = TRANSITION_TYPES.DISSOLVE;
      duration = 0.22;
    }

    // xfade `offset` MUST be computed against the actual running
    // duration of the in-progress concatenated stream, not against
    // a hypothetical pure-xfade timeline. Cuts append fully
    // (running += segmentDuration); xfades overlap (running +=
    // segmentDuration - duration). Without tracking this, mixed
    // chains reference times past EOF and the output truncates
    // silently.
    let offset;
    if (type === TRANSITION_TYPES.CUT) {
      offset = runningDur; // informational; concat ignores
      runningDur += segmentDuration;
    } else {
      offset = runningDur - duration;
      runningDur = offset + segmentDuration;
    }

    out.push({ type, duration, offset });
  }
  return out;
}

/**
 * Render the transition list as ffmpeg filter graph fragments.
 *
 * For each transition, this returns one filter graph line that
 * combines [prevLabel] + [v(i+1)] into a new label.
 *
 *   - CUT      → `concat=n=2:v=1:a=0` (zero-duration, hard switch)
 *   - DISSOLVE → `xfade=transition=dissolve:duration=D:offset=O`
 *   - SLIDE_*  → `xfade=transition=slideleft|slideup:duration=D:offset=O`
 *
 * The output label of edge i becomes the input label of edge i+1.
 * The final edge's output is `[base]`.
 */
function buildTransitionFilters(transitions, { segmentCount }) {
  if (segmentCount < 2) return ["[v0]copy[base]"];

  const lines = [];
  let prevLabel = "v0";

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const isLast = i === transitions.length - 1;
    const outLabel = isLast ? "base" : `xf${i + 1}`;

    if (t.type === TRANSITION_TYPES.CUT) {
      // Hard cut: concat the two segments in time. After concat
      // the output timebase defaults to 1/1000000 — if the NEXT
      // transition is an xfade it requires matching timebases on
      // both inputs and barfs with:
      //   First input link main timebase (1/1000000) do not match
      //   the corresponding second input link xfade timebase (1/30)
      // Normalise every concat output via fps=30 — rewrites both
      // framerate AND timebase to 1/30 so the next xfade can
      // negotiate against another 1/30 source.
      lines.push(
        `[${prevLabel}][v${i + 1}]concat=n=2:v=1:a=0,fps=30,setpts=PTS-STARTPTS[${outLabel}]`,
      );
    } else {
      // Crossfade family.
      lines.push(
        `[${prevLabel}][v${i + 1}]xfade=transition=${t.type}:duration=${t.duration}:offset=${t.offset.toFixed(2)}[${outLabel}]`,
      );
    }
    prevLabel = outLabel;
  }
  return lines;
}

module.exports = {
  buildTransitionStrategy,
  buildTransitionFilters,
  TRANSITION_TYPES,
};
