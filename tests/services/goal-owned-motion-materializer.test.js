"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildOwnedMotionFrameLayout,
  buildOwnedMotionFfmpegArgs,
  canonicalRightsSource,
  materializeGoalOwnedMotionClips,
  writeGoalOwnedMotionMaterializationReport,
} = require("../../lib/goal-owned-motion-materializer");
const {
  evaluateOwnedMotionRightsEvidence,
} = require("../../lib/owned-motion-rights-evidence");
const { buildClipScenePlan } = require("../../tools/studio-v4-proof-render");

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

test("owned motion generator gives every primary project a per-frame camera path", () => {
  const canonical = {
    canonical_subject: "Perfect Dark",
    selected_title: "Perfect Dark Has A New Studio Signal",
    primary_source: "Xbox Wire",
  };
  const projectClips = [
    {
      id: "kinetic-primary",
      asset_class: "kinetic_aperture_surface",
      generator_project_id: "pulse.motion.kinetic-aperture.v1",
      generator_variant: 0,
      durationS: 7,
    },
    {
      id: "signal-primary",
      asset_class: "signal_scan_surface",
      generator_project_id: "pulse.motion.signal-lattice.v1",
      generator_variant: 0,
      durationS: 7,
    },
    {
      id: "data-primary",
      asset_class: "data_pulse_surface",
      generator_project_id: "pulse.motion.data-ribbons.v1",
      generator_variant: 0,
      durationS: 7,
    },
    {
      id: "orbit-primary",
      asset_class: "orbital_cluster_surface",
      generator_project_id: "pulse.motion.spatial-orbits.v1",
      generator_variant: 0,
      durationS: 7,
    },
  ];

  for (const clip of projectClips) {
    const args = buildOwnedMotionFfmpegArgs({
      clip,
      canonical,
      output: `${clip.id}.mp4`,
    });
    const filterGraph = args[args.indexOf("-vf") + 1];
    assert.match(
      filterGraph,
      /crop=1080:1920:x='[^']*sin\(t\*[^']*':y='[^']*cos\(t\*/,
      clip.generator_project_id,
    );
  }
});

test("signal lattice primary keeps continuous full-frame scan energy", () => {
  const args = buildOwnedMotionFfmpegArgs({
    clip: {
      id: "signal-primary",
      asset_class: "signal_scan_surface",
      generator_project_id: "pulse.motion.signal-lattice.v1",
      generator_variant: 0,
      durationS: 7,
    },
    canonical: {
      canonical_subject: "Halo Campaign Evolved",
      selected_title: "Halo Campaign Evolved Is Coming",
      primary_source: "Xbox Wire",
    },
    output: "signal-primary.mp4",
  });
  const filterGraph = args[args.indexOf("-vf") + 1];

  assert.match(
    filterGraph,
    /drawbox=x='mod\(t\*720,1380\)-300':y=0:w=300:h=ih/,
  );
  assert.match(
    filterGraph,
    /drawbox=x=0:y='mod\(t\*620,2180\)-260':w=iw:h=260/,
  );
  assert.match(
    filterGraph,
    /drawbox=x='mod\(t\*1560,1260\)-180':y=0:w=180:h=ih:color=white@0\.34/,
  );
  assert.match(
    filterGraph,
    /drawbox=x='1080-mod\(t\*1320,1260\)':y=0:w=180:h=ih:color=0x38BDF8@0\.38/,
  );
  assert.match(filterGraph, /scroll=horizontal=0\.04:vertical=0\.0015/);
  assert.match(filterGraph, /rotate='0\.006\*t':ow=iw:oh=ih:c=0x12333A/);
});

test("spatial orbit trajectory keeps continuous full-frame scan energy", () => {
  const args = buildOwnedMotionFfmpegArgs({
    clip: {
      id: "trajectory-primary",
      asset_class: "trajectory_arc_surface",
      generator_project_id: "pulse.motion.spatial-orbits.v1",
      generator_variant: 3,
      durationS: 7,
    },
    canonical: {
      canonical_subject: "Halo Campaign Evolved",
      selected_title: "Halo Campaign Evolved Is Coming",
      primary_source: "Xbox Wire",
    },
    output: "trajectory-primary.mp4",
  });
  const filterGraph = args[args.indexOf("-vf") + 1];

  assert.match(filterGraph, /scroll=horizontal=0\.018:vertical=0\.001/);
  assert.match(filterGraph, /rotate='0\.004\*t':ow=iw:oh=ih:c=0x241B12/);
});

test("spatial orbit constellation emits a dense full-frame information lattice", () => {
  const args = buildOwnedMotionFfmpegArgs({
    clip: {
      id: "constellation-primary",
      asset_class: "constellation_drift_surface",
      generator_project_id: "pulse.motion.spatial-orbits.v1",
      generator_variant: 2,
      durationS: 7,
    },
    canonical: {
      canonical_subject: "Halo Campaign Evolved",
      selected_title: "Halo Campaign Evolved Is Coming",
      primary_source: "Xbox Wire",
    },
    output: "constellation-primary.mp4",
  });
  const filterGraph = args[args.indexOf("-vf") + 1];

  assert.match(
    filterGraph,
    /drawgrid=width=80:height=128:thickness=10:color=0xCCFBF1@0\.50/,
  );
  assert.match(filterGraph, /scroll=horizontal=0\.018:vertical=0\.001/);
  assert.match(filterGraph, /rotate='0\.004\*t':ow=iw:oh=ih:c=0x0D2D27/);
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
  assert.doesNotMatch(vf, /MOTION PROOF|SOURCE LOCK|VERIFY/);
  assert.match(vf, /PULSE \/\/ BREAKDOWN/);
  assert.match(vf, /SOURCE IGN PREVIEW/);
  assert.match(vf, /SOURCED/);
  assert.match(vf, /mod\(t\*520,1540\)/);
  assert.match(vf, /color=0x38BDF8@0\.92/);
  assert.match(vf, /shadowcolor=black@0\.82:shadowx=3:shadowy=3/);
});

test("owned motion cards prefer clip-specific public copy over a repeated thumbnail headline", () => {
  const layout = buildOwnedMotionFrameLayout({
    clip: {
      id: "unciv-owned-motion-quote",
      asset_class: "animated_quote_card",
      headline: "AI settlers now expand in parallel",
      visual_purpose: "WHAT CHANGED",
    },
    canonical: {
      canonical_subject: "Unciv 4.21.3",
      thumbnail_headline: "UNCIV 4.21.3 SMARTER RIVALS",
      selected_title: "Unciv 4.21.3 Makes Its AI Smarter",
      primary_source: "Official GitHub release",
    },
  });

  const headline = layout.text_blocks.find((block) => block.id === "headline").lines.join(" ");
  const purpose = layout.text_blocks.find((block) => block.id === "purpose").lines.join(" ");
  const source = layout.text_blocks.find((block) => block.id === "source").lines.join(" ");

  assert.match(headline, /AI SETTLERS NOW EXPAND IN PARALLEL/);
  assert.doesNotMatch(headline, /SMARTER RIVALS/);
  assert.equal(purpose, "WHAT CHANGED");
  assert.equal(source, "SOURCE OFFICIAL GITHUB RELEASE");
  assert.doesNotMatch(`${headline} ${purpose} ${source}`, /LOCK|PROOF|SUPPORT/);
});

test("owned motion materializer enforces readable dwell time for explainer cards", () => {
  const canonical = {
    canonical_subject: "Halo Campaign Evolved",
    thumbnail_headline: "Halo Campaign Evolved Finally Shows Its PS5 Catch",
    selected_title: "Halo Campaign Evolved Finally Shows Its PS5 Catch",
    primary_source: "Xbox Wire",
  };
  const clip = {
    id: "halo-owned-motion-1",
    source_family: "halo_kinetic_title_card",
    visual_purpose: "source-backed platform catch",
    path: "output/generated-motion/halo/01_kinetic_title_card.mp4",
    source_url: "local://pulse-generated-motion/halo/kinetic_title_card",
    source_kind: "owned_source_card_explainer_motion",
    media_kind: "owned_explainer_motion",
    rights_risk_class: "owned_generated_motion",
    owned_explainer_visual_plan: true,
    durationS: 3.2,
  };

  const args = buildOwnedMotionFfmpegArgs({
    clip,
    canonical,
    output: path.join("output", "generated-motion", "halo", "01_kinetic_title_card.mp4"),
  });

  assert.equal(args[args.indexOf("-t") + 1], "12.00");
  assert.match(args[args.indexOf("-i") + 1], /d=12\.00$/);
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
      "The disclosed holding is now larger than Sony's stake.",
      "Kadokawa published the ownership filing this week.",
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
    "kinetic_aperture_surface",
    "parallax_stripe_field",
    "impact_tunnel_surface",
    "kinetic_broll_surface",
    "branded_wipe",
    "signal_scan_surface",
    "topology_node_field",
    "waveform_scope_surface",
    "radar_sweep_surface",
    "data_pulse_surface",
    "comparative_bar_race",
    "metric_ribbon_flow",
    "timeline_cascade_surface",
    "orbital_cluster_surface",
    "radial_phase_field",
    "constellation_drift_surface",
    "trajectory_arc_surface",
    "animated_source_card",
    "animated_quote_card",
    "stat_card",
    "platform_proof_card",
  ];

  assert.equal(report.summary.materialized_clip_count, requiredAssetClasses.length);
  assert.equal(report.stories[0].status, "materialized");
  assert.equal(calls.length, requiredAssetClasses.length);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, requiredAssetClasses.length);
  assert.equal(materialised.owned_explainer_visual_plan, true);
  assert.equal(materialised.distinct_motion_family_count, 5);
  assert.equal(materialised.materially_distinct_generator_project_count, 4);
  assert.deepEqual(materialised.clips.map((clip) => clip.asset_class), requiredAssetClasses);
  assert.ok(materialised.clips.every((clip) => clip.source_type === "internally_generated_motion_graphic"));
  assert.ok(materialised.clips.every((clip) => clip.counts_towards_motion_readiness === true));
  assert.ok(materialised.clips.every((clip) => clip.file_path && clip.file_path === clip.path));
  assert.ok(materialised.clips.every((clip) => clip.duration >= 4));
  assert.ok(materialised.clips.every((clip) => clip.dimensions.width === 1080 && clip.dimensions.height === 1920));
  assert.ok(materialised.clips.every((clip) => clip.frame_rate === 30));
  assert.ok(materialised.clips.every((clip) => clip.motion_family));
  assert.ok(materialised.clips.every((clip) => clip.visual_purpose));
  assert.ok(materialised.clips.every((clip) => clip.rights_basis === "owned_generated_editorial_motion_graphic"));
  assert.ok(materialised.clips.every((clip) => clip.source_relationship === "IGN"));
  assert.ok(materialised.clips.every((clip) => clip.distinctness_score > 0 && clip.distinctness_score < 1));
  assert.ok(materialised.clips.every((clip) => clip.platform_suitability.includes("youtube_shorts")));

  const supportCards = materialised.clips.filter((clip) => clip.hyperframes_card === true);
  assert.equal(supportCards.length, 4);
  assert.ok(supportCards.every((clip) => !/lock|proof|support/i.test(clip.visual_purpose)));
  assert.ok(new Set(supportCards.map((clip) => clip.readable_text)).size >= 3);
  assert.match(
    supportCards.find((clip) => clip.asset_class === "animated_quote_card").readable_text,
    /11\.85%/,
  );
  assert.match(
    supportCards.find((clip) => clip.asset_class === "stat_card").readable_text,
    /larger than Sony/i,
  );
  assert.match(
    supportCards.find((clip) => clip.asset_class === "platform_proof_card").readable_text,
    /ownership filing/i,
  );

  const familyReport = await fs.readJson(path.join(artifactDir, "distinct_motion_family_report.json"));
  assert.equal(familyReport.status, "ready");
  assert.equal(familyReport.summary.distinct_motion_family_count, 5);
  assert.equal(familyReport.summary.materially_distinct_generator_project_count, 4);
  assert.deepEqual(familyReport.families, [...new Set(materialised.clips.map((clip) => clip.motion_family))]);

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

test("owned motion materializer emits four materially distinct procedural project masters with complete evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-projects-"));
  const artifactDir = path.join(root, "project-package");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "project-package",
    canonical_subject: "Perfect Dark",
    selected_title: "Perfect Dark Has A New Studio Signal",
    thumbnail_headline: "PERFECT DARK SIGNAL",
    first_spoken_line: "Perfect Dark just picked up a new studio signal.",
    confirmed_claims: ["Xbox Wire published a new Perfect Dark studio update."],
    primary_source: "Xbox Wire",
    source_card_label: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/en-gb/perfect-dark-studio-update/",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "project-package",
    motion_inventory: { accepted_local_clips: [] },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { records: [] });

  const calls = [];
  await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [
        {
          story_id: "project-package",
          title: "Perfect Dark Has A New Studio Signal",
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
    generatedAt: "2026-07-17T08:00:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.outputFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: () => 12,
  });

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  const primaryProcedural = materialised.clips.filter(
    (clip) => clip.generator_design_role === "primary_procedural_motion",
  );
  const supportCards = materialised.clips.filter(
    (clip) => clip.generator_design_role === "support_card",
  );
  const projectIds = new Set(primaryProcedural.map((clip) => clip.generator_project_id));
  const projectMasters = new Set(primaryProcedural.map((clip) => clip.generator_master_sha256));
  const filterGraphByClip = primaryProcedural.map((clip) => {
      const args = buildOwnedMotionFfmpegArgs({
        clip,
        canonical: {
          canonical_subject: "Perfect Dark",
          selected_title: "Perfect Dark Has A New Studio Signal",
          primary_source: "Xbox Wire",
        },
        output: clip.path,
      });
      return { clip, filterGraph: args[args.indexOf("-vf") + 1] };
    });
  const filterGraphs = new Set(filterGraphByClip.map((entry) => entry.filterGraph));

  assert.ok(primaryProcedural.length >= 16);
  assert.ok(supportCards.length <= 4);
  assert.equal(projectIds.size, 4);
  assert.equal(projectMasters.size, 4);
  assert.equal(filterGraphs.size, primaryProcedural.length);
  for (const projectId of projectIds) {
    const projectEntries = filterGraphByClip.filter(
      (entry) => entry.clip.generator_project_id === projectId,
    );
    assert.equal(
      new Set(projectEntries.map((entry) => entry.filterGraph)).size,
      projectEntries.length,
    );
  }
  assert.ok([...filterGraphs].every((filterGraph) => !filterGraph.includes("PULSE // MOTION PROOF")));
  const kineticFilter = [...filterGraphs].find((filterGraph) =>
    filterGraph.includes("color=0x18263A@1"),
  );
  const signalFilter = [...filterGraphs].find((filterGraph) =>
    filterGraph.includes("color=0x12333A@1"),
  );
  const comparativeBarRaceFilter = filterGraphByClip.find(
    (entry) => entry.clip.asset_class === "comparative_bar_race",
  )?.filterGraph;
  const orbitalClusterFilter = filterGraphByClip.find(
    (entry) => entry.clip.asset_class === "orbital_cluster_surface",
  )?.filterGraph;
  assert.ok(kineticFilter);
  assert.match(kineticFilter, /drawgrid=width=36:height=48:thickness=3:color=white@0\.38/);
  assert.equal((kineticFilter.match(/w=160:h=84/g) || []).length, 24);
  assert.doesNotMatch(kineticFilter, /color=0x070A0F@1/);
  assert.ok(signalFilter);
  assert.match(signalFilter, /drawgrid=width=45:height=48:thickness=3:color=white@0\.34/);
  assert.equal((signalFilter.match(/w=64:h=40/g) || []).length, 48);
  assert.doesNotMatch(signalFilter, /w=iw:h=70/);
  assert.doesNotMatch(signalFilter, /color=0x040B0C@1/);
  assert.ok(comparativeBarRaceFilter);
  assert.match(
    comparativeBarRaceFilter,
    /drawbox=x=0:y=0:w=iw:h=ih:color=0x24364A@1:t=fill/,
  );
  assert.doesNotMatch(comparativeBarRaceFilter, /color=0x10172A@1/);
  assert.match(
    comparativeBarRaceFilter,
    /drawbox=x=0:y=0:w=iw:h=120:color=0x38BDF8@0\.58:t=fill/,
  );
  assert.match(
    comparativeBarRaceFilter,
    /drawbox=x=0:y=1800:w=iw:h=120:color=0xF43F5E@0\.58:t=fill/,
  );
  assert.ok(orbitalClusterFilter);
  assert.match(
    orbitalClusterFilter,
    /drawbox=x=0:y=0:w=iw:h=ih:color=0x071C2B@1:t=fill/,
  );
  assert.match(orbitalClusterFilter, /sin\(t\*/);
  assert.match(orbitalClusterFilter, /cos\(t\*/);
  assert.ok(primaryProcedural.every((clip) => {
    if (/kinetic-aperture/.test(clip.generator_project_id)) return clip.generator_version === 5;
    if (/signal-lattice/.test(clip.generator_project_id)) return clip.generator_version === 7;
    if (/data-ribbons/.test(clip.generator_project_id)) return clip.generator_version === 5;
    if (/spatial-orbits/.test(clip.generator_project_id)) return clip.generator_version === 4;
    return false;
  }));
  assert.ok(primaryProcedural.every((clip) => clip.seek_safe === true));
  assert.ok(primaryProcedural.every((clip) => clip.reproducible === true));

  for (const clip of materialised.clips) {
    assert.match(clip.generator_project_id, /^pulse\.motion\.[a-z-]+\.v\d+$/);
    assert.match(clip.generator_master_sha256, /^[a-f0-9]{64}$/);
    assert.match(clip.sampled_visual_fingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.equal(clip.source_master_identity.generator_project_id, clip.generator_project_id);
    assert.equal(clip.source_master_identity.source_master_sha256, clip.generator_master_sha256);
    assert.match(clip.materialised_output_sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      clip.materialised_output_sha256,
      crypto.createHash("sha256").update(await fs.readFile(clip.path)).digest("hex"),
    );
    assert.equal(clip.materialised_output_size_bytes, (await fs.stat(clip.path)).size);
    assert.equal(clip.rights_grant.grant_type, "owned_generated");
    assert.equal(clip.rights_grant.rights_holder, "Pulse Gaming");
    assert.equal(clip.rights_grant.commercial_use_allowed, true);
    assert.deepEqual(clip.rights_grant.allowed_platforms, clip.allowed_platforms);
    assert.ok(clip.allowed_platforms.includes("youtube_shorts"));
    assert.equal(await fs.pathExists(clip.evidence_file.path), true);
    assert.match(clip.evidence_file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      clip.evidence_file.sha256,
      crypto.createHash("sha256").update(await fs.readFile(clip.evidence_file.path)).digest("hex"),
    );
    assert.equal(clip.evidence_file.size_bytes, (await fs.stat(clip.evidence_file.path)).size);
  }

  assert.equal(materialised.strict_green_claimed, false);
  assert.equal(materialised.control_tower_verdict, null);
  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.ok(rights.records.every((record) => record.rights_grant === true));
  assert.ok(
    rights.records.every(
      (record) => record.owned_generated_rights_grant.grant_type === "owned_generated",
    ),
  );
  assert.ok(rights.records.every((record) => record.evidence_sha256));
  assert.ok(rights.records.every((record) => record.materialised_output_sha256));
  const strictOwnedRecords = rights.records.filter(
    (record) => record.asset_kind === "procedural_clip",
  );
  assert.equal(strictOwnedRecords.length, materialised.clips.length);
  for (const record of strictOwnedRecords) {
    assert.equal(record.allowed_use, "finished_editorial_video_only");
    const evaluation = await evaluateOwnedMotionRightsEvidence({
      record,
      required_platforms: record.allowed_platforms,
    });
    assert.equal(
      evaluation.status,
      "pass",
      `${record.asset_id}: ${evaluation.blockers.join(", ")}`,
    );
    assert.notEqual(record.path, record.evidence_file);
    assert.equal(await fs.pathExists(record.evidence_file), true);
    assert.match(record.asset_sha256, /^[a-f0-9]{64}$/);
    assert.match(record.evidence_sha256, /^[a-f0-9]{64}$/);
  }
});

test("owned motion project masters and outputs are reproducible across clean materialisations", async () => {
  async function runCleanMaterialisation(root) {
    const artifactDir = path.join(root, "repro-package");
    await fs.ensureDir(artifactDir);
    await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
      story_id: "repro-package",
      canonical_subject: "Fable",
      selected_title: "Fable Has A New Release Signal",
      primary_source: "Xbox Wire",
      primary_source_url: "https://news.xbox.com/en-gb/fable-release-update/",
    });
    await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
      motion_inventory: { accepted_local_clips: [] },
    });
    let renderIndex = 0;
    await materializeGoalOwnedMotionClips({
      root,
      workOrder: {
        jobs: [
          {
            story_id: "repro-package",
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
        renderIndex += 1;
        fs.outputFileSync(args[args.length - 1], Buffer.alloc(2048, renderIndex));
      },
      ffprobeDuration: () => 5,
    });
    const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
    return materialised.clips.map((clip) => ({
      asset_class: clip.asset_class,
      generator_project_id: clip.generator_project_id,
      generator_master_sha256: clip.generator_master_sha256,
      deterministic_seed: clip.deterministic_seed,
      sampled_visual_fingerprint: clip.sampled_visual_fingerprint,
      materialised_output_sha256: clip.materialised_output_sha256,
      materialised_output_size_bytes: clip.materialised_output_size_bytes,
    }));
  }

  const first = await runCleanMaterialisation(
    await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-repro-a-")),
  );
  const second = await runCleanMaterialisation(
    await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-repro-b-")),
  );

  assert.deepEqual(second, first);
});

test("owned motion materializer creates renderer-compatible motion-heavy decks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-motion-scene-plan-"));
  const artifactDir = path.join(root, "switch-screen-package");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "switch-screen-package",
    canonical_subject: "Switch 2",
    selected_title: "Switch 2 Screen Rumour Has A Ghosting Test",
    thumbnail_headline: "GHOSTING TEST",
    first_spoken_line: "Switch 2 just picked up a screen rumour players can actually check.",
    confirmed_claims: [
      "GameSpot says the original Nintendo Switch will be discontinued in Europe.",
    ],
    primary_source: "GameSpot",
    source_card_label: "GameSpot",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "switch-screen-package",
    motion_inventory: { accepted_local_clips: [] },
  });

  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [
        {
          story_id: "switch-screen-package",
          title: "Switch 2 Screen Rumour Has A Ghosting Test",
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
    execFileSync: (bin, args) => fs.outputFileSync(args[args.length - 1], Buffer.alloc(4096, 3)),
    ffprobeDuration: () => 12,
  });

  assert.equal(report.summary.story_count, 1);
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  const plan = buildClipScenePlan({
    clips: materialised.clips,
    durationS: 42,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
    maxScenes: 8,
  });

  assert.equal(plan.blockers.includes("direct_motion_base_source_repeated"), false);
  assert.deepEqual(plan.repeatedBaseSources, []);
  assert.equal(plan.scenes.length >= 7, true);
  assert.equal(plan.readableCardSceneMetrics.direct_motion_scene_count >= 4, true);
  assert.equal(plan.readableCardSceneMetrics.readable_card_duration_ratio <= 0.42, true);
  assert.equal(plan.scenes.filter((scene) => scene.readableCardKind).length <= 1, true);
});

test("owned motion materializer executes readable HyperFrames rematerialisation lane", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-readable-lane-"));
  const artifactDir = path.join(root, "readable-package");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "readable-package",
    canonical_subject: "Halo Campaign Evolved",
    selected_title: "Halo Campaign Evolved Has A PS5 Catch",
    thumbnail_headline: "HALO PS5 CATCH",
    first_spoken_line: "Halo Campaign Evolved has one platform catch.",
    confirmed_claims: ["Halo Campaign Evolved requires an account sign-in on PS5."],
    primary_source: "Xbox Wire",
    source_card_label: "Xbox Wire",
  });
  const staleSharedCardPath = path.join(
    root,
    "test",
    "output",
    "hf_source_card_readable-package.mp4",
  );
  await fs.outputFile(staleSharedCardPath, Buffer.alloc(4096, 23));
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "readable-package",
    motion_inventory: {
      accepted_local_clips: [{
        id: "hyperframes_premium_shell_source_legacy",
        path: staleSharedCardPath,
        source_url: "local://hyperframes/readable-package/source",
        source_type: "hyperframes_premium_shell_card",
        source_family: "hyperframes_source_card",
        motion_family: "hyperframes_source_card",
        media_kind: "owned_editorial_motion_graphic",
        rights_basis: "official_direct_media",
        counts_towards_motion_readiness: true,
      }],
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { records: [] });

  const calls = [];
  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [
        {
          story_id: "readable-package",
          title: "Halo Campaign Evolved Has A PS5 Catch",
          artifact_dir: artifactDir,
          actions: [
            {
              action_id: "materialise_owned_generated_motion_clips",
              repair_lane: "readable_hyperframes_card_motion_rematerialisation",
            },
          ],
        },
      ],
    },
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.outputFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: () => 12,
  });

  assert.equal(report.summary.materialized_clip_count, 21);
  assert.equal(calls.length, 21);
  const packageMotionDir = path.join(artifactDir, "owned-motion", "generated");
  assert.ok(
    report.stories[0].materialized.every((result) =>
      path.resolve(result.path).startsWith(`${path.resolve(packageMotionDir)}${path.sep}`),
    ),
  );
  assert.ok(
    report.stories[0].materialized.every((result) =>
      !path.resolve(result.path).startsWith(
        `${path.resolve(root, "output", "generated-motion")}${path.sep}`,
      ),
    ),
  );
  const durations = calls.map((call) => call.args[call.args.indexOf("-t") + 1]);
  assert.equal(durations.filter((duration) => duration === "12.00").length, 4);
  assert.equal(durations.filter((duration) => Number(duration) === 7).length, 17);
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 21);
  assert.equal(
    materialised.clips.some((clip) => clip.id === "hyperframes_premium_shell_source_legacy"),
    false,
  );
  assert.equal(
    materialised.clips
      .filter((clip) => clip.generator_design_role === "primary_procedural_motion")
      .every((clip) => clip.durationS === 7),
    true,
  );
  const readableCards = materialised.clips.filter((clip) => clip.readable_card_kind);
  assert.equal(readableCards.length, 4);
  assert.ok(readableCards.every((clip) => clip.minimum_readable_duration_s >= 12));
  assert.deepEqual(
    readableCards.filter((clip) => clip.readable_card_kind === "source").map((clip) => clip.readable_text),
    ["Xbox Wire"],
  );
  const sourceSidecar = await fs.readJson(`${readableCards.find((clip) => clip.readable_card_kind === "source").path}.json`);
  assert.equal(sourceSidecar.card_kind, "source");
  assert.equal(sourceSidecar.minimum_readable_duration_s, 12);
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

  assert.equal(calls.length, 0);
  assert.equal(report.stories[0].status, "blocked");
  assert.equal(report.summary.materialized_clip_count, 0);
  assert.equal(report.stories[0].failed[0].reason, "owned_explainer_requires_non_discovery_primary_source");
  assert.deepEqual(report.stories[0].rejection_reasons, [
    "owned_explainer_requires_non_discovery_primary_source",
  ]);
  assert.deepEqual(report.stories[0].blockers, [
    "owned_explainer_requires_non_discovery_primary_source",
  ]);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "blocked");
  assert.equal(materialised.clip_count, 0);
  assert.deepEqual(materialised.clips, []);

  const ownedManifest = await fs.readJson(path.join(artifactDir, "owned_motion_manifest.json"));
  assert.equal(ownedManifest.status, "blocked");
  assert.deepEqual(ownedManifest.assets, []);

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_inventory.accepted_local_clips.length, 0);
  assert.equal(footage.motion_inventory.source_safety_blocked_owned_motion_count, 0);

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
  assert.equal(aggregateManifest.status, "blocked");
  assert.ok(aggregateManifest.rejection_reasons.includes("owned_explainer_requires_non_discovery_primary_source"));
});

test("owned motion materializer rejects explicitly unsafe source manifests without generating clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-explainer-unsafe-"));
  const artifactDir = path.join(root, "unsafe-package");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "unsafe-package",
    canonical_subject: "Xbox",
    selected_title: "Xbox Hardware Claim",
    primary_source: "Unknown blog",
    primary_source_url: "https://example.invalid/unverified-claim",
    source_safety_status: "unsafe",
    source_verified: false,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "unsafe-package",
    motion_inventory: { accepted_local_clips: [] },
  });

  const calls = [];
  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [
        {
          story_id: "unsafe-package",
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
    execFileSync: (...args) => calls.push(args),
    ffprobeDuration: () => 12,
  });

  assert.equal(calls.length, 0);
  assert.equal(report.stories[0].status, "blocked");
  assert.ok(report.stories[0].blockers.includes("owned_explainer_source_unsafe"));
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "blocked");
  assert.equal(materialised.clip_count, 0);
  assert.ok(materialised.rejection_reasons.includes("owned_explainer_source_unsafe"));
  assert.equal(materialised.strict_green_claimed, false);
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
  assert.equal(report.summary.materialized_clip_count, 21);
  assert.equal(calls.length, 21);
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 21);
  assert.equal(materialised.distinct_motion_family_count, 5);
  assert.equal(materialised.materially_distinct_generator_project_count, 4);
  assert.equal(materialised.clips.every((clip) => clip.source_type === "internally_generated_motion_graphic"), true);
});

test("owned motion materializer preserves existing official direct-video clips when adding support deck", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-explainer-merge-direct-video-"));
  const artifactDir = path.join(root, "ghost-package");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "ghost-package",
    canonical_subject: "Ghost at Dawn",
    selected_title: "Ghost at Dawn Has A Jump-Scare Risk",
    thumbnail_headline: "JUMP-SCARE RISK",
    first_spoken_line: "Ghost at Dawn is not just another haunted-house trailer.",
    confirmed_claims: ["Ghost at Dawn is listed on Xbox Wire and PlayStation Store."],
    primary_source: "Xbox Wire",
    source_card_label: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/en-us/2026/06/19/ghost-at-dawn-is-about-fear-empathy/",
  });
  const directClips = Array.from({ length: 5 }, (_, index) => ({
    id: `ghost-direct-${index + 1}`,
    source_family: `ghost_direct_window_${index + 1}`,
    motion_family: `ghost_direct_window_${index + 1}`,
    visual_family: `ghost_direct_window_${index + 1}`,
    path: path.join(root, "video-cache", `ghost-direct-${index + 1}.mp4`),
    local_materialized_path: path.join(root, "video-cache", `ghost-direct-${index + 1}.mp4`),
    source_url: "https://video.fastly.steamstatic.com/store_trailers/2806050/1673450740/ed598dc7526249e6bd74f53732f9a6ecf71f8063/1780963408/hls_264_master.m3u8?t=1781050956",
    source_type: "licensed_direct_media_url",
    media_kind: "direct_video",
    rights_basis: "official_direct_media",
    counts_towards_motion_readiness: true,
    source_media_start_s: index * 6,
    source_window_duration_s: 5,
    durationS: 5,
    validated: true,
    materialized: true,
  }));
  for (const [index, clip] of directClips.entries()) {
    const bytes = Buffer.alloc(4096, index + 1);
    await fs.outputFile(clip.path, bytes);
    clip.asset_sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    clip.asset_size_bytes = bytes.length;
  }
  const policyEvidencePath = path.join(root, "rights", "ghost-publisher-policy.html");
  const policyEvidenceBytes = Buffer.alloc(3072, 19);
  await fs.outputFile(policyEvidencePath, policyEvidenceBytes);
  const policyEvidenceSha256 = crypto
    .createHash("sha256")
    .update(policyEvidenceBytes)
    .digest("hex");
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "ghost-package",
    readiness: {
      can_render: true,
      can_publish: true,
      publish_blockers: [],
    },
    motion_inventory: {
      accepted_local_clips: directClips,
      production_motion_clips: directClips,
      direct_video_motion_asset_count: 5,
      direct_video_motion_family_count: 5,
    },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    story_id: "ghost-package",
    status: "ready",
    clips: directClips,
    materialised_clips: directClips,
    clip_count: directClips.length,
    distinct_motion_family_count: directClips.length,
    direct_video_motion_asset_count: directClips.length,
    direct_video_motion_family_count: directClips.length,
  });
  const directRightsRecords = directClips.map((clip) => ({
    asset_id: clip.id,
    path: clip.path,
    source_url: "https://video.akamai.steamstatic.com/store_trailers/2806050/1673450740/ed598dc7526249e6bd74f53732f9a6ecf71f8063/1780963408/dash_h264.mpd?t=1781050956",
    source_type: clip.source_type,
    licence_basis: "official_promotional_media_transformative_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    rights_grant: true,
    asset_sha256: clip.asset_sha256,
    asset_size_bytes: clip.asset_size_bytes,
    source_media_start_s: clip.source_media_start_s,
    source_window_duration_s: clip.source_window_duration_s,
    evidence_file: policyEvidencePath,
    evidence_sha256: policyEvidenceSha256,
    evidence_size_bytes: policyEvidenceBytes.length,
    risk_score: 0.2,
    rights_status: "conditional_youtube_ad_program_scope",
    approval_status: "approved_for_local_materialization_only",
    usage_status: "human_legal_review_required_before_publish",
    live_publish_allowed: false,
    requires_human_legal_review_before_publish: true,
  }));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: [],
    rights_ledger: directRightsRecords,
    assets: directRightsRecords,
  });

  const calls = [];
  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [
        {
          story_id: "ghost-package",
          title: "Ghost at Dawn Has A Jump-Scare Risk",
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
    generatedAt: "2026-06-22T05:00:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.outputFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: () => 2.8,
  });

  assert.equal(report.summary.materialized_clip_count, 21);
  assert.equal(calls.length, 21);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 26);
  assert.equal(materialised.direct_video_motion_asset_count, 5);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "direct_video").length, 5);
  assert.equal(
    materialised.clips.filter((clip) => clip.source_type === "internally_generated_motion_graphic").length,
    21,
  );
  assert.ok(materialised.clips.some((clip) => clip.id === "ghost-direct-1"));
  assert.ok(materialised.clips.some((clip) => clip.asset_class === "branded_wipe"));

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_inventory.accepted_local_clips.length, 26);
  assert.equal(footage.motion_inventory.production_motion_clips.length, 26);
  assert.equal(footage.motion_inventory.direct_video_motion_asset_count, 5);
  assert.equal(footage.motion_budget.required_motion_scenes, 26);
  assert.equal(footage.readiness.can_render, true);
  assert.equal(footage.readiness.can_publish, false);
  assert.ok(footage.readiness.publish_blockers.includes("rights:direct_motion_live_publish_hold"));
  assert.ok(
    footage.readiness.publish_blockers.includes(
      "rights:human_legal_review_required_before_publish",
    ),
  );

  const ownedManifest = await fs.readJson(path.join(artifactDir, "owned_motion_manifest.json"));
  assert.equal(ownedManifest.summary.asset_count, 21);
  assert.equal(ownedManifest.assets.every((asset) => asset.source_type === "internally_generated_motion_graphic"), true);
  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.ok(directClips.every((clip) =>
    rights.records.some((record) => record.asset_id === clip.id),
  ));
  assert.equal(rights.status, "local_materialization_only");
  assert.equal(rights.verdict, "amber");
  assert.equal(rights.motion_rights_verdict, "amber");
  assert.equal(rights.live_publish_allowed, false);
  assert.equal(rights.requires_human_legal_review_before_publish, true);
  assert.ok(rights.publish_blockers.includes("rights:direct_motion_live_publish_hold"));
  assert.ok(
    rights.publish_blockers.includes("rights:human_legal_review_required_before_publish"),
  );
});

test("owned motion rights identity collapses Steam transport mirrors without collapsing trailer masters", () => {
  const fastlyHls = "https://video.fastly.steamstatic.com/store_trailers/2806050/1673450740/ed598dc7526249e6bd74f53732f9a6ecf71f8063/1780963408/hls_264_master.m3u8?t=1781050956";
  const akamaiDash = "https://video.akamai.steamstatic.com/store_trailers/2806050/1673450740/ed598dc7526249e6bd74f53732f9a6ecf71f8063/1780963408/dash_h264.mpd?t=1781050956";
  const differentTrailer = "https://video.akamai.steamstatic.com/store_trailers/2806050/1326798026/6b3d92049c61a2ddc074d5d0f9b8b796d0fbdc03/1781131704/dash_h264.mpd?t=1781134450";

  assert.equal(canonicalRightsSource(fastlyHls), canonicalRightsSource(akamaiDash));
  assert.notEqual(canonicalRightsSource(fastlyHls), canonicalRightsSource(differentTrailer));
});

test("owned motion materializer does not override unrelated blocked rights failures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-motion-monotonic-rights-"));
  const artifactDir = path.join(root, "monotonic-rights");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "monotonic-rights",
    canonical_subject: "Clockwork Revolution",
    selected_title: "Clockwork Revolution Has A New Combat Signal",
    thumbnail_headline: "COMBAT SIGNAL",
    first_spoken_line: "Clockwork Revolution just sharpened its combat pitch.",
    confirmed_claims: ["Xbox Wire published an official combat update."],
    primary_source: "Xbox Wire",
    source_card_label: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/en-us/games/clockwork-revolution/",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "monotonic-rights",
    motion_inventory: {},
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "blocked",
    failures: ["rights:narration_commercial_evidence_missing"],
    records: [],
  });

  await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [{
        story_id: "monotonic-rights",
        title: "Clockwork Revolution Has A New Combat Signal",
        artifact_dir: artifactDir,
        actions: [{
          action_id: "materialise_owned_generated_motion_clips",
          repair_lane: "owned_generated_explainer_motion_materialisation",
        }],
      }],
    },
    execFileSync: (bin, args) => fs.outputFileSync(args[args.length - 1], Buffer.alloc(4096, 11)),
    ffprobeDuration: () => 5,
  });

  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.verdict, "blocked");
  assert.deepEqual(rights.failures, ["rights:narration_commercial_evidence_missing"]);
});

test("owned motion materializer quarantines validated direct clips without exact commercial rights evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-explainer-stale-direct-video-"));
  const artifactDir = path.join(root, "gta-package");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "gta-package",
    canonical_subject: "Grand Theft Auto VI",
    selected_title: "GTA VI Just Made PS5 The Version To Watch",
    thumbnail_headline: "GTA VI PS5 TEST",
    first_spoken_line: "PlayStation just made the GTA VI argument simple.",
    confirmed_claims: ["Grand Theft Auto VI plays best on PS5."],
    primary_source: "PlayStation Blog",
    source_card_label: "PlayStation Blog",
    primary_source_url: "https://blog.playstation.com/2026/06/24/grand-theft-auto-vi-plays-best-on-ps5-november-19/",
  });

  const directClips = Array.from({ length: 4 }, (_, index) => {
    const clipPath = path.join(root, "video-cache", `gta-official-${index + 1}.mp4`);
    return {
      id: `gta-direct-${index + 1}`,
      source_family: `rockstar_gta_vi_official_window_${index + 1}`,
      motion_family: `rockstar_gta_vi_official_window_${index + 1}`,
      visual_family: `rockstar_gta_vi_official_window_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_${index + 1}/GTAVI_Trailer_${index + 1}.mp4`,
      source_type: "official_game_website_media_page",
      media_kind: "direct_video",
      rights_basis: "official_direct_media",
      counts_towards_motion_readiness: false,
      durationS: 5,
      materialized: true,
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "official_storefront_cinematic_motion_samples_passed",
        segment_validated: true,
      },
    };
  });
  await Promise.all(directClips.map((clip, index) =>
    fs.outputFile(clip.path, Buffer.alloc(4096, index + 1)),
  ));
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "gta-package",
    motion_inventory: {
      accepted_local_clips: directClips,
      production_motion_clips: directClips,
      direct_video_motion_asset_count: 0,
      direct_video_motion_family_count: 0,
    },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    story_id: "gta-package",
    status: "ready",
    clips: directClips,
    materialised_clips: directClips,
    clip_count: directClips.length,
    distinct_motion_family_count: directClips.length,
    direct_video_motion_asset_count: 0,
    direct_video_motion_family_count: 0,
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { records: [] });

  const calls = [];
  const report = await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [
        {
          story_id: "gta-package",
          title: "GTA VI Just Made PS5 The Version To Watch",
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
    generatedAt: "2026-06-29T10:00:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.outputFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: () => 2.8,
  });

  assert.equal(report.summary.materialized_clip_count, 21);
  assert.equal(calls.length, 21);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.direct_video_motion_asset_count, 0);
  assert.equal(materialised.direct_video_motion_family_count, 0);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "direct_video").length, 0);
  assert.equal(
    materialised.clips.filter((clip) => clip.source_type === "internally_generated_motion_graphic").length,
    21,
  );
  assert.equal(materialised.clips.some((clip) => clip.id === "gta-direct-1"), false);
  assert.ok(materialised.clips.some((clip) => clip.asset_class === "kinetic_aperture_surface"));
  assert.equal(materialised.quarantined_direct_video_clip_count, 4);
  assert.equal(materialised.quarantined_direct_video_clips.length, 4);
  assert.ok(materialised.quarantined_direct_video_clips.every(
    (clip) => clip.reason === "non_owned_direct_video_rights_unverified",
  ));
  assert.ok(materialised.quarantined_direct_video_clips.every(
    (clip) => clip.blockers.includes("matching_rights_record_missing"),
  ));

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_inventory.accepted_local_clips.length, 21);
  assert.equal(footage.motion_inventory.production_motion_clips.length, 21);
  assert.equal(footage.motion_inventory.quarantined_direct_video_clip_count, 4);
  assert.equal(report.summary.skipped_non_owned_clip_count, 4);

  footage.motion_inventory.accepted_local_clips = [
    ...footage.motion_inventory.accepted_local_clips,
    ...directClips,
  ];
  footage.motion_inventory.production_motion_clips = [
    ...footage.motion_inventory.production_motion_clips,
    ...directClips,
  ];
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), footage);
  materialised.clips = [...materialised.clips, ...directClips];
  materialised.materialised_clips = [...materialised.materialised_clips, ...directClips];
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), materialised);

  const rerun = await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [{
        story_id: "gta-package",
        title: "GTA VI Just Made PS5 The Version To Watch",
        artifact_dir: artifactDir,
        actions: [{
          action_id: "materialise_owned_generated_motion_clips",
          repair_lane: "owned_generated_explainer_motion_materialisation",
        }],
      }],
    },
    execFileSync: () => {
      throw new Error("existing owned clips should not be rematerialized");
    },
    ffprobeDuration: () => 2.8,
  });
  assert.equal(rerun.summary.skipped_non_owned_clip_count, 4);
  assert.equal(rerun.summary.quarantined_direct_video_clip_count, 4);
  assert.equal(new Set(rerun.stories[0].skipped.map((clip) => clip.clip_id)).size, 4);
  const rerunMaterialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  const rerunFootage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  const rerunRights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rerunMaterialised.quarantined_direct_video_clip_count, 4);
  assert.equal(rerunMaterialised.quarantined_direct_video_clips.length, 4);
  assert.equal(rerunFootage.motion_inventory.quarantined_direct_video_clip_count, 4);
  assert.equal(rerunRights.quarantined_non_owned_direct_video_count, 4);

  const auditRerun = await materializeGoalOwnedMotionClips({
    root,
    workOrder: {
      jobs: [{
        story_id: "gta-package",
        title: "GTA VI Just Made PS5 The Version To Watch",
        artifact_dir: artifactDir,
        actions: [{
          action_id: "materialise_owned_generated_motion_clips",
          repair_lane: "owned_generated_explainer_motion_materialisation",
        }],
      }],
    },
    execFileSync: () => {
      throw new Error("existing owned clips should not be rematerialized");
    },
    ffprobeDuration: () => 2.8,
  });
  assert.equal(auditRerun.summary.quarantined_direct_video_clip_count, 0);
  const auditMaterialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  const auditFootage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  const auditRights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(auditMaterialised.quarantined_direct_video_clip_count, 4);
  assert.equal(auditMaterialised.quarantined_direct_video_clips.length, 4);
  assert.equal(auditFootage.motion_inventory.quarantined_direct_video_clip_count, 4);
  assert.equal(auditRights.quarantined_non_owned_direct_video_count, 4);
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

  assert.equal(report.summary.materialized_clip_count, 21);
  assert.equal(calls.length, 21);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 21);
  assert.equal(materialised.distinct_motion_family_count, 5);
  assert.equal(materialised.materially_distinct_generator_project_count, 4);
  assert.equal(materialised.clips.every((clip) => clip.durationS >= 4), true);
  assert.ok(materialised.clips.some((clip) => clip.asset_class === "branded_wipe"));
  assert.ok(materialised.clips.some((clip) => clip.asset_class === "platform_proof_card"));

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_budget.required_motion_scenes, 21);
  assert.equal(footage.motion_inventory.accepted_local_clips.length, 21);
});
