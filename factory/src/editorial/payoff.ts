// The payoff gate (top creator gap plan, gap 1, 18 Nov 2026). Pulse Shorts lose about 4 points of audience a second
// through the fact beats, the take arrives at 65% of the runtime with 38% of viewers left, and the first frame's
// headline and the title often state the answer ("Ocarina Remake Added Fast Travel, Then Cut It"). All 27 breakout
// Shorts studied plant an open question and pay it late (median 87% of the runtime), 17 of 27 turn on a "but" in the
// middle, and 8 of 9 news hits state an opinion and open on a consequence rather than the announcement.
//
// Under SHORT_PAYOFF_GATE a news, breaking or Why Short is planned around one question and its answer (the script's
// `payoff`), and these rules are checked:
//   1. plan: the script carries the question (or contradiction) the hook opens and the answer;
//   2. held: the sentence that answers it starts at or after 60% of the words, and the hook, the first-frame text
//      (headline, thumbnail words) and the title state the premise but not the answer (token overlap);
//   3. pivot: one turn ("but", "except", "the catch", "until") in the middle third;
//   4. side: a side within the first two sentences and the verdict in the last third;
//   5. opener: the take does not open on a stock opener ("I'd", "My verdict", "My Pulse check") a recent Short used;
//   6. ending: the last line is the punchline or verdict, no ask (SHORT_END_PAYOFF's own check, reused);
//   7. read: given only the title, the first-frame text and the hook, a cold reader can say what the Short is about
//      but cannot state the answer (the one model step, "payoff.judge").
// "check" records the result on the script (payoff_gate) and changes nothing; "fix" sends the draft back to the writer
// once with the reasons and accepts what comes back with a note. Never a reason to drop a story. Everything here but
// readPayoff is pure.

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { Script } from "./schema.ts";
import { endingProblems } from "./shortrules.ts";
import { stripVoiceTags } from "../voice/tags.ts";

/** The step CODEX_CALLS can route ("payoff" routes it). */
export const PAYOFF_JUDGE_SITE = "payoff.judge";
/** The answer sentence may not start before this share of the spoken words. */
export const PAYOFF_HELD_AT = 0.6;
/** The middle third, where the turn belongs. */
export const PIVOT_FROM = 1 / 3;
export const PIVOT_TO = 2 / 3;
/** The verdict lands in the last third. */
export const VERDICT_FROM = 2 / 3;
/** A stock take opener may not repeat one used by any of this many newest Shorts. */
export const OPENER_WINDOW = 3;

export type PayoffMode = "off" | "check" | "fix";
export type PayoffArm = "gate" | "control";

export const PAYOFF_ANGLES = ["why", "changes", "deadline", "verdict"] as const;
export type PayoffAngle = (typeof PAYOFF_ANGLES)[number];

export const PayoffSchema = z.object({
  angle: z
    .enum(PAYOFF_ANGLES)
    .describe(
      "The one angle the Short takes: why: why it happened; changes: what it changes for the player; deadline: what the player can do before a date; verdict: the narrator's call on it",
    ),
  question: z
    .string()
    .describe(
      'The open question or contradiction the hook plants, in one plain sentence ("Why would Rockstar make the roads narrower?")',
    ),
  answer: z
    .string()
    .describe(
      "The answer the Short pays off late, in one plain sentence. Never in the hook, the headline, thumb_text or the title",
    ),
  answer_line: z
    .string()
    .describe(
      "The spoken sentence that gives the answer, copied exactly from the narration; it sits in the last 40% of the words",
    ),
  side: z
    .string()
    .describe(
      'The side the narrator takes in the first two sentences, in a few words ("a smart call", "a bad deal")',
    ),
});
export type PayoffPlan = z.infer<typeof PayoffSchema>;

export const PAYOFF_RULES = [
  "plan",
  "held",
  "leak_hook",
  "leak_headline",
  "leak_title",
  "pivot",
  "side",
  "verdict",
  "opener",
  "ending",
  "read",
] as const;
export type PayoffRule = (typeof PAYOFF_RULES)[number];

export interface PayoffFinding {
  rule: PayoffRule;
  problem: string;
}

/** What the gate leaves on the script (`payoff_gate`), for the episode page and the weekly arm comparison. */
export interface PayoffRecord {
  arm: PayoffArm;
  mode: Exclude<PayoffMode, "off">;
  /** Gate arm: every rule held (the cold read included when it ran). Control arm: the plan-free rules held. */
  pass: boolean;
  findings: PayoffFinding[];
  /** Where the answer sentence starts, as a share of the spoken words (gate arm, when it was found). */
  answer_at?: number;
  /** Where the turn word sits, as a share of the spoken words, when there is one. */
  pivot_at?: number;
  /** The cold read, when it ran. */
  read?: PayoffRead;
  /** "fix": the reasons the writer was sent back with, when it was. */
  sent_back?: string[];
}

// ---------------------------------------------------------------- who it applies to

/**
 * Whether the gate covers this Short (pure): the news and breaking lanes and the Why. Rankings, deals, charts and
 * the other evergreen formats are written elsewhere and never reach it; a reply Short, a search Short and a GTA File
 * part keep their own fixed shapes.
 */
export function payoffApplies(o: {
  lane: string;
  why?: boolean;
  reply?: boolean;
  search?: boolean;
  gtaFile?: boolean;
}): boolean {
  if (o.reply || o.search || o.gtaFile) return false;
  return o.lane === "news" || o.lane === "news_breaking" || !!o.why;
}

/** Which arm of the SHORT_PAYOFF_SHARE split an episode is in (pure): the same id always lands the same way. */
export function payoffArm(episodeId: string, share: number): PayoffArm {
  if (share <= 0) return "control";
  if (share >= 1) return "gate";
  const n = createHash("sha1")
    .update(`short-payoff:${episodeId}`)
    .digest()
    .readUInt16BE(0);
  return n / 65536 < share ? "gate" : "control";
}

// ---------------------------------------------------------------- what the writer reads

/** The writer's rule for a Short in the gate's arm. */
export function payoffRule(): string {
  return `Held answer (this Short is built around one open question):
- Before writing, pick one angle and fill "payoff": why it happened, what it changes for the player, what the player can do before a date, or your verdict. An announcement on its own is never the angle; open on its consequence, not on "X was announced".
- The hook plants the question or the contradiction plainly, so a viewer knows exactly what the Short is about, but it does not give the answer. Clear about the question is not the same as giving the answer away.
- Where this Short's structure asks for a surprise or a verdict in the hook, that is the premise or your lean, never the answer.
- The headline, thumb_text and the YouTube title state the premise only: the thing that happened and the question it raises, never the answer or the verdict.
- Take a side within the first two sentences: one plain lean, said once, with a reason that follows logically. Aim any edge at a company, a price or a decision, never at players.
- One turn in the middle third: a sentence with "but", "except", "the catch" or "until" that changes how the facts look.
- The sentence that gives the answer starts after 60% of the words. Copy it exactly into payoff.answer_line. The verdict lands in the last third.
- The last line is the punchline or the verdict, and then stop. No question to the viewer, no ask.
- No stacked "I'd" lines, and no "you" or "I" where a person wouldn't say it. Anything unconfirmed stays plainly unconfirmed in the answer too ("reportedly", "if the leak is right"). Every fact stays exactly as the sources give it.`;
}

/** What a later rewrite (the clarity gate's) is told so it keeps the held answer where the writer put it. */
export function payoffKeepNote(plan: Pick<PayoffPlan, "question" | "answer">): string {
  return `This Short holds its answer back on purpose. The hook may say the question plainly ("${plan.question.trim()}") but must not give the answer ("${plan.answer.trim()}"), and the sentence that gives it stays in the last 40% of the words.`;
}

/** The fix for a draft that broke the rules, as the writer reads it. */
export function payoffFeedback(findings: PayoffFinding[]): string[] {
  return findings.map((f) => `Held answer: ${f.problem}`);
}

// ---------------------------------------------------------------- words, sentences and keys

const STOP = new Set(
  "a an the and or but so to of in on at for from by with as is are was were be been being am it its it's this that these those there here they them their you your you're i i'd i'm me my we our us he she his her what which who whom why how when where will would can could should shall may might must do does did done has have had having not no yes if then than just still now new really actually also even yet get gets got make makes made one ones more most much many way thing things lot all any some only out up down off over into about after before again very too it'll that's there's what's here's isn't aren't wasn't weren't don't doesn't didn't won't can't couldn't wouldn't shouldn't hasn't haven't hadn't let's".split(
    " ",
  ),
);

/** A light stem: plural, possessive and the common verb endings come off, so "cuts" meets "cut". */
function stem(w: string): string {
  let t = w.replace(/['’]s$/, "").replace(/['’]$/, "");
  if (/^\$?\d/.test(t)) return t.replace(/[.,]$/, "");
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("es") && /(ss|sh|ch|x|z)es$/.test(t))
    t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss"))
    t = t.slice(0, -1);
  return t;
}

/** The content words of a text, stemmed, in order (numbers and prices kept whole). */
export function contentTokens(text: string): string[] {
  return stripVoiceTags(text)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/(\d),(\d{3})/g, "$1$2")
    .split(/[^a-z0-9$%.']+/)
    .map((w) => w.replace(/^[.']+|[.']+$/g, ""))
    .filter((w) => w && !STOP.has(w))
    .map(stem)
    .filter((w) => w.length > 1 || /\d/.test(w));
}

const isNumber = (t: string) => /\d/.test(t);

const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

/**
 * The game's name as fans write it, as tokens (pure): its words, its roman numeral as a figure and its initials
 * ("Grand Theft Auto VI" gives gta and 6 too), so the subject never counts as part of the answer.
 */
export function gameAliases(game: string): Set<string> {
  const words = game.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set(contentTokens(game));
  const plain = words.filter((w) => !/^[IVX]+$/.test(w) && !/^\d+$/.test(w));
  if (plain.length >= 2) out.add(plain.map((w) => w[0]!.toLowerCase()).join(""));
  for (const w of words) {
    const r = ROMAN[w.toLowerCase()];
    if (r && /^[IVX]+$/.test(w)) out.add(r);
  }
  return out;
}

/**
 * The words that carry the answer (pure): the answer's content words that the question, the game's name and the
 * generic words do not already have. With fewer than two left, the answer's words minus the game's name.
 */
export function answerKeys(
  plan: Pick<PayoffPlan, "question" | "answer">,
  game = "",
): string[] {
  const gameWords = gameAliases(game);
  const asked = new Set(contentTokens(plan.question));
  const answer = [...new Set(contentTokens(plan.answer))].filter(
    (t) => !gameWords.has(t),
  );
  const own = answer.filter((t) => !asked.has(t));
  return own.length >= 2 ? own : answer;
}

/** How much of the answer a text carries: the keys it has (pure). */
export function keysIn(text: string, keys: string[]): string[] {
  const have = new Set(contentTokens(text));
  return keys.filter((k) => have.has(k));
}

/** Pairs of keys the answer says side by side ("red flag", "fast travel"), in the answer's own order (pure). */
export function keyPairs(answer: string, keys: string[]): string[] {
  // Names ("Vice City", "Bethesda") are premise more often than answer, so a pair with one in it doesn't count.
  const names = new Set(
    stripVoiceTags(answer)
      .split(/\s+/)
      .slice(1)
      .filter((w) => /^[A-Z]/.test(w))
      .flatMap((w) => contentTokens(w)),
  );
  const set = new Set(keys.filter((k) => !names.has(k)));
  const t = contentTokens(answer);
  const out: string[] = [];
  for (let i = 0; i + 1 < t.length; i++)
    if (set.has(t[i]!) && set.has(t[i + 1]!)) out.push(`${t[i]} ${t[i + 1]}`);
  return out;
}

/**
 * Whether a text gives the answer away by overlap (pure): an answer-only number, a pair of keys the answer says side
 * by side, or at least two keys and half of them (one long key when the answer has only one). `answer` (the plan's
 * answer sentence) lets the pairs count.
 */
export function leaksAnswer(text: string, keys: string[], answer = ""): boolean {
  if (!keys.length || !text.trim()) return false;
  const hit = keysIn(text, keys);
  if (hit.some(isNumber)) return true;
  if (answer) {
    const said = ` ${contentTokens(text).join(" ")} `;
    if (keyPairs(answer, keys).some((p) => said.includes(` ${p} `))) return true;
  }
  if (keys.length === 1) return hit.length === 1 && hit[0]!.length >= 5;
  return hit.length >= 2 && hit.length / keys.length >= 0.5;
}

export interface SpokenSentence {
  text: string;
  /** Word index where it starts, counting every spoken word before it. */
  start: number;
  words: number;
}

/** The spoken lines as sentences with their word positions (pure). Lines are hook, beats, take, loop line. */
export function spokenSentences(lines: string[]): {
  sentences: SpokenSentence[];
  total: number;
} {
  const sentences: SpokenSentence[] = [];
  let at = 0;
  for (const line of lines) {
    const clean = stripVoiceTags(line).replace(/\s+/g, " ").trim();
    if (!clean) continue;
    for (const part of clean.split(
      /(?<=[.!?]["”')]?)\s+(?=["“'(]?[A-Z0-9$£€])/,
    )) {
      const n = part.split(/\s+/).filter(Boolean).length;
      if (!n) continue;
      sentences.push({ text: part, start: at, words: n });
      at += n;
    }
  }
  return { sentences, total: at };
}

const flat = (t: string) =>
  stripVoiceTags(t)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9$%']+/g, " ")
    .trim();

/**
 * Where the answer starts (pure): the writer's answer_line found in the narration, else the sentence that carries
 * most of the answer's keys (half at least). `index` is the sentence's position, `at` its start as a share of words.
 */
export function findAnswer(
  lines: string[],
  plan: Pick<PayoffPlan, "question" | "answer" | "answer_line">,
  game = "",
): { index: number; at: number; how: "line" | "overlap" } | undefined {
  const { sentences, total } = spokenSentences(lines);
  if (!total) return undefined;
  const line = flat(plan.answer_line ?? "");
  if (line.split(" ").length >= 3) {
    const head = line.split(" ").slice(0, 6).join(" ");
    const i = sentences.findIndex(
      (s) => flat(s.text).includes(head) || line.includes(flat(s.text)),
    );
    if (i >= 0)
      return { index: i, at: sentences[i]!.start / total, how: "line" };
  }
  const keys = answerKeys(plan, game);
  if (!keys.length) return undefined;
  let best = -1;
  let bestShare = 0;
  sentences.forEach((s, i) => {
    const share = keysIn(s.text, keys).length / keys.length;
    if (share > bestShare) {
      best = i;
      bestShare = share;
    }
  });
  if (best < 0 || bestShare < 0.5) return undefined;
  return { index: best, at: sentences[best]!.start / total, how: "overlap" };
}

/** An earlier sentence that already carries three quarters of the answer's keys, before the 60% mark (pure). */
export function earlyAnswer(
  lines: string[],
  plan: Pick<PayoffPlan, "question" | "answer">,
  game = "",
): SpokenSentence | undefined {
  const keys = answerKeys(plan, game);
  if (keys.length < 2) return undefined;
  const { sentences, total } = spokenSentences(lines);
  return sentences.find(
    (s) =>
      s.start / total < PAYOFF_HELD_AT &&
      keysIn(s.text, keys).length / keys.length >= 0.75,
  );
}

// ---------------------------------------------------------------- the turn, the side and the verdict

const TURN =
  /\b(but|except|the catch|until|however|trouble is|problem is|thing is)\b/i;

/** Where the first turn word in the middle third sits, as a share of the spoken words; undefined for none (pure). */
export function pivotAt(lines: string[]): number | undefined {
  const { sentences, total } = spokenSentences(lines);
  if (!total) return undefined;
  for (const s of sentences) {
    const words = s.text.split(/\s+/);
    for (let k = 0; k < words.length; k++) {
      const rest = words.slice(k, k + 2).join(" ");
      const m = TURN.exec(rest);
      if (!m || m.index !== 0) continue;
      const at = (s.start + k) / total;
      if (at >= PIVOT_FROM && at <= PIVOT_TO) return at;
    }
  }
  return undefined;
}

// A stated lean: first-person takes, value words and calls on a decision. Leans towards finding one: this is a check
// on a missing side, not a style judge.
const OPINION =
  /\b(I think|we think|I'd|I'm|I'll|I don't|I can't|I want|I love|I hate|honestly|frankly|if you ask me|my (take|verdict|bet|call|money|guess|read)|the way I see it|should(n't)?|worth (it|the|waiting|buying)|not worth|mistake|smart|brilliant|clever|bold|greedy|cheeky|risky|weird|odd|strange|genius|bad (sign|news|deal|call|move|idea|look)|good (sign|news|deal|call|move|idea)|great (sign|news|deal|call|move|idea)|right (call|trade|move)|wrong (call|move)|makes sense|doesn't make sense|no-brainer|red flag|win for|loss for|hard to (justify|argue|defend)|easy (win|call)|skip it|wait for|don't buy|don't pre-?order|buy it|for once|finally|frustrating|annoying|baffling|wild|ridiculous|absurd|fair|unfair|overpriced|a steal|a bargain|rip-?off|lazy|clearly|obviously|of course)\b/i;

/** Whether a sentence states a lean (pure). */
export function statesSide(text: string): boolean {
  return OPINION.test(stripVoiceTags(text));
}

/** Whether a side is stated within the first two sentences (pure); the writer's own `side` words count too. */
export function sideEarly(lines: string[], side = ""): boolean {
  const first = spokenSentences(lines).sentences.slice(0, 2);
  const sideKeys = contentTokens(side);
  return first.some(
    (s) =>
      statesSide(s.text) ||
      (sideKeys.length >= 2 &&
        keysIn(s.text, sideKeys).length / sideKeys.length >= 0.6),
  );
}

/** Whether the verdict lands in the last third: a lean, or a verdict line, in a sentence that starts there or in the last one (pure). */
export function verdictLate(lines: string[]): boolean {
  const { sentences, total } = spokenSentences(lines);
  if (!total) return false;
  return sentences.some(
    (s, i) =>
      (s.start / total >= VERDICT_FROM || i === sentences.length - 1) &&
      (statesSide(s.text) || /\b(verdict|pulse check)\b/i.test(s.text)),
  );
}

// ---------------------------------------------------------------- stock take openers

const STOCK_OPENERS: Array<{ id: string; re: RegExp }> = [
  { id: "i_d", re: /^\s*I'?d\b/i },
  { id: "my_verdict", re: /^\s*my verdict\b/i },
  { id: "pulse_check", re: /^\s*(my )?pulse check\b/i },
  { id: "honestly", re: /^\s*honestly\b/i },
  { id: "my_take", re: /^\s*(here's )?my take\b/i },
  { id: "if_you_ask", re: /^\s*if you ask me\b/i },
  { id: "i_think", re: /^\s*I think\b/i },
  { id: "we_think", re: /^\s*(we think|we'?d)\b/i },
];

/** The Pulse Check's own closing line ("My verdict: ...") is a rule of that segment, so it never counts as a tic. */
export const SEGMENT_OPENERS = ["my_verdict", "pulse_check"];

/** The stock opener a line starts with, or undefined (pure). */
export function stockOpener(line: string): string | undefined {
  const t = stripVoiceTags(line).replace(/^["“'\s]+/, "");
  return STOCK_OPENERS.find((o) => o.re.test(t))?.id;
}

/** Every stock opener that starts a sentence of a text: the take's frames, wherever in the take they sit (pure). */
export function stockFrames(text: string): Set<string> {
  const out = new Set<string>();
  for (const s of spokenSentences([text]).sentences) {
    const id = stockOpener(s.text);
    if (id) out.add(id);
  }
  return out;
}

/** "I'd" lines in one take: one is a take, two or more is the stacked shape the clarity rule bans (pure). */
export function stackedIds(text: string): number {
  return (stripVoiceTags(text).match(/\bI'?d\b/g) ?? []).length;
}

/**
 * The take's stock frames against the newest Shorts' (pure): a frame ("I'd...", "Honestly...", "My verdict...") that
 * starts a sentence in one of the last OPENER_WINDOW Shorts comes round again only after it rotates out, the way
 * repeated hooks already do. `recent` are the newest Shorts' takes or whole scripts, newest first; `exempt` frames a
 * segment requires (the Pulse Check's "My verdict:").
 */
export function openerProblems(
  take: string,
  recent: string[] = [],
  exempt: string[] = [],
): string[] {
  const out: string[] = [];
  const window = recent.slice(0, OPENER_WINDOW).map(stockFrames);
  for (const id of stockFrames(take)) {
    if (exempt.includes(id) || !window.some((w) => w.has(id))) continue;
    const line =
      spokenSentences([take]).sentences.find((s) => stockOpener(s.text) === id)?.text ?? take;
    const lead = stripVoiceTags(line).trim().split(/\s+/).slice(0, 3).join(" ");
    out.push(
      `The take opens a line on the stock opener "${lead}", which one of the last ${OPENER_WINDOW} Shorts also used; say that line another way, starting on the point itself.`,
    );
  }
  if (stackedIds(take) >= 2)
    out.push(
      `The take stacks "I'd" lines; keep one opinion, with its reason, said once.`,
    );
  return out;
}

// ---------------------------------------------------------------- the check

export interface PayoffInput {
  script: Pick<
    Script,
    | "hook"
    | "beats"
    | "pulse_take"
    | "loop_line"
    | "headline"
    | "youtube"
    | "game_title"
  > & { payoff?: PayoffPlan };
  /** The newest Shorts' takes or whole scripts (RecentShapes.scripts, else .takes), newest first. */
  recentTakes?: string[];
  /** Stock frames a segment requires (SEGMENT_OPENERS while the Pulse Check is on): never counted as a tic. */
  exemptOpeners?: string[];
  /** SHORT_END_PAYOFF already checks the ending as a house rule: true leaves it out of the writer's reasons. */
  endingChecked?: boolean;
  /** The gate's arm: the plan rules only apply there. */
  planned: boolean;
}

/** The spoken lines in order: hook, beats, take, loop line. */
export function payoffLines(
  s: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
): string[] {
  return [
    s.hook,
    ...s.beats.map((b) => b.narration),
    s.pulse_take.narration,
    s.loop_line,
  ];
}

/** The first-frame text: the headline and the thumbnail words. */
export function firstFrameText(
  s: Pick<Script, "headline" | "youtube">,
): string {
  return [s.headline, s.youtube?.thumb_text ?? ""].filter(Boolean).join(" / ");
}

/**
 * Every deterministic rule the script breaks (pure). With `planned`, the plan, the held answer and the leaks are
 * checked against the script's payoff; without (the control arm, or a script from before the gate), only the
 * turn, the side, the verdict, the opener and the ending, which need no plan.
 */
export function payoffFindings(o: PayoffInput): {
  findings: PayoffFinding[];
  answerAt?: number;
  pivot?: number;
} {
  const s = o.script;
  const lines = payoffLines(s);
  const findings: PayoffFinding[] = [];
  let answerAt: number | undefined;
  const plan = s.payoff;
  if (o.planned) {
    if (!plan?.question?.trim() || !plan?.answer?.trim())
      findings.push({
        rule: "plan",
        problem: `Fill in "payoff": the question the hook plants, its answer, the answer's sentence copied from the narration, the angle and your side.`,
      });
    else {
      const found = findAnswer(lines, plan, s.game_title);
      if (!found)
        findings.push({
          rule: "held",
          problem: `The answer ("${plan.answer}") is never said plainly; give it in one sentence after 60% of the words and copy that sentence into payoff.answer_line.`,
        });
      else {
        answerAt = found.at;
        if (found.at < PAYOFF_HELD_AT)
          findings.push({
            rule: "held",
            problem: `The answer arrives at ${Math.round(found.at * 100)}% of the words; hold it until after 60%, and spend the beats before it on the evidence and the turn.`,
          });
      }
      // A sentence before the mark that already says it, when the answer line itself was not already flagged early.
      const early = earlyAnswer(lines, plan, s.game_title);
      if (early && (!found || found.at >= PAYOFF_HELD_AT))
        findings.push({
          rule: "held",
          problem: `"${early.text}" already gives the answer before 60% of the words; keep the facts but hold that conclusion for the end.`,
        });
      const keys = answerKeys(plan, s.game_title);
      if (leaksAnswer(s.hook, keys, plan.answer))
        findings.push({
          rule: "leak_hook",
          problem: `The hook gives the answer away ("${s.hook.trim()}"); make it plant the question or the contradiction plainly instead.`,
        });
      const frame = firstFrameText(s);
      if (leaksAnswer(frame, keys, plan.answer))
        findings.push({
          rule: "leak_headline",
          problem: `The on-screen headline or thumb_text gives the answer away ("${frame}"); state the premise only.`,
        });
      if (leaksAnswer(s.youtube?.title ?? "", keys, plan.answer))
        findings.push({
          rule: "leak_title",
          problem: `The title gives the answer away ("${s.youtube.title}"); state the premise only, the thing that happened and the question it raises.`,
        });
    }
  }
  const pivot = pivotAt(lines);
  if (pivot === undefined)
    findings.push({
      rule: "pivot",
      problem: `No turn in the middle third; one sentence there should turn with "but", "except", "the catch" or "until" and change how the facts look.`,
    });
  if (!sideEarly(lines, plan?.side))
    findings.push({
      rule: "side",
      problem: `No side in the first two sentences; state one plain lean early, with its reason following logically.`,
    });
  if (!verdictLate(lines))
    findings.push({
      rule: "verdict",
      problem: `No verdict in the last third; land the narrator's call there, said once.`,
    });
  for (const p of openerProblems(s.pulse_take.narration, o.recentTakes, o.exemptOpeners))
    findings.push({ rule: "opener", problem: p });
  if (!o.endingChecked)
    for (const p of endingProblems(s.loop_line))
      findings.push({ rule: "ending", problem: p });
  return { findings, answerAt, pivot };
}

// ---------------------------------------------------------------- the cold read (rule 7)

export const PayoffReadSchema = z.object({
  about: z
    .string()
    .describe(
      "What this Short is about, in one plain sentence, from the title, the first-frame text and the first line alone; if you can't tell, say so",
    ),
  about_clear: z
    .boolean()
    .describe(
      "True when the three together say plainly which game and which question the Short is about",
    ),
  answer_guess: z
    .string()
    .describe(
      "The answer or conclusion you think the Short reaches, stated only if the title, first-frame text or first line already says it; empty when they leave it open",
    ),
  gives_answer: z
    .boolean()
    .describe(
      "Filled in last, after comparing with the writer's answer given at the end: true when the title, first-frame text or first line already states that answer (or its verdict)",
    ),
});
export type PayoffRead = z.infer<typeof PayoffReadSchema>;

/** The cold reader's instructions: what a scroller meets before deciding to stay. */
export function payoffReadPrompt(): string {
  return `You are scrolling YouTube Shorts. Before the video plays you see its title, then the first frame's on-screen text, then you hear its first spoken line. That is all you get. Judge two things only.

1. about and about_clear: say what the Short is about in one plain sentence. It must be clear which game and which question or claim it is about; a viewer who can't tell scrolls away. Say plainly when you can't tell.
2. answer_guess: if the title, the first-frame text or the first line already tells you the answer or the conclusion (what happened in the end, the reason, the verdict, the number that settles it), write it down. If they only set up the question and leave it open, leave answer_guess empty. Do this before you read the writer's answer below.
3. gives_answer: now compare with the writer's question and answer given after the three texts. True only when the title, the first-frame text or the first line already states that answer or its verdict. Stating the premise (what happened, what is being asked) is fine and is not the answer.`;
}

/** The cold reader's message: the three texts, then the writer's plan for comparison. */
export function payoffReadContent(o: {
  title: string;
  firstFrame: string;
  hook: string;
  question: string;
  answer: string;
}): string {
  return `TITLE: ${o.title.trim()}\nFIRST-FRAME TEXT: ${o.firstFrame.trim() || "(none)"}\nFIRST LINE (spoken): ${stripVoiceTags(o.hook).trim()}\n\nTHE WRITER'S PLAN (compare only after answering about and answer_guess):\nQuestion: ${o.question.trim()}\nAnswer: ${o.answer.trim()}`;
}

/** One cold read. Throws when the call fails; the caller records the gate without it. */
export async function readPayoff(
  llm: Llm,
  o: {
    title: string;
    firstFrame: string;
    hook: string;
    question: string;
    answer: string;
  },
): Promise<PayoffRead> {
  return llm.structured({
    site: PAYOFF_JUDGE_SITE,
    tier: "mid",
    effort: "low",
    system: payoffReadPrompt(),
    content: payoffReadContent(o),
    schema: PayoffReadSchema,
  });
}

/** The cold read as findings (pure). */
export function readFindings(r: PayoffRead): PayoffFinding[] {
  const out: PayoffFinding[] = [];
  if (!r.about_clear)
    out.push({
      rule: "read",
      problem: `A cold reader of the title, first-frame text and hook could not tell what the Short is about (they read: "${r.about}"); name the game and plant the question plainly.`,
    });
  if (r.gives_answer)
    out.push({
      rule: "read",
      problem: `A cold reader got the answer from the title, first-frame text and hook alone ("${r.answer_guess}"); keep those to the premise.`,
    });
  return out;
}

/** The record the script carries (pure). */
export function payoffRecord(o: {
  arm: PayoffArm;
  mode: Exclude<PayoffMode, "off">;
  findings: PayoffFinding[];
  answerAt?: number;
  pivot?: number;
  read?: PayoffRead;
  sentBack?: string[];
}): PayoffRecord {
  const findings = [...o.findings, ...(o.read ? readFindings(o.read) : [])];
  return {
    arm: o.arm,
    mode: o.mode,
    pass: !findings.length,
    findings,
    ...(o.answerAt !== undefined
      ? { answer_at: Number(o.answerAt.toFixed(3)) }
      : {}),
    ...(o.pivot !== undefined ? { pivot_at: Number(o.pivot.toFixed(3)) } : {}),
    ...(o.read ? { read: o.read } : {}),
    ...(o.sentBack?.length ? { sent_back: o.sentBack.slice(0, 8) } : {}),
  };
}

// ---------------------------------------------------------------- packaging after the writer

/**
 * Whether a title or tile word set is premise-only for a gated script (pure): true when the script is not in the
 * gate's arm or has no plan, so packaging that runs later (PACKAGING_LAB=pick) never brings the answer back.
 */
export function premiseOnly(
  text: string,
  script: Pick<Script, "game_title"> & {
    payoff?: PayoffPlan;
    payoff_gate?: Pick<PayoffRecord, "arm">;
  },
): boolean {
  if (script.payoff_gate?.arm !== "gate" || !script.payoff) return true;
  return !leaksAnswer(
    text,
    answerKeys(script.payoff, script.game_title),
    script.payoff.answer,
  );
}

// ---------------------------------------------------------------- the weekly comparison

/**
 * The weekly report's line comparing the two arms (pure); undefined when no Short in the period carried an arm.
 * `views` and `viewed_pct` are YouTube's, `comments` its comment count.
 */
export function payoffArmLine(
  rows: Array<{
    arm?: PayoffArm;
    pass?: boolean;
    views?: number | null;
    viewed_pct?: number;
    comments?: number;
  }>,
): string | undefined {
  const arms = (["gate", "control"] as const).map((arm) => {
    const xs = rows.filter((r) => r.arm === arm);
    const mean = (f: (r: (typeof xs)[number]) => number | undefined) => {
      const v = xs
        .map(f)
        .filter(
          (x): x is number => typeof x === "number" && Number.isFinite(x),
        );
      return v.length ? v.reduce((a, x) => a + x, 0) / v.length : undefined;
    };
    const views = xs.reduce((a, r) => a + (r.views ?? 0), 0);
    const comments = xs.reduce((a, r) => a + (r.comments ?? 0), 0);
    return {
      arm,
      n: xs.length,
      passed: xs.filter((r) => r.pass).length,
      viewed: mean((r) => r.viewed_pct),
      per1k: views > 0 ? (comments / views) * 1000 : undefined,
    };
  });
  if (!arms.some((a) => a.n)) return undefined;
  const say = (a: (typeof arms)[number]) =>
    `${a.arm} ${a.n} Shorts (${a.passed} passed every rule), average viewed ${a.viewed === undefined ? "n/a" : `${a.viewed.toFixed(1)}%`}, comments per 1,000 views ${a.per1k === undefined ? "n/a" : a.per1k.toFixed(2)}`;
  return `Held-answer test (SHORT_PAYOFF_GATE): ${arms.map(say).join("; ")}. Pass mark: 20 Shorts per arm and the gate arm 3 points or more ahead on average viewed.`;
}
