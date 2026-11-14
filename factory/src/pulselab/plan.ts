// The Pulse Lab's planner (pure): which Lab format a gameplay Short becomes, and everything that follows from it, the
// title, the spoken lines' guard rails, the graphics, the tally entry and the comment and description lines. It never
// adds a Short: it dresses one the gameplay lane already kept, in the slot it already had.
//
// The order formats are tried in (each only when its setting is on and its evidence exists):
//   6 vs 5     the library has the compare game's footage of the same test (src/pulselab/versus.ts)
//   Receipts   the clip answers a ledger claim and the miner's verdict is sure enough to grade it
//   I measured the test has a number for an answer and the clip (or the HUD reader, or the owner) measured it
//   You asked  a viewer asked for the test (credited by public handle; the credit also rides on any format above)
// Nothing fits: no Lab format, and the Short goes out exactly as it would have.

import type { StreamAsk } from "../streamasks/asks.ts";
import { topicOf } from "../streamasks/asks.ts";
import type { LabOverlay } from "../render/labplan.ts";
import { cardClaim, overlayProblems } from "../render/labplan.ts";
import type { PulseLabSettings } from "./settings.ts";
import { labFormatsOn } from "./settings.ts";
import {
  CLAIM_LABEL,
  GRADE_WORDS,
  LAB_REVEAL,
  LAB_SEGMENT,
  LAB_STING,
  LAB_TICK,
  askedTitle,
  dayClaim,
  isUnofficial,
  labTitleProblems,
  measuredTitle,
  receiptsTitle,
  versusTitle,
  type Grade,
  type LabFormat,
} from "./identity.ts";
import type { LabClaim } from "./ledger.ts";
import { claimForAsk, gradeFor, verdictLine } from "./ledger.ts";
import type { ClipTiming, Measurement } from "./measure.ts";
import {
  measure,
  measuredProblems,
  revealText,
  speedUp,
  spokenAnswer,
} from "./measure.ts";
import type { HudTrack } from "./telemetry.ts";
import type { VersusSource } from "./versus.ts";
import { VERSUS_FILES } from "./versus.ts";
import { creditFor, creditLines } from "./asked.ts";
import type { TallyOutcome, TallySeries } from "./tally.ts";

export interface LabInput {
  settings: PulseLabSettings;
  /** The game the reviewer saw. */
  game: string;
  /** The clip's test as the reviewer wrote it, and its result line. */
  question: string;
  resultLine: string;
  /** VOD_MINER's ask and verdict for the clip (meta.stream_ask), or a live clip's ask (meta.live.ask). */
  streamAsk?: {
    question: string;
    claim: string;
    rumour: boolean;
    verdict: "proved" | "disproved";
    confidence: number;
    reason: string;
    asked_by?: string;
  };
  liveAsk?: string;
  ledger: LabClaim[];
  asks: StreamAsk[];
  timing?: ClipTiming;
  track?: HudTrack;
  owner?: { value: number; of?: number; unit?: string };
  counterpart?: VersusSource;
  /** The direct cut's lines as the second look wrote them. */
  lines: { hook: string; setup: string; payoff_line: string };
}

export interface LabPlan {
  format?: LabFormat;
  /** Why each format that was on did not fit, for the event log and the dry run. */
  skipped: Array<{ format: LabFormat; why: string }>;
  title?: string;
  /** What a GTA 6 Day N title says after "GTA 6 Day N: ". */
  dayClaim?: string;
  /** The spoken lines after the Lab's guard rails (the narrator stays the friend voice). */
  lines?: { hook: string; setup: string; payoff_line: string };
  overlay?: LabOverlay;
  /** The tallies this Short counts towards, claimed when it renders. */
  tally: Array<{ series: TallySeries; outcome: TallyOutcome }>;
  claim?: { id: string; grade: Grade; kind: LabClaim["kind"]; source: string };
  measurement?: {
    value: number;
    of?: number;
    reveal: string;
    spoken: string;
    source: Measurement["source"];
  };
  counterpart?: VersusSource;
  credit?: { handle?: string; poll?: boolean };
  comment: string[];
  description: string[];
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const capFirst = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** A hook that states a claim as fact ("Every store can be robbed") rather than asking it. */
const STATEMENT_HOOK =
  /^(?!.*\?)(?!.*\b(said|says|claim\w*|rumou?r\w*|leak\w*|reportedly|myth|supposedly)\b).+$/i;

/** The ask a clip answers (pure): the miner's ask by its question, else the live clip's, else the reviewer's test by topic. */
export function askFor(
  i: Pick<LabInput, "streamAsk" | "liveAsk" | "question" | "asks" | "game">,
): StreamAsk | undefined {
  const q = i.streamAsk?.question ?? i.liveAsk;
  if (q) {
    const exact = i.asks.find((a) => a.question === q);
    if (exact) return exact;
  }
  const topic = topicOf(`${q ?? ""} ${i.question}`, i.game)?.id;
  return topic ? i.asks.find((a) => a.topic === topic) : undefined;
}

/** The plan for one clip (pure). */
export function planLab(i: LabInput): LabPlan {
  const s = i.settings;
  const plan: LabPlan = {
    skipped: [],
    tally: [],
    comment: [],
    description: [],
  };
  const on = labFormatsOn(s);
  if (!on.length) return plan;
  const ask = askFor(i);
  const question =
    ask?.question ?? i.streamAsk?.question ?? i.liveAsk ?? i.question;
  const credit = s.asked && ask ? creditFor(ask) : undefined;
  const base = (format: LabFormat): LabOverlay => ({
    format,
    ...(s.identity
      ? {
          tag: { segment: LAB_SEGMENT[format] },
          sting: LAB_STING,
          tick: LAB_TICK,
          reveal: LAB_REVEAL,
        }
      : { reveal: LAB_REVEAL }),
  });

  for (const format of on) {
    if (format === "versus") {
      if (!i.counterpart) {
        plan.skipped.push({
          format,
          why: `no ${s.compareGame} footage of this test in the library yet`,
        });
        continue;
      }
      if (!i.timing) {
        plan.skipped.push({
          format,
          why: "no direct cut to line the panes up on",
        });
        continue;
      }
      const title = versusTitle(question);
      plan.format = "versus";
      plan.title = title;
      plan.dayClaim = dayClaim(question);
      plan.counterpart = i.counterpart;
      plan.overlay = {
        ...base("versus"),
        versus: {
          aSrc: VERSUS_FILES.primary,
          bSrc: VERSUS_FILES.counterpart,
          aLabel: "GTA 6",
          bLabel: "GTA 5",
        },
      };
      plan.lines = {
        hook: i.lines.hook,
        setup: joinFit(
          ["Same test, both games. GTA 6 on top.", i.lines.setup],
          i.timing.payoffAt,
          i.lines.hook,
        ),
        payoff_line: i.lines.payoff_line,
      };
      plan.tally.push({ series: "versus", outcome: "counted" });
      plan.description.push(
        `The Pulse Lab, GTA 6 vs GTA 5: the same test in both games, both from our own streams (GTA 5 from ${i.counterpart.kind === "vod" ? "an earlier stream" : "our clip library"}).`,
      );
      break;
    }
    if (format === "receipts") {
      const claim =
        claimForAsk(
          i.ledger,
          { question, claim: i.streamAsk?.claim },
          s.game,
        ) ?? (ask ? i.ledger.find((c) => c.askId === ask.id) : undefined);
      if (!claim) {
        plan.skipped.push({
          format,
          why: "the clip answers no claim in the ledger",
        });
        continue;
      }
      if (claim.status === "held") {
        plan.skipped.push({ format, why: "the claim is held for spoilers" });
        continue;
      }
      let grade: Grade | undefined =
        claim.grade && claim.grade.confidence >= s.minConfidence
          ? claim.grade.grade
          : undefined;
      if (!grade && i.streamAsk)
        grade = gradeFor(
          claim,
          i.streamAsk,
          s.minConfidence,
          i.owner
            ? {
                value: i.owner.value,
                ...(i.owner.of !== undefined ? { of: i.owner.of } : {}),
              }
            : undefined,
        );
      if (!grade) {
        plan.skipped.push({
          format,
          why: i.streamAsk
            ? `the verdict is below ${s.minConfidence} sure`
            : "no verdict from the footage to grade it on",
        });
        continue;
      }
      plan.format = "receipts";
      plan.title = receiptsTitle(question, claim.kind);
      plan.dayClaim = dayClaim(question);
      plan.claim = {
        id: claim.id,
        grade,
        kind: claim.kind,
        source: claim.source.name,
      };
      plan.overlay = {
        ...base("receipts"),
        claim: {
          label: CLAIM_LABEL[claim.kind],
          source: claim.source.name,
          text: cardClaim(claim.claim.replace(/\s*\([^)]{2,60}\)\s*$/, "")),
          unofficial: isUnofficial(claim.kind),
          grade,
        },
      };
      const label = CLAIM_LABEL[claim.kind].toLowerCase();
      // The hook asks; it never states a leak or a rumour as fact.
      const hook =
        STATEMENT_HOOK.test(i.lines.hook) && isUnofficial(claim.kind)
          ? shortQuestion(question)
          : i.lines.hook;
      plan.lines = {
        hook,
        setup: joinFit(
          [`This one is a ${label} from ${claim.source.name}.`, i.lines.setup],
          i.timing?.payoffAt ?? 6,
          hook,
        ),
        payoff_line: receiptsPayoff(claim.kind, grade),
      };
      plan.tally.push({ series: "receipts", outcome: grade });
      if (claim.kind === "myth")
        plan.tally.push({
          series: "myths",
          outcome: grade === "FALSE" ? "busted" : "proved",
        });
      plan.comment.push(
        `Receipts: ${verdictLine(claim, grade)} Which GTA 6 claim should I grade next?`,
      );
      plan.description.push(
        `The Pulse Lab, Receipts: ${CLAIM_LABEL[claim.kind].toLowerCase()} from ${claim.source.name}${claim.source.url ? ` (${claim.source.url})` : ""}, graded ${GRADE_WORDS[grade]} on our own copy of GTA 6. ${isUnofficial(claim.kind) ? "It was never confirmed by Rockstar; this is what our footage shows." : ""}`.trim(),
      );
      break;
    }
    if (format === "measured") {
      if (!i.timing) {
        plan.skipped.push({ format, why: "no direct cut to time" });
        continue;
      }
      const m = measure({
        question,
        ...(ask?.topic ? { topic: ask.topic } : {}),
        timing: i.timing,
        ...(i.track ? { track: i.track } : {}),
        ...(i.owner ? { owner: i.owner } : {}),
      });
      if (!m) {
        plan.skipped.push({
          format,
          why: "no number the clip, the HUD reader or the owner measured",
        });
        continue;
      }
      const reveal = revealText(m);
      const spoken = spokenAnswer(m);
      const hook = measuredProblems(m, { hook: i.lines.hook }).length
        ? shortQuestion(question)
        : i.lines.hook;
      const setup = measuredProblems(m, { setup: i.lines.setup }).length
        ? ""
        : i.lines.setup;
      plan.format = "measured";
      plan.title = measuredTitle(question);
      plan.dayClaim = dayClaim(question);
      plan.measurement = {
        value: m.value,
        ...(m.of !== undefined ? { of: m.of } : {}),
        reveal,
        spoken,
        source: m.source,
      };
      plan.overlay = {
        ...base("measured"),
        instrument: {
          kind: m.spec.kind,
          label: m.spec.label,
          unit: m.spec.unit,
          format: m.spec.format,
          samples: m.samples,
          ...(m.ticks ? { ticks: m.ticks } : {}),
          ...(m.of !== undefined ? { of: m.of, max: m.of } : {}),
          method: m.method,
          reveal,
          speed: speedUp(m.samples, m.spec.format),
        },
      };
      plan.lines = {
        hook,
        setup: joinFit([setup], i.timing.payoffAt, hook),
        payoff_line: measuredPayoff(m.spec.kind, spoken),
      };
      plan.tally.push({ series: "measured", outcome: "counted" });
      plan.comment.push(
        `I measured it: ${spoken}. ${m.source === "clip" ? "Timed on the stream's own clock." : m.source === "owner" ? "Counted live on stream." : "Read off the HUD."} What should I measure next?`,
      );
      plan.description.push(
        `The Pulse Lab, I measured it: ${question} Answer: ${spoken}, measured on our own copy of GTA 6 (${m.method.toLowerCase()}).`,
      );
      break;
    }
    if (format === "asked") {
      if (!credit) {
        plan.skipped.push({ format, why: "no viewer asked for this test" });
        continue;
      }
      plan.format = "asked";
      plan.title = askedTitle(question);
      plan.dayClaim = dayClaim(question);
      plan.overlay = base("asked");
      plan.lines = {
        hook: i.lines.hook,
        setup: joinFit(
          ["You asked for this one, so I tested it.", i.lines.setup],
          i.timing?.payoffAt ?? 6,
          i.lines.hook,
        ),
        payoff_line: i.lines.payoff_line,
      };
      plan.tally.push({ series: "asked", outcome: "counted" });
      break;
    }
  }
  if (plan.format && credit && plan.overlay) {
    const c = creditLines(credit);
    plan.credit = credit;
    plan.overlay.credit = {
      card: c.card,
      ...(credit.handle ? { handle: credit.handle } : {}),
      ask: question,
    };
    plan.comment.push(c.comment);
    if (credit.handle)
      plan.description.push(`Asked by ${credit.handle} in our comments.`);
    if (plan.format !== "asked")
      plan.tally.push({ series: "asked", outcome: "counted" });
  }
  return plan;
}

/** Sentences joined while hook and setup still fit before the outcome (the direct cut's own budget, pure). */
export function joinFit(
  parts: string[],
  payoffAt: number,
  hook: string,
  wordsPerSecond = 3.2,
): string {
  const room = Math.max(0, payoffAt - 0.2) * wordsPerSecond - words(hook);
  const out: string[] = [];
  let used = 0;
  for (const p of parts
    .flatMap((x) => x.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (used + words(p) > room) break;
    out.push(p);
    used += words(p);
  }
  return out.join(" ");
}

/** A question as a hook of nine words or fewer (pure); a longer one becomes "Is this GTA 6 claim true?". */
export function shortQuestion(q: string): string {
  const t = q.replace(/\s+/g, " ").trim();
  const asked = /\?$/.test(t) ? t : `${t.replace(/[.!]+$/, "")}?`;
  return words(asked) <= 9 ? capFirst(asked) : "Is this GTA 6 claim true?";
}

/** The line after the outcome for a Receipt (pure, under ten words): the label, then the grade. */
export function receiptsPayoff(kind: LabClaim["kind"], grade: Grade): string {
  const noun =
    kind === "official"
      ? "That claim"
      : `That ${CLAIM_LABEL[kind].toLowerCase()}`;
  return `${noun}? ${capFirst(GRADE_WORDS[grade])}, on my own copy.`;
}

/** The line after the outcome for a measurement (pure): the number, said once, last. */
export function measuredPayoff(
  kind: Measurement["spec"]["kind"],
  spoken: string,
): string {
  return kind === "timer"
    ? `${capFirst(spoken)}. That's the answer.`
    : `${capFirst(spoken)}. Measured, not guessed.`;
}

/** The gate before render (pure): the plan's title and graphics break no house rule. */
export function planProblems(
  p: LabPlan,
  payoffAt: number,
  seconds: number,
): string[] {
  const out: string[] = [];
  if (p.format && p.title)
    out.push(
      ...labTitleProblems(
        p.title,
        p.format,
        p.measurement ? { answer: p.measurement.reveal } : {},
      ),
    );
  if (p.overlay) out.push(...overlayProblems(p.overlay, payoffAt, seconds));
  if (p.measurement && p.lines)
    out.push(
      ...measuredProblems(
        {
          value: p.measurement.value,
          ...(p.measurement.of !== undefined ? { of: p.measurement.of } : {}),
          spec: { kind: "timer", label: "", unit: "", format: "clock" },
        },
        { hook: p.lines.hook, setup: p.lines.setup },
      ).filter((x) => !/hints/.test(x)),
    );
  return out;
}
