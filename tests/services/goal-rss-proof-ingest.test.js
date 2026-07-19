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

test("RSS proof ingest can advance past an exhausted leading cohort", () => {
  const xml = `
    <rss><channel>
      <item><title>Halo Campaign Evolved Update One</title><link>https://example.com/halo-1</link></item>
      <item><title>Halo Campaign Evolved Update Two</title><link>https://example.com/halo-2</link></item>
      <item><title>Battlefield 6 Shows New Gameplay</title><link>https://example.com/battlefield-6</link></item>
      <item><title>Heave Ho 2 Reveals Co-op Gameplay</title><link>https://example.com/heave-ho-2</link></item>
    </channel></rss>
  `;

  const items = parseRssProofItems(xml, {
    feed: { name: "Official feed", url: "https://example.com/feed" },
    maxItems: 2,
    offsetItems: 2,
  });

  assert.deepEqual(items.map((item) => item.url), [
    "https://example.com/battlefield-6",
    "https://example.com/heave-ho-2",
  ]);
});

test("RSS proof ingest preserves materialisable video enclosures for source-motion-first refill", () => {
  const xml = `
    <rss><channel>
      <item>
        <title><![CDATA[Halo Campaign Evolved Shows New Gameplay In Official Xbox Deep Dive]]></title>
        <link>https://news.xbox.com/en-us/2026/07/07/halo-campaign-evolved-gameplay/</link>
        <pubDate>Tue, 07 Jul 2026 09:00:00 GMT</pubDate>
        <description><![CDATA[Xbox shows a playable campaign demo.]]></description>
        <enclosure url="https://assets.xbox.com/halo-campaign-evolved/gameplay-deep-dive.mp4" type="video/mp4" />
      </item>
    </channel></rss>
  `;

  const stories = buildRssProofStories(
    parseRssProofItems(xml, {
      feed: { name: "Xbox Wire", url: "https://news.xbox.com/feed" },
      maxItems: 10,
    }),
  );

  assert.equal(stories.length, 1);
  assert.equal(
    stories[0].approved_direct_media_url,
    "https://assets.xbox.com/halo-campaign-evolved/gameplay-deep-dive.mp4",
  );
  assert.deepEqual(stories[0].direct_media_candidates, [
    {
      direct_media_url: "https://assets.xbox.com/halo-campaign-evolved/gameplay-deep-dive.mp4",
      direct_media_url_if_available:
        "https://assets.xbox.com/halo-campaign-evolved/gameplay-deep-dive.mp4",
      source_type: "rss_video_enclosure",
      source_family: "rss_video_enclosure_xbox_wire_halo_campaign_evolved",
      source_url: "https://news.xbox.com/en-us/2026/07/07/halo-campaign-evolved-gameplay/",
      title: "Halo Campaign Evolved Shows New Gameplay In Official Xbox Deep Dive",
      canonical_subject: "Halo Campaign Evolved",
      canonical_game: "Halo Campaign Evolved",
    },
  ]);
});

test("RSS proof ingest rejects broad roundups and avoids bad fallback subjects", () => {
  assert.equal(
    _private.isGamingProofItem({
      title: "Share of the Week: Portraits",
      description: "Community screenshots from the game of your choice using PS Share.",
    }),
    false,
  );
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
    _private.isGamingProofItem({
      title: "Next Week on Xbox: New Games for June 22 to 26",
      description: "A calendar roundup of dozens of upcoming games.",
    }),
    false,
  );
  assert.equal(
    _private.isGamingProofItem({
      title: "Best Fantasy Games To Escape Into This Weekend",
      description: "Our evergreen list of fantasy games to play now.",
    }),
    false,
  );
  assert.equal(
    _private.isGamingProofItem({
      title: "Best PS5 Games In 2026",
      description: "A regularly updated list of PS5 games.",
    }),
    false,
  );
  assert.equal(
    _private.isGamingProofItem({
      title: "Take-Two's ex-AI boss says generative AI hype is poisoning the well",
      description: "An executive industry interview without a specific player-facing game update.",
    }),
    false,
  );
  assert.equal(
    _private.isGamingProofItem({
      title: "Official PlayStation Podcast Episode 544: Vesper Underground",
      description: "Podcast episode notes without direct gameplay, trailer or release evidence.",
    }),
    false,
  );
  assert.equal(
    _private.isGamingProofItem({
      title: "Sea of Thieves Custom Seas Update Details Revealed",
      description: "Rare explains the new custom seas update for players.",
    }),
    true,
  );
  assert.equal(
    _private.isGamingProofItem({
      title: "Granblue Fantasy: Relink Endless Ragnarok Demo Available Today",
      description: "A playable demo and hands-on details for the action RPG.",
    }),
    true,
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
  assert.equal(
    _private.titleSubjectFallback(
      "Meet the Star Operator Who Rewrites the Ranged Rulebook in Starward V3.1",
    ),
    "Starward",
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
    _private.titleSubjectFallback("Castlevania: Belmont's Curse hands-on report"),
    "Castlevania: Belmont's Curse",
  );
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
    _private.titleSubjectFallback(
      "Path of Exile 2 director says players exploiting system to become in-game millionaires ruined Christmas for me",
    ),
    "Path of Exile 2",
  );
  assert.equal(
    _private.titleSubjectFallback(
      "Nobody needs to grind for 100 hours to see how Path of Exile 2 has redefined the action RPG loot hunt",
    ),
    "Path of Exile 2",
  );
  assert.equal(
    _private.titleSubjectFallback("PUBG has GenAI team mates now capable of intelligent decision-making"),
    "PUBG",
  );
  assert.equal(
    _private.titleSubjectFallback("Steam Controller reservation update high demand"),
    "Steam Controller",
  );
  assert.equal(
    _private.isGamingProofItem({
      title: "Today’s Top Deals: Borderlands 4 for PS5, office chair and headphones",
    }),
    false,
  );
});

test("RSS proof ingest prefers clean game and product subjects over manifest fragments", () => {
  const stories = buildRssProofStories([
    {
      title: "Steam Controller reservation update high demand",
      url: "https://www.eurogamer.net/steam-controller-reservation-update-high-demand",
      source_name: "Eurogamer",
      description: "Steam Controller reservations are seeing high demand.",
      timestamp: "2026-06-20T01:00:00.000Z",
    },
    {
      title: "PUBG has GenAI team mates now capable of intelligent decision-making",
      url: "https://www.rockpapershotgun.com/pubg-genai-team-mates",
      source_name: "RockPaperShotgun",
      description: "PUBG is testing GenAI teammates.",
      timestamp: "2026-06-20T01:00:00.000Z",
    },
    {
      title:
        "Nobody needs to grind for 100 hours to see how Path of Exile 2 has redefined the action RPG loot hunt",
      url: "https://www.pcgamer.com/path-of-exile-2-loot-hunt",
      source_name: "PCGamer",
      description: "Path of Exile 2 changes the ARPG loot hunt.",
      timestamp: "2026-06-20T01:00:00.000Z",
    },
    {
      title: "Castlevania: Belmont’s Curse hands-on report",
      url: "https://blog.playstation.com/2026/07/17/castlevania-belmonts-curse-hands-on-report/",
      source_name: "PlayStation Blog",
      description: "Castlevania: Belmont’s Curse gameplay details.",
      timestamp: "2026-07-17T07:00:36.000Z",
    },
  ]);

  assert.deepEqual(
    stories.map((story) => story.canonical_subject),
    [
      "Steam Controller",
      "PUBG",
      "Path of Exile 2",
      "Castlevania: Belmont's Curse",
    ],
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

test("RSS proof ingest blocks weak scaffold narration phrases", () => {
  const stories = buildRssProofStories([
    {
      title: "Valor Mortis Gets Short Delay to Avoid September's Onslaught of Game Releases",
      url: "https://www.ign.com/articles/valor-mortis-delay",
      source_name: "IGN",
      description: "Release date delay",
      timestamp: "2026-06-12T09:00:00.000Z",
    },
    {
      title: "In 007 First Light, The Best Part Of Being Bond Is The Boring Stuff",
      url: "https://www.gamespot.com/articles/007-first-light-bond-boring-stuff",
      source_name: "GameSpot",
      description: "Hands-on preview",
      timestamp: "2026-06-12T09:00:00.000Z",
    },
  ]);

  assert.equal(stories.length, 2);
  for (const story of stories) {
    assert.doesNotMatch(
      story.full_script,
      /finally has something (?:concrete|specific) to judge|concrete detail players can argue|source-backed update|angle moves with it/i,
    );
    assert.match(story.full_script, /Follow Pulse Gaming so you never miss a beat\./);
  }
  assert.match(stories[0].full_script, /delay|September/i);
  assert.match(stories[1].full_script, /007 First Light|Bond/i);
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
