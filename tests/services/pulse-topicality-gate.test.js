"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { scoreStory } = require("../../lib/scoring");
const { evaluatePulseGamingTopicality } = require("../../lib/topicality-gate");

function story(overrides = {}) {
  return {
    id: overrides.id || "s1",
    title: overrides.title || "Nintendo Switch 2 games lineup expands",
    body: overrides.body || "",
    full_script: overrides.full_script || "",
    hook: overrides.hook || "This is the gaming update people were waiting for.",
    flair: overrides.flair || "News",
    subreddit: overrides.subreddit || "IGN",
    source_type: overrides.source_type || "rss",
    score: overrides.score ?? 1500,
    num_comments: overrides.num_comments ?? 250,
    timestamp: overrides.timestamp || new Date().toISOString(),
    article_image: "https://example.test/image.jpg",
    game_images: ["https://example.test/game.jpg"],
    company_logo_url: "https://example.test/logo.svg",
    downloaded_images: [{ path: "output/image_cache/game.jpg", type: "key_art" }],
    ...overrides,
  };
}

test("Pulse topicality gate rejects House of the Dragon Season 3", () => {
  const s = story({
    title: "House of the Dragon Season 3 release date reportedly revealed",
    body: "HBO viewers may get the next season sooner than expected.",
  });
  const topicality = evaluatePulseGamingTopicality(s);
  assert.equal(topicality.decision, "reject");
  assert.equal(topicality.reason, "off_topic_entertainment");

  const scored = scoreStory(s, { channelId: "pulse-gaming" });
  assert.equal(scored.decision, "reject");
  assert.ok(scored.hard_stops.includes("pulse_gaming_off_topic_entertainment"));
});

test("Pulse topicality gate accepts Nintendo Switch 2 games", () => {
  const topicality = evaluatePulseGamingTopicality(
    story({ title: "Nintendo Switch 2 games lineup just got a new reveal" }),
  );
  assert.equal(topicality.decision, "accept");
});

test("Pulse topicality gate accepts MindsEye update or price cut", () => {
  assert.equal(
    evaluatePulseGamingTopicality(
      story({ title: "MindsEye update lands with a major price cut" }),
    ).decision,
    "accept",
  );
});

test("Pulse topicality gate accepts Xbox Game Pass price stories", () => {
  assert.equal(
    evaluatePulseGamingTopicality(
      story({ title: "Xbox Game Pass price changes are rolling out" }),
    ).decision,
    "accept",
  );
});

test("Pulse topicality gate accepts mainstream game franchise release-date stories", () => {
  const s = story({
    title: "Bethesda confirms release date for Elder Scrolls VI",
    body: "The publisher is finally talking about the next RPG launch window.",
  });
  const topicality = evaluatePulseGamingTopicality(s);
  assert.equal(topicality.decision, "accept");
  const scored = scoreStory(s, { channelId: "pulse-gaming" });
  assert.ok(
    !scored.hard_stops.includes("pulse_gaming_off_topic_entertainment"),
  );
});

test("Pulse topicality gate routes Elden Ring movie casting to review", () => {
  const s = story({
    title: "Elden Ring movie casting report names a major actor",
    body: "The adaptation is tied directly to FromSoftware's game franchise.",
  });
  const topicality = evaluatePulseGamingTopicality(s);
  assert.equal(topicality.decision, "review");
  assert.equal(topicality.reason, "gaming_adaptation_needs_manual_review");

  const scored = scoreStory(s, { channelId: "pulse-gaming" });
  assert.notEqual(scored.decision, "auto");
  assert.equal(scored.topicality.decision, "review");
});

test("Pulse topicality gate rejects general Marvel, Netflix and TV news", () => {
  const examples = [
    "Marvel reveals new Disney+ TV series casting",
    "Netflix renews a fantasy show for season 4",
    "General TV trailer breaks streaming records",
  ];
  for (const title of examples) {
    const topicality = evaluatePulseGamingTopicality(story({ title }));
    assert.equal(topicality.decision, "reject", title);
  }
});
