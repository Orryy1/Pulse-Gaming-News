"use strict";

const { normaliseText } = require("../text-hygiene");

const MIN_EXACT_SUBJECT_ASSETS = 4;
const MIN_VALIDATED_CLIP_REFS = 3;
const MIN_VALIDATED_CLIP_SOURCES = 3;
const FLASH_MIN_SECONDS = 61;
const FLASH_MAX_SECONDS = 75;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function mdCell(value) {
  return normaliseText(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(array(values).map((value) => normaliseText(value).trim()).filter(Boolean))];
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

function byStory(items, key = "story_id") {
  const map = new Map();
  for (const item of array(items)) {
    const storyId = item?.[key] || item?.storyId || item?.id;
    if (!storyId) continue;
    map.set(storyId, item);
  }
  return map;
}

function rowsByStory(items) {
  const map = new Map();
  for (const item of array(items)) {
    const storyId = item?.story_id || item?.storyId;
    if (!storyId) continue;
    const rows = map.get(storyId) || [];
    rows.push(item);
    map.set(storyId, rows);
  }
  return map;
}

function audioReady(candidate = {}) {
  const duration = numberValue(candidate.audio?.duration_seconds, null);
  return (
    (candidate.audio?.ready === true || /ready/i.test(String(candidate.audio?.status || ""))) &&
    Number.isFinite(duration) &&
    duration >= FLASH_MIN_SECONDS &&
    duration <= FLASH_MAX_SECONDS
  );
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function storyEntities(candidate = {}, gap = {}, footage = {}) {
  return unique([
    ...array(candidate.visuals?.story_target_entities),
    ...array(candidate.visuals?.exact_subject_groups),
    ...array(gap.motion_gap?.story_entities),
    ...array(footage.story_entities),
  ]);
}

function missingMotionEntities(candidate = {}, gap = {}, footage = {}) {
  return unique([
    ...array(candidate.visuals?.missing_validated_clip_entities),
    ...array(gap.motion_gap?.missing_validated_entities),
    ...array(footage.story_entities).filter(
      (entity) => !array(footage.validated_entities).some((validated) => normaliseText(validated) === normaliseText(entity)),
    ),
  ]);
}

function recommendedCommands(gap = {}, candidate = {}, alternateRows = []) {
  const commands = [];
  if (candidate.recommended_command) {
    commands.push({
      label: "Render local proof",
      command: candidate.recommended_command,
    });
  }
  for (const item of array(gap.recommended_commands)) {
    if (item?.command) commands.push(item);
  }
  for (const row of array(alternateRows)) {
    for (const action of array(row.next_actions)) {
      const match = String(action).match(/(npm run [^`]+)$/);
      if (match?.[1]) {
        commands.push({
          label: `Alternate source for ${row.entity}`,
          command: match[1],
        });
      }
    }
  }

  const seen = new Set();
  return commands.filter((item) => {
    const key = item.command;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classifyCurrentState({ candidate = {}, gap = {}, footage = {}, alternateRows = [] } = {}) {
  const visuals = candidate.visuals || {};
  const exactCount = numberValue(visuals.exact_subject_count ?? gap.motion_gap?.exact_subject_count);
  const clipRefs = numberValue(visuals.validated_clip_ref_count ?? gap.motion_gap?.validated_clip_ref_count);
  const clipSources = numberValue(visuals.validated_clip_source_count ?? gap.motion_gap?.validated_clip_source_count);
  const acceptedFrames = numberValue(visuals.accepted_frame_count ?? gap.motion_gap?.accepted_frame_count);
  const audioDuration = numberValue(candidate.audio?.duration_seconds ?? gap.audio_gap?.duration_seconds, null);
  const hasAudioPath = Boolean(candidate.audio?.output_audio_path || gap.audio_gap?.output_audio_path);
  const audioDurationInRange =
    Number.isFinite(audioDuration) && audioDuration >= FLASH_MIN_SECONDS && audioDuration <= FLASH_MAX_SECONDS;
  const hasAlternateNeed =
    alternateRows.length > 0 ||
    footage.next_best_action === "find_alternate_official_source_or_downgrade_story" ||
    gap.motion_gap?.acquisition_strategy?.status === "alternate_official_sources_required";
  const targetEntities = storyEntities(candidate, gap, footage);
  const hasExactSubjectTarget = targetEntities.length > 0;
  const missingEntities = missingMotionEntities(candidate, gap, footage);
  const blockingDimensions = [];

  if (!audioReady(candidate)) {
    blockingDimensions.push(hasAudioPath && !audioDurationInRange ? "audio_duration" : "audio");
  }
  if (exactCount < MIN_EXACT_SUBJECT_ASSETS) {
    blockingDimensions.push(hasExactSubjectTarget ? "exact_subject_assets" : "format_route");
  }
  if (clipRefs < MIN_VALIDATED_CLIP_REFS || clipSources < MIN_VALIDATED_CLIP_SOURCES || missingEntities.length > 0) {
    blockingDimensions.push("validated_motion");
  }
  if (hasAlternateNeed) blockingDimensions.push("alternate_official_source");
  if (candidate.latest_render_proof?.blocks_fresh_proof || gap.render_recommendation === "repair_then_retest") {
    blockingDimensions.push("forensic_repair");
  }

  let stage = "blocked_unknown";
  let operator_next_action = "inspect_reports";
  if (candidate.verdict === "ready_flash_proof" && blockingDimensions.length === 0) {
    stage = "ready_for_local_flash_proof";
    operator_next_action = "render_local_flash_proof";
  } else if (!audioReady(candidate)) {
    if (hasAudioPath && !audioDurationInRange) {
      stage = "needs_liam_audio_duration_repair";
      operator_next_action = "repair_script_length_or_regenerate_local_liam_audio";
    } else {
      stage = "needs_local_liam_audio";
      operator_next_action = "generate_or_repair_local_liam_audio";
    }
  } else if (!hasExactSubjectTarget && exactCount < MIN_EXACT_SUBJECT_ASSETS) {
    stage = "needs_format_router_decision";
    operator_next_action = "route_to_briefing_or_context_card_lane";
  } else if (exactCount < MIN_EXACT_SUBJECT_ASSETS) {
    stage = "needs_exact_subject_assets";
    operator_next_action = "run_exact_subject_still_acquisition";
  } else if (hasAlternateNeed) {
    stage = "needs_alternate_official_motion_source";
    operator_next_action = "find_non_exhausted_official_motion_source";
  } else if (clipRefs < MIN_VALIDATED_CLIP_REFS || clipSources < MIN_VALIDATED_CLIP_SOURCES || missingEntities.length > 0) {
    stage = "needs_motion_window_validation";
    operator_next_action = "validate_more_official_gameplay_windows";
  } else if (blockingDimensions.includes("forensic_repair")) {
    stage = "needs_forensic_repair";
    operator_next_action = "repair_latest_local_render_proof";
  }

  return {
    stage,
    operator_next_action,
    blocking_dimensions: unique(blockingDimensions),
    distance_to_local_proof:
      blockingDimensions.length === 0
        ? "ready"
        : blockingDimensions.length === 1
          ? "one_blocker"
          : blockingDimensions.length === 2
            ? "two_blockers"
            : "hard_blocked",
    exact_subject_count: exactCount,
    accepted_frame_count: acceptedFrames,
    validated_clip_ref_count: clipRefs,
    validated_clip_source_count: clipSources,
    missing_motion_entities: missingEntities,
  };
}

function buildCurrentStateRow({ candidate = {}, gap = {}, footage = {}, alternateRows = [] } = {}) {
  const state = classifyCurrentState({ candidate, gap, footage, alternateRows });
  const alternateEntities = unique(alternateRows.map((row) => row.entity));
  const topAlternateSearches = alternateRows
    .flatMap((row) => array(row.planned_searches).map((search) => search.query))
    .filter(Boolean)
    .slice(0, 6);
  const commands = state.stage === "needs_format_router_decision" ? [] : recommendedCommands(gap, candidate, alternateRows).slice(0, 8);

  return {
    story_id: candidate.story_id || gap.story_id || footage.story_id || alternateRows[0]?.story_id || null,
    title: normaliseText(candidate.title || gap.title || footage.title || alternateRows[0]?.title || ""),
    priority: numberValue(candidate.priority),
    candidate_verdict: candidate.verdict || gap.candidate_verdict || "unknown",
    stage: state.stage,
    operator_next_action: state.operator_next_action,
    distance_to_local_proof: state.distance_to_local_proof,
    blocking_dimensions: state.blocking_dimensions,
    audio: {
      status: candidate.audio?.status || gap.audio_gap?.status || "unknown",
      ready: audioReady(candidate),
      duration_seconds: numberValue(candidate.audio?.duration_seconds ?? gap.audio_gap?.duration_seconds, null),
      output_audio_path: candidate.audio?.output_audio_path || gap.audio_gap?.output_audio_path || null,
    },
    visuals: {
      exact_subject_count: state.exact_subject_count,
      exact_subject_groups: unique(candidate.visuals?.exact_subject_groups),
      story_entities: storyEntities(candidate, gap, footage),
      accepted_frame_count: state.accepted_frame_count,
      validated_clip_ref_count: state.validated_clip_ref_count,
      validated_clip_source_count: state.validated_clip_source_count,
      validated_entities: unique([
        ...array(candidate.visuals?.validated_clip_entities),
        ...array(gap.motion_gap?.validated_entities),
        ...array(footage.validated_entities),
      ]),
      missing_motion_entities: state.missing_motion_entities,
    },
    acquisition: {
      footage_verdict: footage.verdict || "unknown",
      footage_next_best_action: footage.next_best_action || null,
      alternate_source_entities: alternateEntities,
      alternate_source_blockers: unique(alternateRows.map((row) => row.blocker)),
      top_rejection_reasons: unique([
        ...alternateRows.map((row) => row.top_rejection_reason),
        ...Object.keys(gap.motion_gap?.rejection_reasons || {}),
      ]).slice(0, 8),
      planned_searches: topAlternateSearches,
    },
    recommended_commands: commands,
  };
}

function buildFlashLaneCurrentStateReport({
  proofCandidateReport = {},
  motionGapReport = {},
  footageAcquisitionReport = {},
  alternateSourceReport = {},
  storyId = null,
  limit = 20,
} = {}) {
  const gapByStory = byStory(motionGapReport.gaps);
  const footageByStory = byStory(footageAcquisitionReport.stories);
  const alternateByStory = rowsByStory(alternateSourceReport.rows);
  const candidates = array(proofCandidateReport.candidates)
    .filter((candidate) => !storyId || candidate.story_id === storyId)
    .slice(0, Math.max(1, Number(limit) || 20));

  const rows = candidates.map((candidate) => {
    const id = candidate.story_id;
    return buildCurrentStateRow({
      candidate,
      gap: gapByStory.get(id) || {},
      footage: footageByStory.get(id) || {},
      alternateRows: alternateByStory.get(id) || [],
    });
  });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    summary: {
      candidates_considered: rows.length,
      stage_frequency: countBy(rows, (row) => row.stage),
      distance_frequency: countBy(rows, (row) => row.distance_to_local_proof),
      ready_for_local_flash_proof: rows.filter((row) => row.stage === "ready_for_local_flash_proof").length,
      needs_local_liam_audio: rows.filter((row) => row.stage === "needs_local_liam_audio").length,
      needs_liam_audio_duration_repair: rows.filter((row) => row.stage === "needs_liam_audio_duration_repair").length,
      needs_format_router_decision: rows.filter((row) => row.stage === "needs_format_router_decision").length,
      needs_exact_subject_assets: rows.filter((row) => row.stage === "needs_exact_subject_assets").length,
      needs_motion_window_validation: rows.filter((row) => row.stage === "needs_motion_window_validation").length,
      needs_alternate_official_motion_source: rows.filter(
        (row) => row.stage === "needs_alternate_official_motion_source",
      ).length,
      top_story_id: rows[0]?.story_id || null,
    },
    rows,
    safety: {
      local_only: true,
      report_only: true,
      renders_video: false,
      calls_tts: false,
      downloads_media: false,
      posts_to_platforms: false,
      mutates_db: false,
      touches_railway: false,
      triggers_oauth: false,
      switches_production_renderer: false,
    },
  };
}

function renderFlashLaneCurrentStateMarkdown(report = {}) {
  const lines = [
    "# Flash Lane Current State",
    "",
    "Read-only control report. No Railway, OAuth, production DB, render default, TTS or social posting changes.",
    "",
    "## Summary",
    "",
    `- Candidates considered: ${report.summary?.candidates_considered || 0}`,
    `- Ready for local Flash proof: ${report.summary?.ready_for_local_flash_proof || 0}`,
    `- Need local Liam audio: ${report.summary?.needs_local_liam_audio || 0}`,
    `- Need Liam audio duration repair: ${report.summary?.needs_liam_audio_duration_repair || 0}`,
    `- Need format router decision: ${report.summary?.needs_format_router_decision || 0}`,
    `- Need exact subject assets: ${report.summary?.needs_exact_subject_assets || 0}`,
    `- Need motion validation: ${report.summary?.needs_motion_window_validation || 0}`,
    `- Need alternate official motion source: ${report.summary?.needs_alternate_official_motion_source || 0}`,
    "",
    "## Current Queue",
    "",
    "| Story | Stage | Distance | Audio | Exact | Clips | Missing motion entities | Next action |",
    "| --- | --- | --- | --- | ---: | ---: | --- | --- |",
  ];

  for (const row of array(report.rows)) {
    const audio = row.audio?.ready
      ? `ready ${row.audio.duration_seconds ? `${Number(row.audio.duration_seconds).toFixed(1)}s` : ""}`.trim()
      : row.audio?.status || "unknown";
    lines.push(
      `| ${mdCell(`${row.story_id}: ${row.title}`)} | ${mdCell(row.stage)} | ${mdCell(row.distance_to_local_proof)} | ${mdCell(audio)} | ${row.visuals?.exact_subject_count || 0} | ${row.visuals?.validated_clip_ref_count || 0}/${row.visuals?.validated_clip_source_count || 0} | ${mdCell(array(row.visuals?.missing_motion_entities).join(", ") || "none")} | ${mdCell(row.operator_next_action)} |`,
    );
  }

  lines.push("", "## Next Commands", "");
  for (const row of array(report.rows).slice(0, 8)) {
    lines.push(`### ${row.story_id}`);
    if (!array(row.recommended_commands).length) {
      lines.push("- No safe render command yet. Work the blocker above first.");
    } else {
      for (const item of row.recommended_commands.slice(0, 3)) {
        lines.push(`- ${mdCell(item.label || "Command")}: \`${item.command}\``);
      }
    }
    if (array(row.acquisition?.planned_searches).length) {
      lines.push(`- Search targets: ${row.acquisition.planned_searches.map(mdCell).join("; ")}`);
    }
    lines.push("");
  }

  lines.push(
    "## Safety",
    "",
    "- Report-only and local-only.",
    "- Does not download media, render video, call TTS, post, mutate the DB, touch Railway or trigger OAuth.",
    "- Use this report to decide the next local acquisition/validation step before any new Studio V2 proof render.",
    "",
  );

  return lines.join("\n");
}

module.exports = {
  buildFlashLaneCurrentStateReport,
  renderFlashLaneCurrentStateMarkdown,
  classifyCurrentState,
};
