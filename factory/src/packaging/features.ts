// What a title (or a Short's hook words) is made of, as numbers a model can weigh (pure). The same function reads the
// study corpus (other channels' titles) and Pulse's own, so what is learned on one applies to the other. Every feature
// is bounded to about 0..1 so the weights are comparable; the model standardises them anyway.
import {
  BIG_NUMBER,
  CERTAINTY,
  CLICKBAIT,
  CURIOSITY,
  EMOJI,
  FRANCHISE,
  HASHTAG,
  HYPE,
  JARGON,
  LIST,
  NEGATIVE,
  POSITIVE,
  RUMOUR_LABEL,
  SECOND_PERSON,
  SMALL_WORD,
  STAKES,
  VERSUS,
  YEAR,
} from "./patterns.ts";

export type FeatureVector = Record<string, number>;

/** The title as a viewer reads it: hashtags and doubled spaces gone. */
export function cleanTitle(title: string): string {
  return title
    .replace(HASHTAG, " ")
    .replace(/\s*\|\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (t: string): string[] =>
  t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

/** Whether the title names the episode's own game (its full name, its first two words or its US short name). */
export function namesOwnGame(title: string, game: string): boolean {
  const g = game
    .toLowerCase()
    .replace(/^grand theft auto (vi|6)$/, "gta 6")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
  const t = title
    .toLowerCase()
    .replace(/grand theft auto (vi|6)/g, "gta 6")
    .replace(/[^a-z0-9 ]/g, " ");
  const head = g.split(" ").slice(0, 2).join(" ");
  return !!g && (t.includes(g) || (head.length >= 4 && t.includes(head)));
}

/** Whether the title names a game or platform; `game` is the episode's own game when known. */
export function namesGame(title: string, game?: string): boolean {
  if (game && namesOwnGame(title, game)) return true;
  if (game) {
    const g = game
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim();
    const t = title.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
    // The full name or its first two words ("grand theft" for "Grand Theft Auto 6") is enough.
    const head = g.split(" ").slice(0, 2).join(" ");
    if (g && (t.includes(g) || (head.length >= 4 && t.includes(head))))
      return true;
  }
  return FRANCHISE.test(title);
}

/** Where the named game sits: 1 when in the first three words, 0.5 later, 0 when none. */
function gameLead(title: string, game?: string): number {
  if (!namesGame(title, game)) return 0;
  const first = words(title).slice(0, 3).join(" ");
  return namesGame(first, game) ? 1 : 0.5;
}

/** The feature names, in a fixed order (the model's weights follow it). */
export const TITLE_FEATURES = [
  "chars",
  "chars_sweet",
  "chars_long",
  "words",
  "avg_word",
  "number",
  "big_number",
  "money",
  "year",
  "question",
  "colon",
  "ellipsis",
  "exclaim",
  "caps_words",
  "emoji",
  "game_named",
  "game_lead",
  "curiosity",
  "stakes",
  "negative",
  "positive",
  "list",
  "versus",
  "rumour_label",
  "certainty",
  "hype",
  "you",
  "jargon",
  "clickbait",
  "proper_nouns",
] as const;

/** A title's features (pure). */
export function titleFeatures(
  raw: string,
  ctx: { game?: string } = {},
): FeatureVector {
  const t = cleanTitle(raw);
  const w = words(t);
  const n = w.length || 1;
  const chars = t.length;
  const caps = w.filter(
    (x) =>
      x.length >= 3 &&
      /[A-Z]/.test(x) &&
      x === x.toUpperCase() &&
      !/^\d/.test(x),
  ).length;
  // Capitalised words after the first that are not small words: names, games, places.
  const proper = w
    .slice(1)
    .filter((x) => /^[A-Z][a-z]/.test(x) && !SMALL_WORD.test(x)).length;
  return {
    chars: Math.min(1, chars / 100),
    // YouTube shows about 60 characters in search and suggested; 35 to 60 reads whole on a phone.
    chars_sweet: chars >= 35 && chars <= 60 ? 1 : 0,
    chars_long: chars > 70 ? 1 : 0,
    words: Math.min(1, n / 16),
    avg_word: Math.min(1, w.reduce((a, x) => a + x.length, 0) / n / 10),
    number: /\d/.test(t) ? 1 : 0,
    big_number: BIG_NUMBER.test(t) ? 1 : 0,
    money: /\$\s?\d/.test(t) ? 1 : 0,
    year: YEAR.test(t) ? 1 : 0,
    question: /\?/.test(t) ? 1 : 0,
    colon: /:/.test(t) ? 1 : 0,
    ellipsis: /(\.\.\.|…)/.test(t) ? 1 : 0,
    exclaim: /!/.test(t) ? 1 : 0,
    caps_words: Math.min(1, caps / 3),
    emoji: EMOJI.test(raw) ? 1 : 0,
    game_named: namesGame(t, ctx.game) ? 1 : 0,
    game_lead: gameLead(t, ctx.game),
    curiosity: CURIOSITY.test(t) ? 1 : 0,
    stakes: STAKES.test(t) ? 1 : 0,
    negative: NEGATIVE.test(t) ? 1 : 0,
    positive: POSITIVE.test(t) ? 1 : 0,
    list: LIST.test(t) ? 1 : 0,
    versus: VERSUS.test(t) ? 1 : 0,
    rumour_label: RUMOUR_LABEL.test(t) ? 1 : 0,
    certainty: CERTAINTY.test(t) ? 1 : 0,
    hype: HYPE.test(t) ? 1 : 0,
    you: SECOND_PERSON.test(t) ? 1 : 0,
    jargon: JARGON.test(t) ? 1 : 0,
    clickbait: CLICKBAIT.test(t) ? 1 : 0,
    proper_nouns: Math.min(1, proper / 4),
  };
}

/** The vector in the model's order (pure). */
export const toRow = (f: FeatureVector, names: readonly string[]): number[] =>
  names.map((k) => f[k] ?? 0);
