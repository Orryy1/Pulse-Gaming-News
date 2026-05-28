const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const http = require("node:http");

const {
  buildPipelineBacklog,
  classifyStage,
  blockingReason,
  renderPipelineBacklogMarkdown,
  nextProduceCandidate,
  nextPublishCandidate,
  publishCandidateBlocker,
  coreDoneCount,
  requiredCorePlatformsFromEnv,
  isRealPostId,
  MAX_STUCK,
} = require("../../lib/services/pipeline-backlog");

const PACKAGE_PATH = path.resolve(__dirname, "..", "..", "package.json");
const TOOL_PATH = path.resolve(__dirname, "..", "..", "tools", "pipeline-backlog.js");

// ---------- helpers ----------

test("isRealPostId: accepts real ids, rejects null/empty/DUPE_", () => {
  assert.strictEqual(isRealPostId("yt_abc"), true);
  assert.strictEqual(isRealPostId(""), false);
  assert.strictEqual(isRealPostId(null), false);
  assert.strictEqual(isRealPostId(undefined), false);
  assert.strictEqual(isRealPostId("DUPE_BLOCKED"), false);
  assert.strictEqual(isRealPostId("DUPE_SKIPPED"), false);
});

test("coreDoneCount: 4 real ids → 4; DUPE_ doesn't count", () => {
  assert.strictEqual(
    coreDoneCount({
      youtube_post_id: "yt",
      tiktok_post_id: "tt",
      instagram_media_id: "ig",
      facebook_post_id: "fb",
    }),
    4,
  );
  assert.strictEqual(
    coreDoneCount({
      youtube_post_id: "yt",
      tiktok_post_id: "DUPE_BLOCKED",
      instagram_media_id: null,
      facebook_post_id: "fb",
    }),
    2,
  );
});

test("requiredCorePlatformsFromEnv: local TikTok disable removes TikTok from backlog completion", () => {
  const platforms = requiredCorePlatformsFromEnv({ TIKTOK_ENABLED: "false" });
  assert.deepStrictEqual(platforms, ["youtube", "instagram", "facebook"]);
  assert.strictEqual(
    coreDoneCount(
      {
        youtube_post_id: "yt",
        tiktok_post_id: null,
        instagram_media_id: "ig",
        facebook_post_id: "fb",
      },
      platforms,
    ),
    3,
  );
});

// ---------- classifyStage ----------

test("classifyStage: qa_failed has priority over everything else", () => {
  assert.strictEqual(
    classifyStage({ qa_failed: true, approved: true, exported_path: "/x" }),
    "qa_failed",
  );
});

test("classifyStage: published", () => {
  assert.strictEqual(
    classifyStage({ publish_status: "published" }),
    "published",
  );
});

test("classifyStage: partial / failed", () => {
  assert.strictEqual(classifyStage({ publish_status: "partial" }), "partial");
  assert.strictEqual(classifyStage({ publish_status: "failed" }), "failed");
});

test("classifyStage: approved_not_produced", () => {
  assert.strictEqual(
    classifyStage({ approved: true, exported_path: null }),
    "approved_not_produced",
  );
});

test("classifyStage: produced_not_published", () => {
  assert.strictEqual(
    classifyStage({
      approved: true,
      exported_path: "/x",
      publish_status: null,
    }),
    "produced_not_published",
  );
});

test("classifyStage: review for [REVIEW] classification and for unapproved", () => {
  assert.strictEqual(
    classifyStage({ classification: "[REVIEW]", approved: false }),
    "review",
  );
  assert.strictEqual(classifyStage({ approved: false }), "review");
});

// ---------- blockingReason ----------

test("blockingReason: no_script when hook + full_script both missing", () => {
  assert.strictEqual(blockingReason({ approved: true }), "no_script");
});

test("blockingReason: qa_failed surfaces the first qa_failures entry", () => {
  assert.strictEqual(
    blockingReason({
      full_script: "x",
      qa_failed: true,
      qa_failures: ["script_too_short (50 words, min 80)", "glued_sentence"],
    }),
    "qa:script_too_short (50 words, min 80)",
  );
});

test("blockingReason: qa_failed is surfaced even when script fields are missing", () => {
  assert.strictEqual(
    blockingReason({
      qa_failed: true,
      qa_failures: ["audio_duration_too_long (112.43s, max 74.00s)"],
    }),
    "qa:audio_duration_too_long (112.43s, max 74.00s)",
  );
});

test("blockingReason: script-generation review is clearer than generic no_script", () => {
  assert.strictEqual(
    blockingReason({
      script_generation_status: "review_required",
      script_review_reason: "script_runtime_too_long (112.00s, max 75.00s)",
    }),
    "script_generation_review:script_runtime_too_long (112.00s, max 75.00s)",
  );
});

test("blockingReason: partial_missing lists missing core platforms", () => {
  const r = blockingReason({
    full_script: "x",
    approved: true,
    exported_path: "/x",
    publish_status: "partial",
    youtube_post_id: "yt",
    tiktok_post_id: null,
    instagram_media_id: "ig",
    facebook_post_id: null,
  });
  assert.match(r, /^partial_missing:/);
  assert.match(r, /tiktok/);
  assert.match(r, /facebook/);
  assert.strictEqual(r.includes("youtube"), false);
  assert.strictEqual(r.includes("instagram"), false);
});

test("blockingReason: local TikTok disabled does not report TikTok as missing", () => {
  const r = blockingReason(
    {
      full_script: "x",
      approved: true,
      exported_path: "/x",
      publish_status: "partial",
      youtube_post_id: "yt",
      tiktok_post_id: null,
      instagram_media_id: "ig",
      facebook_post_id: null,
    },
    { corePlatforms: ["youtube", "instagram", "facebook"] },
  );
  assert.match(r, /^partial_missing:/);
  assert.match(r, /facebook/);
  assert.strictEqual(r.includes("tiktok"), false);
});

test("blockingReason: failed includes the publish_error", () => {
  const r = blockingReason({
    full_script: "x",
    approved: true,
    exported_path: "/x",
    publish_status: "failed",
    publish_error: "TikTok not authenticated",
  });
  assert.strictEqual(r, "failed:TikTok not authenticated");
});

// ---------- nextPublishCandidate ----------

test("nextPublishCandidate: prefers the story with FEWEST platforms done", () => {
  const stories = [
    {
      id: "three_done",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      youtube_post_id: "yt",
      tiktok_post_id: null,
      instagram_media_id: "ig",
      facebook_post_id: "fb",
      breaking_score: 50,
    },
    {
      id: "zero_done",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      breaking_score: 30,
    },
    {
      id: "fully_published",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      youtube_post_id: "yt",
      tiktok_post_id: "tt",
      instagram_media_id: "ig",
      facebook_post_id: "fb",
      breaking_score: 90,
    },
  ];
  const pick = nextPublishCandidate(stories);
  assert.strictEqual(pick.id, "zero_done");
  assert.strictEqual(pick.eligible_because, "awaiting_first_upload");
});

test("nextPublishCandidate: skips qa_failed stories", () => {
  const stories = [
    { id: "bad", approved: true, exported_path: "/x", qa_failed: true },
    { id: "good", approved: true, exported_path: "/x", full_script: "y" },
  ];
  const pick = nextPublishCandidate(stories);
  assert.strictEqual(pick.id, "good");
});

test("nextPublishCandidate: uses the live selection score within the same platform bucket", () => {
  const stories = [
    {
      id: "raw-score-winner",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 68,
      breaking_score: 999,
    },
    {
      id: "analytics-winner",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 68,
      breaking_score: 10,
    },
  ];
  const pick = nextPublishCandidate(stories, {
    selectionScore: (story) =>
      story.id === "analytics-winner" ? 2000 : story.breaking_score,
  });
  assert.strictEqual(pick.id, "analytics-winner");
});

test("nextPublishCandidate: skips under-60 Shorts even when exported", () => {
  const stories = [
    {
      id: "too-short",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 57.8,
      breaking_score: 99,
    },
    {
      id: "ready",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 68.2,
      breaking_score: 60,
    },
  ];
  const pick = nextPublishCandidate(stories);
  assert.strictEqual(pick.id, "ready");
});

test("nextPublishCandidate: skips frozen or unusable subtitle timelines", () => {
  const stories = [
    {
      id: "frozen-captions",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 68.2,
      breaking_score: 99,
      subtitle_timing_inspection: {
        usable: false,
        reason: "max_gap_too_large",
      },
    },
    {
      id: "ready",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 67.4,
      breaking_score: 60,
      subtitle_timing_inspection: {
        usable: true,
        reason: "usable",
      },
    },
  ];
  const pick = nextPublishCandidate(stories);
  assert.strictEqual(pick.id, "ready");
});

test("nextPublishCandidate: skips stale unpublished backlog rows", () => {
  const nowMs = Date.parse("2026-05-15T12:00:00Z");
  const stories = [
    {
      id: "old",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 68.2,
      created_at: "2026-04-20T12:00:00Z",
      breaking_score: 999,
    },
    {
      id: "fresh",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 67.4,
      created_at: "2026-05-15T11:00:00Z",
      breaking_score: 60,
    },
  ];
  const pick = nextPublishCandidate(stories, { nowMs });
  assert.strictEqual(pick.id, "fresh");
});

test("nextPublishCandidate: stale news is not refreshed by a recent export", () => {
  const nowMs = Date.parse("2026-05-15T12:00:00Z");
  const stories = [
    {
      id: "old-rerendered",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 68.2,
      created_at: "2026-04-20T12:00:00Z",
      exported_at: "2026-05-15T11:30:00Z",
      breaking_score: 999,
    },
    {
      id: "fresh",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 67.4,
      created_at: "2026-05-15T11:00:00Z",
      breaking_score: 60,
    },
  ];
  const pick = nextPublishCandidate(stories, { nowMs });
  assert.strictEqual(pick.id, "fresh");
});

test("nextPublishCandidate: strict mode skips thin visual renders", () => {
  const stories = [
    {
      id: "thin",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 68.2,
      qa_visual_count: 1,
      qa_visual_warning: "thin_visuals_below_three",
      breaking_score: 999,
    },
    {
      id: "safe",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 67.4,
      qa_visual_count: 5,
      breaking_score: 60,
    },
  ];
  const pick = nextPublishCandidate(stories, { strictContentQa: true });
  assert.strictEqual(pick.id, "safe");
});

test("nextPublishCandidate: skips legacy renders when Studio V4 premium publish is required", () => {
  const stories = [
    {
      id: "legacy",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 68.2,
      render_lane: "legacy_multi_image",
      render_quality_class: "standard",
      require_studio_v4_premium_publish: true,
      breaking_score: 999,
    },
    {
      id: "v4-premium",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 67.4,
      render_lane: "studio_v4",
      render_quality_class: "premium",
      distinct_visual_count: 8,
      require_studio_v4_premium_publish: true,
      media_house_benchmark: {
        result: "pass",
        scores: {
          motion_density_score: 91,
          media_house_polish_score: 89,
        },
      },
      breaking_score: 60,
    },
  ];
  const pick = nextPublishCandidate(stories);
  assert.strictEqual(pick.id, "v4-premium");
  assert.match(
    publishCandidateBlocker(stories[0]),
    /^premium_contract_required:/,
  );
});

test("publishCandidateBlocker: strict retry mode blocks public-output title failures", () => {
  const blocker = publishCandidateBlocker(
    {
      id: "mixtape_bad_retry",
      approved: true,
      exported_path: "/x",
      duration_seconds: 68.2,
      title:
        "Mixtape will be safe from a music licensing related delisting, ensured by its developer paying extra for the privilege",
      suggested_title: "This gaming story",
      source_type: "reddit",
      subreddit: "Games",
      article_url: "https://www.rockpapershotgun.com/mixtape-music-licensing",
      full_script:
        "This gaming story just got a source backed update. " +
        "The useful caveat is that this is one sourced update, not a blank check to invent extra details. " +
        "Treat the headline as confirmed only where the named source confirms it. " +
        "Follow Pulse Gaming so you never miss a beat.",
      suggested_thumbnail_text:
        "MIXTAPE WILL BE SAFE FROM A MUSIC LICENSING RELATED DELISTING",
      source_card_label: "r/Games",
    },
    { strictContentQa: true },
  );

  assert.match(blocker, /^public_output:/);
});

test("publishCandidateBlocker: terminal Instagram 2207076 errors require rerender before retry", () => {
  const blocker = publishCandidateBlocker(
    {
      id: "ig_bad_asset",
      approved: true,
      exported_path: "/x",
      duration_seconds: 68.2,
      title: "Steam Named Vampire Survivors' Genre",
      suggested_title: "Steam Named Vampire Survivors' Genre",
      full_script:
        "Steam just gave the Vampire Survivors genre a name players can actually search for. Follow Pulse Gaming so you never miss a beat.",
      instagram_error:
        "Instagram URL processing failed: status_code=ERROR status=Error: Media upload has failed with error code 2207076",
    },
    { strictContentQa: true },
  );

  assert.equal(blocker, "instagram_reel_processing_rejected_2207076_requires_rerender");
});

test("nextPublishCandidate: skips risky article-context dominated decks", () => {
  const riskyImages = Array.from({ length: 4 }, (_, index) => ({
    type: "article_inline",
    source: "article",
    url: `https://example.test/${index}.jpg`,
    thumbnail_safety_warnings: ["article_image_relevance_review"],
  }));
  const stories = [
    {
      id: "risky",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 68.2,
      downloaded_images: JSON.stringify([
        ...riskyImages,
        { type: "company_logo", source: "official" },
      ]),
      breaking_score: 999,
    },
    {
      id: "safe",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      duration_seconds: 67.4,
      downloaded_images: JSON.stringify([
        { type: "steam_screenshot", source: "steam" },
        { type: "steam_header", source: "steam" },
        { type: "article_hero", source: "article" },
      ]),
      breaking_score: 60,
    },
  ];
  const pick = nextPublishCandidate(stories);
  assert.strictEqual(pick.id, "safe");
});

test("nextPublishCandidate: returns null when nothing eligible", () => {
  assert.strictEqual(nextPublishCandidate([]), null);
  assert.strictEqual(
    nextPublishCandidate([
      {
        id: "done",
        approved: true,
        exported_path: "/x",
        youtube_post_id: "yt",
        tiktok_post_id: "tt",
        instagram_media_id: "ig",
        facebook_post_id: "fb",
      },
    ]),
    null,
  );
});

test("nextPublishCandidate: local TikTok disabled treats YT/IG/FB as complete", () => {
  const pick = nextPublishCandidate(
    [
      {
        id: "locally-complete",
        approved: true,
        exported_path: "/x",
        youtube_post_id: "yt",
        tiktok_post_id: null,
        instagram_media_id: "ig",
        facebook_post_id: "fb",
      },
    ],
    { corePlatforms: ["youtube", "instagram", "facebook"] },
  );
  assert.strictEqual(pick, null);
});

// ---------- nextProduceCandidate ----------

test("nextProduceCandidate: highest breaking_score wins", () => {
  const stories = [
    { id: "low", approved: true, exported_path: null, breaking_score: 30 },
    { id: "high", approved: true, exported_path: null, breaking_score: 80 },
    { id: "already_done", approved: true, exported_path: "/x" },
  ];
  const pick = nextProduceCandidate(stories);
  assert.strictEqual(pick.id, "high");
});

test("nextProduceCandidate: skips qa_failed and already-produced", () => {
  const stories = [
    {
      id: "failed",
      approved: true,
      exported_path: null,
      qa_failed: true,
      breaking_score: 99,
    },
    {
      id: "script-review",
      approved: true,
      exported_path: null,
      script_generation_status: "review_required",
      breaking_score: 97,
    },
    {
      id: "ok",
      approved: true,
      exported_path: null,
      full_script: "x",
      breaking_score: 50,
    },
  ];
  assert.strictEqual(nextProduceCandidate(stories).id, "ok");
});

test("nextProduceCandidate: returns null on empty input", () => {
  assert.strictEqual(nextProduceCandidate([]), null);
});

// ---------- buildPipelineBacklog full ----------

test("buildPipelineBacklog: empty list returns zero counts + null candidates", () => {
  const b = buildPipelineBacklog([]);
  assert.strictEqual(b.counts.review, 0);
  assert.strictEqual(b.counts.published, 0);
  assert.strictEqual(b.next_produce_candidate, null);
  assert.strictEqual(b.next_publish_candidate, null);
  assert.strictEqual(b.live_next_publish_candidate, null);
  assert.strictEqual(b.scheduler_bridge_next_publish_candidate, null);
  assert.deepStrictEqual(b.stuck_top10, []);
});

test("buildPipelineBacklog: surfaces scheduler bridge candidate without changing live DB counts", () => {
  const b = buildPipelineBacklog(
    [
      {
        id: "live-review",
        title: "Live DB review row",
        approved: false,
      },
    ],
    {
      schedulerBridgeCandidateReport: {
        bridge_candidates: {
          count: 2,
          mode: "authoritative_bridge_only",
          live_fallback_used: false,
        },
        preflight_qa: {
          candidates_checked: 2,
          pass: 2,
          blocked: 0,
          warning: 0,
        },
        candidates: [
          {
            id: "bridge-ready",
            title: "Hades II Just Broke PlayStation's Silence",
            status: "publish_ready",
            score: 97,
            duration_seconds: 42.4,
            preflight_qa: { status: "pass", blockers: [], warnings: [] },
          },
        ],
      },
    },
  );

  assert.strictEqual(b.counts.review, 1);
  assert.strictEqual(b.counts.produced_not_published, 0);
  assert.strictEqual(b.live_next_publish_candidate, null);
  assert.deepStrictEqual(b.scheduler_bridge_publish_readiness, {
    source: "scheduler_bridge_preflight",
    candidate_count: 2,
    preflight_checked_count: 2,
    preflight_pass_count: 2,
    preflight_blocked_count: 0,
    preflight_warning_count: 0,
    live_fallback_used: false,
    mode: "authoritative_bridge_only",
  });
  assert.deepStrictEqual(b.scheduler_bridge_next_publish_candidate, {
    id: "bridge-ready",
    title: "Hades II Just Broke PlayStation's Silence",
    eligible_because: "scheduler_bridge_preflight_pass",
    source: "scheduler_bridge_preflight",
    preflight_status: "pass",
    duration_seconds: 42.4,
  });
  assert.strictEqual(b.next_publish_candidate.id, "bridge-ready");
  assert.strictEqual(b.next_publish_candidate.source, "scheduler_bridge_preflight");
});

test("buildPipelineBacklog: surfaces scheduler bridge blocked candidates with repair lanes", () => {
  const b = buildPipelineBacklog([], {
    schedulerBridgeCandidateReport: {
      bridge_candidates: {
        count: 3,
        mode: "authoritative_bridge_only",
        live_fallback_used: false,
      },
      preflight_qa: {
        candidates_checked: 3,
        pass: 1,
        blocked: 2,
        warning: 0,
      },
      candidates: [
        {
          id: "weak-script",
          title: "Forza Horizon 6 Reviews Are In",
          status: "review",
          duration_seconds: 39.5,
          preflight_qa: {
            status: "blocked",
            blockers: ["script_scorecard:script_score_below_threshold"],
            checks: {
              script_scorecard: {
                result: "fail",
                failures: ["script_score_below_threshold", "script_verdict_rewrite_required"],
              },
            },
          },
        },
        {
          id: "weak-benchmark",
          title: "Star Wars Zero Company Is More Than XCOM",
          status: "review",
          duration_seconds: 52.7,
          preflight_qa: {
            status: "blocked",
            blockers: ["aggregate_benchmark:upstream:goal09_sound_design_engine_blocked"],
          },
        },
      ],
    },
  });

  assert.equal(b.scheduler_bridge_blocked_candidates.length, 2);
  assert.deepEqual(b.scheduler_bridge_blocked_candidates[0].repair_lanes, [
    "script_rewrite_and_audio_rerender",
  ]);
  assert.deepEqual(b.scheduler_bridge_blocked_candidates[1].repair_lanes, [
    "sound_visual_benchmark_repair",
  ]);
  assert.match(renderPipelineBacklogMarkdown(b), /Scheduler Bridge Blockers/);
  assert.match(renderPipelineBacklogMarkdown(b), /script_rewrite_and_audio_rerender/);
});

test("buildPipelineBacklog: counts across every stage", () => {
  const stories = [
    { id: "review", approved: false, classification: "[REVIEW]" },
    { id: "needs_produce", approved: true },
    {
      id: "produced",
      approved: true,
      exported_path: "/x",
      full_script: "y",
    },
    {
      id: "partial",
      approved: true,
      exported_path: "/x",
      publish_status: "partial",
      youtube_post_id: "yt",
    },
    {
      id: "failed",
      approved: true,
      exported_path: "/x",
      publish_status: "failed",
    },
    {
      id: "qa_blocked",
      approved: true,
      exported_path: "/x",
      qa_failed: true,
    },
    {
      id: "live",
      approved: true,
      exported_path: "/x",
      publish_status: "published",
    },
  ];
  const b = buildPipelineBacklog(stories);
  assert.strictEqual(b.counts.review, 1);
  assert.strictEqual(b.counts.approved_not_produced, 1);
  assert.strictEqual(b.counts.produced_not_published, 1);
  assert.strictEqual(b.counts.partial, 1);
  assert.strictEqual(b.counts.failed, 1);
  assert.strictEqual(b.counts.qa_failed, 1);
  assert.strictEqual(b.counts.published, 1);
});

test("buildPipelineBacklog: stuck_top10 orders by created_at desc and respects cap", () => {
  const stories = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`,
    title: `Story ${i}`,
    approved: true,
    classification: "[REVIEW]",
    created_at: `2026-04-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  const b = buildPipelineBacklog(stories);
  assert.strictEqual(b.stuck_top10.length, MAX_STUCK);
  // Most recent first
  assert.strictEqual(b.stuck_top10[0].id, "s19");
});

test("buildPipelineBacklog: stuck entry contains id + title + stage + blocking_reason", () => {
  const b = buildPipelineBacklog([
    {
      id: "x",
      title: "Partial Story",
      approved: true,
      exported_path: "/x",
      full_script: "y",
      publish_status: "partial",
      youtube_post_id: "yt",
    },
  ]);
  assert.strictEqual(b.stuck_top10.length, 1);
  const entry = b.stuck_top10[0];
  assert.strictEqual(entry.id, "x");
  assert.strictEqual(entry.title, "Partial Story");
  assert.strictEqual(entry.stage, "partial");
  assert.match(entry.blocking_reason, /^partial_missing:/);
});

test("buildPipelineBacklog: no editorial fields leak into stuck entries", () => {
  const b = buildPipelineBacklog([
    {
      id: "leaky",
      title: "Story",
      approved: true,
      classification: "[REVIEW]",
      full_script: "SECRET_SCRIPT",
      pinned_comment: "SECRET_COMMENT",
      hook: "SECRET_HOOK",
    },
  ]);
  const serialised = JSON.stringify(b);
  assert.strictEqual(serialised.includes("SECRET"), false);
});

test("renderPipelineBacklogMarkdown: gives a readable operator summary", () => {
  const md = renderPipelineBacklogMarkdown({
    generated_at: "2026-05-05T20:00:00.000Z",
    counts: {
      review: 1,
      approved_not_produced: 2,
      produced_not_published: 3,
      partial: 4,
      failed: 5,
      qa_failed: 6,
      published: 7,
      other: 0,
    },
    next_produce_candidate: {
      id: "produce-me",
      title: "Produce me",
      reason: "script_ready",
    },
    next_publish_candidate: {
      id: "publish-me",
      title: "Publish me",
      eligible_because: "awaiting_first_upload",
    },
    stuck_top10: [
      {
        id: "qa-story",
        title: "QA story",
        stage: "qa_failed",
        blocking_reason: "qa:audio_duration_too_long",
      },
    ],
  });

  assert.match(md, /Pipeline Backlog/);
  assert.match(md, /qa_failed: 6/);
  assert.match(md, /produce-me/);
  assert.match(md, /publish-me/);
  assert.match(md, /qa:audio_duration_too_long/);
});

test("ops:pipeline-backlog CLI is registered as a read-only operator command", () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
  assert.equal(pkg.scripts["ops:pipeline-backlog"], "node tools/pipeline-backlog.js");

  const src = fs.readFileSync(TOOL_PATH, "utf8");
  assert.match(src, /buildPipelineBacklog/);
  assert.match(src, /renderPipelineBacklogMarkdown/);
  assert.match(src, /next_publish_candidates\.json/);
  assert.match(src, /schedulerBridgeCandidateReport/);
  assert.doesNotMatch(src, /upsertStory|publishNextStory|uploadShort|AUTO_PUBLISH/);
});

// ---------- HTTP contract ----------

function buildTestApp({ apiToken, stories }) {
  const app = express();
  function requireAuth(req, res, next) {
    if (!apiToken) return next();
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/, "");
    if (tok !== apiToken)
      return res.status(401).json({ error: "Unauthorized" });
    next();
  }
  app.get("/api/pipeline/backlog", requireAuth, (_req, res) => {
    res.json(buildPipelineBacklog(stories));
  });
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ server, port: server.address().port }),
    );
  });
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("GET /api/pipeline/backlog: 401 without Bearer", async () => {
  const app = buildTestApp({ apiToken: "tok_verysecret123", stories: [] });
  const { server, port } = await listen(app);
  try {
    const r = await get(port, "/api/pipeline/backlog");
    assert.strictEqual(r.status, 401);
  } finally {
    server.close();
  }
});

test("GET /api/pipeline/backlog: empty DB returns 200 with zero counts", async () => {
  const app = buildTestApp({ apiToken: "tok", stories: [] });
  const { server, port } = await listen(app);
  try {
    const r = await get(port, "/api/pipeline/backlog", {
      Authorization: "Bearer tok",
    });
    assert.strictEqual(r.status, 200);
    const body = JSON.parse(r.body);
    assert.strictEqual(body.counts.review, 0);
  } finally {
    server.close();
  }
});

test("GET /api/pipeline/backlog: no token / editorial leakage", async () => {
  const app = buildTestApp({
    apiToken: "tok_verysecret123",
    stories: [
      {
        id: "x",
        title: "Story",
        approved: true,
        classification: "[REVIEW]",
        full_script: "SECRET_SCRIPT",
      },
    ],
  });
  const { server, port } = await listen(app);
  try {
    const r = await get(port, "/api/pipeline/backlog", {
      Authorization: "Bearer tok_verysecret123",
    });
    assert.strictEqual(r.body.includes("SECRET"), false);
    assert.strictEqual(r.body.includes("tok_verysecret123"), false);
  } finally {
    server.close();
  }
});
