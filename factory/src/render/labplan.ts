// The Pulse Lab's graphics on the rebuilt gameplay Short (src/render/GameplayShort.tsx `lab`), as plain data: what the
// planner (src/pulselab/plan.ts) decides and the components (src/render/components/pulselab) draw. Pure and
// browser-safe, so the composition, the planner and the tests read the same rules.
//
// Where everything sits on the 1080x1920 Short (src/render/layout.ts bands), so nothing covers the hook or captions:
//   brand band (150-300)  the Lab tag on the left (drawn whole on frame 0) and the tally chip on the right
//   hero (300-900)        the hook (as before), then the reveal card on the outcome (where the result stamp sat)
//   shelf (900-1180)      one device at a time: the claim card (Receipts), the instrument (I measured it), the
//                         viewer's card (You asked) for its first seconds
//   captions (1180-1460)  untouched
//   soft (1460-1620)      the small credit tag ("ASKED BY @handle") and the instrument's method line
// The split screen (6 vs 5) replaces the full-screen picture with two 16:9 panes, labelled, the verdict on the seam.

export type LabFormatName = "receipts" | "measured" | "asked" | "versus";
export type LabGrade = "TRUE" | "FALSE" | "PARTLY";
export type InstrumentKind = "timer" | "counter" | "meter";
export type ValueFormat = "clock" | "integer" | "decimal1" | "percent";

export interface LabInstrument {
  kind: InstrumentKind;
  label: string;
  unit: string;
  format: ValueFormat;
  /** [Short second, value]: the reading over the Short; its last value is the answer. */
  samples: Array<[number, number]>;
  /** A counter's steps (a tick sounds on each). */
  ticks?: number[];
  /** A meter's full scale (the claim's number, or the count's "of"). */
  max?: number;
  /** "OF 10" after a counter's number. */
  of?: number;
  /** The small method line: "TIMED ON THE STREAM'S OWN CLOCK". */
  method: string;
  /** The answer as the reveal card says it: "2 MIN 41 S". */
  reveal: string;
  /** Faster than real time (a long test compressed): shown as "8x". */
  speed: number;
}

export interface LabClaimCard {
  /** "LEAK", "RUMOUR", "PREVIEW CLAIM"...: always shown above the claim. */
  label: string;
  /** Where it came from, by name: "Insider Gaming", "Edge". */
  source: string;
  /** The claim as it was made, shortened for the card. */
  text: string;
  /** Unofficial claims get the alert colour on their label. */
  unofficial: boolean;
  grade: LabGrade;
}

export interface LabVersus {
  /** The two panes, resolved to URLs by the renderer (src/render/render.ts) or given as URLs in a preview. */
  aSrc: string;
  bSrc: string;
  aLabel: string;
  bLabel: string;
  /** Each side's outcome in a few words, shown on its pane at the payoff. */
  aResult?: string;
  bResult?: string;
}

export interface LabOverlay {
  format: LabFormatName | "tally";
  /** The Lab tag: "PULSE LAB" over the format's segment name and its number. */
  tag?: { segment: string; number?: number };
  /** The sting under the game's sound on frame 0 (public/ path), or none. */
  sting?: string | null;
  /** The tick and the landing hit (public/ paths). */
  tick?: string | null;
  reveal?: string | null;
  tally?: { line: string; sub?: string };
  claim?: LabClaimCard;
  instrument?: LabInstrument;
  credit?: { card: string; handle?: string; ask?: string };
  versus?: LabVersus;
  /** A preview-only mark ("STAND-IN FOOTAGE"), never set on a real Short. */
  proofMark?: string;
}

/** A value as the instrument shows it (pure): 2:41, 7, 3.5, 64%. */
export function formatValue(v: number, f: ValueFormat): string {
  if (f === "clock") {
    const s = Math.max(0, v);
    const m = Math.floor(s / 60);
    const sec = Math.floor(s - m * 60);
    const tenth = Math.floor((s - Math.floor(s)) * 10);
    return m >= 1 ? `${m}:${String(sec).padStart(2, "0")}` : `${sec}.${tenth}`;
  }
  if (f === "percent") return `${Math.round(v)}%`;
  if (f === "decimal1") return (Math.round(v * 10) / 10).toFixed(1);
  return String(Math.round(v));
}

/** The instrument's reading at a Short second (pure): stepped for counters, smooth for timers and meters. */
export function readingAt(
  samples: Array<[number, number]>,
  t: number,
  kind: InstrumentKind,
): number {
  if (!samples.length) return 0;
  if (t <= samples[0]![0]) return samples[0]![1];
  for (let i = 1; i < samples.length; i++) {
    const [ta, va] = samples[i - 1]!;
    const [tb, vb] = samples[i]!;
    if (t < tb) {
      if (kind === "counter") return va;
      return tb - ta < 1e-6 ? vb : va + ((t - ta) / (tb - ta)) * (vb - va);
    }
  }
  return samples[samples.length - 1]![1];
}

/** When the instrument shows (pure): from its first reading until the reveal card takes over, a beat after the payoff. */
export function instrumentWindow(
  i: Pick<LabInstrument, "samples">,
  payoffAt: number,
): { from: number; until: number } {
  const from = Math.max(0, Math.min(i.samples[0]?.[0] ?? 0, payoffAt - 1));
  return { from, until: payoffAt + 0.35 };
}

/** The reveal card's time on screen (pure): it lands on the payoff and stays 2.6 s, the result stamp's slot. */
export const revealWindow = (payoffAt: number) => ({
  from: payoffAt,
  until: payoffAt + 2.6,
});

/**
 * When the shelf device of a format is up (pure). The claim card runs from frame 0 to the payoff plus its stamp; the
 * viewer card runs for the hook (2.5 to 4.5 s), like the comment card.
 */
export function shelfWindow(
  format: LabOverlay["format"],
  hookEnd: number,
  payoffAt: number,
): { from: number; until: number } | undefined {
  if (format === "receipts") return { from: 0, until: payoffAt + 2.6 };
  if (format === "asked")
    return { from: 0, until: Math.min(4.5, Math.max(2.5, hookEnd)) };
  return undefined;
}

/** A claim cut for the card at a word near `max` characters (pure). */
export function cardClaim(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30)).replace(/[,;:.\s]+$/, "")}...`;
}

/** The Lab tag's text (pure): "PULSE LAB" and "RECEIPTS #14". */
export function tagText(tag: NonNullable<LabOverlay["tag"]>): {
  top: string;
  bottom: string;
} {
  const n =
    tag.number && Number.isInteger(tag.number) && tag.number > 0
      ? ` #${tag.number}`
      : "";
  return { top: "PULSE LAB", bottom: `${tag.segment}${n}` };
}

/** Problems a planned overlay would show on screen (pure): the gate before render. */
export function overlayProblems(
  o: LabOverlay,
  payoffAt: number,
  seconds: number,
): string[] {
  const out: string[] = [];
  if (o.claim && !o.claim.label)
    out.push(
      "A claim card has no label: a claim never goes on screen unlabelled.",
    );
  if (o.claim && !o.claim.source) out.push("A claim card has no source.");
  if (o.instrument) {
    const s = o.instrument.samples;
    if (s.length < 2) out.push("The instrument has fewer than two readings.");
    if (s.some(([t], i) => i > 0 && t < s[i - 1]![0]))
      out.push("The instrument's readings go back in time.");
    if ((s[s.length - 1]?.[0] ?? 0) > payoffAt + 0.05)
      out.push(
        "The instrument reads past the payoff: the answer must land last.",
      );
  }
  if (payoffAt >= seconds) out.push("The payoff is at or past the end.");
  if (o.versus && (!o.versus.aSrc || !o.versus.bSrc))
    out.push("A split screen needs both panes.");
  return out;
}
