"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function positiveMax(...values) {
  const numbers = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return numbers.length ? Math.max(...numbers) : 0;
}

function storyArtifactPath(item = {}, filename = "") {
  const storyId = cleanText(item.story_id);
  const base = cleanText(item.artifact_dir) || `output/goal-proof/batch/${storyId}`;
  return filename ? path.join(base, filename) : base;
}

function commandArg(value = "") {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function timeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function hasAny(blockers = [], names = []) {
  const set = new Set(asArray(blockers));
  return names.some((name) => set.has(name));
}

function normalProductionDurationBlockers(blockers = []) {
  return asArray(blockers).filter((blocker) =>
    /^normal_production_duration_below_quality_floor:/i.test(cleanText(blocker)),
  );
}

function durationFromNormalProductionBlocker(blocker = "") {
  const match = cleanText(blocker).match(/:(\d+(?:\.\d+)?)$/);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceFamilyRowsByStory(report = {}) {
  const rows = new Map();
  for (const row of asArray(report.rows)) {
    const storyId = cleanText(row.story_id || row.storyId || row.id);
    if (storyId) rows.set(storyId, row);
  }
  return rows;
}

function validationSourceFamily(segment = {}) {
  const movieId = cleanText(segment.movie_id);
  if (movieId) return `steam_movie:${movieId}`;
  const sourceUrlMovieId = steamMovieIdFromText(segment.source_url || segment.clip_key);
  if (sourceUrlMovieId) return `steam_movie:${sourceUrlMovieId}`;
  const explicit = cleanText(segment.source_family || segment.motion_family);
  if (explicit) {
    const explicitMovieId = steamMovieIdFromText(explicit);
    return explicitMovieId ? `steam_movie:${explicitMovieId}` : explicit;
  }
  const sourceUrl = cleanText(segment.source_url);
  if (sourceUrl) return sourceUrl.split("?")[0];
  return cleanText(segment.clip_key);
}

function segmentValidated(segment = {}) {
  if (segmentRejected(segment)) return false;
  return (
    segment.segment_validated === true ||
    segment.allowed_for_flash_lane === true ||
    cleanText(segment.status) === "validated" ||
    cleanText(segment.segment_motion_class) === "gameplay_action"
  );
}

function steamMovieIdFromText(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  const storeTrailerMatch = text.match(/store_trailers[\\/]\d+[\\/](\d{4,})/i);
  if (storeTrailerMatch) return storeTrailerMatch[1];
  const steamFamilyMatch = text.match(/steam[_-]\d+[_-](\d{4,})/i);
  if (steamFamilyMatch) return steamFamilyMatch[1];
  return "";
}

function segmentMediaStart(segment = {}) {
  const value = Number(
    segment.recommended_media_start_s ??
      segment.media_start_s ??
      segment.start_s ??
      segment.start ??
      NaN,
  );
  return Number.isFinite(value) ? value.toFixed(2) : "";
}

function segmentIdentityKey(segment = {}, fallbackIndex = 0) {
  const clipKey = cleanText(segment.clip_key);
  if (clipKey) return `clip:${clipKey}`;
  const family = validationSourceFamily(segment);
  const start = segmentMediaStart(segment);
  const duration = Number(segment.recommended_duration_s ?? segment.duration_s ?? NaN);
  const durationKey = Number.isFinite(duration) ? duration.toFixed(2) : "";
  if (family && (start || durationKey)) return [family, start, durationKey].join("|");
  const order = cleanText(segment.order);
  if (family && order) return [family, `order:${order}`].join("|");
  return `fallback:${fallbackIndex}`;
}

function reportFreshnessMs(report = {}, fallbackIndex = 0) {
  const ms = timeMs(report.generated_at);
  return ms == null ? fallbackIndex : ms;
}

function segmentRejected(segment = {}) {
  return (
    segment.segment_validated === false ||
    /^rejected/i.test(cleanText(segment.status)) ||
    cleanText(segment.allowed_for_flash_lane) === "false"
  );
}

function segmentValidationByStory(reports = []) {
  const map = new Map();
  const segmentRecords = new Map();
  const summaryReports = [];

  const upsertSegment = (segment = {}, report = {}, reportIndex = 0, segmentIndex = 0) => {
    const storyId = cleanText(segment.story_id || segment.storyId || segment.id);
    if (!storyId) return;
    const identity = segmentIdentityKey(segment, segmentIndex);
    const key = `${storyId}|${identity}`;
    const incoming = {
      segment,
      generatedMs: reportFreshnessMs(report, reportIndex),
      reportIndex,
    };
    const current = segmentRecords.get(key);
    if (
      !current ||
      incoming.generatedMs > current.generatedMs ||
      (incoming.generatedMs === current.generatedMs && incoming.reportIndex >= current.reportIndex)
    ) {
      segmentRecords.set(key, incoming);
    }
  };

  for (const [reportIndex, report] of asArray(reports).entries()) {
    const segments = asArray(report.segments);
    if (segments.length) {
      for (const [segmentIndex, segment] of segments.entries()) {
        upsertSegment(segment, report, reportIndex, segmentIndex);
      }
      continue;
    }
    summaryReports.push(report);
  }

  const ingestSegment = (segment = {}) => {
    const storyId = cleanText(segment.story_id || segment.storyId || segment.id);
    if (!storyId) return;
    const current = map.get(storyId) || {
      story_id: storyId,
      segment_count: 0,
      validated_segments: 0,
      rejected_segments: 0,
      source_families: new Set(),
      rejection_reasons: {},
    };
    current.segment_count += 1;
    const validated = segmentValidated(segment);
    if (validated) current.validated_segments += 1;
    if (segmentRejected(segment)) current.rejected_segments += 1;
    const family = validationSourceFamily(segment);
    if (validated && family) current.source_families.add(family);
    const reason = cleanText(segment.validation_reason || segment.rejection_reason);
    if (reason) current.rejection_reasons[reason] = (current.rejection_reasons[reason] || 0) + 1;
    map.set(storyId, current);
  };

  for (const record of segmentRecords.values()) ingestSegment(record.segment);

  for (const report of summaryReports) {
    const storyId = cleanText(report.story_id || report.storyId || report.id);
    if (!storyId) continue;
    const summary = report.summary || {};
    const incoming = {
      story_id: storyId,
      segment_count: Number(summary.segments || report.segment_count || 0),
      validated_segments: Number(summary.segments_validated || report.validated_segments || 0),
      rejected_segments: Number(summary.segments_rejected || report.rejected_segments || 0),
      source_families: new Set(asArray(report.source_families).map(cleanText).filter(Boolean)),
      rejection_reasons: report.rejection_reasons || {},
    };
    const current = map.get(storyId);
    if (!current) {
      map.set(storyId, incoming);
      continue;
    }
    current.segment_count = Math.max(current.segment_count, incoming.segment_count);
    current.validated_segments = Math.max(current.validated_segments, incoming.validated_segments);
    current.rejected_segments = Math.max(current.rejected_segments, incoming.rejected_segments);
    for (const family of incoming.source_families) current.source_families.add(family);
    for (const [reason, count] of Object.entries(incoming.rejection_reasons || {})) {
      current.rejection_reasons[reason] = Math.max(
        Number(current.rejection_reasons[reason] || 0),
        Number(count || 0),
      );
    }
    map.set(storyId, current);
  }

  return map;
}

function topRejectionReason(validation = {}) {
  return (
    Object.entries(validation.rejection_reasons || {}).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ||
    null
  );
}

function sourceFamilyCandidates(row = {}) {
  return asArray(row.source_family_candidates || row.candidates);
}

function officialSearchActions(row = {}) {
  return asArray(row.official_search_actions || row.search_actions);
}

function sourceSearchBlockers(row = {}) {
  return asArray(row.source_search_blockers || row.search_blockers);
}

function sourceProofCoversAllTargets(row = {}) {
  const covered = asArray(row.source_proof_covered_target_entities).map(cleanText).filter(Boolean);
  const missing = asArray(row.source_proof_missing_target_entities).map(cleanText).filter(Boolean);
  return covered.length > 0 && missing.length === 0;
}

function isDirectMediaCandidate(candidate = {}) {
  if (candidate.segment_validation_eligible === true) return true;
  if (cleanText(candidate.status) === "ready_for_frame_plan") return true;
  const kind = cleanText(candidate.source_url_kind);
  if (["direct_video", "hls_manifest", "dash_manifest"].includes(kind)) return true;
  return /\.(?:mp4|mov|webm|m3u8|mpd)(?:[?#].*)?$/i.test(cleanText(candidate.source_url));
}

function realMotionJobsByStory(report = {}) {
  const rows = new Map();
  for (const job of asArray(report.jobs)) {
    const storyId = cleanText(job.story_id || job.storyId || job.id);
    if (storyId) rows.set(storyId, job);
  }
  return rows;
}

const OWNED_VISUAL_PLAN_BLOCKERS = new Set([
  "corporate_transaction_requires_owned_explainer_visual_plan",
  "legal_story_requires_source_card_or_human_visual_plan",
  "broad_platform_story_requires_specific_visual_plan",
]);

function requiresOwnedVisualPlan(blockers = []) {
  return asArray(blockers).some((blocker) => OWNED_VISUAL_PLAN_BLOCKERS.has(blocker));
}

function referenceReportPathForStory(storyId) {
  return `output/goal-contract/official_trailer_references_${storyId}_canonical_story_${storyId}.json`;
}

function realMotionAttemptEvidence(realMotionJob = {}) {
  if (!realMotionJob) return {};
  return {
    real_motion_blockers: asArray(realMotionJob.blockers).map(cleanText).filter(Boolean),
    candidate_count: Number(realMotionJob.candidate_count || 0),
    materialized_count: Number(realMotionJob.materialized_count || 0),
    distinct_motion_family_count: Number(realMotionJob.distinct_motion_family_count || 0),
    direct_video_motion_clip_count: Number(realMotionJob.direct_video_motion_clip_count || 0),
    direct_video_motion_family_count: Number(realMotionJob.direct_video_motion_family_count || 0),
    total_direct_video_motion_asset_count: Number(realMotionJob.total_direct_video_motion_asset_count || 0),
    total_direct_video_motion_family_count:
      Number(realMotionJob.total_direct_video_motion_family_count || 0),
    total_motion_clip_count: Number(realMotionJob.total_motion_clip_count || 0),
    total_distinct_motion_family_count: Number(realMotionJob.total_distinct_motion_family_count || 0),
    partial_evidence_path: cleanText(realMotionJob.partial_evidence_path) || null,
    partial_evidence_clip_count: Number(realMotionJob.partial_evidence_clip_count || 0),
    partial_evidence_counts_towards_final_render_readiness:
      realMotionJob.partial_evidence_counts_towards_final_render_readiness === true,
  };
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasOwnNumber(object = {}, key = "") {
  return object && Object.prototype.hasOwnProperty.call(object, key) && finiteNumberOrNull(object[key]) != null;
}

function freshDirectVideoCount(realMotionJob = {}, primaryKey = "", fallbackKey = "") {
  if (!realMotionJob) return null;
  if (hasOwnNumber(realMotionJob, primaryKey)) return Math.max(0, Number(realMotionJob[primaryKey]));
  if (hasOwnNumber(realMotionJob, fallbackKey)) return Math.max(0, Number(realMotionJob[fallbackKey]));
  return null;
}

function directVideoMotionCountEvidence({ motionReadiness = {}, renderEvidence = {}, realMotionJob = {} } = {}) {
  const staleCutoverAssetCount = positiveMax(
    motionReadiness.direct_video_motion_asset_count,
    renderEvidence.visual_evidence_profile?.direct_video_motion_asset_count,
  );
  const staleCutoverFamilyCount = positiveMax(
    motionReadiness.direct_video_motion_family_count,
    renderEvidence.visual_evidence_profile?.direct_video_motion_family_count,
  );
  const freshAssetCount = freshDirectVideoCount(
    realMotionJob,
    "direct_video_motion_clip_count",
    "total_direct_video_motion_asset_count",
  );
  const freshFamilyCount = freshDirectVideoCount(
    realMotionJob,
    "direct_video_motion_family_count",
    "total_direct_video_motion_family_count",
  );
  return {
    direct_video_motion_asset_count:
      freshAssetCount == null ? staleCutoverAssetCount : freshAssetCount,
    direct_video_motion_family_count:
      freshFamilyCount == null ? staleCutoverFamilyCount : freshFamilyCount,
    stale_cutover_direct_video_motion_asset_count: staleCutoverAssetCount,
    stale_cutover_direct_video_motion_family_count: staleCutoverFamilyCount,
    fresh_materialised_direct_video_motion_asset_count: freshAssetCount,
    fresh_materialised_direct_video_motion_family_count: freshFamilyCount,
  };
}

function classifyMotionRepairLane(item = {}, context = {}) {
  const storyId = cleanText(item.story_id);
  const sourceRow = context.sourceFamilyRows?.get(storyId) || {};
  const validation = context.segmentValidation?.get(storyId) || null;
  const realMotionJob = context.realMotionJobs?.get(storyId) || null;
  const candidates = sourceFamilyCandidates(sourceRow);
  const directMediaCandidates = candidates.filter(isDirectMediaCandidate);
  const needsDirectMediaCandidates = candidates.filter((candidate) => !isDirectMediaCandidate(candidate));
  const searches = officialSearchActions(sourceRow);
  const searchBlockers = sourceSearchBlockers(sourceRow);
  const renderInputBlockers = asArray(item.render_input_blockers).map(cleanText).filter(Boolean);
  const renderEvidence = item.render_input_evidence || {};
  const motionReadiness = renderEvidence.real_motion_input_readiness || {};
  const realMotionBlockers = asArray(realMotionJob?.blockers).map(cleanText).filter(Boolean);
  const validated = Number(validation?.validated_segments || 0);
  const rejected = Number(validation?.rejected_segments || 0);
  const segmentCount = Number(validation?.segment_count || 0);
  const validatedSourceFamilyCount = validation?.source_families?.size || 0;
  const directVideoMotionClipFloor =
    Number(motionReadiness.direct_video_motion_clip_floor) ||
    Number(motionReadiness.real_visual_motion_clip_floor) ||
    5;
  const directVideoEvidence = directVideoMotionCountEvidence({
    motionReadiness,
    renderEvidence,
    realMotionJob,
  });
  const directVideoMotionAssetCount = directVideoEvidence.direct_video_motion_asset_count;
  const directVideoMotionFamilyCount = directVideoEvidence.direct_video_motion_family_count;
  const cutoverBlockers = asArray(renderEvidence.cutover_blockers).map(cleanText).filter(Boolean);
  const ownedExplainerDeckAlreadyTried =
    renderEvidence.owned_explainer_motion_ready === true &&
    (
      cutoverBlockers.some((blocker) => /benchmark_not_pass|benchmark_below_production_threshold/i.test(blocker)) ||
      cutoverBlockers.some((blocker) => /gold_standard:/i.test(blocker))
    ) &&
    (
      renderInputBlockers.includes("visual_evidence:generated_only_motion_deck") ||
      renderInputBlockers.includes("visual_evidence:no_real_visual_media_asset")
    );

  if (
    realMotionJob &&
    realMotionBlockers.length === 0 &&
    directVideoMotionAssetCount >= directVideoMotionClipFloor &&
    directVideoMotionFamilyCount >= 4 &&
    (
      renderInputBlockers.includes("visual_evidence:generated_only_motion_deck") ||
      renderInputBlockers.includes("visual_evidence:no_real_visual_media_asset") ||
      renderInputBlockers.includes("visual_evidence:direct_video_motion_missing")
    )
  ) {
    return {
      action_id: "refresh_stale_render_qa_state",
      status: "required",
      repair_lane: "stale_cutover_after_real_motion_repair",
      exact_missing_input: "fresh render-input QA state after direct-video motion repair replaced generated-only evidence",
      required_artefact_path: "output/goal-contract/production_render_cutover_plan.json",
      auto_repairable: true,
      operator_approval_required: false,
      dead_end_blocker: false,
      recommended_command:
        "npm run ops:goal-production-cutover -- --story-packages output/goal-contract/story-packages.json --out-dir output/goal-contract --json",
      post_repair_validation_command:
        "npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json",
      reason_codes: renderInputBlockers.filter((blocker) =>
        /^visual_evidence:(?:generated_only_motion_deck|no_real_visual_media_asset|direct_video_motion_missing)$/.test(blocker),
      ),
      evidence: {
        direct_video_motion_asset_count: directVideoMotionAssetCount,
        direct_video_motion_clip_floor: directVideoMotionClipFloor,
        direct_video_motion_family_count: directVideoMotionFamilyCount,
        stale_cutover_direct_video_motion_asset_count:
          directVideoEvidence.stale_cutover_direct_video_motion_asset_count,
        stale_cutover_direct_video_motion_family_count:
          directVideoEvidence.stale_cutover_direct_video_motion_family_count,
        fresh_materialised_direct_video_motion_asset_count:
          directVideoEvidence.fresh_materialised_direct_video_motion_asset_count,
        fresh_materialised_direct_video_motion_family_count:
          directVideoEvidence.fresh_materialised_direct_video_motion_family_count,
        ...realMotionAttemptEvidence(realMotionJob),
      },
      output_expectations: [
        "production_render_cutover_plan.json generated after latest real-motion repair",
        "render_input_work_order.json no longer reads stale generated-only visual evidence",
        "final production render is regenerated from the real-motion clip set before scheduler preflight",
      ],
      allowed_routes: ["rerun_cutover_plan", "run_visual_v4_production_render", "rerun_scheduler_preflight"],
      blocked_when: ["latest_materialised_motion_clips_missing", "rights_ledger_missing", "cutover_plan_still_reports_generated_only_visuals"],
    };
  }

  if (ownedExplainerDeckAlreadyTried) {
    if (searches.length > 0) {
      return {
        repair_lane: "official_source_search_after_generated_only_benchmark_failure",
        status: "operator_required",
        auto_repairable: false,
        operator_approval_required: true,
        dead_end_blocker: false,
        exact_missing_input:
          "operator-selected official source URL or direct-media URL with rights evidence",
        recommended_command:
          `Fill output/goal-contract/visual_v4_official_search_template_remaining.json for ${storyId}, then run media:intake-official-sources; do not rerun owned-motion materialisation for this blocker.`,
        post_repair_validation_command:
          `npm run media:intake-official-sources -- --input output/goal-contract/visual_v4_source_family_intake_template_remaining.json --story-id ${storyId}`,
        evidence: {
          owned_explainer_motion_ready: true,
          owned_explainer_exception_approved:
            renderEvidence.owned_explainer_exception_approved === true ||
            renderEvidence.owned_explainer_motion_exception_approved === true,
          official_search_action_count: searches.length,
          first_query: searches[0]?.query || searches[0]?.search_query || null,
          primary_story_entity: sourceRow.primary_story_entity || null,
          accepted_source_types: asArray(searches[0]?.accepted_source_types),
          cutover_blockers: cutoverBlockers,
          visual_evidence_profile: renderEvidence.visual_evidence_profile || {},
          ...realMotionAttemptEvidence(realMotionJob),
        },
        output_expectations: [
          "official publisher, developer, storefront or platform-holder source recorded in the intake template",
          "rights ledger evidence exists before media materialisation",
          "real visual motion replaces the generated-only selected deck",
          "human review may reject the story instead of forcing a weak generated explainer video",
        ],
      };
    }
    if (needsDirectMediaCandidates.length > 0) {
      return {
        repair_lane: "official_direct_media_search_after_generated_only_benchmark_failure",
        status: "operator_required",
        auto_repairable: false,
        operator_approval_required: true,
        dead_end_blocker: false,
        exact_missing_input:
          "official direct-media URLs or licensed motion files for the known source families",
        recommended_command:
          `Add rights-backed direct-media URLs for ${storyId}, then run media:intake-official-sources; do not rerun owned-motion materialisation for this blocker.`,
        post_repair_validation_command:
          `npm run media:intake-official-sources -- --input output/goal-contract/visual_v4_source_family_intake_template_remaining.json --story-id ${storyId}`,
        evidence: {
          owned_explainer_motion_ready: true,
          owned_explainer_exception_approved:
            renderEvidence.owned_explainer_exception_approved === true ||
            renderEvidence.owned_explainer_motion_exception_approved === true,
          source_family_candidate_count: needsDirectMediaCandidates.length,
          first_source_family: needsDirectMediaCandidates[0]?.source_family || null,
          first_source_url: needsDirectMediaCandidates[0]?.source_url || needsDirectMediaCandidates[0]?.reference_url || null,
          primary_story_entity: sourceRow.primary_story_entity || null,
          source_proof_covered_target_entities: asArray(sourceRow.source_proof_covered_target_entities),
          source_proof_missing_target_entities: asArray(sourceRow.source_proof_missing_target_entities),
          cutover_blockers: cutoverBlockers,
          visual_evidence_profile: renderEvidence.visual_evidence_profile || {},
          ...realMotionAttemptEvidence(realMotionJob),
        },
        output_expectations: [
          "direct media fields contain only official .mp4, .webm, .mov, .m3u8 or .mpd URLs",
          "rights ledger evidence exists before media materialisation",
          "real visual motion replaces the generated-only selected deck",
          "human review may reject the story if no source family can produce usable motion",
        ],
      };
    }
    return {
      repair_lane: "real_visual_media_required_after_owned_explainer_deck_failed_benchmark",
      status: "operator_required",
      auto_repairable: false,
      operator_approval_required: true,
      dead_end_blocker: false,
      exact_missing_input:
        "official or licensed real visual media, or human-review rejection for a generated-only explainer deck that failed benchmark",
      recommended_command:
        `Find rights-backed official visual media for ${storyId} or route it to human review; do not rerun owned-motion materialisation for this blocker.`,
      post_repair_validation_command:
        "npm run ops:v4-source-family-acquisition -- --story-packages output/goal-contract/production_cutover_story_packages.json --work-order output/goal-contract/render_input_work_order.json --output-json output/goal-contract/studio_v4_source_family_acquisition_remaining.json --output-md output/goal-contract/studio_v4_source_family_acquisition_remaining.md --json",
      evidence: {
        owned_explainer_motion_ready: true,
        owned_explainer_exception_approved:
          renderEvidence.owned_explainer_exception_approved === true ||
          renderEvidence.owned_explainer_motion_exception_approved === true,
        source_search_blockers: searchBlockers,
        primary_story_entity: sourceRow.primary_story_entity || null,
        official_search_action_count: searches.length,
        source_family_candidate_count: candidates.length,
        cutover_blockers: cutoverBlockers,
        visual_evidence_profile: renderEvidence.visual_evidence_profile || {},
        ...realMotionAttemptEvidence(realMotionJob),
      },
      output_expectations: [
        "official or licensed media with a rights ledger record",
        "real visual motion replaces the generated-only selected deck",
        "benchmark_report.json clears motion density and media-house polish thresholds",
        "human review may reject the story instead of forcing a weak generated explainer video",
      ],
    };
  }

  if (
    renderInputBlockers.includes("direct_video_motion_clip_floor_not_met") &&
    realMotionJob &&
    directVideoMotionAssetCount >= directVideoMotionClipFloor &&
    realMotionBlockers.length === 0
  ) {
    return {
      action_id: "refresh_stale_render_qa_state",
      status: "required",
      repair_lane: "stale_cutover_after_real_motion_repair",
      exact_missing_input: "fresh render-input QA state after direct-video motion repair cleared the floor",
      required_artefact_path: "output/goal-contract/production_render_cutover_plan.json",
      auto_repairable: true,
      operator_approval_required: false,
      dead_end_blocker: false,
      recommended_command:
        "npm run ops:goal-production-cutover -- --story-packages output/goal-contract/story-packages.json --out-dir output/goal-contract --json",
      post_repair_validation_command:
        "npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json",
      reason_codes: ["direct_video_motion_clip_floor_not_met"],
      evidence: {
        direct_video_motion_asset_count: directVideoMotionAssetCount,
        direct_video_motion_clip_floor: directVideoMotionClipFloor,
        direct_video_motion_family_count: directVideoMotionFamilyCount,
        stale_cutover_direct_video_motion_asset_count:
          directVideoEvidence.stale_cutover_direct_video_motion_asset_count,
        stale_cutover_direct_video_motion_family_count:
          directVideoEvidence.stale_cutover_direct_video_motion_family_count,
        fresh_materialised_direct_video_motion_asset_count:
          directVideoEvidence.fresh_materialised_direct_video_motion_asset_count,
        fresh_materialised_direct_video_motion_family_count:
          directVideoEvidence.fresh_materialised_direct_video_motion_family_count,
        ...realMotionAttemptEvidence(realMotionJob),
      },
      output_expectations: [
        "production_render_cutover_plan.json generated after latest real-motion repair",
        "render_input_work_order.json no longer reads stale direct-video blocker evidence",
        "scheduler preflight confirms whether the repaired story is now render-ready",
      ],
      allowed_routes: ["rerun_cutover_plan", "rerun_scheduler_preflight"],
      blocked_when: ["latest_materialised_motion_clips_missing", "rights_ledger_missing", "cutover_plan_still_reports_motion_gap"],
    };
  }

  if (
    (
      renderInputBlockers.includes("direct_video_motion_clip_floor_not_met") ||
      motionReadiness.direct_video_motion_clip_floor_met === false
    ) &&
    directVideoMotionAssetCount < directVideoMotionClipFloor
  ) {
    const missingDirectVideoClipCount = Math.max(
      1,
      directVideoMotionClipFloor - directVideoMotionAssetCount,
    );
    const missingDirectVideoSourcePhrase =
      missingDirectVideoClipCount === 1
        ? "one more rights-backed official direct-video source"
        : `${missingDirectVideoClipCount} more rights-backed official direct-video sources`;
    return {
      repair_lane: "additional_direct_video_motion_required",
      status: "operator_required",
      auto_repairable: false,
      operator_approval_required: true,
      dead_end_blocker: false,
      exact_missing_input:
        `at least ${directVideoMotionClipFloor} direct-video motion clips from official or licensed gameplay/trailer sources`,
      recommended_command:
        `Find ${missingDirectVideoSourcePhrase} for ${storyId}, then rerun source intake and real-motion materialisation.`,
      post_repair_validation_command:
        `npm run ops:goal-real-motion -- --story-id ${storyId} --work-order output/goal-contract/render_input_work_order.json --out-dir output/studio-v4/motion-packs --json`,
      evidence: {
        direct_video_motion_asset_count: directVideoMotionAssetCount,
        missing_direct_video_motion_clip_count: missingDirectVideoClipCount,
        direct_video_motion_clip_floor: directVideoMotionClipFloor,
        direct_video_motion_family_count: directVideoMotionFamilyCount,
        stale_cutover_direct_video_motion_asset_count:
          directVideoEvidence.stale_cutover_direct_video_motion_asset_count,
        stale_cutover_direct_video_motion_family_count:
          directVideoEvidence.stale_cutover_direct_video_motion_family_count,
        fresh_materialised_direct_video_motion_asset_count:
          directVideoEvidence.fresh_materialised_direct_video_motion_asset_count,
        fresh_materialised_direct_video_motion_family_count:
          directVideoEvidence.fresh_materialised_direct_video_motion_family_count,
        materialised_real_motion_clip_floor_met:
          motionReadiness.materialised_real_motion_clip_floor_met === true,
        real_visual_motion_clip_count: positiveMax(
          renderEvidence.real_visual_motion_clip_count,
          realMotionJob?.materialized_count,
          realMotionJob?.total_motion_clip_count,
        ),
        ...realMotionAttemptEvidence(realMotionJob),
      },
      output_expectations: [
        `at least ${directVideoMotionClipFloor} materialised direct-video motion clips`,
        "each direct-video clip has official or licensed source evidence",
        "screenshot-derived motion can support the edit but cannot satisfy the direct-video floor",
        "rerun scheduler preflight after real-motion materialisation",
      ],
    };
  }

  if (searchBlockers.length > 0) {
    if (requiresOwnedVisualPlan(searchBlockers)) {
      return {
        action_id: "materialise_owned_generated_motion_clips",
        repair_lane: "owned_generated_explainer_motion_materialisation",
        status: "auto_repairable",
        auto_repairable: true,
        operator_approval_required: false,
        dead_end_blocker: false,
        exact_missing_input: "owned source-card, explainer or product visual plan that matches a non-game story without fake gameplay",
        recommended_command:
          `npm run ops:goal-owned-motion -- --story-id ${storyId} --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --json`,
        post_repair_validation_command:
          `npm run ops:goal-production-cutover -- --story-packages output/goal-contract/story-packages.json --out-dir output/goal-contract --json`,
        evidence: {
          source_search_blockers: searchBlockers,
          primary_story_entity: sourceRow.primary_story_entity || null,
        },
      };
    }
    return {
      repair_lane: "canonical_subject_repair_required_before_motion_search",
      status: "operator_required",
      auto_repairable: false,
      operator_approval_required: true,
      dead_end_blocker: true,
      exact_missing_input: "specific canonical subject, game, company or platform before official motion sourcing",
      recommended_command:
        `Repair public copy and canonical story identity for ${storyId}; do not search official motion until the subject is specific and non-malformed.`,
      post_repair_validation_command:
        `npm run ops:v4-source-family-acquisition -- --story-packages output/goal-contract/production_cutover_story_packages.json --work-order output/goal-contract/render_input_work_order.json --output-json output/goal-contract/studio_v4_source_family_acquisition_remaining.json --output-md output/goal-contract/studio_v4_source_family_acquisition_remaining.md --json`,
      evidence: {
        source_search_blockers: searchBlockers,
        primary_story_entity: sourceRow.primary_story_entity || null,
      },
    };
  }

  if (validation && validated === 0 && rejected >= 5 && segmentCount >= 5) {
    return {
      repair_lane: "alternate_official_source_required_after_segment_validation_exhausted",
      status: "operator_required",
      auto_repairable: false,
      operator_approval_required: true,
      dead_end_blocker: true,
      exact_missing_input: "non-exhausted official direct-media source family",
      recommended_command:
        `Find a non-exhausted official source family for ${storyId}, then fill output/goal-contract/visual_v4_source_family_intake_template_remaining.json and rerun media:intake-official-sources.`,
      post_repair_validation_command:
        `npm run media:validate-trailer-segments -- --story-id ${storyId} --apply-local --deep-scan --reference-report ${referenceReportPathForStory(storyId)} --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --max-segments 90 --candidate-windows-per-source 6`,
      evidence: {
        segment_count: segmentCount,
        validated_segments: validated,
        rejected_segments: rejected,
        top_rejection_reason: topRejectionReason(validation),
        source_family_count: validation.source_families?.size || 0,
        real_motion_blockers: realMotionBlockers,
      },
    };
  }

  if (validation && validated > 0 && (validated < 5 || validatedSourceFamilyCount < 4)) {
    return {
      repair_lane: "additional_official_motion_family_required",
      status: "operator_required",
      auto_repairable: false,
      operator_approval_required: true,
      dead_end_blocker: false,
      exact_missing_input: "at least 5 validated real-motion clips across distinct source families",
      recommended_command:
        `Find additional official direct-media families for ${storyId}; the current segment pass is below the Visual V4 motion floor.`,
      post_repair_validation_command:
        `npm run media:validate-trailer-segments -- --story-id ${storyId} --apply-local --deep-scan --reference-report ${referenceReportPathForStory(storyId)} --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --max-segments 90 --candidate-windows-per-source 6`,
      evidence: {
        segment_count: segmentCount,
        validated_segments: validated,
        rejected_segments: rejected,
        source_family_count: validatedSourceFamilyCount,
        ...realMotionAttemptEvidence(realMotionJob),
      },
    };
  }

  if (
    realMotionBlockers.includes("real_motion_clip_minimum_not_met") ||
    realMotionBlockers.includes("real_motion_family_minimum_not_met")
  ) {
    return {
      repair_lane: "additional_official_motion_family_required",
      status: "operator_required",
      auto_repairable: false,
      operator_approval_required: true,
      dead_end_blocker: false,
      exact_missing_input: "at least 5 validated real-motion clips across distinct source families",
      recommended_command:
        `Find additional official direct-media families for ${storyId}; partial local clips exist but cannot satisfy Visual V4 motion readiness.`,
      post_repair_validation_command:
        `npm run ops:goal-real-motion -- --story-id ${storyId} --work-order output/goal-contract/render_input_work_order.json --out-dir output/studio-v4/motion-packs --json`,
      evidence: realMotionAttemptEvidence(realMotionJob),
    };
  }

  if (realMotionBlockers.includes("direct_video_motion_clip_missing")) {
    return {
      repair_lane: "official_direct_video_source_required_after_materialization_exhausted",
      status: "operator_required",
      auto_repairable: false,
      operator_approval_required: true,
      dead_end_blocker: false,
      exact_missing_input: "official direct-video source or licensed direct gameplay/trailer media with rights evidence",
      recommended_command:
        `Find an official direct-video source for ${storyId}; screenshot-derived motion already exists but cannot satisfy the direct-video gate.`,
      post_repair_validation_command:
        `npm run ops:goal-real-motion -- --story-id ${storyId} --work-order output/goal-contract/render_input_work_order.json --out-dir output/studio-v4/motion-packs --json`,
      evidence: {
        ...realMotionAttemptEvidence(realMotionJob),
      },
    };
  }

  if (realMotionBlockers.includes("validated_direct_media_candidates_missing")) {
    return {
      repair_lane: "official_direct_media_intake_required_after_materialization_exhausted",
      status: "operator_required",
      auto_repairable: false,
      operator_approval_required: true,
      dead_end_blocker: false,
      exact_missing_input: "validated official direct-media source or operator-supplied licensed motion asset",
      recommended_command:
        `Run official-source/direct-media intake for ${storyId}; the real-motion materialiser found no validated direct media candidates to materialise.`,
      post_repair_validation_command:
        `npm run media:intake-official-sources -- --input output/goal-contract/visual_v4_source_family_intake_template_remaining.json --story-id ${storyId}`,
      evidence: {
        ...realMotionAttemptEvidence(realMotionJob),
      },
    };
  }

  if (directMediaCandidates.length > 0) {
    const canonicalManifestPath = storyArtifactPath(item, "canonical_story_manifest.json");
    return {
      repair_lane: "validate_resolved_official_reference_segments",
      status: "auto_repairable",
      auto_repairable: true,
      operator_approval_required: false,
      dead_end_blocker: false,
      exact_missing_input: "locally validated real-motion clip windows from resolved official references",
      recommended_command:
        `npm run media:validate-trailer-segments -- --story-id ${storyId} --apply-local --deep-scan --reference-report ${referenceReportPathForStory(storyId)} --max-segments 90 --candidate-windows-per-source 6`,
      post_repair_validation_command:
        `npm run ops:v4-motion-pack -- --stories ${commandArg(canonicalManifestPath)} --story-id ${storyId} --segment-report test/output/official_trailer_segment_validation_story_${storyId}_apply_local.json --out-dir output/studio-v4/motion-packs --json`,
      evidence: {
        source_family_candidate_count: directMediaCandidates.length,
      },
    };
  }

  if (needsDirectMediaCandidates.length > 0) {
    return {
      repair_lane: "official_direct_media_search_required",
      status: "operator_required",
      auto_repairable: false,
      operator_approval_required: true,
      dead_end_blocker: false,
      exact_missing_input: "official direct-media URL with rights evidence",
      recommended_command:
        "Official source proof already exists; add a rights-backed direct-media URL or licensed motion source to the intake template before media validation.",
      post_repair_validation_command:
        `npm run media:intake-official-sources -- --input output/goal-contract/visual_v4_source_family_intake_template_remaining.json --story-id ${storyId}`,
      evidence: {
        source_family_candidate_count: needsDirectMediaCandidates.length,
        first_source_family: needsDirectMediaCandidates[0]?.source_family || null,
        source_proof_covered_target_entities: asArray(sourceRow.source_proof_covered_target_entities),
        source_proof_missing_target_entities: asArray(sourceRow.source_proof_missing_target_entities),
      },
    };
  }

  if (searches.length > 0) {
    if (sourceProofCoversAllTargets(sourceRow)) {
      return {
        repair_lane: "official_direct_media_search_required",
        status: "operator_required",
        auto_repairable: false,
        operator_approval_required: true,
        dead_end_blocker: false,
        exact_missing_input: "official direct-media URL with rights evidence",
        recommended_command:
          "Official source proof already exists; add a rights-backed direct-media URL or licensed motion source to the intake template before media validation.",
        post_repair_validation_command:
          `npm run media:intake-official-sources -- --input output/goal-contract/visual_v4_source_family_intake_template_remaining.json --story-id ${storyId}`,
        evidence: {
          official_search_action_count: searches.length,
          first_query: searches[0]?.query || searches[0]?.search_query || null,
          source_proof_covered_target_entities: asArray(sourceRow.source_proof_covered_target_entities),
          source_proof_missing_target_entities: asArray(sourceRow.source_proof_missing_target_entities),
        },
      };
    }
    return {
      repair_lane: "official_source_search_required",
      status: "operator_required",
      auto_repairable: false,
      operator_approval_required: true,
      dead_end_blocker: false,
      exact_missing_input: "official source URL or direct-media URL with rights evidence",
      recommended_command:
        "Fill output/goal-contract/visual_v4_official_search_template_remaining.json with an official publisher, developer, storefront or platform-holder source before media intake.",
      post_repair_validation_command:
        `npm run media:intake-official-sources -- --input output/goal-contract/visual_v4_source_family_intake_template_remaining.json --story-id ${storyId}`,
      evidence: {
        official_search_action_count: searches.length,
        first_query: searches[0]?.query || searches[0]?.search_query || null,
      },
    };
  }

  return {
    repair_lane: "validated_real_motion_materialisation",
    status: "auto_repairable",
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    exact_missing_input: "rights-backed materialised real-motion clips",
    recommended_command:
      `npm run ops:goal-real-motion -- --story-id ${storyId} --work-order output/goal-contract/render_input_work_order.json --out-dir output/studio-v4/motion-packs --json`,
    post_repair_validation_command:
      `npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json`,
    evidence: {},
  };
}

function actionForAudioAndTimestamps(item = {}) {
  const storyId = cleanText(item.story_id);
  return {
    action_id: "generate_final_narration_audio_and_word_timestamps",
    status: "required",
    repair_lane: "final_narration_and_word_timestamp_repair",
    exact_missing_input: "final narration audio and word-level timestamps",
    required_artefact_path: storyArtifactPath(item, "audio_manifest.json"),
    required_artefact_paths: [
      `output/audio/${storyId}.mp3`,
      `output/audio/${storyId}_timestamps.json`,
      storyArtifactPath(item, "audio_manifest.json"),
    ],
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command: `npm run ops:goal-audio-timestamps -- --story-id ${storyId} --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --json`,
    post_repair_validation_command: `npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json`,
    reason_codes: asArray(item.render_input_blockers).filter((blocker) =>
      [
        "final_narration_audio_missing",
        "word_timestamps_missing",
        "final_narration_audio_stale_after_public_copy_repair",
        "word_timestamps_stale_after_public_copy_repair",
        "final_narration_audio_stale_after_duration_variant_repair",
        "word_timestamps_stale_after_duration_variant_repair",
        "final_narration_audio_stale_after_pronunciation_repair",
        "word_timestamps_stale_after_pronunciation_repair",
        "word_timestamps_not_asr_aligned",
        "word_timestamps_asr_coverage_incomplete",
      ].includes(blocker),
    ),
    output_expectations: [
      `audio_manifest.json:narration_audio_path`,
      `audio_manifest.json:word_timestamps_path`,
      `output/audio/${cleanText(item.story_id)}.mp3`,
      `output/audio/${cleanText(item.story_id)}_timestamps.json`,
    ],
    allowed_routes: [
      "local_tts_when_health_check_is_green",
      "local_whisper_word_alignment_for_existing_local_voice",
      "operator_supplied_licensed_voice_file",
      "approved_paid_tts_provider_with_timestamps",
    ],
    blocked_when: [
      "local_tts_unreachable",
      "voice_rights_unclear",
      "timestamps_missing",
    ],
  };
}

function actionForValidatedRealMotionMaterialisation(item = {}, context = {}) {
  const lane = classifyMotionRepairLane(item, context);
  return {
    action_id: lane.action_id || "materialise_validated_real_motion_clips",
    status: lane.status || "required",
    required_artefact_path: storyArtifactPath(item, "materialised_motion_clips.json"),
    required_artefact_paths: [
      storyArtifactPath(item, "materialised_motion_clips.json"),
      storyArtifactPath(item, "distinct_motion_family_report.json"),
    ],
    ...lane,
    reason_codes: asArray(item.render_input_blockers).filter((blocker) =>
      [
        "materialised_motion_clips_missing",
        "materialised_motion_families_insufficient",
        "direct_video_motion_clip_floor_not_met",
        "real_visual_motion_clips_missing",
        "real_visual_motion_families_insufficient",
        "visual_evidence:generated_only_motion_deck",
        "visual_evidence:no_real_visual_media_asset",
        "visual_evidence:insufficient_real_visual_source_families",
        "visual_evidence:direct_video_motion_missing",
      ].includes(blocker),
    ),
    output_expectations: lane.output_expectations || [
      lane.action_id === "materialise_owned_generated_motion_clips"
        ? "footage_inventory.json:motion_inventory.accepted_local_clips[] contains owned source-card explainer motion"
        : "footage_inventory.json:motion_inventory.accepted_local_clips[].path points to real gameplay, trailer or screenshot-derived motion",
      lane.action_id === "materialise_owned_generated_motion_clips"
        ? "at least 5 materialised owned explainer motion clips"
        : "at least 5 materialised real-media motion clips",
      lane.action_id === "materialise_owned_generated_motion_clips"
        ? "at least 4 distinct owned explainer motion families"
        : "at least 4 distinct real visual source families",
      lane.action_id === "materialise_owned_generated_motion_clips"
        ? "owned generated cards are allowed only for explicit non-game source-card explainer plans"
        : "owned generated cards may support graphics but cannot satisfy normal production motion readiness",
    ],
    allowed_routes: [
      ...(lane.action_id === "materialise_owned_generated_motion_clips"
        ? ["materialise_owned_source_locked_explainer_motion"]
        : [
            "hydrate_existing_visual_v4_motion_pack_cache",
            "materialise_validated_direct_media_refs",
            "operator_supplied_licensed_motion_files",
          ]),
    ],
    blocked_when: [
      ...(lane.action_id === "materialise_owned_generated_motion_clips"
        ? ["primary_source_is_discovery_only", "source_claim_missing", "rights_ledger_missing", "clip_path_missing_on_disk"]
        : [
            "generated_or_card_only_motion",
            "source_family_duplicates_only",
            "rights_ledger_missing",
            "clip_path_missing_on_disk",
          ]),
    ],
  };
}

function actionForStaleOwnedMotionMaterialisation(item = {}) {
  const storyId = cleanText(item.story_id);
  const evidence = item.render_input_evidence || {};
  return {
    action_id: "materialise_owned_generated_motion_clips",
    status: "auto_repairable",
    repair_lane: "owned_generated_explainer_motion_materialisation",
    exact_missing_input: "fresh owned/generated motion clips matching the repaired public copy",
    required_artefact_path: storyArtifactPath(item, "materialised_motion_clips.json"),
    required_artefact_paths: [
      storyArtifactPath(item, "materialised_motion_clips.json"),
      storyArtifactPath(item, "distinct_motion_family_report.json"),
      storyArtifactPath(item, "owned_motion_manifest.json"),
    ],
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command:
      `npm run ops:goal-owned-motion -- --story-id ${storyId} --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --refresh-existing --json`,
    post_repair_validation_command:
      "npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json",
    reason_codes: asArray(item.render_input_blockers).filter((blocker) =>
      [
        "materialised_motion_stale_after_public_copy_repair",
        "materialised_motion_stale_after_duration_variant_repair",
      ].includes(blocker),
    ),
    output_expectations: [
      "materialised_motion_clips.json regenerated after latest public-copy or duration repair",
      "distinct_motion_family_report.json generated from fresh owned motion clips",
      "owned_motion_manifest.json records rights-backed owned/generated motion evidence",
      "stale_materialised_motion_clip_paths cleared on next render-input work order",
    ],
    allowed_routes: [
      "rematerialise_owned_source_locked_explainer_motion",
      "regenerate_story_specific_cards_after_public_copy_repair",
    ],
    blocked_when: [
      "primary_source_is_discovery_only",
      "source_claim_missing",
      "rights_ledger_missing",
      "clip_path_missing_on_disk",
    ],
    evidence: {
      owned_explainer_motion_ready: evidence.owned_explainer_motion_ready === true,
      stale_materialised_motion_clip_paths: asArray(evidence.stale_materialised_motion_clip_paths),
    },
  };
}

function actionForPublicOutputCoherence(item = {}) {
  const sourceIntakeFailure = publicCopySourceIntakeFailure(item);
  const sourceIntakeRequired = Boolean(sourceIntakeFailure);
  const unrecoverableImagePost = isUnrecoverableImagePostPublicCopy(item);
  const storyId = cleanText(item.story_id);
  const safeStoryId = safeFilePart(storyId);
  const artifactDir = storyArtifactPath(item);
  const sourceInputPath = `output/goal-contract/source-attribution-repair/${safeStoryId}_official_source_entries.json`;
  const sourceReportPath = `output/goal-contract/source-attribution-repair/${safeStoryId}_official_source_intake_report.json`;
  return {
    action_id: "repair_public_output_coherence",
    status: unrecoverableImagePost ? "reject_recommended" : "required",
    repair_lane: unrecoverableImagePost
      ? "reject_or_human_review_non_news_image_post"
      : sourceIntakeRequired ? "official_source_intake_required" : "public_output_coherence_repair",
    exact_missing_input: unrecoverableImagePost
      ? "Reject the story or supply a real primary source and a specific canonical subject before any render repair."
      : sourceIntakeRequired
      ? sourceIntakeFailure === "public_copy:non_news_image_post_source"
        ? "A non-image primary source, official source or reliable publication source that supports the public claim."
        : "A non-Reddit primary source, official source or reliable publication source that supports the public claim."
      : "canonical public copy with matching title, thumbnail, source labels, narration and captions",
    required_artefact_path: storyArtifactPath(item, "coherence_report.json"),
    auto_repairable: !sourceIntakeRequired && !unrecoverableImagePost,
    operator_approval_required: sourceIntakeRequired,
    dead_end_blocker: unrecoverableImagePost,
    recommended_command: unrecoverableImagePost
      ? `Reject ${storyId} from autonomous production, or provide a non-image source manifest and rerun public-copy repair.`
      : sourceIntakeRequired
      ? `node tools/official-source-intake.js --story-json "${path.join(artifactDir, "canonical_story_manifest.json")}" --input "${sourceInputPath}" --output-json "${sourceReportPath}" --json`
      : `npm run ops:goal-public-copy-repair -- --story-packages output/goal-contract/production_cutover_story_packages.json --story-id ${storyId} --out-dir output/goal-contract --json`,
    post_repair_validation_command: `npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json`,
    reason_codes: asArray(item.render_input_blockers).filter((blocker) =>
      ["public_output_coherence_mismatch", "public_copy_repair_required", "source_label_consistency_repair_required"].includes(blocker),
    ),
    output_expectations: [
      ...(sourceIntakeRequired
        ? [
            "official_source_intake_report.json accepts a non-discovery source for the public claim",
            "canonical_story_manifest.json no longer uses an image host or discovery thread as the primary source",
          ]
        : []),
      "canonical_story_manifest.json:title, thumbnail, first line and narration describe the same story",
      "coherence_report.json:verdict=pass",
      "repaired public copy must trigger fresh narration and final render",
    ],
    allowed_routes: [
      "deterministic_public_copy_repair",
      "source_label_repair_from_primary_source",
      "thumbnail_headline_regeneration",
    ],
    blocked_when: [
      "canonical_subject_unclear",
      "primary_source_unverified",
      "public_copy_repair_creates_new_claim",
    ],
  };
}

function actionForDuplicateTitleRepair(item = {}) {
  const storyId = cleanText(item.story_id);
  const duplicateBlocker = asArray(item.render_input_evidence?.scheduler_preflight_blockers)
    .map(cleanText)
    .find((blocker) => /^title_duplicate:/i.test(blocker));
  const duplicateTitle = cleanText(duplicateBlocker.replace(/^title_duplicate:/i, "")) ||
    cleanText(item.title);
  return {
    action_id: "resolve_duplicate_title_or_event",
    status: "human_review_required",
    repair_lane: "event_deduplication_or_angle_split",
    exact_missing_input:
      "a deduplication decision: merge/reject the duplicate story, or rewrite it into a genuinely distinct angle with a non-duplicate title",
    required_artefact_path: storyArtifactPath(item, "deduplication_report.json"),
    auto_repairable: false,
    operator_approval_required: true,
    dead_end_blocker: false,
    recommended_command:
      `npm run ops:goal-public-copy-repair -- --story-packages output/goal-contract/production_cutover_story_packages.json --story-id ${storyId}` +
      (duplicateTitle ? ` --reserved-title ${commandArg(duplicateTitle)}` : "") +
      " --out-dir output/goal-contract --json",
    post_repair_validation_command:
      "npm run ops:goal-dry-run-publish -- --out-dir output/goal-contract --candidate-report test/output/next_publish_candidates.json --json",
    reason_codes: asArray(item.render_input_blockers).filter((blocker) =>
      blocker === "duplicate_title_repair_required",
    ),
    evidence: {
      duplicate_title: duplicateTitle || null,
      scheduler_preflight_status:
        cleanText(item.render_input_evidence?.scheduler_preflight_status) || null,
      scheduler_preflight_blockers:
        asArray(item.render_input_evidence?.scheduler_preflight_blockers).map(cleanText),
      canonical_subject: cleanText(item.render_input_evidence?.canonical_subject) || null,
    },
    output_expectations: [
      "deduplication_report.json records merge, reject or approved angle split",
      "selected_title is unique if the story remains in production",
      "thumbnail, first line, narration and platform packs are regenerated after any title or angle change",
      "strict dry-run no longer reports title_duplicate for the story",
    ],
    allowed_routes: [
      "merge_duplicate_story",
      "reject_duplicate_candidate",
      "angle_split_with_unique_claim_scope",
    ],
    blocked_when: [
      "same_event_no_angle_difference",
      "new_title_changes_claim_scope_without source support",
      "youtube_duplicate_blocker_still_matches",
    ],
  };
}

function actionForScriptScorecardRepair(item = {}) {
  const storyId = cleanText(item.story_id);
  return {
    action_id: "repair_script_scorecard",
    status: "required",
    repair_lane: "script_rewrite_and_audio_rerender",
    exact_missing_input: "a stronger creator-native script scorecard followed by fresh narration, timestamps and final render",
    required_artefact_path: storyArtifactPath(item, "script_scorecard.json"),
    required_artefact_paths: [
      storyArtifactPath(item, "script_scorecard.json"),
      storyArtifactPath(item, "narration_manifest.json"),
      storyArtifactPath(item, "word_timestamps.json"),
      storyArtifactPath(item, "visual_v4_render.mp4"),
    ],
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command:
      `npm run ops:goal-public-copy-repair -- --story-packages output/goal-contract/production_cutover_story_packages.json --story-id ${storyId} --out-dir output/goal-contract --json`,
    post_repair_validation_command: `npm run ops:next-publish-candidates -- --story-id ${storyId} --json`,
    reason_codes: asArray(item.render_input_blockers).filter((blocker) =>
      blocker === "script_scorecard_repair_required",
    ),
    output_expectations: [
      "script_scorecard.json clears the production script threshold",
      "canonical_story_manifest.json has a sharper hook, clear subject and no repair-template narration",
      "final narration audio and word timestamps are regenerated after the script change",
      "visual_v4_render.mp4 is regenerated from the fresh script before scheduler preflight",
    ],
    allowed_routes: [
      "creator_native_script_rewrite",
      "local_voice_audio_regeneration",
      "visual_v4_rerender_after_script_repair",
    ],
    blocked_when: [
      "canonical_subject_unclear",
      "script_rewrite_introduces_unconfirmed_claims",
      "public_copy_qa_still_fails",
    ],
  };
}

function actionForSoundDesignBenchmarkRepair(item = {}) {
  const storyId = cleanText(item.story_id);
  return {
    action_id: "repair_sound_design_benchmark",
    status: "required",
    repair_lane: "sound_visual_benchmark_repair",
    exact_missing_input: "fresh licensed SFX evidence, updated mix policy evidence and a clean Goal 09/Goal 10 benchmark pass",
    required_artefact_path: storyArtifactPath(item, "sfx_manifest.json"),
    required_artefact_paths: [
      storyArtifactPath(item, "sfx_manifest.json"),
      storyArtifactPath(item, "audio_quality_scorecard.json"),
      "output/goal-09/goal09_readiness_report.json",
      "output/goal-10/goal10_readiness_report.json",
    ],
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command:
      "npm run ops:goal-sfx-evidence-repair -- --story-packages output/goal-contract/production_cutover_story_packages.json --out-dir output/goal-contract --json",
    post_repair_validation_command:
      "npm run ops:goal10-gold-standard-forensics -- --out-dir output/goal-10 --json",
    reason_codes: asArray(item.render_input_blockers).filter((blocker) =>
      blocker === "sound_design_benchmark_repair_required",
    ),
    output_expectations: [
      "SFX source evidence uses approved creator-studio assets with rights records",
      "Goal 09 sound design report no longer blocks the story",
      "Goal 10 aggregate benchmark report no longer blocks the story on sound-design upstream state",
      `scheduler preflight can recheck ${storyId} after benchmark evidence is refreshed`,
    ],
    allowed_routes: [
      "refresh_licensed_sfx_evidence",
      "rerun_sound_design_readiness",
      "rerun_gold_standard_aggregate_benchmark",
    ],
    blocked_when: [
      "selected_sfx_has_no_rights_record",
      "render_audio_manifest_is_stale",
      "mix_policy_or_visual_policy_still_stale",
    ],
  };
}

function actionForAggregateBenchmarkRepair(item = {}) {
  const storyId = cleanText(item.story_id);
  const artifactDir = storyArtifactPath(item);
  return {
    action_id: "repair_aggregate_benchmark",
    status: "required",
    repair_lane: "aggregate_visual_director_benchmark_refresh",
    exact_missing_input:
      "fresh render-quality evidence for the aggregate benchmark, including visual density, director duration, SFX mix policy and visual design policy checks",
    required_artefact_path: storyArtifactPath(item, "benchmark_report.json"),
    required_artefact_paths: [
      storyArtifactPath(item, "render_manifest.json"),
      storyArtifactPath(item, "visual_quality_report.json"),
      storyArtifactPath(item, "audio_quality_scorecard.json"),
      storyArtifactPath(item, "benchmark_report.json"),
      "output/goal-09/goal09_readiness_report.json",
      "output/goal-10/goal10_readiness_report.json",
    ],
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command:
      `npm run ops:goal-production-render -- --refresh-quality-only --story-id ${storyId} --artifact-dir ${commandArg(artifactDir)} --out-dir output/goal-contract --json`,
    post_repair_validation_command: `npm run ops:next-publish-candidates -- --story-id ${storyId} --json`,
    reason_codes: asArray(item.render_input_blockers).filter((blocker) =>
      blocker === "aggregate_benchmark_repair_required",
    ),
    output_expectations: [
      "render_manifest.json carries the current visual and audio policy versions",
      "visual_quality_report.json and benchmark_report.json reflect the current final MP4",
      "Goal 09 and Goal 10 no longer block on stale upstream renderer/director/sound state",
      "if motion density still fails after refresh, the story remains blocked for rerender or real-motion repair",
    ],
    allowed_routes: [
      "refresh_existing_final_render_quality_evidence",
      "rerun_visual_v4_final_render_if_density_still_fails",
      "rerun_goal09_goal10_benchmark_reports",
    ],
    blocked_when: [
      "final_mp4_missing",
      "current_render_still_below_gold_standard",
      "director_duration_still_unsuitable",
      "visual_or_audio_policy_still_stale",
    ],
  };
}

function safeFilePart(value = "") {
  return cleanText(value).replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "story";
}

function publicCopyQaFailures(item = {}) {
  return asArray(item.render_input_evidence?.public_copy_qa?.failures);
}

function isUnrecoverableImagePostPublicCopy(item = {}) {
  const publicCopyFailures = publicCopyQaFailures(item);
  return (
    publicCopyFailures.includes("public_copy:non_news_image_post_source") &&
    publicCopyFailures.includes("public_copy:malformed_primary_source_label") &&
    (
      publicCopyFailures.includes("public_copy:weak_title_pattern") ||
      publicCopyFailures.includes("public_copy:formulaic_public_narration") ||
      publicCopyFailures.includes("public_copy:instruction_like_buyer_advice_narration")
    )
  );
}

function publicCopySourceIntakeFailure(item = {}) {
  return publicCopyQaFailures(item).find((failure) =>
    [
      "public_copy:non_news_image_post_source",
      "public_copy:reddit_discovery_label_used_as_primary_source",
      "public_copy:platform_host_source_label",
    ].includes(failure),
  ) || "";
}

function actionForRightsLedgerRepair(item = {}) {
  return {
    action_id: "repair_rights_ledger_evidence",
    status: "required",
    repair_lane: "rights_ledger_repair",
    exact_missing_input: "rights record for every render, audio, source-card and motion asset",
    required_artefact_path: storyArtifactPath(item, "rights_ledger.json"),
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command: `npm run ops:bridge-live-rights-repair -- --story-id ${cleanText(item.story_id)} --out-dir output/goal-contract --json`,
    post_repair_validation_command: `npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json`,
    reason_codes: asArray(item.render_input_blockers).filter((blocker) => blocker === "rights_ledger_missing"),
    output_expectations: [
      "rights_ledger.json contains every render, audio, source-card and motion asset",
      "rights_risk_report.json has no high-risk asset",
      "asset rejection reasons are preserved where media is unsafe",
    ],
    allowed_routes: [
      "rebuild_rights_ledger_from_render_story",
      "attach_owned_generated_motion_records",
      "operator_supplied_rights_evidence",
    ],
    blocked_when: [
      "source_owner_unknown",
      "commercial_use_unclear",
      "asset_path_missing_on_disk",
    ],
  };
}

function actionForCommercialDisclosureRepair(item = {}) {
  return {
    action_id: "repair_commercial_disclosure_evidence",
    status: "required",
    repair_lane: "commercial_disclosure_repair",
    exact_missing_input: "story and platform disclosure evidence for deal, affiliate or paid context",
    required_artefact_path: storyArtifactPath(item, "disclosure_manifest.json"),
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command: `npm run ops:goal-commercial-disclosure-repair -- --story-id ${cleanText(item.story_id)} --out-dir output/goal-contract --json`,
    post_repair_validation_command: `npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json`,
    reason_codes: asArray(item.render_input_blockers).filter(
      (blocker) => blocker === "commercial_deal_disclosure_missing",
    ),
    output_expectations: [
      "affiliate_link_manifest.json records whether the story has affiliate or commercial context",
      "platform_policy_report.json includes the required commercial disclosure state",
      "landing_page_manifest.json carries matching disclosure copy when a deal or affiliate route is present",
    ],
    allowed_routes: [
      "attach_story_relevant_affiliate_disclosure",
      "mark_editorial_price_story_with_no_affiliate_link",
      "route_deal_story_to_human_review_until_disclosure_exists",
    ],
    blocked_when: [
      "offer_relevance_unclear",
      "affiliate_link_dead_or_unapproved",
      "commercial_disclosure_copy_missing",
    ],
  };
}

function actionForProductionRender(item = {}) {
  return {
    action_id: "run_visual_v4_production_render",
    status: "ready_after_inputs",
    repair_lane: "visual_v4_production_render",
    exact_missing_input: "final Visual V4 production render",
    required_artefact_path: storyArtifactPath(item, "visual_v4_render.mp4"),
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command: "npm run ops:goal-production-render -- --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --json",
    post_repair_validation_command: "npm run ops:goal-dry-run-publish -- --out-dir output/goal-contract --json",
    force: item.force_final_render === true,
    target_render_manifest: item.target_render_manifest || null,
    output_expectations: [
      "render_manifest.json:final_publish_render=true",
      "render_manifest.json:renderer=visual_v4_production",
      "render_manifest.json:visual_tier=production_v4_motion",
      "visual_v4_render.mp4 final render replaces the local proof render",
    ],
  };
}

function actionForNormalProductionDurationRepair(item = {}, blockers = []) {
  const storyId = cleanText(item.story_id);
  const reasonCodes = normalProductionDurationBlockers(blockers);
  const durationFromItem = Number(item.rendered_duration_s || item.render_input_evidence?.rendered_duration_s);
  const durationFromBlocker = durationFromNormalProductionBlocker(reasonCodes[0]);
  return {
    action_id: "repair_normal_production_duration",
    status: "required",
    repair_lane: "normal_production_duration_floor",
    exact_missing_input: "final render duration inside the normal 35-59 second production window",
    required_artefact_path: "output/goal-contract/normal_duration_repair_work_order.json",
    required_artefact_paths: [
      "output/goal-contract/normal_duration_repair_work_order.json",
      storyArtifactPath(item, "canonical_story_manifest.json"),
      storyArtifactPath(item, "visual_v4_render.mp4"),
    ],
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command:
      `npm run ops:goal-normal-duration-repair -- --work-order output/goal-contract/normal_duration_repair_work_order.json --story-id ${storyId} --provider local --json`,
    post_repair_validation_command:
      "npm run ops:goal-production-cutover -- --story-packages output/goal-contract/production_cutover_story_packages.json --out-dir output/goal-contract --json",
    reason_codes: reasonCodes,
    evidence: {
      current_duration_s: Number.isFinite(durationFromItem) ? durationFromItem : durationFromBlocker,
      target_duration_seconds: { min: 35, max: 59 },
      local_tts_required: true,
    },
    output_expectations: [
      "canonical_story_manifest.json has a source-safe normal-production script extension",
      "final narration audio and word timestamps are regenerated with the local voice provider",
      "visual_v4_render.mp4 is rerendered after the duration repair and clears the duration floor",
    ],
    allowed_routes: [
      "normal_production_safe_script_expansion",
      "local_tts_audio_regeneration",
      "visual_v4_rerender_after_duration_repair",
    ],
    blocked_when: [
      "canonical_subject_unclear",
      "source_scope_unclear",
      "duration_repair_introduces_generic_or_instruction_like_narration",
    ],
  };
}

function actionForFinalMp4Repair(item = {}) {
  return {
    action_id: "materialise_final_mp4",
    status: "required",
    repair_lane: "final_mp4_materialisation",
    exact_missing_input: "final Visual V4 MP4",
    required_artefact_path: storyArtifactPath(item, "visual_v4_render.mp4"),
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command: "npm run ops:goal-production-render -- --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --json",
    post_repair_validation_command: "npm run ops:goal-dry-run-publish -- --out-dir output/goal-contract --json",
    reason_codes: asArray(item.render_input_blockers).filter((blocker) => blocker === "final_mp4_missing"),
    output_expectations: [
      "visual_v4_render.mp4 exists on disk and is larger than the empty-file floor",
      "render_manifest.json references the final MP4 path",
      "forensic QA can open the MP4 after render materialisation",
    ],
    allowed_routes: ["visual_v4_production_render_materializer"],
    blocked_when: ["narration_missing", "timestamps_missing", "materialised_motion_missing", "rights_ledger_missing"],
  };
}

function actionForCaptionFileRepair(item = {}) {
  return {
    action_id: "generate_caption_file",
    status: "required",
    repair_lane: "caption_file_repair",
    exact_missing_input: "final SRT or platform caption file",
    required_artefact_path: storyArtifactPath(item, "captions.srt"),
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command: `npm run ops:goal-audio-timestamps -- --story-id ${cleanText(item.story_id)} --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --json`,
    post_repair_validation_command: `npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json`,
    reason_codes: asArray(item.render_input_blockers).filter((blocker) => blocker === "caption_file_missing"),
    output_expectations: [
      "captions.srt contains valid SRT timing",
      "caption_manifest.json records source transcript and word timestamp references",
      "captions match final narration transcript",
    ],
    allowed_routes: ["caption_chunker_from_word_timestamps", "operator_supplied_clean_caption_file"],
    blocked_when: ["word_timestamps_missing", "transcript_missing", "caption_text_mismatch"],
  };
}

function actionForRenderManifestRepair(item = {}) {
  return {
    action_id: "repair_render_manifest",
    status: "required",
    repair_lane: "render_manifest_repair",
    exact_missing_input: "final render manifest",
    required_artefact_path: storyArtifactPath(item, "render_manifest.json"),
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command: "npm run ops:goal-production-render -- --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --json",
    post_repair_validation_command: "npm run ops:goal-dry-run-publish -- --out-dir output/goal-contract --json",
    reason_codes: asArray(item.render_input_blockers).filter((blocker) => blocker === "render_manifest_missing"),
    output_expectations: [
      "render_manifest.json declares visual_v4_production",
      "render_manifest.json has final_publish_render=true",
      "render manifest input fingerprint matches final narration, timestamps and motion inputs",
    ],
    allowed_routes: ["rerun_visual_v4_production_render_materializer", "rebuild_manifest_from_verified_render_evidence"],
    blocked_when: ["final_mp4_missing", "input_fingerprint_unavailable"],
  };
}

function actionForAudioManifestRepair(item = {}) {
  return {
    action_id: "repair_audio_manifest",
    status: "required",
    repair_lane: "audio_manifest_repair",
    exact_missing_input: "audio manifest linking final narration, transcript and word timestamps",
    required_artefact_path: storyArtifactPath(item, "audio_manifest.json"),
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command: `npm run ops:goal-audio-timestamps -- --story-id ${cleanText(item.story_id)} --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --json`,
    post_repair_validation_command: `npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json`,
    reason_codes: asArray(item.render_input_blockers).filter((blocker) => blocker === "audio_manifest_missing"),
    output_expectations: [
      "audio_manifest.json records final narration audio",
      "audio_manifest.json records clean transcript",
      "audio_manifest.json records word_timestamps.json path",
    ],
    allowed_routes: ["rebuild_audio_manifest_from_final_audio_and_timestamps"],
    blocked_when: ["narration_audio_missing", "word_timestamps_missing", "transcript_missing"],
  };
}

function actionForStaleQaRefresh(item = {}) {
  return {
    action_id: "refresh_stale_render_qa_state",
    status: "required",
    repair_lane: "stale_qa_state_refresh",
    exact_missing_input: "fresh render-input QA state after the latest repair",
    required_artefact_path: "output/goal-contract/production_render_cutover_plan.json",
    auto_repairable: true,
    operator_approval_required: false,
    dead_end_blocker: false,
    recommended_command: "npm run ops:goal-production-cutover -- --story-packages output/goal-contract/story-packages.json --out-dir output/goal-contract --json",
    post_repair_validation_command: "npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json",
    reason_codes: asArray(item.render_input_blockers).filter((blocker) => blocker === "stale_qa_state"),
    output_expectations: [
      "production_render_cutover_plan.json generated after latest input repair",
      "render_input_work_order.json no longer reads stale QA evidence",
    ],
    allowed_routes: ["rerun_cutover_plan", "rerun_incident_guard_then_render_input_workorder"],
    blocked_when: ["source_story_manifest_missing", "latest_repair_outputs_missing"],
  };
}

function actionForSourceFamilyEvidenceRefresh(item = {}) {
  const storyId = cleanText(item.story_id);
  return {
    action_id: "refresh_source_family_governance_evidence",
    status: "operator_required",
    repair_lane: "refresh_bridge_source_family_evidence",
    exact_missing_input: "fresh source-family governance evidence accepted by scheduler preflight",
    required_artefact_path: "output/goal-contract/studio_v4_source_family_acquisition_remaining.json",
    required_artefact_paths: [
      "output/goal-contract/studio_v4_source_family_acquisition_remaining.json",
      "test/output/next_publish_candidates.json",
      "output/goal-contract/dry_run_publish_plan.json",
    ],
    auto_repairable: false,
    operator_approval_required: true,
    dead_end_blocker: false,
    recommended_command:
      "npm run ops:v4-source-family-acquisition -- --story-packages output/goal-contract/production_cutover_story_packages.json --work-order output/goal-contract/render_input_work_order.json --output-json output/goal-contract/studio_v4_source_family_acquisition_remaining.json --output-md output/goal-contract/studio_v4_source_family_acquisition_remaining.md --json",
    post_repair_validation_command:
      "npm run ops:next-publish-candidates && npm run ops:goal-dry-run-publish && npm run ops:goal-render-inputs -- --json",
    reason_codes: asArray(item.render_input_blockers).filter((blocker) => blocker === "source_family_evidence_stale"),
    evidence: {
      scheduler_preflight_blockers: asArray(item.render_input_evidence?.scheduler_preflight_blockers),
      dry_run_hold_reasons: asArray(item.render_input_evidence?.dry_run_hold_reasons),
      canonical_subject: item.render_input_evidence?.canonical_subject || null,
      story_id: storyId,
    },
    output_expectations: [
      "scheduler preflight no longer reports stale source-family evidence",
      "strict dry-run either returns the story to ready status or keeps it held with a concrete media repair lane",
      "no story is counted as publish-ready while source-family governance is stale",
    ],
    allowed_routes: [
      "rerun_source_family_acquisition",
      "rerun_scheduler_preflight",
      "operator_supplied_source_family_evidence",
    ],
    blocked_when: [
      "source_family_evidence_still_stale",
      "rights_ledger_missing",
      "scheduler_preflight_warning_persists",
    ],
  };
}

function actionForStaleTemporalStoryReview(item = {}) {
  const storyId = cleanText(item.story_id);
  return {
    action_id: "review_stale_temporal_story",
    status: "human_review_required",
    repair_lane: "stale_temporal_story_human_review",
    exact_missing_input:
      "a reject-or-reframe decision for stale current-news wording; any reframe must be source-backed and trigger fresh public copy, narration, timestamps and render",
    required_artefact_path: storyArtifactPath(item, "stale_temporal_review.json"),
    required_artefact_paths: [
      storyArtifactPath(item, "stale_temporal_review.json"),
      storyArtifactPath(item, "canonical_story_manifest.json"),
      storyArtifactPath(item, "visual_v4_render.mp4"),
    ],
    auto_repairable: false,
    operator_approval_required: true,
    dead_end_blocker: false,
    recommended_command:
      `npm run ops:goal-public-copy-repair -- --story-packages output/goal-contract/production_cutover_story_packages.json --story-id ${storyId} --out-dir output/goal-contract --json`,
    post_repair_validation_command:
      "npm run ops:goal-dry-run-publish -- --out-dir output/goal-contract --candidate-report test/output/next_publish_candidates.json --json",
    reason_codes: asArray(item.render_input_blockers).filter((blocker) =>
      blocker === "stale_temporal_story_review_required",
    ),
    evidence: {
      scheduler_preflight_blockers:
        asArray(item.render_input_evidence?.scheduler_preflight_blockers).map(cleanText),
      scheduler_preflight_failures:
        asArray(item.render_input_evidence?.scheduler_preflight_failures).map(cleanText),
      temporal_freshness: item.render_input_evidence?.temporal_freshness || null,
      canonical_subject: cleanText(item.render_input_evidence?.canonical_subject) || null,
    },
    output_expectations: [
      "stale_temporal_review.json records reject, defer or source-backed reframe",
      "current-news wording is removed unless the event is still fresh",
      "a reframed story keeps the same source-backed claim scope",
      "fresh narration, timestamps and final render are regenerated after any public-copy change",
      "strict dry-run no longer reports stale temporal incident blockers for the story",
    ],
    allowed_routes: [
      "reject_stale_current_news_candidate",
      "defer_until_new_source_updates_story",
      "source_backed_evergreen_reframe",
    ],
    blocked_when: [
      "reframe_changes_claim_scope_without_source_support",
      "old_event_is_packaged_as_breaking_or_current_news",
      "fresh_audio_or_render_not_regenerated_after_reframe",
    ],
  };
}

function mergeUniqueStrings(left = [], right = []) {
  const values = [];
  const seen = new Set();
  for (const value of [...asArray(left), ...asArray(right)].map(cleanText).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function pushUniqueAction(actions = [], action = {}) {
  const actionId = cleanText(action.action_id);
  if (!actionId) return;
  const existing = actions.find((candidate) => candidate.action_id === actionId);
  if (!existing) {
    actions.push(action);
    return;
  }
  existing.reason_codes = mergeUniqueStrings(existing.reason_codes, action.reason_codes);
  existing.required_artefact_paths = mergeUniqueStrings(existing.required_artefact_paths, action.required_artefact_paths);
  existing.output_expectations = mergeUniqueStrings(existing.output_expectations, action.output_expectations);
  existing.allowed_routes = mergeUniqueStrings(existing.allowed_routes, action.allowed_routes);
  existing.blocked_when = mergeUniqueStrings(existing.blocked_when, action.blocked_when);
}

function jobForQueueItem(item = {}, context = {}) {
  const blockers = [
    ...asArray(item.render_input_blockers),
    ...normalProductionDurationBlockers(item.blockers),
  ];
  const actions = [];
  const hasMotionMaterialisationAction = () => actions.some((action) =>
    action.action_id === "materialise_validated_real_motion_clips" ||
    action.action_id === "materialise_owned_generated_motion_clips",
  );
  const hasNormalProductionDurationBlocker = normalProductionDurationBlockers(blockers).length > 0;
  const hasTerminalPublicCopyBlocker = isUnrecoverableImagePostPublicCopy(item);
  if (hasNormalProductionDurationBlocker) {
    pushUniqueAction(actions, actionForNormalProductionDurationRepair(item, blockers));
  }
  if (hasAny(blockers, ["final_narration_audio_missing", "word_timestamps_missing"])) {
    pushUniqueAction(actions, actionForAudioAndTimestamps(item));
  }
  if (hasAny(blockers, [
    "final_narration_audio_stale_after_public_copy_repair",
    "word_timestamps_stale_after_public_copy_repair",
    "final_narration_audio_stale_after_duration_variant_repair",
    "word_timestamps_stale_after_duration_variant_repair",
    "final_narration_audio_stale_after_pronunciation_repair",
    "word_timestamps_stale_after_pronunciation_repair",
    "word_timestamps_not_asr_aligned",
    "word_timestamps_asr_coverage_incomplete",
  ])) {
    pushUniqueAction(actions, actionForAudioAndTimestamps(item));
  }
  if (!hasTerminalPublicCopyBlocker && hasAny(blockers, ["materialised_motion_clips_missing", "materialised_motion_families_insufficient"])) {
    pushUniqueAction(actions, actionForValidatedRealMotionMaterialisation(item, context));
  }
  if (hasAny(blockers, [
    "direct_video_motion_clip_floor_not_met",
    "real_visual_motion_clips_missing",
    "real_visual_motion_families_insufficient",
    "visual_evidence:generated_only_motion_deck",
    "visual_evidence:no_real_visual_media_asset",
    "visual_evidence:insufficient_real_visual_source_families",
    "visual_evidence:direct_video_motion_missing",
  ]) && !hasTerminalPublicCopyBlocker && !hasMotionMaterialisationAction()) {
    pushUniqueAction(actions, actionForValidatedRealMotionMaterialisation(item, context));
  }
  if (hasAny(blockers, [
    "materialised_motion_stale_after_public_copy_repair",
    "materialised_motion_stale_after_duration_variant_repair",
  ]) && !hasTerminalPublicCopyBlocker && !hasMotionMaterialisationAction()) {
    pushUniqueAction(actions, actionForStaleOwnedMotionMaterialisation(item));
  }
  if (hasAny(blockers, [
    "public_output_coherence_mismatch",
    "public_copy_repair_required",
    "source_label_consistency_repair_required",
  ])) {
    pushUniqueAction(actions, actionForPublicOutputCoherence(item));
  }
  if (hasAny(blockers, ["duplicate_title_repair_required"])) {
    pushUniqueAction(actions, actionForDuplicateTitleRepair(item));
  }
  if (hasAny(blockers, ["script_scorecard_repair_required"])) {
    pushUniqueAction(actions, actionForScriptScorecardRepair(item));
  }
  if (hasAny(blockers, ["aggregate_benchmark_repair_required"])) {
    pushUniqueAction(actions, actionForAggregateBenchmarkRepair(item));
  }
  if (hasAny(blockers, ["sound_design_benchmark_repair_required"])) {
    pushUniqueAction(actions, actionForSoundDesignBenchmarkRepair(item));
  }
  if (hasAny(blockers, ["rights_ledger_missing"])) {
    pushUniqueAction(actions, actionForRightsLedgerRepair(item));
  }
  if (hasAny(blockers, ["commercial_deal_disclosure_missing"])) {
    pushUniqueAction(actions, actionForCommercialDisclosureRepair(item));
  }
  if (hasAny(blockers, ["final_mp4_missing"])) {
    pushUniqueAction(actions, actionForFinalMp4Repair(item));
  }
  if (hasAny(blockers, ["caption_file_missing"])) {
    pushUniqueAction(actions, actionForCaptionFileRepair(item));
  }
  if (hasAny(blockers, ["render_manifest_missing"])) {
    pushUniqueAction(actions, actionForRenderManifestRepair(item));
  }
  if (hasAny(blockers, ["audio_manifest_missing"])) {
    pushUniqueAction(actions, actionForAudioManifestRepair(item));
  }
  if (hasAny(blockers, ["stale_qa_state"])) {
    pushUniqueAction(actions, actionForStaleQaRefresh(item));
  }
  if (hasAny(blockers, ["source_family_evidence_stale"])) {
    pushUniqueAction(actions, actionForSourceFamilyEvidenceRefresh(item));
  }
  if (hasAny(blockers, ["stale_temporal_story_review_required"])) {
    pushUniqueAction(actions, actionForStaleTemporalStoryReview(item));
  }
  if (cleanText(item.render_input_status) === "ready_for_final_render_job" && !hasNormalProductionDurationBlocker) {
    pushUniqueAction(actions, actionForProductionRender(item));
  }
  return {
    story_id: cleanText(item.story_id),
    title: cleanText(item.title),
    artifact_dir: item.artifact_dir || null,
    force_final_render: item.force_final_render === true,
    status:
      cleanText(item.render_input_status) === "ready_for_final_render_job" && !hasNormalProductionDurationBlocker
        ? "ready_for_final_render_job"
        : "blocked_on_render_inputs",
    blockers,
    evidence: item.render_input_evidence || {},
    actions,
  };
}

function mapIncidentBlocker(blocker = "") {
  const code = cleanText(blocker);
  const directRenderInputBlockers = new Set([
    "final_narration_audio_missing",
    "word_timestamps_missing",
    "final_narration_audio_stale_after_public_copy_repair",
    "word_timestamps_stale_after_public_copy_repair",
    "final_narration_audio_stale_after_duration_variant_repair",
    "word_timestamps_stale_after_duration_variant_repair",
    "final_narration_audio_stale_after_pronunciation_repair",
    "word_timestamps_stale_after_pronunciation_repair",
    "word_timestamps_not_asr_aligned",
    "word_timestamps_asr_coverage_incomplete",
    "materialised_motion_clips_missing",
    "materialised_motion_families_insufficient",
    "direct_video_motion_clip_floor_not_met",
    "real_visual_motion_clips_missing",
    "real_visual_motion_families_insufficient",
    "visual_evidence:direct_video_motion_missing",
    "public_output_coherence_mismatch",
    "public_copy_repair_required",
    "source_label_consistency_repair_required",
    "rights_ledger_missing",
    "commercial_deal_disclosure_missing",
  ]);
  if (directRenderInputBlockers.has(code)) return code;
  const mappings = {
    "incident:narration_missing": "final_narration_audio_missing",
    "incident:word_timestamps_missing": "word_timestamps_missing",
    "incident:narration_audio_stale_after_pronunciation_repair": "final_narration_audio_stale_after_pronunciation_repair",
    "incident:word_timestamps_stale_after_pronunciation_repair": "word_timestamps_stale_after_pronunciation_repair",
    "incident:materialised_motion_missing": "materialised_motion_clips_missing",
    "incident:distinct_motion_families_missing": "materialised_motion_families_insufficient",
    "incident:mp4_missing": "final_mp4_missing",
    "incident:captions_missing_or_dirty": "caption_file_missing",
    "incident:thumbnail_title_script_mismatch": "public_output_coherence_mismatch",
    "incident:source_label_mismatch": "source_label_consistency_repair_required",
    "incident:discovery_source_used_as_primary": "source_label_consistency_repair_required",
    "incident:title_placeholder": "public_copy_repair_required",
    "incident:title_generic": "public_copy_repair_required",
    "incident:title_missing_canonical_subject": "public_copy_repair_required",
    "incident:internal_qa_language": "public_copy_repair_required",
    "incident:stale_temporal_claim": "stale_temporal_story_review_required",
    "incident:current_wording_on_old_event": "stale_temporal_story_review_required",
    "incident:rights_ledger_missing": "rights_ledger_missing",
    "incident:commercial_deal_disclosure_missing": "commercial_deal_disclosure_missing",
    "incident:render_manifest_missing": "render_manifest_missing",
    "incident:audio_manifest_missing": "audio_manifest_missing",
    "incident:stale_qa_state": "stale_qa_state",
  };
  return mappings[code] || null;
}

function blockersFromFileEvidence(fileEvidence = {}) {
  const blockers = [];
  if (fileEvidence.narration_ready === false || fileEvidence.narration_audio_ready === false) {
    blockers.push("final_narration_audio_missing");
  }
  if (fileEvidence.word_timestamps_ready === false || fileEvidence.timestamps_ready === false) {
    blockers.push("word_timestamps_missing");
  }
  if (fileEvidence.materialised_motion_ready === false || fileEvidence.materialised_motion_clips_ready === false) {
    blockers.push("materialised_motion_clips_missing");
  }
  if (fileEvidence.distinct_motion_families_ready === false || fileEvidence.motion_families_ready === false) {
    blockers.push("materialised_motion_families_insufficient");
  }
  if (fileEvidence.rights_ledger_ready === false || fileEvidence.rights_record_ready === false) {
    blockers.push("rights_ledger_missing");
  }
  if (fileEvidence.mp4_ready === false || fileEvidence.final_mp4_ready === false) {
    blockers.push("final_mp4_missing");
  }
  if (fileEvidence.captions_ready === false || fileEvidence.caption_file_ready === false) {
    blockers.push("caption_file_missing");
  }
  if (fileEvidence.render_manifest_ready === false) {
    blockers.push("render_manifest_missing");
  }
  if (fileEvidence.audio_manifest_ready === false) {
    blockers.push("audio_manifest_missing");
  }
  return blockers;
}

function queueItemFromIncidentReport(report = {}) {
  const blockers = [
    ...asArray(report.disaster_upload_blockers).map(mapIncidentBlocker).filter(Boolean),
    ...blockersFromFileEvidence(report.file_evidence || {}),
  ];
  return {
    story_id: cleanText(report.story_id),
    title: cleanText(report.title || report.public_title || report.selected_title),
    artifact_dir: report.artifact_dir || null,
    render_input_status: "blocked",
    render_input_blockers: [...new Set(blockers)],
    render_input_evidence: report.file_evidence || {},
  };
}

const SOURCE_LABEL_PUBLIC_COPY_FAILURES = new Set([
  "public_copy:malformed_primary_source_label",
  "public_copy:reddit_discovery_label_used_as_primary_source",
  "public_copy:non_news_image_post_source",
  "public_copy:platform_host_source_label",
  "public_copy:official_source_reporting_language",
  "public_copy:platform_host_reporting_language",
]);

function queueItemFromCutoverBlockedItem(item = {}) {
  const rawBlockers = asArray(item.blockers || item.render_input_blockers).map(cleanText).filter(Boolean);
  const publicCopyFailures = [
    ...asArray(item.public_copy_qa?.failures),
    ...rawBlockers.filter((blocker) => blocker.startsWith("public_copy:")),
  ].map(cleanText).filter(Boolean);
  const blockers = new Set(asArray(item.render_input_blockers).map(cleanText).filter(Boolean));
  for (const blocker of rawBlockers) {
    const mapped = mapIncidentBlocker(blocker);
    if (mapped) blockers.add(mapped);
    const visualEvidenceMatch = blocker.match(/(?:^|:)visual_evidence:(generated_only_motion_deck|no_real_visual_media_asset|insufficient_real_visual_source_families|direct_video_motion_missing)$/);
    if (visualEvidenceMatch) blockers.add(`visual_evidence:${visualEvidenceMatch[1]}`);
    if (blocker.startsWith("public_copy:")) blockers.add("public_copy_repair_required");
  }
  const visualProfile = item.visual_evidence_profile || item.render_input_evidence?.visual_evidence_profile || {};
  const benchmarkBlocked = rawBlockers.some((blocker) =>
    /benchmark_not_pass|benchmark_below_production_threshold|motion_density|media_house_polish/i.test(blocker),
  );
  if (benchmarkBlocked || visualProfile.generated_only_motion_deck === true) {
    for (const blocker of asArray(visualProfile.blockers).map(cleanText).filter(Boolean)) {
      const visualEvidenceMatch = blocker.match(/(?:^|:)visual_evidence:(generated_only_motion_deck|no_real_visual_media_asset|insufficient_real_visual_source_families|direct_video_motion_missing)$/);
      if (visualEvidenceMatch) blockers.add(`visual_evidence:${visualEvidenceMatch[1]}`);
    }
    if (visualProfile.generated_only_motion_deck === true) {
      blockers.add("visual_evidence:generated_only_motion_deck");
    }
    if (
      Number(visualProfile.motion_asset_count || 0) >= 3 &&
      Number(visualProfile.real_media_asset_count || 0) === 0
    ) {
      blockers.add("visual_evidence:no_real_visual_media_asset");
    }
  }
  if (publicCopyFailures.some((failure) => SOURCE_LABEL_PUBLIC_COPY_FAILURES.has(failure))) {
    blockers.add("source_label_consistency_repair_required");
  }
  if (!blockers.size) return null;
  return {
    story_id: cleanText(item.story_id || item.id),
    title: cleanText(item.title || item.public_title || item.selected_title),
    artifact_dir: item.artifact_dir || null,
    force_final_render: item.force_final_render === true,
    render_input_status: "blocked",
    render_input_blockers: Array.from(blockers),
    render_input_evidence: {
      ...(item.render_input_evidence || {}),
      cutover_blockers: rawBlockers,
      owned_explainer_motion_ready:
        item.owned_explainer_motion_ready === true ||
        item.render_input_evidence?.owned_explainer_motion_ready === true,
      owned_explainer_exception_approved:
        item.owned_explainer_exception_approved === true ||
        item.owned_explainer_motion_exception_approved === true ||
        item.render_input_evidence?.owned_explainer_exception_approved === true ||
        item.render_input_evidence?.owned_explainer_motion_exception_approved === true,
      visual_evidence_profile:
        item.visual_evidence_profile ||
        item.render_input_evidence?.visual_evidence_profile ||
        null,
      selected_render_evidence:
        item.selected_render_evidence ||
        item.render_input_evidence?.selected_render_evidence ||
        null,
      ...(publicCopyFailures.length
        ? {
            public_copy_qa: {
              ...(item.public_copy_qa || {}),
              verdict: item.public_copy_qa?.verdict || "fail",
              failures: [...new Set(publicCopyFailures)],
            },
          }
        : {}),
    },
  };
}

function mapDryRunPreflightBlocker(blocker = "") {
  const code = cleanText(blocker);
  if (/stale_source_family_evidence|source_family_evidence_ignored/i.test(code)) {
    return "source_family_evidence_stale";
  }
  if (/bridge_motion_governance:direct_video_enrichment_required/i.test(code)) {
    return "visual_evidence:direct_video_motion_missing";
  }
  if (/script_scorecard|script_score_below_threshold|viral_script/i.test(code)) {
    return "script_scorecard_repair_required";
  }
  if (/^title_duplicate:/i.test(code) || /duplicate_title|duplicate_event|youtube_duplicate/i.test(code)) {
    return "duplicate_title_repair_required";
  }
  if (/goal09_sound_design_engine|sound_design|sfx_mix_policy|audio_quality/i.test(code)) {
    return "sound_design_benchmark_repair_required";
  }
  if (/public_output|public_copy|placeholder_title|internal_qa_language/i.test(code)) {
    return "public_copy_repair_required";
  }
  if (/source_label|discovery_source/i.test(code)) {
    return "source_label_consistency_repair_required";
  }
  if (/incident:stale_temporal_claim|incident:current_wording_on_old_event|stale_temporal|current_wording_on_old_event/i.test(code)) {
    return "stale_temporal_story_review_required";
  }
  if (/rights/i.test(code)) return "rights_ledger_missing";
  if (/final_mp4|mp4_missing/i.test(code)) return "final_mp4_missing";
  if (/caption/i.test(code)) return "caption_file_missing";
  if (/narration|audio/i.test(code)) return "final_narration_audio_missing";
  if (/timestamp/i.test(code)) return "word_timestamps_missing";
  return null;
}

function schedulerPreflightFailureCodes(item = {}) {
  const preflight = item.scheduler_preflight || item.preflight_qa || {};
  const checks = preflight.checks || {};
  const failures = [];
  for (const [checkName, check] of Object.entries(checks || {})) {
    for (const failure of asArray(check?.failures)) {
      const code = cleanText(failure);
      if (code) failures.push(code);
    }
    for (const blocker of asArray(check?.blockers)) {
      const code = cleanText(blocker);
      if (code) failures.push(code);
    }
  }
  return [...new Set(failures)];
}

function hasAggregateVisualDirectorFailure(codes = []) {
  return asArray(codes).some((code) =>
    /goal08_visual_v4_renderer|goal07_director_brain|director:|visual:|motion_density|weak_motion_density|visual_design_policy/i.test(cleanText(code)),
  );
}

function mapDryRunPreflightBlockers(rawBlockers = [], detailedFailures = []) {
  const codes = [...new Set([...asArray(rawBlockers), ...asArray(detailedFailures)].map(cleanText).filter(Boolean))];
  const aggregateVisualDirectorFailure = hasAggregateVisualDirectorFailure(codes);
  const mapped = [];
  if (aggregateVisualDirectorFailure) mapped.push("aggregate_benchmark_repair_required");
  for (const code of codes) {
    if (/^public_copy_newer_than_render$/i.test(code)) {
      mapped.push("final_narration_audio_stale_after_public_copy_repair");
      mapped.push("word_timestamps_stale_after_public_copy_repair");
      continue;
    }
    if (/^duration_variant_newer_than_render$/i.test(code)) {
      mapped.push("final_narration_audio_stale_after_duration_variant_repair");
      mapped.push("word_timestamps_stale_after_duration_variant_repair");
      continue;
    }
    if (
      aggregateVisualDirectorFailure &&
      /goal09_sound_design_engine|sound_design|sfx_mix_policy|audio_quality/i.test(code)
    ) {
      continue;
    }
    const blocker = mapDryRunPreflightBlocker(code);
    if (blocker) mapped.push(blocker);
  }
  return [...new Set(mapped)];
}

function queueItemFromDryRunBlockedStory(item = {}) {
  const rawBlockers = asArray(item.blockers).map(cleanText).filter(Boolean);
  const preflightFailures = schedulerPreflightFailureCodes(item);
  const blockers = mapDryRunPreflightBlockers(rawBlockers, preflightFailures);
  if (!blockers.length) return null;
  const evidence = item.incident_guard?.evidence || {};
  return {
    story_id: cleanText(item.story_id || item.id),
    title: cleanText(item.title || item.public_title || item.selected_title || evidence.title),
    artifact_dir: item.artifact_dir || null,
    preflight_only: true,
    render_input_status: "blocked",
    render_input_blockers: blockers,
    render_input_evidence: {
      file_evidence: evidence.file_evidence || {},
      scheduler_preflight_blockers: rawBlockers,
      scheduler_preflight_failures: preflightFailures,
      scheduler_preflight_checks: item.scheduler_preflight?.checks || null,
      scheduler_preflight_status: "blocked",
      dry_run_hold_reasons: asArray(item.hold_reasons),
      canonical_subject: evidence.canonical_subject || null,
    },
  };
}

function dryRunHeldStoryNeedsRenderInputWorkOrder(item = {}) {
  return asArray(item.blockers).some((blocker) => mapDryRunPreflightBlocker(blocker) === "source_family_evidence_stale");
}

function dedupeQueueItems(items = []) {
  const byId = new Map();
  const ordered = [];
  for (const item of asArray(items)) {
    const storyId = cleanText(item.story_id);
    if (!storyId) continue;
    const existing = byId.get(storyId);
    if (!existing) {
      byId.set(storyId, item);
      ordered.push(item);
      continue;
    }
    const existingReady = cleanText(existing.render_input_status) === "ready_for_final_render_job";
    const itemReady = cleanText(item.render_input_status) === "ready_for_final_render_job";
    const existingPreflightOnly = existing.preflight_only === true;
    const itemPreflightOnly = item.preflight_only === true;
    const blockers =
      (existingReady && itemPreflightOnly) || (itemReady && existingPreflightOnly)
        ? [...new Set(itemReady ? asArray(item.render_input_blockers) : asArray(existing.render_input_blockers))]
        : [...new Set([...asArray(existing.render_input_blockers), ...asArray(item.render_input_blockers)])];
    byId.set(storyId, {
      ...existing,
      ...item,
      title: cleanText(existing.title) || cleanText(item.title),
      artifact_dir: existing.artifact_dir || item.artifact_dir || null,
      force_final_render: existing.force_final_render === true || item.force_final_render === true,
      render_input_status:
        (existingReady || itemReady) && blockers.length === 0
          ? "ready_for_final_render_job"
          : cleanText(item.render_input_status) || cleanText(existing.render_input_status) || "blocked",
      render_input_blockers: blockers,
      render_input_evidence: {
        ...(existing.render_input_evidence || {}),
        ...(item.render_input_evidence || {}),
      },
    });
  }
  return ordered.map((item) => byId.get(cleanText(item.story_id)));
}

function mergeQueueItems(cutoverItems = [], incidentItems = []) {
  if (!incidentItems.length) return asArray(cutoverItems);
  if (!cutoverItems.length) return incidentItems;
  const incidentById = new Map(incidentItems.map((item) => [cleanText(item.story_id), item]));
  const merged = [];
  const seen = new Set();
  for (const cutoverItem of asArray(cutoverItems)) {
    const storyId = cleanText(cutoverItem.story_id);
    const incidentItem = incidentById.get(storyId);
    if (!incidentItem) {
      merged.push(cutoverItem);
      continue;
    }
    seen.add(storyId);
    const cutoverBlockers = asArray(cutoverItem.render_input_blockers);
    const incidentBlockers = asArray(incidentItem.render_input_blockers);
    const blockers = [...new Set([...cutoverBlockers, ...incidentBlockers])];
    const cutoverStatus = cleanText(cutoverItem.render_input_status);
    const incidentStatus = cleanText(incidentItem.render_input_status);
    merged.push({
      ...cutoverItem,
      ...incidentItem,
      title: cleanText(cutoverItem.title) || cleanText(incidentItem.title),
      artifact_dir: cutoverItem.artifact_dir || incidentItem.artifact_dir || null,
      force_final_render: cutoverItem.force_final_render === true || incidentItem.force_final_render === true,
      render_input_status:
        cutoverStatus === "ready_for_final_render_job" && incidentBlockers.length === 0
          ? "ready_for_final_render_job"
          : incidentStatus || cutoverStatus || "blocked",
      render_input_blockers: blockers,
      render_input_evidence: {
        ...(incidentItem.render_input_evidence || {}),
        ...(cutoverItem.render_input_evidence || {}),
      },
    });
  }
  for (const incidentItem of incidentItems) {
    const storyId = cleanText(incidentItem.story_id);
    if (!seen.has(storyId)) merged.push(incidentItem);
  }
  return merged;
}

function readCanonicalManifestForQueueItem(item = {}) {
  const manifestPath = storyArtifactPath(item, "canonical_story_manifest.json");
  try {
    if (!fs.existsSync(manifestPath)) return null;
    return fs.readJsonSync(manifestPath);
  } catch {
    return null;
  }
}

function queueItemWithPublicCopyQa(item = {}) {
  const manifest = readCanonicalManifestForQueueItem(item);
  if (!manifest) return item;
  const publicCopyQa = evaluateGoalPublicCopy(manifest);
  const title = cleanText(item.title) || cleanText(
    manifest.selected_title || manifest.short_title || manifest.canonical_title || manifest.title,
  );
  if (publicCopyQa.verdict !== "fail") {
    return {
      ...item,
      title,
      render_input_evidence: {
        ...(item.render_input_evidence || {}),
        public_copy_qa: publicCopyQa,
      },
    };
  }
  const blockers = new Set(asArray(item.render_input_blockers));
  blockers.add("public_copy_repair_required");
  if (asArray(publicCopyQa.failures).some((failure) =>
    [
      "public_copy:reddit_discovery_label_used_as_primary_source",
      "public_copy:non_news_image_post_source",
      "public_copy:platform_host_source_label",
      "public_copy:official_source_reporting_language",
      "public_copy:platform_host_reporting_language",
    ].includes(failure),
  )) {
    blockers.add("source_label_consistency_repair_required");
  }
  return {
    ...item,
    title,
    render_input_status: "blocked",
    render_input_blockers: Array.from(blockers),
    render_input_evidence: {
      ...(item.render_input_evidence || {}),
      public_copy_qa: publicCopyQa,
    },
  };
}

function buildGoalRenderInputWorkOrder({
  cutoverPlan = {},
  incidentGuardReport = null,
  dryRunPlan = null,
  publishBlockerResolutionPlan = null,
  sourceFamilyAcquisitionReport = null,
  segmentValidationReports = [],
  realMotionMaterializationReport = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const cutoverGeneratedMs = timeMs(cutoverPlan.generated_at);
  const incidentGeneratedMs = timeMs(incidentGuardReport?.generated_at);
  const dryRunGeneratedMs = timeMs(dryRunPlan?.generated_at);
  const publishBlockerGeneratedMs = timeMs(publishBlockerResolutionPlan?.generated_at);
  const incidentFreshEnough =
    incidentGuardReport &&
    (
      cutoverGeneratedMs == null ||
      incidentGeneratedMs == null ||
      incidentGeneratedMs >= cutoverGeneratedMs
    );
  const dryRunFreshEnough =
    dryRunPlan &&
    (
      cutoverGeneratedMs == null ||
      dryRunGeneratedMs == null ||
      dryRunGeneratedMs >= cutoverGeneratedMs
    );
  const publishBlockerFreshEnough =
    publishBlockerResolutionPlan &&
    (
      cutoverGeneratedMs == null ||
      publishBlockerGeneratedMs == null ||
      publishBlockerGeneratedMs >= cutoverGeneratedMs
    ) &&
    (
      dryRunGeneratedMs == null ||
      publishBlockerGeneratedMs == null ||
      publishBlockerGeneratedMs >= dryRunGeneratedMs
    );
  const dryRunSkippedStoryIds = dryRunFreshEnough
    ? new Set(asArray(dryRunPlan?.skipped_stories).map((story) => cleanText(story.story_id)).filter(Boolean))
    : new Set();
  const incidentQueue = incidentFreshEnough
    ? asArray(incidentGuardReport?.stories)
      .map(queueItemFromIncidentReport)
      .filter((item) => !dryRunSkippedStoryIds.has(cleanText(item.story_id)))
      .filter((item) => asArray(item.render_input_blockers).length > 0)
    : [];
  const cutoverBlockedQueue = asArray(cutoverPlan.blocked)
    .map(queueItemFromCutoverBlockedItem)
    .filter((item) => !dryRunSkippedStoryIds.has(cleanText(item?.story_id)))
    .filter(Boolean);
  const dryRunBlockedQueue = dryRunFreshEnough
    ? [
      ...asArray(dryRunPlan?.blocked_stories),
      ...asArray(dryRunPlan?.held_stories).filter(dryRunHeldStoryNeedsRenderInputWorkOrder),
    ]
      .map(queueItemFromDryRunBlockedStory)
      .filter(Boolean)
    : [];
  const cutoverQueue = dedupeQueueItems([
    ...asArray(cutoverPlan.queue),
    ...cutoverBlockedQueue,
    ...dryRunBlockedQueue,
  ].filter((item) => !dryRunSkippedStoryIds.has(cleanText(item?.story_id))));
  const queue = mergeQueueItems(cutoverQueue, incidentQueue)
    .map(queueItemWithPublicCopyQa);
  const context = {
    sourceFamilyRows: sourceFamilyRowsByStory(sourceFamilyAcquisitionReport || {}),
    segmentValidation: segmentValidationByStory(segmentValidationReports),
    realMotionJobs: realMotionJobsByStory(realMotionMaterializationReport || {}),
  };
  const jobs = queue.map((item) => jobForQueueItem(item, context));
  const audioTimestampJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "generate_final_narration_audio_and_word_timestamps"),
  );
  const realMotionJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "materialise_validated_real_motion_clips"),
  );
  const ownedMotionJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "materialise_owned_generated_motion_clips"),
  );
  const publicOutputRepairJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "repair_public_output_coherence"),
  );
  const duplicateTitleRepairJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "resolve_duplicate_title_or_event"),
  );
  const scriptScorecardRepairJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "repair_script_scorecard"),
  );
  const aggregateBenchmarkRepairJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "repair_aggregate_benchmark"),
  );
  const soundBenchmarkRepairJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "repair_sound_design_benchmark"),
  );
  const rightsLedgerRepairJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "repair_rights_ledger_evidence"),
  );
  const commercialDisclosureRepairJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "repair_commercial_disclosure_evidence"),
  );
  const finalMp4RepairJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "materialise_final_mp4"),
  );
  const captionRepairJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "generate_caption_file"),
  );
  const manifestRepairJobs = jobs.reduce(
    (count, job) =>
      count +
      job.actions.filter((action) => action.action_id === "repair_render_manifest" || action.action_id === "repair_audio_manifest").length,
    0,
  );
  const staleQaRefreshJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "refresh_stale_render_qa_state"),
  );
  const normalDurationRepairJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "repair_normal_production_duration"),
  );
  const staleTemporalReviewJobs = jobs.filter((job) =>
    job.actions.some((action) => action.action_id === "review_stale_temporal_story"),
  );
  const autoRepairableJobs = jobs.filter((job) =>
    job.actions.some((action) => action.auto_repairable === true),
  );
  const operatorRequiredJobs = jobs.filter((job) =>
    job.actions.some((action) => action.operator_approval_required === true),
  );
  const deadEndBlockerJobs = jobs.filter((job) =>
    job.actions.some((action) => action.dead_end_blocker === true),
  );
  const readyJobs = jobs.filter((job) => job.status === "ready_for_final_render_job");
  const blockedJobs = jobs.filter((job) => job.status === "blocked_on_render_inputs");
  const renderRepairBacklog = buildRepairBacklog(jobs, generatedAt);
  const publishBlockerResolutionItems = publishBlockerFreshEnough
    ? repairBacklogItemsFromPublishBlockerResolution(publishBlockerResolutionPlan)
    : [];
  const publishBlockerAutoRepairableItems = publishBlockerResolutionItems.filter((item) => item.auto_repairable);
  const publishBlockerOperatorRequiredItems = publishBlockerResolutionItems.filter((item) =>
    item.operator_approval_required,
  );
  const publishBlockerDeadEndItems = publishBlockerResolutionItems.filter((item) => item.dead_end_blocker);
  const repairBacklog = mergeRepairBacklogs(renderRepairBacklog, publishBlockerResolutionItems, generatedAt);
  const autoRepairPlan = buildAutoRepairPlan(repairBacklog, generatedAt);
  const postRepairValidationPlan = buildPostRepairValidationPlan(repairBacklog, generatedAt);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_RENDER_INPUT_WORK_ORDER",
    source_cutover_generated_at: cutoverPlan.generated_at || null,
    source_dry_run_generated_at: dryRunPlan?.generated_at || null,
    source_dry_run_loaded: dryRunFreshEnough === true,
    source_dry_run_ignored_as_stale: Boolean(dryRunPlan && !dryRunFreshEnough),
    source_incident_guard_generated_at: incidentGuardReport?.generated_at || null,
    source_publish_blocker_resolution_generated_at: publishBlockerResolutionPlan?.generated_at || null,
    source_publish_blocker_resolution_loaded: publishBlockerFreshEnough === true,
    source_publish_blocker_resolution_ignored_as_stale:
      Boolean(publishBlockerResolutionPlan && !publishBlockerFreshEnough),
    summary: {
      story_count: jobs.length,
      ready_for_final_render_job_count: readyJobs.length,
      blocked_on_render_inputs_count: blockedJobs.length,
      audio_timestamp_jobs: audioTimestampJobs.length,
      real_motion_materialisation_jobs: realMotionJobs.length,
      owned_motion_materialisation_jobs: ownedMotionJobs.length,
      public_output_repair_jobs: publicOutputRepairJobs.length,
      duplicate_title_repair_jobs: duplicateTitleRepairJobs.length,
      script_scorecard_repair_jobs: scriptScorecardRepairJobs.length,
      aggregate_benchmark_repair_jobs: aggregateBenchmarkRepairJobs.length,
      sound_benchmark_repair_jobs: soundBenchmarkRepairJobs.length,
      rights_ledger_repair_jobs: rightsLedgerRepairJobs.length,
      commercial_disclosure_repair_jobs: commercialDisclosureRepairJobs.length,
      final_mp4_repair_jobs: finalMp4RepairJobs.length,
      caption_repair_jobs: captionRepairJobs.length,
      manifest_repair_jobs: manifestRepairJobs,
      stale_qa_refresh_jobs: staleQaRefreshJobs.length,
      normal_duration_repair_jobs: normalDurationRepairJobs.length,
      stale_temporal_review_jobs: staleTemporalReviewJobs.length,
      publish_blocker_resolution_repair_items: publishBlockerResolutionItems.length,
      auto_repairable_jobs: autoRepairableJobs.length + publishBlockerAutoRepairableItems.length,
      operator_required_jobs: operatorRequiredJobs.length + publishBlockerOperatorRequiredItems.length,
      dead_end_blocker_jobs: deadEndBlockerJobs.length + publishBlockerDeadEndItems.length,
    },
    repair_backlog: repairBacklog,
    auto_repair_plan: autoRepairPlan,
    post_repair_validation_plan: postRepairValidationPlan,
    jobs,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

function buildRepairBacklog(jobs = [], generatedAt = new Date().toISOString()) {
  const items = [];
  for (const job of asArray(jobs)) {
    for (const action of asArray(job.actions)) {
      items.push({
        story_id: job.story_id,
        title: job.title,
        artifact_dir: job.artifact_dir || null,
        blocker_type: action.action_id,
        repair_lane: action.repair_lane || action.action_id,
        exact_missing_input: action.exact_missing_input || "",
        required_artefact_path: cleanText(action.required_artefact_path),
        required_artefact_paths: asArray(action.required_artefact_paths || [action.required_artefact_path]).map(cleanText).filter(Boolean),
        recommended_command: action.recommended_command || "",
        expected_output: asArray(action.output_expectations),
        db_mutation_needed: false,
        operator_approval_needed: action.operator_approval_required === true,
        operator_approval_required: action.operator_approval_required === true,
        auto_repairable: action.auto_repairable === true,
        dead_end_blocker: action.dead_end_blocker === true,
        post_repair_validation_command: action.post_repair_validation_command || "",
        blockers: asArray(job.blockers),
        evidence: action.evidence || {},
      });
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_REPAIR_BACKLOG",
    summary: {
      total_items: items.length,
      auto_repairable_items: items.filter((item) => item.auto_repairable).length,
      operator_required_items: items.filter((item) => item.operator_approval_required).length,
      dead_end_blocker_items: items.filter((item) => item.dead_end_blocker).length,
    },
    items,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function repairBacklogItemsFromPublishBlockerResolution(plan = {}) {
  const stages = asArray(plan?.repair_orchestration?.stages);
  const items = [];
  for (const stage of stages) {
    const stageId = cleanText(stage.id);
    for (const item of asArray(stage.items)) {
      const storyId = cleanText(item.story_id || item.id);
      const repairLane = cleanText(item.repair_lane || item.lane);
      if (!storyId || !repairLane) continue;
      const blockerType = cleanText(item.blocker_type || item.blocker || repairLane);
      const operatorApprovalRequired =
        item.operator_approval_required === true ||
        item.operator_approval_needed === true ||
        stage.requires_operator_confirmation === true;
      const autoRepairable =
        item.auto_repairable === true ||
        (stageId === "auto_repair_backlog" && operatorApprovalRequired !== true);
      const expectedOutput = asArray(item.expected_output).length
        ? asArray(item.expected_output).map(cleanText).filter(Boolean)
        : cleanText(item.expected_output)
          ? [cleanText(item.expected_output)]
          : [];
      items.push({
        source: "publish_blocker_resolution",
        story_id: storyId,
        title: cleanText(item.title),
        artifact_dir: null,
        blocker_type: blockerType,
        repair_lane: repairLane,
        exact_missing_input: cleanText(item.exact_missing_input),
        required_artefact_path: cleanText(item.required_artefact_path),
        required_artefact_paths: asArray(item.required_artefact_paths)
          .map(cleanText)
          .filter(Boolean),
        recommended_command: cleanText(item.recommended_command || item.command),
        expected_output: expectedOutput,
        db_mutation_needed: item.db_mutation_required === true || item.db_mutation_needed === true,
        operator_approval_needed: operatorApprovalRequired,
        operator_approval_required: operatorApprovalRequired,
        auto_repairable: autoRepairable,
        dead_end_blocker: item.dead_end_blocker === true,
        post_repair_validation_command: cleanText(item.post_repair_validation_command),
        blockers: blockerType ? [blockerType] : [],
        evidence: {
          source: "publish_blocker_resolution",
          source_plan_generated_at: plan.generated_at || null,
          source_stage_id: stageId || null,
          publish_runway_status: cleanText(plan?.publish_runway?.status) || null,
        },
      });
    }
  }
  return items;
}

function repairBacklogKey(item = {}) {
  return [
    cleanText(item.story_id),
    cleanText(item.repair_lane),
    cleanText(item.blocker_type),
  ].join("|");
}

function mergeRepairBacklogs(baseBacklog = {}, extraItems = [], generatedAt = new Date().toISOString()) {
  const items = [...asArray(baseBacklog.items)];
  const seen = new Set(items.map(repairBacklogKey));
  for (const item of asArray(extraItems)) {
    const key = repairBacklogKey(item);
    if (!key.replace(/\|/g, "")) continue;
    if (seen.has(key)) continue;
    items.push(item);
    seen.add(key);
  }
  return {
    ...(baseBacklog || {}),
    generated_at: generatedAt,
    summary: {
      total_items: items.length,
      auto_repairable_items: items.filter((item) => item.auto_repairable).length,
      operator_required_items: items.filter((item) => item.operator_approval_required).length,
      dead_end_blocker_items: items.filter((item) => item.dead_end_blocker).length,
      publish_blocker_resolution_items: items.filter((item) => item.source === "publish_blocker_resolution").length,
    },
    items,
    safety: {
      ...(baseBacklog.safety || {}),
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildAutoRepairPlan(repairBacklog = {}, generatedAt = new Date().toISOString()) {
  const items = asArray(repairBacklog.items).filter((item) => item.auto_repairable === true);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_AUTO_REPAIR_PLAN",
    status: items.length ? "auto_repairable_jobs_available" : "empty_no_auto_repairable_jobs",
    summary: {
      auto_repairable_items: items.length,
      blocked_or_operator_required_items: asArray(repairBacklog.items).length - items.length,
    },
    items,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildPostRepairValidationPlan(repairBacklog = {}, generatedAt = new Date().toISOString()) {
  const items = asArray(repairBacklog.items).map((item) => ({
    story_id: item.story_id,
    blocker_type: item.blocker_type,
    repair_lane: item.repair_lane,
    required_artefact_path: item.required_artefact_path || "",
    required_artefact_paths: asArray(item.required_artefact_paths || [item.required_artefact_path]).filter(Boolean),
    validation_command: item.post_repair_validation_command || "npm run ops:goal-render-inputs",
    expected_ready_state:
      item.blocker_type === "run_visual_v4_production_render" || item.blocker_type === "materialise_final_mp4"
        ? "strict_dry_run_preflight_can_recheck_final_render"
        : "render_input_gate_rechecks_story",
    db_mutation_needed: false,
    operator_approval_needed: item.operator_approval_needed === true || item.operator_approval_required === true,
  }));
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_POST_REPAIR_VALIDATION_PLAN",
    summary: {
      validation_items: items.length,
      operator_approval_items: items.filter((item) => item.operator_approval_needed).length,
      db_mutation_items: items.filter((item) => item.db_mutation_needed).length,
    },
    items,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function renderGoalRenderInputWorkOrderMarkdown(workOrder = {}) {
  const lines = [];
  lines.push("# Goal Render Input Work Order");
  lines.push("");
  lines.push(`Generated: ${workOrder.generated_at || ""}`);
  lines.push(`Stories: ${workOrder.summary?.story_count || 0}`);
  lines.push(`Ready for final render: ${workOrder.summary?.ready_for_final_render_job_count || 0}`);
  lines.push(`Blocked on inputs: ${workOrder.summary?.blocked_on_render_inputs_count || 0}`);
  lines.push(`Audio/timestamp jobs: ${workOrder.summary?.audio_timestamp_jobs || 0}`);
  lines.push(`Real motion jobs: ${workOrder.summary?.real_motion_materialisation_jobs || 0}`);
  lines.push(`Public output repair jobs: ${workOrder.summary?.public_output_repair_jobs || 0}`);
  lines.push(`Rights ledger repair jobs: ${workOrder.summary?.rights_ledger_repair_jobs || 0}`);
  lines.push(`Commercial disclosure repair jobs: ${workOrder.summary?.commercial_disclosure_repair_jobs || 0}`);
  lines.push(`Final MP4 repair jobs: ${workOrder.summary?.final_mp4_repair_jobs || 0}`);
  lines.push(`Caption repair jobs: ${workOrder.summary?.caption_repair_jobs || 0}`);
  lines.push(`Manifest repair jobs: ${workOrder.summary?.manifest_repair_jobs || 0}`);
  lines.push(`Stale QA refresh jobs: ${workOrder.summary?.stale_qa_refresh_jobs || 0}`);
  lines.push(`Normal duration repair jobs: ${workOrder.summary?.normal_duration_repair_jobs || 0}`);
  lines.push(`Publish blocker repair items: ${workOrder.summary?.publish_blocker_resolution_repair_items || 0}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(workOrder.jobs).slice(0, 20)) {
    const actions = job.actions.map((action) => action.action_id).join(", ") || "none";
    lines.push(`- ${job.story_id}: ${job.status}; actions: ${actions}`);
  }
  if (!asArray(workOrder.jobs).length) lines.push("- none");
  const externalRepairItems = asArray(workOrder.repair_backlog?.items)
    .filter((item) => item.source === "publish_blocker_resolution");
  if (externalRepairItems.length) {
    lines.push("");
    lines.push("## Publish Blocker Repair Backlog");
    for (const item of externalRepairItems.slice(0, 20)) {
      lines.push(`- ${item.story_id}: ${item.repair_lane}; blocker: ${item.blocker_type}`);
    }
  }
  lines.push("");
  lines.push("Safety: local planning only; no publishing, database mutation, token change or OAuth change.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalRenderInputWorkOrder(workOrder = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalRenderInputWorkOrder requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "render_input_work_order.json");
  const markdownPath = path.join(outDir, "render_input_work_order.md");
  const repairBacklogPath = path.join(outDir, "repair_backlog.json");
  const autoRepairPlanPath = path.join(outDir, "auto_repair_plan.json");
  const postRepairValidationPlanPath = path.join(outDir, "post_repair_validation_plan.json");
  await fs.writeJson(jsonPath, workOrder, { spaces: 2 });
  await fs.writeJson(repairBacklogPath, workOrder.repair_backlog || buildRepairBacklog(workOrder.jobs), { spaces: 2 });
  await fs.writeJson(autoRepairPlanPath, workOrder.auto_repair_plan || buildAutoRepairPlan(workOrder.repair_backlog), { spaces: 2 });
  await fs.writeJson(
    postRepairValidationPlanPath,
    workOrder.post_repair_validation_plan || buildPostRepairValidationPlan(workOrder.repair_backlog),
    { spaces: 2 },
  );
  await fs.writeFile(markdownPath, renderGoalRenderInputWorkOrderMarkdown(workOrder), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath, repairBacklogPath, autoRepairPlanPath, postRepairValidationPlanPath };
}

module.exports = {
  buildGoalRenderInputWorkOrder,
  renderGoalRenderInputWorkOrderMarkdown,
  writeGoalRenderInputWorkOrder,
};
