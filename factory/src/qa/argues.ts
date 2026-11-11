// "Argues, does not describe" (upgrade queue item 10, niche research change 6, 11 Nov 2026). Since 1 Oct 2026 a
// voice-over that only describes what is on screen does not count as original on YouTube Shorts, and Meta calls
// "narrating what's already on screen" unoriginal. Before a Short goes out, this reads two things from what the
// factory already knows about it, with no model call:
//   - a point not in the picture: a reason, a verdict or a comparison, said in the narration (or a comparison card);
//   - some of Pulse's own material: the owner's capture, a Pulse graphic card or stamp, a chart, a code scene, or an
//     on-screen source (a report card or the source line).
// A Short that misses either waits for the owner instead of publishing on its own (SHORT_ARGUES_CHECK, off).
// Every result is logged, so the weekly share passing can be read. Pure.

import type { Script } from "../editorial/schema.ts";
import type { EpisodeAssets } from "../episodes.ts";
import { narrationOf } from "../editorial/schema.ts";
import { sentencesIn } from "../editorial/voice.ts";

const REASON =
  /\b(because|which is why|that's why|that is why|the reason|so that|which means|that means|meaning|since (?:the|it|they|you|this|that)|so (?:this|that|it|they|you|the|if)|thanks to|all because)\b/i;
const VERDICT =
  /\b(I'd|I would|I think|I'm|honestly|my (?:call|bet|money|take)|worth (?:it|the|your)|not worth|a mistake|the right call|smart move|bad sign|good sign|red flag|warning sign|good news|bad news|wait for|skip (?:it|this)|buy (?:it|this)|steep|overpriced|a bargain|a steal|too much|too little|should(?:n't)? (?:have|be|wait|buy|skip))\b/i;
const COMPARISON =
  /\b(\w+er than|more \w+ than|less \w+ than|fewer \w+ than|compared (?:to|with)|unlike|versus|vs\.?|against (?:the|its|last|their|every)|last time|the same as|than (?:the|its|last|any|every)|twice|half (?:the|as)|double)\b/i;
/** Lines that only say what the picture shows. */
const DESCRIBES =
  /\b(you can see|we see|we can see|here you see|here we see|the trailer shows|this shot|on screen (?:now|here)|shown here|look at (?:the|this|that)|watch as|here(?:'s| is) (?:the|a) (?:shot|scene|moment)|in this (?:scene|clip|footage|shot))\b/i;

const CHART_CARDS = new Set([
  "compare",
  "versus",
  "score",
  "timeline",
  "milestones",
  "price",
  "specs",
  "stat",
  "countdown",
  "bar",
]);
const COMPARE_CARDS = new Set(["compare", "versus"]);
const OWN_CAPTURE = /Pulse's own gameplay capture/i;

export interface ArguesResult {
  pass: boolean;
  /** What carried the point: "reason", "verdict", "comparison". */
  point: string[];
  /** What Pulse's own material is: "owner capture", "graphic", "chart", "code scene", "on-screen source". */
  own: string[];
  /** Sentences that only describe the picture, and how many sentences there were. */
  describing: number;
  sentences: number;
  problems: string[];
}

export function arguesCheck(
  script: Script,
  assets: EpisodeAssets | null | undefined,
  lane: string,
): ArguesResult {
  const spoken = narrationOf({ ...script, beats: script.beats ?? [] });
  const lines = sentencesIn(spoken);
  const kinds = (script.beats ?? []).map((b) => b.visual.kind);
  const point: string[] = [];
  if (REASON.test(spoken)) point.push("reason");
  if (VERDICT.test(spoken)) point.push("verdict");
  if (COMPARISON.test(spoken) || kinds.some((k) => COMPARE_CARDS.has(k)))
    point.push("comparison");
  const own: string[] = [];
  if (
    lane === "gameplay" ||
    script.gameplay ||
    (assets?.clips ?? []).some((c) => OWN_CAPTURE.test(c.provenance))
  )
    own.push("owner capture");
  // A ranking's rank cards (and a cut-down's) are Pulse's own graphics on every entry.
  if (
    kinds.some((k) => k !== "none" && !CHART_CARDS.has(k)) ||
    script.stamp ||
    script.entries?.length ||
    script.cutdown
  )
    own.push("graphic");
  if (kinds.some((k) => CHART_CARDS.has(k))) own.push("chart");
  if (assets?.plan?.scenes?.length) own.push("code scene");
  if (
    kinds.includes("report") ||
    (assets?.plan?.shelf ?? []).some((x) => x.device === "source")
  )
    own.push("on-screen source");
  const describing = lines.filter((l) => DESCRIBES.test(l)).length;
  const problems: string[] = [];
  if (!point.length)
    problems.push(
      "no point beyond the picture: the narration gives no reason, verdict or comparison",
    );
  if (lines.length && describing * 2 >= lines.length)
    problems.push(
      `${describing} of ${lines.length} sentences only describe what is on screen`,
    );
  if (!own.length)
    problems.push(
      "none of Pulse's own material: no owner capture, graphic card, chart or on-screen source",
    );
  return {
    pass: problems.length === 0,
    point,
    own,
    describing,
    sentences: lines.length,
    problems,
  };
}
