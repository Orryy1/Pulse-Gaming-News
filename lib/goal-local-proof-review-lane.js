"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("fs-extra");

const execFileAsync = promisify(execFile);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeSlug(value) {
  return clean(value).replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "story";
}

function normaliseFrameTimes(value) {
  const values = Array.isArray(value) ? value : [value];
  const times = values
    .filter((time) => time !== null && time !== undefined && time !== "")
    .map((time) => Number(time))
    .filter((time) => Number.isFinite(time) && time >= 0)
    .map((time) => Math.round(time * 10) / 10);
  return times.length ? Array.from(new Set(times)) : [0, 1.5, 3];
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

async function defaultExtractVideoFrame({ inputPath, outputPath, timeS, ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg" } = {}) {
  if (!inputPath || !outputPath) throw new Error("extractVideoFrame requires inputPath and outputPath");
  await fs.ensureDir(path.dirname(outputPath));
  await execFileAsync(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(timeS || 0),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=540:960:force_original_aspect_ratio=increase,crop=540:960",
    "-q:v",
    "2",
    outputPath,
  ], { windowsHide: true });
  return outputPath;
}

async function defaultBuildContactSheet({ images, outPath } = {}) {
  const { buildThumbnailContactSheet } = require("./thumbnail-candidate");
  return buildThumbnailContactSheet({ images, outPath });
}

function ratio(count, total) {
  return total > 0 ? count / total : 0;
}

function roundMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10000) / 10000 : 0;
}

function isTextLikePixel(r, g, b) {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const contrast = max - min;
  const whiteText = luma >= 185 && contrast <= 95;
  const orangeText = r >= 180 && g >= 70 && g <= 180 && b <= 120;
  const cyanText = b >= 150 && g >= 120 && r <= 130;
  return whiteText || orangeText || cyanText;
}

async function defaultAnalyseReviewFrame({ framePath, storyId, timeS } = {}) {
  const sharp = require("sharp");
  const image = sharp(framePath);
  const metadata = await image.metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height) {
    return {
      story_id: storyId,
      time_s: timeS,
      path: framePath,
      verdict: "blocked",
      blockers: ["frame_audit_metadata_missing"],
      risk_flags: [],
      metrics: {},
    };
  }

  const channels = 3;
  const raw = await image.removeAlpha().raw().toBuffer();
  const edgePx = Math.max(8, Math.round(width * 0.035));
  const bottomPx = Math.max(18, Math.round(height * 0.055));
  const captionTop = Math.round(height * 0.66);
  const lowerThirdTop = Math.round(height * 0.78);

  const regions = {
    edge: { text: 0, total: 0 },
    bottomEdge: { text: 0, total: 0 },
    captionBand: { text: 0, total: 0 },
    lowerThirdBand: { text: 0, total: 0 },
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const textLike = isTextLikePixel(raw[idx], raw[idx + 1], raw[idx + 2]);
      const inEdge = x < edgePx || x >= width - edgePx;
      const inBottomEdge = y >= height - bottomPx;
      const inCaptionBand = y >= captionTop;
      const inLowerThirdBand = y >= lowerThirdTop;
      if (inEdge) {
        regions.edge.total++;
        if (textLike) regions.edge.text++;
      }
      if (inBottomEdge) {
        regions.bottomEdge.total++;
        if (textLike) regions.bottomEdge.text++;
      }
      if (inCaptionBand) {
        regions.captionBand.total++;
        if (textLike) regions.captionBand.text++;
      }
      if (inLowerThirdBand) {
        regions.lowerThirdBand.total++;
        if (textLike) regions.lowerThirdBand.text++;
      }
    }
  }

  const metrics = {
    edge_text_like_ratio: roundMetric(ratio(regions.edge.text, regions.edge.total)),
    bottom_edge_text_like_ratio: roundMetric(ratio(regions.bottomEdge.text, regions.bottomEdge.total)),
    caption_band_text_like_ratio: roundMetric(ratio(regions.captionBand.text, regions.captionBand.total)),
    lower_third_text_like_ratio: roundMetric(ratio(regions.lowerThirdBand.text, regions.lowerThirdBand.total)),
  };
  const riskFlags = [];
  const blockers = [];
  if (
    metrics.caption_band_text_like_ratio >= 0.018 &&
    (metrics.edge_text_like_ratio >= 0.012 || metrics.bottom_edge_text_like_ratio >= 0.012)
  ) {
    blockers.push("frame_text_cutoff_risk");
    riskFlags.push("text_like_pixels_near_frame_edge");
  }
  if (
    metrics.caption_band_text_like_ratio >= 0.035 &&
    metrics.lower_third_text_like_ratio >= 0.025
  ) {
    blockers.push("caption_overlay_collision_risk");
    riskFlags.push("dense_text_like_pixels_in_caption_and_lower_third_band");
  }

  return {
    story_id: storyId,
    time_s: timeS,
    path: framePath,
    verdict: blockers.length ? "blocked" : riskFlags.length ? "review" : "pass",
    blockers,
    risk_flags: riskFlags,
    metrics,
  };
}

async function buildVisualReviewManifest({
  videos = [],
  generatedAt,
  visualReviewDir,
  frameTimesS,
  deps = {},
} = {}) {
  const outDir = path.resolve(visualReviewDir || path.join(process.cwd(), "output", "goal-contract", "local-proof-visual-review"));
  const times = normaliseFrameTimes(frameTimesS);
  const extractVideoFrame = deps.extractVideoFrame || defaultExtractVideoFrame;
  const buildContactSheet = deps.buildContactSheet || defaultBuildContactSheet;
  const analyseReviewFrame = deps.analyseReviewFrame || defaultAnalyseReviewFrame;
  const frames = [];
  const frameAudit = [];
  const blockers = [];
  await fs.ensureDir(outDir);

  for (const video of asArray(videos)) {
    const storyId = clean(video.story_id);
    const inputPath = clean(video.video_path);
    if (!storyId || !inputPath) continue;
    for (const timeS of times) {
      const suffix = String(timeS).replace(".", "_");
      const framePath = path.join(outDir, `${safeSlug(storyId)}__t${suffix}.jpg`);
      try {
        await extractVideoFrame({ inputPath, outputPath: framePath, timeS });
        const evidence = await fileEvidence(framePath);
        if (!evidence.exists || evidence.size_bytes <= 0) {
          blockers.push(`${storyId}:frame_missing_t${timeS}`);
        } else {
          try {
            const audit = await analyseReviewFrame({ framePath: evidence.path, storyId, timeS });
            frameAudit.push(audit);
            for (const blocker of asArray(audit.blockers)) {
              blockers.push(`${storyId}:${blocker}_t${timeS}`);
            }
          } catch (err) {
            blockers.push(`${storyId}:frame_audit_failed_t${timeS}`);
            frameAudit.push({
              story_id: storyId,
              time_s: timeS,
              path: evidence.path,
              verdict: "blocked",
              blockers: ["frame_audit_failed"],
              risk_flags: [],
              error: clean(err.message),
            });
          }
        }
        frames.push({
          story_id: storyId,
          title: clean(video.title),
          time_s: timeS,
          path: evidence.path,
          exists: evidence.exists,
          size_bytes: evidence.size_bytes,
        });
      } catch (err) {
        blockers.push(`${storyId}:frame_extract_failed_t${timeS}`);
        frames.push({
          story_id: storyId,
          title: clean(video.title),
          time_s: timeS,
          path: framePath,
          exists: false,
          size_bytes: 0,
          error: clean(err.message),
        });
      }
    }
  }

  const contactSheetPath = path.join(outDir, "local_proof_first_seconds_contact_sheet.jpg");
  let sheetPath = null;
  try {
    sheetPath = await buildContactSheet({
      images: frames.filter((frame) => frame.exists).map((frame) => frame.path),
      outPath: contactSheetPath,
    });
    const sheetEvidence = await fileEvidence(sheetPath);
    if (!sheetEvidence.exists || sheetEvidence.size_bytes <= 0) blockers.push("contact_sheet_missing");
  } catch (err) {
    blockers.push("contact_sheet_build_failed");
  }

  const sheetEvidence = await fileEvidence(sheetPath || contactSheetPath);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF_VISUAL_REVIEW",
    status: blockers.length ? "blocked" : "ready",
    blockers: Array.from(new Set(blockers)),
    frame_times_s: times,
    frames,
    frame_audit: frameAudit,
    frame_count: frames.length,
    contact_sheet_path: sheetEvidence.path,
    contact_sheet_exists: sheetEvidence.exists,
    contact_sheet_size_bytes: sheetEvidence.size_bytes,
    required_operator_checks: [
      "inspect_first_frame_subject_clarity",
      "inspect_first_three_seconds_text_fit",
      "inspect_card_design_quality",
      "inspect_caption_and_overlay_overlap",
      "watch_video_before_approval",
    ],
    safety: {
      local_proof_only: true,
      live_publish_allowed: false,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
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
  buildVisualReviewSheet = false,
  visualReviewDir = null,
  frameTimesS = [0, 1.5, 3],
  deps = {},
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
  const visualReviewManifest = buildVisualReviewSheet
    ? await buildVisualReviewManifest({
        videos,
        generatedAt,
        visualReviewDir,
        frameTimesS,
        deps,
      })
    : null;
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
      visual_review_frame_count: Number(visualReviewManifest?.frame_count || 0),
      visual_review_status: visualReviewManifest?.status || "not_requested",
      safe_to_publish_boolean: false,
    },
    local_test_video_manifest: localTestVideoManifest,
    visual_review_manifest: visualReviewManifest,
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
  if (report.visual_review_manifest?.contact_sheet_path) {
    lines.push("## First-seconds visual review");
    lines.push(`Status: ${report.visual_review_manifest.status}`);
    lines.push(`Contact sheet: ${report.visual_review_manifest.contact_sheet_path}`);
    lines.push(`Frames: ${Number(report.visual_review_manifest.frame_count || 0)}`);
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
  const visualReviewManifestPath = path.join(outDir, "visual_review_manifest.json");
  await fs.writeJson(summaryPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalLocalProofReviewLaneMarkdown(report), "utf8");
  await fs.writeJson(localTestVideoManifestPath, report.local_test_video_manifest || {}, { spaces: 2 });
  await fs.writeJson(testRenderReviewPackPath, report.test_render_review_pack || {}, { spaces: 2 });
  await fs.writeJson(operatorFeedbackLogPath, report.operator_feedback_log || {}, { spaces: 2 });
  await fs.writeJson(testRenderQaReportPath, report.test_render_qa_report || {}, { spaces: 2 });
  if (report.visual_review_manifest) {
    await fs.writeJson(visualReviewManifestPath, report.visual_review_manifest, { spaces: 2 });
  }
  return {
    outputDir: outDir,
    summaryPath,
    markdownPath,
    localTestVideoManifestPath,
    testRenderReviewPackPath,
    operatorFeedbackLogPath,
    testRenderQaReportPath,
    visualReviewManifestPath: report.visual_review_manifest ? visualReviewManifestPath : null,
  };
}

module.exports = {
  buildGoalLocalProofReviewLane,
  buildVisualReviewManifest,
  renderGoalLocalProofReviewLaneMarkdown,
  writeGoalLocalProofReviewLane,
};
