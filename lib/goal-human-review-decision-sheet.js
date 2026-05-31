"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const {
  fingerprintArtefacts,
  serialiseFingerprintMap,
} = require("./human-review-artefact-fingerprints");

const REQUIRED_ARTEFACT_KEYS = [
  "video_path",
  "first_frame_source",
  "captions_path",
  "canonical_manifest_path",
  "platform_publish_manifest_path",
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

function decisionsByStory(operatorDecisionLog = {}) {
  const map = new Map();
  for (const decision of asArray(operatorDecisionLog.decisions)) {
    const storyId = clean(decision.story_id || decision.storyId || decision.id);
    if (!storyId || map.has(storyId)) continue;
    map.set(storyId, decision);
  }
  return map;
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

function requiredArtefacts(packet = {}) {
  const artefacts = packet.artefacts || {};
  const fingerprints = fingerprintArtefacts(artefacts, REQUIRED_ARTEFACT_KEYS);
  return REQUIRED_ARTEFACT_KEYS.map((key) => ({
    key,
    path: clean(artefacts[key]),
    fingerprint: fingerprints[key],
    required_for_approval: true,
    reviewed_artefacts_accepts: [key, clean(artefacts[key])].filter(Boolean),
  }));
}

function reviewArtefactPaths(packet = {}) {
  const artefacts = packet.artefacts || {};
  return Object.fromEntries(
    REQUIRED_ARTEFACT_KEYS.map((key) => [key, clean(artefacts[key])]),
  );
}

function sourceName(source = {}) {
  return clean(source?.name || source?.source_name || source?.label || source?.url);
}

function commandQuote(value) {
  const text = clean(value);
  if (!text) return "\"\"";
  if (/^[A-Za-z0-9_.,/:\\-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function buildRecorderCommand({
  storyId,
  decision,
  approvedPlatforms = [],
  rejectedPlatforms = [],
  reviewedArtefacts = [],
  reviewedArtefactFingerprints = {},
  apply = false,
  includeRepairRequest = false,
} = {}) {
  const parts = [
    "npm",
    "run",
    "ops:goal-record-operator-decision",
    "--",
    "--story",
    commandQuote(storyId),
    "--operator",
    "\"<operator>\"",
    "--decision",
    commandQuote(decision),
  ];
  if (approvedPlatforms.length) {
    parts.push("--approved-platforms", commandQuote(approvedPlatforms.join(",")));
  }
  if (rejectedPlatforms.length) {
    parts.push("--rejected-platforms", commandQuote(rejectedPlatforms.join(",")));
  }
  if (reviewedArtefacts.length) {
    parts.push("--reviewed-artefacts", commandQuote(reviewedArtefacts.join(",")));
  }
  const serialisedFingerprints = serialiseFingerprintMap(reviewedArtefactFingerprints);
  if (serialisedFingerprints) {
    parts.push("--reviewed-artefact-fingerprints", commandQuote(serialisedFingerprints));
  }
  if (includeRepairRequest) {
    parts.push("--repair-requested", "\"<repair request>\"");
  }
  parts.push("--risk-notes", "\"<review note>\"");
  parts.push("--json");
  if (apply) parts.push("--apply");
  return parts.join(" ");
}

function buildRecorderCommands({ storyId, enabled = [], artefacts = [] } = {}) {
  const reviewedArtefacts = artefacts.map((artefact) => artefact.key);
  const reviewedArtefactFingerprints = Object.fromEntries(
    artefacts
      .map((artefact) => [artefact.key, artefact.fingerprint?.sha256])
      .filter(([, hash]) => Boolean(hash)),
  );
  return {
    approve_enabled_platforms_dry_run: buildRecorderCommand({
      storyId,
      decision: "approve_enabled_platforms",
      approvedPlatforms: enabled,
      reviewedArtefacts,
      reviewedArtefactFingerprints,
    }),
    approve_enabled_platforms_apply_template: buildRecorderCommand({
      storyId,
      decision: "approve_enabled_platforms",
      approvedPlatforms: enabled,
      reviewedArtefacts,
      reviewedArtefactFingerprints,
      apply: true,
    }),
    reject_dry_run: buildRecorderCommand({
      storyId,
      decision: "reject",
      rejectedPlatforms: enabled,
      reviewedArtefacts,
      reviewedArtefactFingerprints,
    }),
    request_repairs_dry_run: buildRecorderCommand({
      storyId,
      decision: "request_repairs",
      reviewedArtefacts,
      reviewedArtefactFingerprints,
      includeRepairRequest: true,
    }),
  };
}

function buildDecisionSlot(packet = {}, existingDecision = null) {
  const enabled = unique(packet.enabled_review_platforms);
  const nonApprovable = unique([
    ...asArray(packet.deferred_platforms),
    ...asArray(packet.blocked_platforms),
  ]);
  const storyId = clean(packet.story_id);
  const title = clean(packet.title || packet.public_copy?.title);
  const artefacts = requiredArtefacts(packet);
  return {
    packet_id: clean(packet.packet_id || `${storyId}:human_review`),
    story_id: storyId,
    title,
    decision_status: existingDecision ? "already_decided" : "pending_operator_decision",
    existing_decision: existingDecision
      ? {
          decision: clean(existingDecision.decision),
          operator: clean(existingDecision.operator),
          decided_at: clean(existingDecision.decided_at),
          approved_platforms: unique(existingDecision.approved_platforms),
        }
      : null,
    public_copy: packet.public_copy || {},
    source_list: packet.source_list || {},
    source_check_summary: {
      primary_source: sourceName(packet.source_list?.primary) || null,
      discovery_source: sourceName(packet.source_list?.discovery) || null,
      primary_must_match_public_source_label: true,
    },
    review_artefact_paths: reviewArtefactPaths(packet),
    operator_decision_recorder_commands: buildRecorderCommands({
      storyId,
      enabled,
      artefacts,
    }),
    allowed_decisions: ["approve_enabled_platforms", "reject", "request_repairs"],
    allowed_approval_platforms: enabled,
    non_approvable_platforms: nonApprovable,
    required_reviewed_artefacts: artefacts,
    required_operator_checks: unique(packet.required_operator_checks),
    approve_enabled_platforms_template: {
      story_id: storyId,
      operator: "",
      decision: "approve_enabled_platforms",
      approved_platforms: enabled,
      rejected_platforms: [],
      repair_requested: "",
      reviewed_artefacts: artefacts.map((artefact) => artefact.key),
      reviewed_artefact_fingerprints: Object.fromEntries(
        artefacts
          .map((artefact) => [artefact.key, artefact.fingerprint?.sha256])
          .filter(([, hash]) => Boolean(hash)),
      ),
      risk_acceptance_notes: "",
      decided_at: "",
    },
    reject_template: {
      story_id: storyId,
      operator: "",
      decision: "reject",
      approved_platforms: [],
      rejected_platforms: enabled,
      repair_requested: "",
      reviewed_artefacts: artefacts.map((artefact) => artefact.key),
      reviewed_artefact_fingerprints: Object.fromEntries(
        artefacts
          .map((artefact) => [artefact.key, artefact.fingerprint?.sha256])
          .filter(([, hash]) => Boolean(hash)),
      ),
      risk_acceptance_notes: "",
      decided_at: "",
    },
    request_repairs_template: {
      story_id: storyId,
      operator: "",
      decision: "request_repairs",
      approved_platforms: [],
      rejected_platforms: [],
      repair_requested: "",
      reviewed_artefacts: artefacts.map((artefact) => artefact.key),
      reviewed_artefact_fingerprints: Object.fromEntries(
        artefacts
          .map((artefact) => [artefact.key, artefact.fingerprint?.sha256])
          .filter(([, hash]) => Boolean(hash)),
      ),
      risk_acceptance_notes: "",
      decided_at: "",
    },
    validation_rules: [
      "Operator must choose one allowed_decisions value.",
      "Approvals may only include allowed_approval_platforms.",
      "non_approvable_platforms must not appear in approved_platforms.",
      "Every required_reviewed_artefacts key must be recorded before approval.",
      "The title, thumbnail, opening line, source label, captions and first three seconds must match.",
    ],
    approval_gate: {
      operator_must_choose_decision: true,
      live_publish_allowed_from_sheet: false,
      guarded_dispatch_still_requires_approval_gate: true,
      disabled_platforms_must_remain_deferred: true,
    },
  };
}

function buildHumanReviewDecisionSheet({
  reviewPacketManifest = {},
  operatorDecisionLog = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const safetyOk = safetyIsIntact({ reviewPacketManifest, operatorDecisionLog });
  const blockers = [];
  if (!safetyOk) blockers.push("human_review_decision_sheet_safety_contract_failed");

  const packets = safetyOk ? asArray(reviewPacketManifest.review_packets) : [];
  const existingByStory = decisionsByStory(operatorDecisionLog);
  const decisionSlots = packets.map((packet) => {
    const storyId = clean(packet.story_id);
    return buildDecisionSlot(packet, existingByStory.get(storyId) || null);
  });
  const alreadyDecidedCount = decisionSlots.filter((slot) => slot.decision_status === "already_decided").length;
  const pendingDecisionCount = decisionSlots.length - alreadyDecidedCount;
  const verdict = blockers.length ? "RED" : pendingDecisionCount > 0 ? "AMBER" : "GREEN";
  const safePublishPlan = {
    schema_version: 1,
    generated_at: generatedAt,
    operating_mode: "HUMAN_REVIEW",
    decision_sheet_verdict: verdict,
    live_publish_allowed_from_this_tool: false,
    can_publish_without_operator: false,
    decision_slot_count: decisionSlots.length,
    pending_decision_count: pendingDecisionCount,
    already_decided_count: alreadyDecidedCount,
    required_next_step:
      verdict === "RED"
        ? "repair_human_review_decision_sheet_inputs"
        : pendingDecisionCount > 0
          ? "record_operator_decisions_in_operator_decision_log"
          : "run_human_review_approval_gate",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "HUMAN_REVIEW_DECISION_SHEET",
    verdict,
    safe_to_publish_boolean: false,
    summary: {
      decision_slot_count: decisionSlots.length,
      pending_decision_count: pendingDecisionCount,
      already_decided_count: alreadyDecidedCount,
      blocked_input_count: blockers.length,
    },
    decision_slots: decisionSlots,
    blockers,
    safe_publish_plan: safePublishPlan,
    safety: safePublishPlan.safety,
  };
}

function renderHumanReviewDecisionSheetMarkdown(sheet = {}) {
  const lines = [
    "# Human Review Decision Sheet",
    "",
    `Generated: ${sheet.generated_at || "unknown"}`,
    `Verdict: ${sheet.verdict || "UNKNOWN"}`,
    `Pending decisions: ${sheet.summary?.pending_decision_count || 0}`,
    `Already decided: ${sheet.summary?.already_decided_count || 0}`,
    "No uploads are triggered. No database rows, OAuth settings or token files are changed.",
    "Use this sheet to record operator decisions; it is not a publish command.",
    "",
  ];

  for (const slot of asArray(sheet.decision_slots)) {
    lines.push(
      `## ${slot.title || slot.story_id}`,
      "",
      `Story: ${slot.story_id}`,
      `Decision status: ${slot.decision_status}`,
      `Approval platforms, enabled only: ${asArray(slot.allowed_approval_platforms).join(", ") || "none"}`,
      `Do not approve: ${asArray(slot.non_approvable_platforms).join(", ") || "none"}`,
      `Primary source: ${sourceName(slot.source_list?.primary) || "missing"}`,
      `Opening: ${slot.public_copy?.first_spoken_line || "missing"}`,
      `Artefacts: ${asArray(slot.required_reviewed_artefacts).map((artefact) => artefact.key).join(", ")}`,
      "",
    );
    lines.push("Artefact paths:");
    for (const artefact of asArray(slot.required_reviewed_artefacts)) {
      const hash = artefact.fingerprint?.sha256
        ? ` (${artefact.fingerprint.sha256.slice(0, 19)}...)`
        : "";
      lines.push(`- ${artefact.key}: ${artefact.path || "missing"}${hash}`);
    }
    lines.push(
      "",
      "Recorder templates:",
      "Dry-run first. Add `--apply` only after the operator has watched the video and checked the artefacts.",
      "```powershell",
      slot.operator_decision_recorder_commands?.approve_enabled_platforms_dry_run || "",
      "```",
      "Apply template:",
      "```powershell",
      slot.operator_decision_recorder_commands?.approve_enabled_platforms_apply_template || "",
      "```",
      "",
    );
  }

  if (asArray(sheet.blockers).length) {
    lines.push("## Blockers", "");
    for (const blocker of asArray(sheet.blockers)) lines.push(`- ${blocker}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function writeHumanReviewDecisionSheet(sheet = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeHumanReviewDecisionSheet requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "human_review_decision_sheet.json");
  const markdownPath = path.join(outDir, "human_review_decision_sheet.md");
  const safePublishPlanPath = path.join(outDir, "human_review_decision_sheet_safe_publish_plan.json");
  await fs.writeJson(jsonPath, sheet, { spaces: 2 });
  await fs.writeFile(markdownPath, renderHumanReviewDecisionSheetMarkdown(sheet), "utf8");
  await fs.writeJson(safePublishPlanPath, sheet.safe_publish_plan || {}, { spaces: 2 });
  return {
    outputDir: outDir,
    jsonPath,
    markdownPath,
    safePublishPlanPath,
  };
}

module.exports = {
  buildHumanReviewDecisionSheet,
  renderHumanReviewDecisionSheetMarkdown,
  writeHumanReviewDecisionSheet,
};
