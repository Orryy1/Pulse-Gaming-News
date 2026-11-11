// Delivery tags (owner's pick, sample C, 11 Nov 2026): eleven_v3 acts a bracketed cue such as [chuckles]
// instead of reading it, so the writers may put a few where a person would react. Only the voice may
// ever see them. Every writer's answer has its tags lifted out the moment it arrives (liftVoiceTags,
// called by the Llm wrapper in src/editorial/llm.ts): the script's fields stay clean, so captions, cards,
// titles, descriptions, comments, word counts and every check read plain text without knowing tags exist.
// Each tag is kept beside the script as a mark anchored on the words either side of it, and put back
// only into the text sent to ElevenLabs (voiceTexts). A sentence rewritten later loses its tag with it,
// which is the safe way round: a missed chuckle costs nothing, a "[chuckles]" on screen would.

import type { Word } from "./elevenlabs.ts";

/** The tags a writer may use, and the only ones ever sent to the voice. */
export const VOICE_TAGS = [
  "excited",
  "chuckles",
  "laughs",
  "sighs",
  "whispers",
  "curious",
  "sarcastic",
] as const;
export type VoiceTag = (typeof VOICE_TAGS)[number];

/** Tags that are a sound of their own: the breath softener leaves the span they fill alone. */
export const SOUND_TAGS: ReadonlySet<string> = new Set([
  "chuckles",
  "laughs",
  "sighs",
]);

// Cues a writer might add beyond the list: removed as well, never voiced and never shown.
const OTHER_CUES = [
  "laugh",
  "laughing",
  "chuckle",
  "chuckling",
  "sigh",
  "sighing",
  "whisper",
  "whispering",
  "giggles",
  "giggling",
  "gasps",
  "gasp",
  "groans",
  "exhales",
  "inhales",
  "clears throat",
  "pause",
  "short pause",
  "long pause",
  "happy",
  "sad",
  "angry",
  "surprised",
  "shocked",
  "excitedly",
  "curiously",
  "sarcastically",
  "mischievously",
  "playfully",
  "thoughtful",
  "deadpan",
  "amused",
  "impressed",
  "nervously",
  "softly",
  "warmly",
  "cheerfully",
  "dramatically",
];

const CUE = `\\[(${[...VOICE_TAGS, ...OTHER_CUES].join("|")})\\]`;
const HAS_CUE = new RegExp(CUE, "i");
const ALLOWED = new Set<string>(VOICE_TAGS);

/** A tag lifted out of a writer's text: which one, and up to four words either side of where it stood. */
export interface VoiceTagMark {
  tag: VoiceTag;
  after: string;
  before: string;
}

const ANCHOR_WORDS = 4;
/** Sentence ends between two tags: "at most one every two or three sentences". */
export const TAG_SENTENCE_GAP = 2;

export function hasVoiceTags(text: string): boolean {
  return HAS_CUE.test(text);
}

/**
 * The text without its delivery tags, spaced as if they were never there ("honestly? [chuckles] I'm" is
 * "honestly? I'm", "Vice City [laughs]." is "Vice City."). Text with no tag comes back untouched.
 */
export function stripVoiceTags(text: string): string {
  if (!hasVoiceTags(text)) return text;
  return text
    .replace(new RegExp(`[ \\t]*${CUE}`, "gi"), "")
    .replace(/^[ \t]+/gm, "")
    .replace(/ {2,}/g, " ");
}

/** Tag words out of a set of word timings (the voice's alignment carries the tags' characters too). */
export function dropTagWords(words: Word[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    const text = stripVoiceTags(w.text).trim();
    if (text) out.push(text === w.text ? w : { ...w, text });
  }
  return out;
}

/**
 * The spans a sound tag fills in a narration's timings: from the end of the word before it to the start of
 * the word after it. The chuckle or sigh is in there, and the breath softener must not turn it down.
 */
export function soundTagSpans(words: Word[]): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 0; i < words.length; i++) {
    const m = new RegExp(CUE, "i").exec(words[i]!.text);
    if (!m || !SOUND_TAGS.has(m[1]!.toLowerCase())) continue;
    let a = i - 1;
    while (a >= 0 && !stripVoiceTags(words[a]!.text).trim()) a--;
    let b = i + 1;
    while (b < words.length && !stripVoiceTags(words[b]!.text).trim()) b++;
    spans.push([
      a >= 0 ? words[a]!.end : 0,
      b < words.length ? words[b]!.start : Infinity,
    ]);
  }
  return spans;
}

const norm = (w: string) =>
  w
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']/g, "");
const wordsOf = (s: string) => s.split(/\s+/).filter((w) => norm(w));
const endsSentence = (w: string) => /[.!?…]["”')\]]*$/.test(w);

/** One string's tags lifted out: the clean text and a mark per allowed tag (any other cue is just dropped). */
export function extractVoiceTags(text: string): {
  text: string;
  marks: VoiceTagMark[];
} {
  if (!hasVoiceTags(text)) return { text, marks: [] };
  const re = new RegExp(CUE, "gi");
  const found: Array<{ tag: string; at: number }> = [];
  let raw = "";
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    raw += text.slice(last, m.index);
    found.push({ tag: m[1]!.toLowerCase(), at: raw.length });
    last = m.index + m[0].length;
  }
  raw += text.slice(last);
  const marks: VoiceTagMark[] = [];
  for (const f of found) {
    if (!ALLOWED.has(f.tag)) continue;
    const after = wordsOf(raw.slice(0, f.at)).slice(-ANCHOR_WORDS).join(" ");
    const before = wordsOf(raw.slice(f.at)).slice(0, ANCHOR_WORDS).join(" ");
    if (after || before) marks.push({ tag: f.tag as VoiceTag, after, before });
  }
  return { text: stripVoiceTags(text), marks };
}

/**
 * A writer's answer with every string's tags lifted out (pure). The marks go on the top-level object as
 * `voice_tags`, next to any it already had; nested objects and arrays are cleaned the same way.
 */
export function liftVoiceTags<T>(value: T): T {
  const marks: VoiceTagMark[] = [];
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = extractVoiceTags(v);
      marks.push(...r.marks);
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v))
        o[k] = k === "voice_tags" ? x : walk(x);
      return o;
    }
    return v;
  };
  const out = walk(value);
  if (!marks.length || !out || typeof out !== "object" || Array.isArray(out))
    return out as T;
  const o = out as Record<string, unknown>;
  return {
    ...o,
    voice_tags: [
      ...((o.voice_tags as VoiceTagMark[] | undefined) ?? []),
      ...marks,
    ],
  } as T;
}

/** Every mark anywhere in a draft (a documentary's chapters each carry their own), for the finished Script. */
export function voiceTagsIn(value: unknown): VoiceTagMark[] {
  const out: VoiceTagMark[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (k === "voice_tags" && Array.isArray(x))
          out.push(...(x as VoiceTagMark[]));
        else walk(x);
      }
  };
  walk(value);
  return out;
}

/** `{ voice_tags }` for a Script made from a draft, or nothing when the draft had none. */
export function voiceTagsField(value: unknown): {
  voice_tags?: VoiceTagMark[];
} {
  const marks = voiceTagsIn(value);
  return marks.length ? { voice_tags: marks } : {};
}

const sameWords = (tokens: string[], at: number, words: string[]) =>
  at >= 0 &&
  at + words.length <= tokens.length &&
  words.every((w, i) => norm(tokens[at + i]!) === norm(w));

/**
 * The texts the voice is given, in spoken order, with the marks put back where their words still stand
 * (pure). Each mark is used once. The rules hold across the whole narration whatever the writer did: at
 * least TAG_SENTENCE_GAP sentence ends between two tags (so never two in a row), none inside a quotation.
 */
export function voiceTexts(
  texts: string[],
  marks: VoiceTagMark[] = [],
): string[] {
  if (!marks.length) return texts;
  const used = new Set<number>();
  let sentencesBefore = 0; // sentence ends in the texts already done
  let lastTag = -Infinity; // the sentence count where the last tag went
  return texts.map((text) => {
    // Words with where they start, so a tag goes in without touching the text's own spacing or paragraphs.
    const spans = [...text.matchAll(/\S+/g)].filter((m) => norm(m[0]));
    const tokens = spans.map((m) => m[0]);
    const places: Array<{ k: number; mark: number }> = [];
    marks.forEach((m, mi) => {
      if (used.has(mi)) return;
      const A = wordsOf(m.after);
      const B = wordsOf(m.before);
      for (let k = 0; k <= tokens.length; k++) {
        if (!sameWords(tokens, k - A.length, A) || !sameWords(tokens, k, B))
          continue;
        // An anchor with one side missing stood at a sentence edge: it only matches at one.
        if (!A.length && k > 0 && !endsSentence(tokens[k - 1]!)) continue;
        if (
          !B.length &&
          k < tokens.length &&
          !endsSentence(tokens[k - 1] ?? "")
        )
          continue;
        places.push({ k, mark: mi });
        break;
      }
    });
    places.sort((x, y) => x.k - y.k);
    const inserts: Array<{ at: number; tag: string }> = [];
    let quotes = 0;
    let sentences = 0;
    let scanned = 0;
    for (const p of places) {
      for (; scanned < p.k; scanned++) {
        const t = tokens[scanned]!;
        quotes += (t.match(/["“”]/g) ?? []).length;
        if (endsSentence(t)) sentences++;
      }
      const at = sentencesBefore + sentences;
      if (quotes % 2 === 1 || at - lastTag < TAG_SENTENCE_GAP) continue;
      used.add(p.mark);
      lastTag = at;
      const tag = `[${marks[p.mark]!.tag}]`;
      inserts.push(
        p.k < spans.length
          ? { at: spans[p.k]!.index!, tag: `${tag} ` }
          : { at: text.trimEnd().length, tag: ` ${tag}` },
      );
    }
    for (; scanned < tokens.length; scanned++)
      if (endsSentence(tokens[scanned]!)) sentences++;
    sentencesBefore += sentences;
    let out = text;
    for (const x of inserts.reverse())
      out = `${out.slice(0, x.at)}${x.tag}${out.slice(x.at)}`;
    return out;
  });
}
