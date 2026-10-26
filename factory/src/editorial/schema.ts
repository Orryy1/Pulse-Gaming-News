import { z } from "zod";
import { speakable } from "../voice/speakable.ts";

export const STORY_TYPES = [
  "explainer",
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

export const VISUAL_KINDS = [
  "title",
  "stat",
  "date",
  "quote",
  "list",
  "none",
  "timeline",
  "price",
  "score",
  "countdown",
  "compare",
  "rank",
  "platforms",
  "versus",
  "specs",
  "milestones",
  "chapter",
] as const;

export const SelectionSchema = z.object({
  candidate_index: z
    .number()
    .describe("Index of the chosen candidate, or -1 if none is good enough"),
  reason: z.string(),
  story_type: z.enum(STORY_TYPES),
  game_title: z
    .string()
    .describe(
      "Exact official game title, or empty string if the story is not about one game",
    ),
  visual_dependency: z
    .enum(["none", "game_footage", "real_world_images"])
    .describe(
      "What a viewer must SEE for the story to land. none: the fact stands on its own (a date, a price, a delay, a number). game_footage: official trailers or store art of the game cover it. real_world_images: the point is real-world photos or video, leaked images, screenshots only outlets or fans have, merchandise, stunts, cosplay, fan creations or a new trailer's own shots",
    ),
});
export type Selection = z.infer<typeof SelectionSchema>;

export const FOOTAGE_WANTS = [
  "gameplay",
  "cinematic",
  "character",
  "world",
  "vehicle",
  "ui",
  "calm",
  "none",
] as const;
export const FootageSchema = z.object({
  want: z
    .enum(FOOTAGE_WANTS)
    .describe("What the picture should show while this line is spoken"),
  keywords: z
    .array(z.string())
    .max(4)
    .describe(
      "The thing, place, character or action the line names, 1-4 short terms",
    ),
});

export const BeatSchema = z.object({
  narration: z.string().describe("One or two short spoken sentences"),
  footage: FootageSchema.optional(),
  visual: z.object({
    kind: z.enum(VISUAL_KINDS),
    primary: z
      .string()
      .describe(
        "Big on-screen text: a number, date, short quote or 2-5 word phrase. For price: the new price as written, e.g. £69.99. For score: the score as written. Empty for kind none",
      ),
    secondary: z
      .string()
      .describe("Small label under the primary text. May be empty"),
    date_from: z
      .string()
      .optional()
      .describe("timeline only: the old date as ISO YYYY-MM or YYYY-MM-DD"),
    date_to: z
      .string()
      .optional()
      .describe(
        "timeline and countdown: the new or target date as ISO YYYY-MM or YYYY-MM-DD",
      ),
    was: z
      .string()
      .optional()
      .describe(
        "price only: the previous price as written, if the story gives one",
      ),
    region: z
      .string()
      .optional()
      .describe(
        "price only: region or platform the price applies to, e.g. UK or PS5",
      ),
    value_a: z.number().optional().describe("score only: the score 0-100"),
    items: z
      .array(z.string())
      .max(6)
      .optional()
      .describe(
        "compare: 2-5 rows as label:value, the subject row marked with a leading *; score: up to 3 outlet names; price: the same price in other currencies; platforms: 1-6 platform names; versus: exactly 2 rows as label:value, the subject marked with *; specs: 2-6 rows as label:value; milestones: 3-5 rows as ISO date:label, e.g. 2023-12:Trailer 1",
      ),
  }),
});

export const ScriptSchema = z.object({
  story_type: z.enum(STORY_TYPES),
  game_title: z.string(),
  steam_search_term: z
    .string()
    .describe("Term to find the game on the Steam store, or empty string"),
  headline: z.string().describe("On-screen headline, 3-8 words, no clickbait"),
  hook: z
    .string()
    .describe("First spoken line: the news itself in 5-10 words, game named"),
  beats: z.array(BeatSchema).describe("2-4 fact beats"),
  pulse_take: z.object({
    label: z
      .string()
      .describe(
        "Short card label such as WHY IT MATTERS, THE CONTEXT or THE TAKEAWAY",
      ),
    narration: z
      .string()
      .describe(
        "The Pulse angle: context, comparison or a clearly framed verdict",
      ),
    on_screen: z.string().describe("3-8 word on-screen summary of the take"),
  }),
  hook_footage: FootageSchema.optional().describe(
    "What the opening footage should show",
  ),
  person: z
    .string()
    .optional()
    .describe(
      "The real, well-known person this story is about when one person is the story (a director, executive, actor, streamer), as commonly written, e.g. 'Hideo Kojima'; empty when the story is about a game, a company or a product",
    ),
  loop_line: z
    .string()
    .describe(
      "Final spoken line that ties back to the hook so a rewatch feels seamless",
    ),
  stamp: z
    .object({
      word: z
        .string()
        .describe(
          "The single spoken word it lands on, exactly as written in the narration (e.g. 'November', 'delayed', '$49.99')",
        ),
      text: z
        .string()
        .describe(
          "1-3 words in capitals, 14 characters at most, e.g. 'NOV 19', 'DELAYED', 'FREE', '$49.99'",
        ),
      sub: z
        .string()
        .describe(
          "0-2 words under it, e.g. 'CONFIRMED', 'TO 2027', 'THIS WEEK', or empty",
        ),
      tone: z
        .enum(["confirm", "alert", "price", "neutral"])
        .describe(
          "confirm: official news; alert: a delay, a cut, a rumor; price: money; neutral: anything else",
        ),
    })
    .optional()
    .describe(
      "One rubber-stamp moment on the word that carries the news; omit when nothing deserves it",
    ),
  desk_question: z
    .string()
    .optional()
    .describe(
      "The one question a viewer would ask before the take, as a second presenter at the desk would say it to the narrator: 5-12 words, ends with '?', e.g. 'So is it worth $70 on day one?'",
    ),
  is_rumour: z.boolean(),
  attribution: z
    .string()
    .describe("On-screen source credit, e.g. 'Source: Xbox Wire / IGN'"),
  hashtags: z
    .array(z.string())
    .optional()
    .describe(
      "3-5 hashtags fans of this story actually search, most specific first: the game's common short name (#GTA6), its series (#GTA), the company or platform (#RockstarGames). No generic tags (#gaming, #gamer, #fyp, #viral, #shorts), no spaces",
    ),
  youtube: z.object({
    title: z
      .string()
      .describe("Front-load the game name, factual, under 90 characters"),
    description: z
      .string()
      .describe("2-4 sentences plus source credits. No hashtags in the body"),
    tags: z.array(z.string()),
    thumb_text: z
      .string()
      .optional()
      .describe("Long videos only: the 1-4 words on the thumbnail"),
  }),
  claims: z.array(
    z.object({
      claim: z.string(),
      source_url: z
        .string()
        .describe("URL of the provided source that supports the claim"),
    }),
  ),
});
export type Script = z.infer<typeof ScriptSchema> & {
  /** Evergreen ranking Shorts carry their entries so media can be gathered per entry. */
  entries?: Array<{
    rank: number;
    game_title: string;
    steam_search_term: string;
    year: number;
    platforms: string;
    icon?: string;
    photos?: string[];
    moments?: import("./longform.ts").Moment[];
    /** A recap chapter: the Short whose checked media it reuses. */ from_episode?: string;
  }>;
  /** Which evergreen format produced the Short, for its title formula. */
  evergreen_format?:
    | "ranking"
    | "best_per_year"
    | "versus"
    | "years_later"
    | "still_good"
    | "release_radar"
    | "weekly_recap"
    | "rarest_achievements"
    | "hardest_achievements"
    | "documentary"
    | "steam_climbers"
    | "steam_deals";
  /** "long" for the weekly 16:9 ranking video; absent or "short" otherwise. */
  runtime?: "short" | "long";
  /** Long-form: the one criterion the ranking uses, shown under the title. */
  criterion?: string;
  /** Long-form: the kicker line under the intro title. */
  kicker?: string;
  /** Documentary: the articles the script was written from, credited in the description. */
  sources?: string[];
  /** The weekly news recap (a long video built on the documentary shape). */
  recap?: boolean;
  /** Long video: the entry whose media plays behind the outro, when it is not the last. */
  take_entry?: number;
  /** A Short cut from a long ranking: the full video, this entry's rank and the comment question. */
  cutdown?: {
    parent_video: string;
    rank: number;
    total: number;
    question: string;
    theme?: string;
  };
  /** A gameplay Short from the owner's own recordings: the test, its answer and the Leonida Intel page it belongs to. */
  gameplay?: {
    inbox_id: string;
    question: string;
    result: string;
    result_line: string;
    experiment_number: number;
    experiment_slug: string | null;
    radio: boolean;
  };
  /** A translated twin: the original's episode and video, the language, and its pinned comment in that language. */
  twin?: {
    parent: string;
    parent_video: string;
    language: string;
    pinned: string;
  };
};
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

const DANGLING =
  /[,;:\s]+(because|and|so|but|which|that|or|as|while|when|since|until|cause|cos|plus|then)\s*(\.\.\.|…)?\s*$/i;

/** A last line left hanging ("And that spark starts now, because"). */
export function loopLineUnfinished(line: string): boolean {
  const t = line.trim();
  return (
    DANGLING.test(t) ||
    /(\.\.\.|…)$/.test(t) ||
    (t.length > 0 && !/[.!?]["”')]?$/.test(t))
  );
}

/** The safety net when a rewrite still leaves it hanging: the dangling word goes and the sentence ends. */
export function tidyLoopLine(line: string): string {
  let t = line
    .trim()
    .replace(/(\.\.\.|…)$/, "")
    .trim();
  while (DANGLING.test(t)) t = t.replace(DANGLING, "").trim();
  if (t && !/[.!?]["”')]?$/.test(t)) t = `${t.replace(/[,;:]+$/, "")}.`;
  return t;
}

export function narrationOf(
  s: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
): string {
  return [
    s.hook,
    ...s.beats.map((b) => b.narration),
    s.pulse_take.narration,
    tidyLoopLine(s.loop_line),
  ]
    .map((t) => speakable(t.trim()))
    .filter(Boolean)
    .join(" ");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
