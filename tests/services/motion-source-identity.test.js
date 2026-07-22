"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const {
  PROFESSIONAL_MOTION_SOURCE_POLICY,
  canonicaliseMotionSourceUrl,
  resolveMotionSourceIdentity,
  reconcileMotionSourceIdentities,
  assessProfessionalSourceDiversity,
} = require("../../lib/studio/motion-source-identity");

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

test("real-motion CLI loads its tracked source-identity dependency", () => {
  const root = path.resolve(__dirname, "../..");
  const output = execFileSync(
    process.execPath,
    [path.join(root, "tools", "goal-real-motion-materializer.js"), "--help"],
    { cwd: root, encoding: "utf8", timeout: 30_000 },
  );

  assert.match(output, /Materialises validated direct gameplay/i);
  assert.match(output, /No publishing, DB mutation, OAuth or token changes/i);
});

test("motion source identity rejects mutable family names and derivative paths as genuine sources", () => {
  const clips = [12, 24, 36].map((start) => ({
    id: `trailer_window_${start}`,
    path: `C:\\renders\\trailer_window_${start}_5.mp4`,
    source_family: `renamed_family_${start}`,
    base_source_family: `renamed_base_${start}`,
    motion_family: `renamed_motion_${start}`,
    template_family: `renamed_template_${start}`,
  }));

  const result = assessProfessionalSourceDiversity({ clips, scenes: clips });

  assert.equal(result.policy_tier, "ultimate_professional");
  assert.equal(result.status, "blocked");
  assert.equal(result.observed_genuine_base_source_count, 0);
  assert.equal(result.unresolved_clips.length, 3);
  assert.ok(result.blockers.includes("professional_motion_source_identity_unresolved"));
  assert.ok(result.blockers.includes("professional_genuine_base_source_minimum_not_met"));
  assert.deepEqual(
    result.unresolved_clips.map((clip) => clip.rejected_identity_fields.sort()),
    clips.map(() => [
      "base_source_family",
      "motion_family",
      "path",
      "source_family",
      "template_family",
    ]),
  );
  assert.deepEqual(
    result.unresolved_clips.map((clip) => clip.rejection_reasons),
    clips.map(() => [
      "derivative_path_not_genuine_source_identity",
      "mutable_family_label_not_genuine_source_identity",
    ]),
  );
});

test("procedural derivatives from one generator project collapse with machine-readable reasons", () => {
  const clips = [
    {
      id: "alpha_landscape",
      path: "renders/alpha-landscape.mp4",
      source_family: "landscape_family",
      generator_project_id: "pulse-project-alpha",
      generator_project_sha256: HASH_A,
      generation_method: "procedural",
    },
    {
      id: "alpha_portrait",
      path: "exports/renamed-portrait.mp4",
      source_family: "portrait_family",
      generator_project_id: "pulse-project-alpha",
      generator_project_sha256: HASH_A,
      generation_method: "procedural",
    },
    {
      id: "beta_portrait",
      path: "exports/beta-portrait.mp4",
      generator_project_id: "pulse-project-beta",
      generator_project_sha256: HASH_B,
      generation_method: "procedural",
    },
  ];

  const reconciled = reconcileMotionSourceIdentities(clips);

  assert.equal(reconciled.sources.length, 2);
  const alpha = reconciled.sources.find((source) => source.clip_indexes.includes(0));
  assert.deepEqual(alpha.clip_indexes, [0, 1]);
  assert.equal(alpha.base_source_asset_id, `generator-sha256:${HASH_A}`);
  assert.ok(alpha.collapse_reasons.includes("procedural_generator_project_match"));
  assert.deepEqual(reconciled.rejected_independence_claims, [
    {
      clip_index: 1,
      clip_id: "alpha_portrait",
      duplicate_of_clip_index: 0,
      base_source_asset_id: `generator-sha256:${HASH_A}`,
      rejection_reasons: [
        "procedural_generator_master_match",
        "procedural_generator_project_match",
      ],
    },
  ]);
});

test("sampled visual fingerprints collapse near-identical procedural template variants", () => {
  const fingerprint = (hashes) => ({
    algorithm: "temporal-dhash-9x8-v1",
    hashes,
    signature: hashes.join(":"),
    sample_count: hashes.length,
  });
  const clips = [
    {
      id: "project_alpha",
      generator_project_id: "project-alpha",
      generator_project_sha256: HASH_A,
      generation_method: "procedural",
      sampled_visual_fingerprint: fingerprint([
        "0000000000000000",
        "1111111111111111",
        "2222222222222222",
        "3333333333333333",
      ]),
    },
    {
      id: "renamed_template_variant",
      generator_project_id: "project-renamed",
      generator_project_sha256: HASH_B,
      generation_method: "procedural_template_variant",
      sampled_visual_fingerprint: fingerprint([
        "0000000000000001",
        "1111111111111110",
        "2222222222222223",
        "3333333333333332",
      ]),
    },
    {
      id: "genuinely_distinct_project",
      generator_project_id: "project-gamma",
      generator_project_sha256: HASH_C,
      generation_method: "procedural",
      sampled_visual_fingerprint: fingerprint([
        "aaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbb",
        "cccccccccccccccc",
        "dddddddddddddddd",
      ]),
    },
  ];

  const result = assessProfessionalSourceDiversity({
    clips,
    scenes: clips,
    requiredBaseSources: 2,
    maxSourceShare: 1,
  });

  assert.equal(result.observed_genuine_base_source_count, 2);
  assert.equal(result.status, "pass");
  assert.deepEqual(result.rejected_independence_claims, [
    {
      clip_index: 1,
      clip_id: "renamed_template_variant",
      duplicate_of_clip_index: 0,
      base_source_asset_id: `generator-sha256:${HASH_A}`,
      rejection_reasons: [
        "procedural_template_variant_not_independent_source",
        "sampled_visual_fingerprint_near_duplicate",
      ],
    },
  ]);
});

test("near visual fingerprints do not override distinct official source identities", () => {
  const fingerprint = (lastHash) => ({
    algorithm: "temporal-dhash-9x8-v1",
    hashes: [
      "0000000000000000",
      "1111111111111111",
      "2222222222222222",
      lastHash,
    ],
  });
  const clips = [
    {
      id: "official_gameplay",
      source_type: "official_publisher_trailer",
      canonical_source_url: "https://publisher.example/trailers/gameplay.mp4",
      source_master_sha256: HASH_A,
      sampled_visual_fingerprint: fingerprint("3333333333333333"),
    },
    {
      id: "official_launch",
      source_type: "official_publisher_trailer",
      canonical_source_url: "https://publisher.example/trailers/launch.mp4",
      source_master_sha256: HASH_B,
      sampled_visual_fingerprint: fingerprint("3333333333333332"),
    },
  ];

  const reconciled = reconcileMotionSourceIdentities(clips);

  assert.equal(reconciled.sources.length, 2);
  assert.deepEqual(reconciled.rejected_independence_claims, []);
  assert.deepEqual(
    reconciled.sources.map((source) => source.base_source_asset_id).sort(),
    [`sha256:${HASH_A}`, `sha256:${HASH_B}`],
  );
});

test("motion source identity canonicalises YouTube aliases and strips tracking noise", () => {
  assert.equal(
    canonicaliseMotionSourceUrl("https://www.youtube.com/watch?v=AbC123_XY-9&utm_source=discord"),
    "youtube:AbC123_XY-9",
  );
  assert.equal(
    canonicaliseMotionSourceUrl("https://youtu.be/AbC123_XY-9?t=42"),
    "youtube:AbC123_XY-9",
  );

  const clips = [
    { id: "window_a", source_url: "https://youtube.com/watch?v=AbC123_XY-9" },
    { id: "window_b", source_url: "https://youtu.be/AbC123_XY-9?t=42" },
  ];
  const reconciled = reconcileMotionSourceIdentities(clips);

  assert.equal(reconciled.sources.length, 1);
  assert.equal(reconciled.sources[0].base_source_asset_id, "youtube:AbC123_XY-9");
  assert.deepEqual(reconciled.sources[0].clip_indexes, [0, 1]);
});

test("motion source identity collapses Steam trailer transport and CDN mirrors", () => {
  const trailerRoot =
    "/store_trailers/2806050/1673450740/ed598dc7526249e6bd74f53732f9a6ecf71f8063/1780963408";
  const fastlyDash =
    `https://video.fastly.steamstatic.com${trailerRoot}/dash_av1.mpd?t=1781050956`;
  const akamaiHls =
    `https://video.akamai.steamstatic.com${trailerRoot}/hls_264_master.m3u8?t=1781050956`;
  const expected = `url:https://video.steamstatic.com${trailerRoot}`;

  assert.equal(canonicaliseMotionSourceUrl(fastlyDash), expected);
  assert.equal(canonicaliseMotionSourceUrl(akamaiHls), expected);

  const reconciled = reconcileMotionSourceIdentities([
    { id: "fastly_dash", canonical_source_url: fastlyDash },
    { id: "akamai_hls", canonical_source_url: akamaiHls },
  ]);
  assert.equal(reconciled.sources.length, 1);
  assert.deepEqual(reconciled.sources[0].clip_indexes, [0, 1]);
});

test("motion source identity accepts stable base asset IDs but rejects placeholder IDs", () => {
  const stable = resolveMotionSourceIdentity({
    id: "official-scene",
    base_source_asset_id: "publisher-arknights-endfield-trailer-01",
  });
  const placeholder = resolveMotionSourceIdentity({
    id: "placeholder-scene",
    base_source_asset_id: "placeholder",
  });

  assert.equal(stable.resolved, true);
  assert.equal(
    stable.base_source_asset_id,
    "asset:publisher-arknights-endfield-trailer-01",
  );
  assert.equal(stable.base_source_identity_basis, "base_source_asset_id");
  assert.equal(placeholder.resolved, false);
});

test("motion source identity collapses URL mirrors by master hash and sampled fingerprint", () => {
  const clips = [
    {
      id: "official_cdn",
      canonical_source_url: "https://publisher.example/trailers/gameplay.mp4",
      source_master_sha256: HASH_A,
      sampled_visual_fingerprint: "phash:0123456789abcdef",
    },
    {
      id: "youtube_mirror",
      source_url: "https://youtu.be/MirrorVideo1",
      master_sha256: HASH_A,
    },
    {
      id: "platform_mirror",
      source_url: "https://platform.example/video/gameplay-encode.m3u8",
      sampled_visual_fingerprint: "phash:0123456789abcdef",
    },
    {
      id: "different_trailer",
      source_url: "https://publisher.example/trailers/story.mp4",
      master_sha256: HASH_B,
    },
  ];

  const reconciled = reconcileMotionSourceIdentities(clips);

  assert.equal(reconciled.sources.length, 2);
  const mirrored = reconciled.sources.find((source) => source.clip_indexes.includes(0));
  assert.deepEqual(mirrored.clip_indexes, [0, 1, 2]);
  assert.equal(mirrored.base_source_asset_id, `sha256:${HASH_A}`);
  assert.ok(mirrored.identity_evidence.some((entry) => entry.kind === "sampled_visual_fingerprint"));
  assert.ok(mirrored.identity_evidence.some((entry) => entry.kind === "youtube_id"));
});

test("professional source diversity blocks either excessive scene count or source share", () => {
  const clips = [
    {
      id: "source_a_1",
      path: "a-1.mp4",
      source_url: "https://publisher.example/a/master.mp4",
      source_master_sha256: HASH_A,
    },
    {
      id: "source_a_2",
      path: "a-2.mp4",
      source_url: "https://publisher.example/a/master.mp4",
      source_master_sha256: HASH_A,
    },
    {
      id: "source_a_3",
      path: "a-3.mp4",
      source_url: "https://publisher.example/a/master.mp4",
      source_master_sha256: HASH_A,
    },
    {
      id: "source_b_1",
      path: "b-1.mp4",
      source_url: "https://publisher.example/b/master.mp4",
      source_master_sha256: HASH_B,
    },
  ];

  const blocked = assessProfessionalSourceDiversity({ clips, scenes: clips });

  assert.equal(blocked.observed_genuine_base_source_count, 2);
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.blockers.includes("professional_motion_source_concentration_above_floor"));
  assert.deepEqual(blocked.concentration_rule, {
    max_scenes_per_source: PROFESSIONAL_MOTION_SOURCE_POLICY.max_scenes_per_source,
    max_source_share: PROFESSIONAL_MOTION_SOURCE_POLICY.max_source_share,
    operator: "scene_count > max_scenes_per_source OR scene_share > max_source_share",
  });
  assert.equal(blocked.per_source_scene_shares[0].scene_count, 3);
  assert.equal(blocked.per_source_scene_shares[0].scene_share, 0.75);

  const exactShareEdge = [HASH_A, HASH_B, HASH_C, HASH_D].flatMap((hash, sourceIndex) =>
    Array.from({ length: 3 }, (_, sceneIndex) => ({
      id: `source_${sourceIndex}_scene_${sceneIndex}`,
      path: `source-${sourceIndex}-scene-${sceneIndex}.mp4`,
      source_master_sha256: hash,
    })),
  );
  const countBlockedAtExactShare = assessProfessionalSourceDiversity({
    clips: exactShareEdge,
    scenes: exactShareEdge,
  });

  assert.equal(countBlockedAtExactShare.per_source_scene_shares[0].scene_share, 0.25);
  assert.equal(countBlockedAtExactShare.status, "blocked");
  assert.ok(
    countBlockedAtExactShare.blockers.includes(
      "professional_motion_source_concentration_above_floor",
    ),
  );

  const balancedScenes = [HASH_A, HASH_B, HASH_C, HASH_D].flatMap((hash, sourceIndex) =>
    Array.from({ length: 2 }, (_, sceneIndex) => ({
      id: `balanced_source_${sourceIndex}_scene_${sceneIndex}`,
      path: `balanced-source-${sourceIndex}-scene-${sceneIndex}.mp4`,
      source_master_sha256: hash,
    })),
  );
  const balanced = assessProfessionalSourceDiversity({
    clips: balancedScenes,
    scenes: balancedScenes,
  });

  assert.equal(balanced.status, "pass");
  assert.deepEqual(balanced.blockers, []);
  assert.equal(balanced.checks.source_concentration.status, "pass");
});

test("motion source identity fails closed on conflicting master hashes", () => {
  const evidence = resolveMotionSourceIdentity({
    id: "ambiguous",
    master_sha256: HASH_A,
    provenance: { source_master_sha256: HASH_B },
    source_url: "https://publisher.example/trailer.mp4",
  });

  assert.equal(evidence.resolved, false);
  assert.equal(evidence.ambiguous, true);
  assert.ok(evidence.blockers.includes("motion_source_master_hash_conflict"));
});

test("motion source identity fails closed on conflicting generator project masters", () => {
  const evidence = resolveMotionSourceIdentity({
    id: "ambiguous_generator_project",
    generator_project_id: "project-alpha",
    generator_project_sha256: HASH_A,
    provenance: { generator_master_sha256: HASH_B },
    generation_method: "procedural",
  });

  assert.equal(evidence.resolved, false);
  assert.equal(evidence.ambiguous, true);
  assert.ok(evidence.blockers.includes("motion_source_generator_master_hash_conflict"));
});
