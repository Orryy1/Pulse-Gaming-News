// Story selection, scripting and fact-checking. The model does the judgement;
// this file enforces the rules that must never depend on model compliance.

import type { Llm } from "./llm.ts";
import type { StoryCluster } from "../discovery/cluster.ts";
import type { ArticleText } from "../discovery/article.ts";
import {
  SelectionSchema,
  ScriptSchema,
  FactCheckSchema,
  narrationOf,
  wordCount,
  type Script,
  type Selection,
  type FactCheck,
} from "./schema.ts";

export const WORDS_MIN = 70;
export const WORDS_MAX = 115;

const HOUSE_STYLE = `You write for Pulse Gaming News, a fast, credible YouTube Shorts channel about video game news.

House style (non-negotiable):
- British English spelling and vocabulary. Never use the serial (Oxford) comma.
- Brisk, confident, lightly opinionated. Short declarative sentences. No filler, no hype-bro slang.
- Advertiser-friendly: no profanity, no graphic violence, no shock language, no fake stakes.
- Never present a rumour, leak or report as fact. Rumours use "reportedly", "according to" or "rumoured" and name who is reporting it.
- Never invent facts, numbers, dates, prices or quotes. Every factual claim must come from the provided sources, or be long-established public knowledge (for example a game's original release year).
- Never say "let me know in the comments", "like and subscribe" or similar calls to action.
- No personal details about the channel's operator. The channel speaks as "Pulse".`;

export function selectionPrompt(): string {
  return `${HOUSE_STYLE}

You are the editor choosing today's story. Pick the single candidate that will make the best Short for cold viewers:
- Big franchises, release dates, delays, price changes, reveals, sales milestones and major studio news beat niche patch notes.
- Prefer stories with a concrete fact a viewer can repeat to a friend.
- Avoid deals posts, reviews, guides, listicles, podcasts, tragedies and anything that needs footage to make sense.
- Avoid anything that repeats a story the channel already covered (listed below).
Return candidate_index -1 if nothing is worth a Short today.`;
}

export function scriptPrompt(): string {
  return `${HOUSE_STYLE}

Write a 25-40 second vertical Short script (${WORDS_MIN}-${WORDS_MAX} spoken words in total across hook, beats, take and loop line).

Structure:
1. hook: state the news itself in the first sentence, with the game name. Never open with "So", "Today", "Hey", "Welcome", "In this", "Guys" or a question that withholds the news.
2. beats: two to four short fact beats, each with one on-screen visual card. Pick the card that fits the fact:
   - "timeline" for a delay or date change: primary is a 2-5 word phrase, date_from is the old date and date_to the new date, both ISO (YYYY-MM or YYYY-MM-DD).
   - "countdown" for a confirmed release date: primary is the date as spoken, date_to is the ISO date.
   - "price" for a price: primary is the new price exactly as written (e.g. £69.99), was is the old price if the story gives one, region is the region or platform.
   - "score" for a review score or rating out of 100: primary is the score as written, value_a the number 0-100, items up to 3 outlet names.
   - "compare" for one number against others (sales, players, prices across platforms): items are 2-5 rows as "label:value" with the subject row marked "*label:value".
   - "stat" for any other number, "date" for other dates, "quote" for a short official quote (under 12 words, from the sources), "list" for 2-3 short items separated by " | ", "title" for a key phrase.
   Never pad a card with numbers the sources do not give.
   Every beat also carries "footage": what the trailer picture should show while that line is spoken, with 1-4 keywords naming the thing, place, character or action in the line. The picture editor matches real trailer moments to these, so be concrete ("Hyrule Field", "the new ship interior", "a car chase"), and use "calm" for lines whose card needs a quiet background (numbers, dates, prices). "hook_footage" does the same for the opening line and should want the most striking gameplay moment.
3. pulse_take: the Pulse angle. This is the reason the Short exists and must add something the headline does not: context (previous delay, series history, price versus the last entry), a comparison, or a clearly framed opinion ("Our read:"). Opinions must be framed as opinion. Do not invent data.
4. loop_line: one line that flows back into the hook so the loop feels seamless.

Visual "primary" text must be short enough to read in a second. The headline is factual and readable on a phone.
List every factual claim in "claims" with the URL of the provided source that supports it.
The YouTube title is "[Game]: [the fact in 4-7 words]", under 60 characters, no exclamation marks, no clickbait words. The description credits the sources by name.`;
}

export function factCheckPrompt(): string {
  return `You are a strict news fact-checker for a gaming news channel. Compare the script against the provided source texts only.

Mark a "blocker" when the script:
- states something the sources do not support (numbers, dates, platforms, prices, names, quotes),
- presents a rumour, leak or analyst estimate as confirmed fact,
- misattributes who said or reported something,
- makes a claim that could be defamatory about a real person or company.
Opinion clearly framed as opinion, and long-established public knowledge, are fine.
Spelling, style and tone are "minor" at most.
verdict is "fail" if there is any blocker.`;
}

function sourcesBlock(articles: ArticleText[], cluster: StoryCluster): string {
  const byUrl = new Map(articles.map((a) => [a.url, a]));
  return cluster.items
    .map((item, i) => {
      const art = byUrl.get(item.url);
      const body = art?.text || item.summary || "(no body text available; headline only)";
      return `<source index="${i}" outlet="${item.source}" kind="${item.sourceKind}" url="${item.url}" published="${item.publishedAt}">
<headline>${item.title}</headline>
<body>${body}</body>
</source>`;
    })
    .join("\n");
}

/** Live Steam store numbers: a verified source the Pulse take can draw on. */
function storeBlock(data?: string): string {
  if (!data) return "";
  return `\n<source outlet="Steam store (live data)" kind="official">\n${data}\n</source>\nThe Steam numbers above are live and verified. Use one where it sharpens the Pulse take or makes a strong stat beat (current players, review score, price); attribute it to Steam and give it as a figure from today.`;
}

export async function selectStory(llm: Llm, candidates: StoryCluster[], recentHeadlines: string[], performance = ""): Promise<Selection> {
  const list = candidates
    .map(
      (c, i) =>
        `${i}. "${c.headline}" | outlets: ${c.sources.join(", ")} | official source: ${c.hasOfficial ? "yes" : "no"} | rumour signals: ${c.rumourSignals ? "yes" : "no"} | newest: ${c.newestAt}\n   ${c.items[0]?.summary.slice(0, 280) ?? ""}`,
    )
    .join("\n");
  return llm.structured({
    system: selectionPrompt(),
    content: `Already covered recently:\n${recentHeadlines.map((h) => `- ${h}`).join("\n") || "- (nothing yet)"}${performance ? `\n\n${performance}` : ""}\n\nCandidates:\n${list}`,
    schema: SelectionSchema,
    effort: "low",
  });
}

export async function writeScript(
  llm: Llm,
  cluster: StoryCluster,
  articles: ArticleText[],
  opts: { mustLabelRumour: boolean; feedback?: string[]; storeData?: string },
): Promise<Script> {
  const rules = opts.mustLabelRumour
    ? "\nThis story is NOT confirmed by an official source or two independent outlets. Set is_rumour true and attribute every claim to whoever reported it."
    : "";
  const feedback = opts.feedback?.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${opts.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    system: scriptPrompt(),
    content: `Sources:\n${sourcesBlock(articles, cluster)}${storeBlock(opts.storeData)}${rules}${feedback}`,
    schema: ScriptSchema,
    effort: "medium",
  });
}

export async function factCheck(llm: Llm, script: Script, cluster: StoryCluster, articles: ArticleText[], storeData?: string): Promise<FactCheck> {
  return llm.structured({
    system: factCheckPrompt(),
    content: `Sources:\n${sourcesBlock(articles, cluster)}${storeBlock(storeData)}\n\nScript (spoken):\n${narrationOf(script)}\n\nOn-screen text:\n- ${script.headline}\n${script.beats
      .map((b) => `- ${b.visual.primary} ${b.visual.secondary}`.trim())
      .join("\n")}\n- ${script.pulse_take.on_screen}\n\nYouTube title: ${script.youtube.title}\nYouTube description: ${script.youtube.description}\nScript labels this as rumour: ${script.is_rumour}`,
    schema: FactCheckSchema,
    effort: "medium",
  });
}

const BANNED_OPENERS = /^(so|today|hey|welcome|in this|guys|what's up|hello)\b/i;
const BANNED_PHRASES = [
  /let me know in the comments/i,
  /like and subscribe/i,
  /smash (that|the) like/i,
  /don'?t forget to subscribe/i,
  /\byou won'?t believe\b/i,
  /\bshocking\b/i,
];
const AMERICANISMS: Array<[RegExp, string]> = [
  [/\bcolor(s|ed|ful)?\b/i, "colour"],
  [/\bfavorite(s)?\b/i, "favourite"],
  [/\bcenter(s|ed)?\b/i, "centre"],
  [/\brealiz(e|ed|es|ing)\b/i, "realise"],
  [/\borganiz(e|ed|ation)\b/i, "organise"],
  [/\bapologiz(e|ed)\b/i, "apologise"],
  [/\bdefense\b/i, "defence"],
  [/\bfavor\b/i, "favour"],
  [/\bhonor(s|ed)?\b/i, "honour"],
  [/\banalyz(e|ed|ing)\b/i, "analyse"],
  [/\brumor(s|ed)?\b/i, "rumour"],
  [/\bmonetiz(e|ed|ation)\b/i, "monetise"],
];

/** Deterministic house-rule checks. Returns human-readable problems; empty means valid. */
export function validateScript(s: Script): string[] {
  const problems: string[] = [];
  const spoken = narrationOf(s);
  const words = wordCount(spoken);
  if (words < WORDS_MIN || words > WORDS_MAX) problems.push(`Spoken word count is ${words}; it must be ${WORDS_MIN}-${WORDS_MAX}.`);
  if (BANNED_OPENERS.test(s.hook.trim())) problems.push(`The hook must not open with "${s.hook.trim().split(/\s+/)[0]}".`);
  if (wordCount(s.hook) > 18) problems.push("The hook is longer than 18 words.");
  if (s.beats.length < 2 || s.beats.length > 4) problems.push("There must be two to four beats.");
  const allText = [spoken, s.headline, s.youtube.title, s.youtube.description, s.pulse_take.on_screen, ...s.beats.map((b) => `${b.visual.primary} ${b.visual.secondary}`)].join("\n");
  for (const re of BANNED_PHRASES) if (re.test(allText)) problems.push(`Banned phrase matched: ${re.source}.`);
  for (const [re, fix] of AMERICANISMS) if (re.test(allText)) problems.push(`Use British spelling ("${fix}"), found "${allText.match(re)?.[0]}".`);
  if (/\b\w+, [\w ]+, and\b/.test(allText)) problems.push("Remove the serial (Oxford) comma before \"and\".");
  if (s.youtube.title.length > 100) problems.push("The YouTube title is over 100 characters.");
  if (wordCount(s.headline) > 9) problems.push("The on-screen headline is longer than 8 words.");
  if (!s.pulse_take.narration.trim()) problems.push("The Pulse take is empty.");
  if (s.is_rumour && !/\b(reportedly|rumoured|according to|allegedly|claims?|reports?|suggests?)\b/i.test(spoken)) {
    problems.push("A rumour script must attribute its claims (reportedly / according to ...).");
  }
  for (const b of s.beats) {
    if (b.visual.kind !== "none" && wordCount(b.visual.primary) > 7) problems.push(`On-screen text "${b.visual.primary}" is too long to read in a second.`);
    const iso = (d?: string) => !!d && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(d.trim());
    if (b.visual.kind === "timeline" && !(iso(b.visual.date_from) && iso(b.visual.date_to))) problems.push(`Timeline card "${b.visual.primary}" needs date_from and date_to as ISO dates.`);
    if (b.visual.kind === "countdown" && !iso(b.visual.date_to)) problems.push(`Countdown card "${b.visual.primary}" needs date_to as an ISO date.`);
    if (b.visual.kind === "price" && !/\d/.test(b.visual.primary)) problems.push(`Price card "${b.visual.primary}" has no price.`);
    if (b.visual.kind === "score" && !(typeof b.visual.value_a === "number" && b.visual.value_a >= 0 && b.visual.value_a <= 100)) problems.push(`Score card "${b.visual.primary}" needs value_a between 0 and 100.`);
    if (b.visual.kind === "compare" && (b.visual.items ?? []).filter((r) => /:\s*[^:]*\d/.test(r)).length < 2) problems.push(`Compare card "${b.visual.primary}" needs at least two label:value rows.`);
  }
  return problems;
}
