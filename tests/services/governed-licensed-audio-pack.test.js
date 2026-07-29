"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  validateGovernedLicensedAudioPack,
} = require("../../lib/services/governed-licensed-audio-pack");

const STORY_ID = "official_3b8d305c4e17";
const CHANNEL_ID = "pulse-gaming";
const GENERATED_AT = "2026-07-27T18:00:00.000Z";
const VALIDATION_BOUNDARY = "2026-07-28T18:00:00.000Z";
const REVIEW_DUE_AT = "2026-08-03T18:00:00.000Z";
const NARRATION_SHA256 = "7".repeat(64);
const TIMESTAMPS_SHA256 = "8".repeat(64);
const TARGET_DURATION_SECONDS = 36.48;

function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalise(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fingerprint(value) {
  return sha256(Buffer.from(JSON.stringify(canonicalise(value)), "utf8"));
}

function writeFile(root, relativePath, bytes) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);
  return {
    path: relativePath.replace(/\\/g, "/"),
    absolutePath,
    sha256: sha256(fs.readFileSync(absolutePath)),
    size_bytes: fs.statSync(absolutePath).size,
  };
}

function writeJson(root, relativePath, value) {
  return writeFile(
    root,
    relativePath,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
  );
}

function licensedAudioPackFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-licensed-audio-pack-"),
  );
  const candidateManifest = writeJson(
    root,
    "canonical_story_manifest.json",
    {
      schema_version: "pulse-canonical-story-manifest-v1",
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
      story: { id: STORY_ID },
    },
  );
  const audioAssets = [
    {
      asset_id: "epidemic_sound_bed_primary_fixture",
      asset_type: "music_bed",
      ledger_role: "bed_primary",
      role: "MUSIC_BED",
      provider_asset_reference:
        "epidemic-sound://music/gaining-season",
      file: writeFile(
        root,
        "assets/epidemic-bed.mp3",
        Buffer.from("licensed-epidemic-bed-fixture", "utf8"),
      ),
    },
    {
      asset_id: "epidemic_sound_sting_verified_fixture",
      asset_type: "music_sting",
      ledger_role: "sting_verified",
      role: "MUSIC_STING",
      provider_asset_reference:
        "epidemic-sound://music/gaining-season-sting",
      file: writeFile(
        root,
        "assets/epidemic-sting.wav",
        Buffer.from("licensed-epidemic-sting-fixture", "utf8"),
      ),
    },
    {
      asset_id: "epidemic_sound_impact_fixture",
      asset_type: "sfx",
      ledger_role: "impact",
      role: "SFX_IMPACT",
      provider_asset_reference:
        "epidemic-sound://sfx/cinematic-impact",
      file: writeFile(
        root,
        "assets/epidemic-impact.wav",
        Buffer.from("licensed-epidemic-impact-fixture", "utf8"),
      ),
    },
    {
      asset_id: "epidemic_sound_transition_fixture",
      asset_type: "sfx",
      ledger_role: "transition",
      role: "SFX_TRANSITION",
      provider_asset_reference:
        "epidemic-sound://sfx/cinematic-transition",
      file: writeFile(
        root,
        "assets/epidemic-transition.wav",
        Buffer.from("licensed-epidemic-transition-fixture", "utf8"),
      ),
    },
  ];
  const safelist = writeJson(
    root,
    "rights/epidemic-safelist.json",
    {
      schema_version: "pulse-epidemic-safelist-evidence-v1",
      provider_id: "epidemic_sound",
      channel_id: CHANNEL_ID,
      destination: {
        platform: "YOUTUBE",
        surface: "SHORTS",
        account_uri: "https://www.youtube.com/@PulseGMG",
      },
      active_subscription: true,
      channel_safelisted: true,
      attested_by: "channel-owner",
      attested_at: GENERATED_AT,
      review_due_at: REVIEW_DUE_AT,
    },
  );
  for (const asset of audioAssets) {
    asset.rightsEvidence = writeJson(
      root,
      `rights/${asset.asset_id}.json`,
      {
        schema_version:
          "pulse-governed-licensed-audio-rights-evidence-v1",
        story_id: STORY_ID,
        asset_id: asset.asset_id,
        asset_sha256: asset.file.sha256,
        asset_size_bytes: asset.file.size_bytes,
        provider_id: "epidemic_sound",
        provider_asset_reference:
          asset.provider_asset_reference,
        licence_basis:
          "epidemic_sound_active_subscription_safelisted_channel",
        licence_evidence_url:
          "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
        allowed_destinations: ["YOUTUBE_SHORTS"],
        allowed_revenue_modes: [
          "ORGANIC",
          "PLATFORM_ADVERTISING",
        ],
        raw_redistribution_allowed: false,
        approval_status:
          "approved_for_commercial_editorial_use",
        rights_verdict: "GREEN",
        safelist_evidence_sha256: safelist.sha256,
        reviewed_by: "pulse-editorial-rights-review",
        reviewed_at: GENERATED_AT,
        review_due_at: REVIEW_DUE_AT,
      },
    );
    asset.rightsRecord = {
      asset_id: asset.asset_id,
      asset_type: asset.asset_type,
      role: asset.ledger_role,
      provider_id: "epidemic_sound",
      provider_asset_reference:
        asset.provider_asset_reference,
      local_asset_path: asset.file.path,
      licence_basis:
        "epidemic_sound_active_subscription_safelisted_channel",
      licence_evidence_url:
        "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
      allowed_platforms: ["youtube_shorts"],
      allowed_revenue_modes: [
        "organic",
        "platform_advertising",
      ],
      commercial_use_allowed: true,
      raw_redistribution_allowed: false,
      approval_status:
        "approved_for_commercial_editorial_use",
      rights_verdict: "GREEN",
      live_publish_allowed: true,
      requires_human_legal_review_before_publish: false,
      asset_sha256: asset.file.sha256,
      asset_size_bytes: asset.file.size_bytes,
      rights_evidence_sha256: asset.rightsEvidence.sha256,
      safelist_evidence_sha256: safelist.sha256,
    };
  }
  const rightsLedger = writeJson(root, "rights_ledger.json", {
    schema_version:
      "pulse-governed-licensed-audio-rights-ledger-v1",
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    generated_at: GENERATED_AT,
    review_due_at: REVIEW_DUE_AT,
    records: audioAssets.map((asset) => asset.rightsRecord),
  });
  const manifest = {
    schema_version: "pulse-governed-licensed-audio-pack-v1",
    policy: "EPIDEMIC_SOUND_LICENSED_PACK_V1",
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    generated_at: GENERATED_AT,
    candidate_manifest: {
      path: candidateManifest.path,
      sha256: candidateManifest.sha256,
    },
    rights_ledger: {
      path: rightsLedger.path,
      sha256: rightsLedger.sha256,
    },
    provider: {
      id: "epidemic_sound",
      licence_basis:
        "epidemic_sound_active_subscription_safelisted_channel",
      licence_evidence_url:
        "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
      safelist_evidence: {
        path: safelist.path,
        sha256: safelist.sha256,
      },
    },
    scope: {
      destinations: ["YOUTUBE_SHORTS"],
      revenue_modes: ["ORGANIC", "PLATFORM_ADVERTISING"],
      prohibited_without_new_review: [
        "SPONSORSHIP",
        "AFFILIATE_PROMOTION",
        "CLIENT_FUNDED_USE",
        "PAID_ACCESS",
        "CROSS_PLATFORM_REPOSTING",
      ],
    },
    render_binding: {
      narration_sha256: NARRATION_SHA256,
      timestamps_sha256: TIMESTAMPS_SHA256,
      target_duration_seconds: TARGET_DURATION_SECONDS,
    },
    assets: audioAssets.map((asset) => ({
        asset_id: asset.asset_id,
        role: asset.role,
        provider_asset_reference:
          asset.provider_asset_reference,
        local_asset: {
          path: asset.file.path,
          sha256: asset.file.sha256,
          size_bytes: asset.file.size_bytes,
        },
        rights_record_sha256: fingerprint(asset.rightsRecord),
        rights_evidence: {
          path: asset.rightsEvidence.path,
          sha256: asset.rightsEvidence.sha256,
        },
        embedded_in_final: true,
      })),
    mix: {
      policy_version: "epidemic_sidechain_ducked_bed_v1",
      narration_included: false,
      target_duration_seconds: TARGET_DURATION_SECONDS,
      bed: {
        asset_id: audioAssets[0].asset_id,
        raw_volume: 0.1,
        ducked_output_volume: 0.26,
        trim_start_seconds: 0,
        fade_in_seconds: 0.18,
        fade_out_seconds: 0.8,
        sidechain: {
          threshold: 0.035,
          ratio: 5.5,
          attack_ms: 18,
          release_ms: 420,
        },
      },
      micro_drop_windows: [
        {
          start_seconds: 2.63,
          end_seconds: 2.83,
          multiplier: 0.18,
        },
        {
          start_seconds: 4.33,
          end_seconds: 4.53,
          multiplier: 0.18,
        },
      ],
      cues: [
        {
          asset_id: audioAssets[1].asset_id,
          at_seconds: 0,
          volume: 0.035,
          trim_start_seconds: 0,
          duration_seconds: 0.62,
          fade_in_seconds: 0,
          fade_out_seconds: 0.16,
        },
        {
          asset_id: audioAssets[2].asset_id,
          at_seconds: 0,
          volume: 0.055,
          trim_start_seconds: 0,
          duration_seconds: 0.32,
          fade_in_seconds: 0,
          fade_out_seconds: 0.08,
        },
        {
          asset_id: audioAssets[3].asset_id,
          at_seconds: 0.35,
          volume: 0.045,
          trim_start_seconds: 0,
          duration_seconds: 0.42,
          fade_in_seconds: 0,
          fade_out_seconds: 0.1,
        },
      ],
    },
  };
  const manifestFile = writeJson(
    root,
    "governed-licensed-audio-pack.json",
    manifest,
  );
  return {
    root,
    audioAssets,
    manifest,
    manifestFile,
    rightsLedger,
  };
}

test("validates a story-bound Epidemic cinematic pack for YouTube platform-ad use", () => {
  const input = licensedAudioPackFixture();
  try {
    const result = validateGovernedLicensedAudioPack({
      manifestPath: input.manifestFile.absolutePath,
      expectedManifestSha256: input.manifestFile.sha256,
      expectedStoryId: STORY_ID,
      expectedChannelId: CHANNEL_ID,
      expectedNarrationSha256: NARRATION_SHA256,
      expectedTimestampsSha256: TIMESTAMPS_SHA256,
      expectedTargetDurationSeconds: TARGET_DURATION_SECONDS,
      expectedRightsLedgerSha256: input.rightsLedger.sha256,
      expectedYoutubeAccountUri:
        "https://www.youtube.com/@PulseGMG",
      requiredDestination: "YOUTUBE_SHORTS",
      requiredRevenueMode: "PLATFORM_ADVERTISING",
      validationBoundaryAt: VALIDATION_BOUNDARY,
    });

    assert.equal(result.story_id, STORY_ID);
    assert.equal(result.policy, "EPIDEMIC_SOUND_LICENSED_PACK_V1");
    assert.equal(result.assets.length, 4);
    assert.equal(result.assets[0].asset_id, input.manifest.assets[0].asset_id);
    assert.equal(result.assets[0].path, input.audioAssets[0].file.absolutePath);
    assert.equal(result.assets[0].sha256, input.audioAssets[0].file.sha256);
    assert.equal(result.assets[0].role, "MUSIC_BED");
    assert.equal(result.mix.narration_included, false);
    assert.equal(result.mix.cues.length, 3);
    assert.equal(result.validation_status, "PASS");
    assert.equal(result.publish_authorised, false);
    assert.equal(result.platform_objects_created, false);
  } finally {
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("rejects a licensed audio pack that includes narration", () => {
  const input = licensedAudioPackFixture();
  try {
    input.manifest.mix.narration_included = true;
    const tamperedManifest = writeJson(
      input.root,
      "governed-licensed-audio-pack.json",
      input.manifest,
    );
    assert.throws(
      () =>
        validateGovernedLicensedAudioPack({
          manifestPath: tamperedManifest.absolutePath,
          expectedManifestSha256: tamperedManifest.sha256,
          expectedStoryId: STORY_ID,
          expectedChannelId: CHANNEL_ID,
          expectedNarrationSha256: NARRATION_SHA256,
          expectedTimestampsSha256: TIMESTAMPS_SHA256,
          expectedTargetDurationSeconds: TARGET_DURATION_SECONDS,
          expectedRightsLedgerSha256: input.rightsLedger.sha256,
          expectedYoutubeAccountUri:
            "https://www.youtube.com/@PulseGMG",
          requiredDestination: "YOUTUBE_SHORTS",
          requiredRevenueMode: "PLATFORM_ADVERTISING",
          validationBoundaryAt: VALIDATION_BOUNDARY,
        }),
      (error) => {
        assert.ok(
          error.codes.includes(
            "licensed_audio_mix_narration_forbidden",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("rejects a pack that is not bound to the externally selected channel", () => {
  const input = licensedAudioPackFixture();
  try {
    assert.throws(
      () =>
        validateGovernedLicensedAudioPack({
          manifestPath: input.manifestFile.absolutePath,
          expectedManifestSha256: input.manifestFile.sha256,
          expectedStoryId: STORY_ID,
          expectedChannelId: "another-channel",
          expectedNarrationSha256: NARRATION_SHA256,
          expectedTimestampsSha256: TIMESTAMPS_SHA256,
          expectedTargetDurationSeconds: TARGET_DURATION_SECONDS,
          expectedRightsLedgerSha256: input.rightsLedger.sha256,
          expectedYoutubeAccountUri:
            "https://www.youtube.com/@PulseGMG",
          requiredDestination: "YOUTUBE_SHORTS",
          requiredRevenueMode: "PLATFORM_ADVERTISING",
          validationBoundaryAt: VALIDATION_BOUNDARY,
        }),
      (error) => {
        assert.ok(
          error.codes.includes(
            "licensed_audio_manifest_channel_mismatch",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("rejects a pack bound to a different narration or timestamp timeline", () => {
  const input = licensedAudioPackFixture();
  try {
    assert.throws(
      () =>
        validateGovernedLicensedAudioPack({
          manifestPath: input.manifestFile.absolutePath,
          expectedManifestSha256: input.manifestFile.sha256,
          expectedStoryId: STORY_ID,
          expectedChannelId: CHANNEL_ID,
          expectedNarrationSha256: "9".repeat(64),
          expectedTimestampsSha256: TIMESTAMPS_SHA256,
          expectedTargetDurationSeconds: TARGET_DURATION_SECONDS,
          expectedRightsLedgerSha256: input.rightsLedger.sha256,
          expectedYoutubeAccountUri:
            "https://www.youtube.com/@PulseGMG",
          requiredDestination: "YOUTUBE_SHORTS",
          requiredRevenueMode: "PLATFORM_ADVERTISING",
          validationBoundaryAt: VALIDATION_BOUNDARY,
        }),
      (error) => {
        assert.ok(
          error.codes.includes(
            "licensed_audio_render_binding_mismatch",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("rejects a selected-audio ledger asset omitted from the pack", () => {
  const input = licensedAudioPackFixture();
  try {
    const omittedAsset = input.manifest.assets.at(-1);
    input.manifest.assets = input.manifest.assets.filter(
      (asset) => asset.asset_id !== omittedAsset.asset_id,
    );
    input.manifest.mix.cues = input.manifest.mix.cues.filter(
      (cue) => cue.asset_id !== omittedAsset.asset_id,
    );
    const incompleteManifest = writeJson(
      input.root,
      "governed-licensed-audio-pack.json",
      input.manifest,
    );
    assert.throws(
      () =>
        validateGovernedLicensedAudioPack({
          manifestPath: incompleteManifest.absolutePath,
          expectedManifestSha256: incompleteManifest.sha256,
          expectedStoryId: STORY_ID,
          expectedChannelId: CHANNEL_ID,
          expectedNarrationSha256: NARRATION_SHA256,
          expectedTimestampsSha256: TIMESTAMPS_SHA256,
          expectedTargetDurationSeconds: TARGET_DURATION_SECONDS,
          expectedRightsLedgerSha256: input.rightsLedger.sha256,
          expectedYoutubeAccountUri:
            "https://www.youtube.com/@PulseGMG",
          requiredDestination: "YOUTUBE_SHORTS",
          requiredRevenueMode: "PLATFORM_ADVERTISING",
          validationBoundaryAt: VALIDATION_BOUNDARY,
        }),
      (error) => {
        assert.ok(
          error.codes.includes(
            "licensed_audio_rights_ledger_asset_coverage_mismatch",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("rejects Windows drive-relative and ADS-like package paths before file access", () => {
  for (const unsafePath of [
    "C:assets/epidemic-bed.mp3",
    "assets/epidemic-bed.mp3:alternate-stream",
  ]) {
    const input = licensedAudioPackFixture();
    try {
      input.manifest.assets[0].local_asset.path = unsafePath;
      const unsafeManifest = writeJson(
        input.root,
        "governed-licensed-audio-pack.json",
        input.manifest,
      );
      assert.throws(
        () =>
          validateGovernedLicensedAudioPack({
            manifestPath: unsafeManifest.absolutePath,
            expectedManifestSha256: unsafeManifest.sha256,
            expectedStoryId: STORY_ID,
            expectedChannelId: CHANNEL_ID,
            expectedNarrationSha256: NARRATION_SHA256,
            expectedTimestampsSha256: TIMESTAMPS_SHA256,
            expectedTargetDurationSeconds:
              TARGET_DURATION_SECONDS,
            expectedRightsLedgerSha256:
              input.rightsLedger.sha256,
            expectedYoutubeAccountUri:
              "https://www.youtube.com/@PulseGMG",
            requiredDestination: "YOUTUBE_SHORTS",
            requiredRevenueMode: "PLATFORM_ADVERTISING",
            validationBoundaryAt: VALIDATION_BOUNDARY,
          }),
        (error) => {
          assert.ok(
            error.codes.includes(
              "licensed_audio_asset_0_local_asset_path_invalid",
            ),
          );
          return true;
        },
      );
    } finally {
      fs.rmSync(input.root, { recursive: true, force: true });
    }
  }
});

test("rejects a self-consistent pack when its rights ledger is not the externally reviewed ledger", () => {
  const input = licensedAudioPackFixture();
  try {
    assert.throws(
      () =>
        validateGovernedLicensedAudioPack({
          manifestPath: input.manifestFile.absolutePath,
          expectedManifestSha256: input.manifestFile.sha256,
          expectedStoryId: STORY_ID,
          expectedChannelId: CHANNEL_ID,
          expectedNarrationSha256: NARRATION_SHA256,
          expectedTimestampsSha256: TIMESTAMPS_SHA256,
          expectedTargetDurationSeconds: TARGET_DURATION_SECONDS,
          expectedRightsLedgerSha256: "f".repeat(64),
          expectedYoutubeAccountUri:
            "https://www.youtube.com/@PulseGMG",
          requiredDestination: "YOUTUBE_SHORTS",
          requiredRevenueMode: "PLATFORM_ADVERTISING",
          validationBoundaryAt: VALIDATION_BOUNDARY,
        }),
      (error) => {
        assert.ok(
          error.codes.includes(
            "licensed_audio_rights_ledger_external_hash_mismatch",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});
