"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  materializeFlagshipMotionPlan,
} = require("../../lib/flagship-motion-plan-materializer");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function makeFixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-motion-plan-"));
  t.after(() => fs.remove(root));
  const storyId = "flagship-story";
  const sourceStoryPath = path.join(root, "source-story.json");
  const selectionPath = path.join(root, "selection.json");
  const outputStoryPath = path.join(root, "proof", "visual-v4-story.json");
  const reportPath = path.join(root, "proof", "flagship-motion-plan.json");
  const motionManifestPath = path.join(root, "proof", "materialised_motion_clips.json");
  const qaDir = path.join(root, "proof", "visual-qa");
  const audioPath = path.join(root, "narration.mp3");
  await fs.writeFile(audioPath, Buffer.alloc(4096, 0x31));
  await fs.writeJson(sourceStoryPath, {
    story_id: storyId,
    id: storyId,
    title: "Current flagship",
    narration_script: "Current narration.",
    audio_path: audioPath,
    video_clips: ["C:/stale/clip.mp4"],
    visual_v4_bridge_video_clips: [{ id: "stale" }],
    visual_v4_director_plan: { stale: true },
    sound_transition_plan: { stale: true },
    sfx_asset_inventory: [{ asset_id: "retained-sfx" }],
  });

  const scenes = [];
  const durations = new Map([[path.resolve(audioPath), options.audioDurationS ?? 34.5]]);
  for (let sourceIndex = 1; sourceIndex <= 4; sourceIndex += 1) {
    const masterPath = path.join(root, `master-${sourceIndex}.mp4`);
    const infoPath = path.join(root, `master-${sourceIndex}.info.json`);
    const videoId = `sourceId00${sourceIndex}`;
    await fs.writeFile(masterPath, Buffer.from(`master-${sourceIndex}-bytes`));
    await fs.writeJson(infoPath, {
      id: videoId,
      title: `Official source ${sourceIndex}`,
      channel: "Official Publisher",
      channel_url: "https://www.youtube.com/@officialpublisher",
      webpage_url: `https://www.youtube.com/watch?v=${videoId}`,
    });
    for (let clipIndex = 1; clipIndex <= 2; clipIndex += 1) {
      const startS = clipIndex === 1 ? 10 : 20;
      const clipPath = path.join(root, `source-${sourceIndex}-clip-${clipIndex}.mp4`);
      await fs.writeFile(clipPath, Buffer.from(`source-${sourceIndex}-clip-${clipIndex}`));
      durations.set(path.resolve(clipPath), 4);
      scenes.push({
        id: `source-${sourceIndex}-clip-${clipIndex}`,
        kind: "direct_motion",
        path: clipPath,
        master_path: masterPath,
        info_json_path: infoPath,
        youtube_video_id: videoId,
        source_url: `https://www.youtube.com/watch?v=${videoId}`,
        source_type: "official_publisher_trailer_segment",
        rights_basis: "official_source_transformative_editorial_local_proof_only",
        rights_grant: false,
        start_s: startS,
        duration_s: 4,
      });
    }
  }

  const cardPath = path.join(root, "source-card.mp4");
  await fs.writeFile(cardPath, Buffer.from("source-card"));
  durations.set(path.resolve(cardPath), options.cardDurationS ?? 3);
  scenes.splice(4, 0, {
    id: "source-card",
    kind: "generated_card",
    card_type: "source",
    path: cardPath,
    source_url: "local://hyperframes/flagship-story/source",
    rights_basis: "owned_generated_editorial_motion_graphic",
    rights_grant: true,
    duration_s: options.declaredCardDurationS ?? 3,
    minimum_readable_duration_s: 2,
    maximum_visible_duration_s: 3.2,
  });

  for (const [index, cardType] of (options.extraGeneratedCards || []).entries()) {
    const extraCardPath = path.join(root, `${cardType}-card-${index + 1}.mp4`);
    await fs.writeFile(extraCardPath, Buffer.from(`${cardType}-card-${index + 1}`));
    durations.set(path.resolve(extraCardPath), 3);
    scenes.splice(5 + index, 0, {
      id: `${cardType}-card-${index + 1}`,
      kind: "generated_card",
      card_type: cardType,
      path: extraCardPath,
      source_url: `local://hyperframes/flagship-story/${cardType}/${index + 1}`,
      rights_basis: "owned_generated_editorial_motion_graphic",
      rights_grant: true,
      duration_s: 3,
      minimum_readable_duration_s: 2,
      maximum_visible_duration_s: 3.2,
    });
  }

  if (typeof options.mutateScenes === "function") options.mutateScenes(scenes);
  await fs.writeJson(selectionPath, {
    schema_version: 1,
    story_id: storyId,
    policy_tier: "ultimate_professional",
    scenes,
  });

  const probeDuration = async (filePath) => durations.get(path.resolve(filePath)) || 0;
  const inspectClip = async (scene) => ({
    path: scene.path,
    eligible: scene.id !== options.rejectedClipId,
    reasons: scene.id === options.rejectedClipId ? ["direct_motion_frame_taste_failed"] : [],
    metrics: { decoded_sample_count: 8 },
  });
  const fingerprintClip = (scene) => `unique-${scene.id}`;

  return {
    sourceStoryPath,
    selectionPath,
    outputStoryPath,
    reportPath,
    motionManifestPath,
    qaDir,
    cardPath,
    probeDuration,
    inspectClip,
    fingerprintClip,
  };
}

test("materialises a decoded, motion-led flagship plan with current source lineage", async (t) => {
  const fixture = await makeFixture(t);
  const result = await materializeFlagshipMotionPlan({
    ...fixture,
    generatedAt: "2026-07-15T18:00:00.000Z",
  });

  assert.equal(result.report.status, "READY_FOR_LOCAL_FLAGSHIP_RENDER");
  assert.equal(result.report.publish_authorised, false);
  assert.equal(result.report.summary.direct_motion_scene_count, 8);
  assert.equal(result.report.summary.generated_card_scene_count, 1);
  assert.equal(result.report.summary.genuine_base_source_count, 4);
  assert.equal(result.report.summary.max_scenes_per_source, 2);
  assert.equal(result.report.summary.card_duration_ratio < 0.2, true);
  assert.equal(result.report.safety.production_db_mutated, false);
  assert.equal(result.report.safety.external_posting_triggered, false);

  const story = await fs.readJson(fixture.outputStoryPath);
  assert.equal(story.publish_authorised, false);
  assert.equal(story.visual_v4_bridge_video_clips.length, 9);
  assert.equal(story.video_clips.length, 9);
  assert.equal(story.visual_v4_director_plan.stale, undefined);
  assert.equal(story.visual_v4_director_plan.shot_plan.length, 9);
  assert.equal(story.sound_transition_plan.sfx.cues.length, 9);
  assert.deepEqual(story.sfx_asset_inventory, [{ asset_id: "retained-sfx" }]);

  for (const scene of story.visual_v4_bridge_video_clips) {
    assert.match(scene.sha256, /^[a-f0-9]{64}$/);
    assert.equal(scene.size_bytes > 0, true);
    if (scene.media_kind === "direct_video") {
      assert.match(scene.source_master_sha256, /^[a-f0-9]{64}$/);
      assert.equal(scene.rights_grant, false);
      assert.equal(scene.materialized, true);
      assert.equal(scene.validated, true);
      assert.equal(scene.segmentValidationPassed, true);
      assert.equal(scene.provenance.segment_validated, true);
      assert.equal(scene.motion_source_identity.status, "resolved");
      assert.equal(scene.motion_source_identity.strict_pass, true);
      assert.equal(
        scene.motion_source_identity.source_master_sha256,
        scene.source_master_sha256,
      );
      assert.equal(
        scene.motion_source_identity.canonical_source_url,
        scene.source_url,
      );
    }
  }
  assert.equal(await fs.pathExists(fixture.reportPath), true);
  assert.equal(result.report.output_story.sha256, sha256(await fs.readFile(fixture.outputStoryPath)));

  const motionManifest = await fs.readJson(fixture.motionManifestPath);
  const sourceCard = motionManifest.materialised_clips.find((scene) => scene.id === "source-card");
  assert.equal(motionManifest.status, "ready");
  assert.equal(motionManifest.clip_count, 9);
  assert.equal(motionManifest.selected_materialised_motion_clip_ids.length, 9);
  assert.equal(sourceCard.sha256, sha256(await fs.readFile(fixture.cardPath)));
  assert.equal(sourceCard.size_bytes, (await fs.stat(fixture.cardPath)).size);
  assert.equal(motionManifest.motion_plan_report_path, path.resolve(fixture.reportPath));
});

test("removes narrative cards so a flagship stays direct-motion-led", async (t) => {
  const fixture = await makeFixture(t, {
    extraGeneratedCards: ["takeaway", "quote"],
  });

  const result = await materializeFlagshipMotionPlan({
    ...fixture,
    generatedAt: "2026-07-15T18:00:00.000Z",
  });

  assert.deepEqual(
    result.story.visual_v4_bridge_video_clips
      .filter((scene) => scene.media_kind === "generated_card")
      .map((scene) => scene.card_type),
    ["source"],
  );
  assert.equal(result.report.summary.generated_card_scene_count, 1);
  assert.equal(result.report.summary.excluded_generated_card_scene_count, 2);
  assert.deepEqual(result.report.excluded_generated_cards, [
    {
      id: "takeaway-card-1",
      card_type: "takeaway",
      reason: "flagship_narrative_card_disallowed",
    },
    {
      id: "quote-card-2",
      card_type: "quote",
      reason: "flagship_narrative_card_disallowed",
    },
  ]);
  assert.equal(result.story.hyperframes_available_card_count, 1);
  assert.equal(result.story.hyperframes_premium_shell_selected_card_count, 1);
});

test("adapts a blocker-free v5 decoded selector and imports only the current source card", async (t) => {
  const fixture = await makeFixture(t);
  const sourceStory = await fs.readJson(fixture.sourceStoryPath);
  const selection = await fs.readJson(fixture.selectionPath);
  const sourceCard = selection.scenes.find((scene) => scene.card_type === "source");
  sourceStory.visual_v4_bridge_video_clips = [
    sourceCard,
    { ...sourceCard, id: "stale-takeaway", card_type: "takeaway" },
  ];
  await fs.writeJson(fixture.sourceStoryPath, sourceStory);

  const selectorClips = selection.scenes
    .filter((scene) => scene.kind === "direct_motion")
    .map((scene) => ({
      ...scene,
      media_kind: "direct_video",
      canonical_source_url: scene.source_url,
      source_url: scene.master_path,
      durationS: scene.duration_s,
      mediaStartS: scene.start_s,
      materialized_duration_s: scene.duration_s,
      source_identity_provenance: {
        kind: "yt_dlp_info_sidecar",
        status: "resolved",
        sidecar_path: scene.info_json_path,
      },
    }));
  await fs.writeJson(fixture.selectionPath, {
    version: "pulse_direct_motion_visual_selector_v5",
    policy_tier: "ultimate_professional",
    clips: selectorClips,
    blockers: [],
  });

  const result = await materializeFlagshipMotionPlan({ ...fixture });

  assert.equal(result.report.selection_adapter, "pulse_direct_motion_visual_selector_v5");
  assert.equal(result.report.summary.direct_motion_scene_count, 8);
  assert.equal(result.report.summary.generated_card_scene_count, 1);
  assert.deepEqual(
    result.story.visual_v4_bridge_video_clips
      .filter((scene) => scene.media_kind === "generated_card")
      .map((scene) => scene.card_type),
    ["source"],
  );
});

test("keeps a five-second editorial cut when decoded media has frame quantisation", async (t) => {
  const fixture = await makeFixture(t);
  const sourceStory = await fs.readJson(fixture.sourceStoryPath);
  const selection = await fs.readJson(fixture.selectionPath);
  const sourceCard = selection.scenes.find((scene) => scene.card_type === "source");
  sourceStory.visual_v4_bridge_video_clips = [sourceCard];
  await fs.writeJson(fixture.sourceStoryPath, sourceStory);

  const selectorClips = selection.scenes
    .filter((scene) => scene.kind === "direct_motion")
    .map((scene, index) => ({
      ...scene,
      media_kind: "direct_video",
      canonical_source_url: scene.source_url,
      source_url: scene.master_path,
      duration_s: index === 0 ? 5 : scene.duration_s,
      durationS: index === 0 ? 5 : scene.duration_s,
      mediaStartS: scene.start_s,
      materialized_duration_s: index === 0 ? 5.005 : scene.duration_s,
      source_identity_provenance: {
        kind: "yt_dlp_info_sidecar",
        status: "resolved",
        sidecar_path: scene.info_json_path,
      },
    }));
  const quantisedClipPath = path.resolve(selectorClips[0].path);
  await fs.writeJson(fixture.selectionPath, {
    version: "pulse_direct_motion_visual_selector_v5",
    policy_tier: "ultimate_professional",
    clips: selectorClips,
    blockers: [],
  });

  const result = await materializeFlagshipMotionPlan({
    ...fixture,
    probeDuration(filePath) {
      if (path.resolve(filePath) === quantisedClipPath) return 5.005;
      return fixture.probeDuration(filePath);
    },
  });
  const resolved = result.story.visual_v4_bridge_video_clips.find(
    (scene) => scene.id === selectorClips[0].id,
  );

  assert.equal(resolved.duration_s, 5);
  assert.equal(resolved.decoded_duration_s, 5.005);
  assert.equal(result.report.summary.max_direct_motion_scene_duration_s, 5);
});

test("recovers only the verified HyperFrames source lock when selector cards are absent", async (t) => {
  const fixture = await makeFixture(t);
  const sourceStory = await fs.readJson(fixture.sourceStoryPath);
  const selection = await fs.readJson(fixture.selectionPath);
  sourceStory.visual_v4_bridge_video_clips = [];
  sourceStory.video_clips = [];
  sourceStory.hyperframes_premium_shell_gate = {
    checks: {
      source: {
        verdict: "pass",
        blockers: [],
        evidence: {
          cardPath: fixture.cardPath,
          readabilityContract: {
            status: "pass",
            blockers: [],
            evidence: {
              readable_text: "OFFICIAL PUBLISHER SOURCE",
              planned_visible_duration_s: 2.6,
              minimum_visible_duration_s: 1.9,
              maximum_visible_duration_s: 3.1,
            },
          },
        },
      },
      context: {
        verdict: "pass",
        blockers: [],
        evidence: {
          cardPath: path.join(path.dirname(fixture.cardPath), "context-card.mp4"),
        },
      },
    },
  };
  await fs.writeJson(fixture.sourceStoryPath, sourceStory);

  const selectorClips = selection.scenes
    .filter((scene) => scene.kind === "direct_motion")
    .map((scene) => ({
      ...scene,
      media_kind: "direct_video",
      canonical_source_url: scene.source_url,
      source_url: scene.master_path,
      durationS: scene.duration_s,
      mediaStartS: scene.start_s,
      materialized_duration_s: scene.duration_s,
      source_identity_provenance: {
        kind: "yt_dlp_info_sidecar",
        status: "resolved",
        sidecar_path: scene.info_json_path,
      },
    }));
  await fs.writeJson(fixture.selectionPath, {
    version: "pulse_direct_motion_visual_selector_v5",
    policy_tier: "ultimate_professional",
    clips: selectorClips,
    blockers: [],
  });

  const result = await materializeFlagshipMotionPlan({ ...fixture });
  const cards = result.story.visual_v4_bridge_video_clips.filter(
    (scene) => scene.media_kind === "generated_card",
  );

  assert.equal(cards.length, 1);
  assert.equal(cards[0].card_type, "source");
  assert.equal(cards[0].path, path.resolve(fixture.cardPath));
  assert.equal(cards[0].duration_s, 3);
  assert.equal(
    result.story.visual_v4_bridge_video_clips.findIndex(
      (scene) => scene.media_kind === "generated_card",
    ),
    1,
  );
  assert.equal(result.report.summary.generated_card_scene_count, 1);
});

test("uses the governed resolved narration path when the legacy audio_path field is absent", async (t) => {
  const fixture = await makeFixture(t);
  const story = await fs.readJson(fixture.sourceStoryPath);
  story.resolved_narration_audio_path = story.audio_path;
  delete story.audio_path;
  await fs.writeJson(fixture.sourceStoryPath, story);

  const result = await materializeFlagshipMotionPlan({ ...fixture });

  assert.equal(result.report.status, "READY_FOR_LOCAL_FLAGSHIP_RENDER");
  assert.equal(
    result.report.narration_audio.path,
    path.resolve(story.resolved_narration_audio_path),
  );
});

test("accepts official Steam storefront motion only with a current hash-bound identity sidecar", async (t) => {
  const fixture = await makeFixture(t);
  const selection = await fs.readJson(fixture.selectionPath);
  const steamScenes = selection.scenes.filter((scene) => scene.id.startsWith("source-4-"));
  const masterPath = steamScenes[0].master_path;
  const sourceUrl =
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2697940/extras/official-gameplay.mp4?t=1784002409";
  const sidecarPath = path.join(path.dirname(masterPath), "steam-source-identity.json");
  await fs.writeJson(sidecarPath, {
    schema: "pulse_motion_source_identity_sidecar_v1",
    schema_version: 1,
    producer: "pulse_official_platform_source_verifier_v1",
    platform: "steam",
    canonical_source_url: sourceUrl,
    source_master_sha256: sha256(await fs.readFile(masterPath)),
    source_owner: "Official Publisher",
    source_type: "official_platform_product_page",
    identity_scope: "source_identity_only",
    rights_grant: false,
    evidence: {
      steam_app_id: "2697940",
      reference_url: "https://store.steampowered.com/app/2697940/Current_Flagship/",
      verified_at: "2026-07-16T21:30:00.000Z",
    },
  });
  for (const scene of steamScenes) {
    scene.youtube_video_id = "";
    scene.info_json_path = "";
    scene.source_identity_path = sidecarPath;
    scene.source_url = sourceUrl;
    scene.source_type = "official_platform_product_page";
    scene.source_owner = "Official Publisher";
    scene.rights_basis = "official_storefront_promotional_editorial";
  }
  await fs.writeJson(fixture.selectionPath, selection);

  const result = await materializeFlagshipMotionPlan({ ...fixture });
  const resolvedSteamScenes = result.report.scenes.filter((scene) =>
    scene.source_url.includes("steamstatic.com"),
  );

  assert.equal(result.report.summary.genuine_base_source_count, 4);
  assert.equal(resolvedSteamScenes.length, 2);
  assert.equal(resolvedSteamScenes.every((scene) => scene.source_platform === "steam"), true);
  assert.equal(
    resolvedSteamScenes.every((scene) => scene.source_identity_sha256 === sha256(
      fs.readFileSync(sidecarPath),
    )),
    true,
  );
  assert.equal(
    resolvedSteamScenes.every((scene) => scene.rights_status === "operator_legal_review_required"),
    true,
  );
});

test("accepts official YouTube motion through its current hash-bound identity sidecar", async (t) => {
  const fixture = await makeFixture(t);
  const selection = await fs.readJson(fixture.selectionPath);
  const youtubeScenes = selection.scenes.filter((scene) => scene.id.startsWith("source-3-"));
  const masterPath = youtubeScenes[0].master_path;
  const videoId = youtubeScenes[0].youtube_video_id;
  const sidecarPath = path.join(path.dirname(masterPath), "youtube-source-identity.json");
  await fs.writeJson(sidecarPath, {
    schema: "pulse_motion_source_identity_sidecar_v1",
    schema_version: 1,
    producer: "pulse_source_identity_oembed_verifier_v1",
    canonical_source_url: `https://www.youtube.com/watch?v=${videoId}`,
    youtube_video_id: videoId,
    channel_identity: {
      author_name: "Official Publisher",
      author_url: "https://www.youtube.com/@officialpublisher",
    },
    source_master_sha256: sha256(await fs.readFile(masterPath)),
    identity_scope: "source_identity_only",
    rights_grant: false,
    evidence: {
      provider: "youtube_oembed",
      verified_at: "2026-07-16T21:35:00.000Z",
      title: "Official source",
    },
  });
  for (const scene of youtubeScenes) {
    scene.info_json_path = "";
    scene.source_identity_path = sidecarPath;
  }
  await fs.writeJson(fixture.selectionPath, selection);

  const result = await materializeFlagshipMotionPlan({ ...fixture });
  const resolved = result.report.scenes.filter((scene) => scene.youtube_video_id === videoId);

  assert.equal(resolved.length, 2);
  assert.equal(resolved.every((scene) => scene.source_platform === "youtube"), true);
  assert.equal(resolved.every((scene) => scene.source_info_path === ""), true);
  assert.equal(
    resolved.every((scene) => scene.source_identity_sha256 === sha256(
      fs.readFileSync(sidecarPath),
    )),
    true,
  );
});

test("rejects official Steam storefront motion without immutable identity evidence", async (t) => {
  const fixture = await makeFixture(t);
  const selection = await fs.readJson(fixture.selectionPath);
  for (const scene of selection.scenes.filter((row) => row.id.startsWith("source-4-"))) {
    scene.youtube_video_id = "";
    scene.info_json_path = "";
    scene.source_url =
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2697940/extras/official-gameplay.mp4";
    scene.source_type = "official_platform_product_page";
    scene.source_owner = "Official Publisher";
    scene.rights_basis = "official_storefront_promotional_editorial";
  }
  await fs.writeJson(fixture.selectionPath, selection);

  await assert.rejects(
    materializeFlagshipMotionPlan({ ...fixture }),
    /direct_motion_source_identity_missing|official_platform_source_identity_missing/,
  );
  assert.equal(await fs.pathExists(fixture.outputStoryPath), false);
});

test("fails closed when decoded visual QA rejects a direct-motion scene", async (t) => {
  const fixture = await makeFixture(t, { rejectedClipId: "source-2-clip-1" });
  await assert.rejects(
    materializeFlagshipMotionPlan({ ...fixture }),
    /direct_motion_visual_qa_failed:source-2-clip-1/,
  );
  assert.equal(await fs.pathExists(fixture.outputStoryPath), false);
});

test("refreshes a regenerated owned card to its decoded duration inside the readability envelope", async (t) => {
  const fixture = await makeFixture(t, {
    cardDurationS: 2.6,
    declaredCardDurationS: 2.8,
    audioDurationS: 34.2,
  });
  const result = await materializeFlagshipMotionPlan({ ...fixture });

  const sourceCard = result.story.visual_v4_bridge_video_clips.find(
    (scene) => scene.id === "source-card",
  );
  assert.equal(sourceCard.duration_s, 2.6);
  assert.equal(sourceCard.durationS, 2.6);
});

test("fails closed on source overuse or insufficient runtime", async (t) => {
  const overused = await makeFixture(t, {
    mutateScenes(scenes) {
      const first = scenes.find((scene) => scene.kind === "direct_motion");
      const third = { ...first, id: "source-1-clip-3", start_s: 30 };
      scenes.push(third);
    },
  });
  await assert.rejects(
    materializeFlagshipMotionPlan({ ...overused }),
    /professional_source_scene_limit_exceeded/,
  );

  const short = await makeFixture(t, {
    mutateScenes(scenes) {
      scenes.splice(3);
    },
  });
  await assert.rejects(
    materializeFlagshipMotionPlan({ ...short }),
    /flagship_scene_duration_below_narration_duration/,
  );
});

test("fails closed when raw scene duration only matches narration before render transitions", async (t) => {
  const fixture = await makeFixture(t, { audioDurationS: 35 });
  await assert.rejects(
    materializeFlagshipMotionPlan({ ...fixture }),
    /flagship_effective_render_duration_below_narration_duration/,
  );
  assert.equal(await fs.pathExists(fixture.outputStoryPath), false);
});

test("fails closed when different official sources contain perceptually repeated footage", async (t) => {
  const fixture = await makeFixture(t);
  await assert.rejects(
    materializeFlagshipMotionPlan({
      ...fixture,
      fingerprintClip(scene) {
        const repeated = ["source-1-clip-1", "source-2-clip-1"].includes(scene.id);
        return repeated ? "same-visual-beat" : `unique-${scene.id}`;
      },
    }),
    /flagship_visual_near_duplicate:source-1-clip-1:source-2-clip-1/,
  );
  assert.equal(await fs.pathExists(fixture.outputStoryPath), false);
});
