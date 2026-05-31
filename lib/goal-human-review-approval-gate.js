"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const {
  fingerprintValidationBlockers,
} = require("./human-review-artefact-fingerprints");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map(clean).filter(Boolean)));
}

function normaliseComparable(value) {
  return clean(value).replace(/\\/g, "/").toLowerCase();
}

function mapByStory(items = []) {
  const map = new Map();
  for (const item of asArray(items)) {
    const storyId = clean(item.story_id || item.storyId || item.id);
    if (!storyId) continue;
    map.set(storyId, item);
  }
  return map;
}

function safetyIsIntact({ humanReviewQueue = {}, reviewPacketManifest = {}, operatorDecisionLog = {} } = {}) {
  const queueSafety = humanReviewQueue.safety || {};
  const packetSafety = reviewPacketManifest.safety || {};
  const logSafety = operatorDecisionLog.safety || {};
  return (
    queueSafety.no_network_uploads === true &&
    queueSafety.no_db_mutation === true &&
    queueSafety.no_oauth_or_token_change === true &&
    packetSafety.no_live_publish_from_manifest === true &&
    packetSafety.no_network_uploads === true &&
    packetSafety.no_db_mutation === true &&
    packetSafety.no_oauth_or_token_change === true &&
    logSafety.no_live_publish_from_log === true &&
    logSafety.no_network_uploads === true &&
    logSafety.no_db_mutation === true &&
    logSafety.no_oauth_or_token_change === true
  );
}

function artefactAliases(key) {
  const aliases = {
    video_path: ["video_path", "video", "final_video", "mp4", "final_mp4"],
    first_frame_source: ["first_frame_source", "first_frame", "cover_frame", "opening_frame"],
    captions_path: ["captions_path", "captions", "subtitle_file", "srt"],
    canonical_manifest_path: ["canonical_manifest_path", "canonical_manifest", "story_manifest"],
    platform_publish_manifest_path: ["platform_publish_manifest_path", "platform_publish_manifest", "platform_pack"],
  };
  return aliases[key] || [key];
}

function artefactReviewed(key, value, reviewedArtefacts = []) {
  const reviewed = asArray(reviewedArtefacts).map(normaliseComparable);
  const aliases = artefactAliases(key).map(normaliseComparable);
  const comparablePath = normaliseComparable(value);
  return reviewed.some((item) => aliases.includes(item) || (comparablePath && item === comparablePath));
}

function requiredArtefactBlockers(packet = {}, decision = {}) {
  const blockers = [];
  const artefacts = packet.artefacts || {};
  for (const key of [
    "video_path",
    "first_frame_source",
    "captions_path",
    "canonical_manifest_path",
    "platform_publish_manifest_path",
  ]) {
    const value = clean(artefacts[key]);
    if (!value) {
      blockers.push(`required_artefact_missing:${key}`);
      continue;
    }
    if (!artefactReviewed(key, value, decision.reviewed_artefacts)) {
      blockers.push(`required_artefact_not_reviewed:${key}`);
    }
  }
  return blockers;
}

function validateDecision({ decision = {}, packet = null } = {}) {
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
  if (!packet || decisionType !== "approve_enabled_platforms") return blockers;

  if (clean(packet.verdict).toUpperCase() === "RED" || asArray(packet.blocked_platforms).length) {
    blockers.push("red_or_blocked_packet_cannot_be_approved");
  }

  const enabled = new Set(asArray(packet.enabled_review_platforms).map(clean));
  const deferred = new Set(asArray(packet.deferred_platforms).map(clean));
  const blocked = new Set(asArray(packet.blocked_platforms).map(clean));
  const approved = unique(decision.approved_platforms);
  if (!approved.length) blockers.push("approved_platforms_missing");
  for (const platform of approved) {
    if (!enabled.has(platform)) blockers.push(`approved_platform_not_enabled_for_review:${platform}`);
    if (deferred.has(platform)) blockers.push(`approved_platform_is_deferred:${platform}`);
    if (blocked.has(platform)) blockers.push(`approved_platform_is_blocked:${platform}`);
  }

  blockers.push(...requiredArtefactBlockers(packet, decision));
  blockers.push(...fingerprintValidationBlockers({
    artefacts: packet.artefacts || {},
    reviewedFingerprints: decision.reviewed_artefact_fingerprints || {},
    keys: [
      "video_path",
      "first_frame_source",
      "captions_path",
      "canonical_manifest_path",
      "platform_publish_manifest_path",
    ],
  }));
  return unique(blockers);
}

function buildApprovedActions({ decision = {}, packet = {} } = {}) {
  const artefacts = packet.artefacts || {};
  return unique(decision.approved_platforms).map((platform) => ({
    story_id: packet.story_id,
    platform,
    title: clean(packet.title || packet.public_copy?.title),
    operator: clean(decision.operator),
    operator_decided_at: clean(decision.decided_at),
    decision: "approve_enabled_platforms",
    video_path: clean(artefacts.video_path),
    captions_path: clean(artefacts.captions_path),
    first_frame_source: clean(artefacts.first_frame_source),
    canonical_manifest_path: clean(artefacts.canonical_manifest_path),
    platform_publish_manifest_path: clean(artefacts.platform_publish_manifest_path),
    reviewed_artefact_fingerprints: decision.reviewed_artefact_fingerprints || {},
    source_primary: packet.source_list?.primary || null,
    live_publish_allowed_from_gate: false,
    requires_guarded_dispatch_command: true,
    requires_enabled_platform_recheck: true,
  }));
}

function buildHumanReviewApprovalGate({
  humanReviewQueue = {},
  reviewPacketManifest = {},
  operatorDecisionLog = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const packets = asArray(reviewPacketManifest.review_packets);
  const packetByStory = mapByStory(packets);
  const decisions = asArray(operatorDecisionLog.decisions);
  const approvedActions = [];
  const approvedStories = [];
  const blockedDecisions = [];
  const rejectedStories = [];
  const repairRequestedStories = [];
  const decidedStoryIds = new Set();
  const safetyOk = safetyIsIntact({ humanReviewQueue, reviewPacketManifest, operatorDecisionLog });

  if (!safetyOk) {
    blockedDecisions.push({
      story_id: null,
      decision: null,
      blockers: ["human_review_approval_safety_contract_failed"],
    });
  }

  for (const decision of decisions) {
    const storyId = clean(decision.story_id);
    const packet = packetByStory.get(storyId);
    const decisionType = clean(decision.decision);
    decidedStoryIds.add(storyId);

    if (decisionType === "reject") {
      rejectedStories.push({
        story_id: storyId,
        operator: clean(decision.operator),
        decided_at: clean(decision.decided_at),
        reason: clean(decision.risk_acceptance_notes || decision.repair_requested),
      });
      continue;
    }
    if (decisionType === "request_repairs") {
      repairRequestedStories.push({
        story_id: storyId,
        operator: clean(decision.operator),
        decided_at: clean(decision.decided_at),
        repair_requested: clean(decision.repair_requested),
      });
      continue;
    }

    const blockers = validateDecision({ decision, packet });
    if (blockers.length) {
      blockedDecisions.push({
        story_id: storyId || null,
        decision: decisionType || null,
        approved_platforms: unique(decision.approved_platforms),
        blockers,
      });
      continue;
    }

    approvedStories.push({
      story_id: storyId,
      title: packet.title,
      operator: clean(decision.operator),
      decided_at: clean(decision.decided_at),
      approved_platforms: unique(decision.approved_platforms),
      deferred_platforms: asArray(packet.deferred_platforms),
      public_copy: packet.public_copy || {},
      source_list: packet.source_list || {},
    });
    approvedActions.push(...buildApprovedActions({ decision, packet }));
  }

  const pendingReviewPackets = packets
    .filter((packet) => !decidedStoryIds.has(clean(packet.story_id)))
    .map((packet) => ({
      packet_id: packet.packet_id || `${packet.story_id}:human_review`,
      story_id: packet.story_id,
      title: packet.title,
      enabled_review_platforms: asArray(packet.enabled_review_platforms),
      deferred_platforms: asArray(packet.deferred_platforms),
    }));

  const advisory = [];
  if (!decisions.length) advisory.push("no_recorded_operator_decisions");
  if (pendingReviewPackets.length) advisory.push("review_packets_still_pending_operator_decision");
  if (repairRequestedStories.length) advisory.push("operator_requested_repairs");
  if (rejectedStories.length) advisory.push("operator_rejected_stories");

  const verdict = blockedDecisions.length
    ? "RED"
    : approvedActions.length
      ? "GREEN"
      : "AMBER";
  const safePublishPlan = {
    schema_version: 1,
    generated_at: generatedAt,
    operating_mode: "HUMAN_REVIEW",
    approval_gate_verdict: verdict,
    guarded_dispatch_eligible: verdict === "GREEN" && approvedActions.length > 0,
    live_publish_allowed_from_this_tool: false,
    approved_story_count: approvedStories.length,
    approved_action_count: approvedActions.length,
    pending_review_packet_count: pendingReviewPackets.length,
    invalid_decision_count: blockedDecisions.length,
    required_next_step:
      verdict === "RED"
        ? "repair_invalid_operator_decisions_before_guarded_dispatch"
        : approvedActions.length
          ? "run_guarded_dispatch_preflight_for_operator_approved_enabled_platforms"
          : "record_operator_decisions_before_guarded_dispatch",
    approved_actions: approvedActions,
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
    mode: "HUMAN_REVIEW_APPROVAL_GATE",
    verdict,
    safe_to_publish_boolean: false,
    summary: {
      review_packet_count: packets.length,
      decision_count: decisions.length,
      approved_story_count: approvedStories.length,
      approved_action_count: approvedActions.length,
      pending_review_packet_count: pendingReviewPackets.length,
      invalid_decision_count: blockedDecisions.length,
      rejected_story_count: rejectedStories.length,
      repair_requested_story_count: repairRequestedStories.length,
    },
    approved_stories: approvedStories,
    approved_actions: approvedActions,
    blocked_decisions: blockedDecisions,
    pending_review_packets: pendingReviewPackets,
    rejected_stories: rejectedStories,
    repair_requested_stories: repairRequestedStories,
    advisory,
    safe_publish_plan: safePublishPlan,
    safety: safePublishPlan.safety,
  };
}

function renderHumanReviewApprovalGateMarkdown(report = {}) {
  const lines = [
    "# Human Review Approval Gate",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "UNKNOWN"}`,
    `Approved actions: ${report.summary?.approved_action_count || 0}`,
    `Pending review packets: ${report.summary?.pending_review_packet_count || 0}`,
    `Invalid decisions: ${report.summary?.invalid_decision_count || 0}`,
    "No uploads are triggered. No database rows, OAuth settings or token files are changed.",
    "",
  ];
  if (asArray(report.approved_actions).length) {
    lines.push("## Guarded Dispatch Candidates", "");
    for (const action of asArray(report.approved_actions)) {
      lines.push(`- ${action.story_id} -> ${action.platform}: ${action.title}`);
    }
    lines.push("");
  }
  if (asArray(report.blocked_decisions).length) {
    lines.push("## Blocked Decisions", "");
    for (const decision of asArray(report.blocked_decisions)) {
      lines.push(`- ${decision.story_id || "unknown"}: ${asArray(decision.blockers).join(", ") || "blocked"}`);
    }
    lines.push("");
  }
  if (asArray(report.pending_review_packets).length) {
    lines.push("## Pending Review", "");
    for (const packet of asArray(report.pending_review_packets)) {
      lines.push(`- ${packet.story_id}: ${packet.title || "untitled"}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function writeHumanReviewApprovalGate(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeHumanReviewApprovalGate requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, "human_review_approval_gate_report.json");
  const controlledPublishPlanPath = path.join(outDir, "human_review_controlled_publish_plan.json");
  const markdownPath = path.join(outDir, "human_review_approval_gate.md");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeJson(controlledPublishPlanPath, report.safe_publish_plan || {}, { spaces: 2 });
  await fs.writeFile(markdownPath, renderHumanReviewApprovalGateMarkdown(report), "utf8");
  return {
    outputDir: outDir,
    reportPath,
    controlledPublishPlanPath,
    markdownPath,
  };
}

module.exports = {
  buildHumanReviewApprovalGate,
  renderHumanReviewApprovalGateMarkdown,
  writeHumanReviewApprovalGate,
};
