// How Pulse credits a fact on air (owner, 13 Nov 2026, on the 10 Nov launch guide: "according to Wikipedia according
// to Wikipedia according to Wikipedia so many times ... can we also state that type of line a little differently each
// time so it's not dead repetitive"). That script said "Wikipedia" 25 times and "Rockstar confirms" 16 times in 26
// minutes. Shared by every writer (news, rankings, documentaries, the weekly guide, retrospectives, search Shorts):
//   - ATTRIBUTION_RULE goes into every writer's facts rules (PULSE_FACT_RULES, src/editorial/voice.ts);
//   - attributionProblems finds Wikipedia said on air, a credit frame ("according to Kotaku", "Rockstar confirms")
//     repeated within about a minute of narration, or used more than three times in a video, and "according to"
//     leaned on as the one shape; writingProblems sends those back with the other sound-aloud problems;
//   - scrubWikipedia is the last word: a line that still names Wikipedia loses the credit (or says "records show");
//   - ATTRIBUTION_VARY is the friend pass's note to vary what is left.
// ATTRIBUTION_GUARD (on by default) switches the checks.

import { stripVoiceTags } from "../voice/tags.ts";

/** The attribution rule for every writer: which claims carry a credit, whom to credit, and how to vary it. */
export const ATTRIBUTION_RULE = `Credits on air (who said it):
- Credit only the claims that need it: a number, a quote, a contested or surprising claim, a rumor or a report. A settled, widely known fact (a release year, who made the game) is just said plainly, with no credit.
- Credit the original source: the studio, the publisher's post, the interview, the review, the earnings report or the outlet that reported it, as the material names it (a ⁽n⁾ mark in the research notes names who first reported that line). Never say "Wikipedia" or "according to Wikipedia" on air; when the notes name no original, say it plainly or "records show", never Wikipedia.
- Vary the credit the way a person talks, and never use the same frame twice within a minute or more than three times in a whole video: "Rockstar told IGN...", "in a 2013 interview with Edge, Houser said...", "Take-Two's own earnings call put it at...", "Digital Foundry measured...", "Kotaku's sources say...", "the official site lists...", or just the fact. "According to" is one shape of many, at most a few times in a long video.`;

/** The friend pass's note on credits: vary what repeats, never drop a rumor's label. */
export const ATTRIBUTION_VARY = `Credits: where the same credit comes back ("Rockstar confirms" again, a second "according to"), reword the later one the way a person would ("Rockstar's own post says", "per the official listing", "IGN's preview put it at") or, for a settled fact that isn't a number, quote or rumor, just say the fact. Keep every rumor's label ("reportedly", a named reporter) and every credit on a number or a quote. Never say "Wikipedia" on air: credit the original the notes name, or drop the credit.`;

/** ATTRIBUTION_GUARD on its own: the pure validators run before any Config exists. */
export function attributionGuardOn(): boolean {
  const v = (process.env.ATTRIBUTION_GUARD ?? "").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(v);
}

export interface Frame {
  /** The frame as a credit: "according to kotaku", "rockstar confirm". */
  key: string;
  /** "according to" when it is that shape (its own limit), else the key. */
  shape: string;
  /** The words as written. */
  phrase: string;
  /** Its position in words from the start of the text. */
  word: number;
}

const VERBS =
  "says|said|say|reports|reported|report|confirms|confirmed|confirm|told|tells|tell|notes|noted|writes|wrote|estimates|estimated|claims|claimed|explains|explained|admits|admitted|insists|insisted|measured|measures|lists|listed|puts it|put it|announced|announces|revealed|reveals|states|stated";
const NOT_A_SOURCE = new Set(
  "it he she they that this the we i you there which who what one someone nobody everyone his her their its and but so then now yes no also later still once those these both others some many most players fans gamers".split(
    " ",
  ),
);
// Case matters here: a name starts with a capital, so these patterns never take the "i" flag.
const NAME = `[A-Z][\\w'’&+-]*(?:\\s+(?:of|the|de|[A-Z][\\w'’&+-]*)){0,3}`;
const ACCORDING = new RegExp(
  `\\b[Aa]ccording to\\s+((?:the\\s+)?${NAME}|(?:that|this|the|his|her|their|its|an?)\\s+[a-z]+)`,
  "g",
);
const SAYS = new RegExp(
  `\\b(${NAME})(?:'s?|’s?)?\\s+(?:also\\s+|later\\s+|again\\s+|even\\s+|then\\s+)?(${VERBS})\\b`,
  "g",
);
const INTERVIEW = new RegExp(
  `\\b[Ii]n an?\\s+(?:\\d{4}\\s+)?interview with\\s+(${NAME})`,
  "g",
);
const RECORDS = /\brecords show\b/gi;
const WIKI = /\bwikipedia\b/gi;

const lemma = (v: string) =>
  v
    .toLowerCase()
    .replace(/^puts? it$/, "put it")
    .replace(/^(said|says)$/, "say")
    .replace(/^(told|tells)$/, "tell")
    .replace(/^(wrote|writes)$/, "write")
    .replace(/(ed|s)$/, "")
    .replace(/e$/, "");

const whoKey = (who: string) =>
  who
    .replace(/[’']s?$/, "")
    .replace(/^the\s+/i, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ")
    .toLowerCase();

const wordAt = (text: string, index: number) =>
  text.slice(0, index).split(/\s+/).filter(Boolean).length;

/** The credit frames a text uses, in order (pure). Rumor labels ("reportedly") are not frames: they repeat by rule. */
export function attributionFrames(text: string): Frame[] {
  const t = stripVoiceTags(text);
  const out: Frame[] = [];
  for (const m of t.matchAll(ACCORDING)) {
    const who = whoKey(m[1]!);
    out.push({
      key: `according to ${who}`,
      shape: "according to",
      phrase: m[0],
      word: wordAt(t, m.index!),
    });
  }
  for (const m of t.matchAll(SAYS)) {
    const first = m[1]!.split(/\s+/)[0]!.toLowerCase();
    if (NOT_A_SOURCE.has(first)) continue;
    // "According to Kotaku" already counted; a quoted line's own words are not our credit.
    const who = whoKey(m[1]!);
    const key = `${who} ${lemma(m[2]!)}`;
    out.push({ key, shape: key, phrase: m[0], word: wordAt(t, m.index!) });
  }
  for (const m of t.matchAll(INTERVIEW)) {
    const key = `interview with ${whoKey(m[1]!)}`;
    out.push({ key, shape: key, phrase: m[0], word: wordAt(t, m.index!) });
  }
  for (const m of t.matchAll(RECORDS))
    out.push({
      key: "records show",
      shape: "records show",
      phrase: m[0],
      word: wordAt(t, m.index!),
    });
  return out.sort((a, b) => a.word - b.word);
}

export interface AttributionOptions {
  /** Narration said before this text (earlier chapters): repeats are counted across both, reported only here. */
  before?: string;
  /** Spoken pace in words a minute: about 140 in a documentary, 165 in a Short. */
  wpm?: number;
  /** Two uses of one frame closer than this are a repeat (default 60 seconds). */
  windowSeconds?: number;
  /** One frame more often than this in the whole video is a tic (default 3). */
  maxPerVideo?: number;
  /** "According to" as a shape, whoever follows it, more often than this (default 4). */
  maxAccordingTo?: number;
}

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/**
 * What is wrong with the credits in a text (pure): Wikipedia said on air, one frame twice within the window, one
 * frame over the video limit, and "according to" leaned on. Each problem names the frame and where it falls, and is
 * reported only when this text (not `before`) carries one of its uses. Quotations are never counted.
 */
export function attributionProblems(
  text: string,
  opts: AttributionOptions = {},
): string[] {
  const wpm = opts.wpm ?? 140;
  const windowWords = ((opts.windowSeconds ?? 60) / 60) * wpm;
  const max = opts.maxPerVideo ?? 3;
  const maxAccording = opts.maxAccordingTo ?? 4;
  const outside = (t: string) =>
    stripVoiceTags(t).replace(/"[^"]*"|“[^”]*”/g, (q) => q.replace(/\S/g, "x"));
  const before = opts.before ? outside(opts.before) : "";
  const offset = before.split(/\s+/).filter(Boolean).length;
  const all = attributionFrames(
    before ? `${before} ${outside(text)}` : outside(text),
  );
  const mine = (f: Frame) => f.word >= offset;
  const at = (f: Frame) => clock(((f.word - offset) / wpm) * 60);
  const p: string[] = [];
  const wiki = [...outside(text).matchAll(WIKI)];
  if (wiki.length)
    p.push(
      `The narration names Wikipedia ${wiki.length === 1 ? "once" : `${wiki.length} times`}; never say Wikipedia on air. Credit the original source the notes name for that line (a ⁽n⁾ mark: the studio, the interview, the review, the outlet), or say the fact plainly.`,
    );
  const groups = new Map<string, Frame[]>();
  for (const f of all) {
    if (f.key.includes("wikipedia")) continue;
    groups.set(f.key, [...(groups.get(f.key) ?? []), f]);
  }
  for (const [key, fs] of groups) {
    if (!fs.some(mine)) continue;
    const close = fs.findIndex(
      (f, i) => i > 0 && mine(f) && f.word - fs[i - 1]!.word < windowWords,
    );
    if (fs.length > max)
      p.push(
        `"${fs.find(mine)!.phrase}" (${key}) is used ${fs.length} times; keep the credit for the claims that need one (a number, a quote, a contested or surprising claim) and at most ${max} times in a video, word the others differently ("told IGN", "in its own post", "the earnings call put it at") or just state the fact.`,
      );
    else if (close > 0)
      p.push(
        `"${fs[close]!.phrase}" comes twice within a minute (around ${at(fs[close]!)}); say the second one differently or state the fact plainly.`,
      );
  }
  const according = all.filter(
    (f) => f.shape === "according to" && !f.key.includes("wikipedia"),
  );
  if (according.some(mine)) {
    const close = according.findIndex(
      (f, i) =>
        i > 0 && mine(f) && f.word - according[i - 1]!.word < windowWords,
    );
    if (according.length > maxAccording)
      p.push(
        `"According to" opens a credit ${according.length} times; it's one shape of many. Use it at most ${maxAccording} times in a video and vary the rest ("Kotaku's sources say", "Rockstar told IGN", "the official site lists").`,
      );
    else if (close > 0 && !p.some((x) => x.includes(according[close]!.phrase)))
      p.push(
        `"According to" comes twice within a minute (around ${at(according[close]!)}); credit the second one another way.`,
      );
  }
  return p;
}

/** The same problems, gated by ATTRIBUTION_GUARD. */
export function guardedAttributionProblems(
  text: string,
  opts: AttributionOptions = {},
): string[] {
  return attributionGuardOn() ? attributionProblems(text, opts) : [];
}

const capitalise = (t: string) =>
  t.replace(
    /(^|[.!?]["”’]?\s+)([a-z])/g,
    (_, a: string, b: string) => `${a}${b.toUpperCase()}`,
  );

/**
 * Wikipedia taken off the air (pure): "According to Wikipedia, X" says X; "Wikipedia reports that X" says "Records
 * show X"; any other mention becomes "the record". The fact stays, the credit goes. The last word after every rewrite.
 */
export function scrubWikipedia(text: string): string {
  if (!/wikipedia/i.test(text)) return text;
  const art = `(?:the\\s+)?(?:English\\s+)?Wikipedia(?:['’]s\\s+(?:article|entry|page|summary)(?:\\s+on\\s+[^,.;]+)?)?`;
  let t = text
    // Mid-sentence first (lower-case "according"), so a sentence-opening credit keeps its full stop before it.
    .replace(new RegExp(`,?\\s*according to ${art}(?=[,.;!?])`, "g"), "")
    .replace(new RegExp(`\\b[Aa]ccording to ${art},?\\s*`, "g"), "")
    .replace(
      new RegExp(
        `\\b[Aa]s ${art} (?:says|notes|puts it|reports|records|tells it),?\\s*`,
        "g",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\b${art} (?:says|reports|notes|states|lists|records|adds|puts it|claims|describes)(?: that)?,?\\s*`,
        "g",
      ),
      "records show ",
    )
    .replace(new RegExp(`\\b${art}\\b`, "gi"), "the record");
  t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.;!?])/g, "$1");
  return capitalise(t.trim());
}

/** Every narration field of a chapter-like object scrubbed; returns how many lines changed. */
export function scrubNarration<T extends { narration: string }>(
  lines: T[],
): { lines: T[]; changed: number } {
  let changed = 0;
  const out = lines.map((l) => {
    const n = scrubWikipedia(l.narration);
    if (n === l.narration) return l;
    changed++;
    return { ...l, narration: n };
  });
  return { lines: out, changed };
}

/** How many credit frames and Wikipedia mentions a text has, for reports and the preview (pure). */
export function attributionCounts(text: string): {
  frames: number;
  wikipedia: number;
  accordingTo: number;
  byKey: Record<string, number>;
} {
  const fs = attributionFrames(text);
  const byKey: Record<string, number> = {};
  for (const f of fs) byKey[f.key] = (byKey[f.key] ?? 0) + 1;
  return {
    frames: fs.length,
    wikipedia: (stripVoiceTags(text).match(WIKI) ?? []).length,
    accordingTo: fs.filter((f) => f.shape === "according to").length,
    byKey,
  };
}
