"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArgs } = require("../../tools/goal-owned-motion-materializer");

test("goal owned motion materializer CLI parses local arguments", () => {
  const args = parseArgs([
    "--work-order",
    "work.json",
    "--out-dir",
    "out",
    "--root",
    "repo",
    "--generated-at",
    "2026-05-22T05:20:00.000Z",
    "--story-packages",
    "story-packages.json",
    "--refresh-existing",
    "--dry-run",
    "--json",
  ]);

  assert.equal(args.workOrderPath, "work.json");
  assert.equal(args.outDir, "out");
  assert.equal(args.root, "repo");
  assert.equal(args.generatedAt, "2026-05-22T05:20:00.000Z");
  assert.equal(args.storyPackagesPath, "story-packages.json");
  assert.equal(args.refreshExisting, true);
  assert.equal(args.dryRun, true);
  assert.equal(args.json, true);
});

test("goal owned motion materializer CLI writes reports without publish side effects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-motion-cli-"));
  const artifactDir = path.join(root, "story-package");
  const outDir = path.join(root, "out");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-cli",
    canonical_subject: "Star Fox",
    selected_title: "Star Fox Deal Has One Catch",
    thumbnail_headline: "STAR FOX CATCH",
    primary_source: "IGN",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "story-cli",
    motion_inventory: {
      accepted_local_clips: [
        {
          id: "story-cli-owned-motion-1",
          source_family: "story-cli_hook_slam",
          path: "output/generated-motion/story-cli/hook_slam.mp4",
          source_url: "local://pulse-generated-motion/story-cli/hook_slam",
          source_type: "internally_generated_motion_graphic",
          rights_risk_class: "owned_generated_motion",
          durationS: 2.8,
          validated: true,
        },
      ],
    },
  });
  const workOrderPath = path.join(root, "work-order.json");
  await fs.outputJson(workOrderPath, {
    jobs: [
      {
        story_id: "story-cli",
        title: "Star Fox Deal Has One Catch",
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_owned_generated_motion_clips" }],
      },
    ],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--work-order",
      workOrderPath,
      "--out-dir",
      outDir,
      "--root",
      root,
      "--generated-at",
      "2026-05-22T05:25:00.000Z",
      "--json",
    ], {
      execFileSync: (bin, args) => fs.outputFileSync(args[args.length - 1], Buffer.alloc(2500, 9)),
      ffprobeDuration: () => 2.8,
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.materialized_clip_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "owned_motion_materialization_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "owned_motion_materialization_report.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "owned_motion_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "materialised_motion_clips.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "distinct_motion_family_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "render_input_work_order.json")), true);
  assert.equal(result.report.safety.no_publish_triggered, true);
  assert.equal(result.report.safety.no_external_media_downloads, true);
});

test("goal owned motion materializer CLI derives jobs from governed story packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-motion-story-packages-"));
  const missingDir = path.join(root, "missing-package");
  const readyDir = path.join(root, "ready-package");
  const ownedReadyDir = path.join(root, "owned-ready-package");
  const outDir = path.join(root, "out");
  await fs.outputJson(path.join(missingDir, "canonical_story_manifest.json"), {
    story_id: "missing-story",
    canonical_subject: "Hollow Knight Silksong",
    selected_title: "Silksong Date Finally Has Proof",
    thumbnail_headline: "SILKSONG DATE PROOF",
    first_spoken_line: "Silksong finally has a source-backed date clue.",
    confirmed_claims: ["A store listing added a dated Silksong entry."],
    primary_source: "Eurogamer",
    source_card_label: "Eurogamer",
  });
  await fs.outputJson(path.join(missingDir, "footage_inventory.json"), {
    story_id: "missing-story",
    motion_inventory: { accepted_local_clips: [] },
  });
  await fs.outputJson(path.join(missingDir, "rights_ledger.json"), { records: [] });
  await fs.outputJson(path.join(readyDir, "materialised_motion_clips.json"), {
    status: "ready",
    clip_count: 5,
    distinct_motion_family_count: 5,
    clips: Array.from({ length: 5 }, (_, index) => ({
      id: `ready-${index + 1}`,
      path: path.join(readyDir, `ready-${index + 1}.mp4`),
      motion_family: `ready_family_${index + 1}`,
    })),
  });
  await fs.outputJson(path.join(readyDir, "distinct_motion_family_report.json"), {
    status: "ready",
    summary: { distinct_motion_family_count: 5 },
    families: ["a", "b", "c", "d", "e"],
  });
  const ownedReadyClips = Array.from({ length: 5 }, (_, index) => {
    const clipPath = path.join(ownedReadyDir, `owned-ready-${index + 1}.mp4`);
    fs.outputFileSync(clipPath, Buffer.alloc(2500, index + 1));
    return {
      id: `owned-ready-motion-${index + 1}`,
      source_family: `owned_ready_family_${index + 1}`,
      motion_family: `owned_ready_family_${index + 1}`,
      path: clipPath,
      source_url: `local://pulse-generated-motion/owned-ready/${index + 1}`,
      source_type: "internally_generated_motion_graphic",
      rights_risk_class: "owned_generated_motion",
      durationS: 2.8,
      counts_towards_motion_readiness: true,
    };
  });
  await fs.outputJson(path.join(ownedReadyDir, "canonical_story_manifest.json"), {
    story_id: "owned-ready-story",
    canonical_subject: "Xbox",
    selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
    primary_source: "IGN",
  });
  await fs.outputJson(path.join(ownedReadyDir, "footage_inventory.json"), {
    story_id: "owned-ready-story",
    motion_inventory: {
      accepted_local_clips: ownedReadyClips,
      production_motion_clips: ownedReadyClips,
    },
  });
  await fs.outputJson(path.join(ownedReadyDir, "materialised_motion_clips.json"), {
    status: "ready",
    clip_count: 5,
    distinct_motion_family_count: 5,
    clips: ownedReadyClips,
  });
  await fs.outputJson(path.join(ownedReadyDir, "owned_motion_manifest.json"), {
    status: "ready",
    materialised_clips: ownedReadyClips,
  });
  const storyPackagesPath = path.join(root, "story-packages.json");
  await fs.outputJson(storyPackagesPath, [
    { story_id: "missing-story", artifact_dir: missingDir },
    { story_id: "ready-story", artifact_dir: readyDir },
    { story_id: "owned-ready-story", artifact_dir: ownedReadyDir },
  ]);
  const workOrderPath = path.join(root, "work-order.json");
  await fs.outputJson(workOrderPath, { jobs: [] });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--work-order",
      workOrderPath,
      "--story-packages",
      storyPackagesPath,
      "--out-dir",
      outDir,
      "--root",
      root,
      "--generated-at",
      "2026-05-24T16:00:00.000Z",
      "--json",
    ], {
      execFileSync: (bin, args) => fs.outputFileSync(args[args.length - 1], Buffer.alloc(2500, 4)),
      ffprobeDuration: () => 2.8,
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.source_story_package_count, 3);
  assert.equal(result.report.summary.story_count, 2);
  assert.equal(result.report.summary.materialized_clip_count, 21);
  assert.equal(result.report.summary.existing_clip_count, 5);
  assert.equal(result.report.stories[0].story_id, "missing-story");

  const generatedWorkOrder = await fs.readJson(path.join(outDir, "render_input_work_order.json"));
  assert.equal(generatedWorkOrder.summary.source_story_package_count, 3);
  assert.equal(generatedWorkOrder.summary.story_count, 2);
  assert.equal(generatedWorkOrder.summary.owned_motion_materialisation_jobs, 2);
  assert.equal(generatedWorkOrder.summary.real_motion_materialisation_jobs, undefined);
  assert.equal(generatedWorkOrder.jobs.length, 2);
  assert.equal(generatedWorkOrder.jobs[0].actions[0].action_id, "materialise_owned_generated_motion_clips");
});

test("goal owned motion materializer derives jobs when ready-looking clips repeat one direct source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-motion-repeat-source-"));
  const repeatedDir = path.join(root, "repeated-direct-package");
  const outDir = path.join(root, "out");
  const repeatedClips = Array.from({ length: 5 }, (_, index) => ({
    id: `repeat-${index + 1}`,
    path: path.join(repeatedDir, `repeat-${index + 1}.mp4`),
    source_url: index < 4
      ? "https://publisher.example/videos/trailer-1.mp4"
      : "https://publisher.example/videos/trailer-2.mp4",
    source_asset_key: index < 4
      ? "https://publisher.example/videos/trailer-1.mp4"
      : "https://publisher.example/videos/trailer-2.mp4",
    source_family: `official_trailer_window_${index + 1}`,
    motion_family: `official_trailer_window_${index + 1}`,
    media_kind: "direct_video",
    source_type: "official_game_website_media_page",
    durationS: 5,
    counts_towards_motion_readiness: true,
  }));
  await fs.outputJson(path.join(repeatedDir, "canonical_story_manifest.json"), {
    story_id: "repeated-direct-story",
    canonical_subject: "GTA VI",
    selected_title: "GTA VI Just Made PS5 The Version To Watch",
    primary_source: "Rockstar Games",
  });
  await fs.outputJson(path.join(repeatedDir, "materialised_motion_clips.json"), {
    status: "ready",
    clip_count: 5,
    distinct_motion_family_count: 5,
    clips: repeatedClips,
  });
  await fs.outputJson(path.join(repeatedDir, "distinct_motion_family_report.json"), {
    status: "ready",
    summary: { distinct_motion_family_count: 5 },
    families: repeatedClips.map((clip) => clip.motion_family),
  });
  await fs.outputJson(path.join(repeatedDir, "footage_inventory.json"), {
    story_id: "repeated-direct-story",
    motion_inventory: { accepted_local_clips: repeatedClips },
  });
  const storyPackagesPath = path.join(root, "story-packages.json");
  await fs.outputJson(storyPackagesPath, [
    { story_id: "repeated-direct-story", artifact_dir: repeatedDir },
  ]);
  const workOrderPath = path.join(root, "work-order.json");
  await fs.outputJson(workOrderPath, { jobs: [] });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--work-order",
      workOrderPath,
      "--story-packages",
      storyPackagesPath,
      "--out-dir",
      outDir,
      "--root",
      root,
      "--generated-at",
      "2026-06-27T23:10:00.000Z",
      "--dry-run",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.story_count, 1);
  assert.equal(result.report.stories[0].story_id, "repeated-direct-story");
});

test("goal owned motion materializer CLI preserves existing direct-video work orders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-motion-preserve-workorder-"));
  const artifactDir = path.join(root, "story-package");
  const outDir = path.join(root, "out");
  await fs.ensureDir(outDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "xbox-platform-story",
    canonical_subject: "Xbox",
    selected_title: "Xbox's Monetisation Pressure",
    thumbnail_headline: "XBOX MONEY PRESSURE",
    first_spoken_line: "Xbox has a monetisation problem players can actually see.",
    primary_source: "PC Gamer",
    source_card_label: "PC Gamer",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "xbox-platform-story",
    motion_inventory: { accepted_local_clips: [] },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { records: [] });

  const directVideoWorkOrderPath = path.join(outDir, "render_input_work_order.json");
  await fs.outputJson(directVideoWorkOrderPath, {
    schema_version: 1,
    mode: "DIRECT_VIDEO_ENRICHMENT_WORK_ORDER",
    jobs: [
      {
        story_id: "xbox-platform-story",
        artifact_dir: artifactDir,
        blocker_type: "direct_video_motion_missing",
        actions: [
          {
            action_id: "materialise_validated_real_motion_clips",
            repair_lane: "validated_real_motion_materialisation",
          },
        ],
      },
    ],
  });
  const storyPackagesPath = path.join(root, "story-packages.json");
  await fs.outputJson(storyPackagesPath, [
    { story_id: "xbox-platform-story", artifact_dir: artifactDir },
  ]);

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--work-order",
      directVideoWorkOrderPath,
      "--story-packages",
      storyPackagesPath,
      "--out-dir",
      outDir,
      "--root",
      root,
      "--generated-at",
      "2026-06-22T12:00:00.000Z",
      "--json",
    ], {
      execFileSync: (bin, args) => fs.outputFileSync(args[args.length - 1], Buffer.alloc(2500, 6)),
      ffprobeDuration: () => 2.8,
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.materialized_clip_count, 21);
  const preservedDirectWorkOrder = await fs.readJson(directVideoWorkOrderPath);
  assert.equal(preservedDirectWorkOrder.mode, "DIRECT_VIDEO_ENRICHMENT_WORK_ORDER");
  assert.equal(
    preservedDirectWorkOrder.jobs[0].actions[0].action_id,
    "materialise_validated_real_motion_clips",
  );
  const ownedMotionWorkOrder = await fs.readJson(path.join(outDir, "owned_motion_render_input_work_order.json"));
  assert.equal(ownedMotionWorkOrder.mode, "LOCAL_OWNED_GENERATED_MOTION_WORK_ORDER");
  assert.equal(ownedMotionWorkOrder.jobs[0].actions[0].action_id, "materialise_owned_generated_motion_clips");
  assert.equal(result.written.renderInputWorkOrderPreserved, true);
});

test("goal owned motion materializer CLI dry-runs without materialising clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-motion-dry-run-"));
  const artifactDir = path.join(root, "story-package");
  const outDir = path.join(root, "out");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "dry-story",
    canonical_subject: "Hades 2",
    selected_title: "Hades 2 Patch Changes Boons",
    thumbnail_headline: "HADES 2 BOON PATCH",
    primary_source: "Steam",
    primary_source_url: "https://store.steampowered.com/news/app/1145350",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "dry-story",
    motion_inventory: {
      accepted_local_clips: [
        {
          id: "dry-story-owned-motion-1",
          source_family: "dry_story_hook_slam",
          path: "output/generated-motion/dry-story/hook_slam.mp4",
          source_url: "local://pulse-generated-motion/dry-story/hook_slam",
          source_type: "internally_generated_motion_graphic",
          rights_risk_class: "owned_generated_motion",
          durationS: 2.8,
          validated: true,
        },
      ],
    },
  });
  const workOrderPath = path.join(root, "work-order.json");
  await fs.outputJson(workOrderPath, {
    jobs: [
      {
        story_id: "dry-story",
        title: "Hades 2 Patch Changes Boons",
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_owned_generated_motion_clips" }],
      },
    ],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--work-order",
      workOrderPath,
      "--story-id",
      "dry-story",
      "--out-dir",
      outDir,
      "--root",
      root,
      "--generated-at",
      "2026-06-01T09:30:00.000Z",
      "--dry-run",
      "--json",
    ], {
      execFileSync: () => {
        throw new Error("ffmpeg must not run during dry-run");
      },
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.dry_run, true);
  assert.equal(result.report.mode, "OWNED_GENERATED_MOTION_MATERIALIZATION_DRY_RUN");
  assert.equal(result.report.summary.story_count, 1);
  assert.equal(result.report.summary.planned_clip_count, 1);
  assert.equal(result.report.summary.materialized_clip_count, 0);
  assert.equal(result.report.stories[0].status, "dry_run_planned");
  assert.equal(await fs.pathExists(path.join(root, "output", "generated-motion", "dry-story", "hook_slam.mp4")), false);
  assert.equal(await fs.pathExists(path.join(artifactDir, "materialised_motion_clips.json")), false);
  assert.equal(await fs.pathExists(path.join(outDir, "owned_motion_materialization_report.json")), true);
});
