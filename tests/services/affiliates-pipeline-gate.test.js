"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { applyAffiliateAuditToStory } = require("../../affiliates");

test("affiliate pipeline keeps approved story-specific links and disclosure", () => {
  const story = {
    id: "pokemon",
    title: "Mega Mewtwo's Pokémon Go debut gets a confirmed date",
    full_script: "Pokémon Go players now have a concrete event date.",
    source_type: "rss",
    subreddit: "Eurogamer",
  };

  const { audit, affiliateLinks } = applyAffiliateAuditToStory(story, "pulsegaming-21");

  assert.equal(audit.verdict, "pass");
  assert.ok(affiliateLinks.length > 0);
  assert.ok(story.affiliate_url.includes("tag=pulsegaming-21"));
  assert.match(story.pinned_comment, /As an Amazon Associate I earn from qualifying purchases\./);
  assert.equal(story.affiliate_link_manifest.story_id, "pokemon");
  assert.equal(story.affiliate_link_manifest.disclosure_required, true);
  assert.match(story.commercial_landing_page_route, /^\/p\//);
  assert.ok(story.commercial_opportunity_score > 0);
});

test("affiliate pipeline blocks review-case fallback links from public story output", () => {
  const story = {
    id: "policy",
    title: "Xbox platform policy update changes account rules",
    full_script: "Xbox account verification policy changed without a product angle.",
    source_type: "rss",
    subreddit: "The Verge",
  };

  const { audit, affiliateLinks } = applyAffiliateAuditToStory(story, "pulsegaming-21");

  assert.equal(audit.verdict, "review");
  assert.deepEqual(affiliateLinks, []);
  assert.deepEqual(story.affiliate_links, []);
  assert.equal(story.affiliate_url, null);
  assert.doesNotMatch(story.pinned_comment, /amazon\.co\.uk/);
  assert.equal(story.affiliate_link_manifest.primary_link, null);
  assert.ok(
    story.affiliate_link_manifest.rejection_reasons.includes(
      "story_does_not_naturally_support_affiliate",
    ),
  );
});
