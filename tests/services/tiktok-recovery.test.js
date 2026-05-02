"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

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

  const md = renderTikTokAuthDoctorMarkdown(report);
  assert.match(md, /TikTok Auth Doctor/);
  assert.doesNotMatch(md, /secret-value|aw1234567890abcd/);
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
