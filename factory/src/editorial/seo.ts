// SEO and packaging: deterministic title formulas, keyword stacking, a tag
// table, hashtags and a pinned comment, applied on top of what the writer
// produced. Everything here is pure and tested; nothing calls a model.

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

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
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
export function polishTitle(script: Script): string {
  const game = script.game_title.trim();
  let title = script.youtube.title
    .trim()
    .replace(/\s+/g, " ")
    .replace(/#\w+/g, "")
    .trim();
  const gameFirst =
    !game ||
    title
      .toLowerCase()
      .startsWith(game.toLowerCase().slice(0, Math.min(game.length, 12)));
  const clean = !BAD_TITLE_WORDS.test(title) && !CLICKBAIT_PUNCT.test(title);
  if (!title || !gameFirst || !clean || title.length > TITLE_MAX + 12) {
    const fact = script.headline
      .replace(
        new RegExp(
          `^${game.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['’]?s?\\s*`,
          "i",
        ),
        "",
      )
      .trim();
    title = game ? `${game}: ${fact}` : script.headline;
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
  for (const t of EVERGREEN_TAGS) add(t);
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
  const take = script.pulse_take.on_screen.replace(/\.$/, "");
  const game = script.game_title || "this";
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
  return `Our read: ${take}. ${q} Sources are in the description.`;
}
