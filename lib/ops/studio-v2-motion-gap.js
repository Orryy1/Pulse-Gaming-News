"use strict";

const DEFAULT_MIN_VALIDATED_CLIP_REFS = 3;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(items) {
  return [...new Set(array(items).map((item) => String(item || "").trim()).filter(Boolean))];
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

function segmentValidated(segment = {}) {
  return (
    segment.allowed_for_flash_lane === true ||
    (segment.segment_validated === true && String(segment.status || "").toLowerCase() === "validated")
  );
}

function segmentRejected(segment = {}) {
  return !segmentValidated(segment);
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
  return {
    total_segments: segments.length,
    validated_segments: validated.length,
    rejected_segments: rejected.length,
    validated_entities: unique(validated.map((segment) => segment.entity)),
    attempted_entities: unique(segments.map((segment) => segment.entity)),
    rejection_reasons: countBy(rejected, (segment) => segment.validation_reason || "unvalidated_segment"),
    rejection_reasons_by_entity: Object.fromEntries(
      unique(rejected.map((segment) => segment.entity)).map((entity) => [
        entity,
        countBy(
          rejected.filter((segment) => String(segment.entity || "") === entity),
          (segment) => segment.validation_reason || "unvalidated_segment",
        ),
      ]),
    ),
  };
}

function candidateStoryEntities(candidate = {}) {
  return unique([
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

function buildSafeCommands(candidate, row) {
  const storyId = candidate.story_id;
  const commands = [];
  if (row.render_recommendation === "ready_for_local_flash_proof" && candidate.recommended_command) {
    commands.push({
      purpose: "run_local_flash_proof",
      command: candidate.recommended_command,
      safety: "local_only_render_proof",
    });
    return commands;
  }

  if (row.motion_gap.needs_more_motion || row.motion_gap.needs_exact_subject_assets) {
    commands.push(
      {
        purpose: "resolve_more_official_trailer_refs",
        command: `npm run media:resolve-trailers -- --story-id ${storyId}`,
        safety: "report_or_local_only",
      },
      {
        purpose: "plan_frame_sampling",
        command: `npm run media:plan-frames -- --story-id ${storyId}`,
        safety: "report_only",
      },
      {
        purpose: "extract_safe_local_frames",
        command: `npm run media:extract-frames -- --story-id ${storyId} --apply-local`,
        safety: "apply_local_under_test_output_only",
      },
      {
        purpose: "validate_gameplay_clip_windows",
        command: `npm run media:validate-trailer-segments -- --story-id ${storyId} --apply-local --deep-scan`,
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
  if (!steps.length) steps.push("ready_for_local_flash_render_preflight");
  return unique(steps);
}

function buildGap(candidate = {}, context = {}) {
  const threshold = context.minValidatedClipRefs || DEFAULT_MIN_VALIDATED_CLIP_REFS;
  const segment = segmentFacts(context.segmentValidationReport, candidate.story_id);
  const storyEntities = candidateStoryEntities(candidate);
  const validatedEntities = unique([
    ...array(candidate.visuals?.validated_clip_entities),
    ...segment.validated_entities,
  ]);
  const missingValidatedEntities = storyEntities.filter((entity) => !validatedEntities.includes(entity));
  const validatedClipRefs = Number(candidate.visuals?.validated_clip_ref_count || segment.validated_segments || 0);
  const validatedClipSources = Number(
    candidate.visuals?.validated_clip_source_count || segment.validated_segments || 0,
  );
  const exactSubjectCount = Number(candidate.visuals?.exact_subject_count || 0);
  const acceptedFrameCount = Number(candidate.visuals?.accepted_frame_count || 0);

  const renderReady = candidate.verdict === "ready_flash_proof";
  const audioGap = {
    status: candidate.audio?.status || "unknown",
    ready: candidate.audio?.ready === true,
    needs_liam_audio: array(candidate.blockers).includes("approved_liam_audio_missing"),
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
    missing_validated_entities: missingValidatedEntities,
    segment_inventory: segment,
    rejection_reasons: segment.rejection_reasons,
    rejection_reasons_by_entity: segment.rejection_reasons_by_entity,
    needs_more_motion:
      array(candidate.blockers).includes("flash_proof_requires_motion_backbone") ||
      array(candidate.blockers).includes("flash_proof_requires_three_validated_clip_refs") ||
      Math.max(0, threshold - validatedClipRefs) > 0 ||
      Math.max(0, threshold - validatedClipSources) > 0,
    needs_exact_subject_assets: array(candidate.blockers).includes("flash_proof_requires_four_exact_subject_assets"),
  };

  const row = {
    story_id: candidate.story_id,
    title: candidate.title || "Untitled",
    candidate_verdict: candidate.verdict || "unknown",
    render_recommendation: renderReady ? "ready_for_local_flash_proof" : "do_not_render_yet",
    blockers: array(candidate.blockers),
    audio_gap: audioGap,
    motion_gap: motionGap,
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
  row.recommended_commands = buildSafeCommands(candidate, row);
  return row;
}

function buildStudioV2MotionGapReport({
  proofCandidateReport = {},
  segmentValidationReport = null,
  storyId = null,
  limit = 10,
} = {}) {
  const threshold = minValidatedClipRefs(proofCandidateReport);
  const candidates = array(proofCandidateReport.candidates)
    .filter((candidate) => !storyId || candidate.story_id === storyId)
    .slice(0, Math.max(1, Number(limit) || 10));
  const gaps = candidates.map((candidate) =>
    buildGap(candidate, {
      segmentValidationReport,
      minValidatedClipRefs: threshold,
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
      blocked_flash_proofs: gaps.filter((gap) => gap.render_recommendation !== "ready_for_local_flash_proof").length,
      closest_story_id: gaps[0]?.story_id || null,
      blocker_frequency: blockerFrequency,
    },
    thresholds: {
      flash_min_validated_clip_refs: threshold,
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
      `- Missing entities: ${gap.motion_gap.missing_validated_entities.join(", ") || "none"}`,
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
