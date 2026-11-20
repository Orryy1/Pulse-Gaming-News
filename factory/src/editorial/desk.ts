// The script editor's desk (top creator gap plan, writer check, 18 Nov 2026). Blind judges scored 24 published Pulse
// scripts at 3.9 out of 10. An editor's loop run by hand on the same stories, with only the facts already in them
// (state the angle, draft, judge harshly, rewrite the single biggest weakness, up to two rounds, kill stories that
// cannot carry a Short), took them to 6.9: 23 of 24 improved and 14 of 24 reached 7 or more, against 5.25 for the
// transcripts of 12 breakout human Shorts. This is that loop inside the factory, for news, breaking and Why Shorts:
//   1. angle: the writer states, in its own call, "The most interesting true thing is X, and it matters to Y because
//      Z", the mode (reason held, or news in the hook with the verdict held) and whether the story can carry a Short
//      at all (absence, common knowledge, promotion or list); a key fact the payoff needs that the sources lack is
//      recorded as source_gap (advisory);
//   2. the editor's read ("desk.judge"): an independent read of the title, the first-frame text and the narration only,
//      never the writer's plan or the story pack, six scores 1-10 and one sentence on the biggest weakness;
//   3. deterministic checks (pure, below): banned lines, the full name over twice, a formula ending (advisory) and a
//      sentence that repeats a fact;
//   4. the rewrite ("desk.rewrite", fix mode): one instruction, the single biggest weakness, through the edit-based
//      reviser, the fact guard and the fact check, then read again; the best version that passed is kept;
//   5. kill: in fix mode a killed story takes the thin route; in check mode it is only recorded.
// "check" reads and records and changes nothing; "fix" rewrites. Everything here but judgeDesk and runDesk's injected
// steps is pure.

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { Script } from "./schema.ts";
import { VIDEO_PLUG } from "./shortrules.ts";
import { clarityShortProblems } from "./clarity.ts";
import {
  absenceAnswer,
  contentTokens,
  gameAliases,
  spokenSentences,
  type PayoffPlan,
} from "./payoff.ts";
import { stripVoiceTags } from "../voice/tags.ts";

/** The steps CODEX_CALLS can route ("desk" routes both). */
export const DESK_JUDGE_SITE = "desk.judge";
export const DESK_REWRITE_SITE = "desk.rewrite";
/** The overall score that clears the desk without a rewrite (SCRIPT_DESK_MIN overrides it). */
export const DESK_MIN = 7;
/** No single dimension may sit under this, whatever the overall. */
export const DESK_FLOOR = 5;
/** Rewrite rounds (SCRIPT_DESK_ROUNDS overrides it, at most DESK_ROUNDS_MAX). */
export const DESK_ROUNDS = 2;
export const DESK_ROUNDS_MAX = 3;

export type DeskMode = "off" | "check" | "fix";
export type DeskArm = "desk" | "control";

// ---------------------------------------------------------------- who it applies to

/** Which arm of the SCRIPT_DESK_SHARE split an episode is in (pure): the same id always lands the same way. */
export function deskArm(episodeId: string, share: number): DeskArm {
  if (share <= 0) return "control";
  if (share >= 1) return "desk";
  const n = createHash("sha1")
    .update(`script-desk:${episodeId}`)
    .digest()
    .readUInt16BE(0);
  return n / 65536 < share ? "desk" : "control";
}

/** The calls the desk may make on one Short (pure): one read per version, one rewrite per round. */
export function deskCaps(rounds: number): { judge: number; rewrite: number } {
  const r = Math.min(DESK_ROUNDS_MAX, Math.max(0, Math.round(rounds)));
  return { judge: r + 1, rewrite: r };
}

// ---------------------------------------------------------------- 1. the angle, in the writer's own call

export const DESK_KILLS = [
  "none",
  "absence",
  "common_knowledge",
  "promotion",
] as const;
export type DeskKill = (typeof DESK_KILLS)[number];

export const DeskPlanSchema = z.object({
  angle: z
    .string()
    .describe(
      'Decided before writing, one sentence in this shape: "The most interesting true thing is X, and it matters to Y because Z", from the sources alone',
    ),
  mode: z
    .enum(["reason", "verdict"])
    .describe(
      "reason: the Short holds back why it happened; verdict: the news itself is the draw, so the hook may say it and the narrator's verdict or the consequence for the player is held back",
    ),
  kill: z
    .enum(DESK_KILLS)
    .describe(
      "none, or why this story cannot carry a Short: absence (the only honest payoff is that the sources don't say), common_knowledge (the headline's answer is something most players already know), promotion (a promotion, a sale or a list with no question in it)",
    ),
  kill_reason: z
    .string()
    .describe(
      "Why, in one plain sentence when kill is not none; empty otherwise",
    ),
  source_gap: z
    .string()
    .describe(
      "A key fact the payoff depends on that the sources leave out, in a few words; empty when the sources have it",
    ),
});
export type DeskPlan = z.infer<typeof DeskPlanSchema>;

/** The writer's rule for a Short in the desk's arm: the angle first, in the same answer (one call, no extra cost). */
export function deskPlanRule(withPayoff = false): string {
  return `Editor's desk (fill "desk_plan" first, before you write a word of the script):
- angle: one sentence in this shape: "The most interesting true thing is X, and it matters to Y because Z". X is a fact from the sources, Y is a real group of players or buyers, Z is a reason the sources support. Every sentence of the Short serves that one sentence; a sentence that doesn't is cut.
- mode: "reason" when the Short holds back why it happened; "verdict" when the news itself is the draw, so the hook may say it and you hold back your verdict or what it means for the player.${withPayoff ? ' Your "payoff" plan takes the same angle and holds back the same thing.' : ""}
- kill: be honest about whether this story can carry a Short. "absence" when the only honest payoff is that the sources don't say; "common_knowledge" when the headline's answer is something most players already know; "promotion" when the story is a promotion, a sale or a list with no question in it. Otherwise "none". Write the full script either way, and give kill_reason in one plain sentence.
- source_gap: a key fact the payoff depends on that the sources leave out, in a few words, or empty. Never fill that gap yourself.`;
}

/** Whether the plan kills the story, and why (pure). A payoff whose answer is only an absence kills it too. */
export function deskKill(
  plan: DeskPlan | undefined,
  payoff?: Pick<PayoffPlan, "answer">,
): { kind: Exclude<DeskKill, "none">; why: string } | undefined {
  if (plan && plan.kill !== "none")
    return {
      kind: plan.kill,
      why: plan.kill_reason.trim() || KILL_WHY[plan.kill],
    };
  if (payoff?.answer && absenceAnswer(payoff.answer))
    return { kind: "absence", why: KILL_WHY.absence };
  return undefined;
}

const KILL_WHY: Record<Exclude<DeskKill, "none">, string> = {
  absence: "The only honest payoff is that the sources don't say.",
  common_knowledge:
    "The headline's answer is something most players already know.",
  promotion: "A promotion or a list with no question in it.",
};

// ---------------------------------------------------------------- 2. the editor's read

export const DESK_DIMENSIONS = [
  "clarity",
  "hook",
  "payoff",
  "voice",
  "human",
  "overall",
] as const;
export type DeskDimension = (typeof DESK_DIMENSIONS)[number];
export type DeskScores = Record<DeskDimension, number>;

/** The rubric the hand-run loop and both blind judges used, word for word. */
export const DESK_RUBRIC: Record<DeskDimension, string> = {
  clarity:
    "one plain point, easy to follow on one listen, no confusing or nonsensical lines",
  hook: "the first sentence opens a real question or surprise and makes you want the next line",
  payoff:
    "the script holds something back and pays it off late, instead of giving everything away at the start or just listing facts",
  voice:
    "sounds like a real person with a view talking to a friend, natural spoken rhythm, an honest opinion, humour only where it lands, not a news desk and not a try-hard",
  human:
    'free of AI tells: repeated full names, stiff connectives, stock phrases, forced "you", filler quips, formulaic endings',
  overall:
    "would a tough editor at a top human gaming Shorts channel publish it as it stands",
};

const score = (d: DeskDimension) =>
  z.number().int().min(1).max(10).describe(`${d}, 1 to 10: ${DESK_RUBRIC[d]}`);

export const DeskReadSchema = z.object({
  clarity: score("clarity"),
  hook: score("hook"),
  payoff: score("payoff"),
  voice: score("voice"),
  human: score("human"),
  overall: score("overall"),
  note: z
    .string()
    .describe(
      "One sentence naming the single biggest weakness, the one thing to fix first, quoting the line it is in",
    ),
});
export type DeskRead = z.infer<typeof DeskReadSchema>;

/** The editor's instructions. It never sees the writer's plan or the sources, so it reads as a viewer would. */
export function deskJudgePrompt(): string {
  return `You are a tough editor at a top human gaming Shorts channel. You get one Short as a viewer meets it: its title, the text on its first frame and its narration, heard once. You know nothing else about the story, the channel or what the writer meant. Score it on six dimensions, each from 1 to 10:

${DESK_DIMENSIONS.map((d) => `- ${d}: ${DESK_RUBRIC[d]}.`).join("\n")}

5 is average for a competent channel. Use the full range: 8 or more only for a script you would publish as it stands, 3 or less for one that confuses, bores or gives everything away. Don't reward length, and don't mark a fact down because you doubt it: judge only how it is written. Then give one sentence naming the single biggest weakness, the one thing to fix first, quoting the line it is in.`;
}

/** The editor's message: the three texts and nothing else. */
export function deskJudgeContent(o: {
  title: string;
  firstFrame: string;
  narration: string[];
}): string {
  const lines = o.narration
    .map((l) => stripVoiceTags(l).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return `TITLE: ${o.title.trim()}\nFIRST-FRAME TEXT: ${o.firstFrame.trim() || "(none)"}\nNARRATION (as heard, top to bottom):\n${lines}`;
}

/**
 * One read. On the mid tier, so the judge is not the writer (the top tier) marking its own homework. Throws when the
 * call fails; the desk then records the Short unread and changes nothing.
 */
export async function judgeDesk(
  llm: Llm,
  o: { title: string; firstFrame: string; narration: string[] },
): Promise<DeskRead> {
  return llm.structured({
    site: DESK_JUDGE_SITE,
    tier: "mid",
    effort: "medium",
    system: deskJudgePrompt(),
    content: deskJudgeContent(o),
    schema: DeskReadSchema,
  });
}

/** The six scores of a read (pure). */
export function scoresOf(r: DeskRead): DeskScores {
  return Object.fromEntries(
    DESK_DIMENSIONS.map((d) => [d, r[d]]),
  ) as DeskScores;
}

/** Whether a read clears the desk (pure): overall at the bar and no dimension under DESK_FLOOR. */
export function clearsDesk(r: DeskScores, min = DESK_MIN): boolean {
  return r.overall >= min && DESK_DIMENSIONS.every((d) => r[d] >= DESK_FLOOR);
}

/** Whether read a is better than read b (pure): clearing first, then overall, then the six together. */
export function betterRead(
  a: DeskScores,
  b: DeskScores,
  min = DESK_MIN,
): boolean {
  const key = (r: DeskScores) => [
    clearsDesk(r, min) ? 1 : 0,
    r.overall,
    DESK_DIMENSIONS.reduce((s, d) => s + r[d], 0),
  ];
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++)
    if (ka[i] !== kb[i]) return ka[i]! > kb[i]!;
  return false;
}

// ---------------------------------------------------------------- 3. deterministic editor checks

export const DESK_RULES = [
  "banned_line",
  "last_line_ask",
  "full_name",
  "formula_ending",
  "repeated_fact",
] as const;
export type DeskRule = (typeof DESK_RULES)[number];

export interface DeskFinding {
  rule: DeskRule;
  problem: string;
  /** Recorded and shown to the rewrite only when nothing firmer is wrong; never a reason on its own. */
  advisory?: boolean;
}

// Lines the hand-run loop cut every time. The Pulse Check's own lines are a segment's rule while NEWS_SEGMENT is on:
// then they are recorded as advisory and never sent to the rewrite (its house check would refuse the edit).
const BANNED: Array<{ re: RegExp; what: string; segment?: boolean }> = [
  { re: /\bpulse check\b/i, what: '"Pulse check"', segment: true },
  { re: /\bmy verdict\s*[:?]/i, what: '"My verdict:"', segment: true },
  {
    re: /\b(?:tomorrow brings another why|(?:tomorrow'?s|the next) why)\b/i,
    what: "a pointer to tomorrow's Why",
  },
  { re: /\blet (?:me|us) know\b/i, what: '"let me know"' },
];

const ASK =
  /\b(?:subscribe (?:for|to (?:the channel|pulse|us|me))|hit subscribe|comment (?:below|your|with)|in the comments|follow (?:for|us|me|pulse)|hit (?:like|the bell)|tell (?:me|us)|drop (?:a|your)|let (?:me|us) know|share (?:this|it))\b|^\W*(?:subscribe|comment|follow)\b/i;

/** The spoken text as sentences, a semicolon splitting a sentence into two clauses (pure). */
function clauses(text: string): string[] {
  return text
    .split(/;\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

const words = (t: string) =>
  stripVoiceTags(t).replace(/[“”"]/g, "").split(/\s+/).filter(Boolean);

const VERB =
  /\b(?:is|are|was|were|be|been|being|am|has|have|had|do|does|did|can|could|will|would|shall|should|may|might|must|gets?|got|makes?|made|goes|went|comes?|came|takes?|took|gives?|gave|says?|said|keeps?|kept|needs?|wants?|lets?|sells?|costs?|pays?|looks?|feels?|seems?|means?|ships?|launch(?:es)?|runs?|hits?|leads?|works?)\b|\w+'(?:s|re|ve|ll|d)\b|\w+n't\b|\w{3,}ed\b/i;

/** A verbless list of three ("A name, a province and no date") (pure). */
export function verblessThree(sentence: string): boolean {
  const t = stripVoiceTags(sentence)
    .trim()
    .replace(/[.!]+["”']?$/, "");
  if (/[?]/.test(t) || words(t).length > 14) return false;
  const parts = t
    .split(/,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 3 || parts.some((p) => words(p).length > 5))
    return false;
  return !VERB.test(t);
}

// Words a balanced pair of sentences turns on: a pronoun or a word both say ("sells you ... lets you").
const FRAME = new Set([
  "you",
  "your",
  "it",
  "its",
  "they",
  "their",
  "that",
  "this",
]);

/** Two short parallel sentences ("A trailer sells you the game. Footage lets you judge it.") (pure). */
export function parallelPair(a: string, b: string): boolean {
  const wa = words(a).map((w) => w.toLowerCase().replace(/[^a-z0-9$%']/g, ""));
  const wb = words(b).map((w) => w.toLowerCase().replace(/[^a-z0-9$%']/g, ""));
  if (!wa.length || !wb.length) return false;
  if (/\?\s*$/.test(a) || /\?\s*$/.test(b)) return false;
  if (wa.length > 10 || wb.length > 10) return false;
  if (Math.min(wa.length, wb.length) / Math.max(wa.length, wb.length) < 0.5)
    return false;
  // A first-person take is a person talking, not a balanced aphorism.
  if ([...wa, ...wb].some((w) => /^i(?:'d|'m|'ll)?$/.test(w))) return false;
  const plainStem = (w: string) =>
    w.replace(/'s$/, "").replace(/(?<=\w{3})s$/, "");
  const SKIP = new Set(["a", "an", "the", "and", "of", "to", "in", "on", "for", "is", "are", "be"]);
  const sa = new Set(wa.slice(1).filter((w) => !SKIP.has(w)).map(plainStem));
  const shared = wb.slice(1).filter((w) => !SKIP.has(w) && sa.has(plainStem(w)));
  const frames = wa.slice(1).filter((w) => FRAME.has(w) && wb.slice(1).includes(w));
  return shared.length > 0 || frames.length > 0;
}

/** The ending's shape (pure): a verbless list of three, or two short parallel sentences or clauses. */
export function formulaEnding(lines: string[]): string | undefined {
  const all = spokenSentences(lines).sentences.flatMap((s) => clauses(s.text));
  const last = all[all.length - 1];
  if (!last) return undefined;
  const before = all[all.length - 2];
  if (verblessThree(last)) return last;
  if (antithesis(last)) return last;
  if (before && parallelPair(before, last)) return `${before} ${last}`;
  // A verbless list just before a closing line is the same summary, one line early.
  if (before && verblessThree(before)) return before;
  return undefined;
}

/** A short closing antithesis: "That slide is Nintendo's problem, not your wallet's." (pure). */
export function antithesis(sentence: string): boolean {
  const t = stripVoiceTags(sentence).trim();
  return words(t).length <= 12 && /,\s+not\s+(?:\S+\s+){0,2}\S+[.!]["”']?$/i.test(t);
}

const NUMBER_WORD: Record<string, string> = {
  one: "1",
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
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
};

/** A name as plain words with its numerals as figures ("Grand Theft Auto VI" and "grand theft auto six" agree). */
function nameKey(t: string): string[] {
  return stripVoiceTags(t)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/'s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => NUMBER_WORD[w] ?? w);
}

/**
 * How often the game's full name is said (pure). Only a name of two words or more with a short form people use:
 * "Starfield" has no other form, and "GTA 6" is already the fan form.
 */
export function fullNameCount(lines: string[], game: string): number {
  const name = nameKey(game);
  const plain = name.filter((w) => !/^\d+$/.test(w));
  if (name.length < 2 || plain.length < 2) return 0;
  const said = nameKey(lines.join(" "));
  let n = 0;
  for (let i = 0; i + name.length <= said.length; i++)
    if (name.every((w, k) => said[i + k] === w)) {
      n++;
      i += name.length - 1;
    }
  return n;
}

/**
 * Sentences that repeat a fact already given (pure): most of a sentence's content words were said together in one
 * earlier sentence, or a figure comes round again with the words that went with it. The game's own name never counts.
 */
export function repeatedFacts(lines: string[], game = ""): string[] {
  const aliases = gameAliases(game);
  const sents = spokenSentences(lines).sentences.map((s) => ({
    text: s.text,
    toks: new Set(contentTokens(s.text).filter((t) => !aliases.has(t))),
  }));
  const out: string[] = [];
  sents.forEach((s, i) => {
    // A question restates the premise on purpose (the hook's question planted again before the answer).
    if (s.toks.size < 4 || /\?["”']?$/.test(s.text.trim())) return;
    for (const e of sents.slice(0, i)) {
      const shared = [...s.toks].filter((t) => e.toks.has(t));
      // A figure of two digits or more ("$499", "366gb", "96"); a year or a lone digit is too often part of a name.
      const figure = shared.some(
        (t) => /\d\d|[$%]/.test(t) && !/^(?:19|20)\d\d$/.test(t),
      );
      if (
        (shared.length >= 3 && shared.length / s.toks.size >= 0.6) ||
        (figure && shared.length >= 3)
      ) {
        out.push(s.text);
        return;
      }
    }
  });
  return out;
}

/** Every deterministic finding for one script (pure). `segment`: the Pulse Check is on for this Short. */
export function deskChecks(o: {
  lines: string[];
  game?: string;
  segment?: boolean;
}): DeskFinding[] {
  const out: DeskFinding[] = [];
  const text = o.lines.map((l) => stripVoiceTags(l)).join(" ");
  for (const b of BANNED)
    if (b.re.test(text))
      out.push({
        rule: "banned_line",
        problem: `Cut ${b.what}: it is a stock line a listener tunes out.`,
        ...(b.segment && o.segment ? { advisory: true } : {}),
      });
  const plug = text.match(VIDEO_PLUG);
  if (plug)
    out.push({
      rule: "banned_line",
      problem: `Cut the plug "${plug[0]}": the Short ends on its own point.`,
    });
  const sents = spokenSentences(o.lines).sentences;
  const last = sents[sents.length - 1]?.text ?? "";
  if (/\?["”']?\s*$/.test(last) || ASK.test(last))
    out.push({
      rule: "last_line_ask",
      problem: `The last line "${last}" is a question or an ask; end on a take or a punchline instead.`,
    });
  if (o.game) {
    const n = fullNameCount(o.lines, o.game);
    if (n > 2)
      out.push({
        rule: "full_name",
        problem: `"${o.game}" is said in full ${n} times; say it once, then the short name fans use.`,
      });
  }
  const formula = formulaEnding(o.lines);
  if (formula)
    out.push({
      rule: "formula_ending",
      advisory: true,
      problem: `The ending "${formula}" is a tidy formula (a list of three or a balanced pair); end on a take that follows from the line before and could not close any other Short.`,
    });
  for (const r of repeatedFacts(o.lines, o.game))
    out.push({
      rule: "repeated_fact",
      problem: `"${r}" repeats a fact already given; cut it or replace it with a new fact.`,
    });
  return out;
}

/** The spoken lines of a Short in order: hook, beats, take, loop line. */
export function deskLines(
  s: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
): string[] {
  return [
    s.hook,
    ...s.beats.map((b) => b.narration),
    s.pulse_take.narration,
    s.loop_line,
  ];
}

// ---------------------------------------------------------------- the fact guard on a rewrite

/**
 * The fact guard for a desk rewrite (pure): the clarity gate's (no figure, name or quotation added or changed, the beats,
 * the word limits, the verdict line and the stamp's word kept), except that cutting a sentence is allowed. The hand-run
 * loop deleted every sentence that did not serve the point, so a figure or a name dropped with it, or a shorter script,
 * is the edit working, not a fact moving. The fact check then reads the result.
 */
export function deskShortProblems(
  before: Script,
  after: Script,
  opts: { wordsMin?: number; wordsMax?: number } = {},
): string[] {
  return clarityShortProblems(before, after, opts).filter(
    (p) =>
      !/^The rewrite drops the (?:figure|name) /.test(p) &&
      !/^The rewrite runs \d+ words against the original's /.test(p),
  );
}

// ---------------------------------------------------------------- 4. the one instruction

/** The order rules the hand-run loop followed on every rewrite. */
export const DESK_ORDER_RULES = [
  "Put the facts in the order a listener needs them, and set any comparison side by side.",
  "Delete any sentence that does not serve the stated point.",
  "Every sentence before the payoff adds a fact.",
  "The last line is a take or a punchline that follows from the line before and could not be pasted onto another script.",
];

/**
 * The single instruction a rewrite gets (pure): the editor's note on the biggest weakness, the deterministic findings
 * that are not advice (the formula ending only when nothing firmer is wrong), the order rules and the caller's own
 * constraints (the held answer, a refused attempt's reasons).
 */
export function deskInstruction(o: {
  read: DeskRead;
  findings: DeskFinding[];
  min?: number;
  angle?: string;
  extra?: string[];
}): string {
  const min = o.min ?? DESK_MIN;
  const firm = o.findings.filter((f) => !f.advisory);
  const shown = (
    firm.length ? firm : o.findings.filter((f) => f.rule === "formula_ending")
  ).slice(0, 3);
  const low = DESK_DIMENSIONS.filter(
    (d) => d !== "overall" && o.read[d] < DESK_FLOOR,
  );
  return [
    `Editor's desk: a tough editor scored this Short ${o.read.overall}/10 overall (it needs ${min}${low.length ? `, and ${low.join(", ")} sit under ${DESK_FLOOR}` : ""}). Fix the single biggest weakness first: ${o.read.note.trim()}`,
    ...(shown.length ? [`Also: ${shown.map((f) => f.problem).join(" ")}`] : []),
    ...(o.angle?.trim() ? [`The stated point: ${o.angle.trim()}`] : []),
    DESK_ORDER_RULES.join(" "),
    "Use only facts already in the draft and its sources; change nothing a fact depends on.",
    ...(o.extra ?? []),
  ].join(" ");
}

// ---------------------------------------------------------------- the loop

export interface DeskRound {
  /** 0 is the first read of the settled script; 1 and on, each rewrite. */
  round: number;
  /** The read of this version; absent when the rewrite was refused. */
  scores?: DeskScores;
  note?: string;
  /** The deterministic findings on this version. */
  findings: DeskRule[];
  /** Round 1 and on: what the rewrite was told. */
  instruction?: string;
  /** Round 1 and on: why the rewrite was not kept (the fact guard, the house rules or the fact check). */
  refused?: string[];
}

export type DeskStop =
  | "check"
  | "cleared"
  | "no_change"
  | "rounds"
  | "cap"
  | "unread";

export interface DeskLoopResult<T> {
  value: T;
  rounds: DeskRound[];
  /** The round whose version was kept (0 is the script as it reached the desk). */
  kept: number;
  cleared: boolean;
  stop: DeskStop;
  calls: { judge: number; rewrite: number };
}

/**
 * The editor's loop (the steps are injected, so it is tested without a model). The first read; in "fix" mode, while
 * the best version so far misses the bar: one instruction, one rewrite, the caller's accept (fact guard, house rules,
 * fact check), a fresh read. Stops when it clears, when no score moves, after `rounds` rewrites or at the call cap.
 * The kept version is the best-scoring one that passed its accept, never a later worse one; a failed step keeps it.
 */
export async function runDesk<T>(o: {
  value: T;
  mode: "check" | "fix";
  min?: number;
  rounds?: number;
  judge: (v: T) => Promise<DeskRead>;
  checks: (v: T) => DeskFinding[];
  rewrite: (v: T, instruction: string) => Promise<T>;
  accept: (before: T, after: T) => Promise<string[]>;
  angle?: string;
  /** The caller's constraints, added to every instruction (SHORT_PAYOFF_GATE's held answer). */
  extra?: (v: T) => string[];
}): Promise<DeskLoopResult<T>> {
  const min = o.min ?? DESK_MIN;
  const caps = deskCaps(o.rounds ?? DESK_ROUNDS);
  const calls = { judge: 0, rewrite: 0 };
  const rules = (fs: DeskFinding[]) => fs.map((f) => f.rule);
  const firstFindings = o.checks(o.value);
  let first: DeskRead;
  try {
    calls.judge++;
    first = await o.judge(o.value);
  } catch {
    return {
      value: o.value,
      rounds: [{ round: 0, findings: rules(firstFindings) }],
      kept: 0,
      cleared: false,
      stop: "unread",
      calls,
    };
  }
  const rounds: DeskRound[] = [
    {
      round: 0,
      scores: scoresOf(first),
      note: first.note,
      findings: rules(firstFindings),
    },
  ];
  let best = { value: o.value, read: first, findings: firstFindings, round: 0 };
  const done = (stop: DeskStop): DeskLoopResult<T> => ({
    value: best.value,
    rounds,
    kept: best.round,
    cleared: clearsDesk(best.read, min),
    stop,
    calls,
  });
  if (o.mode === "check") return done("check");
  if (clearsDesk(first, min)) return done("cleared");
  let last = first;
  let refused: string[] = [];
  for (let r = 1; r <= caps.rewrite; r++) {
    if (calls.rewrite >= caps.rewrite || calls.judge >= caps.judge)
      return done("cap");
    const instruction = deskInstruction({
      read: best.read,
      findings: best.findings,
      min,
      angle: o.angle,
      extra: [
        ...(o.extra?.(best.value) ?? []),
        ...(refused.length
          ? [
              `The last attempt was refused: ${refused.slice(0, 3).join(" ")} Avoid that this time.`,
            ]
          : []),
      ],
    });
    calls.rewrite++;
    let after: T;
    try {
      after = await o.rewrite(best.value, instruction);
    } catch (err) {
      refused = [
        `The rewrite failed: ${err instanceof Error ? err.message : String(err)}.`,
      ];
      rounds.push({ round: r, findings: [], instruction, refused });
      continue;
    }
    const why = await o
      .accept(best.value, after)
      .catch((err) => [
        `The checks failed: ${err instanceof Error ? err.message : String(err)}.`,
      ]);
    const found = o.checks(after);
    if (why.length) {
      refused = why;
      rounds.push({
        round: r,
        findings: rules(found),
        instruction,
        refused: why.slice(0, 6),
      });
      continue;
    }
    refused = [];
    let read: DeskRead;
    try {
      calls.judge++;
      read = await o.judge(after);
    } catch {
      // Unread, it can't be compared: the best version so far stands.
      rounds.push({
        round: r,
        findings: rules(found),
        instruction,
        refused: ["The editor's read failed."],
      });
      return done("unread");
    }
    rounds.push({
      round: r,
      scores: scoresOf(read),
      note: read.note,
      findings: rules(found),
      instruction,
    });
    const moved = DESK_DIMENSIONS.some((d) => read[d] !== last[d]);
    last = read;
    if (betterRead(read, best.read, min))
      best = { value: after, read, findings: found, round: r };
    if (clearsDesk(best.read, min)) return done("cleared");
    if (!moved) return done("no_change");
  }
  return done("rounds");
}

// ---------------------------------------------------------------- 6. the record

/** What the desk leaves on the script (`desk`, beside payoff_gate), for the episode page and the weekly comparison. */
export interface DeskRecord {
  arm: DeskArm;
  mode: Exclude<DeskMode, "off">;
  /** The writer's angle sentence and mode (the desk's arm). */
  angle?: string;
  hold_mode?: "reason" | "verdict";
  /** The writer's kill, and whether fix mode acted on it (dropped, or a big story sent on with a note). */
  kill?: {
    kind: Exclude<DeskKill, "none">;
    why: string;
    acted: boolean;
    big_story?: boolean;
  };
  /** A key fact the payoff needs that the sources lack (advisory). */
  source_gap?: string;
  rounds: DeskRound[];
  /** Rewrites tried. */
  rounds_used: number;
  /** The round whose version went on. */
  kept: number;
  /** The kept version's scores (the weekly table reads overall). */
  scores?: DeskScores;
  cleared: boolean;
  stop: DeskStop | "killed";
  /** Model calls the desk made on this Short (the angle rides in the writer's own call). */
  calls: { judge: number; rewrite: number; check: number };
}

/** The record the script carries (pure). */
export function deskRecord(o: {
  arm: DeskArm;
  mode: Exclude<DeskMode, "off">;
  plan?: DeskPlan;
  kill?: DeskRecord["kill"];
  loop?: Omit<DeskLoopResult<unknown>, "value">;
  checks?: number;
}): DeskRecord {
  const rounds = o.loop?.rounds ?? [];
  const kept = o.loop?.kept ?? 0;
  const keptScores = rounds.find((r) => r.round === kept)?.scores;
  return {
    arm: o.arm,
    mode: o.mode,
    ...(o.plan?.angle?.trim() ? { angle: o.plan.angle.trim() } : {}),
    ...(o.plan ? { hold_mode: o.plan.mode } : {}),
    ...(o.kill ? { kill: o.kill } : {}),
    ...(o.plan?.source_gap?.trim()
      ? { source_gap: o.plan.source_gap.trim() }
      : {}),
    rounds,
    rounds_used: rounds.filter((r) => r.round > 0).length,
    kept,
    ...(keptScores ? { scores: keptScores } : {}),
    cleared: o.loop?.cleared ?? false,
    stop: o.loop?.stop ?? "killed",
    calls: {
      judge: o.loop?.calls.judge ?? 0,
      rewrite: o.loop?.calls.rewrite ?? 0,
      check: o.checks ?? 0,
    },
  };
}

// ---------------------------------------------------------------- the weekly calibration

/** Shorts with retention data needed before the desk score's rank correlation with average viewed is reported. */
export const DESK_CALIBRATION_MIN = 20;

/**
 * The weekly report's desk lines (pure): per arm and per desk-score band, average viewed and comments per 1,000 views,
 * then the rank correlation of desk score with average viewed once DESK_CALIBRATION_MIN Shorts have data. In the blind
 * test judged quality did not predict views, so this is how the judge is calibrated against real retention. `corr` is
 * the report's own Spearman.
 */
export function deskLinesForReport(
  rows: Array<{
    arm?: DeskArm;
    overall?: number;
    views?: number | null;
    viewed_pct?: number;
    comments?: number;
  }>,
  corr: (xs: number[], ys: number[]) => number | undefined,
): string[] {
  const read = rows.filter((r) => r.arm && typeof r.overall === "number");
  if (!read.length) return [];
  const sum = (xs: typeof read, label: string) => {
    const viewed = xs
      .map((r) => r.viewed_pct)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const views = xs.reduce((a, r) => a + (r.views ?? 0), 0);
    const comments = xs.reduce((a, r) => a + (r.comments ?? 0), 0);
    const score = xs.reduce((a, r) => a + r.overall!, 0) / (xs.length || 1);
    return `${label} ${xs.length} Shorts, desk score ${xs.length ? score.toFixed(1) : "n/a"}, average viewed ${viewed.length ? `${(viewed.reduce((a, v) => a + v, 0) / viewed.length).toFixed(1)}%` : "n/a"}, comments per 1,000 views ${views > 0 ? ((comments / views) * 1000).toFixed(2) : "n/a"}`;
  };
  const arms = (["desk", "control"] as const)
    .map((a) => read.filter((r) => r.arm === a))
    .map((xs, i) =>
      xs.length ? sum(xs, i === 0 ? "desk arm" : "control arm") : "",
    )
    .filter(Boolean);
  const bands = (
    [
      ["scored 1-4", 1, 4],
      ["5-6", 5, 6],
      ["7-10", 7, 10],
    ] as const
  )
    .map(
      ([label, lo, hi]) =>
        [
          label,
          read.filter((r) => r.overall! >= lo && r.overall! <= hi),
        ] as const,
    )
    .filter(([, xs]) => xs.length)
    .map(([label, xs]) => sum(xs, label));
  const paired = read.filter(
    (r) => typeof r.viewed_pct === "number" && Number.isFinite(r.viewed_pct),
  );
  const rho =
    paired.length >= DESK_CALIBRATION_MIN
      ? corr(
          paired.map((r) => r.overall!),
          paired.map((r) => r.viewed_pct!),
        )
      : undefined;
  return [
    `Editor's desk (SCRIPT_DESK), by arm: ${arms.join("; ")}.`,
    `Editor's desk, by desk score: ${bands.join("; ")}.`,
    rho !== undefined
      ? `Editor's desk calibration: desk score against average viewed, rank correlation ${rho.toFixed(2)} over ${paired.length} Shorts.`
      : `Editor's desk calibration: ${paired.length} of ${DESK_CALIBRATION_MIN} Shorts with retention data so far; the rank correlation with average viewed is reported from ${DESK_CALIBRATION_MIN}.`,
  ];
}
