// Story selection, scripting and fact-checking. The model does the judgement;
// this file enforces the rules that must never depend on model compliance.

import { whyBrief } from "./why.ts";
import { voiceFor, voiceProblems } from "./voice.ts";
import { varyOpinion } from "./phrasing.ts";
import { numberWords } from "../voice/speakable.ts";
import type { Llm } from "./llm.ts";
import {
  parsePairs,
  parseMilestones,
} from "../render/components/cards/helpers.ts";
import type { StoryCluster } from "../discovery/cluster.ts";
import type { ArticleText } from "../discovery/article.ts";
import {
  SelectionSchema,
  ScriptSchema,
  FactCheckSchema,
  narrationOf,
  loopLineUnfinished,
  wordCount,
  type Script,
  type Selection,
  type FactCheck,
} from "./schema.ts";

export const WORDS_MIN = 70;
// Our own Shorts of 38-44 s held 57% of viewers against 39% for those over a minute (26 Oct 2026).
export const WORDS_MAX = 100;

const HOUSE_STYLE = `You write for Pulse Gaming News, a YouTube Shorts channel about video game news.

${voiceFor("news")}`;

export function selectionPrompt(): string {
  return `${HOUSE_STYLE}

You are the editor choosing today's story. Pick the single candidate that will make the best Short for cold viewers:
- Big franchises, release dates, delays, price changes, reveals, sales milestones and major studio news beat niche patch notes.
- Prefer stories with a concrete fact a viewer can repeat to a friend.
- Demand matters most: a Short reaches viewers who are already interested in its game. When a candidate is about a game in YouTube's trending list below (match by game or franchise, not exact words), prefer it over an equally strong story nobody is watching, and say so in your reason. Never pick a weak story just because its game is trending.
- What breaks out in gaming news Shorts (a study of 1,345 Shorts across 87 channels, each channel's hits against its own ordinary Shorts): leaks and credible reports were four times as common among hits, and so were stories with a conflict in them (players against a company, a platform against a publisher, a lawsuit or a ban); PlayStation, GTA, Red Dead and FromSoftware over-indexed. Plain price changes, history pieces, "secret" teases, delays read as a date change, EA and Ubisoft business news and multi-story roundups under-indexed. Prefer a clearly labelled credible leak or a story with a fight in it over an equally strong routine announcement, and treat a price story as a conflict (who pays, who gains), never as a figure. Viewers' comments (12,679 read on the niche's biggest videos) show what they are arguing about now: Sony's pricing and disc-less plans, $70-$100 games and waiting for sales, physical against digital ownership, review scores they no longer trust, scalpers and trade-in values, and older gaming being better; CD Projekt's free updates are cheered and Game Freak is mocked. A story that lands in one of those arguments travels; a story about a trivial detail does not, however big its headline.
- Avoid deals posts, reviews, guides, listicles, podcasts and tragedies.
- The Short can only show official trailers, official store art and official press images. Never pick a story whose point is something to look at that we cannot show: real-world photos (marketing stunts, billboards, cars, merchandise, events), leaked or fan images, cosplay, mods, or the shots of a brand-new trailer. A viewer would hear about it over pictures of something else. Mark such a story real_world_images.
- Avoid anything that repeats a story the channel already covered (listed below).
Return candidate_index -1 if nothing is worth a Short today.`;
}

export function scriptPrompt(): string {
  return `${HOUSE_STYLE}

Write a 25-40 second vertical Short script (${WORDS_MIN}-${WORDS_MAX} spoken words in total across hook, beats, take and loop line).

Structure:
1. hook: 5-10 words with the game or company named in the first five words, in the Pulse voice. It opens a gap the Short closes, never a bare "X announced Y" (in a study of 1,345 gaming Shorts, plain announcement openers were twice as common among each channel's weakest Shorts as among its hits, and openers that posed a specific, answerable question or a surprising claim were more than twice as common among hits). Three shapes work; vary them:
   - the news with its stake for the viewer: "GTA 6's launch trailer is out, and November 19 holds."
   - an answerable question the take will answer, carrying the news: "Is Switch 2's $80 Zelda really the new normal?"
   - the surprising fact first: "Silksong sold a million copies before lunch."
   No superlatives or hype in the hook (biggest, greatest, craziest, insane, massive, ever): they were rarer in hits than in weak Shorts. Never open with "So", "Today", "Hey", "Welcome", "In this", "Guys", a greeting or the channel's name, and never a question the Short does not answer.
2. beats: two to four short fact beats, each with one on-screen visual card. The first beat must be the single most surprising concrete detail in the story (a number, a date, a price, a named feature), never background, history or "here is what we know": half our viewers leave between seconds five and twelve, so the best fact goes there. Context and history come later or in the take. Pick the card that fits the fact:
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
   Numbers move: a before and after, a this against that, a countdown ($69.99 to $79.99; 10 hours to 3), never a list of specs read out (13 maps, 30 weapons, 6 modes). One turn line by about the second beat pivots to the detail that changes the story, in words that differ from Short to Short ("Except there's a catch.", "That's not the strange part.", "And that's where you come in."); never the banned stock phrases.
   Frame the story by what it does to the viewer (their money, their console, their pre-order, their weekend) or as players against a company, publisher against platform, studio against its own past: that framing carried the news Shorts that broke out, and a price is a conflict, never just a figure.
   Every beat also carries "footage": what the trailer picture should show while that line is spoken, with 1-4 keywords naming the thing, place, character or action in the line. The picture editor matches real trailer moments to these, so be concrete ("Hyrule Field", "the new ship interior", "a car chase"), and use "calm" for lines whose card needs a quiet background (numbers, dates, prices). "hook_footage" does the same for the opening line and should want the most striking gameplay moment.
person: when the story is about one real person (a cameo, a hire, a departure, a statement), their name as commonly written, so the Short can show a licensed photo of them; otherwise empty.
3. pulse_take: the Pulse angle, and the payoff: when the hook asked a question, the take answers it, plainly, in its first sentence. This is the reason the Short exists and must add something the headline does not: context (previous delay, series history, price versus the last entry), a comparison, or a clearly framed opinion in natural words that differ from Short to Short (never the stock opener "Our read"). Vary its shape: a concession then a verdict, a comparison, a question answered, a consequence for the viewer, a what-happens-next. The opening words and the closing shape must differ from the recent Shorts listed below when a list is given. Opinions must be framed as opinion. Do not invent data.
Talk to the viewer: at least two sentences in the script say "you" or "your" about what this means for them (their console, their money, their weekend).
3a. stamp: the one word that carries the news gets a rubber stamp on screen as it is spoken: a date that was confirmed ("NOV 19" / "CONFIRMED"), a delay ("DELAYED" / "TO 2027"), a price ("$49.99"), "FREE", "LEAKED" (with "REPORTED" under it for a rumor). "word" is that word exactly as written in your narration; the stamp's figures must be the narration's own. Omit it when nothing deserves it.
3b. desk_question: before the take, the sceptic's objection, the line the top comment would otherwise make, put by a second presenter at the desk in 5-12 words, ending with "?": "Isn't this just Mafia 2's wanted system?", "Who actually asked for a disc-less PS6?", "So is it worth $70 on day one?". The take then answers it head on. In a study of 12,679 top comments on gaming Shorts, the most-liked comment on news Shorts was very often exactly that objection; saying it first takes it off the table. Always provide one.
4. loop_line: one complete closing sentence (it ends with a full stop or a question mark) that echoes the hook's subject or words, so a rewatch feels connected. When it asks the viewer something, make it specific enough to answer in five words: a named fork ("Should Pokemon keep turn-based battles, or go full action?"), three options for a buying story ("Day one, wait for a sale, or skip it?"), "name one" ("Which starter deserves a Mega next?") or the viewer's own numbers ("How many raids before your first shiny?"); put the money in it, dollars first, when the story is about money. Specific questions were answered by 73% of top comments in the comment study, "thoughts?" by 46% and rhetorical ones by 12%. Never a rhetorical question, a punchline dressed as a question, or "will you play it?". Never an unfinished sentence or a line ending on "because", "and", "so", "but", "which" or "that": the voice reads it as a stumble followed by silence.

Visual "primary" text must be short enough to read in a second. The headline is factual and readable on a phone.
List every factual claim in "claims" with the URL of the provided source that supports it.
"hashtags": 3-5 tags fans of this story actually search, most specific first (#GTA6, #GTA, #RockstarGames); never generic ones like #gaming or #fyp.
The YouTube title reads like a sharp headline a friend would text you, not a press release: the game or company named early, a strong verb, the point (the consequence, the surprise or the stakes) and, when the story has one, the number that carries it (a price, a date, a count: titles with a number were more common among hits, and on our own channel they drew 2.7 times the views a day). A fifth of our views come from YouTube search, so name the game the way people type it into the search bar ("GTA 6", "Switch 2", "MW4", "Elden Ring Nightreign"), never only a subtitle or an internal code name. Under 60 characters, sentence-style with no "Game: fact" colon template, no exclamation marks, no all-caps words, no clickbait the video does not deliver: never "BIG problem" or "ruined" over a small detail, never "no one is talking about" (viewers answer that everyone noticed), and never "every", "ultimate" or "complete" unless the Short truly covers all of it (those titles drew lists of what was missing). Good: "Nintendo Just Made Switch 2 Games Cost $80", "GTA 6 Slips Again, and This Time It's Fall". Bad: "GTA 6: Release Date Delayed". A rumor's title says it is a rumor or report. The description opens with one conversational sentence on why it matters, then credits the sources by name.`;
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
      const body =
        art?.text || item.summary || "(no body text available; headline only)";
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

export async function selectStory(
  llm: Llm,
  candidates: StoryCluster[],
  recentHeadlines: string[],
  performance = "",
): Promise<Selection> {
  const list = candidates
    .map(
      (c, i) =>
        `${i}. "${c.headline}" | outlets: ${c.sources.join(", ")} | official source: ${c.hasOfficial ? "yes" : "no"} | rumour signals: ${c.rumourSignals ? "yes" : "no"} | newest: ${c.newestAt}\n   ${c.items[0]?.summary.slice(0, 280) ?? ""}`,
    )
    .join("\n");
  return llm.structured({
    tier: "mid",
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
  opts: {
    mustLabelRumour: boolean;
    feedback?: string[];
    storeData?: string;
    lessons?: string;
    /** The last few Shorts' take openers and loop lines, so no shape becomes a tic. */
    recent?: RecentShapes;
  },
): Promise<Script> {
  const rules = opts.mustLabelRumour
    ? "\nThis story is NOT confirmed by an official source or two independent outlets. Set is_rumour true and attribute every claim to whoever reported it."
    : "";
  const feedback = opts.feedback?.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${opts.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  const why = cluster.why
    ? `\n\n${whyBrief(cluster.why.question, cluster.why.angle)}`
    : "";
  const recent =
    opts.recent && (opts.recent.takes.length || opts.recent.loops.length)
      ? `\n\nRecent Shorts (do not open the take the same way or end on the same shape as any of these):\n${opts.recent.takes.map((t) => `- take opened: "${t}"`).join("\n")}\n${opts.recent.loops.map((l) => `- closed: "${l}"`).join("\n")}`
      : "";
  const script = await llm.structured({
    system: scriptPrompt(),
    content: `Sources:\n${sourcesBlock(articles, cluster)}${storeBlock(opts.storeData)}${rules}${why}${opts.lessons ? `\n\n${opts.lessons}` : ""}${recent}${feedback}`,
    schema: ScriptSchema,
    effort: "medium",
  });
  return varyOpinion(
    cluster.why ? { ...script, story_type: "explainer" } : script,
    cluster.hash,
  );
}

/** Everything a card will print: its text plus the dates, prices, scores and rows the graphic draws from. */
export function cardText(v: Script["beats"][number]["visual"]): string {
  const extra = [
    v.date_from && `from ${v.date_from}`,
    v.date_to && `to ${v.date_to}`,
    v.was && `was ${v.was}`,
    v.region && `region ${v.region}`,
    v.value_a !== undefined && `score ${v.value_a}`,
    v.items?.length && `rows: ${v.items.join("; ")}`,
  ].filter(Boolean);
  return `[${v.kind}] ${[v.primary, v.secondary].filter(Boolean).join(" ")}${extra.length ? ` (${extra.join(", ")})` : ""}`.trim();
}

/**
 * The final factual adjudication for a ranking or a long video, which the news lane already had: the
 * spoken script, every card figure, the title and the description against the facts the writer was
 * given (Steam figures and Wikipedia background per game). Only those facts and long-established
 * knowledge count; a figure the facts do not support is a blocker.
 */
export async function factCheckRanking(
  llm: Llm,
  script: Script,
  facts: Array<{ title: string; facts: string }>,
): Promise<FactCheck> {
  const cards = [
    script.headline,
    ...script.beats.map((b) => cardText(b.visual)),
    script.pulse_take.on_screen,
    ...(script.entries ?? []).flatMap((e) =>
      (e.moments ?? [])
        .filter((m) => m.graphic.kind !== "none")
        .map((m) =>
          `${e.game_title}: [${m.graphic.kind}] ${m.graphic.primary} ${m.graphic.secondary} ${m.graphic.items?.join("; ") ?? ""}`.trim(),
        ),
    ),
  ];
  return llm.structured({
    system: `${factCheckPrompt()}\nThis is a ranking or explainer, not a news story: the "sources" are the facts the writer was given for each game. Release years, platforms, prices, scores, review counts, player counts, sales and dates must match those facts or be long-established public knowledge; a figure that appears in neither is a blocker. Opinions and the ranking order itself are not facts.`,
    content: `Facts given to the writer:\n${facts.map((f) => `<game title="${f.title}">\n${f.facts}\n</game>`).join("\n")}\n\nScript (spoken):\n${narrationOf(script)}\n\nOn-screen text and card figures (every one must be supported):\n${cards.map((c) => `- ${c}`).join("\n")}\n\nYouTube title: ${script.youtube.title}\nYouTube description: ${script.youtube.description}`,
    schema: FactCheckSchema,
    effort: "medium",
  });
}

export async function factCheck(
  llm: Llm,
  script: Script,
  cluster: StoryCluster,
  articles: ArticleText[],
  storeData?: string,
): Promise<FactCheck> {
  return llm.structured({
    system: factCheckPrompt(),
    content: `Sources:\n${sourcesBlock(articles, cluster)}${storeBlock(storeData)}\n\nScript (spoken):\n${narrationOf(script)}\n\nOn-screen text and card figures (every one must be supported):\n- ${script.headline}\n${script.beats
      .map((b) => `- ${cardText(b.visual)}`)
      .join(
        "\n",
      )}\n- ${script.pulse_take.on_screen}\n\nYouTube title: ${script.youtube.title}\nYouTube description: ${script.youtube.description}\nScript labels this as rumour: ${script.is_rumour}`,
    schema: FactCheckSchema,
    effort: "medium",
  });
}

const BANNED_OPENERS =
  /^(so|today|hey|welcome|in this|guys|what's up|hello)\b/i;
// Hype in the opening line: rarer in each channel's hits than in its weak Shorts (niche study, 26 Oct 2026).
const HOOK_HYPE =
  /\b(biggest|greatest|craziest|insane(?:ly)?|crazy|massive|huge|mind[- ]blowing|of all time)\b/i;
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

/** The shapes the last few Shorts used: how each take opened (its first words) and each loop line. */
export interface RecentShapes {
  takes: string[];
  loops: string[];
}

/** The first few words of a line, lowercased, for comparing openers. */
export function opener(text: string, words = 3): string {
  return text
    .trim()
    .split(/\s+/)
    .slice(0, words)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, "");
}

/** The last few words of a line, lowercased, for comparing closing shapes. */
export function closer(text: string, words = 3): string {
  return text
    .trim()
    .split(/\s+/)
    .slice(-words)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, "");
}

/** Deterministic house-rule checks. Returns human-readable problems; empty means valid. */
export function validateScript(s: Script, recent?: RecentShapes): string[] {
  const problems: string[] = [];
  const spoken = narrationOf(s);
  const words = wordCount(spoken);
  // The viewer is in the room: a script that never says "you" reads as a bulletin.
  const yous = (spoken.match(/\byou(r|'re|'ve|'ll|'d)?\b/gi) ?? []).length;
  if (yous < 2)
    problems.push(
      `The script says "you" ${yous === 1 ? "once" : "never"}; at least two sentences should speak to the viewer about what this means for them.`,
    );
  // Shapes the last few Shorts used become tics: the take's opener and the loop's closing words must differ.
  if (recent) {
    const take = opener(s.pulse_take.narration, 2);
    if (take && recent.takes.some((t) => opener(t, 2) === take))
      problems.push(
        `The take opens "${s.pulse_take.narration.trim().split(/\s+/).slice(0, 2).join(" ")}" like a recent Short; open it another way.`,
      );
    const loop = closer(s.loop_line, 3);
    if (loop && recent.loops.some((l) => closer(l, 3) === loop))
      problems.push(
        `The loop line ends "${s.loop_line.trim().split(/\s+/).slice(-3).join(" ")}" like a recent Short; close on a different shape.`,
      );
  }
  if (words < WORDS_MIN || words > WORDS_MAX)
    problems.push(
      `Spoken word count is ${words}; it must be ${WORDS_MIN}-${WORDS_MAX}.`,
    );
  if (BANNED_OPENERS.test(s.hook.trim()))
    problems.push(
      `The hook must not open with "${s.hook.trim().split(/\s+/)[0]}".`,
    );
  if (wordCount(s.hook) > 12)
    problems.push(
      `The hook is ${wordCount(s.hook)} words; say the news in 5-10 and move the why into the first beat.`,
    );
  const hype = s.hook.match(HOOK_HYPE);
  if (hype)
    problems.push(
      `The hook leans on "${hype[0]}"; open the gap with the fact or a question instead of a superlative.`,
    );
  if (wordCount(s.loop_line) > 22)
    problems.push(
      "The loop line is longer than 22 words; one short closing sentence.",
    );
  if (s.stamp) {
    if (s.stamp.text.length > 14)
      problems.push(
        `The stamp "${s.stamp.text}" is longer than 14 characters.`,
      );
    const said = spoken.toLowerCase();
    if (!said.includes(s.stamp.word.toLowerCase().replace(/[.,!?]$/, "")))
      problems.push(
        `The stamp's word "${s.stamp.word}" is not in the narration; use a word that is spoken.`,
      );
    for (const fig of s.stamp.text.match(/\d[\d,.]*/g) ?? [])
      if (
        !said.replace(/,/g, "").includes(fig.replace(/,/g, "")) &&
        // "3 MONTHS" on the stamp for "three months" in the narration is the same figure.
        !(
          /^\d{1,3}$/.test(fig) &&
          new RegExp(`\\b${numberWords(Number(fig))}\\b`).test(said)
        )
      )
        problems.push(`The stamp's figure "${fig}" is not in the narration.`);
  }
  if (
    s.desk_question &&
    (wordCount(s.desk_question) > 14 || !/\?\s*$/.test(s.desk_question))
  )
    problems.push(
      "The desk question must be one question of at most 14 words, ending with '?'.",
    );
  if (loopLineUnfinished(s.loop_line))
    problems.push(
      `The loop line "${s.loop_line.trim()}" is unfinished; end it as one complete sentence.`,
    );
  if (s.beats.length < 2 || s.beats.length > 4)
    problems.push("There must be two to four beats.");
  const allText = [
    spoken,
    s.headline,
    s.youtube.title,
    s.youtube.description,
    s.pulse_take.on_screen,
    ...s.beats.map((b) => `${b.visual.primary} ${b.visual.secondary}`),
  ].join("\n");
  for (const re of BANNED_PHRASES)
    if (re.test(allText)) problems.push(`Banned phrase matched: ${re.source}.`);
  problems.push(...voiceProblems(spoken));
  for (const [re, fix] of BRITICISMS)
    if (re.test(allText))
      problems.push(
        `Use American spelling ("${fix}"), found "${allText.match(re)?.[0]}".`,
      );
  if (/\b\w+, [\w ]+, and\b/.test(allText))
    problems.push('Remove the serial (Oxford) comma before "and".');
  if (s.youtube.title.length > 100)
    problems.push("The YouTube title is over 100 characters.");
  if (wordCount(s.headline) > 9)
    problems.push("The on-screen headline is longer than 8 words.");
  if (!s.pulse_take.narration.trim()) problems.push("The Pulse take is empty.");
  if (
    s.is_rumour &&
    !/\b(reportedly|rumoured|according to|allegedly|claims?|reports?|suggests?|rumored)\b/i.test(
      spoken,
    )
  ) {
    problems.push(
      "A rumour script must attribute its claims (reportedly / according to ...).",
    );
  }
  for (const b of s.beats) {
    if (b.visual.kind !== "none" && wordCount(b.visual.primary) > 7)
      problems.push(
        `On-screen text "${b.visual.primary}" is too long to read in a second.`,
      );
    const iso = (d?: string) =>
      !!d && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(d.trim());
    if (b.visual.kind === "chapter")
      problems.push(
        `The "chapter" card is for documentaries only; pick another card for "${b.visual.primary}".`,
      );
    if (
      b.visual.kind === "timeline" &&
      !(iso(b.visual.date_from) && iso(b.visual.date_to))
    )
      problems.push(
        `Timeline card "${b.visual.primary}" needs date_from and date_to as ISO dates.`,
      );
    if (b.visual.kind === "countdown" && !iso(b.visual.date_to))
      problems.push(
        `Countdown card "${b.visual.primary}" needs date_to as an ISO date.`,
      );
    if (b.visual.kind === "price" && !/\d/.test(b.visual.primary))
      problems.push(`Price card "${b.visual.primary}" has no price.`);
    if (
      b.visual.kind === "score" &&
      !(
        typeof b.visual.value_a === "number" &&
        b.visual.value_a >= 0 &&
        b.visual.value_a <= 100
      )
    )
      problems.push(
        `Score card "${b.visual.primary}" needs value_a between 0 and 100.`,
      );
    if (
      b.visual.kind === "compare" &&
      (b.visual.items ?? []).filter((r) => /:\s*[^:]*\d/.test(r)).length < 2
    )
      problems.push(
        `Compare card "${b.visual.primary}" needs at least two label:value rows.`,
      );
    if (
      b.visual.kind === "platforms" &&
      !(b.visual.items ?? []).some((x) => x.trim())
    )
      problems.push(
        `Platforms card "${b.visual.primary}" needs at least one platform in items.`,
      );
    if (
      b.visual.kind === "versus" &&
      parsePairs(b.visual.items ?? []).length !== 2
    )
      problems.push(
        `Versus card "${b.visual.primary}" needs exactly two label:value rows.`,
      );
    if (
      b.visual.kind === "specs" &&
      parsePairs(b.visual.items ?? []).length < 2
    )
      problems.push(
        `Specs card "${b.visual.primary}" needs at least two label:value rows.`,
      );
    if (
      b.visual.kind === "milestones" &&
      parseMilestones(b.visual.items ?? []).length < 3
    )
      problems.push(
        `Milestones card "${b.visual.primary}" needs three to five rows as YYYY-MM:label.`,
      );
  }
  return problems;
}
