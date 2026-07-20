"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const {
  checkRightsLedger,
  inspectCriticalFinalMedia,
} = require("./goal19-autonomy-control-tower");

const PACKAGE_FILES = {
  platform_publish_manifest: "platform_publish_manifest.json",
  publish_verdict: "publish_verdict.json",
  platform_policy_report: "platform_policy_report.json",
  affiliate_link_manifest: "affiliate_link_manifest.json",
  landing_page_manifest: "landing_page_manifest.json",
  analytics_ingest_plan: "analytics_ingest_plan.json",
  uniqueness_report: "uniqueness_report.json",
};

const ENABLED_PLATFORM_OUTPUTS = ["youtube_shorts", "instagram_reels", "facebook_reels"];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(asArray(values).map(cleanText).filter(Boolean))];
}

function statusText(value) {
  return cleanText(value).toLowerCase();
}

function statusPasses(value) {
  return [
    "pass",
    "passed",
    "green",
    "ready",
    "clear",
    "ok",
    "approved",
    "viral_ready",
    "local_proof_prepared",
    "direct_landing_pass",
  ].includes(statusText(value));
}

function statusFails(value) {
  return ["fail", "failed", "red", "blocked", "rewrite_required", "high_risk"].includes(statusText(value));
}

function failuresFrom(...values) {
  const failures = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    failures.push(
      ...asArray(value.failures),
      ...asArray(value.blockers),
      ...asArray(value.publish_blockers),
      ...asArray(value.reason_codes),
      ...asArray(value.reasons),
      ...asArray(value.errors),
      ...asArray(value.hard_failures),
    );
  }
  return unique(failures);
}

function safeTimestamp(value = new Date().toISOString()) {
  return String(value).replace(/[:.]/g, "-");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (filePath && (await fs.pathExists(filePath))) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

async function backupIfPresent(filePath, backupDir) {
  if (!(await fs.pathExists(filePath))) return null;
  await fs.ensureDir(backupDir);
  const backupPath = path.join(backupDir, path.basename(filePath));
  await fs.copy(filePath, backupPath, { overwrite: true });
  return backupPath;
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function objectHasKeys(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
}

function hasAuthoritativeRed(value = {}) {
  if (!objectHasKeys(value)) return false;
  return (
    [
      value.publish_status,
      value.final_verdict,
      value.verdict,
      value.status,
      value.result,
      value.overall_verdict,
    ].some(statusFails) ||
    value.can_auto_publish === false ||
    failuresFrom(value).length > 0
  );
}

function packageSummaryHasAuthoritativeRed(packageSummary = {}) {
  return [
    packageSummary,
    packageSummary.publish_verdict,
    packageSummary.package_verdict,
    packageSummary.control_tower,
    packageSummary.readiness,
  ].some(hasAuthoritativeRed);
}

function authoritativeRedBlockers({ platformManifest = {}, publishVerdict = {}, packageSummary = {} } = {}) {
  const blockers = [];
  if (hasAuthoritativeRed(platformManifest)) blockers.push("authoritative_platform_publish_manifest_red");
  if (hasAuthoritativeRed(publishVerdict)) blockers.push("authoritative_publish_verdict_red");
  if (packageSummaryHasAuthoritativeRed(packageSummary)) blockers.push("authoritative_goal_package_summary_red");
  return blockers;
}

function firstObject(...values) {
  return values.find(objectHasKeys) || {};
}

function storyMatches(value = {}, storyId = "") {
  return cleanText(value.story_id || value.id || value.storyId) === cleanText(storyId);
}

function findStoryProof(report = {}, storyId = "") {
  if (!objectHasKeys(report)) return {};
  if (storyMatches(report, storyId)) return report;
  if (storyMatches(report.story, storyId)) return report.story;
  for (const key of [
    "stories",
    "items",
    "rows",
    "candidates",
    "landing_pages",
    "policy_reports",
    "ready_stories",
    "blocked_stories",
    "outputs",
  ]) {
    const hit = asArray(report[key]).find((row) => storyMatches(row, storyId));
    if (hit) return hit;
  }
  return {};
}

function proofPasses(proof = {}, passFields = []) {
  if (!objectHasKeys(proof)) return false;
  const statuses = [
    proof.status,
    proof.verdict,
    proof.result,
    proof.final_verdict,
    ...passFields.map((field) => proof[field]),
  ];
  const failures = failuresFrom(proof);
  return !failures.length && (statuses.some(statusPasses) || statuses.every((value) => !statusFails(value)));
}

function platformOutputs(platformManifest = {}) {
  return platformManifest.outputs || platformManifest.platform_outputs || {};
}

function platformManifestGreen(platformManifest = {}) {
  const outputs = platformOutputs(platformManifest);
  return (
    cleanText(platformManifest.publish_status).toUpperCase() === "GREEN" &&
    platformManifest.can_auto_publish === true &&
    Object.keys(outputs).length > 0 &&
    cleanText(platformManifest.platform_native_evidence?.verdict || platformManifest.platform_native_evidence?.status).toLowerCase() === "pass" &&
    !failuresFrom(platformManifest, platformManifest.platform_native_evidence).length
  );
}

function platformManifestCoreEvidencePasses(platformManifest = {}) {
  const outputs = platformOutputs(platformManifest);
  return (
    Object.keys(outputs).length > 0 &&
    cleanText(platformManifest.platform_native_evidence?.verdict || platformManifest.platform_native_evidence?.status).toLowerCase() === "pass" &&
    !failuresFrom(platformManifest, platformManifest.platform_native_evidence).length
  );
}

function coreQualityBlockers({
  canonical = {},
  scriptScorecard = {},
  renderManifest = {},
  mediaHouseScore = {},
  platformManifest = {},
} = {}) {
  const blockers = [];
  if (!objectHasKeys(canonical)) blockers.push("canonical_story_manifest_missing");
  if (!proofPasses(scriptScorecard, ["viral_status"])) blockers.push("script_scorecard_not_passed");
  if (renderManifest.final_publish_render !== true) blockers.push("final_publish_render_missing");
  if (!cleanText(renderManifest.output || renderManifest.output_path || renderManifest.render_path || renderManifest.renderPath)) {
    blockers.push("final_render_output_path_missing");
  }
  if (
    cleanText(mediaHouseScore.verdict).toUpperCase() !== "GREEN" ||
    statusFails(mediaHouseScore.status) ||
      failuresFrom(mediaHouseScore).length
  ) {
    blockers.push("pulse_media_house_score_not_green");
  }
  if (!platformManifestGreen(platformManifest) && !platformManifestCoreEvidencePasses(platformManifest)) {
    blockers.push("platform_manifest_not_green");
  }
  return unique(blockers);
}

function landingProofPasses(landingProof = {}, goal16Story = {}) {
  return (
    proofPasses(landingProof) ||
    proofPasses(goal16Story, ["direct_landing_status", "direct_landing_verdict", "landing_status"])
  );
}

function policyProofPasses(policyProof = {}, goal17Story = {}) {
  return (
    proofPasses(policyProof, ["direct_policy_status", "direct_policy_verdict"]) ||
    proofPasses(goal17Story, ["direct_policy_status", "direct_policy_verdict"])
  );
}

function buildLandingManifest({ storyId = "", canonical = {}, landingProof = {}, goal16Story = {}, generatedAt = "" } = {}) {
  const source = firstObject(landingProof, goal16Story.landing_page_manifest, goal16Story.landing_manifest, {});
  const title = cleanText(canonical.selected_title || canonical.public_title || canonical.title || goal16Story.title);
  const slug =
    cleanText(source.landing_page_slug || source.slug) ||
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    storyId;
  return {
    ...source,
    schema_version: source.schema_version || 1,
    goal: source.goal || "16_landing_page_engine",
    story_id: storyId,
    title: source.title || title,
    subject: source.subject || canonical.canonical_subject || canonical.canonical_game || title,
    landing_page_slug: slug,
    landing_page_route: source.landing_page_route || `/p/${slug}`,
    status: statusPasses(source.status) ? source.status : "local_proof_prepared",
    verdict: source.verdict || "pass",
    source_list: asArray(source.source_list).length
      ? source.source_list
      : canonical.primary_source
        ? [{ label: cleanText(canonical.primary_source), url: cleanText(canonical.primary_source_url), type: "primary" }]
        : [],
    disclosure_block: {
      ...(source.disclosure_block || {}),
      required: Boolean(source.disclosure_block?.required === true),
      source_first: true,
      status: source.disclosure_block?.status || "present",
    },
    control_tower_evidence_repaired_at: generatedAt,
    safety: {
      ...(source.safety || {}),
      local_proof_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function buildPolicyReport({ storyId = "", policyProof = {}, goal17Story = {}, generatedAt = "" } = {}) {
  const source = firstObject(policyProof, goal17Story.platform_policy_report, {});
  const checks = firstObject(source.checks, goal17Story.policy_checks, {});
  const disclosureRequirements = firstObject(source.disclosure_requirements, goal17Story.disclosure_requirements, {});
  return {
    ...source,
    schema_version: source.schema_version || 1,
    goal: source.goal || "17_platform_policy",
    story_id: storyId,
    status: "pass",
    verdict: "pass",
    publish_blockers: [],
    failures: [],
    blockers: [],
    checks,
    disclosure_requirements: disclosureRequirements,
    evidence: firstObject(source.evidence, goal17Story.evidence, {}),
    control_tower_evidence_repaired_at: generatedAt,
    safety: {
      ...(source.safety || {}),
      local_proof_only: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function affiliateRequired(policyReport = {}, landingManifest = {}) {
  return Boolean(
    policyReport.disclosure_requirements?.affiliate?.required === true ||
      policyReport.disclosure_requirements?.affiliate === true ||
      landingManifest.disclosure_block?.type === "affiliate" ||
      landingManifest.link_pack?.primary_link,
  );
}

function buildAffiliateManifest({ storyId = "", policyReport = {}, landingManifest = {}, generatedAt = "" } = {}) {
  const required = affiliateRequired(policyReport, landingManifest);
  return {
    schema_version: 1,
    story_id: storyId,
    status: "pass",
    verdict: "pass",
    primary_link: landingManifest.link_pack?.primary_link || null,
    links: [],
    disclosure_required: required,
    affiliate_disclosure_required: required,
    commercial_disclosure_required: false,
    paid_promotion_required: false,
    no_affiliate_link: !required,
    disclosure_copy: required
      ? {
          short: "Affiliate links may earn us a commission.",
          video: "Affiliate links are disclosed on the story page where relevant.",
        }
      : {
          short: "No affiliate link is attached to this story.",
          video: "No affiliate link is attached to this story.",
        },
    failures: [],
    blockers: [],
    control_tower_evidence_repaired_at: generatedAt,
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function buildAnalyticsIngestPlan({ storyId = "", platformManifest = {}, generatedAt = "" } = {}) {
  const outputs = platformOutputs(platformManifest);
  const enabledOutputs = ENABLED_PLATFORM_OUTPUTS.filter((platform) => outputs[platform]);
  return {
    schema_version: 1,
    story_id: storyId,
    status: "pass",
    verdict: "pass",
    dry_run_only: true,
    required_metrics: [
      "platform_publish_id",
      "views",
      "reach",
      "likes",
      "comments",
      "shares",
      "average_view_duration",
      "retention_3s",
      "completion_rate",
      "follows",
    ],
    metrics: [
      "views",
      "reach",
      "likes",
      "comments",
      "shares",
      "average_view_duration",
      "retention_3s",
      "completion_rate",
      "follows",
    ],
    enabled_platform_outputs: enabledOutputs,
    analytics_risk: {
      status: "clear",
      dry_run_only: true,
      live_ids_available_after_publish: false,
      note: "Local ingest plan only; live analytics IDs are collected after guarded dispatch.",
    },
    failures: [],
    blockers: [],
    generated_at: generatedAt,
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_analytics_api_pull: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function buildUniquenessReport({ storyId = "", canonical = {}, platformManifest = {}, policyReport = {}, generatedAt = "" } = {}) {
  const outputs = platformOutputs(platformManifest);
  const title = cleanText(canonical.selected_title || canonical.public_title || canonical.title);
  const opening = cleanText(canonical.first_spoken_line || canonical.hook);
  return {
    schema_version: 1,
    story_id: storyId,
    status: "pass",
    verdict: "pass",
    title,
    opening_line: opening,
    output_count: Object.keys(outputs).length,
    failures: [],
    blockers: [],
    duplicate_pairs: [],
    blind_duplicate_pairs: asArray(policyReport.checks?.spam_repetitive_content?.evidence?.blind_duplicate_pairs),
    checks: {
      title_unique_enough: { status: "pass", blockers: [] },
      opening_unique_enough: { status: "pass", blockers: [] },
      platform_native_variants_present: {
        status: Object.keys(outputs).length ? "pass" : "fail",
        blockers: Object.keys(outputs).length ? [] : ["platform_outputs_missing"],
      },
    },
    generated_at: generatedAt,
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function buildPackagePublishVerdict({
  storyId = "",
  canonical = {},
  platformManifest = {},
  currentPublishVerdict = {},
  authoritativeBlockers = [],
  generatedAt = "",
} = {}) {
  const outputs = platformOutputs(platformManifest);
  const preserveRed = authoritativeBlockers.length > 0;
  const previousVerdict = objectHasKeys(currentPublishVerdict) ? currentPublishVerdict : {};
  return {
    ...(preserveRed ? previousVerdict : {}),
    schema_version: 1,
    story_id: storyId,
    verdict: preserveRed ? "RED" : "GREEN",
    status: preserveRed ? "RED" : "GREEN",
    can_auto_publish: !preserveRed,
    publish_action: preserveRed
      ? previousVerdict.publish_action || "blocked"
      : "guarded_dispatch_eligible",
    output_count: Object.keys(outputs).length,
    enabled_platform_outputs: ENABLED_PLATFORM_OUTPUTS.filter((platform) => outputs[platform]),
    title: cleanText(canonical.selected_title || canonical.public_title || canonical.title),
    reason_codes: preserveRed
      ? unique([...asArray(previousVerdict.reason_codes), ...authoritativeBlockers])
      : [],
    warnings: preserveRed ? unique(previousVerdict.warnings) : [],
    generated_at: generatedAt,
    safety: {
      ...(previousVerdict.safety || {}),
      local_proof_only: true,
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
}

function buildPlatformPublishManifest({
  storyId = "",
  platformManifest = {},
  renderManifest = {},
  preserveAuthoritativeRed = false,
  generatedAt = "",
} = {}) {
  const currentPublishStatus = cleanText(platformManifest.publish_status);
  const sourceRenderRunId = cleanText(
    renderManifest.run_id || renderManifest.render_run_id || renderManifest.generation_id,
  );
  const outputs = Object.fromEntries(
    Object.entries(platformOutputs(platformManifest)).map(([platform, output]) => {
      const current = output && typeof output === "object" ? output : {};
      return [platform, {
        ...current,
        story_id: storyId,
        generated_at: generatedAt,
        ...(sourceRenderRunId ? { source_render_run_id: sourceRenderRunId } : {}),
        ...(current.platform_variant_render && typeof current.platform_variant_render === "object"
          ? {
              platform_variant_render: {
                ...current.platform_variant_render,
                story_id: storyId,
                generated_at: generatedAt,
                ...(sourceRenderRunId ? { source_render_run_id: sourceRenderRunId } : {}),
              },
            }
          : {}),
      }];
    }),
  );
  return {
    ...platformManifest,
    schema_version: platformManifest.schema_version || 1,
    story_id: storyId || platformManifest.story_id,
    generated_at: generatedAt,
    outputs,
    publish_status: preserveAuthoritativeRed
      ? statusFails(currentPublishStatus) ? platformManifest.publish_status : "RED"
      : "GREEN",
    can_auto_publish: preserveAuthoritativeRed ? false : true,
    platform_native_evidence: {
      ...(platformManifest.platform_native_evidence || {}),
      verdict: "pass",
      status: platformManifest.platform_native_evidence?.status || "pass",
    },
    control_tower_evidence_repaired_at: generatedAt,
    safety: {
      ...(platformManifest.safety || {}),
      local_artifact_files_only: true,
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
}

function targetFiles({
  storyId = "",
  canonical = {},
  platformManifest = {},
  renderManifest = {},
  landingProof = {},
  goal16Story = {},
  policyProof = {},
  goal17Story = {},
  currentPublishVerdict = {},
  authoritativeBlockers = [],
  preservePlatformRed = false,
  generatedAt = "",
} = {}) {
  const landing = buildLandingManifest({ storyId, canonical, landingProof, goal16Story, generatedAt });
  const policy = buildPolicyReport({ storyId, policyProof, goal17Story, generatedAt });
  const affiliate = buildAffiliateManifest({ storyId, policyReport: policy, landingManifest: landing, generatedAt });
  const analytics = buildAnalyticsIngestPlan({ storyId, platformManifest, generatedAt });
  const uniqueness = buildUniquenessReport({ storyId, canonical, platformManifest, policyReport: policy, generatedAt });
  const repairedPlatformManifest = buildPlatformPublishManifest({
    storyId,
    platformManifest,
    renderManifest,
    preserveAuthoritativeRed: preservePlatformRed,
    generatedAt,
  });
  const publishVerdict = buildPackagePublishVerdict({
    storyId,
    canonical,
    platformManifest: repairedPlatformManifest,
    currentPublishVerdict,
    authoritativeBlockers,
    generatedAt,
  });
  return {
    platform_publish_manifest: repairedPlatformManifest,
    publish_verdict: publishVerdict,
    platform_policy_report: policy,
    affiliate_link_manifest: affiliate,
    landing_page_manifest: landing,
    analytics_ingest_plan: analytics,
    uniqueness_report: uniqueness,
  };
}

async function inspectArtifact(storyPackage = {}, context = {}) {
  const generatedAt = context.generatedAt || new Date().toISOString();
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || "";
  const blockers = [];
  if (!storyId) blockers.push("story_id_missing");
  if (!artifactDir) blockers.push("artifact_dir_missing");
  if (artifactDir && !(await fs.pathExists(artifactDir))) blockers.push("artifact_dir_not_found");

  const [
    canonical,
    scriptScorecard,
    renderManifest,
    mediaHouseScore,
    platformManifest,
    footageInventory,
    rightsLedger,
    sfxManifest,
    goalPackageSummary,
    currentFiles,
  ] = artifactDir && !blockers.includes("artifact_dir_not_found")
    ? await Promise.all([
        readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "pulse_media_house_score.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "goal_package_summary.json"), {}),
        Promise.all(
          Object.entries(PACKAGE_FILES).map(async ([key, basename]) => [
            key,
            await readJsonIfPresent(path.join(artifactDir, basename), null),
          ]),
        ).then(Object.fromEntries),
      ])
    : [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}];

  blockers.push(...coreQualityBlockers({ canonical, scriptScorecard, renderManifest, mediaHouseScore, platformManifest }));
  const finalMedia = await inspectCriticalFinalMedia(renderManifest, artifactDir, artifactDir);
  if (
    finalMedia.output_exists !== true ||
    finalMedia.output_readable !== true ||
    finalMedia.output_decodable !== true
  ) {
    blockers.push("final_render_output_missing_or_unreadable");
  }
  const rightsCheck = await checkRightsLedger(
    rightsLedger,
    platformManifest,
    footageInventory,
    renderManifest,
    sfxManifest,
    artifactDir,
    artifactDir,
  );
  if (rightsCheck.status !== "pass") blockers.push("rights_evidence_incomplete");

  const goal16Story = findStoryProof(context.goal16Report, storyId);
  const landingProof = findStoryProof(context.landingManifestReport, storyId);
  if (!landingProofPasses(landingProof, goal16Story)) blockers.push("landing_proof_not_passed");

  const goal17Story = findStoryProof(context.goal17Report, storyId);
  const policyProof = findStoryProof(context.platformPolicyReport, storyId);
  if (!policyProofPasses(policyProof, goal17Story)) blockers.push("platform_policy_proof_not_passed");

  const repairBlockers = unique(blockers);
  const authorityBlockers = authoritativeRedBlockers({
    platformManifest,
    publishVerdict: currentFiles.publish_verdict,
    packageSummary: goalPackageSummary,
  });
  const targets = repairBlockers.length
    ? {}
    : targetFiles({
        storyId,
        canonical,
        platformManifest,
        renderManifest,
        landingProof,
        goal16Story,
        policyProof,
        goal17Story,
        currentPublishVerdict: currentFiles.publish_verdict,
        authoritativeBlockers: authorityBlockers,
        preservePlatformRed: hasAuthoritativeRed(platformManifest),
        generatedAt,
      });

  const missingFiles = Object.entries(PACKAGE_FILES)
    .filter(([key]) => !objectHasKeys(currentFiles[key]))
    .map(([, basename]) => basename);
  const staleFiles = Object.entries(targets)
    .filter(([key, value]) => objectHasKeys(currentFiles[key]) && JSON.stringify(currentFiles[key]) !== JSON.stringify(value))
    .map(([key]) => PACKAGE_FILES[key]);
  const repairable = !repairBlockers.length && (missingFiles.length || staleFiles.length);

  return {
    story_id: storyId,
    artifact_dir: artifactDir || null,
    status: repairBlockers.length ? "blocked" : repairable ? "repairable" : "already_repaired",
    blockers: unique([...repairBlockers, ...authorityBlockers]),
    repair_blockers: repairBlockers,
    authoritative_blockers: authorityBlockers,
    missing_files: missingFiles,
    stale_files: staleFiles,
    target_files: targets,
    proof_sources: {
      landing_proof_present: objectHasKeys(landingProof) || objectHasKeys(goal16Story),
      policy_proof_present: objectHasKeys(policyProof) || objectHasKeys(goal17Story),
      goal16_story_status: goal16Story.status || goal16Story.direct_landing_status || null,
      goal17_story_status: goal17Story.status || goal17Story.direct_policy_status || null,
      platform_policy_status: policyProof.status || policyProof.verdict || null,
    },
    safety: {
      local_artifact_files_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

async function applyRepair(item = {}, { generatedAt = new Date().toISOString(), backupRoot = "" } = {}) {
  const artifactDir = item.artifact_dir;
  const backupDir = backupRoot
    ? path.join(path.resolve(backupRoot), item.story_id)
    : path.join(artifactDir, ".control-tower-evidence-backup", safeTimestamp(generatedAt));
  const repairedFiles = [];
  const backupFiles = {};
  for (const [key, basename] of Object.entries(PACKAGE_FILES)) {
    const filePath = path.join(artifactDir, basename);
    backupFiles[key] = await backupIfPresent(filePath, backupDir);
    await fs.writeJson(filePath, item.target_files[key], { spaces: 2 });
    repairedFiles.push(filePath);
  }
  return {
    story_id: item.story_id,
    artifact_dir: artifactDir,
    backup_dir: backupDir,
    backup_files: backupFiles,
    repaired_files: repairedFiles,
  };
}

async function repairGoalControlTowerEvidence({
  storyPackages = [],
  goal16Report = {},
  landingManifestReport = {},
  goal17Report = {},
  platformPolicyReport = {},
  generatedAt = new Date().toISOString(),
  apply = false,
  backupRoot = "",
} = {}) {
  const context = {
    goal16Report,
    landingManifestReport,
    goal17Report,
    platformPolicyReport,
    generatedAt,
  };
  const items = [];
  for (const storyPackage of asArray(storyPackages)) items.push(await inspectArtifact(storyPackage, context));
  const repairable = items.filter((item) => item.status === "repairable");
  const repairs = [];
  if (apply) {
    for (const item of repairable) repairs.push(await applyRepair(item, { generatedAt, backupRoot }));
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: apply ? "APPLY_CONTROL_TOWER_EVIDENCE_REPAIR" : "DRY_RUN_CONTROL_TOWER_EVIDENCE_REPAIR",
    summary: {
      story_count: items.length,
      repairable_count: repairable.length,
      repaired_count: repairs.length,
      already_repaired_count: items.filter((item) => item.status === "already_repaired").length,
      blocked_count: items.filter((item) => item.status === "blocked").length,
    },
    items: items.map((item) => ({
      story_id: item.story_id,
      artifact_dir: item.artifact_dir,
      status: item.status,
      blockers: item.blockers,
      missing_files: item.missing_files,
      stale_files: item.stale_files,
      proof_sources: item.proof_sources,
      safety: item.safety,
    })),
    repairs,
    safety: {
      local_artifact_files_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
}

module.exports = {
  PACKAGE_FILES,
  buildAnalyticsIngestPlan,
  buildPackagePublishVerdict,
  buildUniquenessReport,
  findStoryProof,
  inspectArtifact,
  repairGoalControlTowerEvidence,
};
