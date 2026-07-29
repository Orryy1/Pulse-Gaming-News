const test = require("node:test");
const assert = require("node:assert/strict");

const pulseGaming = require("../../channels/pulse-gaming");
const {
  scoreBreakingValue,
} = require("../../hunter");
const {
  classifyGovernedSource,
} = require("../../lib/services/governed-editorial-evidence-ingress");
const { TRENDING_SOURCE_URLS } = require("../../trending");

test("Pulse Gaming RSS feed config uses the current The Verge games feed", () => {
  const feed = pulseGaming.rssFeeds.find((item) => item.name === "TheVergeGaming");

  assert.ok(feed);
  assert.equal(feed.url, "https://www.theverge.com/rss/games/index.xml");
  assert.doesNotMatch(feed.url, /\/games\/rss\/index\.xml$/);
});

test("Pulse Gaming directly monitors the official Xbox Wire and PlayStation Blog feeds", () => {
  const feeds = new Map(
    pulseGaming.rssFeeds.map((item) => [item.name, item.url]),
  );

  assert.equal(feeds.get("XboxWire"), "https://news.xbox.com/en-us/feed/");
  assert.equal(
    feeds.get("PlayStationBlog"),
    "https://blog.playstation.com/feed/",
  );
});

test("first-party feed stories reach governed breaking review only when player-impact signals justify it", () => {
  const official = classifyGovernedSource(
    "https://blog.playstation.com/2026/07/28/example/",
    require("../../lib/services/breaking-source-policy")
      .BREAKING_SOURCE_POLICY,
  );
  assert.equal(official.source_class, "OFFICIAL_FIRST_PARTY");

  const genericOfficialScore = scoreBreakingValue(
    "A studio developer diary",
    50,
    0,
    pulseGaming.breakingKeywords,
    [],
    official.source_class,
  );
  const editorialPlayerImpactScore = scoreBreakingValue(
    "PlayStation Plus Monthly Games for August",
    50,
    0,
    pulseGaming.breakingKeywords,
    [],
    "TRUSTED_EDITORIAL",
  );
  const officialPlayerImpactScore = scoreBreakingValue(
    "PlayStation Plus Monthly Games for August",
    50,
    0,
    pulseGaming.breakingKeywords,
    [],
    official.source_class,
  );
  const singleSignalOfficialPlayerImpactScore =
    scoreBreakingValue(
      "A Game Adds Achievement Support",
      50,
      0,
      pulseGaming.breakingKeywords,
      [],
      official.source_class,
    );
  const singleSignalEditorialPlayerImpactScore =
    scoreBreakingValue(
      "A Game Adds Achievement Support",
      50,
      0,
      pulseGaming.breakingKeywords,
      [],
      "TRUSTED_EDITORIAL",
    );

  assert.equal(genericOfficialScore, 50);
  assert.equal(editorialPlayerImpactScore, 35);
  assert.equal(officialPlayerImpactScore, 80);
  assert.equal(singleSignalOfficialPlayerImpactScore, 80);
  assert.equal(singleSignalEditorialPlayerImpactScore, 20);
});

test("Google Trends gaming source uses the current trending RSS endpoint", () => {
  assert.equal(
    TRENDING_SOURCE_URLS.googleGaming,
    "https://trends.google.com/trending/rss?geo=US&category=8",
  );
  assert.doesNotMatch(TRENDING_SOURCE_URLS.googleGaming, /trendingsearches\/daily/);
});

test("Google Trends general source stays on the current trending RSS endpoint", () => {
  assert.equal(TRENDING_SOURCE_URLS.googleGeneral, "https://trends.google.com/trending/rss?geo=US");
});
