"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const {
  fingerprintFile,
} = require("./human-review-artefact-fingerprints");

const REVIEW_ARTEFACT_KEYS = [
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

function setKey(values = []) {
  return unique(values).sort().join("|");
}

function safetyIsIntact(decisionSheet = {}) {
  const safety = decisionSheet.safety || {};
  return (
    decisionSheet.safe_to_publish_boolean === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
}

function reviewPacketPlatformBlockers({ decisionSheet = {}, reviewPacketManifest = null } = {}) {
  if (!reviewPacketManifest || !Array.isArray(reviewPacketManifest.review_packets)) return [];
  const slotByStory = new Map(
    asArray(decisionSheet.decision_slots).map((slot) => [clean(slot.story_id), slot]),
  );
  const blockers = [];
  for (const packet of asArray(reviewPacketManifest.review_packets)) {
    const storyId = clean(packet.story_id);
    if (!storyId) continue;
    const slot = slotByStory.get(storyId);
    if (!slot) {
      blockers.push(`decision_sheet_missing_current_packet:${storyId}`);
      continue;
    }
    const packetEnabled = setKey(packet.enabled_review_platforms);
    const slotEnabled = setKey(slot.allowed_approval_platforms);
    const packetNonApprovable = setKey([
      ...asArray(packet.deferred_platforms),
      ...asArray(packet.blocked_platforms),
    ]);
    const slotNonApprovable = setKey(slot.non_approvable_platforms);
    if (packetEnabled !== slotEnabled || packetNonApprovable !== slotNonApprovable) {
      blockers.push(`decision_sheet_platforms_stale:${storyId}`);
    }
  }
  return unique(blockers);
}

function artefactTarget(slot = {}, key) {
  const artefacts = slot.review_artefact_paths || {};
  const filePath = clean(artefacts[key]);
  const fingerprint = fingerprintFile(filePath);
  return {
    key,
    path: filePath,
    exists: fingerprint.exists,
    sha256: fingerprint.sha256,
    size_bytes: fingerprint.size_bytes,
    required_for_review: true,
  };
}

function buildReviewCard(slot = {}, index = 0) {
  const openTargets = Object.fromEntries(
    REVIEW_ARTEFACT_KEYS.map((key) => [key, artefactTarget(slot, key)]),
  );
  const blockers = [];
  for (const target of Object.values(openTargets)) {
    if (!target.path || !target.exists) blockers.push(`missing_review_artefact:${target.key}`);
  }

  const pending = clean(slot.decision_status) === "pending_operator_decision";
  const alreadyDecided = clean(slot.decision_status) === "already_decided";
  const reviewStatus = blockers.length
    ? "missing_review_artefacts"
    : alreadyDecided
      ? "already_decided"
      : "ready_for_operator_review";

  return {
    review_sequence: index + 1,
    packet_id: clean(slot.packet_id),
    story_id: clean(slot.story_id),
    title: clean(slot.title || slot.public_copy?.title),
    decision_status: clean(slot.decision_status || "unknown"),
    review_status: reviewStatus,
    recommended_next_decision: blockers.length
      ? "request_repairs"
      : pending
        ? "operator_watch_then_decide"
        : "no_operator_action_needed",
    public_copy: {
      title: clean(slot.public_copy?.title || slot.title),
      thumbnail_headline: clean(slot.public_copy?.thumbnail_headline),
      first_spoken_line: clean(slot.public_copy?.first_spoken_line),
      script_excerpt: clean(slot.public_copy?.script_excerpt),
      description: clean(slot.public_copy?.description),
    },
    source_check_summary: slot.source_check_summary || {},
    open_targets: openTargets,
    platform_plan: {
      enabled_for_review: unique(slot.allowed_approval_platforms),
      deferred_or_disabled: unique(slot.non_approvable_platforms),
      disabled_platforms_must_remain_deferred: true,
    },
    operator_checklist: unique(slot.required_operator_checks),
    decision_commands: {
      approve_enabled_platforms_dry_run: clean(
        slot.operator_decision_recorder_commands?.approve_enabled_platforms_dry_run,
      ),
      reject_dry_run: clean(slot.operator_decision_recorder_commands?.reject_dry_run),
      request_repairs_dry_run: clean(
        slot.operator_decision_recorder_commands?.request_repairs_dry_run,
      ),
      apply_template_after_review_only: clean(
        slot.operator_decision_recorder_commands?.approve_enabled_platforms_apply_template,
      ),
    },
    blockers,
    approval_guard: {
      live_publish_allowed_from_index: false,
      dispatch_still_requires_approval_gate: true,
      operator_decision_required: pending,
      no_disabled_platform_approval: true,
    },
  };
}

function buildHumanReviewOperatorIndex({
  decisionSheet = {},
  reviewPacketManifest = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const blockers = [];
  const safetyOk = safetyIsIntact(decisionSheet);
  if (!safetyOk) blockers.push("human_review_operator_index_safety_contract_failed");
  blockers.push(...reviewPacketPlatformBlockers({ decisionSheet, reviewPacketManifest }));

  const cards = safetyOk && !blockers.length
    ? asArray(decisionSheet.decision_slots).map((slot, index) => buildReviewCard(slot, index))
    : [];
  const pending = cards.filter((card) => card.decision_status === "pending_operator_decision");
  const ready = cards.filter((card) => card.review_status === "ready_for_operator_review");
  const missing = cards.filter((card) => card.review_status === "missing_review_artefacts");
  const alreadyDecided = cards.filter((card) => card.decision_status === "already_decided");
  const verdict = blockers.length
    ? "RED"
    : pending.length || missing.length
      ? "AMBER"
      : "GREEN";

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "HUMAN_REVIEW_OPERATOR_INDEX",
    verdict,
    safe_to_publish_boolean: false,
    summary: {
      review_card_count: cards.length,
      pending_review_count: pending.length,
      ready_for_operator_review_count: ready.length,
      missing_artefact_card_count: missing.length,
      already_decided_count: alreadyDecided.length,
      blocked_input_count: blockers.length,
    },
    review_cards: cards,
    blockers,
    next_step:
      blockers.length
        ? "repair_operator_index_inputs"
        : missing.length
          ? "request_repairs_for_missing_review_artefacts"
          : pending.length
            ? "watch_review_cards_and_record_operator_decisions"
            : "run_human_review_approval_gate",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function renderHumanReviewOperatorIndexMarkdown(index = {}) {
  const lines = [
    "# Human Review Operator Index",
    "",
    `Generated: ${index.generated_at || "unknown"}`,
    `Verdict: ${index.verdict || "UNKNOWN"}`,
    `Review cards: ${index.summary?.review_card_count || 0}`,
    `Ready to watch: ${index.summary?.ready_for_operator_review_count || 0}`,
    `Missing artefacts: ${index.summary?.missing_artefact_card_count || 0}`,
    "No uploads are triggered. This index cannot approve, publish, mutate the database or touch OAuth/token files.",
    "",
  ];

  for (const card of asArray(index.review_cards)) {
    lines.push(
      `## ${card.review_sequence}. ${card.title || card.story_id}`,
      "",
      `Story: ${card.story_id}`,
      `Status: ${card.review_status}`,
      `Recommended decision: ${card.recommended_next_decision}`,
      `Primary source: ${clean(card.source_check_summary?.primary_source) || "missing"}`,
      `Opening line: ${card.public_copy?.first_spoken_line || "missing"}`,
      `Enabled for review: ${asArray(card.platform_plan?.enabled_for_review).join(", ") || "none"}`,
      `Deferred or disabled: ${asArray(card.platform_plan?.deferred_or_disabled).join(", ") || "none"}`,
      "",
      "Watch this first:",
      `- Video: ${card.open_targets?.video_path?.path || "missing"}`,
      `- Captions: ${card.open_targets?.captions_path?.path || "missing"}`,
      `- Canonical manifest: ${card.open_targets?.canonical_manifest_path?.path || "missing"}`,
      `- Platform manifest: ${card.open_targets?.platform_publish_manifest_path?.path || "missing"}`,
      "",
    );

    if (asArray(card.blockers).length) {
      lines.push("Repair blockers:");
      for (const blocker of asArray(card.blockers)) lines.push(`- ${blocker}`);
      lines.push("");
    }

    lines.push(
      "Decision commands:",
      "Dry-run first. Use the apply template only after a human has watched the video and checked the listed artefacts.",
      "```powershell",
      card.decision_commands?.approve_enabled_platforms_dry_run || "",
      "```",
      "Repair request:",
      "```powershell",
      card.decision_commands?.request_repairs_dry_run || "",
      "```",
      "",
    );
  }

  if (asArray(index.blockers).length) {
    lines.push("## Input Blockers", "");
    for (const blocker of asArray(index.blockers)) lines.push(`- ${blocker}`);
    lines.push("");
  }

  return lines.join("\n");
}

async function writeHumanReviewOperatorIndex(index = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeHumanReviewOperatorIndex requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "human_review_operator_index.json");
  const markdownPath = path.join(outDir, "human_review_operator_index.md");
  await fs.writeJson(jsonPath, index, { spaces: 2 });
  await fs.writeFile(markdownPath, renderHumanReviewOperatorIndexMarkdown(index), "utf8");
  return {
    outputDir: outDir,
    jsonPath,
    markdownPath,
  };
}

module.exports = {
  buildHumanReviewOperatorIndex,
  renderHumanReviewOperatorIndexMarkdown,
  writeHumanReviewOperatorIndex,
};
