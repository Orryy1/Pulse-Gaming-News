/**
 * lib/studio/v2/premium-card-lane-v2.js — premium card routing v2.
 *
 * Routes 4 card scene types onto the HyperFrames lane:
 *   - card.source   → hf_source_card_<id>.mp4 (per-story) ‖ hf_source_card_v1.mp4
 *   - card.stat     → hf_context_card_<id>.mp4 (per-story) ‖ hf_context_card_v1.mp4
 *   - card.quote    → hf_quote_card_<id>.mp4 (per-story) ‖ hf_quote_card_v1.mp4
 *   - card.takeaway → hf_takeaway_card_<id>.mp4 (per-story) ‖ hf_takeaway_card_v1.mp4
 *
 * Per-story renders are produced by tools/studio-v2-build-cards.js
 * which content-derives source/context/quote/takeaway from the
 * story package.
 *
 * Verdict:
 *   - pass    — 3+ HF cards attached (typically all 4 if the slate
 *               carries source + stat + quote + takeaway)
 *   - partial — 2 HF cards attached
 *   - thin    — 0 or 1 HF cards attached
 *
 * If a HyperFrames card is missing entirely, the scene falls back to
 * its ffmpeg renderer. Decisions log records which renderer ran for
 * each card and whether the per-story override was used.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { SCENE_TYPES } = require("../../scene-composer");
const {
  applyPremiumCardLane: applyPremiumCardLaneV1,
} = require("../premium-card-lane");

function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p)) || null;
}

/**
 * Build the per-card asset descriptor:
 *   { path, source: "story-specific-channel" | "story-specific" | "generic" | null }
 *
 * Resolution order:
 *   1. Per-story per-channel render (`hf_<kind>_card_<id>__<channel>.mp4`)
 *   2. Per-story (Pulse Gaming default) render (`hf_<kind>_card_<id>.mp4`)
 *   3. Generic v1 template render (`hf_<kind>_card_v1.mp4`)
 *   4. Experiments fallback (`experiments/hf-<kind>/<kind>-card.mp4`)
 */
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
  const v1Path = path.join(root, "test", "output", `hf_${kind}_card_v1.mp4`);
  const expPath = path.join(
    root,
    "experiments",
    `hf-${kind}`,
    `${kind}-card.mp4`,
  );
  if (channelPath && fs.existsSync(channelPath)) {
    return { path: channelPath, source: "story-specific-channel", channelId };
  }
  if (storyPath && fs.existsSync(storyPath)) {
    return { path: storyPath, source: "story-specific" };
  }
  if (fs.existsSync(v1Path)) return { path: v1Path, source: "generic" };
  if (fs.existsSync(expPath)) return { path: expPath, source: "generic" };
  return { path: null, source: null };
}

function resolveCardAssetsV2(root, storyId, channelId) {
  return {
    source: resolveOne(storyId, "source", root, channelId),
    context: resolveOne(storyId, "context", root, channelId),
    quote: resolveOne(storyId, "quote", root, channelId),
    takeaway: resolveOne(storyId, "takeaway", root, channelId),
  };
}

function attachCard({ scene, descriptor, kind, decisions }) {
  if (!descriptor.path) {
    decisions.push({
      scene: scene.label,
      type: scene.type,
      renderer: "ffmpeg-fallback",
      reason: `HyperFrames ${kind} card not rendered yet`,
    });
    return "ffmpeg-fallback";
  }
  scene.prerenderedMp4 = descriptor.path;
  scene.premiumLane = "hyperframes";
  let lane = "hyperframes";
  let reason = `using generic ${kind} HyperFrames card`;
  if (descriptor.source === "story-specific-channel") {
    lane = "hyperframes-story-specific-channel";
    reason = `per-story per-channel ${kind} card (${descriptor.channelId}) — using channel render`;
  } else if (descriptor.source === "story-specific") {
    lane = "hyperframes-story-specific";
    reason = `story-specific ${kind} card found — using per-story render`;
  }
  decisions.push({
    scene: scene.label,
    type: scene.type,
    renderer: "hyperframes",
    reason,
    cardSource: descriptor.source,
  });
  return lane;
}

function applyPremiumCardLaneV2({ scenes, story, root, channelId }) {
  // Run the v1 pass first so source + context get their initial
  // hyperframes routing decisions logged. Then we override v1's
  // prerenderedMp4 paths with per-story versions where available.
  const v1Result = applyPremiumCardLaneV1({ scenes, story, root });
  const out = v1Result.scenes.map((scene) => ({ ...scene }));
  const assets = resolveCardAssetsV2(root, story?.id, channelId);
  const decisions = [];

  const attached = {};

  for (const scene of out) {
    let kind = null;
    let descriptor = null;
    if (scene.type === SCENE_TYPES.CARD_SOURCE) {
      kind = "source";
      descriptor = assets.source;
    } else if (scene.type === SCENE_TYPES.CARD_STAT) {
      kind = "context";
      descriptor = assets.context;
    } else if (scene.type === SCENE_TYPES.CARD_QUOTE) {
      kind = "quote";
      descriptor = assets.quote;
    } else if (scene.type === SCENE_TYPES.CARD_TAKEAWAY) {
      kind = "takeaway";
      descriptor = assets.takeaway;
    }

    if (!kind || !descriptor) continue;

    // For source/context, v1 may have already set prerenderedMp4 to
    // its generic version. Override only if we have a story-specific
    // or channel-specific upgrade. For quote/takeaway, v1 doesn't
    // touch them — we always attach.
    const v1AlreadySet = !!scene.prerenderedMp4;
    const isUpgrade =
      descriptor.source === "story-specific" ||
      descriptor.source === "story-specific-channel";
    if (v1AlreadySet && !isUpgrade) {
      // Keep v1's choice; just log the decision parity
      decisions.push({
        scene: scene.label,
        type: scene.type,
        renderer: "hyperframes",
        reason: "v1 lane already attached generic HF card",
        cardSource: "generic",
      });
      attached[kind] = "hyperframes";
      continue;
    }
    if (v1AlreadySet && isUpgrade) {
      // Override with the upgraded version
      scene.prerenderedMp4 = descriptor.path;
      scene.premiumLane = "hyperframes";
      const upgradeKind =
        descriptor.source === "story-specific-channel"
          ? "story-specific-channel"
          : "story-specific";
      decisions.push({
        scene: scene.label,
        type: scene.type,
        renderer: "hyperframes",
        reason: `upgraded to ${upgradeKind} ${kind} card`,
        cardSource: descriptor.source,
        ...(descriptor.channelId ? { channelId: descriptor.channelId } : {}),
      });
      attached[kind] =
        descriptor.source === "story-specific-channel"
          ? "hyperframes-story-specific-channel"
          : "hyperframes-story-specific";
      continue;
    }
    // Neither v1 nor we have set anything — try to attach.
    attached[kind] = attachCard({ scene, descriptor, kind, decisions });
  }

  const hfCount = out.filter((s) => s.premiumLane === "hyperframes").length;
  const storySpecificCount = Object.values(attached).filter(
    (v) => v === "hyperframes-story-specific",
  ).length;
  const verdict = hfCount >= 3 ? "pass" : hfCount >= 2 ? "partial" : "thin";

  return {
    scenes: out,
    premiumLane: {
      ...v1Result.premiumLane,
      sourceCard: attached.source || v1Result.premiumLane.sourceCard,
      contextCard: attached.context || v1Result.premiumLane.contextCard,
      quoteCard: attached.quote || null,
      takeawayCard: attached.takeaway || null,
      hyperframesCardCount: hfCount,
      storySpecificCardCount: storySpecificCount,
      verdict,
      decisions,
      assetsV2: assets,
    },
  };
}

module.exports = {
  applyPremiumCardLaneV2,
  resolveCardAssetsV2,
};
