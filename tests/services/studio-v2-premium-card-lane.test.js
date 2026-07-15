"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const { SCENE_TYPES } = require("../../lib/scene-composer");
const {
  applyPremiumCardLaneV2,
  MIN_HYPERFRAMES_READABLE_HOLD_S,
  MIN_PREMIUM_HYPERFRAMES_CARDS,
  resolveCardAssetsV2,
  shellSidecarPathForCard,
} = require("../../lib/studio/v2/premium-card-lane-v2");

function cardScenes() {
  return [
    { type: SCENE_TYPES.CARD_SOURCE, label: "card_source", duration: 4 },
    { type: SCENE_TYPES.CARD_STAT, label: "card_context", duration: 4 },
    { type: SCENE_TYPES.CARD_QUOTE, label: "card_quote", duration: 4 },
    { type: SCENE_TYPES.CARD_TAKEAWAY, label: "card_takeaway", duration: 4 },
    { type: SCENE_TYPES.CARD_TIMELINE, label: "card_timeline", duration: 4 },
  ];
}

async function writePassingShellSidecar(
  cardPath,
  {
    storyId,
    kind,
    channelId = "pulse-gaming",
    readableText = `${kind} proof card`,
    wordCount = 3,
    plannedVisibleDurationS = 12,
    minimumVisibleDurationS = plannedVisibleDurationS,
    maximumVisibleDurationS = null,
    unifiedCheck = false,
  } = {},
) {
  await fs.writeJson(
    shellSidecarPathForCard(cardPath),
    {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      story_id: storyId,
      card_kind: kind,
      channel_id: channelId,
      output_path: cardPath,
      project_dir: "experiments/mock",
      hyperframes_premium_shell: {
        status: "pass",
        story_id: storyId,
        card_kind: kind,
        channel_id: channelId,
        checks: unifiedCheck
          ? {
              check: { status: "pass" },
              render: { status: "pass" },
            }
          : {
              lint: { status: "pass" },
              validate: { status: "pass" },
              inspect: { status: "pass", skipped: false },
              render: { status: "pass" },
            },
        visual_identity: {
          status: "pass",
          evidence: {
            html_path: "experiments/mock/index.html",
            hyperframes_config_path: "experiments/mock/hyperframes.json",
            backdrop_path: "experiments/mock/assets/backdrop.jpg",
            vertical_reel_viewport: true,
            tracked_clip: true,
          },
        },
        animation_contract: {
          status: "pass",
          evidence: {
            timeline_registry: true,
            paused_gsap_timeline: true,
            main_timeline_registered: true,
            entrance_animation_steps: 3,
            timeline_animation_steps: 3,
          },
        },
        readability_contract: {
          status: "pass",
          evidence: {
            readable_text: readableText,
            word_count: wordCount,
            planned_visible_duration_s: plannedVisibleDurationS,
            minimum_visible_duration_s: minimumVisibleDurationS,
            ...(maximumVisibleDurationS == null
              ? {}
              : { max_readable_card_duration_s: maximumVisibleDurationS }),
          },
        },
      },
    },
    { spaces: 2 },
  );
}

test("premium card lane v2 accepts the current unified HyperFrames check contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-unified-check-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    for (const kind of ["source", "context", "quote", "takeaway"]) {
      const cardPath = path.join(outDir, `hf_${kind}_card_story-1.mp4`);
      await fs.writeFile(cardPath, "story");
      await writePassingShellSidecar(cardPath, {
        storyId: "story-1",
        kind,
        unifiedCheck: true,
        ...(kind === "source"
          ? {
              readableText: "KOTAKU NEWS SOURCE",
              wordCount: 3,
              plannedVisibleDurationS: 2.6,
              minimumVisibleDurationS: 1.9,
              maximumVisibleDurationS: 3.1,
            }
          : {
              plannedVisibleDurationS: 4.2,
              minimumVisibleDurationS: 3.4,
              maximumVisibleDurationS: 5.2,
            }),
      });
    }

    const result = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Black Flag Resynced" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(result.premiumLane.verdict, "pass");
    assert.deepEqual(result.premiumLane.hyperframesPremiumShellGate.blockers, []);
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

async function writeStatusOnlyShellSidecar(cardPath, { storyId, kind, channelId = "pulse-gaming" }) {
  await fs.writeJson(
    shellSidecarPathForCard(cardPath),
    {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      story_id: storyId,
      card_kind: kind,
      channel_id: channelId,
      output_path: cardPath,
      project_dir: "experiments/mock",
      hyperframes_premium_shell: {
        status: "pass",
        story_id: storyId,
        card_kind: kind,
        channel_id: channelId,
        checks: {
          lint: { status: "pass" },
          validate: { status: "pass" },
          inspect: { status: "pass", skipped: false },
          render: { status: "pass" },
        },
        visual_identity: { status: "pass" },
        animation_contract: { status: "pass" },
      },
    },
    { spaces: 2 },
  );
}

test("premium card lane v2 refuses generic HyperFrames cards by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-generic-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    for (const kind of ["source", "context", "quote", "takeaway", "timeline"]) {
      await fs.writeFile(path.join(outDir, `hf_${kind}_card_v1.mp4`), "generic");
    }

    const assets = resolveCardAssetsV2(root, "story-1", "pulse-gaming");
    assert.equal(assets.source.path, null);
    assert.equal(assets.source.source, null);

    const result = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(result.premiumLane.hyperframesCardCount, 0);
    assert.equal(result.premiumLane.storySpecificCardCount, 0);
    assert.equal(result.premiumLane.verdict, "thin");
    assert.ok(result.scenes.every((scene) => !scene.prerenderedMp4));
    assert.ok(
      result.premiumLane.decisions.every(
        (decision) => decision.renderer === "ffmpeg-fallback",
      ),
    );
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("premium card lane v2 attaches only story-specific cards", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-story-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    await fs.writeFile(path.join(outDir, "hf_source_card_story-1.mp4"), "story");
    await fs.writeFile(path.join(outDir, "hf_context_card_story-1.mp4"), "story");

    const result = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(result.premiumLane.hyperframesCardCount, 2);
    assert.equal(result.premiumLane.storySpecificCardCount, 2);
    assert.equal(result.premiumLane.verdict, "partial");
    assert.ok(
      result.scenes.some((scene) =>
        String(scene.prerenderedMp4 || "").endsWith("hf_source_card_story-1.mp4"),
      ),
    );
    assert.ok(
      result.premiumLane.decisions.some(
        (decision) => decision.cardSource === "story-specific",
      ),
    );
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("premium card lane v2 requires four story-specific HyperFrames cards to pass", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-threshold-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    for (const kind of ["source", "context", "quote"]) {
      await fs.writeFile(path.join(outDir, `hf_${kind}_card_story-1.mp4`), "story");
    }

    const threeCardResult = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(MIN_PREMIUM_HYPERFRAMES_CARDS, 4);
    assert.equal(threeCardResult.premiumLane.hyperframesCardCount, 3);
    assert.equal(threeCardResult.premiumLane.verdict, "partial");

    await fs.writeFile(path.join(outDir, "hf_takeaway_card_story-1.mp4"), "story");
    const fourCardsNoShellResult = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(fourCardsNoShellResult.premiumLane.hyperframesCardCount, 4);
    assert.equal(fourCardsNoShellResult.premiumLane.verdict, "partial");
    assert.ok(
      fourCardsNoShellResult.premiumLane.hyperframesPremiumShellGate.blockers.some(
        (blocker) => blocker.includes("hyperframes_premium_shell_sidecar_missing"),
      ),
    );

    for (const kind of ["source", "context", "quote", "takeaway"]) {
      await writePassingShellSidecar(path.join(outDir, `hf_${kind}_card_story-1.mp4`), {
        storyId: "story-1",
        kind,
      });
    }
    const fourCardResult = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(fourCardResult.premiumLane.verdict, "pass");
    assert.equal(fourCardResult.premiumLane.premiumShellPassCount, 4);
    assert.equal(fourCardResult.premiumLane.hyperframesPremiumShellGate.verdict, "pass");
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("premium card lane v2 rejects shells when HyperFrames inspect was skipped", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-shell-skip-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    for (const kind of ["source", "context", "quote", "takeaway"]) {
      const cardPath = path.join(outDir, `hf_${kind}_card_story-1.mp4`);
      await fs.writeFile(cardPath, "story");
      await writePassingShellSidecar(cardPath, { storyId: "story-1", kind });
    }
    const sourceSidecar = shellSidecarPathForCard(
      path.join(outDir, "hf_source_card_story-1.mp4"),
    );
    const shell = await fs.readJson(sourceSidecar);
    shell.hyperframes_premium_shell.status = "fail";
    shell.hyperframes_premium_shell.checks.inspect = {
      status: "skipped",
      skipped: true,
    };
    await fs.writeJson(sourceSidecar, shell, { spaces: 2 });

    const result = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(result.premiumLane.verdict, "partial");
    assert.ok(
      result.premiumLane.hyperframesPremiumShellGate.blockers.includes(
        "source:hyperframes_inspect_skipped",
      ),
    );
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("premium card lane v2 rejects status-only shell sidecars without concrete proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-shell-empty-proof-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    for (const kind of ["source", "context", "quote", "takeaway"]) {
      const cardPath = path.join(outDir, `hf_${kind}_card_story-1.mp4`);
      await fs.writeFile(cardPath, "story");
      await writeStatusOnlyShellSidecar(cardPath, { storyId: "story-1", kind });
    }

    const result = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(result.premiumLane.verdict, "partial");
    assert.ok(
      result.premiumLane.hyperframesPremiumShellGate.blockers.includes(
        "source:hyperframes_visual_identity_evidence_incomplete",
      ),
    );
    assert.ok(
      result.premiumLane.hyperframesPremiumShellGate.blockers.includes(
        "source:hyperframes_main_timeline_not_proven",
      ),
    );
    assert.ok(
      result.premiumLane.hyperframesPremiumShellGate.blockers.includes(
        "source:hyperframes_animation_steps_too_thin",
      ),
    );
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("premium card lane v2 rejects shell sidecars without readable hold proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-shell-readable-proof-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    for (const kind of ["source", "context", "quote", "takeaway"]) {
      const cardPath = path.join(outDir, `hf_${kind}_card_story-1.mp4`);
      await fs.writeFile(cardPath, "story");
      await writePassingShellSidecar(cardPath, { storyId: "story-1", kind });
    }
    const sourceSidecar = shellSidecarPathForCard(
      path.join(outDir, "hf_source_card_story-1.mp4"),
    );
    const shell = await fs.readJson(sourceSidecar);
    delete shell.hyperframes_premium_shell.readability_contract;
    await fs.writeJson(sourceSidecar, shell, { spaces: 2 });

    const result = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(result.premiumLane.verdict, "partial");
    assert.ok(
      result.premiumLane.hyperframesPremiumShellGate.blockers.includes(
        "source:hyperframes_readability_contract_missing",
      ),
    );
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("premium card lane v2 accepts V5 proof-card holds without reimposing old 12s dwell", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-shell-legacy-dwell-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    for (const kind of ["source", "context", "quote", "takeaway"]) {
      const cardPath = path.join(outDir, `hf_${kind}_card_story-1.mp4`);
      await fs.writeFile(cardPath, "story");
      await writePassingShellSidecar(cardPath, {
        storyId: "story-1",
        kind,
        plannedVisibleDurationS: 6.5,
      });
    }

    const result = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(MIN_HYPERFRAMES_READABLE_HOLD_S, 3.4);
    assert.equal(result.premiumLane.verdict, "pass");
    assert.deepEqual(result.premiumLane.hyperframesPremiumShellGate.blockers, []);
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("premium card lane v2 accepts a concise source lock under its V5 1.9-3.1s contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-source-lock-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    for (const kind of ["source", "context", "quote", "takeaway"]) {
      const cardPath = path.join(outDir, `hf_${kind}_card_story-1.mp4`);
      await fs.writeFile(cardPath, "story");
      await writePassingShellSidecar(cardPath, {
        storyId: "story-1",
        kind,
        ...(kind === "source"
          ? {
              readableText: "BANDAI NAMCO ENTERTAINMENT AMERICA NEWS SOURCE",
              wordCount: 6,
              plannedVisibleDurationS: 2.2,
              minimumVisibleDurationS: 1.9,
              maximumVisibleDurationS: 3.1,
            }
          : {}),
      });
    }

    const result = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Digimon Story" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(result.premiumLane.verdict, "pass");
    assert.equal(
      result.premiumLane.hyperframesPremiumShellGate.checks.source.evidence
        .internalReadableHoldFloorS,
      1.9,
    );
    assert.deepEqual(result.premiumLane.hyperframesPremiumShellGate.blockers, []);
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("premium card lane v2 rejects cards that are faster than Pulse readable dwell", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-shell-too-fast-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    for (const kind of ["source", "context", "quote", "takeaway"]) {
      const cardPath = path.join(outDir, `hf_${kind}_card_story-1.mp4`);
      await fs.writeFile(cardPath, "story");
      await writePassingShellSidecar(cardPath, { storyId: "story-1", kind });
    }
    const sourceSidecar = shellSidecarPathForCard(
      path.join(outDir, "hf_source_card_story-1.mp4"),
    );
    const shell = await fs.readJson(sourceSidecar);
    shell.hyperframes_premium_shell.readability_contract = {
      status: "pass",
      evidence: {
        readable_text:
          "PLAYERS NEED PRICE, EDITIONS, PLATFORM DETAIL AND A REAL REASON TO CARE",
        word_count: 12,
        planned_visible_duration_s: 2.4,
        minimum_visible_duration_s: 2.4,
      },
    };
    await fs.writeJson(sourceSidecar, shell, { spaces: 2 });

    const result = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(result.premiumLane.verdict, "partial");
    assert.ok(
      result.premiumLane.hyperframesPremiumShellGate.blockers.includes(
        "source:hyperframes_readable_hold_below_internal_floor",
      ),
    );
  } finally {
    await fs.remove(root).catch(() => {});
  }
});
