// Story selection, scripting and fact-checking. The model does the judgement;
// this file enforces the rules that must never depend on model compliance.

import type { Llm } from "./llm.ts";
import { parsePairs, parseMilestones } from "../render/components/cards/helpers.ts";
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
- American English spelling and vocabulary for a US-first audience (color, favorite, center, realize, defense, rumor). AP news style: no serial (Oxford) comma.
- Brisk, confident, lightly opinionated. Short declarative sentences. No filler, no hype-bro slang.
- Advertiser-friendly: no profanity, no graphic violence, no shock language, no fake stakes.
- Never present a rumour, leak or report as fact. Rumors use "reportedly", "according to" or "rumored" and name who is reporting it.
- Never invent facts, numbers, dates, prices or quotes. Every factual claim must come from the provided sources, or be long-established public knowledge (for example a game's original release year).
- Never say "let me know in the comments", "like and subscribe" or similar calls to action.
- No personal details about the channel's operator. The channel speaks as "we" ("we're ranking", "our pick", "we think"), never about itself in the third person ("Pulse is ranking"); the name Pulse is on screen and needs no saying.`;

export function selectionPrompt(): string {
  return `${HOUSE_STYLE}

You are the editor choosing today's story. Pick the single candidate that will make the best Short for cold viewers:
- Big franchises, release dates, delays, price changes, reveals, sales milestones and major studio news beat niche patch notes.
- Prefer stories with a concrete fact a viewer can repeat to a friend.
- Avoid deals posts, reviews, guides, listicles, podcasts and tragedies.
- The Short can only show official trailers, official store art and official press images. Never pick a story whose point is something to look at that we cannot show: real-world photos (marketing stunts, billboards, cars, merchandise, events), leaked or fan images, cosplay, mods, or the shots of a brand-new trailer. A viewer would hear about it over pictures of something else. Mark such a story real_world_images.
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
   - "price" for a price: primary is the US dollar price exactly as written (e.g. $69.99) when the sources or Steam facts give one, else the price as given; was is the old price in the same currency if the story gives one; region is the platform or "US"; items lists the same price in the other currencies (£ and €) only when the sources or Steam facts state them. Speak the US price in the narration.
   - "score" for a review score or rating out of 100: primary is the score as written, value_a the number 0-100, items up to 3 outlet names.
   - "compare" for one number against others (sales, players, prices across platforms): items are 2-5 rows as "label:value" with the subject row marked "*label:value".
   - "platforms" when the platforms are the news (a port, a new console, a "not on Switch" story): primary is a 2-5 word phrase, items are 1-6 platform names as written (PS5, Xbox Series X|S, PC, Switch 2), secondary may carry a short note such as "Day one on Game Pass".
   - "versus" for one thing against another (new against old hardware, two games, two prices): primary is a 2-5 word phrase, items are exactly two rows as "label:value", the subject marked with a leading *.
   - "specs" for a sheet of facts (hardware specs, what an edition includes): primary is a 2-5 word phrase, items are 2-6 rows as "label:value" with short values.
   - "milestones" for a history of three to five dates (announced, delayed, trailer, launch): primary is a 2-5 word phrase, items are rows as "YYYY-MM:label" or "YYYY-MM-DD:label", oldest first, labels of 1-3 words.
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
  opts: { mustLabelRumour: boolean; feedback?: string[]; storeData?: string; lessons?: string },
): Promise<Script> {
  const rules = opts.mustLabelRumour
    ? "\nThis story is NOT confirmed by an official source or two independent outlets. Set is_rumour true and attribute every claim to whoever reported it."
    : "";
  const feedback = opts.feedback?.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${opts.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    system: scriptPrompt(),
    content: `Sources:\n${sourcesBlock(articles, cluster)}${storeBlock(opts.storeData)}${rules}${opts.lessons ? `\n\n${opts.lessons}` : ""}${feedback}`,
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
const BRITICISMS: Array<[RegExp, string]> = [
  [/\bcolour(s|ed|ful)?\b/i, "color"],
  [/\bfavourite(s)?\b/i, "favorite"],
  [/\bcentre(s|d)?\b/i, "center"],
  [/\brealis(e|ed|es|ing)\b/i, "realize"],
  [/\borganis(e|ed|ation)\b/i, "organize"],
  [/\bapologis(e|ed)\b/i, "apologize"],
  [/\bdefence\b/i, "defense"],
  [/\bfavour\b/i, "favor"],
  [/\bhonour(s|ed)?\b/i, "honor"],
  [/\banalys(e|ed|ing)\b/i, "analyze"],
  [/\brumour(s|ed)?\b/i, "rumor"],
  [/\bmonetis(e|ed|ation)\b/i, "monetize"],
  [/\bcatalogue\b/i, "catalog"],
  [/\bprogramme(s)?\b/i, "program"],
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
  for (const [re, fix] of BRITICISMS) if (re.test(allText)) problems.push(`Use American spelling ("${fix}"), found "${allText.match(re)?.[0]}".`);
  if (/\b\w+, [\w ]+, and\b/.test(allText)) problems.push("Remove the serial (Oxford) comma before \"and\".");
  if (s.youtube.title.length > 100) problems.push("The YouTube title is over 100 characters.");
  if (wordCount(s.headline) > 9) problems.push("The on-screen headline is longer than 8 words.");
  if (!s.pulse_take.narration.trim()) problems.push("The Pulse take is empty.");
  if (s.is_rumour && !/\b(reportedly|rumoured|according to|allegedly|claims?|reports?|suggests?|rumored)\b/i.test(spoken)) {
    problems.push("A rumour script must attribute its claims (reportedly / according to ...).");
  }
  for (const b of s.beats) {
    if (b.visual.kind !== "none" && wordCount(b.visual.primary) > 7) problems.push(`On-screen text "${b.visual.primary}" is too long to read in a second.`);
    const iso = (d?: string) => !!d && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(d.trim());
    if (b.visual.kind === "chapter") problems.push(`The "chapter" card is for documentaries only; pick another card for "${b.visual.primary}".`);
    if (b.visual.kind === "timeline" && !(iso(b.visual.date_from) && iso(b.visual.date_to))) problems.push(`Timeline card "${b.visual.primary}" needs date_from and date_to as ISO dates.`);
    if (b.visual.kind === "countdown" && !iso(b.visual.date_to)) problems.push(`Countdown card "${b.visual.primary}" needs date_to as an ISO date.`);
    if (b.visual.kind === "price" && !/\d/.test(b.visual.primary)) problems.push(`Price card "${b.visual.primary}" has no price.`);
    if (b.visual.kind === "score" && !(typeof b.visual.value_a === "number" && b.visual.value_a >= 0 && b.visual.value_a <= 100)) problems.push(`Score card "${b.visual.primary}" needs value_a between 0 and 100.`);
    if (b.visual.kind === "compare" && (b.visual.items ?? []).filter((r) => /:\s*[^:]*\d/.test(r)).length < 2) problems.push(`Compare card "${b.visual.primary}" needs at least two label:value rows.`);
    if (b.visual.kind === "platforms" && !(b.visual.items ?? []).some((x) => x.trim())) problems.push(`Platforms card "${b.visual.primary}" needs at least one platform in items.`);
    if (b.visual.kind === "versus" && parsePairs(b.visual.items ?? []).length !== 2) problems.push(`Versus card "${b.visual.primary}" needs exactly two label:value rows.`);
    if (b.visual.kind === "specs" && parsePairs(b.visual.items ?? []).length < 2) problems.push(`Specs card "${b.visual.primary}" needs at least two label:value rows.`);
    if (b.visual.kind === "milestones" && parseMilestones(b.visual.items ?? []).length < 3) problems.push(`Milestones card "${b.visual.primary}" needs three to five rows as YYYY-MM:label.`);
  }
  return problems;
}
