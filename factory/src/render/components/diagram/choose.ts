// Which bare documentary sentences become an explainer diagram (31 Oct 2026), the "how it worked" lines:
// who owned which studio, where a moment sits in the making of the game, two efforts at once, a hand-off
// from one thing to the next, a change from one state to another. Each shape's data comes only from the
// sentence and its chapter's own text (./facts.ts); when the data is not there the chooser declines rather
// than draw a diagram with invented names or years. Pure: the pipeline imports it from Node.

import {
  indexIn,
  type Candidate,
  type FillerAt,
  type FillerChapter,
  type FillerMoment,
  type Verdict,
} from "../kinetic/types.ts";
import {
  beforeAfterFacts,
  flowFacts,
  orgFacts,
  splitFacts,
  timelineFacts,
  type BeforeAfterFacts,
  type Derived,
  type FlowFacts,
  type OrgFacts,
  type SplitFacts,
  type TimelineFacts,
} from "./facts.ts";

/** The diagram styles, in registry order (./index.ts draws them). */
export const DIAGRAM_STYLES = [
  "orgChart",
  "timeline",
  "split",
  "flow",
  "beforeAfter",
] as const;
export type DiagramStyle = (typeof DIAGRAM_STYLES)[number];

export type DiagramData =
  | { kind: "orgChart"; facts: OrgFacts }
  | { kind: "timeline"; facts: TimelineFacts }
  | { kind: "split"; facts: SplitFacts }
  | { kind: "flow"; facts: FlowFacts }
  | { kind: "beforeAfter"; facts: BeforeAfterFacts };

/** Below this the chooser declines. */
export const DIAGRAM_MIN_CONFIDENCE = 0.5;
/** Longer sentences rarely state one clean structure; the shapes still get a chance but lose a little. */
const LONG = 26;

// The wording of a "how it worked" line: process, structure, sequence.
const HOW =
  /\b(built|build|work|worked|development|production|pre-production|team|teams|studio|studios|engine|pipeline|process|merged|acquired|moved|switched|handed|began|started|shipped|launched|delayed|pushed back|alongside|at the same time|then)\b/i;

type Try = { style: DiagramStyle; base: number; d: Derived<unknown> };

/** The full verdict for a sentence: the best-supported diagram, or why none fits. */
export function diagramVerdict(
  sentence: string,
  moment: FillerMoment,
  chapter: FillerChapter,
  at: FillerAt = {},
): Verdict<DiagramData> {
  const kind = moment.graphic?.kind ?? "none";
  if (kind !== "none")
    return { declined: `it already carries a ${kind} graphic` };
  const idx = indexIn(chapter, sentence, at);
  // Base confidences: a named deal or a stated change is a diagram's whole point; a timeline is strong
  // when the sentence's own year anchors it; a split or flow is good when both ends are named.
  const tries: Try[] = [
    { style: "orgChart", base: 0.75, d: orgFacts(sentence, chapter, idx) },
    {
      style: "beforeAfter",
      base: 0.68,
      d: beforeAfterFacts(sentence, chapter),
    },
    { style: "split", base: 0.66, d: splitFacts(sentence, chapter) },
    { style: "flow", base: 0.62, d: flowFacts(sentence, chapter) },
    { style: "timeline", base: 0.6, d: timelineFacts(sentence, chapter, idx) },
  ];
  const n = sentence.trim().split(/\s+/).length;
  const how = HOW.test(sentence);
  const scored = tries
    .filter(
      (t): t is Try & { d: { ok: true; data: unknown; note: string } } =>
        t.d.ok,
    )
    .map((t) => {
      let c = t.base;
      if (how) c += 0.07;
      if (n > LONG) c -= 0.08;
      // An ownership line that borrows its deal from a neighbour is good, not certain.
      if (t.style === "orgChart" && !/sentence names/.test(t.d.note)) c -= 0.12;
      // "It" read as the chapter's game, or what it became taken from the chapter: a reading, so a little less.
      if (
        (t.style === "split" || t.style === "beforeAfter") &&
        /\b(it|this)\b/i.test(sentence) &&
        /chapter|it started/.test(t.d.note)
      )
        c -= 0.1;
      if (t.style === "timeline") {
        const events = (t.d.data as TimelineFacts).events.length;
        c += events >= 4 ? 0.05 : 0;
      }
      return { ...t, c: Math.round(Math.min(0.92, c) * 100) / 100 };
    })
    .sort((a, b) => b.c - a.c);
  const top = scored[0];
  if (!top || top.c < DIAGRAM_MIN_CONFIDENCE) {
    const why = tries
      .map((t) => (t.d.ok ? undefined : `${t.style}: ${t.d.why}`))
      .filter(Boolean);
    return { declined: `no structure to draw (${why.join("; ")})` };
  }
  return {
    candidate: {
      family: "diagram",
      style: top.style,
      confidence: top.c,
      reason: `${label(top.style)}: ${top.d.note}`,
      data: { kind: top.style, facts: top.d.data } as DiagramData,
    },
  };
}

function label(s: DiagramStyle): string {
  return {
    orgChart: "org chart",
    timeline: "development timeline",
    split: "split screen",
    flow: "flow",
    beforeAfter: "before and after",
  }[s];
}

/** The explainer-diagram candidate for a bare sentence, or undefined when the text gives no structure. */
export function diagramFor(
  sentence: string,
  moment: FillerMoment,
  chapter: FillerChapter,
  at: FillerAt = {},
): Candidate<DiagramData> | undefined {
  const v = diagramVerdict(sentence, moment, chapter, at);
  return "candidate" in v ? v.candidate : undefined;
}
