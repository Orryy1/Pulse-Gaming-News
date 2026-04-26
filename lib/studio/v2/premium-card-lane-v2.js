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
 *   { path, source: "story-specific" | "generic" | null }
 */
function resolveOne(storyId, kind, root) {
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
  if (storyPath && fs.existsSync(storyPath)) {
    return { path: storyPath, source: "story-specific" };
  }
  if (fs.existsSync(v1Path)) return { path: v1Path, source: "generic" };
  if (fs.existsSync(expPath)) return { path: expPath, source: "generic" };
  return { path: null, source: null };
}

function resolveCardAssetsV2(root, storyId) {
  return {
    source: resolveOne(storyId, "source", root),
    context: resolveOne(storyId, "context", root),
    quote: resolveOne(storyId, "quote", root),
    takeaway: resolveOne(storyId, "takeaway", root),
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
  const lane =
    descriptor.source === "story-specific"
      ? "hyperframes-story-specific"
      : "hyperframes";
  decisions.push({
    scene: scene.label,
    type: scene.type,
    renderer: "hyperframes",
    reason:
      descriptor.source === "story-specific"
        ? `story-specific ${kind} card found — using per-story render`
        : `using generic ${kind} HyperFrames card`,
    cardSource: descriptor.source,
  });
  return lane;
}

function applyPremiumCardLaneV2({ scenes, story, root }) {
  // Run the v1 pass first so source + context get their initial
  // hyperframes routing decisions logged. Then we override v1's
  // prerenderedMp4 paths with per-story versions where available.
  const v1Result = applyPremiumCardLaneV1({ scenes, story, root });
  const out = v1Result.scenes.map((scene) => ({ ...scene }));
  const assets = resolveCardAssetsV2(root, story?.id);
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
    // upgrade. For quote/takeaway, v1 doesn't touch them — we always
    // attach.
    const v1AlreadySet = !!scene.prerenderedMp4;
    if (v1AlreadySet && descriptor.source !== "story-specific") {
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
    if (v1AlreadySet && descriptor.source === "story-specific") {
      // Override with the per-story version
      scene.prerenderedMp4 = descriptor.path;
      scene.premiumLane = "hyperframes";
      decisions.push({
        scene: scene.label,
        type: scene.type,
        renderer: "hyperframes",
        reason: `upgraded to story-specific ${kind} card`,
        cardSource: "story-specific",
      });
      attached[kind] = "hyperframes-story-specific";
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
