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

test("TikTok automation report surfaces blocked fresh Studio V2 dispatch packs", () => {
  const report = buildTikTokAutomationReport({
    generatedAt: "2026-05-07T01:30:00.000Z",
    authDoctorReport: {
      token_status: {
        ok: true,
        connected: true,
        reason: "ok",
        expires_in_seconds: 25000,
        refresh_available: true,
        needs_reauth: false,
        local_action: "token_usable",
      },
    },
    dispatchManifest: {
      count: 2,
      statusCounts: { missing_video: 2 },
      topPack: {
        storyId: "legacy",
        status: "missing_video",
        eligibility: { durationSeconds: null },
      },
    },
    freshDispatchPack: {
      dispatchPack: {
        storyId: "1szzhy9",
        status: "creative_review_required",
        mp4: "test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4",
        cover: "test/output/tiktok-cover-candidates/covers/1szzhy9_12s.jpg",
        eligibility: {
          durationSeconds: 74.67,
          captionReady: true,
          dispatchLengthReady: true,
          creatorRewardsLengthEligible: true,
        },
        creativeGate: {
          blocks_dispatch: true,
          blockers: [
            "studio_v2_promotion_red_blocked",
            "visual_repeat_pairs_remaining",
          ],
        },
      },
      inboxPlan: {
        status: "not_ready",
        dry_run: true,
        will_upload_to_tiktok: false,
        public_auto_publish: false,
        blockers: [
          "dispatch_pack_creative_review_required",
          "studio_v2_promotion_red_blocked",
          "visual_repeat_pairs_remaining",
        ],
      },
      creativeReview: {
        operator_visual_review_required: true,
        blockers: [
          "studio_v2_promotion_red_blocked",
          "visual_repeat_pairs_remaining",
        ],
      },
      safety: {
        local_dry_run_only: true,
        live_upload_executed: false,
        public_post_created: false,
      },
    },
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.recommendedRoute, "fix_fresh_dispatch_creative_blockers");
  assert.equal(report.dispatchGate.source, "fresh_local_dispatch_pack");
  assert.equal(report.dispatchGate.topPack.status, "creative_review_required");
  assert.ok(report.blockers.includes("studio_v2_promotion_red_blocked"));
  assert.ok(report.blockers.includes("visual_repeat_pairs_remaining"));
  assert.equal(report.preparedCommands.requiresApprovalBeforeExecution.length, 0);
  assert.ok(
    !report.approvalQueue.some((item) =>
      /Approve one TikTok official inbox upload test/.test(item.decision),
    ),
  );

  const md = renderTikTokAutomationMarkdown(report);
  assert.match(md, /creative_review_required/);
  assert.match(md, /studio_v2_promotion_red_blocked/);
  assert.doesNotMatch(md, /Requires approval before execution/);
});

test("TikTok automation report favours ready manifest pack over blocked stale fresh proof", () => {
  const report = buildTikTokAutomationReport({
    generatedAt: "2026-05-15T00:30:00.000Z",
    authDoctorReport: {
      token_status: {
        ok: true,
        connected: true,
        reason: "ok",
        expires_in_seconds: 25000,
        refresh_available: true,
        needs_reauth: false,
        local_action: "token_usable",
      },
      posting_capability: {
        public_auto_posting_permitted_by_env: false,
      },
    },
    dispatchManifest: {
      count: 1,
      statusCounts: { ready_for_operator_review: 1 },
      topReadyPack: {
        storyId: "rss_ready",
        status: "ready_for_operator_review",
        mp4: "D:/pulse-data/media/output/final/rss_ready.mp4",
        cover: "D:/pulse-data/media/output/images/rss_ready.png",
        eligibility: {
          durationSeconds: 68.2,
          captionReady: true,
          dispatchLengthReady: true,
        },
      },
    },
    freshDispatchPack: {
      dispatchPack: {
        storyId: "stale_studio_v2",
        status: "creative_review_required",
        eligibility: {
          durationSeconds: 74.67,
          captionReady: true,
          dispatchLengthReady: true,
        },
        creativeGate: {
          blocks_dispatch: true,
          blockers: ["weak_rendered_frames_remaining"],
        },
      },
      inboxPlan: {
        status: "not_ready",
        dry_run: true,
        will_upload_to_tiktok: false,
        blockers: ["dispatch_pack_creative_review_required"],
      },
      creativeReview: {
        operator_visual_review_required: true,
        blockers: ["weak_rendered_frames_remaining"],
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
  assert.equal(report.dispatchGate.source, "dispatch_manifest");
  assert.equal(report.dispatchGate.topPack.storyId, "rss_ready");
  assert.equal(report.noPostReadiness.dispatchCreative.status, "ready_for_operator_visual_review");
  assert.equal(report.noPostReadiness.dispatchCreative.storyId, "rss_ready");
  assert.deepEqual(report.noPostReadiness.dispatchCreative.blockers, []);
  assert.equal(report.dispatchGate.topReadyPack.storyId, "rss_ready");
  assert.deepEqual(report.dispatchGate.legacyManifestWarnings, {});
});

test("TikTok automation report surfaces token plus creative blockers together", () => {
  const report = buildTikTokAutomationReport({
    generatedAt: "2026-05-07T02:30:00.000Z",
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
      count: 2,
      statusCounts: { missing_video: 2 },
    },
    freshDispatchPack: {
      dispatchPack: {
        storyId: "1szzhy9",
        status: "creative_review_required",
        mp4: "test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4",
        cover: "test/output/tiktok-cover-candidates/covers/1szzhy9_12s.jpg",
        eligibility: {
          durationSeconds: 74.67,
          captionReady: true,
          dispatchLengthReady: true,
          creatorRewardsLengthEligible: true,
        },
        creativeGate: {
          blocks_dispatch: true,
          blockers: ["studio_v2_promotion_red_blocked"],
        },
      },
      inboxPlan: {
        status: "not_ready",
        dry_run: true,
        will_upload_to_tiktok: false,
        blockers: ["dispatch_pack_creative_review_required"],
      },
      creativeReview: {
        operator_visual_review_required: true,
        blockers: ["studio_v2_promotion_red_blocked"],
      },
    },
  });

  assert.equal(
    report.recommendedRoute,
    "refresh_or_sync_local_token_then_fix_fresh_dispatch_creative_blockers",
  );
  assert.equal(report.routeStrategy[0].status, "blocked_by_local_token_and_creative_review");
  assert.ok(report.blockers.includes("refresh_or_sync_local_token"));

  const md = renderTikTokAutomationMarkdown(report);
  assert.match(md, /blocked_by_local_token_and_creative_review/);
  assert.doesNotMatch(md, /access_token|refresh_token|Bearer/);
});

test("TikTok automation report keeps a fresh token-blocked pack available for manual dispatch", () => {
  const report = buildTikTokAutomationReport({
    generatedAt: "2026-05-28T22:30:00.000Z",
    authDoctorReport: {
      token_status: {
        ok: false,
        connected: false,
        reason: "expired",
        expires_in_seconds: -900,
        refresh_available: true,
        needs_reauth: false,
        needs_refresh_or_sync: true,
        local_action: "refresh_or_sync_local_token",
      },
    },
    dispatchManifest: {
      count: 1,
      statusCounts: { ready_for_operator_review: 1 },
      topReadyPack: {
        storyId: "stale_manifest_pack",
        status: "ready_for_operator_review",
        mp4: "output/final/stale_manifest_pack.mp4",
        cover: "output/images/stale_manifest_pack.png",
        eligibility: {
          durationSeconds: 60.7,
          captionReady: true,
          dispatchLengthReady: true,
        },
      },
    },
    freshDispatchPack: {
      dispatchPack: {
        storyId: "fresh_clean_pack",
        status: "tiktok_auth_action_required",
        mp4: "output/goal-proof/batch/fresh_clean_pack/tiktok.mp4",
        cover: "test/output/tiktok-fresh-dispatch/fresh_clean_pack_cover.jpg",
        eligibility: {
          durationSeconds: 75.88,
          captionReady: true,
          dispatchLengthReady: true,
          creatorRewardsLengthEligible: true,
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
          warnings: [],
        },
      },
      inboxPlan: {
        status: "not_ready",
        dry_run: true,
        will_upload_to_tiktok: false,
        public_auto_publish: false,
        blockers: ["dispatch_pack_tiktok_auth_action_required"],
      },
      creativeReview: {
        operator_visual_review_required: true,
        blockers: [],
      },
      safety: {
        local_dry_run_only: true,
        live_upload_executed: false,
        public_post_created: false,
      },
    },
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.dispatchGate.source, "fresh_local_dispatch_pack");
  assert.equal(report.dispatchGate.topPack.storyId, "fresh_clean_pack");
  assert.equal(report.dispatchGate.topReadyPack.storyId, "fresh_clean_pack");
  assert.equal(report.noPostReadiness.dispatchCreative.status, "ready_for_operator_visual_review");
  assert.deepEqual(report.noPostReadiness.dispatchCreative.blockers, []);
  assert.equal(report.routeStrategy.find((route) => route.id === "manual_phone_workflow").status, "available");
  assert.equal(report.routeStrategy[0].status, "needs_local_token_refresh_or_sync");
  assert.equal(report.recommendedRoute, "fix_local_token_state_then_official_inbox_upload");
  assert.deepEqual(report.blockers, ["refresh_or_sync_local_token"]);
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

test("TikTok automation report labels dispatch token status as a snapshot when auth doctor skips token files", () => {
  const report = buildTikTokAutomationReport({
    authDoctorReport: {
      token_status: null,
      token_status_mode: "skipped_by_operator_flag",
      warnings: ["local_token_status_not_inspected"],
    },
    dispatchManifest: {
      count: 1,
      statusCounts: { missing_video: 1 },
      tiktokTokenGate: {
        ok: false,
        reason: "expired",
        refresh_available: true,
        needs_reauth: false,
        needs_refresh_or_sync: true,
        action: "refresh_or_sync_local_token",
      },
    },
  });

  assert.equal(report.tokenGate.source, "dispatch_manifest_snapshot");
  assert.equal(report.tokenGate.token_status_mode, "skipped_by_operator_flag");

  const md = renderTikTokAutomationMarkdown(report);
  assert.match(md, /source: dispatch_manifest_snapshot/);
  assert.match(md, /auth doctor did not inspect token files/);
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

test("TikTok automation report exposes separate no-post readiness gates", () => {
  const report = buildTikTokAutomationReport({
    generatedAt: "2026-05-13T08:00:00.000Z",
    authDoctorReport: {
      browser_oauth: {
        status: "succeeded",
        completed_at: "2026-05-12T22:10:00.000Z",
        evidence: "operator_handoff",
        access_token: "must-not-leak",
      },
      token_status: {
        ok: false,
        connected: false,
        reason: "expired",
        expires_in_seconds: -900,
        refresh_available: true,
        needs_reauth: false,
        needs_refresh_or_sync: true,
        local_action: "refresh_or_sync_local_token",
        refresh_token: "must-not-leak",
      },
      posting_capability: {
        official_inbox_upload_supported_by_code: true,
        public_auto_posting_permitted_by_env: false,
        public_auto_posting_expected_blocker:
          "app_audit_or_direct_post_approval_not_confirmed",
      },
    },
    freshDispatchPack: {
      dispatchPack: {
        storyId: "creative-story",
        status: "creative_review_required",
        mp4: "test/output/creative-story.mp4",
        cover: "test/output/creative-story.jpg",
        eligibility: {
          durationSeconds: 74.6,
          captionReady: true,
          dispatchLengthReady: true,
        },
        creativeGate: {
          blocks_dispatch: true,
          blockers: ["visual_repeat_pairs_remaining"],
        },
      },
      inboxPlan: {
        status: "not_ready",
        dry_run: true,
        will_upload_to_tiktok: false,
        blockers: ["dispatch_pack_creative_review_required"],
      },
      creativeReview: {
        operator_visual_review_required: true,
        blockers: ["visual_repeat_pairs_remaining"],
      },
      safety: {
        public_post_created: false,
      },
    },
  });

  assert.equal(report.noPostReadiness.browserOAuth.status, "succeeded");
  assert.equal(report.noPostReadiness.browserOAuth.local_token_proven, false);
  assert.equal(report.noPostReadiness.localToken.status, "expired_but_refreshable");
  assert.equal(report.noPostReadiness.localToken.next_action, "refresh_or_sync_local_token");
  assert.equal(report.noPostReadiness.officialInbox.status, "blocked_by_local_token_and_creative_review");
  assert.equal(report.noPostReadiness.directPost.status, "blocked_by_app_review_or_direct_post_approval");
  assert.equal(report.noPostReadiness.dispatchCreative.status, "blocked_by_creative_review");
  assert.equal(report.noPostReadiness.dispatchCreative.storyId, "creative-story");

  const md = renderTikTokAutomationMarkdown(report);
  assert.match(md, /No-Post Readiness Gates/);
  assert.match(md, /Browser OAuth: succeeded/);
  assert.match(md, /Local token: expired_but_refreshable/);
  assert.match(md, /Direct post: blocked_by_app_review_or_direct_post_approval/);
  assert.match(md, /Dispatch creative: blocked_by_creative_review/);
  assert.doesNotMatch(md, /must-not-leak|access_token|refresh_token|Bearer/);
});

test("TikTok automation report recognises auth-doctor browser OAuth success evidence", () => {
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
      operator_actions: [
        "Refresh or sync the local TikTok token before local uploads. Earlier operator/browser OAuth was reported as successful on pulse.orryy.com, but this local proof did not refresh or verify this repo's local token file.",
      ],
    },
    dispatchManifest: {},
  });

  assert.equal(report.noPostReadiness.browserOAuth.status, "reported_success");
  assert.equal(
    report.noPostReadiness.browserOAuth.evidence,
    "auth_doctor_operator_action",
  );
  assert.equal(report.noPostReadiness.localToken.status, "expired_but_refreshable");

  const md = renderTikTokAutomationMarkdown(report);
  assert.match(md, /Browser OAuth: reported_success/);
  assert.match(md, /Local token: expired_but_refreshable/);
});
