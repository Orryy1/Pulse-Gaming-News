"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  materialiseGovernedOwnedProgrammePack,
} = require("../../lib/services/governed-owned-programme-pack");
const {
  validateCombinedOwnedMotionManifest,
} = require("../../lib/services/governed-final-composite");

const GENERATED_AT = "2026-07-29T08:00:00.000Z";
const TARGET_DURATION_SECONDS = 28;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildIntake() {
  const fullScript = [
    "Delta Force just widened cheater compensation.",
    "Victims now qualify after a thirty-day ban, not only a ten-year ban.",
    "Confirmed compensation arrives by in-game mail within three business days.",
    "That makes recovery faster for players whose gear was lost to a cheater.",
  ].join(" ");
  return {
    schema_version: "pulse-governed-story-intake-v1",
    source_url:
      "https://steamcommunity.com/games/2507950/announcements/detail/711155982681508947",
    source_type: "official",
    source_evidence_path: "delta-force-official.html",
    source_evidence_sha256: sha256("official source evidence"),
    published_at: "2026-07-27T09:15:34.000Z",
    claims: [
      "Victims now qualify after a thirty-day ban, not only a ten-year ban.",
      "Compensation arrives within three business days.",
    ],
    story: {
      id: `official_${sha256("owned-programme-story").slice(0, 24)}`,
      channel_id: "pulse-gaming",
      title: "Delta Force expands cheater compensation",
      hook: "Delta Force just widened cheater compensation.",
      full_script: fullScript,
      script_sha256: sha256(fullScript),
    },
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: "what_changes_short_25_32",
      target_duration_seconds: TARGET_DURATION_SECONDS,
    },
  };
}

function ownedProvenance() {
  return {
    source: "repository_owned_authored_vector_scene",
    third_party_media_used: false,
    third_party_music: false,
  };
}

function scene({
  assetId,
  role,
  mediaType,
  start,
  duration,
  headline,
  layout,
}) {
  return {
    asset_id: assetId,
    role,
    media_type: mediaType,
    start_seconds: start,
    duration_seconds: duration,
    design: {
      schema_version: "pulse-owned-vector-scene-v1",
      headline,
      supporting_text: "Exact authored editorial graphic",
      accent_colour: "#FF6B1A",
      layout,
    },
    ownership: "owned",
    rights_basis: "OWNED",
    attribution_required: false,
    provenance: ownedProvenance(),
  };
}

function buildScenes(targetDurationSeconds = TARGET_DURATION_SECONDS) {
  return [
    scene({
      assetId: "owned-hook",
      role: "hook_slam",
      mediaType: "image",
      start: 0,
      duration: 3,
      headline: "COMPENSATION EXPANDED",
      layout: "TITLE",
    }),
    scene({
      assetId: "owned-motion-backbone",
      role: "owned_motion_backbone",
      mediaType: "video",
      start: 0,
      duration: targetDurationSeconds,
      headline: "DELTA FORCE",
      layout: "BACKBONE",
    }),
    scene({
      assetId: "owned-change",
      role: "before_after_change",
      mediaType: "image",
      start: 3,
      duration: targetDurationSeconds === 28 ? 5 : 7,
      headline: "10 YEARS → 30 DAYS",
      layout: "COMPARISON",
    }),
    scene({
      assetId: "owned-timeline",
      role: "verified_timeline",
      mediaType: "image",
      start: targetDurationSeconds === 28 ? 8 : 10,
      duration: targetDurationSeconds === 28 ? 5 : 7,
      headline: "WITHIN 3 BUSINESS DAYS",
      layout: "TIMELINE",
    }),
    scene({
      assetId: "owned-proof",
      role: "proof_grid",
      mediaType: "image",
      start: targetDurationSeconds === 28 ? 13 : 17,
      duration: targetDurationSeconds === 28 ? 5 : 7,
      headline: "OFFICIAL CHANGE",
      layout: "GRID",
    }),
    scene({
      assetId: "owned-impact",
      role: "player_impact",
      mediaType: "image",
      start: targetDurationSeconds === 28 ? 18 : 24,
      duration:
        targetDurationSeconds === 28
          ? 10
          : targetDurationSeconds - 24,
      headline: "FASTER RECOVERY",
      layout: "IMPACT",
    }),
  ];
}

function rendererReceipt(adapterId, extra = {}) {
  return {
    adapter_id: adapterId,
    deterministic: true,
    ownership: "owned",
    rights_basis: "OWNED",
    attribution_required: false,
    third_party_media_used: false,
    third_party_music: false,
    network_used: false,
    ...extra,
  };
}

function buildAdapters() {
  return {
    hyperframesGeneratorIdentity: "hyperframes@0.7.77",
    renderScene: async ({ outputPath, scene: input }) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(
        outputPath,
        Buffer.from(`owned-scene:${input.asset_id}`, "utf8"),
      );
      return rendererReceipt("test-owned-scene-renderer-v1");
    },
    renderProgramme: async ({
      outputPath,
      storyId,
      targetDurationSeconds,
    }) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(
        outputPath,
        Buffer.from(
          `owned-hyperframes-programme:${storyId}:${targetDurationSeconds}`,
          "utf8",
        ),
      );
      return rendererReceipt(
        "test-hyperframes-programme-renderer-v1",
        {
          generator_identity: "hyperframes@0.7.77",
        },
      );
    },
    probeMedia: async ({ filePath, mediaType, expectedDurationSeconds }) => ({
      streams: [
        {
          codec_type: "video",
          width: 1080,
          height: 1920,
          r_frame_rate: mediaType === "video" ? "30/1" : "0/0",
        },
      ],
      format: {
        duration:
          mediaType === "video"
            ? String(expectedDurationSeconds)
            : undefined,
      },
    }),
  };
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function createFixture(t, label = "case", intake = buildIntake()) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `pulse-owned-programme-${label}-`),
  );
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const intakePath = path.join(tempRoot, "story-intake.json");
  const intakeBytes = jsonBytes(intake);
  fs.writeFileSync(intakePath, intakeBytes);
  const storyRoot = path.join(tempRoot, "packs", intake.story.id);
  return {
    tempRoot,
    intake,
    intakePath,
    intakeBytes,
    storyRoot,
    options: {
      mode: "LOCAL_PROOF",
      storyId: intake.story.id,
      storyIntakeRef: {
        path: intakePath,
        sha256: sha256(intakeBytes),
      },
      storyRoot,
      generatedAt: GENERATED_AT,
      scenes: buildScenes(
        intake.contract.target_duration_seconds,
      ),
    },
  };
}

function buildHighCadenceIntake() {
  const fullScript =
    "Yet Another Zombie Defense HD is free to keep on Steam, but the offer ends on 30 July. Claim it before the deadline and the full game stays in your library, this is not a free weekend. It mixes top down shooting with tower defence: spend daylight building barricades, placing turrets and buying weapons, then protect your position when the horde arrives at night. You can play alone, share local co op or fight online with up to four players total. Open the Steam page, make sure the discount shows 100 per cent, and add it to your account. After 30 July, the price comes back.";
  const scriptHash = sha256(fullScript);
  const targetDurationSeconds = 36.48;
  return {
    schema_version: "pulse-governed-story-intake-v1",
    source_url: "https://store.steampowered.com/app/674750/",
    source_type: "official",
    source_evidence_path: "source-evidence.json",
    source_evidence_sha256: sha256("yazd source evidence"),
    published_at: "2026-07-27T03:32:08.000Z",
    claims: [
      "The official Steam listing marks Yet Another Zombie Defense HD as free to keep.",
      "The offer ends on 30 July 2026.",
    ],
    story: {
      id: "official_3b8d305c4e17",
      channel_id: "pulse-gaming",
      title:
        "Yet Another Zombie Defense HD Is Free To Keep Until 30 July",
      hook:
        "Yet Another Zombie Defense HD is free to keep on Steam, but the offer ends on 30 July.",
      full_script: fullScript,
      script_sha256: scriptHash,
    },
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id:
        "what_changes_breaking_high_cadence_35_42",
      target_duration_seconds: targetDurationSeconds,
      target_duration_review: {
        status: "APPROVED",
        target_duration_seconds: targetDurationSeconds,
        script_sha256: scriptHash,
        reviewed_by: "pulse-editorial-operator",
        reviewed_at: "2026-07-28T17:20:00.000Z",
      },
    },
  };
}

test("materialiser emits one deterministic owned-only programme pack that final composite can consume", async (t) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-owned-programme-pack-"),
  );
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const intake = buildIntake();
  const intakePath = path.join(tempRoot, "story-intake.json");
  const intakeBytes = jsonBytes(intake);
  fs.writeFileSync(intakePath, intakeBytes);
  const storyRoot = path.join(tempRoot, "packs", intake.story.id);

  const result = await materialiseGovernedOwnedProgrammePack(
    {
      mode: "LOCAL_PROOF",
      storyId: intake.story.id,
      storyIntakeRef: {
        path: intakePath,
        sha256: sha256(intakeBytes),
      },
      storyRoot,
      generatedAt: GENERATED_AT,
      scenes: buildScenes(),
    },
    buildAdapters(),
  );

  assert.equal(result.schema_version, "pulse-governed-owned-programme-pack-result-v1");
  assert.equal(result.mode, "LOCAL_PROOF");
  assert.equal(result.story_id, intake.story.id);
  assert.equal(result.story_root, path.resolve(storyRoot));
  assert.equal(result.publish_authorised, false);
  assert.equal(result.database_mutated, false);
  assert.equal(result.oauth_or_tokens_mutated, false);
  assert.equal(result.network_used, false);

  const sourceManifest = JSON.parse(
    fs.readFileSync(result.source_manifest_path, "utf8"),
  );
  assert.equal(sourceManifest.schema_version, "pulse-owned-motion-manifest-v1");
  assert.equal(sourceManifest.story_id, intake.story.id);
  assert.equal(sourceManifest.assets.length, 6);
  assert.deepEqual(
    sourceManifest.assets.map((asset) => asset.asset_id),
    buildScenes().map((item) => item.asset_id),
  );
  assert.ok(
    sourceManifest.assets.every(
      (asset) =>
        asset.ownership === "owned" &&
        asset.rights_basis === "OWNED" &&
        asset.attribution_required === false &&
        asset.provenance.third_party_media_used === false &&
        asset.provenance.third_party_music === false &&
        asset.provenance.source_programme_audio_streams === 0 &&
        asset.provenance.source_programme_sha256 === result.programme_sha256,
    ),
  );
  assert.equal(
    sourceManifest.combination.source_programme_sha256,
    result.programme_sha256,
  );
  assert.equal(sourceManifest.combination.source_programme_audio_streams, 0);
  assert.equal(sourceManifest.combination.third_party_media_used, false);
  assert.equal(sourceManifest.combination.third_party_music, false);

  const programmeProbe = JSON.parse(
    fs.readFileSync(result.programme_probe_path, "utf8"),
  );
  assert.equal(programmeProbe.verdict, "GREEN");
  assert.equal(programmeProbe.programme.sha256, result.programme_sha256);
  assert.equal(programmeProbe.observation.width, 1080);
  assert.equal(programmeProbe.observation.height, 1920);
  assert.equal(
    programmeProbe.observation.duration_seconds,
    TARGET_DURATION_SECONDS,
  );
  assert.equal(programmeProbe.observation.audio_stream_count, 0);
  assert.equal(programmeProbe.observation.video_stream_count, 1);

  assert.ok(
    sourceManifest.assets.every(
      (asset) => asset.sha256 !== result.programme_sha256,
    ),
  );
  const combined = validateCombinedOwnedMotionManifest({
    manifestPath: result.combined_manifest_path,
    storyId: intake.story.id,
    hyperframesVideoPath: result.programme_path,
    sourceMediaPolicy: "OWNED_ONLY",
    expectedDurationSeconds: TARGET_DURATION_SECONDS,
  });
  assert.equal(combined.thirdPartyMediaUsed, false);
  assert.equal(combined.hyperframesAsset.sha256, result.programme_sha256);
  assert.equal(
    combined.projectFiles.length,
    5 + buildScenes().length,
  );
  assert.deepEqual(
    new Set(
      combined.projectFiles.map((record) =>
        path.basename(record.path).toLowerCase(),
      ),
    ),
    new Set([
      "index.html",
      "hyperframes.json",
      "timeline.js",
      "package.json",
      "project-manifest.json",
      ...buildScenes().map(
        (item) =>
          `${item.asset_id}${item.media_type === "image" ? ".png" : ".mp4"}`,
      ),
    ]),
  );

  for (const candidate of [
    result.source_manifest_path,
    result.combined_manifest_path,
    result.programme_path,
    result.programme_probe_path,
    result.project_manifest_path,
    result.result_path,
    result.summary_path,
    ...result.owned_visual_assets.map((asset) => asset.path),
    ...result.hyperframes_project_files.map((record) => record.path),
  ]) {
    assert.equal(isWithin(storyRoot, candidate), true, candidate);
    assert.equal(fs.lstatSync(candidate).isSymbolicLink(), false, candidate);
  }
  assert.match(
    fs.readFileSync(result.summary_path, "utf8"),
    /No publication authority/i,
  );
});

test("materialiser gives strict HyperFrames a self-contained project with hash-bound local assets", async (t) => {
  const fixture = createFixture(t, "hyperframes-self-contained");
  const adapters = buildAdapters();
  const renderProgramme = adapters.renderProgramme;
  let inspections = 0;
  adapters.renderProgramme = async (input) => {
    const projectRoot = input.hyperframesProject.root;
    const config = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, "hyperframes.json"),
        "utf8",
      ),
    );
    assert.equal(config.paths.assets, "assets");

    const html = fs.readFileSync(
      path.join(projectRoot, "index.html"),
      "utf8",
    );
    const mediaSources = [
      ...html.matchAll(
        /<(?:img|video)\b[^>]*\bsrc="([^"]+)"/g,
      ),
    ].map((match) => match[1]);
    assert.equal(mediaSources.length, buildScenes().length);
    assert.ok(
      mediaSources.every(
        (source) =>
          source.startsWith("assets/") &&
          !source.split("/").includes(".."),
      ),
    );

    const projectManifest = JSON.parse(
      fs.readFileSync(
        input.hyperframesProject.manifest_path,
        "utf8",
      ),
    );
    assert.deepEqual(
      projectManifest.authored_scene_assets.map(
        (asset) => asset.path,
      ),
      mediaSources,
    );
    assert.ok(
      projectManifest.authored_scene_assets.every((asset) => {
        const candidate = path.resolve(
          projectRoot,
          ...asset.path.split("/"),
        );
        const source = input.sceneAssets.find(
          (item) => item.asset_id === asset.asset_id,
        );
        return (
          isWithin(projectRoot, candidate) &&
          fs.lstatSync(candidate).isFile() &&
          !fs.lstatSync(candidate).isSymbolicLink() &&
          sha256(fs.readFileSync(candidate)) === source.sha256 &&
          asset.sha256 === source.sha256
        );
      }),
    );
    assert.ok(
      projectManifest.project_files
        .map((file) => file.path)
        .filter((filePath) => filePath.startsWith("assets/"))
        .every(
          (filePath) =>
            !filePath.split("/").includes("..") &&
            fs.existsSync(
              path.resolve(
                projectRoot,
                ...filePath.split("/"),
              ),
            ),
        ),
    );
    inspections += 1;
    return renderProgramme(input);
  };

  const result = await materialiseGovernedOwnedProgrammePack(
    fixture.options,
    adapters,
  );

  assert.equal(inspections, 2);
  assert.equal(
    result.hyperframes_project_files.filter((record) =>
      record.path.includes(`${path.sep}hyperframes${path.sep}assets${path.sep}`),
    ).length,
    buildScenes().length,
  );
});

test("ephemeral staging stays inside the Sharp/VIPS path budget without changing the final story root", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
  t.after(() =>
    fs.rmSync(tempRoot, { recursive: true, force: true }),
  );
  const intake = buildIntake();
  intake.story.id = "official_763d6a7310b5";
  const intakePath = path.join(tempRoot, "story-intake.json");
  const intakeBytes = jsonBytes(intake);
  fs.writeFileSync(intakePath, intakeBytes);
  const storyRoot = path.join(
    tempRoot,
    "runtime-next-4fb26f9",
    "output",
    "canary",
    intake.story.id,
    "owned-programme",
    intake.story.id,
  );
  const adapters = buildAdapters();
  const renderScene = adapters.renderScene;
  const originalCopyFile = fsp.copyFile;
  const derivedFramePaths = [];
  const copiedProjectAssetPaths = [];
  const stageRoots = new Set();
  fsp.copyFile = async (sourcePath, destinationPath, mode) => {
    if (
      destinationPath.includes(
        `${path.sep}hyperframes${path.sep}assets${path.sep}`,
      )
    ) {
      copiedProjectAssetPaths.push(destinationPath);
      assert.equal(mode, fs.constants.COPYFILE_EXCL);
      assert.doesNotMatch(
        path.basename(destinationPath),
        /\.tmp$/i,
      );
    }
    return originalCopyFile(sourcePath, destinationPath, mode);
  };
  t.after(() => {
    fsp.copyFile = originalCopyFile;
  });
  adapters.renderScene = async (input) => {
    if (input.scene.media_type === "video") {
      const framePath = `${input.outputPath}.source.png`;
      derivedFramePaths.push(framePath);
      const determinismSegment =
        `${path.sep}.determinism${path.sep}`;
      const determinismIndex =
        input.outputPath.indexOf(determinismSegment);
      stageRoots.add(
        determinismIndex >= 0
          ? input.outputPath.slice(0, determinismIndex)
          : path.dirname(path.dirname(input.outputPath)),
      );
      if (framePath.length > 259) {
        throw new Error(
          `sharp_vips_legacy_path_budget_exceeded:${framePath.length}`,
        );
      }
    }
    return renderScene(input);
  };

  const result = await materialiseGovernedOwnedProgrammePack(
    {
      mode: "LOCAL_PROOF",
      storyId: intake.story.id,
      storyIntakeRef: {
        path: intakePath,
        sha256: sha256(intakeBytes),
      },
      storyRoot,
      generatedAt: GENERATED_AT,
      scenes: buildScenes(),
    },
    adapters,
  );

  assert.equal(result.story_root, path.resolve(storyRoot));
  assert.ok(
    derivedFramePaths.length >= 2,
    "both the primary and deterministic verification renders ran",
  );
  assert.ok(
    derivedFramePaths.every((candidate) => candidate.length <= 259),
    derivedFramePaths.join("\n"),
  );
  assert.equal(copiedProjectAssetPaths.length, buildScenes().length);
  assert.ok(
    copiedProjectAssetPaths.every(
      (candidate) => candidate.length <= 259,
    ),
    copiedProjectAssetPaths.join("\n"),
  );
  assert.ok(
    copiedProjectAssetPaths.some((candidate) =>
      candidate.endsWith(
        `${path.sep}owned-motion-backbone.mp4`,
      ),
    ),
  );
  assert.equal(stageRoots.size, 1);
  assert.match(
    path.basename([...stageRoots][0]),
    /^\.op-\d+-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  );
  assert.equal(fs.existsSync(storyRoot), true);
  assert.equal(isWithin(storyRoot, result.programme_path), true);
});

test("materialiser accepts the exact reviewed 36.48-second high-cadence lane and emits a final-composite-valid pack", async (t) => {
  const fixture = createFixture(
    t,
    "high-cadence",
    buildHighCadenceIntake(),
  );

  const result = await materialiseGovernedOwnedProgrammePack(
    fixture.options,
    buildAdapters(),
  );
  const probe = JSON.parse(
    fs.readFileSync(result.programme_probe_path, "utf8"),
  );
  assert.equal(probe.observation.duration_seconds, 36.48);
  assert.equal(probe.observation.audio_stream_count, 0);
  const combined = validateCombinedOwnedMotionManifest({
    manifestPath: result.combined_manifest_path,
    storyId: fixture.intake.story.id,
    hyperframesVideoPath: result.programme_path,
    sourceMediaPolicy: "OWNED_ONLY",
    expectedDurationSeconds: 36.48,
  });
  assert.equal(combined.hyperframesAsset.duration_seconds, 36.48);
  assert.equal(combined.thirdPartyMediaUsed, false);
});

test("materialiser fails closed when the rendered HyperFrames version differs from the bound project pin", async (t) => {
  const fixture = createFixture(t, "hyperframes-version");
  const adapters = buildAdapters();
  const renderProgramme = adapters.renderProgramme;
  adapters.renderProgramme = async (input) => ({
    ...(await renderProgramme(input)),
    generator_identity: "hyperframes@0.7.76",
  });

  await assert.rejects(
    materialiseGovernedOwnedProgrammePack(
      fixture.options,
      adapters,
    ),
    /owned_programme_pack_hyperframes_generator_identity_mismatch/,
  );
  assert.equal(fs.existsSync(fixture.storyRoot), false);
});

test("materialiser rejects an otherwise valid intake that selects an unapproved duration band", async (t) => {
  const intake = buildIntake();
  intake.contract.duration_band_id =
    "what_changes_standard_35_42";
  intake.contract.target_duration_seconds = 36;
  const fixture = createFixture(t, "unsupported-band", intake);

  await assert.rejects(
    materialiseGovernedOwnedProgrammePack(
      fixture.options,
      buildAdapters(),
    ),
    /owned_programme_pack_story_intake_editorial_contract_invalid/,
  );
  assert.equal(fs.existsSync(fixture.storyRoot), false);
});

test("materialiser rejects a governed intake reference whose story identity is wrong", async (t) => {
  const fixture = createFixture(t, "wrong-story");
  const wrongStoryId = `official_${sha256("wrong-story").slice(0, 24)}`;
  const wrongStoryRoot = path.join(
    fixture.tempRoot,
    "packs",
    wrongStoryId,
  );

  await assert.rejects(
    materialiseGovernedOwnedProgrammePack(
      {
        ...fixture.options,
        storyId: wrongStoryId,
        storyRoot: wrongStoryRoot,
      },
      buildAdapters(),
    ),
    /owned_programme_pack_story_id_mismatch/,
  );
  assert.equal(fs.existsSync(wrongStoryRoot), false);
});

test("materialiser rejects an exact intake reference after its declared hash drifts", async (t) => {
  const fixture = createFixture(t, "intake-hash");
  fixture.options.storyIntakeRef.sha256 = sha256("stale intake");

  await assert.rejects(
    materialiseGovernedOwnedProgrammePack(
      fixture.options,
      buildAdapters(),
    ),
    /owned_programme_pack_story_intake_sha256_mismatch/,
  );
  assert.equal(fs.existsSync(fixture.storyRoot), false);
});

test("materialiser refuses to relabel a renderer's non-owned output as owned", async (t) => {
  const fixture = createFixture(t, "non-owned");
  const adapters = buildAdapters();
  const renderScene = adapters.renderScene;
  adapters.renderScene = async (input) => ({
    ...(await renderScene(input)),
    ownership: "mixed",
    third_party_media_used: true,
  });

  await assert.rejects(
    materialiseGovernedOwnedProgrammePack(
      fixture.options,
      adapters,
    ),
    /owned_local_provenance_required/,
  );
  assert.equal(fs.existsSync(fixture.storyRoot), false);
});

test("materialiser rejects a programme probe containing any audio stream", async (t) => {
  const fixture = createFixture(t, "audio-stream");
  const adapters = buildAdapters();
  const probeMedia = adapters.probeMedia;
  adapters.probeMedia = async (input) => {
    const probe = await probeMedia(input);
    if (path.basename(input.filePath).includes("-owned-programme")) {
      probe.streams.push({
        codec_type: "audio",
        codec_name: "aac",
      });
    }
    return probe;
  };

  await assert.rejects(
    materialiseGovernedOwnedProgrammePack(
      fixture.options,
      adapters,
    ),
    /owned_programme_pack_programme_audio_stream_forbidden/,
  );
  assert.equal(fs.existsSync(fixture.storyRoot), false);
});

test("materialiser rejects a scene adapter whose repeated render is not byte deterministic", async (t) => {
  const fixture = createFixture(t, "nondeterministic");
  const adapters = buildAdapters();
  adapters.renderScene = async ({ outputPath, scene: input }) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
      outputPath,
      Buffer.from(
        outputPath.includes(".determinism")
          ? `drifted-scene:${input.asset_id}`
          : `owned-scene:${input.asset_id}`,
        "utf8",
      ),
    );
    return rendererReceipt("test-owned-scene-renderer-v1");
  };

  await assert.rejects(
    materialiseGovernedOwnedProgrammePack(
      fixture.options,
      adapters,
    ),
    /render_nondeterministic/,
  );
  assert.equal(fs.existsSync(fixture.storyRoot), false);
});

test("materialiser detects an owned visual mutated by the programme adapter", async (t) => {
  const fixture = createFixture(t, "tamper");
  const adapters = buildAdapters();
  const renderProgramme = adapters.renderProgramme;
  adapters.renderProgramme = async (input) => {
    const receipt = await renderProgramme(input);
    fs.writeFileSync(
      input.sceneAssets[0].path,
      Buffer.from("tampered-after-scene-proof", "utf8"),
    );
    return receipt;
  };

  await assert.rejects(
    materialiseGovernedOwnedProgrammePack(
      fixture.options,
      adapters,
    ),
    /owned_programme_pack_hash_drift_detected/,
  );
  assert.equal(fs.existsSync(fixture.storyRoot), false);
});

test("materialiser rejects a renderer-created symlink and leaves no story root", async (t) => {
  const fixture = createFixture(t, "symlink");
  const externalPath = path.join(fixture.tempRoot, "external.bin");
  const trialLink = path.join(fixture.tempRoot, "trial-link.bin");
  fs.writeFileSync(externalPath, "external");
  try {
    fs.symlinkSync(externalPath, trialLink, "file");
    fs.rmSync(trialLink);
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error?.code)) {
      t.skip(`filesystem symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const adapters = buildAdapters();
  adapters.renderScene = async ({ outputPath }) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.symlinkSync(externalPath, outputPath, "file");
    return rendererReceipt("test-owned-scene-renderer-v1");
  };

  await assert.rejects(
    materialiseGovernedOwnedProgrammePack(
      fixture.options,
      adapters,
    ),
    /not_regular_file/,
  );
  assert.equal(fs.existsSync(fixture.storyRoot), false);
});

test("materialiser treats an existing exact story root as an immutable conflict", async (t) => {
  const fixture = createFixture(t, "conflict");
  const first = await materialiseGovernedOwnedProgrammePack(
    fixture.options,
    buildAdapters(),
  );
  const firstResultHash = sha256(fs.readFileSync(first.result_path));

  await assert.rejects(
    materialiseGovernedOwnedProgrammePack(
      fixture.options,
      buildAdapters(),
    ),
    /owned_programme_pack_story_root_already_exists/,
  );
  assert.equal(sha256(fs.readFileSync(first.result_path)), firstResultHash);
});

test("identical exact inputs produce identical machine and Markdown hashes in different roots", async (t) => {
  const first = createFixture(t, "determinism-a");
  const second = createFixture(t, "determinism-b");
  fs.writeFileSync(second.intakePath, first.intakeBytes);
  second.options.storyIntakeRef.sha256 = sha256(first.intakeBytes);
  second.options.storyId = first.intake.story.id;
  second.options.storyRoot = path.join(
    second.tempRoot,
    "packs",
    first.intake.story.id,
  );

  const [left, right] = await Promise.all([
    materialiseGovernedOwnedProgrammePack(
      first.options,
      buildAdapters(),
    ),
    materialiseGovernedOwnedProgrammePack(
      second.options,
      buildAdapters(),
    ),
  ]);

  assert.deepEqual(
    {
      source: left.source_manifest_sha256,
      combined: left.combined_manifest_sha256,
      programme: left.programme_sha256,
      project: left.project_manifest_sha256,
      result: left.result_sha256,
      summary: left.summary_sha256,
    },
    {
      source: right.source_manifest_sha256,
      combined: right.combined_manifest_sha256,
      programme: right.programme_sha256,
      project: right.project_manifest_sha256,
      result: right.result_sha256,
      summary: right.summary_sha256,
    },
  );
});
