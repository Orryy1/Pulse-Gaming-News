// The Pulse Lab's identity (owner, 14 Nov 2026; research 14 Nov section F: a named recurring segment gives a viewer
// something to name and come back for). One place for what the segment is called, how each format's title is shaped,
// how a claim's source is labelled and what the verdicts are called, so the planner, the render and the tests read the
// same words. The friend voice (src/editorial/voice.ts) stays the narrator: the Lab is a look and a name, never a
// second presenter.
//
// The look: the brand's amber on ink, a lab tag in the brand band ("PULSE LAB" with the format and its number) drawn
// whole on frame 0 (a gameplay Short's first frame has to read in a feed, so nothing fades in over the footage), a
// ruler tick along the tag's foot, and one short sting under the game's sound on the first frame. Pure and
// browser-safe.

import { TITLE_MAX, titleProblems } from "../editorial/seo.ts";
import { spoilsStory } from "../streamasks/asks.ts";
import { DAILY_PLOT_WORDS } from "../gtadaily.ts";

export const LAB_NAME = "Pulse Lab";

export type LabFormat = "receipts" | "measured" | "asked" | "versus";

/** What the tag says for each format, after "PULSE LAB". */
export const LAB_SEGMENT: Record<LabFormat, string> = {
  receipts: "RECEIPTS",
  measured: "I MEASURED IT",
  asked: "YOU ASKED",
  versus: "6 VS 5",
};

/** The sting (synthesised in-house, public/sfx/lab/rights.json), played once on frame 0, low under the game. */
export const LAB_STING = "sfx/lab/lab-sting.mp3";
/** A counter's step and the instrument's stop: the house tick and landing hit (public/sfx/v3). */
export const LAB_TICK = "sfx/v3/tick.mp3";
export const LAB_REVEAL = "sfx/v3/land-D.mp3";

// ------------------------------------------------------------------ verdicts and source labels

export type Grade = "TRUE" | "FALSE" | "PARTLY";

/** How a grade is said aloud and in a description (the stamp itself says TRUE, FALSE or PARTLY). */
export const GRADE_WORDS: Record<Grade, string> = {
  TRUE: "true",
  FALSE: "false",
  PARTLY: "partly true",
};

/** Where a claim came from. Anything that is not official is labelled on screen as what it is, never as fact. */
export type ClaimKind =
  | "leak"
  | "datamine"
  | "insider"
  | "rumour"
  | "reported"
  | "myth"
  | "preview"
  | "official"
  | "viewer";

/** The on-screen label for a claim's kind: what a viewer reads before the claim itself. */
export const CLAIM_LABEL: Record<ClaimKind, string> = {
  leak: "LEAK",
  datamine: "DATAMINE",
  insider: "INSIDER CLAIM",
  rumour: "RUMOUR",
  reported: "REPORTED",
  myth: "FAN MYTH",
  preview: "PREVIEW CLAIM",
  official: "OFFICIAL",
  viewer: "VIEWER CLAIM",
};

/** True for every kind that rests on something unofficial: it is said as a claim, with its label, every time. */
export const isUnofficial = (k: ClaimKind): boolean => k !== "official";

// ------------------------------------------------------------------ titles

const DASHES = /\s*[–—]\s*/g;
const SPACES = /\s+/g;
const TRAILING_STOP = /[.!]+$/;
const GAME_LEAD =
  /^\s*(?:the\s+)?(?:gta\s*(?:vi|6)|grand theft auto\s*(?:vi|6))\b\s*(?:day\s*\d+)?\s*[:,.\-|]?\s*/i;
const IN_GAME_TAIL =
  /\s+(?:in|on)\s+(?:gta\s*(?:vi|6)|grand theft auto\s*(?:vi|6))\s*(?=[?.!]?$)/i;
const CAN_YOU = /^(?:can|could) you (?:really |still )?(.+?)\??$/i;
const TRUE_OR_NOT = /^"?(.+?)"?:\s*true or not\??$/i;
/** Words that would give a measured answer away in a title or a hook: digits and number words. */
export const NUMBER_GIVEAWAY =
  /\b(\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|thousand|half)\b/i;

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const lowerFirst = (s: string) =>
  /^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;

/** A question with any game lead or "in GTA 6" tail taken off, dashes made colons, tidied (pure). */
export function cleanQuestion(q: string): string {
  let c = q.replace(DASHES, ": ").replace(SPACES, " ").trim();
  for (let i = 0; i < 3 && GAME_LEAD.test(c); i++)
    c = c.replace(GAME_LEAD, "").trim();
  c = c.replace(IN_GAME_TAIL, "").trim();
  const myth = c.match(TRUE_OR_NOT);
  if (myth)
    c = `Is it true ${lowerFirst(myth[1]!.replace(TRAILING_STOP, ""))}?`;
  return cap(c);
}

/** "Can you lose the cops by changing clothes?" -> "lose the cops by changing clothes" (pure), for "What happens if you". */
export function actionOf(question: string): string | undefined {
  const q = cleanQuestion(question);
  const can = q.match(CAN_YOU);
  if (can) return can[1]!.replace(TRAILING_STOP, "").trim();
  return undefined;
}

const fits = (t: string) => t.length <= TITLE_MAX;

/** The first of the shapes that fits whole within TITLE_MAX (pure); a question is never cut off half way. */
function firstFit(shapes: Array<string | undefined>): string | undefined {
  return shapes.find((s): s is string => !!s && fits(s));
}

/**
 * A Receipts title (pure): the claim as a question, never as a statement, so a leak is never titled as fact.
 * "GTA 6 Receipts: Can your car really run out of fuel?", else "I graded a GTA 6 leak on stream".
 */
export function receiptsTitle(question: string, kind: ClaimKind): string {
  const q = asQuestion(cleanQuestion(question));
  const what =
    kind === "leak" || kind === "datamine"
      ? "a GTA 6 leak"
      : kind === "rumour" || kind === "insider" || kind === "reported"
        ? "a GTA 6 rumour"
        : kind === "myth"
          ? "a GTA 6 myth"
          : "a GTA 6 claim";
  return (
    firstFit([`GTA 6 Receipts: ${q}`, `Receipts: ${q}`]) ??
    `I graded ${what} on stream`
  );
}

/** An "I measured it" title (pure): the question, never the number. */
export function measuredTitle(question: string): string {
  const q = asQuestion(cleanQuestion(question));
  return (
    firstFit([
      `${q} I measured it in GTA 6`,
      `I measured it: ${q}`,
      `${q} I measured it`,
    ]) ?? "I measured it in GTA 6 so you don't have to"
  );
}

/** A "You asked, I tested" title (pure). */
export function askedTitle(question: string): string {
  const q = asQuestion(cleanQuestion(question));
  return (
    firstFit([
      `You asked: ${q} I tested it in GTA 6`,
      `You asked: ${q} I tested it`,
      `You asked, I tested: ${q}`,
    ]) ?? "You asked, so I tested it in GTA 6"
  );
}

/** A split-screen title (pure): "What happens if you <action> in GTA 6 vs GTA 5?", the research's proven shape. */
export function versusTitle(question: string): string {
  const action = actionOf(question);
  const q = asQuestion(cleanQuestion(question));
  return (
    firstFit([
      action ? `What happens if you ${action} in GTA 6 vs GTA 5?` : undefined,
      `${q} GTA 6 vs GTA 5`,
    ]) ?? "GTA 6 vs GTA 5: I tested the same thing in both"
  );
}

function asQuestion(q: string): string {
  const t = q.replace(TRAILING_STOP, "").trim();
  return /\?$/.test(t) ? t : `${t}?`;
}

/** The claim words a GTA 6 Day N title carries for a Lab episode (pure): the plain question, the day says the rest. */
export function dayClaim(question: string): string {
  return asQuestion(cleanQuestion(question));
}

const ADVERTISER =
  /\b(death|dead|kill(?:s|ed|ing)?|war|attack|crisis|horror|scary|murder|gore)\b/i;
const STATED_AS_FACT =
  /^(?:gta 6 )?receipts:\s*(?!can\b|could\b|does\b|do\b|did\b|is\b|are\b|was\b|will\b|would\b|how\b|what\b|why\b)/i;

/** House rules for a Lab title, on top of the channel's own (pure). */
export function labTitleProblems(
  title: string,
  format: LabFormat,
  o: { answer?: string } = {},
): string[] {
  const out = [...titleProblems(title)];
  if (/[–—]/.test(title)) out.push("No em or en dashes in the title.");
  const bad = title.match(ADVERTISER);
  if (bad)
    out.push(`"${bad[0]}" is not advertiser-friendly; say it another way.`);
  // SPOILER_GUARD: a Lab title is about systems, never the story, for the whole launch window and after.
  if (spoilsStory(title) || DAILY_PLOT_WORDS.test(title)) out.push("The title talks about the story.");
  if (format === "receipts" && STATED_AS_FACT.test(title) && !/\?$/.test(title))
    out.push(
      "A Receipts title asks the claim; it never states a leak or rumour as fact.",
    );
  if (format === "measured" && o.answer && title.includes(o.answer))
    out.push(
      "The title gives the measured answer away; the answer comes last.",
    );
  return out;
}
