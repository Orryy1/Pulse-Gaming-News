"use strict";

const { normaliseText } = require("../text-hygiene");

function array(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(items) {
  return [...new Set(array(items).map((item) => String(item || "").trim()).filter(Boolean))];
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return value === true;
}

function storyIdOf(item = {}) {
  return item.story_id || item.storyId || item.id || null;
}

function candidateStoryId({ promotionPacket = {}, proofCandidateReport = {}, motionGapReport = {}, visualRepairReport = {} }) {
  return (
    storyIdOf(promotionPacket) ||
    storyIdOf(array(proofCandidateReport.candidates)[0]) ||
    storyIdOf(array(motionGapReport.gaps)[0]) ||
    storyIdOf(array(visualRepairReport.rows)[0]) ||
    null
  );
}

function findByStory(items = [], storyId) {
  if (!storyId) return array(items)[0] || null;
  return array(items).find((item) => storyIdOf(item) === storyId) || array(items)[0] || null;
}

function evidenceComplete(evidence = {}) {
  return Boolean(evidence.mp4 && evidence.contact_sheet && evidence.qa_json && evidence.forensic_json);
}

function promotionPacketClean(packet = {}) {
  return (
    packet.verdict === "AMBER_LOCAL_PROOF" &&
    packet.production_ready === false &&
    packet.morning_approval_needed === true &&
    array(packet.blockers).length === 0 &&
    evidenceComplete(packet.evidence || {})
  );
}

function voiceReady(packet = {}, candidate = {}) {
  return (
    candidate.audio?.ready === true ||
    packet.metrics?.voice_grade === "green" ||
    /approved/i.test(String(packet.metrics?.voice_value || ""))
  );
}

function proofReady(candidate = {}) {
  return (
    candidate.verdict === "ready_flash_proof" &&
    array(candidate.blockers).length === 0 &&
    (
      candidate.proof_readiness?.final_recommendation === "render_local_proof" ||
      candidate.recommended_command
    )
  );
}

function motionReady(motionGap = {}, candidate = {}) {
  const latest = motionGap.latest_render_proof || {};
  const motionGapClear =
    motionGap.render_recommendation === "ready_for_local_flash_proof" &&
    array(motionGap.blockers).length === 0 &&
    latest.needs_human_visual_review !== true &&
    numberValue(motionGap.motion_gap?.missing_validated_clip_refs, 0) === 0 &&
    numberValue(motionGap.motion_gap?.missing_validated_clip_sources, 0) === 0 &&
    array(motionGap.motion_gap?.missing_validated_entities).length === 0;
  const candidateClear =
    proofReady(candidate) &&
    numberValue(candidate.visuals?.validated_clip_ref_count) >= 3 &&
    numberValue(candidate.visuals?.validated_clip_source_count) >= 3;
  return motionGapClear || candidateClear;
}

function visualRepairClear(visualRepairRow = null) {
  if (!visualRepairRow) return true;
  if (visualRepairRow.render_recommendation === "ready_for_local_flash_proof") return true;
  if (visualRepairRow.repair_class === "no_visual_repair_needed") return true;
  if (
    visualRepairRow.primary_action_type === "monitor" &&
    array(visualRepairRow.blockers).length === 0 &&
    visualRepairRow.visual_evidence_gate_ready === true
  ) {
    return true;
  }
  return false;
}

function forensicClean(packet = {}, motionGap = {}) {
  const metrics = packet.metrics || {};
  const latest = motionGap.latest_render_proof || {};
  const packetClean =
    numberValue(metrics.forensic_fail_count, 0) === 0 &&
    numberValue(metrics.forensic_warn_count, 0) === 0 &&
    numberValue(metrics.visual_repeat_pairs_after, 0) === 0 &&
    !array(packet.blockers).some((blocker) => /forensic|repeat|weak_rendered|rating_or_title/.test(blocker));
  const latestClean = latest.status !== "available" || latest.needs_human_visual_review !== true;
  return packetClean && latestClean;
}

function requirement(id, status, detail, evidence = null) {
  return {
    id,
    status,
    detail,
    ...(evidence ? { evidence } : {}),
  };
}

function prefixed(prefix, values = []) {
  return array(values).map((item) => `${prefix}:${item}`);
}

function visualRepairBlockers(row = null) {
  if (!row || visualRepairClear(row)) return [];
  return unique([
    row.primary_action_type,
    row.repair_class,
    ...array(row.blockers),
  ]).map((item) => `visual_repair:${item}`);
}

function pilotRequirements({ storyId, promotionPacket, proofCandidate, motionGap, visualRepairRow }) {
  const cleanPacket = promotionPacketClean(promotionPacket);
  const approvedVoice = voiceReady(promotionPacket, proofCandidate);
  const validatedMotion = motionReady(motionGap, proofCandidate);
  const repairClear = visualRepairClear(visualRepairRow);
  const cleanForensic = forensicClean(promotionPacket, motionGap);

  return [
    requirement(
      "clean_promotion_packet",
      cleanPacket ? "pass" : "block",
      cleanPacket
        ? `clean promotion packet exists for ${storyId}`
        : "requires a clean promotion packet with no blockers and MP4, contact sheet, QA and forensic evidence",
      promotionPacket.evidence || null,
    ),
    requirement(
      "approved_voice_evidence",
      approvedVoice ? "pass" : "block",
      approvedVoice
        ? "approved Liam voice evidence is present"
        : "requires approved Liam/Sleepy Liam audio evidence before any pilot",
    ),
    requirement(
      "validated_motion_backbone",
      validatedMotion ? "pass" : "block",
      validatedMotion
        ? "validated motion backbone is clear for the selected story"
        : "requires validated motion: at least three usable clip windows, three source families, entity coverage and no current motion-gap blockers",
    ),
    requirement(
      "visual_repair_queue_clear",
      repairClear ? "pass" : "block",
      repairClear
        ? "visual repair queue has no blocking row for the selected story"
        : "requires the visual repair queue to be clear before local proof rerender or pilot review",
    ),
    requirement(
      "forensic_qa_clean",
      cleanForensic ? "pass" : "block",
      cleanForensic
        ? "forensic QA has no remaining fail, warning or repeat-pair blockers"
        : "requires forensic warnings, repeat pairs, weak frames and rating/title frames to be repaired",
    ),
    requirement(
      "manual_operator_approval",
      "manual",
      "requires explicit manual approval for exactly one story, one MP4, one contact sheet, QA evidence and rollback plan",
    ),
  ];
}

function nextActionsForRequirements(requirements = []) {
  const blocked = new Set(array(requirements).filter((item) => item.status === "block").map((item) => item.id));
  const actions = [];
  if (blocked.has("clean_promotion_packet")) actions.push("repair_or_regenerate_studio_v2_promotion_packet");
  if (blocked.has("approved_voice_evidence")) actions.push("generate_approved_sleepy_liam_audio");
  if (blocked.has("validated_motion_backbone")) actions.push("validate_motion_backbone_or_alternate_sources");
  if (blocked.has("visual_repair_queue_clear")) actions.push("complete_visual_repair_plan");
  if (blocked.has("forensic_qa_clean")) actions.push("repair_forensic_warnings");
  if (actions.length) actions.push("rebuild_pilot_readiness_gate");
  else {
    actions.push("queue_manual_one_story_pilot_decision");
    actions.push("attach_evidence_to_morning_approval_queue");
    actions.push("do_not_switch_production_renderer");
  }
  return unique(actions);
}

function buildProductionDefaultBlockers({
  oneStoryReady,
  promotionPacket,
  proofCandidate,
  motionGap,
  visualRepairRow,
}) {
  const blockers = [];
  if (!oneStoryReady) blockers.push("clean_one_story_promotion_packet_missing");
  blockers.push("manual_one_story_pilot_approval_missing");
  blockers.push("completed_one_story_pilot_metrics_missing");
  if (oneStoryReady) {
    blockers.push("multi_story_regression_window_missing");
    blockers.push("production_default_change_not_allowed_by_this_gate");
    return blockers;
  }
  blockers.push(...prefixed("promotion", promotionPacket.blockers));
  blockers.push(...prefixed("proof", proofCandidate.blockers));
  blockers.push(...prefixed("motion", motionGap.blockers));
  blockers.push(...visualRepairBlockers(visualRepairRow));
  if (motionGap.latest_render_proof?.needs_human_visual_review) {
    blockers.push("motion:latest_render_forensic_warnings");
  }
  blockers.push("multi_story_regression_window_missing");
  blockers.push("production_default_change_not_allowed_by_this_gate");
  return unique(blockers);
}

function buildStudioV2PilotReadinessGate({
  promotionPacket = {},
  proofCandidateReport = {},
  motionGapReport = {},
  visualRepairReport = {},
  now = new Date().toISOString(),
} = {}) {
  const storyId = candidateStoryId({
    promotionPacket,
    proofCandidateReport,
    motionGapReport,
    visualRepairReport,
  });
  const proofCandidate = findByStory(proofCandidateReport.candidates, storyId) || {};
  const motionGap = findByStory(motionGapReport.gaps, storyId) || {};
  const visualRepairRow = findByStory(visualRepairReport.rows, storyId);
  const title = normaliseText(
    promotionPacket.title ||
      proofCandidate.title ||
      motionGap.title ||
      visualRepairRow?.title ||
      "unknown",
  );
  const requirements = pilotRequirements({
    storyId,
    promotionPacket,
    proofCandidate,
    motionGap,
    visualRepairRow,
  });
  const hardBlocks = requirements.filter((item) => item.status === "block");
  const oneStoryReady = hardBlocks.length === 0;
  const productionBlockers = buildProductionDefaultBlockers({
    oneStoryReady,
    promotionPacket,
    proofCandidate,
    motionGap,
    visualRepairRow,
  });

  return {
    schema_version: 1,
    generated_at: now,
    story_id: storyId,
    title,
    production_default: {
      allowed: false,
      verdict: oneStoryReady ? "AMBER_PILOT_REVIEW_ONLY" : "RED_BLOCKED",
      blockers: productionBlockers,
      rationale: oneStoryReady
        ? "A clean local proof can move to manual one-story pilot review only; production default still needs approval, live pilot metrics and a regression window."
        : "Studio V2 cannot become the production default while the selected proof and readiness reports still contain blockers.",
    },
    one_story_pilot: {
      status: oneStoryReady ? "ready_for_manual_approval" : "blocked",
      story_id: storyId,
      title,
      requirements,
      next_actions: nextActionsForRequirements(requirements),
    },
    inputs: {
      promotion_packet_verdict: promotionPacket.verdict || "not_available",
      proof_candidate_verdict: proofCandidate.verdict || "not_available",
      motion_gap_recommendation: motionGap.render_recommendation || "not_available",
      visual_repair_recommendation: visualRepairRow?.render_recommendation || "clear_or_not_available",
    },
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

function mdCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function renderStudioV2PilotReadinessMarkdown(report = {}) {
  const production = report.production_default || {};
  const pilot = report.one_story_pilot || {};
  const lines = [
    "# Studio V2 Pilot Readiness Gate",
    "",
    "This is a read-only synthesis report for Studio V2 pilot readiness.",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Story: \`${report.story_id || "unknown"}\``,
    `Title: ${report.title || "unknown"}`,
    "",
    "## Verdict",
    "",
    `Production default: \`${production.verdict || "unknown"}\``,
    `Production default allowed: \`${production.allowed ? "yes" : "no"}\``,
    `One-story pilot status: \`${pilot.status || "unknown"}\``,
    "",
    production.rationale || "",
    "",
    "## Production Default Blockers",
    "",
  ];

  const blockers = array(production.blockers);
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}`);

  lines.push(
    "",
    "## One-story pilot requires",
    "",
    "| Requirement | Status | Detail |",
    "| --- | --- | --- |",
  );
  for (const item of array(pilot.requirements)) {
    lines.push(`| ${mdCell(item.id)} | ${mdCell(item.status)} | ${mdCell(item.detail)} |`);
  }

  lines.push("", "## Next Actions", "");
  for (const action of array(pilot.next_actions)) lines.push(`- ${action}`);

  const evidence = array(pilot.requirements).find((item) => item.id === "clean_promotion_packet")?.evidence || {};
  lines.push(
    "",
    "## Evidence",
    "",
    `- MP4: \`${evidence.mp4 || "unknown"}\``,
    `- Contact sheet: \`${evidence.contact_sheet || "unknown"}\``,
    `- QA JSON: \`${evidence.qa_json || "unknown"}\``,
    `- Forensic JSON: \`${evidence.forensic_json || "unknown"}\``,
    "",
    "## Safety",
    "",
    "- Do not switch production renderer.",
    "- No posting or deployment action is performed.",
    "- No Railway, OAuth, production DB, scheduler, renderer default, TTS or upload behaviour is changed.",
    "- Legacy `assemble.js` remains the production rollback path.",
    "",
  );

  return lines.join("\n");
}

module.exports = {
  buildStudioV2PilotReadinessGate,
  renderStudioV2PilotReadinessMarkdown,
};
