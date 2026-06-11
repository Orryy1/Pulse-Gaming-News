"use strict";

const { buildFootageEmpirePlan } = require("../studio/v4/footage-empire");

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function storyId(story = {}) {
  return clean(story.id || story.story_id || story.storyId);
}

function sourceFamily(row = {}) {
  return clean(
    row.source_family ||
      row.motion_family ||
      row.visual_family ||
      row.family ||
      row.provenance?.source_family,
  );
}

function clipPath(row = {}) {
  return clean(row.path || row.file || row.source || row.source_url || row.local_path);
}

function durationSeconds(row = {}) {
  const value = Number(row.durationS ?? row.duration_s ?? row.duration_seconds ?? row.duration);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normaliseClip(row = {}, fallbackId = "clip") {
  return {
    ...row,
    id: clean(row.id || row.clip_id || row.segment_id || fallbackId),
    source_family: sourceFamily(row),
    path: clipPath(row),
    durationS: durationSeconds(row),
    validated:
      row.validated !== false &&
      row.validation_result !== "fail" &&
      row.verdict !== "fail" &&
      row.rejected !== true,
    segmentValidationPassed:
      row.segmentValidationPassed === true ||
      row.segment_validated === true ||
      row.segment_validation_passed === true ||
      row.validation_result === "pass" ||
      row.verdict === "pass" ||
      row.status === "validated",
  };
}

function pushClip(output, seen, row, fallbackId) {
  const clip = normaliseClip(row, fallbackId);
  if (!clip.source_family || !clip.path) return;
  const key = `${clip.source_family}|${clip.path}|${clip.durationS || ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  output.push(clip);
}

function footageInventoryRows(footageInventory = {}) {
  return [
    ...asArray(footageInventory.clips),
    ...asArray(footageInventory.motion_clips),
    ...asArray(footageInventory.materialised_motion_clips),
    ...asArray(footageInventory.accepted_local_clips),
    ...asArray(footageInventory.ready_clips),
    ...asArray(footageInventory.render_ready_sources),
    ...asArray(footageInventory.records),
  ];
}

function segmentAccepted(row = {}) {
  const status = clean(row.verdict || row.validation_result || row.status);
  return (
    row.segment_validated === true ||
    row.segmentValidationPassed === true ||
    row.validated === true ||
    ["pass", "accepted", "candidate", "validated"].includes(status)
  );
}

function segmentRows(segmentValidationReport = {}) {
  return [
    ...asArray(segmentValidationReport.accepted_segments),
    ...asArray(segmentValidationReport.validated_segments),
    ...asArray(segmentValidationReport.segments).filter(segmentAccepted),
    ...asArray(segmentValidationReport.rows).filter(segmentAccepted),
  ];
}

function collectLocalMotionClips({
  storyId,
  footageInventory = {},
  segmentValidationReport = {},
} = {}) {
  const output = [];
  const seen = new Set();
  let index = 0;

  for (const row of footageInventoryRows(footageInventory)) {
    pushClip(output, seen, row, `footage_${++index}`);
  }

  for (const row of segmentRows(segmentValidationReport)) {
    const rowStoryId = clean(row.story_id || row.storyId);
    if (storyId && rowStoryId && rowStoryId !== storyId) continue;
    pushClip(
      output,
      seen,
      {
        ...row,
        validated: row.validated !== false,
        segmentValidationPassed: true,
      },
      `segment_${++index}`,
    );
  }

  return output;
}

function rightsRows(rightsLedger = {}) {
  if (Array.isArray(rightsLedger)) return rightsLedger;
  return [
    ...asArray(rightsLedger.assets),
    ...asArray(rightsLedger.records),
    ...asArray(rightsLedger.rights_ledger),
    ...asArray(rightsLedger.rights_records),
  ];
}

function approvedRightsFamilies(rightsLedger = {}) {
  return new Set(
    rightsRows(rightsLedger)
      .filter((row) => clean(row.approval_status || row.status || "approved") !== "rejected")
      .map(sourceFamily)
      .filter(Boolean),
  );
}

function safeFileStem(value) {
  return (
    clean(value)
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "source_family"
  );
}

function sourceUrl(row = {}) {
  return clean(row.source_url || row.reference_url || row.url || row.source);
}

function sourceSafeDirectMotion(row = {}) {
  const text = clean([
    row.media_kind,
    row.source_type,
    row.source_url_kind,
    row.rights_basis,
    row.licence_basis,
    sourceUrl(row),
  ].join(" ")).toLowerCase();
  return Boolean(
    sourceFamily(row) &&
      sourceUrl(row) &&
      /direct_video|official_direct_media|platform_storefront|official_game_website|official_product|official_trailer|steamstatic|nintendo|xbox|playstation|cloudinary|cmsassets|steam/.test(text),
  );
}

function buildRightsLedgerRepair({
  storyId,
  generatedAt = new Date().toISOString(),
  footageInventory = {},
  rightsLedger = {},
} = {}) {
  const existing = approvedRightsFamilies(rightsLedger);
  const clips = collectLocalMotionClips({ storyId, footageInventory });
  const records = [];
  const seen = new Set();
  for (const clip of clips) {
    const family = sourceFamily(clip);
    if (!family || existing.has(family) || seen.has(family) || !sourceSafeDirectMotion(clip)) continue;
    seen.add(family);
    records.push({
      asset_id: `${safeFileStem(storyId)}_footage_empire_v2_${safeFileStem(family)}`,
      asset_type: "official_direct_video_motion",
      path: clipPath(clip) || null,
      source_url: sourceUrl(clip),
      source_owner: clean(clip.source_owner || clip.provider || clip.publisher || "official_source"),
      source_type: clean(clip.source_type || clip.source_url_kind || "official_direct_media"),
      source_family: family,
      media_kind: clean(clip.media_kind || "direct_video"),
      licence_basis: clean(clip.rights_basis || clip.licence_basis || "official_direct_media"),
      allowed_use: "finished_editorial_video_only",
      allowed_platforms: [
        "youtube_shorts",
        "tiktok",
        "instagram_reels",
        "facebook_reels",
        "x",
        "threads",
        "pinterest",
      ],
      commercial_use_allowed: true,
      transformation_notes:
        "Source-safe direct motion family used as short-form editorial footage evidence by Footage Empire v2.",
      credit_required: false,
      evidence_reference: clean(clip.id || clip.segment_id || clip.source_url || family),
      rights_risk_class: "official_direct_media_editorial_use",
      approval_status: "approved_for_transformative_editorial_use",
      generated_by: "footage_empire_v2_rights_repair",
      generated_at: generatedAt,
      db_mutation_required: false,
      external_posting_risk: false,
    });
  }
  return {
    story_id: clean(storyId),
    generated_at: generatedAt,
    records_to_add: records,
    record_count: records.length,
    safety: {
      proof_file_repair_only: true,
      db_mutation_required: false,
      external_posting_risk: false,
      oauth_or_token_mutation: false,
    },
  };
}

function mergeRightsRecords(existingRows = [], recordsToAdd = []) {
  const output = [];
  const seen = new Set();
  for (const row of [...asArray(existingRows), ...asArray(recordsToAdd)]) {
    if (!row || typeof row !== "object") continue;
    const key = sourceFamily(row) || clean(row.asset_id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function applyRightsLedgerRepair(rightsLedger = {}, repair = {}) {
  const currentRecords = [
    ...asArray(rightsLedger.records),
    ...asArray(rightsLedger.rights_ledger),
    ...asArray(rightsLedger.rights_records),
  ];
  const merged = mergeRightsRecords(currentRecords, repair.records_to_add);
  return {
    ...rightsLedger,
    verdict: rightsLedger.verdict || "pass",
    failures: asArray(rightsLedger.failures),
    warnings: asArray(rightsLedger.warnings),
    records: merged,
    footage_empire_v2_rights_repair: {
      repaired_at: repair.generated_at || new Date().toISOString(),
      strategy: "promote_source_safe_direct_motion_families_to_explicit_rights_records",
      records_added: Math.max(0, merged.length - currentRecords.length),
      proof_file_repair_only: true,
      db_mutation_required: false,
      external_posting_risk: false,
    },
  };
}

function buildRightsCoverage({ acceptedClips = [], rightsLedger = {} } = {}) {
  const families = [...new Set(asArray(acceptedClips).map(sourceFamily).filter(Boolean))];
  const approved = approvedRightsFamilies(rightsLedger);
  const missing = families.filter((family) => !approved.has(family));
  return {
    verdict: missing.length ? "fail" : "pass",
    motion_family_count: families.length,
    approved_family_count: families.length - missing.length,
    missing_families: missing,
    blockers: missing.length ? ["rights_coverage_missing_for_motion_families"] : [],
  };
}

function clipMatchKey(row = {}) {
  return `${sourceFamily(row)}|${clipPath(row)}`;
}

function storyTrustedCandidateCount(report = {}, id) {
  return asArray(report.story_candidates).filter((candidate) => {
    const rowStoryId = clean(candidate.story_id || candidate.storyId);
    return !id || !rowStoryId || rowStoryId === id;
  }).length;
}

function scoreFootageEmpireStory({
  story = {},
  canonicalManifest = {},
  footageInventory = {},
  rightsLedger = {},
  trustedFootageReport = {},
  segmentValidationReport = {},
} = {}) {
  const id = storyId(story) || clean(canonicalManifest.story_id);
  const enrichedStory = {
    ...story,
    id,
    title: clean(story.title || canonicalManifest.selected_title || canonicalManifest.canonical_title),
    full_script: clean(story.full_script || story.tts_script || canonicalManifest.narration_script),
    canonical_subject: clean(canonicalManifest.canonical_subject || story.canonical_subject),
    canonical_game: clean(canonicalManifest.canonical_game || story.canonical_game),
    source_card_label: clean(canonicalManifest.source_card_label || canonicalManifest.primary_source || story.source_card_label),
  };
  const localMotionClips = collectLocalMotionClips({
    storyId: id,
    footageInventory,
    segmentValidationReport,
  });
  const plan = buildFootageEmpirePlan({
    story: enrichedStory,
    trustedFootageReport,
    localMotionClips,
  });
  const acceptedClips = plan.motion_inventory?.accepted_local_clips || [];
  const passedSegmentClipKeys = new Set(
    localMotionClips
      .filter((clip) => clip.segmentValidationPassed === true)
      .map(clipMatchKey)
      .filter((key) => key !== "|"),
  );
  const rightsCoverage = buildRightsCoverage({ acceptedClips, rightsLedger });
  const trustedCandidateCount = storyTrustedCandidateCount(trustedFootageReport, id);
  const blockers = [];
  const warnings = [];

  if (plan.readiness?.status !== "v4_motion_ready") {
    blockers.push(...asArray(plan.readiness?.blockers));
  }
  if (trustedCandidateCount > 0 && Number(plan.trusted_source_pipeline?.references_found || 0) === 0) {
    blockers.push("trusted_footage_story_mismatch_or_missing");
  }
  blockers.push(...rightsCoverage.blockers);

  const validatedSegments = acceptedClips.filter((clip) => passedSegmentClipKeys.has(clipMatchKey(clip)));
  if (acceptedClips.length && validatedSegments.length === 0) {
    warnings.push("no_segment_validation_passed_motion_windows");
  }

  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  const uniqueWarnings = [...new Set(warnings.filter(Boolean))];
  const verdict = uniqueBlockers.length ? "red" : uniqueWarnings.length ? "amber" : "green";

  return {
    story_id: id,
    title: enrichedStory.title,
    canonical_subject: enrichedStory.canonical_subject || enrichedStory.canonical_game || null,
    verdict,
    motion: {
      ready: plan.readiness?.status === "v4_motion_ready",
      status: plan.readiness?.status || "unknown",
      available_motion_clips: plan.motion_budget?.available_motion_clips || 0,
      required_motion_scenes: plan.motion_budget?.required_motion_scenes || 0,
      available_distinct_families: plan.motion_budget?.available_distinct_families || 0,
      required_distinct_families: plan.motion_budget?.required_distinct_families || 0,
      distinct_source_families: plan.motion_inventory?.distinct_source_families || [],
    },
    trusted_sources: {
      story_candidate_count: trustedCandidateCount,
      references_found: plan.trusted_source_pipeline?.references_found || 0,
      intake_queue_count: plan.trusted_source_pipeline?.intake_queue?.length || 0,
      distinct_reference_families:
        plan.trusted_source_pipeline?.distinct_reference_families || [],
    },
    segment_validation: {
      validated_segment_count: validatedSegments.length,
      accepted_clip_count: acceptedClips.length,
      families: [...new Set(validatedSegments.map(sourceFamily).filter(Boolean))],
    },
    rights_coverage: rightsCoverage,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    plan,
    next_action: uniqueBlockers.length
      ? "repair_footage_empire_v2_blockers_before_publish"
      : uniqueWarnings.length
        ? "review_footage_empire_warnings"
        : "footage_empire_ready",
  };
}

function buildRepairBacklog(rows) {
  return asArray(rows)
    .filter((row) => row.verdict !== "green")
    .map((row) => ({
      story_id: row.story_id,
      blocker_type: "footage_empire_v2",
      severity: row.verdict === "red" ? "high" : "medium",
      blockers: row.blockers,
      warnings: row.warnings,
      recommended_command: `npm run ops:footage-empire-v2 -- --story-id ${row.story_id}`,
      expected_output:
        "Official/source-safe motion families, segment validation evidence and rights coverage for every renderable motion source.",
      db_mutation_required: false,
      external_posting_risk: false,
      operator_approval_required: row.verdict === "amber",
      post_repair_validation_command: "npm run ops:footage-empire-v2 -- --json",
    }));
}

function buildFootageEmpireV2Report({
  generatedAt = new Date().toISOString(),
  candidates = [],
  canonicalManifests = {},
  footageInventories = {},
  rightsLedgers = {},
  trustedFootageReport = {},
  segmentValidationReport = {},
} = {}) {
  const rows = asArray(candidates).map((story) => {
    const id = storyId(story);
    return scoreFootageEmpireStory({
      story,
      canonicalManifest: canonicalManifests[id] || {},
      footageInventory: footageInventories[id] || {},
      rightsLedger: rightsLedgers[id] || {},
      trustedFootageReport,
      segmentValidationReport,
    });
  });
  const green = rows.filter((row) => row.verdict === "green").length;
  const amber = rows.filter((row) => row.verdict === "amber").length;
  const red = rows.filter((row) => row.verdict === "red").length;
  const verdict = red ? "red" : amber ? "amber" : "green";
  const repairBacklog = buildRepairBacklog(rows);

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "read_only_footage_empire_v2",
    verdict,
    summary: {
      story_count: rows.length,
      green_story_count: green,
      amber_story_count: amber,
      red_story_count: red,
      repair_backlog_count: repairBacklog.length,
      total_validated_segments: rows.reduce((sum, row) => sum + row.segment_validation.validated_segment_count, 0),
      total_distinct_motion_families: rows.reduce((sum, row) => sum + row.motion.available_distinct_families, 0),
    },
    rows,
    source_family_scorecard: rows.map((row) => ({
      story_id: row.story_id,
      verdict: row.verdict,
      available_motion_clips: row.motion.available_motion_clips,
      available_distinct_families: row.motion.available_distinct_families,
      validated_segment_count: row.segment_validation.validated_segment_count,
      rights_verdict: row.rights_coverage.verdict,
      trusted_references_found: row.trusted_sources.references_found,
      blockers: row.blockers,
    })),
    repair_backlog: repairBacklog,
    safety: {
      read_only: true,
      no_downloads_started: true,
      no_frame_extraction_started: true,
      no_upload_or_posting_action: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
    },
    next_action:
      verdict === "green"
        ? "enforce_footage_empire_v2_gate_in_readiness"
        : "repair_footage_empire_v2_backlog_before_publish_scaleup",
  };
}

function formatFootageEmpireV2Markdown(report = {}) {
  const lines = [];
  lines.push("# Footage Empire v2");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Verdict: ${String(report.verdict || "unknown").toUpperCase()}`);
  lines.push(`Stories: ${report.summary?.story_count || 0}`);
  lines.push(`Green: ${report.summary?.green_story_count || 0}`);
  lines.push(`Amber: ${report.summary?.amber_story_count || 0}`);
  lines.push(`Red: ${report.summary?.red_story_count || 0}`);
  lines.push(`Validated segments: ${report.summary?.total_validated_segments || 0}`);
  lines.push("");
  lines.push("## Story Scorecard");
  for (const row of asArray(report.rows)) {
    lines.push(`- ${row.story_id}: ${String(row.verdict).toUpperCase()} - ${row.title}`);
    lines.push(
      `  motion ${row.motion.available_motion_clips}/${row.motion.required_motion_scenes}; families ${row.motion.available_distinct_families}/${row.motion.required_distinct_families}; rights ${row.rights_coverage.verdict}`,
    );
    if (row.blockers?.length) lines.push(`  blockers: ${row.blockers.join(", ")}`);
    if (row.warnings?.length) lines.push(`  warnings: ${row.warnings.join(", ")}`);
  }
  if (!asArray(report.rows).length) lines.push("- none");
  lines.push("");
  lines.push("## Repair Backlog");
  for (const item of asArray(report.repair_backlog)) {
    lines.push(`- ${item.story_id}: ${item.blockers.join(", ") || item.warnings.join(", ")}`);
    lines.push(`  command: \`${item.recommended_command}\``);
  }
  if (!asArray(report.repair_backlog).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: read-only; no downloads, frame extraction, DB mutation, posting or token changes.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  applyRightsLedgerRepair,
  buildFootageEmpireV2Report,
  buildRightsLedgerRepair,
  collectLocalMotionClips,
  formatFootageEmpireV2Markdown,
  scoreFootageEmpireStory,
};
