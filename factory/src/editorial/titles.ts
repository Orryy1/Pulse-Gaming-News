// Title variants for YouTube's Test & compare (owner, 28 Oct 2026: "title and thumbnail testing on every
// long video"). Two alternatives to a long video's title, each leading with a different hook, so the test
// learns which kind of title the audience clicks.
import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { Script } from "./schema.ts";
import { advertiserProblems } from "./voice.ts";

export const TitleVariantsSchema = z.object({
  titles: z
    .array(z.string())
    .min(2)
    .max(2)
    .describe("Exactly two alternative titles, each under 70 characters"),
});

export const TITLE_VARIANTS_PROMPT = `You write alternative YouTube titles for a long gaming video (a documentary, a ranking or a weekly recap) so the channel can test them against its current title.
Write exactly two, each leading with a different hook from the current title and from each other: one built on a number or a stake (years, money, copies, a record), one built on a question or a gap the viewer wants closed.
Rules: under 70 characters; keep the game or series name in it; American spelling; title case with small words lowercase; no emoji, no all-caps words, no exclamation marks; never claim anything the current title and description do not support; no advertiser-unfriendly words (death, kill, war, crisis, attack, shocking, horror); no em dashes.`;

/** Two alternatives to the title, checked; fewer when the writer's fail the checks. */
export async function titleVariants(
  llm: Llm,
  script: Script,
): Promise<string[]> {
  const r = await llm.structured({
    site: "titles.long",
    tier: "mid",
    system: TITLE_VARIANTS_PROMPT,
    content: `Current title: ${script.youtube.title}\nThumbnail words: ${script.youtube.thumb_text ?? ""}\nDescription: ${script.youtube.description.slice(0, 900)}`,
    schema: TitleVariantsSchema,
    effort: "low",
    maxTokens: 2000,
  });
  const seen = new Set([script.youtube.title.toLowerCase().trim()]);
  return r.titles
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => {
      const k = t.toLowerCase();
      const ok =
        t.length >= 12 &&
        t.length <= 90 &&
        !seen.has(k) &&
        !/[—–!]/.test(t) &&
        !advertiserProblems(t).length;
      seen.add(k);
      return ok;
    });
}
