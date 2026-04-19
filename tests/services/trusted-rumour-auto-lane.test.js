/**
 * tests/services/trusted-rumour-auto-lane.test.js
 *
 * Pins the narrow review→auto promotion lane added 2026-04-18 after the
 * first post-volume hunt dropped 8 stories into the review queue, most
 * of which were obvious tier-1-leaker calls that the rubric's
 * source_confidence cap on rumour flair kept stuck at 55-74.
 *
 * The lane is layered ON TOP of the existing 100-point rubric — it does
 * NOT lower the global 75-point auto threshold. It only rescues stories
 * that score in the review band (55-74) AND cite a named tier-1 leaker
 * or primary-source evidence AND carry a concrete, dated/quantified
 * claim about a named franchise or platform.
 *
 * Covers:
 *   - Billbil-kun PS Plus leak, Tom Henderson with specific date,
 *     publisher-site numeric leak → all promoted to auto
 *   - Vague VA slip-up, niche indie DLC, multi-franchise compilation,
 *     off-brand film-industry content, anonymous rumour-flair leak
 *     → stay in review/reject
 *   - Hard stops still win over the lane (advertiser_safety=0 can't
 *     be auto-approved even with every other signal)
 *   - Stories scoring ≥75 still auto via the normal threshold
 *   - Helper works in isolation on fabricated score objects
 *
 * Run: node --test tests/services/trusted-rumour-auto-lane.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  scoreStory,
  qualifiesForTrustedRumourAutoLane,
} = require("../../lib/scoring");

/**
 * Score + lane-check in one pass, mimicking how decision-engine.scoreOne
 * wires them together. Returns { score, lane, promoted }.
 */
function scoreAndLane(story, ctx = {}) {
  const enriched = {
    flair: "rumour",
    subreddit: "gamingleaksandrumours",
    source_type: "reddit",
    score: 400,
    num_comments: 70,
    timestamp: new Date().toISOString(),
    article_image: "https://cdn/ex.jpg",
    game_images: ["https://steam/keyart.jpg"],
    ...story,
  };
  const score = scoreStory(enriched, {
    recentStories: [],
    existingPublishedPlatforms: [],
    ...ctx,
  });
  const lane = qualifiesForTrustedRumourAutoLane(enriched, score);
  return { score, lane };
}

// ----------------------------------------------------------------------------
// Positive cases — review should be promoted to auto
// ----------------------------------------------------------------------------

test("Billbil-kun PS Plus leak with named franchise → auto-lane promotes", () => {
  const { score, lane } = scoreAndLane({
    id: "billbilkun-hzd",
    title:
      "Billbil-kun: Horizon Zero Dawn Remastered leaked into April's PS Plus",
    body:
      "According to Billbil-kun, Horizon Zero Dawn Remastered will arrive " +
      "on PS Plus in April. The Extra tier adds the remaster to the " +
      "monthly lineup alongside two other PS5 titles.",
    hook: "A fresh PS Plus leak just dropped from one of the most reliable insiders",
    // No hook bonus to keep the base total below 75 so the lane is what
    // promotes this to auto (not the normal threshold).
    score: 350,
    num_comments: 60,
  });
  // Base rubric should land this in `review` (source_confidence is capped
  // at 12 for rumour:gamingleaksandrumours, plus small vote boost).
  assert.equal(
    score.decision,
    "review",
    `expected base decision 'review'; got ${score.decision} (total=${score.total})`,
  );
  assert.ok(lane.qualifies, `lane should qualify: reason=${lane.reason}`);
  assert.match(lane.reason, /leaker=billbil-kun/);
  assert.match(lane.reason, /platform=ps plus|franchise=horizon/);
});

test("Tom Henderson with specific date + time → auto-lane promotes", () => {
  const { score, lane } = scoreAndLane({
    id: "henderson-blackflag",
    title:
      "Tom Henderson on Black Flag remake: reveal set for April 23rd, embargo lifts 12:15 PM ET",
    body:
      "Tom Henderson reports that the Black Flag remake will be revealed " +
      "on April 23rd. The embargo lifts at 12:15 PM ET.",
    // Weak hook (short, generic) so hook_bonus does not fire and the story
    // lands in review rather than reaching auto via the normal 75 bar.
    hook: "Black Flag reveal locked",
    // Deliberately thin visuals + low engagement to keep total < 75.
    score: 80,
    num_comments: 15,
    article_image: null,
    game_images: null,
  });
  assert.equal(
    score.decision,
    "review",
    `expected base decision 'review'; got ${score.decision} (total=${score.total})`,
  );
  assert.ok(lane.qualifies, `lane should qualify: reason=${lane.reason}`);
  assert.match(lane.reason, /leaker=tom henderson/);
  assert.match(lane.reason, /specific_date/);
  assert.match(lane.reason, /specific_time/);
});

test("Publisher-site numeric leak (THQ Nordic Switch 2) → auto-lane promotes", () => {
  const { score, lane } = scoreAndLane({
    id: "thq-switch2",
    title: "THQ Nordic has 7 unannounced Switch 2 games listed on their site",
    body:
      "THQ Nordic's developer portal lists 7 unannounced Switch 2 titles. " +
      "The games appeared on their site earlier today. No franchise names " +
      "have been attached to the slots yet.",
    hook: "A big publisher just accidentally exposed seven unannounced Switch 2 games",
    score: 500,
    num_comments: 120,
  });
  assert.equal(
    score.decision,
    "review",
    `expected base decision 'review'; got ${score.decision} (total=${score.total})`,
  );
  assert.ok(lane.qualifies, `lane should qualify: reason=${lane.reason}`);
  // The first evidence phrase in the list that matches is reported.
  // "developer portal" and "on their site" both appear — either is valid.
  assert.match(lane.reason, /evidence="(?:developer portal|on their site)"/);
  assert.match(lane.reason, /numeric_claim/);
  assert.match(lane.reason, /platform=switch 2/);
});

// ----------------------------------------------------------------------------
// Negative cases — review must STAY review
// ----------------------------------------------------------------------------

test("Vague VA slip-up without named franchise → lane refuses", () => {
  const { score, lane } = scoreAndLane({
    id: "va-slipup",
    title: "Grace's VA may have slipped up in a recent stream",
    body:
      "A voice actor may have slipped up during a livestream by mentioning " +
      "a character return. No game or franchise was named in the clip.",
    hook: "A voice actor might have accidentally teased something huge tonight",
    score: 200,
    num_comments: 30,
  });
  assert.ok(
    !lane.qualifies,
    `lane must not qualify; got reason=${lane.reason} (total=${score.total})`,
  );
});

test("Niche indie DLC roster leak (no mainstream franchise) → lane refuses", () => {
  const { score, lane } = scoreAndLane({
    id: "mouse-dlc",
    title: "DLC 1 of Mouse P.I. For Hire enemy roster leaked",
    body:
      "The DLC 1 enemy roster for indie detective game Mouse P.I. For Hire " +
      "has leaked via a community datamine. The roster adds three new foes.",
    hook: "An indie datamine has spilled the DLC enemy lineup early",
    score: 80,
    num_comments: 12,
  });
  assert.ok(
    !lane.qualifies,
    `lane must not qualify; got reason=${lane.reason} (total=${score.total})`,
  );
});

test("Multi-franchise compilation rumour (≥3 franchises) → lane refuses", () => {
  const { score, lane } = scoreAndLane({
    id: "henderson-ubi",
    title:
      "Tom Henderson on Ubisoft: Splinter Cell delayed, Ghost Recon next, Far Cry in trouble",
    body:
      "Tom Henderson has weighed in on Ubisoft's roadmap. Splinter Cell is " +
      "delayed. Ghost Recon is next up. Far Cry is going through hell at " +
      "the studio level.",
    hook: "Tom Henderson has new intel on three Ubisoft franchises tonight",
    score: 400,
    num_comments: 80,
  });
  assert.ok(
    !lane.qualifies,
    `compilation (3+ franchises) must not qualify; got ${lane.reason}`,
  );
});

test("Off-brand Hollywood/CinemaCon coverage → lane refuses", () => {
  const { score, lane } = scoreAndLane({
    id: "kotaku-film",
    title: "Every sequel Hollywood teased at CinemaCon this week",
    body:
      "Hollywood's biggest studios showed off their 2026 slate at CinemaCon. " +
      "The box office is bracing for a packed summer. No gaming reveals " +
      "featured in the Vegas showcase.",
    hook: "Hollywood just dropped every sequel on the calendar in one week",
    flair: "news",
    subreddit: "kotaku",
    source_type: "rss",
    score: 50,
    num_comments: 5,
  });
  assert.ok(
    !lane.qualifies,
    `off-brand film content must not qualify; got ${lane.reason}`,
  );
});

test("Anonymous GLaR rumour without a named tier-1 leaker → lane refuses", () => {
  const { score, lane } = scoreAndLane({
    id: "anon-mafia",
    title: "Mafia 2 remake and Mafia: The Old Country sequel in-development",
    body:
      "A new post on the rumour subreddit claims Mafia 2 is getting a " +
      "remake. Mafia: The Old Country is also said to be getting a sequel. " +
      "No source has been attached to the claim.",
    hook: "Two Mafia games are reportedly in the works at the same time",
    score: 300,
    num_comments: 50,
  });
  // Has a franchise ("mafia") but no named leaker, no publisher evidence,
  // and flair is 'rumour' (not verified/highly likely). Must stay review.
  assert.ok(
    !lane.qualifies,
    `anonymous rumour must not qualify; got ${lane.reason}`,
  );
});

// ----------------------------------------------------------------------------
// Invariants: hard stops win, normal 75 threshold is intact
// ----------------------------------------------------------------------------

test("Hard stop (real-world gun violence) overrides the auto-lane", () => {
  // Construct a story that would otherwise qualify for the lane — named
  // leaker, specific date, named franchise — but also contains a real-
  // world-harm phrase that triggers advertiser_unfriendly_language.
  const { score, lane } = scoreAndLane({
    id: "hard-stop-wins",
    title: "Tom Henderson on Black Flag: reveal set for April 23rd",
    body:
      "Tom Henderson reports that Black Flag reveal is set for April 23rd. " +
      "Separately, the developer commented on gun violence in real life " +
      "and the responsibility the shooter genre has.",
    hook: "Tom Henderson has a Black Flag reveal date pinned for next week",
  });
  assert.equal(score.decision, "reject");
  assert.ok(score.hard_stops.includes("advertiser_unfriendly_language"));
  assert.ok(
    !lane.qualifies,
    `lane must never promote a hard-stopped story; got ${lane.reason}`,
  );
});

test("A story already at total≥75 stays auto via the normal threshold (lane is additive)", () => {
  const { score, lane } = scoreAndLane({
    id: "normal-75-auto",
    title: "Bethesda officially confirms Elder Scrolls VI release date",
    body:
      "Bethesda has revealed the Elder Scrolls VI release date during a " +
      "showcase. The sequel launches on PS5 and Xbox Series X in 2027.",
    hook: "Bethesda just officially confirmed when Elder Scrolls six ships",
    flair: "verified",
    subreddit: "gamingleaksandrumours",
    score: 3000,
    num_comments: 450,
  });
  assert.equal(score.decision, "auto");
  // Lane only fires on `review` — must return qualifies:false here to
  // prove it's not the reason for auto.
  assert.equal(
    lane.qualifies,
    false,
    `lane should only fire on review; got reason=${lane.reason}`,
  );
});

test("Lane refuses when advertiser_safety is only partial credit (2/5)", () => {
  // Build a floating-ambiguous story that scores 2/5 on advertiser_safety.
  // Even with a named leaker etc. the lane must refuse because safety is
  // not fully clean.
  const { score, lane } = scoreAndLane({
    id: "amber-safety",
    title: "Tom Henderson on kill streak mechanics in April 23rd reveal",
    body: "Tom Henderson mentions a kill streak during April 23rd coverage.",
    hook: "Tom Henderson drops an April 23rd kill streak hint tonight",
    // no context-markers in body — advertiser_safety lands at 2/5
    article_image: null,
    game_images: null,
    source_type: "reddit",
    flair: "rumour",
    subreddit: "somewhereelse",
  });
  // Don't need to assert score.decision — what matters is the lane
  // refuses when advertiser_safety is not 5.
  assert.ok(
    !lane.qualifies,
    `partial-safety story must not qualify; got ${lane.reason}`,
  );
});

// ----------------------------------------------------------------------------
// Helper works in isolation (so future callers can pass fabricated scores)
// ----------------------------------------------------------------------------

test("Helper accepts fabricated score objects (decision-engine integration)", () => {
  const fabricated = {
    decision: "review",
    hard_stops: [],
    breakdown: {
      advertiser_safety: 5,
      duplicate_safety: 10,
      freshness: 10,
    },
  };
  const story = {
    title: "Billbil-kun: Horizon Zero Dawn leaked into April's PS Plus",
    body: "Billbil-kun reports Horizon Zero Dawn on PS Plus in April.",
    hook: "Billbil-kun has dropped another PS Plus leak tonight",
    flair: "rumour",
    subreddit: "gamingleaksandrumours",
  };
  const lane = qualifiesForTrustedRumourAutoLane(story, fabricated);
  assert.ok(lane.qualifies);
  assert.match(lane.reason, /leaker=billbil-kun/);
});

test("Helper refuses fabricated score with non-review decision", () => {
  const fabricated = {
    decision: "defer",
    hard_stops: [],
    breakdown: {
      advertiser_safety: 5,
      duplicate_safety: 10,
      freshness: 10,
    },
  };
  const story = {
    title: "Billbil-kun: Horizon Zero Dawn leaked into April's PS Plus",
    body: "Billbil-kun reports Horizon Zero Dawn on PS Plus in April.",
    flair: "rumour",
    subreddit: "gamingleaksandrumours",
  };
  const lane = qualifiesForTrustedRumourAutoLane(story, fabricated);
  assert.equal(lane.qualifies, false);
});
