"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  fingerprintRendererManifest,
} = require("../../lib/stabilisation/renderer-governance");
const {
  executeGovernedPublicationReview,
} = require("../../lib/services/governed-publication-review");
const { bindRepositories } = require("../../lib/repositories");
const {
  prepareGovernedWindowCandidateAuthority,
} = require("../../lib/services/governed-youtube-window-candidate-authority");
const {
  admitPublication,
} = require("../../lib/services/publication-admission");
const {
  fingerprintRightsRecord,
  validateGovernedLicensedAudioPack,
} = require("../../lib/services/governed-licensed-audio-pack");
const {
  METADATA_SCHEMA,
} = require("../../lib/services/governed-publication-metadata");
const {
  ATTRIBUTION_TEXT,
  MANIFEST_SCHEMA: SOURCE_MEDIA_MANIFEST_SCHEMA,
} = require("../../lib/services/governed-source-media");
const {
  buildNextPublishCandidatesReport,
} = require("../../lib/ops/stabilisation-preflight");

const NOW = "2026-07-27T12:00:00.000Z";
const STORY_ID = "official_ff567afb1a07";
const CHANNEL_ID = "pulse-gaming";
const SCRIPT =
  "Delta Force just widened cheater compensation to cover thirty-day bans. Previously, victims qualified only after a ten-year ban. The official update says in-game mail should arrive within three business days of confirmation. But if a squadmate extracted and returned your gear, you cannot claim twice.";
const LICENCE_URL =
  "https://support.eu.square-enix.com/rule.php?id=5383&la=2&tag=authc";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fileRecord(root, name, contents) {
  const filePath = path.join(root, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return {
    path: name.replace(/\\/g, "/"),
    absolutePath: filePath,
    sha256: sha256(fs.readFileSync(filePath)),
  };
}

function validProbe(durationSeconds = 28) {
  return {
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        profile: "High",
        pix_fmt: "yuv420p",
        width: 1080,
        height: 1920,
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
      },
    ],
    format: { duration: Number(durationSeconds).toFixed(6) },
  };
}

function migrationEnv() {
  return {
    NODE_ENV: "production",
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    PULSE_MIGRATION_020_APPROVED: "true",
    PULSE_MIGRATION_020_APPROVAL_ID: "test-migration-020",
    PULSE_MIGRATION_020_APPROVED_BY: "test-operator",
    PULSE_MIGRATION_020_BACKUP_ID: "test-backup",
    PULSE_MIGRATION_020_BACKUP_SHA256: "a".repeat(64),
    PULSE_MIGRATION_020_BACKUP_VERIFIED_AT: "2026-07-27T11:00:00.000Z",
    PULSE_MIGRATION_024_APPROVED: "true",
    PULSE_MIGRATION_024_APPROVAL_ID: "test-migration-024",
    PULSE_MIGRATION_024_APPROVED_BY: "test-operator",
    PULSE_MIGRATION_024_BACKUP_ID: "test-backup-024",
    PULSE_MIGRATION_024_BACKUP_SHA256: "b".repeat(64),
    PULSE_MIGRATION_024_BACKUP_VERIFIED_AT: "2026-07-27T11:30:00.000Z",
  };
}

function createDatabase(root, values) {
  const scriptSha = values.scriptSha256;
  const databasePath = path.join(root, "pulse.db");
  const db = new Database(databasePath);
  runMigrations(db, {
    env: migrationEnv(),
    now: new Date(NOW),
    log() {},
  });
  db.prepare(
    `INSERT INTO channels (id, name, enabled)
     VALUES (?, ?, 1)`,
  ).run(CHANNEL_ID, "Pulse Gaming");
  db.prepare(
    `INSERT INTO stories
       (id, title, channel_id, approved, auto_approved, full_script,
        tts_script, _extra)
     VALUES (?, ?, ?, 1, 0, ?, ?, ?)`,
  ).run(
    STORY_ID,
    "Delta Force widens cheater compensation",
    CHANNEL_ID,
    SCRIPT,
    SCRIPT,
    JSON.stringify({
      script_sha256: scriptSha,
      script_approved_sha256: scriptSha,
      script_approved_by: "script-editor",
      script_approved_at: "2026-07-27T11:15:00.000Z",
      operator_review_status: "script_approved",
      breaking_fast_track: true,
      source_evidence_sha256: values.review.source_evidence.sha256,
      owned_asset_manifest_sha256: values.review.owned_motion_manifest.sha256,
    }),
  );
  db.close();
  return databasePath;
}

function createBackupEvidence(root, databasePath, suffix = "one") {
  const backupPath = path.join(root, `pulse-${suffix}.backup.db`);
  fs.copyFileSync(databasePath, backupPath);
  const evidencePath = path.join(root, `backup-${suffix}.json`);
  writeJson(evidencePath, {
    schema_version: "pulse-cutover-backup-evidence-v1",
    backup_id: `backup-${suffix}`,
    backup_path: path.basename(backupPath),
    backup_sha256: sha256(fs.readFileSync(backupPath)),
    source_database_path: databasePath,
    source_database_sha256: sha256(fs.readFileSync(databasePath)),
    verified_at: "2026-07-27T11:30:00.000Z",
    verified_by: "backup-verifier",
    restore_test_status: "PASS",
    integrity_check: "ok",
    foreign_key_check: "ok",
  });
  return evidencePath;
}

function applyEnv(overrides = {}) {
  return {
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    OPERATING_MODE: "HUMAN_REVIEW",
    AUTO_PUBLISH: "false",
    PULSE_EMERGENCY_KILL_SWITCH: "true",
    PULSE_CUTOVER_SCHEDULER_STOPPED: "true",
    PULSE_CUTOVER_WORKERS_STOPPED: "true",
    ...overrides,
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-review-"));
  const scriptSha256 = sha256(SCRIPT);
  const finalMp4 = fileRecord(root, "final.mp4", "reviewed-final-mp4");
  const narration = fileRecord(root, "narration.mp3", "licensed-narration");
  const motion = fileRecord(root, "motion.mp4", "owned-motion");
  const still = fileRecord(root, "hero.png", "owned-still");
  const timestampsPath = path.join(root, "timestamps.json");
  writeJson(timestampsPath, {
    schema_version: "pulse-word-timestamps-v1",
    story_id: STORY_ID,
    words: [
      { text: "Delta", start_seconds: 0, end_seconds: 0.3 },
      { text: "Force", start_seconds: 0.3, end_seconds: 0.6 },
    ],
  });
  const timestamps = {
    path: "timestamps.json",
    absolutePath: timestampsPath,
    sha256: sha256(fs.readFileSync(timestampsPath)),
  };

  const ownedMotionPath = path.join(root, "owned-motion-manifest.json");
  writeJson(ownedMotionPath, {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: STORY_ID,
    generated_at: NOW,
    assets: [
      {
        path: motion.path,
        sha256: motion.sha256,
        media_type: "video",
        role: "primary_motion",
        ownership: "owned",
        width: 1080,
        height: 1920,
        duration_seconds: 28,
      },
      {
        path: still.path,
        sha256: still.sha256,
        media_type: "image",
        role: "hero",
        ownership: "owned",
        width: 1080,
        height: 1920,
      },
    ],
  });
  const ownedMotion = {
    path: "owned-motion-manifest.json",
    absolutePath: ownedMotionPath,
    sha256: sha256(fs.readFileSync(ownedMotionPath)),
  };

  const sourcePath = path.join(root, "source-evidence.json");
  const officialClaim = "Thirty-day bans now qualify for compensation.";
  const officialClaimSha256 = sha256(officialClaim);
  writeJson(sourcePath, {
    schema_version: "pulse-source-evidence-v1",
    story_id: STORY_ID,
    source_url:
      "https://steamcommunity.com/games/2507950/announcements/detail/711155982681508947",
    source_type: "official",
    published_at: "2026-07-27T09:15:34.000Z",
    claims: [
      {
        claim_key: "compensation-window",
        text: officialClaim,
        claim_text_sha256: officialClaimSha256,
      },
    ],
    official_source_snapshot: {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url:
        "https://steamcommunity.com/games/2507950/announcements/detail/711155982681508947",
      source_id: "steam:2507950:711155982681508947",
      source_class: "OFFICIAL_FIRST_PARTY",
      canonical_body_algorithm: "pulse-readable-body-v1",
      canonical_body_sha256: sha256(`Official update: ${officialClaim}`),
      claims: [
        {
          claim_key: "compensation-window",
          text: officialClaim,
          claim_text_sha256: officialClaimSha256,
        },
      ],
    },
  });
  const source = {
    path: "source-evidence.json",
    sha256: sha256(fs.readFileSync(sourcePath)),
  };

  const transformationPath = path.join(root, "transformation.json");
  writeJson(transformationPath, {
    schema_version: "pulse-transformation-evidence-v1",
    story_id: STORY_ID,
    verdict: "STRONG",
    rationale:
      "Original narration, player-focused comparison, sequencing and owned motion materially transform the official facts.",
  });
  const transformation = {
    path: "transformation.json",
    sha256: sha256(fs.readFileSync(transformationPath)),
  };

  const motionRightsPath = path.join(root, "motion-rights.json");
  writeJson(motionRightsPath, {
    schema_version: "pulse-rights-evidence-v1",
    asset_sha256: motion.sha256,
    rights_basis: "OWNED",
    provenance: "repository_owned_generation",
  });
  const narrationRightsPath = path.join(root, "narration-rights.json");
  writeJson(narrationRightsPath, {
    schema_version: "pulse-rights-evidence-v1",
    asset_sha256: narration.sha256,
    rights_basis: "LICENSED",
    provenance: "operator_subscription_attestation",
  });
  const rightsLedger = {
    ledger_version: 1,
    decision: "CLEARED",
    story_id: STORY_ID,
    items: [
      {
        item_id: "owned-motion",
        source_url: `pulse-owned://${STORY_ID}/motion`,
        asset_path: motion.path,
        asset_sha256: motion.sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: "motion-rights.json",
          sha256: sha256(fs.readFileSync(motionRightsPath)),
        },
        attribution_decision: "NOT_REQUIRED",
      },
      {
        item_id: "narration",
        source_url: `pulse-licensed://${STORY_ID}/narration`,
        asset_path: narration.path,
        asset_sha256: narration.sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "LICENSED",
        rights_evidence: {
          reference: "narration-rights.json",
          sha256: sha256(fs.readFileSync(narrationRightsPath)),
        },
        attribution_decision: "NOT_REQUIRED",
      },
    ],
  };
  const rightsPath = path.join(root, "rights-ledger.json");
  writeJson(rightsPath, rightsLedger);
  const rights = {
    path: "rights-ledger.json",
    file_sha256: sha256(fs.readFileSync(rightsPath)),
    canonical_sha256: hashRightsLedger(rightsLedger),
  };

  const rendererInputs = [
    {
      component_id: "owned-motion",
      role: "motion",
      path: motion.path,
      sha256: motion.sha256,
      embedded_in_final: true,
    },
    {
      component_id: "narration",
      role: "narration",
      path: narration.path,
      sha256: narration.sha256,
      embedded_in_final: true,
    },
    {
      component_id: "word-timestamps",
      role: "word_timestamps",
      path: timestamps.path,
      sha256: timestamps.sha256,
      embedded_in_final: false,
    },
  ];
  const rendererManifest = {
    schema_version: "pulse-render-manifest-v1",
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    renderer: {
      id: "studio-v21",
      role: "standard",
      version: "2.1.0",
    },
    stack: { hyperframes: true, ffmpeg: true },
    output: {
      sha256: finalMp4.sha256,
      width: 1080,
      height: 1920,
      aspect_ratio: "9:16",
      video_codec: "h264",
      video_profile: "High",
      pixel_format: "yuv420p",
      audio_codec: "aac",
      audio_sample_rate_hz: 48000,
      has_audio: true,
      duration_seconds: 28,
      ffprobe_passed: true,
      platform_video_qa_result: "pass",
    },
    timing: {
      first_frame_exact_subject: true,
      hook_visible_by_ms: 200,
      consequence_by_ms: 1100,
      proof_by_ms: 2600,
    },
    motion: {
      scene_count: 6,
      motion_scene_count: 6,
      exact_subject_clip_count: 1,
      exact_subject_still_motion_count: 4,
      unrelated_filler_count: 0,
      every_scene_rights_accepted: true,
    },
    inputs: rendererInputs,
  };
  const rendererPath = path.join(root, "renderer-manifest.json");
  writeJson(rendererPath, rendererManifest);
  const renderer = {
    path: "renderer-manifest.json",
    file_sha256: sha256(fs.readFileSync(rendererPath)),
    canonical_sha256: fingerprintRendererManifest(rendererManifest),
  };

  const qaPath = path.join(root, "qa.json");
  writeJson(qaPath, {
    schema_version: "pulse-final-render-qa-v1",
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    verdict: "PASS",
    media_sha256: finalMp4.sha256,
    script_sha256: scriptSha256,
    renderer_manifest_sha256: renderer.canonical_sha256,
  });
  const qa = {
    path: "qa.json",
    sha256: sha256(fs.readFileSync(qaPath)),
  };

  const publicationMetadataPath = path.join(root, "publication-metadata.json");
  writeJson(publicationMetadataPath, {
    schema_version: METADATA_SCHEMA,
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    platform: "youtube_shorts",
    title: "Delta Force widens cheater compensation",
    description: "Delta Force has expanded cheater compensation eligibility.",
  });
  const publicationMetadata = {
    path: path.basename(publicationMetadataPath),
    absolutePath: publicationMetadataPath,
    sha256: sha256(fs.readFileSync(publicationMetadataPath)),
  };

  const reviewPath = path.join(root, "publication-review.json");
  const review = {
    schema_version: "pulse-governed-publication-review-v1",
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    script_sha256: scriptSha256,
    source_evidence: source,
    qa_report: qa,
    transformation_evidence: transformation,
    rights_ledger: rights,
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale:
        "The final edit contains synthetic narration and designed motion.",
      disclosure_text:
        "Includes AI-generated narration and synthetic visual elements.",
      youtube_field_value: true,
      reviewed_at: "2026-07-27T11:45:00.000Z",
    },
    renderer_manifest: renderer,
    final_mp4: {
      path: finalMp4.path,
      sha256: finalMp4.sha256,
    },
    narration_audio: {
      path: narration.path,
      sha256: narration.sha256,
      component_id: "narration",
    },
    word_timestamps: {
      path: timestamps.path,
      sha256: timestamps.sha256,
      component_id: "word-timestamps",
    },
    owned_motion_manifest: {
      path: ownedMotion.path,
      sha256: ownedMotion.sha256,
    },
    publication_metadata: {
      path: publicationMetadata.path,
      sha256: publicationMetadata.sha256,
      platform: "youtube_shorts",
    },
    policy: {
      source_media_policy: "OWNED_ONLY",
      third_party_media_used: false,
      attribution_required: false,
    },
    renderer_inputs: rendererInputs,
  };
  writeJson(reviewPath, review);
  return {
    root,
    review,
    reviewPath,
    rightsLedger,
    rightsPath,
    motionRightsPath,
    scriptSha256,
    source,
    finalMp4,
    narration,
    motion,
    publicationMetadata,
  };
}

function addLicensedSourceMedia(values) {
  const asset = fileRecord(
    values.root,
    "source-media/ffxiv-gameplay.png",
    TINY_PNG,
  );
  const rightsReviewPath = path.join(
    values.root,
    "source-media-rights-review.json",
  );
  writeJson(rightsReviewPath, {
    schema_version: "pulse-governed-rights-review-evidence-v1",
    story_id: STORY_ID,
    review_status: "ACCEPTED",
    rights_basis: "LICENSED",
    publisher: "Square Enix",
    licence_evidence_url: LICENCE_URL,
    licence_effective_date: "2026-05-07",
    reviewed_by: "pulse-editorial-rights-review",
    reviewed_at: NOW,
    scope:
      "Official FINAL FANTASY XIV gameplay used in a narrated, edited news report.",
    findings: {
      covered_materials: ["art", "images", "screenshots", "video"],
      permitted_destination:
        "YouTube and comparable social-network partner programmes",
      copyright_notice: ATTRIBUTION_TEXT,
      copyright_notice_delivery: ["DESCRIPTION", "ON_SCREEN"],
      third_party_music_used: false,
      source_audio_used: false,
      raw_asset_redistribution: false,
      removal_request_must_be_honoured: true,
    },
  });
  const rightsReviewSha = sha256(fs.readFileSync(rightsReviewPath));
  const sourceManifestPath = path.join(
    values.root,
    "source-media-manifest.json",
  );
  writeJson(sourceManifestPath, {
    schema_version: SOURCE_MEDIA_MANIFEST_SCHEMA,
    story_id: STORY_ID,
    generated_at: NOW,
    rights_review: {
      path: path.basename(rightsReviewPath),
      sha256: rightsReviewSha,
      review_status: "ACCEPTED",
    },
    components: [
      {
        component_id: "ffxiv-gameplay-01",
        media_type: "IMAGE",
        asset: {
          path: asset.path,
          sha256: asset.sha256,
          width: 1,
          height: 1,
          mime_type: "image/png",
        },
        source: {
          page_url: "https://eu.finalfantasyxiv.com/evercold/media/",
          direct_media_url:
            "https://lds-img.finalfantasyxiv.com/promo/h/a/test.png",
          publisher: "Square Enix",
        },
        rights_basis: "LICENSED",
        licence_evidence_url: LICENCE_URL,
        review_status: "ACCEPTED",
        attribution: {
          required: true,
          text: ATTRIBUTION_TEXT,
          delivery: ["ON_SCREEN", "DESCRIPTION"],
        },
        editorial: {
          purpose: "TRANSFORMATIVE_EDITORIAL",
          third_party_music_used: false,
          source_audio_disposition: "NOT_APPLICABLE",
          usage_seconds: [0, 2],
        },
      },
    ],
  });
  const sourceManifestSha = sha256(fs.readFileSync(sourceManifestPath));

  const publicationMetadata = JSON.parse(
    fs.readFileSync(values.publicationMetadata.absolutePath, "utf8"),
  );
  publicationMetadata.description = [
    publicationMetadata.description,
    "",
    ATTRIBUTION_TEXT,
  ].join("\n");
  writeJson(values.publicationMetadata.absolutePath, publicationMetadata);
  values.publicationMetadata.sha256 = sha256(
    fs.readFileSync(values.publicationMetadata.absolutePath),
  );
  values.review.publication_metadata.sha256 = values.publicationMetadata.sha256;

  const ownedMotionPath = path.join(
    values.root,
    values.review.owned_motion_manifest.path,
  );
  const ownedMotion = JSON.parse(fs.readFileSync(ownedMotionPath, "utf8"));
  const mixed = ownedMotion.assets.find(
    (component) => component.media_type === "video",
  );
  mixed.role = "hyperframes_intermediate";
  mixed.ownership = "mixed";
  mixed.rights_basis = "LICENSED";
  mixed.attribution_required = true;
  mixed.provenance = {
    third_party_media_used: true,
    source_media_manifest: {
      path: path.basename(sourceManifestPath),
      sha256: sourceManifestSha,
    },
  };
  for (const component of ownedMotion.assets.filter(
    (candidate) => candidate !== mixed,
  )) {
    component.rights_basis = "OWNED";
    component.attribution_required = false;
    component.provenance = {
      third_party_media_used: false,
    };
  }
  writeJson(ownedMotionPath, ownedMotion);
  values.review.owned_motion_manifest.sha256 = sha256(
    fs.readFileSync(ownedMotionPath),
  );

  const sourceInput = {
    component_id: "ffxiv-gameplay-01",
    role: "source_media",
    path: asset.path,
    sha256: asset.sha256,
    embedded_in_final: true,
  };
  const rendererPath = path.join(
    values.root,
    values.review.renderer_manifest.path,
  );
  const renderer = JSON.parse(fs.readFileSync(rendererPath, "utf8"));
  renderer.inputs.push(sourceInput);
  writeJson(rendererPath, renderer);
  values.review.renderer_manifest.file_sha256 = sha256(
    fs.readFileSync(rendererPath),
  );
  values.review.renderer_manifest.canonical_sha256 =
    fingerprintRendererManifest(renderer);
  values.review.renderer_inputs.push(sourceInput);

  const qaPath = path.join(values.root, values.review.qa_report.path);
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  qa.renderer_manifest_sha256 =
    values.review.renderer_manifest.canonical_sha256;
  writeJson(qaPath, qa);
  values.review.qa_report.sha256 = sha256(fs.readFileSync(qaPath));

  const sourceRightsPath = path.join(values.root, "source-media-rights.json");
  writeJson(sourceRightsPath, {
    schema_version: "pulse-rights-evidence-v1",
    story_id: STORY_ID,
    rights_basis: "LICENSED",
    rights_decision: "CLEARED",
    publisher: "Square Enix",
    attribution_required: true,
    attribution_text: ATTRIBUTION_TEXT,
    attribution_delivery: ["DESCRIPTION", "ON_SCREEN"],
    description_attribution_evidence: {
      publication_metadata: {
        path: values.review.publication_metadata.path,
        sha256: values.review.publication_metadata.sha256,
        platform: "youtube_shorts",
      },
      notice: ATTRIBUTION_TEXT,
      exact_standalone_line_verified: true,
    },
    third_party_media_used: true,
    licence: {
      evidence_url: LICENCE_URL,
      rights_review_path: path.basename(rightsReviewPath),
      rights_review_sha256: rightsReviewSha,
      review_status: "ACCEPTED",
    },
    manifest_binding: {
      path: path.basename(sourceManifestPath),
      sha256: sourceManifestSha,
    },
    components: [
      {
        component_id: "ffxiv-gameplay-01",
        asset_path: asset.path,
        asset_sha256: asset.sha256,
        direct_media_url:
          "https://lds-img.finalfantasyxiv.com/promo/h/a/test.png",
        rights_basis: "LICENSED",
        attribution_required: true,
        attribution_text: ATTRIBUTION_TEXT,
      },
    ],
  });
  const sourceRightsSha = sha256(fs.readFileSync(sourceRightsPath));
  const motionItem = values.rightsLedger.items.find(
    (item) => item.item_id === "owned-motion",
  );
  writeJson(values.motionRightsPath, {
    schema_version: "pulse-rights-evidence-v1",
    story_id: STORY_ID,
    component_id: "owned-motion",
    asset_path: values.motion.path,
    asset_sha256: values.motion.sha256,
    rights_basis: "LICENSED",
    rights_decision: "CLEARED",
    ownership: "mixed",
    attribution_required: true,
    attribution_text: ATTRIBUTION_TEXT,
    third_party_media_used: true,
    source_media_manifest_binding: {
      path: path.basename(sourceManifestPath),
      sha256: sourceManifestSha,
    },
  });
  motionItem.rights_basis = "LICENSED";
  motionItem.rights_evidence.sha256 = sha256(
    fs.readFileSync(values.motionRightsPath),
  );
  motionItem.attribution_decision = "REQUIRED_AND_SUPPLIED";
  motionItem.attribution_text = ATTRIBUTION_TEXT;
  values.rightsLedger.items.push({
    item_id: "ffxiv-gameplay-01",
    source_url: "https://lds-img.finalfantasyxiv.com/promo/h/a/test.png",
    asset_path: asset.path,
    asset_sha256: asset.sha256,
    included_in_final: true,
    rights_decision: "CLEARED",
    rights_basis: "LICENSED",
    rights_evidence: {
      reference: path.basename(sourceRightsPath),
      sha256: sourceRightsSha,
    },
    attribution_decision: "REQUIRED_AND_SUPPLIED",
    attribution_text: ATTRIBUTION_TEXT,
  });
  writeJson(values.rightsPath, values.rightsLedger);
  values.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(values.rightsPath),
  );
  values.review.rights_ledger.canonical_sha256 = hashRightsLedger(
    values.rightsLedger,
  );
  values.review.source_media_manifest = {
    path: path.basename(sourceManifestPath),
    sha256: sourceManifestSha,
  };
  values.review.policy = {
    source_media_policy: "LICENSED_OFFICIAL_FFXIV",
    third_party_media_used: true,
    attribution_required: true,
  };
  writeJson(values.reviewPath, values.review);
  return {
    ...values,
    sourceAsset: asset,
    sourceManifestPath,
    sourceManifestSha,
    sourceRightsPath,
  };
}

function jsonRecord(root, name, value) {
  const record = fileRecord(root, name, `${JSON.stringify(value, null, 2)}\n`);
  return {
    ...record,
    size_bytes: fs.statSync(record.absolutePath).size,
  };
}

function relativePath(fromDirectory, filePath) {
  return path.relative(fromDirectory, filePath).replace(/\\/g, "/");
}

function replaceLicensedSourceMediaWithGovernedSteamMedia(values) {
  const admitted = addLicensedSourceMedia(values);
  const assetId = "yazd-steam-screenshot-01";
  const attributionText = "Source: Steam / Awesome Games Studio";
  const steamPageUrl =
    "https://store.steampowered.com/app/674750/Yet_Another_Zombie_Defense_HD/";
  const steamMediaUrl =
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/674750/ss_c64f69ed658fac18ee8ac772783357b00b8928ed.1920x1080.jpg?t=1780089205";
  const rawAsset = fileRecord(
    admitted.root,
    "source-media/yazd-steam-source.jpg",
    "official-yazd-steam-screenshot-source",
  );
  const sourceEvidencePath = path.join(
    admitted.root,
    "source-media/yazd-source-evidence.json",
  );
  writeJson(sourceEvidencePath, {
    schema_version: "pulse-governed-game-media-source-evidence-v1",
    story_id: STORY_ID,
    asset_id: assetId,
    source_class: "OFFICIAL_STEAM_STOREFRONT_ASSET",
    media_kind: "OFFICIAL_SCREENSHOT",
    game: {
      title: "Yet Another Zombie Defense HD",
      publisher: "Awesome Games Studio",
    },
    publisher: "Awesome Games Studio",
    page_url: steamPageUrl,
    story_source_url: steamPageUrl,
    direct_media_url: steamMediaUrl,
    steam_app_id: "674750",
    official_domain_reviewed: true,
    source_asset_sha256: rawAsset.sha256,
    recorded_at: "2026-07-27T11:20:00.000Z",
  });
  const permissionEvidencePath = path.join(
    admitted.root,
    "source-media/yazd-permission-evidence.json",
  );
  writeJson(permissionEvidencePath, {
    schema_version: "pulse-governed-game-media-permission-evidence-v1",
    story_id: STORY_ID,
    asset_id: assetId,
    decision: "ADMITTED",
    review_status: "HUMAN_REVIEW",
    rights_basis: "TRANSFORMATIVE_EDITORIAL_USE",
    rights_holder: "Awesome Games Studio",
    permission_rule_id: "steam_storefront_transformative_editorial_risk_review",
    source_platform: "STEAM",
    reviewed_by: "pulse-editorial-rights-review",
    reviewed_at: "2026-07-27T11:25:00.000Z",
    coverage: {
      media_kinds: ["OFFICIAL_SCREENSHOT"],
      destinations: ["YOUTUBE_SHORTS"],
      uses: ["TRANSFORMATIVE_EDITORIAL"],
    },
    attribution: {
      required: true,
      text: attributionText,
      delivery: ["ON_SCREEN", "DESCRIPTION"],
    },
    attribution_is_permission: false,
    operator_risk_decision: {
      decision_type: "HUMAN_REVIEW",
      decision: "ACCEPT_RISK",
      story_id: STORY_ID,
      asset_id: assetId,
      destinations: ["YOUTUBE_SHORTS"],
      use: "TRANSFORMATIVE_EDITORIAL",
      rationale:
        "A short official-store excerpt identifies the exact game and is materially restructured around original reporting. This is an editorial risk decision, not permission or a legal guarantee.",
      reviewed_by: "pulse-editorial-rights-review",
      reviewed_at: "2026-07-27T11:25:00.000Z",
      automatic_clearance: false,
      attribution_is_permission: false,
      fair_use_guaranteed: false,
      source_page_is_licence: false,
    },
  });
  const transformationEvidencePath = path.join(
    admitted.root,
    "source-media/yazd-transformation-evidence.json",
  );
  writeJson(transformationEvidencePath, {
    schema_version: "pulse-governed-game-media-transformation-evidence-v1",
    story_id: STORY_ID,
    asset_id: assetId,
    source_asset_sha256: rawAsset.sha256,
    permission_evidence_sha256: sha256(fs.readFileSync(permissionEvidencePath)),
    materialised_asset_sha256: admitted.sourceAsset.sha256,
    purpose: "TRANSFORMATIVE_EDITORIAL",
    operations: ["CROP", "KEN_BURNS", "TEXT_OVERLAY"],
    source_audio_disposition: "NOT_APPLICABLE",
    usage_seconds: [0, 2],
    created_at: "2026-07-27T11:30:00.000Z",
  });
  writeJson(admitted.sourceManifestPath, {
    schema_version: "pulse-governed-game-media-admission-v1",
    policy: "GOVERNED_GAME_MEDIA_V1",
    story_id: STORY_ID,
    primary_source_url: steamPageUrl,
    generated_at: "2026-07-27T11:35:00.000Z",
    assets: [
      {
        asset_id: assetId,
        media_type: "IMAGE",
        media_kind: "OFFICIAL_SCREENSHOT",
        editorial_role: "GAMEPLAY_HERO",
        source: {
          evidence_path: path.relative(
            path.dirname(admitted.sourceManifestPath),
            sourceEvidencePath,
          ),
          evidence_sha256: sha256(fs.readFileSync(sourceEvidencePath)),
          asset_path: path.relative(
            path.dirname(admitted.sourceManifestPath),
            rawAsset.absolutePath,
          ),
          asset_sha256: rawAsset.sha256,
        },
        permission: {
          evidence_path: path.relative(
            path.dirname(admitted.sourceManifestPath),
            permissionEvidencePath,
          ),
          evidence_sha256: sha256(fs.readFileSync(permissionEvidencePath)),
        },
        transformation: {
          evidence_path: path.relative(
            path.dirname(admitted.sourceManifestPath),
            transformationEvidencePath,
          ),
          evidence_sha256: sha256(fs.readFileSync(transformationEvidencePath)),
        },
        materialised: {
          path: path.relative(
            path.dirname(admitted.sourceManifestPath),
            admitted.sourceAsset.absolutePath,
          ),
          sha256: admitted.sourceAsset.sha256,
        },
      },
    ],
  });
  admitted.sourceManifestSha = sha256(
    fs.readFileSync(admitted.sourceManifestPath),
  );
  admitted.review.source_media_manifest.sha256 = admitted.sourceManifestSha;

  const metadata = JSON.parse(
    fs.readFileSync(admitted.publicationMetadata.absolutePath, "utf8"),
  );
  metadata.description = metadata.description.replace(
    ATTRIBUTION_TEXT,
    attributionText,
  );
  writeJson(admitted.publicationMetadata.absolutePath, metadata);
  admitted.publicationMetadata.sha256 = sha256(
    fs.readFileSync(admitted.publicationMetadata.absolutePath),
  );
  admitted.review.publication_metadata.sha256 =
    admitted.publicationMetadata.sha256;

  const ownedMotionPath = path.join(
    admitted.root,
    admitted.review.owned_motion_manifest.path,
  );
  const ownedMotion = JSON.parse(fs.readFileSync(ownedMotionPath, "utf8"));
  ownedMotion.assets.find(
    (asset) => asset.role === "hyperframes_intermediate",
  ).provenance.source_media_manifest.sha256 = admitted.sourceManifestSha;
  writeJson(ownedMotionPath, ownedMotion);
  admitted.review.owned_motion_manifest.sha256 = sha256(
    fs.readFileSync(ownedMotionPath),
  );

  const rendererPath = path.join(
    admitted.root,
    admitted.review.renderer_manifest.path,
  );
  const renderer = JSON.parse(fs.readFileSync(rendererPath, "utf8"));
  renderer.inputs.find((input) => input.role === "source_media").component_id =
    assetId;
  writeJson(rendererPath, renderer);
  admitted.review.renderer_manifest.file_sha256 = sha256(
    fs.readFileSync(rendererPath),
  );
  admitted.review.renderer_manifest.canonical_sha256 =
    fingerprintRendererManifest(renderer);
  admitted.review.renderer_inputs.find(
    (input) => input.role === "source_media",
  ).component_id = assetId;
  const qaPath = path.join(admitted.root, admitted.review.qa_report.path);
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  qa.renderer_manifest_sha256 =
    admitted.review.renderer_manifest.canonical_sha256;
  writeJson(qaPath, qa);
  admitted.review.qa_report.sha256 = sha256(fs.readFileSync(qaPath));

  const motionEvidence = JSON.parse(
    fs.readFileSync(admitted.motionRightsPath, "utf8"),
  );
  motionEvidence.attribution_text = attributionText;
  motionEvidence.source_media_manifest_binding.sha256 =
    admitted.sourceManifestSha;
  writeJson(admitted.motionRightsPath, motionEvidence);
  const motionItem = admitted.rightsLedger.items.find(
    (item) => item.item_id === "owned-motion",
  );
  motionItem.rights_evidence.sha256 = sha256(
    fs.readFileSync(admitted.motionRightsPath),
  );
  motionItem.attribution_text = attributionText;

  writeJson(admitted.sourceRightsPath, {
    schema_version: "pulse-rights-evidence-v1",
    story_id: STORY_ID,
    rights_basis: "PER_ASSET_GOVERNED",
    rights_decision: "CLEARED",
    publisher: "Awesome Games Studio",
    attribution_required: true,
    attribution_text: attributionText,
    attribution_delivery: ["DESCRIPTION", "ON_SCREEN"],
    description_attribution_evidence: {
      publication_metadata: {
        path: admitted.review.publication_metadata.path,
        sha256: admitted.review.publication_metadata.sha256,
        platform: "youtube_shorts",
      },
      notice: attributionText,
      exact_standalone_line_verified: true,
    },
    third_party_media_used: true,
    licence: {
      evidence_url: null,
      rights_review_path: path.basename(admitted.sourceManifestPath),
      rights_review_sha256: admitted.sourceManifestSha,
      review_status: "ACCEPTED",
    },
    manifest_binding: {
      path: path.basename(admitted.sourceManifestPath),
      sha256: admitted.sourceManifestSha,
    },
    components: [
      {
        component_id: assetId,
        asset_path: admitted.sourceAsset.path,
        asset_sha256: admitted.sourceAsset.sha256,
        source_page_url: steamPageUrl,
        direct_media_url: steamMediaUrl,
        rights_basis: "TRANSFORMATIVE_EDITORIAL_USE",
        attribution_required: true,
        attribution_text: attributionText,
      },
    ],
  });
  const sourceItem = admitted.rightsLedger.items.find(
    (item) => item.item_id === "ffxiv-gameplay-01",
  );
  sourceItem.item_id = assetId;
  sourceItem.source_url = steamMediaUrl;
  sourceItem.rights_basis = "TRANSFORMATIVE_EDITORIAL_USE";
  sourceItem.rights_evidence.sha256 = sha256(
    fs.readFileSync(admitted.sourceRightsPath),
  );
  sourceItem.attribution_text = attributionText;
  writeJson(admitted.rightsPath, admitted.rightsLedger);
  admitted.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(admitted.rightsPath),
  );
  admitted.review.rights_ledger.canonical_sha256 = hashRightsLedger(
    admitted.rightsLedger,
  );
  admitted.review.policy.source_media_policy = "GOVERNED_GAME_MEDIA_V1";
  writeJson(admitted.reviewPath, admitted.review);
  return {
    ...admitted,
    attributionText,
    sourceAssetId: assetId,
  };
}

function addGovernedLicensedAudio(
  values,
  {
    targetDurationSeconds = 36.48,
    durationBandId = "what_changes_breaking_high_cadence_35_42",
  } = {},
) {
  const reviewDueAt = "2026-08-03T11:40:00.000Z";
  const youtubeAccountUri = "https://www.youtube.com/@PulseGMG";
  const licenceEvidenceUrl =
    "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting";
  const normalisedTimestampsPath = path.join(
    values.root,
    values.review.word_timestamps.path,
  );
  const sourceTimestamps = jsonRecord(
    values.root,
    "narration-source-timestamps.json",
    JSON.parse(fs.readFileSync(normalisedTimestampsPath, "utf8")),
  );
  const normalisedTimestamps = JSON.parse(
    fs.readFileSync(normalisedTimestampsPath, "utf8"),
  );
  normalisedTimestamps.source = {
    path: relativePath(
      path.dirname(normalisedTimestampsPath),
      sourceTimestamps.absolutePath,
    ),
    sha256: sourceTimestamps.sha256,
  };
  writeJson(normalisedTimestampsPath, normalisedTimestamps);
  const normalisedTimestampsSha256 = sha256(
    fs.readFileSync(normalisedTimestampsPath),
  );
  values.review.word_timestamps.sha256 = normalisedTimestampsSha256;
  const reviewTimestampInput = values.review.renderer_inputs.find(
    (input) => input.role === "word_timestamps",
  );
  reviewTimestampInput.sha256 = normalisedTimestampsSha256;
  const candidate = jsonRecord(
    values.root,
    "licensed-audio/canonical-story-manifest.json",
    {
      schema_version: "pulse-canonical-story-manifest-v1",
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
      story: { id: STORY_ID },
    },
  );
  const assets = [
    {
      asset_id: "epidemic-bed",
      asset_type: "music_bed",
      ledger_role: "bed_primary",
      source_role: "MUSIC_BED",
      renderer_role: "music",
      provider_asset_reference: "epidemic-sound://music/gaining-season",
      file: fileRecord(
        values.root,
        "licensed-audio/assets/bed.mp3",
        "licensed-epidemic-bed",
      ),
    },
    {
      asset_id: "epidemic-sting",
      asset_type: "music_sting",
      ledger_role: "sting_verified",
      source_role: "MUSIC_STING",
      renderer_role: "sfx",
      provider_asset_reference: "epidemic-sound://music/gaining-season-sting",
      file: fileRecord(
        values.root,
        "licensed-audio/assets/sting.wav",
        "licensed-epidemic-sting",
      ),
    },
    {
      asset_id: "epidemic-impact",
      asset_type: "sfx",
      ledger_role: "impact",
      source_role: "SFX_IMPACT",
      renderer_role: "sfx",
      provider_asset_reference: "epidemic-sound://sfx/cinematic-impact",
      file: fileRecord(
        values.root,
        "licensed-audio/assets/impact.wav",
        "licensed-epidemic-impact",
      ),
    },
  ].map((asset) => ({
    ...asset,
    size_bytes: fs.statSync(asset.file.absolutePath).size,
  }));
  const safelist = jsonRecord(
    values.root,
    "licensed-audio/rights/safelist.json",
    {
      schema_version: "pulse-epidemic-safelist-evidence-v1",
      provider_id: "epidemic_sound",
      channel_id: CHANNEL_ID,
      destination: {
        platform: "YOUTUBE",
        surface: "SHORTS",
        account_uri: youtubeAccountUri,
      },
      active_subscription: true,
      channel_safelisted: true,
      attested_by: "channel-owner",
      attested_at: "2026-07-27T11:40:00.000Z",
      review_due_at: reviewDueAt,
    },
  );
  for (const asset of assets) {
    asset.rightsEvidence = jsonRecord(
      values.root,
      `licensed-audio/rights/${asset.asset_id}.json`,
      {
        schema_version: "pulse-governed-licensed-audio-rights-evidence-v1",
        story_id: STORY_ID,
        asset_id: asset.asset_id,
        asset_sha256: asset.file.sha256,
        asset_size_bytes: asset.size_bytes,
        provider_id: "epidemic_sound",
        provider_asset_reference: asset.provider_asset_reference,
        licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
        licence_evidence_url: licenceEvidenceUrl,
        allowed_destinations: ["YOUTUBE_SHORTS"],
        allowed_revenue_modes: ["ORGANIC", "PLATFORM_ADVERTISING"],
        raw_redistribution_allowed: false,
        approval_status: "approved_for_commercial_editorial_use",
        rights_verdict: "GREEN",
        safelist_evidence_sha256: safelist.sha256,
        reviewed_by: "pulse-editorial-rights-review",
        reviewed_at: "2026-07-27T11:40:00.000Z",
        review_due_at: reviewDueAt,
      },
    );
    asset.rightsRecord = {
      asset_id: asset.asset_id,
      asset_type: asset.asset_type,
      role: asset.ledger_role,
      provider_id: "epidemic_sound",
      provider_asset_reference: asset.provider_asset_reference,
      local_asset_path: relativePath(
        path.join(values.root, "licensed-audio"),
        asset.file.absolutePath,
      ),
      licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
      licence_evidence_url: licenceEvidenceUrl,
      allowed_platforms: ["youtube_shorts"],
      allowed_revenue_modes: ["organic", "platform_advertising"],
      commercial_use_allowed: true,
      raw_redistribution_allowed: false,
      approval_status: "approved_for_commercial_editorial_use",
      rights_verdict: "GREEN",
      live_publish_allowed: true,
      requires_human_legal_review_before_publish: false,
      asset_sha256: asset.file.sha256,
      asset_size_bytes: asset.size_bytes,
      rights_evidence_sha256: asset.rightsEvidence.sha256,
      safelist_evidence_sha256: safelist.sha256,
    };
  }
  const audioRightsLedger = jsonRecord(
    values.root,
    "licensed-audio/rights-ledger.json",
    {
      schema_version: "pulse-governed-licensed-audio-rights-ledger-v1",
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
      generated_at: "2026-07-27T11:40:00.000Z",
      review_due_at: reviewDueAt,
      records: assets.map((asset) => asset.rightsRecord),
    },
  );
  const pack = jsonRecord(values.root, "licensed-audio/governed-pack.json", {
    schema_version: "pulse-governed-licensed-audio-pack-v1",
    policy: "EPIDEMIC_SOUND_LICENSED_PACK_V1",
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    generated_at: "2026-07-27T11:40:00.000Z",
    candidate_manifest: {
      path: relativePath(
        path.dirname(
          path.join(values.root, "licensed-audio/governed-pack.json"),
        ),
        candidate.absolutePath,
      ),
      sha256: candidate.sha256,
    },
    rights_ledger: {
      path: relativePath(
        path.dirname(
          path.join(values.root, "licensed-audio/governed-pack.json"),
        ),
        audioRightsLedger.absolutePath,
      ),
      sha256: audioRightsLedger.sha256,
    },
    provider: {
      id: "epidemic_sound",
      licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
      licence_evidence_url: licenceEvidenceUrl,
      safelist_evidence: {
        path: relativePath(
          path.dirname(
            path.join(values.root, "licensed-audio/governed-pack.json"),
          ),
          safelist.absolutePath,
        ),
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
      narration_sha256: values.narration.sha256,
      timestamps_sha256: sourceTimestamps.sha256,
      target_duration_seconds: targetDurationSeconds,
    },
    assets: assets.map((asset) => ({
      asset_id: asset.asset_id,
      role: asset.source_role,
      provider_asset_reference: asset.provider_asset_reference,
      local_asset: {
        path: relativePath(
          path.dirname(
            path.join(values.root, "licensed-audio/governed-pack.json"),
          ),
          asset.file.absolutePath,
        ),
        sha256: asset.file.sha256,
        size_bytes: asset.size_bytes,
      },
      rights_record_sha256: fingerprintRightsRecord(asset.rightsRecord),
      rights_evidence: {
        path: relativePath(
          path.dirname(
            path.join(values.root, "licensed-audio/governed-pack.json"),
          ),
          asset.rightsEvidence.absolutePath,
        ),
        sha256: asset.rightsEvidence.sha256,
      },
      embedded_in_final: true,
    })),
    mix: {
      policy_version: "epidemic_sidechain_ducked_bed_v1",
      narration_included: false,
      target_duration_seconds: targetDurationSeconds,
      bed: {
        asset_id: assets[0].asset_id,
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
      micro_drop_windows: [],
      cues: [
        {
          asset_id: assets[1].asset_id,
          at_seconds: 0,
          volume: 0.035,
          trim_start_seconds: 0,
          duration_seconds: 0.62,
          fade_in_seconds: 0,
          fade_out_seconds: 0.16,
        },
        {
          asset_id: assets[2].asset_id,
          at_seconds: 0.35,
          volume: 0.055,
          trim_start_seconds: 0,
          duration_seconds: 0.32,
          fade_in_seconds: 0,
          fade_out_seconds: 0.08,
        },
      ],
    },
  });
  const storyIntake = jsonRecord(values.root, "story-intake.json", {
    schema_version: "pulse-governed-story-intake-v1",
    source_url:
      "https://steamcommunity.com/games/2507950/announcements/detail/711155982681508947",
    source_type: "official",
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: durationBandId,
      target_duration_seconds: targetDurationSeconds,
      target_duration_review: {
        status: "APPROVED",
        target_duration_seconds: targetDurationSeconds,
        script_sha256: values.scriptSha256,
        reviewed_by: "pulse-editorial-operator",
        reviewed_at: "2026-07-27T11:35:00.000Z",
      },
    },
    story: {
      id: STORY_ID,
      channel_id: CHANNEL_ID,
      full_script: SCRIPT,
      script_sha256: values.scriptSha256,
    },
  });
  const validated = validateGovernedLicensedAudioPack({
    manifestPath: pack.absolutePath,
    expectedManifestSha256: pack.sha256,
    expectedStoryId: STORY_ID,
    expectedChannelId: CHANNEL_ID,
    expectedNarrationSha256: values.narration.sha256,
    expectedTimestampsSha256: sourceTimestamps.sha256,
    expectedTargetDurationSeconds: targetDurationSeconds,
    expectedRightsLedgerSha256: audioRightsLedger.sha256,
    expectedYoutubeAccountUri: youtubeAccountUri,
    requiredDestination: "YOUTUBE_SHORTS",
    requiredRevenueMode: "PLATFORM_ADVERTISING",
    validationBoundaryAt: NOW,
  });

  const rendererPath = path.join(
    values.root,
    values.review.renderer_manifest.path,
  );
  const renderer = JSON.parse(fs.readFileSync(rendererPath, "utf8"));
  renderer.output.duration_seconds = targetDurationSeconds;
  renderer.inputs.find((input) => input.role === "word_timestamps").sha256 =
    normalisedTimestampsSha256;
  const audioInputs = assets.map((asset) => ({
    component_id: asset.asset_id,
    role: asset.renderer_role,
    path: asset.file.path,
    sha256: asset.file.sha256,
    embedded_in_final: true,
  }));
  renderer.inputs.push(...audioInputs);
  writeJson(rendererPath, renderer);
  values.review.renderer_manifest.file_sha256 = sha256(
    fs.readFileSync(rendererPath),
  );
  values.review.renderer_manifest.canonical_sha256 =
    fingerprintRendererManifest(renderer);
  values.review.renderer_inputs.push(...audioInputs);
  const qaPath = path.join(values.root, values.review.qa_report.path);
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  qa.renderer_manifest_sha256 =
    values.review.renderer_manifest.canonical_sha256;
  writeJson(qaPath, qa);
  values.review.qa_report.sha256 = sha256(fs.readFileSync(qaPath));

  for (const asset of assets) {
    values.rightsLedger.items.push({
      item_id: asset.asset_id,
      source_url: asset.provider_asset_reference,
      asset_path: asset.file.path,
      asset_sha256: asset.file.sha256,
      included_in_final: true,
      rights_decision: "CLEARED",
      rights_basis: "LICENSED",
      rights_evidence: {
        reference: asset.rightsEvidence.path,
        sha256: asset.rightsEvidence.sha256,
      },
      attribution_decision: "NOT_REQUIRED",
      attribution_text: null,
    });
  }
  writeJson(values.rightsPath, values.rightsLedger);
  values.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(values.rightsPath),
  );
  values.review.rights_ledger.canonical_sha256 = hashRightsLedger(
    values.rightsLedger,
  );
  values.review.story_intake = {
    path: storyIntake.path,
    sha256: storyIntake.sha256,
  };
  values.review.licensed_audio = {
    policy: validated.policy,
    manifest: {
      path: pack.path,
      sha256: pack.sha256,
    },
    rights_ledger: {
      path: audioRightsLedger.path,
      sha256: audioRightsLedger.sha256,
    },
    provider: validated.provider,
    scope: validated.scope,
    render_binding: validated.render_binding,
    mix: validated.mix,
    assets: validated.assets.map((asset) => ({
      asset_id: asset.asset_id,
      source_role: asset.role,
      renderer_role: asset.role === "MUSIC_BED" ? "music" : "sfx",
      path: relativePath(values.root, asset.path),
      sha256: asset.sha256,
      size_bytes: asset.size_bytes,
      provider_asset_reference: asset.provider_asset_reference,
      rights_record_sha256: asset.rights_record_sha256,
      rights_evidence: {
        path: relativePath(values.root, asset.rights_evidence_path),
        sha256: asset.rights_evidence_sha256,
      },
      embedded_in_final: true,
    })),
  };
  writeJson(values.reviewPath, values.review);
  return {
    ...values,
    audioAssets: assets,
    audioPack: pack,
    audioRightsLedger,
    sourceTimestamps,
    normalisedTimestampsSha256,
    storyIntake,
    targetDurationSeconds,
    youtubeAccountUri,
  };
}

test("dry-run validates a complete review package and builds scheduler evidence", async () => {
  const values = fixture();
  const result = await executeGovernedPublicationReview({
    manifestPath: values.reviewPath,
    generatedAt: NOW,
    probe: async () => validProbe(),
  });

  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.verdict, "VALID");
  assert.equal(result.mutated, false);
  assert.equal(result.story_id, STORY_ID);
  assert.equal(result.media_sha256, values.finalMp4.sha256);
  assert.equal(
    result.preflight_evidence.renderer_manifest.output.sha256,
    values.finalMp4.sha256,
  );
  assert.equal(
    result.preflight_evidence.publication_metadata_sha256,
    values.publicationMetadata.sha256,
  );
  assert.equal(
    result.preflight_evidence.official_source_release_binding
      .source_evidence_sha256,
    values.source.sha256,
  );
  assert.equal(
    result.preflight_evidence.official_source_release_binding.story_id,
    STORY_ID,
  );
  assert.deepEqual(result.preflight_evidence.publication_metadata, {
    path: values.publicationMetadata.absolutePath,
    sha256: values.publicationMetadata.sha256,
    platform: "youtube_shorts",
    title: "Delta Force widens cheater compensation",
    description: "Delta Force has expanded cheater compensation eligibility.",
  });
  assert.deepEqual(result.preflight_evidence.artifact_evidence, {
    final_mp4_exists: true,
    narration_audio_exists: true,
    word_timestamps_exist: true,
    motion_materialised: true,
    hashes_verified: true,
  });
  const report = buildNextPublishCandidatesReport({
    snapshot: {
      schema_version: "pulse-preflight-snapshot-v1",
      source: { kind: "test", read_only: true, errors: [] },
      stories: [
        {
          id: STORY_ID,
          title: "Delta Force widens cheater compensation",
          channel_id: CHANNEL_ID,
          approved: true,
          auto_approved: false,
          full_script: SCRIPT,
          exported_path: values.finalMp4.absolutePath,
          render_review_status: "approved",
        },
      ],
      evidence_by_story: {
        [STORY_ID]: result.preflight_evidence,
      },
      platform_posts: [],
      schedules: [],
      jobs: [],
      runtime_leases: [],
      dispatch_ledger: [],
    },
    env: {
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      AUTO_PUBLISH: "false",
    },
    generatedAt: NOW,
    sourceCommitSha: "a".repeat(40),
    runtimeCommitSha: "a".repeat(40),
  });
  assert.equal(report.candidates[0].preflight_verdict, "PASS");
});

test("review rejects legacy official evidence without the exact release snapshot", async () => {
  const values = fixture();
  const sourcePath = path.join(values.root, values.source.path);
  const sourceEvidence = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  delete sourceEvidence.official_source_snapshot;
  writeJson(sourcePath, sourceEvidence);
  values.review.source_evidence.sha256 = sha256(fs.readFileSync(sourcePath));
  writeJson(values.reviewPath, values.review);

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(error.codes.includes("official_source_snapshot_required"));
      return true;
    },
  );
});

test("dry-run accepts an exact governed licensed-audio pack at its intake-reviewed duration", async () => {
  const values = addGovernedLicensedAudio(fixture());
  assert.notEqual(
    values.sourceTimestamps.sha256,
    values.normalisedTimestampsSha256,
  );
  const result = await executeGovernedPublicationReview({
    manifestPath: values.reviewPath,
    generatedAt: NOW,
    expectedYoutubeAccountUri: values.youtubeAccountUri,
    probe: async () => validProbe(values.targetDurationSeconds),
  });

  assert.equal(result.verdict, "VALID");
  assert.equal(
    result.preflight_evidence.licensed_audio.manifest.sha256,
    values.audioPack.sha256,
  );
  assert.equal(
    result.preflight_evidence.licensed_audio.rights_ledger.sha256,
    values.audioRightsLedger.sha256,
  );
  assert.equal(
    result.preflight_evidence.licensed_audio.render_binding
      .target_duration_seconds,
    values.targetDurationSeconds,
  );
  assert.equal(
    result.preflight_evidence.licensed_audio.render_binding.timestamps_sha256,
    values.sourceTimestamps.sha256,
  );
  assert.equal(
    result.preflight_evidence.renderer_manifest.output.duration_seconds,
    values.targetDurationSeconds,
  );
});

test("review keeps music and SFX forbidden when governed licensed-audio evidence is absent", async () => {
  const values = addGovernedLicensedAudio(fixture());
  delete values.review.licensed_audio;
  delete values.review.story_intake;
  const rendererPath = path.join(
    values.root,
    values.review.renderer_manifest.path,
  );
  const renderer = JSON.parse(fs.readFileSync(rendererPath, "utf8"));
  renderer.output.duration_seconds = 28;
  writeJson(rendererPath, renderer);
  values.review.renderer_manifest.file_sha256 = sha256(
    fs.readFileSync(rendererPath),
  );
  values.review.renderer_manifest.canonical_sha256 =
    fingerprintRendererManifest(renderer);
  const qaPath = path.join(values.root, values.review.qa_report.path);
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  qa.renderer_manifest_sha256 =
    values.review.renderer_manifest.canonical_sha256;
  writeJson(qaPath, qa);
  values.review.qa_report.sha256 = sha256(fs.readFileSync(qaPath));
  writeJson(values.reviewPath, values.review);

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "licensed_audio_evidence_required_for_music_or_sfx",
        ),
      );
      return true;
    },
  );
});

test("licensed-audio review requires the probed final duration to match the pack exactly", async () => {
  const values = addGovernedLicensedAudio(fixture());

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      expectedYoutubeAccountUri: values.youtubeAccountUri,
      probe: async () => validProbe(values.targetDurationSeconds - 0.01),
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "final_mp4_duration_must_match_licensed_audio_pack",
        ),
      );
      return true;
    },
  );
});

test("licensed-audio target must remain inside the intake named duration band", async () => {
  const values = addGovernedLicensedAudio(fixture(), {
    targetDurationSeconds: 34,
  });

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      expectedYoutubeAccountUri: values.youtubeAccountUri,
      probe: async () => validProbe(values.targetDurationSeconds),
    }),
    (error) => {
      assert.ok(
        error.codes.includes("licensed_audio_story_target_outside_named_band"),
      );
      return true;
    },
  );
});

test("licensed-audio review never expands a YouTube Short beyond 59 seconds", async () => {
  const values = addGovernedLicensedAudio(fixture());
  const intake = JSON.parse(
    fs.readFileSync(values.storyIntake.absolutePath, "utf8"),
  );
  intake.contract.editorial_lane_id = "weekly_occasional_recap";
  intake.contract.duration_band_id = "governed_explainer_240_480";
  intake.contract.target_duration_seconds = 240;
  intake.contract.target_duration_review.target_duration_seconds = 240;
  writeJson(values.storyIntake.absolutePath, intake);
  values.review.story_intake.sha256 = sha256(
    fs.readFileSync(values.storyIntake.absolutePath),
  );
  writeJson(values.reviewPath, values.review);

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      expectedYoutubeAccountUri: values.youtubeAccountUri,
      probe: async () => validProbe(240),
    }),
    (error) => {
      assert.ok(
        error.codes.includes("licensed_audio_story_target_exceeds_short_limit"),
      );
      return true;
    },
  );
});

test("licensed-audio review evidence must retain the exact pack render binding", async () => {
  const values = addGovernedLicensedAudio(fixture());
  values.review.licensed_audio.render_binding.target_duration_seconds =
    values.targetDurationSeconds - 0.01;
  writeJson(values.reviewPath, values.review);

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      expectedYoutubeAccountUri: values.youtubeAccountUri,
      probe: async () => validProbe(values.targetDurationSeconds),
    }),
    (error) => {
      assert.ok(
        error.codes.includes("licensed_audio_review_evidence_mismatch"),
      );
      return true;
    },
  );
});

test("every music and SFX ledger item must bind to its exact licensed provider asset", async () => {
  const values = addGovernedLicensedAudio(fixture());
  const item = values.rightsLedger.items.find(
    (candidate) => candidate.item_id === values.audioAssets[0].asset_id,
  );
  item.source_url = "epidemic-sound://music/a-different-provider-asset";
  writeJson(values.rightsPath, values.rightsLedger);
  values.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(values.rightsPath),
  );
  values.review.rights_ledger.canonical_sha256 = hashRightsLedger(
    values.rightsLedger,
  );
  writeJson(values.reviewPath, values.review);

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      expectedYoutubeAccountUri: values.youtubeAccountUri,
      probe: async () => validProbe(values.targetDurationSeconds),
    }),
    (error) => {
      assert.ok(
        error.codes.includes("licensed_audio_rights_ledger_item_invalid"),
      );
      return true;
    },
  );
});

test("licensed-audio review fails closed unless the caller names the trusted Pulse YouTube account", async () => {
  for (const expectedYoutubeAccountUri of [
    undefined,
    "https://www.youtube.com/@DifferentChannel",
  ]) {
    const values = addGovernedLicensedAudio(fixture());
    await assert.rejects(
      executeGovernedPublicationReview({
        manifestPath: values.reviewPath,
        generatedAt: NOW,
        expectedYoutubeAccountUri,
        probe: async () => validProbe(values.targetDurationSeconds),
      }),
      (error) => {
        assert.ok(
          error.codes.includes("licensed_audio_youtube_account_uri_invalid"),
        );
        return true;
      },
    );
  }
});

test("review requires an explicit owned-only or licensed source-media policy", async () => {
  const missingPolicy = fixture();
  delete missingPolicy.review.policy;
  writeJson(missingPolicy.reviewPath, missingPolicy.review);
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: missingPolicy.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes("publication_review_source_media_policy_invalid"),
      );
      return true;
    },
  );

  const missingLicensedManifest = fixture();
  missingLicensedManifest.review.policy = {
    source_media_policy: "LICENSED_OFFICIAL_FFXIV",
    third_party_media_used: true,
    attribution_required: true,
  };
  writeJson(missingLicensedManifest.reviewPath, missingLicensedManifest.review);
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: missingLicensedManifest.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "publication_review_source_media_manifest_required",
        ),
      );
      assert.ok(
        error.codes.includes(
          "publication_review_source_media_manifest_path_required",
        ),
      );
      assert.ok(
        error.codes.includes(
          "publication_review_source_media_manifest_sha256_required",
        ),
      );
      return true;
    },
  );
});

test("review reloads mandatory publication metadata and rejects omission or byte tampering", async () => {
  const missing = fixture();
  delete missing.review.publication_metadata;
  writeJson(missing.reviewPath, missing.review);
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: missing.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(error.codes.includes("publication_metadata_path_required"));
      assert.ok(error.codes.includes("publication_metadata_sha256_required"));
      return true;
    },
  );

  const tampered = fixture();
  fs.appendFileSync(tampered.publicationMetadata.absolutePath, " ", "utf8");
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: tampered.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(error.codes.includes("publication_metadata_sha256_mismatch"));
      return true;
    },
  );
});

test("review rejects licensed media when the independently bound publication description omits the exact copyright notice", async () => {
  const values = addLicensedSourceMedia(fixture());
  const metadata = JSON.parse(
    fs.readFileSync(values.publicationMetadata.absolutePath, "utf8"),
  );
  metadata.description =
    "Delta Force has expanded cheater compensation eligibility.";
  writeJson(values.publicationMetadata.absolutePath, metadata);
  values.review.publication_metadata.sha256 = sha256(
    fs.readFileSync(values.publicationMetadata.absolutePath),
  );
  writeJson(values.reviewPath, values.review);

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "publication_metadata_description_attribution_missing",
        ),
      );
      return true;
    },
  );
});

test("dry-run validates exact licensed source-media inputs and required Square Enix attribution", async () => {
  const values = addLicensedSourceMedia(fixture());
  const result = await executeGovernedPublicationReview({
    manifestPath: values.reviewPath,
    generatedAt: NOW,
    probe: async () => validProbe(),
  });

  assert.equal(result.verdict, "VALID");
  assert.equal(
    result.preflight_evidence.source_media_manifest_sha256,
    values.sourceManifestSha,
  );
  assert.equal(
    result.preflight_evidence.artifact_evidence.hashes_verified,
    true,
  );
});

test("dry-run validates governed Steam media with its exact per-asset rights and attribution", async () => {
  const values = replaceLicensedSourceMediaWithGovernedSteamMedia(fixture());
  const result = await executeGovernedPublicationReview({
    manifestPath: values.reviewPath,
    generatedAt: NOW,
    probe: async () => validProbe(),
  });

  assert.equal(result.verdict, "VALID");
  assert.equal(
    result.preflight_evidence.policy.source_media_policy,
    "GOVERNED_GAME_MEDIA_V1",
  );
  const sourceItem = result.preflight_evidence.rights_ledger.items.find(
    (item) => item.item_id === values.sourceAssetId,
  );
  assert.equal(sourceItem.rights_basis, "TRANSFORMATIVE_EDITORIAL_USE");
  assert.equal(sourceItem.attribution_text, values.attributionText);
  assert.doesNotMatch(
    JSON.stringify(result.preflight_evidence),
    /Square Enix|SQUARE ENIX/,
  );
});

test("review rejects licensed source media omitted from renderer coverage or missing exact attribution", async () => {
  const missingRendererInput = addLicensedSourceMedia(fixture());
  const rendererPath = path.join(
    missingRendererInput.root,
    missingRendererInput.review.renderer_manifest.path,
  );
  const renderer = JSON.parse(fs.readFileSync(rendererPath, "utf8"));
  renderer.inputs = renderer.inputs.filter(
    (input) => input.role !== "source_media",
  );
  writeJson(rendererPath, renderer);
  missingRendererInput.review.renderer_inputs =
    missingRendererInput.review.renderer_inputs.filter(
      (input) => input.role !== "source_media",
    );
  missingRendererInput.review.renderer_manifest.file_sha256 = sha256(
    fs.readFileSync(rendererPath),
  );
  missingRendererInput.review.renderer_manifest.canonical_sha256 =
    fingerprintRendererManifest(renderer);
  const qaPath = path.join(
    missingRendererInput.root,
    missingRendererInput.review.qa_report.path,
  );
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  qa.renderer_manifest_sha256 =
    missingRendererInput.review.renderer_manifest.canonical_sha256;
  writeJson(qaPath, qa);
  missingRendererInput.review.qa_report.sha256 = sha256(
    fs.readFileSync(qaPath),
  );
  writeJson(missingRendererInput.reviewPath, missingRendererInput.review);
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: missingRendererInput.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes("source_media_renderer_input_coverage_mismatch"),
      );
      assert.ok(
        error.codes.includes(
          "rights_ledger_renderer_component_coverage_mismatch",
        ),
      );
      return true;
    },
  );

  const wrongAttribution = addLicensedSourceMedia(fixture());
  const item = wrongAttribution.rightsLedger.items.find(
    (candidate) => candidate.item_id === "ffxiv-gameplay-01",
  );
  item.attribution_text = "Credit: Square Enix";
  writeJson(wrongAttribution.rightsPath, wrongAttribution.rightsLedger);
  wrongAttribution.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(wrongAttribution.rightsPath),
  );
  wrongAttribution.review.rights_ledger.canonical_sha256 = hashRightsLedger(
    wrongAttribution.rightsLedger,
  );
  writeJson(wrongAttribution.reviewPath, wrongAttribution.review);
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: wrongAttribution.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes("source_media_rights_ledger_item_invalid"),
      );
      return true;
    },
  );

  const falseMotionOwnership = addLicensedSourceMedia(fixture());
  const motionEvidence = JSON.parse(
    fs.readFileSync(falseMotionOwnership.motionRightsPath, "utf8"),
  );
  motionEvidence.ownership = "owned";
  writeJson(falseMotionOwnership.motionRightsPath, motionEvidence);
  falseMotionOwnership.rightsLedger.items.find(
    (candidate) => candidate.item_id === "owned-motion",
  ).rights_evidence.sha256 = sha256(
    fs.readFileSync(falseMotionOwnership.motionRightsPath),
  );
  writeJson(falseMotionOwnership.rightsPath, falseMotionOwnership.rightsLedger);
  falseMotionOwnership.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(falseMotionOwnership.rightsPath),
  );
  falseMotionOwnership.review.rights_ledger.canonical_sha256 = hashRightsLedger(
    falseMotionOwnership.rightsLedger,
  );
  writeJson(falseMotionOwnership.reviewPath, falseMotionOwnership.review);
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: falseMotionOwnership.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(error.codes.includes("mixed_motion_rights_evidence_invalid"));
      return true;
    },
  );

  const tamperedAggregate = addLicensedSourceMedia(fixture());
  const aggregate = JSON.parse(
    fs.readFileSync(tamperedAggregate.sourceRightsPath, "utf8"),
  );
  aggregate.components[0].asset_sha256 = "f".repeat(64);
  writeJson(tamperedAggregate.sourceRightsPath, aggregate);
  const aggregateSha = sha256(
    fs.readFileSync(tamperedAggregate.sourceRightsPath),
  );
  tamperedAggregate.rightsLedger.items.find(
    (candidate) => candidate.item_id === "ffxiv-gameplay-01",
  ).rights_evidence.sha256 = aggregateSha;
  writeJson(tamperedAggregate.rightsPath, tamperedAggregate.rightsLedger);
  tamperedAggregate.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(tamperedAggregate.rightsPath),
  );
  tamperedAggregate.review.rights_ledger.canonical_sha256 = hashRightsLedger(
    tamperedAggregate.rightsLedger,
  );
  writeJson(tamperedAggregate.reviewPath, tamperedAggregate.review);
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: tamperedAggregate.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "source_media_rights_evidence_components_mismatch",
        ),
      );
      return true;
    },
  );
});

test("rejects any embedded renderer component omitted from the rights ledger", async () => {
  const values = fixture();
  values.rightsLedger.items = values.rightsLedger.items.filter(
    (item) => item.item_id !== "narration",
  );
  writeJson(values.rightsPath, values.rightsLedger);
  values.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(values.rightsPath),
  );
  values.review.rights_ledger.canonical_sha256 = hashRightsLedger(
    values.rightsLedger,
  );
  writeJson(values.reviewPath, values.review);

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.equal(error.name, "GovernedPublicationReviewError");
      assert.ok(
        error.codes.includes(
          "rights_ledger_renderer_component_coverage_mismatch",
        ),
      );
      return true;
    },
  );
});

test("apply atomically approves the exact reviewed render and records immutable provenance", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const backupEvidencePath = createBackupEvidence(values.root, databasePath);
  const result = await executeGovernedPublicationReview({
    apply: true,
    manifestPath: values.reviewPath,
    databasePath,
    backupEvidencePath,
    confirmStoryId: STORY_ID,
    confirmMediaSha256: values.finalMp4.sha256,
    confirmScriptSha256: values.scriptSha256,
    actorId: "render-editor",
    reason: "Exact final render, evidence and disclosure reviewed",
    generatedAt: NOW,
    env: applyEnv(),
    probe: async () => validProbe(),
  });

  assert.equal(result.verdict, "APPLIED");
  assert.equal(result.mutated, true);
  const db = new Database(databasePath);
  const story = db
    .prepare(
      `SELECT exported_path, audio_path, approved, auto_approved, _extra
       FROM stories WHERE id = ?`,
    )
    .get(STORY_ID);
  const extra = JSON.parse(story._extra);
  assert.equal(story.exported_path, values.finalMp4.absolutePath);
  assert.equal(story.audio_path, values.narration.absolutePath);
  assert.equal(story.approved, 1);
  assert.equal(story.auto_approved, 0);
  assert.equal(extra.render_review_status, "approved");
  assert.equal(extra.preflight_evidence.media_sha256, values.finalMp4.sha256);
  assert.equal(
    extra.final_publication_review.review_manifest_sha256,
    result.review_manifest_sha256,
  );
  assert.deepEqual(extra.final_publication_review.publication_metadata, {
    path: values.publicationMetadata.absolutePath,
    sha256: values.publicationMetadata.sha256,
    platform: "youtube_shorts",
  });
  assert.equal(
    extra.preflight_evidence.publication_metadata_sha256,
    values.publicationMetadata.sha256,
  );
  const audit = db
    .prepare(
      `SELECT * FROM operator_audit_log
       WHERE action = 'governed_publication_review' AND target_id = ?`,
    )
    .get(STORY_ID);
  assert.equal(audit.actor_id, "render-editor");
  assert.equal(audit.decision, "HUMAN_RENDER_APPROVED");
  assert.match(
    audit.idempotency_key,
    new RegExp(`^governed-publication-review:${STORY_ID}:`),
  );
  const auditEvidence = JSON.parse(audit.evidence_json);
  assert.deepEqual(auditEvidence.admission_evidence, extra.preflight_evidence);
  assert.equal(
    auditEvidence.admission_evidence.official_source_release_binding
      .binding_sha256,
    result.preflight_evidence.official_source_release_binding.binding_sha256,
  );
  const repos = bindRepositories(db);
  const prepared = prepareGovernedWindowCandidateAuthority({
    repos,
    storyId: STORY_ID,
    role: "PRIMARY",
    scheduledFor: "2026-07-29T19:00:00.000Z",
    humanReviewAuditId: Number(audit.id),
    actorId: "window-editor",
    reason: "Bind the exact reviewed evidence into the guarded window",
    now: new Date("2026-07-29T12:00:00.000Z"),
  });
  assert.deepEqual(
    prepared.authority.admission.evidence,
    auditEvidence.admission_evidence,
  );
  const admitted = await admitPublication({
    repos,
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: "youtube",
    actorId: prepared.authority.admission.actor_id,
    reason: prepared.authority.admission.reason,
    confirmationStoryId: prepared.authority.admission.confirmation_story_id,
    scheduledFor: prepared.authority.admission.scheduled_for,
    evidence: prepared.authority.admission.evidence,
    env: {
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "f".repeat(64),
    },
    now: new Date("2026-07-29T17:45:00.000Z"),
  });
  assert.equal(admitted.admitted, true);
  assert.equal(
    repos.publicationGovernance.getState(STORY_ID, "youtube").lifecycle_state,
    "SCHEDULED",
  );
  db.close();
});

test("apply refuses unsafe runtime state and inexact story, media or script confirmations", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const backupEvidencePath = createBackupEvidence(values.root, databasePath);
  const result = await executeGovernedPublicationReview({
    apply: true,
    manifestPath: values.reviewPath,
    databasePath,
    backupEvidencePath,
    confirmStoryId: "another-story",
    confirmMediaSha256: "1".repeat(64),
    confirmScriptSha256: "2".repeat(64),
    actorId: "render-editor",
    reason: "Attempt with unsafe controls",
    generatedAt: NOW,
    env: applyEnv({
      AUTO_PUBLISH: "true",
      PULSE_CUTOVER_WORKERS_STOPPED: "false",
    }),
    probe: async () => validProbe(),
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(result.blockers.includes("exact_story_confirmation_required"));
  assert.ok(
    result.blockers.includes("exact_media_sha256_confirmation_mismatch"),
  );
  assert.ok(
    result.blockers.includes("exact_script_sha256_confirmation_mismatch"),
  );
  assert.ok(result.blockers.includes("auto_publish_must_be_explicitly_false"));
  assert.ok(result.blockers.includes("workers_must_be_stopped"));
  const db = new Database(databasePath, { readonly: true });
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM operator_audit_log
         WHERE action = 'governed_publication_review'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT exported_path FROM stories WHERE id = ?").get(STORY_ID)
      .exported_path,
    null,
  );
  db.close();
});

test("an exact replay is idempotent and never duplicates its immutable audit", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const options = {
    apply: true,
    manifestPath: values.reviewPath,
    databasePath,
    confirmStoryId: STORY_ID,
    confirmMediaSha256: values.finalMp4.sha256,
    confirmScriptSha256: values.scriptSha256,
    actorId: "render-editor",
    reason: "Exact final render reviewed",
    generatedAt: NOW,
    env: applyEnv(),
    probe: async () => validProbe(),
  };
  const first = await executeGovernedPublicationReview({
    ...options,
    backupEvidencePath: createBackupEvidence(
      values.root,
      databasePath,
      "first",
    ),
  });
  assert.equal(first.verdict, "APPLIED");

  const replay = await executeGovernedPublicationReview({
    ...options,
    backupEvidencePath: createBackupEvidence(
      values.root,
      databasePath,
      "replay",
    ),
  });
  assert.equal(replay.verdict, "IDEMPOTENT");
  assert.equal(replay.mutated, false);
  const db = new Database(databasePath, { readonly: true });
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM operator_audit_log
         WHERE action = 'governed_publication_review' AND target_id = ?`,
      )
      .get(STORY_ID).count,
    1,
  );
  db.close();
});

test("apply rejects auto-approval and drift from the exact human-approved script hash", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const db = new Database(databasePath);
  const story = db
    .prepare("SELECT _extra FROM stories WHERE id = ?")
    .get(STORY_ID);
  const extra = JSON.parse(story._extra);
  extra.script_approved_sha256 = "f".repeat(64);
  db.prepare(
    "UPDATE stories SET auto_approved = 1, _extra = ? WHERE id = ?",
  ).run(JSON.stringify(extra), STORY_ID);
  db.close();

  const result = await executeGovernedPublicationReview({
    apply: true,
    manifestPath: values.reviewPath,
    databasePath,
    backupEvidencePath: createBackupEvidence(
      values.root,
      databasePath,
      "approval-drift",
    ),
    confirmStoryId: STORY_ID,
    confirmMediaSha256: values.finalMp4.sha256,
    confirmScriptSha256: values.scriptSha256,
    actorId: "render-editor",
    reason: "Approval integrity test",
    generatedAt: NOW,
    env: applyEnv(),
    probe: async () => validProbe(),
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(result.blockers.includes("auto_approved_story_forbidden"));
  assert.ok(result.blockers.includes("human_script_approval_hash_mismatch"));
});

test("independent probing rejects an out-of-band duration or non-48k final audio", async () => {
  const values = fixture();
  const probe = validProbe();
  probe.streams[1].sample_rate = "44100";
  probe.format.duration = "24.99";

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      probe: async () => probe,
    }),
    (error) => {
      assert.ok(
        error.codes.includes("final_mp4_audio_sample_rate_must_be_48000"),
      );
      assert.ok(
        error.codes.includes("final_mp4_duration_must_be_25_to_32_seconds"),
      );
      return true;
    },
  );
});

test("rejects a real rights-evidence file when its declared hash no longer matches", async () => {
  const values = fixture();
  fs.appendFileSync(values.motionRightsPath, "tampered");

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes("rights_evidence_owned-motion_sha256_mismatch"),
      );
      return true;
    },
  );
});

test("apply binds the review back to the source and owned-motion hashes stored at intake", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const db = new Database(databasePath);
  const row = db
    .prepare("SELECT _extra FROM stories WHERE id = ?")
    .get(STORY_ID);
  const extra = JSON.parse(row._extra);
  extra.source_evidence_sha256 = "e".repeat(64);
  extra.owned_asset_manifest_sha256 = "f".repeat(64);
  db.prepare("UPDATE stories SET _extra = ? WHERE id = ?").run(
    JSON.stringify(extra),
    STORY_ID,
  );
  db.close();

  const result = await executeGovernedPublicationReview({
    apply: true,
    manifestPath: values.reviewPath,
    databasePath,
    backupEvidencePath: createBackupEvidence(
      values.root,
      databasePath,
      "intake-drift",
    ),
    confirmStoryId: STORY_ID,
    confirmMediaSha256: values.finalMp4.sha256,
    confirmScriptSha256: values.scriptSha256,
    actorId: "render-editor",
    reason: "Intake hash binding test",
    generatedAt: NOW,
    env: applyEnv(),
    probe: async () => validProbe(),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("source_evidence_intake_hash_mismatch"));
  assert.ok(result.blockers.includes("owned_motion_intake_hash_mismatch"));
});

test("the immediate transaction rolls the story update back if the audit write fails", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const db = new Database(databasePath);
  db.exec(
    `CREATE TRIGGER fail_governed_review_audit
     BEFORE INSERT ON operator_audit_log
     WHEN NEW.action = 'governed_publication_review'
     BEGIN
       SELECT RAISE(ABORT, 'forced_review_audit_failure');
     END;`,
  );
  db.close();

  await assert.rejects(
    executeGovernedPublicationReview({
      apply: true,
      manifestPath: values.reviewPath,
      databasePath,
      backupEvidencePath: createBackupEvidence(
        values.root,
        databasePath,
        "atomicity",
      ),
      confirmStoryId: STORY_ID,
      confirmMediaSha256: values.finalMp4.sha256,
      confirmScriptSha256: values.scriptSha256,
      actorId: "render-editor",
      reason: "Atomicity test",
      generatedAt: NOW,
      env: applyEnv(),
      probe: async () => validProbe(),
    }),
    /forced_review_audit_failure/,
  );
  const check = new Database(databasePath, { readonly: true });
  const story = check
    .prepare(
      "SELECT exported_path, audio_path, _extra FROM stories WHERE id = ?",
    )
    .get(STORY_ID);
  assert.equal(story.exported_path, null);
  assert.equal(story.audio_path, null);
  assert.equal(JSON.parse(story._extra).render_review_status, undefined);
  check.close();
});
