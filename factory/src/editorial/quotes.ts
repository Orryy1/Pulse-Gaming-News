import { advertiserProblems } from "./voice.ts";

export interface CutsceneQuote {
  id: string;
  videoId: string;
  text: string;
  start: number;
  end: number;
}

const UNSAFE_QUOTE = /\b(?:kill\w*|murder\w*|slay\w*|slaughter\w*|blood\w*|gore|gory|guts|wounds?|stab\w*|shoot\w*|shot|gunfire|tortur\w*|execut\w*|rape|rapist|suicid\w*|die|dies|died|dying|dead|death|fight\w*|battl\w*|attack\w*|weapon\w*|war|violence|violent|fuck\w*|shit\w*|bitch\w*|bastard\w*|nigg\w*|fagg\w*|chink\w*|spic\w*|kike\w*|trann\w*)\b/i;

export function safeCutsceneQuote(quote: CutsceneQuote): boolean {
  const words = quote.text.trim().split(/\s+/).filter(Boolean);
  return /^[\w-]{11}$/.test(quote.videoId) && !!quote.id &&
    Number.isFinite(quote.start) && Number.isFinite(quote.end) &&
    quote.start >= 0 && quote.end > quote.start && quote.end - quote.start <= 6 &&
    words.length >= 3 && words.length <= 15 &&
    !/[\[\]<>]/.test(quote.text) && !UNSAFE_QUOTE.test(quote.text) &&
    advertiserProblems(quote.text).length === 0;
}

export function quoteProblems(
  beats: ReadonlyArray<{ narration: string; quote?: string }>,
  available: readonly CutsceneQuote[] = [],
): string[] {
  const problems: string[] = [];
  const marked = beats.flatMap((beat, index) => beat.quote === undefined ? [] : [{ beat, index }]);
  if (marked.length > 1) problems.push("Use at most one character quote.");
  for (const quote of available.filter(safeCutsceneQuote)) {
    const needle = quote.text.toLowerCase();
    for (const beat of beats) {
      const text = beat.narration.toLowerCase();
      const first = text.indexOf(needle);
      if (first < 0) continue;
      if (beat.quote !== quote.id || text.indexOf(needle, first + needle.length) >= 0)
        problems.push("The character quote appears outside its single marked beat.");
    }
  }
  for (const { beat, index } of marked) {
    const choices = available.filter((quote) => quote.id === beat.quote);
    const quote = choices.length === 1 ? choices[0] : undefined;
    if (!quote || !safeCutsceneQuote(quote)) {
      problems.push("The character quote is unavailable or unsafe.");
      continue;
    }
    if (beat.narration.trim() !== quote.text)
      problems.push("The character quote must be copied exactly into its own beat.");
    if (index === 0 || index === beats.length - 1 ||
        !beats[index - 1]?.narration.trim() || !beats[index + 1]?.narration.trim() ||
        beats[index - 1]?.quote !== undefined || beats[index + 1]?.quote !== undefined)
      problems.push("A narrator line must come before and after the character quote.");
  }
  return problems;
}

export function quoteBrief(available: readonly CutsceneQuote[] = []): string {
  const safe = available.filter(safeCutsceneQuote);
  if (!safe.length) return "\n\nDo not use a character quote or set the quote field.";
  return `\n\nAvailable character quotes for this game:\n${safe.map((q) => `- ${q.id}: ${JSON.stringify(q.text)}`).join("\n")}\nUse at most one, only when it fits. Put its exact words alone in a beat's narration and its ID in quote. The narrator's preceding line sets it up and the following line answers it. Never use violence, slurs or gore.`;
}
