// SEO and packaging: deterministic title formulas, keyword stacking, a tag
// table, hashtags and a pinned comment, applied on top of what the writer
// produced. Everything here is pure and tested; nothing calls a model.

import { RUNNING_QUESTION } from "./voice.ts";
import { writtenOpinionLead } from "./phrasing.ts";
import type { Script } from "./schema.ts";

export const TITLE_MAX = 60; // phones truncate around here; YouTube allows 100
const BAD_TITLE_WORDS =
  /\b(shocking|insane|you won'?t believe|unbelievable|omg|wtf|must watch|gone wrong|clickbait|exposed|destroyed|rip)\b/i;
const CLICKBAIT_PUNCT = /[!?]{2,}|\.{3,}|\s!$/;

/** Franchise and platform keywords worth stacking when they appear in the story. */
export const KEYWORD_TABLE: Array<[RegExp, string[]]> = [
  [
    /\bgta\s*(vi|6)\b|grand theft auto/i,
    ["GTA 6", "GTA VI", "Grand Theft Auto 6", "Rockstar Games"],
  ],
  [/\bswitch\s*2\b/i, ["Nintendo Switch 2", "Switch 2"]],
  [/\bps5\b|playstation\s*5/i, ["PS5", "PlayStation 5", "PlayStation"]],
  [/\bps5 pro\b/i, ["PS5 Pro"]],
  [/playstation plus|ps plus/i, ["PS Plus", "PlayStation Plus"]],
  [/\bxbox\b/i, ["Xbox", "Xbox Series X"]],
  [/game pass/i, ["Xbox Game Pass", "Game Pass"]],
  [/\bnintendo\b/i, ["Nintendo"]],
  [/zelda/i, ["Zelda", "The Legend of Zelda"]],
  [/\bmario\b/i, ["Mario", "Super Mario"]],
  [/pok[eé]mon/i, ["Pokemon"]],
  [/call of duty|\bcod\b/i, ["Call of Duty", "COD"]],
  [/battlefield/i, ["Battlefield"]],
  [/elden ring|fromsoftware/i, ["Elden Ring", "FromSoftware"]],
  [/\bsteam\b|valve/i, ["Steam", "PC gaming"]],
  [/steam deck/i, ["Steam Deck"]],
  [/fortnite/i, ["Fortnite"]],
  [/minecraft/i, ["Minecraft"]],
  [/roblox/i, ["Roblox"]],
  [/the elder scrolls/i, ["Elder Scrolls", "Elder Scrolls 6"]],
  [/fallout/i, ["Fallout"]],
  [/starfield/i, ["Starfield"]],
  [/bethesda/i, ["Bethesda"]],
  [/witcher/i, ["The Witcher", "Witcher 4"]],
  [/cyberpunk/i, ["Cyberpunk 2077"]],
  [/resident evil/i, ["Resident Evil"]],
  [/monster hunter/i, ["Monster Hunter"]],
  [/street fighter/i, ["Street Fighter"]],
  [/capcom/i, ["Capcom"]],
  [/final fantasy/i, ["Final Fantasy"]],
  [/square enix/i, ["Square Enix"]],
  [/assassin'?s creed/i, ["Assassin's Creed"]],
  [/ubisoft/i, ["Ubisoft"]],
  [/spider-man|insomniac/i, ["Spider-Man", "Insomniac Games"]],
  [/wolverine/i, ["Marvel's Wolverine"]],
  [/silksong|hollow knight/i, ["Hollow Knight Silksong", "Silksong"]],
  [/hades/i, ["Hades"]],
  [/god of war/i, ["God of War"]],
  [/the last of us|naughty dog/i, ["The Last of Us", "Naughty Dog"]],
  [/ghost of/i, ["Ghost of Yotei", "Ghost of Tsushima"]],
  [/\bhalo\b/i, ["Halo"]],
  [/gears of war/i, ["Gears of War"]],
  [/forza/i, ["Forza"]],
  [/epic games|unreal/i, ["Epic Games"]],
  [/\bsony\b/i, ["Sony"]],
  [/\bmicrosoft\b/i, ["Microsoft"]],
  [/\bea\b|electronic arts/i, ["EA"]],
];

const STORY_TERMS: Record<string, string[]> = {
  release_date: ["release date", "launch", "when is it out"],
  delay: ["delayed", "delay", "new release date"],
  price: ["price", "how much", "cost"],
  sales: ["sales", "players", "milestone"],
  reveal: ["reveal", "announced", "new game"],
  trailer: ["trailer", "gameplay", "first look"],
  update: ["update", "patch", "patch notes"],
  rumour: ["rumour", "report", "leak"],
  review_scores: ["reviews", "review score", "metacritic"],
  hardware: ["console", "hardware", "specs"],
  industry: ["games industry", "studio"],
  other: ["gaming news"],
};

const EVERGREEN_TAGS = [
  "gaming news",
  "video game news",
  "gaming news today",
  "game news",
  "shorts",
  "gaming shorts",
  "pulse gaming news",
];

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "vs", "via"]);

/** Title case with the small words left small ("Call of Duty Ranked Worst to Best"), except first and after a colon or dash. */
export function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w, i, all) => {
      const after = i > 0 && /[:|\u2013-]$/.test(all[i - 1]!);
      if (i > 0 && !after && SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
      return w.replace(/^([a-z])/, (m) => m.toUpperCase());
    })
    .join(" ");
}

function truncateWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  return cut
    .slice(0, cut.lastIndexOf(" "))
    .replace(/[,:;\-–]$/, "")
    .trim();
}

/** Keywords the story carries, from the title, headline, game and beats. */
export function storyKeywords(script: Script): string[] {
  const text = [
    script.game_title,
    script.headline,
    script.hook,
    script.youtube.title,
    ...script.beats.map((b) => b.narration),
  ].join(" ");
  const out: string[] = [];
  for (const [re, words] of KEYWORD_TABLE)
    if (re.test(text)) for (const w of words) if (!out.includes(w)) out.push(w);
  return out;
}

/**
 * The title: game name first, the fact second, under 60 characters, no
 * clickbait words or punctuation. The writer's title is kept when it already
 * does that; otherwise a formula for the story type rebuilds it from the
 * headline.
 */
/**
 * A ranking's title follows the search pattern viewers type ("every X game
 * ranked worst to best") and says how many entries it holds when it is not
 * the whole series; other evergreen formats keep the writer's templated title.
 */
export function evergreenTitle(script: Script): string | undefined {
  const n = script.entries?.length ?? 0;
  if (!n) return undefined;
  const theme = script.game_title.trim();
  if (script.evergreen_format === "ranking" || !script.evergreen_format) {
    // The writer's own "Ranked" headline keeps its qualifier ("Call of Duty Campaigns Ranked Worst to Best").
    const head = script.headline
      .replace(BAD_TITLE_WORDS, "")
      .replace(CLICKBAIT_PUNCT, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      // Digits outperform words in titles: "Six Resident Evil Games" is "6 Resident Evil Games".
      .replace(
        /^(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i,
        (w) =>
          String(
            [
              "two",
              "three",
              "four",
              "five",
              "six",
              "seven",
              "eight",
              "nine",
              "ten",
              "eleven",
              "twelve",
            ].indexOf(w.toLowerCase()) + 2,
          ),
      );
    if (/\branked\b/i.test(head) && head.length <= TITLE_MAX) {
      const full = /worst to best|best to worst/i.test(head)
        ? head
        : `${head} Worst to Best`;
      return titleCase(full.length <= TITLE_MAX ? full : head);
    }
    const lead =
      n >= 8 ? `Every ${theme} Game Ranked` : `${n} ${theme} Games Ranked`;
    const full = `${lead} Worst to Best`;
    return titleCase(full.length <= TITLE_MAX ? full : lead);
  }
  const own = script.youtube.title
    .replace(BAD_TITLE_WORDS, "")
    .replace(CLICKBAIT_PUNCT, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return truncateWords(titleCase(own || script.headline), TITLE_MAX);
}

/** The short line on a ranking's thumbnail: "Every X Game Ranked" or "N X Games Ranked". */
export function thumbTitle(script: Script): string {
  const n = script.entries?.length ?? 0;
  const theme = script.game_title.trim() || "Games";
  if (!n || script.evergreen_format === "documentary") return script.headline;
  if (/\branked\b/i.test(script.headline) && script.headline.length <= 48)
    return script.headline;
  return n >= 8 ? `Every ${theme} Game Ranked` : `${n} ${theme} Games Ranked`;
}

export function polishTitle(script: Script): string {
  const evergreen = evergreenTitle(script);
  if (evergreen) return evergreen;
  const game = script.game_title.trim();
  let title = script.youtube.title
    .trim()
    .replace(/\s+/g, " ")
    .replace(/#\w+/g, "")
    .trim();
  // "Call of Duty: Modern Warfare 4" may lead as "Modern Warfare 4": no doubled colon, and room for the fact.
  const shortGame = game.includes(":")
    ? (game.split(":").pop() ?? game).trim() || game
    : game;
  const leads = (t: string) =>
    [game, shortGame].some(
      (g) =>
        g &&
        t
          .toLowerCase()
          .startsWith(g.toLowerCase().slice(0, Math.min(g.length, 12))),
    );
  const gameFirst = !game || leads(title);
  const clean = !BAD_TITLE_WORDS.test(title) && !CLICKBAIT_PUNCT.test(title);
  if (!title || !gameFirst || !clean || title.length > TITLE_MAX + 12) {
    const esc = (g: string) => g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const fact = script.headline
      .replace(
        new RegExp(`^(?:${esc(game)}|${esc(shortGame)})['’]?s?\\s*`, "i"),
        "",
      )
      .trim();
    const led = `${shortGame}: ${fact}`;
    // When even the short lead leaves no room, a fact that names the game stands on its own.
    const namesGame =
      shortGame
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.length >= 4 && fact.toLowerCase().includes(w)) ||
      /\b[A-Z]{2,}\d*\b/.test(fact);
    title = !game
      ? script.headline
      : led.length <= TITLE_MAX || !namesGame
        ? led
        : fact;
  }
  title = title
    .replace(BAD_TITLE_WORDS, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[!]+$/, "")
    .trim();
  title = titleCase(title);
  return (
    truncateWords(title, TITLE_MAX) || truncateWords(script.headline, TITLE_MAX)
  );
}

/** Problems a title would have on the channel; empty when it is fine. */
export function titleProblems(title: string): string[] {
  const p: string[] = [];
  if (title.length > TITLE_MAX)
    p.push(`Title is ${title.length} characters; keep it under ${TITLE_MAX}.`);
  if (BAD_TITLE_WORDS.test(title))
    p.push(
      `Title uses a clickbait word (${title.match(BAD_TITLE_WORDS)?.[0]}).`,
    );
  if (CLICKBAIT_PUNCT.test(title)) p.push("Title uses clickbait punctuation.");
  if (/#/.test(title)) p.push("No hashtags in the title.");
  if (title === title.toUpperCase() && /[A-Z]{4,}/.test(title))
    p.push("Title is shouting (all caps).");
  return p;
}

/** Up to 500 characters of tags: the game, its franchise and platform terms, the story type and the channel's evergreen terms. */
export function buildTags(script: Script): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const v = t.trim().replace(/[<>]/g, "").slice(0, 60);
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  if (script.game_title) add(script.game_title);
  for (const k of storyKeywords(script)) add(k);
  for (const t of STORY_TERMS[script.story_type] ?? [])
    add(script.game_title ? `${script.game_title} ${t}` : t);
  for (const t of script.youtube.tags) add(t);
  // A long video is not a Short: the Shorts tags would mislabel it.
  for (const t of EVERGREEN_TAGS) if (script.runtime !== "long" || !/shorts/.test(t)) add(t);
  while (out.join(",").length > 480 && out.length > 1) out.pop();
  return out;
}

/** Three hashtags: the channel's two plus the game's. */
export function hashtags(script: Script): string[] {
  const game = script.game_title.replace(/[^A-Za-z0-9]/g, "");
  return ["#Shorts", "#GamingNews", ...(game ? [`#${game.slice(0, 30)}`] : [])];
}

/** The first two lines of a description: the keyword stack YouTube indexes, written as a sentence. */
export function keywordLead(script: Script): string {
  const n = script.entries?.length ?? 0;
  if (script.cutdown) {
    const theme = script.cutdown.theme || script.game_title;
    return `${script.game_title} is number ${script.cutdown.rank} of ${script.cutdown.total} in our ${theme} ranking. ${theme} ranked, best ${theme} games, by Pulse Gaming News.`;
  }
  if (script.recap)
    return `This week in gaming news: ${script.headline.replace(/\.$/, "")}. Gaming news this week, video game news recap, biggest gaming stories, by Pulse Gaming News.`;
  if (script.evergreen_format === "documentary")
    return `The complete history of ${script.game_title}, game by game: ${script.headline.replace(/\.$/, "")}. ${script.game_title} documentary, history of ${script.game_title}, ${script.game_title} explained, by Pulse Gaming News.`;
  if (script.evergreen_format === "release_radar")
    return `New games out this week: ${script.headline.replace(/\.$/, "")}. New game releases, games coming out this week, upcoming games, by Pulse Gaming News.`;
  if (script.evergreen_format === "rarest_achievements")
    return `The rarest achievements in ${script.game_title}: ${script.headline.replace(/\.$/, "")}. ${script.game_title} achievements, hardest achievements, achievement hunting, by Pulse Gaming News.`;
  if (script.evergreen_format === "hardest_achievements")
    return `The hardest achievements in gaming right now: ${script.headline.replace(/\.$/, "")}. Hardest achievements, rarest achievements, achievement hunting, by Pulse Gaming News.`;
  if (script.evergreen_format === "steam_climbers")
    return `The biggest climbers on Steam this week: ${script.headline.replace(/\.$/, "")}. Steam charts, most played games on Steam, trending games, by Pulse Gaming News.`;
  if (script.evergreen_format === "steam_deals")
    return `The best Steam deals right now: ${script.headline.replace(/\.$/, "")}. Steam sale, cheap PC games, best game deals today, by Pulse Gaming News.`;
  if (script.evergreen_format === "weekly_recap")
    return `This week in gaming: ${script.headline.replace(/\.$/, "")}. Gaming news recap, biggest gaming news this week, by Pulse Gaming News.`;
  if (n) {
    // A ranking is searched as "every X game ranked"; say so first, then the premise.
    const theme = script.game_title.trim() || "gaming";
    const lead =
      n >= 8 ? `Every ${theme} game ranked` : `${n} ${theme} games ranked`;
    return `${lead} worst to best: ${script.headline.replace(/\.$/, "")}. Best ${theme} games, ${theme} ranking, by Pulse Gaming News.`;
  }
  const kws = storyKeywords(script).slice(0, 4);
  const type = (STORY_TERMS[script.story_type] ?? ["news"])[0]!;
  const subject = script.game_title || kws[0] || "gaming";
  const rest = kws
    .filter((k) => k.toLowerCase() !== subject.toLowerCase())
    .slice(0, 3);
  return `${subject} ${type}: ${script.headline.replace(/\.$/, "")}.${rest.length ? ` ${rest.join(", ")} news, checked by Pulse Gaming News.` : " Checked by Pulse Gaming News."}`;
}

/** A warm pinned comment that asks one direct question tied to the Pulse take. */
export function pinnedComment(script: Script): string {
  if (script.cutdown)
    return `${script.cutdown.question.trim()} The full ranking, every pick explained: https://youtu.be/${script.cutdown.parent_video}`;
  const take = script.pulse_take.on_screen.replace(/^\s*our read\s*[:,-]?\s*/i, "").replace(/\.$/, "");
  const game = script.game_title || "this";
  const lead = writtenOpinionLead(script.headline);
  if (script.recap)
    return `Which story was the biggest one for you this week? ${lead} ${take}. And the question we ask every week: ${RUNNING_QUESTION.toLowerCase()} Every source is in the description.`;
  if (script.evergreen_format === "documentary")
    return `Which ${game} game was the one for you, and which chapter of the story surprised you most? Sources for every chapter are in the description.`;
  if (script.evergreen_format === "release_radar")
    return `Our pick: ${take}. Which one are you picking up this week?`;
  if (script.evergreen_format && /achievements$/.test(script.evergreen_format))
    return `Our pick for the real test: ${take}. Which of these have you unlocked? Be honest.`;
  if (script.evergreen_format === "steam_climbers")
    return `Our pick: ${take}. Which of these are you playing right now?`;
  if (script.evergreen_format === "steam_deals")
    return `Our pick: ${take}. Prices are Steam's at the time we checked and can change. Which one are you grabbing?`;
  if (script.evergreen_format === "weekly_recap")
    return `Which story was the biggest one for you this week? ${lead} ${take}.`;
  if (script.entries?.length && script.runtime === "long")
    return `Our number one: ${take}. Too high, too low? Name yours below, and tell us which series we should rank next. The most-asked ones go to the top of our list.`;
  if (script.entries?.length)
    return `Our pick: ${take}. Which ${game} game would you move up or down the list? Every pick is explained in the video.`;
  const q =
    script.story_type === "delay"
      ? `Does the new date change your plans for ${game}?`
      : script.story_type === "price"
        ? `Is that price fair for ${game}?`
        : script.story_type === "release_date"
          ? `Are you picking up ${game} at launch?`
          : script.story_type === "review_scores"
            ? `Do the scores match what you expected from ${game}?`
            : script.story_type === "rumour"
              ? `Do you buy this one, or wait for the official word?`
              : `What do you make of it?`;
  return `${q} ${lead} ${take}. Sources are in the description.`;
}
