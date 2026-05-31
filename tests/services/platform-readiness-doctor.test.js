"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildPlatformReadinessDoctor,
  classifyInstagramReadinessError,
  renderPlatformReadinessDoctorMarkdown,
} = require("../../lib/ops/platform-readiness-doctor");
const {
  buildCurrentTikTokAutomationReport,
} = require("../../tools/platform-readiness-doctor");

const ROOT = path.resolve(__dirname, "..", "..");

test("platform readiness doctor keeps TikTok OAuth success separate from local token readiness", () => {
  const report = buildPlatformReadinessDoctor({
    generatedAt: "2026-05-08T05:30:00.000Z",
    tiktokTokenStatus: {
      ok: false,
      reason: "expired",
      refresh_available: true,
      needs_reauth: false,
      expires_in_seconds: -120,
      access_token: "must-not-leak",
    },
    tiktokAutomationReport: {
      recommendedRoute: "fix_local_token_state_then_official_inbox_upload",
      routeStrategy: [{ id: "official_inbox_upload", status: "needs_local_token_refresh_or_sync" }],
      dispatchGate: {
        topReadyPack: {
          storyId: "story1",
          mp4: "D:/pulse-data/media/output/final/story1.mp4",
          eligibility: { durationSeconds: 64 },
        },
      },
    },
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.platforms.tiktok.status, "needs_local_token_refresh_or_sync");
  assert.equal(report.platforms.tiktok.browser_oauth_may_be_ok, true);
  assert.equal(report.platforms.tiktok.official_inbox_route, "prepared_not_executed");
  assert.ok(report.blockers.includes("tiktok_local_token_refresh_or_sync_required"));
  assert.deepEqual(report.safety, {
    read_only: true,
    no_oauth_triggered: true,
    no_token_mutation: true,
    no_social_uploads: true,
    no_public_posts: true,
    no_production_db_mutation: true,
  });

  const md = renderPlatformReadinessDoctorMarkdown(report);
  assert.match(md, /TikTok/);
  assert.match(md, /needs_local_token_refresh_or_sync/);
  assert.doesNotMatch(md, /must-not-leak|access_token|refresh_token|Bearer/);
});

test("platform readiness doctor CLI evidence prefers fresh token-blocked TikTok packs over stale overnight snapshots", () => {
  const report = buildCurrentTikTokAutomationReport({
    generatedAt: "2026-05-28T22:45:00.000Z",
    env: { TIKTOK_DIRECT_POST_APPROVED: "false" },
    tiktokTokenStatus: {
      ok: false,
      reason: "expired",
      refresh_available: true,
      needs_reauth: false,
      needs_refresh_or_sync: true,
      expires_in_seconds: -120,
    },
    existingAutomationReport: {
      dispatchGate: {
        topReadyPack: {
          storyId: "stale_overnight_story",
          status: "ready_for_operator_review",
          mp4: "output/final/stale_overnight_story.mp4",
          eligibility: { durationSeconds: 68.2 },
        },
      },
    },
    dispatchManifest: {
      count: 1,
      statusCounts: { ready_for_operator_review: 1 },
      topReadyPack: {
        storyId: "stale_manifest_story",
        status: "ready_for_operator_review",
        mp4: "output/final/stale_manifest_story.mp4",
        eligibility: { durationSeconds: 60.7 },
      },
    },
    freshDispatchPack: {
      dispatchPack: {
        storyId: "fresh_current_story",
        status: "tiktok_auth_action_required",
        mp4: "output/goal-proof/batch/fresh_current_story/tiktok.mp4",
        cover: "test/output/tiktok-fresh-dispatch/fresh_current_story_cover.jpg",
        eligibility: {
          durationSeconds: 75.88,
          captionReady: true,
          dispatchLengthReady: true,
          hasMp4: true,
          hasCover: true,
        },
        voiceGate: {
          verdict: "pass",
          blockers: [],
          warnings: [],
          do_not_reuse_for_tiktok_dispatch: false,
        },
        creativeGate: {
          blocks_dispatch: false,
          blockers: [],
        },
      },
      inboxPlan: {
        status: "not_ready",
        dry_run: true,
        will_upload_to_tiktok: false,
        blockers: ["dispatch_pack_tiktok_auth_action_required"],
      },
      creativeReview: {
        operator_visual_review_required: true,
        blockers: [],
      },
      safety: {
        public_post_created: false,
      },
    },
  });

  assert.equal(report.dispatchGate.source, "fresh_local_dispatch_pack");
  assert.equal(report.dispatchGate.topReadyPack.storyId, "fresh_current_story");
  assert.equal(report.noPostReadiness.dispatchCreative.storyId, "fresh_current_story");
  assert.equal(report.noPostReadiness.dispatchCreative.status, "ready_for_operator_visual_review");
  assert.deepEqual(report.blockers, ["refresh_or_sync_local_token"]);
});

test("platform readiness doctor CLI evidence prefers strict dry-run TikTok actions over stale fresh dispatch packs", () => {
  const report = buildCurrentTikTokAutomationReport({
    generatedAt: "2026-05-31T17:10:00.000Z",
    env: { TIKTOK_DIRECT_POST_APPROVED: "false" },
    tiktokTokenStatus: {
      ok: false,
      reason: "expired",
      refresh_available: true,
      needs_reauth: false,
      needs_refresh_or_sync: true,
      expires_in_seconds: -120,
    },
    existingAutomationReport: {
      dispatchGate: {
        topReadyPack: {
          storyId: "stale_overnight_story",
          status: "ready_for_operator_review",
          mp4: "output/final/stale_overnight_story.mp4",
          eligibility: { durationSeconds: 68.2 },
        },
      },
    },
    freshDispatchPack: {
      dispatchPack: {
        storyId: "stale_fresh_story",
        status: "tiktok_auth_action_required",
        mp4: "output/goal-proof/batch/stale_fresh_story/tiktok.mp4",
        cover: "test/output/tiktok-fresh-dispatch/stale_fresh_story_cover.jpg",
        eligibility: {
          durationSeconds: 75.886,
          captionReady: true,
          dispatchLengthReady: true,
          hasMp4: true,
          hasCover: true,
        },
        voiceGate: { verdict: "pass", blockers: [], warnings: [] },
        creativeGate: { blocks_dispatch: false, blockers: [] },
      },
      inboxPlan: {
        status: "not_ready",
        dry_run: true,
        will_upload_to_tiktok: false,
        blockers: ["dispatch_pack_tiktok_auth_action_required"],
      },
      creativeReview: { operator_visual_review_required: true, blockers: [] },
      safety: { public_post_created: false },
    },
    strictDryRunPlan: {
      mode: "DRY_RUN_PUBLISH",
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
      actions: [
        {
          story_id: "current_dry_run_story",
          platform: "tiktok",
          action: "would_queue_when_enabled",
          mode: "DRY_RUN_PUBLISH",
          title: "Current TikTok Proof Cut",
          video_path: "output/goal-proof/batch/current_dry_run_story/platform_variants/tiktok_creator_rewards/current.mp4",
          cover_frame_source: "output/goal-proof/batch/current_dry_run_story/platform_variants/tiktok_creator_rewards/current.mp4",
          video_duration_s: 65.159,
          blockers: [],
          warnings: [],
          no_network_upload: true,
          platform_enabled: false,
          platform_operational_state: "needs_credentials",
        },
      ],
    },
  });

  assert.equal(report.dispatchGate.source, "strict_dry_run_tiktok_action");
  assert.equal(report.dispatchGate.topReadyPack.storyId, "current_dry_run_story");
  assert.equal(report.dispatchGate.topReadyPack.durationSeconds, 65.159);
  assert.equal(report.noPostReadiness.dispatchCreative.storyId, "current_dry_run_story");
  assert.equal(report.noPostReadiness.dispatchCreative.status, "ready_for_operator_visual_review");
  assert.deepEqual(report.blockers, ["refresh_or_sync_local_token"]);
});

test("platform readiness doctor renders TikTok no-post readiness lanes separately", () => {
  const report = buildPlatformReadinessDoctor({
    generatedAt: "2026-05-13T08:30:00.000Z",
    tiktokTokenStatus: {
      ok: false,
      reason: "expired",
      refresh_available: true,
      needs_reauth: false,
      expires_in_seconds: -60,
      access_token: "must-not-leak",
    },
    tiktokAutomationReport: {
      noPostReadiness: {
        browserOAuth: {
          status: "succeeded",
          completed_at: "2026-05-12T22:10:00.000Z",
          evidence: "operator_handoff",
          local_token_proven: false,
          local_token_status: "expired_but_refreshable",
        },
        localToken: {
          status: "expired_but_refreshable",
          next_action: "refresh_or_sync_local_token",
          refresh_available: true,
          needs_reauth: false,
        },
        officialInbox: {
          status: "blocked_by_local_token_and_creative_review",
          ready_pack_present: false,
          public_auto_publish: false,
        },
        directPost: {
          status: "blocked_by_app_review_or_direct_post_approval",
          blocker: "direct_post_approval_not_declared",
        },
        dispatchCreative: {
          status: "blocked_by_creative_review",
          storyId: "1szzhy9",
          blockers: ["visual_repeat_pairs_remaining"],
        },
      },
      dispatchGate: {
        topPack: {
          storyId: "1szzhy9",
          status: "creative_review_required",
          mp4: "test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4",
          cover: "test/output/tiktok-cover-candidates/covers/1szzhy9_12s.jpg",
          eligibility: { durationSeconds: 74.6 },
        },
      },
      blockers: ["visual_repeat_pairs_remaining"],
    },
  });

  assert.equal(report.platforms.tiktok.no_post_readiness.browser_oauth.status, "succeeded");
  assert.equal(
    report.platforms.tiktok.no_post_readiness.local_token.status,
    "expired_but_refreshable",
  );
  assert.equal(
    report.platforms.tiktok.no_post_readiness.official_inbox.status,
    "blocked_by_local_token_and_creative_review",
  );
  assert.equal(
    report.platforms.tiktok.no_post_readiness.direct_post.status,
    "blocked_by_app_review_or_direct_post_approval",
  );
  assert.equal(
    report.platforms.tiktok.no_post_readiness.dispatch_creative.status,
    "blocked_by_creative_review",
  );

  const md = renderPlatformReadinessDoctorMarkdown(report);
  assert.match(md, /TikTok No-Post Readiness/);
  assert.match(md, /Browser OAuth: succeeded/);
  assert.match(md, /Local token: expired_but_refreshable/);
  assert.match(md, /Official inbox: blocked_by_local_token_and_creative_review/);
  assert.match(md, /Direct post: blocked_by_app_review_or_direct_post_approval/);
  assert.match(md, /Dispatch creative: blocked_by_creative_review/);
  assert.doesNotMatch(md, /must-not-leak|access_token|refresh_token|Bearer/);
});

test("platform readiness doctor lets live TikTok token inspection override stale usable no-post evidence", () => {
  const report = buildPlatformReadinessDoctor({
    generatedAt: "2026-05-26T11:10:00.000Z",
    tiktokTokenStatus: {
      ok: false,
      reason: "expired",
      refresh_available: true,
      needs_reauth: false,
      expires_in_seconds: -464321,
    },
    tiktokAutomationReport: {
      noPostReadiness: {
        browserOAuth: {
          status: "succeeded",
          local_token_proven: true,
          local_token_status: "usable",
        },
        localToken: {
          status: "usable",
          next_action: "none",
          refresh_available: false,
          needs_reauth: false,
        },
      },
      dispatchGate: {
        topReadyPack: {
          storyId: "ready-story",
          status: "ready_for_operator_review",
          durationSeconds: 67.4,
        },
      },
    },
  });

  const readiness = report.platforms.tiktok.no_post_readiness;

  assert.equal(report.platforms.tiktok.status, "needs_local_token_refresh_or_sync");
  assert.equal(readiness.browser_oauth.status, "succeeded");
  assert.equal(readiness.browser_oauth.local_token_proven, false);
  assert.equal(readiness.browser_oauth.local_token_status, "expired_but_refreshable");
  assert.equal(readiness.local_token.status, "expired_but_refreshable");
  assert.equal(readiness.local_token.next_action, "refresh_or_sync_local_token");
  assert.equal(readiness.local_token.refresh_available, true);
  assert.ok(report.blockers.includes("tiktok_local_token_refresh_or_sync_required"));

  const md = renderPlatformReadinessDoctorMarkdown(report);
  assert.match(md, /Local token: expired_but_refreshable; action=refresh_or_sync_local_token/);
  assert.doesNotMatch(md, /Local token: usable; action=none/);
});

test("platform readiness doctor blocks TikTok inbox when the selected pack still needs creative review", () => {
  const report = buildPlatformReadinessDoctor({
    tiktokTokenStatus: {
      ok: false,
      reason: "expired",
      refresh_available: true,
      needs_reauth: false,
    },
    tiktokAutomationReport: {
      dispatchGate: {
        topPack: {
          storyId: "1szzhy9",
          status: "creative_review_required",
          mp4: "test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4",
          cover: "test/output/tiktok-cover-candidates/covers/1szzhy9_12s.jpg",
          eligibility: { durationSeconds: 74.6 },
        },
      },
    },
  });

  assert.equal(report.platforms.tiktok.official_inbox_route, "creative_review_required_before_inbox");
  assert.equal(report.platforms.tiktok.pack.status, "creative_review_required");
  assert.ok(report.blockers.includes("tiktok_creative_review_required"));
  assert.match(renderPlatformReadinessDoctorMarkdown(report), /creative_review_required_before_inbox/);
});

test("platform readiness doctor does not treat visual-review routing as a creative blocker without blocker evidence", () => {
  const report = buildPlatformReadinessDoctor({
    tiktokTokenStatus: {
      ok: false,
      reason: "expired",
      refresh_available: true,
      needs_reauth: false,
      needs_refresh_or_sync: true,
    },
    tiktokAutomationReport: {
      dispatchGate: {
        topReadyPack: {
          storyId: "fresh-current",
          status: "tiktok_auth_action_required",
          durationSeconds: 75.88,
          mp4: "output/goal-proof/batch/fresh-current/tiktok.mp4",
          cover: "test/output/tiktok-fresh-dispatch/fresh-current-cover.jpg",
          creativeReviewRequired: true,
          creativeBlockers: [],
        },
      },
      noPostReadiness: {
        officialInbox: {
          status: "needs_local_token_refresh_or_sync",
          ready_pack_present: true,
          public_auto_publish: false,
        },
        dispatchCreative: {
          status: "ready_for_operator_visual_review",
          storyId: "fresh-current",
          blockers: [],
        },
      },
      blockers: ["refresh_or_sync_local_token"],
    },
  });

  assert.equal(report.platforms.tiktok.official_inbox_route, "prepared_not_executed");
  assert.equal(report.platforms.tiktok.pack.story_id, "fresh-current");
  assert.equal(report.platforms.tiktok.pack.creative_review_required, false);
  assert.deepEqual(report.platforms.tiktok.no_post_readiness.dispatch_creative.blockers, []);
  assert.ok(!report.blockers.includes("tiktok_creative_review_required"));
});

test("platform readiness doctor does not coerce unknown TikTok pack duration to zero", () => {
  const report = buildPlatformReadinessDoctor({
    tiktokTokenStatus: { ok: true, reason: "ok" },
    tiktokAutomationReport: {
      dispatchGate: {
        topReadyPack: {
          storyId: "story-no-duration",
          status: "ready_for_operator_review",
          eligibility: { durationSeconds: null },
        },
      },
    },
  });

  assert.equal(report.platforms.tiktok.pack.duration_seconds, null);
  assert.match(renderPlatformReadinessDoctorMarkdown(report), /story-no-duration \(duration unknown\)/);
  assert.doesNotMatch(renderPlatformReadinessDoctorMarkdown(report), /0\.0s/);
});

test("platform readiness doctor treats a top ready TikTok pack as actionable, not creative-blocked", () => {
  const report = buildPlatformReadinessDoctor({
    tiktokTokenStatus: { ok: true, reason: "ok", refresh_available: true },
    tiktokAutomationReport: {
      noPostReadiness: {
        dispatchCreative: {
          status: "blocked_by_creative_review",
          storyId: "old-proof",
          blockers: ["visual_repeat_pairs_remaining"],
        },
      },
      dispatchGate: {
        topReadyPack: {
          storyId: "rss_clean",
          status: "ready_for_operator_review",
          durationSeconds: 68.2,
          mp4: "output/final/rss_clean.mp4",
          cover: "output/thumbnails/rss_clean.jpg",
        },
        topPack: {
          storyId: "old-proof",
          status: "creative_review_required",
        },
      },
      blockers: [],
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(
    report.platforms.tiktok.official_inbox_route,
    "ready_pending_explicit_upload_approval",
  );
  assert.equal(report.platforms.tiktok.pack.story_id, "rss_clean");
  assert.equal(report.platforms.tiktok.pack.duration_seconds, 68.2);
  assert.equal(report.platforms.tiktok.pack.creative_review_required, false);
  assert.equal(
    report.platforms.tiktok.no_post_readiness.dispatch_creative.status,
    "ready_for_operator_review",
  );
  assert.deepEqual(report.platforms.tiktok.no_post_readiness.dispatch_creative.blockers, []);
  assert.doesNotMatch(
    renderPlatformReadinessDoctorMarkdown(report),
    /tiktok_creative_review_required|creative_review_required_before_inbox/,
  );
});

test("platform readiness doctor exposes X enablement without network calls or secret leakage", () => {
  const report = buildPlatformReadinessDoctor({
    generatedAt: "2026-05-22T16:10:00.000Z",
    platformConfig: {
      twitter: { state: "disabled", reason: "x_optional_disabled" },
      facebook_reel: { state: "enabled", reason: "facebook_reels_default_enabled" },
    },
    xEnv: {
      TWITTER_ENABLED: "false",
      TWITTER_API_KEY: "must-not-leak",
      TWITTER_API_SECRET: "must-not-leak",
      TWITTER_ACCESS_TOKEN: "must-not-leak",
      TWITTER_ACCESS_SECRET: "must-not-leak",
    },
  });

  assert.equal(report.platforms.x.status, "operator_disabled");
  assert.equal(report.platforms.x.no_post_readiness.operator_switch.status, "disabled");
  assert.equal(report.platforms.x.no_post_readiness.credential_set.status, "present");
  assert.equal(report.platforms.x.no_post_readiness.api_billing.status, "not_declared");
  assert.equal(report.platforms.x.public_auto_publish, false);
  assert.equal(report.platforms.x.network_calls_allowed, false);
  assert.ok(report.enablement_gaps.includes("x_operator_disabled"));

  const md = renderPlatformReadinessDoctorMarkdown(report);
  assert.match(md, /## X/);
  assert.match(md, /operator_disabled/);
  assert.match(md, /Network calls allowed: false/);
  assert.doesNotMatch(md, /must-not-leak|TWITTER_API_KEY|TWITTER_ACCESS_TOKEN|Bearer/);
});

test("platform readiness doctor blocks X enablement when credentials are incomplete", () => {
  const report = buildPlatformReadinessDoctor({
    platformConfig: {
      twitter: { state: "enabled", reason: "x_video_enabled" },
      facebook_reel: { state: "enabled", reason: "facebook_reels_default_enabled" },
    },
    xEnv: {
      TWITTER_ENABLED: "true",
      TWITTER_API_KEY: "must-not-leak",
      X_API_BILLING_CONFIRMED: "true",
    },
  });

  assert.equal(report.platforms.x.status, "missing_credentials");
  assert.equal(report.platforms.x.no_post_readiness.operator_switch.status, "enabled");
  assert.equal(report.platforms.x.no_post_readiness.credential_set.status, "missing");
  assert.ok(report.enablement_gaps.includes("x_credentials_missing"));
  assert.equal(report.platforms.x.network_calls_allowed, false);
  assert.doesNotMatch(renderPlatformReadinessDoctorMarkdown(report), /must-not-leak|TWITTER_API_KEY/);
});

test("platform readiness doctor classifies Instagram 2207076 as rerender work, not URL fallback", () => {
  const error =
    "Instagram URL processing failed: status_code=ERROR status=Error: Media upload has failed with error code 2207076";
  const diagnosis = classifyInstagramReadinessError(error);

  assert.equal(diagnosis.category, "media_processing_rejected");
  assert.equal(diagnosis.error_code, "2207076");
  assert.equal(diagnosis.url_fallback_allowed, false);
  assert.equal(diagnosis.retry_same_mp4_recommended, false);
  assert.equal(diagnosis.next_action, "rerender_mp4_codec_qa_required");

  const report = buildPlatformReadinessDoctor({
    instagramLastError: error,
  });
  assert.equal(report.platforms.instagram_reel.status, "blocked_by_media_processing_rejection");
  assert.ok(report.blockers.includes("instagram_reel_rerender_required"));
  assert.match(renderPlatformReadinessDoctorMarkdown(report), /rerender_mp4_codec_qa_required/);
});

test("platform readiness doctor records Facebook Reels enabled with verifier guardrails", () => {
  const report = buildPlatformReadinessDoctor({
    platformConfig: {
      facebook_reel: { state: "enabled", reason: "facebook_reels_default_enabled" },
    },
    facebookManualProof: {
      observed: true,
      note: "manual_reel_upload_succeeded",
    },
  });

  assert.equal(report.platforms.facebook_reel.status, "enabled_verify_after_upload");
  assert.equal(report.platforms.facebook_reel.manual_reel_upload_observed, true);
  assert.equal(report.platforms.facebook_reel.verifier_contract.requires_ready_status, true);
  assert.equal(report.platforms.facebook_reel.verifier_contract.requires_permalink_or_published_flag, true);
  assert.match(renderPlatformReadinessDoctorMarkdown(report), /manual_reel_upload_succeeded/);
});

test("platform readiness doctor uses read-only Facebook Graph eligibility proof", () => {
  const report = buildPlatformReadinessDoctor({
    platformConfig: {
      facebook_reel: { state: "enabled", reason: "facebook_reels_default_enabled" },
    },
    facebookEligibilityReport: {
      evidence: {
        page: { data: { can_post: true } },
        videos: { count: 1 },
        reels: { count: 1 },
        tokenDebug: { data: { is_valid: true } },
      },
      classification: {
        verdict: "eligible_for_normal_publish",
        reason: "visible_graph_video_or_reel_found",
      },
    },
  });

  assert.equal(report.platforms.facebook_reel.manual_reel_upload_observed, true);
  assert.equal(
    report.platforms.facebook_reel.graph_eligibility.verdict,
    "eligible_for_normal_publish",
  );
  assert.equal(report.platforms.facebook_reel.graph_eligibility.token_valid, true);
  assert.equal(report.platforms.facebook_reel.graph_eligibility.page_can_post, true);

  const markdown = renderPlatformReadinessDoctorMarkdown(report);
  assert.match(markdown, /Graph eligibility: eligible_for_normal_publish/);
  assert.match(markdown, /visible_reel_or_video=true; token_valid=true; page_can_post=true/);
});

test("platform readiness doctor command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["ops:platform-doctor"], "node tools/platform-readiness-doctor.js");
  const tool = fs.readFileSync(path.join(ROOT, "tools", "platform-readiness-doctor.js"), "utf8");
  assert.match(tool, /platform_readiness_doctor\.json/);
  assert.match(tool, /no OAuth, token mutation, uploads or posts/i);
});
