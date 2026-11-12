// The character-quote writer (CHARACTER_QUOTES): with a script finished, the writer is shown the game's quotable
// lines (src/sceneindex/quotepick.ts) and either declines or picks one and writes the two narrator lines around it,
// in the friend voice, as an exchange (owner, 12 Nov 2026: characters "talking to" the narration): the setup makes
// the line sound like a reply to the narrator, and the reaction talks back at the line's own words with a take or a
// joke. The quote itself is never written by the model: it chooses an ID, the words played and captioned are the
// index's own and are checked again after the rewrite. A draft that introduces the speaker instead of setting the
// line up ("Here's Nabooru.", "Zelda has a request."), reacts with a line that would fit any quote ("Warps won't
// help."), repeats or paraphrases the quote, drops a fact of its beat, adds one, breaks a house rule the script kept,
// or runs over the word budget goes back once, then the script stays as it was. Everything here but
// writeQuoteMoment is pure.

import { z } from "zod";
import type { Llm, Tier } from "./llm.ts";
import { narrationOf, wordCount, type Script } from "./schema.ts";
import { factDrift, newProblems } from "./friendpass.ts";
import { tokens } from "../sceneindex/lookup.ts";
import { sentencesIn, voiceFor, voiceProblems } from "./voice.ts";
import { stripVoiceTags } from "../voice/tags.ts";
import { spoilerProblems } from "../sceneindex/spoilers.ts";
import type { QuoteCandidate } from "../sceneindex/quotepick.ts";

/** A quote placed in a script: the index's line, where it plays and the narrator lines around it. */
export interface CharacterQuote {
  id: string;
  game: string;
  videoId: string;
  sourceTitle: string;
  uploader: string;
  text: string;
  speaker: string;
  /** Seconds into the source of the first and last spoken word. */
  start: number;
  end: number;
  /** The beat it plays in: after `before` and ahead of `after`, which together are that beat's narration. */
  beat: number;
  before: string;
  after: string;
  /** The beat's narration before the quote was written in, so a quote that cannot be played can be taken out again. */
  original: string;
}

export const QuoteMomentSchema = z.object({
  use: z
    .boolean()
    .describe(
      "true only when one of the listed lines genuinely fits what this script says at that point",
    ),
  quote_id: z
    .string()
    .describe(
      "the ID of the line used (q followed by digits), or an empty string",
    ),
  beat: z.number().int().describe("the BEAT number the line plays in, or -1"),
  before_quote: z
    .string()
    .describe(
      "that beat's narration up to the quote, ending with the setup sentence; empty when not used",
    ),
  after_quote: z
    .string()
    .describe(
      "the rest of that beat's narration, opening with the reaction sentence; empty when not used",
    ),
  answers: z
    .string()
    .describe(
      "the word or words of the line, copied exactly from it, that the reaction talks back at; empty when not used",
    ),
  why: z
    .string()
    .describe("one short line for the log: why it fits, or why none does"),
});
export type QuoteMoment = z.infer<typeof QuoteMomentSchema>;

export const SETUP_MAX_WORDS = 14;
export const REACTION_MAX_WORDS = 12;

export const QUOTE_MOMENT_RULES = `The character quote
A real line from the game's own cutscene can play inside this video, in the character's own voice: the narrator stops, the character speaks, the narrator comes straight back. Write it as an exchange between two people, the way a friend talks over a game on the sofa: the narrator says something, the character seems to answer it, and the narrator talks back at what the character actually said. Decide whether one of the listed lines genuinely fits this script, and write the narrator's side of that exchange only if one does.
- Use a line only when its own words land on what the script says at that point. Three kinds of fit work: the line is about the very thing the beat says (the character the story names, the place, the decision); the line answers the beat without meaning to, the way a game character's words land on today's news (a character urging you to hurry in a story about cut shortcuts, a mentor promising trials in a story about difficulty); or the line is the character's own introduction in a story about that character. A line that is merely from the same game is not a fit, and neither is one that only works behind a bare introduction. Most scripts have no line that fits: then set use to false and leave the other fields empty. Declining is a good answer; a forced line is the worst one.
- The line plays exactly as the game says it. Never repeat it, paraphrase it, quote it or put any of its words in quotation marks: the viewer hears it from the character.
- before_quote is the chosen beat's narration up to the quote and ends with the setup: one sentence of at most ${SETUP_MAX_WORDS} words that makes the line land, so the character's words sound like a reply to the narrator. Lead into what the line says: a claim the character seems to answer, a question the line answers, or a situation the line pays off, tied to the story. Example shapes (placeholder facts: copy the move, never the words), for a guide whose line is "Hey! Wake up!": "You'd think the first fairy you meet would let you sleep in." or "So who actually wants you up early in this remake?" Never a bare introduction or a cue: "Here's Navi.", "Here's how Navi puts it.", "Navi has a request.", "Navi has something to say.", "Listen to Navi.", "Meet Navi." and "Take it away, Navi." say nothing and are sent back. It ends with a full stop, a question mark or a colon.
- after_quote is the rest of the beat and opens with the reaction: one sentence of at most ${REACTION_MAX_WORDS} words that talks back at the line's actual words, the way a friend answers the screen. Take up a word or the demand of the line and turn it into a take or a joke tied back to the story: for "Hey! Wake up!", "Awake, sure, but there's still no fast travel." or "I'd wake up faster with a sprint button." Echo at least one word of the line or answer its question plainly (yes, no, sure), never three of its words in a row. A reaction that would fit any line ("Fair enough.", "You heard her.", "Warps won't help.") is sent back. Then whatever is left of the beat.
- answers is the word or words of the line, copied exactly from it, that the reaction talks back at ("wake up").
- Keep every fact, figure and name the beat had (you may say them shorter or move them); add no new fact, figure or name except the speaking character's name.
- The quote goes in one of the beats listed, never in the hook or the last line.
- Full sentences with a verb, contractions, no delivery tags in square brackets, no stage directions.`;

const plain = (text: string): string[] =>
  stripVoiceTags(text)
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** The longest run of consecutive words two texts share. */
function sharedRun(a: string[], b: string[]): number {
  let best = 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      best = Math.max(best, prev[j]!);
      diag = keep;
    }
  }
  return best;
}

/** Setups that introduce the speaker or cue the line instead of setting it up (owner, 12 Nov 2026). */
export const BARE_SETUPS: RegExp[] = [
  /^(?:and|so|now|well|okay|right)?,?\s*here(?:['’]s| is)\b/i,
  /\b(?:has|have|had|['’]s got|got)\s+(?:a|an|one|some|something|few)?\s*(?:little\s+|quick\s+|small\s+|few\s+)?(?:request|message|word|words|something to say|thing to say|advice|thoughts?|idea|question|announcement|news|plea|warning|reminder)\b/i,
  /^(?:and|so|now)?,?\s*(?:listen to|meet|cue|enter|over to|let(?:['’]s)? hear(?: from)?|take it away)\b/i,
  /\b(?:take it away|says it best|said it best|puts it best|puts it like this|in (?:his|her|their|its) own words|has (?:this|these words) to say)\b/i,
];

/** Words a reaction may answer a question with ("No, and I'd wait."). */
const ANSWER_WORDS =
  /^(?:yes|yeah|yep|no|nope|nah|sure|fine|okay|ok|maybe|absolutely|never|gladly|hardly)\b/i;

/** Contraction pieces and chatter that never make an exchange on their own. */
const CHATTER = new Set(
  "t ll re ve d m don won isn aren wasn weren didn doesn can couldn wouldn shouldn let like yes no oh hey okay ok yeah well just really even still".split(
    " ",
  ),
);

/** A text's content words, stemmed, without chatter and the given names (pure). */
function contentWords(
  text: string,
  drop: ReadonlySet<string> = new Set(),
): Set<string> {
  return new Set(
    tokens(stripVoiceTags(text)).filter(
      (w) => w.length > 1 && !CHATTER.has(w) && !drop.has(w),
    ),
  );
}

/**
 * How the setup and the reaction talk to the line (pure): problems, as instructions, unless it is a real exchange.
 * The setup must not be a bare introduction or cue ("Here's Nabooru.", "Zelda has a request.") and must share a
 * word with the story or the line; the reaction must take up a word of the line (names aside) or answer its
 * question with a yes or a no.
 */
export function exchangeProblems(
  setup: string,
  reaction: string,
  q: Pick<QuoteCandidate, "text" | "speaker">,
  o: { beat: string; names?: readonly string[]; answers?: string },
): string[] {
  const p: string[] = [];
  const speaker = new Set(tokens(q.speaker));
  const cast = new Set([
    ...speaker,
    ...(o.names ?? []).flatMap((n) => tokens(n)),
  ]);
  if (BARE_SETUPS.some((r) => r.test(setup.trim())))
    p.push(
      `The setup ("${setup}") only introduces ${q.speaker} or cues the line. Make the line land instead: say the thing the line seems to answer, or ask what it answers, tied to the story.`,
    );
  else {
    const lineWords = contentWords(q.text, speaker);
    const beatWords = contentWords(o.beat, speaker);
    const own = [...contentWords(setup, speaker)];
    if (!own.some((w) => lineWords.has(w) || beatWords.has(w)))
      p.push(
        `The setup ("${setup}") is tied to neither the story nor the line. Lead into what ${q.speaker} is about to say, in the beat's own terms.`,
      );
  }
  const lineContent = contentWords(q.text, cast);
  const said = contentWords(reaction, cast);
  const asks = /\?["'”’]?\s*$/.test(q.text.trim());
  const answered = asks && ANSWER_WORDS.test(reaction.trim());
  const echoed = [...said].some((w) => lineContent.has(w));
  if (!echoed && !answered)
    p.push(
      `The reaction ("${reaction}") does not answer the line and would fit any quote. Talk back at ${q.speaker}'s actual words (${[...lineContent].slice(0, 4).join(", ") || q.text}) with a take or a joke tied to the story.`,
    );
  const ans = (o.answers ?? "").trim();
  if (ans) {
    const inLine = new Set(tokens(q.text));
    if (tokens(ans).some((w) => !inLine.has(w)))
      p.push(`answers ("${ans}") must be words copied from the line itself.`);
  }
  return p;
}

const minutes = (s: number) => `${Math.max(0, Math.round(s / 60))} min`;

/** The writer's brief: the script as it will be voiced and the lines on offer (pure). */
export function quoteMomentBrief(
  script: Pick<
    Script,
    "game_title" | "hook" | "beats" | "pulse_take" | "loop_line"
  >,
  candidates: readonly QuoteCandidate[],
  o: { wordsMax?: number; beats?: readonly number[] } = {},
): string {
  const beats = o.beats ?? script.beats.map((_, i) => i);
  const now = wordCount(
    narrationOf({ ...script, voice_tags: undefined } as Script),
  );
  return [
    `Game: ${script.game_title}`,
    "",
    "The script, in spoken order:",
    `HOOK: ${script.hook}`,
    ...script.beats.map(
      (b, i) =>
        `BEAT ${i}${beats.includes(i) ? "" : " (not for the quote)"}: ${b.narration}`,
    ),
    `TAKE: ${script.pulse_take.narration}`,
    `LAST LINE: ${script.loop_line}`,
    "",
    `Narration now: ${now} words${o.wordsMax ? `; at most ${o.wordsMax} words once the setup and reaction are in, so trim the beat if you need room` : ""}.`,
    "",
    "Lines you may use (the game's exact words; the clip is the character saying them):",
    ...candidates.map(
      (c) =>
        `- ${c.id}: ${c.speaker}, ${(c.end - c.start).toFixed(1)} s, ${minutes(c.start)} into the story${c.matched.length ? `, shares with the script: ${c.matched.join(", ")}` : c.fit === "general" ? ", shares no words with the script (use it only if its words truly answer a beat)" : ""}. ${JSON.stringify(c.text)}`,
    ),
  ].join("\n");
}

export interface QuoteMomentChecks {
  wordsMax?: number;
  /** Beats the quote may go in (default: every beat). */
  beats?: readonly number[];
  /** Names the narrator may add besides the speaker's (the game's cast and places). */
  names?: readonly string[];
  /** The script's own house rules: only the problems the quote adds count. */
  house?: (s: Script) => string[];
  now?: Date;
}

/** The script with the quote written in (pure): the beat's narration becomes before + after. */
export function applyQuoteMoment(
  script: Script,
  m: QuoteMoment,
  q: QuoteCandidate,
): Script {
  const before = stripVoiceTags(m.before_quote).trim();
  const after = stripVoiceTags(m.after_quote).trim();
  const beats = script.beats.map((b, i) =>
    i === m.beat ? { ...b, narration: `${before} ${after}`.trim() } : b,
  );
  const placed: CharacterQuote = {
    id: q.id,
    game: q.game,
    videoId: q.videoId,
    sourceTitle: q.sourceTitle,
    uploader: q.uploader,
    text: q.text,
    speaker: q.speaker,
    start: q.start,
    end: q.end,
    beat: m.beat,
    before,
    after,
    original: script.beats[m.beat]?.narration ?? "",
  };
  return {
    ...script,
    beats,
    character_quotes: [...(script.character_quotes ?? []), placed],
  };
}

/** What is wrong with a quote moment, as instructions a rewrite can follow; empty when it may be used (pure). */
export function quoteMomentProblems(
  script: Script,
  m: QuoteMoment,
  candidates: readonly QuoteCandidate[],
  o: QuoteMomentChecks = {},
): string[] {
  if (!m.use) return [];
  const q = candidates.find((c) => c.id === m.quote_id.trim());
  if (!q) return [`quote_id "${m.quote_id}" is not one of the listed lines.`];
  const allowed = o.beats ?? script.beats.map((_, i) => i);
  if (!allowed.includes(m.beat))
    return [
      `BEAT ${m.beat} is not one the quote may go in (${allowed.join(", ")}).`,
    ];
  if ((script.character_quotes ?? []).some((c) => c.beat === m.beat))
    return [`BEAT ${m.beat} already has a quote.`];
  const p: string[] = [];
  const before = stripVoiceTags(m.before_quote).trim();
  const after = stripVoiceTags(m.after_quote).trim();
  if (!before)
    p.push("before_quote is empty: it must end with the setup sentence.");
  if (!after)
    p.push("after_quote is empty: it must open with the reaction sentence.");
  if (p.length) return p;
  if (!/[.?!:]["”]?$/.test(before))
    p.push("The setup must end with a full stop, a question mark or a colon.");
  const setup = sentencesIn(before).at(-1) ?? before;
  const reaction = sentencesIn(after)[0] ?? after;
  if (plain(setup).length > SETUP_MAX_WORDS + 2)
    p.push(
      `The setup ("${setup}") is ${plain(setup).length} words; keep it to ${SETUP_MAX_WORDS}.`,
    );
  if (plain(reaction).length > REACTION_MAX_WORDS + 2)
    p.push(
      `The reaction ("${reaction}") is ${plain(reaction).length} words; keep it to ${REACTION_MAX_WORDS}.`,
    );
  if (plain(reaction).length < 2)
    p.push("The reaction must be a sentence, not a single word.");
  const qw = plain(q.text);
  const original = script.beats[m.beat]!.narration;
  const beat = `${before} ${after}`;
  // The viewer hears the line from the character: the narrator never says it too.
  const run = sharedRun(qw, plain(beat));
  if (
    run >= Math.min(4, Math.max(3, qw.length - 1)) &&
    run > sharedRun(qw, plain(original))
  )
    p.push(
      `The narration repeats the quote's words ("${qw.slice(0, 6).join(" ")}..."); never say or paraphrase the line, the character says it.`,
    );
  if (/["“”]/.test(beat) && !/["“”]/.test(original))
    p.push("No quotation marks: the quote is heard, not read out.");
  if (/\bquote\b/i.test(`${setup} ${reaction}`))
    p.push('Never say "quote": just set the moment up.');
  p.push(
    ...exchangeProblems(setup, reaction, q, {
      beat: [script.hook, original, script.headline].filter(Boolean).join(" "),
      names: o.names,
      answers: m.answers,
    }),
  );
  // The beat's facts hold; the speaker, the game's cast and places may be named, and a word of the line taken up
  // by the reaction ("Quickly? ...") is an echo, not a new name.
  const ok = new Set(
    [q.speaker, q.game, ...(o.names ?? []), q.text]
      .flatMap((n) => n.split(/[^\p{L}\p{N}'’]+/u))
      .map((w) => w.toLowerCase().replace(/['’]s$/, ""))
      .filter(Boolean),
  );
  const allowedName = (n: string) =>
    n.split(/\s+/).every((w) => ok.has(w.toLowerCase().replace(/['’]s$/, "")));
  // A setup ending on a colon capitalises the reaction's first word: read as a new sentence, not a name.
  for (const d of factDrift(original, `${before.replace(/:$/, ".")} ${after}`)) {
    const added = d.match(/^The rewrite adds the name (.+)\.$/);
    if (added) {
      const rest = added[1]!.split(/,\s*/).filter((n) => !allowedName(n));
      if (rest.length) p.push(`The rewrite adds the name ${rest.join(", ")}.`);
      continue;
    }
    p.push(d);
  }
  p.push(...newProblems(voiceProblems(original), voiceProblems(beat)));
  p.push(
    ...newProblems(
      spoilerProblems(original, o.now, [q.game]),
      spoilerProblems(beat, o.now, [q.game]),
    ),
  );
  const next = applyQuoteMoment(script, m, q);
  const words = wordCount(
    narrationOf({ ...next, voice_tags: undefined } as Script),
  );
  if (o.wordsMax && words > o.wordsMax)
    p.push(
      `The narration is ${words} words with the quote's lines; the most is ${o.wordsMax}, so trim the beat.`,
    );
  if (o.house) p.push(...newProblems(o.house(script), o.house(next)));
  return p;
}

export interface QuoteMomentResult {
  script: Script;
  quote?: CharacterQuote;
  /** For the log: the writer's reason and any problems that sent a draft back. */
  why: string[];
}

/** One writer call and at most one retry; the script comes back unchanged unless a clean quote moment was written. */
export async function writeQuoteMoment(
  llm: Llm,
  script: Script,
  candidates: readonly QuoteCandidate[],
  o: QuoteMomentChecks & {
    site: string;
    tier?: Tier;
    format?: "news" | "documentary";
  },
): Promise<QuoteMomentResult> {
  if (!candidates.length) return { script, why: ["no quotable lines"] };
  const system = `${voiceFor(o.format ?? "news")}\n\n${QUOTE_MOMENT_RULES}`;
  const brief = quoteMomentBrief(script, candidates, o);
  const why: string[] = [];
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const m = await llm.structured({
      system,
      content: problems.length
        ? `${brief}\n\nYour last answer could not be used:\n${problems.map((x) => `- ${x}`).join("\n")}\nFix these, or set use to false.`
        : brief,
      schema: QuoteMomentSchema,
      tier: o.tier ?? "top",
      effort: "medium",
      maxTokens: 2000,
      site: o.site,
    });
    why.push(m.why);
    if (!m.use) return { script, why };
    problems = quoteMomentProblems(script, m, candidates, o);
    if (!problems.length) {
      const q = candidates.find((c) => c.id === m.quote_id.trim())!;
      const next = applyQuoteMoment(script, m, q);
      return { script: next, quote: next.character_quotes!.at(-1), why };
    }
    why.push(...problems);
  }
  return { script, why };
}

/** The script with a placed quote taken out again: its beat back as it was (pure). */
export function withoutQuote(script: Script, id: string): Script {
  const q = (script.character_quotes ?? []).find((c) => c.id === id);
  if (!q) return script;
  const rest = (script.character_quotes ?? []).filter((c) => c.id !== id);
  return {
    ...script,
    beats: script.beats.map((b, i) =>
      i === q.beat ? { ...b, narration: q.original } : b,
    ),
    character_quotes: rest.length ? rest : undefined,
  };
}
