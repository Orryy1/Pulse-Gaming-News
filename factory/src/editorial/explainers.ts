// The explainer pass (EXPLAINERS, 20 Nov 2026): after the writer has settled a Short or a documentary chapter, one
// call marks the lines that explain HOW something works ("Scooter Bros brings your car to you for a fee", "pre-load
// starts at midnight local time", "the price went from $70 to $80") with an explainer: its shape and its items, every
// word taken from the script and its sources. The guard (src/render/components/explainers/ground.ts) then keeps only
// what the text supports, and the renderer draws it (src/render/components/explainers). Lines that only state one
// fact keep their fact cards: an explainer is for a mechanism, a sequence or a sum.

import { z } from "zod";
import type { Script } from "./schema.ts";
import type { Llm } from "./llm.ts";
import { ICON_NAMES } from "../render/components/explainers/icons.ts";
import { groundExplainer } from "../render/components/explainers/ground.ts";
import type { Orientation } from "../render/components/explainers/layout.ts";
import {
  EXPLAINER_TYPES,
  EXPLAINER_WORDS,
  OBJECT_KINDS,
  type Explainer,
} from "../render/components/explainers/types.ts";

/** A Short's explainer, on one of its beats or on its take. */
export interface ShortExplainer {
  part: "beat" | "take";
  /** The beat's index (0 for the take). */
  index: number;
  explainer: Explainer;
}

/** The most explainers a Short and a documentary chapter carry: they are for the lines that need them. */
export const SHORT_EXPLAINERS_MAX = 2;
export const CHAPTER_EXPLAINERS_MAX = 3;

const ItemSchema = z.object({
  label: z
    .string()
    .describe(
      "1-5 words on screen, taken from the line, the script or the sources",
    ),
  value: z
    .string()
    .describe(
      "versus, timeline and howmuch only: the figure or time beside the label as the text writes it (at most 16 characters, e.g. '$79.99', '+$20', '6 a.m. ET', '30 FPS target'); empty for every other type",
    ),
  icon: z
    .enum(["", ...ICON_NAMES] as [string, ...string[]])
    .describe("A generic icon for the item, or empty"),
  cue: z
    .string()
    .describe(
      "1-4 consecutive words copied exactly from the line, where the narrator says this item",
    ),
  lead: z
    .boolean()
    .describe("versus only: true for the side the line is about"),
});

export const ExplainerMarksSchema = z.object({
  explainers: z
    .array(
      z.object({
        line: z
          .number()
          .int()
          .describe("The number of the line this explainer draws"),
        type: z.enum(EXPLAINER_TYPES),
        title: z
          .string()
          .describe(
            "A 1-5 word heading made of the line's own words, or empty",
          ),
        object: z
          .enum(["", ...OBJECT_KINDS] as [string, ...string[]])
          .describe("object3d only: what is built; empty otherwise"),
        items: z.array(ItemSchema).max(4),
      }),
    )
    .max(CHAPTER_EXPLAINERS_MAX),
});
export type ExplainerMarks = z.infer<typeof ExplainerMarksSchema>;

export const EXPLAINERS_PROMPT = `You are the motion-graphics designer of Pulse Gaming, a gaming news channel whose videos explain things visually, the way the best explainer creators do. You get a script as numbered lines and the sources it was written from. Mark an explainer only on a line that explains HOW something works, so a clean animated diagram would make it clearer than footage:
- steps: a process in order, 2-4 steps (join the queue, pick a class, the match starts).
- versus: a before and after, or this against that: exactly 2 sides, each a label and a value ($79.99 against $99.99; 30 FPS on both).
- chain: a cause and its effects, 2-4 links, each leading to the next (the servers fill, the queue grows, players wait longer).
- timeline: when things happen, 2-4 stops in time order, each a time as the value and what happens as the label.
- howmuch: how a price or number adds up, 2-3 rows: the starting figure, the change written with + or - (e.g. "+$20"), and the result. The figures must add up.
- cycle: something that comes back round, 3-4 stages.
- anatomy: 2-4 things the line names that a game screenshot would show (a car's trunk, a character's clothes), each a short label.
- object3d: 2-3 labels about a console, controller, disc or handheld the line is about; name a part (disc drive, sticks, screen) only when the line does.
Most lines are not explainers. Never mark a line that only states one fact (one date, one score, one number, one name): the fact cards already draw those. At most {MAX} explainers, never on two lines in a row, never on the opening line or the closing line.
Every word and figure on screen comes from the line, the script or the sources: no new facts, names, numbers, units, time zones or prices, and no words of your own beyond plain joining words. Labels are 1-5 words; values at most 16 characters; the cue is 1-4 words copied exactly from that line where the narrator says that item, in the order the items are said. Use British English. Return an empty list when no line explains a mechanism, a sequence or a sum.`;

/** The numbered lines a Short offers the pass: the hook, the beats, the take and the loop line (hook and loop are context only). */
export function shortLines(
  script: Script,
): Array<{ text: string; part?: "beat" | "take"; index: number }> {
  return [
    { text: script.hook, index: 0 },
    // A ranked entry's line keeps its rank card: the viewer came to read it.
    ...script.beats.map((b, i) => ({
      text: b.narration,
      ...(b.visual?.kind === "rank" ? {} : { part: "beat" as const }),
      index: i,
    })),
    // The take keeps its verdict card: it is the payoff the Short builds to.
    { text: script.pulse_take.narration, index: 0 },
    { text: script.loop_line, index: 0 },
  ];
}

/** The script's own sources as the pass and the guard read them: its claims and their attribution. */
export function shortSources(script: Script): string[] {
  const claims = (
    (script as { claims?: Array<{ claim?: string }> }).claims ?? []
  )
    .map((c) => c.claim ?? "")
    .filter(Boolean);
  // The script's own fact cards were written and fact-checked with it: their words count as the script's.
  const cards = script.beats.flatMap((b) =>
    b.visual && b.visual.kind !== "none"
      ? [b.visual.primary, b.visual.secondary, ...(b.visual.items ?? [])]
      : [],
  );
  return [
    ...claims,
    ...cards,
    script.headline,
    (script as { attribution?: string }).attribution ?? "",
  ].filter(Boolean);
}

/**
 * The marks made real (pure): each mark on a line that may carry one, grounded against the whole script and its
 * sources, at most `max`, never two on neighbouring lines. Returns what was kept and every reason something was not.
 */
export function groundMarks(
  marks: ExplainerMarks,
  o: {
    lines: Array<{ text: string; eligible: boolean }>;
    texts: string[];
    orientation: Orientation;
    max: number;
  },
): { kept: Array<{ line: number; explainer: Explainer }>; dropped: string[] } {
  const kept: Array<{ line: number; explainer: Explainer }> = [];
  const dropped: string[] = [];
  for (const m of marks.explainers) {
    const k = m.line - 1;
    const line = o.lines[k];
    const name = `line ${m.line} ${m.type}`;
    if (!line || !line.eligible) {
      dropped.push(`${name}: that line cannot carry an explainer`);
      continue;
    }
    if (kept.length >= o.max) {
      dropped.push(`${name}: already ${o.max}`);
      continue;
    }
    if (kept.some((x) => Math.abs(x.line - k) <= 1)) {
      dropped.push(`${name}: the line beside it has one`);
      continue;
    }
    const raw: Explainer = {
      type: m.type,
      title: m.title,
      items: m.items.map((it) => ({
        label: it.label,
        value: it.value,
        icon: (it.icon || undefined) as Explainer["items"][number]["icon"],
        cue: it.cue,
        lead: it.lead || undefined,
      })),
      ...(m.object ? { object: m.object as Explainer["object"] } : {}),
    };
    const g = groundExplainer(raw, {
      line: line.text,
      texts: o.texts,
      orientation: o.orientation,
    });
    dropped.push(...g.dropped.map((d) => `${name}: ${d}`));
    if (g.explainer) kept.push({ line: k, explainer: g.explainer });
  }
  return { kept, dropped };
}

function numbered(lines: string[]): string {
  return lines.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

/** A Short's explainers: one call, then the guard. Never throws past the caller's catch; an empty list is normal. */
export async function markShortExplainers(
  llm: Llm,
  script: Script,
): Promise<{ explainers: ShortExplainer[]; dropped: string[] }> {
  const lines = shortLines(script);
  const sources = shortSources(script);
  const marks = await llm.structured({
    system: EXPLAINERS_PROMPT.replace("{MAX}", String(SHORT_EXPLAINERS_MAX)),
    content: `Game: ${script.game_title}\n\nScript lines:\n${numbered(lines.map((l) => l.text))}\n\nSources:\n${sources.map((s) => `- ${s}`).join("\n") || "(none)"}`,
    schema: ExplainerMarksSchema,
    tier: "mid",
    effort: "low",
    maxTokens: 3000,
    site: "short.explainers",
  });
  const g = groundMarks(marks, {
    lines: lines.map((l) => ({ text: l.text, eligible: !!l.part })),
    texts: [...lines.map((l) => l.text), ...sources],
    orientation: "tall",
    max: SHORT_EXPLAINERS_MAX,
  });
  return {
    explainers: g.kept.map((k) => ({
      part: lines[k.line]!.part!,
      index: lines[k.line]!.index,
      explainer: k.explainer,
    })),
    dropped: g.dropped,
  };
}

/** A documentary chapter's explainers by sentence index: one call over its sentences and source, then the guard. */
export async function markChapterExplainers(
  llm: Llm,
  chapter: {
    game: string;
    sentences: string[];
    source: string;
    taken?: Set<number>;
  },
): Promise<{ explainers: Map<number, Explainer>; dropped: string[] }> {
  const marks = await llm.structured({
    system: EXPLAINERS_PROMPT.replace("{MAX}", String(CHAPTER_EXPLAINERS_MAX)),
    content: `Game: ${chapter.game}\n\nChapter sentences:\n${numbered(chapter.sentences)}\n\nSource:\n${chapter.source.slice(0, 12000) || "(none)"}`,
    schema: ExplainerMarksSchema,
    tier: "mid",
    effort: "low",
    maxTokens: 4000,
    site: "doc.explainers",
  });
  const g = groundMarks(marks, {
    lines: chapter.sentences.map((text, i) => ({
      text,
      eligible: i > 0 && !chapter.taken?.has(i),
    })),
    texts: [...chapter.sentences, chapter.source],
    orientation: "wide",
    max: CHAPTER_EXPLAINERS_MAX,
  });
  return {
    explainers: new Map(g.kept.map((k) => [k.line, k.explainer])),
    dropped: g.dropped,
  };
}

/** One line for the log: what each explainer is. */
export function explainersNote(list: Array<{ explainer: Explainer }>): string {
  return list
    .map(
      (x) =>
        `${EXPLAINER_WORDS[x.explainer.type]} (${x.explainer.items.map((i) => i.label).join(" / ")})`,
    )
    .join("; ");
}
