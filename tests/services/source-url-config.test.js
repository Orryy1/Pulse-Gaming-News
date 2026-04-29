const test = require("node:test");
const assert = require("node:assert/strict");

const pulseGaming = require("../../channels/pulse-gaming");
const { TRENDING_SOURCE_URLS } = require("../../trending");

test("Pulse Gaming RSS feed config uses the current The Verge games feed", () => {
  const feed = pulseGaming.rssFeeds.find((item) => item.name === "TheVergeGaming");

  assert.ok(feed);
  assert.equal(feed.url, "https://www.theverge.com/rss/games/index.xml");
  assert.doesNotMatch(feed.url, /\/games\/rss\/index\.xml$/);
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
