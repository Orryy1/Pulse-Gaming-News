/**
 * tests/services/advertiser-safety.test.js
 *
 * Pins the context-aware advertiser_safety rule introduced after the
 * 2026-04-19 Medal of Honor hard-stop incident. Previously the scorer
 * flat-blocked on any substring match of "shooter", "shooting", "kill",
 * "murder", "bomb", "war" — which rejected legitimate coverage of
 * shooter / action / crime franchises (CoD, Battlefield, Doom, MoH,
 * Hotline Miami, Mafia, GTA, Counter-Strike, Helldivers, …).
 *
 * The new rule:
 *   - Absolute real-world harm terms (suicide, self-harm, rape, pedophile,
 *     genocide, terrorism, lynching) always hard-stop.
 *   - Gaming-ambiguous terms (shooter, shooting, kill, murder, bomb, gun,
 *     war) only hard-stop when paired with real-world-harm context
 *     (mass shooting, school shooter, real life, tragedy, victim, police
 *     said, hospital, etc.).
 *   - Otherwise, if clear gaming-context markers are present (game,
 *     trailer, DLC, Steam, PS5, studio, etc.) the story is safe.
 *   - Ambiguous term without either context → partial credit (2/5) — no
 *     hard-stop, but score drops enough to nudge toward review.
 *
 * Run: node --test tests/services/advertiser-safety.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { scoreStory } = require("../../lib/scoring");

function score(story, ctx = {}) {
  return scoreStory(
    {
      flair: "news",
      subreddit: "ign",
      source_type: "rss",
      score: 500,
      num_comments: 80,
      timestamp: new Date().toISOString(),
      article_image: "https://cdn/ex.jpg",
      ...story,
    },
    {
      recentStories: [],
      existingPublishedPlatforms: [],
      ...ctx,
    },
  );
}

// -------- Allowed: gaming-context shooter / action / crime content --------

test("Call of Duty trailer story is NOT hard-stopped (shooter+gaming context)", () => {
  const r = score({
    title: "Call of Duty: new multiplayer trailer drops tomorrow",
    body:
      "Activision has released a new trailer for the upcoming Call of Duty " +
      "first-person shooter. The multiplayer gameplay reveal shows new maps " +
      "and weapons. The game launches on PS5 and Xbox in October.",
  });
  assert.equal(r.breakdown.advertiser_safety, 5);
  assert.deepEqual(r.hard_stops, []);
});

test("Medal of Honor fan remake — the story that triggered this fix", () => {
  const r = score({
    title:
      "Here's that free fan remake of 1999's PlayStation-exclusive Medal of Honor you were looking for",
    body:
      "Fans have released a free remake of the classic first-person shooter " +
      "Medal of Honor. The PlayStation original introduced the shooter genre " +
      "to many players. The remake is available on Steam as a free download.",
  });
  assert.equal(r.breakdown.advertiser_safety, 5);
  assert.deepEqual(r.hard_stops, []);
});

test("Doom trailer story (gaming context; the word 'kill' in combat description)", () => {
  const r = score({
    title: "Doom: The Dark Ages gets new gameplay trailer",
    body:
      "The new Doom trailer shows off brutal combat mechanics. Players can " +
      "kill demons with a variety of weapons including the iconic shotgun. " +
      "The game launches on PS5, Xbox and Steam next year.",
  });
  assert.equal(r.breakdown.advertiser_safety, 5);
  assert.deepEqual(r.hard_stops, []);
});

test("GTA 6 trailer analysis story (crime-game franchise)", () => {
  const r = score({
    title:
      "Dedicated nature watchers are combing every millisecond of GTA 6 trailer footage",
    body:
      "The GTA 6 trailer has fans cataloguing every animal shown. Rockstar's " +
      "open-world crime game has a history of detailed wildlife. The game " +
      "launches on PS5 and Xbox.",
  });
  assert.equal(r.breakdown.advertiser_safety, 5);
  assert.deepEqual(r.hard_stops, []);
});

test("Hotline Miami trailer leak (violent indie but clear gaming context)", () => {
  const r = score({
    title: "Hotline Miami 2 unused animated trailer leaked",
    body:
      "An unused trailer for the indie top-down shooter Hotline Miami 2 has " +
      "leaked. The developer studio originally cut it from the game's launch " +
      "campaign on Steam.",
  });
  assert.equal(r.breakdown.advertiser_safety, 5);
  assert.deepEqual(r.hard_stops, []);
});

test("Battlefield 2042 update with war-setting language", () => {
  const r = score({
    title: "Battlefield 2042 Season 7 update brings new war-setting maps",
    body:
      "The latest Battlefield update adds three new multiplayer maps set in " +
      "near-future war zones. The game's single-player campaign also gets a " +
      "free DLC expansion on PS5 and Xbox.",
  });
  assert.equal(r.breakdown.advertiser_safety, 5);
  assert.deepEqual(r.hard_stops, []);
});

test("Helldivers 2 story with terrorist-faction in-game reference", () => {
  const r = score({
    title: "Helldivers 2 adds new enemy faction in free update",
    body:
      "The Helldivers 2 update introduces a new terrorist-themed enemy " +
      "faction. The co-op multiplayer game is available on PS5 and Steam.",
  });
  assert.equal(r.breakdown.advertiser_safety, 5);
  assert.deepEqual(r.hard_stops, []);
});

// -------- Still blocked: real-world harm --------

test("Real-world mass shooting news — hard-stopped", () => {
  const r = score({
    title: "Breaking: mass shooting at US mall leaves 5 dead",
    body:
      "Police said the shooter opened fire at a shopping mall. Several " +
      "victims were taken to hospital. The suspect was arrested at the scene.",
    flair: "news",
    subreddit: "worldnews",
  });
  assert.equal(r.breakdown.advertiser_safety, 0);
  assert.ok(r.hard_stops.includes("advertiser_unfriendly_language"));
  assert.equal(r.decision, "reject");
});

test("Real-world 'school shooter' phrase — hard-stopped even with gaming words nearby", () => {
  const r = score({
    title: "Developer comments on school shooter controversy in game",
    body:
      "A studio has pulled a game trailer after critics called out its use " +
      "of school shooter imagery. The game's publisher issued an apology.",
  });
  assert.equal(r.breakdown.advertiser_safety, 0);
  assert.ok(r.hard_stops.includes("advertiser_unfriendly_language"));
});

test("'In real life' phrasing drags a shooter-game story to hard-stop", () => {
  const r = score({
    title:
      "Former Medal of Honor developer comments on gun violence in real life",
    body:
      "The developer said the shooter genre has responsibility to discuss " +
      "real-life gun violence. Victims' families have criticised the industry.",
  });
  assert.equal(r.breakdown.advertiser_safety, 0);
  assert.ok(r.hard_stops.includes("advertiser_unfriendly_language"));
});

test("Absolute unsafe term (suicide) — hard-stopped regardless of gaming context", () => {
  const r = score({
    title: "Game developer speaks about suicide prevention in new title",
    body:
      "The game tackles suicide prevention themes in a single-player " +
      "campaign on PS5 and Xbox.",
  });
  assert.equal(r.breakdown.advertiser_safety, 0);
  assert.ok(r.hard_stops.includes("advertiser_unfriendly_language"));
});

test("Absolute unsafe term (child abuse) — hard-stopped regardless of context", () => {
  const r = score({
    title: "Industry report on child abuse in gaming communities",
    body:
      "A new industry report details child abuse concerns across online " +
      "multiplayer games. Several studios have pledged to improve moderation.",
  });
  assert.equal(r.breakdown.advertiser_safety, 0);
  assert.ok(r.hard_stops.includes("advertiser_unfriendly_language"));
});

// -------- Partial credit: ambiguous term, no gaming OR harm context --------

test("Floating ambiguous term without gaming OR harm context -> partial credit, no hard-stop", () => {
  // Contrived: a very short, context-less snippet. advertiser_safety
  // should give partial credit (2/5) — enough to hurt the total but
  // not enough to trigger hard_stop.
  const r = score({
    title: "Kill streak observed",
    body: "Kill streak observed yesterday.",
    full_script: "Kill streak observed yesterday.",
    flair: "news",
    subreddit: "somewhere",
    source_type: "reddit",
    article_image: null,
    game_images: null,
  });
  assert.equal(r.breakdown.advertiser_safety, 2);
  assert.ok(!r.hard_stops.includes("advertiser_unfriendly_language"));
});

// -------- Existing behaviour preserved: source confidence still governs auto --------

test("Safe rumour-flair story still routes to review, not auto (source-confidence ceiling)", () => {
  // This is the crucial regression test: loosening advertiser_safety
  // for gaming contexts must not let a low-confidence rumour reach auto.
  const r = score({
    title: "Rumour: new Call of Duty game coming next year",
    body:
      "An unverified source claims a new Call of Duty first-person shooter " +
      "is in development. The studio has not confirmed anything. The game " +
      "would launch on PS5 and Xbox.",
    flair: "rumour",
    subreddit: "gamingleaksandrumours",
    source_type: "reddit",
    score: 50,
    num_comments: 10,
  });
  // advertiser_safety stays at 5 under the new rule (gaming context
  // rescues the "shooter" hit), but source_confidence is still capped
  // at 12 for rumour-flair so the total cannot reach 75.
  assert.equal(r.breakdown.advertiser_safety, 5);
  assert.notEqual(r.decision, "auto");
});
