// The long-video rules from the Inspiration study (reports/Inspiration playlist forensics.md, 4 Nov 2026), each behind
// its own setting and all off by default. What the four hits did and our long videos do not: talk to the viewer (40
// "you" per 1,000 words against Vice City's 3), keep sentences short (12.5 words against Halo's 19.6), stack the
// hook with named surprises and pay each one, and sort claims into confirmed, reported and busted.
//
// Every check here is pure and reads the script as written. A miss costs at most one revision: the writer sees its
// draft and the problem once (src/editorial/revise.ts), and what still misses is logged as a style warning, never a
// stopped video. Nothing here decides a fact: the fact check (documentary.ts checkChapter) still reads every revision.

import { z } from "zod";
import { findPayoff, loopMatch, loopTokens } from "./openloops.ts";
import { outsideQuotes, sentencesIn } from "./voice.ts";

/** The settings the rules read (a slice of src/config.ts Config). */
export interface LongRuleSettings {
  longYouPer1000: number;
  guideYouPer1000: number;
  longSentenceGate: number;
  longHookStack: number;
  /** LONG_HOOK_YOU_MIN: the least "you" words in the opening itself (0: not measured). */
  longHookYouMin?: number;
  longOpenLoopsMax: number;
  loopNamePayoff: boolean;
  longVerdictStamps: boolean;
  longGuideFormat: boolean;
  guideChapterAction: boolean;
}

export type LongRuleKind = "documentary" | "guide" | "ranking" | "explained";

/** What one long video gets. A zero or false means that rule is off and the writer's brief is as it was. */
export interface LongRules {
  kind: LongRuleKind;
  /** Least "you" family words per 1,000 across the script (0: not measured). */
  youFloor: number;
  /** The most the mean sentence may run, in words (0: not measured). */
  sentenceGate: number;
  /** The most named surprises in the hook (0: the older opening). */
  hookStack: number;
  /** The least "you" family words in the opening (0: not measured). The whole-video floor cannot see a cold first minute. */
  hookYouMin: number;
  /** The most open loops this format plans (0: the documentary default, and rankings none). */
  loopsMax: number;
  /** A payoff says out loud that it is the promise being kept. */
  namePayoff: boolean;
  /** Confirmed, reported, busted: spoken in the chapter and stamped on screen. */
  verdicts: boolean;
  /** Chapters follow the player's journey (a guide's own outline and chapter brief). */
  guide: boolean;
  /** Each guide chapter ends in a job for day one. */
  chapterAction: boolean;
}

/** A ranking plans fewer loops than a guide: its entries are short and its order is already a promise. */
export const RANKING_LOOPS_MAX = 3;
/** The hook stack's fewest surprises: GrandGecko named five, and two is only a list. */
export const HOOK_STACK_MIN = 3;
/** The most rule-led revisions in one video, so a writer that cannot reach a floor cannot run up a bill. */
export const LONG_RULE_REVISIONS = 3;

export const NO_LONG_RULES: LongRules = {
  kind: "documentary",
  youFloor: 0,
  sentenceGate: 0,
  hookStack: 0,
  hookYouMin: 0,
  loopsMax: 0,
  namePayoff: false,
  verdicts: false,
  guide: false,
  chapterAction: false,
};

/** The rules for one long video (pure). `guide` is a planned entry's own format; LONG_GUIDE_FORMAT must also be on. */
export function longRulesFor(
  cfg: LongRuleSettings,
  kind: Exclude<LongRuleKind, "guide">,
  guideEntry = false,
): LongRules {
  const guide = kind === "documentary" && guideEntry && cfg.longGuideFormat;
  const you = cfg.longYouPer1000;
  return {
    kind: guide ? "guide" : kind,
    youFloor: you > 0 ? (guide ? Math.max(you, cfg.guideYouPer1000) : you) : 0,
    // Rankings and guides inform; a documentary's scenes keep their own rhythm (Vice City is already 13.4).
    sentenceGate:
      kind === "ranking" || guide ? Math.max(0, cfg.longSentenceGate) : 0,
    hookStack: kind === "explained" ? 0 : Math.max(0, cfg.longHookStack),
    hookYouMin: Math.max(0, cfg.longHookYouMin ?? 0),
    loopsMax: guide
      ? Math.max(0, cfg.longOpenLoopsMax)
      : kind === "ranking"
        ? Math.min(RANKING_LOOPS_MAX, Math.max(0, cfg.longOpenLoopsMax))
        : 0,
    namePayoff: cfg.loopNamePayoff && kind !== "explained",
    verdicts: guide && cfg.longVerdictStamps,
    guide,
    chapterAction: guide && cfg.guideChapterAction,
  };
}

// ---------------------------------------------------------------- measures

const YOU = /\b(?:you(?:['’](?:re|ve|ll|d))?|yours?|yourself|yourselves)\b/gi;
const wordsIn = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** "You" family words per 1,000, outside quotations: a quoted person's "you" is not the narrator talking to you. */
export function youPer1000(text: string): number {
  const t = outsideQuotes(text);
  const n = wordsIn(t);
  return n ? (1000 * (t.match(YOU) ?? []).length) / n : 0;
}

export interface SentenceStats {
  count: number;
  mean: number;
  median: number;
  /** Share of sentences of six words or fewer, 0-1. */
  shortShare: number;
}

/** How long the sentences run, split the way the captions split them. */
export function sentenceStats(text: string): SentenceStats {
  const lens = sentencesIn(outsideQuotes(text))
    .map(wordsIn)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (!lens.length) return { count: 0, mean: 0, median: 0, shortShare: 0 };
  return {
    count: lens.length,
    mean: lens.reduce((a, b) => a + b, 0) / lens.length,
    median: lens[Math.floor(lens.length / 2)]!,
    shortShare: lens.filter((n) => n <= 6).length / lens.length,
  };
}

/** The script's measures, for the event log and the audit tool. */
export function scriptMeasures(text: string): {
  words: number;
  you: number;
  sentenceMean: number;
  sentenceMedian: number;
  shortShare: number;
} {
  const st = sentenceStats(text);
  return {
    words: wordsIn(text),
    you: Math.round(youPer1000(text) * 10) / 10,
    sentenceMean: Math.round(st.mean * 10) / 10,
    sentenceMedian: st.median,
    shortShare: Math.round(st.shortShare * 1000) / 1000,
  };
}

// ---------------------------------------------------------------- "you"

/** The writer's line for LONG_YOU_PER_1000. */
export function youRule(floor: number): string {
  return `Talk to the viewer: at least ${floor} "you", "your" or "you're" per 1,000 spoken words across the whole video, about ${Math.ceil(floor / 10)} in every 100 words. Say what each fact means for the person watching: what you see, what you pay, what you'd do with it, what you'd have noticed. Second person belongs to what a player experiences; history stays in the past tense, and the viewer was never in the room for it. Never tell the viewer what they personally did, own or feel as if it were a fact ("you bought it in 2001"); use "if you played it", "you can see it in", "here's what that means for you". Never give the narrator a life of its own: his "I" is only ever an opinion, never taxes, a cousin, memories or anything he did.`;
}

/**
 * What to tell the writer when the script so far falls short (pure). Earlier chapters count, so a scene-heavy chapter
 * can run low when the rest make up for it; a chapter already over the floor is never sent back, since revising it
 * would not help the total. Undefined: no revision.
 */
export function youShortfall(
  written: readonly string[],
  draft: string,
  floor: number,
): string | undefined {
  if (floor <= 0) return undefined;
  const so = youPer1000([...written, draft].join(" "));
  if (so >= floor) return undefined;
  const own = youPer1000(draft);
  if (own >= floor) return undefined;
  const need = Math.ceil(((floor - own) * wordsIn(draft)) / 1000);
  return `This draft says "you" about ${Math.round(own)} times per 1,000 words and the video needs ${floor}. Turn about ${need} more lines to the viewer: what they will see, pay or do, and what each fact means for them. Keep every fact exactly as it is and the length about the same; history stays in the past tense, and nothing claims what the viewer personally did.`;
}

// ---------------------------------------------------------------- sentence length

/** The writer's line for LONG_SENTENCE_GATE. Halo's 19.6 came partly from a brief asking for 3-5 sentences in 130-240 words. */
export function sentenceRule(gate: number): string {
  return `Short sentences: the mean across this narration stays under ${gate} words. One thought per sentence. Follow a long line with a short one, and let about one sentence in five run seven words or fewer. Never join two thoughts with "and" or a comma when a full stop works. Every line is still a full sentence with a verb.`;
}

/** The sentence count a narration of this many words needs to stay under the gate. */
export function sentencesFor(words: number, gate: number): number {
  return gate > 0 ? Math.ceil(words / Math.max(1, gate - 1)) : 0;
}

/** What to tell the writer when the script so far runs long (pure); the same rule as youShortfall. */
export function sentenceShortfall(
  written: readonly string[],
  draft: string,
  gate: number,
): string | undefined {
  if (gate <= 0) return undefined;
  const so = sentenceStats([...written, draft].join(" ")).mean;
  if (so < gate) return undefined;
  const own = sentenceStats(draft);
  if (own.mean < gate) return undefined;
  return `This draft's sentences average ${own.mean.toFixed(1)} words and the limit is under ${gate}. Split the longest ones at their joining words so it reads as about ${sentencesFor(wordsIn(draft), gate)} sentences. Keep every fact and about the same length.`;
}

// ---------------------------------------------------------------- the hook

export const HookStackSchema = z.object({
  stakes: z
    .string()
    .describe("The opening line's stakes for the viewer, as said in the intro"),
  surprises: z
    .array(
      z.object({
        tease: z
          .string()
          .describe("The surprise as the intro names it, under 16 words"),
        chapter: z
          .number()
          .int()
          .describe("The chapter (1 is the first) that pays it"),
      }),
    )
    .max(8),
  trust: z.string().describe("The trust line as said in the intro"),
  saved: z.object({
    tease: z
      .string()
      .describe("The one promise kept for the very end, as said in the intro"),
    chapter: z
      .number()
      .int()
      .describe("The last chapter's number, which pays it"),
  }),
});
export type HookStack = z.infer<typeof HookStackSchema>;

const DATE_IN_LINE =
  /\b(?:1[89]|20)\d\d\b|\b(?:January|February|March|April|June|July|August|September|October|November|December)\b/;

/** The writer's hook, when LONG_HOOK_STACK is on: it replaces the opening on a date. */
export function hookStackRule(count: number, what = "video"): string {
  const min = Math.min(HOOK_STACK_MIN, count);
  return `The opening is a stacked hook of about 60 seconds, in this order:
1. The stakes for you, in the first two sentences: what this ${what} means for the viewer's own money, time, habits or first evening with the game. No date or year in the first sentence, no greeting, no channel name.
2. ${min === count ? count : `${min} to ${count}`} named surprises, one sentence each, each a specific and concrete thing that a named later chapter really delivers. Name the thing and hold back how it turns out.
3. One trust line in plain words: where this comes from and what was checked. Never a claim to have played what we haven't.
4. One promise saved for the very end: a specific thing the viewer will only get in the last chapter. Say that it's coming last.
Then hand on to the first chapter. List them in "hook_stack": the stakes, each surprise with the chapter that pays it, the trust line, and the saved promise with the last chapter's number.`;
}

/**
 * The opening's own "you" count (pure). 5 Nov 2026: with the hook stack on, a Vice City rewrite passed every check on 4
 * "you" in its first 165 words, where GrandGecko has 13 by 60 s. Every family word outside quotations counts.
 */
export function hookYouProblems(intro: string, least: number): string[] {
  if (least <= 0) return [];
  const n = (outsideQuotes(intro).match(YOU) ?? []).length;
  return n >= least
    ? []
    : [
        `The opening says "you" ${n} times and needs at least ${least}. Turn the surprises and the promise to the viewer: what you will see, pay, assume or get wrong.`,
      ];
}

/** A hook's problems as instructions a rewrite can follow (pure). `chapters` are the chapters' narrations in order. */
export function hookStackProblems(
  intro: string,
  stack: HookStack | undefined,
  count: number,
  chapters: readonly string[],
  /** A cold open's last words, for a saved promise paid in the outro itself. */
  outro = "",
): string[] {
  if (count <= 0) return [];
  const p: string[] = [];
  const lines = sentencesIn(intro);
  const first = lines[0] ?? "";
  if (DATE_IN_LINE.test(first))
    p.push(
      `The first sentence opens on a date ("${first.split(/\s+/).slice(0, 8).join(" ")}..."); open on the stakes for the viewer and leave dates for later.`,
    );
  if (youPer1000(lines.slice(0, 2).join(" ")) === 0)
    p.push(
      `The first two sentences never say "you"; open on what this means for the viewer.`,
    );
  if (!stack) {
    p.push(
      `Fill "hook_stack": the stakes, the named surprises with the chapters that pay them, the trust line and the promise saved for the end.`,
    );
    return p;
  }
  const min = Math.min(HOOK_STACK_MIN, count);
  if (stack.surprises.length < min || stack.surprises.length > count)
    p.push(
      `The hook names ${stack.surprises.length} surprises; it must name ${min === count ? count : `${min} to ${count}`}.`,
    );
  const said = (x: string) => {
    const q = loopTokens(x);
    const hay = loopTokens(intro);
    const shared = [...q].filter((t) => hay.has(t)).length;
    return shared >= Math.max(1, Math.ceil(q.size * 0.4));
  };
  for (const s of stack.surprises) {
    if (!said(s.tease))
      p.push(
        `The surprise "${s.tease}" is listed but the intro never says it.`,
      );
    const text = chapters[s.chapter - 1];
    if (!text || !loopMatch(s.tease, text))
      p.push(
        `The surprise "${s.tease}" names chapter ${s.chapter}, which doesn't pay it; use a surprise a later chapter really delivers, and its right number.`,
      );
  }
  if (!stack.trust.trim() || !said(stack.trust))
    p.push(
      `The intro needs one plain line on where this comes from and what was checked.`,
    );
  if (/\b(we|i)(?:'ve| have)? (played|tested|tried)\b/i.test(stack.trust))
    p.push(
      `The trust line claims hands-on play; say what was checked, not what was played.`,
    );
  if (!stack.saved.tease.trim() || !said(stack.saved.tease))
    p.push(`The intro needs one specific promise saved for the very end.`);
  else {
    const last = [chapters.at(-1) ?? "", outro].join(" ");
    if (!loopMatch(stack.saved.tease, last))
      p.push(
        `The promise saved for the end, "${stack.saved.tease}", isn't paid in the last chapter or the outro; promise something that is.`,
      );
  }
  return p;
}

// ---------------------------------------------------------------- open loops, paid out loud

/** The writer's line for LOOP_NAME_PAYOFF. */
export const LOOP_NAME_RULE = `When a chapter answers a question raised earlier, say out loud that this is the promise being kept, in fresh words each time ("that's the map number from the start", "remember the habit we said would cost you"). It teaches the viewer that the promises here are real.`;

const CALLS_BACK =
  /\b(earlier|remember|promis\w*|at the start|from the start|from the top|back at the top|we (said|told you|asked|mentioned|left you)|left you with|as we said|the (question|number|thing|habit|claim|surprise) (from|we|you)|that's the (one|question|number|thing|habit|claim)|here's the (answer|payoff)|finally)\b/i;

/** Whether a payoff sentence, or a line touching it, says that a promise is being kept (pure). */
export function saysPayoff(sentences: readonly string[], at: number): boolean {
  return [at - 1, at, at + 1].some(
    (i) => i >= 0 && i < sentences.length && CALLS_BACK.test(sentences[i]!),
  );
}

// ---------------------------------------------------------------- verdicts

export const VERDICT_WORDS = ["CONFIRMED", "REPORTED", "BUSTED"] as const;
export type VerdictWord = (typeof VERDICT_WORDS)[number];

/**
 * The ladder, spoken. It sits on top of the rumour rule and never loosens it: nothing leaked or datamined gets a
 * verdict at all, a rumour can only ever be "reported", and "confirmed" needs the publisher's or platform's own word.
 */
export const VERDICT_RULE = `Verdicts: give each claim one of three words out loud, with who said it in the same breath.
- "Confirmed" only when the publisher or the platform said it themselves and the SOURCE shows that ("Rockstar's own page confirms it").
- "Reported" when a named outlet or person says so and the publisher hasn't: say "reportedly" or "according to" and name them. It stays reported to the end of the video; never upgrade it in a later line.
- "Busted" only when the SOURCE shows the claim is false or came from fans, not from the publisher ("that number is a fan estimate; Rockstar has never given one"). A thing nobody has confirmed yet isn't busted; it's "not confirmed".
Leaked builds, stolen footage and datamined files get no verdict and no airtime as evidence: never describe what they showed. Teach the three words in the hook, in one line, before the first chapter.`;

/** The picture editor's line: the stamp lands on the sentence that speaks the verdict. */
export const VERDICT_STAMP_RULE = `- verdict: when a sentence gives a claim its verdict out loud, stamp it. primary is exactly CONFIRMED, REPORTED or BUSTED, the same word the sentence uses; secondary is who said it, 1-4 words, as the sentence names them. Use it on every sentence that speaks a verdict, and never on one that doesn't.`;

const SAYS: Record<VerdictWord, RegExp> = {
  CONFIRMED: /\bconfirm(?:s|ed|ing)?\b/i,
  REPORTED: /\breport(?:s|ed|edly|ing)?\b|\baccording to\b/i,
  BUSTED:
    /\bbust(?:s|ed)?\b|\bfan estimate\b|\bnever (?:said|gave|given|confirmed|announced)\b|\bisn['’]t true\b|\bnot true\b|\bfalse\b/i,
};
// Whose word counts as confirmation: the publisher, the platform or their own named people.
const OFFICIAL =
  /\b(rockstar|take-two|take two|zelnick|sony|playstation|microsoft|xbox|nintendo|steam|valve|official)\b/i;
const OFF_LIMITS =
  /\b(leak\w*|datamin\w*|stolen|hack(?:ed|er|ers)?|insiders?)\b/i;
const UNCONFIRMED =
  /\b(rumou?r\w*|unconfirmed|not confirmed|hasn['’]t confirmed|hasn['’]t said|hasn['’]t announced)\b/i;

/**
 * Why a verdict stamp may not go on this sentence (pure); empty when it may. `hay` is the source's normalised text, so
 * a stamp credits only someone the source names. A failed stamp comes off the screen and the sentence keeps its
 * picture: this can only ever remove a claim of certainty, never add one.
 */
export function verdictProblem(
  g: { primary: string; secondary: string },
  sentence: string,
  hay: string,
): string {
  const word = g.primary.trim().toUpperCase() as VerdictWord;
  if (!VERDICT_WORDS.includes(word)) return `"${g.primary}" is not a verdict`;
  if (!SAYS[word].test(sentence)) return `the sentence doesn't say ${word}`;
  if (OFF_LIMITS.test(sentence) && word !== "BUSTED")
    return `${word} on a line about a leak`;
  if (word === "CONFIRMED") {
    if (UNCONFIRMED.test(sentence)) return "CONFIRMED on an unconfirmed claim";
    if (!OFFICIAL.test(sentence))
      return "CONFIRMED with no official source named in the sentence";
  }
  const who = g.secondary.trim();
  if (word !== "BUSTED") {
    if (!who) return `${word} with nobody named`;
    const flat = (t: string) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    if (!flat(sentence).includes(flat(who)))
      return `"${who}" isn't in the sentence`;
    if (!flat(hay).includes(flat(who))) return `"${who}" isn't in the source`;
  }
  return "";
}

/** A guide's hook teaches the three words before the first chapter (pure). */
export function verdictHookProblems(intro: string): string[] {
  return VERDICT_WORDS.filter((w) => !SAYS[w].test(intro)).length
    ? [
        `The hook must teach the three verdicts in one line: say the words "confirmed", "reported" and "busted".`,
      ]
    : [];
}

// ---------------------------------------------------------------- the guide

/** The outline's brief for a guide (LONG_GUIDE_FORMAT): the viewer's own first day, not a history. */
export const GUIDE_OUTLINE_RULE = `Plan a launch guide told as the viewer's own first day with the game, not a history, 7-10 chapters in the order a player meets things: buying it and getting it installed, where you are, who you are, how you get caught, how you get paid, how you get around, what's not there on day one, and finally what's false. Give the longest chapter to the biggest change from what players are used to. Chapter titles name what the player is dealing with in 2-5 plain words a viewer would search for ("The New Police", "Getting Paid"). Each chapter's "game_title" is the game itself and "wiki_title" is the article that best documents that part (often the game's own article). "focus" says what the viewer needs to know and the one job it gives them. The YouTube title and the question are about what the viewer can rely on, not the game's past. Never promise "everything".`;

/** A guide chapter's brief, replacing the franchise documentary's scene-first chapter shape. */
export function guideChapterShape(action: boolean): string {
  return `This is one chapter of a launch guide told as the viewer's own first day with the game. Open on what the viewer will be doing at this point, not on a year or a scene from the past, and explain each new system as a change from a habit they already have, naming the earlier game it differs from. Lead with what's known, then how sure we are. No dates unless the date is the point. Never claim to have played it, tested it or seen it first hand.${
    action
      ? ` The chapter's last two sentences do two jobs: the first gives one specific job to do on day one ("before you start the first mission, set..."), and the last asks for the next chapter, in words that make it the obvious next question. Never "In the next chapter".`
      : ""
  }`;
}

const JOB =
  /\b(day one|first day|before you|when you|as soon as you|once you|on launch|your first)\b|^(?:so |then |just |now )?(?:do|don['’]t|make|set|check|keep|save|bank|clear|start|turn|put|pick|buy|skip|wait|plan|try|leave|grab|get|take|look|remember)\b/i;

/** Whether a guide chapter closes on a job to do (pure): one of its last two sentences gives one. */
export function guideActionProblems(narration: string): string[] {
  const end = sentencesIn(outsideQuotes(narration)).slice(-2);
  return end.some((x) => JOB.test(x))
    ? []
    : [
        `The chapter must close on one specific job for day one, in its last two sentences ("before you start the first mission, set..."), then ask for the next chapter.`,
      ];
}

/** Everything that misses at the end of a finished script, for the style warnings and the event log (pure). */
export function longRuleWarnings(text: string, r: LongRules): string[] {
  const m = scriptMeasures(text);
  const out: string[] = [];
  if (r.youFloor > 0 && m.you < r.youFloor)
    out.push(`"You" ${m.you} per 1,000 words, under the ${r.youFloor} target.`);
  if (r.sentenceGate > 0 && m.sentenceMean >= r.sentenceGate)
    out.push(
      `Sentences average ${m.sentenceMean} words, over the ${r.sentenceGate} limit.`,
    );
  return out;
}

/** Whether any rule is on: off, the writers run exactly as they did. */
export function longRulesOn(r: LongRules): boolean {
  return Boolean(
    r.youFloor ||
      r.sentenceGate ||
      r.hookStack ||
      r.loopsMax ||
      r.namePayoff ||
      r.verdicts ||
      r.guide ||
      r.chapterAction,
  );
}

/** A loop answered in this chapter whose answer never says it's the promise being kept (pure). */
export function namedPayoffProblems(
  sentences: readonly string[],
  loops: ReadonlyArray<{
    question: string;
    plant_chapter: number;
    payoff_chapter: number;
  }>,
  chapter: number,
): string[] {
  const p: string[] = [];
  for (const l of loops) {
    if (l.payoff_chapter !== chapter) continue;
    const at = findPayoff(l.question, sentences);
    if (at >= 0 && !saysPayoff(sentences, at))
      p.push(
        `When you answer "${l.question}", say out loud that this is the promise being kept, in fresh words ("that's the number from the start").`,
      );
  }
  return p;
}

// A writer that finds its source too thin may answer with a note to its editor instead of narration. On the FFXIV
// documentary (4 Nov 2026) three rejected drafts ended in one, and it was voiced: "These paragraphs flag the missing
// evidence. They aren't a finished documentary chapter."
const WRITER_NOTE =
  /\b(supplied (?:source|excerpt|text)|(?:the|this) excerpt\b|your source rule|(?:the|this) brief\b|please provide|shouldn['’]t be (?:recorded|published)|aren['’]t a finished|isn['’]t a finished|unsupported here|the requested (?:scene|chapter)|the omitted|as an ai\b|i (?:can['’]t|cannot) write)/i;

/** A chapter that talks about its brief instead of the story (pure): nothing here is narration. */
export function writerNoteProblems(text: string): string[] {
  const hit = outsideQuotes(text).match(WRITER_NOTE);
  return hit
    ? [
        `"${hit[0]}" is a note about the brief, not narration: this is spoken to viewers. Tell the story the SOURCE does support and leave out the rest, with no mention of the source, the brief or what's missing.`,
      ]
    : [];
}
