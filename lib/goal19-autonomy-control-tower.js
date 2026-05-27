"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "19_autonomy_control_tower";

const REQUIRED_CONTROL_INPUTS = [
  "canonical_story_manifest",
  "script_scorecard",
  "footage_inventory",
  "rights_ledger",
  "director_plan",
  "render_qa",
  "benchmark_report",
  "policy_report",
  "affiliate_disclosure_report",
  "platform_pack",
  "analytics_risk",
  "anti_spam_report",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function objectText(value) {
  return cleanText(collectStrings(value).join(" "));
}

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function hasObject(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function statusPasses(value) {
  return ["pass", "passed", "green", "ready", "clear", "ok", "approved"].includes(normaliseStatus(value));
}

function statusFails(value) {
  return [
    "fail",
    "failed",
    "red",
    "blocked",
    "blocked_for_review",
    "director_blocked",
    "rewrite_required",
    "high_risk",
  ].includes(normaliseStatus(value));
}

function statusFrom(value = {}) {
  return (
    value.verdict ||
    value.result ||
    value.status ||
    value.overall_verdict ||
    value.publish_status ||
    value.quality_gate_status ||
    null
  );
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
    );
  }
  return unique(failures);
}

function gatePasses(value = {}) {
  if (!hasObject(value)) return false;
  const status = statusFrom(value);
  return !failuresFrom(value).length && statusPasses(status);
}

function gateFails(value = {}) {
  if (!hasObject(value)) return true;
  return failuresFrom(value).length > 0 || statusFails(statusFrom(value));
}

function platformOutputs(platformManifest = {}) {
  return platformManifest.outputs || platformManifest.platform_outputs || {};
}

function governanceGate(platformManifest = {}, name) {
  return platformManifest.governance_gates?.[name] || {};
}

function buildCheck({ passed, blocker, requirement, evidence = {}, warnings = [] } = {}) {
  return {
    status: passed ? "pass" : "fail",
    blockers: passed ? [] : [blocker],
    warnings: unique(warnings),
    requirement,
    evidence,
  };
}

function checkCanonical(canonical = {}) {
  const passed =
    hasObject(canonical) &&
    Boolean(cleanText(canonical.story_id || canonical.id || canonical.selected_title || canonical.canonical_title || canonical.title)) &&
    Boolean(objectText([canonical.narration_script, canonical.full_script, canonical.selected_title, canonical.canonical_title]));
  return buildCheck({
    passed,
    blocker: "control:canonical_story_manifest_missing",
    requirement: "A canonical story manifest with public title and narration evidence must exist.",
    evidence: {
      present: hasObject(canonical),
      has_public_title: Boolean(cleanText(canonical.selected_title || canonical.canonical_title || canonical.title)),
      has_script: Boolean(objectText([canonical.narration_script, canonical.full_script])),
    },
  });
}

function checkScriptScorecard(scorecard = {}) {
  const status = statusFrom(scorecard);
  const passed = hasObject(scorecard) && !failuresFrom(scorecard).length && statusPasses(status);
  return buildCheck({
    passed,
    blocker: "control:script_scorecard_not_pass",
    requirement: "The script scorecard must be pass/green with no rewrite requirement.",
    evidence: {
      present: hasObject(scorecard),
      status: status || null,
      failures: failuresFrom(scorecard),
      viral_score: scorecard.viral_score ?? null,
    },
  });
}

function checkFootageInventory(footage = {}) {
  const status = statusFrom(footage);
  const blockers = unique([...failuresFrom(footage), ...asArray(footage.readiness?.blockers)]);
  const motionCount = numeric(
    footage.motion_asset_count ||
      footage.motion_assets?.length ||
      footage.real_motion_asset_count ||
      footage.visual_evidence_profile?.motion_asset_count,
  );
  const familyCount = numeric(
    footage.distinct_motion_family_count ||
      footage.distinct_motion_families?.length ||
      footage.real_media_family_count ||
      footage.visual_evidence_profile?.real_media_family_count,
  );
  const countEvidencePasses = motionCount > 0 && familyCount > 0;
  const passed =
    hasObject(footage) &&
    !blockers.length &&
    (statusPasses(status) || (!statusFails(status) && countEvidencePasses));
  return buildCheck({
    passed,
    blocker: "control:footage_inventory_not_pass",
    requirement: "Footage inventory must have usable motion evidence and no source blockers.",
    evidence: {
      present: hasObject(footage),
      status: status || null,
      blockers,
      motion_asset_count: motionCount,
      distinct_motion_family_count: familyCount,
    },
  });
}

function checkRightsLedger(rightsLedger = {}, platformManifest = {}) {
  const gate = governanceGate(platformManifest, "rights_ledger");
  const failures = unique([...failuresFrom(rightsLedger), ...failuresFrom(gate)]);
  const passed = hasObject(rightsLedger) && !failures.length && (gatePasses(rightsLedger) || gatePasses(gate));
  return buildCheck({
    passed,
    blocker: "control:rights_ledger_not_pass",
    requirement: "Rights ledger must pass and carry no unresolved rights failures.",
    evidence: {
      present: hasObject(rightsLedger),
      status: statusFrom(rightsLedger) || statusFrom(gate) || null,
      failures,
    },
  });
}

function checkDirectorPlan(directorPlan = {}) {
  const readiness = directorPlan.readiness || {};
  const status = statusFrom(readiness) || statusFrom(directorPlan);
  const blockers = unique([...failuresFrom(directorPlan), ...failuresFrom(readiness)]);
  const hasPlan = asArray(directorPlan.shot_plan || directorPlan.beats || directorPlan.plan).length > 0;
  const passed = hasObject(directorPlan) && hasPlan && !blockers.length && (statusPasses(status) || !statusFails(status));
  return buildCheck({
    passed,
    blocker: "control:director_plan_not_pass",
    requirement: "Director plan must be ready and include an executable shot plan.",
    evidence: {
      present: hasObject(directorPlan),
      status: status || null,
      shot_count: asArray(directorPlan.shot_plan || directorPlan.beats || directorPlan.plan).length,
      blockers,
    },
  });
}

function checkRenderQa(renderManifest = {}, visualQuality = {}) {
  const renderStatus = statusFrom(renderManifest);
  const visualStatus = statusFrom(visualQuality);
  const failures = unique([...failuresFrom(renderManifest), ...failuresFrom(visualQuality)]);
  const hasOutput = Boolean(cleanText(renderManifest.output_path || renderManifest.output || renderManifest.final_video_path));
  const visualQualityPasses = hasObject(visualQuality)
    ? gatePasses(visualQuality)
    : statusPasses(renderStatus);
  const passed =
    hasObject(renderManifest) &&
    renderManifest.final_publish_render === true &&
    hasOutput &&
    visualQualityPasses &&
    !failures.length;
  return buildCheck({
    passed,
    blocker: "control:render_qa_not_pass",
    requirement: "Render manifest must represent a final publish render with passing QA evidence.",
    evidence: {
      present: hasObject(renderManifest),
      final_publish_render: renderManifest.final_publish_render === true,
      output_present: hasOutput,
      render_status: renderStatus || null,
      visual_quality_status: visualStatus || null,
      failures,
    },
  });
}

function checkBenchmarkReport(benchmark = {}) {
  const passed = gatePasses(benchmark);
  return buildCheck({
    passed,
    blocker: "control:benchmark_report_not_pass",
    requirement: "Benchmark report must pass with no reference-pack failures.",
    evidence: {
      present: hasObject(benchmark),
      status: statusFrom(benchmark) || null,
      failures: failuresFrom(benchmark),
      warnings: asArray(benchmark.warnings),
    },
  });
}

function checkPolicyReport(policyReport = {}, platformManifest = {}) {
  const gate = governanceGate(platformManifest, "platform_policy_gate");
  const publishBlockers = asArray(policyReport.publish_blockers);
  const failures = unique([...failuresFrom(policyReport), ...failuresFrom(gate), ...publishBlockers]);
  const status = statusFrom(policyReport) || statusFrom(gate);
  const passed =
    !failures.length &&
    ((hasObject(policyReport) && statusPasses(status)) ||
      gatePasses(gate) ||
      (hasObject(policyReport) && !publishBlockers.length && !statusFails(status)));
  return buildCheck({
    passed,
    blocker: "control:policy_report_not_pass",
    requirement: "Policy report must pass and expose no publish blockers.",
    evidence: {
      present: hasObject(policyReport) || hasObject(gate),
      status: status || null,
      publish_blockers: publishBlockers,
      failures,
    },
  });
}

function disclosureRequired(affiliate = {}, platformManifest = {}) {
  return Boolean(
    affiliate.disclosure_required === true ||
      affiliate.affiliate_disclosure_required === true ||
      /affiliate|commission|paid promotion|commercial content/i.test(objectText(platformManifest)),
  );
}

function disclosurePresent(affiliate = {}, platformManifest = {}) {
  return Boolean(
    objectText(affiliate.disclosure_copy).length ||
      objectText(affiliate.disclosure).length ||
      objectText(platformOutputs(platformManifest)).match(/affiliate links may earn|paid promotion|commercial content/i),
  );
}

function checkAffiliateDisclosure(affiliate = {}, platformManifest = {}) {
  const required = disclosureRequired(affiliate, platformManifest);
  const present = disclosurePresent(affiliate, platformManifest);
  const failures = failuresFrom(affiliate, governanceGate(platformManifest, "affiliate_disclosure_gate"));
  const passed = hasObject(affiliate) && !failures.length && (!required || present);
  return buildCheck({
    passed,
    blocker: "control:affiliate_disclosure_not_pass",
    requirement: "Affiliate or commercial disclosure must be present wherever required.",
    evidence: {
      present: hasObject(affiliate),
      disclosure_required: required,
      disclosure_present: present,
      failures,
    },
  });
}

function checkPlatformPack(platformManifest = {}, publishVerdict = {}) {
  const outputs = platformOutputs(platformManifest);
  const status = cleanText(platformManifest.publish_status || publishVerdict.verdict || platformManifest.status);
  const outputCount = Object.keys(outputs || {}).length;
  const failures = failuresFrom(platformManifest, publishVerdict);
  const passed = hasObject(platformManifest) && outputCount > 0 && status.toUpperCase() === "GREEN" && !failures.length;
  return buildCheck({
    passed,
    blocker: "control:platform_pack_not_green",
    requirement: "Platform pack must be GREEN with at least one native platform output.",
    evidence: {
      present: hasObject(platformManifest),
      status: status || null,
      output_count: outputCount,
      can_auto_publish: platformManifest.can_auto_publish === true || publishVerdict.can_auto_publish === true,
      failures,
    },
  });
}

function checkAnalyticsRisk(analytics = {}) {
  const failures = failuresFrom(analytics);
  const status = statusFrom(analytics);
  const metricCount = asArray(analytics.required_metrics || analytics.metrics || analytics.metrics_required).length;
  const hasPlan = metricCount > 0 || hasObject(analytics.analytics_risk) || hasObject(analytics.metric_risk);
  const passed = hasObject(analytics) && hasPlan && !failures.length && !statusFails(status);
  return buildCheck({
    passed,
    blocker: "control:analytics_risk_missing",
    requirement: "Analytics risk or dry-run ingest plan must exist before final publish verdict.",
    evidence: {
      present: hasObject(analytics),
      status: status || null,
      metric_count: metricCount,
      dry_run_only: analytics.dry_run_only === true,
      failures,
    },
  });
}

function checkAntiSpam(uniqueness = {}, platformManifest = {}) {
  const antiSpamGate = governanceGate(platformManifest, "anti_spam_uniqueness_gate");
  const failures = unique([...failuresFrom(uniqueness), ...failuresFrom(antiSpamGate)]);
  const passed = !failures.length && (gatePasses(uniqueness) || gatePasses(antiSpamGate));
  return buildCheck({
    passed,
    blocker: "control:anti_spam_not_pass",
    requirement: "Anti-spam and uniqueness report must pass.",
    evidence: {
      uniqueness_report_present: hasObject(uniqueness),
      gate_present: hasObject(antiSpamGate),
      status: statusFrom(uniqueness) || statusFrom(antiSpamGate) || null,
      failures,
    },
  });
}

function buildGoal18Index(upstreamFirewallReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamFirewallReport.stories || upstreamFirewallReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamBlockers(storyId, firewallIndex = new Map()) {
  const row = firewallIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal18_finance_crypto_firewall_missing"];
  const status = normaliseStatus(row.status || row.verdict || row.final_verdict);
  if (["ready", "pass", "passed", "green"].includes(status) && !asArray(row.blockers).length) return [];
  return unique(["upstream:goal18_finance_crypto_firewall_blocked", ...asArray(row.blockers)]);
}

function humanApproval({ canonical = {}, platformManifest = {}, publishVerdict = {}, storyPackage = {} } = {}) {
  const required = Boolean(
    storyPackage.human_review_required === true ||
      storyPackage.requires_human_review === true ||
      canonical.human_review_required === true ||
      platformManifest.human_review_required === true ||
      publishVerdict.verdict === "AMBER" ||
      platformManifest.publish_status === "AMBER",
  );
  return {
    required,
    reason: cleanText(
      storyPackage.human_review_reason ||
        canonical.human_review_reason ||
        platformManifest.human_review_reason ||
        publishVerdict.human_review_reason ||
        "Human approval required before publishing.",
    ),
  };
}

async function inspectStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const scriptScorecard = await readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {});
  const footageInventory = await readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {});
  const rightsLedger = await readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {});
  const directorPlan = await readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {});
  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {});
  const visualQuality = await readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"), {});
  const benchmark = await readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {});
  const policyReport = await readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json"), {});
  const affiliate = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const analytics = await readJsonIfPresent(path.join(artifactDir, "analytics_ingest_plan.json"), {});
  const uniqueness = await readJsonIfPresent(path.join(artifactDir, "uniqueness_report.json"), {});
  const publishVerdict = await readJsonIfPresent(path.join(artifactDir, "publish_verdict.json"), {});

  const controlInputs = {
    canonical_story_manifest: checkCanonical(canonical),
    script_scorecard: checkScriptScorecard(scriptScorecard),
    footage_inventory: checkFootageInventory(footageInventory),
    rights_ledger: checkRightsLedger(rightsLedger, platformManifest),
    director_plan: checkDirectorPlan(directorPlan),
    render_qa: checkRenderQa(renderManifest, visualQuality),
    benchmark_report: checkBenchmarkReport(benchmark),
    policy_report: checkPolicyReport(policyReport, platformManifest),
    affiliate_disclosure_report: checkAffiliateDisclosure(affiliate, platformManifest),
    platform_pack: checkPlatformPack(platformManifest, publishVerdict),
    analytics_risk: checkAnalyticsRisk(analytics),
    anti_spam_report: checkAntiSpam(uniqueness, platformManifest),
  };
  const directBlockers = unique(Object.values(controlInputs).flatMap((check) => asArray(check.blockers)));
  const upstream = upstreamBlockers(storyId, context.firewallIndex);
  const approval = humanApproval({ canonical, platformManifest, publishVerdict, storyPackage });
  const finalVerdict = directBlockers.length || upstream.length ? "RED" : approval.required ? "AMBER" : "GREEN";
  const canAutoPublish =
    finalVerdict === "GREEN" &&
    (platformManifest.can_auto_publish === true || publishVerdict.can_auto_publish === true) &&
    cleanText(platformManifest.publish_status || publishVerdict.verdict).toUpperCase() === "GREEN";
  const blockers = unique([...upstream, ...directBlockers]);

  return {
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.short_title || canonical.canonical_title || storyPackage.title),
    artifact_dir: artifactDir,
    final_verdict: finalVerdict,
    status: finalVerdict === "GREEN" ? "ready" : finalVerdict === "AMBER" ? "needs_human_review" : "blocked",
    can_auto_publish: canAutoPublish,
    publish_action: finalVerdict === "GREEN" ? "none_local_proof_dry_run_only" : finalVerdict === "AMBER" ? "none_human_review_required" : "none_blocked",
    approval_required: approval.required || finalVerdict !== "GREEN",
    approval_reason: approval.required ? approval.reason : null,
    direct_control_tower_status: directBlockers.length ? "blocked" : "pass",
    upstream_status: upstream.length ? "blocked" : "ready",
    blockers,
    upstream_blockers: upstream,
    direct_control_tower_blockers: directBlockers,
    control_inputs: controlInputs,
    risk_profile: {
      story_id: storyId,
      final_verdict: finalVerdict,
      risk_level: finalVerdict === "RED" ? "high" : finalVerdict === "AMBER" ? "medium" : "low",
      risk_categories: unique([
        ...(upstream.length ? ["upstream_dependency"] : []),
        ...(directBlockers.length ? ["control_input"] : []),
        ...(approval.required ? ["human_approval"] : []),
      ]),
      direct_blockers: directBlockers,
      upstream_blockers: upstream,
    },
    source_material: {
      canonical_story_manifest_present: hasObject(canonical),
      script_scorecard_present: hasObject(scriptScorecard),
      footage_inventory_present: hasObject(footageInventory),
      rights_ledger_present: hasObject(rightsLedger),
      director_plan_present: hasObject(directorPlan),
      render_manifest_present: hasObject(renderManifest),
      benchmark_report_present: hasObject(benchmark),
      policy_report_present: hasObject(policyReport),
      affiliate_manifest_present: hasObject(affiliate),
      platform_publish_manifest_present: hasObject(platformManifest),
      analytics_ingest_plan_present: hasObject(analytics),
      uniqueness_report_present: hasObject(uniqueness),
    },
    safety: {
      local_proof_only: true,
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function countBy(stories = [], key) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const value of asArray(story[key])) counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function directRiskCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.direct_control_tower_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function buildPublishVerdict(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "DRY_RUN_PUBLISH",
    overall_verdict: report.verdict || "UNKNOWN",
    publish_now_count: 0,
    green_story_count: report.summary?.green_story_count || 0,
    amber_story_count: report.summary?.amber_story_count || 0,
    red_story_count: report.summary?.red_story_count || 0,
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      title: story.title,
      verdict: story.final_verdict,
      can_auto_publish: story.can_auto_publish === true,
      publish_action: story.publish_action,
      approval_required: story.approval_required === true,
      blockers: story.blockers,
      upstream_blockers: story.upstream_blockers,
      direct_control_tower_blockers: story.direct_control_tower_blockers,
    })),
    safety: {
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_production_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function buildRiskReport(report = {}) {
  const stories = asArray(report.stories).map((story) => story.risk_profile);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    overall_risk_level:
      stories.some((story) => story.risk_level === "high") ? "high" : stories.some((story) => story.risk_level === "medium") ? "medium" : "low",
    risk_category_counts: countBy(stories, "risk_categories"),
    stories,
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
    },
  };
}

function buildRejectionReasons(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      final_verdict: story.final_verdict,
      rejected: story.final_verdict === "RED",
      direct_reasons: story.direct_control_tower_blockers,
      upstream_reasons: story.upstream_blockers,
      all_reasons: story.blockers,
    })),
    safety: {
      no_public_output_mutation: true,
      no_publish_triggered: true,
    },
  };
}

function buildApprovalRequirements(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    human_operator_required: asArray(report.stories).some((story) => story.final_verdict !== "GREEN"),
    stories: asArray(report.stories).map((story) => {
      if (story.final_verdict === "GREEN") {
        return {
          story_id: story.story_id,
          status: "no_approval_required",
          requirements: [],
        };
      }
      if (story.final_verdict === "AMBER") {
        return {
          story_id: story.story_id,
          status: "human_review_required",
          requirements: ["human_approval_required"],
          reason: story.approval_reason,
        };
      }
      return {
        story_id: story.story_id,
        status: "blocked_until_repairs",
        requirements: unique([
          ...(story.upstream_blockers.length ? ["resolve_goal18_and_upstream_campaign_blockers"] : []),
          ...(story.direct_control_tower_blockers.length ? ["repair_direct_control_tower_inputs"] : []),
          "rerun_goal19_autonomy_control_tower",
        ]),
        blockers: story.blockers,
      };
    }),
    safety: {
      no_approval_record_mutation: true,
      no_publish_triggered: true,
    },
  };
}

async function buildGoal19AutonomyControlTower({
  storyPackages = [],
  upstreamFirewallReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal19AutonomyControlTower requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const firewallIndex = buildGoal18Index(upstreamFirewallReport);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, { workspaceRoot, firewallIndex }));
  }
  const greenStories = stories.filter((story) => story.final_verdict === "GREEN");
  const amberStories = stories.filter((story) => story.final_verdict === "AMBER");
  const redStories = stories.filter((story) => story.final_verdict === "RED");
  const directPassStories = stories.filter((story) => story.direct_control_tower_status === "pass");
  const directBlockedStories = stories.filter((story) => story.direct_control_tower_status !== "pass");
  const upstreamBlockedStories = stories.filter((story) => story.upstream_status === "blocked");
  const verdict = !stories.length
    ? "FAIL"
    : redStories.length && greenStories.length + amberStories.length
      ? "PARTIAL"
      : redStories.length
        ? "BLOCKED"
        : amberStories.length
          ? "PARTIAL"
          : "PASS";
  const directControlTowerVerdict = !stories.length
    ? "FAIL"
    : directBlockedStories.length && directPassStories.length
      ? "PARTIAL"
      : directBlockedStories.length
        ? "BLOCKED"
        : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    direct_control_tower_verdict: directControlTowerVerdict,
    final_verdict_contract: {
      GREEN: "safe to auto-publish after operator enables live publish controls",
      AMBER: "usable but requires human approval",
      RED: "blocked",
    },
    summary: {
      story_count: stories.length,
      green_story_count: greenStories.length,
      amber_story_count: amberStories.length,
      red_story_count: redStories.length,
      control_ready_story_count: greenStories.length,
      blocked_story_count: redStories.length,
      human_review_story_count: amberStories.length,
      direct_control_tower_pass_story_count: directPassStories.length,
      direct_control_tower_blocked_story_count: directBlockedStories.length,
      upstream_blocked_story_count: upstreamBlockedStories.length,
      publish_now_count: 0,
    },
    required_control_inputs: REQUIRED_CONTROL_INPUTS,
    blocker_counts: blockerCounts(stories),
    direct_risk_counts: directRiskCounts(stories),
    upstream_blockers: {
      goal18_finance_and_crypto_firewall:
        "Goal 19 can inspect final verdict inputs locally, but readiness requires Goal 18 and all earlier campaign gates to be ready first.",
      note:
        "This gate emits LOCAL_PROOF and DRY_RUN_PUBLISH artefacts only. It does not publish, post externally, mutate production rows, inspect secrets or change OAuth/token state.",
    },
    stories,
    safety: {
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
  report.publish_verdict = buildPublishVerdict(report);
  report.risk_report = buildRiskReport(report);
  report.rejection_reasons = buildRejectionReasons(report);
  report.approval_requirements = buildApprovalRequirements(report);
  return report;
}

function renderGoal19AutonomyControlTowerMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 19 Autonomy Control Tower");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct control tower verdict: ${report.direct_control_tower_verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`GREEN stories: ${report.summary?.green_story_count || 0}`);
  lines.push(`AMBER stories: ${report.summary?.amber_story_count || 0}`);
  lines.push(`RED stories: ${report.summary?.red_story_count || 0}`);
  lines.push(`Direct control-pass stories: ${report.summary?.direct_control_tower_pass_story_count || 0}`);
  lines.push(`Direct control-blocked stories: ${report.summary?.direct_control_tower_blocked_story_count || 0}`);
  lines.push(`Upstream-blocked stories: ${report.summary?.upstream_blocked_story_count || 0}`);
  lines.push(`Publish-now actions: ${report.summary?.publish_now_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Direct control input blockers");
  const direct = Object.keys(report.direct_risk_counts || {}).sort();
  if (!direct.length) lines.push("- none");
  for (const blocker of direct) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF and DRY_RUN_PUBLISH only. This run did not publish, post externally, mutate the database, touch OAuth or token files, inspect secrets or weaken gates.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal19AutonomyControlTower(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal19AutonomyControlTower requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal19_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal19_readiness_report.md");
  const publishVerdict = path.join(outDir, "publish_verdict.json");
  const riskReport = path.join(outDir, "risk_report.json");
  const rejectionReasons = path.join(outDir, "rejection_reasons.json");
  const approvalRequirements = path.join(outDir, "approval_requirements.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal19AutonomyControlTowerMarkdown(report), "utf8");
  await fs.writeJson(publishVerdict, report.publish_verdict || buildPublishVerdict(report), { spaces: 2 });
  await fs.writeJson(riskReport, report.risk_report || buildRiskReport(report), { spaces: 2 });
  await fs.writeJson(rejectionReasons, report.rejection_reasons || buildRejectionReasons(report), { spaces: 2 });
  await fs.writeJson(approvalRequirements, report.approval_requirements || buildApprovalRequirements(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    publishVerdict,
    riskReport,
    rejectionReasons,
    approvalRequirements,
  };
}

module.exports = {
  GOAL_ID,
  REQUIRED_CONTROL_INPUTS,
  buildApprovalRequirements,
  buildGoal19AutonomyControlTower,
  buildPublishVerdict,
  buildRejectionReasons,
  buildRiskReport,
  inspectStoryPackage,
  renderGoal19AutonomyControlTowerMarkdown,
  writeGoal19AutonomyControlTower,
};
