"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildLocalPromotionRenderInputWorkOrder,
  buildCanonicalStoryManifest,
  buildFreshGreenBufferLocalPromotionReport,
  buildSourceManifest,
  writeFreshGreenBufferLocalPromotionArtifacts,
} = require("../../lib/fresh-green-buffer-local-promotion");
const mediaHousePrivate = require("../../lib/pulse-media-house-score")._private;
const { parseArgs } = require("../../tools/fresh-green-buffer-local-promotion");
const packageJson = require("../../package.json");

function draftStory(overrides = {}) {
  return {
    id: "fresh_xbox_halo_campaign_evolved_demo_20260610",
    title: "Halo: Campaign Evolved Shows The Real Remake Test",
    canonical_subject: "Halo: Campaign Evolved",
    canonical_game: "Halo: Campaign Evolved",
    primary_source: {
      name: "Xbox Wire",
      url: "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
      type: "official_platform_news",
    },
    primary_source_url: "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
    source_published_at: "2026-06-10T00:00:00.000Z",
    confirmed_claims: [
      "Xbox Wire says Halo: Campaign Evolved showed Assault on the Control Room in hands-on demo form.",
    ],
    unconfirmed_claims: [],
    thumbnail_headline: "HALO'S REAL TEST",
    narration_script:
      "Halo: Campaign Evolved just put the remake debate where it belongs. Xbox Wire says Halo Studios showed Assault on the Control Room in hands-on form. Follow Pulse Gaming so you never miss a beat.",
    ...overrides,
  };
}

test("fresh buffer promotion writes local package work orders without publish or DB side effects", async () => {
  const generatedAt = "2026-06-12T08:00:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [draftStory()],
    generatedAt,
  });

  assert.equal(report.mode, "LOCAL_ONLY_FRESH_GREEN_BUFFER_PROMOTION");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.local_package_count, 1);
  assert.equal(report.summary.scheduler_green_count, 0);
  assert.equal(report.summary.production_db_mutation_required, false);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.candidates[0].story_id, "fresh_xbox_halo_campaign_evolved_demo_20260610");
  assert.equal(report.candidates[0].freshness_gate, "pass");
  assert.deepEqual(report.candidates[0].blocking_lanes, [
    "audio_timestamps",
    "official_direct_motion",
    "visual_v4_final_render",
    "scheduler_bridge_promotion",
    "strict_dry_run",
  ]);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-promotion-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });

  assert.ok(fs.existsSync(written.reportJson));
  assert.ok(fs.existsSync(written.reportMd));
  assert.ok(fs.existsSync(written.renderInputWorkOrder));
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "canonical_story_manifest.json")));
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "rights_ledger.json")));
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "footage_inventory.json")));
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "render_readiness_work_order.json")));

  const canonical = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "canonical_story_manifest.json"),
      "utf8",
    ),
  );
  assert.equal(canonical.public_title, "Halo: Campaign Evolved Shows The Real Remake Test");
  assert.match(canonical.description, /Halo: Campaign Evolved has a public demo test/i);
  assert.match(canonical.description, /Source: Xbox Wire\./);
  assert.equal(canonical.public_copy.title, "Halo: Campaign Evolved Shows The Real Remake Test");

  const rightsLedger = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "rights_ledger.json"),
      "utf8",
    ),
  );
  assert.equal(rightsLedger.verdict, "fail");
  assert.deepEqual(rightsLedger.failures, ["rights:no_rights_record"]);
  assert.deepEqual(rightsLedger.records, []);
  assert.equal(rightsLedger.direct_media_validated, false);
  assert.equal(rightsLedger.reference_only_sources[0].url, draftStory().primary_source_url);
  assert.equal(rightsLedger.safety.no_publish_triggered, true);

  const footageInventory = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "footage_inventory.json"),
      "utf8",
    ),
  );
  assert.equal(footageInventory.readiness.status, "v4_motion_blocked");
  assert.deepEqual(footageInventory.motion_inventory.accepted_local_clips, []);
  assert.equal(footageInventory.motion_budget.available_motion_clips, 0);
  assert.equal(footageInventory.direct_media_validated, false);
  assert.equal(footageInventory.safety.no_publish_triggered, true);

  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  assert.equal(storyPackages[0].verdict, "local_proof_pending");
  assert.equal(storyPackages[0].status, "needs_media_house_render_proof");
  assert.equal(storyPackages[0].publishable, false);
  assert.equal(storyPackages[0].scheduler_green, false);
  assert.equal(storyPackages[0].counted_as_green, false);
  assert.ok(storyPackages[0].blockers.includes("missing_media_house_quality_gate_pass"));
  assert.ok(storyPackages[0].blockers.includes("missing_visual_v4_final_render"));
  assert.match(storyPackages[0].description, /Halo: Campaign Evolved has a public demo test/i);
  assert.ok(storyPackages[0].blockers.includes("not_scheduler_green"));
  assert.ok(storyPackages[0].blockers.includes("missing_scheduler_preflight_pass"));

  const renderInputWorkOrder = JSON.parse(fs.readFileSync(written.renderInputWorkOrder, "utf8"));
  assert.equal(renderInputWorkOrder.mode, "LOCAL_RENDER_INPUT_WORK_ORDER");
  assert.equal(renderInputWorkOrder.summary.story_count, 1);
  assert.equal(renderInputWorkOrder.summary.ready_for_final_render_job_count, 0);
  assert.equal(renderInputWorkOrder.summary.blocked_on_render_inputs_count, 1);
  assert.equal(renderInputWorkOrder.summary.audio_timestamp_jobs, 1);
  assert.equal(renderInputWorkOrder.summary.real_motion_materialisation_jobs, 1);
  assert.equal(renderInputWorkOrder.summary.final_mp4_repair_jobs, 1);
  assert.equal(renderInputWorkOrder.summary.caption_repair_jobs, 1);
  assert.equal(renderInputWorkOrder.jobs[0].status, "blocked_on_render_inputs");
  assert.equal(renderInputWorkOrder.jobs[0].artifact_dir, storyPackages[0].artifact_dir);
  assert.deepEqual(
    renderInputWorkOrder.jobs[0].actions.map((action) => action.action_id),
    [
      "generate_final_narration_audio_and_word_timestamps",
      "materialise_validated_real_motion_clips",
      "materialise_final_mp4",
      "generate_caption_file",
      "repair_render_manifest",
      "repair_audio_manifest",
    ],
  );
  assert.equal(renderInputWorkOrder.safety.no_publish_triggered, true);
  assert.equal(renderInputWorkOrder.safety.no_db_mutation, true);
});

test("fresh buffer promotion refresh preserves current render and SFX evidence for unchanged story", async () => {
  const generatedAt = "2026-06-23T16:00:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [draftStory()],
    generatedAt,
  });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-promotion-preserve-render-"));

  await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const packageDir = path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610");
  const previousCanonical = JSON.parse(fs.readFileSync(path.join(packageDir, "canonical_story_manifest.json"), "utf8"));
  fs.writeFileSync(
    path.join(packageDir, "canonical_story_manifest.json"),
    JSON.stringify(
      {
        ...previousCanonical,
        selected_title: "Halo Public Copy Holding Title",
        public_title: "Halo Public Copy Holding Title",
        upload_title: "Halo Public Copy Holding Title",
        thumbnail_headline: "HALO HOLDING CARD",
        suggested_thumbnail_text: "HALO HOLDING CARD",
      },
      null,
      2,
    ),
  );
  const evidence = {
    "audio_manifest.json": JSON.stringify({ voice_status: "materialized", blockers: [] }),
    "render_manifest.json": JSON.stringify({ quality_gate_status: "post_render_forensics_passed" }),
    "materialised_motion_clips.json": JSON.stringify({ clips: [{ path: "clip-01.mp4" }] }),
    "owned_motion_manifest.json": JSON.stringify({ readiness: { status: "pass", blockers: [] } }),
    "distinct_motion_family_report.json": JSON.stringify({ status: "pass", families: 5 }),
    "visual_quality_report.json": JSON.stringify({ result: "pass", failures: [] }),
    "benchmark_report.json": JSON.stringify({ result: "pass", failures: [] }),
    "forensic_qa_report.json": JSON.stringify({ result: "pass", blockers: [] }),
    "director_beat_map.json": JSON.stringify({ beats: [{ label: "hook" }] }),
    "script_scorecard.json": JSON.stringify({ verdict: "pass", score: 91 }),
    "sfx_manifest.json": JSON.stringify({ readiness: { status: "pass", blockers: [] } }),
    "sfx_source_plan.json": JSON.stringify({ readiness: { status: "pass", blockers: [] } }),
    "visual_v4_render_story.json": JSON.stringify({ id: "fresh_xbox_halo_campaign_evolved_demo_20260610" }),
    "audio_segment_loudness_report.json": JSON.stringify({ verdict: "pass" }),
    "captions.srt": "1\n00:00:00,000 --> 00:00:01,000\nHALO\n",
    "caption_manifest.json": JSON.stringify({ status: "ready", blockers: [] }),
  };
  for (const [fileName, content] of Object.entries(evidence)) {
    fs.writeFileSync(path.join(packageDir, fileName), content);
  }
  fs.writeFileSync(path.join(packageDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 3));

  await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });

  for (const [fileName, content] of Object.entries(evidence)) {
    const filePath = path.join(packageDir, fileName);
    assert.equal(fs.existsSync(filePath), true, `${fileName} should be preserved`);
    assert.equal(fs.readFileSync(filePath, "utf8"), content);
  }
  const mp4Path = path.join(packageDir, "visual_v4_render.mp4");
  assert.equal(fs.existsSync(mp4Path), true);
  assert.equal(fs.statSync(mp4Path).size, 4096);
});

test("fresh buffer promotion CLI is registered and defaults to overnight output", () => {
  assert.equal(
    packageJson.scripts["ops:fresh-green-buffer-promote"],
    "node tools/fresh-green-buffer-local-promotion.js",
  );

  const args = parseArgs(["--json", "--generated-at", "2026-06-12T08:00:00.000Z"]);
  assert.equal(args.json, true);
  assert.equal(args.generatedAt, "2026-06-12T08:00:00.000Z");
  assert.match(args.storiesPath, /fresh_source_intake_stories\.json$/);
  assert.match(args.outDir, /overnight-fresh-green-buffer$/);
});

test("fresh buffer promotion preserves official direct media references in local artefacts", async () => {
  const story = draftStory({
    id: "rss_gta_vi_article_story",
    title: "GTA VI Launch Details Turn Into A Trust Test",
    canonical_subject: "Grand Theft Auto VI",
    canonical_game: "Grand Theft Auto VI",
    selected_title: "GTA VI Launch Details Turn Into A Trust Test",
    primary_source: {
      name: "GameSpot",
      url: "https://www.gamespot.com/articles/gta-6-features-a-single-player-experience-at-least-at-launch/",
      type: "rss",
    },
    primary_source_url:
      "https://www.gamespot.com/articles/gta-6-features-a-single-player-experience-at-least-at-launch/",
    source_published_at: "2026-06-24T15:41:17.000Z",
    direct_media_candidates: [
      {
        direct_media_url:
          "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
        label: "Grand Theft Auto VI Trailer 2",
        source_family: "rockstar_gta_vi_trailer_2",
        source_type: "official_game_website_media_page",
      },
    ],
    narration_script:
      "GTA VI just turned launch wording into a trust test. GameSpot reports the game is being described around its single-player experience at launch. Follow Pulse Gaming so you never miss a beat.",
  });

  const generatedAt = "2026-06-24T16:00:00.000Z";
  const sourceManifest = buildSourceManifest(story, new Date(generatedAt));
  assert.equal(sourceManifest.direct_media_candidates.length, 1);
  assert.equal(
    sourceManifest.direct_media_candidates[0].direct_media_url,
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
  );

  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [story],
    generatedAt,
  });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-direct-media-"));
  await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const packageDir = path.join(outDir, "packages", "rss_gta_vi_article_story");
  const canonical = JSON.parse(fs.readFileSync(path.join(packageDir, "canonical_story_manifest.json"), "utf8"));
  const rightsLedger = JSON.parse(fs.readFileSync(path.join(packageDir, "rights_ledger.json"), "utf8"));
  const footageInventory = JSON.parse(fs.readFileSync(path.join(packageDir, "footage_inventory.json"), "utf8"));

  assert.equal(canonical.official_motion_references.length, 1);
  assert.equal(canonical.official_motion_references[0].source_family, "rockstar_gta_vi_trailer_2");
  assert.equal(rightsLedger.official_motion_references[0].source_family, "rockstar_gta_vi_trailer_2");
  assert.equal(footageInventory.official_motion_references[0].source_family, "rockstar_gta_vi_trailer_2");
});

test("fresh buffer local render work order consumes current audio package evidence", async () => {
  const generatedAt = "2026-06-23T11:45:00.000Z";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-promotion-audio-evidence-"));
  const packageDir = path.join(root, "packages", "story-audio-ready");
  const audioDir = path.join(root, "output", "audio");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "story-audio-ready.mp3");
  const timestampPath = path.join(audioDir, "story-audio-ready_timestamps.json");
  fs.writeFileSync(audioPath, Buffer.alloc(2048, 1));
  fs.writeFileSync(timestampPath, JSON.stringify({ words: [{ word: "Halo", start: 0, end: 0.2 }] }));
  fs.writeFileSync(
    path.join(packageDir, "audio_manifest.json"),
    JSON.stringify({
      narration_audio_path: audioPath,
      word_timestamps_path: timestampPath,
      voice_status: "materialized",
    }),
  );

  const workOrder = buildLocalPromotionRenderInputWorkOrder({
    generatedAt,
    packages: [
      {
        story_id: "story-audio-ready",
        title: "Halo Audio Ready",
        artifact_dir: packageDir,
        canonical_subject: "Halo",
        primary_source: "Xbox Wire",
        primary_source_url: "https://news.xbox.com/halo",
        source_published_at: "2026-06-23T09:00:00.000Z",
        status: "needs_media_house_render_proof",
        verdict: "local_proof_pending",
      },
    ],
  });

  assert.equal(workOrder.summary.audio_timestamp_jobs, 0);
  assert.equal(workOrder.summary.manifest_repair_jobs, 1);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    [
      "materialise_validated_real_motion_clips",
      "materialise_final_mp4",
      "generate_caption_file",
      "repair_render_manifest",
    ],
  );
  assert.ok(!workOrder.jobs[0].blockers.includes("final_narration_audio_missing"));
  assert.ok(!workOrder.jobs[0].blockers.includes("word_timestamps_missing"));
  assert.ok(!workOrder.jobs[0].blockers.includes("audio_manifest_missing"));
  assert.equal(workOrder.jobs[0].evidence.narration_audio_path, audioPath);
  assert.equal(workOrder.jobs[0].evidence.word_timestamps_path, timestampPath);
  assert.ok(workOrder.jobs[0].blockers.includes("materialised_motion_clips_missing"));
});

test("fresh buffer local render work order resolves generated MEDIA_ROOT audio without a package manifest", async () => {
  const generatedAt = "2026-06-23T12:40:00.000Z";
  const previousMediaRoot = process.env.MEDIA_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-promotion-media-root-audio-"));
  process.env.MEDIA_ROOT = root;
  try {
    const packageDir = path.join(root, "packages", "story-generated-audio");
    const audioDir = path.join(root, "output", "audio");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, "story-generated-audio.mp3");
    const timestampPath = path.join(audioDir, "story-generated-audio_timestamps.json");
    fs.writeFileSync(audioPath, Buffer.alloc(4096, 2));
    fs.writeFileSync(timestampPath, JSON.stringify({ words: [{ word: "Xbox", start: 0, end: 0.2 }] }));

    const workOrder = buildLocalPromotionRenderInputWorkOrder({
      generatedAt,
      packages: [
        {
          story_id: "story-generated-audio",
          title: "Xbox Generated Audio",
          artifact_dir: packageDir,
          canonical_subject: "Xbox",
          primary_source: "IGN",
          primary_source_url: "https://www.ign.com/xbox",
          source_published_at: "2026-06-23T09:00:00.000Z",
          status: "needs_media_house_render_proof",
          verdict: "local_proof_pending",
        },
      ],
    });

    assert.equal(workOrder.summary.audio_timestamp_jobs, 0);
    assert.ok(!workOrder.jobs[0].blockers.includes("final_narration_audio_missing"));
    assert.ok(!workOrder.jobs[0].blockers.includes("word_timestamps_missing"));
    assert.ok(!workOrder.jobs[0].blockers.includes("audio_manifest_missing"));
    assert.equal(workOrder.jobs[0].evidence.narration_audio_path, audioPath);
    assert.equal(workOrder.jobs[0].evidence.word_timestamps_path, timestampPath);
  } finally {
    if (previousMediaRoot == null) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = previousMediaRoot;
  }
});

test("fresh buffer local render work order emits context-aware auto repair commands", () => {
  const generatedAt = "2026-06-26T08:00:00.000Z";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-contextual-repair-"));
  const contractDir = path.join(root, "goal-contract", "motion-hydrated");
  const proofRoot = path.join(root, "goal-proof-batch", "motion-hydrated");
  const artifactDir = path.join(proofRoot, "story-contextual");
  const storyPackagesPath = path.join(contractDir, "story-packages.json");
  const continuationDir = path.join(contractDir, "materialization-continuation");
  const renderInputWorkOrderPath = path.join(continuationDir, "render_input_work_order.json");
  const segmentReportPath = path.join(root, "test-output", "official_trailer_segment_validation_apply_local.json");
  const realMotionOutDir = path.join(root, "studio-v4", "motion-packs");
  fs.mkdirSync(artifactDir, { recursive: true });

  const workOrder = buildLocalPromotionRenderInputWorkOrder({
    generatedAt,
    storyPackagesPath,
    outputDir: continuationDir,
    renderInputWorkOrderPath,
    segmentReportPath,
    realMotionOutDir,
    packages: [
      {
        story_id: "story-contextual",
        title: "GTA VI Starts The Preorder Fight",
        artifact_dir: artifactDir,
        canonical_subject: "Grand Theft Auto VI",
        primary_source: "Xbox Wire",
        primary_source_url: "https://news.xbox.com/en-us/2026/06/25/grand-theft-auto-vi-cover-art/",
        source_published_at: "2026-06-25T04:06:35.000Z",
        status: "needs_media_house_render_proof",
        verdict: "local_proof_pending",
      },
    ],
  });

  const commands = workOrder.auto_repair_plan.items
    .map((item) => item.recommended_command)
    .filter(Boolean);
  const joined = commands.join("\n");
  const realMotionCommand = commands.find((command) => command.includes("ops:goal-real-motion"));
  const audioCommand = commands.find((command) => command.includes("ops:goal-audio-timestamps"));
  const renderCommand = commands.find((command) => command.includes("ops:goal-production-render"));
  const cmdPath = (value) => value.replace(/\\/g, "/");

  assert.ok(realMotionCommand);
  assert.ok(realMotionCommand.includes(`--work-order ${cmdPath(renderInputWorkOrderPath)}`));
  assert.ok(realMotionCommand.includes(`--out-dir ${cmdPath(realMotionOutDir)}`));
  assert.ok(realMotionCommand.includes(`--artifact-root ${cmdPath(proofRoot)}`));
  assert.ok(realMotionCommand.includes(`--segment-report ${cmdPath(segmentReportPath)}`));
  assert.ok(realMotionCommand.includes("--min-clips 8 --min-families 5 --max-clips 8"));
  assert.ok(audioCommand?.includes(`--work-order ${cmdPath(renderInputWorkOrderPath)}`));
  assert.ok(audioCommand?.includes(`--out-dir ${cmdPath(continuationDir)}`));
  assert.ok(renderCommand?.includes(`--work-order ${cmdPath(renderInputWorkOrderPath)}`));
  assert.ok(renderCommand?.includes(`--out-dir ${cmdPath(continuationDir)}`));
  assert.doesNotMatch(joined, /output\/goal-contract\/render_input_work_order\.json/);
  assert.doesNotMatch(joined, /output\/goal-contract\/production_cutover_story_packages\.json/);
});

test("fresh buffer local render work order consumes current materialised motion package evidence", async () => {
  const generatedAt = "2026-06-23T13:20:00.000Z";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-promotion-motion-evidence-"));
  const packageDir = path.join(root, "packages", "story-motion-ready");
  const audioDir = path.join(root, "output", "audio");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "story-motion-ready.mp3");
  const timestampPath = path.join(audioDir, "story-motion-ready_timestamps.json");
  fs.writeFileSync(audioPath, Buffer.alloc(2048, 1));
  fs.writeFileSync(timestampPath, JSON.stringify({ words: [{ word: "Halo", start: 0, end: 0.2 }] }));
  fs.writeFileSync(
    path.join(packageDir, "audio_manifest.json"),
    JSON.stringify({
      narration_audio_path: audioPath,
      word_timestamps_path: timestampPath,
      voice_status: "materialized",
    }),
  );
  fs.writeFileSync(
    path.join(packageDir, "materialised_motion_clips.json"),
    JSON.stringify((() => {
      const clips = Array.from({ length: 8 }, (_, index) => ({
        path: path.join(packageDir, `clip-${index + 1}.mp4`),
        source_family: `official_family_${Math.floor(index / 2) + 1}`,
        media_kind: "direct_video",
      }));
      return {
        status: "materialized",
        clip_count: 8,
        distinct_motion_family_count: 5,
        direct_video_motion_asset_count: 8,
        direct_video_motion_family_count: 5,
        clips,
        materialised_clips: clips,
      };
    })()),
  );
  for (let index = 0; index < 8; index += 1) {
    fs.writeFileSync(path.join(packageDir, `clip-${index + 1}.mp4`), Buffer.alloc(2048, 2));
  }

  const workOrder = buildLocalPromotionRenderInputWorkOrder({
    generatedAt,
    packages: [
      {
        story_id: "story-motion-ready",
        title: "Halo Motion Ready",
        artifact_dir: packageDir,
        canonical_subject: "Halo",
        primary_source: "Xbox Wire",
        primary_source_url: "https://news.xbox.com/halo",
        source_published_at: "2026-06-23T09:00:00.000Z",
        status: "needs_media_house_render_proof",
        verdict: "local_proof_pending",
      },
    ],
  });

  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 0);
  assert.equal(workOrder.summary.ready_for_final_render_job_count, 1);
  assert.equal(workOrder.jobs[0].status, "ready_for_final_render_job");
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["materialise_final_mp4", "generate_caption_file", "repair_render_manifest", "run_visual_v4_production_render"],
  );
  assert.ok(!workOrder.jobs[0].blockers.includes("materialised_motion_clips_missing"));
  assert.ok(!workOrder.jobs[0].blockers.includes("materialised_motion_families_insufficient"));
  assert.ok(!workOrder.jobs[0].blockers.includes("real_visual_motion_clips_missing"));
  assert.ok(!workOrder.jobs[0].blockers.includes("real_visual_motion_families_insufficient"));
  assert.equal(workOrder.jobs[0].evidence.materialised_motion_clip_count, 8);
  assert.equal(workOrder.jobs[0].evidence.real_visual_motion_clip_count, 8);
  assert.equal(workOrder.jobs[0].evidence.real_visual_motion_family_count, 5);
  assert.equal(workOrder.jobs[0].evidence.narration_audio_path, audioPath);
  assert.equal(workOrder.jobs[0].evidence.word_timestamps_path, timestampPath);
});

test("fresh buffer local render work order honours validated V4 official reveal motion readiness", async () => {
  const generatedAt = "2026-06-23T15:40:00.000Z";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-promotion-v4-ready-motion-"));
  const packageDir = path.join(root, "packages", "story-v4-official-ready");
  const audioDir = path.join(root, "output", "audio");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "story-v4-official-ready.mp3");
  const timestampPath = path.join(audioDir, "story-v4-official-ready_timestamps.json");
  fs.writeFileSync(audioPath, Buffer.alloc(2048, 1));
  fs.writeFileSync(timestampPath, JSON.stringify({ words: [{ word: "Street", start: 0, end: 0.2 }] }));
  fs.writeFileSync(
    path.join(packageDir, "audio_manifest.json"),
    JSON.stringify({
      narration_audio_path: audioPath,
      word_timestamps_path: timestampPath,
      word_timestamp_source: "local_whisper_word_alignment",
    }),
  );
  const clips = Array.from({ length: 6 }, (_, index) => ({
    path: path.join(packageDir, `clip-${index + 1}.mp4`),
    source_family: `official_hls_asset_${index < 4 ? "a" : "b"}_window_${index + 1}`,
    base_source_family: `official_hls_asset_${index < 4 ? "a" : "b"}`,
    media_kind: "direct_video",
    source_type: "steam_movie",
    rights_basis: "official_direct_media",
    counts_towards_motion_readiness: true,
    provenance: {
      source: "official_trailer_segment_validation",
      segment_validated: true,
      validation_reason: "official_storefront_trailer_motion_samples_passed",
    },
  }));
  for (const clip of clips) {
    fs.writeFileSync(clip.path, Buffer.alloc(2048, 2));
  }
  fs.writeFileSync(
    path.join(packageDir, "materialised_motion_clips.json"),
    JSON.stringify({
      schema_version: 1,
      status: "ready",
      clip_count: 6,
      distinct_motion_family_count: 2,
      direct_video_motion_asset_count: 6,
      direct_video_motion_family_count: 2,
      clips,
      materialised_clips: clips,
    }),
  );

  const workOrder = buildLocalPromotionRenderInputWorkOrder({
    generatedAt,
    packages: [
      {
        story_id: "story-v4-official-ready",
        title: "Street Fighter Official Motion Ready",
        artifact_dir: packageDir,
        canonical_subject: "Street Fighter 6",
        primary_source: "GameSpot",
        primary_source_url: "https://www.gamespot.com/street-fighter-6",
        source_published_at: "2026-06-23T09:00:00.000Z",
        status: "needs_media_house_render_proof",
        verdict: "local_proof_pending",
      },
    ],
  });

  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 0);
  assert.equal(workOrder.summary.ready_for_final_render_job_count, 1);
  assert.equal(workOrder.jobs[0].status, "ready_for_final_render_job");
  assert.ok(!workOrder.jobs[0].blockers.includes("materialised_motion_clips_missing"));
  assert.ok(!workOrder.jobs[0].blockers.includes("materialised_motion_families_insufficient"));
  assert.ok(!workOrder.jobs[0].blockers.includes("real_visual_motion_clips_missing"));
  assert.ok(!workOrder.jobs[0].blockers.includes("real_visual_motion_families_insufficient"));
  assert.equal(workOrder.jobs[0].evidence.selected_render_input_motion_ready, true);
  assert.equal(workOrder.jobs[0].evidence.selected_render_input_motion_kind, "direct_video");
  assert.equal(workOrder.jobs[0].evidence.materialised_motion_clip_count, 6);
  assert.equal(workOrder.jobs[0].evidence.real_visual_motion_clip_count, 6);
  assert.equal(workOrder.jobs[0].evidence.real_visual_motion_family_count, 2);
});

test("fresh buffer local render work order trusts current final render and caption evidence", async () => {
  const generatedAt = "2026-06-23T16:55:00.000Z";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-promotion-render-ready-"));
  const packageDir = path.join(root, "packages", "story-render-ready");
  const audioDir = path.join(root, "output", "audio");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "story-render-ready.mp3");
  const timestampPath = path.join(audioDir, "story-render-ready_timestamps.json");
  const captionsPath = path.join(packageDir, "captions.srt");
  const finalMp4Path = path.join(packageDir, "visual_v4_render.mp4");
  fs.writeFileSync(audioPath, Buffer.alloc(4096, 1));
  fs.writeFileSync(timestampPath, JSON.stringify({ words: [{ word: "Street", start: 0, end: 0.2 }] }));
  fs.writeFileSync(finalMp4Path, Buffer.alloc(4096, 3));
  fs.writeFileSync(captionsPath, "1\n00:00:00,000 --> 00:00:01,000\nStreet Fighter 6\n");
  fs.writeFileSync(
    path.join(packageDir, "audio_manifest.json"),
    JSON.stringify({
      narration_audio_path: audioPath,
      word_timestamps_path: timestampPath,
      word_timestamp_source: "local_whisper_word_alignment",
    }),
  );
  fs.writeFileSync(
    path.join(packageDir, "caption_manifest.json"),
    JSON.stringify({
      status: "ready",
      caption_srt_path: captionsPath,
      blockers: [],
      checks: { caption_file_present: true, captions_well_formed: true },
    }),
  );
  fs.writeFileSync(
    path.join(packageDir, "render_manifest.json"),
    JSON.stringify({
      renderer: "visual_v4_production",
      visual_tier: "production_v4_motion",
      final_publish_render: true,
      output: "visual_v4_render.mp4",
      output_path: finalMp4Path,
      file_size_bytes: 4096,
      quality_gate_status: "post_render_forensics_passed",
      post_render_forensic_result: "pass",
      post_render_forensic_blockers: [],
    }),
  );
  const clips = Array.from({ length: 6 }, (_, index) => ({
    path: path.join(packageDir, `clip-${index + 1}.mp4`),
    source_family: `official_hls_asset_${index < 4 ? "a" : "b"}_window_${index + 1}`,
    base_source_family: `official_hls_asset_${index < 4 ? "a" : "b"}`,
    media_kind: "direct_video",
    source_type: "steam_movie",
    rights_basis: "official_direct_media",
    counts_towards_motion_readiness: true,
    provenance: {
      source: "official_trailer_segment_validation",
      segment_validated: true,
      validation_reason: "official_storefront_trailer_motion_samples_passed",
    },
  }));
  fs.writeFileSync(
    path.join(packageDir, "materialised_motion_clips.json"),
    JSON.stringify({
      status: "ready",
      motion_budget: { required_motion_scenes: 5 },
      readiness: { status: "v4_motion_ready", blockers: [] },
      clip_count: 6,
      distinct_motion_family_count: 2,
      direct_video_motion_asset_count: 6,
      direct_video_motion_family_count: 2,
      clips,
      materialised_clips: clips,
    }),
  );

  const workOrder = buildLocalPromotionRenderInputWorkOrder({
    generatedAt,
    packages: [
      {
        story_id: "story-render-ready",
        title: "Street Fighter Render Ready",
        artifact_dir: packageDir,
        canonical_subject: "Street Fighter 6",
        primary_source: "GameSpot",
        primary_source_url: "https://www.gamespot.com/street-fighter-6",
        source_published_at: "2026-06-23T09:00:00.000Z",
        status: "needs_media_house_render_proof",
        verdict: "local_proof_pending",
      },
    ],
  });

  assert.equal(workOrder.summary.ready_for_scheduler_preflight_count, 1);
  assert.equal(workOrder.summary.ready_for_final_render_job_count, 0);
  assert.equal(workOrder.summary.blocked_on_render_inputs_count, 0);
  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 0);
  assert.equal(workOrder.summary.final_mp4_repair_jobs, 0);
  assert.equal(workOrder.summary.caption_repair_jobs, 0);
  assert.equal(workOrder.summary.manifest_repair_jobs, 0);
  assert.equal(workOrder.jobs[0].status, "ready_for_scheduler_preflight");
  assert.deepEqual(workOrder.jobs[0].actions.map((action) => action.action_id), []);
  assert.deepEqual(workOrder.jobs[0].blockers, []);
  assert.equal(workOrder.jobs[0].evidence.final_render_ready, true);
  assert.equal(workOrder.jobs[0].evidence.caption_file_ready, true);
  assert.equal(workOrder.jobs[0].evidence.render_manifest_ready, true);
});

test("fresh buffer promotion compacts headline-style subjects into the named game", async () => {
  const generatedAt = "2026-06-19T04:00:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "rss_gta6_launch_countdown",
        title: "Here's How I Know We Are Entering The GTA 6 Launch Endgame",
        canonical_subject: "Here's How I Know We Are Entering The GTA 6 Launch Endgame",
        canonical_game: "",
        selected_title: "GTA 6 May Finally Be In Launch Countdown Mode",
        primary_source: {
          name: "Kotaku",
          url: "https://kotaku.com/gta-6-launch-endgame-2026",
          type: "trusted_editorial_source",
        },
        primary_source_url: "https://kotaku.com/gta-6-launch-endgame-2026",
        source_published_at: "2026-06-18T12:00:00.000Z",
        confirmed_claims: [
          "Kotaku argues Rockstar is entering the GTA 6 launch endgame as store and marketing signals shift.",
        ],
        thumbnail_headline: "GTA 6 COUNTDOWN",
        narration_script:
          "GTA 6 may finally be shifting from delay fear to launch countdown. Kotaku argues Rockstar is entering the launch endgame as store and marketing signals shift. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-subject-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const packageDir = path.join(outDir, "packages", "rss_gta6_launch_countdown");

  const canonical = JSON.parse(
    fs.readFileSync(path.join(packageDir, "canonical_story_manifest.json"), "utf8"),
  );
  assert.equal(canonical.canonical_subject, "GTA 6");
  assert.equal(canonical.canonical_game, "GTA 6");
  assert.match(canonical.first_spoken_line, /^GTA 6\b/);

  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  assert.equal(storyPackages[0].canonical_subject, "GTA 6");
  assert.equal(storyPackages[0].canonical_game, "GTA 6");
});

test("fresh buffer promotion maps current-news title subjects to source-search entities", async () => {
  const generatedAt = "2026-06-22T06:00:00.000Z";
  const cases = [
    ["rss_black_ops", "Black Ops Classics Face A Price Test", "Black Ops 1 and 2 just turned nostalgia into a price test.", "Call of Duty: Black Ops", "IGN reports Call of Duty: Black Ops 1 and 2 listings have fans watching port prices."],
    ["rss_ocarina", "Ocarina's Remake Pressure", "Ocarina of Time just made Nintendo's remake demand impossible to ignore.", "Ocarina of Time", "Eurogamer reports Nintendo removed an Ocarina of Time Switch 2 description."],
    ["rss_cyberpunk", "Cyberpunk 2077's Trust Debt", "CD Projekt Red is still paying for Cyberpunk 2077's launch.", "Cyberpunk 2077", "IGN reports Cyberpunk 2077 has a new update detail."],
    ["rss_xbox", "Xbox's Strategy Trust Problem", "An original Xbox insider just made the brand problem sound painfully simple.", "Xbox", "Kotaku reports a founding Xbox figure says early console-business fears still matter."],
    ["rss_halo_ps5", "Halo's PS5 Account Catch", "Halo on PS5 just picked up a very Xbox-shaped requirement.", "Halo: Campaign Evolved", "Eurogamer reports Halo: Campaign Evolved PS5 players will require an Xbox account and gamertag."],
    ["rss_lords_fallen_2", "Lords Of The Fallen 2 Dodges GTA 6", "Lords of the Fallen 2 just blinked first in the GTA 6 traffic jam. GameSpot reports Lords of the Fallen 2 was delayed to avoid GTA 6 and give the sequel more enhancement time before launch. Dodging GTA 6 is sensible, but it also raises expectations.", "Lords of the Fallen 2", "GameSpot reports Lords of the Fallen 2 was delayed to avoid GTA 6 and get more enhancements."],
    ["rss_onimusha", "Onimusha's September Gamble Just Got Real", "Onimusha Way of the Sword just gave players the trailer that matters more than the nostalgia.", "Onimusha: Way of the Sword", "Capcom released a game overview trailer for Onimusha: Way of the Sword."],
    ["rss_diablo", "Diablo 4's New Season Has One Real Test", "Diablo 4's next season has a problem trailers alone cannot solve.", "Diablo IV", "Blizzard released official trailer material for Diablo IV Season of Death Awakening."],
    ["rss_dead_by_daylight", "Dead By Daylight Just Took A Weird Detour", "Dead by Daylight just took the kind of detour that either refreshes a live game or annoys its most loyal players.", "Dead by Daylight", "Behaviour Interactive released official trailer material for Dead by Daylight: The Life Road."],
  ];
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: cases.map(([id, title, script, , claim]) =>
      draftStory({
        id,
        title,
        selected_title: title,
        canonical_subject: title,
        canonical_game: title,
        narration_script: `${script} Follow Pulse Gaming so you never miss a beat.`,
        confirmed_claims: [claim],
      }),
    ),
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-current-subjects-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));

  for (const [id, , , expected] of cases) {
    const canonical = JSON.parse(
      fs.readFileSync(path.join(outDir, "packages", id, "canonical_story_manifest.json"), "utf8"),
    );
    assert.equal(canonical.canonical_subject, expected);
    assert.equal(canonical.canonical_game, expected);
    if (id === "rss_lords_fallen_2") {
      assert.equal(canonical.script_coherence_result, "pass");
      assert.match(canonical.description, /Lords of the Fallen 2/i);
      assert.match(canonical.description, /release-calendar|GTA 6|breathing room|extra time|launch/i);
      assert.doesNotMatch(canonical.description, /^GTA 6 has/i);
      assert.doesNotMatch(canonical.description, /headline is interesting|useful question/i);
    }
    const storyPackage = storyPackages.find((item) => item.story_id === id);
    assert.equal(storyPackage.canonical_subject, expected);
    assert.equal(storyPackage.canonical_game, expected);
  }
});

test("fresh buffer promotion uses spoken-safe Halo account requirement wording", () => {
  const canonical = buildCanonicalStoryManifest(
    draftStory({
      id: "rss_halo_ps5_account_requirement",
      title: "Halo's PS5 Account Catch",
      selected_title: "Halo's PS5 Account Catch",
      canonical_subject: "Halo's PS5 Account Catch",
      canonical_game: "Halo's PS5 Account Catch",
      primary_source: {
        name: "Eurogamer",
        url: "https://www.eurogamer.net/halo-campaign-evolved-ps5-xbox-account-gamertag-psplus",
        type: "trusted_editorial_source",
      },
      primary_source_url: "https://www.eurogamer.net/halo-campaign-evolved-ps5-xbox-account-gamertag-psplus",
      source_published_at: "2026-06-20T21:05:23.000Z",
      confirmed_claims: [
        "Eurogamer reports Halo: Campaign Evolved PS5 players will require an Xbox account and gamertag to play, plus PS Plus for split-screen co-op.",
      ],
      narration_script: "",
      full_script: "",
    }),
    "2026-06-23T11:22:35.313Z",
  );

  assert.match(canonical.full_script, /Halo: Campaign Evolved/i);
  assert.match(canonical.full_script, /Xbox account and gamertag/i);
  assert.doesNotMatch(canonical.full_script, /make that welcome/i);
  assert.doesNotMatch(canonical.full_script, /extra account steps can make/i);
});

test("fresh buffer promotion uses selected title over long source headline when multiple games are named", async () => {
  const generatedAt = "2026-06-19T05:00:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "rss_gta5_free_upgrade",
        title:
          "As GTA Online readies for another large update, and GTA 6 approaches, Rockstar offers free upgrades to GTA 5 on PS5 and Xbox Series S/X",
        canonical_subject:
          "As GTA Online readies for another large update, and GTA 6 approaches, Rockstar offers free upgrades to GTA 5 on PS5 and Xbox Series S/X",
        canonical_game:
          "As GTA Online readies for another large update, and GTA 6 approaches, Rockstar offers free upgrades to GTA 5 on PS5 and Xbox Series S/X",
        selected_title: "GTA 5's Free Upgrade Runway",
        primary_source: {
          name: "Eurogamer",
          url: "https://www.eurogamer.net/gta-5-free-ps5-xbox-series-x-s-upgrade",
          type: "trusted_editorial_source",
        },
        primary_source_url: "https://www.eurogamer.net/gta-5-free-ps5-xbox-series-x-s-upgrade",
        source_published_at: "2026-06-18T13:08:06.000Z",
        confirmed_claims: [
          "Eurogamer says Rockstar is giving GTA 5 players on PS4 and Xbox One a free upgrade to PS5 and Xbox Series X/S.",
        ],
        thumbnail_headline: "FREE UPGRADE",
        narration_script:
          "GTA 5 just became Rockstar's current-gen waiting room. Eurogamer reports Rockstar is giving GTA 5 players on PS4 and Xbox One a free upgrade to PS5 and Xbox Series X/S as GTA Online gears up again and GTA 6 approaches. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-mixed-subject-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const canonical = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "packages", "rss_gta5_free_upgrade", "canonical_story_manifest.json"),
      "utf8",
    ),
  );
  assert.equal(canonical.canonical_subject, "GTA 5");
  assert.equal(canonical.canonical_game, "GTA 5");
  assert.match(canonical.first_spoken_line, /^GTA 5\b/);

  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  assert.equal(storyPackages[0].canonical_subject, "GTA 5");
  assert.equal(storyPackages[0].canonical_game, "GTA 5");
});

test("fresh buffer promotion rewrites unsupported GTA 6 context into specific GTA 5 upgrade copy", () => {
  const canonical = buildCanonicalStoryManifest(
    draftStory({
      id: "rss_gta5_free_upgrade_source_safe",
      title: "GTA 5's Free Upgrade Runway",
      selected_title: "GTA 5's Free Upgrade Runway",
      canonical_subject: "GTA 5's Free Upgrade Runway",
      canonical_game: "GTA 5's Free Upgrade Runway",
      primary_source: {
        name: "GameSpot",
        url: "https://www.gamespot.com/articles/gta-5-for-ps5-and-xbox-series-xs-will-be-free-for-last-gen-owners-this-week/",
        type: "trusted_editorial_source",
      },
      primary_source_url:
        "https://www.gamespot.com/articles/gta-5-for-ps5-and-xbox-series-xs-will-be-free-for-last-gen-owners-this-week/",
      source_published_at: "2026-06-17T16:06:13.000Z",
      confirmed_claims: [
        "GameSpot reports GTA 5 For PS5 And Xbox Series X|S Will Be Free For Last-Gen Owners This Week.",
      ],
      thumbnail_headline: "FREE UPGRADE",
      narration_script:
        "GTA 5 just became Rockstar's current-gen waiting room. GameSpot reports Rockstar is giving GTA 5 players on PS4 and Xbox One a free upgrade to PS5 and Xbox Series X/S as GTA Online gears up again and GTA 6 approaches. That matters because this is not just generosity; it moves old players onto the hardware where Rockstar wants attention, spending and habits before the sequel arrives. Follow Pulse Gaming so you never miss a beat.",
    }),
    "2026-06-23T10:50:00.000Z",
  );

  assert.equal(canonical.canonical_subject, "GTA 5");
  assert.equal(canonical.script_coherence_result, "pass");
  assert.equal(canonical.script_source, "angle_first_source_bound_fallback");
  assert.match(canonical.full_script, /free upgrade/i);
  assert.match(canonical.full_script, /PS4 and Xbox One/i);
  assert.match(canonical.full_script, /PS5 and Xbox Series X and S/i);
  assert.doesNotMatch(canonical.full_script, /Xbox Series X\/S|Xbox Series S\/X/i);
  assert.doesNotMatch(canonical.full_script, /new GTA 5 detail around access/i);
  assert.doesNotMatch(canonical.full_script, /next big update|sequel takes over/i);
  assert.doesNotMatch(canonical.full_script, /\bGTA 6\b/i);
  assert.doesNotMatch(canonical.public_title, /Player Impact/i);
});

test("fresh buffer promotion compacts overlong coherent scripts for Shorts narration", () => {
  const overlongScript = [
    "GTA 5 just made its current-gen upgrade free for easy-to-miss owners.",
    "GameSpot reports GTA 5 players on PS4 and Xbox One can claim the PS5 and Xbox Series X/S version for free this week.",
    "That matters because this is the native current-gen version, not just backward compatibility: better graphics, faster loading and current platform support are the actual value.",
    "For lapsed players, the free upgrade lowers the friction and gives them a reason to check saves, accounts and online progress before reinstalling.",
    "The free headline still depends on eligibility, so old owners need to check whether their copy is covered before assuming it costs nothing.",
    "If you still own the old version, the claim window and platform eligibility are the bits to check before paying again.",
    "The useful split is eligibility: digital ownership, platform version and whether the claim appears before anyone pays twice.",
    "This is the kind of old-game update that matters because it prevents a needless rebuy.",
    "If Rockstar makes the claim painless, an old upgrade fee turns into a clean retention win.",
    "If eligibility is messy, the free headline starts the argument.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" ");

  const canonical = buildCanonicalStoryManifest(
    draftStory({
      id: "rss_gta5_free_upgrade_overlong",
      title: "GTA 5's Free Upgrade Runway",
      selected_title: "GTA 5's Free Upgrade Runway",
      canonical_subject: "GTA 5",
      canonical_game: "GTA 5",
      primary_source: {
        name: "GameSpot",
        url: "https://www.gamespot.com/articles/gta-5-for-ps5-and-xbox-series-xs-will-be-free-for-last-gen-owners-this-week/",
        type: "trusted_editorial_source",
      },
      primary_source_url:
        "https://www.gamespot.com/articles/gta-5-for-ps5-and-xbox-series-xs-will-be-free-for-last-gen-owners-this-week/",
      source_published_at: "2026-06-17T16:06:13.000Z",
      source_title: "GTA 5 players can claim the current-gen upgrade free this week",
      confirmed_claims: [
        "GameSpot reports GTA 5 players on PS4 and Xbox One can claim the PS5 and Xbox Series X/S version for free this week.",
      ],
      thumbnail_headline: "FREE UPGRADE",
      narration_script: overlongScript,
      full_script: overlongScript,
    }),
    "2026-06-23T10:50:00.000Z",
  );

  const words = canonical.full_script.split(/\s+/).filter(Boolean);
  assert.ok(words.length <= 165, `expected compact Shorts script, got ${words.length} words`);
  assert.match(canonical.full_script, /GTA 5/i);
  assert.match(canonical.full_script, /free/i);
  assert.match(canonical.full_script, /current-gen|PS5|Xbox Series X and S/i);
  assert.doesNotMatch(canonical.full_script, /Xbox Series X\/S|Xbox Series S\/X/i);
  assert.match(canonical.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.notEqual(canonical.script_source, "provided_fresh_story_script");
});

test("fresh buffer promotion rebuilds stale failing narration before packaging", async () => {
  const generatedAt = "2026-06-19T06:45:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "rss_garfield_gameplay",
        title:
          "Garfield - Escape From Monday Gameplay Trailer Teases the Terror of The Curse of the Spinach Lasagna",
        canonical_subject: "Garfield",
        canonical_game: "Garfield",
        selected_title: "Garfield Gameplay Check",
        primary_source: {
          name: "IGN",
          url: "https://www.ign.com/articles/garfield-escape-from-monday-gameplay-trailer",
          type: "trusted_editorial_source",
        },
        primary_source_url: "https://www.ign.com/articles/garfield-escape-from-monday-gameplay-trailer",
        source_published_at: "2026-06-18T12:00:00.000Z",
        confirmed_claims: [
          "IGN reports a Garfield gameplay trailer shows platforming, camera movement and repeated gameplay beats.",
        ],
        narration_script:
          "Garfield just showed real gameplay. For players, repeated play matters more than one perfect trailer a perfect trailer moment. That gives fans something sharper to argue about than whether the licence is famous enough. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-script-repair-"));
  await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const canonical = JSON.parse(
    fs.readFileSync(path.join(outDir, "packages", "rss_garfield_gameplay", "canonical_story_manifest.json"), "utf8"),
  );

  assert.equal(canonical.script_coherence_result, "pass");
  assert.equal(canonical.public_copy_repaired_at, generatedAt);
  assert.match(canonical.public_copy_repair_reason, /repeated_near_phrase|public_narration_meta_language/);
  assert.doesNotMatch(canonical.full_script, /perfect trailer a perfect trailer|something sharper to argue/i);
  assert.match(canonical.full_script, /blunt test is this: does the gameplay stay fun/i);
});

test("fresh buffer promotion rewrites weak coherent demo copy before packaging", async () => {
  const generatedAt = "2026-06-19T08:45:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "rss_granblue_demo",
        title: "Granblue Fantasy: Relink - Endless Ragnarok hands-on report, demo available today",
        selected_title: "Granblue Fantasy Demo Test",
        canonical_subject: "Granblue Fantasy",
        canonical_game: "Granblue Fantasy",
        primary_source: {
          name: "PlayStation Blog",
          url: "https://blog.playstation.com/2026/06/18/granblue-fantasy-relink-endless-ragnarok-hands-on-report-demo-available-today/",
          type: "official_platform_news",
        },
        primary_source_url:
          "https://blog.playstation.com/2026/06/18/granblue-fantasy-relink-endless-ragnarok-hands-on-report-demo-available-today/",
        source_published_at: "2026-06-18T12:00:08.000Z",
        confirmed_claims: [
          "PlayStation Blog reports Granblue Fantasy: Relink - Endless Ragnarok has a playable demo available today on PS5 and PS4 ahead of launch.",
        ],
        thumbnail_headline: "DEMO TEST",
        narration_script:
          "Granblue Fantasy just gave players the test most previews skip: a demo. PlayStation Blog reports Granblue Fantasy has a hands-on demo beat before launch on PS5 and PS4, giving players a way to judge the expansion early. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-demo-copy-"));
  await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const canonical = JSON.parse(
    fs.readFileSync(path.join(outDir, "packages", "rss_granblue_demo", "canonical_story_manifest.json"), "utf8"),
  );

  assert.equal(canonical.script_coherence_result, "pass");
  assert.equal(canonical.public_copy_repaired_at, generatedAt);
  assert.match(canonical.public_copy_repair_reason, /weak_public_copy_pattern/);
  assert.doesNotMatch(canonical.public_title, /\bDemo Test\b/i);
  assert.doesNotMatch(canonical.full_script, /\bhands-on demo beat\b/i);
  assert.match(canonical.public_title, /Demo/i);
  assert.match(canonical.full_script, /PlayStation Blog/i);
});

test("fresh buffer promotion lightly repairs repeated phrasing without replacing a strong sourced script", () => {
  const canonical = buildCanonicalStoryManifest(
    draftStory({
      id: "rss_ocarina_hidden_switch_2_clue",
      title: "Ocarina's Hidden Switch 2 Clue",
      selected_title: "Ocarina's Hidden Switch 2 Clue",
      canonical_subject: "Ocarina of Time",
      canonical_game: "Ocarina of Time",
      primary_source: {
        name: "IGN",
        url: "https://www.ign.com/articles/nintendo-removes-hidden-the-legend-of-zelda-ocarina-of-time-switch-2-description-that-suggested-its-a-faithful-remake",
        type: "trusted_editorial_source",
      },
      primary_source_url:
        "https://www.ign.com/articles/nintendo-removes-hidden-the-legend-of-zelda-ocarina-of-time-switch-2-description-that-suggested-its-a-faithful-remake",
      confirmed_claims: [
        "IGN reports Nintendo removed a hidden description for Ocarina of Time on Switch 2 that suggested a faithful remake.",
      ],
      narration_script:
        "Ocarina of Time just dropped a clue Nintendo pulled back. IGN reports Nintendo removed a hidden Switch 2 description that suggested a faithful update of the N64 original. That matters because hidden store copy gets louder when it disappears. It does not confirm a remake, and removed copy should be treated as cautious evidence rather than a finished announcement. The real question is what should be preserved and what should be modernised if Nintendo confirms it later. Follow Pulse Gaming so you never miss a beat.",
    }),
    "2026-06-22T10:45:00.000Z",
  );

  assert.equal(canonical.public_title, "Ocarina's Hidden Switch 2 Clue");
  assert.equal(canonical.script_coherence_result, "pass");
  assert.equal(canonical.script_source, "provided_fresh_story_script_lightly_repaired");
  assert.match(canonical.public_copy_repair_reason, /repeated_near_phrase/);
  assert.match(canonical.full_script, /Ocarina of Time.*hidden Switch 2 description/i);
  assert.match(canonical.full_script, /line between preservation and modernisation/i);
  assert.match(canonical.full_script, /pulled listing should be treated as cautious evidence/i);
  assert.doesNotMatch(canonical.full_script, /removed cop(?:y|ies) should be treated/i);
  assert.doesNotMatch(canonical.full_script, /got an update that changes the player decision/i);
  assert.doesNotMatch(canonical.full_script, /Ocarina of Time Player Impact/i);
});

test("fresh buffer promotion packages fresh source claims as attention-led public metadata", async () => {
  const generatedAt = "2026-06-19T20:10:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "fresh_xbox_end_of_abyss_20260619",
        title: "End of Abyss Hands-On Shows The Little Nightmares Team's New Risk",
        canonical_subject: "End of Abyss",
        canonical_game: "End of Abyss",
        selected_title: "End of Abyss Has A Horror Trust Problem",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/19/end-of-abyss-combat-exploration-hands-on/",
          type: "official_platform_news",
        },
        primary_source_url: "https://news.xbox.com/en-us/2026/06/19/end-of-abyss-combat-exploration-hands-on/",
        source_published_at: "2026-06-19T00:00:00.000Z",
        confirmed_claims: [
          "Xbox Wire says End of Abyss is an atmospheric top-down 3D twin-stick shooter Metroidvania from Section 9 Interactive.",
          "Xbox Wire says the studio was co-founded by leads from Tarsier Studios, known for Little Nightmares and Reanimal.",
          "Xbox Wire says End of Abyss comes to Xbox Series X|S on October 1, 2026.",
        ],
        trailer_references: [
          {
            label: "End of Abyss official release date trailer",
            url: "https://www.youtube.com/watch?v=Sytee6i3M9E",
            source_family: "end_of_abyss_official_release_date_trailer",
            source_type: "official_trailer",
          },
        ],
        thumbnail_headline: "HORROR CAMERA RISK",
        narration_script:
          "End of Abyss just gave horror fans a cleaner question than another creepy trailer. Xbox Wire says the top-down Metroidvania comes from Section 9 Interactive, a new studio with former Tarsier leads behind Little Nightmares and Reanimal. That legacy buys attention, not trust. The real test is whether the camera angle can still make players feel trapped, exposed and curious enough to keep pushing deeper. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-attention-metadata-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const canonical = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "packages", "fresh_xbox_end_of_abyss_20260619", "canonical_story_manifest.json"),
      "utf8",
    ),
  );
  const platformManifest = {
    outputs: {
      youtube_shorts: {
        title: canonical.public_title,
        description: canonical.description,
        cover_frame: { headline: canonical.thumbnail_headline },
      },
    },
  };

  assert.doesNotMatch(canonical.description, /^Xbox Wire says/i);
  assert.match(canonical.description, /\bhorror trust test\b/i);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(platformManifest), false);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(platformManifest, canonical), false);
  assert.equal(mediaHousePrivate.weakFirstFrameOrThumbnailCopy(canonical, platformManifest), false);

  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  assert.equal(storyPackages[0].description, canonical.description);
  assert.equal(storyPackages[0].trailer_references[0].source_family, "end_of_abyss_official_release_date_trailer");
});

test("fresh buffer promotion keeps sandbox-control and expansion stories on the correct angle", async () => {
  const generatedAt = "2026-06-19T20:30:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "fresh_sea_custom_seas",
        title: "Sea of Thieves Just Handed Players The Keys",
        canonical_subject: "Sea of Thieves",
        canonical_game: "Sea of Thieves",
        selected_title: "Sea of Thieves Just Handed Players The Keys",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/19/sea-of-thieves-custom-seas-update-details/",
          type: "official_platform_news",
        },
        source_published_at: "2026-06-19T00:00:00.000Z",
        confirmed_claims: [
          "Xbox Wire says Sea of Thieves Season 20 adds Custom Seas, a private sandbox with creative tools and rule controls.",
        ],
        narration_script:
          "Sea of Thieves just changed the argument from content to control. Xbox Wire says Custom Seas lets players set rules around creatures, time of day and weapons. Follow Pulse Gaming so you never miss a beat.",
      }),
      draftStory({
        id: "fresh_dave_jungle",
        title: "Dave the Diver Just Became Bigger Than DLC",
        canonical_subject: "Dave the Diver",
        canonical_game: "Dave the Diver",
        selected_title: "Dave the Diver Just Became Bigger Than DLC",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/18/dave-the-diver-in-the-jungle-out-now/",
          type: "official_platform_news",
        },
        source_published_at: "2026-06-18T00:00:00.000Z",
        confirmed_claims: [
          "Xbox Wire says Dave the Diver: In the Jungle is available now with up to 10 hours of playable content, new wildlife, new ingredients and Bancho Grill.",
        ],
        narration_script:
          "Dave the Diver just released the kind of DLC that starts sounding like a sequel. Xbox Wire says In the Jungle adds up to 10 hours of content. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-angle-metadata-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  const sea = storyPackages.find((row) => row.story_id === "fresh_sea_custom_seas");
  const dave = storyPackages.find((row) => row.story_id === "fresh_dave_jungle");

  assert.match(sea.description, /\b(?:control|sandbox|rules|player-made)\b/i);
  assert.doesNotMatch(sea.description, /More content only matters/i);
  assert.match(dave.description, /\b(?:DLC|expansion|bigger|worth returning|new zone)\b/i);
  assert.doesNotMatch(dave.description, /playable slice|demo test/i);
});

test("fresh buffer promotion prioritises free-access and playable-demo angles over incidental horror or DLC terms", async () => {
  const generatedAt = "2026-06-19T20:45:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "fresh_free_play_days",
        title: "Xbox Free Play Days Has One Weekend Test",
        canonical_subject: "Xbox Free Play Days",
        canonical_game: "Xbox Free Play Days",
        selected_title: "Xbox Free Play Days Has One Weekend Test",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/18/free-play-days-06-18-2026/",
          type: "official_platform_news",
        },
        source_published_at: "2026-06-18T00:00:00.000Z",
        confirmed_claims: [
          "Xbox Wire says Dead by Daylight is free to play for all players, while PGA Tour 2K25, Two Point Museum and Assetto Corsa are available for Xbox Game Pass members during Free Play Days.",
        ],
        narration_script:
          "Xbox Free Play Days has one weekend test. The question is not just what is free, but what earns an install after Sunday. Follow Pulse Gaming so you never miss a beat.",
      }),
      draftStory({
        id: "fresh_granblue_demo",
        title: "Granblue Fantasy Has A Demo Trust Test",
        canonical_subject: "Granblue Fantasy: Relink",
        canonical_game: "Granblue Fantasy: Relink",
        selected_title: "Granblue Fantasy Has A Demo Trust Test",
        primary_source: {
          name: "PlayStation Blog",
          url: "https://blog.playstation.com/2026/06/18/granblue-fantasy-relink-endless-ragnarok-hands-on-report-demo-available-today/",
          type: "official_platform_news",
        },
        source_published_at: "2026-06-18T00:00:00.000Z",
        confirmed_claims: [
          "PlayStation Blog says Endless Ragnarok adds new characters and a new story arc, and a playable demo of the main game is available now.",
        ],
        narration_script:
          "Granblue Fantasy has a playable demo now, which gives players a cleaner test than another expansion feature list. Follow Pulse Gaming so you never miss a beat.",
      }),
      draftStory({
        id: "fresh_ubisoft_trial",
        title: "Ubisoft Plus Has A Five-Day Trust Test",
        canonical_subject: "Ubisoft Plus",
        canonical_game: "Ubisoft Plus",
        selected_title: "Ubisoft Plus Has A Five-Day Trust Test",
        primary_source: {
          name: "Ubisoft News",
          url: "https://news.ubisoft.com/en-us/article/7e8YHQ8EGbHe89eOu4ySGy/ubisoft-free-trial-from-june-1823-what-you-need-to-know",
          type: "official_publisher_news",
        },
        source_published_at: "2026-06-18T00:00:00.000Z",
        confirmed_claims: [
          "Ubisoft News says Ubisoft+ Premium has a free trial from June 18 to June 23 with premium editions, DLC and bonus content.",
        ],
        narration_script:
          "Ubisoft Plus just became a five-day value test, because a free trial only works if one game grabs players before renewal. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-priority-metadata-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  const freePlay = storyPackages.find((row) => row.story_id === "fresh_free_play_days");
  const granblue = storyPackages.find((row) => row.story_id === "fresh_granblue_demo");
  const ubisoft = storyPackages.find((row) => row.story_id === "fresh_ubisoft_trial");

  assert.match(freePlay.description, /\b(?:free|weekend|install|after Sunday)\b/i);
  assert.doesNotMatch(freePlay.description, /horror trust test/i);
  assert.match(granblue.description, /\b(?:demo|playable|before launch|trust)\b/i);
  assert.doesNotMatch(granblue.description, /DLC sounds big/i);
  assert.match(ubisoft.description, /\b(?:free trial|five-day|subscription|renewal|value)\b/i);
  assert.doesNotMatch(ubisoft.description, /DLC sounds big/i);
});

test("fresh buffer promotion uses fighting-game pressure details in public descriptions", async () => {
  const generatedAt = "2026-06-23T21:00:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "sf6_yasmine_pressure",
        title: "Street Fighter 6 Yasmine Gameplay Reveal",
        canonical_subject: "Street Fighter 6",
        canonical_game: "Street Fighter 6",
        selected_title: "Street Fighter 6 Just Revealed A Rushdown Problem",
        primary_source: {
          name: "GameSpot",
          url: "https://www.gamespot.com/videos/street-fighter-6-yasmine-character-gameplay-reveal-trailer/",
          type: "trusted_editorial_source",
        },
        source_published_at: "2026-06-17T23:11:20.000Z",
        thumbnail_headline: "YASMINE PRESSURE",
        confirmed_claims: [
          "GameSpot's footage shows Capcom giving Yasmine Eskrima combat, knife feints and fast step-ins.",
        ],
        narration_script:
          "Street Fighter 6 just made Yasmine look like a ranked-mode problem. GameSpot's footage shows Capcom giving her Eskrima combat, knife feints and fast step-ins that punish anyone who backs up. That matters because zoner mains may have to spend meter just to breathe, while rushdown players may get a new bully when she arrives. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-fighting-pressure-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  const sf6 = storyPackages.find((row) => row.story_id === "sf6_yasmine_pressure");

  assert.match(sf6.description, /Yasmine/i);
  assert.match(sf6.description, /\b(?:gameplay|combat|ranked|rushdown|zoner|meter|pressure)\b/i);
  assert.match(sf6.description, /Source: GameSpot\./);
  assert.doesNotMatch(sf6.description, /player-trust test/i);
  assert.doesNotMatch(sf6.description, /headline is interesting/i);
});

test("fresh buffer promotion removes stale package directories before writing current packages", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-stale-packages-"));
  fs.mkdirSync(path.join(outDir, "packages", "stale_story"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "packages", "stale_story", "canonical_story_manifest.json"), "{}", "utf8");

  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [draftStory({ id: "current_story" })],
    generatedAt: "2026-06-19T07:00:00.000Z",
  });

  await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });

  assert.equal(fs.existsSync(path.join(outDir, "packages", "stale_story")), false);
  assert.equal(fs.existsSync(path.join(outDir, "packages", "current_story")), true);
});

test("fresh buffer promotion preserves same-story generated motion evidence across package refresh", async () => {
  const generatedAt = "2026-06-23T12:55:00.000Z";
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-preserve-generated-motion-"));
  const story = draftStory({
    id: "current_story",
    title: "Xbox's Exclusive Label Problem",
    selected_title: "Xbox's Exclusive Label Problem",
    canonical_subject: "Xbox",
    canonical_game: "Xbox",
    primary_source: {
      name: "IGN",
      url: "https://www.ign.com/articles/xboxs-confusing-exclusivity-criteria-now-aided-by-exclusive-label-on-console-dashboard",
      type: "trusted_editorial_source",
    },
    primary_source_url:
      "https://www.ign.com/articles/xboxs-confusing-exclusivity-criteria-now-aided-by-exclusive-label-on-console-dashboard",
    source_published_at: "2026-06-21T12:00:00.000Z",
    confirmed_claims: [
      "IGN reports Xbox is using an EXCLUSIVE label on the console dashboard.",
    ],
    narration_script:
      "Xbox just made its exclusives problem visible on the dashboard. IGN reports Xbox is using an EXCLUSIVE label on the console dashboard while players are still trying to understand what counts as an Xbox exclusive. Follow Pulse Gaming so you never miss a beat.",
  });
  const oldPackageDir = path.join(outDir, "packages", "current_story");
  fs.mkdirSync(oldPackageDir, { recursive: true });
  fs.writeFileSync(
    path.join(oldPackageDir, "canonical_story_manifest.json"),
    JSON.stringify(buildCanonicalStoryManifest(story, generatedAt), null, 2),
  );
  fs.writeFileSync(
    path.join(oldPackageDir, "materialised_motion_clips.json"),
    JSON.stringify({
      status: "ready",
      owned_explainer_visual_plan: true,
      clip_count: 13,
      distinct_motion_family_count: 13,
      clips: Array.from({ length: 13 }, (_, index) => ({
        id: `current_story-owned-motion-${index + 1}`,
        media_kind: "owned_explainer_motion",
        source_type: "internally_generated_motion_graphic",
        source_family: `current_story_owned_family_${index + 1}`,
        counts_towards_motion_readiness: true,
        path: `output/generated-motion/current_story/${index + 1}.mp4`,
      })),
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(oldPackageDir, "owned_motion_manifest.json"),
    JSON.stringify({ status: "ready", summary: { asset_count: 13 } }, null, 2),
  );
  fs.mkdirSync(path.join(outDir, "packages", "stale_story"), { recursive: true });

  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [story],
    generatedAt,
  });

  await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });

  assert.equal(fs.existsSync(path.join(outDir, "packages", "stale_story")), false);
  assert.equal(fs.existsSync(path.join(outDir, "packages", "current_story", "materialised_motion_clips.json")), true);
  assert.equal(fs.existsSync(path.join(outDir, "packages", "current_story", "owned_motion_manifest.json")), true);
});

test("fresh buffer render work order accepts rights-backed owned HyperFrames motion as motion-ready", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-owned-motion-ready-"));
  const artifactDir = path.join(root, "package");
  fs.mkdirSync(artifactDir, { recursive: true });
  const clips = Array.from({ length: 13 }, (_, index) => ({
    id: `owned-motion-${index + 1}`,
    media_kind: "owned_explainer_motion",
    source_type: "internally_generated_motion_graphic",
    source_family: `owned_motion_family_${index + 1}`,
    motion_family: `owned_motion_family_${index + 1}`,
    counts_towards_motion_readiness: true,
    path: path.join(root, "generated", `${index + 1}.mp4`),
  }));
  fs.writeFileSync(
    path.join(artifactDir, "materialised_motion_clips.json"),
    JSON.stringify({
      status: "ready",
      owned_explainer_visual_plan: true,
      clip_count: clips.length,
      distinct_motion_family_count: clips.length,
      clips,
    }, null, 2),
  );

  const workOrder = buildLocalPromotionRenderInputWorkOrder({
    generatedAt: "2026-06-23T12:56:00.000Z",
    packages: [
      {
        story_id: "owned_motion_story",
        id: "owned_motion_story",
        title: "Xbox's Strategy Trust Problem",
        artifact_dir: artifactDir,
        status: "needs_media_house_render_proof",
        primary_source: "Kotaku",
        primary_source_url: "https://kotaku.com/founding-xbox-member-says-her-early-skepticisms-are-coming-true-25-years-later-2000708811",
        source_published_at: "2026-06-21T12:00:00.000Z",
      },
    ],
  });

  const job = workOrder.jobs[0];
  assert.equal(job.evidence.owned_explainer_motion_clip_count, 13);
  assert.equal(job.evidence.selected_render_input_motion_kind, "owned_explainer_motion");
  assert.ok(!job.blockers.includes("materialised_motion_clips_missing"));
  assert.ok(!job.blockers.includes("real_visual_motion_clips_missing"));
  assert.ok(!job.blockers.includes("real_visual_motion_families_insufficient"));
});
