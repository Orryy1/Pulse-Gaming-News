"use strict";

const GENERIC_STORE_TITLE_TOKENS = new Set([
  "action",
  "adventure",
  "collection",
  "definitive",
  "deluxe",
  "edition",
  "game",
  "gaming",
  "jrpg",
  "news",
  "online",
  "pc",
  "ps4",
  "ps5",
  "remake",
  "remastered",
  "report",
  "rpg",
  "steam",
  "stylish",
  "switch",
  "the",
  "trailer",
  "xbox",
]);

const STORE_TITLE_CONTEXT_BEFORE = new Set([
  "adds",
  "announces",
  "announced",
  "confirms",
  "confirmed",
  "delays",
  "delayed",
  "plays",
  "previews",
  "reviews",
  "reveals",
  "revealed",
]);

const STORE_TITLE_CONTEXT_AFTER = new Set([
  "adds",
  "announces",
  "announced",
  "arrives",
  "beta",
  "confirmed",
  "delayed",
  "demo",
  "fans",
  "gameplay",
  "getting",
  "gets",
  "got",
  "hands",
  "has",
  "is",
  "launch",
  "launches",
  "patch",
  "players",
  "preview",
  "release",
  "report",
  "returns",
  "review",
  "reveals",
  "trailer",
  "update",
  "will",
]);

const WEAK_STORE_TITLE_CONTEXT_AFTER = new Set([
  "fans",
  "has",
  "is",
  "players",
  "will",
]);

const STRONG_STORE_TITLE_CONTEXT_AFTER = new Set(
  [...STORE_TITLE_CONTEXT_AFTER].filter(
    (token) => !WEAK_STORE_TITLE_CONTEXT_AFTER.has(token),
  ),
);

const COMMON_LANGUAGE_STORE_TITLE_TOKENS = new Set([
  "control",
  "day",
  "dead",
  "fall",
  "final",
  "finals",
  "grounded",
  "inside",
  "journey",
  "light",
  "new",
  "night",
  "prey",
  "space",
  "stray",
  "world",
]);

function normaliseStoreTitleText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleContainsExactStoreName(storyTitle, appTitle) {
  const story = normaliseStoreTitleText(storyTitle);
  const app = normaliseStoreTitleText(appTitle);
  const storyTokens = story.split(" ").filter(Boolean);
  const tokens = app.split(" ").filter(Boolean);
  if (!story || !app || tokens.length < 1 || tokens.length > 10) {
    return false;
  }
  if (
    !tokens.some(
      (token) =>
        token.length >= 3 &&
        !GENERIC_STORE_TITLE_TOKENS.has(token),
    )
  ) {
    return false;
  }
  if (story === app) return true;
  const weakTitle =
    tokens.length === 1 ||
    !tokens.some(
      (token) =>
        !GENERIC_STORE_TITLE_TOKENS.has(token) &&
        !COMMON_LANGUAGE_STORE_TITLE_TOKENS.has(token),
    );

  for (
    let index = 0;
    index <= storyTokens.length - tokens.length;
    index += 1
  ) {
    const matches = tokens.every(
      (token, offset) => storyTokens[index + offset] === token,
    );
    if (!matches) continue;

    const before = storyTokens[index - 1] || null;
    const after = storyTokens[index + tokens.length] || null;
    const afterNext =
      storyTokens[index + tokens.length + 1] || null;
    const strongAfterContext =
      STRONG_STORE_TITLE_CONTEXT_AFTER.has(after) ||
      (WEAK_STORE_TITLE_CONTEXT_AFTER.has(after) &&
        STRONG_STORE_TITLE_CONTEXT_AFTER.has(afterNext));
    if (
      STORE_TITLE_CONTEXT_BEFORE.has(before) ||
      (weakTitle
        ? strongAfterContext
        : STORE_TITLE_CONTEXT_AFTER.has(after) ||
          strongAfterContext)
    ) {
      return true;
    }
  }
  return false;
}

module.exports = {
  GENERIC_STORE_TITLE_TOKENS,
  COMMON_LANGUAGE_STORE_TITLE_TOKENS,
  STORE_TITLE_CONTEXT_AFTER,
  STORE_TITLE_CONTEXT_BEFORE,
  normaliseStoreTitleText,
  titleContainsExactStoreName,
};
