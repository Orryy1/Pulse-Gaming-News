"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Database = require("better-sqlite3");

const {
  buildFreshReviewScriptRepairPlan,
  fetchFreshApprovedProductionRows,
  selectFreshApprovedProductionRows,
  selectFreshReviewScriptRepairRows,
} = require("../../lib/ops/fresh-review-script-repair");
const { commandSafety } = require("../../lib/ops/auto-repair-runner");

const NOW = "2026-06-17T09:00:00.000Z";

function row(overrides = {}) {
  return {
    story_id: "rss_gears",
    title: "Gears of War E-Day PC Specs Revealed",
    url: "https://www.pcgamer.com/games/action/gears-of-war-e-day-pc-specs",
    article_url: "https://www.pcgamer.com/games/action/gears-of-war-e-day-pc-specs",
    source_type: "rss",
    timestamp: "2026-06-16T12:00:00.000Z",
    created_at: "2026-06-16T12:00:00.000Z",
    scored_at: "2026-06-16 12:10:00",
    decision: "review",
    total: 74,
    decision_reason: "script_quality_score 0 below 7",
    inputs: JSON.stringify({ script_review_auto_block: "Hook starts with banned word: so" }),
    hard_stops: "[]",
    published_platform_post_count: 0,
    ...overrides,
  };
}

test("fresh review script repair selects current source-backed script-quality blockers", () => {
  const selected = selectFreshReviewScriptRepairRows([
    row(),
    row({
      story_id: "rss_word_count",
      title: "Switch 2 Firmware Update Needs A Better Short",
      decision_reason: "Actual spoken word count 149 outside 204-250",
      total: 71,
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), [
    "rss_gears",
    "rss_word_count",
  ]);

  const plan = buildFreshReviewScriptRepairPlan({ rows: selected, now: NOW });
  assert.equal(plan.summary.selected_count, 2);
  assert.equal(plan.source_bound_rewrite_work_orders.length, 2);
  assert.equal(plan.source_bound_rewrite_work_orders[0].repair_lane, "source_bound_script_rewrite");
  assert.equal(plan.source_bound_rewrite_work_orders[0].db_mutation_required, false);
  assert.match(
    plan.source_bound_rewrite_work_orders[0].recommended_command,
    /^npm run ops:reprocess-script-failures -- --story-id rss_gears --force-story --source-bound-only --dry-run --json$/,
  );
  assert.equal(
    commandSafety(plan.source_bound_rewrite_work_orders[0].recommended_command).safe,
    true,
  );
});

test("fresh review script repair excludes off-topic entertainment feed noise", () => {
  const selected = selectFreshReviewScriptRepairRows([
    row({ story_id: "fresh_gaming" }),
    row({
      story_id: "movie_noise",
      title: "Jim Carrey Returning For Grinch Sequel 25 Years After The Original",
      url: "https://kotaku.com/jim-carrey-returning-for-grinch-sequel-25-years-after-the-original-2000708170",
      article_url: "https://kotaku.com/jim-carrey-returning-for-grinch-sequel-25-years-after-the-original-2000708170",
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), ["fresh_gaming"]);
});

test("fresh review script repair excludes commerce deals roundups from editorial refill", () => {
  const selected = selectFreshReviewScriptRepairRows([
    row({ story_id: "fresh_good" }),
    row({
      story_id: "deals_roundup",
      title: "The Best Deals Today: AirPods Pro 3, Tears of the Kingdom Switch 2 Edition, Nioh 3, and More",
      url: "https://www.ign.com/articles/best-deals-for-june-21-2026",
      article_url: "https://www.ign.com/articles/best-deals-for-june-21-2026",
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), ["fresh_good"]);
});

test("fresh review script repair excludes Prime Day shopping deal rows", () => {
  const selected = selectFreshReviewScriptRepairRows([
    row({ story_id: "fresh_good" }),
    row({
      story_id: "prime_day_bundle",
      title: "The Only Pokemon Pokopia Deal During Prime Day Is a Nintendo Switch 2 Bundle",
      url: "https://www.ign.com/articles/pokemon-pokopia-switch-2-bundle-prime-day",
      article_url: "https://www.ign.com/articles/pokemon-pokopia-switch-2-bundle-prime-day",
    }),
    row({
      story_id: "console_shopping_price",
      title: "The Nintendo Switch 2 Gaming Console Is Going for as Low as $399 for Prime Day",
      url: "https://www.ign.com/articles/nintendo-switch-2-console-prime-day",
      article_url: "https://www.ign.com/articles/nintendo-switch-2-console-prime-day",
    }),
    row({
      story_id: "woot_console_sale",
      title: "Woot Is Selling the Nintendo Switch 2 From $399 Ahead of Scheduled September Price Hike",
      url: "https://www.ign.com/articles/woot-nintendo-switch-2-from-399",
      article_url: "https://www.ign.com/articles/woot-nintendo-switch-2-from-399",
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), ["fresh_good"]);
});

test("fresh review script repair excludes motion-poor retail and platform-service rows", () => {
  const selected = selectFreshReviewScriptRepairRows([
    row({ story_id: "fresh_good" }),
    row({
      story_id: "xbox_price_rise",
      title: "Microsoft Announces Significant Price Rises for Xbox Series X and S, 2TB Model Discontinued",
      url: "https://www.ign.com/articles/microsoft-announces-significant-price-rises-for-xbox-series-x-and-s",
      article_url: "https://www.ign.com/articles/microsoft-announces-significant-price-rises-for-xbox-series-x-and-s",
      total: 77,
    }),
    row({
      story_id: "gta_physical_release",
      title: "GTA 6 has no plans for a post-launch physical release, not at launch and not months later, insists new report",
      url: "https://www.gamesradar.com/games/grand-theft-auto/gta-6-has-no-plans-for-a-post-launch-physical-release/",
      article_url: "https://www.gamesradar.com/games/grand-theft-auto/gta-6-has-no-plans-for-a-post-launch-physical-release/",
      total: 76,
    }),
    row({
      story_id: "metroid_lowest_price",
      title: "Metroid Prime 4 Hits Its Lowest Price Ever for Switch 2, But Use This Simple Trick to Save Even More",
      url: "https://www.ign.com/articles/metroid-prime-4-lowest-price-switch-2",
      article_url: "https://www.ign.com/articles/metroid-prime-4-lowest-price-switch-2",
      total: 75,
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), ["fresh_good"]);
});

test("fresh review script repair keeps footage-backed rows even when their subject looks motion-poor", () => {
  const selected = selectFreshReviewScriptRepairRows([
    row({
      story_id: "switch_memory_card_with_clip",
      title: "Switch 2 MicroSD Cards Just Got A Storage Warning",
      url: "https://www.ign.com/articles/best-microsd-express-cards-for-switch-2",
      article_url: "https://www.ign.com/articles/best-microsd-express-cards-for-switch-2",
      video_clips: JSON.stringify([
        {
          path: "C:\\pulse\\output\\video_cache\\switch_2_storage_clip.mp4",
          source_type: "youtube_official_trailer",
        },
      ]),
      total: 76,
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), ["switch_memory_card_with_clip"]);
});

test("fresh review script repair excludes stale, non-script, published and reddit-only rows", () => {
  const selected = selectFreshReviewScriptRepairRows([
    row({ story_id: "fresh_good" }),
    row({
      story_id: "stale",
      timestamp: "2026-06-01T12:00:00.000Z",
      created_at: "2026-06-01T12:00:00.000Z",
    }),
    row({
      story_id: "strategy_review",
      decision_reason: "source confidence below auto threshold",
      inputs: JSON.stringify({ topicality_decision: "review" }),
    }),
    row({
      story_id: "published",
      youtube_post_id: "abc123",
      published_platform_post_count: 1,
    }),
    row({
      story_id: "reddit_only",
      source_type: "reddit",
      url: "https://www.reddit.com/r/gaming/comments/abc/example",
      article_url: "",
    }),
    row({
      story_id: "auto_story",
      decision: "auto",
      decision_reason: "",
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), ["fresh_good"]);
});

test("fresh approved production recovery only selects current unproduced rows and repairable audio failures", () => {
  const selected = selectFreshApprovedProductionRows([
    row({
      story_id: "fresh_approved",
      decision: "auto",
      decision_reason: "verified source score met automatic approval threshold",
      approved: 1,
      total: 82,
      publish_status: null,
      publish_error: null,
    }),
    row({
      story_id: "off_topic_hallucinated_gameplay",
      title:
        "Avengers: Doomsday Off to Huge Start in Advance Ticket Sales, Second-Biggest Trailer Launch Ever Behind Only Spider-Man: Brand New Day",
      top_comment:
        "Avengers: Doomsday released its first proper trailer yesterday alongside the start of advance ticket sales, and both were a huge success.",
      body:
        "The trailer shows real gameplay and lets players judge movement, combat and camera weight.",
      full_script:
        "Avengers just showed the part game trailers usually hide: how it plays.",
      decision: "auto",
      approved: 1,
      total: 95,
    }),
    row({
      story_id: "tts_timeout",
      decision: "auto",
      decision_reason: "verified source score met automatic approval threshold",
      approved: 1,
      total: 80,
      publish_status: "failed",
      publish_error: "audio_generation_failed: timeout: local TTS queue wait exceeded",
    }),
    row({
      story_id: "audio_duration_too_long",
      decision: "auto",
      decision_reason: "verified source score met automatic approval threshold",
      approved: 1,
      total: 79,
      publish_status: "failed",
      publish_error: "qa_blocked: audio_duration_too_long (89.60s, max 89.00s)",
    }),
    row({
      story_id: "stale_approved",
      decision: "auto",
      approved: 1,
      total: 90,
      timestamp: "2026-05-01T12:00:00.000Z",
      created_at: "2026-05-01T12:00:00.000Z",
    }),
    row({
      story_id: "older_than_approved_runway",
      decision: "auto",
      approved: 1,
      total: 84,
      timestamp: "2026-06-15T12:00:00.000Z",
      created_at: "2026-06-15T12:00:00.000Z",
    }),
    row({
      story_id: "already_exported",
      decision: "auto",
      approved: 1,
      total: 89,
      exported_path: "output/final/already_exported.mp4",
    }),
    row({
      story_id: "already_published",
      decision: "auto",
      approved: 1,
      total: 88,
      published_platform_post_count: 1,
      youtube_post_id: "yt-123",
    }),
    row({
      story_id: "non_tts_failure",
      decision: "auto",
      approved: 1,
      total: 87,
      publish_status: "failed",
      publish_error: "video_assembly_failed: rights ledger incomplete",
    }),
    row({
      story_id: "hard_stop",
      decision: "auto",
      approved: 1,
      total: 86,
      hard_stops: JSON.stringify(["source_confidence_below_floor"]),
    }),
    row({
      story_id: "not_approved",
      decision: "auto",
      approved: 0,
      total: 85,
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), [
    "fresh_approved",
    "tts_timeout",
    "audio_duration_too_long",
  ]);
});

test("fresh approved production recovery fetches only recent approved rows without export or post evidence", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE stories (
        id TEXT PRIMARY KEY,
        title TEXT,
        url TEXT,
        article_url TEXT,
        source_type TEXT,
        timestamp TEXT,
        created_at TEXT,
        approved INTEGER,
        auto_approved INTEGER,
        exported_path TEXT,
        youtube_post_id TEXT,
        youtube_url TEXT,
        tiktok_post_id TEXT,
        instagram_media_id TEXT,
        facebook_post_id TEXT,
        twitter_post_id TEXT,
        published_at TEXT,
        publish_status TEXT,
        publish_error TEXT
      );
      CREATE TABLE story_scores (
        story_id TEXT,
        total REAL,
        decision TEXT,
        decision_reason TEXT,
        inputs TEXT,
        hard_stops TEXT,
        scored_at TEXT
      );
      CREATE TABLE platform_posts (
        story_id TEXT,
        status TEXT,
        external_id TEXT
      );
    `);
    const insertStory = db.prepare(`
      INSERT INTO stories (
        id, title, url, article_url, source_type, timestamp, created_at,
        approved, auto_approved, exported_path
      ) VALUES (?, ?, ?, ?, 'rss', ?, ?, ?, 1, ?)
    `);
    const insertScore = db.prepare(`
      INSERT INTO story_scores (
        story_id, total, decision, decision_reason, inputs, hard_stops, scored_at
      ) VALUES (?, ?, 'auto', 'verified source score met automatic approval threshold', '{}', '[]', ?)
    `);
    for (const candidate of [
      { id: "fresh_approved", approved: 1, exportedPath: null },
      { id: "already_exported", approved: 1, exportedPath: "output/final/already_exported.mp4" },
      { id: "already_published", approved: 1, exportedPath: null },
      { id: "not_approved", approved: 0, exportedPath: null },
    ]) {
      const url = `https://www.ign.com/articles/${candidate.id}`;
      insertStory.run(
        candidate.id,
        "Gears of War E-Day Gameplay Reveals A New Combat Detail",
        url,
        url,
        "2026-06-16T12:00:00.000Z",
        "2026-06-16T12:05:00.000Z",
        candidate.approved,
        candidate.exportedPath,
      );
      insertScore.run(candidate.id, 82, "2026-06-16T12:10:00.000Z");
    }
    db.prepare(
      "INSERT INTO platform_posts (story_id, status, external_id) VALUES (?, 'published', ?)",
    ).run("already_published", "yt-123");

    const fetched = fetchFreshApprovedProductionRows({
      db,
      now: new Date(NOW),
      maxAgeHours: 7 * 24,
      limit: 10,
    });

    assert.deepEqual(fetched.map((item) => item.id), ["fresh_approved"]);
    assert.equal(fetched[0].published_platform_post_count, 0);
  } finally {
    db.close();
  }
});

test("fresh review script repair turns current bridge transcript backlog into bridge rewrite work orders", () => {
  const plan = buildFreshReviewScriptRepairPlan({
    rows: [],
    now: NOW,
    candidateReport: {
      candidates: [
        {
          id: "fresh_gears_eday_pc_specs_20260616",
          title: "Gears Of War E-Day PC Specs Are A Storage Warning",
          status: "publish_ready",
          score: 92,
          source: {
            exported_path: "C:\\pulse\\output\\fresh\\fresh_gears_eday_pc_specs_20260616\\visual_v4_render.mp4",
          },
          source_manifest: {
            primary_source: {
              name: "PC Gamer",
              url: "https://www.pcgamer.com/gears-e-day-pc-specs",
              published_at: "2026-06-16T09:00:00.000Z",
            },
          },
        },
      ],
    },
    transcriptAudienceReport: {
      generated_at: NOW,
      summary: { total: 1, pass: 0, rewrite_required: 1 },
      stories: [
        {
          story_id: "fresh_gears_eday_pc_specs_20260616",
          title: "Gears Of War E-Day PC Specs Are A Storage Warning",
          verdict: "rewrite_required",
          blockers: ["mass_audience:abstract_payoff", "mass_audience:unclear_referents"],
          viral_score: 55,
        },
      ],
    },
  });

  assert.equal(plan.summary.selected_count, 1);
  assert.equal(plan.summary.transcript_backlog_selected_count, 1);
  assert.equal(plan.source_bound_rewrite_work_orders[0].blocker_type, "transcript_audience_rewrite_required");
  assert.equal(plan.source_bound_rewrite_work_orders[0].repair_lane, "bridge_transcript_artifact_rewrite_required");
  assert.equal(plan.source_bound_rewrite_work_orders[0].auto_repairable, false);
  assert.equal(
    plan.source_bound_rewrite_work_orders[0].artifact_dir,
    "C:\\pulse\\output\\fresh\\fresh_gears_eday_pc_specs_20260616",
  );
  assert.match(
    plan.source_bound_rewrite_work_orders[0].recommended_command,
    /^npm run ops:transcript-audience-audit -- --artifact-dir "C:\\pulse\\output\\fresh\\fresh_gears_eday_pc_specs_20260616" --json$/,
  );
});

test("fresh review script repair prioritises current candidate transcript rewrites before DB backlog", () => {
  const plan = buildFreshReviewScriptRepairPlan({
    rows: [row({ story_id: "db_backlog", title: "Gears of War E-Day PC Specs Revealed", total: 80 })],
    now: NOW,
    candidateReport: {
      candidates: [
        {
          id: "current_publish_candidate",
          title: "Doom The Dark Ages PS5 Pro Upgrade Risks Blur",
          status: "publish_ready",
          score: 92,
          source: {
            exported_path: "C:\\pulse\\output\\fresh\\current_publish_candidate\\visual_v4_render.mp4",
          },
          source_manifest: {
            primary_source: {
              url: "https://blog.playstation.com/2026/06/16/doom-the-dark-ages-ps5-pro-upgrade",
            },
          },
        },
      ],
    },
    transcriptAudienceReport: {
      generated_at: NOW,
      summary: { total: 1, pass: 0, rewrite_required: 1 },
      stories: [
        {
          story_id: "current_publish_candidate",
          title: "Doom The Dark Ages PS5 Pro Upgrade Risks Blur",
          verdict: "rewrite_required",
          blockers: ["generic_could_split_title_template", "mass_audience:low_concrete_detail"],
          viral_score: 55,
        },
      ],
    },
  });

  assert.equal(plan.summary.selected_count, 2);
  assert.equal(plan.source_bound_rewrite_work_orders[0].story_id, "current_publish_candidate");
  assert.equal(plan.source_bound_rewrite_work_orders[0].blocker_type, "transcript_audience_rewrite_required");
  assert.equal(plan.source_bound_rewrite_work_orders[0].repair_lane, "bridge_transcript_artifact_rewrite_required");
  assert.equal(plan.source_bound_rewrite_work_orders[0].auto_repairable, false);
  assert.equal(plan.source_bound_rewrite_work_orders[1].story_id, "db_backlog");
  assert.equal(plan.source_bound_rewrite_work_orders[1].auto_repairable, true);
});
