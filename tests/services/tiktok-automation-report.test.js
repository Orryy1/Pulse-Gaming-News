"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTikTokAutomationReport,
  renderTikTokAutomationMarkdown,
  tokenGateFromReports,
} = require("../../lib/platforms/tiktok-automation-report");

test("TikTok automation report recommends official inbox when token and pack are ready", () => {
  const report = buildTikTokAutomationReport({
    generatedAt: "2026-05-06T22:00:00.000Z",
    authDoctorReport: {
      token_status: {
        ok: true,
        connected: true,
        reason: "ok",
        expires_in_seconds: 40000,
        refresh_available: true,
        needs_reauth: false,
        local_action: "token_usable",
        access_token: "must-not-leak",
      },
      posting_capability: {
        public_auto_posting_permitted_by_env: false,
      },
      warnings: [
        "direct_public_post_not_approved_or_not_declared",
        "dashboard_client_key_error_requires_operator_dashboard_fix",
      ],
    },
    dispatchManifest: {
      count: 1,
      statusCounts: { ready_for_operator_review: 1 },
      topReadyPack: {
        storyId: "story1",
        status: "ready_for_operator_review",
        mp4: "output/final/story1.mp4",
        cover: "output/images/story1.png",
        eligibility: { durationSeconds: 64 },
      },
      topPack: {
        storyId: "story1",
        status: "ready_for_operator_review",
        eligibility: {
          durationSeconds: 64,
          captionReady: true,
          dispatchLengthReady: true,
        },
        mp4: "output/final/story1.mp4",
        cover: "output/images/story1.png",
      },
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.recommendedRoute, "official_inbox_upload_prepare_only");
  assert.equal(report.routeStrategy[0].status, "ready_for_operator_review_not_executed");
  assert.ok(
    report.approvalQueue.some((item) =>
      /Approve one TikTok official inbox upload test/.test(item.decision),
    ),
  );

  const md = renderTikTokAutomationMarkdown(report);
  assert.match(md, /Official TikTok inbox upload/);
  assert.match(md, /Requires approval before execution/);
  assert.doesNotMatch(md, /must-not-leak|access_token|refresh_token|Bearer/);
});

test("TikTok automation report prefers a fresh local dispatch pack over stale manifest gaps", () => {
  const report = buildTikTokAutomationReport({
    generatedAt: "2026-05-06T22:30:00.000Z",
    authDoctorReport: {
      token_status: {
        ok: true,
        connected: true,
        reason: "ok",
        expires_in_seconds: 36000,
        refresh_available: true,
        needs_reauth: false,
        local_action: "token_usable",
      },
      posting_capability: {
        public_auto_posting_permitted_by_env: false,
      },
      warnings: [
        "direct_public_post_not_approved_or_not_declared",
        "dashboard_client_key_error_requires_operator_dashboard_fix",
      ],
    },
    dispatchManifest: {
      count: 2,
      statusCounts: { duration_review_required: 2 },
      topPack: {
        storyId: "stale-story",
        status: "duration_review_required",
        eligibility: { durationSeconds: null, captionReady: true, dispatchLengthReady: false },
      },
    },
    freshDispatchPack: {
      dispatchPack: {
        storyId: "1szzhy9",
        status: "ready_for_operator_review",
        mp4: "test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4",
        cover: "test/output/tiktok-cover-candidates/covers/1szzhy9_12s.jpg",
        eligibility: {
          durationSeconds: 74.67,
          captionReady: true,
          dispatchLengthReady: true,
          creatorRewardsLengthEligible: true,
        },
      },
      inboxPlan: {
        status: "dry_run_ready",
        dry_run: true,
        will_upload_to_tiktok: false,
        public_auto_publish: false,
      },
      creativeReview: {
        operator_visual_review_required: true,
      },
      safety: {
        local_dry_run_only: true,
        live_upload_executed: false,
        public_post_created: false,
      },
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.recommendedRoute, "official_inbox_upload_prepare_only");
  assert.equal(report.dispatchGate.source, "fresh_local_dispatch_pack");
  assert.equal(report.dispatchGate.topReadyPack.storyId, "1szzhy9");
  assert.ok(report.diagnostics.warnings.includes("dashboard_client_key_error_requires_operator_dashboard_fix"));
  assert.equal(report.routeStrategy[0].status, "ready_for_operator_review_not_executed");
  assert.deepEqual(report.blockers, []);

  const md = renderTikTokAutomationMarkdown(report);
  assert.match(md, /fresh local dispatch pack/);
  assert.match(md, /dry-run only/);
  assert.match(md, /dashboard_client_key_error_requires_operator_dashboard_fix/);
  assert.match(md, /1szzhy9/);
  assert.doesNotMatch(md, /access_token|refresh_token|Bearer/);
});

test("TikTok automation report distinguishes stale local token from a ready browser flow", () => {
  const report = buildTikTokAutomationReport({
    authDoctorReport: {
      token_status: {
        ok: false,
        connected: false,
        reason: "expired",
        refresh_available: true,
        needs_reauth: false,
        needs_refresh_or_sync: true,
        local_action: "refresh_or_sync_local_token",
      },
    },
    dispatchManifest: {
      count: 1,
      statusCounts: { tiktok_auth_action_required: 1 },
      topPack: {
        storyId: "story1",
        status: "tiktok_auth_action_required",
        eligibility: { durationSeconds: 65, captionReady: true, dispatchLengthReady: true },
      },
    },
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.recommendedRoute, "produce_or_select_fresh_60s_dispatch_pack");
  assert.ok(report.blockers.includes("tiktok_auth_action_required"));
  assert.ok(report.blockers.includes("refresh_or_sync_local_token"));
  assert.equal(report.routeStrategy[0].status, "needs_ready_60s_dispatch_pack");

  const md = renderTikTokAutomationMarkdown(report);
  assert.match(md, /refresh_or_sync_local_token/);
  assert.doesNotMatch(md, /access_token|refresh_token|Bearer/);
});

test("TikTok automation report keeps browser automation test-account-only", () => {
  const report = buildTikTokAutomationReport({
    authDoctorReport: {},
    dispatchManifest: {},
  });

  const browserRoute = report.routeStrategy.find((route) => route.id === "browser_automation");
  assert.equal(browserRoute.status, "test_account_only");
  assert.equal(browserRoute.account_risk, "high");
  assert.match(browserRoute.recommendation, /live Pulse TikTok account/);
  assert.ok(
    report.approvalQueue.some((item) =>
      /Do not approve live-account TikTok browser automation/.test(item.decision),
    ),
  );
});

test("TikTok automation token gate redacts raw token-shaped fields", () => {
  const gate = tokenGateFromReports({
    token_status: {
      ok: true,
      reason: "ok",
      access_token: "secret-access",
      refresh_token: "secret-refresh",
    },
  });

  assert.equal(gate.ok, true);
  assert.equal(gate.access_token, undefined);
  assert.equal(gate.refresh_token, undefined);
});
