"use strict";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanEntity(value) {
  return String(value || "").trim();
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

function frameEntities(plans) {
  return uniq(
    plans
      .flatMap((plan) => asArray(plan.frames))
      .map((frame) => cleanEntity(frame.entity)),
  );
}

function rejectedReasonsByEntity(segments) {
  const byEntity = {};
  for (const segment of segments) {
    if (segment.allowed_for_flash_lane === true) continue;
    const entity = cleanEntity(segment.entity);
    if (!entity) continue;
    if (!byEntity[entity]) byEntity[entity] = [];
    byEntity[entity].push(segment.validation_reason || "unvalidated_segment");
  }
  return byEntity;
}

function reasonsForShoppingItem(reasons) {
  const output = ["find_validated_official_trailer_window"];
  if (reasons.includes("segment_contains_title_or_rating_card")) {
    output.push("skip_rating_title_logo_sections");
  }
  if (reasons.includes("segment_contains_black_frame")) {
    output.push("avoid_black_or_transition_windows");
  }
  if (reasons.includes("segment_contains_low_detail_frame")) {
    output.push("sample_later_or_alternate_trailer_for_low_detail_sources");
  }
  return uniq(output);
}

function suggestedWindowsForReasons(reasons) {
  const starts =
    reasons.includes("segment_contains_title_or_rating_card") ||
    reasons.includes("segment_contains_black_frame")
      ? [12, 22, 34]
      : [8, 18, 30];
  return starts.map((start) => ({
    start_s: start,
    duration_s: 4,
    purpose: "validate_high_motion_gameplay_or_character_moment",
  }));
}

function buildShoppingList({ entities, validatedEntities, rejectedReasons }) {
  return entities
    .filter((entity) => !validatedEntities.includes(entity))
    .map((entity) => {
      const reasons = rejectedReasons[entity] || [];
      return {
        entity,
        priority: "high",
        acquisition_mode: "operator_or_local_apply_only",
        allowed_sources: ["steam_official_movie", "igdb_official_video_reference", "publisher_official_trailer"],
        forbidden_sources: ["yt_dlp", "browser_scraping", "social_media_scraping", "unofficial_clip_download"],
        suggested_windows: suggestedWindowsForReasons(reasons),
        reasons: reasonsForShoppingItem(reasons),
        acceptance_criteria: [
          "no_rating_or_title_card",
          "no_black_or_transition_frame",
          "subject_entity_visible_or_strongly_implied",
          "enough_detail_for_vertical_crop",
        ],
      };
    });
}

function buildFlashLaneFootageAcquisitionPlan({
  storyId = null,
  frameReport = null,
  segmentValidationReport = null,
  minValidatedClipWindows = 3,
  minValidatedEntities = 3,
} = {}) {
  const plans = storyPlans(frameReport, storyId);
  const segments = storySegments(segmentValidationReport, storyId);
  const entities = frameEntities(plans);
  const validatedSegments = segments.filter((segment) => segment.allowed_for_flash_lane === true);
  const validatedEntities = uniq(validatedSegments.map((segment) => cleanEntity(segment.entity)));
  const rejectedReasons = rejectedReasonsByEntity(segments);
  const shoppingList = buildShoppingList({
    entities,
    validatedEntities,
    rejectedReasons,
  });
  const blockers = [];
  if (validatedSegments.length < minValidatedClipWindows) {
    blockers.push("flash_lane_needs_more_validated_clip_windows");
  }
  if (validatedEntities.length < minValidatedEntities) {
    blockers.push("flash_lane_needs_more_entity_coverage");
  }
  if (entities.length === 0) blockers.push("flash_lane_has_no_story_entities");

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    story_id: storyId,
    verdict: blockers.length ? "needs_more_validated_footage" : "ready_for_flash_footage_backbone",
    blockers,
    thresholds: {
      min_validated_clip_windows: minValidatedClipWindows,
      min_validated_entities: minValidatedEntities,
    },
    story_entities: entities,
    validated_entities: validatedEntities,
    validated_clip_windows: validatedSegments.length,
    rejected_reasons_by_entity: rejectedReasons,
    shopping_list: shoppingList,
    safety: {
      report_only: true,
      downloads_performed: false,
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      render_default_changed: false,
      forbidden_acquisition_enabled: false,
    },
  };
}

function renderFlashLaneFootageAcquisitionMarkdown(plan) {
  const lines = [];
  lines.push("# Flash Lane Footage Acquisition v1");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at}`);
  lines.push(`Story: ${plan.story_id || "all"}`);
  lines.push(`Verdict: ${plan.verdict}`);
  lines.push(`Blockers: ${plan.blockers.join(", ") || "clear"}`);
  lines.push("");
  lines.push("## Coverage");
  lines.push("");
  lines.push(`- story entities: ${plan.story_entities.join(", ") || "none"}`);
  lines.push(`- validated entities: ${plan.validated_entities.join(", ") || "none"}`);
  lines.push(`- validated clip windows: ${plan.validated_clip_windows}`);
  lines.push("");
  lines.push("## Shopping List");
  lines.push("");
  if (plan.shopping_list.length === 0) {
    lines.push("- none");
  } else {
    for (const item of plan.shopping_list) {
      lines.push(`- ${item.entity}: ${item.reasons.join(", ")}`);
      lines.push(
        `  windows: ${item.suggested_windows
          .map((window) => `${window.start_s}-${window.start_s + window.duration_s}s`)
          .join(", ")}`,
      );
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- No downloads are performed by this command.");
  lines.push("- No yt-dlp, browser scraping, social scraping or unofficial clip acquisition.");
  lines.push("- No DB, Railway, OAuth, render-default or posting changes.");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildFlashLaneFootageAcquisitionPlan,
  renderFlashLaneFootageAcquisitionMarkdown,
};
