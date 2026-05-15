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
