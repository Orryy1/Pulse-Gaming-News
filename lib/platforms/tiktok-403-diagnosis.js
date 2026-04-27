"use strict";

function includes(source, pattern) {
  return new RegExp(pattern, "i").test(String(source || ""));
}

function diagnoseTikTok403({ uploadSource = "", privacyTestSource = "", browserFallbackSource = "" } = {}) {
  const combined = [uploadSource, privacyTestSource, browserFallbackSource].join("\n");
  const evidence = {
    unauditedErrorPinned: includes(combined, "unaudited_client_can_only_post_to_private_accounts"),
    publishScopeRequested: includes(uploadSource, "video\\.publish"),
    uploadScopeRequested: includes(uploadSource, "video\\.upload"),
    privacyResolverPresent: includes(uploadSource, "resolveTikTokPrivacyLevel\\(\\)"),
    defaultPublic: includes(uploadSource, "TIKTOK_DEFAULT_PRIVACY_LEVEL\\s*=\\s*[\"']PUBLIC_TO_EVERYONE"),
    selfOnlySupported: includes(uploadSource, "SELF_ONLY"),
    fileUploadUsed: includes(uploadSource, "source\\s*:\\s*[\"']FILE_UPLOAD"),
    pullFromUrlUsed: includes(uploadSource, "PULL_FROM_URL"),
    browserFallbackGated: includes(browserFallbackSource, "TIKTOK_BROWSER_FALLBACK"),
  };

  const likelyBlocker = evidence.unauditedErrorPinned && evidence.defaultPublic
    ? "unaudited_app_public_posting"
    : "unconfirmed_403";

  const blockers = [];
  if (likelyBlocker === "unaudited_app_public_posting") {
    blockers.push({
      code: "unaudited_tiktok_app",
      likelihood: "high",
      evidence: "Local code comments and regression tests pin the live error `unaudited_client_can_only_post_to_private_accounts` for PUBLIC_TO_EVERYONE posts.",
    });
  }
  if (!evidence.publishScopeRequested || !evidence.uploadScopeRequested) {
    blockers.push({
      code: "missing_scope_in_auth_url",
      likelihood: "high",
      evidence: "The local authorise URL source does not contain both video.publish and video.upload.",
    });
  } else {
    blockers.push({
      code: "missing_scope_in_auth_url",
      likelihood: "low",
      evidence: "The local authorise URL requests user.info.basic, video.publish and video.upload.",
    });
  }
  if (evidence.fileUploadUsed && !evidence.pullFromUrlUsed) {
    blockers.push({
      code: "url_ownership_verification",
      likelihood: "low",
      evidence: "The current uploader uses FILE_UPLOAD, not PULL_FROM_URL, so URL ownership is unlikely to explain this path.",
    });
  }
  blockers.push({
    code: "expired_or_wrong_token",
    likelihood: "unknown",
    evidence: "This diagnosis did not read live tokens or trigger OAuth. Existing tests cover token shape and expiry handling only.",
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "read-only-static-code-diagnosis",
    likelyBlocker,
    evidence,
    blockers,
    smallestSafeNextStep:
      "Verify TikTok developer-app audit status and token scope in the dashboard/read-only status path. Do not trigger OAuth or post from this diagnostic.",
    fileUploadRecommendation: evidence.fileUploadUsed
      ? "FILE_UPLOAD is already the active upload method; do not switch to PULL_FROM_URL for this 403."
      : "Investigate FILE_UPLOAD as the safer later replacement for URL pull, after audit and scope status are confirmed.",
    forbiddenActionsAvoided: [
      "no OAuth flow",
      "no token mutation",
      "no TikTok post",
      "no browser-cookie automation",
      "no production config change",
    ],
  };
}

function renderTikTokDiagnosisMarkdown(report) {
  const lines = [];
  lines.push("# TikTok 403 Diagnosis");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push("");
  lines.push("## Likely blocker");
  lines.push(`- ${report.likelyBlocker}`);
  lines.push("");
  lines.push("## Evidence");
  for (const [key, value] of Object.entries(report.evidence)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Blocker assessment");
  for (const blocker of report.blockers) {
    lines.push(`- ${blocker.code}: ${blocker.likelihood}. ${blocker.evidence}`);
  }
  lines.push("");
  lines.push("## Smallest safe next step");
  lines.push(`- ${report.smallestSafeNextStep}`);
  lines.push("");
  lines.push("## FILE_UPLOAD");
  lines.push(`- ${report.fileUploadRecommendation}`);
  lines.push("");
  lines.push("## Safety");
  for (const action of report.forbiddenActionsAvoided) {
    lines.push(`- ${action}`);
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  diagnoseTikTok403,
  renderTikTokDiagnosisMarkdown,
};
