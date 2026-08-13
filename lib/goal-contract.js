"use strict";

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");
const {
  CONTRACT_ID: FLAGSHIP_MEDIA_PORTFOLIO_CONTRACT_ID,
  FLAGSHIP_MEDIA_PORTFOLIO_SLOTS,
  LONGFORM_MIN_DURATION_SECONDS,
  evaluateFlagshipMediaPortfolio,
} = require("./flagship-media-portfolio");

const GOAL_ID = "pulse_gaming_enterprise_media_os";
const GOAL_VERSION = "goal_contract_v1";
const FINAL_RENDER_WIDTH = 1080;
const FINAL_RENDER_HEIGHT = 1920;
const FINAL_RENDER_MIN_DURATION_SECONDS = 10;

const REQUIRED_SYSTEMS = [
  {
    id: "canonical_story_manifest",
    label: "Canonical Story Manifest",
    modules: ["lib/public-output-manifest.js", "lib/studio-governance-engine.js"],
    outputs: ["canonical_story_manifest.json"],
  },
  {
    id: "public_output_coherence_gate",
    label: "Public Output Coherence Gate",
    modules: ["lib/public-output-manifest.js", "lib/studio-governance-engine.js"],
    outputs: ["coherence_report.json"],
  },
  {
    id: "story_selection_engine",
    label: "Story Selection Intelligence",
    modules: ["lib/editorial-angle-engine.js", "lib/studio-enterprise-os.js"],
    outputs: ["story_scorecard.json"],
  },
  {
    id: "viral_script_engine",
    label: "Viral Script Engine",
    modules: ["lib/viral-script-intelligence.js", "lib/editorial-angle-engine.js"],
    outputs: ["script_scorecard.json"],
  },
  {
    id: "footage_empire",
    label: "Footage Empire",
    modules: ["lib/studio/v4/footage-empire.js", "lib/trusted-footage-registry.js"],
    outputs: ["footage_inventory.json"],
  },
  {
    id: "rights_ledger",
    label: "Rights Ledger",
    modules: ["lib/studio-governance-engine.js", "lib/trusted-footage-registry.js"],
    outputs: ["rights_ledger.json"],
  },
  {
    id: "director_brain",
    label: "Director Brain",
    modules: ["lib/studio/v4/director-brain.js"],
    outputs: ["director_beat_map.json"],
  },
  {
    id: "visual_v4_creator_renderer",
    label: "Visual V4 / Creator Studio Renderer",
    modules: ["lib/studio/v4/proof-render.js", "lib/studio/v4/render-bridge.js"],
    outputs: ["render_manifest.json"],
  },
  {
    id: "sound_design_engine",
    label: "Sound Design Engine",
    modules: ["lib/studio/v4/sound-transition-planner.js"],
    outputs: ["audio_manifest.json", "sfx_manifest.json"],
  },
  {
    id: "gold_standard_forensics_engine",
    label: "Gold Standard Forensics Engine",
    modules: ["lib/media-house-benchmark.js", "lib/gold-standard-reference-library.js"],
    outputs: ["benchmark_report.json"],
  },
  {
    id: "retention_intelligence_loop",
    label: "Retention Intelligence Loop",
    modules: ["lib/intelligence/retention-intelligence.js"],
    outputs: ["retention_report.json", "analytics_ingest_plan.json"],
  },
  {
    id: "experimentation_engine",
    label: "Experimentation Engine",
    modules: ["lib/intelligence/continuous-learning-loop.js", "lib/studio-enterprise-os.js"],
    outputs: ["experiment_manifest.json"],
  },
  {
    id: "multi_platform_publisher_engine",
    label: "Multi-Platform Publisher Engine",
    modules: ["lib/studio-enterprise-os.js", "lib/studio-governance-engine.js"],
    outputs: ["platform_publish_manifest.json"],
  },
  {
    id: "social_derivatives_engine",
    label: "Social Derivatives Engine",
    modules: ["lib/studio-enterprise-os.js"],
    outputs: ["x_publish_pack.json", "instagram_publish_pack.json"],
  },
  {
    id: "affiliate_intelligence_engine",
    label: "Affiliate Intelligence Engine",
    modules: ["lib/commercial-intelligence-engine.js", "lib/revenue-path-engine.js"],
    outputs: ["affiliate_link_manifest.json"],
  },
  {
    id: "landing_page_engine",
    label: "Landing Page Engine",
    modules: ["lib/commercial-intelligence-engine.js", "lib/revenue-path-engine.js"],
    outputs: ["landing_page_manifest.json"],
  },
  {
    id: "platform_policy_engine",
    label: "Platform Policy Engine",
    modules: ["lib/studio-governance-engine.js"],
    outputs: ["platform_policy_report.json"],
  },
  {
    id: "finance_crypto_firewall",
    label: "Finance and Crypto Firewall",
    modules: ["lib/studio-governance-engine.js", "lib/studio-enterprise-os.js"],
    outputs: ["finance_crypto_risk_report.json"],
  },
  {
    id: "autonomy_control_tower",
    label: "Autonomy Control Tower",
    modules: ["lib/studio-enterprise-os.js", "lib/studio-governance-engine.js"],
    outputs: ["publish_verdict.json"],
  },
  {
    id: "anti_spam_uniqueness_engine",
    label: "Anti-Spam and Uniqueness Engine",
    modules: ["lib/studio-governance-engine.js"],
    outputs: ["uniqueness_report.json"],
  },
  {
    id: "observability_dashboard",
    label: "Observability Dashboard",
    modules: ["lib/studio-enterprise-os.js"],
    outputs: ["observability_report.json"],
  },
  {
    id: "prompt_model_registry",
    label: "Versioned Prompt and Model Registry",
    modules: ["lib/studio-enterprise-os.js"],
    outputs: ["prompt_model_registry.json", "video_lineage_manifest.json"],
  },
  {
    id: "security_secrets_deployment_safety",
    label: "Security, Secrets and Deployment Safety",
    modules: ["lib/studio-enterprise-os.js", "lib/studio-governance-engine.js"],
    outputs: ["security_report.json", "secrets_scan_report.json", "deployment_safety_report.json"],
  },
  {
    id: "corrections_retractions_takedowns",
    label: "Corrections, Retractions and Takedowns",
    modules: ["lib/studio-governance-engine.js"],
    outputs: ["correction_queue.json", "affected_content_report.json", "correction_plan.json", "takedown_response_log.json"],
  },
  {
    id: "sponsor_readiness_pack",
    label: "Sponsor Readiness Pack",
    modules: ["lib/intelligence/monetisation-readiness.js", "lib/studio-enterprise-os.js"],
    outputs: ["sponsor_media_kit.json", "sponsor_pitch_pack.md", "brand_safety_report.json"],
  },
  {
    id: "creator_studio_brand_system",
    label: "Creator Studio Brand System",
    modules: ["lib/studio-enterprise-os.js"],
    outputs: [
      "brand_system_manifest.json",
      "visual_style_guide.md",
      "editorial_style_guide.md",
      "recurring_format_registry.json",
    ],
  },
];

const REQUIRED_ARTEFACTS = [
  "canonical_story_manifest.json",
  "story_scorecard.json",
  "source_manifest.json",
  "claim_inventory.json",
  "script_scorecard.json",
  "footage_inventory.json",
  "rights_ledger.json",
  "director_beat_map.json",
  "render_manifest.json",
  "audio_manifest.json",
  "sfx_manifest.json",
  "visual_quality_report.json",
  "forensic_qa_report.json",
  "benchmark_report.json",
  "coherence_report.json",
  "platform_policy_report.json",
  "affiliate_link_manifest.json",
  "landing_page_manifest.json",
  "publish_verdict.json",
  "analytics_ingest_plan.json",
  "audit_log.json",
  "youtube_publish_pack.json",
  "tiktok_publish_pack.json",
  "instagram_publish_pack.json",
  "facebook_publish_pack.json",
  "x_publish_pack.json",
  "threads_publish_pack.json",
  "pinterest_publish_pack.json",
  "carousel_manifest.json",
  "image_card_manifest.json",
  "thread_manifest.json",
  "observability_report.json",
  "security_report.json",
  "secrets_scan_report.json",
  "deployment_safety_report.json",
  "correction_queue.json",
  "affected_content_report.json",
  "correction_plan.json",
  "takedown_response_log.json",
  "sponsor_media_kit.json",
  "sponsor_pitch_pack.md",
  "brand_safety_report.json",
  "brand_system_manifest.json",
  "visual_style_guide.md",
  "editorial_style_guide.md",
  "recurring_format_registry.json",
  "prompt_model_registry.json",
  "video_lineage_manifest.json",
];

const REQUIRED_STORY_PACKAGE_ARTEFACTS = [
  "canonical_story_manifest.json",
  "script_scorecard.json",
  "footage_inventory.json",
  "rights_ledger.json",
  "director_beat_map.json",
  "render_manifest.json",
  "visual_v4_render.mp4",
  "audio_manifest.json",
  "sfx_manifest.json",
  "captions.srt",
  "platform_publish_manifest.json",
  "x_publish_pack.json",
  "instagram_publish_pack.json",
  "affiliate_link_manifest.json",
  "landing_page_manifest.json",
  "platform_policy_report.json",
  "benchmark_report.json",
  "coherence_report.json",
  "publish_verdict.json",
  "final_av_review.json",
  "analytics_ingest_plan.json",
];

const REQUIRED_TESTS = [
  "generic_title_rejection",
  "this_gaming_story_rejection",
  "internal_qa_language_rejection",
  "source_mismatch_rejection",
  "thumbnail_title_script_mismatch_rejection",
  "missing_canonical_subject_rejection",
  "missing_rights_record_rejection",
  "affiliate_disclosure_rejection",
  "finance_crypto_unsafe_wording_rejection",
  "weak_first_frame_rejection",
  "unreadable_mobile_text_rejection",
  "excessive_caveat_ratio_rejection",
  "repeated_visual_pattern_rejection",
  "repeated_cta_rejection",
  "platform_mirroring_detection",
  "green_amber_red_control_tower_verdicts",
  "platform_native_publish_pack_generation",
  "x_thread_generation",
  "instagram_carousel_generation",
  "landing_page_generation",
  "analytics_rule_update_generation",
  "correction_workflow",
  "secrets_scan",
  "dry_run_publishing_mode",
];

const OPERATING_MODES = ["LOCAL_PROOF", "DRY_RUN_PUBLISH", "HUMAN_REVIEW", "AUTO_PUBLISH"];

function hasIndexed(index = {}, key) {
  return index[key] === true || index[key] === "present" || index[key]?.present === true;
}

function summariseStatuses(rows = []) {
  const implemented = rows.filter((row) => row.status === "implemented").length;
  const partial = rows.filter((row) => row.status === "partial").length;
  const missing = rows.filter((row) => row.status === "missing").length;
  return {
    total: rows.length,
    implemented,
    partial,
    missing,
  };
}

function buildSystemRows(moduleIndex = {}, artefactIndex = {}) {
  return REQUIRED_SYSTEMS.map((system) => {
    const presentModules = system.modules.filter((item) => hasIndexed(moduleIndex, item));
    const presentOutputs = system.outputs.filter((item) => hasIndexed(artefactIndex, item));
    const moduleReady = presentModules.length > 0;
    const outputReady = presentOutputs.length === system.outputs.length;
    const status = moduleReady ? "implemented" : "missing";
    return {
      ...system,
      status,
      output_status: outputReady ? "present" : "missing",
      present_modules: presentModules,
      missing_modules: system.modules.filter((item) => !presentModules.includes(item)),
      present_outputs: presentOutputs,
      missing_outputs: system.outputs.filter((item) => !presentOutputs.includes(item)),
    };
  });
}

function buildRequiredRows(required = [], index = {}) {
  return required.map((id) => ({
    id,
    status: hasIndexed(index, id) ? "present" : "missing",
  }));
}

function summariseRequiredRows(rows = []) {
  const present = rows.filter((row) => row.status === "present").length;
  const missing = rows.length - present;
  return {
    total: rows.length,
    present,
    missing,
  };
}

function materialisedArtefactMissing(storyPackage = {}) {
  const dir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir;
  if (!dir) return [];
  return REQUIRED_STORY_PACKAGE_ARTEFACTS.filter((item) => {
    try {
      return !fs.existsSync(path.join(dir, item));
    } catch {
      return true;
    }
  });
}

function storyPackageStatus(storyPackage = {}) {
  const artefacts = new Set(Array.isArray(storyPackage.artefacts) ? storyPackage.artefacts : []);
  const missing = REQUIRED_STORY_PACKAGE_ARTEFACTS.filter((item) => !artefacts.has(item));
  const missingMaterialised = materialisedArtefactMissing(storyPackage);
  const declaredVerdicts = trafficLightVerdicts(storyPackage);
  const green =
    declaredVerdicts.includes("GREEN") &&
    declaredVerdicts.every((verdict) => verdict === "GREEN");
  return {
    story_id: storyPackage.story_id || storyPackage.id || "unknown",
    status: missing.length === 0 && missingMaterialised.length === 0 && green ? "complete" : "incomplete",
    verdict: storyPackage.verdict || storyPackage.publish_verdict || null,
    missing_artefacts: missing,
    missing_materialised_artefacts: missingMaterialised,
    artifact_dir: storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || null,
  };
}

function buildThirtyStoryGate(storyPackages = [], publishCutoverGate = {}) {
  const packageRows = (Array.isArray(storyPackages) ? storyPackages : []).map(storyPackageStatus);
  const finalRenderByPackageIndex = new Map(
    (publishCutoverGate.story_results || []).map((row) => [row.package_index, row]),
  );
  const rows = packageRows.map((row, packageIndex) => {
    const finalRender = finalRenderByPackageIndex.get(packageIndex);
    const strictComplete = row.status === "complete" && finalRender?.final_publish_render === true;
    return {
      ...row,
      package_index: packageIndex,
      package_status: row.status,
      status: strictComplete ? "complete" : "incomplete",
      final_publish_render: finalRender?.final_publish_render === true,
      final_render_blocker: finalRender?.blocker || null,
      canonical_story_id: finalRender?.canonical_story_id || null,
      final_render_sha256: finalRender?.final_render_sha256 || null,
    };
  });
  const packageComplete = packageRows.filter((row) => row.status === "complete").length;
  const complete = rows.filter((row) => row.status === "complete").length;
  return {
    required_story_count: 30,
    story_count_seen: rows.length,
    package_complete_story_count: packageComplete,
    complete_story_count: complete,
    verified_complete_story_count: complete,
    unique_canonical_story_count: publishCutoverGate.unique_canonical_story_count || 0,
    unique_final_render_fingerprint_count:
      publishCutoverGate.unique_final_render_fingerprint_count || 0,
    status: complete >= 30 ? "pass" : "blocked",
    incomplete_stories: rows.filter((row) => row.status !== "complete").slice(0, 30),
  };
}

function readRenderManifest(storyPackage = {}) {
  const dir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir;
  if (!dir) return null;
  try {
    const filePath = path.join(dir, "render_manifest.json");
    if (!fs.existsSync(filePath)) return null;
    return fs.readJsonSync(filePath);
  } catch {
    return null;
  }
}

function resolveFinalRenderPath(storyPackage = {}, renderManifest = {}) {
  const dir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir;
  if (!dir) return null;
  const declaredPath = renderManifest.output_path || renderManifest.output || "visual_v4_render.mp4";
  const resolvedDir = path.resolve(dir);
  const resolvedPath = path.isAbsolute(declaredPath)
    ? path.resolve(declaredPath)
    : path.resolve(resolvedDir, declaredPath);
  const relative = path.relative(resolvedDir, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolvedPath;
}

function cleanText(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function trafficLightVerdicts(record) {
  const verdicts = [];
  const fields = [
    "verdict",
    "status",
    "final_verdict",
    "overall_verdict",
    "publish_verdict",
    "governance_publish_status",
    "quality_gate_status",
  ];
  const inspect = (value, depth = 0) => {
    if (typeof value === "string") {
      const verdict = cleanText(value).toUpperCase();
      if (["GREEN", "AMBER", "RED"].includes(verdict)) verdicts.push(verdict);
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 1) return;
    for (const field of fields) inspect(value[field], depth + 1);
  };
  inspect(record);
  return [...new Set(verdicts)];
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = fs.openSync(filePath, "r");
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function canonicalInputSnapshot(canonical = {}) {
  return {
    story_id: cleanText(canonical.story_id),
    selected_title: cleanText(canonical.selected_title || canonical.short_title),
    thumbnail_headline: cleanText(canonical.thumbnail_headline || canonical.thumbnail_text),
    first_spoken_line: cleanText(canonical.first_spoken_line || canonical.narration_hook),
    narration_script: cleanText(canonical.narration_script),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game),
    canonical_angle: cleanText(canonical.canonical_angle),
    primary_source: cleanText(canonical.primary_source || canonical.source_card_label),
    public_copy_repaired_at: cleanText(canonical.public_copy_repaired_at),
    duration_variant_repaired_at: cleanText(canonical.duration_variant_repaired_at),
  };
}

function buildFinalRenderInputFingerprint({ canonical = {}, audioPath, timestampsPath } = {}) {
  const audioBytes = fs.readFileSync(audioPath);
  const timestampsBytes = fs.readFileSync(timestampsPath);
  const canonicalSnapshot = canonicalInputSnapshot(canonical);
  const current = {
    canonical_snapshot: canonicalSnapshot,
    audio_sha256: sha256(audioBytes),
    word_timestamps_sha256: sha256(timestampsBytes),
    audio_size_bytes: audioBytes.length,
    word_timestamps_size_bytes: timestampsBytes.length,
  };
  return {
    algorithm: "sha256",
    signature: sha256(Buffer.from(stableJson(current), "utf8")),
    canonical_public_copy_hash: sha256(
      Buffer.from(stableJson(canonicalSnapshot), "utf8"),
    ),
    ...current,
  };
}

function readJsonFile(filePath) {
  try {
    return fs.readJsonSync(filePath);
  } catch {
    return null;
  }
}

function firstExistingEvidencePath(artifactDir, candidates = []) {
  for (const candidate of candidates) {
    const declared = cleanText(candidate);
    if (!declared) continue;
    const resolved = path.isAbsolute(declared)
      ? path.resolve(declared)
      : path.resolve(artifactDir, declared);
    try {
      if (fs.statSync(resolved).isFile()) return resolved;
    } catch {
      // Try the next declared evidence path.
    }
  }
  return null;
}

function verifyFinalRenderInputLineage(storyPackage = {}, renderManifest = {}) {
  const fingerprint = renderManifest.input_fingerprint || {};
  const blockers = [];
  if (!fingerprint.signature) blockers.push("final_render_fingerprint_signature_missing");
  if (!fingerprint.canonical_public_copy_hash) {
    blockers.push("final_render_canonical_copy_hash_missing");
  }
  if (!fingerprint.audio_sha256) blockers.push("final_render_audio_fingerprint_missing");
  if (!fingerprint.word_timestamps_sha256) {
    blockers.push("final_render_word_timestamps_fingerprint_missing");
  }
  if (blockers.length) return { pass: false, blockers };

  const artifactDir = path.resolve(
    storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || "",
  );
  const canonical = readJsonFile(path.join(artifactDir, "canonical_story_manifest.json"));
  const audioManifest = readJsonFile(path.join(artifactDir, "audio_manifest.json"));
  if (!canonical) blockers.push("final_render_canonical_manifest_missing");
  if (!audioManifest) blockers.push("final_render_audio_manifest_missing");
  if (blockers.length) return { pass: false, blockers };

  const inputEvidence = renderManifest.input_evidence || {};
  const audioPath = firstExistingEvidencePath(artifactDir, [
    audioManifest.resolved_narration_audio_path,
    inputEvidence.resolved_narration_audio_path,
    audioManifest.narration_audio_path,
    inputEvidence.narration_audio_path,
    "audio/narration.mp3",
  ]);
  const timestampsPath = firstExistingEvidencePath(artifactDir, [
    audioManifest.resolved_word_timestamps_path,
    inputEvidence.resolved_word_timestamps_path,
    audioManifest.word_timestamps_path,
    inputEvidence.word_timestamps_path,
    "audio/word_timestamps.json",
  ]);
  if (!audioPath) blockers.push("final_render_narration_audio_missing");
  if (!timestampsPath) blockers.push("final_render_word_timestamps_missing");
  if (blockers.length) return { pass: false, blockers };

  const currentFingerprint = buildFinalRenderInputFingerprint({
    canonical,
    audioPath,
    timestampsPath,
  });
  const current = {
    canonical_snapshot: currentFingerprint.canonical_snapshot,
    audio_sha256: currentFingerprint.audio_sha256,
    word_timestamps_sha256: currentFingerprint.word_timestamps_sha256,
    audio_size_bytes: currentFingerprint.audio_size_bytes,
    word_timestamps_size_bytes: currentFingerprint.word_timestamps_size_bytes,
  };
  const canonicalCopyHash = currentFingerprint.canonical_public_copy_hash;
  const signature = currentFingerprint.signature;

  if (cleanText(fingerprint.canonical_public_copy_hash) !== canonicalCopyHash) {
    blockers.push("final_render_canonical_copy_fingerprint_mismatch");
  }
  if (cleanText(fingerprint.audio_sha256) !== current.audio_sha256) {
    blockers.push("final_render_audio_fingerprint_mismatch");
  }
  if (cleanText(fingerprint.word_timestamps_sha256) !== current.word_timestamps_sha256) {
    blockers.push("final_render_word_timestamps_fingerprint_mismatch");
  }
  if (Number(fingerprint.audio_size_bytes) !== current.audio_size_bytes) {
    blockers.push("final_render_audio_size_mismatch");
  }
  if (Number(fingerprint.word_timestamps_size_bytes) !== current.word_timestamps_size_bytes) {
    blockers.push("final_render_word_timestamps_size_mismatch");
  }
  if (cleanText(fingerprint.signature) !== signature) {
    blockers.push("final_render_fingerprint_signature_mismatch");
  }
  return {
    pass: blockers.length === 0,
    blockers,
    evidence: {
      narration_audio_path: audioPath,
      word_timestamps_path: timestampsPath,
      audio_sha256: current.audio_sha256,
      word_timestamps_sha256: current.word_timestamps_sha256,
      canonical_public_copy_hash: canonicalCopyHash,
      signature,
    },
  };
}

function verifyFinalPublishRender(storyPackage = {}, renderManifest = {}) {
  const finalRenderPath = resolveFinalRenderPath(storyPackage, renderManifest);
  if (!finalRenderPath) {
    return { pass: false, path: null, blocker: "final_render_path_invalid" };
  }
  if (path.extname(finalRenderPath).toLowerCase() !== ".mp4") {
    return { pass: false, path: finalRenderPath, blocker: "final_render_not_mp4" };
  }
  try {
    const stat = fs.statSync(finalRenderPath);
    if (!stat.isFile() || stat.size <= 0) {
      return { pass: false, path: finalRenderPath, blocker: "final_render_missing" };
    }
  } catch {
    return { pass: false, path: finalRenderPath, blocker: "final_render_missing" };
  }

  const probe = spawnSync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
      "-of", "json",
      finalRenderPath,
    ],
    { encoding: "utf8", timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  if (probe.error) {
    return { pass: false, path: finalRenderPath, blocker: "final_render_probe_unavailable" };
  }
  if (probe.status !== 0) {
    return { pass: false, path: finalRenderPath, blocker: "final_render_not_decodable" };
  }

  let metadata;
  try {
    metadata = JSON.parse(probe.stdout || "{}");
  } catch {
    return { pass: false, path: finalRenderPath, blocker: "final_render_not_decodable" };
  }
  const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationSeconds = Number(metadata.format?.duration);
  if (
    !video?.codec_name ||
    Number(video.width) <= 0 ||
    Number(video.height) <= 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return { pass: false, path: finalRenderPath, blocker: "final_render_not_decodable" };
  }
  if (!audio?.codec_name) {
    return { pass: false, path: finalRenderPath, blocker: "final_render_audio_missing" };
  }
  if (cleanText(video.codec_name).toLowerCase() !== "h264") {
    return { pass: false, path: finalRenderPath, blocker: "final_render_video_codec_invalid" };
  }
  if (cleanText(audio.codec_name).toLowerCase() !== "aac") {
    return { pass: false, path: finalRenderPath, blocker: "final_render_audio_codec_invalid" };
  }
  if (
    Number(video.width) !== FINAL_RENDER_WIDTH ||
    Number(video.height) !== FINAL_RENDER_HEIGHT
  ) {
    return { pass: false, path: finalRenderPath, blocker: "final_render_dimensions_invalid" };
  }
  if (durationSeconds < FINAL_RENDER_MIN_DURATION_SECONDS) {
    return { pass: false, path: finalRenderPath, blocker: "final_render_duration_too_short" };
  }

  const lineage = verifyFinalRenderInputLineage(storyPackage, renderManifest);
  if (!lineage.pass) {
    return {
      pass: false,
      path: finalRenderPath,
      blocker: lineage.blockers[0],
      lineage_blockers: lineage.blockers,
    };
  }

  const nullSink = process.platform === "win32" ? "NUL" : "/dev/null";
  const decode = spawnSync(
    "ffmpeg",
    [
      "-v", "error",
      "-xerror",
      "-i", finalRenderPath,
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-f", "null",
      nullSink,
    ],
    { encoding: "utf8", timeout: 120000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  if (decode.error) {
    return { pass: false, path: finalRenderPath, blocker: "final_render_decoder_unavailable" };
  }
  if (decode.status !== 0) {
    return { pass: false, path: finalRenderPath, blocker: "final_render_not_decodable" };
  }
  let finalRenderSha256;
  try {
    finalRenderSha256 = sha256File(finalRenderPath);
  } catch {
    return { pass: false, path: finalRenderPath, blocker: "final_render_fingerprint_unavailable" };
  }
  return {
    pass: true,
    path: finalRenderPath,
    blocker: null,
    final_render_sha256: finalRenderSha256,
    duration_seconds: durationSeconds,
    video_codec: video.codec_name,
    lineage_blockers: [],
  };
}

function buildPublishCutoverGate(storyPackages = []) {
  const rows = [];
  const mediaVerificationByPath = new Map();
  const packages = Array.isArray(storyPackages) ? storyPackages : [];
  for (const [packageIndex, storyPackage] of packages.entries()) {
    const dir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir;
    const renderManifest = readRenderManifest(storyPackage);
    const canonicalManifest = dir
      ? readJsonFile(path.join(path.resolve(dir), "canonical_story_manifest.json"))
      : null;
    const reviewManifest = dir
      ? readJsonFile(path.join(path.resolve(dir), "final_av_review.json"))
      : null;
    const publishVerdictManifest = dir
      ? readJsonFile(path.join(path.resolve(dir), "publish_verdict.json"))
      : null;
    const packageStoryId = cleanText(storyPackage.story_id || storyPackage.id);
    const canonicalStoryId = cleanText(canonicalManifest?.story_id);
    const renderStoryId = cleanText(renderManifest?.story_id);
    const reviewStoryId = cleanText(reviewManifest?.story_id);
    const identityBlockers = [];
    if (!packageStoryId) identityBlockers.push("package_story_id_missing");
    if (!canonicalStoryId) identityBlockers.push("canonical_story_id_missing");
    else if (packageStoryId && canonicalStoryId !== packageStoryId) {
      identityBlockers.push("package_canonical_story_id_mismatch");
    }
    if (!renderStoryId) identityBlockers.push("render_story_id_missing");
    else if (packageStoryId && renderStoryId !== packageStoryId) {
      identityBlockers.push("package_render_story_id_mismatch");
    }
    if (!reviewStoryId) identityBlockers.push("review_story_id_missing");
    else if (packageStoryId && reviewStoryId !== packageStoryId) {
      identityBlockers.push("package_review_story_id_mismatch");
    }
    const authorityVerdicts = {
      package: trafficLightVerdicts(storyPackage),
      canonical: trafficLightVerdicts(canonicalManifest),
      render: trafficLightVerdicts(renderManifest),
      review: trafficLightVerdicts(reviewManifest),
      publish: trafficLightVerdicts(publishVerdictManifest),
    };
    const verdictBlockers = [];
    for (const [source, verdicts] of Object.entries(authorityVerdicts)) {
      const requiresGreen = source === "review" || source === "publish";
      const hasNonGreen = verdicts.some((verdict) => verdict !== "GREEN");
      if (hasNonGreen || (requiresGreen && !verdicts.includes("GREEN"))) {
        verdictBlockers.push(`${source}_verdict_not_green`);
      }
    }
    const allAuthorityVerdicts = Object.values(authorityVerdicts).flat();
    if (
      allAuthorityVerdicts.includes("GREEN") &&
      allAuthorityVerdicts.some((verdict) => verdict !== "GREEN")
    ) {
      verdictBlockers.push("contradictory_green_and_non_green_verdicts");
    }
    let mediaVerification = { pass: false, path: null, blocker: "artifact_dir_missing" };
    if (dir && !renderManifest) {
      mediaVerification = { pass: false, path: null, blocker: "render_manifest_missing" };
    } else if (dir && renderManifest?.final_publish_render !== true) {
      mediaVerification = { pass: false, path: null, blocker: "render_not_final_publish_ready" };
    } else if (dir) {
      const finalRenderPath = resolveFinalRenderPath(storyPackage, renderManifest);
      const cacheKey = finalRenderPath ? path.resolve(finalRenderPath) : null;
      if (cacheKey && mediaVerificationByPath.has(cacheKey)) {
        mediaVerification = mediaVerificationByPath.get(cacheKey);
      } else {
        try {
          mediaVerification = verifyFinalPublishRender(storyPackage, renderManifest) || {
            pass: false,
            path: null,
            blocker: "final_render_verification_failed",
          };
        } catch {
          mediaVerification = {
            pass: false,
            path: null,
            blocker: "final_render_verification_failed",
          };
        }
        if (cacheKey) mediaVerificationByPath.set(cacheKey, mediaVerification);
      }
    }
    const finalPublishRender =
      renderManifest?.final_publish_render === true &&
      mediaVerification.pass === true &&
      identityBlockers.length === 0 &&
      verdictBlockers.length === 0;
    const rowBlockers = [
      ...(mediaVerification.pass === true ? [] : [mediaVerification.blocker]),
      ...identityBlockers,
      ...verdictBlockers,
    ].filter(Boolean);
    rows.push({
      package_index: packageIndex,
      story_id: packageStoryId || "unknown",
      canonical_story_id: canonicalStoryId || null,
      render_story_id: renderStoryId || null,
      review_story_id: reviewStoryId || null,
      authority_verdicts: authorityVerdicts,
      artifact_dir: dir || null,
      final_publish_render: finalPublishRender,
      renderer: renderManifest?.renderer || null,
      visual_tier: renderManifest?.visual_tier || null,
      final_render_path: mediaVerification.path || null,
      final_render_sha256: mediaVerification.final_render_sha256 || null,
      duration_seconds: mediaVerification.duration_seconds || null,
      video_codec: mediaVerification.video_codec || null,
      lineage_blockers: mediaVerification.lineage_blockers || [],
      blockers: rowBlockers,
      blocker: finalPublishRender ? null : rowBlockers[0] || "final_render_verification_failed",
    });
  }

  const duplicateGroups = (values) => {
    const groups = new Map();
    for (const row of rows) {
      const value = values(row);
      if (!value) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    }
    return groups;
  };
  const addBlocker = (row, blocker) => {
    if (!row.blockers.includes(blocker)) row.blockers.push(blocker);
    row.final_publish_render = false;
    row.blocker = row.blockers[0];
  };
  const canonicalGroups = duplicateGroups((row) => cleanText(row.canonical_story_id).toLowerCase());
  const fingerprintGroups = duplicateGroups((row) => cleanText(row.final_render_sha256).toLowerCase());
  for (const group of canonicalGroups.values()) {
    if (group.length > 1) {
      for (const row of group) addBlocker(row, "canonical_story_id_not_unique");
    }
  }
  for (const group of fingerprintGroups.values()) {
    if (group.length > 1) {
      for (const row of group) addBlocker(row, "final_render_fingerprint_not_unique");
    }
  }

  const finalCount = rows.filter((row) => row.final_publish_render).length;
  const blocked = rows.filter((row) => !row.final_publish_render);
  return {
    required_story_count: 30,
    evaluated_story_count: rows.length,
    final_publish_render_count: finalCount,
    unique_canonical_story_count: canonicalGroups.size,
    unique_final_render_fingerprint_count: fingerprintGroups.size,
    status: rows.length === 0 ? "not_evaluated" : finalCount >= 30 ? "pass" : "blocked",
    story_results: rows,
    blocked_stories: blocked.slice(0, 30),
  };
}

function buildFlagshipMediaPortfolioGate(portfolioReport = null) {
  if (!portfolioReport) {
    return {
      required: true,
      contract_id: FLAGSHIP_MEDIA_PORTFOLIO_CONTRACT_ID,
      status: "blocked",
      portfolio_status: "MISSING",
      blockers: ["flagship_media_portfolio_missing"],
      evidence: null,
    };
  }

  const slots = portfolioReport.slots && typeof portfolioReport.slots === "object"
    && !Array.isArray(portfolioReport.slots)
    ? portfolioReport.slots
    : {};
  const suppliedSlotIds = Object.keys(slots);
  const slotResults = FLAGSHIP_MEDIA_PORTFOLIO_SLOTS
    .map((slotId) => slots[slotId])
    .filter(Boolean);
  const sourceStatus = cleanText(portfolioReport.status).toUpperCase();
  const sourceVerdict = cleanText(portfolioReport.verdict).toUpperCase();
  const blockers = [];
  const addBlocker = (code) => {
    const value = cleanText(code);
    if (value && !blockers.includes(value)) blockers.push(value);
  };
  for (const blocker of Array.isArray(portfolioReport.blockers)
    ? portfolioReport.blockers
    : []) {
    addBlocker(blocker);
  }

  if (
    portfolioReport.contract_id !== FLAGSHIP_MEDIA_PORTFOLIO_CONTRACT_ID ||
    portfolioReport.report_type !== "flagship_media_portfolio_contract_evaluation"
  ) {
    addBlocker("flagship_media_portfolio_evaluation_invalid");
  }
  if (portfolioReport.evaluation_complete !== true) {
    addBlocker("flagship_media_portfolio_evaluation_incomplete");
  }
  if (sourceStatus !== "GREEN") {
    addBlocker("flagship_media_portfolio_status_not_green");
  }
  if (sourceVerdict !== "GREEN") {
    addBlocker("flagship_media_portfolio_verdict_not_green");
  }
  if (
    portfolioReport.contract_satisfied !== true ||
    portfolioReport.portfolio_ready !== true
  ) {
    addBlocker("flagship_media_portfolio_contract_not_satisfied");
  }

  const requiredSlots = Array.isArray(portfolioReport.required_slots)
    ? portfolioReport.required_slots
    : [];
  const hasExactRequiredSlots =
    suppliedSlotIds.length === FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.length &&
    FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.every((slotId) => suppliedSlotIds.includes(slotId)) &&
    requiredSlots.length === FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.length &&
    FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.every((slotId) => requiredSlots.includes(slotId));
  if (!hasExactRequiredSlots) {
    addBlocker("flagship_media_portfolio_required_slots_incomplete");
  }
  const summary = portfolioReport.summary || {};
  if (
    Number(summary.required_slot_count) !== FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.length ||
    Number(summary.supplied_required_slot_count) !== FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.length ||
    Number(summary.verified_slot_count) !== FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.length ||
    Number(summary.blocked_slot_count) !== 0 ||
    Number(summary.unique_story_count) !== FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.length ||
    Number(summary.unique_media_hash_count) !== FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.length ||
    Number(summary.blocker_count) !== 0
  ) {
    addBlocker("flagship_media_portfolio_summary_incomplete");
  }

  for (const slotId of FLAGSHIP_MEDIA_PORTFOLIO_SLOTS) {
    const row = slots[slotId];
    if (!row) continue;
    if (row.pass !== true || cleanText(row.verdict).toUpperCase() !== "GREEN") {
      addBlocker(`${slotId}:slot_not_green`);
    }
    const expectedType = slotId === "longform_1" ? "longform" : "short";
    if (cleanText(row.expected_media_type).toLowerCase() !== expectedType) {
      addBlocker(`${slotId}:media_type_mismatch`);
    }
    if (row.media?.decodable !== true || row.media?.decoded !== true) {
      addBlocker(`${slotId}:media_not_decoded`);
    }
    if (expectedType === "short" && row.media?.orientation !== "portrait") {
      addBlocker(`${slotId}:short_media_not_portrait`);
    }
    if (expectedType === "longform") {
      if (row.media?.orientation !== "landscape") {
        addBlocker(`${slotId}:longform_media_not_landscape`);
      }
      const durationSeconds = Number(row.media?.duration_seconds);
      if (
        !Number.isFinite(durationSeconds) ||
        durationSeconds < LONGFORM_MIN_DURATION_SECONDS
      ) {
        addBlocker(`${slotId}:longform_duration_below_600_seconds`);
      }
    }
  }

  const uniqueCount = (values) => new Set(values.filter(Boolean)).size;
  if (uniqueCount(slotResults.map((row) => cleanText(row.story_id).toLowerCase())) !== 4) {
    addBlocker("flagship_media_portfolio_four_unique_stories_required");
  }
  if (uniqueCount(slotResults.map((row) => cleanText(row.media?.sha256).toLowerCase())) !== 4) {
    addBlocker("flagship_media_portfolio_four_unique_media_hashes_required");
  }
  const shortRows = FLAGSHIP_MEDIA_PORTFOLIO_SLOTS
    .slice(0, 3)
    .map((slotId) => slots[slotId])
    .filter(Boolean);
  const shortSourceIdentityCount = uniqueCount(
    shortRows.map((row) => cleanText(row.source_identity_material_key).toLowerCase()),
  );
  const shortMotionIdentityCount = uniqueCount(
    shortRows.map((row) => cleanText(row.motion_identity_material_key).toLowerCase()),
  );
  if (
    shortRows.length !== 3 ||
    shortSourceIdentityCount !== 3 ||
    shortMotionIdentityCount !== 3 ||
    portfolioReport.short_identity_diversity?.materially_different !== true
  ) {
    addBlocker("flagship_media_portfolio_shorts_not_materially_different");
  }

  const pass = blockers.length === 0;
  return {
    required: true,
    contract_id: FLAGSHIP_MEDIA_PORTFOLIO_CONTRACT_ID,
    status: pass ? "pass" : "blocked",
    portfolio_status: sourceStatus || sourceVerdict || "INVALID",
    verdict: sourceVerdict || null,
    evaluation_complete: portfolioReport.evaluation_complete === true,
    contract_satisfied: portfolioReport.contract_satisfied === true,
    blockers,
    blocker_codes: [
      ...new Set([
        ...(Array.isArray(portfolioReport.blocker_codes)
          ? portfolioReport.blocker_codes.map(cleanText).filter(Boolean)
          : []),
        ...blockers.map((blocker) => blocker.split(":").pop()),
      ]),
    ],
    evidence: {
      report_type: portfolioReport.report_type || null,
      generated_at: portfolioReport.generated_at || null,
      required_slots: [...FLAGSHIP_MEDIA_PORTFOLIO_SLOTS],
      supplied_slot_ids: suppliedSlotIds,
      summary: portfolioReport.summary || null,
      short_identity_diversity: portfolioReport.short_identity_diversity || null,
      slots,
      slot_results: slotResults,
    },
  };
}

function buildNextActions({
  systemRows,
  artefactRows,
  testRows,
  thirtyStoryGate,
  publishCutoverGate,
  flagshipMediaPortfolioGate,
}) {
  const actions = [];
  const missingSystems = systemRows.filter((row) => row.status === "missing");
  const partialSystems = systemRows.filter((row) => row.status === "partial");
  const missingArtefacts = artefactRows.filter((row) => row.status === "missing");
  const missingTests = testRows.filter((row) => row.status === "missing");

  if (missingSystems.length) {
    actions.push({
      priority: "P0",
      reason_code: "missing_required_systems",
      action: `Implement or wire ${missingSystems[0].label}.`,
      evidence: missingSystems.slice(0, 5).map((row) => row.id),
    });
  }
  if (partialSystems.length) {
    actions.push({
      priority: "P0",
      reason_code: "partial_required_systems",
      action: `Add missing outputs for ${partialSystems[0].label}.`,
      evidence: partialSystems.slice(0, 5).map((row) => row.id),
    });
  }
  if (missingArtefacts.length) {
    actions.push({
      priority: "P1",
      reason_code: "missing_required_artefacts",
      action: `Generate ${missingArtefacts[0].id} as a machine-readable artefact.`,
      evidence: missingArtefacts.slice(0, 8).map((row) => row.id),
    });
  }
  if (missingTests.length) {
    actions.push({
      priority: "P1",
      reason_code: "missing_required_tests",
      action: `Add a regression test for ${missingTests[0].id}.`,
      evidence: missingTests.slice(0, 8).map((row) => row.id),
    });
  }
  if (thirtyStoryGate.status !== "pass") {
    actions.push({
      priority: "P0",
      reason_code: "thirty_story_acceptance_not_met",
      action: "Produce governed packages until 30 gaming stories pass the full artefact checklist with GREEN verdicts.",
      evidence: {
        complete_story_count: thirtyStoryGate.complete_story_count,
        required_story_count: thirtyStoryGate.required_story_count,
      },
    });
  }
  if (publishCutoverGate?.status === "blocked") {
    actions.push({
      priority: "P0",
      reason_code: "production_render_cutover_not_met",
      action: "Generate final production renders before any DRY_RUN_PUBLISH plan can create publish actions.",
      evidence: {
        final_publish_render_count: publishCutoverGate.final_publish_render_count,
        required_story_count: publishCutoverGate.required_story_count,
        first_blocker: publishCutoverGate.blocked_stories?.[0]?.blocker || null,
      },
    });
  }
  if (flagshipMediaPortfolioGate?.status !== "pass") {
    actions.push({
      priority: "P0",
      reason_code: "flagship_media_portfolio_not_met",
      action: "Provide a passing flagship portfolio with exactly three materially different Shorts and one decoded landscape longform of at least 10 minutes.",
      evidence: {
        portfolio_status: flagshipMediaPortfolioGate?.portfolio_status || "MISSING",
        blockers: flagshipMediaPortfolioGate?.blockers || [],
      },
    });
  }

  return actions;
}

async function buildGoalContractReport({
  generatedAt = new Date().toISOString(),
  moduleIndex = {},
  artefactIndex = {},
  testIndex = {},
  storyPackages = [],
  flagshipMediaPortfolio = null,
  flagshipMediaPortfolioReport = null,
  flagshipMediaPortfolioOptions = {},
} = {}) {
  const systemRows = buildSystemRows(moduleIndex, artefactIndex);
  const artefactRows = buildRequiredRows(REQUIRED_ARTEFACTS, artefactIndex);
  const testRows = buildRequiredRows(REQUIRED_TESTS, testIndex);
  const publishCutoverGate = buildPublishCutoverGate(storyPackages);
  const thirtyStoryGate = buildThirtyStoryGate(storyPackages, publishCutoverGate);
  let portfolioEvaluation = null;
  if (
    flagshipMediaPortfolio !== null &&
    flagshipMediaPortfolio !== undefined
  ) {
    const evaluationOptions = {
      generatedAt,
      workspaceRoot: flagshipMediaPortfolioOptions.workspaceRoot || process.cwd(),
    };
    portfolioEvaluation = await evaluateFlagshipMediaPortfolio(
      flagshipMediaPortfolio,
      evaluationOptions,
    );
  }
  const flagshipMediaPortfolioGate =
    portfolioEvaluation === null && flagshipMediaPortfolioReport !== null
      ? {
        required: true,
        contract_id: FLAGSHIP_MEDIA_PORTFOLIO_CONTRACT_ID,
        status: "blocked",
        portfolio_status: "UNEVALUATED_REPORT_REJECTED",
        blockers: ["flagship_media_portfolio_raw_manifest_required"],
        blocker_codes: ["flagship_media_portfolio_raw_manifest_required"],
        evidence: null,
      }
      : buildFlagshipMediaPortfolioGate(portfolioEvaluation);
  const systemSummary = summariseStatuses(systemRows);
  const artefactSummary = summariseRequiredRows(artefactRows);
  const testSummary = summariseRequiredRows(testRows);
  const allGreen =
    systemSummary.missing === 0 &&
    systemSummary.partial === 0 &&
    artefactSummary.missing === 0 &&
    testSummary.missing === 0 &&
    thirtyStoryGate.status === "pass" &&
    flagshipMediaPortfolioGate.status === "pass";

  const status = allGreen && publishCutoverGate.status === "pass"
    ? "GOAL_ACCEPTANCE_READY"
    : "IN_PROGRESS";

  const report = {
    schema_version: 1,
    goal_id: GOAL_ID,
    goal_version: GOAL_VERSION,
    generated_at: generatedAt,
    status,
    no_fake_readiness: true,
    operating_modes: OPERATING_MODES,
    required_systems: systemRows,
    system_summary: systemSummary,
    required_artefacts: artefactRows,
    required_artefacts_summary: artefactSummary,
    required_tests: testRows,
    required_tests_summary: testSummary,
    acceptance_30_story_gate: thirtyStoryGate,
    publish_cutover_gate: publishCutoverGate,
    flagship_media_portfolio_gate: flagshipMediaPortfolioGate,
    safety: {
      read_only: true,
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_safety_gate_weakening: true,
    },
  };

  report.next_actions = buildNextActions({
    systemRows,
    artefactRows,
    testRows,
    thirtyStoryGate,
    publishCutoverGate,
    flagshipMediaPortfolioGate,
  });
  return report;
}

function renderGoalContractMarkdown(report = {}) {
  const lines = [];
  lines.push("# Pulse Gaming Goal Contract");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Status: ${report.status || "unknown"}`);
  lines.push(`Systems: ${report.system_summary?.implemented || 0} implemented, ${report.system_summary?.partial || 0} partial, ${report.system_summary?.missing || 0} missing`);
  lines.push(`Artefacts: ${report.required_artefacts_summary?.present || 0} present, ${report.required_artefacts_summary?.missing || 0} missing`);
  lines.push(`Tests: ${report.required_tests_summary?.present || 0} present, ${report.required_tests_summary?.missing || 0} missing`);
  lines.push(`30-story gate: ${report.acceptance_30_story_gate?.status || "unknown"} (${report.acceptance_30_story_gate?.complete_story_count || 0}/${report.acceptance_30_story_gate?.required_story_count || 30})`);
  lines.push(`Publish cutover: ${report.publish_cutover_gate?.status || "unknown"} (${report.publish_cutover_gate?.final_publish_render_count || 0}/${report.publish_cutover_gate?.required_story_count || 30} final renders)`);
  lines.push(`Flagship media portfolio: ${report.flagship_media_portfolio_gate?.status || "blocked"} (${report.flagship_media_portfolio_gate?.portfolio_status || "MISSING"}, ${report.flagship_media_portfolio_gate?.evidence?.summary?.verified_slot_count || 0}/${FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.length} verified)`);
  lines.push("");
  lines.push("## Next actions");
  const actions = Array.isArray(report.next_actions) ? report.next_actions : [];
  if (!actions.length) lines.push("- No blocking action from the contract audit.");
  for (const action of actions.slice(0, 10)) {
    lines.push(`- [${action.priority}] ${action.reason_code}: ${action.action}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Read-only audit.");
  lines.push("- No publishing was triggered.");
  lines.push("- No database mutation was performed.");
  lines.push("- No OAuth or token settings were changed.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalContractArtifacts(report, { outputDir = path.join(process.cwd(), "output", "goal-contract") } = {}) {
  await fs.ensureDir(outputDir);
  const jsonPath = path.join(outputDir, "goal_contract_report.json");
  const markdownPath = path.join(outputDir, "goal_contract_report.md");
  const matrixPath = path.join(outputDir, "goal_acceptance_matrix.json");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalContractMarkdown(report), "utf8");
  await fs.writeJson(
    matrixPath,
    {
      status: report.status,
      acceptance_status: report.status === "GOAL_ACCEPTANCE_READY" ? "pass" : "blocked",
      no_fake_readiness: report.no_fake_readiness === true,
      required_systems: report.required_systems,
      required_artefacts: report.required_artefacts,
      required_tests: report.required_tests,
      acceptance_30_story_gate: report.acceptance_30_story_gate,
      publish_cutover_gate: report.publish_cutover_gate,
      flagship_media_portfolio_gate: report.flagship_media_portfolio_gate,
    },
    { spaces: 2 },
  );
  return {
    outputDir,
    jsonPath,
    markdownPath,
    matrixPath,
  };
}

module.exports = {
  GOAL_ID,
  GOAL_VERSION,
  REQUIRED_SYSTEMS,
  REQUIRED_ARTEFACTS,
  REQUIRED_STORY_PACKAGE_ARTEFACTS,
  REQUIRED_TESTS,
  buildGoalContractReport,
  buildPublishCutoverGate,
  buildFinalRenderInputFingerprint,
  renderGoalContractMarkdown,
  verifyFinalRenderInputLineage,
  writeGoalContractArtifacts,
};
