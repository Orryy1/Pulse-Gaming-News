import { z } from "zod";

export const STORY_TYPES = [
  "release_date",
  "delay",
  "price",
  "sales",
  "reveal",
  "trailer",
  "update",
  "rumour",
  "review_scores",
  "hardware",
  "industry",
  "other",
] as const;

export const VISUAL_KINDS = ["title", "stat", "date", "quote", "list", "none", "timeline", "price", "score", "countdown", "compare"] as const;

export const SelectionSchema = z.object({
  candidate_index: z.number().describe("Index of the chosen candidate, or -1 if none is good enough"),
  reason: z.string(),
  story_type: z.enum(STORY_TYPES),
  game_title: z.string().describe("Exact official game title, or empty string if the story is not about one game"),
});
export type Selection = z.infer<typeof SelectionSchema>;

export const BeatSchema = z.object({
  narration: z.string().describe("One or two short spoken sentences"),
  visual: z.object({
    kind: z.enum(VISUAL_KINDS),
    primary: z.string().describe("Big on-screen text: a number, date, short quote or 2-5 word phrase. For price: the new price as written, e.g. £69.99. For score: the score as written. Empty for kind none"),
    secondary: z.string().describe("Small label under the primary text. May be empty"),
    date_from: z.string().optional().describe("timeline only: the old date as ISO YYYY-MM or YYYY-MM-DD"),
    date_to: z.string().optional().describe("timeline and countdown: the new or target date as ISO YYYY-MM or YYYY-MM-DD"),
    was: z.string().optional().describe("price only: the previous price as written, if the story gives one"),
    region: z.string().optional().describe("price only: region or platform the price applies to, e.g. UK or PS5"),
    value_a: z.number().optional().describe("score only: the score 0-100"),
    items: z.array(z.string()).max(5).optional().describe("compare: 2-5 rows as label:value, the subject row marked with a leading *; score: up to 3 outlet names"),
  }),
});

export const ScriptSchema = z.object({
  story_type: z.enum(STORY_TYPES),
  game_title: z.string(),
  steam_search_term: z.string().describe("Term to find the game on the Steam store, or empty string"),
  headline: z.string().describe("On-screen headline, 3-8 words, no clickbait"),
  hook: z.string().describe("First spoken line: the news itself, 6-16 words"),
  beats: z.array(BeatSchema).describe("2-4 fact beats"),
  pulse_take: z.object({
    label: z.string().describe("Short card label such as WHY IT MATTERS, THE CONTEXT or OUR READ"),
    narration: z.string().describe("The Pulse angle: context, comparison or a clearly framed verdict"),
    on_screen: z.string().describe("3-8 word on-screen summary of the take"),
  }),
  loop_line: z.string().describe("Final spoken line that ties back to the hook so a rewatch feels seamless"),
  is_rumour: z.boolean(),
  attribution: z.string().describe("On-screen source credit, e.g. 'Source: Xbox Wire / IGN'"),
  youtube: z.object({
    title: z.string().describe("Front-load the game name, factual, under 90 characters"),
    description: z.string().describe("2-4 sentences plus source credits. No hashtags in the body"),
    tags: z.array(z.string()),
  }),
  claims: z.array(
    z.object({
      claim: z.string(),
      source_url: z.string().describe("URL of the provided source that supports the claim"),
    }),
  ),
});
export type Script = z.infer<typeof ScriptSchema>;
export type BeatVisual = z.infer<typeof BeatSchema>["visual"];

export const FactCheckSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  issues: z.array(
    z.object({
      quote: z.string().describe("The exact script text with the problem"),
      problem: z.string(),
      severity: z.enum(["blocker", "minor"]),
    }),
  ),
  rumour_labelling_ok: z.boolean(),
  summary: z.string(),
});
export type FactCheck = z.infer<typeof FactCheckSchema>;

export const VisionQaSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  problems: z.array(z.string()),
  notes: z.string(),
});
export type VisionQa = z.infer<typeof VisionQaSchema>;

export function narrationOf(s: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">): string {
  return [s.hook, ...s.beats.map((b) => b.narration), s.pulse_take.narration, s.loop_line]
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" ");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
