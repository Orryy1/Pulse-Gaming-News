// The Pulse Check (owner's plan, 4 Nov 2026, item 10): one named segment with a consistent take, as the reason to
// follow news Shorts. The growth plan's finding was that a news Short is about someone else's game and leaves nothing
// behind; a viewer who knows every news Short ends on one of the same four readings has something of ours to come back
// for. It is three spoken words at the end of the take, so it fits inside the news writer's word limit and adds no
// card: the take's usual card carries the name and the reading. The desk question still comes before the take and the
// loop line still closes the Short, so neither the desk test nor the rewatch loop changes. Since 11 Nov 2026 the narrator
// says it like a friend's verdict ("My Pulse check? Steady, but...") rather than reading a label. The reading is an opinion
// on what the news means for the viewer, not a fact, and a story that is not confirmed can only ever read "faint".
// Scripts are American English. NEWS_SEGMENT turns it on.
import type { Script } from "./schema.ts";

export const PULSE_CHECK_LABEL = "PULSE CHECK";
export const PULSE_CHECK_READINGS = [
  "strong",
  "steady",
  "weak",
  "faint",
] as const;
export type PulseCheckReading = (typeof PULSE_CHECK_READINGS)[number];

/** The sentence's most words: the name, the reading and a short reason in the story's own terms. */
const MAX_WORDS = 12;

// How the narrator says the name (owner, 11 Nov 2026: a friend's verdict, not a label): "Pulse check:", "My Pulse
// check?", "So, my Pulse check on this one?". The four readings stay fixed whatever leads into them.
const LEAD = String.raw`(?:(?:so|okay|right|look|and|honestly),?\s+)?(?:my |our |the )?pulse check(?: on (?:this|that)(?: one)?| here)?`;
/** The lead-in alone, asked as a question ("My Pulse check?"): the segment's own beat, never a mid-take question. */
export const PULSE_CHECK_ASK = new RegExp(`^${LEAD}\\?$`, "i");
// "My Pulse check is weak, because ..." is the same verdict said plainly (12 Nov 2026: a GTA File part was dropped for it).
const PULSE_CHECK_END = new RegExp(
  `(?:^|[.!?"”]\\s+)${LEAD}(?:\\s+(?:is|reads|says)|['’]s)?\\s*[:?,.]?\\s*(strong|steady|weak|faint)\\b[^.!?]*[.!?]["”]?$`,
  "i",
);

/** The brief's rule, added to one news Short's user message; the system prompt is untouched. */
export function pulseCheckRule(): string {
  return `This Short's take ends on the Pulse Check, our named segment and the reason viewers follow the news here. It's the narrator's own verdict, said the way a friend sums something up, never a label read out: the take ends on "Pulse check" (on its own or as "My Pulse check?"), one reading, and optionally a comma and a reason of up to 8 words in the narrator's voice and this story's own terms. The reading is an opinion about what the news means for the viewer, and each word means the same thing every time:
- strong: confirmed and good for you, worth acting on or looking forward to.
- steady: confirmed, but little changes for you; nothing to do yet.
- weak: confirmed and worse for you: you pay more, wait longer or get less.
- faint: not confirmed. A leak, a report, an unnamed source or a rumor. Whenever is_rumour is true the reading is faint, with no exception, and the reason says so ("Pulse check: faint, until Sony says it.").
Example shapes only, in your own words for this story, never these words: "My Pulse check? Steady, but don't hold your breath for a sequel." "Pulse check: weak, if you were planning on launch day." "So my Pulse check on this one? Faint, until Sony says it."
The take's other sentences come first and still answer the desk question or the hook, with the take's flat verdict and its one "I" line; the reading never replaces that answer, and it is never the take's only sentence. The Pulse Check sums the verdict up in one word, so it carries no second "I think" or "honestly". It rates the news for players, never a person, and never people losing their jobs: on a layoffs or closure story rate only what it means for the games, usually steady.
It does not lengthen the Short: the word limit stands, so cut a weaker line to make room. The loop_line still follows and closes the Short. Say "Pulse check" nowhere else in the script.
Set pulse_take.label to "${PULSE_CHECK_LABEL}" and start pulse_take.on_screen with the reading in capitals and a colon ("STEADY: 212GB, nothing else changes"), still 3-8 words.`;
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** The reading the take ends on, when it follows the form. */
export function pulseCheckReading(take: string): PulseCheckReading | undefined {
  const m = take.trim().match(PULSE_CHECK_END);
  return m ? (m[1]!.toLowerCase() as PulseCheckReading) : undefined;
}

/** What is wrong with a news Short's Pulse Check; empty when it is right. */
export function pulseCheckProblems(s: Script): string[] {
  const take = s.pulse_take.narration.trim();
  const reading = pulseCheckReading(take);
  if (!reading)
    return [
      `The take must end on the Pulse Check, said as the narrator's verdict ("My Pulse check? Steady, ..." or "Pulse check: weak, ..."), with the reading strong, steady, weak or faint.`,
    ];
  const out: string[] = [];
  const last = take.slice(take.toLowerCase().lastIndexOf("pulse check"));
  if (words(last) > MAX_WORDS)
    out.push(
      `The Pulse Check is ${words(last)} words; keep it to ${MAX_WORDS}: the name, the reading and a short reason.`,
    );
  if (words(take) === words(last))
    out.push(
      "The Pulse Check is the take's only sentence; answer the question first, then give the reading.",
    );
  if (s.is_rumour && reading !== "faint")
    out.push(
      `This story is not confirmed, so its Pulse Check reads faint, not ${reading}.`,
    );
  const all = [
    s.hook,
    ...s.beats.map((b) => b.narration),
    s.desk_question ?? "",
    take,
    s.loop_line,
  ].join(" ");
  if ((all.match(/\bpulse check\b/gi) ?? []).length > 1)
    out.push(`Say "Pulse check" once, at the end of the take.`);
  if (s.pulse_take.label.toUpperCase() !== PULSE_CHECK_LABEL)
    out.push(`The take's label must be "${PULSE_CHECK_LABEL}".`);
  if (!new RegExp(`^${reading}\\b`, "i").test(s.pulse_take.on_screen.trim()))
    out.push(
      `The take's on-screen line must start with the reading (${reading.toUpperCase()}:).`,
    );
  return out;
}

// ---- The series (format redesign plan item 6) ------------------------------------------------------------------------

/** The series whose Shorts end on the Pulse Check once NEWS_SEGMENT_SERIES is on. */
const SERIES_WITH_CHECK = new Set(["why", "gta_file", "verdict"]);

/**
 * Whether a Short's take ends on the Pulse Check: a news Short with NEWS_SEGMENT (as before), and since the format
 * redesign every series Short (The Why, The GTA File, Buy, Wait or Skip) with NEWS_SEGMENT_SERIES. A Short in the
 * argument test has no labelled take, so it never carries one.
 */
export function pulseCheckFor(
  cfg: { newsSegment: boolean; newsSegmentSeries?: boolean },
  x: { lane: string; why: boolean; argument: boolean; series?: string },
): boolean {
  if (x.argument) return false;
  if (cfg.newsSegmentSeries && x.series && SERIES_WITH_CHECK.has(x.series))
    return true;
  return (
    cfg.newsSegment &&
    !x.why &&
    (x.lane === "news" || x.lane === "news_breaking")
  );
}

const SERIES_NOTE: Record<string, string> = {
  why: "This Short is The Why, our numbered series: the reading rates what the answer means for the viewer today (strong: worth playing or revisiting now; steady: a good story, nothing to do; weak: it aged badly or costs you; faint: the answer rests on a report, not a confirmed fact).",
  gta_file:
    "This Short is The GTA File, our numbered GTA VI serial: the reading rates what today's confirmed fact means for a GTA VI player.",
  verdict:
    "This Short is Buy, Wait or Skip: the Pulse Check sums up the verdict in one reading after the BUY, WAIT or SKIP call: strong for a buy, steady for a wait, weak for a skip, and faint when the price or the scores are only reported.",
};

/** What the reading means in a series Short, for its writer's note; empty for a Short in no series. */
export function seriesPulseCheckNote(series: string | undefined): string {
  return (series && SERIES_NOTE[series]) || "";
}

/** The whole Pulse Check brief for a series Short (for a writer of its own, such as Buy, Wait or Skip's). */
export function seriesPulseCheckRule(series: string): string {
  const note = seriesPulseCheckNote(series);
  return note ? `${pulseCheckRule()}\n${note}` : pulseCheckRule();
}
