"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AMAZON_ASSOCIATE_DISCLOSURE,
  amazonSearchUrl,
  buildAffiliateStack,
  buildPinnedComment,
  formatStorySource,
  normaliseAffiliateLinks,
} = require("../../lib/affiliate-targeting");

test("amazonSearchUrl always appends the affiliate tag", () => {
  const url = amazonSearchUrl("Pokemon Go Plus Plus", "pulsegaming-21");

  assert.equal(
    url,
    "https://www.amazon.co.uk/s?k=Pokemon%20Go%20Plus%20Plus&tag=pulsegaming-21",
  );
});

test("buildAffiliateStack targets a Pokemon Go story with game-specific products", () => {
  const links = buildAffiliateStack(
    {
      title:
        "Mega Mewtwo's Pokemon Go debut finally announced and Go Fest Global is free",
      source_type: "rss",
      subreddit: "Eurogamer",
    },
    { tag: "pulsegaming-21" },
  );

  assert.equal(links[0].label, "Pokémon Go Plus+");
  assert.ok(links.some((link) => link.query === "Pokemon TCG booster box"));
  assert.ok(links.every((link) => link.url.includes("tag=pulsegaming-21")));
  assert.ok(!links.some((link) => /gaming headset/i.test(link.query)));
});

test("buildAffiliateStack combines franchise and platform targeting", () => {
  const links = buildAffiliateStack(
    {
      title: "GTA 6 PS5 trailer report points to another huge reveal",
    },
    { tag: "pulsegaming-21" },
  );

  assert.ok(links.some((link) => /Grand Theft Auto/i.test(link.query)));
  assert.ok(links.some((link) => /DualSense|PlayStation 5/i.test(link.query)));
  assert.ok(links.length <= 4);
});

test("buildPinnedComment uses non-reddit RSS sources without fake r/ prefix", () => {
  const story = { source_type: "rss", subreddit: "Eurogamer" };
  const links = buildAffiliateStack(
    { title: "Nintendo Switch 2 launch accessories leak" },
    { tag: "pulsegaming-21" },
  );

  const comment = buildPinnedComment(story, links);

  assert.match(comment, /Source: Eurogamer/);
  assert.doesNotMatch(comment, /Source: r\/Eurogamer/);
  assert.match(comment, /tag=pulsegaming-21/);
  assert.match(comment, new RegExp(AMAZON_ASSOCIATE_DISCLOSURE));
});

test("normaliseAffiliateLinks preserves new stacks and old single-url stories", () => {
  assert.deepEqual(
    normaliseAffiliateLinks({
      affiliate_links: [
        { label: "A", url: "https://www.amazon.co.uk/s?k=Pokemon&tag=x" },
      ],
    }),
    [
      {
        label: "A",
        url: "https://www.amazon.co.uk/s?k=Pokemon&tag=x",
        category: "related",
      },
    ],
  );

  assert.deepEqual(
    normaliseAffiliateLinks({
      affiliate_primary_label: "Old",
      affiliate_url: "https://www.amazon.co.uk/s?k=Zelda&tag=x",
    }),
    [
      {
        label: "Old",
        url: "https://www.amazon.co.uk/s?k=Zelda&tag=x",
        category: "related",
      },
    ],
  );
});

test("normaliseAffiliateLinks rejects unsafe or non-Amazon affiliate URLs", () => {
  assert.deepEqual(
    normaliseAffiliateLinks({
      affiliate_links: [
        { label: "Bad", url: "javascript:alert(1)" },
        { label: "External", url: "https://example.com/offer" },
        {
          label: "Safe",
          url: "https://www.amazon.co.uk/s?k=Pokemon&tag=pulse-21",
        },
      ],
      affiliate_url: "javascript:alert(2)",
    }),
    [
      {
        label: "Safe",
        url: "https://www.amazon.co.uk/s?k=Pokemon&tag=pulse-21",
        category: "related",
      },
    ],
  );
});

test("formatStorySource keeps reddit sources explicit", () => {
  assert.equal(
    formatStorySource({ source_type: "reddit", subreddit: "GamingLeaksAndRumours" }),
    "r/GamingLeaksAndRumours",
  );
});
