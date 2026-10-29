// Titles and descriptions in other languages for YouTube's "localizations": a viewer whose YouTube is in
// Spanish, Portuguese, German, French or Japanese sees (and searches for) the video in their own
// language, while the video itself stays the English original (YouTube's own auto-dubbing covers the
// voice). One small model call per video.

import { z } from "zod";
import type { Llm } from "./llm.ts";

export const LANGUAGE_NAMES: Record<string, string> = {
  es: "Spanish (neutral Latin American)",
  pt: "Portuguese (Brazilian)",
  de: "German",
  fr: "French",
  ja: "Japanese",
  it: "Italian",
  ko: "Korean",
  "es-419": "Spanish (Latin American)",
  "pt-BR": "Portuguese (Brazilian)",
};

const Localized = z.object({
  language: z.string(),
  title: z.string().min(3),
  description: z.string().min(10),
});
const LocalizationsSchema = z.object({ localizations: z.array(Localized) });

export type Localizations = Record<
  string,
  { title: string; description: string }
>;

const PROMPT = `You translate YouTube titles and descriptions for Pulse, a gaming news channel, into the languages asked for.
Rules:
- Natural, native wording a gaming fan in that language would write; not word-for-word. Keep the title's hook and keep it under 90 characters.
- Keep game titles, studio and platform names, numbers, prices, dates, hashtags, @handles and every URL exactly as they are. Keep the channel name "Pulse" and "Pulse Gaming".
- Keep the description's structure line for line: the same paragraphs and line breaks, every link line unchanged, the AI-disclosure line translated faithfully.
- Never add or drop a claim. A rumour stays marked as a rumour.
Return one entry per language code requested, with the code exactly as given.`;

/** The title and description in each language, keyed by the code given. Languages the model skipped are left out. */
export async function translateMetadata(
  llm: Llm,
  meta: { title: string; description: string },
  languages: string[],
): Promise<Localizations> {
  if (!languages.length) return {};
  const asked = languages
    .map((l) => `${l} (${LANGUAGE_NAMES[l] ?? l})`)
    .join(", ");
  const r = await llm.structured({
    system: PROMPT,
    content: `Languages: ${asked}\n\nTitle: ${meta.title}\n\nDescription:\n${meta.description}`,
    schema: LocalizationsSchema,
    effort: "low",
    tier: "mid",
    // Each upload and the backfill come back to the same instructions over the hour.
    cache: "1h",
  });
  const out: Localizations = {};
  for (const l of r.localizations) {
    const code = languages.find(
      (x) => x.toLowerCase() === l.language.trim().toLowerCase(),
    );
    if (!code) continue;
    const title = l.title.trim().slice(0, 100);
    const description = l.description.trim().slice(0, 5000);
    if (!title || !description) continue;
    out[code] = { title, description };
  }
  return out;
}
