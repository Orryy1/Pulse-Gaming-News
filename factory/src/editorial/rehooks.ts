// Re-hooks: hit gaming documentaries open a fresh question or tease every 60 to 120 seconds of narration
// ("But that wasn't the strangest part.", "So why did Rockstar wait twelve years?"), which carries viewers
// past the points where they would otherwise drift off. The long writers are asked for one about every
// 150-300 words (about 150 words a minute); this finds them and measures the longest stretch without one,
// so a draft that goes quiet for too long is sent back with the stretch named. A heuristic by design: a
// miss only costs a rewrite or a warning, never the video.

/** Longest stretch of narration, in words, allowed without a re-hook (about two and a half minutes). */
export const REHOOK_GAP_MAX_WORDS = 400;

/** The prompt rule, shared by the documentary and long-form writers so they ask for the same thing. */
export const REHOOK_RULE = `Re-hooks: about every 60-120 seconds of narration (every 150-300 words), give the viewer a fresh reason to keep watching with one line that opens a question or teases what is coming, in the Pulse voice. The shape, not the words: "But that wasn't the strangest part.", "And that's where it started to go wrong.", "So why did Rockstar wait twelve years?", "There was just one problem." Word every one differently: never the same line twice in a video. Never clickbait ("you won't believe", "this changes everything"), and never a false promise: whatever a line teases is paid off later in the script. No em dashes.`;

// Sentence openers that turn the story or open a gap. "But" counts only on a short sentence (a turn,
// "But it would not last."), not on a long contrast clause.
const OPENERS =
  /^(and (that|this|then)|so (why|what|how)|which (is|was) (why|where|when|how)|here[’']?s|here is|what|why|how|there (was|were|is) (just |only )?(one|a) (small |big )?(problem|catch|snag|twist)|that[’']?s (when|where)|that (is|was) (when|where|only|just)|this is (where|when)|(nobody|no one) (knew|expected|saw|could)|little did|or so|not for long|the (real |bigger |biggest |only )?(question|problem|catch|twist))\b/i;
const SHORT_BUT = /^but\b/i;
const SHORT_BUT_WORDS = 12;
// Teases anywhere in a sentence (outside quotation marks).
const TEASES =
  /\b((was|were) about to|would soon|what (happened|came) next|only the (beginning|start)|(strangest|stranger|weirdest|real) (part|story)|(we[’']ll|we will) (get to|come back to)|more on that|(wouldn[’']?t|would not|didn[’']?t|did not) (last|stay that way)|would cost (them|him|her|it|the)\b)/i;

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** One passage's sentences, each with whether it starts inside a quotation. */
export function quotedSentences(
  text: string,
): Array<{ text: string; inQuote: boolean }> {
  const out: Array<{ text: string; inQuote: boolean }> = [];
  let open = false;
  for (const s of text
    .split(/(?<=[.!?]["”]?)\s+(?=[A-Z0-9"“'‘])/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    out.push({ text: s, inQuote: open });
    for (const ch of s) {
      if (ch === "“") open = true;
      else if (ch === "”") open = false;
      else if (ch === '"') open = !open;
    }
  }
  return out;
}

/** Whether a sentence opens a question or teases what is coming. Quotations never count. */
export function isRehook(sentence: string, inQuote = false): boolean {
  const s = sentence.trim();
  if (!s || inQuote) return false;
  // A question in the narrator's own words: ends on "?", not on a closing quotation mark, and not
  // inside a quotation that opened in this sentence and is still open ("Who is this for? We...).
  const unclosed =
    (s.match(/"/g) ?? []).length % 2 === 1 ||
    (s.match(/“/g) ?? []).length > (s.match(/”/g) ?? []).length;
  if (s.endsWith("?")) return !unclosed;
  if (/^["“'‘]/.test(s)) return false;
  if (OPENERS.test(s)) return true;
  if (SHORT_BUT.test(s) && wordCount(s) <= SHORT_BUT_WORDS) return true;
  return TEASES.test(s.replace(/"[^"]*"|“[^”]*”/g, " "));
}

/** The re-hook sentences across passages, in order. */
export function rehooksOf(passages: string[]): string[] {
  return passages.flatMap((p) =>
    quotedSentences(p)
      .filter((x) => isRehook(x.text, x.inQuote))
      .map((x) => x.text),
  );
}

/**
 * The longest stretch of narration without a re-hook, counted in words of the sentences between them
 * (before the first and after the last too), across passages in the order they are spoken. "from" is the
 * stretch's opening sentence, so a rewrite knows where to look.
 */
export function longestRehookGap(passages: string[]): {
  words: number;
  from: string;
} {
  let best = { words: 0, from: "" };
  let run = { words: 0, from: "" };
  for (const p of passages)
    for (const x of quotedSentences(p)) {
      if (isRehook(x.text, x.inQuote)) {
        run = { words: 0, from: "" };
        continue;
      }
      run = { words: run.words + wordCount(x.text), from: run.from || x.text };
      if (run.words > best.words) best = run;
    }
  return best;
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Re-hook problems as instructions a rewrite can follow: a stretch too long without one, or one used twice. */
export function rehookProblems(
  passages: string[],
  max = REHOOK_GAP_MAX_WORDS,
): string[] {
  const p: string[] = [];
  const gap = longestRehookGap(passages);
  if (gap.words > max) {
    const start = gap.from.split(/\s+/).slice(0, 8).join(" ");
    p.push(
      `The narration runs ${gap.words} words without a re-hook (from "${start}..."); about every 150-300 words, add a line that opens a question or teases what is coming, and pay it off later.`,
    );
  }
  const seen = new Set<string>();
  for (const r of rehooksOf(passages)) {
    const k = norm(r);
    if (seen.has(k)) {
      p.push(
        `The re-hook "${r}" is used twice; word every re-hook differently.`,
      );
      break;
    }
    seen.add(k);
  }
  return p;
}
