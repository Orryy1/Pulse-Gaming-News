"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("TikTok auth doctor marks generated OAuth shape valid without exposing secrets", () => {
  const {
    buildTikTokAuthDoctorReport,
    renderTikTokAuthDoctorMarkdown,
  } = require("../../lib/platforms/tiktok-auth-doctor");

  const report = buildTikTokAuthDoctorReport({
    env: {
      TIKTOK_CLIENT_KEY: "aw1234567890abcd",
      TIKTOK_CLIENT_SECRET: "secret-value",
      TIKTOK_REDIRECT_URI: "https://pulse.orryy.com/auth/tiktok/callback",
      TIKTOK_DIRECT_POST_APPROVED: "false",
    },
    publicUrl: "https://pulse.orryy.com",
    now: "2026-05-02T12:00:00.000Z",
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.oauth.generated_url_shape, "valid");
  assert.equal(report.oauth.scope_separator, "comma");
  assert.deepEqual(report.oauth.required_scopes_missing, []);
  assert.equal(report.credentials.client_key.present, true);
  assert.equal(report.credentials.client_key.value, undefined);
  assert.equal(report.credentials.client_secret.value, undefined);
  assert.ok(report.operator_actions.some((a) => /same TikTok app/.test(a)));
  assert.ok(report.operator_actions.some((a) => /Draft\/Staging/.test(a)));

  const md = renderTikTokAuthDoctorMarkdown(report);
  assert.match(md, /TikTok Auth Doctor/);
  assert.doesNotMatch(md, /secret-value|aw1234567890abcd/);
});

test("TikTok auth doctor reports OAuth token health without exposing token values", () => {
  const {
    buildTikTokAuthDoctorReport,
    renderTikTokAuthDoctorMarkdown,
  } = require("../../lib/platforms/tiktok-auth-doctor");

  const report = buildTikTokAuthDoctorReport({
    env: {
      TIKTOK_CLIENT_KEY: "aw1234567890abcd",
      TIKTOK_CLIENT_SECRET: "secret-value",
      TIKTOK_REDIRECT_URI: "https://pulse.orryy.com/auth/tiktok/callback",
    },
    tokenStatus: {
      ok: true,
      reason: "ok",
      expires_in_seconds: 50_000,
      refresh_available: true,
      needs_reauth: false,
      access_token: "should-not-print",
    },
  });

  assert.equal(report.token_status.ok, true);
  assert.equal(report.token_status.reason, "ok");
  assert.equal(report.token_status.connected, true);
  assert.equal(report.token_status.access_token, undefined);

  const md = renderTikTokAuthDoctorMarkdown(report);
  assert.match(md, /OAuth Token/);
  assert.match(md, /Connected: true/);
  assert.match(md, /Needs re-auth: false/);
  assert.doesNotMatch(md, /should-not-print|secret-value|aw1234567890abcd/);
});

test("TikTok auth doctor can explicitly skip local token inspection", () => {
  const {
    buildTikTokAuthDoctorReport,
    renderTikTokAuthDoctorMarkdown,
  } = require("../../lib/platforms/tiktok-auth-doctor");

  const report = buildTikTokAuthDoctorReport({
    env: {
      TIKTOK_CLIENT_KEY: "aw1234567890abcd",
      TIKTOK_CLIENT_SECRET: "secret-value",
      TIKTOK_REDIRECT_URI: "https://pulse.orryy.com/auth/tiktok/callback",
    },
    tokenStatus: null,
    tokenStatusMode: "skipped_by_operator_flag",
  });

  assert.equal(report.token_status, null);
  assert.equal(report.token_status_mode, "skipped_by_operator_flag");
  assert.ok(report.warnings.includes("local_token_status_not_inspected"));

  const md = renderTikTokAuthDoctorMarkdown(report);
  assert.match(md, /Token status mode: skipped_by_operator_flag/);
  assert.match(md, /OAuth token: not inspected/);
  assert.doesNotMatch(md, /secret-value|aw1234567890abcd/);
});

test("TikTok auth doctor CLI exposes a no-token shape-only mode", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "tiktok-auth-doctor.js"),
    "utf8",
  );

  assert.match(source, /--no-token/);
  assert.match(source, /--shape-only/);
  assert.match(source, /inspectLocalToken/);
  assert.match(source, /skipped_by_operator_flag/);
});

test("TikTok auth doctor does not keep dashboard client-key warning after token is usable", () => {
  const { buildTikTokAuthDoctorReport } = require("../../lib/platforms/tiktok-auth-doctor");

  const report = buildTikTokAuthDoctorReport({
    env: {
      TIKTOK_CLIENT_KEY: "aw1234567890abcd",
      TIKTOK_CLIENT_SECRET: "secret-value",
      TIKTOK_REDIRECT_URI: "https://pulse.orryy.com/auth/tiktok/callback",
    },
    tokenStatus: {
      ok: true,
      reason: "ok",
      expires_in_seconds: 50_000,
      refresh_available: true,
      needs_reauth: false,
    },
  });

  assert.equal(report.token_status.local_action, "token_usable");
  assert.equal(
    report.warnings.includes("dashboard_client_key_error_requires_operator_dashboard_fix"),
    false,
  );
  assert.equal(
    report.operator_actions.some((action) => /same TikTok app\/environment/.test(action)),
    false,
  );
});

test("TikTok auth doctor treats an expired refreshable local token as a sync or refresh action", () => {
  const {
    buildTikTokAuthDoctorReport,
    renderTikTokAuthDoctorMarkdown,
  } = require("../../lib/platforms/tiktok-auth-doctor");

  const report = buildTikTokAuthDoctorReport({
    env: {
      TIKTOK_CLIENT_KEY: "aw1234567890abcd",
      TIKTOK_CLIENT_SECRET: "secret-value",
      TIKTOK_REDIRECT_URI: "https://pulse.orryy.com/auth/tiktok/callback",
    },
    tokenStatus: {
      ok: false,
      reason: "expired",
      expires_in_seconds: -3_600,
      refresh_available: true,
      needs_reauth: false,
      access_token: "expired-access-token",
      refresh_token: "still-secret",
    },
  });

  assert.equal(report.token_status.connected, false);
  assert.equal(report.token_status.needs_reauth, false);
  assert.equal(report.token_status.needs_refresh_or_sync, true);
  assert.equal(report.token_status.local_action, "refresh_or_sync_local_token");
  assert.ok(report.warnings.includes("local_token_expired_but_refreshable"));
  assert.equal(
    report.warnings.includes("dashboard_client_key_error_requires_operator_dashboard_fix"),
    false,
  );
  assert.equal(
    report.operator_actions.some((action) => /same TikTok app\/environment/.test(action)),
    false,
  );
  assert.ok(
    report.operator_actions.some((action) =>
      /refresh or sync the local TikTok token/i.test(action),
    ),
  );

  const md = renderTikTokAuthDoctorMarkdown(report);
  assert.match(md, /Needs refresh or sync: true/);
  assert.match(md, /refresh_or_sync_local_token/);
  assert.doesNotMatch(md, /expired-access-token|still-secret|secret-value|aw1234567890abcd/);
});

test("TikTok auth doctor can include a redacted live client credential probe", async () => {
  const {
    buildTikTokAuthDoctorReport,
    probeTikTokClientCredentials,
    renderTikTokAuthDoctorMarkdown,
  } = require("../../lib/platforms/tiktok-auth-doctor");

  const probe = await probeTikTokClientCredentials({
    env: {
      TIKTOK_CLIENT_KEY: "aw1234567890abcd",
      TIKTOK_CLIENT_SECRET: "secret-value",
    },
    now: "2026-05-02T12:00:00.000Z",
    async postForm(url, body) {
      assert.equal(url, "https://open.tiktokapis.com/v2/oauth/token/");
      assert.match(String(body), /client_key=aw1234567890abcd/);
      return {
        status: 200,
        data: {
          access_token: "redacted-by-report",
          expires_in: 7200,
        },
      };
    },
  });

  assert.equal(probe.verdict, "client_credentials_accepted");
  assert.equal(probe.has_access_token, true);
  assert.equal(probe.client_key_length, 16);
  assert.equal(probe.client_secret_length, 12);
  assert.equal(probe.access_token, undefined);

  const report = buildTikTokAuthDoctorReport({
    env: {
      TIKTOK_CLIENT_KEY: "aw1234567890abcd",
      TIKTOK_CLIENT_SECRET: "secret-value",
      TIKTOK_REDIRECT_URI: "https://pulse.orryy.com/auth/tiktok/callback",
    },
    clientCredentialsProbe: probe,
  });
  const md = renderTikTokAuthDoctorMarkdown(report);
  assert.match(md, /Live Client Credential Probe/);
  assert.match(md, /client_credentials_accepted/);
  assert.doesNotMatch(md, /redacted-by-report|secret-value|aw1234567890abcd/);
});

test("TikTok auth doctor flags missing client key and insecure redirect", () => {
  const { buildTikTokAuthDoctorReport } = require("../../lib/platforms/tiktok-auth-doctor");

  const report = buildTikTokAuthDoctorReport({
    env: {
      TIKTOK_CLIENT_SECRET: "secret-value",
      TIKTOK_REDIRECT_URI: "http://localhost:3001/auth/tiktok/callback",
    },
    publicUrl: "https://pulse.orryy.com",
  });

  assert.equal(report.verdict, "RED");
  assert.ok(report.blockers.includes("client_key_missing"));
  assert.ok(report.blockers.includes("redirect_uri_not_https"));
});

test("TikTok inbox command plan is dry-run by default and send requires explicit flag", () => {
  const {
    buildTikTokInboxCommandPlan,
  } = require("../../lib/platforms/tiktok-inbox-command");

  const dry = buildTikTokInboxCommandPlan({
    story: { id: "s1", title: "Story", exported_path: "output/final/s1.mp4" },
    args: {},
  });
  assert.equal(dry.dry_run, true);
  assert.equal(dry.will_upload_to_tiktok, false);
  assert.equal(dry.route, "official_inbox_upload");

  const send = buildTikTokInboxCommandPlan({
    story: { id: "s1", title: "Story", exported_path: "output/final/s1.mp4" },
    args: { sendInbox: true },
  });
  assert.equal(send.dry_run, false);
  assert.equal(send.will_upload_to_tiktok, true);
  assert.equal(send.public_auto_publish, false);
  assert.equal(send.requires_manual_completion, true);
});

test("TikTok inbox command plan records post-upload inbox status without public posting", () => {
  const {
    buildTikTokInboxCommandPlan,
    renderTikTokInboxCommandMarkdown,
  } = require("../../lib/platforms/tiktok-inbox-command");

  const plan = buildTikTokInboxCommandPlan({
    story: { id: "s1", title: "Story", exported_path: "output/final/s1.mp4" },
    args: { sendInbox: true },
    result: {
      platform: "tiktok_inbox",
      publishId: "v_inbox_file~123",
      status: "SEND_TO_USER_INBOX",
      requiresManualCompletion: true,
    },
    tiktokStatus: {
      status: "SEND_TO_USER_INBOX",
      raw_error_code: "ok",
    },
  });

  assert.equal(plan.public_auto_publish, false);
  assert.equal(plan.completion_state, "sent_to_user_inbox");
  assert.equal(plan.publish_id, "v_inbox_file~123");
  assert.equal(plan.tiktok_status.status, "SEND_TO_USER_INBOX");
  assert.match(plan.discord_summary, /TikTok Inbox/);
  assert.match(plan.discord_summary, /Manual action/);

  const md = renderTikTokInboxCommandMarkdown(plan);
  assert.match(md, /Publish ID: v_inbox_file~123/);
  assert.match(md, /Status: SEND_TO_USER_INBOX/);
  assert.match(md, /Public auto-publish: false/);
});

test("TikTok inbox command plan can check a publish id without another upload", () => {
  const {
    buildTikTokInboxCommandPlan,
    renderTikTokInboxCommandMarkdown,
  } = require("../../lib/platforms/tiktok-inbox-command");

  const plan = buildTikTokInboxCommandPlan({
    args: { publishId: "v_inbox_file~456" },
    tiktokStatus: {
      status: "SEND_TO_USER_INBOX",
      raw_error_code: "ok",
    },
  });

  assert.equal(plan.status_only, true);
  assert.equal(plan.dry_run, true);
  assert.equal(plan.will_upload_to_tiktok, false);
  assert.equal(plan.public_auto_publish, false);
  assert.equal(plan.publish_id, "v_inbox_file~456");
  assert.equal(plan.completion_state, "sent_to_user_inbox");
  assert.equal(plan.blockers.length, 0);

  const md = renderTikTokInboxCommandMarkdown(plan);
  assert.match(md, /Status-only: true/);
  assert.match(md, /TikTok Status: SEND_TO_USER_INBOX/);
});

test("TikTok inbox command plan blocks real upload from auto-selected media", () => {
  const {
    buildTikTokInboxCommandPlan,
  } = require("../../lib/platforms/tiktok-inbox-command");

  const plan = buildTikTokInboxCommandPlan({
    story: { id: "old", title: "Old Story", exported_path: "output/final/old.mp4" },
    args: { sendInbox: true, autoSelected: true },
    mediaInfo: {
      exists: true,
      is_current_render: true,
      reason: "current_render_window_ok",
    },
  });

  assert.equal(plan.will_upload_to_tiktok, false);
  assert.equal(plan.status, "not_ready");
  assert.equal(plan.completion_state, "blocked_before_upload");
  assert.ok(plan.blockers.includes("explicit_story_or_mp4_required"));
});

test("TikTok inbox command plan blocks stale MP4s unless explicitly allowed", () => {
  const {
    buildTikTokInboxCommandPlan,
    renderTikTokInboxCommandMarkdown,
  } = require("../../lib/platforms/tiktok-inbox-command");

  const blocked = buildTikTokInboxCommandPlan({
    story: { id: "s1", title: "Story", exported_path: "output/final/s1.mp4" },
    args: { sendInbox: true },
    mediaInfo: {
      exists: true,
      is_current_render: false,
      age_hours: 120,
      max_age_hours: 36,
      reason: "stale_or_unverified_mp4",
    },
  });

  assert.equal(blocked.will_upload_to_tiktok, false);
  assert.ok(blocked.blockers.includes("stale_or_unverified_mp4"));
  assert.match(renderTikTokInboxCommandMarkdown(blocked), /Current render: false/);

  const allowed = buildTikTokInboxCommandPlan({
    story: { id: "s1", title: "Story", exported_path: "output/final/s1.mp4" },
    args: { sendInbox: true, allowStale: true },
    mediaInfo: {
      exists: true,
      is_current_render: false,
      age_hours: 120,
      max_age_hours: 36,
      reason: "stale_or_unverified_mp4",
    },
  });

  assert.equal(allowed.will_upload_to_tiktok, true);
  assert.ok(allowed.warnings.includes("stale_or_unverified_mp4"));
});
