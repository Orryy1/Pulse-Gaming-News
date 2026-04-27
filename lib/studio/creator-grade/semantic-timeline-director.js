"use strict";

const { alignScriptToShots } = require("./script-shot-aligner");

const BEAT_ORDER = [
  "hook",
  "proof",
  "escalation",
  "context",
  "quote",
  "payoff",
  "end_lock",
];

function pickAlignment(alignments, tags, fallbackIndex = 0) {
  return (
    alignments.find((a) => tags.some((tag) => a.tags.includes(tag))) ||
    alignments[fallbackIndex] ||
    null
  );
}

function buildBeat({ id, type, startRatio, endRatio, energy, alignment, treatment, cardAllowance = 0 }) {
  return {
    id,
    type,
    startRatio,
    endRatio,
    energy,
    scriptPhrase: alignment?.text || null,
    semanticTags: alignment?.tags || [],
    preferredAssetId: alignment?.assetId || null,
    preferredAssetFile: alignment?.assetFile || null,
    preferredAssetKind: alignment?.assetKind || null,
    treatment,
    cardAllowance,
  };
}

function buildSemanticTimeline({
  story = {},
  script = "",
  vault = {},
  runtimeS = 54,
} = {}) {
  const alignment = alignScriptToShots({ script, vault });
  const a = alignment.alignments;

  const beats = [
    buildBeat({
      id: "beat_hook",
      type: "hook",
      startRatio: 0,
      endRatio: 0.1,
      energy: "high",
      alignment: pickAlignment(a, ["official", "grim"], 0),
      treatment: "clip-first cold open with immediate kinetic caption.",
    }),
    buildBeat({
      id: "beat_proof",
      type: "proof",
      startRatio: 0.1,
      endRatio: 0.24,
      energy: "high",
      alignment: pickAlignment(a, ["official", "source"], 1),
      treatment: "source-confirmation proof beat; one card allowed if it confirms credibility.",
      cardAllowance: 1,
    }),
    buildBeat({
      id: "beat_escalation",
      type: "escalation",
      startRatio: 0.24,
      endRatio: 0.42,
      energy: "medium-high",
      alignment: pickAlignment(a, ["grim"], 2),
      treatment: "two motion cuts or punch pair; no repeated still cycling.",
    }),
    buildBeat({
      id: "beat_context",
      type: "context",
      startRatio: 0.42,
      endRatio: 0.58,
      energy: "medium",
      alignment: pickAlignment(a, ["timing", "unknown"], 3),
      treatment: "timeline or context reframe card, followed by footage.",
      cardAllowance: 1,
    }),
    buildBeat({
      id: "beat_quote",
      type: "quote",
      startRatio: 0.58,
      endRatio: 0.76,
      energy: "medium",
      alignment: pickAlignment(a, ["quote"], 4),
      treatment: story.top_comment ? "viewer quote impact card earns one authored beat." : "skip quote card if no meaningful comment.",
      cardAllowance: story.top_comment ? 1 : 0,
    }),
    buildBeat({
      id: "beat_payoff",
      type: "payoff",
      startRatio: 0.76,
      endRatio: 0.9,
      energy: "high",
      alignment: pickAlignment(a, ["unknown", "official"], 5),
      treatment: "return to best footage; answer what is and is not confirmed.",
    }),
    buildBeat({
      id: "beat_end_lock",
      type: "end_lock",
      startRatio: 0.9,
      endRatio: 1,
      energy: "controlled",
      alignment: pickAlignment(a, ["grim", "timing"], Math.max(0, a.length - 1)),
      treatment: "branded end-lock with one final concrete takeaway.",
      cardAllowance: 1,
    }),
  ];

  return {
    storyId: story.id || null,
    runtimeS,
    beatOrder: BEAT_ORDER,
    beats: beats.map((beat) => ({
      ...beat,
      startS: Number((beat.startRatio * runtimeS).toFixed(2)),
      endS: Number((beat.endRatio * runtimeS).toFixed(2)),
    })),
    alignment,
    rules: [
      "No stock filler in premium output.",
      "No more than one card inside a beat.",
      "At least four beats must use motion or trailer-frame evidence.",
      "Quote and source cards must be earned by script meaning.",
      "End-lock must not duplicate opener branding.",
    ],
  };
}

function annotateScenesWithBeats(scenes = [], timeline = {}) {
  const beats = timeline.beats || [];
  const totalDuration =
    timeline.runtimeS ||
    scenes.reduce((sum, scene) => sum + Number(scene.duration || 0), 0) ||
    1;
  let cursor = 0;
  return scenes.map((scene) => {
    const midRatio =
      (cursor + Number(scene.duration || 0) / 2) / totalDuration;
    const beat = beats.find((b) => midRatio >= b.startRatio && midRatio < b.endRatio) || beats[beats.length - 1];
    cursor += Number(scene.duration || 0);
    return {
      ...scene,
      directorBeat: beat?.type || null,
      directorTreatment: beat?.treatment || null,
    };
  });
}

module.exports = {
  BEAT_ORDER,
  annotateScenesWithBeats,
  buildSemanticTimeline,
};
