"use strict";

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return typeof value === "object" ? [value] : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseFamily(value) {
  return (
    cleanText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || null
  );
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function storyIdFromPack(pack = {}) {
  return cleanText(pack.story_id || pack.storyId || pack.id);
}

function currentFamilies(pack = {}) {
  return Array.from(
    new Set(
      asArray(pack.clips)
        .map((clip) => normaliseFamily(clip.source_family || clip.sourceFamily))
        .filter(Boolean),
    ),
  );
}

function currentFamilySet(pack = {}) {
  return new Set(currentFamilies(pack));
}

function findSourceFamilyRow(sourceFamilyReport = {}, storyId = "") {
  return (
    asArray(sourceFamilyReport.rows).find(
      (row) => cleanText(row.story_id) === cleanText(storyId),
    ) || {}
  );
}

function directMediaForCandidate(directMediaDiscoveryReport = {}, storyId = "", candidate = {}) {
  const family = normaliseFamily(candidate.source_family);
  return (
    asArray(directMediaDiscoveryReport.rows).find((row) => {
      if (cleanText(row.story_id) !== cleanText(storyId)) return false;
      return normaliseFamily(row.source_family) === family;
    }) || null
  );
}

function sourceKind(candidate = {}) {
  return cleanText(candidate.source_url_kind || candidate.sourceUrlKind);
}

function isYoutubeReference(candidate = {}) {
  return sourceKind(candidate).startsWith("youtube");
}

function isDirectMediaReference(candidate = {}) {
  return ["direct_video", "hls_manifest", "dash_manifest"].includes(sourceKind(candidate));
}

function isTrustedCreator(candidate = {}) {
  return cleanText(candidate.source_tier) === "trusted_creator_reference";
}

function segmentStoryId(segment = {}) {
  return cleanText(segment.story_id || segment.storyId || segment.provenance?.story_id);
}

function segmentFamily(segment = {}) {
  return normaliseFamily(
    segment.source_family ||
      segment.sourceFamily ||
      segment.provenance?.source_family ||
      segment.provenance?.sourceFamily,
  );
}

function segmentValidated(segment = {}) {
  return segment.segment_validated === true || cleanText(segment.status) === "validated";
}

function segmentActionScore(segment = {}) {
  const value = Number(segment.action_score ?? segment.actionScore);
  return Number.isFinite(value) ? value : null;
}

function validationReason(segment = {}) {
  return cleanText(segment.validation_reason || segment.reason || "unknown");
}

function topReason(segments = []) {
  const counts = new Map();
  for (const segment of segments) {
    const reason = validationReason(segment);
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
}

function segmentValidationOutcome({
  storyId,
  candidate = {},
  pack = {},
  segmentValidationReport = {},
} = {}) {
  const family = normaliseFamily(candidate.source_family);
  if (!family) return { segment_validation_status: "unknown_family" };
  if (currentFamilies(pack).includes(family)) {
    return { segment_validation_status: "accepted_motion_clip" };
  }
  const segments = asArray(segmentValidationReport.segments).filter((segment) => {
    const rowStoryId = segmentStoryId(segment);
    if (storyId && rowStoryId && rowStoryId !== storyId) return false;
    return segmentFamily(segment) === family;
  });
  if (!segments.length) {
    return { segment_validation_status: "not_scanned" };
  }
  const validated = segments.filter(segmentValidated);
  const rejected = segments.filter((segment) => !segmentValidated(segment));
  const scores = segments.map(segmentActionScore).filter((score) => score !== null);
  const base = {
    segment_validation_checked_segments: segments.length,
    segment_validation_rejected_segments: rejected.length,
    segment_validation_best_action_score: scores.length ? Math.max(...scores) : null,
  };
  if (validated.length) {
    return {
      ...base,
      segment_validation_status: "validated_not_selected",
      segment_validation_validated_segments: validated.length,
      segment_validation_rejection_reason: rejected.length ? topReason(rejected) : "",
    };
  }
  return {
    ...base,
    segment_validation_status: "validation_failed",
    segment_validation_validated_segments: 0,
    segment_validation_rejection_reason: topReason(rejected),
  };
}

function classifyAcquisition({
  storyId,
  candidate = {},
  directMediaRow = null,
  segmentValidation = {},
} = {}) {
  const family = normaliseFamily(candidate.source_family);
  const directReady = directMediaRow?.status === "direct_media_found" || isDirectMediaReference(candidate);
  const discoveryStatus = cleanText(directMediaRow?.status);
  const discoveryReason = cleanText(directMediaRow?.rejection_reason || directMediaRow?.blocking_reason);
  const discoveryFields = directMediaRow
    ? {
        direct_media_discovery_status: discoveryStatus,
        direct_media_discovery_reason: discoveryReason,
      }
    : {};
  if (directReady) {
    const directMediaUrl = cleanText(directMediaRow?.direct_media_url || candidate.source_url || candidate.reference_url);
    return {
      story_id: storyId,
      source_family: family,
      display_name: cleanText(candidate.display_name || candidate.source_id || family),
      source_tier: cleanText(candidate.source_tier || "official"),
      action: "intake_direct_media_and_validate_segments",
      priority: "urgent",
      blocker: null,
      direct_media_url: directMediaUrl,
      direct_media_url_kind: cleanText(directMediaRow?.source_url_kind || candidate.source_url_kind),
      source_duration_s: directMediaRow?.source_duration_s || candidate.source_duration_s || null,
      allowed_render_use: "reference_only_until_segment_validation_passes",
      ...segmentValidation,
      ...discoveryFields,
    };
  }
  if (isTrustedCreator(candidate)) {
    return {
      story_id: storyId,
      source_family: family,
      display_name: cleanText(candidate.display_name || candidate.source_id || family),
      source_tier: cleanText(candidate.source_tier),
      action: "trusted_creator_licence_required",
      priority: "high",
      blocker: "trusted_creator_reference_is_not_render_permission",
      direct_media_url: "",
      direct_media_url_kind: "",
      source_duration_s: null,
      allowed_render_use: "reference_only_until_licensed",
      segment_validation_status: "not_applicable_until_media_approved",
      ...discoveryFields,
    };
  }
  if (isYoutubeReference(candidate)) {
    return {
      story_id: storyId,
      source_family: family,
      display_name: cleanText(candidate.display_name || candidate.source_id || family),
      source_tier: cleanText(candidate.source_tier || "official"),
      action: "licensed_direct_media_or_operator_supplied_url_required",
      priority: "high",
      blocker: "youtube_reference_is_not_download_permission",
      direct_media_url: "",
      direct_media_url_kind: "",
      source_duration_s: null,
      allowed_render_use: "reference_only_until_direct_media_or_licence",
      segment_validation_status: "not_applicable_until_media_approved",
      ...discoveryFields,
    };
  }
  return {
    story_id: storyId,
    source_family: family,
    display_name: cleanText(candidate.display_name || candidate.source_id || family),
    source_tier: cleanText(candidate.source_tier || "official"),
    action: "discover_direct_media_or_operator_supplied_url",
    priority: "normal",
    blocker: "direct_media_url_missing",
    direct_media_url: "",
    direct_media_url_kind: "",
    source_duration_s: null,
    allowed_render_use: "reference_only_until_direct_media_found",
    segment_validation_status: "not_scanned",
    ...discoveryFields,
  };
}

function safeNextCommands(storyId) {
  const suffix = storyId ? ` --story-id ${storyId}` : "";
  const framePlanFlags = " --max-references 12 --max-references-per-entity 12 --max-target-frames 48";
  const frameExtractFlags = " --max-frames-per-story 48";
  const segmentValidationFlags =
    " --deep-scan --include-frame-anchored-windows --candidate-windows-per-source 6 --max-segments 72";
  return [
    {
      step: "discover_direct_media",
      command:
        `npm run media:discover-direct-media -- --input test/output/visual_v4_source_family_intake_template.json${suffix}`,
    },
    {
      step: "intake_official_direct_media",
      command:
        `npm run media:intake-official-sources -- --input test/output/official_direct_media_intake_template.json${suffix}`,
    },
    {
      step: "classify_licensed_direct_media_readiness",
      command: `npm run ops:v4-licensed-direct-media --${suffix}`,
    },
    {
      step: "resolve_trailer_references",
      command:
        `npm run media:resolve-trailers --${suffix} --official-source-intake-report test/output/studio_v4_licensed_direct_media_acquisition.json --trusted-footage-registry-report test/output/trusted_footage_registry_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --write-latest-report`,
    },
    {
      step: "plan_controlled_frame_windows",
      command: `npm run media:plan-frames --${suffix}${framePlanFlags}`,
    },
    {
      step: "extract_controlled_frames",
      command: `npm run media:extract-frames --${suffix} --apply-local${frameExtractFlags}`,
    },
    {
      step: "validate_motion_segments",
      command: `npm run media:validate-trailer-segments --${suffix} --apply-local${segmentValidationFlags}`,
    },
    {
      step: "rebuild_visual_v4_motion_pack",
      command: `npm run ops:v4-motion-pack --${suffix}`,
    },
  ];
}

function buildRejectedBreakdown(pack = {}) {
  const counts = new Map();
  for (const item of asArray(pack.rejected_candidates)) {
    const reason = cleanText(item.reason || item.rejection_reason || "unknown");
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Array.from(counts, ([reason, count]) => ({ reason, count })).sort(
    (a, b) => b.count - a.count || a.reason.localeCompare(b.reason),
  );
}

function buildRow({
  pack = {},
  sourceFamilyReport = {},
  directMediaDiscoveryReport = {},
  segmentValidationReport = {},
} = {}) {
  const storyId = storyIdFromPack(pack);
  const budget = pack.motion_budget || {};
  const families = currentFamilies(pack);
  const currentMotionClips = numberOrZero(
    budget.available_motion_clips ?? asArray(pack.clips).length,
  );
  const requiredMotionClips = numberOrZero(budget.required_motion_scenes);
  const currentMotionFamilies = numberOrZero(
    budget.available_distinct_families ?? families.length,
  );
  const requiredMotionFamilies = numberOrZero(budget.required_distinct_families);
  const missingMotionFamilies = Math.max(0, requiredMotionFamilies - currentMotionFamilies);
  const missingMotionClips = Math.max(0, requiredMotionClips - currentMotionClips);
  const sourceRow = findSourceFamilyRow(sourceFamilyReport, storyId);
  const candidates = asArray(sourceRow.source_family_candidates);
  const acceptedFamilies = currentFamilySet(pack);
  const [currentFamilyCandidates, missingFamilyCandidates] = candidates.reduce(
    (groups, candidate) => {
      const family = normaliseFamily(candidate.source_family);
      groups[acceptedFamilies.has(family) ? 0 : 1].push(candidate);
      return groups;
    },
    [[], []],
  );
  const currentFamilyRefreshes = currentFamilyCandidates.map((candidate) =>
    classifyAcquisition({
      storyId,
      candidate,
      directMediaRow: directMediaForCandidate(directMediaDiscoveryReport, storyId, candidate),
      segmentValidation: segmentValidationOutcome({
        storyId,
        candidate,
        pack,
        segmentValidationReport,
      }),
    }),
  );
  const requiredAcquisitions = missingFamilyCandidates.map((candidate) =>
    classifyAcquisition({
      storyId,
      candidate,
      directMediaRow: directMediaForCandidate(directMediaDiscoveryReport, storyId, candidate),
      segmentValidation: segmentValidationOutcome({
        storyId,
        candidate,
        pack,
        segmentValidationReport,
      }),
    }),
  );
  const ready =
    cleanText(pack.readiness?.status) === "v4_motion_ready" &&
    missingMotionFamilies === 0 &&
    missingMotionClips === 0;
  const governedVisualPlan = sourceRow.governed_visual_plan || null;
  const sourceFamilyOperatorRequired = !ready && (
    governedVisualPlan?.operator_approval_required === true ||
    sourceRow.real_visual_media_required_after_owned_explainer_failed === true ||
    sourceRow.render_input_operator_required === true
  ) ? 1 : 0;

  return {
    story_id: storyId,
    title: cleanText(pack.title),
    readiness_status: cleanText(pack.readiness?.status || "unknown"),
    render_decision: ready ? "render_visual_v4" : "hold_v4_source_acquisition_required",
    scheduler_gate: ready
      ? "visual_v4_allowed"
      : "legacy_allowed_but_do_not_claim_visual_v4",
    blockers: asArray(pack.readiness?.blockers),
    current_motion_families: families,
    current_motion_clips: currentMotionClips,
    required_motion_families: requiredMotionFamilies,
    required_motion_clips: requiredMotionClips,
    missing_motion_families: missingMotionFamilies,
    missing_motion_clips: missingMotionClips,
    current_family_refreshes: ready ? [] : currentFamilyRefreshes,
    required_acquisitions: ready ? [] : requiredAcquisitions,
    governed_visual_plan: ready ? null : governedVisualPlan,
    acquisition_counts: {
      direct_media_ready: requiredAcquisitions.filter(
        (item) => item.action === "intake_direct_media_and_validate_segments",
      ).length,
      licence_or_operator_required:
        requiredAcquisitions.filter(
          (item) =>
            item.action === "trusted_creator_licence_required" ||
            item.action === "licensed_direct_media_or_operator_supplied_url_required",
        ).length + sourceFamilyOperatorRequired,
      direct_media_missing: requiredAcquisitions.filter(
        (item) => item.action === "discover_direct_media_or_operator_supplied_url",
      ).length,
      current_family_refreshes: ready ? 0 : currentFamilyRefreshes.length,
    },
    rejected_candidate_breakdown: buildRejectedBreakdown(pack),
    must_not_use: [
      "random_youtube_reupload",
      "reaction_video",
      "stale_merge_previous_segments",
      "duplicate_motion_family_padding",
      "text_card_padding_to_fake_motion_density",
    ],
    safe_next_commands: ready ? [] : safeNextCommands(storyId),
  };
}

function buildStudioV4SourceDeficitReport({
  motionPackReports = [],
  sourceFamilyReport = {},
  directMediaDiscoveryReport = {},
  segmentValidationReport = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const rows = asArray(motionPackReports).map((pack) =>
    buildRow({ pack, sourceFamilyReport, directMediaDiscoveryReport, segmentValidationReport }),
  );
  const blockedRows = rows.filter((row) => row.render_decision !== "render_visual_v4");
  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "studio_v4_source_deficit",
    local_only: true,
    summary: {
      stories: rows.length,
      v4_ready_stories: rows.length - blockedRows.length,
      blocked_stories: blockedRows.length,
      missing_motion_families: blockedRows.reduce(
        (sum, row) => sum + row.missing_motion_families,
        0,
      ),
      missing_motion_clips: blockedRows.reduce((sum, row) => sum + row.missing_motion_clips, 0),
      direct_media_ready: blockedRows.reduce(
        (sum, row) => sum + row.acquisition_counts.direct_media_ready,
        0,
      ),
      licence_or_operator_required: blockedRows.reduce(
        (sum, row) => sum + row.acquisition_counts.licence_or_operator_required,
        0,
      ),
      direct_media_missing: blockedRows.reduce(
        (sum, row) => sum + row.acquisition_counts.direct_media_missing,
        0,
      ),
    },
    safety: {
      local_only: true,
      video_downloads_started: false,
      retained_video_files: false,
      browser_scraping_started: false,
      yt_dlp_started: false,
      oauth_triggered: false,
      production_db_mutated: false,
      railway_mutated: false,
      social_posting_triggered: false,
    },
    rows,
  };
}

function renderStudioV4SourceDeficitMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [];
  lines.push("# Visual V4 Source Deficit");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Blocked stories: ${summary.blocked_stories ?? 0}`);
  lines.push(`V4 ready stories: ${summary.v4_ready_stories ?? 0}`);
  lines.push(`Direct media ready: ${summary.direct_media_ready ?? 0}`);
  lines.push(`Licence/operator required: ${summary.licence_or_operator_required ?? 0}`);
  lines.push("");
  lines.push("Safety: No downloads, DB mutation, OAuth or posting. This only writes local reports.");
  lines.push("");
  lines.push("| story | decision | missing families | missing clips | top acquisition |");
  lines.push("| --- | --- | ---: | ---: | --- |");
  for (const row of asArray(report.rows)) {
    const first = asArray(row.required_acquisitions)[0];
    lines.push(
      `| ${row.story_id || "unknown"} | ${row.render_decision || "unknown"} | ${row.missing_motion_families ?? 0} | ${row.missing_motion_clips ?? 0} | ${first ? `${first.source_family}:${first.action}` : "none"} |`,
    );
  }
  if (!asArray(report.rows).length) {
    lines.push("| none | none | 0 | 0 | none |");
  }
  lines.push("");
  lines.push("## Hard Rules");
  lines.push("");
  lines.push("- Do not use random reuploads, reaction footage or duplicated source families to fake motion density.");
  lines.push("- Do not merge stale segment windows into fresh validation runs.");
  lines.push("- Do not call a render Visual V4 unless the motion-pack gate is ready.");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildStudioV4SourceDeficitReport,
  renderStudioV4SourceDeficitMarkdown,
};
