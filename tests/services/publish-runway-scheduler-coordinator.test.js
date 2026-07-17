"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  createPublishRunwaySchedulerCoordinator,
} = require("../../lib/ops/publish-runway-scheduler-coordinator");
const {
  resolvePublishWindow,
} = require("../../lib/ops/publish-runway-lock-controller");

const T180 = "2026-07-17T06:00:00.000Z";
const T90 = "2026-07-17T07:30:00.000Z";
const T0 = "2026-07-17T09:00:00.000Z";
const GENERATION_ID = "runway-20260717-0900-v1";
const RUNWAY_IDS = Array.from(
  { length: 5 },
  (_, index) => `runway-story-${index + 1}`,
);
const RESERVE_IDS = Array.from(
  { length: 5 },
  (_, index) => `reserve-story-${index + 1}`,
);

function windowForT180() {
  return resolvePublishWindow({
    at: new Date(T180),
    phase: "T-180",
    publishHoursUtc: [9],
    phaseToleranceMs: 0,
  });
}

function youtubeAction(storyId, assets, overrides = {}) {
  return {
    action_id: `${storyId}:youtube_shorts`,
    story_id: storyId,
    platform: "youtube_shorts",
    platform_enabled: true,
    youtube_first: true,
    executable: true,
    verdict: "GREEN",
    blockers: [],
    video_path: assets.video,
    captions_path: assets.captions,
    first_frame_source: assets.video,
    canonical_manifest_path: assets.canonicalManifest,
    platform_publish_manifest_path: assets.platformManifest,
    final_audio_path: assets.audio,
    word_timestamps_path: assets.timestamps,
    rights_ledger_path: assets.rights,
    source_manifest_path: assets.sourceManifest,
    claim_inventory_path: assets.claimInventory,
    ...overrides,
  };
}

function reserveStory(storyId) {
  return {
    story_id: storyId,
    role: "reserve",
    verdict: "GREEN",
    blockers: [],
    youtube_first: true,
    enabled_platforms: ["youtube_shorts"],
  };
}

async function writeStoryAssets(allowedRoot, storyId) {
  const storyRoot = path.join(allowedRoot, "stories", storyId);
  const assets = {
    video: path.join(storyRoot, "final.mp4"),
    captions: path.join(storyRoot, "captions.srt"),
    canonicalManifest: path.join(storyRoot, "canonical-manifest.json"),
    platformManifest: path.join(storyRoot, "youtube-publish-manifest.json"),
    audio: path.join(storyRoot, "final-audio.wav"),
    timestamps: path.join(storyRoot, "word-timestamps.json"),
    rights: path.join(storyRoot, "rights-ledger.json"),
    sourceManifest: path.join(storyRoot, "source-manifest.json"),
    claimInventory: path.join(storyRoot, "claim-inventory.json"),
  };
  await fs.outputFile(assets.video, Buffer.alloc(4096, storyId.length));
  await fs.outputFile(
    assets.captions,
    "1\n00:00:00,000 --> 00:00:02,000\nPulse Gaming\n",
  );
  await fs.writeJson(assets.canonicalManifest, {
    story_id: storyId,
    verdict: "GREEN",
  });
  await fs.writeJson(assets.platformManifest, {
    story_id: storyId,
    platform: "youtube_shorts",
    verdict: "GREEN",
  });
  await fs.outputFile(assets.audio, Buffer.alloc(2048, storyId.length + 1));
  await fs.writeJson(assets.timestamps, {
    words: [{ word: "Pulse", start: 0, end: 0.3 }],
  });
  await fs.writeJson(assets.rights, {
    verdict: "pass",
    used_assets: [{ asset_id: `${storyId}-motion-1`, rights_status: "cleared" }],
  });
  await fs.writeJson(assets.sourceManifest, {
    story_id: storyId,
    sources: [{ source_id: `${storyId}-official`, authority: "official" }],
  });
  await fs.writeJson(assets.claimInventory, {
    story_id: storyId,
    claims: [{ claim_id: `${storyId}-claim-1`, verified: true }],
  });
  return assets;
}

function envelope(windowId, overrides = {}) {
  return {
    generation_id: "source-evidence-generation",
    window_id: windowId,
    generated_at: T180,
    verdict: "GREEN",
    blockers: [],
    critical_inputs: [],
    enabled_platforms: ["youtube_shorts"],
    disabled_platforms: ["tiktok", "x", "threads", "pinterest"],
    ...overrides,
  };
}

async function writeEvidenceSet(allowedRoot, overrides = {}) {
  const window = windowForT180();
  const assetsByStory = new Map();
  for (const storyId of RUNWAY_IDS) {
    assetsByStory.set(
      storyId,
      await writeStoryAssets(allowedRoot, storyId),
    );
  }
  const actions = RUNWAY_IDS.map((storyId) =>
    youtubeAction(storyId, assetsByStory.get(storyId)),
  );
  const reserves = RESERVE_IDS.map(reserveStory);
  const documents = {
    candidate: envelope(window.window_id, {
      candidates: [
        ...RUNWAY_IDS.map((storyId) => ({
          story_id: storyId,
          verdict: "GREEN",
          blockers: [],
          youtube_first: true,
          enabled_platforms: ["youtube_shorts"],
        })),
        ...reserves,
      ],
      reserve_stories: reserves,
    }),
    preflight: envelope(window.window_id, {
      executable_actions: actions,
      reserve_stories: reserves,
    }),
    dry_run: envelope(window.window_id, {
      actions: actions.map((action) => ({
        ...action,
        action: "would_publish",
        autonomous_green_lit_by_dry_run: true,
      })),
    }),
    guarded: envelope(window.window_id, {
      ready_for_guarded_dispatch: true,
      dispatch_ready_actions: actions,
    }),
    executor: envelope(window.window_id, {
      ready_for_live_executor_handoff: true,
      handoff_ready_actions: actions,
    }),
  };
  for (const [name, patch] of Object.entries(overrides.documents || {})) {
    documents[name] = {
      ...documents[name],
      ...patch,
    };
  }
  if (typeof overrides.mutate === "function") {
    await overrides.mutate({ documents, actions, assetsByStory });
  }

  const evidenceRoot = path.join(allowedRoot, "evidence");
  const evidencePaths = {};
  for (const [name, document] of Object.entries(documents)) {
    const evidencePath = path.join(evidenceRoot, `${name}.json`);
    await fs.outputJson(evidencePath, document, { spaces: 2 });
    evidencePaths[name] = evidencePath;
  }
  return { actions, assetsByStory, documents, evidencePaths, window };
}

async function fixture(t) {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-coordinator-"),
  );
  t.after(() => fs.remove(rootDir));
  const allowedRoot = path.join(rootDir, "allowed");
  const storeRoot = path.join(rootDir, "store");
  await fs.ensureDir(allowedRoot);
  return {
    rootDir,
    allowedRoot,
    storeRoot,
    coordinator: createPublishRunwaySchedulerCoordinator({
      allowedRoot,
      rootDir: storeRoot,
      publishHoursUtc: [9],
      phaseToleranceMs: 0,
    }),
  };
}

async function generateGreen(t) {
  const context = await fixture(t);
  const evidence = await writeEvidenceSet(context.allowedRoot);
  const generated = await context.coordinator.generateAtT180({
    at: new Date(T180),
    generationId: GENERATION_ID,
    evidencePaths: evidence.evidencePaths,
  });
  return { ...context, ...evidence, generated };
}

test("T-180 normalises five concrete documents, captures critical assets and commits only a strict 5+5 GREEN generation", async (t) => {
  const { coordinator, generated, actions, window } = await generateGreen(t);

  assert.equal(generated.verdict, "GREEN");
  assert.equal(generated.reconciliation.verdict, "GREEN");
  assert.equal(generated.reconciliation.can_auto_publish, true);
  assert.equal(
    generated.reconciliation.summary.executable_youtube_first_story_count,
    5,
  );
  assert.equal(generated.reconciliation.summary.reserve_story_count, 5);
  assert.deepEqual(
    generated.selected_action_ids,
    actions.map((action) => action.action_id),
  );

  const generationPath = generated.generation.generation_path;
  const normalisedExecutor = await fs.readJson(
    path.join(generationPath, "evidence", "executor-evidence.json"),
  );
  const rawExecutor = await fs.readJson(
    path.join(generationPath, "raw-evidence", "executor.json"),
  );
  assert.equal(normalisedExecutor.generation_id, GENERATION_ID);
  assert.equal(normalisedExecutor.window_id, window.window_id);
  assert.equal(normalisedExecutor.generated_at, T180);
  assert.equal(rawExecutor.generation_id, "source-evidence-generation");
  for (const action of normalisedExecutor.handoff_ready_actions) {
    for (const field of [
      "video_path",
      "captions_path",
      "canonical_manifest_path",
      "platform_publish_manifest_path",
      "final_audio_path",
      "word_timestamps_path",
      "rights_ledger_path",
      "source_manifest_path",
      "claim_inventory_path",
    ]) {
      assert.equal(
        path.relative(generationPath, action[field]).startsWith(".."),
        false,
        `${field} must point inside the immutable generation`,
      );
      assert.equal(await fs.pathExists(action[field]), true);
    }
  }

  const locked = await coordinator.lockAtT90({
    at: new Date(T90),
    generationId: GENERATION_ID,
    windowId: window.window_id,
    selectedActionIds: generated.selected_action_ids,
  });
  assert.equal(locked.verdict, "GREEN");

  const resolved = await coordinator.readExecutorPlanAtT0({
    at: new Date(T0),
    generationId: GENERATION_ID,
    windowId: window.window_id,
    selectedActionIds: generated.selected_action_ids,
  });
  assert.equal(resolved.verdict, "GREEN");
  assert.equal(resolved.executor_plan.generation_id, GENERATION_ID);
  assert.deepEqual(resolved.selected_action_ids, generated.selected_action_ids);
  assert.deepEqual(
    resolved.executor_plan.handoff_ready_actions.map(
      (action) => action.action_id,
    ),
    generated.selected_action_ids,
  );
});

test("T-180 propagates an explicit reserve target through reconciliation and immutable binding", async (t) => {
  const { allowedRoot, coordinator } = await fixture(t);
  const extraReserveIds = [
    "reserve-story-6",
    "reserve-story-7",
    "reserve-story-8",
  ];
  const evidence = await writeEvidenceSet(allowedRoot, {
    mutate: ({ documents }) => {
      const extraReserves = extraReserveIds.map(reserveStory);
      documents.candidate.candidates.push(...extraReserves);
      documents.candidate.reserve_stories.push(...extraReserves);
      documents.preflight.reserve_stories.push(...extraReserves);
    },
  });

  const generated = await coordinator.generateAtT180({
    at: new Date(T180),
    generationId: `${GENERATION_ID}-reserve-8`,
    evidencePaths: evidence.evidencePaths,
    targetReserveCount: 8,
  });

  assert.equal(generated.verdict, "GREEN");
  assert.equal(generated.reconciliation.targets.runway_story_count, 5);
  assert.equal(generated.reconciliation.targets.reserve_story_count, 8);
  assert.equal(generated.reconciliation.summary.reserve_story_count, 8);
  assert.equal(generated.reserve_story_ids.length, 8);
  assert.deepEqual(generated.reserve_target, {
    requested_story_count: 8,
    effective_story_count: 8,
    minimum_story_count: 5,
    maximum_story_count: 25,
  });
});

test("mixed source generations and stale source evidence fail before immutable commit", async (t) => {
  const { allowedRoot, storeRoot, coordinator } = await fixture(t);
  const mixed = await writeEvidenceSet(allowedRoot, {
    documents: {
      guarded: { generation_id: "another-source-generation" },
    },
  });
  await assert.rejects(
    coordinator.generateAtT180({
      at: new Date(T180),
      generationId: GENERATION_ID,
      evidencePaths: mixed.evidencePaths,
    }),
    (error) => error.code === "SOURCE_EVIDENCE_GENERATION_MIXED",
  );
  assert.equal(
    await fs.pathExists(path.join(storeRoot, "generations", GENERATION_ID)),
    false,
  );

  const stale = await writeEvidenceSet(allowedRoot, {
    documents: {
      preflight: { generated_at: "2026-07-17T03:59:59.999Z" },
    },
  });
  await assert.rejects(
    coordinator.generateAtT180({
      at: new Date(T180),
      generationId: `${GENERATION_ID}-stale`,
      evidencePaths: stale.evidencePaths,
    }),
    (error) => error.code === "SOURCE_EVIDENCE_STALE",
  );
});

test("AMBER or RED input remains non-GREEN and is never committed", async (t) => {
  const states = ["AMBER", "RED"];
  for (const verdict of states) {
    await t.test(verdict, async (subtest) => {
      const { allowedRoot, storeRoot, coordinator } = await fixture(subtest);
      const evidence = await writeEvidenceSet(allowedRoot, {
        documents: {
          dry_run: { verdict },
        },
      });
      await assert.rejects(
        coordinator.generateAtT180({
          at: new Date(T180),
          generationId: `${GENERATION_ID}-${verdict.toLowerCase()}`,
          evidencePaths: evidence.evidencePaths,
        }),
        (error) =>
          error.code === "RUNWAY_RECONCILIATION_NOT_STRICT_GREEN" &&
          error.reconciliation?.verdict === verdict,
      );
      assert.equal(
        await fs.pathExists(
          path.join(
            storeRoot,
            "generations",
            `${GENERATION_ID}-${verdict.toLowerCase()}`,
          ),
        ),
        false,
      );
    });
  }
});

test("missing or out-of-root critical files fail RED before generation commit", async (t) => {
  await t.test("missing", async (subtest) => {
    const { allowedRoot, coordinator } = await fixture(subtest);
    const evidence = await writeEvidenceSet(allowedRoot, {
      mutate: async ({ assetsByStory }) => {
        await fs.remove(assetsByStory.get(RUNWAY_IDS[0]).video);
      },
    });
    await assert.rejects(
      coordinator.generateAtT180({
        at: new Date(T180),
        generationId: `${GENERATION_ID}-missing`,
        evidencePaths: evidence.evidencePaths,
      }),
      (error) => error.code === "CRITICAL_FILE_MISSING",
    );
  });

  await t.test("outside allowed root", async (subtest) => {
    const { rootDir, allowedRoot, coordinator } = await fixture(subtest);
    const outsideVideo = path.join(rootDir, "outside.mp4");
    await fs.outputFile(outsideVideo, Buffer.alloc(4096, 7));
    const evidence = await writeEvidenceSet(allowedRoot, {
      mutate: ({ documents }) => {
        for (const name of ["preflight", "dry_run", "guarded", "executor"]) {
          const collection =
            documents[name].executable_actions ||
            documents[name].actions ||
            documents[name].dispatch_ready_actions ||
            documents[name].handoff_ready_actions;
          collection[0].video_path = outsideVideo;
          collection[0].first_frame_source = outsideVideo;
        }
      },
    });
    await assert.rejects(
      coordinator.generateAtT180({
        at: new Date(T180),
        generationId: `${GENERATION_ID}-outside`,
        evidencePaths: evidence.evidencePaths,
      }),
      (error) => error.code === "CRITICAL_FILE_OUTSIDE_ALLOWED_ROOT",
    );
  });
});

test("action ids must match exactly across preflight, dry-run, guarded and executor evidence", async (t) => {
  const { allowedRoot, coordinator } = await fixture(t);
  const evidence = await writeEvidenceSet(allowedRoot, {
    mutate: ({ documents }) => {
      documents.executor.handoff_ready_actions[0].action_id =
        "runway-story-1:youtube_shorts:substituted";
    },
  });

  await assert.rejects(
    coordinator.generateAtT180({
      at: new Date(T180),
      generationId: `${GENERATION_ID}-action-mismatch`,
      evidencePaths: evidence.evidencePaths,
    }),
    (error) => error.code === "RUNWAY_ACTION_ID_MISMATCH",
  );
});

test("T0 rejects generation, window or selected-action drift", async (t) => {
  const {
    coordinator,
    generated,
    window,
  } = await generateGreen(t);
  await coordinator.lockAtT90({
    at: new Date(T90),
    generationId: GENERATION_ID,
    windowId: window.window_id,
    selectedActionIds: generated.selected_action_ids,
  });

  await assert.rejects(
    coordinator.readExecutorPlanAtT0({
      at: new Date(T0),
      generationId: "wrong-generation",
      windowId: window.window_id,
      selectedActionIds: generated.selected_action_ids,
    }),
    (error) => error.code === "T0_GENERATION_ID_MISMATCH",
  );
  await assert.rejects(
    coordinator.readExecutorPlanAtT0({
      at: new Date(T0),
      generationId: GENERATION_ID,
      windowId: "wrong-window",
      selectedActionIds: generated.selected_action_ids,
    }),
    (error) => error.code === "T0_WINDOW_ID_MISMATCH",
  );
  await assert.rejects(
    coordinator.readExecutorPlanAtT0({
      at: new Date(T0),
      generationId: GENERATION_ID,
      windowId: window.window_id,
      selectedActionIds: generated.selected_action_ids.slice(1),
    }),
    (error) => error.code === "T0_ACTION_ID_MISMATCH",
  );
});

test("T0 verifies the immutable executor plan and never accepts a mutable global fallback", async (t) => {
  const {
    rootDir,
    coordinator,
    generated,
    window,
  } = await generateGreen(t);
  await coordinator.lockAtT90({
    at: new Date(T90),
    generationId: GENERATION_ID,
    windowId: window.window_id,
    selectedActionIds: generated.selected_action_ids,
  });

  const mutableFallbackPath = path.join(rootDir, "global-executor-plan.json");
  await fs.writeJson(mutableFallbackPath, {
    verdict: "GREEN",
    generation_id: GENERATION_ID,
    window_id: window.window_id,
    handoff_ready_actions: [],
  });
  await fs.appendFile(
    path.join(
      generated.generation.generation_path,
      "evidence",
      "executor-evidence.json",
    ),
    "\n",
  );

  await assert.rejects(
    coordinator.readExecutorPlanAtT0({
      at: new Date(T0),
      generationId: GENERATION_ID,
      windowId: window.window_id,
      selectedActionIds: generated.selected_action_ids,
      executorPlanPath: mutableFallbackPath,
      globalExecutorPlanPath: mutableFallbackPath,
    }),
    (error) => error.code === "GENERATION_FILE_SHA256_MISMATCH",
  );
});

test("controller RED results are thrown by coordinator phase entry points", async (t) => {
  const { coordinator } = await fixture(t);

  await assert.rejects(
    coordinator.lockAtT90({
      at: new Date(T90),
      generationId: "missing-generation",
      windowId: windowForT180().window_id,
      selectedActionIds: RUNWAY_IDS.map(
        (storyId) => `${storyId}:youtube_shorts`,
      ),
    }),
    (error) => error.code === "GENERATION_NOT_FOUND",
  );
  await assert.rejects(
    coordinator.readExecutorPlanAtT0({
      at: new Date(T0),
      generationId: "missing-generation",
      windowId: windowForT180().window_id,
      selectedActionIds: RUNWAY_IDS.map(
        (storyId) => `${storyId}:youtube_shorts`,
      ),
    }),
    (error) => error.code === "T90_GENERATION_LOCK_MISSING",
  );
});
