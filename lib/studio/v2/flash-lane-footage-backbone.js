"use strict";

const { buildOfficialTrailerClipsFromFrameReport } = require("./official-trailer-clip-refs");

const MIN_FLASH_SEGMENT_QUALITY_SCORE = 75;
const MIN_FLASH_ACTION_SCORE = 70;
const MAX_FLASH_CLIP_REFS_PER_SOURCE = 3;
const DEFAULT_MIN_FLASH_CLIP_DOMINANCE = 0.55;
const DEFAULT_MAX_PROJECTED_CLIP_REFS = 16;
const SUPPORTING_TRAILER_FRAME_SECONDS = 2.5;
const MIN_FRAME_SUPPORTED_CLIP_DOMINANCE = 0.45;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function storyPlans(frameReport, storyId) {
  return asArray(frameReport?.plans).filter((plan) => !storyId || plan.story_id === storyId);
}

function segmentStoryId(segment) {
  const sample = asArray(segment?.samples)[0];
  const localPath = String(sample?.local_path || sample?.planned_local_path || "");
  const match = localPath.match(/[\\/]assets[\\/]([^\\/]+)[\\/]/i);
  return match ? match[1] : null;
}

function storySegments(segmentReport, storyId) {
  const segments = asArray(segmentReport?.segments);
  if (!storyId) return segments;
  return segments.filter((segment) => segment.story_id === storyId || segmentStoryId(segment) === storyId);
}

function frameFacts(plans) {
  const frames = plans.flatMap((plan) => asArray(plan.frames));
  const entities = uniq(frames.map((frame) => frame.entity));
  const accepted = frames.filter((frame) => frame.status === "accepted");
  const rejected = frames.filter((frame) => frame.status !== "accepted" && frame.status !== "would_extract");
  const rejectedReasons = {};
  for (const frame of rejected) {
    for (const reason of asArray(frame.qa?.failures)) {
      rejectedReasons[reason] = (rejectedReasons[reason] || 0) + 1;
    }
  }
  return {
    total_frames: frames.length,
    accepted_frames: accepted.length,
    rejected_frames: rejected.length,
    entities,
    accepted_entities: uniq(accepted.map((frame) => frame.entity)),
    rejected_reasons: rejectedReasons,
  };
}

function segmentFacts(segments) {
  const validated = segments.filter((segment) => {
    const actionScore = Number(segment?.action_score);
    return (
      segment.allowed_for_flash_lane === true &&
      segment.segment_motion_class === "gameplay_action" &&
      Number.isFinite(actionScore) &&
      actionScore >= MIN_FLASH_ACTION_SCORE
    );
  });
  const nonGameplayContext = segments.filter(
    (segment) =>
      segment.allowed_for_flash_lane === true &&
      segment.segment_motion_class !== "gameplay_action",
  );
  const lowAction = segments.filter((segment) => {
    const actionScore = Number(segment?.action_score);
    return (
      segment.allowed_for_flash_lane === true &&
      segment.segment_motion_class === "gameplay_action" &&
      Number.isFinite(actionScore) &&
      actionScore < MIN_FLASH_ACTION_SCORE
    );
  });
  const rejected = segments.filter((segment) => segment.status === "rejected");
  const rejectedReasons = {};
  for (const segment of rejected) {
    const reason = segment.validation_reason || "unknown";
    rejectedReasons[reason] = (rejectedReasons[reason] || 0) + 1;
  }
  return {
    total_segments: segments.length,
    validated_segments: validated.length,
    gameplay_action_segments: validated.length,
    non_gameplay_context_segments: nonGameplayContext.length,
    low_action_score_segments: lowAction.length,
    rejected_segments: rejected.length,
    validated_entities: uniq(validated.map((segment) => segment.entity)),
    rejected_entities: uniq(rejected.map((segment) => segment.entity)),
    rejected_reasons: rejectedReasons,
  };
}

function clipSourceKey(ref) {
  return String(ref?.path || ref?.source_url || ref?.sourceUrl || "").trim();
}

function balanceClipRefsByEntity(refs, maxRefs, opts = {}) {
  const cap = Math.max(1, Number(maxRefs) || refs.length || 1);
  const maxPerSource = Math.max(1, Number(opts.maxPerSource || MAX_FLASH_CLIP_REFS_PER_SOURCE));
  const groups = new Map();
  const entityOrder = [];
  const sourceCounts = new Map();
  for (const ref of refs) {
    const entity = String(ref?.entity || "unknown").trim() || "unknown";
    if (!groups.has(entity)) {
      groups.set(entity, []);
      entityOrder.push(entity);
    }
    groups.get(entity).push(ref);
  }
  const balanced = [];
  while (balanced.length < cap) {
    let added = false;
    for (const entity of entityOrder) {
      const group = groups.get(entity) || [];
      let next = null;
      while (group.length > 0) {
        const candidate = group.shift();
        const source = clipSourceKey(candidate);
        const sourceCount = sourceCounts.get(source) || 0;
        if (sourceCount >= maxPerSource) continue;
        next = candidate;
        sourceCounts.set(source, sourceCount + 1);
        break;
      }
      if (!next) continue;
      balanced.push(next);
      added = true;
      if (balanced.length >= cap) break;
    }
    if (!added) break;
  }
  return balanced;
}

function buildBackboneRecommendations({ frame, segment, thresholds }) {
  const recommendations = [];
  const missingValidated = Math.max(0, thresholds.minValidatedClipRefs - segment.validated_segments);
  const missingEntityCoverage = frame.entities.filter(
    (entity) => !segment.validated_entities.includes(entity),
  );

  if (missingValidated > 0) {
    recommendations.push(`find_${missingValidated}_more_validated_clip_window${missingValidated === 1 ? "" : "s"}`);
  }
  if (missingEntityCoverage.length > 0) {
    recommendations.push(`missing_validated_entities:${missingEntityCoverage.join(",")}`);
  }
  if (segment.rejected_reasons.segment_contains_black_frame) {
    recommendations.push("avoid_black_or_transition_windows_for_failed_trailers");
  }
  if (segment.rejected_reasons.segment_contains_low_detail_frame) {
    recommendations.push("sample_later_or_alternate_trailer_for_low_detail_sources");
  }
  if (segment.rejected_reasons.segment_contains_title_or_rating_card) {
    recommendations.push("skip_rating_title_and_logo_sections");
  }
  if (segment.non_gameplay_context_segments > 0) {
    recommendations.push("resample_trailers_for_gameplay_action_windows_not_clean_cards");
  }
  if (segment.low_action_score_segments > 0) {
    recommendations.push("replace_low_motion_clip_windows_with_higher_energy_gameplay");
  }
  if (segment.validated_segments < 2) {
    recommendations.push("downgrade_to_standard_short_until_footage_backbone_exists");
  } else if (segment.validated_segments < thresholds.minValidatedClipRefs) {
    recommendations.push("hold_flash_lane_and_continue_motion_acquisition");
  }
  if (recommendations.length === 0) recommendations.push("ready_for_local_flash_render_preflight");
  return recommendations;
}

function buildFlashLaneFootageBackboneReport({
  storyId = null,
  frameReport = null,
  segmentValidationReport = null,
  targetRuntimeS = 66,
  minValidatedClipRefs = 3,
  minValidatedEntities = 2,
  minClipDominance = DEFAULT_MIN_FLASH_CLIP_DOMINANCE,
  maxProjectedClipRefs = DEFAULT_MAX_PROJECTED_CLIP_REFS,
  maxCandidateWindowsPerSource = 3,
  includeFrameAnchoredWindows = true,
  minSegmentQualityScore = MIN_FLASH_SEGMENT_QUALITY_SCORE,
  minSegmentActionScore = MIN_FLASH_ACTION_SCORE,
} = {}) {
  const plans = storyPlans(frameReport, storyId);
  const segments = storySegments(segmentValidationReport, storyId);
  const frame = frameFacts(plans);
  const segment = segmentFacts(segments);
  const effectiveMinValidatedEntities = Math.min(
    Math.max(1, Number(minValidatedEntities) || 1),
    Math.max(1, frame.entities.length || 1),
  );
  const maxProjectedClipRefCount = Math.max(
    1,
    Number(maxProjectedClipRefs) || DEFAULT_MAX_PROJECTED_CLIP_REFS,
  );
  const idealFiveSecondClipRefCount = Math.max(
    minValidatedClipRefs,
    Math.ceil((Math.max(1, Number(targetRuntimeS) || 66) * minClipDominance) / 5),
  );
  const candidateClipRefs = storyId
    ? buildOfficialTrailerClipsFromFrameReport(frameReport, storyId, {
        segmentValidationReport,
        requireValidatedSegments: true,
        maxClips: maxProjectedClipRefCount,
        maxCandidateWindowsPerSource,
        includeFrameAnchoredWindows,
      })
    : [];
  const minimumQuality = Number(minSegmentQualityScore) || MIN_FLASH_SEGMENT_QUALITY_SCORE;
  const minimumAction = Number(minSegmentActionScore) || MIN_FLASH_ACTION_SCORE;
  const qualityFilteredClipRefs = candidateClipRefs.filter((ref) => {
    const score = Number(ref?.provenance?.segment_quality_score);
    const actionScore = Number(ref?.provenance?.segment_action_score);
    return (
      (!Number.isFinite(score) || score >= minimumQuality) &&
      ref?.provenance?.segment_motion_class === "gameplay_action" &&
      Number.isFinite(actionScore) &&
      actionScore >= minimumAction
    );
  });
  const validatedClipRefs = balanceClipRefsByEntity(qualityFilteredClipRefs, maxProjectedClipRefCount, {
    maxPerSource: MAX_FLASH_CLIP_REFS_PER_SOURCE,
  });
  const projectedClipSeconds = validatedClipRefs.reduce(
    (sum, clip) => sum + Number(clip.durationS || 0),
    0,
  );
  const projectedClipDominance =
    targetRuntimeS > 0 ? Number((projectedClipSeconds / targetRuntimeS).toFixed(2)) : 0;
  const projectedSupportingFrameSeconds = frame.accepted_frames * SUPPORTING_TRAILER_FRAME_SECONDS;
  const projectedMotionSeconds = projectedClipSeconds + projectedSupportingFrameSeconds;
  const projectedMotionDominance =
    targetRuntimeS > 0 ? Number((projectedMotionSeconds / targetRuntimeS).toFixed(2)) : 0;
  const thresholds = {
    minValidatedClipRefs,
    minValidatedEntities: effectiveMinValidatedEntities,
    minClipDominance,
    minFrameSupportedClipDominance: MIN_FRAME_SUPPORTED_CLIP_DOMINANCE,
    supportingTrailerFrameSeconds: SUPPORTING_TRAILER_FRAME_SECONDS,
    targetRuntimeS,
    minSegmentActionScore: minimumAction,
  };
  const blockers = [];
  const warnings = [];
  if (segment.validated_segments < minValidatedClipRefs) {
    blockers.push("footage_backbone_needs_three_validated_clip_windows");
  }
  if (segment.gameplay_action_segments < minValidatedClipRefs) {
    blockers.push("footage_backbone_needs_gameplay_action_clip_windows");
  }
  if (segment.validated_entities.length < effectiveMinValidatedEntities) {
    blockers.push("footage_backbone_entity_coverage_too_thin");
  }
  const trailerFramesCarryGap =
    projectedClipDominance >= MIN_FRAME_SUPPORTED_CLIP_DOMINANCE &&
    frame.accepted_frames >= 3 &&
    projectedMotionDominance >= minClipDominance &&
    validatedClipRefs.length >= minValidatedClipRefs;
  if (projectedClipDominance < minClipDominance && trailerFramesCarryGap) {
    warnings.push("footage_backbone_clip_dominance_supported_by_trailer_frames");
  } else if (projectedClipDominance < minClipDominance) {
    blockers.push("footage_backbone_clip_dominance_too_low");
  }
  const verdict = blockers.length
    ? segment.validated_segments < 2
      ? "downgrade_to_standard_short"
      : "needs_more_validated_footage"
    : "ready_for_flash_render_preflight";

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    story_id: storyId,
    verdict,
    blockers,
    warnings,
    thresholds,
    projected_clip_ref_count: Math.max(
      idealFiveSecondClipRefCount,
      Math.min(maxProjectedClipRefCount, qualityFilteredClipRefs.length),
    ),
    min_segment_quality_score: minimumQuality,
    min_segment_action_score: minimumAction,
    max_clip_refs_per_source: MAX_FLASH_CLIP_REFS_PER_SOURCE,
    filtered_low_quality_clip_refs: candidateClipRefs.length - qualityFilteredClipRefs.length,
    filtered_source_overuse_clip_refs: qualityFilteredClipRefs.length - validatedClipRefs.length,
    frame_inventory: frame,
    segment_inventory: segment,
    validated_clip_refs: validatedClipRefs,
    projected_clip_seconds: projectedClipSeconds,
    projected_clip_dominance: projectedClipDominance,
    projected_supporting_frame_seconds: projectedSupportingFrameSeconds,
    projected_motion_seconds: projectedMotionSeconds,
    projected_motion_dominance: projectedMotionDominance,
    recommendations: buildBackboneRecommendations({ frame, segment, thresholds }),
    safety: {
      report_only: true,
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      render_default_changed: false,
    },
  };
}

function renderFlashLaneFootageBackboneMarkdown(report) {
  const lines = [];
  lines.push("# Flash Lane Footage Backbone v1");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Story: ${report.story_id || "all"}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push(`Blockers: ${report.blockers.join(", ") || "clear"}`);
  if (Array.isArray(report.warnings) && report.warnings.length > 0) {
    lines.push(`Warnings: ${report.warnings.join(", ")}`);
  }
  lines.push("");
  lines.push("## Inventory");
  lines.push("");
  lines.push(`- planned frames: ${report.frame_inventory.total_frames}`);
  lines.push(`- accepted frames: ${report.frame_inventory.accepted_frames}`);
  lines.push(`- rejected frames: ${report.frame_inventory.rejected_frames}`);
  lines.push(`- story entities: ${report.frame_inventory.entities.join(", ") || "none"}`);
  lines.push(`- validated segments: ${report.segment_inventory.validated_segments}`);
  lines.push(`- gameplay/action segments: ${report.segment_inventory.gameplay_action_segments}`);
  lines.push(`- non-gameplay context segments: ${report.segment_inventory.non_gameplay_context_segments}`);
  lines.push(`- rejected segments: ${report.segment_inventory.rejected_segments}`);
  lines.push(`- validated entities: ${report.segment_inventory.validated_entities.join(", ") || "none"}`);
  lines.push(`- projected clip dominance: ${report.projected_clip_dominance}`);
  lines.push(`- projected motion dominance: ${report.projected_motion_dominance}`);
  lines.push("");
  lines.push("## Recommendations");
  lines.push("");
  for (const item of report.recommendations) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Rejection Reasons");
  lines.push("");
  lines.push("### Frames");
  for (const [reason, count] of Object.entries(report.frame_inventory.rejected_reasons)) {
    lines.push(`- ${reason}: ${count}`);
  }
  if (Object.keys(report.frame_inventory.rejected_reasons).length === 0) lines.push("- none");
  lines.push("");
  lines.push("### Segments");
  for (const [reason, count] of Object.entries(report.segment_inventory.rejected_reasons)) {
    lines.push(`- ${reason}: ${count}`);
  }
  if (Object.keys(report.segment_inventory.rejected_reasons).length === 0) lines.push("- none");
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Report-only.");
  lines.push("- No DB, Railway, OAuth, render-default or posting changes.");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildFlashLaneFootageBackboneReport,
  renderFlashLaneFootageBackboneMarkdown,
  MAX_FLASH_CLIP_REFS_PER_SOURCE,
  MIN_FLASH_ACTION_SCORE,
};
