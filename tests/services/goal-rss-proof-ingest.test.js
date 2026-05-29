"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseRssProofItems,
  buildRssProofStories,
  _private,
} = require("../../lib/goal-rss-proof-ingest");
const { parseArgs } = require("../../tools/goal-batch-packages");

test("RSS proof ingest parses source-backed feed entries into goal-proof stories", () => {
  const xml = `
    <rss><channel>
      <item>
        <title>Save 50% Off a Dashcam During Amazon's Memorial Day Sale</title>
        <link>https://www.ign.com/articles/dashcam-sale</link>
      </item>
      <item>
        <title><![CDATA[Hades II - Xbox & PlayStation Trailer Coming April 14th]]></title>
        <link>https://www.ign.com/articles/hades-ii-console-trailer</link>
        <pubDate>Thu, 21 May 2026 18:30:00 GMT</pubDate>
        <description><![CDATA[Supergiant shows the console trailer.]]></description>
      </item>
      <item>
        <title>Steam Deck OLED gets a new update</title>
        <link>https://www.gamespot.com/articles/steam-deck-oled-update/1100-0000/</link>
      </item>
    </channel></rss>
  `;

  const items = parseRssProofItems(xml, {
    feed: { name: "IGN", url: "https://www.ign.com/rss" },
    maxItems: 10,
  });
  const stories = buildRssProofStories(items);

  assert.equal(stories.length, 2);
  assert.equal(stories[0].source_type, "rss");
  assert.equal(stories[0].source_name, "IGN");
  assert.match(stories[0].id, /^rss_/);
  assert.equal(stories[0].article_url, "https://www.ign.com/articles/hades-ii-console-trailer");
  assert.equal(stories[0].canonical_subject, "Hades II");
  assert.match(stories[0].full_script, /Hades II/i);
  assert.match(stories[0].full_script, /Follow Pulse Gaming/);
  assert.ok(stories[0].suggested_thumbnail_text.split(/\s+/).length <= 5);
  assert.equal(stories.some((story) => /Dashcam/i.test(story.title)), false);
});

test("RSS proof ingest rejects broad roundups and avoids bad fallback subjects", () => {
  assert.equal(
    _private.isGamingProofItem({ title: "Everything Announced at Warhammer Skulls 2026" }),
    false,
  );
  assert.equal(
    _private.isGamingProofItem({ title: "A Packed Day Of Game Reveals Just Ended With A Wave Of New Demos" }),
    false,
  );
  assert.equal(
    _private.isGamingProofItem({ title: "Only One Games Subscription Service Is Truly Kid-Friendly" }),
    false,
  );
  assert.equal(
    _private.titleSubjectFallback(
      "\"Honestly difficult to imagine a path forward with it\" - licensed Paranormal Activity horror game technically done for good",
    ),
    "Paranormal Activity",
  );
  assert.equal(
    _private.titleSubjectFallback(
      "It's not just PS Plus Essential getting a price hike: Premium and Extra tiers are now more expensive too",
    ),
    "PlayStation Plus",
  );
  assert.equal(
    _private.titleSubjectFallback("Former Splinter Cell Director Thinks Modern Graphics Are Hurting Stealth Games"),
    "Splinter Cell",
  );
  assert.equal(
    _private.titleSubjectFallback("Helldivers 2's Next Legendary Warbond Is Warhammer 40K"),
    "Helldivers 2",
  );
  assert.equal(
    _private.titleSubjectFallback("The Big Warhammer 40,000: Dawn of War IV Interview"),
    "Warhammer 40,000: Dawn of War IV",
  );
  assert.equal(
    _private.titleSubjectFallback("Xbox hires analyst who said games were losing the attention battle"),
    "Xbox",
  );
});

test("goal batch CLI exposes live RSS proof mode without enabling it by default", () => {
  assert.equal(parseArgs([]).liveRss, false);
  const args = parseArgs(["--live-rss", "--rss-per-feed", "4"]);
  assert.equal(args.liveRss, true);
  assert.equal(args.rssPerFeed, 4);
});

test("RSS proof ingest extracts useful game subjects from long article titles", () => {
  assert.equal(
    _private.titleSubjectFallback(
      "Assassin's Creed Black Flag Resynced director has teased more on cut modern-day sections",
    ),
    "Assassin's Creed Black Flag",
  );
  assert.equal(
    _private.titleSubjectFallback("Here&#039;s This Week&#039;s Free Game From The Epic Games Store On Mobile"),
    "Epic Games Store",
  );
  assert.equal(
    _private.isGamingProofItem({
      title: "Today’s Top Deals: Borderlands 4 for PS5, office chair and headphones",
    }),
    false,
  );
});

test("RSS proof ingest writes creator-native proof scripts instead of policy memo phrasing", () => {
  const stories = buildRssProofStories([
    {
      title: "Hades II finally shows console gameplay in new PlayStation trailer",
      url: "https://blog.playstation.com/hades-ii-console-gameplay",
      source_name: "PlayStation Blog",
      description: "Console gameplay reveal",
      timestamp: "2026-05-21T09:00:00.000Z",
    },
  ]);

  assert.equal(stories.length, 1);
  assert.doesNotMatch(
    stories[0].full_script,
    /the useful question|gave players the update they needed|source-backed update|this gaming story/i,
  );
  assert.match(stories[0].full_script, /Hades II/i);
  assert.match(stories[0].full_script, /PlayStation Blog/i);
});

test("RSS proof ingest keeps advertiser-unfriendly article wording out of narration", () => {
  const stories = buildRssProofStories([
    {
      title:
        "Xbox hires analyst who said games were losing the attention battle with gambling, crypto and porn as chief strategy officer",
      url: "https://www.eurogamer.net/xbox-hires-analyst",
      source_name: "Eurogamer",
      description: "Leadership update",
      timestamp: "2026-05-21T09:00:00.000Z",
    },
  ]);

  assert.equal(stories.length, 1);
  assert.equal(stories[0].canonical_subject, "Xbox");
  assert.doesNotMatch(stories[0].full_script, /\b(?:gambling|porn|casino|betting)\b/i);
  assert.match(stories[0].full_script, /Eurogamer says Xbox has made another leadership move/i);
});
