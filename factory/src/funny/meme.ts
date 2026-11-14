// Meme posts (MEME_POSTS), pure parts: a well-known meme layout recreated as Pulse's own graphic, filled with the
// owner's own stream frames and short lines in the friend voice. No meme photos (the layouts are formats, drawn by
// us), no AI pictures of Rockstar's characters, nothing cruel, crude or advertiser-unfriendly.
//
// The layouts (src/render/Meme.tsx draws them, 1080x1350 so Instagram, X and the Community tab all show it whole):
//   nobody_me            "Nobody:" / "Me ...:" over one frame
//   expectation_reality  two frames, the calm before (EXPECTATION) and the payoff (REALITY), with a line
//   top_bottom           the classic top line and bottom line over one frame
//   two_panel            the "no / yes" two-row format: a line beside each frame, a cross then a tick
//   pov                  "POV: ..." over one frame

import { captionProblems } from "./edit.ts";

export type MemeLayout =
  | "nobody_me"
  | "expectation_reality"
  | "top_bottom"
  | "two_panel"
  | "pov";

export interface MemePick {
  id: string;
  layout: MemeLayout;
  /** The words in the layout's order. */
  lines: string[];
  /** The owner's frames, in the layout's order (file paths). */
  frames: string[];
  /** The post's text for the Community tab, Instagram and X: one line and a question, then hashtags. */
  post: string;
  /** The bank entry used, so the next weeks do not repeat it. */
  key: string;
}

interface BankEntry {
  key: string;
  layout: MemeLayout;
  lines: string[];
  /** Frames the layout needs. */
  frames: 1 | 2;
  kinds: string[];
  question: string;
}

/** The lines, by the kind of moment they fit. Aimed at the game and the situation, never at a person. */
export const MEME_BANK: BankEntry[] = [
  {
    key: "nm_calm",
    layout: "nobody_me",
    lines: ["Nobody:", "Me, one inch from disaster, so calm:"],
    frames: 1,
    kinds: ["near_miss", "fail"],
    question: "Who else plays like this?",
  },
  {
    key: "nm_plan",
    layout: "nobody_me",
    lines: ["Nobody:", "Me with a full tank and zero plan:"],
    frames: 1,
    kinds: ["near_miss", "physics", "none"],
    question: "What is your worst plan that worked?",
  },
  {
    key: "er_plan",
    layout: "expectation_reality",
    lines: ["EXPECTATION", "REALITY", "The plan vs how it went"],
    frames: 2,
    kinds: ["fail", "physics", "near_miss"],
    question: "Which one is you?",
  },
  {
    key: "er_smooth",
    layout: "expectation_reality",
    lines: ["EXPECTATION", "REALITY", "One smooth run, they said"],
    frames: 2,
    kinds: ["fail", "near_miss", "glitch"],
    question: "How many tries would you need?",
  },
  {
    key: "tb_control",
    layout: "top_bottom",
    lines: ["I had it under control", "I did not have it under control"],
    frames: 1,
    kinds: ["near_miss", "fail"],
    question: "Be honest, how often is this you?",
  },
  {
    key: "tb_physics",
    layout: "top_bottom",
    lines: ["Physics in this game", "Still undefeated"],
    frames: 1,
    kinds: ["physics", "glitch"],
    question: "Best physics moment you have seen?",
  },
  {
    key: "tp_road",
    layout: "two_panel",
    lines: ["Taking the normal route", "Taking the scenic route at full speed"],
    frames: 2,
    kinds: ["near_miss", "physics", "none"],
    question: "Normal route or scenic route?",
  },
  {
    key: "tp_quiet",
    layout: "two_panel",
    lines: ["A quiet evening", "A quiet evening in this game"],
    frames: 2,
    kinds: ["fail", "physics", "npc", "none"],
    question: "When did it last stay quiet for you?",
  },
  {
    key: "pov_game",
    layout: "pov",
    lines: ["POV: the game decided", "you were having too much fun"],
    frames: 1,
    kinds: ["glitch", "fail", "npc"],
    question: "Has the game ever done you like this?",
  },
  {
    key: "pov_locals",
    layout: "pov",
    lines: ["POV: the locals", "have seen it all before"],
    frames: 1,
    kinds: ["npc", "physics"],
    question: "Strangest thing a local has done in front of you?",
  },
];

/** What is wrong with a meme's words, empty when nothing is (pure). */
export function memeProblems(
  m: Pick<MemePick, "lines" | "post" | "frames" | "layout">,
): string[] {
  const out: string[] = [];
  for (const l of m.lines)
    for (const why of captionProblems(l, { words: 9, chars: 44 })) out.push(`"${l}": ${why}`);
  for (const why of captionProblems(m.post.split("\n")[0]!.slice(0, 40)))
    if (!why.startsWith("over ")) out.push(`post: ${why}`);
  if (/[—–]/.test(m.post)) out.push("post: a long dash");
  const need = MEME_BANK.find((b) => b.layout === m.layout)?.frames ?? 1;
  if (m.frames.length < need)
    out.push(`the ${m.layout} layout needs ${need} frame(s)`);
  return out;
}

/** The hashtags for a game's meme post (pure). */
export function memeTags(game: string): string {
  if (/\b(gta\s*(vi|6)|grand theft auto\s*(vi|6))\b/i.test(game))
    return "#GTA6 #GTAVI #gaming";
  if (/\b(gta\s*(v|5)|grand theft auto\s*(v|5))\b/i.test(game))
    return "#GTA5 #GTAV #gaming";
  return "#gaming";
}

/**
 * This week's meme (pure): the first bank entry that fits the week's moment kinds, has the frames it needs and was not
 * used in the last `recent` weeks, rotated by id so weeks differ. Frames come in time order, the calm first.
 */
export function pickMeme(o: {
  id: string;
  frames: string[];
  kinds: string[];
  game: string;
  used?: string[];
}): MemePick {
  const used = new Set(o.used ?? []);
  let h = 0;
  for (const c of o.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rotated = MEME_BANK.map(
    (_, i) => MEME_BANK[(i + h) % MEME_BANK.length]!,
  );
  const fits = (b: BankEntry) =>
    b.frames <= o.frames.length && !used.has(b.key);
  const want = new Set(o.kinds.filter((k) => k && k !== "none"));
  const entry =
    rotated.find((b) => fits(b) && b.kinds.some((k) => want.has(k))) ??
    rotated.find(fits) ??
    rotated.find((b) => b.frames <= o.frames.length) ??
    MEME_BANK[0]!;
  const frames =
    entry.frames === 2
      ? o.frames.slice(0, 2)
      : [o.frames[o.frames.length > 1 ? 1 : 0]!];
  return {
    id: o.id,
    layout: entry.layout,
    lines: entry.lines,
    frames,
    post: `${entry.question}\n${memeTags(o.game)}`,
    key: entry.key,
  };
}
