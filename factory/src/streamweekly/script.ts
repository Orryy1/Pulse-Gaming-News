// The words that link the owner's moments (the channel's narrator, between his clips). The owner's own game audio and
// reactions carry each moment; the narrator only sets a moment up, over the footage leading into it, so a viewer
// knows what is about to be tried or found, and never talks over the payoff or gives it away first.
//
// The writer is the factory's own (src/editorial/llm.ts, site "streamweekly.write", so CODEX_CALLS routes it), in
// the Pulse voice (src/editorial/voice.ts) with its fact rules: only what the owner said and did on stream, and the
// settled stream asks, may be stated. The cold-read clarity gate (src/editorial/clarity.ts) then judges the whole
// narration as heard; a flagged line is rewritten and every version passes the house checks below or the version
// before stands. With no writer at all (or a writer that fails twice) the links are written from fixed lines, so a
// week is never lost to an outage.

import { z } from "zod";
import type { Llm } from "../editorial/llm.ts";
import { PULSE_FACT_RULES, PULSE_VOICE, SIGN_OFF } from "../editorial/voice.ts";
import { TITLE_MAX, titleProblems } from "../editorial/seo.ts";
import {
  clarityGate,
  judgeClarity,
  rewriteLines,
  clarityLog,
  type ClarityJudgement,
} from "../editorial/clarity.ts";
import { spoilerProblems } from "../sceneindex/spoilers.ts";
import { DAILY_PLOT_WORDS } from "../gtadaily.ts";
import { errorMessage, log } from "../lib/util.ts";
import type { PlannedMoment, WeekPlan } from "./chapters.ts";
import type { MomentKind } from "./moments.ts";
import { shortGameName } from "./chapters.ts";
import { ADVERTISER, DASHES, PLUG, STORY_WORDS, SWEAR } from "./patterns.ts";

export const WRITE_SITE = "streamweekly.write";
export const SETUP_MAX_WORDS = 30;
export const INTRO_MAX_WORDS = 48;
export const OUTRO_MAX_WORDS = 40;
export const LABEL_MAX_WORDS = 6;

/** The whole narration: a key per spoken line, so the clarity rewrite can edit it line by line. */
export interface WeekScript {
  title: string;
  /** One sentence: what the week was about, for the clarity judge. */
  point: string;
  intro: string;
  /** Per moment (key `m<n>`, in the order they play): the setup line and the on-screen label. */
  moments: Array<{ key: string; setup: string; label: string }>;
  outro: string;
  /** "writer" or "fixed lines". */
  by: "writer" | "fixed";
  clarity?: Record<string, unknown>;
}

/** Every moment of the plan in play order, keyed m1, m2... (pure). */
export function playOrder(
  p: WeekPlan,
): Array<{ key: string; m: PlannedMoment; chapter: string }> {
  let n = 0;
  return p.chapters.flatMap((c) =>
    c.moments.map((m) => ({ key: `m${++n}`, m, chapter: c.title })),
  );
}

/** "GTA 6 Week 2: <what the week was>" within the title limit (pure). */
export function weekTitle(game: string, week: number, hook: string): string {
  const lead = `${shortGameName(game)} Week ${week}: `;
  const clean = hook.replace(DASHES, ": ").replace(/\s+/g, " ").trim();
  const fallback = "Best Moments, Tests and Discoveries";
  return (
    lead +
    (clean && lead.length + clean.length <= TITLE_MAX
      ? clean
      : fallback.length + lead.length <= TITLE_MAX
        ? fallback
        : "Best Moments")
  );
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

const WriterSchema = z.object({
  hook: z
    .string()
    .describe(
      "The title's second half after 'GTA 6 Week N: ', a few words that make someone click: what was tested, found or settled. Plain, no clickbait, no dashes.",
    ),
  point: z.string().describe("One sentence: what this week of streams showed."),
  intro: z
    .string()
    .describe(
      `Two or three spoken sentences, at most ${INTRO_MAX_WORDS} words, that open the video after a short teaser: what this week of streams has in it.`,
    ),
  moments: z
    .array(
      z.object({
        key: z
          .string()
          .describe("The moment's key, exactly as given (m1, m2...)"),
        setup: z
          .string()
          .describe(
            `One or two spoken sentences, at most ${SETUP_MAX_WORDS} words, said over the footage just before the moment: what is about to be tried, checked or found. Never the result.`,
          ),
        label: z
          .string()
          .describe(
            `An on-screen label of at most ${LABEL_MAX_WORDS} words naming the moment, e.g. "Can you outswim five stars?"`,
          ),
      }),
    )
    .describe("One entry per moment, in the order given."),
  outro: z
    .string()
    .describe(
      `One or two spoken sentences, at most ${OUTRO_MAX_WORDS} words, that close the week on its point. No requests to like, subscribe or watch anything.`,
    ),
});

/** The writer's instructions: the Pulse voice, its fact rules, and what this format needs. */
export function writerPrompt(game: string): string {
  return `${PULSE_VOICE}

${PULSE_FACT_RULES}

THIS FORMAT: the weekly compilation of our own ${shortGameName(game)} streams. The footage is our own play, recorded on stream, with the streamer's own voice and the game's sound. You write only the narrator's short links between the moments. Each moment plays in full with its own sound straight after your setup line, so:
- A setup line says what is about to be tried, checked or found, in plain words, so a viewer who joins on that moment knows what to watch for. It never says the result, the punchline or how it ends: the clip does that.
- Use only what the moment's transcript, its labels and any settled stream ask show. Never invent what happened, what anyone said, a number, a place name or a feature. If a transcript is thin, keep the setup general and honest ("Day 3, and the streamer finds out what the police do when you...") rather than guess.
- The streams are ours: "we" tried it, "on stream". Never claim a feeling or an experience beyond what the clip shows.
- No story spoilers: never mention missions' plots, characters' fates, cutscenes, twists or endings. Systems, the map, tests, secrets, myths and funny moments only.
- Keep it moving: setup lines vary their shape (a question, a dare, a claim to check, a scene). Never "next up", never the same opener twice.
- No calls to like, subscribe, comment or watch another video, and no dashes. The sign-off is added for you.`;
}

/** The writer's material: the week, then each moment with its day, chapter, kind, transcript and settled ask. */
export function writerContent(p: WeekPlan, notes: string[] = []): string {
  const moments = playOrder(p).map(({ key, m, chapter }) =>
    [
      `${key}: chapter "${chapter}", ${m.kind}${m.day ? `, Day ${m.day}` : ""}${m.recordedOn ? ` (${m.recordedOn})` : ""}, ${Math.round(m.end - m.start)} s`,
      m.ask
        ? `  settles the stream ask "${m.ask.question}": ${m.ask.result}`
        : "",
      `  what was said: ${clean(m.transcript).slice(0, 700) || "(nothing said)"}`,
      `  why it was picked: ${m.why.join("; ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return `${shortGameName(p.game)} Week ${p.week} (${p.dates.from} to ${p.dates.to}), ${p.chapters.length} chapters: ${p.chapters.map((c) => c.title).join(", ")}.\n\nMOMENTS, in the order they play:\n${moments.join("\n\n")}${notes.length ? `\n\nFIX THESE IN THIS VERSION:\n${notes.map((n) => `- ${n}`).join("\n")}` : ""}`;
}

/** A transcript as material: strong language starred out, so the writer never repeats it. */
const clean = (t: string) =>
  t.replace(new RegExp(SWEAR.source, "gi"), "[bleep]");

/** House checks on a script (pure): empty when it may be voiced. */
export function scriptProblems(
  s: Omit<WeekScript, "by">,
  p: WeekPlan,
  now = new Date(),
): string[] {
  const out: string[] = [];
  const keys = playOrder(p).map((x) => x.key);
  const got = s.moments.map((m) => m.key);
  if (keys.join() !== got.join())
    out.push(`The moments must be exactly ${keys.join(", ")} in that order.`);
  out.push(...titleProblems(s.title));
  if (ADVERTISER.test(s.title))
    out.push(
      `"${s.title.match(ADVERTISER)![0]}" in the title is not advertiser-friendly.`,
    );
  const spoken: Array<[string, string, number]> = [
    ["intro", s.intro, INTRO_MAX_WORDS],
    ...s.moments.map(
      (m) => [m.key, m.setup, SETUP_MAX_WORDS] as [string, string, number],
    ),
    ["outro", s.outro, OUTRO_MAX_WORDS],
  ];
  for (const [k, t, max] of spoken) {
    if (!t.trim()) out.push(`${k} is empty.`);
    if (words(t) > max)
      out.push(`${k} runs ${words(t)} words; at most ${max}.`);
    if (DASHES.test(t))
      out.push(`${k} has a dash; use a full stop or a comma.`);
    if (PLUG.test(t))
      out.push(
        `${k} asks the viewer to do something ("${t.match(PLUG)![0]}"); cut it.`,
      );
    if (SWEAR.test(t)) out.push(`${k} has strong language.`);
    if (STORY_WORDS.test(t) || DAILY_PLOT_WORDS.test(t))
      out.push(
        `${k} talks about the story ("${(t.match(STORY_WORDS) ?? t.match(DAILY_PLOT_WORDS))![0]}").`,
      );
  }
  for (const m of s.moments) {
    if (words(m.label) > LABEL_MAX_WORDS)
      out.push(
        `${m.key}'s label runs ${words(m.label)} words; at most ${LABEL_MAX_WORDS}.`,
      );
    if (DASHES.test(m.label) || ADVERTISER.test(m.label))
      out.push(`${m.key}'s label has a dash or an advertiser-unfriendly word.`);
  }
  const all = [
    s.title,
    s.intro,
    ...s.moments.flatMap((m) => [m.setup, m.label]),
    s.outro,
  ].join("\n");
  out.push(...spoilerProblems(all, now, [p.game]));
  return out;
}

const LEADS: Record<MomentKind, string[]> = {
  challenge: [
    "Here comes a stunt.",
    "One of the game's own challenges, done on stream.",
    "Watch the line on this one.",
  ],
  test: [
    "Time for a test.",
    "Here's one we had to try.",
    "Can it be done? We checked.",
  ],
  myth: [
    "People keep saying this works. We checked.",
    "Here's a claim worth checking.",
    "Myth or not? Watch.",
  ],
  hidden: [
    "Look closely at this one.",
    "Here's something easy to miss.",
    "This one's a proper find.",
  ],
  funny: [
    "This didn't go to plan.",
    "Watch what happens here.",
    "This one still gets a laugh.",
  ],
  action: [
    "Here's one of the best moments of the week.",
    "Hold on for this one.",
    "This is how a stream gets loud.",
  ],
};

/** The links from fixed lines (pure): used when there is no writer, and as the floor every writer version must beat. */
export function fixedScript(p: WeekPlan): WeekScript {
  const g = shortGameName(p.game);
  const order = playOrder(p);
  const used = new Map<string, number>();
  const moments = order.map(({ key, m }) => {
    const n = used.get(m.kind) ?? 0;
    used.set(m.kind, n + 1);
    const lead = LEADS[m.kind][n % LEADS[m.kind].length]!;
    // The day is said when it changes, not before every moment.
    const prev = order[order.findIndex((x) => x.key === key) - 1]?.m;
    const day = m.day && m.day !== prev?.day ? `Day ${m.day}. ` : "";
    const setup = m.ask
      ? `${day}You asked: ${m.ask.question.replace(/\?*$/, "?")} We tested it.`
      : `${day}${lead}`;
    const label = m.ask
      ? m.ask.question
      : (
          {
            test: "The test",
            myth: "Myth check",
            challenge: "Stunt challenge",
            hidden: "Hidden detail",
            funny: "Funny moment",
            action: "Best moment",
          } as const
        )[m.kind];
    return {
      key,
      setup,
      label: label.split(/\s+/).slice(0, LABEL_MAX_WORDS).join(" "),
    };
  });
  return {
    title: weekTitle(p.game, p.week, "Best Moments, Tests and Discoveries"),
    point: `The best of a week of ${g} streams.`,
    intro: `This is ${g} Week ${p.week}, the best of a week of our own streams. The tests, the surprises and the moments that went wrong, all in one place.`,
    moments,
    outro: `That's Week ${p.week}. ${SIGN_OFF}`,
    by: "fixed",
  };
}

/** The writer's answer as a script (pure); the sign-off is added word for word. */
export function fromWriter(
  p: WeekPlan,
  r: z.infer<typeof WriterSchema>,
): WeekScript {
  const outro = r.outro.trim();
  return {
    title: weekTitle(p.game, p.week, r.hook),
    point: r.point.trim(),
    intro: r.intro.trim(),
    moments: r.moments.map((m) => ({
      key: m.key.trim(),
      setup: m.setup.trim(),
      label: m.label.trim().replace(/[.]$/, ""),
    })),
    outro: outro.includes(SIGN_OFF)
      ? outro
      : `${outro}${/[.!?]$/.test(outro) ? "" : "."} ${SIGN_OFF}`,
    by: "writer",
  };
}

/**
 * The Pulse sign-off word for word at the end of the outro (pure): a clarity rewrite may trim the outro, and the
 * sign-off is added back rather than the whole rewrite thrown away. The parts of it left behind ("Play something
 * good this week.") are taken off first so it is never said twice.
 */
export function withSignOff<T extends { outro: string }>(s: T): T {
  if (s.outro.trim().endsWith(SIGN_OFF)) return s;
  let o = s.outro.trim();
  for (const part of SIGN_OFF.split(/(?<=\.)\s+/).reverse()) if (o.endsWith(part)) o = o.slice(0, -part.length).trim();
  return { ...s, outro: `${o}${!o || /[.!?]$/.test(o) ? "" : "."} ${SIGN_OFF}`.trim() };
}

/** The spoken lines as the clarity gate reads them: one key a line. */
export function scriptLines(s: WeekScript): Record<string, string> {
  return {
    intro: s.intro,
    ...Object.fromEntries(s.moments.map((m) => [m.key, m.setup])),
    outro: s.outro,
  };
}

function withLines(s: WeekScript, lines: Record<string, string>): WeekScript {
  return {
    ...s,
    intro: lines.intro ?? s.intro,
    moments: s.moments.map((m) => ({ ...m, setup: lines[m.key] ?? m.setup })),
    outro: lines.outro ?? s.outro,
  };
}

/**
 * The week's narration: written (two tries), judged cold for clarity and fixed, every version held to the house
 * checks. Never throws: with no usable writer it returns the fixed lines.
 */
export async function writeWeek(
  p: WeekPlan,
  llm: Llm | undefined,
  o: { now?: Date; clarity?: boolean; clarityMin?: number } = {},
): Promise<WeekScript> {
  const now = o.now ?? new Date();
  const fixed = fixedScript(p);
  if (!llm) return fixed;
  let notes: string[] = [];
  let draft: WeekScript | undefined;
  for (let attempt = 0; attempt < 2 && !draft; attempt++) {
    try {
      const r = await llm.structured({
        site: WRITE_SITE,
        tier: "top",
        effort: "medium",
        system: writerPrompt(p.game),
        content: writerContent(p, notes),
        schema: WriterSchema,
      });
      const s = fromWriter(p, r);
      const bad = scriptProblems(s, p, now);
      if (bad.length) notes = bad;
      else draft = s;
    } catch (err) {
      log("warn", "stream weekly: writer failed", { error: errorMessage(err) });
      notes = [];
    }
  }
  if (!draft) {
    log(
      "warn",
      "stream weekly: writer gave no usable script; fixed lines used",
      { problems: notes.slice(0, 4) },
    );
    return fixed;
  }
  if (o.clarity === false) return draft;
  const accept = async (_b: WeekScript, a: WeekScript) =>
    scriptProblems(a, p, now);
  const gate = await clarityGate<WeekScript>({
    value: draft,
    judge: (v) =>
      judgeClarity(llm, {
        lines: Object.values(scriptLines(v)),
        intended: v.point,
        title: v.title,
        format: "chapter",
      }),
    rewrite: async (v: WeekScript, j: ClarityJudgement, plain: boolean) =>
      withLines(
        v,
        await rewriteLines(llm, "chapter", scriptLines(v), j, {
          plain,
          min: o.clarityMin ?? 8,
        }),
      ),
    accept,
    min: o.clarityMin,
  });
  return { ...withSignOff(gate.value), clarity: clarityLog(gate) };
}
