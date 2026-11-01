// Title variants for YouTube's Test & compare (owner, 28 Oct 2026: "title and thumbnail testing on every
// long video"). Two alternatives to a long video's title, each leading with a different hook, so the test
// learns which kind of title the audience clicks. With TITLE_ANGLES (growth plan move 5, 1 Nov 2026) the writer
// gives three angles in the winning shapes (a downfall, a hidden side, a comeback or an argument: see
// ./titleshape.ts) and the two that differ most from the current title's angle go to the test, so the test
// compares three distinct angles rather than three wordings of one.
import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { Script } from "./schema.ts";
import { advertiserProblems } from "./voice.ts";
import {
  TITLE_ANGLES,
  TITLE_SHAPE_RULE,
  distinctAngles,
  type TitleAngle,
} from "./titleshape.ts";

export const TitleVariantsSchema = z.object({
  titles: z
    .array(z.string())
    .min(2)
    .max(2)
    .describe("Exactly two alternative titles, each under 70 characters"),
});

export const TitleAnglesSchema = z.object({
  titles: z
    .array(
      z.object({
        angle: z
          .enum(TITLE_ANGLES)
          .describe(
            "downfall, hidden (the hidden side or what really happened), comeback, why, how or claim (a contested claim)",
          ),
        title: z.string().describe("Under 70 characters"),
      }),
    )
    .min(3)
    .max(3)
    .describe("Exactly three titles, each a different angle"),
});

export const TITLE_VARIANTS_PROMPT = `You write alternative YouTube titles for a long gaming video (a documentary, a ranking or a weekly recap) so the channel can test them against its current title.
Write exactly two, each leading with a different hook from the current title and from each other: one built on a number or a stake (years, money, copies, a record), one built on a question or a gap the viewer wants closed.
Rules: under 70 characters; keep the game or series name in it; American spelling; title case with small words lowercase; no emoji, no all-caps words, no exclamation marks; never claim anything the current title and description do not support; no advertiser-unfriendly words (death, kill, war, crisis, attack, shocking, horror); no em dashes.`;

export const TITLE_ANGLES_PROMPT = `You write alternative YouTube titles for a long gaming video (a documentary or a ranking) so the channel can test three angles against each other.
Write exactly three, each a different angle and each different from the current title's angle:
- downfall: the named subject and how it fell, failed or nearly ended ("How Anthem Ended BioWare's Winning Streak");
- hidden: its hidden side or what really happened ("What Really Happened to Rockstar's Agent", "The GTA 6 Nobody Saw");
- comeback: how it came back or was saved ("How Cyberpunk 2077 Saved Itself");
- why or how: an argument that closes a gap ("Why GTA 6 Took Thirteen Years");
- claim (rankings): a contested claim about the order ("Halo 3 Isn't the Best Halo Campaign").
Pick the three that this video's description honestly supports; a ranking has no downfall unless its subject had one.
${TITLE_SHAPE_RULE}
Rules: under 70 characters; keep the game or series name in it; American spelling; title case with small words lowercase; no emoji, no all-caps words, no exclamation marks; never claim anything the current title and description do not support; no advertiser-unfriendly words (death, kill, war, crisis, attack, shocking, horror); no em dashes.`;

const acceptable = (t: string) =>
  t.length >= 12 &&
  t.length <= 90 &&
  !/[—–!]/.test(t) &&
  !advertiserProblems(t).length;

/**
 * Two alternatives to the title, checked; fewer when the writer's fail the checks. With `angles`, three angles
 * are written and the two most distinct from the current title (and each other) are kept; `allow` lets back in a
 * title shape a test has shown to work (TITLE_SHAPE_ALLOW).
 */
export async function titleVariants(
  llm: Llm,
  script: Script,
  opts: { angles?: boolean; allow?: readonly string[] } = {},
): Promise<string[]> {
  return (await titleAngles(llm, script, opts)).map((x) => x.title);
}

/** As titleVariants, with each alternative's angle (the plain mode labels them by their words). */
export async function titleAngles(
  llm: Llm,
  script: Script,
  opts: { angles?: boolean; allow?: readonly string[] } = {},
): Promise<Array<{ title: string; angle: TitleAngle }>> {
  const content = `Current title: ${script.youtube.title}\nThumbnail words: ${script.youtube.thumb_text ?? ""}\nDescription: ${script.youtube.description.slice(0, 900)}`;
  if (opts.angles) {
    const r = await llm.structured({
      site: "titles.long",
      tier: "mid",
      system: TITLE_ANGLES_PROMPT,
      content,
      schema: TitleAnglesSchema,
      effort: "low",
      maxTokens: 2000,
    });
    return distinctAngles(
      script.youtube.title,
      r.titles
        .map((t) => ({ ...t, title: t.title.replace(/\s+/g, " ").trim() }))
        .filter((t) => acceptable(t.title)),
      opts.allow,
    );
  }
  const r = await llm.structured({
    site: "titles.long",
    tier: "mid",
    system: TITLE_VARIANTS_PROMPT,
    content,
    schema: TitleVariantsSchema,
    effort: "low",
    maxTokens: 2000,
  });
  const seen = new Set([script.youtube.title.toLowerCase().trim()]);
  return r.titles
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => {
      const k = t.toLowerCase();
      const ok = acceptable(t) && !seen.has(k);
      seen.add(k);
      return ok;
    })
    .map((title) => ({ title, angle: "plain" as TitleAngle }));
}
