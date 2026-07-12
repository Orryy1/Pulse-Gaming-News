"use strict";

/**
 * Studio v2.1 HyperFrames card routing.
 *
 * This lane intentionally refuses generic pre-rendered MP4 cards by
 * default. A generic card can contain old story text baked into the
 * pixels, which is worse than a plainer ffmpeg fallback card. Only
 * story-specific or story-specific channel cards are allowed through.
 */

const path = require("node:path");
const fs = require("fs-extra");
const { SCENE_TYPES } = require("../../scene-composer");

const MIN_PREMIUM_HYPERFRAMES_CARDS = 4;
const MIN_HYPERFRAMES_READABLE_HOLD_S = 5.2;
const MAX_HYPERFRAMES_READABLE_HOLD_S = 14;
const MAX_CONCISE_SOURCE_LOCK_WORDS = 6;
const MAX_CONCISE_SOURCE_LOCK_HOLD_S = 2.2;
const HYPERFRAMES_SHELL_SIDECAR_SUFFIX = ".shell.json";

function shellSidecarPathForCard(cardPath) {
  if (!cardPath) return null;
  return cardPath.replace(/\.[^.]+$/i, HYPERFRAMES_SHELL_SIDECAR_SUFFIX);
}

function checkStatus(value) {
  return String(value?.status || value?.verdict || value || "").toLowerCase();
}

function isPassingCheck(value) {
  return checkStatus(value) === "pass" || checkStatus(value) === "passed";
}

function readJsonSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return fs.readJsonSync(filePath);
  } catch {
    return null;
  }
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function readabilityContractFromShell(shell = {}) {
  const nested = shell.readability_contract ||
    shell.card_readability_contract ||
    shell.readability;
  if (nested) return nested;
  const evidence = shell.evidence || shell;
  if (
    evidence.readable_text ||
    evidence.minimum_visible_duration_s ||
    evidence.minimum_readable_duration_s ||
    evidence.planned_visible_duration_s
  ) {
    return shell;
  }
  return {};
}

function readableDurationEvidenceFromShell(shell = {}) {
  const contract = readabilityContractFromShell(shell);
  const evidence = contract.evidence || contract;
  return {
    contract,
    status: checkStatus(contract),
    readable_text: evidence.readable_text || evidence.text || "",
    word_count: firstFiniteNumber(evidence.word_count),
    planned_visible_duration_s: firstFiniteNumber(
      evidence.planned_visible_duration_s,
      evidence.visible_duration_s,
      evidence.duration_s,
      evidence.durationS,
    ),
    minimum_visible_duration_s: firstFiniteNumber(
      evidence.minimum_visible_duration_s,
      evidence.minimum_readable_duration_s,
      evidence.min_duration_s,
    ),
    max_readable_card_duration_s: firstFiniteNumber(
      evidence.max_readable_card_duration_s,
      evidence.maximum_visible_duration_s,
      evidence.maximum_readable_duration_s,
      evidence.max_duration_s,
    ),
  };
}

function internalReadableHoldFloorS({ readableText = "", wordCount = null } = {}) {
  const text = String(readableText || "").trim();
  const words =
    Number.isFinite(Number(wordCount)) && Number(wordCount) > 0
      ? Number(wordCount)
      : text.split(/\s+/).filter(Boolean).length;
  const longTokenPenalty = /\b[A-Z0-9]{6,}\b/.test(text) ? 0.5 : 0;
  const computed = Math.max(
    MIN_HYPERFRAMES_READABLE_HOLD_S,
    1.05 * Math.max(1, words) + 1.2 + longTokenPenalty,
  );
  return Number(
    Math.min(
      MAX_HYPERFRAMES_READABLE_HOLD_S,
      Math.ceil(computed * 10) / 10,
    ).toFixed(1),
  );
}

function evaluateHyperframesPremiumShellEvidence({
  cardPath,
  kind,
  storyId,
  channelId,
} = {}) {
  const sidecarPath = shellSidecarPathForCard(cardPath);
  const blockers = [];
  const warnings = [];
  const evidence = {
    kind,
    storyId,
    channelId,
    cardPath,
    sidecarPath,
  };

  if (!cardPath || !fs.existsSync(cardPath)) {
    blockers.push("hyperframes_card_missing");
    return { verdict: "fail", blockers, warnings, evidence };
  }
  if (!sidecarPath || !fs.existsSync(sidecarPath)) {
    blockers.push("hyperframes_premium_shell_sidecar_missing");
    return { verdict: "fail", blockers, warnings, evidence };
  }

  const sidecar = readJsonSafe(sidecarPath);
  if (!sidecar) {
    blockers.push("hyperframes_premium_shell_sidecar_unreadable");
    return { verdict: "fail", blockers, warnings, evidence };
  }

  const shell = sidecar.hyperframes_premium_shell || sidecar.premium_shell || {};
  evidence.generatedAt = sidecar.generated_at || shell.generated_at || null;
  evidence.projectDir = shell.project_dir || sidecar.project_dir || null;
  evidence.outputPath = shell.output_path || sidecar.output_path || null;
  evidence.checks = shell.checks || {};
  evidence.visualIdentity = shell.visual_identity || {};
  evidence.animationContract = shell.animation_contract || {};
  evidence.readabilityContract = readabilityContractFromShell(shell);

  if (String(sidecar.story_id || shell.story_id || "") !== String(storyId || "")) {
    blockers.push("hyperframes_premium_shell_story_mismatch");
  }
  if (String(sidecar.card_kind || shell.card_kind || "") !== String(kind || "")) {
    blockers.push("hyperframes_premium_shell_kind_mismatch");
  }
  if (
    channelId &&
    sidecar.channel_id &&
    String(sidecar.channel_id) !== String(channelId)
  ) {
    blockers.push("hyperframes_premium_shell_channel_mismatch");
  }

  const checks = shell.checks || {};
  for (const name of ["lint", "validate", "inspect", "render"]) {
    if (!isPassingCheck(checks[name])) {
      blockers.push(`hyperframes_${name}_not_passed`);
    }
  }
  if (checks.inspect?.skipped === true) {
    blockers.push("hyperframes_inspect_skipped");
  }
  if (!isPassingCheck(shell.visual_identity)) {
    blockers.push("hyperframes_visual_identity_not_proven");
  }
  if (!isPassingCheck(shell.animation_contract)) {
    blockers.push("hyperframes_animation_contract_not_proven");
  }
  const readability = readableDurationEvidenceFromShell(shell);
  if (!readability.contract || Object.keys(readability.contract).length === 0) {
    blockers.push("hyperframes_readability_contract_missing");
  } else if (readability.status && readability.status !== "pass" && readability.status !== "passed") {
    blockers.push("hyperframes_readability_contract_not_passed");
  }
  if (!readability.readable_text) {
    blockers.push("hyperframes_readable_text_missing");
  }
  if (readability.planned_visible_duration_s == null) {
    blockers.push("hyperframes_readable_hold_duration_missing");
  }
  if (readability.minimum_visible_duration_s == null) {
    blockers.push("hyperframes_readable_hold_minimum_missing");
  }
  if (
    readability.planned_visible_duration_s != null &&
    readability.minimum_visible_duration_s != null &&
    readability.planned_visible_duration_s + 0.001 < readability.minimum_visible_duration_s
  ) {
    blockers.push("hyperframes_readable_hold_too_short");
  }
  const conciseSourceLock =
    String(kind || "").toLowerCase() === "source" &&
    Number(readability.word_count) > 0 &&
    Number(readability.word_count) <= MAX_CONCISE_SOURCE_LOCK_WORDS &&
    readability.minimum_visible_duration_s != null &&
    readability.planned_visible_duration_s != null &&
    readability.max_readable_card_duration_s != null &&
    readability.planned_visible_duration_s <= MAX_CONCISE_SOURCE_LOCK_HOLD_S + 0.001 &&
    readability.max_readable_card_duration_s <= MAX_CONCISE_SOURCE_LOCK_HOLD_S + 0.001;
  const internalHoldFloor = conciseSourceLock
    ? readability.minimum_visible_duration_s
    : internalReadableHoldFloorS({
        readableText: readability.readable_text,
        wordCount: readability.word_count,
      });
  evidence.conciseSourceLock = conciseSourceLock;
  evidence.internalReadableHoldFloorS = internalHoldFloor;
  if (
    readability.planned_visible_duration_s != null &&
    readability.planned_visible_duration_s + 0.001 < internalHoldFloor
  ) {
    blockers.push("hyperframes_readable_hold_below_internal_floor");
  }
  const visualEvidence = shell.visual_identity?.evidence || {};
  if (visualEvidence.vertical_reel_viewport !== true) {
    blockers.push("hyperframes_vertical_reel_viewport_not_proven");
  }
  if (visualEvidence.tracked_clip !== true) {
    blockers.push("hyperframes_tracked_clip_not_proven");
  }
  if (!visualEvidence.html_path || !visualEvidence.hyperframes_config_path) {
    blockers.push("hyperframes_visual_identity_evidence_incomplete");
  }
  const animationEvidence = shell.animation_contract?.evidence || {};
  const animationStepCount = Number(
    animationEvidence.timeline_animation_steps ??
      animationEvidence.entrance_animation_steps ??
      0,
  );
  if (animationEvidence.timeline_registry !== true) {
    blockers.push("hyperframes_timeline_registry_not_proven");
  }
  if (animationEvidence.paused_gsap_timeline !== true) {
    blockers.push("hyperframes_paused_timeline_not_proven");
  }
  if (animationEvidence.main_timeline_registered !== true) {
    blockers.push("hyperframes_main_timeline_not_proven");
  }
  if (!Number.isFinite(animationStepCount) || animationStepCount < 2) {
    blockers.push("hyperframes_animation_steps_too_thin");
  }
  if (!isPassingCheck(shell)) {
    blockers.push("hyperframes_premium_shell_not_passed");
  }

  try {
    const cardStat = fs.statSync(cardPath);
    const sidecarStat = fs.statSync(sidecarPath);
    if (sidecarStat.mtimeMs + 2000 < cardStat.mtimeMs) {
      blockers.push("hyperframes_premium_shell_sidecar_stale");
    }
  } catch {
    warnings.push("hyperframes_premium_shell_freshness_not_checked");
  }

  return {
    verdict: blockers.length ? "fail" : "pass",
    blockers,
    warnings,
    evidence,
  };
}

function resolveOne(storyId, kind, root, channelId) {
  const isDefault = !channelId || channelId === "pulse-gaming";
  const channelPath =
    storyId && !isDefault
      ? path.join(
          root,
          "test",
          "output",
          `hf_${kind}_card_${storyId}__${channelId}.mp4`,
        )
      : null;
  const storyPath = storyId
    ? path.join(root, "test", "output", `hf_${kind}_card_${storyId}.mp4`)
    : null;

  if (channelPath && fs.existsSync(channelPath)) {
    return { path: channelPath, source: "story-specific-channel", channelId };
  }
  if (storyPath && fs.existsSync(storyPath)) {
    return { path: storyPath, source: "story-specific" };
  }
  return { path: null, source: null };
}

function resolveCardAssetsV2(root, storyId, channelId) {
  return {
    source: resolveOne(storyId, "source", root, channelId),
    context: resolveOne(storyId, "context", root, channelId),
    quote: resolveOne(storyId, "quote", root, channelId),
    takeaway: resolveOne(storyId, "takeaway", root, channelId),
    timeline: resolveOne(storyId, "timeline", root, channelId),
  };
}

function attachCard({ scene, descriptor, kind, decisions }) {
  if (!descriptor.path) {
    decisions.push({
      scene: scene.label,
      type: scene.type,
      renderer: "ffmpeg-fallback",
      reason: `story-specific HyperFrames ${kind} card not rendered`,
      cardSource: null,
    });
    return "ffmpeg-fallback";
  }

  scene.prerenderedMp4 = descriptor.path;
  scene.premiumLane = "hyperframes";
  const lane =
    descriptor.source === "story-specific-channel"
      ? "hyperframes-story-specific-channel"
      : "hyperframes-story-specific";
  decisions.push({
    scene: scene.label,
    type: scene.type,
    renderer: "hyperframes",
    reason:
      descriptor.source === "story-specific-channel"
        ? `using per-story per-channel ${kind} HyperFrames card`
        : `using story-specific ${kind} HyperFrames card`,
    cardSource: descriptor.source,
    ...(descriptor.channelId ? { channelId: descriptor.channelId } : {}),
  });
  return lane;
}

function cardKindForScene(scene) {
  if (scene.type === SCENE_TYPES.CARD_SOURCE) return "source";
  if (scene.type === SCENE_TYPES.CARD_STAT) return "context";
  if (scene.type === SCENE_TYPES.CARD_QUOTE) return "quote";
  if (scene.type === SCENE_TYPES.CARD_TAKEAWAY) return "takeaway";
  if (scene.type === SCENE_TYPES.CARD_TIMELINE) return "timeline";
  return null;
}

function applyPremiumCardLaneV2({ scenes, story, root, channelId }) {
  const out = scenes.map((scene) => ({ ...scene }));
  const assets = resolveCardAssetsV2(root, story?.id, channelId);
  const decisions = [];
  const attached = {};
  const shellChecks = {};

  for (const scene of out) {
    const kind = cardKindForScene(scene);
    if (!kind) continue;
    attached[kind] = attachCard({
      scene,
      descriptor: assets[kind],
      kind,
      decisions,
    });
    if (scene.premiumLane === "hyperframes") {
      shellChecks[kind] = evaluateHyperframesPremiumShellEvidence({
        cardPath: assets[kind]?.path,
        kind,
        storyId: story?.id,
        channelId,
      });
    }
  }

  const hfCount = out.filter((scene) => scene.premiumLane === "hyperframes")
    .length;
  const storySpecificCount = Object.values(attached).filter(
    (value) =>
      value === "hyperframes-story-specific" ||
      value === "hyperframes-story-specific-channel",
  ).length;
  const shellPassCount = Object.values(shellChecks).filter(
    (result) => result?.verdict === "pass",
  ).length;
  const shellBlockers = Object.entries(shellChecks).flatMap(([kind, result]) =>
    (result?.blockers || []).map((blocker) => `${kind}:${blocker}`),
  );
  const shellGateVerdict =
    hfCount >= MIN_PREMIUM_HYPERFRAMES_CARDS &&
    shellPassCount >= MIN_PREMIUM_HYPERFRAMES_CARDS &&
    shellBlockers.length === 0
      ? "pass"
      : hfCount >= 2
        ? "partial"
        : "thin";

  return {
    scenes: out,
    premiumLane: {
      rendererSplit: "ffmpeg-backbone-story-specific-hyperframes-cards",
      sourceCard: attached.source || "missing",
      contextCard: attached.context || "missing",
      quoteCard: attached.quote || null,
      takeawayCard: attached.takeaway || null,
      hyperframesCardCount: hfCount,
      storySpecificCardCount: storySpecificCount,
      premiumShellPassCount: shellPassCount,
      hyperframesPremiumShellGate: {
        verdict: shellGateVerdict,
        requiredPassCount: MIN_PREMIUM_HYPERFRAMES_CARDS,
        passCount: shellPassCount,
        blockers: shellBlockers,
        checks: shellChecks,
      },
      verdict: shellGateVerdict,
      decisions,
      assetsV2: assets,
    },
  };
}

module.exports = {
  applyPremiumCardLaneV2,
  evaluateHyperframesPremiumShellEvidence,
  HYPERFRAMES_SHELL_SIDECAR_SUFFIX,
  internalReadableHoldFloorS,
  MIN_HYPERFRAMES_READABLE_HOLD_S,
  MIN_PREMIUM_HYPERFRAMES_CARDS,
  readableDurationEvidenceFromShell,
  resolveCardAssetsV2,
  shellSidecarPathForCard,
};
