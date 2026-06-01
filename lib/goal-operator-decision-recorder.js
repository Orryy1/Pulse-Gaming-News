"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const {
  compactFingerprintMap,
  fingerprintValidationBlockers,
} = require("./human-review-artefact-fingerprints");

const REQUIRED_ARTEFACT_KEYS = [
  "video_path",
  "first_frame_source",
  "captions_path",
  "canonical_manifest_path",
  "platform_publish_manifest_path",
];

const OPTIONAL_REVIEW_ARTEFACT_KEYS = [
  "human_review_visual_strip_report_path",
  "human_review_visual_strip_qa_report_path",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map(clean).filter(Boolean)));
}

function splitList(value) {
  if (Array.isArray(value)) return unique(value);
  return unique(String(value || "").split(","));
}

function safetyIsIntact({ reviewPacketManifest = {}, operatorDecisionLog = {} } = {}) {
  const manifestSafety = reviewPacketManifest.safety || {};
  const logSafety = operatorDecisionLog.safety || {};
  return (
    manifestSafety.no_live_publish_from_manifest === true &&
    manifestSafety.no_network_uploads === true &&
    manifestSafety.no_db_mutation === true &&
    manifestSafety.no_oauth_or_token_change === true &&
    logSafety.no_live_publish_from_log === true &&
    logSafety.no_network_uploads === true &&
    logSafety.no_db_mutation === true &&
    logSafety.no_oauth_or_token_change === true
  );
}

function findPacket(reviewPacketManifest = {}, storyId) {
  return asArray(reviewPacketManifest.review_packets).find(
    (packet) => clean(packet.story_id) === clean(storyId),
  ) || null;
}

function normaliseDecisionInput(input = {}) {
  return {
    story_id: clean(input.story_id || input.storyId),
    operator: clean(input.operator),
    decision: clean(input.decision),
    approved_platforms: unique(input.approved_platforms),
    rejected_platforms: unique(input.rejected_platforms),
    repair_requested: clean(input.repair_requested),
    reviewed_artefacts: unique(input.reviewed_artefacts),
    reviewed_artefact_fingerprints: compactFingerprintMap(input.reviewed_artefact_fingerprints),
    risk_acceptance_notes: clean(input.risk_acceptance_notes),
    decided_at: clean(input.decided_at),
  };
}

function artefactReviewed(key, packet = {}, reviewed = []) {
  const artefactPath = clean(packet.artefacts?.[key]);
  const reviewedSet = new Set(unique(reviewed));
  return reviewedSet.has(key) || (artefactPath && reviewedSet.has(artefactPath));
}

function reviewArtefactKeys(packet = {}) {
  const artefacts = packet.artefacts || {};
  return [
    ...REQUIRED_ARTEFACT_KEYS,
    ...OPTIONAL_REVIEW_ARTEFACT_KEYS.filter((key) => clean(artefacts[key])),
  ];
}

function safeReadJsonSync(filePath) {
  const value = clean(filePath);
  if (!value || !fs.existsSync(value)) return null;
  try {
    return fs.readJsonSync(value);
  } catch {
    return null;
  }
}

function visualStripSafetyIsIntact(report = {}) {
  const safety = report.safety || {};
  return (
    report.safe_to_publish_boolean === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safety.approval_omitted_from_visual_strip === true
  );
}

function visualStripQaSafetyIsIntact(report = {}) {
  const safety = report.safety || {};
  return (
    report.safe_to_publish_boolean === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safety.approval_omitted_from_visual_strip_qa === true
  );
}

function visualReviewEvidenceBlockers({ packet = {}, reviewPacketManifest = {} } = {}) {
  const blockers = [];
  const artefacts = packet.artefacts || {};
  const stripPath = clean(artefacts.human_review_visual_strip_report_path);
  const qaPath = clean(artefacts.human_review_visual_strip_qa_report_path);
  if (!stripPath && !qaPath) return blockers;
  const storyId = clean(packet.story_id);
  const sourceDryRun = clean(reviewPacketManifest.source_dry_run_generated_at);

  const strip = safeReadJsonSync(stripPath);
  const qa = safeReadJsonSync(qaPath);
  if (!strip) blockers.push("human_review_visual_strip_report_unreadable");
  if (!qa) blockers.push("human_review_visual_strip_qa_report_unreadable");
  if (!strip || !qa) return unique(blockers);

  if (!visualStripSafetyIsIntact(strip)) blockers.push("human_review_visual_strip_safety_contract_failed");
  if (!visualStripQaSafetyIsIntact(qa)) blockers.push("human_review_visual_strip_qa_safety_contract_failed");
  if (sourceDryRun && clean(strip.source_console_dry_run_generated_at) && clean(strip.source_console_dry_run_generated_at) !== sourceDryRun) {
    blockers.push("human_review_visual_strip_stale_for_review_packet");
  }
  if (sourceDryRun && clean(qa.source_console_dry_run_generated_at) && clean(qa.source_console_dry_run_generated_at) !== sourceDryRun) {
    blockers.push("human_review_visual_strip_qa_stale_for_review_packet");
  }
  if (clean(qa.source_visual_strip_generated_at) && clean(strip.generated_at) && clean(qa.source_visual_strip_generated_at) !== clean(strip.generated_at)) {
    blockers.push("human_review_visual_strip_qa_not_from_current_strip");
  }

  const stripCard = asArray(strip.cards).find((card) => clean(card.story_id) === storyId);
  const qaCard = asArray(qa.cards).find((card) => clean(card.story_id) === storyId);
  if (!stripCard) blockers.push("human_review_visual_strip_card_missing");
  else if (clean(stripCard.status) !== "frames_extracted") blockers.push("human_review_visual_strip_card_not_extracted");
  if (!qaCard) blockers.push("human_review_visual_strip_qa_card_missing");
  else if (clean(qaCard.verdict).toUpperCase() !== "GREEN") blockers.push("human_review_visual_strip_qa_card_not_green");

  const qaSummary = qa.summary || {};
  if (Number(qaSummary.red_card_count || 0) > 0) blockers.push("human_review_visual_strip_qa_has_red_cards");
  if (Number(qaSummary.risk_card_count || 0) > 0 || Number(qaSummary.frame_warning_count || 0) > 0) {
    blockers.push("human_review_visual_strip_qa_has_frame_risks");
  }
  return unique(blockers);
}

function validateDecision({ packet = null, decision = {}, operatorDecisionLog = {}, replaceExisting = false } = {}) {
  const blockers = [];
  const storyId = clean(decision.story_id);
  const decisionType = clean(decision.decision);
  if (!storyId) blockers.push("decision_missing_story_id");
  if (!packet) blockers.push(`decision_story_not_in_review_queue:${storyId || "missing"}`);
  if (!clean(decision.operator)) blockers.push("operator_missing");
  if (!clean(decision.decided_at)) blockers.push("decided_at_missing");
  if (!["approve_enabled_platforms", "reject", "request_repairs"].includes(decisionType)) {
    blockers.push(`unsupported_decision:${decisionType || "missing"}`);
  }
  const existing = asArray(operatorDecisionLog.decisions).find(
    (item) => clean(item.story_id) === storyId,
  );
  if (existing && replaceExisting !== true) blockers.push(`decision_already_exists_for_story:${storyId}`);
  if (!packet || decisionType !== "approve_enabled_platforms") return unique(blockers);

  const enabled = new Set(unique(packet.enabled_review_platforms));
  const deferred = new Set(unique(packet.deferred_platforms));
  const blocked = new Set(unique(packet.blocked_platforms));
  if (!decision.approved_platforms.length) blockers.push("approved_platforms_missing");
  for (const platform of decision.approved_platforms) {
    if (!enabled.has(platform)) blockers.push(`approved_platform_not_enabled_for_review:${platform}`);
    if (deferred.has(platform)) blockers.push(`approved_platform_is_deferred:${platform}`);
    if (blocked.has(platform)) blockers.push(`approved_platform_is_blocked:${platform}`);
  }
  for (const key of reviewArtefactKeys(packet)) {
    if (!clean(packet.artefacts?.[key])) blockers.push(`required_artefact_missing:${key}`);
    else if (!artefactReviewed(key, packet, decision.reviewed_artefacts)) {
      blockers.push(`required_artefact_not_reviewed:${key}`);
    }
  }
  blockers.push(...fingerprintValidationBlockers({
    artefacts: packet.artefacts || {},
    reviewedFingerprints: decision.reviewed_artefact_fingerprints || {},
    keys: reviewArtefactKeys(packet),
  }));
  blockers.push(...visualReviewEvidenceBlockers({ packet, reviewPacketManifest: packet.review_packet_manifest || {} }));
  if (!decision.risk_acceptance_notes) blockers.push("risk_acceptance_notes_missing");
  return unique(blockers);
}

function buildUpdatedLog({ operatorDecisionLog = {}, proposedDecision = null, replaceExisting = false, generatedAt } = {}) {
  const next = {
    schema_version: operatorDecisionLog.schema_version || 1,
    generated_at: generatedAt,
    mode: "HUMAN_REVIEW_DECISION_LOG",
    decisions: asArray(operatorDecisionLog.decisions),
    decision_template: operatorDecisionLog.decision_template || {
      story_id: "",
      operator: "",
      decision: "approve_enabled_platforms | reject | request_repairs",
      approved_platforms: [],
      rejected_platforms: [],
      repair_requested: "",
      reviewed_artefacts: [],
      reviewed_artefact_fingerprints: {},
      risk_acceptance_notes: "",
      decided_at: "",
    },
    safety: {
      no_live_publish_from_log: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
  if (!proposedDecision) return next;
  if (replaceExisting) {
    next.decisions = next.decisions.filter(
      (item) => clean(item.story_id) !== proposedDecision.story_id,
    );
  }
  next.decisions.push(proposedDecision);
  return next;
}

function buildOperatorDecisionRecorder({
  reviewPacketManifest = {},
  operatorDecisionLog = {},
  operatorDecisionLogPath = null,
  decisionInput = {},
  apply = false,
  replaceExisting = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  const safetyOk = safetyIsIntact({ reviewPacketManifest, operatorDecisionLog });
  const decision = normaliseDecisionInput(decisionInput);
  const packet = findPacket(reviewPacketManifest, decision.story_id);
  if (packet) packet.review_packet_manifest = reviewPacketManifest;
  const blockers = [];
  if (!safetyOk) blockers.push("operator_decision_recorder_safety_contract_failed");
  blockers.push(...validateDecision({ packet, decision, operatorDecisionLog, replaceExisting }));
  const cleanBlockers = unique(blockers);
  const proposedDecision = cleanBlockers.length ? null : decision;
  const updatedLog = buildUpdatedLog({
    operatorDecisionLog,
    proposedDecision,
    replaceExisting,
    generatedAt,
  });
  const wouldWrite = cleanBlockers.length === 0 && proposedDecision !== null;

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "OPERATOR_DECISION_RECORDER",
    verdict: cleanBlockers.length ? "RED" : "GREEN",
    safe_to_publish_boolean: false,
    summary: {
      existing_decision_count: asArray(operatorDecisionLog.decisions).length,
      updated_decision_count: updatedLog.decisions.length,
      blocker_count: cleanBlockers.length,
    },
    story_id: decision.story_id,
    proposed_decision: proposedDecision,
    blockers: cleanBlockers,
    updated_operator_decision_log: updatedLog,
    write_plan: {
      operator_decision_log_path: operatorDecisionLogPath ? path.resolve(operatorDecisionLogPath) : null,
      apply_requested: apply === true,
      would_write_operator_decision_log: wouldWrite,
      did_write_operator_decision_log: false,
      backup_path: null,
    },
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function renderOperatorDecisionRecorderMarkdown(report = {}) {
  const lines = [
    "# Operator Decision Recorder",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "UNKNOWN"}`,
    `Story: ${report.story_id || "missing"}`,
    `Apply requested: ${report.write_plan?.apply_requested === true}`,
    "No uploads are triggered. No database rows, OAuth settings or token files are changed.",
    "",
  ];
  if (report.proposed_decision) {
    lines.push(
      "## Proposed Decision",
      "",
      `- decision: ${report.proposed_decision.decision}`,
      `- approved platforms: ${asArray(report.proposed_decision.approved_platforms).join(", ") || "none"}`,
      `- reviewed artefacts: ${asArray(report.proposed_decision.reviewed_artefacts).join(", ") || "none"}`,
      "",
    );
  }
  if (asArray(report.blockers).length) {
    lines.push("## Blockers", "");
    for (const blocker of asArray(report.blockers)) lines.push(`- ${blocker}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function writeOperatorDecisionRecorder(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeOperatorDecisionRecorder requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, "operator_decision_recorder_report.json");
  const proposedDecisionPath = path.join(outDir, "operator_decision_recorder_proposed_decision.json");
  const markdownPath = path.join(outDir, "operator_decision_recorder.md");

  const nextReport = { ...report, write_plan: { ...(report.write_plan || {}) } };
  const shouldApply =
    nextReport.write_plan.apply_requested === true &&
    nextReport.write_plan.would_write_operator_decision_log === true &&
    nextReport.write_plan.operator_decision_log_path;
  if (shouldApply) {
    const target = nextReport.write_plan.operator_decision_log_path;
    const backupPath = path.join(outDir, "operator_decision_log.backup.json");
    if (await fs.pathExists(target)) await fs.copy(target, backupPath);
    await fs.writeJson(target, nextReport.updated_operator_decision_log, { spaces: 2 });
    nextReport.write_plan.did_write_operator_decision_log = true;
    nextReport.write_plan.backup_path = backupPath;
  }

  await fs.writeJson(reportPath, nextReport, { spaces: 2 });
  await fs.writeJson(proposedDecisionPath, nextReport.proposed_decision || {}, { spaces: 2 });
  await fs.writeFile(markdownPath, renderOperatorDecisionRecorderMarkdown(nextReport), "utf8");
  return {
    outputDir: outDir,
    reportPath,
    proposedDecisionPath,
    markdownPath,
  };
}

module.exports = {
  buildOperatorDecisionRecorder,
  renderOperatorDecisionRecorderMarkdown,
  splitList,
  writeOperatorDecisionRecorder,
};
