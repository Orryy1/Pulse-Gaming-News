"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildFreshReviewLocalPromotionIntake,
  qualityFailuresForDraft,
  storyDraftFromReprocessedRow,
} = require("../../lib/fresh-review-local-promotion-intake");
const { parseArgs } = require("../../tools/fresh-review-local-promotion-intake");
const packageJson = require("../../package.json");

function sourceBackedReviewRow(overrides = {}) {
  return {
    id: "rss_black_ops_ports",
    story_id: "rss_black_ops_ports",
    title: "Call of Duty: Black Ops 1 and 2 Listings Have Fans Fearing Pricey PlayStation Ports",
    description:
      "IGN reports Call of Duty: Black Ops 1 and 2 store listings appeared for PlayStation, raising pricing questions for classic ports.",
    article_url:
      "https://www.ign.com/articles/call-of-duty-black-ops-1-and-2-listings-have-fans-fearing-pricey-playstation-ports",
    source_type: "rss",
    source_name: "IGN",
    source_published_at: "2026-06-21T22:00:00.000Z",
    created_at: "2026-06-21T22:05:00.000Z",
    scored_at: "2026-06-21T22:10:00.000Z",
    decision: "review",
    total: 76,
    decision_reason: "script_quality_score 0 below 7 total=76",
    inputs: "{}",
    hard_stops: "[]",
    ...overrides,
  };
}

test("fresh review local promotion intake converts a repaired row into source-backed draft copy", () => {
  const draft = storyDraftFromReprocessedRow({
    id: "rss_black_ops_ports",
    title: "Black Ops Classics Have A Price Trust Problem",
    suggested_title: "Black Ops Classics Have A Price Trust Problem",
    source_name: "IGN",
    article_url:
      "https://www.ign.com/articles/call-of-duty-black-ops-1-and-2-listings-have-fans-fearing-pricey-playstation-ports",
    source_type: "rss",
    source_published_at: "2026-06-21T22:00:00.000Z",
    full_script:
      "Black Ops just gave PlayStation players a nostalgia test with a price tag. IGN reports new listings for Black Ops 1 and 2 have fans watching for classic ports. Follow Pulse Gaming so you never miss a beat.",
    script_generation_status: "script_ready",
  });

  assert.equal(draft.id, "rss_black_ops_ports");
  assert.equal(draft.primary_source.name, "IGN");
  assert.equal(draft.primary_source.type, "rss");
  assert.match(draft.full_script, /Black Ops/);
  assert.match(draft.hook, /^Black Ops just gave/);
  assert.equal(draft.local_promotion_intake_only, true);
  assert.equal(draft.pinned_comment, "Source: IGN.");
});

test("fresh review local promotion intake builds local promotion stories without DB or publish side effects", async () => {
  const row = sourceBackedReviewRow();
  const report = await buildFreshReviewLocalPromotionIntake({
    rows: [row],
    plan: {
      summary: { selected_count: 1 },
      source_bound_rewrite_work_orders: [{ story_id: "rss_black_ops_ports" }],
    },
    now: new Date("2026-06-21T23:00:00.000Z"),
    reprocessCandidateImpl: async () => [
      {
        id: "rss_black_ops_ports",
        title: "Black Ops Classics Face A Price Test",
        suggested_title: "Black Ops Classics Face A Price Test",
        source_name: "IGN",
        article_url:
          "https://www.ign.com/articles/call-of-duty-black-ops-1-and-2-listings-have-fans-fearing-pricey-playstation-ports",
        source_type: "rss",
        source_published_at: "2026-06-21T22:00:00.000Z",
        source_confidence_score: 90,
        confirmed_claims: [
          "IGN reports PlayStation listings for Call of Duty: Black Ops 1 and 2 have fans watching pricing and port details.",
        ],
        full_script:
          "Black Ops 1 and 2 just turned nostalgia into a price test. IGN reports PlayStation listings for the two classic Call of Duty games, and that puts the pressure on price, features and whether these are proper preservation releases. The player question is simple: do these ports make old campaigns easy to revisit, or do they ask fans to pay premium money for convenience? Listings do not prove final pricing, release timing or multiplayer support, so the useful move is to wait for the official package detail. If Activision prices this cleanly, it gets an easy goodwill win. If not, the backlash writes itself before launch. Follow Pulse Gaming so you never miss a beat.",
        script_generation_status: "script_ready",
      },
    ],
  });

  assert.equal(report.mode, "FRESH_REVIEW_LOCAL_PROMOTION_INTAKE");
  assert.equal(report.summary.rows_seen, 1);
  assert.equal(report.summary.repair_plan_selected_count, 1);
  assert.equal(report.summary.local_promotion_story_count, 1);
  assert.equal(report.summary.production_db_mutation_required, false);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_oauth_or_token_change, true);
  assert.equal(report.fresh_source_intake_stories[0].id, "rss_black_ops_ports");
  assert.equal(report.fresh_source_intake_stories[0].primary_source.name, "IGN");
  assert.equal(report.fresh_source_intake_stories[0].canonical_subject, "Call of Duty: Black Ops");
  assert.equal(report.fresh_source_intake_stories[0].canonical_game, "Call of Duty: Black Ops");
  assert.match(report.fresh_source_intake_stories[0].selected_title, /Black Ops/i);
  assert.match(report.fresh_source_intake_stories[0].full_script, /price test|PlayStation listings|nostalgia/i);
  assert.doesNotMatch(report.fresh_source_intake_stories[0].full_script, /one concrete player question/i);
  assert.equal(report.repair_results[0].output_story_ready, true);
});

test("fresh review local promotion intake attaches known official GTA VI direct media", async () => {
  const report = await buildFreshReviewLocalPromotionIntake({
    rows: [
      sourceBackedReviewRow({
        id: "rss_gta_vi_launch",
        story_id: "rss_gta_vi_launch",
        title: "GTA 6 Features A Single-Player Experience At Launch",
        description:
          "GameSpot reports GTA 6 is being described around its launch single-player experience.",
        article_url:
          "https://www.gamespot.com/articles/gta-6-features-a-single-player-experience-at-least-at-launch/",
        source_name: "GameSpot",
        source_published_at: "2026-06-24T15:41:17.000Z",
      }),
    ],
    plan: {
      summary: { selected_count: 1 },
      source_bound_rewrite_work_orders: [{ story_id: "rss_gta_vi_launch" }],
    },
    now: new Date("2026-06-24T16:00:00.000Z"),
    reprocessCandidateImpl: async () => [
      {
        id: "rss_gta_vi_launch",
        title: "GTA VI Launch Details Turn Into A Trust Test",
        suggested_title: "GTA VI Launch Details Turn Into A Trust Test",
        canonical_subject: "Grand Theft Auto VI",
        source_name: "GameSpot",
        article_url:
          "https://www.gamespot.com/articles/gta-6-features-a-single-player-experience-at-least-at-launch/",
        source_type: "rss",
        source_published_at: "2026-06-24T15:41:17.000Z",
        source_confidence_score: 90,
        confirmed_claims: [
          "GameSpot reports GTA 6 is being described around its launch single-player experience.",
        ],
        full_script:
          "GTA VI just turned launch wording into a trust test. GameSpot reports the game is being described around its single-player experience at launch, and that matters because players still need clear answers on editions, online timing and what Rockstar is actually asking people to buy first. The useful question is not whether GTA VI is huge; it is whether the launch package is clear before pre-order pressure peaks. If Rockstar explains that cleanly, hype becomes confidence. If not, the biggest game in the world still gets a messy buying argument. Follow Pulse Gaming so you never miss a beat.",
        script_generation_status: "script_ready",
      },
    ],
  });

  const story = report.fresh_source_intake_stories[0];
  assert.equal(report.summary.local_promotion_story_count, 1);
  assert.equal(story.canonical_subject, "Grand Theft Auto VI");
  assert.equal(story.canonical_game, "Grand Theft Auto VI");
  assert.equal(story.direct_media_candidates.length, 4);
  assert.deepEqual(
    story.direct_media_candidates.map((entry) => entry.source_family),
    [
      "rockstar_gta_vi_cover_art_animation",
      "rockstar_gta_vi_trailer_2",
      "rockstar_gta_vi_trailer_1",
      "rockstar_gta_vi_site_motion_lucia_neon",
    ],
  );
  assert.equal(story.primary_source.name, "GameSpot");
});

test("fresh review local promotion intake canonicalises MARVEL Tokon trailer headlines", async () => {
  const report = await buildFreshReviewLocalPromotionIntake({
    rows: [
      sourceBackedReviewRow({
        id: "rss_marvel_tokon_roster",
        story_id: "rss_marvel_tokon_roster",
        title: "MARVEL Tōkon Fighting Souls – Blade, Loki, and Deadpool Gameplay Reveal Trailer | Team Samurai Outriders",
        description:
          "PlayStation Blog shows Blade, Loki and Deadpool gameplay for MARVEL Tōkon: Fighting Souls.",
        article_url:
          "https://blog.playstation.com/2026/06/29/blade-loki-deadpool-announced-for-marvel-tokon-fighting-souls/",
        source_name: "PlayStation Blog",
        source_published_at: "2026-06-29T01:38:56.000Z",
      }),
    ],
    plan: {
      summary: { selected_count: 1 },
      source_bound_rewrite_work_orders: [{ story_id: "rss_marvel_tokon_roster" }],
    },
    now: new Date("2026-06-29T02:00:00.000Z"),
    reprocessCandidateImpl: async () => [
      {
        id: "rss_marvel_tokon_roster",
        title: "MARVEL Tokon Just Started A Roster Fight",
        suggested_title: "MARVEL Tokon Just Started A Roster Fight",
        source_name: "PlayStation Blog",
        article_url:
          "https://blog.playstation.com/2026/06/29/blade-loki-deadpool-announced-for-marvel-tokon-fighting-souls/",
        source_type: "rss",
        source_published_at: "2026-06-29T01:38:56.000Z",
        source_confidence_score: 90,
        confirmed_claims: [
          "PlayStation Blog shows Blade, Loki and Deadpool gameplay for MARVEL Tōkon: Fighting Souls.",
        ],
        full_script:
          "MARVEL Tokon Fighting Souls just gave fighting-game fans three reasons to argue before launch. PlayStation Blog shows Blade, Loki and Deadpool in new gameplay for Arc System Works' 4v4 tag fighter, and the roster reveal is really a team-building test. Blade has to bring pressure. Loki has to bend reads. Deadpool has to create chaos without turning every match into visual noise. That matters on PlayStation 5 and PC because tag fighters rise or die on what the assists do after the trailer ends. If these clips show real combo paths, players will be testing team plans before release. If they only show expensive super moves, the hype becomes famous skins with health bars. Follow Pulse Gaming so you never miss a beat.",
        script_generation_status: "script_ready",
      },
    ],
  });

  const story = report.fresh_source_intake_stories[0];
  assert.equal(report.summary.local_promotion_story_count, 1);
  assert.equal(story.canonical_subject, "MARVEL Tokon: Fighting Souls");
  assert.equal(story.canonical_game, "MARVEL Tokon: Fighting Souls");
  assert.equal(report.repair_results[0].output_story_ready, true);
});

test("fresh review local promotion intake repairs malformed MARVEL Tokon trailer copy", () => {
  const draft = storyDraftFromReprocessedRow({
    id: "rss_marvel_tokon_bad_copy",
    title: "MARVEL Tōkon Fighting Souls , Blade, Loki, and Deadpool Gam",
    suggested_title: "MARVEL Tōkon Fighting Souls , Blade, Loki, and Deadpool Gam",
    source_name: "GameSpot",
    article_url:
      "https://www.gamespot.com/videos/marvel-tokon-fighting-souls-blade-loki-and-deadpool-gameplay-reveal-trailer-team-samurai-outriders/",
    source_type: "rss",
    source_published_at: "2026-06-29T03:30:54.000Z",
    confirmed_claims: [
      "GameSpot reports MARVEL Tōkon Fighting Souls – Blade, Loki, and Deadpool Gameplay Reveal Trailer.",
    ],
    full_script:
      "MARVEL Tōkon Fighting Souls , Blade, Loki, and Deadpool Gameplay just showed the part trailers usually hide: how it plays. GameSpot reports the new MARVEL Tōkon Fighting Souls , Blade, Loki, and Deadpool Gameplay trailer shows real gameplay, not just another logo beat. Follow Pulse Gaming so you never miss a beat.",
    script_generation_status: "script_ready",
  });

  assert.equal(draft.selected_title, "MARVEL Tokon Just Started A Roster Fight");
  assert.equal(draft.canonical_subject, "MARVEL Tokon: Fighting Souls");
  assert.match(draft.full_script, /^MARVEL Tokon Fighting Souls just gave fighting-game fans three reasons to argue before launch\./);
  assert.match(draft.full_script, /Arc System Works' 4v4 tag fighter/i);
  assert.match(draft.full_script, /PlayStation 5 and PC/i);
  assert.ok(draft.full_script.split(/\s+/).length >= 140);
  assert.match(draft.full_script, /Watch the assists, not just the faces/i);
  assert.match(draft.full_script, /whole game look deeper/i);
  assert.match(draft.description, /famous skins/i);
  assert.doesNotMatch(draft.full_script, /Fighting Souls\s*,\s*Blade/i);
  assert.doesNotMatch(draft.full_script, /labbing/i);
  assert.doesNotMatch(draft.full_script, /trailers usually hide: how it plays/i);
  assert.doesNotMatch(draft.full_script, /the debate is simple|the useful part/i);
  assert.deepEqual(qualityFailuresForDraft(draft), []);
});

test("fresh review local promotion intake does not promote GTA context as the canonical game", async () => {
  const report = await buildFreshReviewLocalPromotionIntake({
    rows: [
      sourceBackedReviewRow({
        id: "rss_lords_delay",
        story_id: "rss_lords_delay",
        title: "Lords Of The Fallen 2 Delayed To Avoid GTA 6 And Get More Enhancements",
        description:
          "GameSpot reports Lords of the Fallen 2 was delayed to avoid GTA 6 and get more enhancement time.",
        article_url:
          "https://www.gamespot.com/articles/lords-of-the-fallen-2-delayed-to-avoid-gta-6-and-get-more-enhancements/",
        source_name: "GameSpot",
        source_published_at: "2026-06-23T20:05:34.000Z",
      }),
    ],
    plan: {
      summary: { selected_count: 1 },
      source_bound_rewrite_work_orders: [{ story_id: "rss_lords_delay" }],
    },
    now: new Date("2026-06-23T21:00:00.000Z"),
    reprocessCandidateImpl: async () => [
      {
        id: "rss_lords_delay",
        title: "Lords Of The Fallen 2 Dodges GTA 6",
        suggested_title: "Lords Of The Fallen 2 Dodges GTA 6",
        suggested_thumbnail_text: "GTA 6 TRAFFIC",
        source_name: "GameSpot",
        article_url:
          "https://www.gamespot.com/articles/lords-of-the-fallen-2-delayed-to-avoid-gta-6-and-get-more-enhancements/",
        source_type: "rss",
        source_published_at: "2026-06-23T20:05:34.000Z",
        source_confidence_score: 90,
        confirmed_claims: [
          "GameSpot reports Lords of the Fallen 2 was delayed to avoid GTA 6 and get more enhancement time.",
        ],
        full_script:
          "Lords of the Fallen 2 just blinked first in the GTA 6 traffic jam. GameSpot reports the sequel was delayed to avoid GTA 6 and give the team more enhancement time before launch. That matters because avoiding Rockstar is not ordinary scheduling; it tells players this calendar is dangerous enough to reshape a game's rollout before marketing even starts. If the enhancements are real, this looks disciplined. If not, players will remember it as a retreat. Follow Pulse Gaming so you never miss a beat.",
        script_generation_status: "script_ready",
      },
    ],
  });

  const story = report.fresh_source_intake_stories[0];
  assert.equal(report.summary.local_promotion_story_count, 1);
  assert.equal(story.canonical_subject, "Lords of the Fallen 2");
  assert.equal(story.canonical_game, "Lords of the Fallen 2");
  assert.equal(story.direct_media_candidates, undefined);
  assert.match(story.suggested_thumbnail_text, /LORDS/i);
  assert.doesNotMatch(story.suggested_thumbnail_text, /^GTA\b/i);
});

test("fresh review local promotion intake rejects generic source-bound scaffolds", async () => {
  const report = await buildFreshReviewLocalPromotionIntake({
    rows: [
      sourceBackedReviewRow({
        story_id: "rss_generic",
        id: "rss_generic",
        title: "Unknown Game Has A Small Update",
        description: "",
        article_url: "https://www.ign.com/articles/unknown-game-small-update",
      }),
    ],
    plan: {
      summary: { selected_count: 1 },
      source_bound_rewrite_work_orders: [{ story_id: "rss_generic" }],
    },
    now: new Date("2026-06-21T23:00:00.000Z"),
  });

  assert.equal(report.summary.local_promotion_story_count, 0);
  assert.equal(report.repair_results[0].output_story_ready, false);
  assert.ok(report.repair_results[0].quality_failures.includes("local_intake:generic_player_question_script"));
});

test("fresh review local promotion intake rejects source-angle drift from GTA trailer timing into preorder claims", async () => {
  const report = await buildFreshReviewLocalPromotionIntake({
    rows: [
      sourceBackedReviewRow({
        id: "rss_gta_trailer_timing",
        story_id: "rss_gta_trailer_timing",
        title: "If Rockstar Follows Its Own Precedent, Don't Expect GTA 6 Trailer 3 This Week",
        description:
          "GameSpot reports Rockstar's previous trailer cadence suggests GTA 6 Trailer 3 is not likely this week.",
        article_url:
          "https://www.gamespot.com/articles/if-rockstar-follows-its-own-precedent-dont-expect-gta-6-trailer-3-this-week/",
        source_name: "GameSpot",
        source_published_at: "2026-06-24T11:06:12.000Z",
      }),
    ],
    plan: {
      summary: { selected_count: 1 },
      source_bound_rewrite_work_orders: [{ story_id: "rss_gta_trailer_timing" }],
    },
    now: new Date("2026-06-24T12:00:00.000Z"),
    reprocessCandidateImpl: async () => [
      {
        id: "rss_gta_trailer_timing",
        title: "GTA 6's Preorder Decision",
        suggested_title: "GTA 6's Preorder Decision",
        source_name: "GameSpot",
        article_url:
          "https://www.gamespot.com/articles/if-rockstar-follows-its-own-precedent-dont-expect-gta-6-trailer-3-this-week/",
        source_type: "rss",
        source_published_at: "2026-06-24T11:06:12.000Z",
        source_confidence_score: 90,
        full_script:
          "GTA 6 just turned cover art into a preorder pressure test. Rockstar revealed new key art while preorders still have no confirmed start date, and that matters because store pages usually tell players price, editions and platform detail before the hype cycle gets louder. Follow Pulse Gaming so you never miss a beat.",
        script_generation_status: "script_ready",
      },
    ],
  });

  assert.equal(report.summary.local_promotion_story_count, 0);
  assert.equal(report.repair_results[0].output_story_ready, false);
  assert.ok(
    report.repair_results[0].quality_failures.includes(
      "local_intake:source_script_mismatch_gta_preorder_vs_trailer_timing",
    ),
  );
});

test("fresh review local promotion intake rejects GTA context-only source drift into GTA lead story", async () => {
  const report = await buildFreshReviewLocalPromotionIntake({
    rows: [
      sourceBackedReviewRow({
        id: "rss_gta_shadow_context",
        story_id: "rss_gta_shadow_context",
        title: "I Have Nothing But Respect For This Game That Doesn't Care About Launching In GTA 6's Shadow",
        description:
          "GameSpot reports a different game is choosing not to dodge the GTA 6 launch window.",
        article_url:
          "https://www.gamespot.com/articles/i-have-nothing-but-respect-for-this-game-that-doesnt-care-about-launching-in-gta-6s-shadow/",
        source_name: "GameSpot",
        source_published_at: "2026-06-25T17:00:46.000Z",
      }),
    ],
    plan: {
      summary: { selected_count: 1 },
      source_bound_rewrite_work_orders: [{ story_id: "rss_gta_shadow_context" }],
    },
    now: new Date("2026-06-25T18:00:00.000Z"),
    reprocessCandidateImpl: async () => [
      {
        id: "rss_gta_shadow_context",
        title: "GTA 6's Date Trust Check",
        suggested_title: "GTA VI Cover Art Starts The Pre-Order Fight",
        source_name: "GameSpot",
        article_url:
          "https://www.gamespot.com/articles/i-have-nothing-but-respect-for-this-game-that-doesnt-care-about-launching-in-gta-6s-shadow/",
        source_type: "rss",
        source_published_at: "2026-06-25T17:00:46.000Z",
        source_confidence_score: 90,
        confirmed_claims: [
          "GameSpot reports I Have Nothing But Respect For This Game That Doesn't Care About Launching In GTA 6's Shadow.",
        ],
        full_script:
          "GTA 6's release date just became a trust check, not a new reveal. GameSpot reports GTA 6's release timing has been reiterated without new footage, price or edition detail. The pressure now shifts back to proof: gameplay, platform wording, editions and whether Rockstar's next official beat makes the schedule feel solid. Follow Pulse Gaming so you never miss a beat.",
        script_generation_status: "script_ready",
      },
    ],
  });

  assert.equal(report.summary.local_promotion_story_count, 0);
  assert.equal(report.repair_results[0].output_story_ready, false);
  assert.ok(
    report.repair_results[0].quality_failures.includes(
      "local_intake:source_script_mismatch_gta_context_only",
    ),
  );
});

test("fresh review local promotion intake rejects reusable follow-up scaffold language", () => {
  const failures = qualityFailuresForDraft({
    selected_title: "Cyberpunk 2077's Trust Debt",
    canonical_subject: "Cyberpunk 2077",
    full_script:
      "CD Projekt Red is still paying for Cyberpunk 2077's launch. The next thing to watch is whether the official follow-up gives players a clear date, platform detail or gameplay proof. That is where a small update either becomes a real player decision or stays as background context. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.ok(failures.includes("local_intake:generic_follow_up_scaffold_script"));
});

test("fresh review local promotion intake rejects internal value scaffold language", () => {
  const failures = qualityFailuresForDraft({
    selected_title: "Black Ops Classics Face A Price Test",
    canonical_subject: "Call of Duty: Black Ops",
    confirmed_claims: [
      "IGN reports PlayStation listings for Black Ops 1 and 2 have fans watching pricing and port details.",
    ],
    full_script:
      "Black Ops 1 and 2 just turned nostalgia into a price test. For viewers, the immediate value is knowing whether this affects a download, a setting, a wishlist or a purchase. The story does not need fake drama; it needs the player consequence to land clearly. If later footage, pricing or timing changes the picture, that becomes a new story. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.ok(failures.includes("local_intake:generic_value_scaffold_script"));
});

test("fresh review local promotion intake rejects horror-angle contamination on non-horror stories", () => {
  const failures = qualityFailuresForDraft({
    selected_title: "GTA 6 Gets A Date",
    canonical_subject: "GTA 6",
    confirmed_claims: [
      "GameSpot reports GTA 6 release date was confirmed again by Take-Two's CEO.",
    ],
    full_script:
      "GTA 6 finally has a date, and now tone has to do the hard work. That matters because a date turns a horror reveal from atmosphere into a real buy, wait or skip decision. A date does not prove quality by itself, especially for a licensed horror game that has to make the name feel playable. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.ok(failures.includes("local_intake:semantic_contamination_horror_angle"));
});

test("fresh review local promotion intake CLI is registered", () => {
  assert.equal(
    packageJson.scripts["ops:fresh-review-local-promotion-intake"],
    "node tools/fresh-review-local-promotion-intake.js",
  );
  const args = parseArgs(["--json", "--limit", "8", "--out-dir", "output/example"]);
  assert.equal(args.json, true);
  assert.equal(args.limit, 8);
  assert.match(args.outDir, /output[\\/]example$/);
});
