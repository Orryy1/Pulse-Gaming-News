// The Pulse Check (owner's plan, 4 Nov 2026, item 10): one named segment with a consistent take, as the reason to
// follow news Shorts. The growth plan's finding was that a news Short is about someone else's game and leaves nothing
// behind; a viewer who knows every news Short ends on one of the same four readings has something of ours to come back
// for. It is three spoken words at the end of the take, so it fits inside the news writer's word limit and adds no
// card: the take's usual card carries the name and the reading. The desk question still comes before the take and the
// loop line still closes the Short, so neither the desk test nor the rewatch loop changes. Since 11 Nov 2026 the narrator
// says it like a friend's verdict rather than reading a label, and since 13 Nov 2026 (clarity first) he says it in plain
// words, "My verdict: wait for reviews.", while the card shows PULSE CHECK and the reading. The reading is an opinion
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

// How the narrator used to say the name (11 Nov 2026: a friend's verdict, not a label): "Pulse check:", "My Pulse
// check?", "So, my Pulse check on this one?". Kept so an older script still reads; new scripts say "My verdict".
const LEAD = String.raw`(?:(?:so|okay|right|look|and|honestly),?\s+)?(?:my |our |the )?pulse check(?: on (?:this|that)(?: one)?| here)?`;
// Clarity first (owner, 13 Nov 2026: "My Pulse check? Faint" left viewers "unsure what the actual point" was): the
// segment's name and its reading word are ours, not the viewer's, so out loud the take ends on a plain verdict ("My
// verdict: wait until Rockstar confirms it.") and the card carries PULSE CHECK and the reading.
const VERDICT_LEAD = String.raw`(?:(?:so|okay|right|look|and|honestly),?\s+)?(?:my|the) (?:verdict|call)(?: on (?:this|that)(?: one)?| here)?`;
/** The lead-in alone, asked as a question ("My verdict?", or the older "My Pulse check?"): the segment's own beat, never a mid-take question. */
export const PULSE_CHECK_ASK = new RegExp(
  `^(?:${LEAD}|${VERDICT_LEAD})\\?$`,
  "i",
);
// "My Pulse check is weak, because ..." is the same verdict said plainly (12 Nov 2026: a GTA File part was dropped for it).
const PULSE_CHECK_END = new RegExp(
  `(?:^|[.!?"”]\\s+)${LEAD}(?:\\s+(?:is|reads|says)|['’]s)?\\s*[:?,.]?\\s*(strong|steady|weak|faint)\\b[^.!?]*[.!?]["”]?$`,
  "i",
);
/** The plain verdict that ends the take: "My verdict: wait for reviews." or "My verdict? Skip it." */
const VERDICT_END = new RegExp(
  `(?:^|[.!?"”]\\s+)(${VERDICT_LEAD}\\s*[:?,]\\s*[^.!?]+[.!?]["”]?)$`,
  "i",
);
const VERDICT_HEAD = new RegExp(`^${VERDICT_LEAD}\\s*[:?,]\\s*`, "i");
/** A verdict that is only one of our reading words ("My verdict: faint."), which tells a viewer nothing. */
const BARE_READING =
  /^(?:strong|steady|weak|faint)\b[\s,.!?]*(?:(?:because|but|since|until|if)\b.*)?$/i;
const READING_START = /^(strong|steady|weak|faint)\b/i;

/** The brief's rule, added to one news Short's user message; the system prompt is untouched. */
export function pulseCheckRule(): string {
  return `This Short's take ends on the Pulse Check, our named segment and the reason viewers follow the news here. Out loud it is the narrator's plain verdict, the way a friend sums something up: the take's last sentence starts "My verdict:" and says in everyday words what the viewer should do or think, with its reason, in at most 12 words ("My verdict: wait until Rockstar confirms the upgrade."). Never say "Pulse check" aloud and never speak a reading word as the verdict ("My verdict: faint." means nothing to a viewer): the name and the reading are ours, so they go on the card, not in the voice.
The reading goes on screen and is an opinion about what the news means for the viewer; each word means the same thing every time, and the spoken verdict says that meaning in this story's own words:
- strong: confirmed and good for you, worth acting on or looking forward to.
- steady: confirmed, but little changes for you; nothing to do yet.
- weak: confirmed and worse for you: you pay more, wait longer or get less.
- faint: not confirmed. A leak, a report, an unnamed source or a rumor. Whenever is_rumour is true the reading is faint, with no exception, and the verdict says so ("My verdict: treat it as a rumor until Sony confirms it.").
Example shapes only, in your own words for this story, never these words: "My verdict: worth the wait, if you liked the first one." "My verdict: skip the deluxe edition." "My verdict: don't plan around a date nobody has confirmed."
The take's other sentences come first and still answer the desk question or the hook, with the take's one reason; the verdict never replaces that answer, and it is never the take's only sentence. It says the take's conclusion once, so it carries no second "I think" or "honestly". It rates the news for players, never a person, and never people losing their jobs: on a layoffs or closure story rate only what it means for the games, usually steady.
It does not lengthen the Short: the word limit stands, so cut a weaker line to make room. The loop_line still follows and closes the Short. Say "Pulse check" nowhere in the narration.
Set pulse_take.label to "${PULSE_CHECK_LABEL}" and start pulse_take.on_screen with the reading in capitals and a colon, then the verdict in plain words ("STEADY: 212GB, nothing else changes"), still 3-8 words.`;
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** The reading an older take ends on, when it says it aloud ("Pulse check: weak, ..."). */
export function pulseCheckReading(take: string): PulseCheckReading | undefined {
  const m = take.trim().match(PULSE_CHECK_END);
  return m ? (m[1]!.toLowerCase() as PulseCheckReading) : undefined;
}

/** The plain verdict a take ends on ("My verdict: wait for reviews."), whole, or undefined. */
export function pulseVerdict(take: string): string | undefined {
  return take.trim().match(VERDICT_END)?.[1];
}

/** A Short's reading: the on-screen card's ("FAINT: ..."), else the one an older take says aloud. */
export function pulseReadingOf(
  s: Pick<Script, "pulse_take">,
): PulseCheckReading | undefined {
  const m = s.pulse_take.on_screen.trim().match(READING_START);
  return m
    ? (m[1]!.toLowerCase() as PulseCheckReading)
    : pulseCheckReading(s.pulse_take.narration);
}

/** What is wrong with a news Short's Pulse Check; empty when it is right. */
export function pulseCheckProblems(s: Script): string[] {
  const take = s.pulse_take.narration.trim();
  const out: string[] = [];
  const all = [
    s.hook,
    ...s.beats.map((b) => b.narration),
    s.desk_question ?? "",
    take,
    s.loop_line,
  ].join(" ");
  if (/\bpulse check\b/i.test(all))
    out.push(
      `Don't say "Pulse check" aloud: viewers don't know the name. End the take on a plain verdict ("My verdict: wait for reviews."); the card carries PULSE CHECK and the reading.`,
    );
  const verdict = pulseVerdict(take);
  if (!verdict)
    out.push(
      `The take must end on a plain verdict: one sentence starting "My verdict:" that says what the viewer should do or think ("My verdict: wait until it's confirmed.").`,
    );
  else {
    if (words(verdict) > MAX_WORDS)
      out.push(
        `The verdict is ${words(verdict)} words; keep it to ${MAX_WORDS}: what to do or think, and why, in plain words.`,
      );
    if (words(take) === words(verdict))
      out.push(
        "The verdict is the take's only sentence; give the take's reason first, then the verdict.",
      );
    if (BARE_READING.test(verdict.replace(VERDICT_HEAD, "").trim()))
      out.push(
        `"${verdict}" speaks a reading word as the verdict, which means nothing to a viewer; say plainly what they should do or think.`,
      );
  }
  const reading = pulseReadingOf(s);
  if (s.is_rumour && reading && reading !== "faint")
    out.push(
      `This story is not confirmed, so its Pulse Check reads faint, not ${reading}.`,
    );
  if (s.pulse_take.label.toUpperCase() !== PULSE_CHECK_LABEL)
    out.push(`The take's label must be "${PULSE_CHECK_LABEL}".`);
  if (!READING_START.test(s.pulse_take.on_screen.trim()))
    out.push(
      `The take's on-screen line must start with the reading (STRONG:, STEADY:, WEAK: or FAINT:).`,
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
