"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { SCENE_TYPES } = require("../scene-composer");

function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p)) || null;
}

function resolveCardAssets(root) {
  return {
    sourceCard: firstExisting([
      path.join(root, "test", "output", "hf_source_card_v1.mp4"),
      path.join(root, "experiments", "hf-source", "source-card.mp4"),
    ]),
    contextCard: firstExisting([
      path.join(root, "test", "output", "hf_context_card_v1.mp4"),
      path.join(root, "experiments", "hf-context", "context-card.mp4"),
    ]),
  };
}

function buildContextCardScene(scene, story) {
  const metro = /metro\s+2039/i.test(story?.title || "");
  return {
    ...scene,
    type: SCENE_TYPES.CARD_STAT,
    label: "card_context",
    cardKind: "context",
    statLabel: metro ? "7 YEARS QUIET" : "CONTEXT",
    sublabel: metro ? "EXODUS LANDED IN 2019" : "WHY THIS MATTERS",
  };
}

function applyPremiumCardLane({ scenes, story, root }) {
  const assets = resolveCardAssets(root);
  const out = scenes.map((scene) => ({ ...scene }));
  const decisions = [];

  let sourceAttached = false;
  let contextAttached = false;
  let duplicateSourceCount = 0;

  for (let i = 0; i < out.length; i++) {
    const scene = out[i];
    if (scene.type === SCENE_TYPES.CARD_SOURCE) {
      if (!sourceAttached) {
        sourceAttached = true;
        if (assets.sourceCard) {
          scene.prerenderedMp4 = assets.sourceCard;
          scene.premiumLane = "hyperframes";
          decisions.push({
            scene: scene.label,
            type: scene.type,
            renderer: "hyperframes",
            reason: "source card is typographic and benefits from HTML motion",
          });
        } else {
          decisions.push({
            scene: scene.label,
            type: scene.type,
            renderer: "ffmpeg",
            reason: "HyperFrames source card missing",
          });
        }
      } else {
        duplicateSourceCount++;
        out[i] = buildContextCardScene(scene, story);
      }
    }
  }

  let context = out.find((scene) => scene.type === SCENE_TYPES.CARD_STAT);
  if (!context) {
    const releaseIdx = out.findIndex(
      (scene) => scene.type === SCENE_TYPES.CARD_RELEASE,
    );
    if (releaseIdx >= 0) {
      out[releaseIdx] = buildContextCardScene(out[releaseIdx], story);
      context = out[releaseIdx];
    }
  }

  if (context) {
    contextAttached = true;
    if (assets.contextCard) {
      context.prerenderedMp4 = assets.contextCard;
      context.premiumLane = "hyperframes";
      decisions.push({
        scene: context.label,
        type: context.type,
        renderer: "hyperframes",
        reason: "context card is a premium typography beat",
      });
    } else {
      decisions.push({
        scene: context.label,
        type: context.type,
        renderer: "ffmpeg-fallback",
        reason: "HyperFrames context card missing",
      });
    }
  }

  const hfCount = out.filter((scene) => scene.premiumLane === "hyperframes")
    .length;
  const verdict = hfCount >= 2 ? "pass" : "partial";

  return {
    scenes: out,
    premiumLane: {
      rendererSplit: "ffmpeg-backbone-hyperframes-cards",
      sourceCard: sourceAttached ? (assets.sourceCard ? "hyperframes" : "ffmpeg") : "missing",
      contextCard: contextAttached
        ? assets.contextCard
          ? "hyperframes"
          : "ffmpeg-fallback"
        : "missing",
      hyperframesCardCount: hfCount,
      duplicateSourceCardsConverted: duplicateSourceCount,
      verdict,
      decisions,
      assets,
    },
  };
}

module.exports = {
  applyPremiumCardLane,
  resolveCardAssets,
  buildContextCardScene,
};
