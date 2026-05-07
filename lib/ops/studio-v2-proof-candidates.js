"use strict";

const {
  officialTrailerFrameRejectReason,
} = require("../controlled-frame-extraction-worker");
const { buildSubjectGraph } = require("../exact-subject-matching");
const { summariseForensicWarnings } = require("../studio/v2/promotion-packet");
const {
  buildFlashLaneFootageBackboneReport,
} = require("../studio/v2/flash-lane-footage-backbone");
const { normaliseText } = require("../text-hygiene");

const EXACT_PREMIUM_MATCHES = new Set([
  "exact_game_match",
  "exact_franchise_match",
  "exact_platform_match",
]);
const FLASH_MIN_EXACT_SUBJECT_ASSETS = 4;
const FLASH_MIN_MOTION_FRAMES = 2;
const FLASH_MIN_VALIDATED_CLIP_REFS = 3;
const FLASH_MIN_VALIDATED_CLIP_SOURCES = 3;
const FLASH_MIN_VALIDATED_ENTITY_COVERAGE = 2;
const FLASH_MIN_SECONDS = 61;
const FLASH_MAX_SECONDS = 75;

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function storyIdOf(item = {}) {
  return item.story_id || item.storyId || item.id || null;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function uniqueStrings(items) {
  return [...new Set(array(items).map((item) => normaliseText(item).trim()).filter(Boolean))];
}

function normaliseLabel(value) {
  return normaliseText(value).trim().toLowerCase();
}

function storyPriority(story = {}) {
  return Number(story.breaking_score || story.score || 0) || 0;
}

function storyApproved(story = {}) {
  return bool(story.approved) || bool(story.auto_approved);
}

function durationInFlashRange(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value >= FLASH_MIN_SECONDS && value <= FLASH_MAX_SECONDS;
}

function timestampMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function reportGeneratedAt(report = {}) {
  return report.generated_at || report.generatedAt || report.summary?.generated_at || report.summary?.generatedAt || null;
}

function normaliseProofStoryId(value) {
  return String(value || "").trim().replace(/_(baseline|enriched)$/i, "");
}

function forensicStoryId(report = {}) {
  return normaliseProofStoryId(report.story_id || report.storyId || report.summary?.storyId);
}

function collectAppliedAudio(localAudioReports = []) {
  const byStory = new Map();
  for (const report of array(localAudioReports)) {
    for (const item of array(report?.applied)) {
      const storyId = storyIdOf(item);
      if (!storyId) continue;
      const durationSeconds = Number(item.duration_seconds ?? item.durationSeconds);
      const outputAudioPath = item.output_audio_path || item.outputAudioPath || item.audio_path || null;
      const timestampsPath =
        item.timestamps_path ||
        item.timestampsPath ||
        (typeof outputAudioPath === "string"
          ? outputAudioPath.replace(/\.(mp3|wav|m4a)$/i, "_timestamps.json")
          : null);
      const durationVerdict = item.duration_verdict || item.durationVerdict || null;
      const ready =
        durationVerdict === "pass" &&
        Boolean(outputAudioPath) &&
        durationInFlashRange(durationSeconds);
      const normalised = {
        story_id: storyId,
        output_audio_path: outputAudioPath,
        timestamps_path: timestampsPath,
        duration_seconds: Number.isFinite(durationSeconds) ? Number(durationSeconds.toFixed(3)) : null,
        duration_verdict: durationVerdict,
        status: ready ? "approved_local_liam_audio_ready" : "local_liam_audio_not_flash_ready",
        ready,
      };
      const current = byStory.get(storyId);
      if (!current || Number(normalised.duration_seconds || 0) > Number(current.duration_seconds || 0)) {
        byStory.set(storyId, normalised);
      }
    }
  }
  return byStory;
}

function assetBucketsFromPlan(plan = {}) {
  return [
    ...array(plan.would_fetch),
    ...array(plan.applied_assets),
    ...array(plan.provenance),
    ...array(plan.media_provenance),
    ...array(plan.visual_deck),
    ...array(plan.visual_deck?.items),
  ];
}

function isPremiumExactAsset(asset = {}) {
  const quality = String(asset.subject_match_quality || asset.match_quality || "");
  return bool(asset.counted_for_premium) && EXACT_PREMIUM_MATCHES.has(quality);
}

function collectAssetStrength(assetReports = []) {
  const byStory = new Map();
  for (const report of array(assetReports)) {
    for (const plan of array(report?.plans)) {
      const storyId = storyIdOf(plan);
      if (!storyId) continue;
      const existing = byStory.get(storyId) || {
        exact_subject_assets: [],
        context_assets: [],
        rejected_assets: [],
      };
      for (const asset of assetBucketsFromPlan(plan)) {
        if (!asset || typeof asset !== "object") continue;
        if (isPremiumExactAsset(asset)) {
          existing.exact_subject_assets.push(asset);
        } else if (asset.status === "rejected" || asset.rejected === true) {
          existing.rejected_assets.push(asset);
        } else {
          existing.context_assets.push(asset);
        }
      }
      byStory.set(storyId, existing);
    }
  }
  for (const [storyId, value] of byStory.entries()) {
    const exact = uniqueBy(value.exact_subject_assets, (asset) =>
      [
        asset.local_path,
        asset.path,
        asset.source_url,
        asset.url,
        asset.id,
        asset.exact_subject_group,
        asset.entity,
      ]
        .filter(Boolean)
        .join("|"),
    );
    const exactGroups = uniqueStrings(
      exact.map((asset) => asset.exact_subject_group || asset.entity || asset.game || asset.game_title),
    );
    byStory.set(storyId, {
      ...value,
      exact_subject_assets: exact,
      exact_subject_count: exact.length,
      exact_subject_groups: exactGroups,
      exact_subject_ready: exact.length >= FLASH_MIN_EXACT_SUBJECT_ASSETS,
    });
  }
  return byStory;
}

function frameAccepted(frame = {}) {
  const status = String(frame.status || frame.verdict || "").toLowerCase();
  const qa = frame.qa || {};
  const qaVerdict = String(qa.verdict || "").toLowerCase();
  const failures = array(qa.failures);
  if (officialTrailerFrameRejectReason(frame, qa)) return false;
  return (
    status === "accepted" &&
    (qaVerdict === "" || qaVerdict === "pass") &&
    failures.length === 0 &&
    Boolean(frame.local_path || frame.localPath || qa.local_path)
  );
}

function collectFrameStrength(frameReports = []) {
  const byStory = new Map();
  for (const report of array(frameReports)) {
    for (const plan of array(report?.plans)) {
      const storyId = storyIdOf(plan);
      if (!storyId) continue;
      const accepted = array(plan.frames).filter(frameAccepted);
      const existing = byStory.get(storyId) || [];
      existing.push(...accepted);
      byStory.set(storyId, existing);
    }
  }
  const out = new Map();
  for (const [storyId, frames] of byStory.entries()) {
    const uniqueFrames = uniqueBy(frames, (frame) =>
      frame.qa?.content_hash || frame.local_path || frame.localPath || frame.source_url,
    );
    out.set(storyId, {
      accepted_frames: uniqueFrames,
      accepted_frame_count: uniqueFrames.length,
      frame_groups: uniqueStrings(uniqueFrames.map((frame) => frame.entity || frame.exact_subject_group)),
      motion_backbone_ready: uniqueFrames.length >= FLASH_MIN_MOTION_FRAMES,
    });
  }
  return out;
}

function inferStoryIdFromSegment(segment = {}, report = {}) {
  if (segment.story_id || segment.storyId) return segment.story_id || segment.storyId;
  if (report.story_id || report.storyId) return report.story_id || report.storyId;
  for (const sample of array(segment.samples)) {
    if (sample.story_id || sample.storyId) return sample.story_id || sample.storyId;
    const localPath = String(sample.local_path || sample.localPath || "");
    const match = localPath.match(/[\\/]assets[\\/]([^\\/]+)[\\/]/i);
    if (match?.[1]) return match[1];
  }
  const localPath = String(segment.local_path || segment.localPath || "");
  const match = localPath.match(/[\\/]assets[\\/]([^\\/]+)[\\/]/i);
  return match?.[1] || null;
}

function segmentValidated(segment = {}) {
  return (
    segment.allowed_for_flash_lane === true ||
    (segment.segment_validated === true && String(segment.status || "").toLowerCase() === "validated")
  );
}

function collectSegmentStrength(segmentValidationReports = []) {
  const byStory = new Map();
  for (const report of array(segmentValidationReports)) {
    for (const segment of array(report?.segments)) {
      if (!segmentValidated(segment)) continue;
      const storyId = inferStoryIdFromSegment(segment, report);
      if (!storyId) continue;
      const existing = byStory.get(storyId) || [];
      existing.push(segment);
      byStory.set(storyId, existing);
    }
  }
  const out = new Map();
  for (const [storyId, segments] of byStory.entries()) {
    const uniqueSegments = uniqueBy(segments, (segment) =>
      segment.clip_key ||
      [
        segment.source_url,
        segment.path,
        segment.entity,
        Number(segment.media_start_s ?? segment.mediaStartS ?? 0).toFixed(2),
      ]
        .filter(Boolean)
        .join("|"),
    );
    const uniqueSources = uniqueStrings(uniqueSegments.map((segment) => segment.source_url || segment.path));
    out.set(storyId, {
      validated_clip_refs: uniqueSegments,
      validated_clip_ref_count: uniqueSegments.length,
      validated_clip_source_count: uniqueSources.length,
      validated_clip_entities: uniqueStrings(uniqueSegments.map((segment) => segment.entity)),
      validated_clip_ref_ready: uniqueSegments.length >= FLASH_MIN_VALIDATED_CLIP_REFS,
      validated_clip_source_ready: uniqueSources.length >= FLASH_MIN_VALIDATED_CLIP_SOURCES,
      validated_clip_ready:
        uniqueSegments.length >= FLASH_MIN_VALIDATED_CLIP_REFS &&
        uniqueSources.length >= FLASH_MIN_VALIDATED_CLIP_SOURCES,
    });
  }
  return out;
}

function combineFrameReports(frameReports = []) {
  return {
    plans: array(frameReports).flatMap((report) => array(report?.plans)),
  };
}

function combineSegmentValidationReports(segmentValidationReports = []) {
  return {
    segments: array(segmentValidationReports).flatMap((report) => array(report?.segments)),
  };
}

function collectFootageBackboneStrength({
  stories = [],
  frameReports = [],
  segmentValidationReports = [],
  audioByStory = new Map(),
} = {}) {
  const out = new Map();
  const combinedFrameReport = combineFrameReports(frameReports);
  const combinedSegmentValidationReport = combineSegmentValidationReports(segmentValidationReports);
  for (const story of array(stories)) {
    const storyId = story?.id;
    if (!storyId) continue;
    const audio = audioByStory.get(storyId);
    const report = buildFlashLaneFootageBackboneReport({
      storyId,
      frameReport: combinedFrameReport,
      segmentValidationReport: combinedSegmentValidationReport,
      targetRuntimeS: Number(audio?.duration_seconds) || 66,
    });
    out.set(storyId, {
      ready: report.verdict === "ready_for_flash_render_preflight",
      verdict: report.verdict,
      blockers: array(report.blockers),
      warnings: array(report.warnings),
      projected_clip_seconds: report.projected_clip_seconds,
      projected_clip_dominance: report.projected_clip_dominance,
      projected_motion_seconds: report.projected_motion_seconds,
      projected_motion_dominance: report.projected_motion_dominance,
      validated_clip_ref_count: array(report.validated_clip_refs).length,
      recommendations: array(report.recommendations),
    });
  }
  return out;
}

function collectStillDeckBlocks(stillDeckReports = []) {
  const byStory = new Map();
  for (const report of array(stillDeckReports)) {
    const storyId = storyIdOf(report);
    const gate = report?.render_package_gate || report?.renderPackageGate || null;
    if (!storyId || gate?.verdict !== "block") continue;
    byStory.set(storyId, {
      blockers: array(gate.blockers),
      warnings: array(gate.warnings),
    });
  }
  return byStory;
}

function rememberFreshness(map, storyId, generatedAt) {
  if (!storyId) return;
  const generatedMs = timestampMs(generatedAt);
  if (!generatedMs) return;
  const existing = map.get(storyId) || { generated_at: null, generated_ms: 0 };
  if (generatedMs > existing.generated_ms) {
    map.set(storyId, {
      generated_at: new Date(generatedMs).toISOString(),
      generated_ms: generatedMs,
    });
  }
}

function collectVisualInputFreshness({
  assetReports = [],
  frameReports = [],
  segmentValidationReports = [],
} = {}) {
  const byStory = new Map();
  for (const report of array(assetReports)) {
    const generatedAt = reportGeneratedAt(report);
    for (const plan of array(report?.plans)) {
      rememberFreshness(byStory, storyIdOf(plan), plan.generated_at || plan.generatedAt || generatedAt);
    }
  }
  for (const report of array(frameReports)) {
    const generatedAt = reportGeneratedAt(report);
    for (const plan of array(report?.plans)) {
      rememberFreshness(byStory, storyIdOf(plan), plan.generated_at || plan.generatedAt || generatedAt);
    }
  }
  for (const report of array(segmentValidationReports)) {
    const generatedAt = reportGeneratedAt(report);
    for (const segment of array(report?.segments)) {
      rememberFreshness(byStory, inferStoryIdFromSegment(segment, report), segment.generated_at || segment.generatedAt || generatedAt);
    }
  }
  return byStory;
}

function latestRenderProofForStory(forensicReports = [], storyId, visualFreshness = null) {
  const matches = array(forensicReports)
    .filter((report) => forensicStoryId(report) === normaliseProofStoryId(storyId))
    .sort((a, b) => timestampMs(reportGeneratedAt(b)) - timestampMs(reportGeneratedAt(a)));
  const report = matches[0];
  if (!report) {
    return {
      status: "not_available",
      needs_human_visual_review: false,
      blocks_fresh_proof: false,
      visual_inputs_are_newer: false,
    };
  }
  const summary = report.summary || {};
  const details = summariseForensicWarnings(report);
  const verdict = summary.verdict || report.verdict || "unknown";
  const failCount = Number(summary.failCount || summary.fail_count || 0);
  const warnCount = Number(summary.warnCount || summary.warn_count || 0);
  const generatedAt = reportGeneratedAt(report);
  const generatedMs = timestampMs(generatedAt);
  const visualGeneratedMs = Number(visualFreshness?.generated_ms || 0);
  const visualInputsAreNewer = Boolean(visualGeneratedMs && generatedMs && visualGeneratedMs > generatedMs);
  const needsReview =
    verdict !== "pass" ||
    failCount > 0 ||
    warnCount > 0 ||
    details.repeat_pair_count > 0 ||
    details.weak_frame_count > 0 ||
    details.rating_or_title_frame_count > 0;
  return {
    status: "available",
    story_id: forensicStoryId(report),
    generated_at: generatedAt || null,
    visual_inputs_generated_at: visualFreshness?.generated_at || null,
    visual_inputs_are_newer: visualInputsAreNewer,
    verdict,
    fail_count: Number.isFinite(failCount) ? failCount : 0,
    warn_count: Number.isFinite(warnCount) ? warnCount : 0,
    needs_human_visual_review: needsReview,
    blocks_fresh_proof: needsReview && !visualInputsAreNewer,
    issue_codes: details.issue_codes,
    repeat_pair_count: details.repeat_pair_count,
    repeat_pair_times: details.repeat_pair_times,
    weak_frame_count: details.weak_frame_count,
    weak_frame_times: details.weak_frame_times,
    rating_or_title_frame_count: details.rating_or_title_frame_count,
  };
}

function buildRecommendedCommand(storyId, audio, segments = {}) {
  if (!storyId || !audio?.output_audio_path) return null;
  const parts = [
    "npm run studio:v2:still-deck --",
    `--story ${storyId}`,
    `--audio "${audio.output_audio_path}"`,
  ];
  if (audio.timestamps_path) parts.push(`--timestamps "${audio.timestamps_path}"`);
  parts.push('--frame-report "test/output/controlled_frame_extraction_worker_apply_local.json"');
  if (segments.validated_clip_ready && segments.footage_backbone_ready) {
    parts.push(
      '--segment-validation-report "test/output/official_trailer_segment_validation_apply_local.json"',
      "--use-official-trailer-clips",
      "--with-sound-design",
    );
  }
  return parts.join(" ");
}

function collectEntityCoverage(assets = {}, segments = {}) {
  const exactGroups = uniqueStrings(assets.exact_subject_groups);
  const storyTargets = uniqueStrings(assets.story_target_entities);
  const requiredGroups =
    storyTargets.length >= FLASH_MIN_VALIDATED_ENTITY_COVERAGE
      ? storyTargets
      : exactGroups;
  const validatedEntities = uniqueStrings(segments.validated_clip_entities);
  const validatedSet = new Set(validatedEntities.map(normaliseLabel));
  const coveredGroups = requiredGroups.filter((group) => validatedSet.has(normaliseLabel(group)));
  const missingGroups = requiredGroups.filter((group) => !validatedSet.has(normaliseLabel(group)));
  const requiredCoverage =
    requiredGroups.length >= FLASH_MIN_VALIDATED_ENTITY_COVERAGE
      ? FLASH_MIN_VALIDATED_ENTITY_COVERAGE
      : 0;
  return {
    exact_subject_groups: exactGroups,
    story_target_entities: storyTargets,
    validated_clip_entities: validatedEntities,
    validated_entity_coverage_count: coveredGroups.length,
    validated_entity_coverage_required: requiredCoverage,
    validated_entity_coverage_ready: requiredCoverage === 0 || coveredGroups.length >= requiredCoverage,
    missing_validated_clip_entities: missingGroups,
  };
}

function collectExactSubjectEntityCoverage(assets = {}, frames = {}, segments = {}) {
  const exactGroups = uniqueStrings(assets.exact_subject_groups);
  const storyTargets = uniqueStrings(assets.story_target_entities);
  const motionGroups = uniqueStrings([
    ...array(frames.frame_groups),
    ...array(segments.validated_clip_entities),
  ]);
  const exactSet = new Set([...exactGroups, ...motionGroups].map(normaliseLabel));
  const coveredGroups = storyTargets.filter((group) => exactSet.has(normaliseLabel(group)));
  const missingGroups = storyTargets.filter((group) => !exactSet.has(normaliseLabel(group)));
  const requiredCoverage = storyTargets.length >= 2 ? storyTargets.length : 0;
  return {
    exact_subject_motion_groups: motionGroups,
    exact_subject_entity_coverage_count: coveredGroups.length,
    exact_subject_entity_coverage_required: requiredCoverage,
    exact_subject_entity_coverage_ready: requiredCoverage === 0 || missingGroups.length === 0,
    missing_exact_subject_entities: missingGroups,
  };
}

function storyTargetEntities(story = {}) {
  return uniqueStrings(buildSubjectGraph(story).required_subject_groups);
}

function classifyCandidate({ story, audio, assets, frames, segments, stillDeckBlock, latestRenderProof }) {
  const blockers = [];
  const warnings = [];
  const assetsWithStoryTargets = {
    ...assets,
    story_target_entities: storyTargetEntities(story),
  };
  const entityCoverage = collectEntityCoverage(assetsWithStoryTargets, segments);
  const exactEntityCoverage = collectExactSubjectEntityCoverage(
    assetsWithStoryTargets,
    frames,
    segments,
  );
  if (!storyApproved(story)) blockers.push("story_not_approved");

  if (!audio?.ready) blockers.push("approved_liam_audio_missing");
  if (!frames.motion_backbone_ready) blockers.push("flash_proof_requires_motion_backbone");
  if (!segments.validated_clip_ref_ready) blockers.push("flash_proof_requires_three_validated_clip_refs");
  if (!segments.validated_clip_source_ready) blockers.push("flash_proof_requires_three_validated_clip_sources");
  if (!segments.footage_backbone_ready) {
    blockers.push(...array(segments.footage_backbone_blockers));
    if (segments.validated_clip_ready) blockers.push("flash_proof_requires_footage_backbone_dominance");
  }
  if (!entityCoverage.validated_entity_coverage_ready) {
    blockers.push("flash_proof_requires_validated_entity_coverage");
  }
  if (!exactEntityCoverage.exact_subject_entity_coverage_ready) {
    blockers.push("flash_proof_requires_exact_subject_entity_coverage");
  }
  if (!assets.exact_subject_ready) blockers.push("flash_proof_requires_four_exact_subject_assets");
  if (latestRenderProof?.blocks_fresh_proof) {
    blockers.push("latest_render_forensic_warnings");
  } else if (latestRenderProof?.needs_human_visual_review && latestRenderProof?.visual_inputs_are_newer) {
    warnings.push("latest_render_warned_but_visual_inputs_refreshed");
  }
  if (stillDeckBlock && !frames.motion_backbone_ready) {
    blockers.push(...stillDeckBlock.blockers);
    warnings.push(...stillDeckBlock.warnings);
  } else if (stillDeckBlock) {
    warnings.push("prior_still_deck_block_overridden_by_current_motion_backbone");
  }

  const visualReady =
    frames.motion_backbone_ready &&
    segments.validated_clip_ref_ready &&
    segments.validated_clip_source_ready &&
    segments.footage_backbone_ready &&
    entityCoverage.validated_entity_coverage_ready &&
    exactEntityCoverage.exact_subject_entity_coverage_ready &&
    assets.exact_subject_ready;
  let verdict = "needs_motion_or_exact_assets";
  let nextAction = "acquire_motion_frames_or_exact_subject_assets";
  if (!storyApproved(story)) {
    verdict = "skip_not_approved";
    nextAction = "approve_or_reject_story_first";
  } else if (latestRenderProof?.blocks_fresh_proof && visualReady && audio?.ready) {
    verdict = "needs_forensic_warning_repair";
    nextAction = "repair_motion_quality_before_next_proof";
  } else if (visualReady && audio?.ready) {
    verdict = "ready_flash_proof";
    nextAction = "run_local_studio_v2_proof";
  } else if (visualReady && !audio?.ready) {
    verdict = "needs_liam_audio_then_flash_proof";
    nextAction = "generate_sleepy_liam_audio";
  }

  return {
    story_id: story.id || null,
    title: normaliseText(story.title || ""),
    priority: storyPriority(story),
    verdict,
    next_action: nextAction,
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
    audio: audio || {
      status: "approved_local_liam_audio_missing",
      ready: false,
      output_audio_path: null,
      timestamps_path: null,
      duration_seconds: null,
      duration_verdict: null,
    },
    visuals: {
      exact_subject_count: assets.exact_subject_count,
      exact_subject_groups: assets.exact_subject_groups,
      story_target_entities: entityCoverage.story_target_entities,
      exact_subject_entity_coverage_count: exactEntityCoverage.exact_subject_entity_coverage_count,
      exact_subject_entity_coverage_required: exactEntityCoverage.exact_subject_entity_coverage_required,
      exact_subject_entity_coverage_ready: exactEntityCoverage.exact_subject_entity_coverage_ready,
      exact_subject_motion_groups: exactEntityCoverage.exact_subject_motion_groups,
      missing_exact_subject_entities: exactEntityCoverage.missing_exact_subject_entities,
      exact_subject_ready: assets.exact_subject_ready,
      accepted_frame_count: frames.accepted_frame_count,
      frame_groups: frames.frame_groups,
      motion_backbone_ready: frames.motion_backbone_ready,
      validated_clip_ref_count: segments.validated_clip_ref_count,
      validated_clip_source_count: segments.validated_clip_source_count,
      validated_clip_entities: segments.validated_clip_entities,
      validated_entity_coverage_count: entityCoverage.validated_entity_coverage_count,
      validated_entity_coverage_required: entityCoverage.validated_entity_coverage_required,
      validated_entity_coverage_ready: entityCoverage.validated_entity_coverage_ready,
      missing_validated_clip_entities: entityCoverage.missing_validated_clip_entities,
      validated_clip_ref_ready: segments.validated_clip_ref_ready,
      validated_clip_source_ready: segments.validated_clip_source_ready,
      validated_clip_ready: segments.validated_clip_ready,
      footage_backbone_ready: segments.footage_backbone_ready,
      footage_backbone_verdict: segments.footage_backbone_verdict,
      footage_backbone_blockers: segments.footage_backbone_blockers,
      projected_clip_seconds: segments.projected_clip_seconds,
      projected_clip_dominance: segments.projected_clip_dominance,
      projected_motion_seconds: segments.projected_motion_seconds,
      projected_motion_dominance: segments.projected_motion_dominance,
      context_asset_count: array(assets.context_assets).length,
    },
    latest_render_proof: latestRenderProof || {
      status: "not_available",
      needs_human_visual_review: false,
      blocks_fresh_proof: false,
      visual_inputs_are_newer: false,
    },
    recommended_command: verdict === "ready_flash_proof"
      ? buildRecommendedCommand(story.id, audio, segments)
      : null,
  };
}

function buildStudioV2ProofCandidateReport({
  stories = [],
  localAudioReports = [],
  assetReports = [],
  frameReports = [],
  segmentValidationReports = [],
  stillDeckReports = [],
  latestForensicReports = [],
  limit = 20,
} = {}) {
  const audioByStory = collectAppliedAudio(localAudioReports);
  const assetsByStory = collectAssetStrength(assetReports);
  const framesByStory = collectFrameStrength(frameReports);
  const segmentsByStory = collectSegmentStrength(segmentValidationReports);
  const footageBackboneByStory = collectFootageBackboneStrength({
    stories,
    frameReports,
    segmentValidationReports,
    audioByStory,
  });
  const stillBlocksByStory = collectStillDeckBlocks(stillDeckReports);
  const visualFreshnessByStory = collectVisualInputFreshness({
    assetReports,
    frameReports,
    segmentValidationReports,
  });
  const candidates = [];

  for (const story of array(stories)) {
    const storyId = story?.id;
    if (!storyId) continue;
    const assets =
      assetsByStory.get(storyId) ||
      { exact_subject_count: 0, exact_subject_groups: [], exact_subject_ready: false, context_assets: [] };
    const frames =
      framesByStory.get(storyId) ||
      { accepted_frame_count: 0, frame_groups: [], motion_backbone_ready: false };
    const baseSegments =
      segmentsByStory.get(storyId) ||
      {
        validated_clip_ref_count: 0,
        validated_clip_source_count: 0,
        validated_clip_entities: [],
        validated_clip_ref_ready: false,
        validated_clip_source_ready: false,
        validated_clip_ready: false,
      };
    const footageBackbone = footageBackboneByStory.get(storyId) || {
      ready: false,
      verdict: "not_available",
      blockers: ["footage_backbone_not_available"],
      warnings: [],
      projected_clip_seconds: 0,
      projected_clip_dominance: 0,
      projected_motion_seconds: 0,
      projected_motion_dominance: 0,
    };
    const segments = {
      ...baseSegments,
      footage_backbone_ready: footageBackbone.ready,
      footage_backbone_verdict: footageBackbone.verdict,
      footage_backbone_blockers: footageBackbone.blockers,
      footage_backbone_warnings: footageBackbone.warnings,
      projected_clip_seconds: footageBackbone.projected_clip_seconds,
      projected_clip_dominance: footageBackbone.projected_clip_dominance,
      projected_motion_seconds: footageBackbone.projected_motion_seconds,
      projected_motion_dominance: footageBackbone.projected_motion_dominance,
    };
    candidates.push(
      classifyCandidate({
        story,
        audio: audioByStory.get(storyId),
        assets,
        frames,
        segments,
        stillDeckBlock: stillBlocksByStory.get(storyId),
        latestRenderProof: latestRenderProofForStory(
          latestForensicReports,
          storyId,
          visualFreshnessByStory.get(storyId),
        ),
      }),
    );
  }

  const rank = {
    ready_flash_proof: 4,
    needs_forensic_warning_repair: 3,
    needs_liam_audio_then_flash_proof: 3,
    needs_motion_or_exact_assets: 2,
    skip_not_approved: 1,
  };
  candidates.sort((a, b) => {
    const lane = (rank[b.verdict] || 0) - (rank[a.verdict] || 0);
    if (lane) return lane;
    return Number(b.priority || 0) - Number(a.priority || 0);
  });

  const limited = candidates.slice(0, Math.max(1, Number(limit) || 20));
  const summary = {
    total: limited.length,
    ready_flash_proof: limited.filter((item) => item.verdict === "ready_flash_proof").length,
    needs_forensic_warning_repair: limited.filter((item) => item.verdict === "needs_forensic_warning_repair").length,
    needs_liam_audio_then_flash_proof: limited.filter((item) => item.verdict === "needs_liam_audio_then_flash_proof").length,
    needs_motion_or_exact_assets: limited.filter((item) => item.verdict === "needs_motion_or_exact_assets").length,
    skipped: limited.filter((item) => item.verdict === "skip_not_approved").length,
  };

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    summary,
    candidates: limited,
    thresholds: {
      flash_min_exact_subject_assets: FLASH_MIN_EXACT_SUBJECT_ASSETS,
      flash_min_motion_frames: FLASH_MIN_MOTION_FRAMES,
      flash_min_validated_clip_refs: FLASH_MIN_VALIDATED_CLIP_REFS,
      flash_min_validated_clip_sources: FLASH_MIN_VALIDATED_CLIP_SOURCES,
      flash_min_validated_entity_coverage: FLASH_MIN_VALIDATED_ENTITY_COVERAGE,
      flash_runtime_seconds: [FLASH_MIN_SECONDS, FLASH_MAX_SECONDS],
    },
    safety: {
      local_only: true,
      report_only: true,
      renders_video: false,
      calls_tts: false,
      posts_to_platforms: false,
      mutates_production_db: false,
      mutates_railway: false,
    },
  };
}

function renderStudioV2ProofCandidatesMarkdown(report = {}) {
  const ready = array(report.candidates).filter((item) => item.verdict === "ready_flash_proof");
  const lines = [
    "# Studio V2 Proof Candidate Selector",
    "",
    "This is local-only and report-only. It does not render, call TTS, post, mutate the DB or touch Railway.",
    "",
    "## Summary",
    "",
    `- Ready Flash proofs: ${report.summary?.ready_flash_proof || 0}`,
    `- Need forensic warning repair: ${report.summary?.needs_forensic_warning_repair || 0}`,
    `- Need Liam audio first: ${report.summary?.needs_liam_audio_then_flash_proof || 0}`,
    `- Need motion/exact assets: ${report.summary?.needs_motion_or_exact_assets || 0}`,
    "",
  ];
  if (!ready.length) {
    lines.push("## Verdict", "", "No Studio V2 proof render is safe yet.", "");
  }
  lines.push("## Candidates", "");
  for (const candidate of array(report.candidates)) {
    lines.push(
      `### ${candidate.story_id}`,
      "",
      `- Title: ${candidate.title || "Untitled"}`,
      `- Verdict: ${candidate.verdict}`,
      `- Next action: ${candidate.next_action}`,
      `- Liam audio: ${candidate.audio?.status || "unknown"} (${candidate.audio?.duration_seconds ?? "no duration"}s)`,
      `- Exact subject assets: ${candidate.visuals?.exact_subject_count || 0}`,
      `- Accepted motion frames: ${candidate.visuals?.accepted_frame_count || 0}`,
      `- Validated clip refs: ${candidate.visuals?.validated_clip_ref_count || 0}`,
      `- Validated clip sources: ${candidate.visuals?.validated_clip_source_count || 0}`,
      `- Validated clip entities: ${array(candidate.visuals?.validated_clip_entities).join(", ") || "none"}`,
      `- Footage backbone: ${candidate.visuals?.footage_backbone_verdict || "unknown"} (clip dominance ${candidate.visuals?.projected_clip_dominance ?? "unknown"})`,
      `- Latest render proof: ${
        candidate.latest_render_proof?.status === "available"
          ? `${candidate.latest_render_proof.verdict} (${candidate.latest_render_proof.fail_count || 0} fail / ${candidate.latest_render_proof.warn_count || 0} warn)`
          : "not available"
      }`,
      `- Blockers: ${array(candidate.blockers).length ? candidate.blockers.join(", ") : "none"}`,
    );
    if (candidate.recommended_command) {
      lines.push("", "Recommended command:", "", "```powershell", candidate.recommended_command, "```");
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

module.exports = {
  buildStudioV2ProofCandidateReport,
  renderStudioV2ProofCandidatesMarkdown,
  collectAppliedAudio,
  collectAssetStrength,
  collectFrameStrength,
  collectSegmentStrength,
  collectFootageBackboneStrength,
  latestRenderProofForStory,
};
