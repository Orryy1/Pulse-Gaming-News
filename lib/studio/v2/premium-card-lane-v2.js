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

  for (const scene of out) {
    const kind = cardKindForScene(scene);
    if (!kind) continue;
    attached[kind] = attachCard({
      scene,
      descriptor: assets[kind],
      kind,
      decisions,
    });
  }

  const hfCount = out.filter((scene) => scene.premiumLane === "hyperframes")
    .length;
  const storySpecificCount = Object.values(attached).filter(
    (value) =>
      value === "hyperframes-story-specific" ||
      value === "hyperframes-story-specific-channel",
  ).length;

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
      verdict: hfCount >= 3 ? "pass" : hfCount >= 2 ? "partial" : "thin",
      decisions,
      assetsV2: assets,
    },
  };
}

module.exports = {
  applyPremiumCardLaneV2,
  resolveCardAssetsV2,
};
