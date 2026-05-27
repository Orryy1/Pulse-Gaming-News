"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const RETENTION_REPAIR_STRATEGY = "retention_repair_short_cut";
const HARD_MIN_SECONDS = 15;
const TARGET_SHORT_CUT_SECONDS = { min: 22, max: 30 };
const TIKTOK_CREATOR_REWARDS_TARGET_SECONDS = { min: 61, max: 75 };

const PLATFORM_HARD_MAX_SECONDS = {
  youtube_shorts: 60,
  tiktok: 90,
  instagram_reels: 45,
  facebook_reels: 75,
  x: 60,
  snapchat_spotlight: 45,
};

function round(value, places = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

async function readJsonIfPresent(filePath, fallback = null) {
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function buildBasePlatformContract(platform, renderedDurationS) {
  const hardMax = PLATFORM_HARD_MAX_SECONDS[platform] || 60;
  const warnings = [];
  if (renderedDurationS < TARGET_SHORT_CUT_SECONDS.min) {
    warnings.push("below_retention_repair_target_duration");
  }
  return {
    publish_duration_seconds: { min: HARD_MIN_SECONDS, max: hardMax },
    target_duration_seconds: { ...TARGET_SHORT_CUT_SECONDS },
    duration_strategy: RETENTION_REPAIR_STRATEGY,
    duration_basis: "hard window is upload eligibility; target window is the current retention repair creative target",
    duration_warnings: warnings,
  };
}

function buildRetentionRepairDurationContracts(renderedDurationS) {
  const duration = Number(renderedDurationS);
  const contracts = {};
  for (const platform of Object.keys(PLATFORM_HARD_MAX_SECONDS)) {
    contracts[platform] = buildBasePlatformContract(platform, duration);
  }

  const tiktokWarnings = new Set(contracts.tiktok.duration_warnings || []);
  const creatorRewardsEligible = duration >= 61 && duration <= 90;
  if (!creatorRewardsEligible) tiktokWarnings.add("below_creator_rewards_duration");
  contracts.tiktok = {
    ...contracts.tiktok,
    creator_rewards_eligible: creatorRewardsEligible,
    creator_rewards_duration_seconds: { min: 61, max: 90 },
    duration_warnings: [...tiktokWarnings],
  };

  return contracts;
}

function mergePlatformOutput(existing = {}, contract = {}) {
  return {
    ...existing,
    ...contract,
    duration_seconds: existing.duration_seconds || contract.target_duration_seconds,
  };
}

function durationBlockers(renderedDurationS) {
  const duration = Number(renderedDurationS);
  const blockers = [];
  if (!Number.isFinite(duration) || duration <= 0) {
    blockers.push("missing_render_duration");
    return blockers;
  }
  if (duration < HARD_MIN_SECONDS) {
    blockers.push(`render_duration_below_retention_repair_min:${HARD_MIN_SECONDS}`);
  }
  if (duration > PLATFORM_HARD_MAX_SECONDS.tiktok) {
    blockers.push(`render_duration_above_longest_platform_max:${PLATFORM_HARD_MAX_SECONDS.tiktok}`);
  }
  return blockers;
}

function buildDurationVariantRepairJob({
  storyId = "",
  artifactDir = "",
  renderedDurationS = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const duration = Number(renderedDurationS);
  if (!Number.isFinite(duration) || duration >= TARGET_SHORT_CUT_SECONDS.min) {
    return null;
  }
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    status: "needs_duration_variant_rerender",
    current_duration_s: round(duration),
    target_duration_seconds: { ...TARGET_SHORT_CUT_SECONDS },
    minimum_extension_seconds: round(TARGET_SHORT_CUT_SECONDS.min - duration),
    generated_at: generatedAt,
    actions: [
      "extend_canonical_script_source_safely",
      "regenerate_audio_and_word_timestamps",
      "rerender_visual_v4_platform_variants",
      "rerun_content_video_platform_governance_preflight",
    ],
    publish_gate: "do_not_treat_as_green_until_rerendered_and_preflight_passes",
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_gate_weakened: true,
    },
  };
}

function variantDurationSeconds(output = {}) {
  return round(
    output.technical_duration_seconds ||
      output.platform_variant_render?.duration_s ||
      output.platform_variant_render?.duration_seconds,
  );
}

function variantVideoPath(output = {}) {
  return String(
    output.variant_video_path ||
      output.platform_variant_render?.output_path ||
      output.platform_variant_render?.video_path ||
      "",
  ).trim();
}

async function platformVariantAlreadyInWindow({ output = {}, artifactDir = "", maxDurationS = null } = {}) {
  const max = Number(maxDurationS);
  const duration = variantDurationSeconds(output);
  if (!Number.isFinite(max) || !Number.isFinite(duration) || duration <= 0 || duration > max) {
    return false;
  }
  const videoPath = variantVideoPath(output);
  if (!videoPath) return false;
  const resolved = path.isAbsolute(videoPath) ? videoPath : path.join(artifactDir, videoPath);
  return fs.pathExists(resolved);
}

async function tiktokCreatorRewardsVariantAlreadyReady({ output = {}, artifactDir = "" } = {}) {
  const duration = variantDurationSeconds(output);
  if (
    !Number.isFinite(duration) ||
    duration < TIKTOK_CREATOR_REWARDS_TARGET_SECONDS.min ||
    duration > PLATFORM_HARD_MAX_SECONDS.tiktok
  ) {
    return false;
  }
  const videoPath = variantVideoPath(output);
  if (!videoPath) return false;
  const resolved = path.isAbsolute(videoPath) ? videoPath : path.join(artifactDir, videoPath);
  return fs.pathExists(resolved);
}

async function buildPlatformDurationVariantRepairJobs({
  storyId = "",
  artifactDir = "",
  renderedDurationS = null,
  existingOutputs = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const duration = Number(renderedDurationS);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const jobs = [];
  for (const [platform, output] of Object.entries(existingOutputs || {})) {
    if (platform === "snapchat_spotlight") continue;
    const hardMax = PLATFORM_HARD_MAX_SECONDS[platform];
    if (!Number.isFinite(hardMax) || duration <= hardMax) continue;
    if (await platformVariantAlreadyInWindow({ output, artifactDir, maxDurationS: hardMax })) continue;
    jobs.push({
      story_id: storyId,
      artifact_dir: artifactDir,
      status: "needs_platform_duration_variant",
      platform,
      current_duration_s: round(duration),
      max_duration_s: hardMax,
      target_duration_s: round(Math.max(HARD_MIN_SECONDS, hardMax - 0.2)),
      generated_at: generatedAt,
      actions: [
        "materialize_platform_specific_duration_variant",
        "trim_platform_captions_to_variant_duration",
        "rerun_strict_dry_run_publish_preflight",
      ],
      publish_gate: "do_not_count_platform_ready_until_variant_file_exists_and_preflight_passes",
      safety: {
        no_publish_triggered: true,
        no_db_mutation: true,
        no_gate_weakened: true,
      },
    });
  }
  return jobs;
}

async function buildTiktokCreatorRewardsVariantRepairJob({
  storyId = "",
  artifactDir = "",
  renderedDurationS = null,
  existingOutputs = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const duration = Number(renderedDurationS);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration >= TIKTOK_CREATOR_REWARDS_TARGET_SECONDS.min ||
    duration > PLATFORM_HARD_MAX_SECONDS.tiktok
  ) {
    return null;
  }
  const tiktokOutput = existingOutputs.tiktok || {};
  if (await tiktokCreatorRewardsVariantAlreadyReady({ output: tiktokOutput, artifactDir })) return null;
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    status: "needs_tiktok_creator_rewards_variant",
    platform: "tiktok",
    current_duration_s: round(duration),
    target_duration_seconds: { ...TIKTOK_CREATOR_REWARDS_TARGET_SECONDS },
    publish_duration_seconds: { min: HARD_MIN_SECONDS, max: PLATFORM_HARD_MAX_SECONDS.tiktok },
    minimum_extension_seconds: round(TIKTOK_CREATOR_REWARDS_TARGET_SECONDS.min - duration),
    output_variant_dir: path.join(artifactDir, "platform_variants", "tiktok_creator_rewards"),
    generated_at: generatedAt,
    actions: [
      "write_tiktok_specific_script_extension_source_safely",
      "regenerate_tiktok_variant_audio_and_word_timestamps",
      "materialize_tiktok_long_platform_variant",
      "rerun_tiktok_upload_preflight",
      "rerun_strict_dry_run_publish_preflight",
    ],
    publish_gate: "do_not_count_tiktok_creator_rewards_ready_until_long_variant_audio_render_captions_and_preflight_pass",
    notes: [
      "The base short remains eligible for TikTok upload when platform duration rules pass.",
      "This work order is for platform-native TikTok monetisation readiness, not a live publish approval.",
    ],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

async function repairStoryPackageDurationContract(storyPackage = {}, { generatedAt = new Date().toISOString() } = {}) {
  const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir;
  const storyId = storyPackage.story_id || "unknown";
  if (!artifactDir) {
    return { story_id: storyId, artifact_dir: null, status: "blocked", blockers: ["missing_artifact_dir"] };
  }

  const renderPath = path.join(artifactDir, "render_manifest.json");
  const manifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const renderManifest = await readJsonIfPresent(renderPath);
  const platformManifest = await readJsonIfPresent(manifestPath);
  const blockers = [];
  if (!renderManifest) blockers.push("missing_render_manifest");
  if (!platformManifest) blockers.push("missing_platform_publish_manifest");

  const renderedDurationS = round(
    renderManifest?.rendered_duration_s ||
      renderManifest?.duration_s ||
      renderManifest?.video_duration_s,
  );
  blockers.push(...durationBlockers(renderedDurationS));

  if (blockers.length) {
    return {
      story_id: storyPackage.story_id || renderManifest?.story_id || platformManifest?.story_id || storyId,
      artifact_dir: artifactDir,
      status: "blocked",
      rendered_duration_s: renderedDurationS,
      blockers,
    };
  }

  const contracts = buildRetentionRepairDurationContracts(renderedDurationS);
  const existingOutputs = platformManifest.outputs || {};
  const outputs = { ...existingOutputs };
  for (const [platform, contract] of Object.entries(contracts)) {
    outputs[platform] = mergePlatformOutput(existingOutputs[platform], contract);
  }

  const updatedManifest = {
    ...platformManifest,
    operating_mode: "DRY_RUN_PUBLISH",
    duration_contract_strategy: RETENTION_REPAIR_STRATEGY,
    rendered_duration_s: renderedDurationS,
    duration_contract_updated_at: generatedAt,
    outputs,
    safety: {
      ...(platformManifest.safety || {}),
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };

  await fs.writeJson(manifestPath, updatedManifest, { spaces: 2 });
  const story_id = storyPackage.story_id || renderManifest.story_id || platformManifest.story_id || storyId;
  const variantRepairJob = buildDurationVariantRepairJob({
    storyId: story_id,
    artifactDir,
    renderedDurationS,
    generatedAt,
  });
  const platformVariantRepairJobs = await buildPlatformDurationVariantRepairJobs({
    storyId: story_id,
    artifactDir,
    renderedDurationS,
    existingOutputs,
    generatedAt,
  });
  const tiktokCreatorRewardsVariantJob = await buildTiktokCreatorRewardsVariantRepairJob({
    storyId: story_id,
    artifactDir,
    renderedDurationS,
    existingOutputs,
    generatedAt,
  });
  const variantRepairJobs = [
    ...(variantRepairJob ? [variantRepairJob] : []),
    ...platformVariantRepairJobs,
  ];
  return {
    story_id,
    artifact_dir: artifactDir,
    status: "updated",
    rendered_duration_s: renderedDurationS,
    duration_contract_strategy: RETENTION_REPAIR_STRATEGY,
    variant_repair_required: variantRepairJobs.length > 0,
    variant_repair_job: variantRepairJob,
    variant_repair_jobs: variantRepairJobs,
    platform_variant_repair_jobs: platformVariantRepairJobs,
    tiktok_creator_rewards_variant_required: !!tiktokCreatorRewardsVariantJob,
    tiktok_creator_rewards_variant_job: tiktokCreatorRewardsVariantJob,
    warnings: Object.entries(outputs)
      .flatMap(([platform, output]) => asArray(output.duration_warnings).map((warning) => `${platform}:${warning}`)),
  };
}

async function repairGoalPlatformDurationContracts({
  storyPackages = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const updated = [];
  const blocked = [];
  for (const storyPackage of asArray(storyPackages)) {
    const result = await repairStoryPackageDurationContract(storyPackage, { generatedAt });
    if (result.status === "updated") updated.push(result);
    else blocked.push(result);
  }
  const variantRepairJobs = updated.flatMap((item) => asArray(item.variant_repair_jobs));
  const tiktokCreatorRewardsVariantJobs = updated
    .map((item) => item.tiktok_creator_rewards_variant_job)
    .filter(Boolean);

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "DRY_RUN_PUBLISH",
    strategy: RETENTION_REPAIR_STRATEGY,
    min_render_duration_s: HARD_MIN_SECONDS,
    target_duration_seconds: { ...TARGET_SHORT_CUT_SECONDS },
    summary: {
      package_count: updated.length + blocked.length,
      updated_count: updated.length,
      blocked_count: blocked.length,
      variant_repair_required_count: variantRepairJobs.length,
      tiktok_creator_rewards_variant_required_count: tiktokCreatorRewardsVariantJobs.length,
    },
    updated,
    blocked,
    variant_repair_work_order: {
      schema_version: 1,
      generated_at: generatedAt,
      mode: "DURATION_VARIANT_RERENDER_WORK_ORDER",
      jobs: variantRepairJobs,
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_gate_weakened: true,
      },
    },
    tiktok_creator_rewards_variant_work_order: {
      schema_version: 1,
      generated_at: generatedAt,
      mode: "TIKTOK_CREATOR_REWARDS_VARIANT_WORK_ORDER",
      jobs: tiktokCreatorRewardsVariantJobs,
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_gate_weakened: true,
      },
    },
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function renderGoalPlatformDurationContractMarkdown(report = {}) {
  const lines = [];
  const formatTargetDuration = (job = {}) => {
    if (Number.isFinite(Number(job.target_duration_s))) return `${Number(job.target_duration_s)}s`;
    const target = job.target_duration_seconds || {};
    const min = Number(target.min);
    const max = Number(target.max);
    if (Number.isFinite(min) && Number.isFinite(max)) return `${min}-${max}s`;
    return "target duration missing";
  };
  lines.push("# Goal Platform Duration Contract");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Strategy: ${report.strategy || RETENTION_REPAIR_STRATEGY}`);
  lines.push(`Updated packages: ${report.summary?.updated_count || 0}`);
  lines.push(`Blocked packages: ${report.summary?.blocked_count || 0}`);
  lines.push(`Variant rerenders required: ${report.summary?.variant_repair_required_count || 0}`);
  lines.push(`TikTok creator-rewards variants required: ${report.summary?.tiktok_creator_rewards_variant_required_count || 0}`);
  lines.push("");
  lines.push("Hard publish windows are kept separate from creative target durations.");
  lines.push("TikTok Creator Rewards duration is recorded as a warning when the cut is under 61 seconds.");
  const jobs = asArray(report.variant_repair_work_order?.jobs);
  if (jobs.length) {
    lines.push("");
    lines.push("## Duration Variant Rerenders");
    for (const job of jobs.slice(0, 20)) {
      lines.push(
        `- ${job.story_id}: ${job.current_duration_s}s -> ${formatTargetDuration(job)} (${asArray(job.actions).join(", ")})`,
      );
    }
  }
  const tiktokJobs = asArray(report.tiktok_creator_rewards_variant_work_order?.jobs);
  if (tiktokJobs.length) {
    lines.push("");
    lines.push("## TikTok Creator-Rewards Variants");
    for (const job of tiktokJobs.slice(0, 20)) {
      lines.push(
        `- ${job.story_id}: ${job.current_duration_s}s -> ${formatTargetDuration(job)} (${asArray(job.actions).join(", ")})`,
      );
    }
  }
  if (asArray(report.blocked).length) {
    lines.push("");
    lines.push("## Blocked");
    for (const item of asArray(report.blocked).slice(0, 20)) {
      lines.push(`- ${item.story_id}: ${asArray(item.blockers).join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function writeGoalPlatformDurationContractReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalPlatformDurationContractReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "platform_duration_contract_report.json");
  const markdownPath = path.join(outDir, "platform_duration_contract_report.md");
  const variantWorkOrderPath = path.join(outDir, "duration_variant_rerender_work_order.json");
  const tiktokCreatorRewardsWorkOrderPath = path.join(outDir, "tiktok_creator_rewards_variant_work_order.json");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalPlatformDurationContractMarkdown(report), "utf8");
  await fs.writeJson(variantWorkOrderPath, report.variant_repair_work_order || { jobs: [] }, { spaces: 2 });
  await fs.writeJson(
    tiktokCreatorRewardsWorkOrderPath,
    report.tiktok_creator_rewards_variant_work_order || { jobs: [] },
    { spaces: 2 },
  );
  return { outputDir: outDir, jsonPath, markdownPath, variantWorkOrderPath, tiktokCreatorRewardsWorkOrderPath };
}

module.exports = {
  RETENTION_REPAIR_STRATEGY,
  HARD_MIN_SECONDS,
  TARGET_SHORT_CUT_SECONDS,
  TIKTOK_CREATOR_REWARDS_TARGET_SECONDS,
  buildRetentionRepairDurationContracts,
  buildDurationVariantRepairJob,
  repairStoryPackageDurationContract,
  repairGoalPlatformDurationContracts,
  renderGoalPlatformDurationContractMarkdown,
  writeGoalPlatformDurationContractReport,
};
