// Rankings keep number one for its turn. The channel's voice says "give the verdict early", which is right for
// news and wrong for a countdown: `oiyFG7VPy-k` opened "Street Fighter 6 wins." and a viewer had no reason to stay
// (owner, 4 Nov 2026). These checks read a draft for number one's name, the short forms people use for it and its
// figure, everywhere a viewer sees before its turn: the hook, the earlier entries, the on-screen title, the YouTube
// title and the description. The writer gets them back as a rejected draft; the last resort is patchSpoilers.
//
// Steam Deals and Release Radar are left out of the title and hook check on purpose: a deals list sells on the price
// (its title leads with the best deal, by design), and a release list runs in date order, so its rank 1 is only the
// last game out. A versus names both contenders by nature, so only a stated result counts there.

const ROMAN: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
};
const WORDS: Record<string, string> = {
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

/** Lower case, no marks or punctuation, a possessive off, Roman numerals and small number words as digits. */
export function normTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => ROMAN[w] ?? WORDS[w] ?? w)
    .join(" ");
}

const has = (hay: string, needle: string) => ` ${hay} `.includes(` ${needle} `);
const cut = (hay: string, needle: string) =>
  needle
    ? ` ${hay} `.split(` ${needle} `).join(" ").replace(/\s+/g, " ").trim()
    : hay;

/** "Street Fighter 6" as "sf6", "sf 6"; "Grand Theft Auto V" as "gta5", "gta 5", "gta". */
function acronyms(base: string): string[] {
  const words = base.split(" ").filter(Boolean);
  const num = /^\d+$/.test(words.at(-1) ?? "") ? words.at(-1)! : "";
  const stem = num ? words.slice(0, -1) : words;
  if (stem.length < 2) return [];
  const out: string[] = [];
  for (const w of [stem, stem.filter((x) => x !== "the" && x !== "of")]) {
    const letters = w.map((x) => x[0]).join("");
    if (letters.length < 2) continue;
    if (num) out.push(`${letters}${num}`, `${letters} ${num}`);
    if (letters.length >= 3) out.push(letters);
  }
  return [...new Set(out)];
}

export interface WinnerAliases {
  /** Matched on normalised text. */
  phrases: string[];
  /** One ordinary word ("Reach"): only as a capitalised name, never the verb that starts a sentence. */
  capitalised: string[];
}

/**
 * Every form of number one a viewer would recognise: the full title, the title without its subtitle, the subtitle,
 * the title without the series name and the acronym. A form that is the theme, or another entry's own title, says
 * nothing about number one and is dropped ("Halo 3" must not fire on "Halo 3: ODST").
 */
export function winnerAliases(
  title: string,
  theme: string,
  others: string[],
): WinnerAliases {
  const full = normTitle(title);
  const themed = normTitle(theme);
  const otherTitles = others.map(normTitle);
  const parts = title.split(/\s*(?::| - | – )\s*/);
  const base = normTitle(parts[0] ?? title);
  const subtitle = parts.length > 1 ? normTitle(parts.slice(1).join(" ")) : "";
  const candidates = new Set<string>([
    full,
    base,
    ...acronyms(base),
    ...acronyms(full),
  ]);
  const lone: string[] = [];
  const add = (form: string, written: string) => {
    if (!form) return;
    if (form.includes(" ") || /\d/.test(form)) candidates.add(form);
    else if (form.length >= 4) lone.push(written);
  };
  if (subtitle)
    add(
      subtitle.replace(/^the /, ""),
      parts
        .slice(1)
        .join(" ")
        .trim()
        .replace(/^the\s+/i, ""),
    );
  if (themed && full.startsWith(`${themed} `)) {
    const rest = full.slice(themed.length + 1).replace(/^the /, "");
    if (/[a-z]/.test(rest)) add(rest, title.split(/\s+/).at(-1) ?? rest);
  }
  const phrases = [...candidates].filter(
    (p) =>
      p &&
      p !== themed &&
      !has(themed, p) &&
      !otherTitles.includes(p) &&
      /[a-z]/.test(p),
  );
  return {
    phrases: phrases.sort((a, b) => b.length - a.length),
    capitalised: lone.filter((w) => !has(themed, normTitle(w))),
  };
}

/** The form of number one a text names, once its own subject, the other entries and the theme are taken out. */
export function namesWinner(
  text: string,
  winner: string,
  theme: string,
  others: string[],
): string | undefined {
  const aliases = winnerAliases(winner, theme, others);
  const norm = normTitle(text);
  const longer = others.map(normTitle).sort((a, b) => b.length - a.length);
  // Only another entry's title that contains the form can explain it away: "Halo 3 ODST" for "Halo 3".
  for (const p of aliases.phrases) {
    let rest = norm;
    for (const o of longer) if (has(o, p)) rest = cut(rest, o);
    if (has(rest, p)) return p;
  }
  for (const w of aliases.capitalised) {
    const re = new RegExp(
      `(?<![.!?]\\s)(?<!^)\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    );
    if (re.test(text)) return w;
  }
  return undefined;
}

/** A line that hands over the result without a name: "the newest one wins". */
const HINTS =
  /\b(newest|latest|oldest|original|first|last|most recent|cheapest|rarest)\b[^.!?]{0,30}\b(wins|takes it|comes out on top|is the best|tops the list|beats them all)\b/i;
const VERDICT =
  /\b(wins|beats|takes it|comes out on top|is the winner|is better)\b/i;

export interface RankedDraft {
  format: string;
  theme: string;
  title: string;
  hook: string;
  entries: Array<{
    rank: number;
    game_title: string;
    one_line: string;
    verdict_chip: string;
    percent?: number;
    peak?: number;
    platforms?: string;
  }>;
  youtube: { title: string; description: string };
}

/** Formats whose title and hook are free to name rank 1. */
export const SPOILER_EXEMPT = new Set(["steam_deals", "release_radar"]);

/** Percentages said before number one's turn may only be the ceiling of the list ("all under 5%"), never its floor. */
function percentSpoiler(
  text: string,
  entries: RankedDraft["entries"],
): string | undefined {
  const known = entries
    .map((x) => x.percent)
    .filter((p): p is number => typeof p === "number");
  if (!known.length) return undefined;
  const ceiling = Math.max(...known);
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?(?:%|percent\b)/gi))
    if (Number(m[1]) < ceiling) return `${m[1]}%`;
  return undefined;
}

/** A climb or a peak: the top result's own number, said early. */
function figureSpoiler(
  text: string,
  top: RankedDraft["entries"][number],
): string | undefined {
  const figures: string[] = [];
  if (typeof top.peak === "number")
    figures.push(top.peak.toLocaleString("en-US"), String(top.peak));
  for (const m of `${top.platforms ?? ""} ${top.verdict_chip}`.matchAll(
    /(?:UP |\+)(\d+)/g,
  ))
    figures.push(m[1]!);
  for (const f of figures)
    if (new RegExp(`(?<![\\d,.])${f}(?![\\d,])`).test(text)) return f;
  return undefined;
}

/** What a draft gives away before number one's turn. Empty when it keeps the result for the end. */
export function spoilerProblems(e: RankedDraft): string[] {
  const p: string[] = [];
  const ordered = [...e.entries].sort((a, b) => a.rank - b.rank);
  const top = ordered[0];
  if (!top || ordered.length < 2) return p;
  const others = ordered.slice(1).map((x) => x.game_title);
  const exempt = SPOILER_EXEMPT.has(e.format);
  const surfaces: Array<[string, string]> = [
    ["The hook", e.hook],
    ["The on-screen title", e.title],
    ["The YouTube title", e.youtube.title],
    ["The description", e.youtube.description],
  ];
  if (!exempt && e.format !== "versus")
    for (const [where, text] of surfaces) {
      const named = namesWinner(text, top.game_title, e.theme, others);
      if (named)
        p.push(
          `${where} gives away number one ("${named}" is ${top.game_title}). A ranking keeps number one for its own turn: rewrite it without naming or hinting at the winner.`,
        );
      const figure =
        percentSpoiler(text, e.entries) ?? figureSpoiler(text, top);
      if (figure)
        p.push(
          `${where} says ${figure}, which gives away number one's result. Use the list's ceiling ("all under 5%") or no figure.`,
        );
    }
  if (!exempt && HINTS.test(e.hook))
    p.push(
      `The hook hints at who wins ("${e.hook}"). Keep the result for number one's own turn.`,
    );
  if (
    e.format === "versus" &&
    VERDICT.test(e.hook) &&
    namesWinner(e.hook, top.game_title, e.theme, others)
  )
    p.push(
      "The hook states the versus result. Set up the contest; say who wins at the end.",
    );
  for (const x of ordered.slice(1)) {
    // Its own title and the other entries come out first, so "Halo 3: ODST" never fires for "Halo 3".
    const named = namesWinner(
      `${x.one_line} ${x.verdict_chip}`,
      top.game_title,
      e.theme,
      others,
    );
    if (named)
      p.push(
        `The entry at number ${x.rank} ("${x.game_title}") mentions number one ("${named}") before its turn: take it out.`,
      );
  }
  return p;
}

/** The whole number a list of percentages is honestly "under": 4.4 gives 5, an exact 5 gives 6. */
export function underFigure(percents: number[]): number {
  return Math.floor(Math.max(...percents)) + 1;
}

/** The last resort after a rewrite still spoiled the result: plain, safe wording for whatever the writer can't fix. */
export function patchSpoilers<T extends RankedDraft>(e: T): T {
  if (SPOILER_EXEMPT.has(e.format)) return e;
  const count = e.entries.length;
  const known = e.entries
    .map((x) => x.percent)
    .filter((p): p is number => typeof p === "number");
  const hardest = e.format === "hardest_achievements";
  const achieve = hardest || e.format === "rarest_achievements";
  const kind = hardest ? "hardest" : "rarest";
  const subject = hardest ? "gaming right now" : e.theme;
  const under = known.length ? underFigure(known) : 0;
  const problems = spoilerProblems(e);
  const spoiled = (label: string) => problems.some((x) => x.startsWith(label));
  const youtube = { ...e.youtube };
  const out: T = { ...e, youtube };
  if (spoiled("The hook"))
    out.hook = achieve
      ? `The ${kind} achievements in ${subject}, all under ${under}% of players.`
      : `We rank ${e.theme} from the bottom up, and number one comes last.`;
  if (spoiled("The on-screen title"))
    out.title = achieve
      ? `The ${kind[0]!.toUpperCase()}${kind.slice(1)} Achievements in ${subject}`
      : `${e.theme} Ranked`;
  if (spoiled("The YouTube title"))
    youtube.title = achieve
      ? `The ${kind[0]!.toUpperCase()}${kind.slice(1)} Achievements in ${subject}`
      : `${e.theme}: Ranked From the Bottom Up`;
  if (spoiled("The description"))
    youtube.description = achieve
      ? `We count down ${count} of the ${kind} achievements in ${subject} by Steam's global unlock rates.`
      : `We count down ${count} ${e.theme} picks from the bottom up.`;
  return out;
}
