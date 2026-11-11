// A rejected draft is fixed where the checks pointed instead of written again from nothing: the writer
// sees its own draft and the problems and sends back only the passages it changes. Opus output was most
// of the Claude bill (23-29 Oct: $9.29 of $25 was the writers), and nearly every news Short paid for a
// second full draft that repeated every line that had passed. The fixed draft goes through every check
// again; when an edit does not land on the draft's text, or the result breaks the format, the caller
// writes the whole draft again as before.

import { z } from "zod";
import type { Llm, Tier } from "./llm.ts";
import { errorMessage, log } from "../lib/util.ts";
import { voiceTagsField } from "../voice/tags.ts";

const EditsSchema = z.object({
  edits: z.array(
    z.object({
      find: z
        .string()
        .describe(
          "A passage copied exactly from the draft's text, character for character, long enough to appear only where it should change",
        ),
      replace: z.string().describe("What goes there instead"),
    }),
  ),
});

export type Edit = z.infer<typeof EditsSchema>["edits"][number];

const HOW = `Fix every problem above by editing your draft, not by writing it again. Return only the changes: for each, "find" is a passage copied exactly from the draft's text (character for character, with enough words to be unique) and "replace" is what goes there instead. Every line without a problem stays word for word. When a fix changes a fact, a name or a figure, change it everywhere it appears: narration, on-screen cards, title and description. Rewrite a whole sentence when that reads better than patching a few words, and keep the lines around each fix flowing. Every rule above still applies to the edited script. When a fix would need a fact the material doesn't have, cut the line; a sentence explaining what the material lacks is never a fix. A fix changes what the problem names and nothing else: the narrator's own takes ("I'd wait", "honestly, I think..."), the jokes and cheeky asides and the friendly rhythm stay as they are unless a problem is about them. When a factual fix lands inside a joke or a take, correct the fact and keep the joke or the take around it.`;

/** The draft with every edit applied to each text field it appears in, or undefined when an edit finds nothing. */
export function applyEdits<T>(draft: T, edits: Edit[]): T | undefined {
  if (!edits.length) return undefined;
  // A quote copied from the JSON view may keep its escapes (\" or \n).
  const unescape = (t: string) => {
    try {
      return JSON.parse(`"${t}"`) as string;
    } catch {
      return t;
    }
  };
  const landed = edits.map(() => false);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      let s = v;
      edits.forEach((e, i) => {
        for (const find of [e.find, unescape(e.find)]) {
          if (!find || !s.includes(find)) continue;
          s = s.split(find).join(e.replace);
          landed[i] = true;
          break;
        }
      });
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x)]),
      );
    return v;
  };
  const out = walk(draft) as T;
  return landed.every(Boolean) ? out : undefined;
}

/**
 * Asks the writer for the edits that fix the problems, on the same instructions as the draft (so they
 * are read from the cache) and the same brief. Undefined when the edits do not apply cleanly.
 */
export async function reviseByEdits<S extends z.ZodType>(
  llm: Llm,
  opts: {
    system: string;
    content: string;
    schema: S;
    draft: z.infer<S>;
    problems: string[];
    effort?: "low" | "medium" | "high";
    tier?: Tier;
    /** The writer's own step, so a revision goes where its draft went (CODEX_CALLS). Absent: read from the caller. */
    site?: string;
    /** For the log: which writer this was. */
    job: string;
  },
): Promise<z.infer<S> | undefined> {
  try {
    const r = await llm.structured({
      ...(opts.site ? { site: opts.site } : {}),
      system: opts.system,
      content: `${opts.content}\n\nYOUR DRAFT (JSON):\n${JSON.stringify(opts.draft, (k, v) => (k === "voice_tags" ? undefined : v), 1)}\n\nThe draft was rejected for these problems:\n${opts.problems.map((p) => `- ${p}`).join("\n")}\n\n${HOW}`,
      schema: EditsSchema,
      effort: opts.effort ?? "medium",
      tier: opts.tier,
    });
    const edited = applyEdits(opts.draft, r.edits);
    const parsed =
      edited === undefined ? undefined : opts.schema.safeParse(edited);
    if (!parsed?.success) {
      log("info", "draft edits did not apply; writing it again", {
        job: opts.job,
        edits: r.edits.length,
      });
      return undefined;
    }
    log("info", "draft fixed by edits", {
      job: opts.job,
      edits: r.edits.length,
    });
    // The schema drops what it does not name: the draft's delivery tags, and any the edits wrote, ride on.
    const tags = voiceTagsField([opts.draft, r]);
    return (
      tags.voice_tags ? { ...(parsed.data as object), ...tags } : parsed.data
    ) as z.infer<S>;
  } catch (err) {
    log("warn", "draft edit failed; writing it again", {
      job: opts.job,
      error: errorMessage(err),
    });
    return undefined;
  }
}
