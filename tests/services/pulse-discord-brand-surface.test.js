"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..", "..");
const publicDiscordSources = [
  "discord/setup.js",
  "discord/bot.js",
  "discord/auto_post.js",
  "discord/package.json",
  "discord/commands/news.js",
  "discord/commands/giveaway.js",
  "discord/commands/predict.js",
].map((relativePath) => ({
  relativePath,
  source: fs.readFileSync(path.join(ROOT, relativePath), "utf8"),
}));

test("Discord-facing copy uses the Pulse Gaming News display identity", () => {
  for (const { relativePath, source } of publicDiscordSources) {
    assert.doesNotMatch(
      source,
      /PULSE GAMING - Verified leaks\. Every day\./,
      relativePath,
    );
    assert.doesNotMatch(
      source,
      /PULSE GAMING - (?:Claim daily|Story Approval)/,
      relativePath,
    );
    assert.doesNotMatch(
      source,
      /PULSE GAMING(?! NEWS)/,
      relativePath,
    );
  }

  assert.match(
    publicDiscordSources.find(
      ({ relativePath }) => relativePath === "discord/auto_post.js",
    ).source,
    /PULSE GAMING NEWS - Fast gaming news\. Checked\. Explained\./,
  );
});

test("Discord video drops promise review rather than autonomous posting", () => {
  const setup = publicDiscordSources.find(
    ({ relativePath }) => relativePath === "discord/setup.js",
  ).source;

  assert.match(setup, /posted after editorial review/);
  assert.doesNotMatch(setup, /posted automatically when they go live/);
});
