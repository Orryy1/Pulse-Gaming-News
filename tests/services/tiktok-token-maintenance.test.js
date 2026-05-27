"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTikTokTokenMaintenancePlan,
  renderTikTokTokenMaintenanceMarkdown,
  sanitiseTokenStatus,
} = require("../../lib/platforms/tiktok-token-maintenance");

test("TikTok token maintenance: usable token needs no mutation", () => {
  const plan = buildTikTokTokenMaintenancePlan({
    ok: true,
    reason: "ok",
    refresh_available: true,
  });

  assert.equal(plan.verdict, "green");
  assert.equal(plan.action, "none");
  assert.equal(plan.mutatesTokenFile, false);
});

test("TikTok token maintenance: expired refreshable token is dry-run by default", () => {
  const plan = buildTikTokTokenMaintenancePlan({
    ok: false,
    reason: "expired",
    refresh_available: true,
    needs_reauth: false,
  });

  assert.equal(plan.verdict, "amber");
  assert.equal(plan.action, "dry_run_refresh_available");
  assert.equal(plan.mutatesTokenFile, false);
});

test("TikTok token maintenance: explicit refresh is the only mutating path", () => {
  const plan = buildTikTokTokenMaintenancePlan(
    {
      ok: false,
      reason: "expired",
      refresh_available: true,
      needs_reauth: false,
    },
    { allowRefresh: true },
  );

  assert.equal(plan.action, "refresh_local_token");
  assert.equal(plan.mutatesTokenFile, true);
});

test("TikTok token maintenance: missing refresh token requires operator OAuth", () => {
  const plan = buildTikTokTokenMaintenancePlan({
    ok: false,
    reason: "token_file_missing",
    refresh_available: false,
    needs_reauth: true,
  });

  assert.equal(plan.verdict, "red");
  assert.equal(plan.action, "operator_reauth_required");
});

test("TikTok token maintenance report never prints token-shaped values", () => {
  const status = sanitiseTokenStatus({
    ok: false,
    reason: "expired",
    expires_at: 123,
    expires_in_seconds: -10,
    refresh_available: true,
    needs_reauth: false,
    access_token: "secret",
    refresh_token: "secret-refresh",
  });
  const md = renderTikTokTokenMaintenanceMarkdown({
    generated_at: "2026-05-06T00:00:00Z",
    mode: "dry_run",
    verdict: "amber",
    action: "dry_run_refresh_available",
    reason: "expired",
    before: status,
  });

  assert.match(md, /TikTok Token Maintenance/);
  assert.doesNotMatch(md, /secret|refresh-token|access_token|refresh_token/i);
});
