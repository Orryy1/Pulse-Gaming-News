"use strict";

const FRAME_PERCENTS = [0.42, 0.58, 0.74, 0.88];
const DEFAULT_MAX_TARGET_FRAMES = 12;
const SAMPLING_STRATEGY = "interleaved_non_intro_multi_probe_v3";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isOfficialReference(reference) {
  const sourceType = String(reference?.source_type || "").toLowerCase();
  return (
    Boolean(reference?.source_url || reference?.local_path) &&
    reference?.downloads_allowed !== true &&
    /(steam_movie|igdb_video|official_trailer|publisher_video|platform_video)/.test(sourceType)
  );
}

function referenceScore(reference) {
  const name = String(reference?.movie_name || reference?.name || "").toLowerCase();
  let score = 50;
  if (reference?.provider === "steam") score += 20;
  if (reference?.provider === "igdb") score += 15;
  if (/official/.test(name)) score += 12;
  if (/launch|reveal|gameplay|trailer/.test(name)) score += 8;
  if (reference?.entity) score += 8;
  if (reference?.rights_risk_class === "storefront_promotional_video") score += 5;
  return score;
}

function referenceKey(reference) {
  return [
    reference?.source_url || "",
    reference?.local_path || "",
    reference?.source_type || "",
    reference?.entity || "",
  ].join("|");
}

function dedupeReferences(references) {
  const seen = new Set();
  const deduped = [];
  for (const reference of references) {
    const key = referenceKey(reference);
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    deduped.push(reference);
  }
  return deduped;
}

function normalisePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function selectedReferenceCountForEntity(selected, entity) {
  const normalised = String(entity || "").toLowerCase();
  if (!normalised) return 0;
  return selected.filter((reference) => String(reference.entity || "").toLowerCase() === normalised)
    .length;
}

function selectReferences(references, maxReferences = 4, options = {}) {
  const sorted = dedupeReferences(references.filter(isOfficialReference)).sort(
    (a, b) => referenceScore(b) - referenceScore(a),
  );
  const cap = normalisePositiveInteger(maxReferences, 4);
  const maxReferencesPerEntity = normalisePositiveInteger(options.maxReferencesPerEntity, 1);
  const selected = [];
  const usedEntities = new Set();

  for (const reference of sorted) {
    const entity = String(reference.entity || "").toLowerCase();
    if (entity && usedEntities.has(entity)) continue;
    selected.push(reference);
    if (entity) usedEntities.add(entity);
    if (selected.length >= cap) return selected;
  }

  if (maxReferencesPerEntity > 1) {
    for (const reference of sorted) {
      if (selected.includes(reference)) continue;
      const entity = String(reference.entity || "").toLowerCase();
      if (!entity) continue;
      if (selectedReferenceCountForEntity(selected, entity) >= maxReferencesPerEntity) continue;
      selected.push(reference);
      if (selected.length >= cap) return selected;
    }
  }

  for (const reference of sorted) {
    if (selected.includes(reference)) continue;
    if (reference.entity) continue;
    selected.push(reference);
    if (selected.length >= cap) break;
  }

  return selected;
}

function targetFramesForReferences(references, options = {}) {
  const maxTargetFrames = Math.max(1, Number(options.maxTargetFrames) || DEFAULT_MAX_TARGET_FRAMES);
  const frames = [];
  for (const percent of FRAME_PERCENTS) {
    for (const reference of references) {
      frames.push({
        sample_order: frames.length + 1,
        sampling_strategy: SAMPLING_STRATEGY,
        source_url: reference.source_url || null,
        local_path: reference.local_path || null,
        source_type: reference.source_type,
        entity: reference.entity || null,
        target_time_percent: percent,
        time_expression: `${Math.round(percent * 100)}%`,
        reason: "representative_exact_subject_frame_candidate",
        downloads_allowed: false,
        extraction_allowed: false,
        quality_checks: [
          "dedupe_hash",
          "blur_detection",
          "black_frame_detection",
          "thumbnail_safety",
          "exact_subject_visibility",
        ],
      });
    }
  }
  return frames.slice(0, maxTargetFrames);
}

function readinessFor(motionPlan, selectedReferences, targetFrames) {
  if (motionPlan?.motion_readiness === "reject") return "reject";
  if (selectedReferences.length === 0) return "no_reference";
  if (selectedReferences.length < 2) return "thin_reference_coverage";
  if (targetFrames.length >= 3) return "frame_plan_ready";
  return "thin_reference_coverage";
}

function blockersFor(readiness, motionPlan, selectedReferences, targetFrames) {
  if (readiness === "frame_plan_ready") return [];
  const blockers = [];
  if (readiness === "reject") blockers.push("story_rejected_upstream");
  if (selectedReferences.length === 0) blockers.push("no_official_motion_reference");
  if (selectedReferences.length > 0 && selectedReferences.length < 2) {
    blockers.push("needs_two_unique_official_references");
  }
  if (targetFrames.length < 3) blockers.push("needs_three_planned_frames");
  if (motionPlan?.motion_readiness === "official_reference_search_required") {
    blockers.push("official_reference_search_required");
  }
  return Array.from(new Set(blockers));
}

function buildControlledFrameExtractionPlan(motionPlan, options = {}) {
  const maxReferencesPerEntity = normalisePositiveInteger(options.maxReferencesPerEntity, 1);
  const selectedReferences = selectReferences(
    asArray(motionPlan?.existing_references),
    options.maxReferences || 4,
    { maxReferencesPerEntity },
  );
  const targetFrames = targetFramesForReferences(selectedReferences, {
    maxTargetFrames: options.maxTargetFrames,
  });
  const framePlanReadiness = readinessFor(motionPlan, selectedReferences, targetFrames);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    execution_mode: "report_only",
    will_download: false,
    will_extract_frames: false,
    story_id: motionPlan?.story_id || "unknown",
    title: motionPlan?.title || "Untitled",
    upstream_motion_readiness: motionPlan?.motion_readiness || "unknown",
    frame_plan_readiness: framePlanReadiness,
    selected_references: selectedReferences.map((reference, index) => ({
      order: index + 1,
      provider: reference.provider || null,
      source_type: reference.source_type || "unknown",
      source_url: reference.source_url || null,
      local_path: reference.local_path || null,
      entity: reference.entity || null,
      movie_name: reference.movie_name || reference.name || null,
      score: referenceScore(reference),
      entity_reference_rank: selectedReferenceCountForEntity(
        selectedReferences.slice(0, index + 1),
        reference.entity,
      ) || null,
      selection_reason:
        selectedReferenceCountForEntity(selectedReferences.slice(0, index + 1), reference.entity) > 1
          ? "alternate_official_reference_retry"
          : "primary_official_reference",
      rights_risk_class: reference.rights_risk_class || null,
      allowed_render_use: reference.allowed_render_use || null,
      downloads_allowed: false,
    })),
    target_frames: targetFrames,
    exact_subject_motion_coverage: {
      unique_entities: Array.from(
        new Set(selectedReferences.map((reference) => reference.entity).filter(Boolean)),
      ),
      reference_count: selectedReferences.length,
      target_frame_count: targetFrames.length,
      minimum_frame_count: 3,
      sampling_strategy: SAMPLING_STRATEGY,
      max_references_per_entity: maxReferencesPerEntity,
      alternate_reference_count: selectedReferences.filter(
        (reference, index) =>
          selectedReferenceCountForEntity(selectedReferences.slice(0, index + 1), reference.entity) >
          1,
      ).length,
      max_target_frames: Math.max(
        1,
        Number(options.maxTargetFrames) || DEFAULT_MAX_TARGET_FRAMES,
      ),
    },
    blockers: blockersFor(framePlanReadiness, motionPlan, selectedReferences, targetFrames),
    safety: {
      local_only: true,
      report_only: true,
      video_downloads: false,
      frame_extraction: false,
      clip_slicing: false,
      yt_dlp: false,
      browser_scraping: false,
      railway_mutated: false,
      production_db_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      production_render_default_changed: false,
    },
  };
}

function buildControlledFrameExtractionReport(motionPlans = [], options = {}) {
  const plans = asArray(motionPlans).map((motionPlan) =>
    buildControlledFrameExtractionPlan(motionPlan, options),
  );
  const byReadiness = plans.reduce((acc, plan) => {
    acc[plan.frame_plan_readiness] = (acc[plan.frame_plan_readiness] || 0) + 1;
    return acc;
  }, {});
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    execution_mode: "report_only",
    will_download: false,
    will_extract_frames: false,
    summary: {
      stories: plans.length,
      frame_plan_ready: byReadiness.frame_plan_ready || 0,
      thin_reference_coverage: byReadiness.thin_reference_coverage || 0,
      no_reference: byReadiness.no_reference || 0,
      reject: byReadiness.reject || 0,
      target_frames: plans.reduce((sum, plan) => sum + plan.target_frames.length, 0),
    },
    plans,
    safety: {
      local_only: true,
      report_only: true,
      downloads: false,
      frame_extraction: false,
      clip_slicing: false,
      railway_mutated: false,
      production_db_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
    },
  };
}

function renderControlledFrameExtractionMarkdown(report) {
  const lines = [];
  lines.push("# Controlled Frame Extraction Plan v1");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Execution mode: ${report.execution_mode}`);
  lines.push(`Will download: ${report.will_download}`);
  lines.push(`Will extract frames: ${report.will_extract_frames}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- stories: ${report.summary.stories}`);
  lines.push(`- frame-plan ready: ${report.summary.frame_plan_ready}`);
  lines.push(`- thin reference coverage: ${report.summary.thin_reference_coverage}`);
  lines.push(`- no reference: ${report.summary.no_reference}`);
  lines.push(`- planned target frames: ${report.summary.target_frames}`);
  lines.push("");
  lines.push("| story | readiness | refs | entities | target frames | blockers |");
  lines.push("| --- | --- | ---: | --- | ---: | --- |");
  for (const plan of report.plans) {
    lines.push(
      [
        plan.story_id,
        plan.frame_plan_readiness,
        plan.selected_references.length,
        plan.exact_subject_motion_coverage.unique_entities.join(", ") || "none",
        plan.target_frames.length,
        plan.blockers.join(", ") || "clear",
      ]
        .map((value) => String(value ?? "").replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Report-only.");
  lines.push("- No video downloads.");
  lines.push("- No frame extraction or clip slicing.");
  lines.push("- No yt-dlp, browser scraping, Railway changes, OAuth, production DB mutation or posting.");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildControlledFrameExtractionPlan,
  buildControlledFrameExtractionReport,
  renderControlledFrameExtractionMarkdown,
};
