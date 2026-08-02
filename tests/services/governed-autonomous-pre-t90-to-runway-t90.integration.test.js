"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { handlers } = require("../../lib/job-handlers");
const { bindRepositories } = require("../../lib/repositories");
const {
  createAutonomousOfficialJitPreparationManifest,
  STATIC_ARTIFACT_FIELDS,
} = require("../../lib/services/autonomous-official-jit-admission-packet");
const {
  applyGovernedAutonomousPreT90CandidateComposition,
} = require("../../lib/services/apply-governed-autonomous-pre-t90-candidate-composition");
const {
  REQUEST_SCHEMA_VERSION,
  composeGovernedAutonomousPreT90Candidates,
} = require("../../lib/services/governed-autonomous-pre-t90-candidate-composition");
const {
  MATERIALISER_ID: T90_SOURCE_MATERIALISER_ID,
  REPORT_SCHEMA_VERSION: T90_SOURCE_REPORT_SCHEMA_VERSION,
} = require("../../lib/services/governed-autonomous-t90-eligibility-source-report");
const {
  createAutonomousOfficialPublicationAuthority,
} = require("../../lib/services/autonomous-official-publication-authority");
const {
  buildImmutablePublicationEvidence,
} = require("../../lib/services/publication-admission");
const {
  fingerprintPublicationRequest,
} = require("../../lib/services/publication-request-fingerprint");
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  canonicalSha256,
  validateLock,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  createRendererEvidence,
} = require("../../lib/stabilisation/render-manifest");
const {
  fingerprintRendererManifest,
} = require("../../lib/stabilisation/renderer-governance");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const COMPOSED_AT = "2026-07-30T07:28:00.000Z";
const T90_AT = "2026-07-30T07:30:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const SOURCE_CHECKED_AT = "2026-07-30T07:27:30.000Z";
const REQUIRED_VALID_THROUGH = "2026-07-30T07:46:01.000Z";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function migratedFixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare(
    `INSERT INTO channels (id, name, niche)
     VALUES ('pulse-gaming', 'Pulse Gaming', 'gaming')`,
  ).run();
  return { db, repos: bindRepositories(db) };
}

function addApprovedBreakingStory(db, storyId, breakingScore) {
  db.prepare(
    `INSERT INTO stories
       (id, title, full_script, approved, auto_approved, breaking_score,
        score, channel_id, publish_status, _extra)
     VALUES (?, ?, ?, 1, 1, ?, ?, 'pulse-gaming', '', ?)`,
  ).run(
    storyId,
    `Official news for ${storyId}`,
    `${storyId}:\n   script`,
    breakingScore,
    breakingScore,
    JSON.stringify({ breaking_fast_track: true }),
  );
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(filePath, bytes);
  return { sha256: sha256(bytes) };
}

function liveGuardedEnv(workspaceRoot) {
  return {
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
    PULSE_STATE_ROOT: workspaceRoot,
  };
}

async function buildRealT75AdmissionPacket({
  repos,
  storyId,
  workspaceRoot,
  runwayLock,
}) {
  const story = repos.stories.get(storyId);
  const resolveMediaPath = async (storedPath) =>
    path.isAbsolute(storedPath)
      ? storedPath
      : path.join(workspaceRoot, ...storedPath.split("/"));
  const mediaPath = await resolveMediaPath(story.exported_path);
  const mediaSha256 = sha256(fs.readFileSync(mediaPath));
  const sourceUrl =
    "https://news.xbox.com/en-us/2026/07/30/joined-integration/";
  const sourceClaim =
    "The joined integration confirms an official player-facing change.";
  const sourceEvidenceSha256 = sha256(`${storyId}:official-source-evidence`);
  const sourceEvidence = {
    schema_version: "pulse-source-evidence-v1",
    story_id: storyId,
    source_url: sourceUrl,
    source_type: "official",
    claims: [
      {
        claim_key: "joined.integration.change",
        text: sourceClaim,
        claim_text_sha256: sha256(sourceClaim),
      },
    ],
    official_source_snapshot: {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url: sourceUrl,
      source_id: "xbox-wire",
      source_class: "OFFICIAL_FIRST_PARTY",
      canonical_body_algorithm: "pulse-readable-body-v1",
      canonical_body_sha256: sha256(sourceClaim),
      claims: [
        {
          claim_key: "joined.integration.change",
          text: sourceClaim,
          claim_text_sha256: sha256(sourceClaim),
        },
      ],
    },
  };
  const rightsLedger = {
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "owned-motion-package",
        source_url: `pulse-owned://${storyId}/motion-package`,
        asset_sha256: sha256(`${storyId}:owned-motion-package`),
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: `output/rights/${storyId}-owned-motion.json`,
          sha256: sha256(`${storyId}:owned-motion-rights`),
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
      },
    ],
  };
  const metadataPath = path.join(
    workspaceRoot,
    "output",
    "canary",
    storyId,
    "publication-metadata.json",
  );
  const metadataValue = {
    schema_version: "pulse-governed-publication-metadata-v1",
    story_id: storyId,
    channel_id: "pulse-gaming",
    platform: "youtube_shorts",
    title: `Official news for ${storyId}`,
    description:
      "The exact governed publication description for the joined integration proof.",
  };
  const metadataFile = writeJson(metadataPath, metadataValue);
  const rendererManifest = createRendererEvidence({
    story: {
      id: storyId,
      channel_id: "pulse-gaming",
    },
    rendererVersion: "2.1.0",
    mediaSha256,
    stack: {
      hyperframes: true,
      ffmpeg: true,
    },
    platformVideoQa: {
      result: "pass",
      failures: [],
      warnings: [],
      technical: {
        video_codec: "h264",
        video_profile: "High",
        pixel_format: "yuv420p",
        width: 1080,
        height: 1920,
        audio_codec: "aac",
        audio_sample_rate_hz: 48000,
        has_audio: true,
        duration_seconds: 31.2,
        ffprobe_passed: true,
      },
    },
    timing: {
      first_frame_exact_subject: true,
      first_frame_text: "THIS JUST CHANGED",
      hook_visible_by_ms: 200,
      consequence_by_ms: 1100,
      proof_by_ms: 2600,
    },
    motion: {
      scene_count: 8,
      motion_scene_count: 4,
      exact_subject_clip_count: 2,
      exact_subject_still_motion_count: 1,
      unrelated_filler_count: 0,
      every_scene_rights_accepted: true,
    },
    operatingMode: "LIVE_GUARDED",
  }).manifest;
  const qaReportSha256 = sha256(`${storyId}:t75-deterministic-qa`);
  const gateInput = {
    originality_transformation: {
      verdict: "STRONG",
      rationale:
        "Pulse adds an original player consequence and authored motion treatment.",
      evidence_ref: `output/qa/${storyId}-transformation.json`,
      evidence_sha256: sha256(`${storyId}:transformation`),
    },
    rights_ledger: rightsLedger,
    rights_ledger_sha256: hashRightsLedger(rightsLedger),
    synthetic_media_disclosure: {
      decision_authority: "SYSTEM_POLICY",
      altered_content: true,
      policy_basis: "DISCLOSE",
      youtube_field_value: true,
      decision_provenance: {
        policy_id: "pulse-youtube-synthetic-media-disclosure",
        policy_version: "1",
        evaluated_at: "2026-07-30T07:44:00.000Z",
        evidence_sha256: qaReportSha256,
      },
    },
  };
  const publicationEvidence = buildImmutablePublicationEvidence({
    evidence: {
      source_evidence_sha256: sourceEvidenceSha256,
      official_source_release_binding:
        buildOfficialSourceReleaseBinding({
          storyId,
          sourceEvidenceSha256,
          sourceEvidence,
        }),
      qa_report_sha256: qaReportSha256,
      publication_metadata_sha256: metadataFile.sha256,
      publication_metadata: {
        path: metadataPath,
        sha256: metadataFile.sha256,
        platform: metadataValue.platform,
        title: metadataValue.title,
        description: metadataValue.description,
      },
      renderer_manifest: rendererManifest,
      ...gateInput,
    },
    operatingMode: "LIVE_GUARDED",
  });
  const channel = {
    id: "pulse-gaming",
    name: "Pulse Gaming",
    niche: "Gaming",
    tagline: "Fast gaming news. Checked. Explained.",
    cta: "Follow Pulse.",
    youtubeCategory: "20",
  };
  const fingerprint = await fingerprintPublicationRequest(story, {
    channelId: "pulse-gaming",
    platform: "youtube",
    resolveMediaPath,
    channel,
    publicationEvidence,
  });
  const visualQaPath = path.join(
    workspaceRoot,
    "output",
    "canary",
    storyId,
    "visual-qa.json",
  );
  const visualGateDecisionPath = path.join(
    workspaceRoot,
    "output",
    "canary",
    storyId,
    "autonomous-visual-gate-decision.json",
  );
  const lineage = {
    story_intake_sha256: sha256(`${storyId}:story-intake`),
    source_evidence_sha256: publicationEvidence.source_evidence_sha256,
    script_sha256: fingerprint.script_sha256,
    owned_motion_manifest_sha256: sha256(`${storyId}:motion-manifest`),
    owned_motion_source_manifest_sha256: sha256(
      `${storyId}:motion-source-manifest`,
    ),
    owned_programme_sha256: sha256(`${storyId}:owned-programme`),
    narration_audio_sha256: sha256(`${storyId}:narration-audio`),
    narration_manifest_sha256: sha256(`${storyId}:narration-manifest`),
    narration_licence_evidence_sha256: sha256(
      `${storyId}:narration-licence`,
    ),
    final_composite_manifest_sha256: sha256(
      `${storyId}:final-composite`,
    ),
    renderer_manifest_file_sha256: sha256(
      `${storyId}:renderer-manifest-file`,
    ),
    renderer_manifest_canonical_sha256:
      publicationEvidence.renderer_manifest_sha256,
    deterministic_qa_sha256: publicationEvidence.qa_report_sha256,
    multimodal_visual_qa_sha256: sha256(`${storyId}:visual-qa`),
    autonomous_visual_gate_decision_sha256: null,
    autonomous_green_supplement_sha256: sha256(
      `${storyId}:green-supplement`,
    ),
    final_mp4_sha256: fingerprint.media_sha256,
    publication_metadata_sha256:
      publicationEvidence.publication_metadata_sha256,
    kill_switch_proof_sha256: sha256(`${storyId}:kill-switch-proof`),
    publication_admission_owner_proof_sha256: sha256(
      `${storyId}:publication-admission-owner-proof`,
    ),
  };
  const visualGateDecisionBody = {
    schema_version:
      "pulse-governed-autonomous-visual-gate-decision-v1",
    generated_at: "2026-07-30T07:44:20.000Z",
    mode: "LOCAL_PROOF",
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    verdict: "PASS",
    decision_authority: "SYSTEM_POLICY",
    authority_scope: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    visual_review_policy: {
      policy_id: "pulse-visual-review-policy",
      policy_version: "2",
      gate: "AUTONOMOUS_OFFICIAL_UNANIMOUS",
      required_report_schema:
        "pulse-local-multimodal-visual-review-v1",
      required_aggregation: "UNANIMOUS_PASS",
      minimum_distinct_vision_models: 2,
    },
    bindings: {
      final_mp4: {
        path: mediaPath,
        sha256: lineage.final_mp4_sha256,
      },
      visual_qa: {
        path: visualQaPath,
        raw_sha256: lineage.multimodal_visual_qa_sha256,
        canonical_sha256: sha256(`${storyId}:visual-qa-canonical`),
      },
    },
    model_evidence: {
      strategy: "UNANIMOUS_PASS",
      model_ids: ["gemma3:12b", "qwen2.5vl:7b"],
      distinct_model_count: 2,
      review_count: 2,
      pass_count: 2,
    },
    controls: {
      human_approval: false,
      models_treated_as_humans: false,
      publish_authority: false,
      scheduler_authority: false,
      database_authority: false,
      oauth_or_token_authority: false,
      platform_contacted: false,
      network_used: false,
    },
  };
  const visualGateDecision = {
    ...visualGateDecisionBody,
    decision_sha256: canonicalSha256(visualGateDecisionBody),
  };
  const visualGateDecisionBytes = Buffer.from(
    `${JSON.stringify(visualGateDecision, null, 2)}\n`,
    "utf8",
  );
  lineage.autonomous_visual_gate_decision_sha256 = sha256(
    visualGateDecisionBytes,
  );
  const sourceReportBody = {
    schema_version:
      "pulse-autonomous-official-source-evidence-apply-report-v4",
    materialiser_id: "pulse-autonomous-official-source-evidence-apply-v4",
    mode: "LOCAL_PROOF",
    generated_at: "2026-07-30T07:44:30.000Z",
    valid_until: "2026-07-30T07:46:30.000Z",
    request_sha256: sha256(`${storyId}:t75-source-request`),
    story_id: storyId,
    verdict: "GREEN",
    blockers: [],
    authority: {
      method: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
      scope: "LOCAL_EDITORIAL_AND_RELEASE_EVIDENCE_ONLY",
      human_approval: false,
      may_impersonate_human: false,
    },
    visual_policy: "OWNED_ONLY",
    audio_policy: "LICENSED_NARRATION_ONLY",
    source_revalidation: {
      policy: "PRIMARY_AND_ALL_SUPPORTING_OFFICIAL_SNAPSHOTS",
      snapshot_count: 1,
      primary_count: 1,
      supporting_count: 0,
      sources: [
        {
          role: "PRIMARY",
          source_id: "xbox-wire",
          source_url: sourceUrl,
          snapshot_sha256: sha256(`${storyId}:source-snapshot`),
          canonical_body_sha256: sha256(sourceClaim),
          matched_claim_text_sha256: [sha256(sourceClaim)],
          bytes_sha256: sha256(`${storyId}:source-bytes`),
          fetch_status: 200,
          revalidated_at: "2026-07-30T07:44:30.000Z",
          unchanged: true,
          claims_match: true,
        },
      ],
    },
    lineage,
    controls: {
      kill_switch: "FRESH_HEALTHY",
      scheduler_and_publication_admission_ownership: "SINGLE_OWNER",
      kill_switch_proof: {
        declared_path: "output/proof/kill-switch.json",
        resolved_path: "C:\\proof\\kill-switch.json",
        real_path: "C:\\proof\\kill-switch.json",
        observed_sha256: lineage.kill_switch_proof_sha256,
        size_bytes: 300,
      },
      publication_admission_owner_proof: {
        declared_path:
          "output/proof/publication-admission-owner.json",
        resolved_path:
          "C:\\proof\\publication-admission-owner.json",
        real_path: "C:\\proof\\publication-admission-owner.json",
        observed_sha256:
          lineage.publication_admission_owner_proof_sha256,
        size_bytes: 400,
      },
    },
    qa: {
      deterministic: "PASS",
      multimodal: "UNANIMOUS_PASS",
      deterministic_report: {
        declared_path: "output/qa/final-render-qa.json",
        resolved_path: "C:\\proof\\final-render-qa.json",
        real_path: "C:\\proof\\final-render-qa.json",
        observed_sha256: lineage.deterministic_qa_sha256,
        size_bytes: 4000,
      },
      multimodal_report: {
        declared_path: "output/qa/visual-review.json",
        resolved_path: "C:\\proof\\visual-review.json",
        real_path: "C:\\proof\\visual-review.json",
        observed_sha256: lineage.multimodal_visual_qa_sha256,
        size_bytes: 5000,
      },
    },
    input_files: {
      final_mp4: {
        declared_path: mediaPath,
        resolved_path: mediaPath,
        real_path: mediaPath,
        observed_sha256: lineage.final_mp4_sha256,
        size_bytes: fs.statSync(mediaPath).size,
      },
      multimodal_visual_qa: {
        declared_path: visualQaPath,
        resolved_path: visualQaPath,
        real_path: visualQaPath,
        observed_sha256: lineage.multimodal_visual_qa_sha256,
        size_bytes: 2048,
      },
      autonomous_visual_gate_decision: {
        declared_path: visualGateDecisionPath,
        resolved_path: visualGateDecisionPath,
        real_path: visualGateDecisionPath,
        observed_sha256:
          lineage.autonomous_visual_gate_decision_sha256,
        size_bytes: visualGateDecisionBytes.length,
      },
    },
    owned_visual_files: [],
    operational_publish_authority: false,
    dispatch_authorised: false,
    dispatch_revalidation_required: true,
    external_publish_authorised: false,
    platform_contacted: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    platform_objects_created: false,
    local_files_written: 1,
    network_scope: "OFFICIAL_PRIMARY_AND_SUPPORTING_SOURCE_READS_ONLY",
  };
  const sourceReport = {
    ...sourceReportBody,
    report_sha256: canonicalSha256(sourceReportBody),
  };
  const sourceReportBytes = Buffer.from(
    `${JSON.stringify(sourceReport, null, 2)}\n`,
    "utf8",
  );
  const sourceReportPath = path.join(
    workspaceRoot,
    "output",
    "canary",
    storyId,
    "t75-source-report.json",
  );
  const authority = await createAutonomousOfficialPublicationAuthority(
    {
      source_report: {
        path: sourceReportPath,
        file_sha256: sha256(sourceReportBytes),
      },
      binding: {
        story_id: storyId,
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        scheduled_for: SCHEDULED_FOR,
        runway_lock_sha256: runwayLock.lock_sha256,
        dispatch_idempotency_key: `youtube:${storyId}:${SCHEDULED_FOR}`,
        request_fingerprint: fingerprint.request_fingerprint,
      },
      publication_evidence: publicationEvidence,
      publication_evidence_gate_input: gateInput,
      admission_controls: {
        kill_switch_proof_sha256: lineage.kill_switch_proof_sha256,
        kill_switch_checked_at: "2026-07-30T07:44:40.000Z",
        publication_admission_owner_proof_sha256:
          lineage.publication_admission_owner_proof_sha256,
        publication_admission_owner_checked_at:
          "2026-07-30T07:44:45.000Z",
      },
    },
    {
      clock: () => new Date("2026-07-30T07:45:00.000Z"),
      fileSystem: {
        async readFile(filePath) {
          return path.resolve(filePath) ===
            path.resolve(visualGateDecisionPath)
            ? visualGateDecisionBytes
            : sourceReportBytes;
        },
      },
    },
  );
  return {
    resolveMediaPath,
    channel,
    admissionPacket: {
      authority,
      storyId,
      channelId: "pulse-gaming",
      laneId: "breaking_short",
      platform: "youtube",
      scheduledFor: SCHEDULED_FOR,
      runwayLockSha256: runwayLock.lock_sha256,
      requestFingerprint: fingerprint.request_fingerprint,
      publicationEvidence,
    },
  };
}

function governedCoordinatorCandidate(workspaceRoot, storyId, role) {
  const artifacts = Object.fromEntries(
    STATIC_ARTIFACT_FIELDS.map((field) => [
      field,
      {
        path: `output/canary/${storyId}/artifacts/${field}`,
        sha256: sha256(`${storyId}:${field}`),
      },
    ]),
  );
  const mediaRelativePath = `output/canary/${storyId}/final/${storyId}.mp4`;
  const mediaBytes = Buffer.from(`${storyId}:final_mp4`, "utf8");
  const mediaSha256 = sha256(mediaBytes);
  artifacts.final_mp4 = {
    path: mediaRelativePath,
    sha256: mediaSha256,
  };
  const mediaPath = path.join(
    workspaceRoot,
    ...mediaRelativePath.split("/"),
  );
  fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
  fs.writeFileSync(mediaPath, mediaBytes);

  const candidateRevisionSha256 = sha256(
    `${storyId}:candidate-revision`,
  );
  const requestFingerprint = sha256(
    `${storyId}:request-fingerprint`,
  );
  const jitRightsLedgerSha256 = sha256(
    `${storyId}:jit-rights-ledger`,
  );
  const preparation = createAutonomousOfficialJitPreparationManifest({
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    role,
    candidate_revision_sha256: candidateRevisionSha256,
    request_fingerprint: requestFingerprint,
    artifacts,
    owned_visual_assets: [],
    publication_evidence_gate_input: {
      originality_transformation: {
        verdict: "STRONG",
        rationale: "Story-specific owned motion.",
        evidence_ref: artifacts.owned_motion_manifest.path,
        evidence_sha256: artifacts.owned_motion_manifest.sha256,
      },
      rights_ledger: {
        ledger_version: 1,
        decision: "CLEARED",
        items: [],
      },
      rights_ledger_sha256: jitRightsLedgerSha256,
      synthetic_media_disclosure: {
        decision_authority: "SYSTEM_POLICY",
        decision_provenance: {
          policy_id: "pulse-synthetic-media-policy",
          policy_version: "v1",
          evaluated_at: COMPOSED_AT,
          evidence_sha256: artifacts.final_composite_manifest.sha256,
        },
        altered_content: true,
        policy_basis: "DISCLOSE",
        youtube_field_value: true,
      },
    },
  });
  const hashes = {
    source_intake_sha256: artifacts.story_intake.sha256,
    claim_map_sha256: sha256(`${storyId}:claim-map`),
    script_sha256: sha256(`${storyId}: script`),
    narration_sha256: artifacts.narration_audio.sha256,
    timestamps_sha256: sha256(`${storyId}:timestamps`),
    media_inventory_sha256: sha256(`${storyId}:media-inventory`),
    rights_ledger_sha256: sha256(`${storyId}:editorial-rights-ledger`),
    motion_manifest_sha256: artifacts.owned_motion_manifest.sha256,
    render_manifest_sha256: artifacts.renderer_manifest.sha256,
    final_mp4_sha256: mediaSha256,
    qa_report_sha256: artifacts.deterministic_qa.sha256,
    publication_metadata_sha256: artifacts.publication_metadata.sha256,
    package_manifest_sha256: sha256(`${storyId}:package-manifest`),
  };
  const reportRelativePath =
    `output/canary/${storyId}/eligibility/t90-source-report.json`;
  const requestSha256 = sha256(`${storyId}:source-report-request`);
  const reportBody = {
    schema_version: T90_SOURCE_REPORT_SCHEMA_VERSION,
    materialiser_id: T90_SOURCE_MATERIALISER_ID,
    mode: "LOCAL_PROOF",
    generated_at: SOURCE_CHECKED_AT,
    valid_until: REQUIRED_VALID_THROUGH,
    request_sha256: requestSha256,
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    role,
    scheduled_for: SCHEDULED_FOR,
    jit_preparation_sha256: preparation.preparation_sha256,
    candidate_revision_sha256: candidateRevisionSha256,
    request_fingerprint: requestFingerprint,
    source_evidence_sha256: artifacts.source_evidence.sha256,
    story_intake_sha256: artifacts.story_intake.sha256,
    required_checkpoint: {
      name: "T75",
      t75_at: "2026-07-30T07:45:00.000Z",
      validity_margin_ms: 61_000,
      required_valid_through: REQUIRED_VALID_THROUGH,
      final_jit_revalidation_required: true,
    },
    source_last_checked_at: SOURCE_CHECKED_AT,
    upstream_source_apply_report: {
      path: path.join(
        workspaceRoot,
        "output",
        "canary",
        storyId,
        "eligibility",
        "source-apply.json",
      ),
      file_sha256: sha256(`${storyId}:source-apply-file`),
      report_sha256: sha256(`${storyId}:source-apply-report`),
    },
    source_set_sha256: sha256(`${storyId}:source-set`),
    verdict: "GREEN",
    blockers: [],
    publish_authority: false,
    scheduler_authority: false,
    database_authority: false,
    external_publish_authorised: false,
    platform_contacted: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
  };
  const report = {
    ...reportBody,
    report_sha256: canonicalSha256(reportBody),
  };
  const reportFile = writeJson(
    path.join(workspaceRoot, ...reportRelativePath.split("/")),
    report,
  );

  return {
    coordinator_result: {
      schema_version: "pulse-governed-autonomous-production-result-v1",
      mode: "LOCAL_PROOF",
      verdict: "GREEN",
      blockers: [],
      story_id: storyId,
      green_supplement: {
        verdict: "GREEN",
        authority_scope: "LOCAL_PROOF_EVIDENCE_ONLY",
        story_id: storyId,
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        hashes,
        prompt_injection: { verdict: "PASS" },
        media_items: [
          {
            item_id: "owned-motion",
            asset_sha256: sha256(`${storyId}:owned-motion-asset`),
            included_in_final: true,
            rights_decision: "CLEARED",
            rights_basis: "OWNED",
            rights_evidence_sha256: sha256(
              `${storyId}:owned-motion-rights`,
            ),
            licence_document_sha256: null,
            review_status: "VERIFIED",
            risk_decision: null,
            attribution_decision: "NOT_REQUIRED",
            attribution_text: null,
            scope: {
              destinations: ["YOUTUBE"],
              revenue_modes: ["ORGANIC", "PLATFORM_ADVERTISING"],
              territory: "WORLDWIDE",
              account_id: "pulse-gaming-youtube",
            },
          },
        ],
        safety: {
          publish_authority: false,
          scheduler_authority: false,
          database_authority: false,
          oauth_or_token_authority: false,
          network_authority: false,
          platform_contacted: false,
        },
      },
      staging: {
        schema_version:
          "pulse-autonomous-official-candidate-staging-result-v3",
        mode: "LOCAL_PROOF",
        verdict: "GREEN",
        blockers: [],
        story_id: storyId,
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        scheduled_for: SCHEDULED_FOR,
        role,
        preparation_sha256: preparation.preparation_sha256,
        rights_ledger_sha256: jitRightsLedgerSha256,
        preparation_manifest: preparation,
        safety: {
          local_proof_only: true,
          publish_authority: false,
          external_publish_authorised: false,
          database_mutated: false,
          oauth_or_tokens_mutated: false,
          platform_contacted: false,
          network_used: false,
        },
      },
      safety: {
        publish_authority: false,
        scheduler_authority: false,
        database_mutated: false,
        oauth_or_tokens_mutated: false,
        platform_contacted: false,
        external_publish_authorised: false,
      },
    },
    source_snapshot: {
      discovered_at: "2026-07-30T06:00:00.000Z",
      source_last_checked_at: SOURCE_CHECKED_AT,
      publish_by: "2026-07-30T12:00:00.000Z",
      stale_after: "2026-07-30T13:00:00.000Z",
      stale_reframe_option: {
        allowed: true,
        reason: "Reframe as a confirmed player-impact explainer.",
      },
      source_report: {
        path: reportRelativePath,
        file_sha256: reportFile.sha256,
        report_sha256: report.report_sha256,
        request_sha256: requestSha256,
        generated_at: SOURCE_CHECKED_AT,
        valid_until: REQUIRED_VALID_THROUGH,
      },
    },
  };
}

test("real pre-T90 composition and T90 lock reach canonical T75 SCHEDULED state with one exact T0 job", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-pre-t90-runway-integration-"),
  );
  const env = liveGuardedEnv(workspaceRoot);
  const { db, repos } = migratedFixture();
  t.after(() => {
    db.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  addApprovedBreakingStory(db, "joined-primary", 120);
  addApprovedBreakingStory(db, "joined-standby", 90);
  const primary = governedCoordinatorCandidate(
    workspaceRoot,
    "joined-primary",
    "PRIMARY",
  );
  const reserve = governedCoordinatorCandidate(
    workspaceRoot,
    "joined-standby",
    "STANDBY",
  );
  const composition = composeGovernedAutonomousPreT90Candidates({
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    now: COMPOSED_AT,
    scheduled_for: SCHEDULED_FOR,
    primary,
    reserve,
  });

  const applied =
    applyGovernedAutonomousPreT90CandidateComposition({
      composition,
      repos,
      workspaceRoot,
      now: COMPOSED_AT,
    });
  assert.equal(applied.verdict, "APPLIED");
  assert.deepEqual(
    applied.candidates.map(({ story_id, role, verdict }) => ({
      story_id,
      role,
      verdict,
    })),
    [
      {
        story_id: "joined-primary",
        role: "PRIMARY",
        verdict: "APPLIED",
      },
      {
        story_id: "joined-standby",
        role: "STANDBY",
        verdict: "APPLIED",
      },
    ],
  );

  const beforeT90 = repos.jobs
    .listPending()
    .filter((job) => job.kind === "admit_governed_publication");
  assert.equal(beforeT90.length, 1);
  assert.equal(beforeT90[0].story_id, "joined-primary");
  assert.equal(beforeT90[0].run_at, "2026-07-30 07:45:00");

  const result = await handlers.governed_youtube_runway_t90(
    {
      kind: "governed_youtube_runway_t90",
      channel_id: "pulse-gaming",
      run_at: "2026-07-30 07:30:00",
      payload: {
        phase: "T-90",
        publish_hour_utc: 9,
        scheduler_profile: "governed_multi_lane",
        catch_up_allowed: false,
        publish_authority: false,
      },
    },
    {
      repos,
      env,
      now: () => new Date(T90_AT),
      async notifyRunwayIncident() {},
    },
  );

  assert.equal(
    result.verdict,
    "GREEN",
    JSON.stringify({
      blockers: result.blockers,
      candidates: result.candidates,
    }),
  );
  assert.equal(result.lock.primary.story_id, "joined-primary");
  assert.equal(result.lock.primary.stage, "AUTONOMOUS_ELIGIBLE");
  assert.equal(result.lock.primary.standby_authorised, false);
  assert.equal(result.lock.reserve.story_id, "joined-standby");
  assert.equal(result.lock.reserve.stage, "AUTONOMOUS_ELIGIBLE");
  assert.equal(result.lock.reserve.standby_authorised, true);
  assert.equal(result.lock.scheduled_for, SCHEDULED_FOR);
  assert.equal(result.no_external_posting, true);
  assert.equal(result.publish_authority_created, false);

  const afterT90 = repos.jobs
    .listPending()
    .filter((job) => job.kind === "admit_governed_publication");
  assert.equal(afterT90.length, 1);
  assert.equal(afterT90[0].id, beforeT90[0].id);
  assert.equal(afterT90[0].story_id, "joined-primary");
  assert.equal(afterT90[0].run_at, "2026-07-30 07:45:00");
  assert.equal(
    afterT90[0].payload.candidate_revision_sha256,
    composition.candidates[0].candidate_revision_sha256,
  );
  assert.equal(afterT90[0].payload.publish_authority, false);
  assert.equal(afterT90[0].payload.external_posting, false);

  const runwayEvidence = JSON.parse(
    fs.readFileSync(result.evidence_json, "utf8"),
  );
  const runwayLock = JSON.parse(
    fs.readFileSync(result.lock_json, "utf8"),
  );
  assert.equal(runwayEvidence.lock.lock_sha256, runwayLock.lock_sha256);
  assert.deepEqual(validateLock(runwayLock), []);

  const realT75 = await buildRealT75AdmissionPacket({
    repos,
    storyId: "joined-primary",
    workspaceRoot,
    runwayLock,
  });
  const t75Result = await handlers.admit_governed_publication(
    {
      ...afterT90[0],
      attempt_count: 1,
    },
    {
      repos,
      env,
      now: () => new Date("2026-07-30T07:45:00.000Z"),
      autonomousWorkspaceRoot: workspaceRoot,
      channel: realT75.channel,
      resolveMediaPath: realT75.resolveMediaPath,
      assertLeaseHealthy() {},
      async runWithPublicationAdmissionLease(options) {
        assert.equal(
          options.operation,
          "autonomous_t75_jit_admission",
        );
        const publicationAdmissionLease = {
          acquired: true,
          lease_name: "publication-admission:global",
          expires_at: "2026-07-30T07:47:00.000Z",
          current_lock_owner_sha256: "a".repeat(64),
          claimed_job_authority_sha256: "b".repeat(64),
          assertHealthy() {
            return true;
          },
          assertHealthyInTransaction() {
            assert.equal(repos.db.inTransaction, true);
            return true;
          },
        };
        return options.task({
          assertHealthy() {},
          publicationAdmissionLease,
        });
      },
      async materialiseAutonomousOfficialJitAdmissionPacket(request) {
        assert.equal(
          request.runway_lock.lock_sha256,
          runwayLock.lock_sha256,
        );
        assert.equal(
          request.runway_binding.story_id,
          "joined-primary",
        );
        assert.equal(
          request.preparation_manifest.preparation_sha256,
          composition.candidates[0].eligibility.jit_preparation
            .preparation_sha256,
        );
        return {
          schema_version:
            "pulse-autonomous-official-jit-admission-packet-result-v4",
          verdict: "GREEN",
          role: "PRIMARY",
          attempt_count: 1,
          resolved_plan: {
            schema_version:
              "pulse-autonomous-official-jit-resolved-plan-v4",
            resolved_plan_sha256: "f".repeat(64),
          },
          runway_lock_sha256: runwayLock.lock_sha256,
          admission_packet: realT75.admissionPacket,
        };
      },
    },
  );

  assert.equal(t75Result.status, "scheduled", JSON.stringify(t75Result));
  assert.equal(t75Result.story_id, "joined-primary");
  assert.equal(t75Result.lifecycle_state, "SCHEDULED");
  assert.equal(t75Result.scheduled_for, SCHEDULED_FOR);
  assert.equal(t75Result.no_external_posting, true);

  const lifecycle = repos.publicationGovernance.getState(
    "joined-primary",
    "youtube",
  );
  assert.equal(lifecycle.lifecycle_state, "SCHEDULED");
  const scheduledEvent =
    repos.publicationGovernance.getLatestLifecycleEvent(
      "joined-primary",
      "youtube",
      "SCHEDULED",
    );
  assert.ok(Number(scheduledEvent.id) > 0);
  const t0Jobs = repos.jobs
    .listPending()
    .filter(
      (queued) =>
        queued.kind === "verify_governed_youtube_release_t0" &&
        queued.story_id === "joined-primary",
    );
  assert.equal(t0Jobs.length, 1);
  assert.equal(t0Jobs[0].id, t75Result.dispatch_job_id);
  assert.equal(t0Jobs[0].run_at, "2026-07-30 09:00:00");
  assert.equal(t0Jobs[0].payload.phase, "T0");
  assert.equal(t0Jobs[0].payload.scheduled_for, SCHEDULED_FOR);
  assert.equal(
    t0Jobs[0].payload.scheduled_event_id,
    scheduledEvent.id,
  );
  assert.equal(
    t0Jobs[0].payload.dispatch_idempotency_key,
    t75Result.dispatch_idempotency_key,
  );
  assert.equal(t0Jobs[0].payload.public_verification_only, true);
  assert.equal(t0Jobs[0].payload.publish_authority, false);
  assert.equal(t0Jobs[0].payload.external_posting, false);
});
