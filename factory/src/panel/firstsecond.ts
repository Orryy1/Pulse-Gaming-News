// The first-second panel (FIRST_SECOND_PANEL, top creator gap plan, 19 Nov 2026). What a viewer meets in the first
// second of a Short is three things: the first spoken sentence, the text on the first frame and what the opening
// picture shows. This builds the critics' view from exactly those (the picture as the plan describes it: the kind of
// footage, the game and the keywords, moving or still) and runs them on the shared blind panel (./panel.ts).
//   check: one audience read ("first.viewer") of the Short as it stands: a stop mark (1 to 10), the reason and whether
//          the first-frame text gives the answer away. Nothing changes. Its record is what the weekly report later sets
//          against real stayed-versus-swiped (engaged views over views).
//   on:    the panel's arm. One call ("first.write") writes up to three alternative first-frame texts and, only for a
//          Short the writers' room did not write, up to two alternative first sentences. Code drops any that break the
//          rules (length, the game named, no hype, no figure or name the script does not already have, never the held
//          answer) and any first sentence the caller's fact guard and house rules refuse. The audience critic and the
//          editor critic ("first.editor") mark every combination blind; the best mean overall is kept and the current
//          version wins ties. The control arm gets the check read.
// Everything is pure but the three call helpers and runFirstSecond, whose model calls and guard are injected.

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Llm } from "../editorial/llm.ts";
import type { Script } from "../editorial/schema.ts";
import {
  gameAliases,
  contentTokens,
  premiseOnly,
  spokenSentences,
} from "../editorial/payoff.ts";
import { stripVoiceTags } from "../voice/tags.ts";
import {
  runPanel,
  seededShuffle,
  type PanelCandidate,
  type PanelCritic,
  type PanelMark,
  type PanelRule,
} from "./panel.ts";

// ---------------------------------------------------------------- the numbers, in one place

/** Every limit the first-second panel uses; nothing else in the code repeats them. */
export const FIRST_SECOND = {
  /** First-frame text alternatives: words at most, and how many. */
  textWords: 6,
  textsMax: 3,
  /** First-sentence alternatives: words at most, and how many. */
  sentenceWords: 12,
  sentencesMax: 2,
  /** Model calls a Short at most: one write, two reads (the audience critic and the editor critic). */
  caps: { write: 1, read: 2 },
  /** The share of covered Shorts in the panel's arm when FIRST_SECOND_PANEL_SHARE is unset. */
  share: 0.5,
  /** The mark range. */
  markMin: 1,
  markMax: 10,
} as const;

export const FIRST_VIEWER_SITE = "first.viewer";
export const FIRST_EDITOR_SITE = "first.editor";
export const FIRST_WRITE_SITE = "first.write";

/** Hype a first-frame text or a first sentence never carries (the niche study: rarer in hits than in weak Shorts). */
export const FIRST_HYPE =
  /\b(biggest|greatest|craziest|insane(?:ly)?|crazy|massive|huge|mind[- ]blowing|of all time|shocking|you won'?t believe|unbelievable|epic)\b/i;

export type FirstSecondMode = "off" | "check" | "on";
export type FirstSecondArm = "panel" | "control";

/** Which arm of the FIRST_SECOND_PANEL_SHARE split an episode is in (pure): the same id always lands the same way. */
export function firstSecondArm(
  episodeId: string,
  share: number,
): FirstSecondArm {
  if (share <= 0) return "control";
  if (share >= 1) return "panel";
  const n = createHash("sha1")
    .update(`first-second:${episodeId}`)
    .digest()
    .readUInt16BE(0);
  return n / 65536 < share ? "panel" : "control";
}

/**
 * The arm a Short is in, or undefined when the panel does not run on it (pure): FIRST_SECOND_PANEL off, or a Short the
 * desk does not cover (only news, breaking and Why Shorts are). Off means no call and no record.
 */
export function firstSecondArmFor(
  mode: FirstSecondMode,
  share: number,
  episodeId: string,
  covered: boolean,
): FirstSecondArm | undefined {
  return mode !== "off" && covered ? firstSecondArm(episodeId, share) : undefined;
}

// ---------------------------------------------------------------- what the viewer meets

export interface FirstSecondView {
  /** The first spoken sentence. */
  sentence: string;
  /** The text on the first frame (the Short's headline, fully drawn at frame 0). */
  text: string;
  /** The opening picture as the plan describes it. */
  picture: string;
}

const WANT_WORDS: Record<string, string> = {
  gameplay: "gameplay footage",
  cinematic: "cinematic trailer footage",
  character: "footage of a character",
  world: "footage of the game's world",
  vehicle: "footage of a vehicle",
  ui: "the game's menus or HUD",
  calm: "slow, calm footage",
};

const clean = (t: string) => stripVoiceTags(t).replace(/\s+/g, " ").trim();
const words = (t: string) => clean(t).split(" ").filter(Boolean);

/** The first spoken sentence of a Short (pure). */
export function firstSentenceOf(script: Pick<Script, "hook">): string {
  return (
    spokenSentences([script.hook]).sentences[0]?.text ?? clean(script.hook)
  );
}

/** The opening picture as the plan describes it (pure): the kind of media, the game and keywords, moving or still. */
export function pictureOf(
  script: Pick<Script, "hook_footage" | "game_title" | "beats">,
): string {
  const f = script.hook_footage ?? script.beats[0]?.footage;
  const game = script.game_title.trim();
  if (!f || f.want === "none")
    return `a still picture (key art or a screenshot) of ${game || "the game"}`;
  const keys = f.keywords.map((k) => k.trim()).filter(Boolean);
  return `moving: ${WANT_WORDS[f.want] ?? `${f.want} footage`} from ${game || "the game"}${keys.length ? `, showing ${keys.join(", ")}` : ""}`;
}

/** The three things a viewer meets in the first second (pure). */
export function firstSecondView(
  script: Pick<
    Script,
    "hook" | "headline" | "hook_footage" | "game_title" | "beats"
  >,
): FirstSecondView {
  return {
    sentence: firstSentenceOf(script),
    text: clean(script.headline),
    picture: pictureOf(script),
  };
}

/** What a critic sees of one opening (pure): never the plan, the sources or the rest of the script. */
export function openingView(label: string, v: FirstSecondView): string {
  return `OPENING ${label}\nON SCREEN: ${v.text}\nPICTURE: ${v.picture}\nSAID: ${v.sentence}`;
}

// ---------------------------------------------------------------- the critics

const mark = (rubric: string) =>
  z
    .number()
    .int()
    .min(FIRST_SECOND.markMin)
    .max(FIRST_SECOND.markMax)
    .describe(`1 to 10: ${rubric}`);

export const FirstViewerReadSchema = z.object({
  label: z.string().describe("The opening's label"),
  stop: mark("would you stop scrolling for this opening"),
  clear: mark("do you know at once what this is about"),
  want_next: mark("do you want to hear the next line"),
  reason: z.string().describe("Why you would stop or swipe, one plain line"),
  gives_away: z
    .boolean()
    .describe(
      "True when the on-screen text already tells you the whole story, so there is nothing left to stay for",
    ),
  fault: z
    .string()
    .describe("The single biggest thing that would make you swipe, quoting it"),
});
export type FirstViewerRead = z.infer<typeof FirstViewerReadSchema>;
export const FirstViewerPanelSchema = z.object({
  reads: z.array(FirstViewerReadSchema),
});

export const FirstEditorReadSchema = z.object({
  label: z.string(),
  hook: mark("the opening plants a real question or surprise in one second"),
  clarity: mark(
    "the game and the topic are plain at once, and the words on screen and the words said work together",
  ),
  honesty: mark("it promises only what is true, with no hype and no bait"),
  overall: mark(
    "would a tough editor at a top gaming Shorts channel open with this",
  ),
  gives_away: z
    .boolean()
    .describe(
      "True when the on-screen text or the sentence gives the answer away",
    ),
  fault: z.string().describe("The single biggest weakness, quoting it"),
});
export type FirstEditorRead = z.infer<typeof FirstEditorReadSchema>;
export const FirstEditorPanelSchema = z.object({
  reads: z.array(FirstEditorReadSchema),
});

export function firstViewerPrompt(): string {
  return `You are a general gamer scrolling YouTube Shorts late at night. You play a few big games and follow the news loosely. You get the first second of one or more Shorts: the text on the first frame, what the picture shows and the first sentence you hear. You know nothing else. For each opening:

- stop: would you stop scrolling for it.
- clear: do you know at once what it is about.
- want_next: do you want to hear the next line.

Be honest: most Shorts lose you in the first second, and 5 is an ordinary opening. Then give reason (why you would stop or swipe, one plain line), gives_away (true when the on-screen text already tells you the whole story, so there is nothing left to stay for) and fault (the single biggest thing that would make you swipe, quoting it).`;
}

export function firstEditorPrompt(): string {
  return `You are a tough editor at a top human gaming Shorts channel. You get one or more openings for the same Short: the text on the first frame, what the picture shows and the first sentence said. You know nothing else about the story or what the writer meant. Mark each from 1 to 10:

- hook: the opening plants a real question or surprise in one second.
- clarity: the game and the topic are plain at once, and the words on screen and the words said work together rather than repeat each other.
- honesty: it promises only what is true, with no hype and no bait.
- overall: would you open with this as it stands.

5 is average for a competent channel; 8 or more only for an opening you would use as it stands. Don't reward length. Then give gives_away (true when the on-screen text or the sentence gives the answer away) and fault (the single biggest weakness, quoting it).`;
}

export async function readFirstViewer(
  llm: Llm,
  content: string,
): Promise<z.infer<typeof FirstViewerPanelSchema>> {
  return llm.structured({
    site: FIRST_VIEWER_SITE,
    tier: "mid",
    effort: "low",
    system: firstViewerPrompt(),
    content,
    schema: FirstViewerPanelSchema,
  });
}

export async function readFirstEditor(
  llm: Llm,
  content: string,
): Promise<z.infer<typeof FirstEditorPanelSchema>> {
  return llm.structured({
    site: FIRST_EDITOR_SITE,
    tier: "mid",
    effort: "low",
    system: firstEditorPrompt(),
    content,
    schema: FirstEditorPanelSchema,
  });
}

// ---------------------------------------------------------------- the writer

export const FirstWriteSchema = z.object({
  texts: z
    .array(z.string())
    .max(FIRST_SECOND.textsMax)
    .describe(
      `Up to ${FIRST_SECOND.textsMax} alternative first-frame texts, each ${FIRST_SECOND.textWords} words or fewer`,
    ),
  sentences: z
    .array(z.string())
    .max(FIRST_SECOND.sentencesMax)
    .describe(
      `Up to ${FIRST_SECOND.sentencesMax} alternative first sentences; empty when none are asked for`,
    ),
});
export type FirstWrite = z.infer<typeof FirstWriteSchema>;

export function firstWritePrompt(sentences: boolean): string {
  return `You write the first second of a gaming news Short: the text on its first frame${sentences ? " and its first spoken sentence" : ""}. You get the Short as it stands.

First-frame text: up to ${FIRST_SECOND.textsMax} alternatives to the current one. Each is ${FIRST_SECOND.textWords} words or fewer, names the game, and states a plain, concrete surprise from this Short (a figure, a contradiction, a detail that should not be true). Never the answer the Short holds back, never hype (no "insane", "huge", "biggest", "shocking"), never a question, no emoji, no em dashes. Only facts the Short already says.
${
  sentences
    ? `First sentence: up to ${FIRST_SECOND.sentencesMax} alternatives to the current one. Each is ${FIRST_SECOND.sentenceWords} words or fewer, names the game or the company, and states a contradiction, an oddity or a claim that cannot be left alone, so the viewer knows the topic at once. It must lead naturally into the current second sentence. Never the answer, no riddles, no hype, no figure or name the Short does not already say, American spelling.`
    : `First sentence: the Short keeps its own; return no sentences.`
}
Each alternative must differ from the current one and from the others in what it leads with, not only in wording.`;
}

/** What the writer sees (pure): the title, the opening as it stands and the narration, plus the answer to keep back. */
export function firstWriteContent(script: Script, narration: string): string {
  const v = firstSecondView(script);
  const held = script.payoff?.answer?.trim();
  return `GAME: ${script.game_title}\nTITLE: ${script.youtube.title}\nCURRENT FIRST-FRAME TEXT: ${v.text}\nOPENING PICTURE: ${v.picture}\nCURRENT FIRST SENTENCE: ${v.sentence}\nNARRATION: ${clean(narration)}${held ? `\nTHE ANSWER IT HOLDS BACK (never put this in the opening): ${held}` : ""}`;
}

export async function writeFirst(
  llm: Llm,
  script: Script,
  narration: string,
  sentences: boolean,
): Promise<FirstWrite> {
  return llm.structured({
    site: FIRST_WRITE_SITE,
    tier: "mid",
    effort: "low",
    system: firstWritePrompt(sentences),
    content: firstWriteContent(script, narration),
    schema: FirstWriteSchema,
  });
}

// ---------------------------------------------------------------- the guards (pure)

const figures = (t: string): string[] =>
  (t.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(
    (f) => f.replace(/\.0+$/, ""),
  );

/** Capitalised words past the first, as a cheap stand-in for names (pure). */
const capitalised = (t: string): string[] =>
  words(t)
    .slice(1)
    .map((w) =>
      w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['’]s$/i, ""),
    )
    .filter((w) => /^\p{Lu}/u.test(w) && w.length > 1);

/** Whether a text names the game (pure): one of its words or its initials. */
export function namesTheGame(text: string, game: string): boolean {
  if (!game.trim()) return true;
  const aliases = gameAliases(game);
  return contentTokens(text).some((t) => aliases.has(t));
}

/**
 * Why an alternative may not be used (pure), empty when it may: the length, the game named, no hype, no question, no
 * em dash, no figure or name the script does not already have, and never the held answer (SHORT_PAYOFF_GATE's plan).
 */
export function alternativeProblems(
  kind: "text" | "sentence",
  alt: string,
  script: Script,
  scriptText: string,
): string[] {
  const out: string[] = [];
  const t = clean(alt);
  const max =
    kind === "text" ? FIRST_SECOND.textWords : FIRST_SECOND.sentenceWords;
  if (!t) return ["empty"];
  if (words(t).length > max) out.push(`over ${max} words`);
  if (!namesTheGame(t, script.game_title)) out.push("does not name the game");
  if (FIRST_HYPE.test(t)) out.push("hype");
  if (/[—–]/.test(t)) out.push("an em dash");
  if (kind === "text" && /\?/.test(t)) out.push("a question");
  const have = new Set(figures(scriptText));
  const newFigures = figures(t).filter((f) => !have.has(f));
  if (newFigures.length)
    out.push(`a figure the Short does not say: ${newFigures.join(", ")}`);
  const lower = scriptText.toLowerCase();
  const newNames = capitalised(t).filter(
    (n) => !lower.includes(n.toLowerCase()),
  );
  if (newNames.length)
    out.push(`a name the Short does not say: ${newNames.join(", ")}`);
  if (!premiseOnly(t, script)) out.push("gives the held answer away");
  return out;
}

/** The hook with its first sentence replaced (pure); the rest of the hook stays word for word. */
export function withFirstSentence(hook: string, sentence: string): string {
  const first = firstSentenceOf({ hook });
  const at = hook.indexOf(first);
  if (at < 0) return sentence;
  return `${hook.slice(0, at)}${sentence.trim()}${hook.slice(at + first.length)}`;
}

// ---------------------------------------------------------------- the record

export interface FirstSecondOpening {
  id: string;
  text: string;
  sentence: string;
  /** The version as it stood. */
  current: boolean;
}

export interface FirstSecondRecord {
  arm: FirstSecondArm;
  mode: Exclude<FirstSecondMode, "off">;
  /** What the viewer met as the Short stood (the picture as planned). */
  before: FirstSecondView;
  /** The audience critic's stop mark (1 to 10) on the version that went out: the number set against stayed-vs-swiped. */
  stop?: number;
  /** Its reason, one line. */
  reason?: string;
  /** The audience critic said the first-frame text gives the whole story away. */
  gives_away?: boolean;
  /** SHORT_PAYOFF_GATE's plan: the first-frame text carries the held answer (code, not a critic). */
  leak?: boolean;
  /** "on": every opening shown, the marks, the pick and why. */
  candidates?: FirstSecondOpening[];
  marks?: PanelMark[];
  pick?: string;
  why?: string;
  /** "on": alternatives the guards dropped, with the reason. */
  refused?: string[];
  /** True when the first-frame text or the first sentence changed. */
  changed: boolean;
  /** "on": a room-written Short keeps its first sentence. */
  sentence_locked?: boolean;
  calls: { write: number; read: number };
  error?: string;
}

/** The event the pipeline logs (pure). */
export function firstSecondEvent(
  r: FirstSecondRecord,
): Record<string, unknown> {
  return {
    arm: r.arm,
    mode: r.mode,
    ...(r.stop !== undefined ? { stop: r.stop } : {}),
    ...(r.gives_away !== undefined ? { gives_away: r.gives_away } : {}),
    ...(r.leak !== undefined ? { leak: r.leak } : {}),
    changed: r.changed,
    ...(r.pick ? { pick: r.pick } : {}),
    ...(r.candidates ? { candidates: r.candidates.length } : {}),
    ...(r.refused?.length ? { refused: r.refused.length } : {}),
    calls: r.calls,
    ...(r.error ? { error: r.error } : {}),
  };
}

// ---------------------------------------------------------------- the run

/** The panel's pick rule: the best mean overall, the current version winning ties, then the audience's higher mark. */
export const firstSecondRule = (currentId: string): PanelRule => ({
  name: "best mean overall",
  ties: [
    { by: "prefer", id: currentId },
    { by: "critic", critic: "audience" },
    { by: "order" },
  ],
});

export interface FirstSecondDeps {
  /** The audience read, given the openings as text. */
  viewer: (content: string) => Promise<z.infer<typeof FirstViewerPanelSchema>>;
  /** "on": the editor read. */
  editor?: (content: string) => Promise<z.infer<typeof FirstEditorPanelSchema>>;
  /** "on": the one write call. */
  write?: (sentences: boolean) => Promise<FirstWrite>;
  /** "on": the existing fact guard and house rules on the script with a new first sentence; empty to allow it. */
  accept?: (after: Script) => string[];
}

/** The script with an opening applied (pure). */
export function applyOpening(
  script: Script,
  o: { text: string; sentence: string },
): Script {
  const now = firstSecondView(script);
  return {
    ...script,
    ...(o.text !== now.text ? { headline: o.text } : {}),
    ...(o.sentence !== now.sentence
      ? { hook: withFirstSentence(script.hook, o.sentence) }
      : {}),
  };
}

/**
 * One Short's first second. Never throws: a failed call leaves the script as it was, recorded. `narration` is the
 * whole spoken script (the guards' figure and name test reads it with the title and the headline).
 */
export async function runFirstSecond(o: {
  script: Script;
  narration: string;
  episodeId: string;
  arm: FirstSecondArm;
  mode: Exclude<FirstSecondMode, "off">;
  /** Written by the writers' room: its first sentence is kept. */
  roomWrote?: boolean;
  deps: FirstSecondDeps;
}): Promise<{ script: Script; record: FirstSecondRecord }> {
  const before = firstSecondView(o.script);
  const full = o.mode === "on" && o.arm === "panel";
  const calls = { write: 0, read: 0 };
  const leak =
    o.script.payoff_gate?.arm === "gate" && o.script.payoff
      ? !premiseOnly(before.text, o.script)
      : undefined;
  const base: FirstSecondRecord = {
    arm: o.arm,
    mode: o.mode,
    before,
    ...(leak !== undefined ? { leak } : {}),
    changed: false,
    calls,
  };
  const audience = (content: string) => o.deps.viewer(content);
  if (!full) {
    try {
      calls.read++;
      const r = await audience(openingView("1", before));
      const read = r.reads[0];
      return {
        script: o.script,
        record: {
          ...base,
          ...(read
            ? {
                stop: read.stop,
                reason: read.reason.trim(),
                gives_away: read.gives_away,
              }
            : {}),
        },
      };
    } catch (err) {
      return { script: o.script, record: { ...base, error: errorText(err) } };
    }
  }
  // "on", the panel's arm.
  const scriptText = [
    o.narration,
    o.script.youtube.title,
    o.script.headline,
    o.script.game_title,
  ].join("\n");
  const sentencesAllowed = !o.roomWrote && !!o.deps.accept;
  const refused: string[] = [];
  let written: FirstWrite = { texts: [], sentences: [] };
  if (o.deps.write) {
    try {
      calls.write++;
      written = await o.deps.write(sentencesAllowed);
    } catch (err) {
      refused.push(`the write failed: ${errorText(err)}`);
    }
  }
  const seen = new Set([before.text.toLowerCase()]);
  const texts = [before.text];
  for (const t of written.texts.slice(0, FIRST_SECOND.textsMax)) {
    const c = clean(t);
    if (seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    const p = alternativeProblems("text", c, o.script, scriptText);
    if (p.length) refused.push(`text "${c}": ${p.join("; ")}`);
    else texts.push(c);
  }
  const sentences = [before.sentence];
  if (sentencesAllowed) {
    const seenS = new Set([before.sentence.toLowerCase()]);
    for (const t of written.sentences.slice(0, FIRST_SECOND.sentencesMax)) {
      const c = clean(t);
      if (seenS.has(c.toLowerCase())) continue;
      seenS.add(c.toLowerCase());
      const p = alternativeProblems("sentence", c, o.script, scriptText);
      const guard = p.length
        ? []
        : (o.deps.accept?.(
            applyOpening(o.script, { text: before.text, sentence: c }),
          ) ?? []);
      if (p.length || guard.length)
        refused.push(
          `sentence "${c}": ${[...p, ...guard].slice(0, 3).join("; ")}`,
        );
      else sentences.push(c);
    }
  }
  const openings: FirstSecondOpening[] = [];
  for (const sentence of sentences)
    for (const text of texts)
      openings.push({
        id: "",
        text,
        sentence,
        current: text === before.text && sentence === before.sentence,
      });
  // Blind: the order is shuffled per episode, so the current version is not always first.
  const shown = seededShuffle(openings, `first-second:${o.episodeId}`).map(
    (x, i) => ({ ...x, id: String(i + 1) }),
  );
  const currentId = shown.find((x) => x.current)!.id;
  const viewOf = (x: FirstSecondOpening) => ({
    ...before,
    text: x.text,
    sentence: x.sentence,
  });
  const candidates: PanelCandidate[] = shown.map((x) => ({
    id: x.id,
    view: openingView(x.id, viewOf(x)),
  }));
  const content = (cs: readonly PanelCandidate[]) =>
    cs.map((c) => c.view).join("\n\n");
  const critics: PanelCritic[] = [
    {
      name: "audience",
      required: true,
      judge: async (cs) => {
        const r = await audience(content(cs));
        return {
          raw: r,
          reads: r.reads.map((x) => ({
            id: x.label.replace(/^OPENING\s+/i, "").trim(),
            marks: { stop: x.stop, clear: x.clear, want_next: x.want_next },
            overall: x.stop,
            fault: x.fault || x.reason,
            raw: x,
          })),
        };
      },
    },
    // Nothing to choose between: the audience read alone, as in "check".
    ...(o.deps.editor && shown.length > 1
      ? [
          {
            name: "editor",
            judge: async (cs: readonly PanelCandidate[]) => {
              const r = await o.deps.editor!(content(cs));
              return {
                raw: r,
                reads: r.reads.map((x) => ({
                  id: x.label.replace(/^OPENING\s+/i, "").trim(),
                  marks: {
                    hook: x.hook,
                    clarity: x.clarity,
                    honesty: x.honesty,
                    overall: x.overall,
                  },
                  overall: x.overall,
                  fault: x.fault,
                  raw: x,
                })),
              };
            },
          } as PanelCritic,
        ]
      : []),
  ];
  const panel = await runPanel({
    candidates,
    critics,
    rule: firstSecondRule(currentId),
    caps: { calls: FIRST_SECOND.caps.read },
  });
  calls.read += panel.calls;
  const pickId = panel.pick ?? currentId;
  const picked = shown.find((x) => x.id === pickId)!;
  const audienceRead = panel.verdicts.audience?.reads.find(
    (r) => r.id === pickId,
  )?.raw as FirstViewerRead | undefined;
  const changed = !!panel.pick && !picked.current;
  const script = changed ? applyOpening(o.script, picked) : o.script;
  return {
    script,
    record: {
      ...base,
      ...(audienceRead
        ? {
            stop: audienceRead.stop,
            reason: audienceRead.reason.trim(),
            gives_away: audienceRead.gives_away,
          }
        : {}),
      candidates: shown,
      marks: panel.marks,
      ...(panel.pick ? { pick: panel.pick } : {}),
      why: panel.why,
      ...(refused.length ? { refused: refused.slice(0, 8) } : {}),
      changed,
      ...(o.roomWrote ? { sentence_locked: true } : {}),
      ...(Object.keys(panel.failed).length
        ? {
            error: Object.entries(panel.failed)
              .map(([k, v]) => `${k}: ${v}`)
              .join("; ")
              .slice(0, 300),
          }
        : {}),
    },
  };
}

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 300);

// ---------------------------------------------------------------- the weekly report

/** Shorts with both a stop mark and a stayed-to-watch reading before the report gives a correlation. */
export const FIRST_SECOND_VERDICT_MIN = 20;

/**
 * The weekly report's first-second lines (pure): per arm, Shorts and the average stayed-to-watch share; then, from
 * FIRST_SECOND_VERDICT_MIN Shorts with both, the rank correlation of the audience critic's stop mark with stayed to
 * watch (engaged views over views), and how often the first-frame text gave the answer away.
 */
export function firstSecondLinesForReport(
  rows: Array<{
    arm?: FirstSecondArm;
    changed?: boolean;
    stop?: number;
    gives_away?: boolean;
    stayed?: number;
  }>,
  corr: (xs: number[], ys: number[]) => number | undefined,
): string[] {
  const all = rows.filter((r) => r.arm);
  if (!all.length) return [];
  const avg = (xs: number[]) =>
    xs.reduce((a, v) => a + v, 0) / (xs.length || 1);
  const stayedOf = (xs: typeof all) =>
    xs
      .map((r) => r.stayed)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const side = (xs: typeof all, label: string) => {
    const s = stayedOf(xs);
    return `${label} ${xs.length} Shorts, stayed to watch ${s.length ? `${avg(s).toFixed(1)}%` : "n/a"}`;
  };
  const changed = all.filter((r) => r.arm === "panel" && r.changed);
  const sides = [
    side(
      all.filter((r) => r.arm === "panel"),
      "panel arm",
    ),
    changed.length ? side(changed, "of which changed") : "",
    side(
      all.filter((r) => r.arm === "control"),
      "control arm",
    ),
  ].filter(Boolean);
  const paired = all.filter(
    (r) =>
      typeof r.stop === "number" &&
      typeof r.stayed === "number" &&
      Number.isFinite(r.stayed),
  );
  const rho =
    paired.length >= FIRST_SECOND_VERDICT_MIN
      ? corr(
          paired.map((r) => r.stop!),
          paired.map((r) => r.stayed!),
        )
      : undefined;
  const marks =
    paired.length < FIRST_SECOND_VERDICT_MIN
      ? `${paired.length} of ${FIRST_SECOND_VERDICT_MIN} Shorts so far`
      : `rank correlation ${rho === undefined ? "n/a" : rho.toFixed(2)} over ${paired.length} Shorts`;
  const read = all.filter((r) => typeof r.gives_away === "boolean");
  const away = read.filter((r) => r.gives_away).length;
  return [
    `First second (FIRST_SECOND_PANEL), by arm: ${sides.join("; ")}.`,
    `First-second stop mark against stayed to watch (engaged views over views): ${marks}; the first-frame text gave the answer away on ${away} of ${read.length} read.`,
  ];
}
