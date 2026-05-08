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

test("platform readiness doctor command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["ops:platform-doctor"], "node tools/platform-readiness-doctor.js");
  const tool = fs.readFileSync(path.join(ROOT, "tools", "platform-readiness-doctor.js"), "utf8");
  assert.match(tool, /platform_readiness_doctor\.json/);
  assert.match(tool, /no OAuth, token mutation, uploads or posts/i);
});
