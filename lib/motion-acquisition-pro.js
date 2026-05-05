"use strict";

const { buildAssetAcquisitionPlan } = require("./asset-acquisition-pro");

function taskTypes(plan) {
  return new Set((plan?.tasks || []).map((task) => task.type));
}

function normaliseReference(reference) {
  return {
    provider: reference?.provider || reference?.source || null,
    source_type: reference?.source_type || "unknown",
    source_url: reference?.source_url || null,
    local_path: reference?.local_path || null,
    entity: reference?.entity || null,
    movie_name: reference?.movie_name || reference?.name || reference?.title || null,
    rights_risk_class: reference?.rights_risk_class || null,
    allowed_render_use: reference?.allowed_render_use || null,
    downloads_allowed: reference?.downloads_allowed === true,
    reference_status: reference?.local_path
      ? "local_reference"
      : reference?.source_url
        ? "remote_reference"
        : "metadata_reference",
  };
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

function officialPlansFromOptions(options) {
  if (Array.isArray(options?.officialTrailerReferencePlans)) {
    return options.officialTrailerReferencePlans;
  }
  if (Array.isArray(options?.officialTrailerReferenceReport?.plans)) {
    return options.officialTrailerReferenceReport.plans;
  }
  if (Array.isArray(options?.officialTrailerReferences?.plans)) {
    return options.officialTrailerReferences.plans;
  }
  if (Array.isArray(options?.officialTrailerReferences)) {
    return options.officialTrailerReferences;
  }
  if (options?.officialTrailerReferencePlans instanceof Map) {
    return Array.from(options.officialTrailerReferencePlans.values());
  }
  if (options?.officialTrailerReferences && typeof options.officialTrailerReferences === "object") {
    return Object.entries(options.officialTrailerReferences).map(([story_id, references]) => ({
      story_id,
      references: Array.isArray(references) ? references : [],
    }));
  }
  return [];
}

function officialReferencesForStory(story, options = {}) {
  const storyId = story?.id;
  return officialPlansFromOptions(options)
    .filter((plan) => plan?.story_id === storyId || plan?.storyId === storyId)
    .flatMap((plan) => (Array.isArray(plan?.references) ? plan.references : []))
    .filter(Boolean)
    .filter((reference) => reference.downloads_allowed !== true);
}

function motionReadiness({ acquisitionPlan, counts, references, types, hasResolverReferences }) {
  if (acquisitionPlan.topicality_verdict === "reject") return "reject";
  if (counts.total_clips >= 3 && counts.trailer_extracted_frames >= 3) {
    return "local_motion_proof_ready";
  }
  if (
    references.length > 0 &&
    (hasResolverReferences || types.has("trailer_frame_extract") || types.has("clip_slice_extract"))
  ) {
    return "reference_ready_for_local_frame_plan";
  }
  if (references.length > 0) return "reference_only";
  if (types.has("official_trailer_search")) return "official_reference_search_required";
  return "no_motion_path";
}

function buildMotionAcquisitionPlan(story, options = {}) {
  const acquisitionPlan = buildAssetAcquisitionPlan(story, options);
  const counts = acquisitionPlan.media_inventory?.counts || {};
  const types = taskTypes(acquisitionPlan);
  const trailerFramePlan = acquisitionPlan.trailer_frame_plan || {};
  const resolverReferences = officialReferencesForStory(story, options).map(normaliseReference);
  const references = dedupeReferences([
    ...(trailerFramePlan.references || []).map(normaliseReference),
    ...resolverReferences,
  ]);
  const hasResolverReferences = resolverReferences.length > 0;
  const officialSearchTasks = references.length
    ? []
    : (acquisitionPlan.tasks || []).filter((task) => task.type === "official_trailer_search");
  const extractionTasks = (trailerFramePlan.planned_actions || []).filter((task) =>
    ["trailer_frame_extract", "clip_slice_extract"].includes(task.type),
  );
  const resolverPlanActions = hasResolverReferences
    ? [
        {
          type: "trailer_frame_extract_plan",
          priority: "high",
          target: resolverReferences
            .map((reference) => reference.entity)
            .filter(Boolean)
            .join(", ") || "official trailer references",
          reason: "official_trailer_reference_resolved_report_only",
          will_download: false,
          mutates: false,
          minimum_frames: 3,
          current_frames: counts.trailer_extracted_frames || 0,
          reference_count: resolverReferences.length,
          accepted_sources: ["Steam movie metadata", "IGDB video metadata"],
        },
      ]
    : [];
  const plannedActions = [...officialSearchTasks, ...extractionTasks, ...resolverPlanActions].map((task) => ({
    type: task.type,
    priority: task.priority,
    target: task.target,
    reason: task.reason,
    will_download: false,
    mutates: false,
    queries: task.queries || undefined,
    minimum_frames: task.minimum_frames,
    current_frames: task.current_frames,
    desired_clip_slices: task.desired_clip_slices,
    current_clips: task.current_clips,
    accepted_sources: task.accepted_sources,
    reference_count: task.reference_count,
  }));
  const readiness = motionReadiness({
    acquisitionPlan,
    counts,
    references,
    types,
    hasResolverReferences,
  });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    execution_mode: "report_only",
    will_download: false,
    will_extract_frames: false,
    story_id: acquisitionPlan.story_id,
    title: acquisitionPlan.title,
    topicality_verdict: acquisitionPlan.topicality_verdict,
    motion_readiness: readiness,
    studio_v2_motion_candidate: readiness === "local_motion_proof_ready",
    counts: {
      official_trailer_clips: counts.official_trailer_clips || 0,
      gameplay_clips: counts.gameplay_clips || 0,
      trailer_extracted_frames: counts.trailer_extracted_frames || 0,
      total_clips: counts.total_clips || 0,
      total_images: counts.total_images || 0,
    },
    existing_references: references,
    planned_actions: plannedActions,
    search_queries: (acquisitionPlan.search_queries || []).filter((query) =>
      /official trailer|gameplay/i.test(query),
    ),
    frame_plan: {
      mode: "report_only",
      downloads_allowed: false,
      frame_extraction_allowed: false,
      minimum_frames: 3,
      current_frames: counts.trailer_extracted_frames || 0,
      dedupe_required: true,
      frame_quality_scoring_required: true,
    },
    clip_plan: {
      mode: "report_only",
      downloads_allowed: false,
      clip_slicing_allowed: false,
      desired_clip_slices: 3,
      current_clips: counts.total_clips || 0,
    },
    blockers: buildMotionBlockers(readiness, counts, references),
    source_asset_acquisition: {
      acquisition_verdict: acquisitionPlan.acquisition_verdict,
      asset_budget_class: acquisitionPlan.asset_budget_class,
      exact_subject_readiness: acquisitionPlan.exact_subject_readiness,
    },
    safety: {
      local_only: true,
      railway_mutated: false,
      production_db_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      video_downloads: false,
      yt_dlp: false,
      browser_scraping: false,
      production_render_default_changed: false,
    },
  };
}

function buildMotionBlockers(readiness, counts, references) {
  const blockers = [];
  if (readiness === "reject") blockers.push("off_brand_or_rejected_story");
  if (references.length === 0) blockers.push("no_official_motion_reference");
  if ((counts.trailer_extracted_frames || 0) < 3) blockers.push("needs_three_trailer_frames");
  if ((counts.total_clips || 0) < 3) blockers.push("needs_three_clip_slices");
  if (readiness === "local_motion_proof_ready") return [];
  return blockers;
}

function buildMotionAcquisitionReport(stories = [], options = {}) {
  const plans = (Array.isArray(stories) ? stories : []).map((story) =>
    buildMotionAcquisitionPlan(story, options),
  );
  const byReadiness = plans.reduce((acc, plan) => {
    acc[plan.motion_readiness] = (acc[plan.motion_readiness] || 0) + 1;
    return acc;
  }, {});
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    execution_mode: "report_only",
    will_download: false,
    summary: {
      stories: plans.length,
      local_motion_proof_ready: byReadiness.local_motion_proof_ready || 0,
      reference_ready_for_local_frame_plan:
        byReadiness.reference_ready_for_local_frame_plan || 0,
      official_reference_search_required:
        byReadiness.official_reference_search_required || 0,
      reference_only: byReadiness.reference_only || 0,
      no_motion_path: byReadiness.no_motion_path || 0,
      reject: byReadiness.reject || 0,
    },
    plans,
    safety: {
      local_only: true,
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

function renderMotionAcquisitionMarkdown(report) {
  const lines = [];
  lines.push("# Motion Acquisition Pro v1");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Execution mode: ${report.execution_mode}`);
  lines.push(`Will download: ${report.will_download}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- stories: ${report.summary.stories}`);
  lines.push(`- local motion proof ready: ${report.summary.local_motion_proof_ready}`);
  lines.push(`- reference ready for local frame plan: ${report.summary.reference_ready_for_local_frame_plan}`);
  lines.push(`- official trailer search required: ${report.summary.official_reference_search_required}`);
  lines.push("");
  lines.push("| story | readiness | refs | clips | frames | actions | blockers |");
  lines.push("| --- | --- | ---: | ---: | ---: | --- | --- |");
  for (const plan of report.plans) {
    lines.push(
      [
        plan.story_id,
        plan.motion_readiness,
        plan.existing_references.length,
        plan.counts.total_clips,
        plan.counts.trailer_extracted_frames,
        plan.planned_actions.map((action) => action.type).join(", ") || "none",
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
  lines.push("- No trailer/video downloads.");
  lines.push("- No frame extraction or clip slicing.");
  lines.push("- No yt-dlp, browser scraping, Railway changes, OAuth, production DB mutation or posting.");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildMotionAcquisitionPlan,
  buildMotionAcquisitionReport,
  renderMotionAcquisitionMarkdown,
};
