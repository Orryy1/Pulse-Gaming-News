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

test("first-party feed stories receive a bounded discovery-priority boost", () => {
  const official = classifyGovernedSource(
    "https://blog.playstation.com/2026/07/28/example/",
    require("../../lib/services/breaking-source-policy")
      .BREAKING_SOURCE_POLICY,
  );
  assert.equal(official.source_class, "OFFICIAL_FIRST_PARTY");

  const editorialScore = scoreBreakingValue(
    "PlayStation Plus Monthly Games for August",
    50,
    0,
    [],
    [],
    "TRUSTED_EDITORIAL",
  );
  const officialScore = scoreBreakingValue(
    "PlayStation Plus Monthly Games for August",
    50,
    0,
    [],
    [],
    official.source_class,
  );

  assert.equal(officialScore - editorialScore, 45);
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
