"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const {
  repairGoalControlTowerEvidence,
} = require("../../lib/goal-control-tower-evidence-repair");
const {
  buildGoal19AutonomyControlTower,
  checkRightsLedger,
} = require("../../lib/goal19-autonomy-control-tower");
const { fingerprintFile } = require("../../lib/human-review-artefact-fingerprints");

function passGate(extra = {}) {
  return { status: "pass", verdict: "pass", failures: [], blockers: [], ...extra };
}

const execFileAsync = promisify(execFile);
let validFinalMediaFixturePromise;

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalSnapshot(canonical = {}) {
  return {
    story_id: canonical.story_id || "",
    selected_title: canonical.selected_title || canonical.short_title || "",
    thumbnail_headline: canonical.thumbnail_headline || canonical.thumbnail_text || "",
    first_spoken_line: canonical.first_spoken_line || canonical.narration_hook || "",
    narration_script: canonical.narration_script || "",
    canonical_subject: canonical.canonical_subject || canonical.canonical_game || "",
    canonical_angle: canonical.canonical_angle || "",
    primary_source: canonical.primary_source || canonical.source_card_label || "",
    public_copy_repaired_at: canonical.public_copy_repaired_at || "",
    duration_variant_repaired_at: canonical.duration_variant_repaired_at || "",
  };
}

function renderInputFingerprint({ canonical, audio, timestamps }) {
  const snapshot = canonicalSnapshot(canonical);
  const source = {
    canonical_snapshot: snapshot,
    audio_sha256: sha256(audio),
    word_timestamps_sha256: sha256(timestamps),
    audio_size_bytes: audio.length,
    word_timestamps_size_bytes: timestamps.length,
  };
  return {
    algorithm: "sha256",
    signature: sha256(Buffer.from(stableJson(source), "utf8")),
    canonical_public_copy_hash: sha256(Buffer.from(stableJson(snapshot), "utf8")),
    ...source,
  };
}

async function extractSampledFrameHashes(finalMp4Path, sampleTimes) {
  const frames = [];
  for (const timeSeconds of sampleTimes) {
    const { stdout } = await execFileAsync("ffmpeg", [
      "-hide_banner", "-nostdin", "-v", "error", "-xerror",
      "-i", finalMp4Path,
      "-ss", String(timeSeconds),
      "-map", "0:v:0",
      "-frames:v", "1",
      "-an", "-sn", "-dn",
      "-threads", "1",
      "-pix_fmt", "rgba",
      "-f", "rawvideo",
      "pipe:1",
    ], {
      encoding: null,
      timeout: 30000,
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024,
    });
    frames.push({ time_seconds: timeSeconds, hash: sha256(stdout) });
  }
  return frames;
}

async function validFinalMediaFixture() {
  if (!validFinalMediaFixturePromise) {
    validFinalMediaFixturePromise = (async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-repair-valid-media-"));
      const output = path.join(root, "valid-short.mp4");
      const contactSheet = path.join(root, "contact-sheet.png");
      try {
        await execFileAsync("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30:duration=1",
          "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=1",
          "-t", "1",
          "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart",
          output,
        ], { timeout: 30000, windowsHide: true });
        await execFileAsync("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", output,
          "-vf", "fps=4,scale=270:480:flags=lanczos,tile=2x2:padding=0:margin=0",
          "-frames:v", "1",
          contactSheet,
        ], { timeout: 30000, windowsHide: true });
        return {
          finalMediaBytes: await fs.readFile(output),
          contactSheetBytes: await fs.readFile(contactSheet),
          sampledFrames: await extractSampledFrameHashes(output, [0, 0.2, 0.4, 0.6, 0.8]),
        };
      } finally {
        await fs.remove(root);
      }
    })();
  }
  return validFinalMediaFixturePromise;
}

async function validFinalMediaBytes() {
  return (await validFinalMediaFixture()).finalMediaBytes;
}

async function makeControlTowerPackage(root, storyId = "story-ready") {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  const finalMediaFixture = await validFinalMediaFixture();
  const finalMp4Path = path.join(artifactDir, "visual_v4_render.mp4");
  await fs.writeFile(finalMp4Path, await validFinalMediaBytes());
  const rightsRecords = [];
  for (let index = 0; index < 5; index += 1) {
    const assetId = `clip-${index + 1}`;
    const relativeAssetPath = `motion/${assetId}.mp4`;
    const relativeEvidencePath = `rights/${assetId}.json`;
    const assetBytes = Buffer.from(`materialised governed motion ${assetId}`);
    const assetPath = path.join(artifactDir, relativeAssetPath);
    const evidencePath = path.join(artifactDir, relativeEvidencePath);
    await fs.outputFile(assetPath, assetBytes);
    await fs.outputJson(evidencePath, {
      asset_id: assetId,
      decision: "approved_for_transformative_editorial_use",
      source_owner: "Official publisher",
    }, { spaces: 2 });
    const evidenceBytes = await fs.readFile(evidencePath);
    rightsRecords.push({
      asset_id: assetId,
      path: relativeAssetPath,
      source_type: "official_direct_media",
      source_owner: "Official publisher",
      licence_basis: "official_promotional_media_transformative_editorial_use",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      commercial_use_allowed: true,
      evidence_file: relativeEvidencePath,
      approval_status: "approved_for_transformative_editorial_use",
      verdict: "GREEN",
      asset_sha256: crypto.createHash("sha256").update(assetBytes).digest("hex"),
      asset_size_bytes: assetBytes.length,
      evidence_sha256: crypto.createHash("sha256").update(evidenceBytes).digest("hex"),
      evidence_size_bytes: evidenceBytes.length,
      risk_score: 0.1,
    });
  }
  const canonical = {
    story_id: storyId,
    canonical_subject: "Hellraiser: Revival",
    selected_title: "Hellraiser: Revival's October Date Is A Risk",
    first_spoken_line: "Hellraiser: Revival picked October 8, and that is brave for all the wrong reasons.",
    narration_script:
      "Hellraiser: Revival picked October 8, and that is brave for all the wrong reasons. Source-backed copy stays clean.",
    primary_source: "Eurogamer",
    primary_source_url: "https://www.eurogamer.net/hellraiser-revival-release-date-trailer",
    claim_inventory: {
      confirmed: ["Hellraiser: Revival is scheduled for 8 October."],
      unconfirmed: [],
      prohibited: [],
    },
  };
  const narrationBytes = Buffer.from(`governed narration for ${storyId}`);
  const timestampBytes = Buffer.from(JSON.stringify([{ word: "Hellraiser", start: 0, end: 0.2 }]));
  const narrationPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word-timestamps.json");
  const narrationEvidencePath = path.join(artifactDir, "rights", "narration.json");
  await fs.outputFile(narrationPath, narrationBytes);
  await fs.outputFile(timestampsPath, timestampBytes);
  await fs.outputJson(narrationEvidencePath, {
    asset_id: `${storyId}_audio_path`,
    decision: "approved_owned_or_licensed_editorial_narration",
    source_owner: "Pulse Gaming",
  }, { spaces: 2 });
  const narrationEvidenceBytes = await fs.readFile(narrationEvidencePath);
  rightsRecords.push({
    asset_id: `${storyId}_audio_path`,
    path: "audio/narration.mp3",
    source_url: `local-tts://${storyId}`,
    source_type: "governed_narration_audio",
    source_owner: "Pulse Gaming",
    licence_basis: "owned_or_licensed_editorial_narration",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    evidence_file: "rights/narration.json",
    approval_status: "approved_owned_or_licensed_editorial_narration",
    verdict: "GREEN",
    asset_sha256: sha256(narrationBytes),
    asset_size_bytes: narrationBytes.length,
    evidence_sha256: sha256(narrationEvidenceBytes),
    evidence_size_bytes: narrationEvidenceBytes.length,
    risk_score: 0.05,
  });
  const platformVariants = {};
  for (const platform of ["youtube_shorts", "instagram_reels", "facebook_reels"]) {
    const variantRelativePath = `platform/${platform}.mp4`;
    const variantPath = path.join(artifactDir, variantRelativePath);
    const evidenceRelativePath = `rights/platform-native-${platform}.json`;
    const evidencePath = path.join(artifactDir, evidenceRelativePath);
    await fs.outputFile(variantPath, finalMediaFixture.finalMediaBytes);
    await fs.outputJson(evidencePath, {
      asset_id: `platform-native-${platform}`,
      decision: "approved_for_platform_native_transcode",
      source_render_sha256: sha256(finalMediaFixture.finalMediaBytes),
    }, { spaces: 2 });
    const evidenceBytes = await fs.readFile(evidencePath);
    rightsRecords.push({
      asset_id: `platform-native-${platform}`,
      path: variantRelativePath,
      source_type: "platform_native_derivative",
      source_owner: "Pulse Gaming",
      licence_basis: "derived_platform_variant_of_fully_rights_covered_final_render",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      commercial_use_allowed: true,
      evidence_file: evidenceRelativePath,
      approval_status: "approved_for_platform_native_transcode",
      verdict: "GREEN",
      asset_sha256: sha256(finalMediaFixture.finalMediaBytes),
      asset_size_bytes: finalMediaFixture.finalMediaBytes.length,
      evidence_sha256: sha256(evidenceBytes),
      evidence_size_bytes: evidenceBytes.length,
      risk_score: 0.05,
    });
    platformVariants[platform] = {
      variant_video_path: variantRelativePath,
      variant_sha256: sha256(finalMediaFixture.finalMediaBytes),
      variant_size_bytes: finalMediaFixture.finalMediaBytes.length,
      source_render_sha256: sha256(finalMediaFixture.finalMediaBytes),
    };
  }
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), canonical);
  await fs.writeJson(path.join(artifactDir, "claim_inventory.json"), {
    schema_version: 1,
    story_id: storyId,
    confirmed: canonical.claim_inventory.confirmed,
    unconfirmed: canonical.claim_inventory.unconfirmed,
    prohibited: canonical.claim_inventory.prohibited,
  });
  await fs.writeJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    resolved_narration_audio_path: narrationPath,
    resolved_word_timestamps_path: timestampsPath,
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    viral_score: 90,
    blockers: [],
    warnings: [],
  });
  await fs.writeJson(path.join(artifactDir, "footage_inventory.json"), {
    verdict: "pass",
    failures: [],
    blockers: [],
    motion_asset_count: 6,
    distinct_motion_family_count: 5,
    motion_inventory: {
      accepted_local_clips: [
        { id: "clip-1", path: "motion/clip-1.mp4", source_family: "official_1" },
        { id: "clip-2", path: "motion/clip-2.mp4", source_family: "official_2" },
        { id: "clip-3", path: "motion/clip-3.mp4", source_family: "official_3" },
        { id: "clip-4", path: "motion/clip-4.mp4", source_family: "official_4" },
        { id: "clip-5", path: "motion/clip-5.mp4", source_family: "official_5" },
      ],
    },
  });
  await fs.writeJson(path.join(artifactDir, "rights_ledger.json"), passGate({
    records: rightsRecords,
  }));
  await fs.writeJson(path.join(artifactDir, "director_beat_map.json"), {
    readiness: { status: "director_ready", blockers: [] },
    shot_plan: [{ id: "hook", kind: "motion_clip" }],
  });
  const rendererSelectedAssets = rightsRecords
    .filter((record) => record.source_type !== "platform_native_derivative")
    .map((record) => ({
      asset_id: record.asset_id,
      kind: record.source_type === "governed_narration_audio" ? "narration" : "video",
      path: path.resolve(artifactDir, record.path),
      asset_sha256: record.asset_sha256,
      asset_size_bytes: record.asset_size_bytes,
    }));
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    run_id: `render-run-${storyId}`,
    generated_at: "2026-06-22T02:09:00.000Z",
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    quality_gate_status: "pass",
    clip_scene_plan: {
      scenes: rightsRecords.slice(0, 5).map((record) => ({
        asset_id: record.asset_id,
        path: path.resolve(artifactDir, record.path),
      })),
    },
    input_evidence: {
      resolved_narration_audio_path: narrationPath,
      resolved_word_timestamps_path: timestampsPath,
    },
    input_fingerprint: renderInputFingerprint({
      canonical,
      audio: narrationBytes,
      timestamps: timestampBytes,
    }),
    selected_input_assets: {
      schema_version: 2,
      authoritative: true,
      complete: true,
      producer_id: "pulse-gaming-studio-v4-renderer",
      asset_count: rendererSelectedAssets.length,
      assets: rendererSelectedAssets,
      blockers: [],
    },
    safety: { no_publish_triggered: true },
  });
  await fs.writeJson(path.join(artifactDir, "temporal_video_qa_report.json"), {
    schema_version: 1,
    story_id: storyId,
    verdict: "GREEN",
    can_publish: true,
    blockers: [],
    warnings: [],
    final_media: {
      path: finalMp4Path,
      sha256: sha256(finalMediaFixture.finalMediaBytes),
      size_bytes: finalMediaFixture.finalMediaBytes.length,
    },
    evidence: {
      decode: {
        complete: true,
        video_stream: true,
        audio_stream: true,
      },
      temporal: {
        analysis_scope: "full_frame",
        scan_complete: true,
        coverage_ratio: 1,
        sampled_frame_count: 6,
        repeated_motion_sequences: [],
        repeated_motion_seconds: 0,
        cadence: { choppy: false },
        supplemental_center_crop: {
          analysis_scope: "center_crop",
          scan_complete: true,
          coverage_ratio: 1,
          sampled_frame_count: 6,
          repeated_motion_sequences: [],
          repeated_motion_seconds: 0,
          cadence: { choppy: false },
        },
      },
    },
    source_result: {
      result: "pass",
      failures: [],
      warnings: [],
    },
  });
  await fs.writeJson(path.join(artifactDir, "visual_quality_report.json"), passGate());
  await fs.writeJson(path.join(artifactDir, "benchmark_report.json"), passGate({ result: "pass" }));
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    story_id: storyId,
    generated_at: "2026-06-22T02:09:30.000Z",
    source_render_run_id: `render-run-${storyId}`,
    final_video_report: {
      path: finalMp4Path,
      sha256: sha256(finalMediaFixture.finalMediaBytes),
      size_bytes: finalMediaFixture.finalMediaBytes.length,
      decodable: true,
      media_qa_status: "pass",
    },
    verdict: "GREEN",
    status: "pass",
    hard_failures: [],
    scores: {
      overall_media_house_score: 95,
      competitor_parity_score: 97,
      competitor_surpass_score: 93,
      first_3_seconds_score: 100,
      source_lock_score: 100,
    },
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "GREEN",
    can_auto_publish: true,
    enabled_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    outputs: {
      youtube_shorts: {
        title: "Hellraiser: Revival's October Date Is A Risk",
        ...platformVariants.youtube_shorts,
      },
      instagram_reels: {
        caption: "Hellraiser: Revival picked October 8. Source: Eurogamer.",
        ...platformVariants.instagram_reels,
      },
      facebook_reels: {
        page_caption: "Hellraiser: Revival picked October 8. Source: Eurogamer.",
        ...platformVariants.facebook_reels,
      },
    },
    platform_native_evidence: { verdict: "pass", platforms: [{ platform: "youtube_shorts", status: "pass" }] },
  });
  const contactSheetPath = path.join(artifactDir, "final_av_contact_sheet.png");
  const decodedForensicReportPath = path.join(artifactDir, "decoded_forensic_report.json");
  await fs.writeFile(contactSheetPath, finalMediaFixture.contactSheetBytes);
  await fs.writeJson(decodedForensicReportPath, {
    schema_version: 1,
    story_id: storyId,
    verdict: "pass",
    blockers: [],
    final_media: {
      path: finalMp4Path,
      sha256: sha256(finalMediaFixture.finalMediaBytes),
      size_bytes: finalMediaFixture.finalMediaBytes.length,
    },
    checks: Object.fromEntries(
      ["audio", "video", "captions", "av_sync", "freeze", "black", "blur", "repetition"]
        .map((name) => [name, { checked: true, verdict: "pass" }]),
    ),
    sampled_frames: finalMediaFixture.sampledFrames,
    critical_defects: [],
  }, { spaces: 2 });
  const artefacts = {
    final_mp4: finalMp4Path,
    contact_sheet: contactSheetPath,
    decoded_forensic_report: decodedForensicReportPath,
  };
  const reviewedArtefactFingerprints = Object.fromEntries(
    Object.entries(artefacts).map(([key, filePath]) => [key, fingerprintFile(filePath).sha256]),
  );
  await fs.writeJson(path.join(artifactDir, "final_av_review.json"), {
    schema_version: 1,
    story_id: storyId,
    reviewed_at: "2026-07-15T01:00:00.000Z",
    signed_at: "2026-07-15T01:01:00.000Z",
    reviewer: { id: "independent-final-av-reviewer", independent: true },
    signoff: {
      reviewer_id: "independent-final-av-reviewer",
      signed_at: "2026-07-15T01:01:00.000Z",
    },
    artefacts,
    reviewed_artefact_fingerprints: reviewedArtefactFingerprints,
    contact_sheet_binding: {
      contact_sheet_sha256: reviewedArtefactFingerprints.contact_sheet,
      final_mp4_sha256: reviewedArtefactFingerprints.final_mp4,
      decoded_forensic_report_sha256: reviewedArtefactFingerprints.decoded_forensic_report,
      sampled_frames: finalMediaFixture.sampledFrames,
    },
    attestations: {
      full_watch: true,
      full_listen: true,
      av_sync: true,
      caption_readability: true,
      subject_match: true,
    },
    defects: [],
    status: "GREEN",
    verdict: "GREEN",
    final_verdict: "GREEN",
    publish_ready: true,
    can_publish: true,
    can_auto_publish: true,
  }, { spaces: 2 });
  return { story_id: storyId, artifact_dir: artifactDir, title: "Hellraiser: Revival's October Date Is A Risk" };
}

function readyGoal18(storyId) {
  return { stories: [{ story_id: storyId, status: "ready", blockers: [] }] };
}

function goal16Pass(storyId) {
  return {
    stories: [{
      story_id: storyId,
      status: "blocked",
      direct_landing_status: "pass",
      blockers: ["upstream:goal15_affiliate_intelligence_missing"],
    }],
  };
}

function landingProof(storyId) {
  return {
    story: {
      story_id: storyId,
      status: "local_proof_prepared",
      landing_page_slug: "hellraiser-revival-october-risk",
      landing_page_route: "/p/hellraiser-revival-october-risk",
      link_pack: { primary_link: null, source_links: [] },
      disclosure_block: { required: false, status: "present" },
    },
  };
}

function goal17Pass(storyId) {
  return {
    stories: [{
      story_id: storyId,
      status: "blocked",
      direct_policy_status: "pass",
      direct_policy_blockers: [],
      disclosure_requirements: {
        affiliate: { required: false, present: true, action: "no_action" },
      },
      policy_checks: {
        spam_repetitive_content: passGate({ evidence: { blind_duplicate_pairs: [] } }),
        affiliate_disclosure: passGate({ evidence: { required: false, present: true } }),
      },
    }],
  };
}

function policyProof(storyId) {
  return {
    story: {
      story_id: storyId,
      status: "pass",
      blockers: [],
      checks: {
        spam_repetitive_content: passGate({ evidence: { blind_duplicate_pairs: [] } }),
        affiliate_disclosure: passGate({ evidence: { required: false, present: true } }),
      },
      disclosure_requirements: {
        affiliate: { required: false, present: true, action: "no_action" },
      },
    },
  };
}

test("control tower evidence repair promotes passed local proof into package-level Goal19 inputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-evidence-"));
  const story = await makeControlTowerPackage(root, "story-hellraiser");
  const packageRights = await checkRightsLedger(
    await fs.readJson(path.join(story.artifact_dir, "rights_ledger.json")),
    await fs.readJson(path.join(story.artifact_dir, "platform_publish_manifest.json")),
    await fs.readJson(path.join(story.artifact_dir, "footage_inventory.json")),
    await fs.readJson(path.join(story.artifact_dir, "render_manifest.json")),
    {},
    root,
    story.artifact_dir,
  );
  assert.equal(packageRights.status, "pass", JSON.stringify(packageRights, null, 2));

  const before = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-hellraiser"),
    workspaceRoot: root,
    outputDir: path.join(root, "out-before"),
    generatedAt: "2026-06-22T02:10:00.000Z",
  });
  assert.equal(before.direct_control_tower_verdict, "BLOCKED");
  assert.ok(before.stories[0].direct_control_tower_blockers.includes("control:policy_report_not_pass"));
  assert.ok(before.stories[0].direct_control_tower_blockers.includes("control:analytics_risk_missing"));

  const report = await repairGoalControlTowerEvidence({
    storyPackages: [story],
    goal16Report: goal16Pass("story-hellraiser"),
    landingManifestReport: landingProof("story-hellraiser"),
    goal17Report: goal17Pass("story-hellraiser"),
    platformPolicyReport: policyProof("story-hellraiser"),
    generatedAt: "2026-06-22T02:11:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(report.summary.repairable_count, 1);
  assert.equal(report.summary.repaired_count, 1);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_gate_weakened, true);

  const analytics = await fs.readJson(path.join(story.artifact_dir, "analytics_ingest_plan.json"));
  const affiliate = await fs.readJson(path.join(story.artifact_dir, "affiliate_link_manifest.json"));
  const uniqueness = await fs.readJson(path.join(story.artifact_dir, "uniqueness_report.json"));
  assert.equal(analytics.dry_run_only, true);
  assert.equal(affiliate.no_affiliate_link, true);
  assert.equal(affiliate.disclosure_required, false);
  assert.equal(uniqueness.status, "pass");
  assert.equal(await fs.pathExists(path.join(story.artifact_dir, "publish_verdict.json")), true);

  const after = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-hellraiser"),
    workspaceRoot: root,
    outputDir: path.join(root, "out-after"),
    generatedAt: "2026-06-22T02:12:00.000Z",
  });
  assert.equal(after.verdict, "PASS", JSON.stringify(after.stories[0], null, 2));
  assert.equal(after.direct_control_tower_verdict, "PASS");
  assert.equal(after.stories[0].final_verdict, "GREEN");
  assert.deepEqual(after.stories[0].direct_control_tower_blockers, []);
});

test("control tower evidence repair refuses to promote missing policy proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-evidence-blocked-"));
  const story = await makeControlTowerPackage(root, "story-missing-policy");

  const report = await repairGoalControlTowerEvidence({
    storyPackages: [story],
    goal16Report: goal16Pass("story-missing-policy"),
    landingManifestReport: landingProof("story-missing-policy"),
    goal17Report: {},
    platformPolicyReport: {},
    generatedAt: "2026-06-22T02:20:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(report.summary.blocked_count, 1);
  assert.equal(report.summary.repaired_count, 0);
  assert.ok(report.items[0].blockers.includes("platform_policy_proof_not_passed"));
  assert.equal(await fs.pathExists(path.join(story.artifact_dir, "platform_policy_report.json")), false);
});

test("control tower evidence repair refuses to promote a missing final media file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-evidence-missing-media-"));
  const story = await makeControlTowerPackage(root, "story-missing-final-media");
  await fs.remove(path.join(story.artifact_dir, "visual_v4_render.mp4"));

  const report = await repairGoalControlTowerEvidence({
    storyPackages: [story],
    goal16Report: goal16Pass("story-missing-final-media"),
    landingManifestReport: landingProof("story-missing-final-media"),
    goal17Report: goal17Pass("story-missing-final-media"),
    platformPolicyReport: policyProof("story-missing-final-media"),
    generatedAt: "2026-07-14T21:04:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(report.summary.blocked_count, 1);
  assert.equal(report.summary.repaired_count, 0);
  assert.ok(report.items[0].blockers.includes("final_render_output_missing_or_unreadable"));
});

test("control tower evidence repair refuses bare rights pass evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-evidence-bare-rights-"));
  const story = await makeControlTowerPackage(root, "story-bare-rights");
  await fs.writeJson(path.join(story.artifact_dir, "rights_ledger.json"), passGate());

  const report = await repairGoalControlTowerEvidence({
    storyPackages: [story],
    goal16Report: goal16Pass("story-bare-rights"),
    landingManifestReport: landingProof("story-bare-rights"),
    goal17Report: goal17Pass("story-bare-rights"),
    platformPolicyReport: policyProof("story-bare-rights"),
    generatedAt: "2026-07-14T21:05:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(report.summary.blocked_count, 1);
  assert.equal(report.summary.repaired_count, 0);
  assert.ok(report.items[0].blockers.includes("rights_evidence_incomplete"));
});

test("control tower evidence repair refuses missing rights for a final render scene", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-evidence-render-rights-"));
  const story = await makeControlTowerPackage(root, "story-render-rights");
  const renderPath = path.join(story.artifact_dir, "render_manifest.json");
  const renderManifest = await fs.readJson(renderPath);
  await fs.writeJson(renderPath, {
    ...renderManifest,
    clip_scene_plan: {
      scenes: [{ path: "motion/final-render-only.mp4" }],
    },
  });

  const report = await repairGoalControlTowerEvidence({
    storyPackages: [story],
    goal16Report: goal16Pass("story-render-rights"),
    landingManifestReport: landingProof("story-render-rights"),
    goal17Report: goal17Pass("story-render-rights"),
    platformPolicyReport: policyProof("story-render-rights"),
    generatedAt: "2026-07-14T21:06:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(report.summary.blocked_count, 1);
  assert.equal(report.summary.repaired_count, 0);
  assert.ok(report.items[0].blockers.includes("rights_evidence_incomplete"));
});

test("control tower evidence repair refreshes evidence without promoting authoritative RED publish controls", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-evidence-platform-manifest-"));
  const story = await makeControlTowerPackage(root, "story-stale-platform-manifest");
  const platformManifestPath = path.join(story.artifact_dir, "platform_publish_manifest.json");
  const platformManifest = await fs.readJson(platformManifestPath);
  const authoritativePlatformManifest = {
    ...platformManifest,
    publish_status: "RED",
    can_auto_publish: false,
  };
  const publishVerdictPath = path.join(story.artifact_dir, "publish_verdict.json");
  const authoritativePublishVerdict = {
    verdict: "RED",
    status: "RED",
    can_auto_publish: false,
    publish_action: "blocked",
    reason_codes: ["operator_hold"],
  };
  await fs.writeJson(platformManifestPath, authoritativePlatformManifest);
  await fs.writeJson(publishVerdictPath, authoritativePublishVerdict);

  const report = await repairGoalControlTowerEvidence({
    storyPackages: [story],
    goal16Report: goal16Pass("story-stale-platform-manifest"),
    landingManifestReport: landingProof("story-stale-platform-manifest"),
    goal17Report: goal17Pass("story-stale-platform-manifest"),
    platformPolicyReport: policyProof("story-stale-platform-manifest"),
    generatedAt: "2026-06-22T02:30:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(report.summary.repairable_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.summary.repaired_count, 1);
  assert.ok(report.items[0].blockers.includes("authoritative_platform_publish_manifest_red"));
  assert.ok(report.items[0].blockers.includes("authoritative_publish_verdict_red"));
  assert.ok(report.items[0].stale_files.includes("platform_publish_manifest.json"));

  const repairedPlatformManifest = await fs.readJson(platformManifestPath);
  const publishVerdict = await fs.readJson(publishVerdictPath);
  assert.equal(repairedPlatformManifest.publish_status, "RED");
  assert.equal(repairedPlatformManifest.can_auto_publish, false);
  assert.equal(publishVerdict.verdict, "RED");
  assert.equal(publishVerdict.status, "RED");
  assert.equal(publishVerdict.can_auto_publish, false);
  assert.equal(publishVerdict.publish_action, "blocked");
  assert.ok(publishVerdict.reason_codes.includes("operator_hold"));
  assert.equal(await fs.pathExists(path.join(story.artifact_dir, "analytics_ingest_plan.json")), true);
});
