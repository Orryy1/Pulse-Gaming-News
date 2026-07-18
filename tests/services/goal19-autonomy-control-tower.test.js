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
  REQUIRED_CONTROL_INPUTS,
  buildGoal19AutonomyControlTower,
  writeGoal19AutonomyControlTower,
} = require("../../lib/goal19-autonomy-control-tower");
const { fingerprintFile } = require("../../lib/human-review-artefact-fingerprints");

function passGate(extra = {}) {
  return { verdict: "pass", failures: [], warnings: [], ...extra };
}

function narrationRightsRecord(storyId, allowedPlatforms = ["youtube_shorts", "tiktok"]) {
  return {
    asset_id: `${storyId}_audio_path`,
    path: "audio/narration.mp3",
    source_url: `local-tts://${storyId}`,
    source_type: "governed_narration_audio",
    source_owner: "Pulse Gaming",
    licence_basis: "owned_or_licensed_editorial_narration",
    allowed_platforms: allowedPlatforms,
    commercial_use_allowed: true,
    evidence_file: "rights/narration.json",
    approval_status: "approved_for_transformative_editorial_use",
    verdict: "GREEN",
    risk_score: 0.05,
  };
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

async function materialiseRightsFixture(artifactDir, ledger = {}) {
  const records = [
    ...(Array.isArray(ledger.records) ? ledger.records : []),
    ...(Array.isArray(ledger.rights_ledger) ? ledger.rights_ledger : []),
    ...(Array.isArray(ledger.rights_records) ? ledger.rights_records : []),
  ];
  for (const record of records) {
    const assetDeclaredPath = record.path || record.local_path || record.file || record.output_path;
    if (assetDeclaredPath) {
      const assetPath = path.isAbsolute(assetDeclaredPath)
        ? assetDeclaredPath
        : path.resolve(artifactDir, assetDeclaredPath);
      if (!(await fs.pathExists(assetPath))) {
        await fs.outputFile(assetPath, Buffer.from(`asset:${record.asset_id || record.id || assetDeclaredPath}`));
      }
      const assetBytes = await fs.readFile(assetPath);
      record.asset_sha256 = sha256(assetBytes);
      record.asset_size_bytes = assetBytes.length;
    }
    const evidenceDeclaredPath =
      record.evidence_file || record.licence_evidence || record.license_evidence || record.permission_evidence;
    if (evidenceDeclaredPath) {
      const evidencePath = path.isAbsolute(evidenceDeclaredPath)
        ? evidenceDeclaredPath
        : path.resolve(artifactDir, evidenceDeclaredPath);
      if (!(await fs.pathExists(evidencePath))) {
        await fs.outputFile(
          evidencePath,
          Buffer.from(`evidence:${record.asset_id || record.id || evidenceDeclaredPath}`),
        );
      }
      const evidenceBytes = await fs.readFile(evidencePath);
      record.evidence_sha256 = sha256(evidenceBytes);
      record.evidence_size_bytes = evidenceBytes.length;
    }
  }
  return ledger;
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
    assert.ok(Buffer.isBuffer(stdout) && stdout.length > 0, `frame ${timeSeconds}s must decode`);
    frames.push({
      time_seconds: timeSeconds,
      hash: sha256(stdout),
    });
  }
  return frames;
}

async function validFinalMediaFixture() {
  if (!validFinalMediaFixturePromise) {
    validFinalMediaFixturePromise = (async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-valid-media-"));
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
        const sampledFrames = await extractSampledFrameHashes(output, [0, 0.2, 0.4, 0.6, 0.8]);
        return {
          finalMediaBytes: await fs.readFile(output),
          contactSheetBytes: await fs.readFile(contactSheet),
          sampledFrames,
        };
      } finally {
        await fs.remove(root);
      }
    })();
  }
  return validFinalMediaFixturePromise;
}

async function makeControlStory(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  const finalMp4Path = path.join(artifactDir, "visual_v4_render.mp4");
  const finalMediaFixture = await validFinalMediaFixture();
  if (overrides.finalMedia !== false) {
    await fs.writeFile(finalMp4Path, finalMediaFixture.finalMediaBytes);
  }
  const canonical = {
    story_id: storyId,
    selected_title: "Forza Horizon 6 Shows Real Footage",
    narration_script: "Forza Horizon 6 showed real footage from Xbox. The copy stays source backed.",
    claim_inventory: {
      confirmed: ["Xbox showed official Forza Horizon 6 footage."],
      unconfirmed: [],
      prohibited: [],
    },
    commercial_intelligence: { disclosure_required: true },
    ...(overrides.canonical || {}),
  };
  const narrationBytes = Buffer.from(`governed narration for ${storyId}`);
  const timestampBytes = Buffer.from(JSON.stringify([{ word: "Forza", start: 0, end: 0.2 }]));
  const narrationPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word-timestamps.json");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), canonical);
  await fs.outputJson(
    path.join(artifactDir, "claim_inventory.json"),
    overrides.claimInventory || {
      schema_version: 1,
      story_id: storyId,
      confirmed: canonical.claim_inventory?.confirmed || [],
      unconfirmed: canonical.claim_inventory?.unconfirmed || [],
      prohibited: canonical.claim_inventory?.prohibited || [],
    },
  );
  await fs.outputFile(narrationPath, narrationBytes);
  await fs.outputFile(timestampsPath, timestampBytes);
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    resolved_narration_audio_path: narrationPath,
    resolved_word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "script_scorecard.json"), overrides.scriptScorecard || passGate({ viral_score: 88 }));
  const footageInventory = overrides.footageInventory || {
    verdict: "pass",
    failures: [],
    blockers: [],
    motion_asset_count: 6,
    distinct_motion_family_count: 4,
    materialised_motion_clips: [
      {
        id: "clip-a",
        path: "motion/clip-a.mp4",
        source_url: "https://www.xbox.com/games/forza-horizon-6",
        source_family: "official_xbox_gameplay",
      },
      {
        id: "clip-b",
        path: "motion/clip-b.mp4",
        source_url: "https://store.steampowered.com/app/example",
        source_family: "official_steam_gameplay",
      },
    ],
  };
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), footageInventory);
  const usedMotion = [
    ...(footageInventory.motion_inventory?.accepted_local_clips || []),
    ...(footageInventory.materialised_motion_clips || []),
    ...(footageInventory.motion_clips || []),
    ...(footageInventory.motion_assets || []),
  ];
  const defaultRightsLedger = {
    verdict: "pass",
    failures: [],
    warnings: [],
    records: [
      ...usedMotion.map((clip, index) => ({
        asset_id: clip.asset_id || clip.id || `motion-${index + 1}`,
        path: clip.path || clip.local_path || "",
        source_url: clip.source_url || "",
        source_type: "official_direct_media",
        source_owner: "Official publisher",
        licence_basis: "official_promotional_media_transformative_editorial_use",
        allowed_platforms: ["youtube_shorts", "tiktok"],
        commercial_use_allowed: true,
        evidence_file: `rights/${clip.asset_id || clip.id || `motion-${index + 1}`}.json`,
        approval_status: "approved_for_transformative_editorial_use",
        verdict: "GREEN",
        risk_score: 0.1,
      })),
      narrationRightsRecord(storyId),
    ],
  };
  const rightsLedger = overrides.rightsLedger || defaultRightsLedger;
  if (overrides.materialiseRightsEvidence !== false) {
    await materialiseRightsFixture(artifactDir, rightsLedger);
  }
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), rightsLedger);
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), overrides.directorPlan || {
    readiness: { status: "ready", blockers: [] },
    shot_plan: [{ id: "hook", kind: "motion_clip" }],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), overrides.renderManifest || {
    story_id: storyId,
    final_publish_render: true,
    output_path: finalMp4Path,
    quality_gate_status: "pass",
    clip_scene_plan: {
      scenes: usedMotion.map((clip, index) => ({
        asset_id: clip.asset_id || clip.id || clip.clip_id || `motion-${index + 1}`,
        path: clip.path || clip.local_path || `motion/motion-${index + 1}.mp4`,
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
    safety: { no_publish_triggered: true },
  });
  if (overrides.sfxManifest) {
    await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), overrides.sfxManifest);
  }
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), overrides.visualQuality || passGate());
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), overrides.benchmark || passGate({ result: "pass" }));
  await fs.outputJson(path.join(artifactDir, "pulse_media_house_score.json"), overrides.pulseMediaHouseScore || {
    verdict: "GREEN",
    status: "pass",
    hard_failures: [],
    scores: {
      title_strength_score: 88,
      first_frame_score: 86,
      first_3_seconds_score: 88,
      script_punch_score: 87,
      narration_quality_score: 84,
      motion_density_score: 88,
      transition_energy_score: 86,
      sound_design_score: 84,
      mobile_readability_score: 89,
      brand_recognition_score: 82,
      source_lock_score: 91,
      source_trust_score: 91,
      commercial_trust_score: 86,
      ending_payoff_score: 84,
      competitor_parity_score: 85,
      competitor_surpass_score: 78,
      overall_media_house_score: 86,
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), overrides.policyReport || {
    verdict: "pass",
    publish_blockers: [],
    youtube_reused_content_risk: passGate(),
    affiliate_disclosure: passGate(),
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), overrides.affiliate || {
    disclosure_required: true,
    disclosure_copy: { short: "Affiliate links may earn us a commission." },
    failures: [],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), overrides.platformManifest || {
    publish_status: "GREEN",
    can_auto_publish: true,
    outputs: {
      youtube_shorts: { title: "Forza Horizon 6 Shows Real Footage" },
      tiktok: { caption: "Source: Xbox." },
    },
    governance_gates: {
      public_output_coherence_gate: passGate(),
      rights_ledger: passGate(),
      platform_policy_gate: passGate(),
      affiliate_disclosure_gate: passGate(),
      reused_content_risk_gate: passGate(),
      anti_spam_uniqueness_gate: passGate(),
      finance_crypto_firewall: passGate(),
    },
  });
  await fs.outputJson(path.join(artifactDir, "analytics_ingest_plan.json"), overrides.analyticsRisk || {
    dry_run_only: true,
    risk_status: "clear",
    required_metrics: ["views", "average_view_duration", "swipe_away"],
  });
  await fs.outputJson(path.join(artifactDir, "uniqueness_report.json"), overrides.uniquenessReport || passGate({ matches: [] }));
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), overrides.publishVerdict || {
    verdict: "GREEN",
    can_auto_publish: true,
    reason_codes: [],
  });
  if (overrides.goalPackageSummary) {
    await fs.outputJson(
      path.join(artifactDir, "goal_package_summary.json"),
      overrides.goalPackageSummary,
    );
  }
  const contactSheetPath = path.join(artifactDir, "final_av_contact_sheet.png");
  const decodedForensicReportPath = path.join(artifactDir, "decoded_forensic_report.json");
  if (overrides.finalAvContactSheet !== false) {
    await fs.writeFile(
      contactSheetPath,
      overrides.finalAvContactSheet || finalMediaFixture.contactSheetBytes,
    );
  }
  let decodedForensicReport = null;
  if (overrides.decodedForensicReport !== false) {
    const finalMediaBytes = await fs.pathExists(finalMp4Path)
      ? await fs.readFile(finalMp4Path)
      : Buffer.alloc(0);
    const passingChecks = Object.fromEntries(
      ["audio", "video", "captions", "av_sync", "freeze", "black", "blur", "repetition"]
        .map((name) => [name, { checked: true, verdict: "pass" }]),
    );
    decodedForensicReport = overrides.decodedForensicReport || {
      schema_version: 1,
      story_id: storyId,
      verdict: "pass",
      blockers: [],
      final_media: {
        path: finalMp4Path,
        sha256: finalMediaBytes.length ? sha256(finalMediaBytes) : null,
        size_bytes: finalMediaBytes.length,
      },
      checks: passingChecks,
      sampled_frames: finalMediaFixture.sampledFrames,
      critical_defects: [],
    };
    await fs.writeJson(decodedForensicReportPath, decodedForensicReport, { spaces: 2 });
  }
  if (overrides.temporalVideoQa !== false) {
    const finalMediaBytes = await fs.pathExists(finalMp4Path)
      ? await fs.readFile(finalMp4Path)
      : Buffer.alloc(0);
    const defaultTemporalVideoQa = {
      schema_version: 1,
      story_id: storyId,
      verdict: "GREEN",
      can_publish: true,
      blockers: [],
      warnings: [],
      final_media: {
        path: finalMp4Path,
        sha256: finalMediaBytes.length ? sha256(finalMediaBytes) : null,
        size_bytes: finalMediaBytes.length,
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
          sampled_frame_count: 300,
          repeated_motion_sequences: [],
          repeated_motion_seconds: 0,
          cadence: { choppy: false },
          supplemental_center_crop: {
            analysis_scope: "center_crop",
            scan_complete: true,
            coverage_ratio: 1,
            sampled_frame_count: 300,
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
    };
    const temporalOverride = overrides.temporalVideoQa || {};
    await fs.writeJson(
      path.join(artifactDir, "temporal_video_qa_report.json"),
      {
        ...defaultTemporalVideoQa,
        ...temporalOverride,
        final_media: {
          ...defaultTemporalVideoQa.final_media,
          ...(temporalOverride.final_media || {}),
        },
        evidence: {
          ...defaultTemporalVideoQa.evidence,
          ...(temporalOverride.evidence || {}),
          decode: {
            ...defaultTemporalVideoQa.evidence.decode,
            ...(temporalOverride.evidence?.decode || {}),
          },
          temporal: {
            ...defaultTemporalVideoQa.evidence.temporal,
            ...(temporalOverride.evidence?.temporal || {}),
            cadence: {
              ...defaultTemporalVideoQa.evidence.temporal.cadence,
              ...(temporalOverride.evidence?.temporal?.cadence || {}),
            },
            supplemental_center_crop: {
              ...defaultTemporalVideoQa.evidence.temporal.supplemental_center_crop,
              ...(temporalOverride.evidence?.temporal?.supplemental_center_crop || {}),
              cadence: {
                ...defaultTemporalVideoQa.evidence.temporal.supplemental_center_crop.cadence,
                ...(temporalOverride.evidence?.temporal?.supplemental_center_crop?.cadence || {}),
              },
            },
          },
        },
        source_result: {
          ...defaultTemporalVideoQa.source_result,
          ...(temporalOverride.source_result || {}),
        },
      },
      { spaces: 2 },
    );
  }
  if (overrides.finalAvReview !== false) {
    const artefacts = {
      final_mp4: finalMp4Path,
      contact_sheet: contactSheetPath,
      decoded_forensic_report: decodedForensicReportPath,
    };
    const artefactFingerprints = Object.fromEntries(
      Object.entries(artefacts).map(([key, filePath]) => [key, fingerprintFile(filePath).sha256]),
    );
    const defaultReview = {
      schema_version: 1,
      story_id: storyId,
      reviewed_at: "2026-07-15T01:00:00.000Z",
      signed_at: "2026-07-15T01:01:00.000Z",
      reviewer: {
        id: "independent-final-av-reviewer",
        independent: true,
      },
      signoff: {
        reviewer_id: "independent-final-av-reviewer",
        signed_at: "2026-07-15T01:01:00.000Z",
      },
      artefacts,
      reviewed_artefact_fingerprints: artefactFingerprints,
      contact_sheet_binding: {
        contact_sheet_sha256: artefactFingerprints.contact_sheet,
        final_mp4_sha256: artefactFingerprints.final_mp4,
        decoded_forensic_report_sha256: artefactFingerprints.decoded_forensic_report,
        sampled_frames: Array.isArray(decodedForensicReport?.sampled_frames)
          ? decodedForensicReport.sampled_frames.map((frame) => ({
            time_seconds: frame.time_seconds,
            hash: frame.hash,
          }))
          : [],
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
    };
    const reviewOverride = overrides.finalAvReview || {};
    await fs.writeJson(path.join(artifactDir, "final_av_review.json"), {
      ...defaultReview,
      ...reviewOverride,
      reviewer: { ...defaultReview.reviewer, ...(reviewOverride.reviewer || {}) },
      artefacts: { ...defaultReview.artefacts, ...(reviewOverride.artefacts || {}) },
      reviewed_artefact_fingerprints: {
        ...defaultReview.reviewed_artefact_fingerprints,
        ...(reviewOverride.reviewed_artefact_fingerprints || {}),
      },
      contact_sheet_binding: {
        ...defaultReview.contact_sheet_binding,
        ...(reviewOverride.contact_sheet_binding || {}),
      },
      attestations: { ...defaultReview.attestations, ...(reviewOverride.attestations || {}) },
    }, { spaces: 2 });
  }
  return { story_id: storyId, artifact_dir: artifactDir, title: "Forza Horizon 6 Shows Real Footage" };
}

function readyGoal18(storyId) {
  return { stories: [{ story_id: storyId, status: "ready", blockers: [] }] };
}

function blockedGoal18(storyId) {
  return {
    stories: [{
      story_id: storyId,
      status: "blocked",
      blockers: ["upstream:goal17_platform_policy_engine_blocked"],
    }],
  };
}

function skippedGoal18(storyId) {
  return {
    stories: [{
      story_id: storyId,
      status: "skipped",
      skipped_status: "visual_source_deferred",
      skipped_reason: "defer_until_rights_backed_media_available",
      blockers: [],
    }],
  };
}

test("Goal 19 returns RED when the critical final video is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-missing-final-media-"));
  const story = await makeControlStory(root, "story-missing-final-media", { finalMedia: false });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-missing-final-media"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T20:55:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].can_auto_publish, false);
  assert.equal(report.stories[0].control_inputs.render_qa.status, "fail");
  assert.ok(report.stories[0].blockers.includes("control:render_qa_not_pass"));
  assert.equal(report.stories[0].control_inputs.render_qa.evidence.output_exists, false);
});

test("Goal 19 returns RED when the critical final video exists but is not decodable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-corrupt-final-media-"));
  const story = await makeControlStory(root, "story-corrupt-final-media");
  await fs.writeFile(path.join(story.artifact_dir, "visual_v4_render.mp4"), Buffer.from("not an mp4"));

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-corrupt-final-media"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T20:56:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].can_auto_publish, false);
  assert.equal(report.stories[0].control_inputs.render_qa.evidence.output_decodable, false);
  assert.equal(report.stories[0].control_inputs.render_qa.evidence.media_qa_status, "fail");
});

test("Goal 19 requires a valid final AV review control input before GREEN", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-final-av-green-"));
  const story = await makeControlStory(root, "story-final-av-green");

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(story.story_id),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
  });

  assert.ok(REQUIRED_CONTROL_INPUTS.includes("final_av_review"));
  assert.ok(REQUIRED_CONTROL_INPUTS.includes("temporal_video_qa"));
  assert.equal(report.stories[0].control_inputs.temporal_video_qa.status, "pass");
  assert.equal(
    report.stories[0].control_inputs.temporal_video_qa.evidence.render_hash_matches,
    true,
  );
  const finalAvReview = report.stories[0].control_inputs.final_av_review;
  assert.equal(finalAvReview.status, "pass");
  assert.equal(finalAvReview.evidence.fingerprints_verified, true);
  assert.equal(finalAvReview.evidence.reviewer_trusted, true);
  assert.equal(finalAvReview.evidence.contact_sheet_inspection.fully_decoded, true);
  assert.equal(finalAvReview.evidence.contact_sheet_inspection.dimensions_valid, true);
  assert.equal(finalAvReview.evidence.contact_sheet_binding.bound_to_current_media, true);
  assert.equal(finalAvReview.evidence.contact_sheet_binding.independently_verified_frame_hashes, true);
  assert.equal(report.stories[0].final_verdict, "GREEN");
  assert.equal(report.stories[0].can_auto_publish, true);
});

test("Goal 19 returns RED when temporal video QA evidence is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-temporal-missing-"));
  const story = await makeControlStory(root, "story-temporal-missing", {
    temporalVideoQa: false,
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(story.story_id),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
  });

  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].can_auto_publish, false);
  assert.ok(report.stories[0].blockers.includes("control:temporal_video_qa_not_pass"));
  assert.ok(report.stories[0].blockers.includes("temporal_video_qa_report_missing"));
});

test("Goal 19 returns RED when temporal video QA is stale, choppy or repeated", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-temporal-red-"));
  const story = await makeControlStory(root, "story-temporal-red", {
    temporalVideoQa: {
      final_media: { sha256: "f".repeat(64) },
      evidence: {
        temporal: {
          repeated_motion_sequences: [
            {
              first_start_seconds: 3,
              repeat_start_seconds: 20,
              duration_seconds: 2,
            },
          ],
          repeated_motion_seconds: 2,
          cadence: { choppy: true },
        },
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(story.story_id),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
  });

  const temporal = report.stories[0].control_inputs.temporal_video_qa;
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].can_auto_publish, false);
  assert.ok(temporal.blockers.includes("temporal_video_qa_render_hash_mismatch"));
  assert.ok(temporal.blockers.includes("temporal_video_qa_repeated_motion_detected"));
  assert.ok(temporal.blockers.includes("temporal_video_qa_choppy_cadence"));
});

test("Goal 19 returns RED when final_av_review.json is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-final-av-missing-"));
  const story = await makeControlStory(root, "story-final-av-missing", { finalAvReview: false });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(story.story_id),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
  });

  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].can_auto_publish, false);
  assert.ok(report.stories[0].blockers.includes("control:final_av_review_not_pass"));
  assert.ok(report.stories[0].blockers.includes("final_av_review_missing"));
});

test("Goal 19 returns RED for stale MP4, contact-sheet and decoded-forensics hashes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-final-av-stale-"));
  const cases = [
    { id: "stale-final-mp4", key: "final_mp4", file: "visual_v4_render.mp4" },
    { id: "stale-contact-sheet", key: "contact_sheet", file: "final_av_contact_sheet.png" },
    {
      id: "stale-decoded-forensics",
      key: "decoded_forensic_report",
      file: "decoded_forensic_report.json",
    },
  ];
  const stories = [];
  for (const item of cases) {
    const story = await makeControlStory(root, item.id);
    await fs.appendFile(path.join(story.artifact_dir, item.file), Buffer.from("\n"));
    stories.push(story);
  }

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: stories,
    upstreamFirewallReport: { stories: stories.map((story) => ({
      story_id: story.story_id,
      status: "ready",
      blockers: [],
    })) },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
  });

  for (const item of cases) {
    const row = report.stories.find((story) => story.story_id === item.id);
    assert.equal(row.final_verdict, "RED", item.key);
    assert.equal(row.can_auto_publish, false, item.key);
    assert.ok(
      row.blockers.includes(`reviewed_artefact_fingerprint_mismatch:${item.key}`),
      item.key,
    );
  }
});

test("Goal 19 returns RED for false final AV attestations, non-independent review or a critical defect", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-final-av-claims-"));
  const falseAttestations = {
    full_watch: false,
    full_listen: false,
    av_sync: false,
    caption_readability: false,
    subject_match: false,
  };
  const stories = [
    await makeControlStory(root, "false-attestations", {
      finalAvReview: { attestations: falseAttestations },
    }),
    await makeControlStory(root, "non-independent-reviewer", {
      finalAvReview: { reviewer: { id: "render-operator", independent: false } },
    }),
    await makeControlStory(root, "critical-final-av-defect", {
      finalAvReview: {
        defects: [{ severity: "critical", code: "unreadable_captions" }],
      },
    }),
  ];

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: stories,
    upstreamFirewallReport: { stories: stories.map((story) => ({
      story_id: story.story_id,
      status: "ready",
      blockers: [],
    })) },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
  });

  const attestations = report.stories.find((story) => story.story_id === "false-attestations");
  for (const key of Object.keys(falseAttestations)) {
    assert.ok(attestations.blockers.includes(`final_av_review_attestation_not_true:${key}`), key);
  }
  const reviewer = report.stories.find((story) => story.story_id === "non-independent-reviewer");
  assert.ok(reviewer.blockers.includes("final_av_review_reviewer_not_independent"));
  const defect = report.stories.find((story) => story.story_id === "critical-final-av-defect");
  assert.ok(defect.blockers.includes("final_av_review_critical_defect"));
  assert.ok(report.stories.every((story) => story.final_verdict === "RED"));
  assert.ok(report.stories.every((story) => story.can_auto_publish === false));
});

test("Goal 19 preserves an authoritative RED on structurally valid canonical evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-red-canonical-"));
  const story = await makeControlStory(root, "story-red-canonical", {
    canonical: { verdict: "RED" },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-red-canonical"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T20:57:00.000Z",
  });

  assert.equal(report.stories[0].control_inputs.canonical_story_manifest.status, "fail");
  assert.ok(report.stories[0].blockers.includes("control:critical_input_red"));
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].can_auto_publish, false);
});

test("Goal 19 rejects a stale claim inventory that contradicts the canonical manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-stale-claims-"));
  const story = await makeControlStory(root, "story-stale-claims", {
    claimInventory: {
      schema_version: 1,
      story_id: "story-stale-claims",
      confirmed: [],
      unconfirmed: [],
      prohibited: [],
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-stale-claims"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-18T08:35:00.000Z",
  });

  assert.equal(report.stories[0].control_inputs.claim_inventory.status, "fail");
  assert.ok(report.stories[0].blockers.includes("control:claim_inventory_inconsistent"));
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].can_auto_publish, false);
});

test("Goal 19 preserves authoritative RED across render, director and affiliate evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-red-critical-inputs-"));
  const cases = [
    {
      id: "red-render",
      input: "render_qa",
      overrides: {
        renderManifest: {
          verdict: "RED",
          final_publish_render: true,
          output_path: "visual_v4_render.mp4",
          quality_gate_status: "pass",
          safety: { no_publish_triggered: true },
        },
      },
    },
    {
      id: "red-director",
      input: "director_plan",
      overrides: {
        directorPlan: {
          verdict: "RED",
          readiness: { status: "ready", blockers: [] },
          shot_plan: [{ id: "hook", kind: "motion_clip" }],
        },
      },
    },
    {
      id: "red-affiliate",
      input: "affiliate_disclosure_report",
      overrides: {
        affiliate: {
          verdict: "RED",
          disclosure_required: true,
          disclosure_copy: { short: "Affiliate links may earn us a commission." },
          failures: [],
        },
      },
    },
  ];

  for (const item of cases) {
    const story = await makeControlStory(root, item.id, item.overrides);
    const report = await buildGoal19AutonomyControlTower({
      storyPackages: [story],
      upstreamFirewallReport: readyGoal18(item.id),
      workspaceRoot: root,
      outputDir: path.join(root, `out-${item.id}`),
      generatedAt: "2026-07-14T20:58:00.000Z",
    });
    assert.equal(report.stories[0].control_inputs[item.input].status, "fail", item.input);
    assert.ok(report.stories[0].blockers.includes("control:critical_input_red"), item.input);
    assert.equal(report.stories[0].final_verdict, "RED", item.input);
  }
});

test("Goal 19 cannot hide a failed render-bound rights reconciliation behind a GREEN ledger", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-render-rights-red-"));
  const storyId = "render-rights-red";
  const story = await makeControlStory(root, storyId);
  const renderPath = path.join(story.artifact_dir, "render_manifest.json");
  const rightsPath = path.join(story.artifact_dir, "rights_ledger.json");
  const render = await fs.readJson(renderPath);
  const rightsFingerprint = await fingerprintFile(rightsPath);
  await fs.outputJson(renderPath, {
    ...render,
    rights_reconciliation: {
      verdict: "FAIL",
      blockers: ["used_asset_rights_coverage_incomplete"],
      rights_ledger_path: rightsPath,
      applied_ledger_sha256: rightsFingerprint.sha256,
      applied_ledger_size_bytes: rightsFingerprint.size_bytes,
      applied_ledger_verdict: "FAIL",
      used_asset_count: 3,
      reconciled_record_count: 2,
      final_state_verified: true,
      can_auto_publish: false,
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(storyId),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-18T19:15:00.000Z",
  });

  const result = report.stories[0];
  assert.equal(result.control_inputs.rights_ledger.status, "fail");
  assert.ok(
    result.control_inputs.rights_ledger.evidence.failures.includes(
      "render_rights_reconciliation:used_asset_rights_coverage_incomplete",
    ),
  );
  assert.equal(result.final_verdict, "RED");
  assert.equal(result.can_auto_publish, false);
});

test("Goal 19 rejects a stale render-bound rights ledger fingerprint", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-render-rights-stale-"));
  const storyId = "render-rights-stale";
  const story = await makeControlStory(root, storyId);
  const renderPath = path.join(story.artifact_dir, "render_manifest.json");
  const rightsPath = path.join(story.artifact_dir, "rights_ledger.json");
  const render = await fs.readJson(renderPath);
  const rightsFingerprint = await fingerprintFile(rightsPath);
  await fs.outputJson(renderPath, {
    ...render,
    rights_reconciliation: {
      verdict: "PASS",
      blockers: [],
      warnings: [],
      rights_ledger_path: rightsPath,
      applied_ledger_sha256: "0".repeat(64),
      applied_ledger_size_bytes: rightsFingerprint.size_bytes,
      applied_ledger_verdict: "PASS",
      used_asset_count: 3,
      reconciled_record_count: 3,
      final_state_verified: true,
      can_auto_publish: true,
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(storyId),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-18T19:20:00.000Z",
  });

  const result = report.stories[0];
  assert.equal(result.control_inputs.rights_ledger.status, "fail");
  assert.ok(
    result.control_inputs.rights_ledger.evidence.failures.includes(
      "render_rights_reconciliation:ledger_hash_mismatch",
    ),
  );
  assert.equal(result.final_verdict, "RED");
  assert.equal(result.can_auto_publish, false);
});

test("Goal 19 caps an AMBER render-bound rights reconciliation at AMBER", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-render-rights-amber-"));
  const storyId = "render-rights-amber";
  const story = await makeControlStory(root, storyId);
  const renderPath = path.join(story.artifact_dir, "render_manifest.json");
  const rightsPath = path.join(story.artifact_dir, "rights_ledger.json");
  const render = await fs.readJson(renderPath);
  const rightsFingerprint = await fingerprintFile(rightsPath);
  await fs.outputJson(renderPath, {
    ...render,
    rights_reconciliation: {
      verdict: "AMBER",
      blockers: [],
      warnings: ["rights_provenance_requires_review"],
      rights_ledger_path: rightsPath,
      applied_ledger_sha256: rightsFingerprint.sha256,
      applied_ledger_size_bytes: rightsFingerprint.size_bytes,
      applied_ledger_verdict: "AMBER",
      used_asset_count: 3,
      reconciled_record_count: 3,
      final_state_verified: true,
      can_auto_publish: false,
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(storyId),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-18T19:25:00.000Z",
  });

  const result = report.stories[0];
  assert.equal(result.control_inputs.rights_ledger.status, "amber");
  assert.ok(
    result.control_inputs.rights_ledger.warnings.includes(
      "render_rights_reconciliation:rights_provenance_requires_review",
    ),
  );
  assert.equal(result.final_verdict, "AMBER");
  assert.equal(result.can_auto_publish, false);
});

test("Goal 19 does not require an affiliate manifest when commercial disclosure is explicitly not required", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-no-affiliate-required-"));
  const storyId = "non-commercial-editorial-story";
  const story = await makeControlStory(root, storyId, {
    canonical: {
      commercial_intelligence: { disclosure_required: false },
    },
    affiliate: [],
    platformManifest: {
      publish_status: "GREEN",
      can_auto_publish: true,
      outputs: {
        youtube_shorts: {
          title: "Forza Horizon 6 Shows Real Footage",
          disclosure_status: { required: false, type: "none" },
        },
        tiktok: {
          caption: "Source: Xbox.",
          disclosure_status: { required: false, type: "none" },
        },
      },
      governance_gates: {
        public_output_coherence_gate: passGate(),
        rights_ledger: passGate(),
        platform_policy_gate: passGate(),
        affiliate_disclosure_gate: passGate(),
        reused_content_risk_gate: passGate(),
        anti_spam_uniqueness_gate: passGate(),
        finance_crypto_firewall: passGate(),
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(storyId),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-15T14:25:00.000Z",
  });

  const disclosure = report.stories[0].control_inputs.affiliate_disclosure_report;
  assert.equal(disclosure.status, "pass", JSON.stringify(disclosure, null, 2));
  assert.equal(disclosure.evidence.disclosure_required, false);
  assert.equal(disclosure.evidence.present, false);
  assert.ok(!report.stories[0].blockers.includes("control:affiliate_disclosure_not_pass"));
});

test("Goal 19 rejects a final render that omits scene, narration and timestamp lineage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-missing-render-lineage-"));
  const story = await makeControlStory(root, "story-missing-render-lineage", {
    renderManifest: {
      final_publish_render: true,
      output_path: "visual_v4_render.mp4",
      quality_gate_status: "pass",
      safety: { no_publish_triggered: true },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-missing-render-lineage"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T20:58:30.000Z",
  });

  const renderQa = report.stories[0].control_inputs.render_qa;
  assert.equal(renderQa.status, "fail");
  assert.ok(renderQa.evidence.failures.includes("render:final_scene_inventory_missing"));
  assert.ok(renderQa.evidence.failures.includes("audio:final_narration_input_missing"));
  assert.ok(renderQa.evidence.failures.includes("captions:final_word_timestamps_input_missing"));
  assert.equal(report.stories[0].final_verdict, "RED");
});

test("Goal 19 rejects a bare passing rights verdict without used-asset records", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-bare-rights-"));
  const story = await makeControlStory(root, "story-bare-rights", {
    rightsLedger: { verdict: "pass", failures: [] },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-bare-rights"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T20:59:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].control_inputs.rights_ledger.status, "fail");
  assert.equal(report.stories[0].control_inputs.rights_ledger.evidence.rights_record_count, 0);
  assert.ok(report.stories[0].blockers.includes("control:rights_ledger_not_pass"));
});

test("Goal 19 rejects rights records that do not cover every used motion asset", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-incomplete-rights-"));
  const story = await makeControlStory(root, "story-incomplete-rights", {
    footageInventory: {
      verdict: "pass",
      failures: [],
      blockers: [],
      motion_asset_count: 1,
      distinct_motion_family_count: 1,
      materialised_motion_clips: [{
        id: "used-clip",
        path: "motion/used-clip.mp4",
        source_url: "https://publisher.example/used-clip",
        source_family: "official_gameplay",
      }],
    },
    rightsLedger: {
      verdict: "pass",
      failures: [],
      records: [{
        asset_id: "different-clip",
        path: "motion/different-clip.mp4",
        source_url: "https://publisher.example/different-clip",
        source_type: "official_direct_media",
        source_owner: "Official publisher",
        licence_basis: "official_promotional_media_transformative_editorial_use",
        allowed_platforms: ["youtube_shorts", "tiktok"],
        commercial_use_allowed: true,
        evidence_file: "rights/different-clip.json",
      }],
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-incomplete-rights"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:00:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(rights.status, "fail");
  assert.equal(rights.evidence.used_asset_count, 2);
  assert.equal(rights.evidence.matched_asset_count, 0);
  assert.deepEqual(rights.evidence.missing_asset_ids, [
    "used-clip",
    "story-incomplete-rights_audio_path",
  ]);
});

test("Goal 19 rejects incomplete rights records for a used motion asset", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-incomplete-rights-record-"));
  const story = await makeControlStory(root, "story-incomplete-rights-record", {
    rightsLedger: {
      verdict: "pass",
      failures: [],
      records: [{
        asset_id: "clip-a",
        path: "motion/clip-a.mp4",
        source_url: "https://www.xbox.com/games/forza-horizon-6",
        allowed_platforms: ["youtube_shorts", "tiktok"],
      }],
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-incomplete-rights-record"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:01:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(rights.status, "fail");
  assert.ok(rights.evidence.incomplete_record_reasons.includes("rights:licence_basis_missing"));
  assert.ok(rights.evidence.incomplete_record_reasons.includes("rights:commercial_use_unclear_or_not_allowed"));
  assert.ok(rights.evidence.incomplete_record_reasons.includes("rights:evidence_missing"));
});

test("Goal 19 rejects a stale SHA-256 for a final-used asset", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-stale-rights-hash-"));
  const story = await makeControlStory(root, "story-stale-rights-hash");
  const ledgerPath = path.join(story.artifact_dir, "rights_ledger.json");
  const ledger = await fs.readJson(ledgerPath);

  for (const record of ledger.records) {
    const assetPath = path.resolve(story.artifact_dir, record.path);
    const evidencePath = path.resolve(story.artifact_dir, record.evidence_file);
    const assetBytes = Buffer.from(`asset:${record.asset_id}`);
    const evidenceBytes = Buffer.from(`evidence:${record.asset_id}`);
    await fs.outputFile(assetPath, assetBytes);
    await fs.outputFile(evidencePath, evidenceBytes);
    record.asset_sha256 = sha256(assetBytes);
    record.asset_size_bytes = assetBytes.length;
    record.evidence_sha256 = sha256(evidenceBytes);
    record.evidence_size_bytes = evidenceBytes.length;
  }
  ledger.records[0].asset_sha256 = "0".repeat(64);
  await fs.writeJson(ledgerPath, ledger, { spaces: 2 });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-stale-rights-hash"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-15T00:10:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(rights.status, "fail");
  assert.ok(rights.evidence.incomplete_record_reasons.includes("rights:asset_hash_mismatch"));
});

test("Goal 19 rejects missing final-used asset and evidence fingerprints", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-missing-rights-hashes-"));
  const story = await makeControlStory(root, "story-missing-rights-hashes");
  const ledgerPath = path.join(story.artifact_dir, "rights_ledger.json");
  const ledger = await fs.readJson(ledgerPath);
  delete ledger.records[0].asset_sha256;
  delete ledger.records[0].asset_size_bytes;
  delete ledger.records[0].evidence_sha256;
  delete ledger.records[0].evidence_size_bytes;
  await fs.writeJson(ledgerPath, ledger, { spaces: 2 });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-missing-rights-hashes"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-15T00:11:00.000Z",
  });

  const reasons = report.stories[0].control_inputs.rights_ledger.evidence.incomplete_record_reasons;
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.ok(reasons.includes("rights:asset_hash_missing_or_invalid"));
  assert.ok(reasons.includes("rights:asset_size_missing_or_invalid"));
  assert.ok(reasons.includes("rights:evidence_hash_missing_or_invalid"));
  assert.ok(reasons.includes("rights:evidence_size_missing_or_invalid"));
});

test("Goal 19 binds rights evidence to the selected final-used asset path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-selected-rights-path-"));
  const story = await makeControlStory(root, "story-selected-rights-path");
  const ledgerPath = path.join(story.artifact_dir, "rights_ledger.json");
  const ledger = await fs.readJson(ledgerPath);
  const selectedPath = path.join(story.artifact_dir, "motion", "clip-a.mp4");
  const donorPath = path.join(story.artifact_dir, "motion", "same-id-donor.mp4");
  const donorBytes = Buffer.from("same asset ID, different file");

  await fs.remove(selectedPath);
  await fs.outputFile(donorPath, donorBytes);
  ledger.records = ledger.records.map((record) => ({
    ...record,
    approval_status: "approved_for_transformative_editorial_use",
    verdict: "GREEN",
  }));
  ledger.records[0] = {
    ...ledger.records[0],
    path: "motion/same-id-donor.mp4",
    asset_sha256: sha256(donorBytes),
    asset_size_bytes: donorBytes.length,
  };
  await fs.writeJson(ledgerPath, ledger, { spaces: 2 });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(story.story_id),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-15T09:20:00.000Z",
  });

  const result = report.stories[0];
  const rights = result.control_inputs.rights_ledger;
  assert.equal(result.final_verdict, "RED");
  assert.equal(result.can_auto_publish, false);
  assert.equal(rights.status, "fail");
  assert.ok(rights.evidence.incomplete_record_reasons.includes("rights:asset_path_mismatch"));
  assert.ok(rights.evidence.incomplete_record_reasons.includes("rights:asset_file_missing_or_unreadable"));
});

test("Goal 19 rejects final-used rights records without a positive per-record decision", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-rights-decision-"));
  const story = await makeControlStory(root, "story-rights-decision");
  const ledgerPath = path.join(story.artifact_dir, "rights_ledger.json");
  const ledger = await fs.readJson(ledgerPath);

  ledger.records = ledger.records.map((record) => ({
    ...record,
    approval_status: "approved_for_transformative_editorial_use",
    verdict: "GREEN",
  }));
  ledger.records[0].approval_status = "REJECTED";
  ledger.records[0].verdict = "RED";
  await fs.writeJson(ledgerPath, ledger, { spaces: 2 });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(story.story_id),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-15T09:21:00.000Z",
  });

  const result = report.stories[0];
  const rights = result.control_inputs.rights_ledger;
  assert.equal(result.final_verdict, "RED");
  assert.equal(result.can_auto_publish, false);
  assert.equal(rights.status, "fail");
  assert.ok(rights.evidence.incomplete_record_reasons.includes("rights:approval_status_not_approved"));
  assert.ok(rights.evidence.incomplete_record_reasons.includes("rights:verdict_not_pass"));
});

test("Goal 19 rejects narration changed after the final render fingerprint was stamped", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-stale-render-audio-"));
  const story = await makeControlStory(root, "story-stale-render-audio");
  await fs.writeFile(
    path.join(story.artifact_dir, "audio", "narration.mp3"),
    Buffer.from("narration changed after render"),
  );

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-stale-render-audio"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-15T00:12:00.000Z",
  });

  const renderQa = report.stories[0].control_inputs.render_qa;
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.ok(renderQa.evidence.failures.includes("final_render_audio_fingerprint_mismatch"));
});

test("Goal 19 scopes final-render rights to enabled live platforms while derivative channels stay deferred", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-platform-rights-alias-"));
  const story = await makeControlStory(root, "story-platform-rights-alias", {
    rightsLedger: {
      verdict: "pass",
      failures: [],
      records: [
        ...["clip-a", "clip-b"].map((assetId) => ({
          asset_id: assetId,
          path: `motion/${assetId}.mp4`,
          licence_basis: "official_promotional_media_transformative_editorial_use",
          allowed_platforms: ["youtube", "instagram", "facebook"],
          commercial_use_allowed: true,
          evidence_file: `rights/${assetId}.json`,
          approval_status: "approved_for_transformative_editorial_use",
          verdict: "GREEN",
        })),
        narrationRightsRecord("story-platform-rights-alias", ["youtube", "instagram", "facebook"]),
      ],
    },
    platformManifest: {
      publish_status: "GREEN",
      can_auto_publish: true,
      outputs: {
        youtube_shorts: { title: "Native YouTube title" },
        instagram_reels: { caption: "Native Instagram caption" },
        facebook_reels: { caption: "Native Facebook caption" },
        x: { post: "Prepared derivative only" },
        threads: { post: "Prepared derivative only" },
        pinterest: { pin: "Prepared derivative only" },
      },
      governance_gates: {
        public_output_coherence_gate: passGate(),
        rights_ledger: passGate(),
        platform_policy_gate: passGate(),
        affiliate_disclosure_gate: passGate(),
        reused_content_risk_gate: passGate(),
        anti_spam_uniqueness_gate: passGate(),
        finance_crypto_firewall: passGate(),
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-platform-rights-alias"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:12:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(rights.status, "pass", JSON.stringify(rights, null, 2));
  assert.equal(rights.evidence.incomplete_record_reasons.includes("rights:platform_not_allowed"), false);
});

test("Goal 19 requires rights for an explicitly enabled derivative platform", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-explicit-platform-rights-"));
  const story = await makeControlStory(root, "story-explicit-platform-rights", {
    rightsLedger: {
      verdict: "pass",
      failures: [],
      records: [
        ...["clip-a", "clip-b"].map((assetId) => ({
          asset_id: assetId,
          path: `motion/${assetId}.mp4`,
          licence_basis: "official_promotional_media_transformative_editorial_use",
          allowed_platforms: ["youtube", "instagram", "facebook"],
          commercial_use_allowed: true,
          evidence_file: `rights/${assetId}.json`,
        })),
        narrationRightsRecord("story-explicit-platform-rights", ["youtube", "instagram", "facebook"]),
      ],
    },
    platformManifest: {
      publish_status: "GREEN",
      can_auto_publish: true,
      enabled_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels", "x"],
      outputs: {
        youtube_shorts: { title: "Native YouTube title" },
        instagram_reels: { caption: "Native Instagram caption" },
        facebook_reels: { caption: "Native Facebook caption" },
        x: { post: "Explicitly enabled derivative" },
      },
      governance_gates: {
        public_output_coherence_gate: passGate(),
        rights_ledger: passGate(),
        platform_policy_gate: passGate(),
        affiliate_disclosure_gate: passGate(),
        reused_content_risk_gate: passGate(),
        anti_spam_uniqueness_gate: passGate(),
        finance_crypto_firewall: passGate(),
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-explicit-platform-rights"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:13:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(rights.status, "fail");
  assert.ok(rights.evidence.required_platforms.includes("x"));
  assert.ok(rights.evidence.incomplete_record_reasons.includes("rights:platform_not_allowed"));
});

test("Goal 19 does not reuse one rights record for two used assets sharing a source URL", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-one-to-one-rights-"));
  const sharedSource = "https://www.playstation.com/en-gb/games/marvel-tokon/";
  const story = await makeControlStory(root, "story-one-to-one-rights", {
    footageInventory: {
      verdict: "pass",
      failures: [],
      blockers: [],
      motion_asset_count: 2,
      distinct_motion_family_count: 2,
      materialised_motion_clips: [
        { id: "clip-one", path: "motion/clip-one.mp4", source_url: sharedSource },
        { id: "clip-two", path: "motion/clip-two.mp4", source_url: sharedSource },
      ],
    },
    rightsLedger: {
      verdict: "pass",
      failures: [],
      records: [
        {
          asset_id: "clip-one",
          path: "motion/clip-one.mp4",
          source_url: sharedSource,
          licence_basis: "official_promotional_media_transformative_editorial_use",
          commercial_use_allowed: true,
          allowed_platforms: ["youtube_shorts", "tiktok"],
          evidence_file: "rights/clip-one.json",
        },
        narrationRightsRecord("story-one-to-one-rights"),
      ],
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-one-to-one-rights"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:13:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(rights.status, "fail");
  assert.equal(rights.evidence.used_asset_count, 3);
  assert.equal(rights.evidence.matched_asset_count, 2);
  assert.deepEqual(rights.evidence.missing_asset_ids, ["clip-two"]);
  assert.equal(report.stories[0].final_verdict, "RED");
});

test("Goal 19 deduplicates the same logical rights row across ledger aliases", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-duplicate-rights-alias-"));
  const sharedSource = "https://www.playstation.com/en-gb/games/marvel-tokon/";
  const rightsRecord = {
    asset_id: "clip-one",
    path: "motion/clip-one.mp4",
    source_url: sharedSource,
    licence_basis: "official_promotional_media_transformative_editorial_use",
    commercial_use_allowed: true,
    allowed_platforms: ["youtube_shorts", "tiktok"],
    evidence_file: "rights/clip-one.json",
  };
  const story = await makeControlStory(root, "story-duplicate-rights-alias", {
    footageInventory: {
      verdict: "pass",
      failures: [],
      blockers: [],
      motion_asset_count: 2,
      distinct_motion_family_count: 2,
      materialised_motion_clips: [
        { id: "clip-one", path: "motion/clip-one.mp4", source_url: sharedSource },
        { id: "clip-two", path: "motion/clip-two.mp4", source_url: sharedSource },
      ],
    },
    rightsLedger: {
      verdict: "pass",
      failures: [],
      records: [rightsRecord, narrationRightsRecord("story-duplicate-rights-alias")],
      rights_ledger: [{ ...rightsRecord }],
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-duplicate-rights-alias"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:13:30.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(rights.status, "fail");
  assert.equal(rights.evidence.rights_record_count, 2);
  assert.equal(rights.evidence.matched_asset_count, 2);
  assert.deepEqual(rights.evidence.missing_asset_ids, ["clip-two"]);
  assert.equal(report.stories[0].final_verdict, "RED");
});

test("Goal 19 requires rights coverage for clips selected by the final render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-render-scene-rights-"));
  const story = await makeControlStory(root, "story-render-scene-rights", {
    renderManifest: {
      final_publish_render: true,
      output_path: "visual_v4_render.mp4",
      quality_gate_status: "pass",
      clip_scene_plan: {
        scenes: [{ path: "motion/render-only.mp4" }],
      },
      safety: { no_publish_triggered: true },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-render-scene-rights"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:14:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(rights.status, "fail");
  assert.equal(rights.evidence.used_asset_count, 1);
  assert.equal(rights.evidence.matched_asset_count, 0);
  assert.deepEqual(rights.evidence.missing_asset_ids, ["render_scene_1"]);
  assert.equal(report.stories[0].final_verdict, "RED");
});

test("Goal 19 requires rights coverage for narration selected by the final render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-render-narration-rights-"));
  const story = await makeControlStory(root, "story-render-narration-rights", {
    renderManifest: {
      final_publish_render: true,
      output_path: "visual_v4_render.mp4",
      quality_gate_status: "pass",
      input_evidence: {
        resolved_narration_audio_path: "audio/final-narration.mp3",
        resolved_word_timestamps_path: "audio/word-timestamps.json",
      },
      safety: { no_publish_triggered: true },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-render-narration-rights"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:15:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(rights.status, "fail");
  assert.equal(rights.evidence.used_asset_count, 3);
  assert.equal(rights.evidence.matched_asset_count, 2);
  assert.deepEqual(rights.evidence.missing_asset_ids, ["final_narration_audio"]);
  assert.equal(report.stories[0].final_verdict, "RED");
});

test("Goal 19 requires rights coverage for SFX selected for the final mix", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-sfx-rights-"));
  const story = await makeControlStory(root, "story-sfx-rights", {
    sfxManifest: {
      cue_count: 1,
      source_plan: {
        selected_assets: [{
          asset_id: "licensed-impact",
          source_url: "file:///audio/licensed-impact.wav",
        }],
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-sfx-rights"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:16:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(rights.status, "fail");
  assert.equal(rights.evidence.used_asset_count, 4);
  assert.equal(rights.evidence.matched_asset_count, 3);
  assert.deepEqual(rights.evidence.missing_asset_ids, ["licensed-impact"]);
  assert.equal(report.stories[0].final_verdict, "RED");
});

test("Goal 19 requires rights coverage for enabled platform-native final variants", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-platform-native-rights-"));
  const storyId = "story-platform-native-rights";
  const artifactDir = path.join(root, storyId);
  const instagramVariantPath = path.join(artifactDir, "platform", "instagram-reels.mp4");
  const facebookVariantPath = path.join(artifactDir, "platform", "facebook-reels.mp4");
  const allowedPlatforms = ["youtube_shorts", "instagram_reels", "facebook_reels"];
  const story = await makeControlStory(root, storyId, {
    rightsLedger: {
      verdict: "pass",
      failures: [],
      records: [
        {
          asset_id: "clip-a",
          path: "motion/clip-a.mp4",
          source_url: "https://www.xbox.com/games/forza-horizon-6",
          source_type: "official_direct_media",
          source_owner: "Official publisher",
          licence_basis: "official_promotional_media_transformative_editorial_use",
          allowed_platforms: allowedPlatforms,
          commercial_use_allowed: true,
          evidence_file: "rights/clip-a.json",
          approval_status: "approved_for_transformative_editorial_use",
          verdict: "GREEN",
          risk_score: 0.1,
        },
        {
          asset_id: "clip-b",
          path: "motion/clip-b.mp4",
          source_url: "https://store.steampowered.com/app/example",
          source_type: "official_direct_media",
          source_owner: "Official publisher",
          licence_basis: "official_promotional_media_transformative_editorial_use",
          allowed_platforms: allowedPlatforms,
          commercial_use_allowed: true,
          evidence_file: "rights/clip-b.json",
          approval_status: "approved_for_transformative_editorial_use",
          verdict: "GREEN",
          risk_score: 0.1,
        },
        narrationRightsRecord(storyId, allowedPlatforms),
      ],
    },
    platformManifest: {
      publish_status: "GREEN",
      can_auto_publish: true,
      enabled_platforms: allowedPlatforms,
      outputs: {
        youtube_shorts: { title: "Forza Horizon 6 Shows Real Footage" },
        instagram_reels: { variant_video_path: instagramVariantPath },
        facebook_reels: { variant_video_path: facebookVariantPath },
      },
      governance_gates: {
        public_output_coherence_gate: passGate(),
        rights_ledger: passGate(),
        platform_policy_gate: passGate(),
        affiliate_disclosure_gate: passGate(),
        reused_content_risk_gate: passGate(),
        anti_spam_uniqueness_gate: passGate(),
        finance_crypto_firewall: passGate(),
      },
    },
  });
  await fs.outputFile(instagramVariantPath, Buffer.from("instagram variant"));
  await fs.outputFile(facebookVariantPath, Buffer.from("facebook variant"));

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(storyId),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-15T05:00:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(rights.status, "fail");
  assert.equal(rights.evidence.used_asset_count, 5);
  assert.equal(rights.evidence.matched_asset_count, 3);
  assert.deepEqual(rights.evidence.missing_asset_ids.sort(), [
    "platform-native-facebook_reels",
    "platform-native-instagram_reels",
  ]);
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].can_auto_publish, false);

  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const repairedRights = await fs.readJson(rightsPath);
  repairedRights.records.push(
    {
      asset_id: "platform-native-instagram_reels",
      kind: "platform_native",
      path: instagramVariantPath,
      licence_basis: "derived_platform_variant_of_fully_rights_covered_final_render",
      commercial_use_allowed: true,
      allowed_platforms: allowedPlatforms,
      evidence_file: "platform_publish_manifest.json",
      approval_status: "approved_for_platform_native_transcode",
      verdict: "GREEN",
    },
    {
      asset_id: "platform-native-facebook_reels",
      kind: "platform_native",
      path: facebookVariantPath,
      licence_basis: "derived_platform_variant_of_fully_rights_covered_final_render",
      commercial_use_allowed: true,
      allowed_platforms: allowedPlatforms,
      evidence_file: "platform_publish_manifest.json",
      approval_status: "approved_for_platform_native_transcode",
      verdict: "GREEN",
    },
  );
  await materialiseRightsFixture(artifactDir, repairedRights);
  await fs.writeJson(rightsPath, repairedRights, { spaces: 2 });

  const repairedReport = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18(storyId),
    workspaceRoot: root,
    outputDir: path.join(root, "repaired-out"),
    generatedAt: "2026-07-15T05:01:00.000Z",
  });
  const repairedRightsCheck = repairedReport.stories[0].control_inputs.rights_ledger;
  assert.equal(repairedRightsCheck.status, "pass");
  assert.equal(repairedRightsCheck.evidence.used_asset_count, 5);
  assert.equal(repairedRightsCheck.evidence.matched_asset_count, 5);
  assert.equal(repairedRightsCheck.evidence.materially_verified_asset_count, 5);
  assert.deepEqual(repairedRightsCheck.evidence.missing_asset_ids, []);
});

test("Goal 19 rejects an SFX mix that omits its selected-asset inventory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-sfx-inventory-"));
  const story = await makeControlStory(root, "story-sfx-inventory", {
    sfxManifest: {
      cue_count: 3,
      cues: [{ id: "impact" }, { id: "whoosh" }, { id: "tick" }],
      source_plan: { selected_assets: [] },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-sfx-inventory"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:17:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(rights.status, "fail");
  assert.ok(rights.evidence.failures.includes("rights:sfx_selected_asset_inventory_missing"));
  assert.equal(report.stories[0].final_verdict, "RED");
});

test("Goal 19 requires rights records for ledger-declared used audio assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-used-audio-rights-"));
  const story = await makeControlStory(root, "story-used-audio-rights");
  const rightsPath = path.join(story.artifact_dir, "rights_ledger.json");
  const rightsLedger = await fs.readJson(rightsPath);
  await fs.writeJson(rightsPath, {
    ...rightsLedger,
    assets: [{
      asset_id: "music-bed",
      path: "audio/music-bed.wav",
      kind: "music",
      used_in_final_render: true,
    }],
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-used-audio-rights"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:07:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(rights.status, "fail");
  assert.ok(rights.evidence.missing_asset_ids.includes("music-bed"));
});

test("Goal 19 does not treat unselected rights inventory as final-render usage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-unused-rights-inventory-"));
  const story = await makeControlStory(root, "story-unused-rights-inventory");
  const rightsPath = path.join(story.artifact_dir, "rights_ledger.json");
  const rightsLedger = await fs.readJson(rightsPath);
  await fs.writeJson(rightsPath, {
    ...rightsLedger,
    assets: [{
      asset_id: "unused-library-asset",
      path: "library/unused.mp4",
      kind: "video",
    }],
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-unused-rights-inventory"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:18:00.000Z",
  });

  const rights = report.stories[0].control_inputs.rights_ledger;
  assert.equal(rights.status, "pass");
  assert.equal(rights.evidence.used_asset_count, 3);
  assert.equal(rights.evidence.matched_asset_count, 3);
  assert.deepEqual(rights.evidence.missing_asset_ids, []);
});

test("Goal 19 emits RED final verdicts when Goal 18 is blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-upstream-"));
  const story = await makeControlStory(root, "story-upstream");

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: blockedGoal18("story-upstream"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:07:13.497Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_control_tower_verdict, "PASS");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.green_story_count, 0);
  assert.equal(report.summary.red_story_count, 1);
  assert.equal(report.summary.publish_now_count, 0);
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].direct_control_tower_status, "pass");
  assert.ok(report.stories[0].blockers.includes("upstream:goal18_finance_crypto_firewall_blocked"));
  for (const input of REQUIRED_CONTROL_INPUTS) {
    assert.equal(report.stories[0].control_inputs[input].status, "pass", input);
  }
  assert.equal(report.publish_verdict.publish_now_count, 0);
  assert.equal(report.publish_verdict.stories[0].can_auto_publish, false);
  assert.equal(report.rejection_reasons.stories[0].upstream_reasons.length, 2);
});

test("Goal 19 excludes upstream-skipped stories from active control tower blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-skipped-"));
  const readyStory = await makeControlStory(root, "story-ready");
  const skippedStory = await makeControlStory(root, "story-skipped", {
    scriptScorecard: { verdict: "rewrite_required", blockers: ["slow_hook"], viral_score: 41 },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [readyStory, skippedStory],
    upstreamFirewallReport: {
      stories: [
        { story_id: "story-ready", status: "ready", blockers: [] },
        ...skippedGoal18("story-skipped").stories,
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T01:36:00.000Z",
  });

  const skipped = report.stories.find((story) => story.story_id === "story-skipped");

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_control_tower_verdict, "PASS");
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.active_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.green_story_count, 1);
  assert.equal(skipped.status, "skipped");
  assert.deepEqual(report.blocker_counts, {});
  assert.equal(report.publish_verdict.stories.length, 1);
  assert.equal(report.rejection_reasons.stories.length, 1);
});

test("Goal 19 accepts final viral script verdicts and materialised footage evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-local-contract-"));
  const story = await makeControlStory(root, "story-local-contract", {
    scriptScorecard: {
      verdict: "viral_ready",
      viral_score: 83,
      blockers: [],
      warnings: [],
      scores: { hook_strength: 82, curiosity_gap: 87 },
    },
    footageInventory: {
      readiness: {
        status: "ready",
        blockers: [],
      },
      motion_budget: {
        required_motion_scenes: 5,
        required_distinct_families: 4,
      },
      motion_inventory: {
        accepted_local_clips: [
          { id: "clip-1", path: "clip-1.mp4", source_url: "https://store.example/a", source_family: "official_store_a" },
          { id: "clip-2", path: "clip-2.mp4", source_url: "https://store.example/b", source_family: "official_store_b" },
          { id: "clip-3", path: "clip-3.mp4", source_url: "https://store.example/c", source_family: "official_store_c" },
          { id: "clip-4", path: "clip-4.mp4", source_url: "https://store.example/d", source_family: "official_store_d" },
          { id: "clip-5", path: "clip-5.mp4", source_url: "https://store.example/e", source_family: "official_store_e" },
        ],
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-local-contract"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T01:37:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_control_tower_verdict, "PASS");
  assert.equal(report.stories[0].control_inputs.script_scorecard.status, "pass");
  assert.equal(report.stories[0].control_inputs.footage_inventory.status, "pass");
  assert.deepEqual(report.direct_risk_counts, {});
});

test("Goal 19 blocks scripts still marked tighten before TTS", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-tighten-script-"));
  const story = await makeControlStory(root, "story-tighten-script", {
    scriptScorecard: {
      verdict: "tighten_before_tts",
      viral_score: 83,
      blockers: [],
      warnings: [],
      scores: { hook_strength: 82, curiosity_gap: 87 },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-tighten-script"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-31T04:47:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].control_inputs.script_scorecard.status, "fail");
  assert.ok(report.stories[0].blockers.includes("control:script_scorecard_not_pass"));
});

test("Goal 19 does not let post-render forensics erase RED pre-render evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-post-render-motion-"));
  const story = await makeControlStory(root, "story-post-render-motion", {
    footageInventory: {
      readiness: {
        status: "v4_motion_blocked",
        blockers: ["actual_motion_clip_minimum_not_met"],
      },
      motion_budget: {
        required_motion_scenes: 13,
        required_distinct_families: 6,
        available_motion_clips: 6,
        available_distinct_families: 6,
      },
      motion_inventory: {
        accepted_local_clips: [
          { id: "clip-1", source_url: "https://store.example/a", source_family: "official_store_a" },
          { id: "clip-2", source_url: "https://store.example/b", source_family: "official_store_b" },
          { id: "clip-3", source_url: "https://store.example/c", source_family: "official_store_c" },
          { id: "clip-4", source_url: "https://store.example/d", source_family: "official_store_d" },
          { id: "clip-5", source_url: "https://store.example/e", source_family: "official_store_e" },
          { id: "clip-6", source_url: "https://store.example/f", source_family: "official_store_f" },
        ],
      },
    },
    directorPlan: {
      readiness: { status: "director_blocked", blockers: ["actual_motion_clip_minimum_not_met"] },
      shot_budget: {
        min_actual_motion_clips: 13,
        available_motion_clips: 6,
        min_distinct_motion_families: 6,
        available_distinct_motion_families: 6,
      },
      shot_plan: [
        { id: "hook", kind: "hook_slam" },
        { id: "clip-1", kind: "motion_clip" },
        { id: "clip-2", kind: "motion_clip" },
      ],
    },
    visualQuality: {
      result: "pass",
      failures: [],
      warnings: [],
      benchmark_source: "actual_materialised_motion_clips",
      visual_evidence_profile: {
        motion_asset_count: 39,
        real_motion_asset_count: 13,
        real_media_family_count: 8,
        direct_video_motion_asset_count: 2,
        generated_only_motion_deck: false,
        blockers: [],
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-post-render-motion"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T01:38:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_control_tower_verdict, "BLOCKED");
  assert.equal(report.stories[0].control_inputs.footage_inventory.status, "fail");
  assert.equal(report.stories[0].control_inputs.director_plan.status, "fail");
  assert.ok(report.stories[0].blockers.includes("control:critical_input_red"));
  assert.equal(report.stories[0].final_verdict, "RED");
});

test("Goal 19 caps pending critical motion evidence at AMBER after passing final forensics", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-pending-motion-"));
  const story = await makeControlStory(root, "story-pending-motion", {
    footageInventory: {
      readiness: {
        status: "pending_post_render_forensics",
        blockers: ["actual_motion_clip_minimum_not_met"],
      },
      motion_budget: {
        required_motion_scenes: 2,
        required_distinct_families: 2,
      },
      motion_inventory: {
        accepted_local_clips: [
          { id: "clip-1", path: "clip-1.mp4", source_url: "https://store.example/a", source_family: "official_store_a" },
          { id: "clip-2", path: "clip-2.mp4", source_url: "https://store.example/b", source_family: "official_store_b" },
        ],
      },
    },
    visualQuality: {
      result: "pass",
      failures: [],
      warnings: [],
      benchmark_source: "actual_materialised_motion_clips",
      visual_evidence_profile: {
        real_motion_asset_count: 2,
        real_media_family_count: 2,
        generated_only_motion_deck: false,
        blockers: [],
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-pending-motion"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-15T00:30:00.000Z",
  });

  const candidate = report.stories[0];
  assert.equal(report.verdict, "PARTIAL");
  assert.equal(candidate.control_inputs.footage_inventory.status, "amber");
  assert.ok(candidate.control_inputs.footage_inventory.warnings.includes("control:critical_input_amber"));
  assert.equal(candidate.final_verdict, "AMBER");
  assert.equal(candidate.can_auto_publish, false);
});

test("Goal 19 caps an authoritative AMBER media-house score at AMBER", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-media-house-amber-"));
  const story = await makeControlStory(root, "story-media-house-amber", {
    pulseMediaHouseScore: {
      verdict: "AMBER",
      status: "AMBER",
      hard_failures: [],
      warnings: [],
      scores: {
        title_strength_score: 90,
        first_frame_score: 90,
        first_3_seconds_score: 90,
        script_punch_score: 90,
        narration_quality_score: 90,
        motion_density_score: 90,
        transition_energy_score: 90,
        sound_design_score: 90,
        mobile_readability_score: 90,
        brand_recognition_score: 90,
        source_lock_score: 90,
        source_trust_score: 90,
        commercial_trust_score: 90,
        ending_payoff_score: 90,
        competitor_parity_score: 90,
        competitor_surpass_score: 90,
        overall_media_house_score: 90,
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-media-house-amber"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-18T07:10:00.000Z",
  });

  const candidate = report.stories[0];
  const mediaHouse = candidate.control_inputs.pulse_media_house_score;
  assert.equal(report.verdict, "PARTIAL");
  assert.equal(mediaHouse.status, "amber");
  assert.ok(mediaHouse.warnings.includes("control:pulse_media_house_score_amber"));
  assert.ok(mediaHouse.warnings.includes("control:critical_input_amber"));
  assert.equal(candidate.final_verdict, "AMBER");
  assert.equal(candidate.can_auto_publish, false);
});

test("Goal 19 hard-blocks incomplete direct control inputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-direct-"));
  const story = await makeControlStory(root, "story-direct", {
    scriptScorecard: { verdict: "rewrite_required", blockers: [] },
    footageInventory: { verdict: "blocked", blockers: ["no_motion_assets"] },
    rightsLedger: { verdict: "fail", failures: ["asset_missing_rights"] },
    directorPlan: { readiness: { status: "director_blocked", blockers: ["actual_motion_clip_minimum_not_met"] } },
    renderManifest: { final_publish_render: false, output_path: "", quality_gate_status: "pending_post_render_forensics" },
    visualQuality: { verdict: "fail", failures: ["unclear_first_frame"] },
    benchmark: { result: "fail", failures: ["motion_density_below_reference"] },
    policyReport: { verdict: "fail", publish_blockers: ["policy:reused_content"] },
    affiliate: { disclosure_required: true, disclosure_copy: {}, failures: [] },
    platformManifest: {
      publish_status: "RED",
      can_auto_publish: false,
      outputs: {},
      governance_gates: {
        anti_spam_uniqueness_gate: { verdict: "fail", failures: ["duplicate_title_structure"] },
      },
    },
    analyticsRisk: {},
    uniquenessReport: { verdict: "fail", failures: ["duplicate_title_structure"], matches: ["story-a"] },
    publishVerdict: { verdict: "RED", can_auto_publish: false, reason_codes: ["governance:red"] },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-direct"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:07:13.497Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_control_tower_verdict, "BLOCKED");
  assert.equal(report.stories[0].final_verdict, "RED");
  for (const blocker of [
    "control:script_scorecard_not_pass",
    "control:footage_inventory_not_pass",
    "control:rights_ledger_not_pass",
    "control:director_plan_not_pass",
    "control:render_qa_not_pass",
    "control:benchmark_report_not_pass",
    "control:policy_report_not_pass",
    "control:affiliate_disclosure_not_pass",
    "control:platform_pack_not_green",
    "control:analytics_risk_missing",
    "control:anti_spam_not_pass",
  ]) {
    assert.ok(report.blocker_counts[blocker] >= 1, blocker);
    assert.ok(report.direct_risk_counts[blocker] >= 1, blocker);
  }
  assert.equal(report.approval_requirements.stories[0].status, "blocked_until_repairs");
  assert.equal(report.publish_verdict.stories[0].publish_action, "none_blocked");
});

test("Goal 19 hard-blocks weak Pulse Media-House Score before GREEN", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-media-house-"));
  const story = await makeControlStory(root, "story-media-house", {
    pulseMediaHouseScore: {
      verdict: "RED",
      status: "fail",
      hard_failures: ["media_house:first_3_seconds_weak"],
      scores: {
        title_strength_score: 81,
        first_frame_score: 72,
        first_3_seconds_score: 44,
        script_punch_score: 68,
        narration_quality_score: 70,
        motion_density_score: 78,
        transition_energy_score: 75,
        sound_design_score: 72,
        mobile_readability_score: 80,
        brand_recognition_score: 76,
        source_lock_score: 88,
        source_trust_score: 88,
        commercial_trust_score: 80,
        ending_payoff_score: 62,
        competitor_parity_score: 55,
        competitor_surpass_score: 41,
        overall_media_house_score: 60,
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-media-house"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-06-07T12:00:00.000Z",
  });

  assert.equal(REQUIRED_CONTROL_INPUTS.includes("pulse_media_house_score"), true);
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].control_inputs.pulse_media_house_score.status, "fail");
  assert.ok(report.stories[0].blockers.includes("control:pulse_media_house_score_not_pass"));
});

test("Goal 19 preserves Pulse Media-House AMBER and disables auto-publish", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-media-house-amber-"));
  const story = await makeControlStory(root, "story-media-house-amber", {
    pulseMediaHouseScore: {
      verdict: "AMBER",
      status: "human_review",
      hard_failures: [],
      warnings: ["media_house:independent_visual_review_pending"],
      scores: {
        first_3_seconds_score: 88,
        source_lock_score: 91,
        competitor_parity_score: 85,
        competitor_surpass_score: 78,
        overall_media_house_score: 86,
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-media-house-amber"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T20:57:00.000Z",
  });

  assert.equal(report.verdict, "PARTIAL");
  assert.equal(report.direct_control_tower_verdict, "PARTIAL");
  assert.equal(report.summary.direct_control_tower_amber_story_count, 1);
  assert.equal(report.summary.direct_control_tower_blocked_story_count, 0);
  assert.equal(report.stories[0].final_verdict, "AMBER");
  assert.equal(report.stories[0].can_auto_publish, false);
  assert.equal(report.stories[0].control_inputs.pulse_media_house_score.status, "amber");
  assert.ok(
    report.stories[0].control_inputs.pulse_media_house_score.warnings.includes(
      "media_house:independent_visual_review_pending",
    ),
  );
});

test("Goal 19 caps the final verdict at AMBER when a critical input has warnings", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-critical-warning-"));
  const story = await makeControlStory(root, "story-critical-warning", {
    benchmark: {
      result: "pass",
      failures: [],
      warnings: ["benchmark:independent_frame_review_pending"],
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-critical-warning"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T20:58:00.000Z",
  });

  assert.equal(report.stories[0].control_inputs.benchmark_report.status, "amber");
  assert.equal(report.stories[0].final_verdict, "AMBER");
  assert.equal(report.stories[0].can_auto_publish, false);
  assert.ok(
    report.stories[0].direct_control_tower_warnings.includes(
      "benchmark:independent_frame_review_pending",
    ),
  );
});

test("Goal 19 does not let a GREEN platform manifest mask an authoritative RED publish verdict", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-publish-red-veto-"));
  const story = await makeControlStory(root, "story-publish-red-veto", {
    publishVerdict: {
      verdict: "RED",
      can_auto_publish: false,
      reason_codes: [],
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-publish-red-veto"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:10:00.000Z",
  });

  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].can_auto_publish, false);
  assert.equal(report.stories[0].control_inputs.platform_pack.status, "fail");
  assert.ok(report.stories[0].blockers.includes("control:platform_pack_not_green"));
});

test("Goal 19 keeps a critical final_verdict AMBER when status also says ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-masked-amber-"));
  const story = await makeControlStory(root, "story-masked-amber", {
    pulseMediaHouseScore: {
      status: "ready",
      final_verdict: "AMBER",
      hard_failures: [],
      scores: {
        first_3_seconds_score: 88,
        source_lock_score: 91,
        competitor_parity_score: 85,
        competitor_surpass_score: 78,
        overall_media_house_score: 86,
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-masked-amber"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:11:00.000Z",
  });

  assert.equal(report.stories[0].control_inputs.pulse_media_house_score.status, "amber");
  assert.equal(report.stories[0].final_verdict, "AMBER");
  assert.equal(report.stories[0].can_auto_publish, false);
});

test("Goal 19 treats a present RED goal package summary as an authoritative veto", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-package-summary-red-"));
  const story = await makeControlStory(root, "story-package-summary-red", {
    goalPackageSummary: {
      status: "ready",
      final_verdict: "RED",
      can_auto_publish: false,
      blockers: [],
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-package-summary-red"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:12:00.000Z",
  });

  assert.equal(report.stories[0].final_verdict, "RED");
  assert.equal(report.stories[0].can_auto_publish, false);
  assert.equal(report.stories[0].control_inputs.package_summary.status, "fail");
  assert.ok(report.stories[0].blockers.includes("control:package_summary_red"));
});

test("Goal 19 preserves an authoritative RED on the supplied story-package row", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-story-package-red-"));
  const story = await makeControlStory(root, "story-package-row-red");

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [{
      ...story,
      verdict: "RED",
      can_auto_publish: false,
      blockers: ["story_package:authoritative_red"],
    }],
    upstreamFirewallReport: readyGoal18(story.story_id),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-15T09:22:00.000Z",
  });

  const result = report.stories[0];
  assert.equal(result.final_verdict, "RED");
  assert.equal(result.can_auto_publish, false);
  assert.equal(result.control_inputs.story_package_authority.status, "fail");
  assert.ok(result.blockers.includes("control:story_package_red"));
  assert.ok(result.control_inputs.story_package_authority.evidence.failures.includes(
    "story_package:authoritative_red",
  ));
});

test("Goal 19 caps authoritative story-package AMBER or warnings at final AMBER", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-story-package-amber-"));
  const cases = [
    {
      story_id: "story-package-row-amber",
      story_package: { verdict: "AMBER" },
      expected_warning: "control:story_package_amber",
    },
    {
      story_id: "story-package-row-warning",
      story_package: { verdict: "GREEN", warnings: ["story_package:review_advisory"] },
      expected_warning: "story_package:review_advisory",
    },
  ];

  for (const item of cases) {
    const story = await makeControlStory(root, item.story_id);
    const report = await buildGoal19AutonomyControlTower({
      storyPackages: [{ ...story, ...item.story_package }],
      upstreamFirewallReport: readyGoal18(story.story_id),
      workspaceRoot: root,
      outputDir: path.join(root, `${item.story_id}-out`),
      generatedAt: "2026-07-15T09:23:00.000Z",
    });

    const result = report.stories[0];
    assert.equal(result.final_verdict, "AMBER", item.story_id);
    assert.equal(result.can_auto_publish, false, item.story_id);
    assert.equal(result.control_inputs.story_package_authority.status, "amber", item.story_id);
    assert.ok(result.direct_control_tower_warnings.includes(item.expected_warning), item.story_id);
  }
});

test("Goal 19 hard-blocks Pulse Media-House Score with missing source-lock score", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-media-house-source-lock-"));
  const story = await makeControlStory(root, "story-media-house-source-lock", {
    pulseMediaHouseScore: {
      verdict: "GREEN",
      status: "pass",
      hard_failures: [],
      scores: {
        title_strength_score: 88,
        first_frame_score: 86,
        first_3_seconds_score: 88,
        script_punch_score: 87,
        narration_quality_score: 84,
        motion_density_score: 88,
        transition_energy_score: 86,
        sound_design_score: 84,
        mobile_readability_score: 89,
        brand_recognition_score: 82,
        source_trust_score: 91,
        commercial_trust_score: 86,
        ending_payoff_score: 84,
        competitor_parity_score: 85,
        competitor_surpass_score: 78,
        overall_media_house_score: 86,
      },
    },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-media-house-source-lock"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-06-07T12:00:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].control_inputs.pulse_media_house_score.status, "fail");
  assert.equal(report.stories[0].control_inputs.pulse_media_house_score.evidence.source_lock_score, 0);
});

test("Goal 19 returns AMBER when safe output still needs human approval", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-amber-"));
  const story = await makeControlStory(root, "story-amber", {
    canonical: { human_review_required: true, human_review_reason: "Operator wants manual source check before publish." },
  });

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-amber"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:07:13.497Z",
  });

  assert.equal(report.verdict, "PARTIAL");
  assert.equal(report.direct_control_tower_verdict, "PASS");
  assert.equal(report.stories[0].final_verdict, "AMBER");
  assert.equal(report.stories[0].approval_required, true);
  assert.equal(report.stories[0].can_auto_publish, false);
  assert.equal(report.approval_requirements.stories[0].status, "human_review_required");
  assert.ok(report.approval_requirements.stories[0].requirements.includes("human_approval_required"));
});

test("Goal 19 writes required control tower artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-write-"));
  const story = await makeControlStory(root, "story-write");
  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-write"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:07:13.497Z",
  });
  const written = await writeGoal19AutonomyControlTower(report, { outputDir: path.join(root, "out") });

  assert.equal(report.verdict, "PASS");
  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.publishVerdict), true);
  assert.equal(await fs.pathExists(written.riskReport), true);
  assert.equal(await fs.pathExists(written.rejectionReasons), true);
  assert.equal(await fs.pathExists(written.approvalRequirements), true);
});

test("Goal 19 returns GREEN only with independently verified critical inputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal19-verified-green-"));
  const story = await makeControlStory(root, "story-verified-green");

  const report = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-verified-green"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-07-14T21:03:00.000Z",
  });

  const result = report.stories[0];
  assert.equal(report.verdict, "PASS");
  assert.equal(result.final_verdict, "GREEN");
  assert.equal(result.can_auto_publish, true);
  for (const input of REQUIRED_CONTROL_INPUTS) {
    assert.equal(result.control_inputs[input].status, "pass", input);
  }
  assert.equal(result.control_inputs.render_qa.evidence.output_exists, true);
  assert.equal(result.control_inputs.render_qa.evidence.output_decodable, true);
  assert.ok(result.control_inputs.render_qa.evidence.output_bytes > 0);
  assert.equal(result.control_inputs.final_av_review.evidence.reviewer_trusted, true);
  assert.equal(
    result.control_inputs.final_av_review.evidence.contact_sheet_binding.bound_to_current_media,
    true,
  );
  assert.equal(
    result.control_inputs.final_av_review.evidence.decoded_forensic_report
      .frame_hash_verification.verified,
    true,
  );
  assert.ok(result.control_inputs.rights_ledger.evidence.used_asset_count > 0);
  assert.equal(
    result.control_inputs.rights_ledger.evidence.matched_asset_count,
    result.control_inputs.rights_ledger.evidence.used_asset_count,
  );
});
