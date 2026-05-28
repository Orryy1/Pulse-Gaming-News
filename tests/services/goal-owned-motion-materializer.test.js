"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildOwnedMotionFrameLayout,
  buildOwnedMotionFfmpegArgs,
  materializeGoalOwnedMotionClips,
  writeGoalOwnedMotionMaterializationReport,
} = require("../../lib/goal-owned-motion-materializer");

async function makeOwnedMotionPackage(root, id = "story-owned-motion") {
  const artifactDir = path.join(root, "package");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: id,
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    thumbnail_headline: "XBOX NEEDED THIS",
    primary_source: "IGN",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: id,
    motion_inventory: {
      accepted_local_clips: [
        {
          id: `${id}-owned-motion-1`,
          source_family: `${id}_hook_slam`,
          path: `output/generated-motion/${id}/hook_slam.mp4`,
          source_url: `local://pulse-generated-motion/${id}/hook_slam`,
          source_type: "internally_generated_motion_graphic",
          rights_risk_class: "owned_generated_motion",
          durationS: 3.1,
          validated: true,
        },
        {
          id: `${id}-official-1`,
          source_family: `${id}_official`,
          path: `output/generated-motion/${id}/official.mp4`,
          source_url: "https://example.com/official.mp4",
          source_type: "official_reference_clip",
          rights_risk_class: "official_reference_only",
          durationS: 3,
          validated: true,
        },
      ],
    },
  });
  return {
    story_id: id,
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    artifact_dir: artifactDir,
    actions: [{ action_id: "materialise_owned_generated_motion_clips" }],
  };
}

test("owned motion materializer creates only owned generated motion files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-motion-"));
  const job = await makeOwnedMotionPackage(root);
  const calls = [];

  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T05:00:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(2500, 7));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3.1 : null),
  });

  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 1);
  assert.equal(report.summary.skipped_non_owned_clip_count, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, "ffmpeg");
  assert.match(calls[0].args.join(" "), /lavfi/);
  assert.match(report.stories[0].materialized[0].path, /output[\\/]+generated-motion[\\/]+story-owned-motion[\\/]+hook_slam\.mp4$/);
  assert.equal(await fs.pathExists(report.stories[0].materialized[0].path), true);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_external_media_downloads, true);
});

test("owned motion materializer keeps baked card text inside mobile safe bounds", () => {
  assert.equal(typeof buildOwnedMotionFrameLayout, "function");

  const canonical = {
    canonical_subject: "Pokemon Go",
    thumbnail_headline: "Pokemon Go Mega Mewtwo Is",
    selected_title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
    primary_source: "Eurogamer",
  };
  const clip = {
    id: "pokemon-owned-motion-1",
    source_family: "pokemon_kinetic_title_card",
    visual_purpose: "story tension",
    path: "output/generated-motion/pokemon/01_kinetic_title_card.mp4",
    durationS: 2.8,
  };
  const layout = buildOwnedMotionFrameLayout({ clip, canonical });

  for (const block of layout.text_blocks) {
    assert.ok(
      block.estimated_right_px <= 1038,
      `${block.id} exceeds right safe bound at ${block.estimated_right_px}`,
    );
    assert.ok(
      block.estimated_bottom_px <= 1828,
      `${block.id} exceeds bottom safe bound at ${block.estimated_bottom_px}`,
    );
    assert.equal(
      block.within_card_bounds,
      true,
      `${block.id} exceeds its card bounds`,
    );
  }
  assert.deepEqual(layout.text_blocks.find((block) => block.id === "headline").lines, [
    "POKEMON GO MEGA",
    "MEWTWO IS",
  ]);

  const args = buildOwnedMotionFfmpegArgs({
    clip,
    canonical,
    output: path.join("output", "generated-motion", "pokemon", "01_kinetic_title_card.mp4"),
  });
  const vf = args[args.indexOf("-vf") + 1];
  assert.doesNotMatch(vf, /x=\(w-tw\)\/2:y=560/);
  assert.match(vf, /drawtext=text='POKEMON GO MEGA'/);
  assert.match(vf, /drawtext=text='MEWTWO IS'/);
});

test("owned motion materializer renders newsroom-grade motion cards instead of flat text blocks", () => {
  const canonical = {
    canonical_subject: "Boltgun 2",
    thumbnail_headline: "Boltgun 2 Already Feels Loud",
    selected_title: "Boltgun 2 Already Feels Loud",
    primary_source: "IGN Preview",
  };
  const clip = {
    id: "boltgun-owned-motion-1",
    source_family: "boltgun_kinetic_title_card",
    visual_purpose: "demo combat read",
    path: "output/generated-motion/boltgun/01_kinetic_title_card.mp4",
    durationS: 2.8,
  };

  const args = buildOwnedMotionFfmpegArgs({
    clip,
    canonical,
    output: path.join("output", "generated-motion", "boltgun", "01_kinetic_title_card.mp4"),
  });
  const vf = args[args.indexOf("-vf") + 1];

  assert.doesNotMatch(vf, /drawbox=x=70:y=488:w=940:h=284:color=0x0B0F19@0\.72:t=fill/);
  assert.doesNotMatch(vf, /drawbox=x=98:y=820:w=884:h=148:color=black@0\.62:t=fill/);
  assert.match(vf, /PULSE \/\/ MOTION PROOF/);
  assert.match(vf, /SOURCE LOCK/);
  assert.match(vf, /VERIFY/);
  assert.match(vf, /mod\(t\*520,1540\)/);
  assert.match(vf, /color=0x38BDF8@0\.92/);
  assert.match(vf, /shadowcolor=black@0\.82:shadowx=3:shadowy=3/);
});

test("owned motion materializer does not cut card text mid-word", () => {
  const canonical = {
    canonical_subject: "Warhammer 40,000 Boltgun 2",
    thumbnail_headline: "Warhammer 40,000 Boltgun 2 Already Feels Loud In The Demo",
    selected_title: "Boltgun 2 Already Feels Loud",
    primary_source: "IGN Preview",
  };
  const clip = {
    id: "boltgun-owned-motion-1",
    source_family: "boltgun_safe_article_screenshot_transform",
    visual_purpose: "appearance in objective markers and combat readability",
    path: "output/generated-motion/boltgun/01_safe_article_screenshot_transform.mp4",
    durationS: 2.8,
  };

  const layout = buildOwnedMotionFrameLayout({ clip, canonical });
  const purpose = layout.text_blocks.find((block) => block.id === "purpose");
  const flattenedPurpose = purpose.lines.join(" ");

  assert.equal(purpose.fits, true);
  assert.doesNotMatch(flattenedPurpose, /\bR$/);
  assert.doesNotMatch(flattenedPurpose, /\.\.\./);
  assert.match(flattenedPurpose, /COMBAT READABILITY/);
});

test("owned motion materializer recognises packaged owned-motion clips by id and generated path", async () => {
  assert.equal(
    require("../../lib/goal-owned-motion-materializer").isOwnedGeneratedMotion({
      id: "rss_abc-owned-motion-1",
      path: "output/generated-motion/rss_abc/hook_slam.mp4",
      source_kind: "video_file",
    }),
    true,
  );
  assert.equal(
    require("../../lib/goal-owned-motion-materializer").isOwnedGeneratedMotion({
      id: "official-clip",
      path: "output/video_cache/official.mp4",
      rights_risk_class: "official_reference_only",
    }),
    false,
  );
});

test("owned motion materializer reports failed clips without aborting the batch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-motion-fail-"));
  const job = await makeOwnedMotionPackage(root, "fail-story");

  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: { jobs: [job] },
    execFileSync: () => {
      throw new Error("ffmpeg drawtext failed");
    },
    ffprobeDuration: () => null,
  });

  assert.equal(report.summary.materialized_clip_count, 0);
  assert.equal(report.summary.failed_clip_count, 1);
  assert.equal(report.stories[0].failed[0].reason, "ffmpeg_materialization_failed");
  assert.match(report.stories[0].failed[0].error, /ffmpeg drawtext failed/);
});

test("owned motion materializer writes machine-readable and operator reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-motion-write-"));
  const job = await makeOwnedMotionPackage(root, "write-story");
  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: { jobs: [job] },
    execFileSync: (bin, args) => fs.outputFileSync(args[args.length - 1], Buffer.alloc(2500, 8)),
    ffprobeDuration: () => 2.8,
  });

  const written = await writeGoalOwnedMotionMaterializationReport(report, {
    outputDir: path.join(root, "out"),
  });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
  assert.equal(await fs.pathExists(written.ownedMotionManifestPath), true);
  assert.equal(await fs.pathExists(written.materialisedMotionClipsPath), true);
  assert.equal(await fs.pathExists(written.distinctMotionFamilyReportPath), true);
  const saved = await fs.readJson(written.jsonPath);
  assert.equal(saved.summary.materialized_clip_count, 1);
  const ownedManifest = await fs.readJson(written.ownedMotionManifestPath);
  assert.equal(ownedManifest.summary.asset_count, 1);
  assert.equal(ownedManifest.assets[0].story_id, "write-story");
  assert.equal(ownedManifest.assets[0].file_path.endsWith("hook_slam.mp4"), true);
  assert.equal(ownedManifest.assets[0].duration, 3.1);
  assert.deepEqual(ownedManifest.assets[0].dimensions, { width: 1080, height: 1920 });
  assert.equal(ownedManifest.assets[0].frame_rate, 30);
  assert.equal(ownedManifest.assets[0].motion_family, "write-story_hook_slam");
  assert.equal(ownedManifest.assets[0].rights_basis, "owned_generated_editorial_motion_graphic");
  assert.equal(ownedManifest.assets[0].source_relationship, "local://pulse-generated-motion/write-story/hook_slam");
  assert.equal(ownedManifest.assets[0].distinctness_score, 1);
  assert.equal(ownedManifest.assets[0].counts_towards_motion_readiness, true);

  const materialised = await fs.readJson(written.materialisedMotionClipsPath);
  assert.equal(materialised.summary.clip_count, 1);
  assert.equal(materialised.clips[0].file_path, ownedManifest.assets[0].file_path);

  const families = await fs.readJson(written.distinctMotionFamilyReportPath);
  assert.equal(families.status, "blocked");
  assert.equal(families.summary.distinct_motion_family_count, 1);
  assert.ok(families.rejection_reasons.includes("distinct_motion_families_missing"));
  const markdown = await fs.readFile(written.markdownPath, "utf8");
  assert.match(markdown, /write-story/);
  assert.match(markdown, /materialized 1/);
});

test("owned motion materializer creates a source-locked explainer deck when footage is absent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-explainer-"));
  const artifactDir = path.join(root, "kadokawa-package");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "kadokawa-package",
    canonical_subject: "Kadokawa",
    canonical_company: "Kadokawa",
    selected_title: "Kadokawa Stake Just Passed Sony",
    thumbnail_headline: "KADOKAWA STAKE PASSES SONY",
    first_spoken_line: "Kadokawa's activist investor now has a bigger stake than Sony.",
    confirmed_claims: [
      "Oasis Management raised its Kadokawa stake to 11.85%.",
    ],
    primary_source: "IGN",
    source_card_label: "IGN",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "kadokawa-package",
    motion_inventory: { accepted_local_clips: [] },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: [],
  });

  const calls = [];
  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [
        {
          story_id: "kadokawa-package",
          title: "Kadokawa Stake Just Passed Sony",
          artifact_dir: artifactDir,
          actions: [
            {
              action_id: "materialise_owned_generated_motion_clips",
              repair_lane: "owned_generated_explainer_motion_materialisation",
            },
          ],
        },
      ],
    },
    generatedAt: "2026-05-24T05:00:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.outputFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: () => 2.8,
  });

  assert.equal(report.summary.story_count, 1);
  const requiredAssetClasses = [
    "kinetic_title_card",
    "animated_source_card",
    "animated_quote_card",
    "stat_card",
    "chart_slam",
    "lower_third",
    "platform_proof_card",
    "safe_article_screenshot_transform",
    "motion_background",
    "branded_wipe",
    "x_image_card",
    "instagram_carousel_slide",
    "breaking_news_fast_card",
  ];

  assert.equal(report.summary.materialized_clip_count, requiredAssetClasses.length);
  assert.equal(report.stories[0].status, "materialized");
  assert.equal(calls.length, requiredAssetClasses.length);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, requiredAssetClasses.length);
  assert.equal(materialised.owned_explainer_visual_plan, true);
  assert.equal(materialised.distinct_motion_family_count, requiredAssetClasses.length);
  assert.deepEqual(materialised.clips.map((clip) => clip.asset_class), requiredAssetClasses);
  assert.ok(materialised.clips.every((clip) => clip.source_type === "internally_generated_motion_graphic"));
  assert.ok(materialised.clips.every((clip) => clip.counts_towards_motion_readiness === true));
  assert.ok(materialised.clips.every((clip) => clip.file_path && clip.file_path === clip.path));
  assert.ok(materialised.clips.every((clip) => clip.duration >= 2.5));
  assert.ok(materialised.clips.every((clip) => clip.dimensions.width === 1080 && clip.dimensions.height === 1920));
  assert.ok(materialised.clips.every((clip) => clip.frame_rate === 30));
  assert.ok(materialised.clips.every((clip) => clip.motion_family));
  assert.ok(materialised.clips.every((clip) => clip.visual_purpose));
  assert.ok(materialised.clips.every((clip) => clip.rights_basis === "owned_generated_editorial_motion_graphic"));
  assert.ok(materialised.clips.every((clip) => clip.source_relationship === "IGN"));
  assert.ok(materialised.clips.every((clip) => clip.distinctness_score === 1));
  assert.ok(materialised.clips.every((clip) => clip.platform_suitability.includes("youtube_shorts")));

  const familyReport = await fs.readJson(path.join(artifactDir, "distinct_motion_family_report.json"));
  assert.equal(familyReport.status, "ready");
  assert.equal(familyReport.summary.distinct_motion_family_count, requiredAssetClasses.length);
  assert.deepEqual(familyReport.families, materialised.clips.map((clip) => clip.motion_family));

  const ownedManifest = await fs.readJson(path.join(artifactDir, "owned_motion_manifest.json"));
  assert.equal(ownedManifest.status, "ready");
  assert.equal(ownedManifest.summary.asset_count, requiredAssetClasses.length);
  assert.deepEqual(ownedManifest.assets.map((asset) => asset.asset_class), requiredAssetClasses);

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_inventory.owned_explainer_visual_plan, true);
  assert.equal(footage.motion_budget.allow_owned_explainer_motion_only, true);
  assert.equal(footage.motion_inventory.accepted_local_clips.length, requiredAssetClasses.length);

  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.verdict, "pass");
  assert.equal(rights.records.length, requiredAssetClasses.length);
  assert.ok(rights.records.every((record) => record.licence_basis === "owned_generated_editorial_motion_graphic"));
  assert.ok(rights.records.every((record) => record.commercial_use_allowed === true));
});

test("owned motion materializer blocks source-card generation for Reddit-only discovery stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-explainer-reddit-"));
  const artifactDir = path.join(root, "reddit-package");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "reddit-package",
    canonical_subject: "PS5",
    selected_title: "PS5 Price Hike Rumour Hits Europe",
    primary_source: "Reddit",
    source_card_label: "Reddit",
    primary_source_url: "https://www.reddit.com/r/GamingLeaksAndRumours/comments/example",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "reddit-package",
    motion_inventory: { accepted_local_clips: [] },
  });

  const calls = [];
  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [
        {
          story_id: "reddit-package",
          title: "PS5 Price Hike Rumour Hits Europe",
          artifact_dir: artifactDir,
          actions: [
            {
              action_id: "materialise_owned_generated_motion_clips",
              repair_lane: "owned_generated_explainer_motion_materialisation",
            },
          ],
        },
      ],
    },
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.outputFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: () => 2.8,
  });

  assert.equal(calls.length, 13);
  assert.equal(report.stories[0].status, "blocked");
  assert.equal(report.summary.materialized_clip_count, 13);
  assert.equal(report.stories[0].failed[0].reason, "owned_explainer_requires_non_discovery_primary_source");
  assert.deepEqual(report.stories[0].rejection_reasons, [
    "owned_explainer_requires_non_discovery_primary_source",
  ]);
  assert.deepEqual(report.stories[0].blockers, [
    "owned_explainer_requires_non_discovery_primary_source",
  ]);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "blocked");
  assert.equal(materialised.clip_count, 13);
  assert.equal(materialised.clips.every((clip) => clip.counts_towards_motion_readiness === false), true);
  assert.equal(materialised.clips.every((clip) => clip.source_relationship === "discovery_source_only_not_primary"), true);

  const ownedManifest = await fs.readJson(path.join(artifactDir, "owned_motion_manifest.json"));
  assert.equal(ownedManifest.status, "blocked");
  assert.equal(ownedManifest.assets.every((asset) => asset.counts_towards_motion_readiness === false), true);

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_inventory.accepted_local_clips.length, 0);
  assert.equal(footage.motion_inventory.source_safety_blocked_owned_motion_count, 13);

  const written = await writeGoalOwnedMotionMaterializationReport(report, {
    outputDir: path.join(root, "out"),
  });
  assert.equal(await fs.pathExists(written.ownedMotionSourceSafetyWorkOrderPath), true);
  const sourceSafetyWorkOrder = await fs.readJson(written.ownedMotionSourceSafetyWorkOrderPath);
  assert.equal(sourceSafetyWorkOrder.summary.story_count, 1);
  assert.equal(sourceSafetyWorkOrder.summary.operator_required_count, 1);
  assert.equal(sourceSafetyWorkOrder.jobs[0].story_id, "reddit-package");
  assert.equal(sourceSafetyWorkOrder.jobs[0].repair_lane, "non_discovery_primary_source_intake");
  assert.equal(sourceSafetyWorkOrder.jobs[0].operator_approval_required, true);
  assert.equal(sourceSafetyWorkOrder.jobs[0].db_mutation_required, false);
  assert.match(sourceSafetyWorkOrder.jobs[0].exact_missing_input, /non-discovery primary source/i);
  assert.match(sourceSafetyWorkOrder.jobs[0].recommended_command, /official-source-intake/);
  const aggregateManifest = await fs.readJson(written.ownedMotionManifestPath);
  assert.equal(aggregateManifest.status, "partial");
  assert.ok(aggregateManifest.rejection_reasons.includes("owned_explainer_requires_non_discovery_primary_source"));
});

test("owned motion materializer synthesises support deck when existing inventory is not owned-generated", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-explainer-non-owned-inventory-"));
  const artifactDir = path.join(root, "forza-package");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "forza-package",
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
    thumbnail_headline: "XBOX STEAM CEILING",
    first_spoken_line: "Forza Horizon 6 just gave Xbox a Steam record.",
    confirmed_claims: ["Forza Horizon 6 set a Steam player record for Xbox."],
    primary_source: "The Phrasemaker",
    source_card_label: "The Phrasemaker",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "forza-package",
    motion_inventory: {
      accepted_local_clips: [
        {
          id: "non-owned-reference",
          source_family: "forza_reference",
          path: "https://example.com/reference.mp4",
          source_url: "https://example.com/reference.mp4",
          source_type: "official_reference_clip",
          rights_risk_class: "official_reference_only",
          durationS: 3,
          validated: true,
        },
      ],
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { records: [] });

  const calls = [];
  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [
        {
          story_id: "forza-package",
          title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
          artifact_dir: artifactDir,
          actions: [
            {
              action_id: "materialise_owned_generated_motion_clips",
              repair_lane: "owned_generated_explainer_motion_materialisation",
            },
          ],
        },
      ],
    },
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.outputFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: () => 2.8,
  });

  assert.equal(report.stories[0].status, "materialized");
  assert.equal(report.summary.materialized_clip_count, 13);
  assert.equal(calls.length, 13);
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 13);
  assert.equal(materialised.distinct_motion_family_count, 13);
  assert.equal(materialised.clips.every((clip) => clip.source_type === "internally_generated_motion_graphic"), true);
});

test("owned motion materializer refresh expands thin owned explainer decks to the full motion pack", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-motion-refresh-expand-"));
  const artifactDir = path.join(root, "thin-owned");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "thin-owned",
    canonical_subject: "Fable",
    selected_title: "Fable Still Has a PS5 Question",
    thumbnail_headline: "FABLE'S PS5 QUESTION",
    first_spoken_line: "Fable still has one awkward platform question.",
    confirmed_claims: ["Fable remains part of Xbox's publishing plan."],
    primary_source: "Eurogamer",
    source_card_label: "Eurogamer",
  });
  const thinClips = Array.from({ length: 5 }, (_, index) => ({
    id: `thin-owned-card-${index + 1}`,
    source_family: `thin_owned_card_${index + 1}`,
    motion_family: `thin_owned_card_${index + 1}`,
    visual_family: `thin_owned_card_${index + 1}`,
    path: `output/generated-motion/thin-owned/${index + 1}_owned_motion_card.mp4`,
    source_url: `local://pulse-generated-motion/thin-owned/card-${index + 1}`,
    source_type: "internally_generated_motion_graphic",
    rights_risk_class: "owned_generated_motion",
    media_kind: "owned_explainer_motion",
    owned_explainer_visual_plan: true,
    counts_towards_motion_readiness: true,
    durationS: 2.8,
    validated: true,
  }));
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "thin-owned",
    motion_budget: {
      allow_owned_explainer_motion_only: true,
      owned_explainer_visual_plan: true,
      required_motion_scenes: 5,
      required_distinct_families: 5,
    },
    motion_inventory: {
      owned_explainer_visual_plan: true,
      accepted_local_clips: thinClips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { records: [] });

  const calls = [];
  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [
        {
          story_id: "thin-owned",
          title: "Fable Still Has a PS5 Question",
          artifact_dir: artifactDir,
          actions: [
            {
              action_id: "materialise_owned_generated_motion_clips",
              repair_lane: "owned_generated_explainer_motion_materialisation",
            },
          ],
        },
      ],
    },
    refreshExisting: true,
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.outputFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: () => 2.8,
  });

  assert.equal(report.summary.materialized_clip_count, 13);
  assert.equal(calls.length, 13);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 13);
  assert.equal(materialised.distinct_motion_family_count, 13);
  assert.ok(materialised.clips.some((clip) => clip.asset_class === "branded_wipe"));
  assert.ok(materialised.clips.some((clip) => clip.asset_class === "instagram_carousel_slide"));

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_budget.required_motion_scenes, 13);
  assert.equal(footage.motion_inventory.accepted_local_clips.length, 13);
});
