"use strict";

const { summariseForensicWarnings } = require("../studio/v2/promotion-packet");
const {
  officialMediaReferenceRejectReason,
} = require("../official-media-reference-preflight");
const { storyReferenceReportRelativePath } = require("../official-trailer-reference-report-files");
const { coverageForGroups, segmentCoverageLabels } = require("../subject-coverage");

const DEFAULT_MIN_VALIDATED_CLIP_REFS = 3;
const DEFAULT_MIN_FLASH_CLIP_DOMINANCE = 0.55;
const EXHAUSTED_ENTITY_ATTEMPT_THRESHOLD = 8;
const EXHAUSTED_SOURCE_FAMILY_REJECT_THRESHOLD = 5;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(items) {
  return [...new Set(array(items).map((item) => String(item || "").trim()).filter(Boolean))];
}

function mdCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of array(items)) {
    const key = keyFn(item);
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function inferStoryIdFromSegment(segment = {}, report = {}) {
  if (segment.story_id || segment.storyId) return segment.story_id || segment.storyId;
  if (report.story_id || report.storyId) return report.story_id || report.storyId;
  for (const sample of array(segment.samples)) {
    if (sample.story_id || sample.storyId) return sample.story_id || sample.storyId;
    const localPath = String(sample.local_path || sample.localPath || sample.planned_local_path || "");
    const match = localPath.match(/[\\/]assets[\\/]([^\\/]+)[\\/]/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

function metadataRejectReasonToSegmentReason(reason) {
  if (reason === "rating_board_reference") return "segment_source_is_rating_board_reference";
  if (reason === "logo_or_title_only_reference") return "segment_source_is_logo_or_title_only_reference";
  if (reason === "localised_non_english_reference") return "segment_source_is_localised_non_english_reference";
  if (reason === "embedded_subtitle_reference") return "segment_source_has_embedded_subtitle_reference";
  return null;
}

function segmentMetadataRejectReason(segment = {}) {
  return metadataRejectReasonToSegmentReason(officialMediaReferenceRejectReason(segment));
}

function segmentRejectionReason(segment = {}) {
  return segmentMetadataRejectReason(segment) || segment.validation_reason || "unvalidated_segment";
}

function segmentValidated(segment = {}) {
  if (segmentMetadataRejectReason(segment)) return false;
  return (
    segment.allowed_for_flash_lane === true ||
    (segment.segment_validated === true && String(segment.status || "").toLowerCase() === "validated")
  );
}

function segmentRejected(segment = {}) {
  return !segmentValidated(segment);
}

function segmentSourceUrl(segment = {}) {
  return String(segment.source_url || segment.sourceUrl || segment.clip_url || segment.reference_url || "").trim();
}

function parseSteamTrailerUrl(sourceUrl) {
  const text = String(sourceUrl || "");
  const match = text.match(/store_trailers\/(\d+)\/(\d+)\//i);
  if (!match) return null;
  return {
    provider: "steam",
    store_app_id: match[1],
    movie_id: match[2],
    reference_title: `Steam movie ${match[2]}`,
  };
}

function normaliseSourceFamilyValue(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function segmentSourceFamily(segment = {}) {
  const sourceUrl = segmentSourceUrl(segment);
  const parsedSteam = parseSteamTrailerUrl(sourceUrl);
  const provider = normaliseSourceFamilyValue(
    segment.provider || segment.source || segment.provenance?.provider || parsedSteam?.provider,
  );
  const storeAppId = normaliseSourceFamilyValue(
    segment.store_app_id ||
      segment.storeAppId ||
      segment.provenance?.store_app_id ||
      segment.provenance?.storeAppId ||
      parsedSteam?.store_app_id,
  );
  const storeAppTitle = String(
    segment.store_app_title ||
      segment.storeAppTitle ||
      segment.provenance?.store_app_title ||
      segment.provenance?.storeAppTitle ||
      "",
  ).trim();
  const movieId = normaliseSourceFamilyValue(
    segment.movie_id ||
      segment.movieId ||
      segment.video_id ||
      segment.provenance?.movie_id ||
      segment.provenance?.movieId ||
      parsedSteam?.movie_id,
  );
  const referenceTitle = String(
    segment.reference_title ||
      segment.referenceTitle ||
      segment.movie_name ||
      segment.movieName ||
      segment.provenance?.reference_title ||
      segment.provenance?.referenceTitle ||
      parsedSteam?.reference_title ||
      "",
  ).trim();
  const sourceKey = normaliseSourceFamilyValue(sourceUrl.replace(/[?#].*$/, ""));
  const key = [provider || "unknown_provider", storeAppId || "unknown_app", movieId || sourceKey || "unknown_source"]
    .join("|")
    .slice(0, 260);
  return {
    key,
    provider: provider || null,
    store_app_id: storeAppId || null,
    store_app_title: storeAppTitle || null,
    movie_id: movieId || null,
    reference_title: referenceTitle || null,
    source_url: sourceUrl || null,
  };
}

function sourceFamiliesForSegments(segments = []) {
  const families = new Map();
  for (const segment of array(segments)) {
    const family = segmentSourceFamily(segment);
    if (!family.key || !family.key.trim()) continue;
    const existing =
      families.get(family.key) ||
      {
        ...family,
        attempted_segments: 0,
        validated_segments: 0,
        rejected_segments: 0,
        rejection_reasons: {},
        top_rejection_reason: null,
      };
    existing.attempted_segments += 1;
    if (segmentValidated(segment)) existing.validated_segments += 1;
    else {
      existing.rejected_segments += 1;
      const reason = segmentRejectionReason(segment);
      existing.rejection_reasons[reason] = (existing.rejection_reasons[reason] || 0) + 1;
    }
    existing.top_rejection_reason =
      Object.entries(existing.rejection_reasons).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ||
      null;
    families.set(family.key, existing);
  }
  return [...families.values()].sort((a, b) => {
    const rejected = Number(b.rejected_segments || 0) - Number(a.rejected_segments || 0);
    if (rejected) return rejected;
    return String(a.key).localeCompare(String(b.key));
  });
}

function sourceFamilyExhausted(family = {}) {
  return (
    Number(family.rejected_segments || 0) >= EXHAUSTED_SOURCE_FAMILY_REJECT_THRESHOLD ||
    Number(family.attempted_segments || 0) >= EXHAUSTED_ENTITY_ATTEMPT_THRESHOLD
  );
}

function allAttemptedSourceFamiliesExhausted(inventory = {}) {
  const families = array(inventory.source_families);
  return families.length > 0 && families.every(sourceFamilyExhausted);
}

function storySegments(segmentValidationReport = {}, storyId) {
  return array(segmentValidationReport?.segments).filter(
    (segment) => inferStoryIdFromSegment(segment, segmentValidationReport) === storyId,
  );
}

function segmentFacts(segmentValidationReport, storyId) {
  const segments = storySegments(segmentValidationReport, storyId);
  const validated = segments.filter(segmentValidated);
  const rejected = segments.filter(segmentRejected);
  const entities = unique(segments.map((segment) => segment.entity));
  return {
    total_segments: segments.length,
    validated_segments: validated.length,
    validated_source_count: unique(validated.map(segmentSourceUrl)).length,
    rejected_segments: rejected.length,
    validated_entities: unique(validated.map((segment) => segment.entity)),
    validated_coverage_labels: unique(validated.flatMap(segmentCoverageLabels)),
    attempted_entities: unique(segments.map((segment) => segment.entity)),
    entity_inventory: Object.fromEntries(
      entities.map((entity) => {
        const entitySegments = segments.filter((segment) => String(segment.entity || "") === entity);
        const entityValidated = entitySegments.filter(segmentValidated);
        const entityRejected = entitySegments.filter(segmentRejected);
        const rejectionReasons = countBy(
          entityRejected,
          segmentRejectionReason,
        );
        const topRejectionReason =
          Object.entries(rejectionReasons).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || null;
        const sourceFamilies = sourceFamiliesForSegments(entitySegments);
        return [
          entity,
          {
            attempted_segments: entitySegments.length,
            validated_segments: entityValidated.length,
            rejected_segments: entityRejected.length,
            source_count: unique(entitySegments.map(segmentSourceUrl)).length,
            source_family_count: sourceFamilies.length,
            source_families: sourceFamilies,
            rejection_reasons: rejectionReasons,
            top_rejection_reason: topRejectionReason,
          },
        ];
      }),
    ),
    rejection_reasons: countBy(rejected, segmentRejectionReason),
    rejection_reasons_by_entity: Object.fromEntries(
      unique(rejected.map((segment) => segment.entity)).map((entity) => [
        entity,
        countBy(
          rejected.filter((segment) => String(segment.entity || "") === entity),
          segmentRejectionReason,
        ),
      ]),
    ),
  };
}

function buildAcquisitionStrategy(storyEntities = [], segment = {}, options = {}) {
  const entityStatuses = {};
  const allStoryEntitiesValidated =
    storyEntities.length > 0 &&
    storyEntities.every((entity) => Number(segment.entity_inventory?.[entity]?.validated_segments || 0) > 0);
  const needsMoreWindows =
    Number(options.missingValidatedClipRefs || 0) > 0 ||
    Number(options.missingValidatedClipSources || 0) > 0 ||
    options.needsMoreFootageDominance === true;
  for (const entity of storyEntities) {
    const inventory = segment.entity_inventory?.[entity] || {
      attempted_segments: 0,
      validated_segments: 0,
      rejected_segments: 0,
      source_count: 0,
      source_family_count: 0,
      source_families: [],
      rejection_reasons: {},
      top_rejection_reason: null,
    };
    let status = "not_sampled";
    let recommendation = "run_initial_segment_scan";
    if (inventory.validated_segments > 0) {
      if (allStoryEntitiesValidated && needsMoreWindows && allAttemptedSourceFamiliesExhausted(inventory)) {
        status = "alternate_source_required";
        recommendation = "find_alternate_official_source_family";
      } else if (allStoryEntitiesValidated && needsMoreWindows) {
        status = "keep_sampling";
        recommendation = "find_additional_validated_clip_window_for_existing_entity";
      } else {
        status = "validated";
        recommendation = "keep_as_validated_motion_source";
      }
    } else if (inventory.attempted_segments >= EXHAUSTED_ENTITY_ATTEMPT_THRESHOLD) {
      status = "alternate_source_required";
      recommendation = "find_alternate_official_source_family";
    } else if (inventory.attempted_segments > 0) {
      status = "keep_sampling";
      recommendation = "continue_segment_scan_with_resume";
    }
    entityStatuses[entity] = {
      status,
      recommendation,
      attempted_segments: inventory.attempted_segments,
      validated_segments: inventory.validated_segments,
      rejected_segments: inventory.rejected_segments,
      source_count: inventory.source_count,
      source_family_count: inventory.source_family_count,
      source_families: array(inventory.source_families),
      top_rejection_reason: inventory.top_rejection_reason,
      rejection_reasons: inventory.rejection_reasons,
    };
  }

  const alternateSourceEntities = Object.entries(entityStatuses)
    .filter(([, row]) => row.status === "alternate_source_required")
    .map(([entity]) => entity);
  const unattemptedEntities = Object.entries(entityStatuses)
    .filter(([, row]) => row.status === "not_sampled")
    .map(([entity]) => entity);
  const keepSamplingEntities = Object.entries(entityStatuses)
    .filter(([, row]) => row.status === "keep_sampling")
    .map(([entity]) => entity);
  const validatedEntities = Object.entries(entityStatuses)
    .filter(([, row]) => row.status === "validated")
    .map(([entity]) => entity);

  let status = "no_story_entities";
  if (storyEntities.length && alternateSourceEntities.length) {
    status = "alternate_official_sources_required";
  } else if (storyEntities.length && unattemptedEntities.length) {
    status = "needs_first_segment_scan";
  } else if (storyEntities.length && keepSamplingEntities.length) {
    status = "continue_segment_scan";
  } else if (storyEntities.length && validatedEntities.length === storyEntities.length) {
    status = "entity_motion_coverage_ready";
  }

  return {
    status,
    attempt_threshold: EXHAUSTED_ENTITY_ATTEMPT_THRESHOLD,
    entity_statuses: entityStatuses,
    alternate_source_entities: alternateSourceEntities,
    unattempted_entities: unattemptedEntities,
    keep_sampling_entities: keepSamplingEntities,
    validated_entities: validatedEntities,
  };
}

function candidateStoryEntities(candidate = {}) {
  return unique([
    ...array(candidate.visuals?.story_target_entities),
    ...array(candidate.visuals?.exact_subject_groups),
    ...array(candidate.visuals?.frame_groups),
    ...array(candidate.visuals?.validated_clip_entities),
  ]);
}

function minValidatedClipRefs(proofCandidateReport = {}) {
  return Number(
    proofCandidateReport.thresholds?.flash_min_validated_clip_refs ||
      proofCandidateReport.thresholds?.flashMinValidatedClipRefs ||
      DEFAULT_MIN_VALIDATED_CLIP_REFS,
  );
}

function minClipDominance(proofCandidateReport = {}) {
  const value = Number(
    proofCandidateReport.thresholds?.flash_min_clip_dominance ||
      proofCandidateReport.thresholds?.flashMinClipDominance ||
      DEFAULT_MIN_FLASH_CLIP_DOMINANCE,
  );
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MIN_FLASH_CLIP_DOMINANCE;
}

function roundSeconds(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function normaliseProofStoryId(value) {
  const raw = String(value || "").trim();
  return raw.replace(/_(baseline|enriched)$/i, "");
}

function forensicStoryId(report = {}) {
  return normaliseProofStoryId(report.story_id || report.storyId || report.summary?.storyId);
}

function latestForensicReports(context = {}) {
  if (Array.isArray(context.latestForensicReports)) return context.latestForensicReports;
  return context.latestForensicReport ? [context.latestForensicReport] : [];
}

function latestRenderProofForStory(context = {}, storyId) {
  const report = latestForensicReports(context).find(
    (item) => forensicStoryId(item) === normaliseProofStoryId(storyId),
  );
  if (!report) {
    return {
      status: "not_available",
      needs_human_visual_review: false,
    };
  }
  const summary = report.summary || {};
  const details = summariseForensicWarnings(report);
  const verdict = summary.verdict || report.verdict || "unknown";
  const failCount = Number(summary.failCount || summary.fail_count || 0);
  const warnCount = Number(summary.warnCount || summary.warn_count || 0);
  const needsReview =
    verdict !== "pass" ||
    failCount > 0 ||
    warnCount > 0 ||
    details.repeat_pair_count > 0 ||
    details.weak_frame_count > 0;
  return {
    status: "available",
    story_id: forensicStoryId(report),
    verdict,
    fail_count: failCount,
    warn_count: warnCount,
    needs_human_visual_review: needsReview,
    issue_codes: details.issue_codes,
    repeat_pair_count: details.repeat_pair_count,
    repeat_pair_times: details.repeat_pair_times,
    weak_frame_count: details.weak_frame_count,
    weak_frame_times: details.weak_frame_times,
    rating_or_title_frame_count: details.rating_or_title_frame_count,
  };
}

function buildSafeCommands(candidate, row) {
  const storyId = candidate.story_id;
  const storyReferenceReport = storyReferenceReportRelativePath(storyId);
  const commands = [];
  if (row.render_recommendation === "ready_for_local_flash_proof" && candidate.recommended_command) {
    commands.push({
      purpose: "run_local_flash_proof",
      command: candidate.recommended_command,
      safety: "local_only_render_proof",
    });
    return commands;
  }

  if (row.motion_gap.acquisition_strategy?.alternate_source_entities?.length) {
    commands.push({
      purpose: "validate_operator_official_source_intake",
      command: `npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id ${storyId}`,
      safety: "report_only_reference_validation",
    });
    commands.push({
      purpose: "resolve_alternate_official_trailer_refs",
      command: `npm run media:resolve-trailers -- --story-id ${storyId} --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`,
      safety: "network_metadata_lookup_report_only",
    });
  }

  if (row.motion_gap.needs_more_motion || row.motion_gap.needs_exact_subject_assets) {
    if (!row.motion_gap.acquisition_strategy?.alternate_source_entities?.length) {
      commands.push({
        purpose: "resolve_more_official_trailer_refs",
        command: `npm run media:resolve-trailers -- --story-id ${storyId} --no-latest-report`,
        safety: "network_metadata_lookup_report_only",
      });
    }
    commands.push(
      {
        purpose: "plan_frame_sampling",
        command: `npm run media:plan-frames -- --story-id ${storyId} --trailer-references ${storyReferenceReport}`,
        safety: "report_only",
      },
      {
        purpose: "extract_safe_local_frames",
        command: `npm run media:extract-frames -- --story-id ${storyId} --apply-local`,
        safety: "apply_local_under_test_output_only",
      },
      {
        purpose: "validate_gameplay_clip_windows",
        command: `npm run media:validate-trailer-segments -- --story-id ${storyId} --apply-local --deep-scan --reference-report ${storyReferenceReport} --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`,
        safety: "apply_local_under_test_output_only",
      },
    );
  }

  if (row.audio_gap.needs_liam_audio) {
    commands.push(
      {
        purpose: "refresh_local_audio_repair_queue",
        command: "npm run ops:local-media-repair -- --limit 20 --dry-run",
        safety: "report_only",
      },
      {
        purpose: "generate_sleepy_liam_audio_locally_after_visuals_are_ready",
        command: "npm run ops:local-script-extension -- --apply-local-audio",
        safety: "apply_local_audio_only",
      },
    );
  }

  commands.push({
    purpose: "recheck_flash_lane_readiness",
    command: `npm run studio:v2:proof-candidates -- --story ${storyId}`,
    safety: "report_only",
  });
  return commands;
}

function prioritySteps(candidate, motionGap, audioGap) {
  const steps = [];
  const alternateSourceEntities = array(motionGap.acquisition_strategy?.alternate_source_entities);
  const unattemptedEntities = array(motionGap.acquisition_strategy?.unattempted_entities);
  if (alternateSourceEntities.length) {
    steps.push(`find_alternate_official_sources_for:${alternateSourceEntities.join(",")}`);
    steps.push(`do_not_rescan_same_official_sources_for:${alternateSourceEntities.join(",")}`);
  }
  if (unattemptedEntities.length) {
    steps.push(`run_initial_segment_scan_for:${unattemptedEntities.join(",")}`);
  }
  if (motionGap.missing_validated_clip_refs > 0) {
    const missing = motionGap.missing_validated_clip_refs;
    steps.push(
      missing === 1
        ? "find_one_more_validated_gameplay_clip_window"
        : `find_${missing}_more_validated_gameplay_clip_windows`,
    );
  }
  if (motionGap.missing_validated_clip_sources > 0) {
    const missing = motionGap.missing_validated_clip_sources;
    steps.push(
      missing === 1
        ? "find_one_more_validated_clip_source"
        : `find_${missing}_more_validated_clip_sources`,
    );
  }
  if (motionGap.needs_footage_backbone_dominance) {
    steps.push("find_more_validated_gameplay_seconds_for_flash_lane");
  }
  if (motionGap.needs_exact_subject_assets) {
    steps.push("acquire_exact_subject_images_or_official_motion_refs");
  }
  if (motionGap.missing_validated_entities.length) {
    steps.push(`cover_missing_entities:${motionGap.missing_validated_entities.join(",")}`);
  }
  if (audioGap.needs_liam_audio) {
    const visualBlockers = array(candidate.blockers).some((blocker) =>
      /^flash_proof_requires_/.test(blocker),
    );
    steps.push(
      visualBlockers
        ? "generate_approved_sleepy_liam_audio_after_visuals_are_ready"
        : "generate_approved_sleepy_liam_audio_now",
    );
  }
  if (array(candidate.blockers).includes("latest_render_forensic_warnings")) {
    steps.push("repair_motion_quality_before_next_proof");
  }
  if (!steps.length) steps.push("ready_for_local_flash_render_preflight");
  return unique(steps);
}

function buildGap(candidate = {}, context = {}) {
  const threshold = context.minValidatedClipRefs || DEFAULT_MIN_VALIDATED_CLIP_REFS;
  const clipDominanceThreshold = context.minClipDominance || DEFAULT_MIN_FLASH_CLIP_DOMINANCE;
  const segment = segmentFacts(context.segmentValidationReport, candidate.story_id);
  const hasSegmentValidationRows = Number(segment.total_segments || 0) > 0;
  const storyEntities = candidateStoryEntities(candidate);
  const validatedEntities = hasSegmentValidationRows
    ? segment.validated_entities
    : unique([...array(candidate.visuals?.validated_clip_entities), ...segment.validated_entities]);
  const validatedCoverageLabels = hasSegmentValidationRows
    ? unique([...validatedEntities, ...segment.validated_coverage_labels])
    : unique([
        ...validatedEntities,
        ...array(candidate.visuals?.validated_clip_coverage_labels),
        ...segment.validated_coverage_labels,
      ]);
  const missingValidatedEntities = coverageForGroups(storyEntities, validatedCoverageLabels).missingGroups;
  const validatedClipRefs = Number(
    hasSegmentValidationRows ? segment.validated_segments : candidate.visuals?.validated_clip_ref_count || 0,
  );
  const validatedClipSources = Number(
    hasSegmentValidationRows ? segment.validated_source_count : candidate.visuals?.validated_clip_source_count || 0,
  );
  const exactSubjectCount = Number(candidate.visuals?.exact_subject_count || 0);
  const acceptedFrameCount = Number(candidate.visuals?.accepted_frame_count || 0);
  const motionContradictsReadyProof =
    hasSegmentValidationRows &&
    candidate.verdict === "ready_flash_proof" &&
    (Math.max(0, threshold - validatedClipRefs) > 0 ||
      Math.max(0, threshold - validatedClipSources) > 0 ||
      missingValidatedEntities.length > 0);
  const blockers = unique([
    ...array(candidate.blockers),
    ...(motionContradictsReadyProof ? ["segment_validation_report_invalidates_ready_motion"] : []),
  ]);
  const needsFootageBackboneDominance =
    blockers.includes("flash_proof_requires_footage_backbone_dominance") ||
    blockers.includes("footage_backbone_clip_dominance_too_low");
  const audioDurationSeconds = Number(candidate.audio?.duration_seconds);
  const projectedClipSeconds = Number(candidate.visuals?.projected_clip_seconds);
  const requiredClipSecondsForDominance =
    Number.isFinite(audioDurationSeconds) && audioDurationSeconds > 0
      ? roundSeconds(audioDurationSeconds * clipDominanceThreshold)
      : null;
  const missingClipSecondsForDominance =
    needsFootageBackboneDominance &&
    Number.isFinite(projectedClipSeconds) &&
    requiredClipSecondsForDominance !== null
      ? roundSeconds(Math.max(0, requiredClipSecondsForDominance - projectedClipSeconds))
      : null;
  const latestRenderProof =
    candidate.latest_render_proof?.status === "available"
      ? candidate.latest_render_proof
      : latestRenderProofForStory(context, candidate.story_id);
  const acquisitionEntities = missingValidatedEntities.length ? storyEntities : unique(validatedEntities);
  const acquisitionStrategy = buildAcquisitionStrategy(acquisitionEntities, segment, {
    missingValidatedClipRefs: Math.max(0, threshold - validatedClipRefs),
    missingValidatedClipSources: Math.max(0, threshold - validatedClipSources),
    needsMoreFootageDominance: needsFootageBackboneDominance,
  });

  const renderReady = candidate.verdict === "ready_flash_proof" && !motionContradictsReadyProof;
  const audioGap = {
    status: candidate.audio?.status || "unknown",
    ready: candidate.audio?.ready === true,
    needs_liam_audio: blockers.includes("approved_liam_audio_missing"),
    duration_seconds: candidate.audio?.duration_seconds ?? null,
    output_audio_path: candidate.audio?.output_audio_path || null,
  };
  const motionGap = {
    exact_subject_count: exactSubjectCount,
    accepted_frame_count: acceptedFrameCount,
    validated_clip_ref_count: validatedClipRefs,
    missing_validated_clip_refs: Math.max(0, threshold - validatedClipRefs),
    validated_clip_source_count: validatedClipSources,
    missing_validated_clip_sources: Math.max(0, threshold - validatedClipSources),
    story_entities: storyEntities,
    validated_entities: validatedEntities,
    validated_coverage_labels: validatedCoverageLabels,
    missing_validated_entities: missingValidatedEntities,
    acquisition_strategy: acquisitionStrategy,
    segment_inventory: segment,
    rejection_reasons: segment.rejection_reasons,
    rejection_reasons_by_entity: segment.rejection_reasons_by_entity,
    footage_backbone_verdict: candidate.visuals?.footage_backbone_verdict || null,
    projected_clip_seconds: candidate.visuals?.projected_clip_seconds ?? null,
    projected_clip_dominance: candidate.visuals?.projected_clip_dominance ?? null,
    required_clip_seconds_for_dominance: requiredClipSecondsForDominance,
    missing_clip_seconds_for_dominance: missingClipSecondsForDominance,
    projected_motion_seconds: candidate.visuals?.projected_motion_seconds ?? null,
    projected_motion_dominance: candidate.visuals?.projected_motion_dominance ?? null,
    needs_footage_backbone_dominance: needsFootageBackboneDominance,
    needs_more_motion:
      blockers.includes("flash_proof_requires_motion_backbone") ||
      blockers.includes("flash_proof_requires_three_validated_clip_refs") ||
      needsFootageBackboneDominance ||
      Math.max(0, threshold - validatedClipRefs) > 0 ||
      Math.max(0, threshold - validatedClipSources) > 0,
    needs_exact_subject_assets: blockers.includes("flash_proof_requires_four_exact_subject_assets"),
  };

  const row = {
    story_id: candidate.story_id,
    title: candidate.title || "Untitled",
    candidate_verdict: candidate.verdict || "unknown",
    render_recommendation: renderReady ? "ready_for_local_flash_proof" : "do_not_render_yet",
    blockers,
    audio_gap: audioGap,
    motion_gap: motionGap,
    latest_render_proof: latestRenderProof,
    readiness_score:
      (candidate.verdict === "ready_flash_proof" ? 1000 : 0) +
      Math.min(4, exactSubjectCount) * 4 +
      Math.min(3, validatedClipRefs) * 6 +
      Math.min(3, acceptedFrameCount) * 2 +
      (audioGap.ready ? 5 : 0),
    priority_next_steps: [],
    recommended_commands: [],
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
  row.priority_next_steps = prioritySteps(candidate, motionGap, audioGap);
  if (latestRenderProof.needs_human_visual_review) {
    row.priority_next_steps = unique([
      "review_latest_render_forensic_warnings_before_pilot",
      ...row.priority_next_steps,
    ]);
  }
  row.recommended_commands = buildSafeCommands(candidate, row);
  return row;
}

function buildStudioV2MotionGapReport({
  proofCandidateReport = {},
  segmentValidationReport = null,
  latestForensicReport = null,
  latestForensicReports = null,
  storyId = null,
  limit = 10,
} = {}) {
  const threshold = minValidatedClipRefs(proofCandidateReport);
  const clipDominanceThreshold = minClipDominance(proofCandidateReport);
  const candidates = array(proofCandidateReport.candidates)
    .filter((candidate) => !storyId || candidate.story_id === storyId)
    .slice(0, Math.max(1, Number(limit) || 10));
  const gaps = candidates.map((candidate) =>
    buildGap(candidate, {
      segmentValidationReport,
      minValidatedClipRefs: threshold,
      minClipDominance: clipDominanceThreshold,
      latestForensicReport,
      latestForensicReports,
    }),
  ).sort((a, b) => {
    const readiness = Number(b.readiness_score || 0) - Number(a.readiness_score || 0);
    if (readiness) return readiness;
    return String(a.story_id || "").localeCompare(String(b.story_id || ""));
  });
  const blockerFrequency = countBy(gaps.flatMap((gap) => gap.blockers), (item) => item);
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    summary: {
      total: gaps.length,
      ready_flash_proofs: gaps.filter((gap) => gap.render_recommendation === "ready_for_local_flash_proof").length,
      ready_flash_proofs_with_forensic_warnings: gaps.filter(
        (gap) =>
          gap.render_recommendation === "ready_for_local_flash_proof" &&
          gap.latest_render_proof?.needs_human_visual_review,
      ).length,
      blocked_flash_proofs: gaps.filter((gap) => gap.render_recommendation !== "ready_for_local_flash_proof").length,
      closest_story_id: gaps[0]?.story_id || null,
      blocker_frequency: blockerFrequency,
    },
    thresholds: {
      flash_min_validated_clip_refs: threshold,
      flash_min_clip_dominance: clipDominanceThreshold,
    },
    gaps,
    safety: {
      local_only: true,
      report_only: true,
      renders_video: false,
      calls_tts: false,
      posts_to_platforms: false,
      mutates_production_db: false,
      mutates_railway: false,
      mutates_oauth: false,
      changes_render_defaults: false,
    },
  };
}

function renderStudioV2MotionGapMarkdown(report = {}) {
  const lines = [
    "# Studio V2 Motion Gap Planner",
    "",
    "This is local-only and report-only. It turns blocked Flash Lane proofs into concrete acquisition work.",
    "",
    "## Summary",
    "",
    `- Ready local Flash proofs: ${report.summary?.ready_flash_proofs || 0}`,
    `- Blocked Flash proofs: ${report.summary?.blocked_flash_proofs || 0}`,
    `- Closest story: ${report.summary?.closest_story_id || "none"}`,
    "",
  ];

  for (const gap of array(report.gaps)) {
    lines.push(
      `## ${gap.story_id}`,
      "",
      `- Title: ${gap.title}`,
      `- Recommendation: ${gap.render_recommendation}`,
      `- Blockers: ${gap.blockers.length ? gap.blockers.join(", ") : "clear"}`,
      `- Liam audio: ${gap.audio_gap.status}`,
      `- Exact assets: ${gap.motion_gap.exact_subject_count}`,
      `- Motion frames: ${gap.motion_gap.accepted_frame_count}`,
      `- Validated clip refs: ${gap.motion_gap.validated_clip_ref_count}`,
      `- Validated clip sources: ${gap.motion_gap.validated_clip_source_count}`,
      `- Projected clip dominance: ${gap.motion_gap.projected_clip_dominance ?? "unknown"}`,
      `- Clip dominance shortfall: ${
        gap.motion_gap.missing_clip_seconds_for_dominance === null ||
        gap.motion_gap.missing_clip_seconds_for_dominance === undefined
          ? "unknown"
          : `${Number(gap.motion_gap.missing_clip_seconds_for_dominance).toFixed(1)}s`
      }`,
      `- Validated entities: ${gap.motion_gap.validated_entities.join(", ") || "none"}`,
      `- Missing entities: ${gap.motion_gap.missing_validated_entities.join(", ") || "none"}`,
      `- Acquisition strategy: ${gap.motion_gap.acquisition_strategy?.status || "unknown"}`,
      `- Latest render proof: ${
        gap.latest_render_proof?.status === "available"
          ? `${gap.latest_render_proof.verdict} (${gap.latest_render_proof.fail_count} fail / ${gap.latest_render_proof.warn_count} warn)`
          : "not available"
      }`,
      "",
      "### Acquisition Strategy",
      "",
    );
    const strategy = gap.motion_gap.acquisition_strategy || {};
    lines.push(`- Status: ${strategy.status || "unknown"}`);
    lines.push(
      `- Alternate-source entities: ${array(strategy.alternate_source_entities).join(", ") || "none"}`,
    );
    lines.push(`- Unattempted entities: ${array(strategy.unattempted_entities).join(", ") || "none"}`);
    lines.push(`- Keep-sampling entities: ${array(strategy.keep_sampling_entities).join(", ") || "none"}`);
    const entityRows = Object.entries(strategy.entity_statuses || {});
    if (entityRows.length) {
      lines.push(
        "",
        "| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |",
      );
      lines.push("| --- | --- | ---: | ---: | ---: | --- | --- |");
      for (const [entity, row] of entityRows) {
        lines.push(
          `| ${mdCell(entity)} | ${mdCell(row.status)} | ${row.attempted_segments} | ${row.validated_segments} | ${
            row.source_family_count || 0
          } | ${mdCell(row.top_rejection_reason || "none")} | ${mdCell(row.recommendation)} |`,
        );
      }
    }
    const sourceFamilyRows = entityRows.flatMap(([entity, row]) =>
      array(row.source_families).map((family) => ({ entity, ...family })),
    );
    if (sourceFamilyRows.length) {
      lines.push("", "#### Source families", "");
      lines.push("| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |");
      lines.push("| --- | --- | --- | --- | ---: | ---: | --- |");
      for (const family of sourceFamilyRows.slice(0, 12)) {
        const sourceLabel =
          family.reference_title ||
          family.movie_id ||
          (family.source_url ? String(family.source_url).replace(/^https?:\/\//i, "").slice(0, 72) : "unknown");
        lines.push(
          `| ${mdCell(family.entity)} | ${mdCell(family.provider || "unknown")} | ${mdCell(
            family.store_app_title || family.store_app_id || "unknown",
          )} | ${mdCell(sourceLabel)} | ${family.attempted_segments} | ${family.rejected_segments} | ${mdCell(
            family.top_rejection_reason || "none",
          )} |`,
        );
      }
    }
    lines.push(
      "",
      "### Next Steps",
      "",
    );
    for (const step of gap.priority_next_steps) lines.push(`- ${step}`);
    lines.push("", "### Safe Commands", "");
    for (const item of gap.recommended_commands) {
      lines.push(`- ${item.purpose}: \`${item.command}\``);
    }
    lines.push("", "### Segment Rejections", "");
    const rejectionEntries = Object.entries(gap.motion_gap.rejection_reasons || {});
    if (!rejectionEntries.length) lines.push("- none");
    for (const [reason, count] of rejectionEntries) lines.push(`- ${reason}: ${count}`);
    if (gap.latest_render_proof?.needs_human_visual_review) {
      lines.push("", "### Latest Render Forensic Warnings", "");
      lines.push(`- Issue codes: ${gap.latest_render_proof.issue_codes.join(", ") || "unknown"}`);
      lines.push(`- Repeat pair count: ${gap.latest_render_proof.repeat_pair_count}`);
      if (gap.latest_render_proof.repeat_pair_times.length) {
        lines.push(`- Repeat pair times: ${gap.latest_render_proof.repeat_pair_times.join(", ")}`);
      }
      lines.push(`- Weak rendered frame count: ${gap.latest_render_proof.weak_frame_count}`);
      if (gap.latest_render_proof.weak_frame_times.length) {
        lines.push(`- Weak rendered frames: ${gap.latest_render_proof.weak_frame_times.join(", ")}`);
      }
      lines.push(`- Rating/title frame count: ${gap.latest_render_proof.rating_or_title_frame_count}`);
    }
    lines.push("");
  }

  lines.push(
    "## Safety",
    "",
    "- No DB, Railway, OAuth, render-default or posting changes.",
    "- No video render is started by this command.",
    "- No trailer, browser, social or unofficial media download is started by this command.",
  );
  return lines.join("\n").trimEnd() + "\n";
}

module.exports = {
  buildStudioV2MotionGapReport,
  renderStudioV2MotionGapMarkdown,
};
