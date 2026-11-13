// The clarity gate (owner, 13 Nov 2026: "Latest short voice sounds fantastic but I think the scripts are still a little
// nonsensical / confusing / unclear / ambiguous / not clear / unsure what the actual point it's getting at are"). The
// friend voice's quotas ("you" three to five times per hundred words, a joke every 15-25 seconds, an "I" line) filled
// Shorts with quips that didn't follow ("Math isn't an upgrade policy"), a "your" on things that weren't the viewer's
// ("your East Coast unlock"), our own labels ("My Pulse check? Faint") and plugs. None of the checks read a script the
// way a viewer does, once and cold. So after writing, a judge reads it cold: it says the point in one sentence, lists
// every line a first-time viewer would trip on, and scores clarity 1-10. A flagged line is rewritten; a score under
// CLARITY_MIN goes back to the writer once, then to a plain-language rewrite. Every rewrite keeps the facts (the friend
// pass's guard) and passes the caller's own checks and fact check, or the version before it stands. The judge and the
// rewrite are their own steps ("clarity.judge", "clarity.rewrite"), so CODEX_CALLS=clarity sends both to Codex.

import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { Script } from "./schema.ts";
import { narrationOf, wordCount } from "./schema.ts";
import type { DocChapter } from "./documentary.ts";
import { applyEdits } from "./revise.ts";
import { factDrift } from "./friendpass.ts";
import { pulseVerdict } from "./newssegment.ts";
import { PULSE_FACT_RULES } from "./voice.ts";
import { stripVoiceTags, type VoiceTagMark } from "../voice/tags.ts";
import { errorMessage } from "../lib/util.ts";

/** The steps CODEX_CALLS can route ("clarity" routes both). */
export const CLARITY_JUDGE_SITE = "clarity.judge";
export const CLARITY_REWRITE_SITE = "clarity.rewrite";
/** The lowest score that passes without going back (CLARITY_MIN overrides it). */
export const CLARITY_MIN = 8;

export const CLARITY_KINDS = [
  "non_sequitur",
  "ambiguous",
  "jargon",
  "forced_pronoun",
  "stacked_take",
  "plug",
  "unclear",
] as const;
export type ClarityKind = (typeof CLARITY_KINDS)[number];

export const ClarityJudgeSchema = z.object({
  point: z
    .string()
    .describe(
      "The script's point as you understood it, in one plain sentence a viewer could repeat to a friend; if you could not tell, say so",
    ),
  point_matches: z
    .boolean()
    .describe(
      "True when your point says the same thing as the writer's intended point (given after the script); true when none was given and the point was plain",
    ),
  issues: z
    .array(
      z.object({
        line: z
          .string()
          .describe(
            "The confusing sentence or phrase, copied exactly from the script",
          ),
        kind: z.enum(CLARITY_KINDS),
        problem: z
          .string()
          .describe("What a first-time viewer would trip on, in a few words"),
        fix: z
          .string()
          .describe(
            "What the line should say instead, in plain words, using only facts already in the script",
          ),
      }),
    )
    .describe(
      "Every line a first-time viewer would trip on; empty when there is none",
    ),
  score: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe(
      "Clarity from 1 to 10: 10 every line follows and the point is unmistakable, 8 clear with a small wobble, 5 the point comes through but several lines confuse, 1 you can't tell what it's about",
    ),
});
export type ClarityJudgement = z.infer<typeof ClarityJudgeSchema>;

export type ClarityFormat = "short" | "chapter";

/** The judge's instructions: a first-time viewer, not the Pulse writer, so it never shares the writer's blind spots. */
export function clarityJudgePrompt(format: ClarityFormat = "short"): string {
  const what =
    format === "short"
      ? "a 30-60 second gaming news Short (YouTube Shorts, TikTok), narrated by one voice over game footage"
      : "one chapter of a long gaming documentary, narrated by one voice over footage";
  return `You are a casual gamer hearing ${what} for the first time, once, at normal speed, with no context beyond what is said. You know games in general but nothing about this channel, its segments or its in-jokes, and you can't rewind. Read the narration below as that viewer, line by line, and judge only whether it is clear. Not whether it is true, funny or well written: clear.

1. point: say the script's point in one plain sentence, as you would repeat it to a friend. Write it from the script alone, before you look at the writer's intended point given after it. If you can't tell what the point is, say that plainly.
2. point_matches: then compare your point with the intended one: true only when a viewer would come away with the same point.
3. issues: list every line that would make that viewer stop and think "wait, what?" Copy each line exactly. Flag a line when it is:
   - non_sequitur: it doesn't follow from the line before (a quip, joke or metaphor whose link you have to guess, "Math isn't an upgrade policy", "The calendar's picking favorites", "I can get excited about paperwork after all");
   - ambiguous: it could mean two things, or "it", "that" or "this" has nothing clear to point at, or it says "the upgrade" without saying which;
   - jargon: a label or term the viewer would need explained ("My Pulse check? Faint", an internal segment name, an unexplained abbreviation);
   - forced_pronoun: a "you" or "your" bolted onto something that isn't the viewer's, which makes the sentence odd ("your East Coast unlock", "your unfinished trilogy", "your game's first vote");
   - stacked_take: an "I'd..." or "I want..." aside in the middle of the facts, or a second and third opinion line, when the opinion belongs once, with its reason, near the end;
   - plug: a pointer to another video tacked on ("our full documentary checks...");
   - unclear: anything else a first-time viewer would trip on (a closing line that only makes sense to the writer, a sentence too packed to follow).
   Never flag a line for being plain, for having no joke, for a fact you doubt, or for style you'd merely word differently. A clear line with an opinion in it is fine. For each issue give the fix: what the line should say instead, in plain words, using only facts already in the script.
4. score: clarity from 1 to 10. 10: every line follows the one before and the point is unmistakable. 8: clear, with at most one small wobble. 6: the point comes through but several lines confuse. 4: hard to follow. 1: you can't tell what it's about. A script with two or more non-sequiturs or a point you can't state scores 6 at most.`;
}

/** The judge's user message: the narration, one sentence group per line, and the writer's intended point after it. */
export function clarityJudgeContent(o: {
  lines: string[];
  intended?: string;
  title?: string;
}): string {
  const body = o.lines
    .map((l) => stripVoiceTags(l).trim())
    .filter(Boolean)
    .join("\n");
  return `${o.title ? `On-screen title: ${o.title}\n\n` : ""}NARRATION (as heard, top to bottom):\n${body}\n\nWRITER'S INTENDED POINT (compare only after writing your own):\n${o.intended?.trim() || "(none given)"}`;
}

/** One cold read. Throws when the call fails; the gate catches it and lets the script through unjudged. */
export async function judgeClarity(
  llm: Llm,
  o: {
    lines: string[];
    intended?: string;
    title?: string;
    format?: ClarityFormat;
  },
): Promise<ClarityJudgement> {
  const r = await llm.structured({
    site: CLARITY_JUDGE_SITE,
    tier: "mid",
    effort: "medium",
    system: clarityJudgePrompt(o.format ?? "short"),
    content: clarityJudgeContent(o),
    schema: ClarityJudgeSchema,
  });
  return { ...r, issues: groundIssues(r.issues, o.lines) };
}

const flat = (t: string) =>
  stripVoiceTags(t)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9$%']+/g, " ")
    .trim();

/** Issues whose line is really in the script (a judge that paraphrases a line can't have it rewritten). */
export function groundIssues(
  issues: ClarityJudgement["issues"],
  lines: string[],
): ClarityJudgement["issues"] {
  const hay = ` ${flat(lines.join(" "))} `;
  return issues.filter((i) => {
    const q = flat(i.line);
    return q.length > 0 && hay.includes(` ${q} `);
  });
}

/** What the judgement asks for: nothing, a rewrite of the flagged lines, or (under the minimum) the writer again. */
export function clarityAction(
  j: ClarityJudgement,
  min = CLARITY_MIN,
): "pass" | "rewrite" | "writer" {
  if (j.score < min || !j.point_matches) return "writer";
  return j.issues.length ? "rewrite" : "pass";
}

/** The judgement as problems a writer or a rewrite can follow. */
export function clarityNotes(j: ClarityJudgement, min = CLARITY_MIN): string[] {
  const out: string[] = [];
  if (j.score < min)
    out.push(
      `A first-time viewer scored this script's clarity ${j.score}/10 (it needs ${min}). Say the one point plainly, make each line follow from the one before, and cut anything the viewer would have to decode.`,
    );
  if (!j.point_matches)
    out.push(
      `A first-time viewer came away with this point: "${j.point}". That is not the intended point; make the hook and the take say the intended point plainly.`,
    );
  for (const i of j.issues)
    out.push(
      `"${i.line}" is ${i.kind.replace(/_/g, " ")}: ${i.problem}. Say instead, in plain words: ${i.fix}`,
    );
  return out;
}

// ---------------------------------------------------------------- the rewrite

const RewriteSchema = z.object({
  edits: z
    .array(
      z.object({
        find: z
          .string()
          .describe(
            "A passage copied exactly from one line of the script, character for character, long enough to appear only once",
          ),
        replace: z
          .string()
          .describe("What goes there instead, in plain spoken words"),
      }),
    )
    .describe(
      "The changes: one for each flagged line, sometimes one more where a neighbour must change to follow",
    ),
});

/** The rewrite's instructions: plain words, the facts locked, the warmth kept where it is clear. */
export function clarityRewritePrompt(format: ClarityFormat = "short"): string {
  return `You are the editor making ${format === "short" ? "a gaming news Short" : "a documentary chapter"} clear to someone hearing it once. A first-time viewer flagged the lines below. Rewrite those lines, and only those, in plain spoken words so that every sentence follows from the one before and the point is unmistakable.

- Say what the viewer flagged plainly: name the thing ("the upgrade from Standard to Ultimate", not "the upgrade"), drop the metaphor or quip and say the point it was hinting at, take a "your" off anything that isn't the viewer's, and replace our own labels with plain words.
- Keep the narrator warm and opinionated: one clear opinion with its reason stays, said once, near the end. A joke that follows plainly from the line before may stay; one the viewer had to decode goes.
- Keep every number, price, date, name, outlet, quotation and rumor label exactly as it is, and add none: use only facts already in the script. Never mention the viewer, the edit or these instructions.
- Keep the length within a few words of the original: a Short has a hard word limit.
- Contractions, sentences of about 9-12 words, every sentence with a verb, no colons except one closing "My verdict:" line where the script already has one, no em dashes, American spelling.
- Answer with edits: for each, "find" is a passage copied exactly from one line of the script (character for character, long enough to be unique) and "replace" is what goes there instead. Rewrite a whole sentence when that reads better than patching words. Everything you don't edit stays word for word.

${PULSE_FACT_RULES}`;
}

function rewriteContent(
  lines: Record<string, string>,
  j: ClarityJudgement,
  plain: boolean,
  min: number,
  extra: string[] = [],
): string {
  const notes = clarityNotes(j, min);
  return `${plain ? "This is the last pass: rewrite in plain language every flagged line and any line around it that still doesn't follow, so a first-time viewer gets the point on one hearing.\n\n" : ""}THE SCRIPT (JSON, each key one spoken line):\n${JSON.stringify(lines, null, 1)}\n\nWhat the first-time viewer flagged:\n${notes.map((n) => `- ${n}`).join("\n") || "- (nothing flagged; make the point plainer)"}${extra.length ? `\n\n${extra.join("\n")}` : ""}`;
}

/** Edits from one call applied to the lines; throws when none land, so the version before stands. */
async function rewriteLines(
  llm: Llm,
  format: ClarityFormat,
  lines: Record<string, string>,
  j: ClarityJudgement,
  o: { plain: boolean; min: number; extra?: string[] },
): Promise<Record<string, string>> {
  const r = await llm.structured({
    site: CLARITY_REWRITE_SITE,
    tier: "top",
    effort: "medium",
    system: clarityRewritePrompt(format),
    content: rewriteContent(lines, j, o.plain, o.min, o.extra),
    schema: RewriteSchema,
  });
  const edited = applyEdits(lines, r.edits);
  if (!edited)
    throw new Error(
      r.edits.length
        ? "a clarity edit didn't land on the script's text"
        : "the clarity rewrite returned no edits",
    );
  return Object.fromEntries(
    Object.entries(edited).map(([k, v]) => [
      k,
      v
        .replace(/\s+([,.!?])/g, "$1")
        .replace(/\s{2,}/g, " ")
        .trim(),
    ]),
  );
}

/** A Short's spoken lines, hook to loop line, in order. */
export function shortLines(
  s: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
): string[] {
  return [
    s.hook,
    ...s.beats.map((b) => b.narration),
    s.pulse_take.narration,
    s.loop_line,
  ];
}

/** Delivery tags whose anchors still stand in the new narration (a rewritten line loses the tags it carried). */
function keptTags(
  marks: VoiceTagMark[] | undefined,
  text: string,
): VoiceTagMark[] {
  const t = flat(text);
  return (marks ?? []).filter(
    (m) =>
      (!m.after || t.includes(flat(m.after))) &&
      (!m.before || t.includes(flat(m.before))),
  );
}

/** The plain rewrite of a Short's flagged lines (one call): every other field stays. */
export async function clarityRewriteShort(
  llm: Llm,
  script: Script,
  j: ClarityJudgement,
  o: { plain?: boolean; min?: number; wordsMax?: number } = {},
): Promise<Script> {
  const lines: Record<string, string> = { hook: script.hook };
  script.beats.forEach((b, i) => (lines[`beat_${i + 1}`] = b.narration));
  lines.take = script.pulse_take.narration;
  lines.loop_line = script.loop_line;
  const extra = [
    script.point ? `The intended point: ${script.point}` : "",
    pulseVerdict(script.pulse_take.narration)
      ? `The take ends on its verdict line ("My verdict: ..."): keep it last, plain, and at most 12 words.`
      : "",
    script.stamp?.word
      ? `The word "${script.stamp.word}" carries an on-screen stamp, so it stays spoken exactly as written.`
      : "",
    o.wordsMax
      ? `The whole Short must stay under ${o.wordsMax} spoken words (it has ${wordCount(narrationOf(script))}).`
      : "",
  ].filter(Boolean);
  const r = await rewriteLines(llm, "short", lines, j, {
    plain: !!o.plain,
    min: o.min ?? CLARITY_MIN,
    extra,
  });
  const line = (k: string) => {
    const t = r[k]?.trim();
    if (!t) throw new Error(`the clarity rewrite left ${k} empty`);
    return t;
  };
  const out: Script = {
    ...script,
    hook: line("hook"),
    beats: script.beats.map((b, i) => ({
      ...b,
      narration: line(`beat_${i + 1}`),
    })),
    pulse_take: { ...script.pulse_take, narration: line("take") },
    loop_line: line("loop_line"),
  };
  const marks = keptTags(script.voice_tags, shortLines(out).join(" "));
  const { voice_tags: _old, ...rest } = out;
  return marks.length ? { ...rest, voice_tags: marks } : rest;
}

/** The plain rewrite of a chapter's flagged lines (one call): callouts and footage stay with their paragraphs. */
export async function clarityRewriteChapter<
  C extends DocChapter & { voice_tags?: VoiceTagMark[] },
>(
  llm: Llm,
  chapter: C,
  j: ClarityJudgement,
  o: { plain?: boolean; min?: number } = {},
): Promise<C> {
  const lines: Record<string, string> = {};
  chapter.paragraphs.forEach(
    (p, i) => (lines[`paragraph_${i + 1}`] = p.narration),
  );
  const r = await rewriteLines(llm, "chapter", lines, j, {
    plain: !!o.plain,
    min: o.min ?? CLARITY_MIN,
    extra: [
      `Each paragraph keeps telling what it told: its on-screen callout and footage stay with it.`,
    ],
  });
  const paragraphs = chapter.paragraphs.map((p, i) => {
    const t = r[`paragraph_${i + 1}`]?.trim();
    if (!t)
      throw new Error(`the clarity rewrite left paragraph ${i + 1} empty`);
    return { ...p, narration: t };
  });
  const text = paragraphs.map((p) => p.narration).join(" ");
  const marks = keptTags(chapter.voice_tags, text);
  const { voice_tags: _old, ...rest } = chapter;
  return (
    marks.length
      ? { ...rest, paragraphs, voice_tags: marks }
      : { ...rest, paragraphs }
  ) as C;
}

const words = (t: string) =>
  stripVoiceTags(t).split(/\s+/).filter(Boolean).length;

/** What a clarity rewrite of a Short broke (pure): moved facts, a lost verdict or stamp, the length or the beats. */
export function clarityShortProblems(
  before: Script,
  after: Script,
  opts: { wordsMin?: number; wordsMax?: number } = {},
): string[] {
  const b = shortLines(before).join(" ");
  const a = shortLines(after).join(" ");
  const p = factDrift(b, a);
  if (after.beats.length !== before.beats.length)
    p.push(`The rewrite changed the number of beats.`);
  if (/[{}[\]]/.test(stripVoiceTags(a)))
    p.push(`The rewrite left a bracket in the narration.`);
  const wb = words(b);
  const wa = words(a);
  if (Math.abs(wa - wb) > Math.max(8, wb * 0.25))
    p.push(
      `The rewrite runs ${wa} words against the original's ${wb}; keep the length.`,
    );
  const n = wordCount(narrationOf(after));
  if (
    (opts.wordsMin !== undefined && n < opts.wordsMin) ||
    (opts.wordsMax !== undefined && n > opts.wordsMax)
  )
    p.push(
      `The rewrite runs ${n} words, outside ${opts.wordsMin}-${opts.wordsMax}.`,
    );
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
  return p;
}

/** What a clarity rewrite of a chapter broke (pure). */
export function clarityChapterProblems(
  before: DocChapter,
  after: DocChapter,
): string[] {
  const b = before.paragraphs.map((x) => x.narration).join(" ");
  const a = after.paragraphs.map((x) => x.narration).join(" ");
  const p = factDrift(b, a);
  if (after.paragraphs.length !== before.paragraphs.length)
    p.push(`The rewrite changed the number of paragraphs.`);
  const wb = words(b);
  const wa = words(a);
  if (Math.abs(wa - wb) > Math.max(12, wb * 0.15))
    p.push(
      `The rewrite runs ${wa} words against the original's ${wb}; keep the length.`,
    );
  return p;
}

// ---------------------------------------------------------------- the gate

export interface ClarityStep {
  step: "judge" | "writer" | "rewrite" | "plain";
  score?: number;
  kept?: boolean;
  why?: string[];
}

export interface ClarityOutcome<T> {
  value: T;
  /** The first cold read, or undefined when the judge could not run. */
  first?: ClarityJudgement;
  /** The last cold read of the version that stands. */
  last?: ClarityJudgement;
  steps: ClarityStep[];
}

/**
 * Judge, then fix. A score under `min` (or a point the judge can't find) goes back to the writer once with the
 * judge's notes; whatever is still flagged then gets a plain-language rewrite. Each new version must pass `accept`
 * (the caller's guard, house rules and fact check: problems, empty means fine) or the version before stands. Never
 * throws: a failed judge or rewrite leaves the script as it was.
 */
export async function clarityGate<T>(o: {
  value: T;
  judge: (v: T) => Promise<ClarityJudgement>;
  /** The writer's own revision with the judge's notes; absent, the plain rewrite does that job. */
  writer?: (v: T, notes: string[]) => Promise<T>;
  rewrite: (v: T, j: ClarityJudgement, plain: boolean) => Promise<T>;
  accept: (before: T, after: T) => Promise<string[]>;
  min?: number;
}): Promise<ClarityOutcome<T>> {
  const min = o.min ?? CLARITY_MIN;
  const steps: ClarityStep[] = [];
  let value = o.value;
  const read = async (v: T): Promise<ClarityJudgement | undefined> => {
    try {
      const j = await o.judge(v);
      steps.push({ step: "judge", score: j.score });
      return j;
    } catch (err) {
      steps.push({
        step: "judge",
        why: [`the judge could not run: ${errorMessage(err)}`],
      });
      return undefined;
    }
  };
  const tryStep = async (
    step: ClarityStep["step"],
    make: () => Promise<T>,
  ): Promise<boolean> => {
    let after: T;
    try {
      after = await make();
    } catch (err) {
      steps.push({ step, kept: false, why: [errorMessage(err)] });
      return false;
    }
    let why: string[];
    try {
      why = await o.accept(value, after);
    } catch (err) {
      why = [`the checks could not run: ${errorMessage(err)}`];
    }
    steps.push({
      step,
      kept: !why.length,
      ...(why.length ? { why: why.slice(0, 6) } : {}),
    });
    if (why.length) return false;
    value = after;
    return true;
  };
  const first = await read(value);
  if (!first) return { value, steps };
  let last = first;
  let action = clarityAction(last, min);
  if (action === "pass") return { value, first, last, steps };
  // Under the minimum: the writer once, with the judge's notes.
  if (action === "writer" && o.writer) {
    const notes = clarityNotes(last, min);
    if (await tryStep("writer", () => o.writer!(value, notes))) {
      const again = await read(value);
      if (again) last = again;
      action = clarityAction(last, min);
      if (action === "pass") return { value, first, last, steps };
    }
  }
  // What is still flagged (or still under the minimum) gets the plain-language rewrite.
  const plain = action === "writer";
  const judged = last;
  if (
    await tryStep(plain ? "plain" : "rewrite", () =>
      o.rewrite(value, judged, plain),
    )
  ) {
    const again = await read(value);
    if (again) last = again;
  }
  return { value, first, last, steps };
}

/** The gate's outcome for the event log. */
export function clarityLog<T>(r: ClarityOutcome<T>): Record<string, unknown> {
  return {
    before: r.first?.score,
    after: r.last?.score,
    point: r.last?.point,
    flagged: (r.last?.issues ?? [])
      .map((i) => `${i.kind}: ${i.line}`)
      .slice(0, 6),
    steps: r.steps,
  };
}
