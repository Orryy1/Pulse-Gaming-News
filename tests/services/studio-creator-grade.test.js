"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildClipIntelligenceVault,
  reorderMediaByVault,
  scoreAsset,
} = require("../../lib/studio/creator-grade/clip-intelligence-vault");
const {
  runHumanStyleRewrite,
} = require("../../lib/studio/creator-grade/human-style-rewrite");
const {
  alignScriptToShots,
  classifyPhrase,
} = require("../../lib/studio/creator-grade/script-shot-aligner");
const {
  buildSemanticTimeline,
  annotateScenesWithBeats,
} = require("../../lib/studio/creator-grade/semantic-timeline-director");
const {
  analyseVisualTimeline,
} = require("../../lib/studio/creator-grade/creator-visual-qa");
const {
  planSoundDesign,
  rejectRecurringSound,
} = require("../../lib/studio/creator-grade/sound-design-composer");
const {
  planRetentionAB,
} = require("../../lib/studio/creator-grade/retention-ab-engine");
const {
  buildCreatorGradePlan,
  renderCreatorGradeMarkdown,
} = require("../../lib/studio/creator-grade/orchestrator");

const media = {
  clips: [
    { path: "C:/cache/metro_clip_A.mp4", kind: "trailer-clip", durationS: 5 },
    { path: "C:/cache/metro_clip_B.mp4", kind: "trailer-clip", durationS: 5 },
  ],
  trailerFrames: [
    { path: "C:/cache/metro_trailerframe_1.jpg", kind: "trailer-frame" },
    { path: "C:/cache/metro_trailerframe_2.jpg", kind: "trailer-frame" },
  ],
  articleHeroes: [{ path: "C:/cache/metro_article.jpg", kind: "article" }],
  stockFillers: [{ path: "C:/cache/metro_pexels_0.jpg", kind: "stock" }],
};

test("clip vault ranks topical clips and rejects stock filler", () => {
  const clip = scoreAsset({ path: "metro_clip_A.mp4", kind: "trailer-clip", durationS: 5 });
  const stock = scoreAsset({ path: "metro_pexels_0.jpg", kind: "stock" });
  assert.ok(clip.score > stock.score);
  const vault = buildClipIntelligenceVault({ storyId: "s1", media });
  assert.equal(vault.stats.clipCount, 2);
  assert.equal(vault.stats.stockRejected, 1);
  assert.equal(vault.best.hook.kind, "trailer-clip");
});

test("reorderMediaByVault follows vault ranking and suppresses stock", () => {
  const vault = buildClipIntelligenceVault({ storyId: "s1", media });
  const reordered = reorderMediaByVault(media, vault);
  assert.equal(reordered.stockFillers.length, 0);
  assert.ok(reordered.clips[0].path.includes("clip"));
});

test("human style rewrite removes AI tells and filler", () => {
  const rewrite = runHumanStyleRewrite({
    title: "Metro 2039 trailer",
    script:
      "You won't believe this. Basically, Metro 2039 is real. But here's where it gets interesting. The trailer is grim.",
  });
  assert.ok(rewrite.removedAiTells.length >= 2);
  assert.ok(rewrite.removedFiller.length >= 1);
  assert.doesNotMatch(rewrite.tightenedScript, /you won't believe/i);
});

test("script-shot aligner maps phrases to suitable vault assets", () => {
  const vault = buildClipIntelligenceVault({ storyId: "s1", media });
  assert.deepEqual(classifyPhrase("The official trailer is live."), ["official"]);
  const aligned = alignScriptToShots({
    script: "The official trailer is live. Seven years later, the date is still unknown.",
    vault,
  });
  assert.equal(aligned.phraseCount, 2);
  assert.equal(aligned.alignedCount, 2);
  assert.ok(aligned.coverage > 0.9);
});

test("semantic director creates seven beats and annotates scenes", () => {
  const vault = buildClipIntelligenceVault({ storyId: "s1", media });
  const timeline = buildSemanticTimeline({
    story: { id: "s1", top_comment: "Looks grim" },
    script: "The official trailer is live. Seven years later, the date is still unknown. Fans are worried.",
    vault,
    runtimeS: 56,
  });
  assert.equal(timeline.beats.length, 7);
  const scenes = annotateScenesWithBeats(
    [
      { type: "opener", duration: 4 },
      { type: "card.source", duration: 4 },
      { type: "clip.frame", duration: 4 },
    ],
    timeline,
  );
  assert.equal(scenes[0].directorBeat, "hook");
});

test("visual QA flags stock and repeated sources", () => {
  const vault = buildClipIntelligenceVault({ storyId: "s1", media });
  const qa = analyseVisualTimeline({
    scenes: [
      { type: "still", source: "same.jpg", duration: 4 },
      { type: "still", source: "same.jpg", duration: 4 },
      { type: "still", source: "same.jpg", duration: 4 },
      { type: "still", source: "metro_pexels_0.jpg", _stock: true },
    ],
    vault,
    timeline: { beats: [] },
  });
  assert.equal(qa.verdict, "reject");
  assert.ok(qa.issues.some((i) => i.code === "stock_scene"));
});

test("sound composer rejects repeated/periodic cues", () => {
  const bad = rejectRecurringSound({
    cues: [
      { kind: "whoosh", atS: 1 },
      { kind: "whoosh", atS: 2 },
      { kind: "whoosh", atS: 3 },
    ],
  });
  assert.equal(bad.verdict, "review");
  const good = planSoundDesign({
    timeline: {
      runtimeS: 54,
      beats: [
        { type: "hook", startS: 0 },
        { type: "proof", startS: 8, cardAllowance: 1 },
        { type: "quote", startS: 40, cardAllowance: 1 },
        { type: "end_lock", startS: 50 },
      ],
    },
  });
  assert.equal(good.verdict, "pass");
});

test("retention A/B engine chooses a conservative candidate", () => {
  const vault = buildClipIntelligenceVault({ storyId: "s1", media });
  const ab = planRetentionAB({
    vault,
    timeline: { beats: Array.from({ length: 7 }, () => ({})) },
    visualQa: { beatCoverage: ["hook", "proof", "context", "quote", "payoff"] },
  });
  assert.ok(ab.winner);
  assert.ok(ab.winner.score >= 70);
});

test("creator-grade orchestrator returns a complete local report", () => {
  const plan = buildCreatorGradePlan({
    story: {
      id: "s1",
      title: "Metro 2039 trailer",
      full_script:
        "The official trailer is live. Seven years later, the date is still unknown. Fans are worried.",
      top_comment: "Looks grim",
    },
    media,
    scenes: [
      { type: "opener", source: "C:/cache/metro_clip_A.mp4", duration: 4 },
      { type: "card.source", backgroundSource: "C:/cache/metro_trailerframe_1.jpg", duration: 4 },
      { type: "clip.frame", source: "C:/cache/metro_trailerframe_2.jpg", duration: 4 },
    ],
  });
  assert.ok(plan.vault.stats.acceptedAssets >= 5);
  assert.ok(plan.timeline.beats.length >= 7);
  assert.match(renderCreatorGradeMarkdown(plan), /Creator-Grade Studio Brain/);
});

test("studio-v2-render wires creator-grade mode behind an explicit env flag", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-render.js"),
    "utf8",
  );
  assert.match(src, /STUDIO_CREATOR_GRADE === "true"/);
  assert.match(src, /reorderMediaByVault\(media, creatorGradePlan\.vault\)/);
  assert.match(src, /report\.creatorGrade/);
});
