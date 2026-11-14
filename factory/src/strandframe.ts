// One title shape and one thumbnail layout per long strand, plus the Shorts title rule and the chapter cadence (upgrade
// queue item 14, from the 11 Nov niche research, changes 10, 15 and 28). The small channels with the highest views per
// subscriber each keep one sentence shape and one thumbnail layout, with only the game's art changing inside it (Game
// Gauntlet 17.5 times its subscribers, JarGames 6.0, Selwen 5.8, nelvox 3.2), while anonymous list brands sit at 0.03 to
// 0.04. Every GTA video over 200K named the game; a third of Pulse's views come from search by game name; on Shorts
// "why or how plus a named subject" lifted two channels' medians fourfold and more, and Pulse's own Shorts with a
// number in the title broke out half as often.
//
// So, behind STRAND_FRAMES (off by default):
//   documentary  "How <subject> <did what>"                      poster layout, 1 to 3 words
//   whydied      "How <game> Lost <a concrete loss>"            number layout (the loss is the word), 1 to 2 words
//   everygame    "The Story of Every <series> Game"             motif layout (the series' covers), 0 to 2 words
//   guide        the guide plan's own frame (src/longguide.ts)  poster layout, 1 to 4 words
// A title outside its strand's shape gives way to a title variant inside it; none: it stays and the owner is told.
// The thumbnail's first design is the strand's layout and the Test & compare variants are the same layout on other
// art, so the test measures the art and the layout stays the strand's signature.
//
// SHORT_TITLE_GAME_FIRST: a Short's title opens on the game's name, then the why or how ("GTA 6: Why It Costs $80").
// LONG_CHAPTER_CADENCE: a long description's chapters land every one to two minutes with plain labels; the chapter
// writer marks the story's moments inside each chapter (CHAPTER_MARK_RULE) and the marks fill the gaps.
//
// This module is separate from the title code the packaging lab studies (src/packaging/, src/editorial/seo.ts): it
// only fixes the strand shapes and layouts. Pure functions; the pipeline applies them.

import { titleShapeProblems } from "./editorial/titleshape.ts";

export type LongStrand = "documentary" | "whydied" | "everygame" | "guide";

export interface StrandFrame {
  strand: LongStrand;
  /** The one sentence shape, as a test on the title. */
  shape: RegExp;
  /** The shape in words, for the owner and the writer. */
  shapeText: string;
  /** The thumbnail layout every video in the strand opens with (a layout name from the long thumbnail designs). */
  layout: "poster" | "number" | "motif";
  /** The fewest and most words on the thumbnail. */
  words: readonly [number, number];
  /** The title shape rules this strand may break ("count": a loss figure may be a count). */
  allow: readonly string[];
}

/** The four frames. Regexes live here, nowhere else. */
export const STRAND_FRAMES: Record<LongStrand, StrandFrame> = {
  documentary: {
    strand: "documentary",
    shape: /^How\s+\S.{8,}$/i,
    shapeText:
      'How <subject> <did what>: "How Cyberpunk 2077 Saved Itself From Dying"',
    layout: "poster",
    words: [1, 3],
    allow: [],
  },
  whydied: {
    strand: "whydied",
    shape: /^How\s+.+\s+Lost\s+.*\d/i,
    shapeText:
      'How <game> Lost <a concrete loss>: "How Concord Lost Its Players in 12 Days"',
    layout: "number",
    words: [1, 2],
    allow: ["count"],
  },
  everygame: {
    strand: "everygame",
    shape: /^The Story of Every\s+.+\s+Game$/i,
    shapeText:
      'The Story of Every <series> Game: "The Story of Every GTA Game"',
    layout: "motif",
    words: [0, 2],
    allow: [],
  },
  guide: {
    strand: "guide",
    shape: /\S/,
    shapeText: "the guide plan's own frame (guides.json)",
    layout: "poster",
    words: [1, 4],
    allow: [],
  },
};

/** The most characters a long title runs to: every video over 200K in the GTA sample had a 43.5-character median. */
export const STRAND_TITLE_MAX = 70;

/** Which long strand a script belongs to (pure); undefined for rankings, recaps, explainers and the rest. */
export function longStrandOf(
  script: {
    runtime?: string;
    evergreen_format?: string;
    every_game?: unknown;
    recap?: boolean;
    explained?: boolean;
    why_died?: unknown;
  },
  topic?: { format?: string; guide?: unknown },
): LongStrand | undefined {
  if (script.runtime !== "long") return undefined;
  if (topic?.format === "guide" || topic?.guide) return "guide";
  if (
    script.every_game ||
    script.evergreen_format === "every_game" ||
    topic?.format === "everygame"
  )
    return "everygame";
  if (script.why_died) return "whydied";
  if (script.recap || script.explained) return undefined;
  if (script.evergreen_format === "documentary" && topic?.format !== "retro")
    return "documentary";
  return undefined;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const GAME_FILLER = new Set([
  "the",
  "a",
  "of",
  "and",
  "edition",
  "remastered",
  "remake",
  "game",
  "games",
]);

/** True when the title names the game: its full name, a distinctive word of it, or its initials (GTA, COD). */
export function namesGame(title: string, game: string): boolean {
  if (!game.trim()) return true;
  const t = ` ${norm(title)} `;
  const g = norm(game);
  if (t.includes(` ${g} `)) return true;
  const words = g.split(" ").filter((w) => w && !GAME_FILLER.has(w));
  if (
    words.some((w) => w.length >= 4 && !/^\d+$/.test(w) && t.includes(` ${w} `))
  )
    return true;
  const initials = words
    .filter((w) => /^\p{L}/u.test(w) && !/^[ivx]+$/.test(w))
    .map((w) => w[0])
    .join("");
  return initials.length >= 2 && t.includes(` ${initials} `);
}

/** What keeps a title out of its strand's frame (pure); empty when it fits. */
export function strandTitleProblems(
  strand: LongStrand,
  title: string,
  game: string,
): string[] {
  const f = STRAND_FRAMES[strand];
  const t = title.trim();
  const out: string[] = [];
  if (!f.shape.test(t))
    out.push(`"${t}" is not in the ${strand} frame: ${f.shapeText}.`);
  if (!namesGame(t, game)) out.push(`"${t}" does not name ${game}.`);
  if (t.length > STRAND_TITLE_MAX)
    out.push(
      `"${t}" is ${t.length} characters; keep it under ${STRAND_TITLE_MAX}.`,
    );
  if (/\?/.test(t))
    out.push(`"${t}" asks a question; a long title is a statement.`);
  out.push(...titleShapeProblems(t, f.allow));
  return out;
}

/**
 * The title to publish in the strand's frame (pure): the current one when it fits, else the first variant that fits
 * (the current one joins the variants if it still passes the house shape rules). Undefined: nothing to change, or
 * nothing fits (the caller tells the owner).
 */
export function framedTitle(
  strand: LongStrand,
  current: string,
  variants: readonly string[],
  game: string,
): { title: string; variants: string[]; reason: string } | undefined {
  const problems = strandTitleProblems(strand, current, game);
  if (!problems.length) return undefined;
  const pick = variants.find(
    (v) => !strandTitleProblems(strand, v, game).length,
  );
  if (!pick) return undefined;
  return {
    title: pick,
    // The Test & compare only tries titles in the frame: the strand's shape is the constant, the words the test.
    variants: variants.filter(
      (v) => v !== pick && !strandTitleProblems(strand, v, game).length,
    ),
    reason: problems[0]!,
  };
}

/** Variants that fit the frame (pure): a title test inside the strand never tries a different shape. */
export function framedVariants(
  strand: LongStrand,
  variants: readonly string[],
  game: string,
): string[] {
  return variants.filter((v) => !strandTitleProblems(strand, v, game).length);
}

const FIGURE = /^[$£€]?\d[\d,.]*(%|k|m|bn)?$/i;

/**
 * The thumbnail's words held to the strand's count (pure): upper case, at most the strand's maximum; a "why it died"
 * thumbnail keeps the loss figure first ("-97%", "12 DAYS"). Empty when the strand allows none and none were given.
 */
export function strandThumbWords(
  strand: LongStrand,
  words: string | undefined,
): string {
  const [, max] = STRAND_FRAMES[strand].words;
  const list = (words ?? "").trim().split(/\s+/).filter(Boolean);
  if (!list.length || max === 0) return "";
  if (strand === "whydied") {
    const i = list.findIndex((w) => FIGURE.test(w.replace(/^-/, "")));
    if (i > 0) list.unshift(...list.splice(i, 1));
  }
  return list.slice(0, max).join(" ").toUpperCase();
}

/**
 * The thumbnail designs with the strand's layout first and only that layout as Test & compare variants (pure). When no
 * design has the layout (the art did not allow it), the list is left as it was.
 */
export function pinStrandLayout<T extends { layout: string }>(
  designs: readonly T[],
  strand: LongStrand,
): T[] {
  const want = STRAND_FRAMES[strand].layout;
  const same = designs.filter((d) => d.layout === want);
  return same.length ? same : [...designs];
}

// ---------------------------------------------------------------- Shorts titles

const WHY_HOW = /^(why|how)\s+/i;

/**
 * A Short's title with the game's name first, then the why or how (pure; SHORT_TITLE_GAME_FIRST). "Why GTA 6 Costs $80"
 * becomes "GTA 6: Why It Costs $80"; a title that does not name the game gets it in front when it fits. A title already
 * led by the game, or one that cannot be reworded safely, comes back as it was.
 */
export function gameFirstShortTitle(
  title: string,
  game: string,
  shortName = game,
  max = 60,
): string {
  const t = title.trim().replace(/\s+/g, " ");
  const names = [shortName, game]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const leading = (text: string) =>
    names.find((n) => text.toLowerCase().startsWith(n.toLowerCase())) ??
    leadingAlias(text, game);
  if (leading(t) || !game.trim()) return t;
  const why = t.match(WHY_HOW);
  if (why) {
    const rest = t.slice(why[0].length);
    const name = leading(rest);
    if (name) {
      const after = rest.slice(name.length);
      const lead = names.includes(name) ? shortName : name;
      const word = why[1]![0]!.toUpperCase() + why[1]!.slice(1).toLowerCase();
      const pronoun = /^['’]s\s/i.test(after)
        ? `Its ${after.slice(3)}`
        : `It${after}`;
      const out = `${lead}: ${word} ${pronoun}`.replace(/\s+/g, " ").trim();
      if (out.length <= max) return out;
    }
  }
  if (!namesGame(t, game)) {
    const out = `${shortName}: ${t}`;
    if (out.length <= max) return out;
  }
  return t;
}

/** A numeral after the initials: "6", "VI". */
const ALIAS_NUMERAL = /^\s*(?:\d+|[IVX]+)\b/i;

/**
 * The game's initials as a title opens with them (pure): "GTA 6", "GTA VI" or "GTA" for Grand Theft Auto VI, exactly
 * as the title writes it; undefined when the text does not open so.
 */
export function leadingAlias(text: string, game: string): string | undefined {
  const letters = norm(game)
    .split(" ")
    .filter((w) => w && !GAME_FILLER.has(w))
    .filter((w) => /^\p{L}/u.test(w) && !/^[ivx]+$/.test(w));
  if (letters.length < 2) return undefined;
  const initials = letters.map((w) => w[0]).join("");
  if (text.slice(0, initials.length).toLowerCase() !== initials)
    return undefined;
  let alias = text.slice(0, initials.length);
  const numeral = text.slice(alias.length).match(ALIAS_NUMERAL);
  if (numeral) alias += numeral[0];
  const next = text.slice(alias.length);
  return next === "" || /^[\s:'’]/.test(next) ? alias : undefined;
}

/** What breaks the Shorts title rule (pure), for the log: the game not first, no why or how, a number that leads. */
export function shortTitleNotes(
  title: string,
  game: string,
  shortName = game,
): string[] {
  const t = title.trim();
  const out: string[] = [];
  const names = [shortName, game].filter(Boolean);
  const alias = leadingAlias(t, game);
  if (!alias && !names.some((n) => t.toLowerCase().startsWith(n.toLowerCase())))
    out.push("the game's name is not first");
  if (!/\b(why|how)\b/i.test(t)) out.push("no why or how");
  const rest = names.reduce(
    (acc, n) =>
      acc.replace(
        new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"),
        "",
      ),
    alias ? t.slice(alias.length) : t,
  );
  if (/^\W*\d/.test(rest)) out.push("a number leads the title");
  return out;
}

// ---------------------------------------------------------------- chapter cadence

/** The chapter writer's instruction for moment marks (LONG_CHAPTER_CADENCE). */
export const CHAPTER_MARK_RULE = `Moment marks: the video's chapter list needs a mark every one to two minutes (every 150 to 280 spoken words). Give "mark" to the paragraphs that start a new moment of the story, about one paragraph in two after the first: a plain 2 to 5 word label a viewer would search or skim for ("The Price Reveal", "Servers Go Dark", "Sony Steps In"), naming what happens, never "Part 2", a question, a pun or a teaser. Leave "mark" out of the first paragraph (the chapter card names it) and out of the rest.`;

/** A chapter label in plain words (pure): no question or exclamation marks, quotes, ellipses or numbering. */
export function plainChapterLabel(label: string): string {
  return (
    label
      .replace(
        /^\s*(?:part|chapter|section)\s*(?:\d+|[ivx]+)\s*[:.\-]?\s*/i,
        "",
      )
      // Double quotes go; an apostrophe inside a word ("Sony's") stays.
      .replace(/["“”‘]/g, "")
      .replace(/[?!]+|\.{2,}|…/g, "")
      .replace(/[:;,.]\s*$/, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** The marker the chapter list carries on a moment mark until the cadence pass keeps or drops it. */
export const MOMENT_MARK = "\u0001";

const secondsOf = (line: string) =>
  (line.trim().split(/\s+/)[0] ?? "")
    .split(":")
    .reduce((a, b) => a * 60 + Number(b), 0);

/**
 * The chapter list with its moment marks thinned to the cadence (pure): a chapter mark always stays; a moment mark
 * stays only when it is at least `minGap` seconds from the mark before and the next chapter mark. Labels come out plain.
 */
export function cadenceChapters(
  lines: readonly string[],
  minGap = 60,
): string[] {
  const parsed = lines.map((l) => {
    const m = l.match(/^(\S+)\s+(.*)$/);
    const label = m?.[2] ?? "";
    return {
      t: secondsOf(l),
      stamp: m?.[1] ?? "",
      moment: label.startsWith(MOMENT_MARK),
      label: label.replace(MOMENT_MARK, ""),
    };
  });
  const out: typeof parsed = [];
  for (const [i, p] of parsed.entries()) {
    if (!p.moment) {
      // A chapter mark pushes out a moment mark kept just before it.
      while (out.length && out.at(-1)!.moment && p.t - out.at(-1)!.t < minGap)
        out.pop();
      out.push(p);
      continue;
    }
    const prev = out.at(-1);
    const nextChapter = parsed.slice(i + 1).find((x) => !x.moment);
    if (prev && p.t - prev.t < minGap) continue;
    if (nextChapter && nextChapter.t - p.t < minGap) continue;
    out.push(p);
  }
  return out.map(
    (p) => `${p.stamp} ${p.moment ? plainChapterLabel(p.label) : p.label}`,
  );
}

/** The gaps between marks over `max` seconds (pure), for the cadence report: [from, to] in seconds. */
export function cadenceGaps(
  lines: readonly string[],
  durationSeconds: number,
  max = 120,
): Array<[number, number]> {
  const ts = lines.map(secondsOf).sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (const [i, t] of ts.entries()) {
    const next = ts[i + 1] ?? durationSeconds;
    if (next - t > max) out.push([t, next]);
  }
  return out;
}
