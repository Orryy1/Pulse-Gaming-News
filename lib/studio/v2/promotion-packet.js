"use strict";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return value === true;
}

function formatTime(value) {
  const num = safeNumber(value, null);
  return num === null ? null : `${Number(num.toFixed(2))}s`;
}

function summariseForensicWarnings(forensicReport = {}) {
  const issues = asArray(forensicReport.issues);
  const visual = forensicReport.visual || {};
  const taste = visual.taste || {};
  const repeatPairs = asArray(visual.repeatPairs);
  const badFrames = asArray(taste.badFrames);
  const repeatPairTimes = repeatPairs
    .map((pair) => {
      const a = formatTime(pair.aTimeS);
      const b = formatTime(pair.bTimeS);
      return a && b ? `${a}/${b}` : null;
    })
    .filter(Boolean);
  const weakFrameTimes = badFrames
    .map((frame) => {
      const time = formatTime(frame.timeS);
      const reason = frame.reason || "weak_frame";
      return time ? `${time} ${reason}` : reason;
    })
    .filter(Boolean);
  const issueCodes = issues.map((issue) => issue.code).filter(Boolean);

  return {
    issue_codes: [...new Set(issueCodes)],
    repeat_pair_count: safeNumber(visual.repeatPairCount),
    repeat_pair_times: repeatPairTimes,
    weak_frame_count: safeNumber(taste.badFrameCount),
    weak_frame_times: weakFrameTimes,
    rating_or_title_frame_count: safeNumber(taste.ratingOrTitleFrameCount),
  };
}

function safetyBoundaryPassed(safety = {}) {
  return (
    bool(safety.local_only) &&
    !bool(safety.railway_mutated) &&
    !bool(safety.production_db_mutated) &&
    !bool(safety.oauth_triggered) &&
    !bool(safety.posted_to_platforms) &&
    !bool(safety.production_render_default_changed)
  );
}

function summariseSegmentValidation(segmentValidationReport = {}, storyId = null) {
  const segments = asArray(segmentValidationReport.segments).filter((segment) => {
    const segmentStoryId = segment.story_id || segment.storyId || segment.clip?.storyId || null;
    return !storyId || !segmentStoryId || segmentStoryId === storyId;
  });
  const validated = segments.filter(
    (segment) => segment.segment_validated === true && segment.allowed_for_flash_lane === true,
  );
  return {
    available: !!segmentValidationReport && asArray(segmentValidationReport.segments).length > 0,
    generated_at: segmentValidationReport.generated_at || null,
    total_segments: segments.length,
    validated_clip_refs: validated.length,
    validated_clip_sources: new Set(validated.map((segment) => segment.source_url).filter(Boolean)).size,
    validated_clip_entities: new Set(validated.map((segment) => segment.entity).filter(Boolean)).size,
    rejected_segments: segments.filter((segment) => segment.segment_validated !== true).length,
  };
}

function buildStudioV2PromotionPacket({
  stillDeckReport = {},
  qaReport = {},
  forensicComparison = null,
  forensicReport = null,
  segmentValidationReport = null,
  now = new Date().toISOString(),
} = {}) {
  const qaVerdict = qaReport?.verdict || {};
  const qaLane = qaVerdict.lane || "unknown";
  const renderPreflight = stillDeckReport.render_preflight || {};
  const renderPreflightBlockers = asArray(renderPreflight.blockers);
  const renderPreflightWarnings = asArray(renderPreflight.warnings);
  const judgement = stillDeckReport.judgement || {};
  const motion = stillDeckReport.motion || {};
  const narration = stillDeckReport.narration || {};
  const qaAuto = qaReport.auto || {};
  const comparison = forensicComparison || stillDeckReport.comparison || {};
  const after = comparison.after || {};
  const safety = stillDeckReport.safety || {};
  const forensicWarningDetails = summariseForensicWarnings(forensicReport || {});
  const segmentValidation = summariseSegmentValidation(
    segmentValidationReport || {},
    stillDeckReport.story_id || null,
  );
  const blockers = [];
  const warnings = [];

  if (!safetyBoundaryPassed(safety)) blockers.push("proof_safety_boundary_failed");
  if (qaLane !== "pass") blockers.push(`qa_lane_${qaLane}`);
  if (renderPreflight.verdict && renderPreflight.verdict !== "allow") {
    blockers.push("flash_lane_preflight_not_allowed");
  }
  if (renderPreflightBlockers.length) {
    blockers.push(...renderPreflightBlockers.map((item) => `preflight_${item}`));
  }
  if (safeNumber(after.failCount) > 0) blockers.push("forensic_failures_remaining");
  if (safeNumber(after.warnCount) > 0) blockers.push("forensic_warnings_remaining");
  if (safeNumber(after.visualRepeatPairs) > 0) blockers.push("visual_repeat_pairs_remaining");
  if (safeNumber(forensicWarningDetails.repeat_pair_count) > 0) {
    blockers.push("visual_repeat_pairs_remaining");
  }
  if (safeNumber(forensicWarningDetails.weak_frame_count) > 0) {
    blockers.push("weak_rendered_frames_remaining");
  }
  if (safeNumber(forensicWarningDetails.rating_or_title_frame_count) > 0) {
    blockers.push("rating_or_title_frames_remaining");
  }
  if (judgement.studio_v2_suitability !== "studio_v2_60s_candidate_local_proof") {
    blockers.push("not_a_60s_local_proof_candidate");
  }
  if (!narration.enriched_audio_path) blockers.push("missing_real_narration_audio");
  if (safeNumber(motion.official_clip_refs_used) < 3) warnings.push("thin_official_clip_reference_count");
  if (segmentValidation.available) {
    if (segmentValidation.validated_clip_refs < 3) blockers.push("current_segment_validation_insufficient");
    if (segmentValidation.validated_clip_sources < 3) {
      blockers.push("current_segment_source_diversity_insufficient");
    }
  }
  if (safeNumber(motion.official_trailer_frames_used) < 3) warnings.push("thin_official_frame_count");
  if (renderPreflightWarnings.length) {
    warnings.push(...renderPreflightWarnings.map((item) => `preflight_${item}`));
  }

  const runtimeS =
    safeNumber(qaReport?.runtime?.durationS, null) ??
    safeNumber(renderPreflight?.metrics?.narrationDurationS, null) ??
    safeNumber(narration.durationS, null);
  const runtimeOk = runtimeS === null ? false : runtimeS >= 61 && runtimeS <= 75;
  if (!runtimeOk) blockers.push("runtime_outside_61_75s");

  const voiceGrade = qaAuto.voicePathUsed?.grade || "unknown";
  const voiceValue = qaAuto.voicePathUsed?.value || narration.enriched_source || "unknown";
  if (voiceGrade !== "green") blockers.push(`voice_grade_${voiceGrade}`);

  const localProofReady =
    blockers.length === 0 &&
    judgement.visual_output === "improved" &&
    qaLane === "pass" &&
    runtimeOk &&
    safetyBoundaryPassed(safety);

  const verdict = blockers.length ? "RED_BLOCKED" : "AMBER_LOCAL_PROOF";
  const morningApprovalNeeded = localProofReady;
  const productionReady = false;
  const recommendation = localProofReady
    ? "Queue a morning decision for a one-story Studio V2 pilot; do not switch production defaults."
    : "Do not pilot Studio V2 yet; fix blockers and regenerate the local proof packet.";

  return {
    schema_version: 1,
    generated_at: now,
    story_id: stillDeckReport.story_id || "unknown",
    title: stillDeckReport.title || "unknown",
    verdict,
    production_ready: productionReady,
    morning_approval_needed: morningApprovalNeeded,
    recommendation,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    forensic_warning_details: forensicWarningDetails,
    evidence: {
      mp4: stillDeckReport.renders?.enriched?.mp4 || null,
      contact_sheet:
        asArray(stillDeckReport.artefacts).find((item) => /enriched contact sheet/i.test(item.label))
          ?.path || null,
      qa_json: stillDeckReport.renders?.enriched?.qa || null,
      forensic_json: stillDeckReport.renders?.enriched?.forensic?.jsonPath || null,
      forensic_md: stillDeckReport.renders?.enriched?.forensic?.markdownPath || null,
      media_package: stillDeckReport.enriched_media?.package || null,
      frame_report: stillDeckReport.frame_report_path || null,
      segment_validation_report: stillDeckReport.segment_validation_report_path || null,
    },
    metrics: {
      runtime_s: runtimeS,
      qa_lane: qaLane,
      qa_green_hits: safeNumber(qaVerdict.greenHits),
      qa_amber_trips: safeNumber(qaVerdict.amberTrips),
      qa_red_trips: safeNumber(qaVerdict.redTrips),
      voice_grade: voiceGrade,
      voice_value: voiceValue,
      official_clip_refs_used: safeNumber(motion.official_clip_refs_used),
      official_trailer_frames_used: safeNumber(motion.official_trailer_frames_used),
      current_validated_clip_refs: segmentValidation.available
        ? segmentValidation.validated_clip_refs
        : null,
      current_validated_clip_sources: segmentValidation.available
        ? segmentValidation.validated_clip_sources
        : null,
      current_validated_clip_entities: segmentValidation.available
        ? segmentValidation.validated_clip_entities
        : null,
      current_segment_rejected_count: segmentValidation.available
        ? segmentValidation.rejected_segments
        : null,
      forensic_verdict: after.verdict || comparison.verdict || "unknown",
      forensic_fail_count: safeNumber(after.failCount),
      forensic_warn_count: safeNumber(after.warnCount),
      visual_repeat_pairs_after: safeNumber(after.visualRepeatPairs),
      visual_repeat_pairs_delta: safeNumber(comparison.deltas?.visualRepeatPairs),
      source_diversity_unique_sources: safeNumber(qaAuto.sourceDiversity?.uniqueSources),
      clip_dominance: safeNumber(qaAuto.clipDominance?.value),
      caption_gap_count: safeNumber(qaAuto.captionGapsOver2s?.value),
      rendered_duration_s: safeNumber(qaAuto.durationIntegrity?.renderedDurationS, runtimeS),
      audio_duration_s: safeNumber(qaAuto.durationIntegrity?.audioDurationS, narration.durationS),
    },
    safety: {
      ...safety,
      production_renderer_switch_allowed: false,
      production_publish_allowed: false,
      railway_change_allowed: false,
      oauth_change_allowed: false,
    },
    proposed_pilot_plan: {
      mode: "manual_approval_only",
      scope: "one story only",
      production_default_change: false,
      hard_gate_change: false,
      required_before_live:
        "Martin approves the specific story, MP4, contact sheet, QA JSON and rollback plan in plain English.",
      rollback: "Keep legacy assemble.js as canonical; if pilot underperforms or fails, publish via existing legacy path and do not set any Studio V2 production flag.",
    },
  };
}

function lineValue(value) {
  return value === null || value === undefined || value === "" ? "unknown" : value;
}

function renderStudioV2PromotionPacketMarkdown(packet) {
  const evidence = packet.evidence || {};
  const metrics = packet.metrics || {};
  const blockers = asArray(packet.blockers);
  const warnings = asArray(packet.warnings);
  const forensicWarningDetails = packet.forensic_warning_details || {};
  const lines = [
    "# Studio V2 Overnight Promotion Packet",
    "",
    `Generated: ${packet.generated_at}`,
    `Story: \`${packet.story_id}\``,
    `Title: ${packet.title}`,
    "",
    "## Verdict",
    "",
    `\`${packet.verdict}\` - ${packet.recommendation}`,
    "",
    `Production ready: \`${packet.production_ready ? "yes" : "no"}\``,
    `Morning approval needed: \`${packet.morning_approval_needed ? "yes" : "no"}\``,
    "",
  ];

  if (blockers.length) {
    lines.push("## Blockers", "");
    for (const blocker of blockers) lines.push(`- ${blocker}`);
    lines.push("");
  }

  if (warnings.length) {
    lines.push("## Warnings", "");
    for (const warning of warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  const hasForensicDetails =
    asArray(forensicWarningDetails.issue_codes).length ||
    safeNumber(forensicWarningDetails.repeat_pair_count) > 0 ||
    safeNumber(forensicWarningDetails.weak_frame_count) > 0;
  if (hasForensicDetails) {
    lines.push("## Forensic Warning Details", "");
    lines.push(
      `- Issue codes: ${asArray(forensicWarningDetails.issue_codes).join(", ") || "unknown"}`,
    );
    lines.push(`- Repeat pair count: ${lineValue(forensicWarningDetails.repeat_pair_count)}`);
    if (asArray(forensicWarningDetails.repeat_pair_times).length) {
      lines.push(`- Repeat pair times: ${forensicWarningDetails.repeat_pair_times.join(", ")}`);
    }
    lines.push(`- Weak rendered frame count: ${lineValue(forensicWarningDetails.weak_frame_count)}`);
    if (asArray(forensicWarningDetails.weak_frame_times).length) {
      lines.push(`- Weak rendered frames: ${forensicWarningDetails.weak_frame_times.join(", ")}`);
    }
    lines.push(
      `- Rating/title frame count: ${lineValue(forensicWarningDetails.rating_or_title_frame_count)}`,
    );
    lines.push("");
  }

  lines.push(
    "## Evidence",
    "",
    `- MP4: \`${lineValue(evidence.mp4)}\``,
    `- Contact sheet: \`${lineValue(evidence.contact_sheet)}\``,
    `- QA JSON: \`${lineValue(evidence.qa_json)}\``,
    `- Forensic JSON: \`${lineValue(evidence.forensic_json)}\``,
    `- Forensic Markdown: \`${lineValue(evidence.forensic_md)}\``,
    `- Media package: \`${lineValue(evidence.media_package)}\``,
    `- Frame report: \`${lineValue(evidence.frame_report)}\``,
    `- Segment validation report: \`${lineValue(evidence.segment_validation_report)}\``,
    "",
    "## Metrics",
    "",
    "| Check | Value |",
    "| --- | ---: |",
    `| Runtime | ${lineValue(metrics.runtime_s)}s |`,
    `| QA lane | ${lineValue(metrics.qa_lane)} |`,
    `| QA green / amber / red | ${lineValue(metrics.qa_green_hits)} / ${lineValue(metrics.qa_amber_trips)} / ${lineValue(metrics.qa_red_trips)} |`,
    `| Voice | ${lineValue(metrics.voice_value)} (${lineValue(metrics.voice_grade)}) |`,
    `| Official clip refs | ${lineValue(metrics.official_clip_refs_used)} |`,
    `| Official trailer frames | ${lineValue(metrics.official_trailer_frames_used)} |`,
    `| Current validated clip refs | ${lineValue(metrics.current_validated_clip_refs)} |`,
    `| Current validated clip sources | ${lineValue(metrics.current_validated_clip_sources)} |`,
    `| Current validated clip entities | ${lineValue(metrics.current_validated_clip_entities)} |`,
    `| Current segment rejections | ${lineValue(metrics.current_segment_rejected_count)} |`,
    `| Forensic verdict | ${lineValue(metrics.forensic_verdict)} |`,
    `| Forensic fails / warns | ${lineValue(metrics.forensic_fail_count)} / ${lineValue(metrics.forensic_warn_count)} |`,
    `| Visual repeat pairs after | ${lineValue(metrics.visual_repeat_pairs_after)} |`,
    `| Visual repeat pairs delta | ${lineValue(metrics.visual_repeat_pairs_delta)} |`,
    `| Unique scene sources | ${lineValue(metrics.source_diversity_unique_sources)} |`,
    `| Clip dominance | ${lineValue(metrics.clip_dominance)} |`,
    `| Caption gaps over 2s | ${lineValue(metrics.caption_gap_count)} |`,
    "",
    "## Proposed Pilot Plan",
    "",
    "- Do not switch production renderer.",
    "- Do not change Railway env vars.",
    "- Do not enable hard production gates.",
    "- Do not publish automatically.",
  );

  if (blockers.length) {
    lines.push(
      "- No Studio V2 pilot should be run until blockers are fixed and a clean packet is regenerated.",
    );
  } else {
    lines.push(
      "- If Martin approves, use this as a one-story manual Studio V2 pilot candidate only.",
    );
  }

  lines.push(
    "- Keep legacy `assemble.js` as the rollback path.",
    "",
    "## Rollback",
    "",
    packet.proposed_pilot_plan?.rollback ||
      "Keep the current legacy renderer and do not set any Studio V2 production flag.",
    "",
    "## Safety Boundaries",
    "",
    "- Local-only report.",
    "- No Railway mutation.",
    "- No OAuth trigger.",
    "- No production DB mutation.",
    "- No platform post.",
    "- No production render default change.",
  );

  if (!blockers.length) {
    lines.push("- Add the pilot decision to `MORNING_APPROVAL_QUEUE.md` before any live action.");
  } else {
    lines.push("- Keep the blocked proof out of the live approval queue until it is clean.");
  }

  lines.push("");

  return lines.join("\n");
}

module.exports = {
  buildStudioV2PromotionPacket,
  renderStudioV2PromotionPacketMarkdown,
  summariseSegmentValidation,
  summariseForensicWarnings,
  safetyBoundaryPassed,
};
