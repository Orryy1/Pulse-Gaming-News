"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "pulse_gaming_enterprise_media_os";
const GOAL_VERSION = "goal_contract_v1";

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
  const green = storyPackage.verdict === "GREEN" || storyPackage.publish_verdict === "GREEN";
  return {
    story_id: storyPackage.story_id || storyPackage.id || "unknown",
    status: missing.length === 0 && missingMaterialised.length === 0 && green ? "complete" : "incomplete",
    verdict: storyPackage.verdict || storyPackage.publish_verdict || null,
    missing_artefacts: missing,
    missing_materialised_artefacts: missingMaterialised,
    artifact_dir: storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || null,
  };
}

function buildThirtyStoryGate(storyPackages = []) {
  const rows = (Array.isArray(storyPackages) ? storyPackages : []).map(storyPackageStatus);
  const complete = rows.filter((row) => row.status === "complete").length;
  return {
    required_story_count: 30,
    story_count_seen: rows.length,
    complete_story_count: complete,
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

function buildPublishCutoverGate(storyPackages = []) {
  const rows = [];
  for (const storyPackage of Array.isArray(storyPackages) ? storyPackages : []) {
    const dir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir;
    if (!dir) continue;
    const renderManifest = readRenderManifest(storyPackage);
    rows.push({
      story_id: storyPackage.story_id || storyPackage.id || "unknown",
      artifact_dir: dir,
      final_publish_render: renderManifest?.final_publish_render === true,
      renderer: renderManifest?.renderer || null,
      visual_tier: renderManifest?.visual_tier || null,
      blocker: renderManifest?.final_publish_render === true ? null : "render_not_final_publish_ready",
    });
  }
  const finalCount = rows.filter((row) => row.final_publish_render).length;
  const blocked = rows.filter((row) => !row.final_publish_render);
  return {
    required_story_count: 30,
    evaluated_story_count: rows.length,
    final_publish_render_count: finalCount,
    status: rows.length === 0 ? "not_evaluated" : finalCount >= 30 ? "pass" : "blocked",
    blocked_stories: blocked.slice(0, 30),
  };
}

function buildNextActions({ systemRows, artefactRows, testRows, thirtyStoryGate, publishCutoverGate }) {
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

  return actions;
}

function buildGoalContractReport({
  generatedAt = new Date().toISOString(),
  moduleIndex = {},
  artefactIndex = {},
  testIndex = {},
  storyPackages = [],
} = {}) {
  const systemRows = buildSystemRows(moduleIndex, artefactIndex);
  const artefactRows = buildRequiredRows(REQUIRED_ARTEFACTS, artefactIndex);
  const testRows = buildRequiredRows(REQUIRED_TESTS, testIndex);
  const thirtyStoryGate = buildThirtyStoryGate(storyPackages);
  const publishCutoverGate = buildPublishCutoverGate(storyPackages);
  const systemSummary = summariseStatuses(systemRows);
  const artefactSummary = summariseRequiredRows(artefactRows);
  const testSummary = summariseRequiredRows(testRows);
  const allGreen =
    systemSummary.missing === 0 &&
    systemSummary.partial === 0 &&
    artefactSummary.missing === 0 &&
    testSummary.missing === 0 &&
    thirtyStoryGate.status === "pass";

  const status = allGreen && publishCutoverGate.status === "blocked"
    ? "GOAL_PROOF_READY"
    : allGreen
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
      required_systems: report.required_systems,
      required_artefacts: report.required_artefacts,
      required_tests: report.required_tests,
      acceptance_30_story_gate: report.acceptance_30_story_gate,
      publish_cutover_gate: report.publish_cutover_gate,
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
  renderGoalContractMarkdown,
  writeGoalContractArtifacts,
};
