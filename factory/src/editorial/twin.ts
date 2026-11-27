// The twin channel's script: a published Short's script carried into another language by a model, with
// every number, price, date, name and title left exactly as it was. The cards keep their shape (kinds,
// dates, values, rows); only the words on them are translated. A translation that changes a figure is
// sent back once, then dropped: a twin must never say something the original did not.

import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { Script } from "./schema.ts";

export const LANGUAGE_NAMES: Record<string, string> = {
  es: "Spanish (neutral Latin American, as a gaming news channel for Mexico, Colombia, Argentina and Spain would write; usted never, tú always)",
  pt: "Brazilian Portuguese",
  de: "German",
  fr: "French",
  it: "Italian",
};

export const TwinScriptSchema = z.object({
  headline: z.string().describe("The on-screen headline, 3-8 words"),
  hook: z.string().describe("The first spoken line"),
  beats: z
    .array(
      z.object({
        narration: z.string(),
        primary: z
          .string()
          .describe(
            "The card's main text, translated; numbers, prices and dates exactly as given",
          ),
        secondary: z
          .string()
          .describe("The card's second line, translated, or empty as given"),
      }),
    )
    .describe(
      "One per beat, in order: the narration and the card's two text lines",
    ),
  take_label: z
    .string()
    .describe("The take card's label, 1-3 words, uppercase in spirit"),
  take_narration: z.string(),
  take_on_screen: z.string().describe("3-8 words"),
  loop_line: z.string(),
  attribution: z.string().describe("e.g. 'Fuente: Xbox Wire / IGN'"),
  youtube_title: z
    .string()
    .describe("Under 70 characters, the game or company named early"),
  youtube_description: z
    .string()
    .describe("2-4 sentences, then the sources by name; no hashtags"),
  youtube_tags: z
    .array(z.string())
    .describe("Up to 15 tags in the language, the game's names kept"),
  pinned_comment: z
    .string()
    .describe(
      "The channel's first comment: the take in one line, then a question a viewer answers in one word",
    ),
});
export type TwinScript = z.infer<typeof TwinScriptSchema>;

export function twinPrompt(language: string): string {
  const name = LANGUAGE_NAMES[language] ?? language;
  return `You translate a gaming news channel's Short into ${name}. The channel, Pulse Gaming, speaks as "we" (nosotros) to the viewer as "you" (tú): relaxed, specific, dryly funny, never shouting. Translate meaning and tone, not word by word, so it reads as written in the language.
Hard rules:
- Every number, price, date, percentage, score, platform name, game title, company name, person's name and quotation stays exactly as in the original. "$69.99" stays "$69.99"; "November 19" becomes the language's natural form of the same date; a game title is never translated. Magnitude words are translated correctly, never left in English: "$10 billion" is "10 mil millones de dólares" in Spanish, "230 million" is "230 millones".
- Keep each spoken line about as long as the original (the video's timing depends on it): no added sentences, no dropped facts.
- Rumours stay rumours: where the original says "reportedly" or names who reported it, the translation does too.
- Hashtags are not part of the text; do not add any. No English left over except names and titles.
- The YouTube title is a sharp headline in the language, under 70 characters, no colon template, no clickbait.`;
}

const FIGURE = /\d[\d,.]*/g;

/** The figures in a text, normalised, as a sorted list: what a translation must carry unchanged. */
export function figuresOf(text: string): string[] {
  return (text.match(FIGURE) ?? [])
    .map((f) => f.replace(/[,.]/g, ""))
    .filter(Boolean)
    .sort();
}

/** The figures the translation lost or invented, as feedback; empty when they match. */
export function figureDrift(original: string, translated: string): string[] {
  const a = figuresOf(original);
  const b = figuresOf(translated);
  const missing = a.filter((x) => !b.includes(x));
  const extra = b.filter((x) => !a.includes(x));
  const out: string[] = [];
  if (missing.length)
    out.push(
      `These figures from the original are missing or changed: ${[...new Set(missing)].join(", ")}.`,
    );
  if (extra.length)
    out.push(
      `These figures are not in the original: ${[...new Set(extra)].join(", ")}.`,
    );
  return out;
}

function spokenOf(t: {
  hook: string;
  beats: Array<{ narration: string }>;
  take_narration: string;
  loop_line: string;
}): string {
  return [
    t.hook,
    ...t.beats.map((b) => b.narration),
    t.take_narration,
    t.loop_line,
  ].join(" ");
}

/** The original's script in the language, as a Script the rest of the factory can voice, render and upload. */
export async function translateScript(
  llm: Llm,
  original: Script,
  language: string,
  ids: { parent: string; parentVideo: string },
): Promise<{ script: Script; problems: string[] }> {
  const source = [
    `Headline: ${original.headline}`,
    `Hook: ${original.hook}`,
    ...original.beats.map(
      (b, i) =>
        `Beat ${i + 1}: ${b.narration}\n  card primary: ${b.visual.primary}\n  card secondary: ${b.visual.secondary}`,
    ),
    `Take label: ${original.pulse_take.label}`,
    `Take: ${original.pulse_take.narration}`,
    `Take on screen: ${original.pulse_take.on_screen}`,
    `Loop line: ${original.loop_line}`,
    `Attribution: ${original.attribution}`,
    `YouTube title: ${original.youtube.title}`,
    `YouTube description: ${original.youtube.description}`,
    `Tags: ${original.youtube.tags.join(", ")}`,
    `Rumour: ${original.is_rumour ? "yes" : "no"}`,
  ].join("\n");
  const spoken = [
    original.hook,
    ...original.beats.map((b) => b.narration),
    original.pulse_take.narration,
    original.loop_line,
  ].join(" ");
  let feedback: string[] = [];
  let t: TwinScript | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    t = await llm.structured({
      system: twinPrompt(language),
      content: `${source}${feedback.length ? `\n\nA previous translation was rejected. Fix every one of these:\n${feedback.map((f) => `- ${f}`).join("\n")}` : ""}`,
      schema: TwinScriptSchema,
      effort: "low",
      tier: "mid",
    });
    if (t.beats.length !== original.beats.length) {
      feedback = [
        `Return exactly ${original.beats.length} beats, one per original beat, in order.`,
      ];
      continue;
    }
    feedback = figureDrift(spoken, spokenOf(t));
    if (!feedback.length) break;
  }
  if (!t || t.beats.length !== original.beats.length)
    throw new Error("translation did not keep the beats");
  const script: Script = {
    ...original,
    headline: t.headline,
    hook: t.hook,
    beats: original.beats.map((b, i) => ({
      ...b,
      narration: t!.beats[i]!.narration,
      visual: {
        ...b.visual,
        primary: t!.beats[i]!.primary || b.visual.primary,
        secondary: t!.beats[i]!.secondary ?? b.visual.secondary,
      },
    })),
    pulse_take: {
      ...original.pulse_take,
      label: t.take_label || original.pulse_take.label,
      narration: t.take_narration,
      on_screen: t.take_on_screen,
    },
    loop_line: t.loop_line,
    attribution: t.attribution || original.attribution,
    youtube: {
      title: t.youtube_title.slice(0, 100),
      description: t.youtube_description,
      tags: t.youtube_tags.slice(0, 15),
    },
    twin: {
      parent: ids.parent,
      parent_video: ids.parentVideo,
      language,
      pinned: t.pinned_comment,
    },
  };
  return { script, problems: feedback };
}

/** The spoken text of a twin, as written: no English number-to-words pass, the voice reads the figures in its language. */
export function twinNarration(s: Script): string {
  return [
    s.hook,
    ...s.beats.map((b) => b.narration),
    s.pulse_take.narration,
    s.loop_line,
  ]
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" ");
}

/** The description's fixed lines in the twin's language. */
export function twinFooter(language: string, parentUrl: string): string[] {
  if (language === "es")
    return [
      `Versión en español de nuestro Short en inglés: ${parentUrl}`,
      "Narración: voz sintética generada por IA. Imágenes: material oficial del editor, acreditado.",
      "Pulse Gaming en Español: noticias de videojuegos, verificadas y explicadas. Shorts nuevos todos los días.",
    ];
  return [
    `Original: ${parentUrl}`,
    "Narration: AI-generated synthetic voice. Visuals: official publisher material, credited.",
  ];
}
