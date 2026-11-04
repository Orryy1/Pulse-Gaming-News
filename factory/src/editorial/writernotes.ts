// Writer's notes read aloud as narration. On 4 Nov 2026 "How Final Fantasy XIV Survived Its Shutdown" spoke
// about four minutes of the writer explaining why it could not write two chapters ("Please add the relevant
// announcement and billing passages to SOURCE", "They shouldn't be recorded or published as narration"). A
// chapter's schema had only a place for narration, so a refusal went there; every later check passed it, since
// what it said about the source was true. This is the cheap, deterministic test for that kind of text. It runs
// after every write, before voicing, on the words as voiced and at release, and it fails closed: a hit is sent
// back with more sources, and if it survives the video stops (src/pipeline.ts).
//
// Two tiers, because the words themselves are real English in real gaming stories ("the source code", "a source
// told Eurogamer", "Counter-Strike: Source", "the first draft of the script"):
//   - PHRASES nobody says about a game; one is enough.
//   - SIGNS that mean nothing alone; three different ones within a few sentences are a writer talking about the task.
// It has no imports, so the voice step and the release gate can use it freely.

export interface WriterNoteHit {
  /** The words that gave it away. */
  phrase: string;
  /** The sentence (or the run of sentences) they sit in. */
  sentence: string;
}

/** One is enough. Case-insensitive unless marked; a real story has no reason to say any of these. */
const PHRASES: RegExp[] = [
  // The material it was handed, as a thing.
  /\bSOURCE\b/, // the prompt's own heading, in capitals; the case matters ("Source: IGN" is an attribution)
  /\b(?:the|this|that) (?:supplied|provided|permitted|given) (?:source|sources|excerpt|text|passage|passages|material|overview|account|article|brief)\b/i,
  /\bsupplied (?:source|sources|excerpt|text|passage|passages|material|overview|account|article)\b/i,
  /\b(?:the|this) excerpt (?:stops|supplies|doesn'?t|does not|cannot|can'?t|never|omits|lacks|says nothing)\b/i,
  /\brestricted to (?:this|the) (?:excerpt|source|text|passage)\b/i,
  /\bpermitted (?:text|evidence|source|sources|material)\b/i,
  /\bsource (?:text|rule|clarification|passage|passages|material)\b/i,
  /\bsourcing gap\b/i,
  /\bwhat the source calls\b/i,
  // Its instructions and its earlier attempts.
  /\byour (?:source rule|instructions? (?:to|currently|permit)|brief\b|prompt\b)/i,
  /\b(?:violate|break|follow|under) (?:your|the) (?:source )?(?:rule|instruction)s?\b/i,
  /\binstruction to (?:use only|avoid|keep|write)\b/i,
  /\bthe rejected (?:draft|date|version|chapter|sentence|line|paragraph)\b(?! of\b)/i,
  /\bidentified in the rejection\b/i,
  /\b(?:links?|references?) in the brief\b/i,
  // The thing being written.
  /\b(?:requested|proposed|finished) (?:documentary )?chapter\b/i,
  /\bdocumentary (?:chapter|narration|script)\b/i,
  /\bthe chapter's (?:spoken script|central (?:claim|event|scene))\b/i,
  /\bspoken script\b/i,
  /\bthese paragraphs\b/i,
  /\bchapters already (?:completed|written)\b/i,
  /\bnarration brief\b/i,
  /\b(?:recorded|published|used|read|spoken)(?: or \w+)? as (?:the )?narration\b/i,
  /\b(?:requested|central) scene\b.{0,60}\b(?:unsupported|evidence|passage)\b/i,
  // Asking someone for something.
  /\bplease (?:provide|add|supply|share|paste|send|include|confirm|clarify)\b.{0,80}\b(?:source|sources|passages?|material|evidence|excerpt|references?|links?|text)\b/i,
  /\b(?:add|provide|supply|paste|share) (?:the )?(?:relevant|missing|omitted|needed|necessary)\b.{0,50}\b(?:passages?|material|evidence|sources?)\b/i,
  /\bif you (?:can )?(?:provide|share|paste|supply|send)\b/i,
  /\bwould you like me to\b/i,
  /\blet me know if\b/i,
  // A model speaking as itself.
  /\bas an AI\b/i,
  /\bI(?:'m| am) (?:unable|not able) to (?:write|provide|complete|comply|verify|continue|fulfil)/i,
  /\bI (?:cannot|can'?t) (?:write|provide|complete|comply|verify|fulfil|produce|create)\b/i,
  /\bI (?:apologi[sz]e|would need|need more|need additional|need the)\b/i,
  /\bhere(?:'s| is) (?:the|a|your) (?:rewritten|revised|updated|corrected|edited|new) (?:chapter|draft|script|narration|version|text)\b/i,
  /\b(?:the|this|my) (?:revised|rewritten|corrected|edited) (?:chapter|draft|narration)\b/i,
  /\bword count\b/i,
  /\blorem ipsum\b/i,
  /\[(?:insert|placeholder|todo|tbd|source needed)\b/i,
];

/** Each means nothing alone. Each counts once in a window, however often it comes up. */
const SIGNS: Array<[string, RegExp]> = [
  ["excerpt", /\bexcerpts?\b/i],
  ["the brief", /\b(?:the|this) brief\b/i],
  ["the source", /\b(?:the|this) (?:source|sources)\b(?! code| engine)/i],
  ["Source", /(?<=[a-z,] )Source\b(?! code| engine| Engine| \d)/],
  ["draft", /\b(?:the|this|a) (?:rejected |earlier |previous )?draft\b/i],
  ["rewrite", /\brewrite\b/i],
  ["supplied", /\bsupplied\b/i],
  [
    "evidence",
    /\b(?:missing|additional|supporting|direct|needed|the) evidence\b/i,
  ],
  ["passage", /\bpassages?\b/i],
  ["narration", /\bnarration\b/i],
  ["chapter", /\b(?:this|the) chapter\b|\bchapter length\b/i],
  ["unsupported", /\bunsupported\b/i],
  [
    "establish",
    /\b(?:doesn'?t|does not|can'?t|cannot|don'?t) (?:establish|substantiate|attribute|mention|name)\b/i,
  ],
  ["not mentioned", /\b(?:isn'?t|aren'?t|not) mentioned\b/i],
  ["permit", /\bpermit(?:s|ted)?\b/i],
  ["instruction", /\byour instructions?\b/i],
  ["requested", /\bthe requested\b/i],
  ["omitted", /\bthe omitted\b/i],
  ["documented", /\bdocumented history\b/i],
];
/** Different signs needed inside the window. */
const SIGNS_NEEDED = 3;
/** Sentences in the window. */
const SIGN_WINDOW = 4;
/** A transcript may have no punctuation at all: no "sentence" is allowed to run longer than this. */
const LONGEST_SENTENCE_WORDS = 40;

function sentencesOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/(?<=[.!?]["”']?)\s+/)) {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += LONGEST_SENTENCE_WORDS)
      out.push(words.slice(i, i + LONGEST_SENTENCE_WORDS).join(" "));
  }
  return out;
}

/** Writer's notes in spoken or on-screen text; empty for anything a viewer should hear. */
export function writerNoteHits(text: string): WriterNoteHit[] {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = sentencesOf(clean);
  const hits: WriterNoteHit[] = [];
  const seen = new Set<string>();
  const add = (phrase: string, sentence: string) => {
    if (seen.has(sentence)) return;
    seen.add(sentence);
    hits.push({ phrase, sentence });
  };
  for (const sentence of sentences)
    for (const re of PHRASES) {
      const m = sentence.match(re);
      if (m) {
        add(m[0], sentence);
        break;
      }
    }
  for (let i = 0; i < sentences.length; i++) {
    const run = sentences.slice(i, i + SIGN_WINDOW);
    const signs = SIGNS.filter(([, re]) => run.some((t) => re.test(t)));
    if (signs.length >= SIGNS_NEEDED)
      add(signs.map(([name]) => name).join(" + "), run.join(" "));
  }
  return hits;
}

const short = (t: string, n = 140) =>
  t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;

/** Hits as instructions a rewrite can follow, for the writers' own validators. Empty when clean. */
export function writerNoteProblems(text: string): string[] {
  return writerNoteHits(text)
    .slice(0, 6)
    .map(
      (h) =>
        `"${short(h.sentence)}" talks about the writing task ("${short(h.phrase, 40)}"), not the story. Narration only ever tells the story: no mention of a source, excerpt, brief, draft, instructions or what you were asked to do. Tell what happened from the material; where it says nothing, say less.`,
    );
}

/** What a script holds that a viewer hears or reads: never the picture editor's notes or the fact list. */
export interface ScriptText {
  hook?: string;
  loop_line?: string;
  desk_question?: string;
  headline?: string;
  pulse_take?: { narration?: string; on_screen?: string; label?: string };
  beats?: ReadonlyArray<{
    narration?: string;
    visual?: {
      primary?: string;
      secondary?: string;
      items?: readonly string[];
    };
  }>;
  entries?: ReadonlyArray<{ moments?: ReadonlyArray<unknown> }>;
  youtube?: { title?: string; description?: string };
}

export interface WriterNoteFinding extends WriterNoteHit {
  /** Where it is: "beat 19", "hook", "chapter 5 moment 3 on screen". */
  where: string;
}

const textIn = (v: unknown, keys: readonly string[]): string[] => {
  const out: string[] = [];
  const walk = (x: unknown, key: string) => {
    if (typeof x === "string") {
      if (keys.includes(key) && x.trim()) out.push(x);
    } else if (Array.isArray(x)) x.forEach((y) => walk(y, key));
    else if (x && typeof x === "object")
      for (const [k, y] of Object.entries(x)) walk(y, k);
  };
  walk(v, "");
  return out;
};

/** On-screen words of a shot-list moment: its graphic and any filler card, not the "show" note to the editor. */
const SCREEN_KEYS = [
  "primary",
  "secondary",
  "items",
  "emphasis",
  "line",
  "sentence",
  "mark",
];

/** Every writer's note in a script, by where it sits. */
export function scriptWriterNotes(script: ScriptText): WriterNoteFinding[] {
  const found: WriterNoteFinding[] = [];
  const look = (where: string, text?: string) => {
    if (text) for (const h of writerNoteHits(text)) found.push({ ...h, where });
  };
  look("hook", script.hook);
  (script.beats ?? []).forEach((b, i) => {
    look(`beat ${i}`, b.narration);
    look(`beat ${i} on screen`, textIn(b.visual, SCREEN_KEYS).join(". "));
  });
  look("take", script.pulse_take?.narration);
  look("take on screen", script.pulse_take?.on_screen);
  look("close", script.loop_line);
  look("desk question", script.desk_question);
  look("headline", script.headline);
  look("title", script.youtube?.title);
  look("description", script.youtube?.description);
  (script.entries ?? []).forEach((e, ei) =>
    (e.moments ?? []).forEach((m, mi) =>
      look(
        `chapter ${ei} moment ${mi} on screen`,
        textIn(m, SCREEN_KEYS).join(". "),
      ),
    ),
  );
  return found;
}

/** The spoken words of a caption file, one line of text with the numbers and times removed. */
export function srtText(srt: string): string {
  return srt
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes("-->"))
    .join(" ");
}

/** Timed words as text. */
export function wordsText(
  words: ReadonlyArray<{ text: string }> | undefined,
): string {
  return (words ?? []).map((w) => w.text).join(" ");
}

/** Everything a finished video says: the script, the words as voiced and its captions. */
export function releaseWriterNotes(input: {
  script?: ScriptText | null;
  words?: ReadonlyArray<{ text: string }>;
  srt?: string;
}): WriterNoteFinding[] {
  const found = input.script ? scriptWriterNotes(input.script) : [];
  for (const h of writerNoteHits(wordsText(input.words)))
    found.push({ ...h, where: "the voice's words" });
  if (input.srt)
    for (const h of writerNoteHits(srtText(input.srt)))
      found.push({ ...h, where: "the captions" });
  return found;
}

/** One line for the owner and the logs. */
export function writerNoteSummary(
  found: readonly WriterNoteFinding[],
  max = 3,
): string {
  return found
    .slice(0, max)
    .map((f) => `${f.where}: "${short(f.sentence, 110)}"`)
    .join("; ");
}
