"use strict";

const {
  MIN_SEGMENT_ACTION_SCORE,
} = require("./official-trailer-segment-validator");
const {
  MIN_OFFICIAL_CLIP_START_S,
} = require("./official-trailer-clip-refs");

const EXHAUSTED_SOURCE_FAMILY_SEGMENT_THRESHOLD = 5;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanEntity(value) {
  return String(value || "").trim();
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function storyProofCandidate(proofCandidateReport, storyId) {
  return asArray(proofCandidateReport?.candidates).find(
    (candidate) => !storyId || candidate.story_id === storyId || candidate.storyId === storyId,
  );
}

function proofCandidateStoryIds(proofCandidateReport) {
  return uniq(
    asArray(proofCandidateReport?.candidates)
      .map((candidate) => candidate?.story_id || candidate?.storyId)
      .filter(Boolean),
  );
}

function proofCandidateEntities(proofCandidateReport, storyId) {
  const candidate = storyProofCandidate(proofCandidateReport, storyId);
  return uniq([
    ...asArray(candidate?.visuals?.story_target_entities),
    ...asArray(candidate?.visuals?.exact_subject_groups),
    ...asArray(candidate?.visuals?.frame_groups),
    ...asArray(candidate?.visuals?.validated_clip_entities),
  ].map(cleanEntity));
}

function isValidatedFlashSegment(segment) {
  const actionScore = numberOr(segment?.action_score, null);
  return (
    segment?.allowed_for_flash_lane === true &&
    segment?.segment_motion_class === "gameplay_action" &&
    Number.isFinite(actionScore) &&
    actionScore >= MIN_SEGMENT_ACTION_SCORE
  );
}

function rejectedReasonForSegment(segment) {
  if (isValidatedFlashSegment(segment)) return null;
  if (segment?.validation_reason) return segment.validation_reason;
  if (segment?.allowed_for_flash_lane === true && segment?.segment_motion_class !== "gameplay_action") {
    return "segment_missing_gameplay_action_proof";
  }
  const actionScore = numberOr(segment?.action_score, null);
  if (
    segment?.allowed_for_flash_lane === true &&
    segment?.segment_motion_class === "gameplay_action" &&
    Number.isFinite(actionScore) &&
    actionScore < MIN_SEGMENT_ACTION_SCORE
  ) {
    return "segment_action_score_below_flash_threshold";
  }
  return "unvalidated_segment";
}

function rejectedSegmentsByEntity(segments) {
  const byEntity = {};
  for (const segment of segments) {
    const reason = rejectedReasonForSegment(segment);
    if (!reason) continue;
    const entity = cleanEntity(segment.entity);
    if (!entity) continue;
    if (!byEntity[entity]) byEntity[entity] = [];
    byEntity[entity].push({
      reason,
      media_start_s: numberOr(segment.media_start_s ?? segment.start_s, null),
    });
  }
  return byEntity;
}

function rejectedReasonsByEntity(segments) {
  const byEntity = rejectedSegmentsByEntity(segments);
  return Object.fromEntries(
    Object.entries(byEntity).map(([entity, items]) => [entity, uniq(items.map((item) => item.reason))]),
  );
}

function sourceFamilyKeyForSegment(segment) {
  return String(
    segment?.source_family_key ||
      segment?.provenance?.source_family_key ||
      segment?.source_url ||
      segment?.path ||
      segment?.url ||
      segment?.movie_id ||
      segment?.movie_name ||
      segment?.reference_title ||
      "",
  )
    .trim()
    .toLowerCase();
}

function sourceFamilyStatusByEntity(segments, threshold = EXHAUSTED_SOURCE_FAMILY_SEGMENT_THRESHOLD) {
  const byEntity = {};
  for (const segment of segments) {
    const reason = rejectedReasonForSegment(segment);
    if (!reason) continue;
    const entity = cleanEntity(segment.entity);
    const familyKey = sourceFamilyKeyForSegment(segment);
    if (!entity || !familyKey) continue;
    if (!byEntity[entity]) byEntity[entity] = new Map();
    const family = byEntity[entity].get(familyKey) || {
      key: familyKey,
      attempts: 0,
      rejection_reasons: [],
    };
    family.attempts += 1;
    family.rejection_reasons = uniq([...family.rejection_reasons, reason]);
    byEntity[entity].set(familyKey, family);
  }

  return Object.fromEntries(
    Object.entries(byEntity).map(([entity, familyMap]) => {
      const families = [...familyMap.values()];
      const exhaustedFamilies = families.filter((family) => family.attempts >= threshold);
      return [
        entity,
        {
          source_family_count: families.length,
          exhausted_source_family_count: exhaustedFamilies.length,
          all_source_families_exhausted: families.length > 0 && exhaustedFamilies.length === families.length,
          exhausted_source_families: exhaustedFamilies,
        },
      ];
    }),
  );
}

function attemptedStartsForRejectedItems(items) {
  return uniq(
    asArray(items)
      .map((item) => numberOr(item.media_start_s, null))
      .filter((start) => Number.isFinite(start))
      .map((start) => Number(start.toFixed(2))),
  );
}

function reasonsForShoppingItem(reasons, attemptedStarts = []) {
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
  if (reasons.includes("segment_lacks_gameplay_action_samples")) {
    output.push("seek_high_motion_gameplay_not_context_or_logo_sections");
  }
  if (reasons.includes("segment_samples_too_repetitive")) {
    output.push("avoid_repeated_static_or_rating_frames");
  }
  if (reasons.includes("segment_action_score_below_flash_threshold")) {
    output.push("replace_low_motion_clip_windows_with_higher_energy_gameplay");
  }
  if (reasons.includes("segment_missing_gameplay_action_proof")) {
    output.push("rerun_segment_validation_before_counting_for_flash_lane");
  }
  if (attemptedStarts.length >= 4) {
    output.push("try_later_or_alternate_official_source_after_failed_windows");
  }
  return uniq(output);
}

function suggestedWindowsForReasons(reasons, attemptedStarts = []) {
  const primaryStarts = [36, 42, 48, 54, 60, 66, 72, 84];
  const fallbackStarts = [96, 108, 120];
  const attempted = attemptedStarts.map((start) => Number(start)).filter((start) => Number.isFinite(start));
  const wasAlreadySampled = (candidate) =>
    attempted.some((start) => Math.abs(start - candidate) <= 1);
  let starts = primaryStarts.filter((start) => !wasAlreadySampled(start));
  if (starts.length < 3) {
    starts = starts.concat(fallbackStarts.filter((start) => !wasAlreadySampled(start)));
  }
  starts = starts.slice(0, 3);
  return starts.map((start) => ({
    start_s: Math.max(MIN_OFFICIAL_CLIP_START_S, start),
    duration_s: 4,
    purpose: "validate_high_motion_gameplay_or_character_moment",
  }));
}

function buildShoppingList({ entities, validatedEntities, rejectedItems, sourceFamilyStatus }) {
  return entities
    .filter((entity) => !validatedEntities.includes(entity))
    .map((entity) => {
      const items = rejectedItems[entity] || [];
      const reasons = uniq(items.map((item) => item.reason));
      const attemptedStarts = attemptedStartsForRejectedItems(items);
      const entitySourceFamilyStatus = sourceFamilyStatus?.[entity] || null;
      const sourceFamiliesExhausted = entitySourceFamilyStatus?.all_source_families_exhausted === true;
      const suggestedWindows = sourceFamiliesExhausted
        ? []
        : suggestedWindowsForReasons(reasons, attemptedStarts);
      const requiresAlternateOfficialSource =
        (attemptedStarts.length > 0 && suggestedWindows.length === 0) || sourceFamiliesExhausted;
      return {
        entity,
        priority: "high",
        acquisition_mode: "operator_or_local_apply_only",
        allowed_sources: ["steam_official_movie", "igdb_official_video_reference", "publisher_official_trailer"],
        forbidden_sources: ["yt_dlp", "browser_scraping", "social_media_scraping", "unofficial_clip_download"],
        attempted_windows: attemptedStarts.map((start) => ({
          start_s: start,
          duration_s: 4,
        })),
        suggested_windows: suggestedWindows,
        window_status: requiresAlternateOfficialSource
          ? "alternate_official_source_required"
          : "sample_more_candidate_windows",
        requires_alternate_official_source: requiresAlternateOfficialSource,
        source_family_count: entitySourceFamilyStatus?.source_family_count || 0,
        exhausted_source_family_count: entitySourceFamilyStatus?.exhausted_source_family_count || 0,
        exhausted_source_families: entitySourceFamilyStatus?.exhausted_source_families || [],
        reasons: requiresAlternateOfficialSource
          ? uniq([...reasonsForShoppingItem(reasons, attemptedStarts), "alternate_official_source_required"])
          : reasonsForShoppingItem(reasons, attemptedStarts),
        acceptance_criteria: [
          "no_rating_or_title_card",
          "no_black_or_transition_frame",
          "subject_entity_visible_or_strongly_implied",
          "enough_detail_for_vertical_crop",
        ],
      };
    });
}

function buildSingleFlashLaneFootageAcquisitionPlan({
  storyId = null,
  frameReport = null,
  segmentValidationReport = null,
  proofCandidateReport = null,
  minValidatedClipWindows = 3,
  minValidatedEntities = 3,
} = {}) {
  const plans = storyPlans(frameReport, storyId);
  const segments = storySegments(segmentValidationReport, storyId);
  const proofCandidate = storyProofCandidate(proofCandidateReport, storyId);
  const entities = uniq([
    ...frameEntities(plans),
    ...proofCandidateEntities(proofCandidateReport, storyId),
  ]);
  const validatedSegments = segments.filter(isValidatedFlashSegment);
  const validatedEntities = uniq(validatedSegments.map((segment) => cleanEntity(segment.entity)));
  const rejectedItems = rejectedSegmentsByEntity(segments);
  const rejectedReasons = rejectedReasonsByEntity(segments);
  const sourceFamilyStatus = sourceFamilyStatusByEntity(segments);
  const shoppingList = buildShoppingList({
    entities,
    validatedEntities,
    rejectedItems,
    sourceFamilyStatus,
  });
  const blockers = [];
  if (validatedSegments.length < minValidatedClipWindows) {
    blockers.push("flash_lane_needs_more_validated_clip_windows");
  }
  if (validatedEntities.length < minValidatedEntities) {
    blockers.push("flash_lane_needs_more_entity_coverage");
  }
  if (entities.length === 0) blockers.push("flash_lane_has_no_story_entities");
  const needsAlternateOfficialSource = shoppingList.some((item) => item.requires_alternate_official_source);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    story_id: storyId,
    title: proofCandidate?.title || null,
    verdict: blockers.length ? "needs_more_validated_footage" : "ready_for_flash_footage_backbone",
    next_best_action: !blockers.length
      ? "ready_for_flash_footage_backbone"
      : needsAlternateOfficialSource
        ? "find_alternate_official_source_or_downgrade_story"
        : "sample_more_official_trailer_windows",
    blockers,
    thresholds: {
      min_validated_clip_windows: minValidatedClipWindows,
      min_validated_entities: minValidatedEntities,
      min_segment_action_score: MIN_SEGMENT_ACTION_SCORE,
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

function rankAcquisitionPlan(plan) {
  const audioReady = plan.proof_candidate?.audio?.ready === true ? 40 : 0;
  const exactCount = Number(plan.proof_candidate?.visuals?.exact_subject_count || 0);
  const validatedWindows = Number(plan.validated_clip_windows || 0);
  const shoppingPenalty = Number(plan.shopping_list?.length || 0) * 8;
  const alternatePenalty = plan.shopping_list?.some((item) => item.requires_alternate_official_source) ? 20 : 0;
  return audioReady + Math.min(40, exactCount * 4) + validatedWindows * 12 - shoppingPenalty - alternatePenalty;
}

function buildFlashLaneFootageAcquisitionPlan({
  storyId = null,
  frameReport = null,
  segmentValidationReport = null,
  proofCandidateReport = null,
  minValidatedClipWindows = 3,
  minValidatedEntities = 3,
  limit = 20,
} = {}) {
  if (storyId) {
    return buildSingleFlashLaneFootageAcquisitionPlan({
      storyId,
      frameReport,
      segmentValidationReport,
      proofCandidateReport,
      minValidatedClipWindows,
      minValidatedEntities,
    });
  }

  const storyIds = proofCandidateStoryIds(proofCandidateReport).slice(0, Math.max(1, Number(limit) || 20));
  if (!storyIds.length) {
    return buildSingleFlashLaneFootageAcquisitionPlan({
      storyId,
      frameReport,
      segmentValidationReport,
      proofCandidateReport,
      minValidatedClipWindows,
      minValidatedEntities,
    });
  }

  const stories = storyIds
    .map((id) => {
      const plan = buildSingleFlashLaneFootageAcquisitionPlan({
        storyId: id,
        frameReport,
        segmentValidationReport,
        proofCandidateReport,
        minValidatedClipWindows,
        minValidatedEntities,
      });
      const proofCandidate = storyProofCandidate(proofCandidateReport, id);
      return {
        ...plan,
        proof_candidate: proofCandidate
          ? {
              verdict: proofCandidate.verdict,
              blockers: asArray(proofCandidate.blockers),
              audio: proofCandidate.audio || null,
              visuals: proofCandidate.visuals || null,
            }
          : null,
        acquisition_priority: rankAcquisitionPlan({
          ...plan,
          proof_candidate: proofCandidate,
        }),
      };
    })
    .sort((a, b) => {
      const priority = Number(b.acquisition_priority || 0) - Number(a.acquisition_priority || 0);
      if (priority) return priority;
      return String(a.story_id).localeCompare(String(b.story_id));
    });

  const readyStories = stories.filter((plan) => plan.verdict === "ready_for_flash_footage_backbone");
  const alternateStories = stories.filter((plan) => plan.next_best_action === "find_alternate_official_source_or_downgrade_story");
  const sampleMoreStories = stories.filter((plan) => plan.next_best_action === "sample_more_official_trailer_windows");
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    story_id: null,
    verdict: readyStories.length ? "has_flash_footage_ready_story" : "needs_more_validated_footage",
    next_best_action: readyStories.length
      ? "run_flash_footage_backbone_for_ready_story"
      : sampleMoreStories.length
        ? "sample_more_official_trailer_windows"
        : alternateStories.length
          ? "find_alternate_official_source_or_downgrade_story"
          : "acquire_exact_subject_assets_first",
    blockers: readyStories.length ? [] : ["flash_lane_queue_has_no_ready_story"],
    summary: {
      stories_considered: stories.length,
      ready_for_backbone: readyStories.length,
      sample_more_windows: sampleMoreStories.length,
      alternate_source_or_downgrade: alternateStories.length,
    },
    stories,
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
  if (Array.isArray(plan.stories)) {
    lines.push(`Story: queue`);
    lines.push(`Verdict: ${plan.verdict}`);
    lines.push(`Next best action: ${plan.next_best_action || "unknown"}`);
    lines.push(`Blockers: ${plan.blockers.join(", ") || "clear"}`);
    lines.push("");
    lines.push("## Queue Summary");
    lines.push("");
    lines.push(`- stories considered: ${plan.summary.stories_considered}`);
    lines.push(`- ready for backbone: ${plan.summary.ready_for_backbone}`);
    lines.push(`- sample more windows: ${plan.summary.sample_more_windows}`);
    lines.push(`- alternate source or downgrade: ${plan.summary.alternate_source_or_downgrade}`);
    lines.push("");
    lines.push("## Story Queue");
    lines.push("");
    lines.push("| story | priority | verdict | validated windows | validated entities | next action |");
    lines.push("| --- | ---: | --- | ---: | --- | --- |");
    for (const story of plan.stories.slice(0, 20)) {
      lines.push(
        [
          story.story_id,
          story.acquisition_priority,
          story.verdict,
          story.validated_clip_windows,
          story.validated_entities.join(", ") || "none",
          story.next_best_action,
        ]
          .map((value) => String(value ?? "").replace(/\|/g, "/"))
          .join(" | ")
          .replace(/^/, "| ")
          .replace(/$/, " |"),
      );
    }
    const shoppingItems = plan.stories
      .flatMap((story) => story.shopping_list.map((item) => ({ story_id: story.story_id, item })))
      .slice(0, 20);
    lines.push("");
    lines.push("## Top Shopping Items");
    lines.push("");
    if (!shoppingItems.length) {
      lines.push("- none");
    } else {
      for (const { story_id, item } of shoppingItems) {
        lines.push(`- ${story_id} / ${item.entity}: ${item.reasons.join(", ")}`);
      }
    }
    lines.push("");
    lines.push("## Safety");
    lines.push("");
    lines.push("- Report-only queue; no downloads are performed.");
    lines.push("- No yt-dlp, browser scraping, social scraping or unofficial clip acquisition.");
    lines.push("- No DB, Railway, OAuth, render-default or posting changes.");
    return lines.join("\n") + "\n";
  }
  lines.push(`Story: ${plan.story_id || "all"}`);
  lines.push(`Verdict: ${plan.verdict}`);
  lines.push(`Next best action: ${plan.next_best_action || "unknown"}`);
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
      if (item.requires_alternate_official_source) {
        lines.push("  windows: alternate official source required");
      } else {
        lines.push(
          `  windows: ${item.suggested_windows
            .map((window) => `${window.start_s}-${window.start_s + window.duration_s}s`)
            .join(", ")}`,
        );
      }
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
  sourceFamilyStatusByEntity,
};
