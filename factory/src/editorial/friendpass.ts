// The friend pass (owner, 11 Nov 2026, after a documentary: "we need to feel way more real, personal, like a
// viewer's friend rather than a journalist or corporate company, with hot takes, a bit of edginess, a bit of
// humour"). The shared voice asked for that, yet the writers' briefs are mostly rules about facts, cards and shapes,
// and every revision after the fact check fixed facts in the same flat register. So once a script's facts are
// settled, one cheap call rewrites its delivery only: the narrator's own take, a dry joke or two at a company or
// a situation, spoken rhythm and a few eleven_v3 delivery tags. Nothing factual may move. A deterministic guard
// compares every figure, name and quotation before and after, the writers' own checks run again, and then the
// existing fact check reads the new version; if any of it fails, the settled script goes out as it was.
// FRIEND_PASS (src/config.ts) picks the writers it runs for.

import { z } from "zod";
import type { Llm, Tier } from "./llm.ts";
import {
  narrationOf,
  wordCount,
  type FactCheck,
  type Script,
} from "./schema.ts";
import type { DocChapter } from "./documentary.ts";
import type { Config, FriendPassFormat } from "../config.ts";
import {
  PULSE_VOICE,
  PULSE_FACT_RULES,
  VOICE_TAG_RULE,
  outsideQuotes,
  sentencesIn,
  inventedExperience,
  advertiserProblems,
  phraseProblems,
  writingProblems,
} from "./voice.ts";
import { pulseCheckReading, pulseVerdict } from "./newssegment.ts";
import {
  VOICE_TAGS,
  extractVoiceTags,
  stripVoiceTags,
  voiceTexts,
  type VoiceTagMark,
} from "../voice/tags.ts";
import { applyEdits } from "./revise.ts";
import { ATTRIBUTION_VARY, attributionFrames } from "./attribution.ts";
import { errorMessage } from "../lib/util.ts";

/** Whether the friend pass runs for this writer (FRIEND_PASS). */
export function friendPassOn(
  cfg: Pick<Config, "friendPass">,
  format: FriendPassFormat,
): boolean {
  return (cfg.friendPass ?? []).includes(format);
}

// ---------------------------------------------------------------- the guard (pure)

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90",
  hundred: "100",
  thousand: "1000",
  million: "million",
  billion: "billion",
  dozen: "12",
};
// "One" is left out: "this one", "a one-off" and "one more thing" are how people talk, not figures.
const NUMBER_WORD = new RegExp(
  `\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`,
  "gi",
);

/** The figures a text says, as digits where it spells them: "$7.19", "18%", "three players" give 7.19, 18, 3. */
export function figuresOf(text: string): Set<string> {
  const t = stripVoiceTags(text);
  const out = new Set<string>();
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?/g))
    out.add(m[0].replace(/,/g, "").replace(/\.$/, ""));
  for (const m of t.matchAll(NUMBER_WORD))
    out.add(NUMBER_WORDS[m[1]!.toLowerCase()]!);
  return out;
}

const I_FORM = /^I(?:'m|'d|'ll|'ve|’m|’d|’ll|’ve)?$/;
// The possessive goes before the trailing stops, so "B.J.'s" and "B.J." are the same name ("B.J").
const clean = (raw: string) =>
  raw
    .replace(/^[("“'‘[]+/, "")
    .replace(/[)"”'’\].,;:!?…]+$/, "")
    .replace(/['’]s$/, "")
    .replace(/[.]+$/, "");

/**
 * The names a text says: capitalised words that aren't the first of their sentence, and any word with a digit or a
 * second capital wherever it stands ("PS5", "GTA", "PlayStation"). A plain capital opening a sentence is left to the
 * fact check: "Honestly" and "Sony" look alike to a rule.
 */
export function namesOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const s of sentencesIn(stripVoiceTags(text))) {
    const toks = s.split(/\s+/);
    toks.forEach((raw, i) => {
      const tok = clean(raw);
      if (!/[A-Z]/.test(tok) || I_FORM.test(tok)) return;
      const strong = /\d/.test(tok) || /[A-Z].*[A-Z]/.test(tok);
      // A word after a colon opens a clause like a sentence does ("My verdict: Don't...").
      const opens = i === 0 || /:$/.test(toks[i - 1] ?? "");
      if (opens && !strong) return;
      out.add(tok);
    });
  }
  return out;
}

/**
 * Runs of capitalised words, each a name as people write it ("Reflector Entertainment", "Rob Nelson"). A rewrite
 * may shorten a name to the part people say ("Reflector"), so a name only counts as dropped when none of it is left.
 */
export function nameRunsOf(text: string): string[][] {
  const runs: string[][] = [];
  for (const s of sentencesIn(stripVoiceTags(text))) {
    let run: string[] = [];
    for (const raw of s.split(/\s+/)) {
      const tok = clean(raw);
      if (/[A-Z]/.test(tok) && !I_FORM.test(tok)) run.push(tok);
      else {
        if (run.length) runs.push(run);
        run = [];
      }
      // A comma or a full stop ends a name ("Sony, Microsoft").
      if (/[,.;:!?]$/.test(raw) && run.length) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
  }
  return runs;
}

const QUOTE = /"([^"]+)"|“([^”]+)”/g;
const quoteText = (q: string) =>
  q
    .trim()
    .replace(/[’‘]/g, "'")
    .replace(/[.,;:!?]+$/, "");
/** The quotations a text carries, as their words. */
export function quotesOf(text: string): string[] {
  return [...stripVoiceTags(text).matchAll(QUOTE)].map((m) =>
    quoteText(m[1] ?? m[2] ?? ""),
  );
}

// A rumor's label never goes. A credit frame may be reworded ("according to Kotaku" to "Kotaku says") and a repeated
// one may go (ATTRIBUTION_VARY, 13 Nov 2026), so frames are counted as frames, one needed for each source named.
const RUMOR_LABEL =
  /\b(?:reportedly|rumou?red|allegedly|unconfirmed|suggests?|leak(?:s|ed)?|sources? (?:say|said|claim|told))\b/gi;
const rumorLabels = (t: string) => (t.match(RUMOR_LABEL) ?? []).length;
const creditFrames = (t: string) =>
  attributionFrames(t).filter((f) => !f.key.includes("wikipedia"));
/** The credits a rewrite must keep: one for each source the original credits, however often it credited it. */
const creditsNeeded = (t: string) =>
  new Set(creditFrames(t).map((f) => f.key)).size;

const kindOf = (p: string) =>
  p
    .replace(/"[^"]*"/g, '""')
    .replace(/\d+/g, "#")
    .trim();

/** The problems in `after` of a kind `before` didn't already have (quoted words and counts don't make a new kind). */
export function newProblems(before: string[], after: string[]): string[] {
  const had = new Set(before.map(kindOf));
  return after.filter((p) => !had.has(kindOf(p)));
}

const lowerWords = (t: string) =>
  new Set(
    stripVoiceTags(t)
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .split(/[^a-z0-9$%.'-]+/)
      .map((w) =>
        w
          .replace(/^'+|'+$/g, "")
          .replace(/'s$/, "")
          .replace(/\.$/, ""),
      )
      .filter(Boolean),
  );

/**
 * What a delivery rewrite changed that it mustn't (pure): figures added or dropped, names added or dropped,
 * quotations altered, rumor labels lost, an invented experience, and advertiser or banned-phrase problems the
 * original didn't have. Empty means the facts held.
 */
export function factDrift(before: string, after: string): string[] {
  const p: string[] = [];
  const fb = figuresOf(before);
  const fa = figuresOf(after);
  const lost = [...fb].filter((x) => !fa.has(x));
  const added = [...fa].filter((x) => !fb.has(x));
  if (lost.length) p.push(`The rewrite drops the figure ${lost.join(", ")}.`);
  if (added.length) p.push(`The rewrite adds the figure ${added.join(", ")}.`);
  const wb = lowerWords(before);
  const wa = lowerWords(after);
  // The short form people say for a name already there is the same name ("GTA" for "Grand Theft Auto").
  const initials = new Set(
    nameRunsOf(before)
      .filter((run) => run.length > 1)
      .map((run) => run.map((x) => x[0]).join("").toUpperCase()),
  );
  // A name whose other form is already there is the same name: "Korea" after "South Korean", "Japan" after "Japanese".
  const sameStem = (n: string) => {
    const l = n.toLowerCase();
    return l.length >= 4 && [...wb].some((w) => w.length >= 4 && (w.startsWith(l) || l.startsWith(w)));
  };
  const newNames = [...namesOf(after)].filter(
    (n) => !wb.has(n.toLowerCase()) && !initials.has(n) && !sameStem(n),
  );
  const named = namesOf(before);
  const afterInitials = new Set(
    nameRunsOf(after)
      .filter((run) => run.length > 1)
      .map((run) => run.map((x) => x[0]).join("").toUpperCase()),
  );
  const lostNames = nameRunsOf(before)
    .filter(
      (run) =>
        run.some((x) => named.has(x)) &&
        !run.some((x) => wa.has(x.toLowerCase()) || afterInitials.has(x)) &&
        !(run.length > 1 && wa.has(run.map((x) => x[0]).join("").toLowerCase())) &&
        // Our own segment's name is a label, not a fact: saying it plainly instead is the point.
        !run.some((x) => /^pulse$/i.test(x)),
    )
    .map((run) => run.join(" "));
  if (newNames.length)
    p.push(`The rewrite adds the name ${newNames.join(", ")}.`);
  if (lostNames.length)
    p.push(`The rewrite drops the name ${lostNames.join(", ")}.`);
  const plainAfter = quoteText(stripVoiceTags(after).replace(/[“”]/g, '"'));
  const qb = quotesOf(before);
  for (const q of qb)
    if (!plainAfter.includes(q))
      p.push(`The rewrite changes the quotation "${q}".`);
  const plainBefore = quoteText(stripVoiceTags(before).replace(/[“”]/g, '"'));
  for (const q of quotesOf(after))
    if (!qb.includes(q) && !plainBefore.includes(q))
      p.push(`The rewrite adds the quotation "${q}".`);
  if (rumorLabels(after) < rumorLabels(before))
    p.push(
      `The rewrite drops an attribution, a rumor label ("reportedly", "rumored", "sources say"); a rumor keeps every label.`,
    );
  if (creditFrames(after).length < creditsNeeded(before))
    p.push(
      `The rewrite drops an attribution ("according to", "told", "says"); reword a repeated credit, but keep one for each source named.`,
    );
  const invented = inventedExperience(after);
  if (invented && !inventedExperience(before))
    p.push(`"${invented}" claims an experience the narrator never had.`);
  p.push(
    ...newProblems(advertiserProblems(before), advertiserProblems(after)),
    ...newProblems(phraseProblems(before), phraseProblems(after)),
  );
  return p;
}

const wordsIn = (t: string) =>
  stripVoiceTags(t).split(/\s+/).filter(Boolean).length;

/** The most delivery tags a stretch of narration may carry: one every three sentences or so, at least one. */
export function tagLimit(sentences: number, most = 3): number {
  return Math.min(most, Math.max(1, Math.round(sentences / 3)));
}

/** A documentary chapter's most delivery tags: they follow its one or two asides (voice study, 11 Nov 2026: about one joke every two minutes in documentaries). */
export const CHAPTER_TAGS_MOST = 3;

/** A length that strays more than this share from the original is a rewrite of the content, not the delivery. */
const LENGTH_DRIFT = 0.2;

function lengthProblem(before: string, after: string): string[] {
  const a = wordsIn(after);
  const b = wordsIn(before);
  return Math.abs(a - b) > Math.max(6, b * LENGTH_DRIFT)
    ? [
        `The rewrite runs ${a} words against the original's ${b}; keep the length.`,
      ]
    : [];
}

// ---------------------------------------------------------------- the prompt

// Everything about how the pass should sound lives in FRIEND_STYLE, on top of the shared PULSE_VOICE, so a new voice
// study can replace it in one place. FRIEND_FACT_LOCK is what may never move, whatever the style says.
export const FRIEND_STYLE = `The friend pass
You're given a finished script whose facts are settled and fact-checked. Rewrite its delivery only, so it sounds like the viewer's gaming friend telling them this on the sofa, not a news desk reading a bulletin, and so a viewer who hears it once understands it. Same story, same facts, same order, a clearer and warmer voice.

Clarity comes first (owner, 13 Nov 2026: the friendlier scripts were "a little nonsensical / confusing / unclear", leaving viewers "unsure what the actual point" was). A friend explains things; a friend doesn't talk in riddles:
- The point stays plain. A casual viewer must be able to repeat the Short's one point in a sentence after hearing it once: who did what, the number that matters, and what it means for them. If the original buries it, make the take say it plainly.
- Every sentence follows from the one before. A line that makes the viewer guess the link (a metaphor, a pun, a quip about something nobody said, a "that" with nothing clear to point at) goes, or becomes the plain point.
- Fix what is unclear in the original too: a vague "it" or "that", a "your" bolted onto something that isn't the viewer's ("your East Coast unlock", "your unfinished trilogy", "your game's vote"), jargon, a line that doesn't follow, a closing line that only makes sense to the writer.

Then, where the script doesn't already have them:
- One owned verdict, in the take: a flat claim with its reason, then at most one first-person line that owns it ("That's steep for a remaster. I'd wait for a sale.", "I think this one's on Sony"). The "I" lives in the take: the beats tell the story and carry no "I'd" or "I want" lines, and a Short has one or two "I" sentences in all. One "I think" or "honestly" is plenty: never stack them and never put one in the first sentence. Never an experience: never "I played", "I tried", "I've seen", "when I was", "my copy", because the narrator has never played, bought, watched or attended anything.
- "You" where it is natural: when a fact really lands on the viewer (their money, their console, their wait, their pre-order), say "you"; turn a line about "fans" or "gamers" into one about you. No quota: a sentence that reads oddly with "you" in it stays about the game.
- At most one light joke, and only one that earns its place: it follows straight from the line before, a viewer gets it with no context, and it is about a company, a price, a decision or the situation (a deadpan understatement, an honest groan, a translation of a phrase the script already quotes, a wry turn on two facts already there). Read it after the line before it: if the link isn't obvious, cut it. If no joke comes naturally from the facts, add none: a clear Short with no joke beats a funny one nobody follows. Never at players, fans, developers who lost their jobs or any group of people; on a layoffs or closure story be kind about the people and keep the dryness for the business decision. No profanity, nothing mean, nothing an advertiser would mind. Warm beats sharp about three to one: when the news is good for you, let the friend sound pleased.
- Spoken rhythm: contractions, short sentences (in a Short about 9-12 words on average, one in three under eight), a short line after a long one, and a spoken joining word ("right", "well", "look", "of course", "so", "which") about once per hundred words, at most one rhetorical "right?". Every sentence still has a verb.
- Delivery tags where a person would truly react: [sighs] before a catch or a groan, [chuckles] right after the dry line, [sarcastic] on it, [excited] before good news, [curious] before something odd. Never on a plain fact or a flat verdict, never two within two sentences, never inside a quotation.

Personal means a real opinion, said clearly: the flat, news-desk register is what the owner turned down (11 Nov 2026), and riddles are what he turned down next (13 Nov 2026). A friend reading both versions should hear one real first-person take and a story that is easier to follow. More opinion words don't make it more personal: one committed verdict with a reason beats four hedged ones.

Sound like a person, not a parody of one: no meme slang ("bro", "it's giving", "no cap"), no "folks", "guys" or "y'all", no "let's be real", "plot twist", "spoiler alert" or "buckle up", no exclamation marks, no "um", "literally", "basically" or filler "like", no pun for its own sake, no laughing at your own line, no metaphor the viewer has to decode.

What the change sounds like, with made-up facts (copy the move, never the words):
Desk: "Ubisoft delayed Skull Raiders to March 2027. The studio said it needs more time for polish. It's the third delay since 2024. Pre-orders remain open."
Friend: "Ubisoft delayed Skull Raiders again, to March 2027. The studio says it needs more time for polish. That's the third delay since 2024, so a pre-order now just ties up your money. I'd cancel it and decide once it's out."
The facts and figures are the same; the point is said plainly, every line follows the one before, and the take is a real call in the first person with its reason.`;

/** What the pass may never change: the guard and the fact check enforce it whatever the style asks for. */
export const FRIEND_FACT_LOCK = `Never change (your version goes back to the fact check, and a moved fact throws it away):
- Every number, price, percentage, date, name, title, outlet and platform stays, meaning the same thing, and nothing new comes in: no comparison game, no year, no figure, no person, no outlet. A joke may only use what's already there.
- No figure worked out from the ones there either ("ten dollars more", "twice the price"): a sum the sources never state is a new fact.
- Quotations stay word for word inside their quote marks, credited as before, and your own words never go in quote marks.
- Every rumor label ("reportedly", "rumored") and every named reporter stays; a rumor never sounds more certain than it did. A credit that repeats may be reworded (see Credits), never taken off a rumor, a number or a quote.
- Opinions stay opinions; never turn one into a fact or a fact into a guess.`;

/** The friend pass's instructions: the shared voice, the facts rules, the tags and the pass's own rules. */
export function friendPassPrompt(): string {
  return `${PULSE_VOICE}\n\n${PULSE_FACT_RULES}\n\n${VOICE_TAG_RULE}\n\n${FRIEND_STYLE}

${ATTRIBUTION_VARY}

${FRIEND_FACT_LOCK}`;
}

// ---------------------------------------------------------------- edits, not a new script

// The pass answers in edits, as the revisions do (src/editorial/revise.ts): everything it doesn't touch stays word for
// word, so length and facts move only where it chose to, and the answer is a fraction of a whole script. A full
// rewrite on the mid model ran 30-40% long and lost lines that spoke to the viewer (11 Nov 2026 tuning runs).
const FriendEditsSchema = z.object({
  edits: z
    .array(
      z.object({
        find: z
          .string()
          .describe(
            "A passage copied exactly from one editable line of the script, character for character, long enough to appear only once",
          ),
        replace: z
          .string()
          .describe(
            "What goes there instead, with any delivery tag in curly braces like {sighs}",
          ),
      }),
    )
    .describe("The changes, usually three to six"),
});

const EDIT_HOW = `Answer with edits, not a new script: for each, "find" is a passage copied exactly from one editable line (character for character, long enough to be unique) and "replace" is what goes there instead. Everything you don't edit stays word for word. Rewrite a whole sentence when that reads better than patching a few words. Write each delivery tag in curly braces inside a replace, like {sighs} or {chuckles}: the same tags described above, braces instead of square brackets. Tags already in the script are shown the same way.`;

const SQUARE_TAG = new RegExp(`\\[(${VOICE_TAGS.join("|")})\\]`, "gi");
const toBraces = (t: string) => t.replace(SQUARE_TAG, "{$1}");
const fromBraces = (t: string) => t.replace(/\{([a-z][a-z ]*)\}/gi, "[$1]");

/**
 * One call for the edits, applied to the editable lines (tags shown in braces), then every line's tags lifted
 * into marks. Throws when there are no edits or one doesn't land on the text, so the original stands.
 */
async function editLines(
  llm: Llm,
  o: {
    site: string;
    tier: Tier;
    effort: "low" | "medium" | "high";
    notes: string[];
    lines: Record<string, string>;
    /** What the model sees: the lines with their context (counts, cards, the fixed hook). */
    view: unknown;
  },
): Promise<{
  lines: Record<string, string>;
  marks: VoiceTagMark[];
  braced: Record<string, string>;
}> {
  const r = await llm.structured({
    site: o.site,
    tier: o.tier,
    effort: o.effort,
    system: friendPassPrompt(),
    content: `${o.notes.join("\n\n")}\n\n${EDIT_HOW}\n\nTHE SCRIPT (JSON):\n${JSON.stringify(o.view, null, 1)}`,
    schema: FriendEditsSchema,
  });
  const braced = Object.fromEntries(
    Object.entries(o.lines).map(([k, v]) => [k, toBraces(v)]),
  );
  const edited = applyEdits(braced, r.edits);
  if (!edited)
    throw new Error(
      r.edits.length
        ? "an edit didn't land on the script's text"
        : "the pass returned no edits",
    );
  const marks: VoiceTagMark[] = [];
  const lines: Record<string, string> = {};
  for (const [k, v] of Object.entries(edited)) {
    const x = extractVoiceTags(fromBraces(v));
    marks.push(...x.marks);
    lines[k] = x.text.replace(/\s+([,.!?])/g, "$1").trim();
  }
  return { lines, marks, braced: edited };
}

// ---------------------------------------------------------------- news Shorts

export interface FriendShortOpts {
  /** The take ends on the Pulse Check (NEWS_SEGMENT). */
  segment?: boolean;
  /** The loop line is a statement (SHORT_END_PAYOFF). */
  endStatement?: boolean;
  /** The recent Shorts' take openers and closing lines, so the rewrite doesn't land on one of them. */
  recent?: { takes: string[]; loops: string[] };
  wordsMin?: number;
  wordsMax?: number;
  /** The model for the pass: the mid model unless a caller asks otherwise. */
  tier?: Tier;
}

const shortFields = (
  s: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
) => [
  s.hook,
  ...s.beats.map((b) => b.narration),
  s.pulse_take.narration,
  s.loop_line,
];

/** A Short's written narration, hook to loop line, as one text (no tags, not made speakable). */
export function shortText(
  s: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
): string {
  return shortFields(s).join(" ");
}

/** The delivery pass on a settled news Short: one mid-model call. The hook, cards and every other field stay. */
export async function friendShort(
  llm: Llm,
  script: Script,
  opts: FriendShortOpts = {},
): Promise<Script> {
  const texts = voiceTexts(shortFields(script), script.voice_tags);
  const words = wordsIn(shortText(script));
  // The house limit counts the words the voice says, figures read out ("$20" is "twenty dollars"), so the budget does too.
  const spoken = wordCount(narrationOf(script));
  const extra = Math.max(0, spoken - words);
  const lo = Math.max((opts.wordsMin ?? 0) - extra, Math.round(words * 0.9));
  const hi = Math.min(
    (opts.wordsMax ?? Infinity) - extra - 2,
    Math.round(words * 1.1),
  );
  const notes = [
    `This is a news Short. Edit the beats, the take and the loop line; the hook is fixed and can't be edited.`,
    `Keep each beat saying what it said: its card is on screen with it. Ask no questions in the beats or the take${opts.segment ? ` (the verdict's own "My verdict?" is fine)` : ""}, and keep "you" wherever a fact really lands on the viewer.`,
    script.is_rumour
      ? `This story is a rumor: every label and the reporter's name stay, and the take treats it as unconfirmed.`
      : "",
    opts.segment
      ? `The take ends on the Pulse Check, said out loud as a plain verdict: its last sentence starts "My verdict:" and says in everyday words what the viewer should do or think, in at most 12 words. Keep it last and keep its meaning (the card reads "${script.pulse_take.on_screen}"). Never say "Pulse check" or a reading word (strong, steady, weak, faint) aloud: the card carries them.`
      : "",
    script.stamp?.word
      ? `The word "${script.stamp.word}" carries an on-screen stamp, so it stays spoken exactly as written.`
      : "",
    opts.endStatement
      ? `The loop line stays one statement, never a question, with its meaning as it is. If it only makes sense to the writer (a quip with no clear link to the line before), say the Short's point plainly instead.`
      : `The loop line stays one complete closing sentence with its meaning as it is.`,
    opts.recent && (opts.recent.takes.length || opts.recent.loops.length)
      ? `Recent Shorts' takes opened and closed like this; open the take and end the loop line differently:\n${[
          ...opts.recent.takes.map((t) => `- take opened "${t}"`),
          ...opts.recent.loops.map((l) => `- closed "${l}"`),
        ].join("\n")}`
      : "",
    `Delivery tags: one to three in the whole Short, on the joke, the groans and the good news. A laugh or chuckle goes right after the line that earns it, never in front of a plain fact.`,
    `Length is a hard limit, because a Short runs 25-40 seconds: the original has ${words} written words and yours must have ${lo}-${hi}, so your edits together add at most ${Math.max(0, hi - words)} words${words > lo ? ` or remove at most ${words - lo}` : ""} (tags don't count). Pay for a take or an aside by trimming a restatement or a weak clause, or by merging two short facts, or by cutting a line that doesn't follow. Never pad with an idiom or a stock line ("the writing was on the wall", "at the end of the day"): every word you add makes the point clearer, or it is the take.`,
  ].filter(Boolean);
  const lines: Record<string, string> = {};
  const view: Record<string, unknown> = {
    hook: { text: toBraces(texts[0]!), editable: false },
  };
  script.beats.forEach((b, i) => {
    const t = texts[i + 1]!;
    lines[`beat_${i + 1}`] = t;
    view[`beat_${i + 1}`] = {
      narration: toBraces(t),
      words: wordsIn(t),
      card_on_screen: [b.visual.kind, b.visual.primary, b.visual.secondary]
        .filter(Boolean)
        .join(" | "),
    };
  });
  for (const [k, t] of [
    ["pulse_take", texts[script.beats.length + 1]!],
    ["loop_line", texts[script.beats.length + 2]!],
  ] as const) {
    lines[k] = t;
    view[k] = { narration: toBraces(t), words: wordsIn(t) };
  }
  const first = await editLines(llm, {
    site: "friend.short",
    tier: opts.tier ?? "mid",
    effort: "medium",
    notes,
    lines,
    view,
  });
  const hookMarks = extractVoiceTags(texts[0]!).marks;
  const { voice_tags: _old, ...rest } = script;
  const build = (r: {
    lines: Record<string, string>;
    marks: VoiceTagMark[];
  }): Script => {
    const line = (key: string) => {
      const t = r.lines[key];
      if (!t?.trim()) throw new Error(`the friend pass left ${key} empty`);
      return t;
    };
    // The hook's own tags stand; everything else carries the pass's tags.
    const marks = [...hookMarks, ...r.marks];
    return {
      ...rest,
      beats: script.beats.map((b, i) => ({
        ...b,
        narration: line(`beat_${i + 1}`),
      })),
      pulse_take: { ...script.pulse_take, narration: line("pulse_take") },
      loop_line: line("loop_line"),
      ...(marks.length ? { voice_tags: marks } : {}),
    };
  };
  const draft = build(first);
  // The mid model adds a take and an aside well and counts badly: a version over the limit gets one trim, by edits,
  // on what it wrote (cheaper than a model that thinks about every word, 11 Nov 2026 tuning runs).
  const over = Math.max(
    wordCount(narrationOf(draft)) - ((opts.wordsMax ?? Infinity) - 1),
    wordsIn(shortText(draft)) - Math.round(words * 1.12),
  );
  if (over <= 0) return draft;
  const trimView: Record<string, unknown> = {
    hook: { text: toBraces(texts[0]!), editable: false },
  };
  for (const [k, t] of Object.entries(first.braced))
    trimView[k] = {
      narration: t,
      words: wordsIn(stripVoiceTags(fromBraces(t))),
    };
  const trimmed = await editLines(llm, {
    site: "friend.short",
    tier: opts.tier ?? "mid",
    effort: "high",
    notes: [
      `This news Short has just had its delivery made more personal, and it now runs ${over} words over its limit. Cut at least ${over + 2} words with edits, and change nothing else. The surest cut is a whole sentence: drop the weakest one that carries no fact, then restatements, filler and weak clauses; keep the narrator's take, every fact, figure, name and quotation, the point said plainly, the closing verdict and the loop line's meaning. Keep the delivery tags where they are unless their sentence goes.`,
      script.stamp?.word ? `The word "${script.stamp.word}" stays spoken.` : "",
    ].filter(Boolean),
    lines: first.braced,
    view: trimView,
  });
  return build(trimmed);
}

/** What a Short's delivery pass broke (pure): the guard before the writers' checks and the fact check. */
export function friendShortProblems(
  before: Script,
  after: Script,
  opts: { wordsMin?: number; wordsMax?: number } = {},
): string[] {
  const b = shortText(before);
  const a = shortText(after);
  const p = factDrift(b, a);
  if (after.hook !== before.hook) p.push(`The rewrite changed the hook.`);
  if (after.beats.length !== before.beats.length)
    p.push(`The rewrite changed the number of beats.`);
  if (/[{}[\]]/.test(a))
    p.push(`The rewrite left a bracket or an unknown cue in the narration.`);
  p.push(...lengthProblem(b, a));
  const n = wordCount(narrationOf(after));
  if (
    (opts.wordsMin !== undefined && n < opts.wordsMin) ||
    (opts.wordsMax !== undefined && n > opts.wordsMax)
  )
    p.push(
      `The rewrite runs ${n} words, outside ${opts.wordsMin}-${opts.wordsMax}.`,
    );
  const reading = pulseCheckReading(before.pulse_take.narration);
  if (reading && pulseCheckReading(after.pulse_take.narration) !== reading)
    p.push(`The rewrite lost the Pulse Check's reading "${reading}".`);
  if (
    pulseVerdict(before.pulse_take.narration) &&
    !pulseVerdict(after.pulse_take.narration)
  )
    p.push(`The rewrite lost the take's closing verdict ("My verdict: ...").`);
  if (
    before.stamp?.word &&
    !a
      .toLowerCase()
      .includes(before.stamp.word.toLowerCase().replace(/[.,!?]$/, ""))
  )
    p.push(
      `The rewrite no longer says the stamp's word "${before.stamp.word}".`,
    );
  const tags = (after.voice_tags ?? []).length;
  const most = tagLimit(sentencesIn(a).length);
  if (tags > most)
    p.push(
      `The rewrite carries ${tags} delivery tags; ${most} at most in this Short.`,
    );
  return p;
}

// ---------------------------------------------------------------- documentary chapters

/** A chapter's narration as one text. */
export function chapterText(c: Pick<DocChapter, "paragraphs">): string {
  return c.paragraphs.map((x) => x.narration).join(" ");
}

/** The delivery pass on a fact-checked documentary chapter: one mid-model call; callouts and footage stay. */
export async function friendChapter(
  llm: Llm,
  chapter: DocChapter & { voice_tags?: VoiceTagMark[] },
  opts: {
    tier?: Tier;
    /** The credits that still repeat across the video (src/editorial/attribution.ts): the pass rewords these. */
    credits?: string[];
  } = {},
): Promise<DocChapter & { voice_tags?: VoiceTagMark[] }> {
  const texts = voiceTexts(
    chapter.paragraphs.map((x) => x.narration),
    chapter.voice_tags,
  );
  const sentences = sentencesIn(chapterText(chapter)).length;
  const words = wordsIn(chapterText(chapter));
  const notes = [
    `This is one chapter of a long documentary, told by someone who knows the whole story and cares about it. Edit the paragraphs; each keeps telling what it told (its on-screen callout and footage stay with it).`,
    `Across the chapter: the judgement goes in plain verdict words on the decisions ("a reckless bet"), and the narrator steps forward as "I" once, for the one take the chapter turns on, never more than once per hundred words; where the chapter stacks "I think" and "honestly", take some out. At most one dry aside, two in a long chapter, and only where it follows straight from the line before and a viewer gets it with no context; cut any line a listener would have to decode (a metaphor, a pun, a quip about something not said). Every sentence follows from the one before. The chapter's last sentence keeps its job (a look ahead or a plain consequence). Where the chapter already has its take, change little.`,
    `Delivery tags: at most ${tagLimit(sentences, CHAPTER_TAGS_MOST)} in the chapter, at least four sentences apart.`,
    `Length: the chapter has ${words} words; your edits together add or remove at most ${Math.round(words * 0.1)}.`,
    ...(opts.credits?.length
      ? [
          `Credits that repeat across the video, reword these here (Credits above):\n${opts.credits.map((c) => `- ${c}`).join("\n")}`,
        ]
      : []),
  ];
  const lines: Record<string, string> = {};
  const view: Record<string, unknown> = {};
  texts.forEach((t, i) => {
    lines[`paragraph_${i + 1}`] = t;
    view[`paragraph_${i + 1}`] = toBraces(t);
  });
  const r = await editLines(llm, {
    site: "friend.doc",
    tier: opts.tier ?? "mid",
    effort: "medium",
    notes,
    lines,
    view,
  });
  const { voice_tags: _old, ...rest } = chapter;
  return {
    ...rest,
    paragraphs: chapter.paragraphs.map((x, i) => ({
      ...x,
      narration: r.lines[`paragraph_${i + 1}`] ?? "",
    })),
    ...(r.marks.length ? { voice_tags: r.marks } : {}),
  };
}

/** What a chapter's delivery pass broke (pure). */
export function friendChapterProblems(
  before: DocChapter & { voice_tags?: VoiceTagMark[] },
  after: DocChapter & { voice_tags?: VoiceTagMark[] },
): string[] {
  const b = chapterText(before);
  const a = chapterText(after);
  const p = factDrift(b, a);
  if (after.paragraphs.length !== before.paragraphs.length)
    p.push(`The rewrite changed the number of paragraphs.`);
  after.paragraphs.forEach((x, i) => {
    if (!x.narration.trim())
      p.push(`The rewrite left paragraph ${i + 1} empty.`);
  });
  p.push(...lengthProblem(b, a));
  p.push(
    ...newProblems(
      writingProblems(b, { long: true }),
      writingProblems(a, { long: true }),
    ),
  );
  const tags = (after.voice_tags ?? []).length;
  const most = tagLimit(sentencesIn(a).length, CHAPTER_TAGS_MOST);
  if (tags > most)
    p.push(
      `The rewrite carries ${tags} delivery tags; ${most} at most in this chapter.`,
    );
  return p;
}

// ---------------------------------------------------------------- the fact check's verdict on the pass

const flat = (t: string) =>
  stripVoiceTags(t)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9$%€£']+/g, " ")
    .trim();

/**
 * The fact check's verdict on a friend version, judged on what the pass changed (pure). A blocker quoting a line
 * that stands word for word in the settled script (`beforeText`: its spoken narration, cards, title and
 * description) was already passed by the check that settled it, and the checker reads the same line differently
 * on another day; it never throws away the pass, and in the kept check it is marked minor with that note. Blockers
 * on new or changed words, a failed rumor-labelling check or a fail with no blocker at all stop the pass.
 */
export function friendCheckVerdict(
  check: FactCheck,
  beforeText: string,
): { blockers: string[]; check: FactCheck } {
  const hay = ` ${flat(beforeText)} `;
  const unchanged = (q: string) => !!flat(q) && hay.includes(` ${flat(q)} `);
  const issues = check.issues.map((i) =>
    i.severity === "blocker" && unchanged(i.quote)
      ? {
          ...i,
          severity: "minor" as const,
          problem: `${i.problem} (unchanged by the friend pass; the settled script's check passed this line)`,
        }
      : i,
  );
  const blockers = issues
    .filter((i) => i.severity === "blocker")
    .map((i) => `"${i.quote}" - ${i.problem}`);
  const failedOnlyOnOld =
    check.verdict === "fail" &&
    !blockers.length &&
    check.issues.some((i) => i.severity === "blocker");
  if (check.verdict === "fail" && !blockers.length && !failedOnlyOnOld)
    blockers.push("the fact check failed without naming a line");
  if (!check.rumour_labelling_ok) blockers.push("rumor labelling");
  return {
    blockers,
    check: {
      ...check,
      issues,
      verdict: blockers.length ? "fail" : "pass",
    },
  };
}

/** Everything the settled Short says, spoken and on screen, the way the fact check is shown it (for friendCheckVerdict). */
export function shortSettledText(s: Script): string {
  return [
    narrationOf(s),
    s.headline,
    ...s.beats.flatMap((b) => [
      b.visual.primary,
      b.visual.secondary,
      ...(b.visual.items ?? []),
    ]),
    s.pulse_take.on_screen,
    s.youtube.title,
    s.youtube.description,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------- adopt or keep

export interface FriendOutcome<T> {
  value: T;
  /** True when the rewrite went through every check and replaced the original. */
  kept: boolean;
  /** Why the original stands, when it does. */
  why: string[];
}

/**
 * Write the friend version, guard it, fact-check it, and keep it only when all three pass; the original otherwise.
 * Never throws: a failed rewrite or check leaves the settled script as it was.
 */
export async function friendPass<T>(o: {
  before: T;
  write: () => Promise<T>;
  /** Deterministic problems with the rewrite: drift, the writers' own checks. Empty means it may go to the fact check. */
  guard: (after: T) => string[];
  /** The fact check's blockers for the rewrite. Empty means it passed. */
  check: (after: T) => Promise<string[]>;
}): Promise<FriendOutcome<T>> {
  let after: T;
  try {
    after = await o.write();
  } catch (err) {
    return {
      value: o.before,
      kept: false,
      why: [`the rewrite failed: ${errorMessage(err)}`],
    };
  }
  const guard = o.guard(after);
  if (guard.length) return { value: o.before, kept: false, why: guard };
  let blockers: string[];
  try {
    blockers = await o.check(after);
  } catch (err) {
    return {
      value: o.before,
      kept: false,
      why: [`the fact check could not run: ${errorMessage(err)}`],
    };
  }
  if (blockers.length)
    return {
      value: o.before,
      kept: false,
      why: blockers.map((b) => `fact check: ${b}`),
    };
  return { value: after, kept: true, why: [] };
}

/** First-person lines, jokes and tags a narration carries, for the before/after counts and the event log. */
export function voiceCounts(
  text: string,
  tags: number,
): { i: number; tags: number } {
  const i = sentencesIn(outsideQuotes(stripVoiceTags(text))).filter(
    (s) => /\bI(?:'m|'d|'ll|'ve|’m|’d|’ll|’ve)?\b/.test(s) && !/^I$/.test(s),
  ).length;
  return { i, tags };
}
