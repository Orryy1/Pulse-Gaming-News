"use strict";

const path = require("node:path");
const fs = require("fs-extra");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function fileEvidence(filePath) {
  const resolved = clean(filePath);
  if (!resolved) {
    return { path: "", exists: false, size_bytes: 0 };
  }
  try {
    const stat = await fs.stat(resolved);
    return { path: resolved, exists: stat.isFile(), size_bytes: stat.isFile() ? stat.size : 0 };
  } catch {
    return { path: resolved, exists: false, size_bytes: 0 };
  }
}

function reviewVideoFromItem(item = {}, qa = {}) {
  return {
    story_id: clean(item.story_id),
    title: clean(item.public_copy?.title || item.story_id),
    render_kind: "local_proof_review_video",
    publish_status: "not_publishable_local_proof",
    video_path: clean(item.evidence?.video_path),
    captions_path: clean(item.evidence?.captions_path),
    first_frame_source: clean(item.evidence?.first_frame_source),
    enabled_review_platforms: asArray(item.enabled_review_platforms),
    deferred_platforms: asArray(item.deferred_platforms),
    qa_status: qa.status || "unknown",
    blockers: asArray(qa.blockers),
    safety: {
      can_count_as_final_production_render: false,
      live_publish_allowed: false,
      requires_cutover_bridge_before_publish: true,
    },
  };
}

function reviewPackItem(item = {}, qa = {}) {
  return {
    story_id: clean(item.story_id),
    title: clean(item.public_copy?.title || item.story_id),
    verdict: clean(item.full_platform_verdict || "AMBER"),
    public_copy: item.public_copy || {},
    source_list: item.source_list || {},
    artefacts: {
      video_path: clean(item.evidence?.video_path),
      first_frame_source: clean(item.evidence?.first_frame_source),
      captions_path: clean(item.evidence?.captions_path),
      canonical_manifest_path: clean(item.evidence?.canonical_manifest_path),
      platform_publish_manifest_path: clean(item.evidence?.platform_publish_manifest_path),
    },
    qa_status: qa.status || "unknown",
    operator_checks: [
      "watch_video_before_any_publish_approval",
      "verify_hook_and_first_frame_are_strong",
      "verify_subtitles_track_the_voice",
      "verify_sfx_fit_the_story_and_do_not_overpower_voice",
      "verify_cards_and_text_are_not_cut_off",
      "record_feedback_before_rerender_or_approval",
    ],
    publish_boundary: {
      local_proof_only: true,
      live_publish_allowed: false,
    },
  };
}

async function qaItemForReview(item = {}) {
  const video = await fileEvidence(item.evidence?.video_path);
  const captions = await fileEvidence(item.evidence?.captions_path);
  const blockers = [];
  if (!video.exists || video.size_bytes <= 0) blockers.push("local_proof_video_missing");
  if (!captions.exists || captions.size_bytes <= 0) blockers.push("local_proof_captions_missing");
  return {
    story_id: clean(item.story_id),
    status: blockers.length ? "blocked" : "pass",
    blockers,
    file_evidence: {
      video_path: video.path,
      video_exists: video.exists,
      video_size_bytes: video.size_bytes,
      captions_path: captions.path,
      captions_exists: captions.exists,
      captions_size_bytes: captions.size_bytes,
    },
    safety: {
      local_proof_only: true,
      live_publish_allowed: false,
      can_count_as_final_production_render: false,
    },
  };
}

function buildOperatorFeedbackLog({ generatedAt } = {}) {
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF_OPERATOR_FEEDBACK",
    decisions: [],
    feedback_template: {
      story_id: "",
      operator: "",
      watched_video_path: "",
      hook_feedback: "",
      subtitle_timing_feedback: "",
      sfx_feedback: "",
      card_text_feedback: "",
      decision: "approve_for_human_review | request_rerender | reject",
      decided_at: "",
    },
    safety: {
      no_live_publish_from_feedback_log: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

async function buildGoalLocalProofReviewLane({
  humanReviewQueue = {},
  generatedAt = new Date().toISOString(),
  maxItems = 30,
} = {}) {
  const sourceItems = asArray(humanReviewQueue.review_items).slice(0, Math.max(0, Number(maxItems) || 0));
  const qaItems = [];
  const videos = [];
  const reviewItems = [];
  for (const item of sourceItems) {
    const qa = await qaItemForReview(item);
    qaItems.push(qa);
    if (qa.status === "pass") videos.push(reviewVideoFromItem(item, qa));
    reviewItems.push(reviewPackItem(item, qa));
  }
  const blockedItems = qaItems.filter((item) => item.status !== "pass");
  const localTestVideoManifest = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    videos,
    safety: {
      local_proof_only: true,
      no_live_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
  const testRenderReviewPack = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF_REVIEW",
    items: reviewItems,
    safety: localTestVideoManifest.safety,
  };
  const testRenderQaReport = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF_QA",
    items: qaItems,
    summary: {
      checked_video_count: qaItems.length,
      pass_count: qaItems.filter((item) => item.status === "pass").length,
      blocked_count: blockedItems.length,
    },
    safety: localTestVideoManifest.safety,
  };
  const operatorFeedbackLog = buildOperatorFeedbackLog({ generatedAt });
  const safePublishPlan = {
    schema_version: 1,
    generated_at: generatedAt,
    can_publish_from_local_proof: false,
    required_next_step: "operator_watch_local_proof_then_request_rerender_or_human_review",
    live_publish_ready_story_count: 0,
  };
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF_REVIEW",
    summary: {
      review_video_count: videos.length,
      blocked_video_count: blockedItems.length,
      source_human_review_items: sourceItems.length,
      safe_to_publish_boolean: false,
    },
    local_test_video_manifest: localTestVideoManifest,
    test_render_review_pack: testRenderReviewPack,
    operator_feedback_log: operatorFeedbackLog,
    test_render_qa_report: testRenderQaReport,
    safe_publish_plan: safePublishPlan,
    safety: {
      no_live_publish: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function renderGoalLocalProofReviewLaneMarkdown(report = {}) {
  const lines = [
    "# Local Proof Review Lane",
    "",
    `Generated: ${clean(report.generated_at)}`,
    `Review videos: ${Number(report.summary?.review_video_count || 0)}`,
    `Blocked videos: ${Number(report.summary?.blocked_video_count || 0)}`,
    "No uploads are triggered. Local proof videos are review artefacts, not publishable renders.",
    "",
  ];
  for (const video of asArray(report.local_test_video_manifest?.videos)) {
    lines.push(`## ${video.title || video.story_id}`);
    lines.push(`Story: ${video.story_id}`);
    lines.push(`Video: ${video.video_path}`);
    lines.push(`QA: ${video.qa_status}`);
    lines.push("Publish status: not_publishable_local_proof");
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function writeGoalLocalProofReviewLane(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalLocalProofReviewLane requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const summaryPath = path.join(outDir, "local_proof_review_lane.json");
  const markdownPath = path.join(outDir, "local_proof_review_lane.md");
  const localTestVideoManifestPath = path.join(outDir, "local_test_video_manifest.json");
  const testRenderReviewPackPath = path.join(outDir, "test_render_review_pack.json");
  const operatorFeedbackLogPath = path.join(outDir, "operator_feedback_log.json");
  const testRenderQaReportPath = path.join(outDir, "test_render_qa_report.json");
  await fs.writeJson(summaryPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalLocalProofReviewLaneMarkdown(report), "utf8");
  await fs.writeJson(localTestVideoManifestPath, report.local_test_video_manifest || {}, { spaces: 2 });
  await fs.writeJson(testRenderReviewPackPath, report.test_render_review_pack || {}, { spaces: 2 });
  await fs.writeJson(operatorFeedbackLogPath, report.operator_feedback_log || {}, { spaces: 2 });
  await fs.writeJson(testRenderQaReportPath, report.test_render_qa_report || {}, { spaces: 2 });
  return {
    outputDir: outDir,
    summaryPath,
    markdownPath,
    localTestVideoManifestPath,
    testRenderReviewPackPath,
    operatorFeedbackLogPath,
    testRenderQaReportPath,
  };
}

module.exports = {
  buildGoalLocalProofReviewLane,
  renderGoalLocalProofReviewLaneMarkdown,
  writeGoalLocalProofReviewLane,
};
