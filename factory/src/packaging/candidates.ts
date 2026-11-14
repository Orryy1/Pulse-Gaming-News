// Candidate titles and hook words for one video (pure). Every candidate is built from what the video itself says
// (the writer's title and alternatives, the headline, the spoken hook, the first lines), rearranged into the shapes
// the study found: the game named first, a figure early, a question that closes a gap, a shorter cut. Nothing is
// invented: the clarity check (./clarity.ts) refuses any figure the video does not contain, and a rumour keeps its label.
import { cleanTitle, namesGame } from "./features.ts";
import { FIGURE_PHRASE, LONG_DASH, RUMOUR_LABEL, TRAILING_SMALL } from "./patterns.ts";

export interface CandidateSource {
  title: string;
  variants?: string[];
  headline?: string;
  hook?: string;
  /** The spoken lines in order (the first few are used). */
  lines?: string[];
  game?: string;
  rumour?: boolean;
  thumbText?: string;
}

export interface Candidate {
  text: string;
  /** How it was made: writer, variant, headline, hook, line, game_first, short_name, long_name, cut, figure_first, report. */
  origin: string;
}

/** Common short names US viewers search by, both ways round. */
const NAME_SWAPS: Array<[RegExp, string]> = [
  [/\bGrand Theft Auto (VI|6)\b/g, "GTA 6"],
  [/\bGrand Theft Auto (V|5)\b/g, "GTA 5"],
  [/\bGTA VI\b/g, "GTA 6"],
  [/\bCall of Duty\b/g, "CoD"],
  [/\bThe Legend of Zelda\b/g, "Zelda"],
];

const tidy = (t: string) =>
  cleanTitle(t)
    .replace(LONG_DASH, ",")
    .replace(/\s+([,?.:])/g, "$1")
    .replace(/[.]+$/, "")
    .trim();

/** Title case for a sentence-case line (small words lower, the first word capitalised, names kept). */
export function titleCase(t: string): string {
  const small = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "but",
    "by",
    "for",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "vs",
    "with",
    "from",
    "into",
  ]);
  return t
    .split(" ")
    .map((w, i) => {
      if (/^[a-z]{1,3}\d{1,2}$/.test(w)) return w.toUpperCase(); // ps5 -> PS5
      if (/[A-Z]/.test(w.slice(1)) || /\d/.test(w)) return w; // GTA, PS5, iPhone, $99.99
      const lower = w.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** The first sentence of a line, if it reads as a title (12 to 70 characters, not a quote). */
function sentence(line: string | undefined): string | undefined {
  const s = line?.split(/(?<=[.?!])\s/)[0]?.trim();
  if (!s || s.length < 12 || s.length > 72 || /["“”]/.test(s)) return undefined;
  return s.replace(/\.$/, "");
}

/** The game name moved to the front: "X Gets Y in GTA 6" becomes "GTA 6: X Gets Y" (only when the game is present). */
function gameFirst(t: string, game?: string): string | undefined {
  if (!game || !namesGame(t, game)) return undefined;
  const idx = t.toLowerCase().indexOf(game.toLowerCase());
  if (idx <= 0) return undefined;
  const rest = (t.slice(0, idx) + t.slice(idx + game.length))
    .replace(/\b(in|for|of|on)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,?.:])/g, "$1")
    .replace(/^[\s,:'s]+|[\s,:]+$/g, "")
    .trim();
  return rest.length >= 8
    ? `${game}: ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`
    : undefined;
}

/** The figure moved forward: "Xbox adds 21 PC classics" stays; "Sales hit 5 million for X" becomes "5 Million Sales for X"
 * is too free a rewrite, so only the clause holding the figure is kept when the title has two clauses. */
function figureClause(t: string): string | undefined {
  const parts = t.split(/[,:;]\s+/);
  if (parts.length < 2) return undefined;
  const withFig = parts.find((p) => /\d/.test(p));
  return withFig && withFig !== t && withFig.length >= 18 ? withFig : undefined;
}

/** The title cut at its first break, when what is left still stands alone. */
function cut(t: string): string | undefined {
  const m = t.match(/^(.{18,}?)[,;]\s/);
  return m && m[1]!.split(" ").length >= 4 ? m[1] : undefined;
}

/** Every candidate title, de-duplicated (case and spacing ignored), the writer's own first. */
export function titleCandidates(src: CandidateSource, max = 24): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (text: string | undefined, origin: string) => {
    if (!text) return;
    const t = tidy(text);
    const key = t.toLowerCase().replace(/[^a-z0-9$]/g, "");
    if (!t || seen.has(key)) return;
    seen.add(key);
    out.push({ text: t, origin });
  };
  add(src.title, "writer");
  for (const v of src.variants ?? []) add(v, "variant");
  add(src.headline && titleCase(src.headline), "headline");
  add(sentence(src.hook), "hook");
  // Narration lines are not used: out of their story they lean on "the trailer", "that game" (cold-read unclear).
  // Rearrangements of everything so far.
  for (const c of [...out]) {
    add(gameFirst(c.text, src.game), "game_first");
    for (const [re, to] of NAME_SWAPS)
      if (re.test(c.text)) add(c.text.replace(re, to), "short_name");
    add(figureClause(c.text), "figure_first");
    add(cut(c.text), "cut");
  }
  // A rumour's alternatives keep a label: one without gets "Report:" in front rather than being dropped.
  if (src.rumour)
    for (const c of [...out])
      if (!RUMOUR_LABEL.test(c.text) && c.text.length <= 61)
        add(`Report: ${c.text}`, "report");
  return out.slice(0, max);
}

/** Candidate hook words for a Short's first frame and search tile: up to 4 words, upper case, drawn from the video. */
export function hookCandidates(src: CandidateSource, max = 8): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (text: string | undefined, origin: string) => {
    const t = text
      ?.replace(/[^\p{L}\p{N}$.,'?% ]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
    if (!t || t.split(" ").length > 4 || t.length > 26 || seen.has(t)) return;
    seen.add(t);
    out.push({ text: t, origin });
  };
  add(src.thumbText, "writer");
  const title = tidy(src.title);
  // The figure and the words that finish its phrase ("$99.99 EDITION", "17% OF THE VOTE", "21 PC CLASSICS").
  const fig = title.match(FIGURE_PHRASE);
  if (fig) add(fig[0].replace(TRAILING_SMALL, ""), "figure");
  if (src.game) {
    const short = src.game.replace(/^Grand Theft Auto (VI|6)$/i, "GTA 6");
    const key = title
      .replace(
        new RegExp(src.game.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
        "",
      )
      .split(/\s+/)
      .find((w) => w.length >= 5 && /^\p{L}+$/u.test(w));
    if (key) add(`${short} ${key}`, "game_word");
  }
  // The hook's opening words, when they make a phrase on their own.
  const hw = (src.hook ?? "").replace(/[?.!,].*$/, "").split(/\s+/);
  if (hw.length >= 2 && hw.length <= 4) add(hw.join(" "), "hook");
  return out.slice(0, max);
}
