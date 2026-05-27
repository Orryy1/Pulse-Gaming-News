"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const packageJson = require("../../package.json");

const {
  buildRetentionIntelligence,
  normalizeRetentionRows,
  renderRetentionIntelligenceMarkdown,
} = require("../../lib/intelligence/retention-intelligence");
const { parseArgs } = require("../../tools/retention-intelligence");

test("retention intelligence normalises YouTube retention percentages", () => {
  const rows = normalizeRetentionRows([
    {
      video_id: "yt1",
      elapsed_video_time_ratio: 5,
      audience_watch_ratio: 82,
      relative_retention_performance: 112,
    },
    {
      video_id: "yt1",
      elapsed_video_time_ratio: 0.1,
      audience_watch_ratio: 0.66,
      relative_retention_performance: 0.91,
    },
  ]);

  assert.deepEqual(rows[0], {
    video_id: "yt1",
    elapsed_video_time_ratio: 0.05,
    audience_watch_ratio: 0.82,
    relative_retention_performance: 1.12,
  });
  assert.equal(rows[1].audience_watch_ratio, 0.66);
});

test("retention intelligence scores hook, pacing drops and repeated clip windows", () => {
  const intelligence = buildRetentionIntelligence({
    story: {
      id: "forza-steam",
      title:
        "Forza Horizon 6 hits 130,000 concurrent players on Steam during early access",
      full_script:
        "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam during early access.",
    },
    durationS: 60,
    retentionRows: [
      { elapsed_video_time_ratio: 0, audience_watch_ratio: 1 },
      { elapsed_video_time_ratio: 0.05, audience_watch_ratio: 0.82 },
      { elapsed_video_time_ratio: 0.1, audience_watch_ratio: 0.66 },
      { elapsed_video_time_ratio: 0.2, audience_watch_ratio: 0.61 },
      { elapsed_video_time_ratio: 0.35, audience_watch_ratio: 0.43 },
    ],
    trafficRows: [
      {
        traffic_source_type: "SHORTS",
        views: 2400,
        average_percentage_viewed: 58,
      },
    ],
    sceneTimeline: {
      scenes: [
        {
          type: "opener",
          startS: 0,
          durationS: 3.8,
          source: "forza-trailer.m3u8",
          mediaStartS: 28.5,
          label: "opener_clip",
        },
        {
          type: "clip",
          startS: 3.8,
          durationS: 4,
          source: "forza-trailer.m3u8",
          mediaStartS: 28.5,
          label: "repeated_window",
        },
        {
          type: "card.stat",
          startS: 7.8,
          durationS: 4,
          label: "steam_stat",
        },
        {
          type: "clip.frame",
          startS: 11.8,
          durationS: 4,
          source: "forza-frame-1.jpg",
        },
      ],
    },
  });

  assert.equal(intelligence.verdict, "needs_render_adjustment");
  assert.ok(intelligence.hook.score < 75);
  assert.ok(intelligence.visual_pacing.score < 80);
  assert.equal(intelligence.visual_pacing.repeated_clip_windows[0].count, 2);
  assert.ok(
    intelligence.recommendations.some(
      (item) => item.id === "replace_repeated_clip_windows",
    ),
  );
  assert.ok(
    intelligence.recommendations.some(
      (item) => item.id === "tighten_first_three_seconds",
    ),
  );
  assert.equal(intelligence.visual_v3_adjustments.max_clip_window_repeats, 1);
  assert.ok(
    intelligence.visual_v3_adjustments.timeline_events.some(
      (event) => event.kind === "retention_pattern_interrupt",
    ),
  );
  assert.ok(
    intelligence.visual_v3_adjustments.prompt_directives.some((line) =>
      /avoid repeating/i.test(line),
    ),
  );
  assert.equal(intelligence.safety.production_db_mutated, false);
  assert.equal(intelligence.safety.social_posting_triggered, false);
});

test("retention intelligence turns weak channel baseline stats into next-render pressure rules", () => {
  const intelligence = buildRetentionIntelligence({
    story: {
      id: "baseline-forza",
      title: "This gaming story",
      suggested_thumbnail_text:
        "FORZA HORIZON SIX HAS A MASSIVE STEAM NUMBER TO EXPLAIN",
      full_script:
        "Forza Horizon 6 hit 130,000 concurrent players on Steam during early access.",
    },
    durationS: 60,
    channelBaseline: {
      views_28d: 19300,
      watch_hours_28d: 58,
      avg_watch_seconds_estimate: 10.8,
      stayed_to_watch: 39.3,
      swiped_away: 60.7,
      subscriber_conversion_estimate: 0.041,
      top_short_ceiling_current: 900,
      mobile_share: 71.4,
      audience_core: "male, 25-44, UK/US, mobile",
    },
    retentionRows: [],
    trafficRows: [],
    sceneTimeline: {
      scenes: [{ type: "card.stat", startS: 0, durationS: 6.5 }],
    },
  });

  assert.equal(intelligence.channel_pressure.status, "retention_baseline_under_target");
  assert.deepEqual(intelligence.channel_pressure.target_duration_s, {
    min: 25,
    max: 40,
    reason: "avg_watch_seconds_below_15_and_stayed_to_watch_below_45",
  });
  assert.ok(
    intelligence.channel_pressure.recommendations.some(
      (item) => item.id === "named_entity_title_consequence_tension",
    ),
  );
  assert.ok(
    intelligence.channel_pressure.recommendations.some(
      (item) => item.id === "first_frame_text_under_5_words",
    ),
  );
  assert.ok(
    intelligence.visual_v3_adjustments.prompt_directives.some((line) =>
      /25-40 seconds/i.test(line),
    ),
  );
  assert.ok(
    intelligence.visual_v3_adjustments.prompt_directives.some((line) =>
      /first frame/i.test(line),
    ),
  );
});

test("retention intelligence Markdown is operator readable and token safe", () => {
  const intelligence = buildRetentionIntelligence({
    story: { id: "yt1", title: "Steam stat story" },
    retentionRows: [
      { elapsed_video_time_ratio: 0, audience_watch_ratio: 1 },
      { elapsed_video_time_ratio: 0.1, audience_watch_ratio: 0.72 },
    ],
  });
  const markdown = renderRetentionIntelligenceMarkdown(intelligence);

  assert.match(markdown, /^# Retention Intelligence/m);
  assert.match(markdown, /Hook score/);
  assert.match(markdown, /Visual V3 adjustments/);
  assert.doesNotMatch(markdown, /access_token|refresh_token/i);
});

test("retention intelligence local operator command is registered", () => {
  const args = parseArgs([
    "--channel-baseline",
    "test/output/channel-baseline.json",
    "--duration",
    "35",
  ]);

  assert.equal(
    packageJson.scripts["ops:retention-intelligence"],
    "node tools/retention-intelligence.js",
  );
  assert.equal(args.channelBaseline, "test/output/channel-baseline.json");
  assert.equal(args.durationS, 35);
});
