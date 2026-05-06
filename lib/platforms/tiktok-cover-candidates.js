"use strict";

const {
  classifyTrailerFrameTaste,
} = require("../visual-content-prescan");

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function tasteForCandidate(candidate = {}) {
  const prescan = candidate.prescan || {};
  return prescan.trailer_frame_taste || classifyTrailerFrameTaste(prescan);
}

function scoreTikTokCoverCandidate(candidate = {}, opts = {}) {
  const durationSeconds = numberOrNull(opts.durationSeconds);
  const timestampS = numberOrNull(candidate.timestampS ?? candidate.timestamp_seconds);
  const prescan = candidate.prescan || {};
  const taste = tasteForCandidate(candidate);
  const reasons = [];
  const warnings = [];
  let score = numberOrNull(taste?.score) ?? 50;

  if (candidate.exists === false) reasons.push("cover_file_missing");
  if (timestampS !== null && timestampS < (opts.minStartSeconds ?? 2.5)) {
    reasons.push("too_close_to_start");
  }
  if (
    timestampS !== null &&
    durationSeconds !== null &&
    durationSeconds - timestampS < (opts.minEndPaddingSeconds ?? 2)
  ) {
    reasons.push("too_close_to_end");
  }
  if (taste?.verdict === "fail") reasons.push(taste.reason || "taste_failed");
  if (Number(prescan.white_text_on_dark_likelihood) >= 0.55) {
    reasons.push("white_text_on_dark_card");
  }
  if (Number(prescan.text_overlay_likelihood) >= 0.42) {
    reasons.push("text_heavy_cover");
  }
  if (prescan.likely_is_stock_person === true) {
    reasons.push("stock_or_portrait_risk");
  }

  const edge = numberOrNull(prescan.edge_density) ?? 0;
  const saturation = numberOrNull(prescan.saturation_mean) ?? 0;
  const textOverlay = numberOrNull(prescan.text_overlay_likelihood) ?? 0;
  const darkRatio = numberOrNull(prescan.dark_pixel_ratio) ?? 0;
  const brightRatio = numberOrNull(prescan.bright_pixel_ratio) ?? 0;
  const tags = Array.isArray(taste?.tags) ? taste.tags : [];

  if (tags.includes("gameplay_candidate")) {
    score += 12;
    reasons.push("gameplay_candidate");
  }
  if (edge >= 0.18) {
    score += 8;
    reasons.push("detail_rich");
  }
  if (saturation >= 0.32) {
    score += 8;
    reasons.push("colourful");
  }
  if (textOverlay > 0.25) {
    score -= 12;
    warnings.push("moderate_text_overlay");
  }
  if (darkRatio > 0.68 || brightRatio > 0.5) {
    score -= 10;
    warnings.push("extreme_luma_balance");
  }
  if (prescan.likely_has_face === true) {
    score -= 8;
    warnings.push("possible_face_or_character_focus");
  }
  if (timestampS !== null && timestampS < 10 && !reasons.includes("too_close_to_start")) {
    score -= 10;
    warnings.push("early_trailer_frame");
  }

  const verdict = reasons.some((reason) =>
    [
      "cover_file_missing",
      "too_close_to_start",
      "too_close_to_end",
      "white_text_on_dark_card",
      "text_heavy_cover",
      "stock_or_portrait_risk",
      taste?.reason,
    ].includes(reason),
  )
    ? "reject"
    : "candidate";

  return {
    ...candidate,
    timestampS,
    rawScore: Number(score.toFixed(1)),
    score: Number(Math.max(0, Math.min(100, score)).toFixed(1)),
    verdict,
    reasons: unique(reasons.length ? reasons : [taste?.reason || "cover_candidate"]),
    warnings: unique(warnings),
    taste,
  };
}

function rankTikTokCoverCandidates(candidates = [], opts = {}) {
  const verdictRank = {
    candidate: 0,
    reject: 1,
  };
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => scoreTikTokCoverCandidate(candidate, opts))
    .sort((a, b) => {
      const rankDelta = (verdictRank[a.verdict] ?? 9) - (verdictRank[b.verdict] ?? 9);
      if (rankDelta !== 0) return rankDelta;
      const scoreDelta = Number(b.rawScore ?? b.score ?? 0) - Number(a.rawScore ?? a.score ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      return Number(a.timestampS ?? 9999) - Number(b.timestampS ?? 9999);
    });
}

function buildTikTokCoverCandidateReport({
  storyId = null,
  title = null,
  durationSeconds = null,
  candidates = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const ranked = rankTikTokCoverCandidates(candidates, { durationSeconds });
  const selected = ranked.find((candidate) => candidate.verdict === "candidate") || null;
  return {
    schemaVersion: 1,
    generatedAt,
    storyId,
    title,
    durationSeconds,
    ready: Boolean(selected),
    selected,
    ranked,
    safety: {
      local_only: true,
      no_upload_or_posting_action: true,
      oauth_triggered: false,
      token_mutated: false,
      production_db_mutated: false,
    },
  };
}

function renderTikTokCoverCandidateMarkdown(report) {
  const lines = [];
  lines.push("# TikTok Cover Candidates");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Story: ${report.storyId || "unknown"}`);
  if (report.title) lines.push(`Title: ${report.title}`);
  lines.push(`Ready: ${report.ready}`);
  lines.push(`Selected: ${report.selected?.path || "none"}`);
  lines.push("");
  lines.push("## Ranked Candidates");
  if (!report.ranked?.length) {
    lines.push("- none");
  } else {
    for (const item of report.ranked) {
      lines.push(
        `- ${item.path || "missing"} @ ${item.timestampS ?? "unknown"}s: ${item.verdict} score=${item.score} reasons=${item.reasons.join(", ")}`,
      );
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Local-only cover analysis.");
  lines.push("- No upload or posting action is performed.");
  lines.push("- No token, OAuth, Railway or production DB mutation is performed.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildTikTokCoverCandidateReport,
  rankTikTokCoverCandidates,
  renderTikTokCoverCandidateMarkdown,
  scoreTikTokCoverCandidate,
};
