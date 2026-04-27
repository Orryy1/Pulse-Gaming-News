"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  diagnoseTikTok403,
  renderTikTokDiagnosisMarkdown,
} = require("../../lib/platforms/tiktok-403-diagnosis");

test("TikTok diagnosis identifies the pinned unaudited app blocker", () => {
  const report = diagnoseTikTok403({
    uploadSource: `
      const scope = "user.info.basic,video.publish,video.upload";
      const TIKTOK_DEFAULT_PRIVACY_LEVEL = "PUBLIC_TO_EVERYONE";
      privacy_level: resolveTikTokPrivacyLevel(),
      source: "FILE_UPLOAD",
      const TIKTOK_ALLOWED_PRIVACY_LEVELS = new Set(["SELF_ONLY"]);
    `,
    privacyTestSource: "unaudited_client_can_only_post_to_private_accounts",
    browserFallbackSource: "TIKTOK_BROWSER_FALLBACK",
  });
  assert.equal(report.likelyBlocker, "unaudited_app_public_posting");
  assert.equal(report.evidence.fileUploadUsed, true);
  assert.equal(report.evidence.pullFromUrlUsed, false);
  assert.match(report.fileUploadRecommendation, /already/);
});

test("TikTok diagnosis markdown is read-only and explicit", () => {
  const md = renderTikTokDiagnosisMarkdown(
    diagnoseTikTok403({
      uploadSource: 'const scope = "video.publish,video.upload"; source: "FILE_UPLOAD";',
    }),
  );
  assert.match(md, /TikTok 403 Diagnosis/);
  assert.match(md, /no OAuth flow/);
  assert.match(md, /no TikTok post/);
});
