/**
 * tests/services/quality-redesign.test.js
 *
 * Pin the contract of the new quality-redesign lib modules.
 *
 * These tests are unit tests on pure functions — no ffmpeg, no
 * filesystem, no network. They exist so that future edits to the
 * lib/ helpers can't silently regress the behaviour the test
 * harness depends on.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const motion = require("../../lib/motion");
const transitions = require("../../lib/transitions");
const hookFactory = require("../../lib/hook-factory");
const captionEmphasis = require("../../lib/caption-emphasis");
const relevance = require("../../lib/relevance");
const imageCrop = require("../../lib/image-crop");

// ---------- lib/motion ------------------------------------------

test("motion.buildPerImageMotion: slot 0 always uses pushInCentre (hook punch)", () => {
  const out = motion.buildPerImageMotion({
    slot: 0,
    segmentCount: 8,
    segmentDuration: 5,
  });
  assert.match(out, /\[0:v\]/);
  assert.match(out, /zoompan=z=min/);
  assert.match(out, /format=yuv420p/);
  assert.match(out, /\[v0\]/);
});

test("motion.buildPerImageMotion: ALWAYS includes setrange=tv (auto_scale_N fix)", () => {
  // The auto_scale_N regression was caused by JPEG full-range
  // inputs being negotiated against a TV-range filter graph
  // without an explicit hint. setrange=tv prepends the hint.
  for (const slot of [0, 1, 2, 5, 7]) {
    const out = motion.buildPerImageMotion({
      slot,
      segmentCount: 8,
      segmentDuration: 5,
    });
    assert.match(
      out,
      /setrange=tv/,
      `slot ${slot} must include setrange=tv to prevent auto_scale failures`,
    );
  }
});

test("motion.buildPerImageMotion: video slots SKIP zoompan (motion already in source)", () => {
  const out = motion.buildPerImageMotion({
    slot: 0,
    segmentCount: 8,
    segmentDuration: 5,
    isVideoSlot: true,
  });
  assert.doesNotMatch(out, /zoompan=/);
  assert.match(out, /scale=1080:1920/);
  assert.match(out, /format=yuv420p/);
});

test("motion.buildPerImageMotion: zoom never exceeds MAX_ZOOM", () => {
  const out = motion.buildPerImageMotion({
    slot: 2,
    segmentCount: 8,
    segmentDuration: 5,
  });
  // The expression caps at MAX_ZOOM (1.18). Search for the literal.
  assert.match(out, /1\.18/);
});

// ---------- lib/transitions -------------------------------------

test("transitions: first edge is always a CUT (snappy hook handoff)", () => {
  const t = transitions.buildTransitionStrategy({
    segmentCount: 10,
    segmentDuration: 4,
  });
  assert.equal(t.length, 9);
  assert.equal(t[0].type, transitions.TRANSITION_TYPES.CUT);
  assert.equal(t[0].duration, 0);
});

test("transitions: last edge is a soft DISSOLVE (calm close)", () => {
  const t = transitions.buildTransitionStrategy({
    segmentCount: 10,
    segmentDuration: 4,
  });
  assert.equal(t[t.length - 1].type, transitions.TRANSITION_TYPES.DISSOLVE);
  assert.ok(t[t.length - 1].duration >= 0.25);
});

test("transitions: at least 1 cut + 1 dissolve in a 10-segment video (mix)", () => {
  const t = transitions.buildTransitionStrategy({
    segmentCount: 10,
    segmentDuration: 4,
  });
  const cuts = t.filter(
    (x) => x.type === transitions.TRANSITION_TYPES.CUT,
  ).length;
  const dissolves = t.filter(
    (x) => x.type === transitions.TRANSITION_TYPES.DISSOLVE,
  ).length;
  assert.ok(cuts >= 1, "must have at least one cut");
  assert.ok(dissolves >= 1, "must have at least one dissolve");
});

test("transitions: buildTransitionFilters length matches segmentCount-1", () => {
  const segmentCount = 8;
  const t = transitions.buildTransitionStrategy({
    segmentCount,
    segmentDuration: 4,
  });
  const filters = transitions.buildTransitionFilters(t, { segmentCount });
  assert.equal(filters.length, segmentCount - 1);
});

test("transitions: cut renders as concat (not zero-duration xfade)", () => {
  const t = transitions.buildTransitionStrategy({
    segmentCount: 4,
    segmentDuration: 4,
  });
  const filters = transitions.buildTransitionFilters(t, { segmentCount: 4 });
  // First edge is a CUT — should produce concat
  assert.match(filters[0], /concat=n=2:v=1:a=0/);
});

// ---------- lib/hook-factory ------------------------------------

test("hookFactory.tighten: strips fillers and caps at 7 words", () => {
  const out = hookFactory.tighten(
    "So, today the new Xbox boss might keep games like Gears of War off PlayStation moving forward.",
  );
  assert.ok(out.length <= 7);
  assert.notDeepEqual(out[0].toLowerCase(), "so");
  assert.notDeepEqual(out[0].toLowerCase(), "today");
});

test("hookFactory.composeOpenerOverlay: returns null for empty story", () => {
  const r = hookFactory.composeOpenerOverlay({});
  assert.equal(r, null);
});

test("hookFactory.composeOpenerOverlay: uppercases the headline", () => {
  const r = hookFactory.composeOpenerOverlay({
    hook: "GTA 6 release date might leak this month",
  });
  assert.ok(r);
  assert.equal(r.text, r.text.toUpperCase());
});

test("hookFactory.pickAccentIndex: prefers money / percent / year over plain words", () => {
  const i = hookFactory.pickAccentIndex(["The", "deal", "is", "$5B", "huge"]);
  assert.equal(i, 3);
});

test("hookFactory.composeOpenerOverlay: hold ends at 2.6s, fade-out at 3.0s", () => {
  const r = hookFactory.composeOpenerOverlay({
    hook: "GTA 6 will not launch in 2026",
  });
  assert.equal(r.holdEnd, 2.6);
  assert.equal(r.fadeOutEnd, 3.0);
});

// ---------- lib/caption-emphasis --------------------------------

test("captionEmphasis.groupIntoPhrases: splits on sentence-ending punctuation only", () => {
  const words = [
    { word: "The", start: 0, end: 0.3 },
    { word: "GTA", start: 0.3, end: 0.6 },
    { word: "6", start: 0.6, end: 0.9 },
    { word: "delay,", start: 0.9, end: 1.4 },
    { word: "obviously,", start: 1.4, end: 1.9 },
    { word: "is", start: 1.9, end: 2.0 },
    { word: "real.", start: 2.0, end: 2.3 },
  ];
  const phrases = captionEmphasis.groupIntoPhrases(words);
  assert.ok(phrases.length >= 2, "must split on the period at the end");
});

test("captionEmphasis.groupIntoPhrases: does NOT break on colons in titles", () => {
  // Regression for "Clair Obscur: Expedition 33" being shattered
  // across two captions with a visible gap.
  const words = [
    { word: "Clair", start: 0, end: 0.3 },
    { word: "Obscur:", start: 0.3, end: 0.7 },
    { word: "Expedition", start: 0.7, end: 1.3 },
    { word: "33", start: 1.3, end: 1.5 },
  ];
  const phrases = captionEmphasis.groupIntoPhrases(words);
  // Should produce ONE phrase (only 4 words, no sentence end), or
  // at most break by the WORDS_PER_PHRASE cap — not by the colon.
  assert.equal(
    phrases.length,
    1,
    "colon must not split mid-title; expected 1 phrase, got " + phrases.length,
  );
});

test("captionEmphasis.isEmphasisWord: detects $5B, 47%, 2026, GTA", () => {
  const tokens = new Set(["GTA"]);
  assert.ok(captionEmphasis.isEmphasisWord("$5B", tokens));
  assert.ok(captionEmphasis.isEmphasisWord("47%", tokens));
  assert.ok(captionEmphasis.isEmphasisWord("2026", tokens));
  assert.ok(captionEmphasis.isEmphasisWord("GTA", tokens));
  assert.ok(!captionEmphasis.isEmphasisWord("the", tokens));
});

test("captionEmphasis.extractStoryEmphasisTokens: pulls proper nouns from title", () => {
  const tokens = captionEmphasis.extractStoryEmphasisTokens({
    title: "GTA 6 release date confirmed by Take-Two Interactive",
  });
  assert.ok(tokens.has("GTA"));
  assert.ok(tokens.has("6"));
  // Lower-case stopwords are dropped
  assert.ok(!tokens.has("THE"));
});

test("captionEmphasis.buildAss: produces complete ASS file with both styles", () => {
  const story = { title: "GTA 6 delay confirmed", id: "test1" };
  const words = [
    { word: "GTA", start: 0, end: 0.5 },
    { word: "6", start: 0.5, end: 0.8 },
    { word: "delay", start: 0.8, end: 1.4 },
    { word: "is", start: 1.4, end: 1.6 },
    { word: "real.", start: 1.6, end: 2.0 },
  ];
  const ass = captionEmphasis.buildAss({ story, words, duration: 5 });
  assert.match(ass, /\[V4\+ Styles\]/);
  assert.match(ass, /Style: Caption,/);
  assert.match(ass, /Style: Emphasis,/);
  assert.match(ass, /Dialogue: 0,/);
  // Emphasis style switches expected for GTA / 6
  assert.match(ass, /\\rEmphasis/);
});

test("captionEmphasis.buildAss: clamps phrases to PHRASE_MAX_DURATION_S", () => {
  const story = { title: "test" };
  const words = [
    // A phrase that runs 4 seconds — must clamp to 2.2.
    { word: "this", start: 0, end: 4.0 },
  ];
  const ass = captionEmphasis.buildAss({ story, words, duration: 10 });
  // Ends at start+2.2 = 0:00:02.20 not 0:00:04.00
  assert.match(ass, /0:00:02\.20/);
});

// ---------- lib/relevance ---------------------------------------

test("relevance.tokenize: drops stopwords + short tokens", () => {
  const t = relevance.tokenize("The new Xbox release of GTA 6 is huge");
  assert.ok(!t.includes("the"));
  assert.ok(!t.includes("is"));
  assert.ok(t.includes("xbox"));
  assert.ok(t.includes("gta"));
  assert.ok(t.includes("6") || t.includes("xbox"));
});

test("relevance.scoreImage: keyword match in filename boosts score", () => {
  const story = { title: "GTA 6 release date confirmed", body: "" };
  const { keywords, titleTokens } = relevance.buildStoryKeywords(story);
  const gtaImg = { filename: "rss_xxx_gta6_hero_steam.jpg", source: "steam" };
  const cottageImg = {
    filename: "rss_xxx_pexels_cottage_1.jpg",
    source: "pexels",
  };
  const gtaScore = relevance.scoreImage(gtaImg, { keywords, titleTokens });
  const cottageScore = relevance.scoreImage(cottageImg, {
    keywords,
    titleTokens,
  });
  assert.ok(
    gtaScore > cottageScore,
    `GTA-tagged image should outscore generic stock — got gta=${gtaScore} cottage=${cottageScore}`,
  );
});

test("relevance.scoreImage: penalises stock-library tags", () => {
  const story = { title: "Witcher 3 director praises new RPG", body: "" };
  const { keywords, titleTokens } = relevance.buildStoryKeywords(story);
  const stockImg = {
    filename: "1234_pexels_2.jpg",
    source: "pexels",
    tags: ["person", "businessman"],
  };
  const score = relevance.scoreImage(stockImg, { keywords, titleTokens });
  assert.ok(
    score < 0,
    `stock + person image should be penalised, got ${score}`,
  );
});

test("relevance.rankImagesByRelevance: combined score reorders by relevance, not just source", () => {
  const story = { title: "GTA 6 release date" };
  const images = [
    { filename: "rss_xxx_pexels_gta_1.jpg", priority: 25, source: "pexels" },
    { filename: "rss_xxx_article.jpg", priority: 100, source: "article" },
    { filename: "rss_xxx_bing_random.jpg", priority: 10, source: "bing" },
  ];
  const ranked = relevance.rankImagesByRelevance(images, story);
  assert.equal(ranked.length, 3);
  // article still wins (priority 100 + maybe small relevance), but
  // pexels with GTA in filename must beat bing with no relevance.
  const idxPexels = ranked.findIndex((i) => i.filename.includes("pexels"));
  const idxBing = ranked.findIndex((i) => i.filename.includes("bing"));
  assert.ok(
    idxPexels < idxBing,
    `keyword-matched pexels (idx ${idxPexels}) should outrank generic bing (idx ${idxBing})`,
  );
});

// ---------- lib/image-crop --------------------------------------

test("image-crop: cache filename uses _smartcrop_v2 suffix (busts stale crops)", () => {
  // The CACHE_SUFFIX export ensures any old `_smartcrop.jpg` files
  // from the rolled-back attempt are NOT reused. New ones land at
  // `_smartcrop_v2.jpg`.
  assert.equal(imageCrop.CACHE_SUFFIX, "_smartcrop_v2.jpg");
});

test("image-crop: smartCropToReel returns input on null / non-string", async () => {
  assert.equal(await imageCrop.smartCropToReel(null), null);
  assert.equal(await imageCrop.smartCropToReel(undefined), undefined);
  assert.equal(await imageCrop.smartCropToReel(""), "");
});

test("image-crop: smartCropToReel returns input when file doesn't exist", async () => {
  const out = await imageCrop.smartCropToReel(
    "/tmp/definitely-does-not-exist-quality-test.jpg",
  );
  assert.equal(out, "/tmp/definitely-does-not-exist-quality-test.jpg");
});

test("image-crop: VARIANT_STRATEGIES exposes 7 distinct crop strategies", () => {
  assert.equal(imageCrop.VARIANT_STRATEGIES.length, 7);
  assert.ok(imageCrop.VARIANT_STRATEGIES.includes("attention"));
  assert.ok(imageCrop.VARIANT_STRATEGIES.includes("entropy"));
  assert.ok(imageCrop.VARIANT_STRATEGIES.includes("north"));
  assert.ok(imageCrop.VARIANT_STRATEGIES.includes("centre"));
});

test("image-crop: smartCropForCount returns exactly targetCount paths", async () => {
  // Use non-existent paths so smart-crop fails fast and falls back
  // to returning the input. We're testing the LENGTH + cycling
  // logic, not the actual cropping.
  const sources = ["/tmp/no_a.jpg", "/tmp/no_b.jpg"];
  const out = await imageCrop.smartCropForCount(sources, 6);
  assert.equal(out.length, 6);
  // Entries should alternate between the two sources (round-robin):
  // out[0]=a, out[1]=b, out[2]=a, out[3]=b, ...
  for (let i = 0; i < 6; i++) {
    assert.ok(out[i].includes(i % 2 === 0 ? "no_a" : "no_b"));
  }
});

test("image-crop: smartCropForCount: empty inputs return empty array", async () => {
  assert.deepEqual(await imageCrop.smartCropForCount([], 10), []);
  assert.deepEqual(await imageCrop.smartCropForCount(["/tmp/a.jpg"], 0), []);
});

// ---------- lib/prl-overlays ------------------------------------

const prl = require("../../lib/prl-overlays");

test("prl: flairColour maps known classifications to brand colours", () => {
  assert.equal(prl.flairColour("Confirmed"), "0x10B981");
  assert.equal(prl.flairColour("Breaking"), "0xFF2D2D");
  assert.equal(prl.flairColour("Rumour"), "0xF59E0B");
  assert.equal(prl.flairColour("Trailer"), "0x8B5CF6");
  // Unknown falls back to grey News
  assert.equal(prl.flairColour("Whatever"), "0x6B7280");
});

test("prl.buildFlairBadge: emits drawtext + pulsing border drawbox", () => {
  const out = prl.buildFlairBadge({
    flair: "Breaking",
    fontOpt: "font='Arial'",
  });
  assert.equal(out.length, 2);
  assert.match(out[0], /drawtext=text=' {2}BREAKING {2}'/);
  // Pulse is implemented as a periodic `enable` gate (drawbox
  // does not support runtime alpha). On for 0.6s every 2s.
  assert.match(out[1], /enable='lt\(mod\(t\\,2\)\\,0\.6\)'/);
});

test("prl.buildSourceBug: uses subreddit when present", () => {
  const out = prl.buildSourceBug({
    story: { subreddit: "GamingLeaksAndRumours" },
    fontOpt: "font='Arial'",
  });
  assert.equal(out.length, 1);
  assert.match(out[0], /r\/GamingLeaksAndRumours/);
});

test("prl.buildSourceBug: falls back to source_type when no subreddit", () => {
  const out = prl.buildSourceBug({
    story: { source_type: "rss", subreddit: null },
    fontOpt: "font='Arial'",
  });
  assert.match(out[0], /text=' {2}rss {2}'/);
});

test("prl.buildStatCard: returns [] when no Steam metrics on story", () => {
  const out = prl.buildStatCard({
    story: { title: "no stats here" },
    fontOpt: "font='Arial'",
  });
  assert.deepEqual(out, []);
});

test("prl.buildStatCard: emits one drawtext when stats present", () => {
  const out = prl.buildStatCard({
    story: { steam_review_score: 87, steam_player_count: 12345 },
    fontOpt: "font='Arial'",
    startS: 4,
    durationS: 4,
  });
  assert.equal(out.length, 1);
  // ffmpeg drawtext escapes % and , so "87% Positive" lands as
  // "87\% Positive" and "12,345" as "12\,345" inside the text='...' arg
  assert.match(out[0], /87\\% Positive/);
  assert.match(out[0], /12\\,345 Playing/);
  assert.match(out[0], /enable='between\(t\\,4\\,8\)'/);
});

test("prl.buildCommentSwoop: returns [] when no comment data", () => {
  const out = prl.buildCommentSwoop({
    story: { title: "no comments" },
    fontOpt: "font='Arial'",
  });
  assert.deepEqual(out, []);
});

test("prl.buildCommentSwoop: emits card bg + stripe + handle + body", () => {
  const out = prl.buildCommentSwoop({
    story: {
      top_comment: "This is going to flop hard, mark my words on this",
      reddit_comments: [{ author: "GamerXX", body: "...", score: 547 }],
    },
    fontOpt: "font='Arial'",
    startS: 12,
    durationS: 6,
  });
  // Card bg + amber stripe + handle line + at least 1 body line
  assert.ok(out.length >= 4);
  // u/handle in the header
  assert.ok(out.some((l) => l.includes("u/GamerXX")));
  // Score visible
  assert.ok(out.some((l) => l.includes("↑547")));
});

test("prl.buildHotTakeCard: uses story.loop as fallback text", () => {
  const out = prl.buildHotTakeCard({
    story: { loop: "And nobody saw this coming." },
    fontOpt: "font='Arial'",
    startS: 40,
    durationS: 4,
  });
  assert.ok(out.length >= 3);
  assert.ok(out.some((l) => l.includes("HOT TAKE")));
});

test("prl.buildPrlChain: full chain length grows with enabled options", () => {
  const story = {
    title: "GTA 6 leak",
    flair: "Confirmed",
    subreddit: "GamingLeaksAndRumours",
    steam_review_score: 87,
    steam_player_count: 12345,
    top_comment: "This is huge",
    reddit_comments: [{ author: "X", body: "huge", score: 100 }],
    loop: "Stay tuned for more.",
  };
  const full = prl.buildPrlChain({
    story,
    fontOpt: "font='Arial'",
    videoDuration: 60,
  });
  assert.ok(
    full.length >= 8,
    `expected ≥8 elements in full chain, got ${full.length}`,
  );

  const minimal = prl.buildPrlChain({
    story,
    fontOpt: "font='Arial'",
    videoDuration: 60,
    options: {
      enableLowerThird: false,
      enableBadge: false,
      enableSourceBug: false,
      enableStatCard: false,
      enableCommentSwoop: false,
      enableHotTake: false,
    },
  });
  // Only the eq() polish remains
  assert.equal(minimal.length, 1);
  assert.match(minimal[0], /^eq=brightness/);
});

test("prl.ffEscape: escapes ffmpeg drawtext metacharacters", () => {
  // Smart quotes preserved; literal apostrophe replaced; colon/comma escaped.
  assert.equal(
    prl.ffEscape("It's a 30%, 2-for-1: deal"),
    "It’s a 30\\%\\, 2-for-1\\: deal",
  );
});
