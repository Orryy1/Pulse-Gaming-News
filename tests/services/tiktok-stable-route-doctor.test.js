"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildTikTokStableRouteDoctor,
  renderTikTokStableRouteDoctorMarkdown,
} = require("../../tools/tiktok-stable-route-doctor");

const ROOT = path.resolve(__dirname, "..", "..");

function readyAutomationReport(overrides = {}) {
  return {
    noPostReadiness: {
      browserOAuth: {
        status: "succeeded",
        local_token_proven: true,
        local_token_status: "usable",
      },
      dispatchCreative: {
        status: "ready_for_operator_visual_review",
        storyId: "rss_ready",
        blockers: [],
      },
    },
    dispatchGate: {
      topReadyPack: {
        storyId: "rss_ready",
        status: "ready_for_operator_review",
        durationSeconds: 68.2,
        mp4: "D:/pulse-data/media/output/final/rss_ready.mp4",
        cover: "D:/pulse-data/media/output/images/rss_ready.png",
      },
      topPack: {
        storyId: "rss_ready",
        status: "ready_for_operator_review",
        durationSeconds: 68.2,
      },
    },
    routeStrategy: [
      {
        id: "official_inbox_upload",
        status: "ready_for_operator_review_not_executed",
      },
    ],
    ...overrides,
  };
}

test("TikTok stable route doctor chooses official inbox when direct posting is not approved", () => {
  const report = buildTikTokStableRouteDoctor({
    generatedAt: "2026-05-16T09:00:00.000Z",
    env: {
      TIKTOK_CLIENT_KEY: "client",
      TIKTOK_CLIENT_SECRET: "secret",
      TIKTOK_DIRECT_POST_APPROVED: "false",
    },
    tokenStatus: {
      ok: true,
      reason: "ok",
      refresh_available: true,
      needs_reauth: false,
      expires_in_seconds: 36000,
      access_token: "must-not-leak",
    },
    automationReport: readyAutomationReport(),
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.selected_route, "official_inbox_upload");
  assert.equal(report.routes.official_api.status, "blocked_until_direct_post_approval");
  assert.equal(report.routes.official_inbox.status, "ready_pending_explicit_operator_approval");
  assert.equal(report.routes.manual_dispatch.status, "ready_available");
  assert.equal(report.token_action, "none");
  assert.match(report.recommended_next_action, /tiktok:inbox-upload -- --story rss_ready/);

  const markdown = renderTikTokStableRouteDoctorMarkdown(report);
  assert.match(markdown, /Selected route: official_inbox_upload/);
  assert.match(markdown, /no OAuth triggered/i);
  assert.doesNotMatch(markdown, /must-not-leak|access_token|refresh_token|Bearer/);
});

test("TikTok stable route doctor keeps manual dispatch available while official routes need token sync", () => {
  const report = buildTikTokStableRouteDoctor({
    env: { TIKTOK_DIRECT_POST_APPROVED: "true" },
    tokenStatus: {
      ok: false,
      reason: "expired",
      refresh_available: true,
      needs_reauth: false,
      expires_in_seconds: -120,
      refresh_token: "must-not-leak",
    },
    automationReport: readyAutomationReport(),
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.selected_route, "manual_dispatch");
  assert.equal(report.token_action, "refresh_or_sync_local_token");
  assert.equal(report.routes.official_api.status, "blocked_by_local_token_refresh_or_sync");
  assert.equal(report.routes.official_inbox.status, "blocked_by_local_token_refresh_or_sync");
  assert.equal(report.routes.manual_dispatch.status, "ready_available");
  assert.match(report.recommended_next_action, /manual dispatch/i);
  assert.match(report.recommended_next_action, /tiktok:token -- --dry-run/);
});

test("TikTok stable route doctor requires re-auth when no token route or pack is ready", () => {
  const report = buildTikTokStableRouteDoctor({
    tokenStatus: {
      ok: false,
      reason: "token_file_missing",
      refresh_available: false,
      needs_reauth: true,
    },
    automationReport: {},
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.selected_route, "needs_reauth");
  assert.equal(report.token_action, "operator_reauth_required");
  assert.equal(report.routes.official_api.status, "blocked_by_operator_reauth_required");
  assert.equal(report.routes.official_inbox.status, "blocked_by_operator_reauth_required");
  assert.equal(report.routes.manual_dispatch.status, "needs_ready_dispatch_pack");
  assert.match(report.recommended_next_action, /npm run tiktok:auth-doctor/);
});

test("TikTok stable route doctor marks official API as a controlled candidate only when approval is declared", () => {
  const report = buildTikTokStableRouteDoctor({
    env: {
      TIKTOK_DIRECT_POST_APPROVED: "true",
      TIKTOK_ENABLED: "true",
      TIKTOK_AUTO_UPLOAD_ENABLED: "true",
    },
    tokenStatus: {
      ok: true,
      reason: "ok",
      refresh_available: true,
      needs_reauth: false,
    },
    automationReport: readyAutomationReport(),
  });

  assert.equal(report.selected_route, "official_api");
  assert.equal(report.routes.official_api.status, "candidate_requires_controlled_live_proof");
  assert.equal(report.routes.official_api.public_auto_publish, true);
  assert.equal(report.routes.official_inbox.status, "ready_pending_explicit_operator_approval");
  assert.match(report.recommended_next_action, /controlled official API proof/i);
  assert.equal(report.safety.no_uploads, true);
  assert.equal(report.safety.no_browser_automation, true);
});

test("TikTok stable route doctor does not label ready operator-review packs as creative-blocked", () => {
  const report = buildTikTokStableRouteDoctor({
    tokenStatus: { ok: true, reason: "ok" },
    automationReport: readyAutomationReport({
      dispatchGate: {
        topReadyPack: {
          storyId: "fresh_ready",
          status: "ready_for_operator_review",
          durationSeconds: 73.36,
          creativeReviewRequired: true,
        },
      },
    }),
  });

  assert.equal(report.routes.manual_dispatch.status, "ready_available");
  assert.equal(report.dispatch_pack.creative_review_required, false);
  assert.equal(report.dispatch_pack.operator_visual_review_required, true);
});

test("TikTok stable route doctor script is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["tiktok:stable-route-doctor"], "node tools/tiktok-stable-route-doctor.js");

  const tool = fs.readFileSync(path.join(ROOT, "tools", "tiktok-stable-route-doctor.js"), "utf8");
  assert.match(tool, /tiktok_stable_route_doctor\.json/);
  assert.doesNotMatch(tool, /uploadVideoToInbox\(|uploadVideo\(|exchangeCode\(|refreshToken\(|playwright|puppeteer/i);
});
