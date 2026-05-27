"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "22_versioned_prompt_model_registry";

const REQUIRED_VERSION_FIELDS = [
  "git_commit",
  "renderer_version",
  "script_prompt_version",
  "director_version",
  "policy_ruleset",
  "benchmark_pack_version",
  "voice_model",
  "audio_model",
  "visual_model",
  "affiliate_ruleset",
  "platform_pack_version",
  "publishing_mode",
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

function hasObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
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

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function passLike(value) {
  return ["pass", "passed", "ready", "green", "ok", "clear"].includes(normaliseStatus(value));
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
      ...asArray(value.errors),
    );
  }
  return unique(failures);
}

function warningsFrom(...values) {
  const warnings = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    warnings.push(...asArray(value.warnings));
  }
  return unique(warnings);
}

function firstPresent(candidates = []) {
  for (const candidate of candidates) {
    const value = candidate.value;
    if (Array.isArray(value) && value.length) {
      return {
        value: value.map((item) => cleanText(item)).filter(Boolean).join("|"),
        source: candidate.source,
      };
    }
    if (value !== null && value !== undefined && cleanText(value)) {
      return {
        value: cleanText(value),
        source: candidate.source,
      };
    }
  }
  return { value: null, source: null };
}

function versionField(field, candidates = []) {
  const found = firstPresent(candidates);
  return {
    field,
    value: found.value,
    source: found.source,
    status: found.value ? "recorded" : "missing",
  };
}

function schemaVersionLabel(prefix, source, value) {
  if (value === null || value === undefined || value === "") return null;
  return `${prefix}_schema_v${value}`;
}

function buildGoal21Index(upstreamObservabilityReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamObservabilityReport.stories || upstreamObservabilityReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamBlockers(storyId, observabilityIndex = new Map()) {
  const row = observabilityIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal21_observability_dashboard_missing"];
  const blockers = failuresFrom(row);
  const status = normaliseStatus(row.status || row.verdict || row.direct_observability_status || row.final_verdict);
  if (passLike(status) && blockers.length === 0) return [];
  return unique(["upstream:goal21_observability_dashboard_blocked", ...blockers]);
}

function buildVersionFields({
  gitContext = {},
  canonical = {},
  scriptScorecard = {},
  directorPlan = {},
  renderManifest = {},
  platformPolicyReport = {},
  benchmarkReport = {},
  audioManifest = {},
  affiliateManifest = {},
  platformManifest = {},
} = {}) {
  return {
    git_commit: versionField("git_commit", [
      { value: gitContext.commit, source: "git.rev_parse_head" },
    ]),
    renderer_version: versionField("renderer_version", [
      { value: renderManifest.renderer_version, source: "render_manifest.renderer_version" },
      { value: renderManifest.renderer, source: "render_manifest.renderer" },
      { value: renderManifest.engine, source: "render_manifest.engine" },
    ]),
    script_prompt_version: versionField("script_prompt_version", [
      { value: canonical.script_prompt_version, source: "canonical_story_manifest.script_prompt_version" },
      { value: scriptScorecard.prompt_version, source: "script_scorecard.prompt_version" },
      { value: scriptScorecard.execution_mode, source: "script_scorecard.execution_mode" },
      { value: canonical.public_copy_repair_strategy, source: "canonical_story_manifest.public_copy_repair_strategy" },
    ]),
    director_version: versionField("director_version", [
      { value: directorPlan.director_version, source: "director_beat_map.director_version" },
      { value: directorPlan.execution_mode, source: "director_beat_map.execution_mode" },
    ]),
    policy_ruleset: versionField("policy_ruleset", [
      { value: platformPolicyReport.policy_ruleset, source: "platform_policy_report.policy_ruleset" },
      { value: platformPolicyReport.ruleset_version, source: "platform_policy_report.ruleset_version" },
      { value: platformManifest.policy_ruleset, source: "platform_publish_manifest.policy_ruleset" },
      { value: platformManifest.governance_refresh_source, source: "platform_publish_manifest.governance_refresh_source" },
      { value: renderManifest.visual_design_policy_version, source: "render_manifest.visual_design_policy_version" },
    ]),
    benchmark_pack_version: versionField("benchmark_pack_version", [
      { value: benchmarkReport.benchmark_pack_version, source: "benchmark_report.benchmark_pack_version" },
      { value: benchmarkReport.reference_pack_version, source: "benchmark_report.reference_pack_version" },
      { value: benchmarkReport.reference_pack_used, source: "benchmark_report.reference_pack_used" },
      { value: schemaVersionLabel("benchmark_report", "benchmark_report.schema_version", benchmarkReport.schema_version), source: "benchmark_report.schema_version" },
    ]),
    voice_model: versionField("voice_model", [
      { value: audioManifest.voice_model, source: "audio_manifest.voice_model" },
      { value: audioManifest.voice_id, source: "audio_manifest.voice_id" },
      { value: audioManifest.voice_provider, source: "audio_manifest.voice_provider" },
    ]),
    audio_model: versionField("audio_model", [
      { value: audioManifest.audio_model, source: "audio_manifest.audio_model" },
      { value: audioManifest.tts_model, source: "audio_manifest.tts_model" },
      { value: renderManifest.voice_mix_policy_version, source: "render_manifest.voice_mix_policy_version" },
      { value: renderManifest.sfx_mix_policy_version, source: "render_manifest.sfx_mix_policy_version" },
    ]),
    visual_model: versionField("visual_model", [
      { value: renderManifest.visual_model, source: "render_manifest.visual_model" },
      { value: renderManifest.visual_tier, source: "render_manifest.visual_tier" },
      { value: renderManifest.visual_design_policy_version, source: "render_manifest.visual_design_policy_version" },
    ]),
    affiliate_ruleset: versionField("affiliate_ruleset", [
      { value: affiliateManifest.affiliate_ruleset, source: "affiliate_link_manifest.affiliate_ruleset" },
      { value: affiliateManifest.ruleset_version, source: "affiliate_link_manifest.ruleset_version" },
      {
        value: schemaVersionLabel(
          "affiliate_attribution",
          "affiliate_link_manifest.landing_page_attribution.schema_version",
          affiliateManifest.landing_page_attribution?.schema_version,
        ),
        source: "affiliate_link_manifest.landing_page_attribution.schema_version",
      },
      { value: affiliateManifest.disclosure_required === true ? "affiliate_disclosure_required" : null, source: "affiliate_link_manifest.disclosure_required" },
    ]),
    platform_pack_version: versionField("platform_pack_version", [
      { value: platformManifest.platform_pack_version, source: "platform_publish_manifest.platform_pack_version" },
      { value: platformManifest.pack_version, source: "platform_publish_manifest.pack_version" },
      { value: schemaVersionLabel("platform_publish_manifest", "platform_publish_manifest.schema_version", platformManifest.schema_version), source: "platform_publish_manifest.schema_version" },
    ]),
    publishing_mode: versionField("publishing_mode", [
      { value: platformManifest.operating_mode, source: "platform_publish_manifest.operating_mode" },
      { value: platformManifest.publishing_mode, source: "platform_publish_manifest.publishing_mode" },
      { value: platformManifest.publish_mode, source: "platform_publish_manifest.publish_mode" },
    ]),
  };
}

function missingFieldBlockers(versionFields = {}) {
  return REQUIRED_VERSION_FIELDS
    .filter((field) => versionFields[field]?.status !== "recorded")
    .map((field) => `versioning:${field}_missing`);
}

async function loadStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const scriptScorecard = await readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {});
  const directorPlan = await readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {});
  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {});
  const platformPolicyReport = await readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json"), {});
  const benchmarkReport = await readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {});
  const audioManifest = await readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {});
  const affiliateManifest = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const versionFields = buildVersionFields({
    gitContext: context.gitContext,
    canonical,
    scriptScorecard,
    directorPlan,
    renderManifest,
    platformPolicyReport,
    benchmarkReport,
    audioManifest,
    affiliateManifest,
    platformManifest,
  });
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    title: cleanText(canonical.selected_title || canonical.canonical_title || storyPackage.title),
    output_path: cleanText(renderManifest.output_path || renderManifest.output || ""),
    fingerprint: cleanText(renderManifest.input_fingerprint?.signature || renderManifest.input_fingerprint?.hash || ""),
    platform_outputs: Object.keys(platformManifest.outputs || {}),
    version_fields: versionFields,
    source_material: {
      canonical_story_manifest_present: hasObject(canonical),
      script_scorecard_present: hasObject(scriptScorecard),
      director_beat_map_present: hasObject(directorPlan),
      render_manifest_present: hasObject(renderManifest),
      platform_policy_report_present: hasObject(platformPolicyReport),
      benchmark_report_present: hasObject(benchmarkReport),
      audio_manifest_present: hasObject(audioManifest),
      affiliate_manifest_present: hasObject(affiliateManifest),
      platform_publish_manifest_present: hasObject(platformManifest),
    },
  };
}

function finaliseStory(story = {}, observabilityIndex = new Map()) {
  const upstream = upstreamBlockers(story.story_id, observabilityIndex);
  const directBlockers = missingFieldBlockers(story.version_fields);
  const directStatus = directBlockers.length ? "blocked" : "pass";
  const blockers = unique([...upstream, ...directBlockers]);
  const status = blockers.length ? "blocked" : "ready";
  return {
    ...story,
    status,
    upstream_status: upstream.length ? "blocked" : "ready",
    direct_registry_status: directStatus,
    blockers,
    upstream_blockers: upstream,
    direct_registry_blockers: directBlockers,
    warnings: contextWarnings(story.version_fields),
    lineage_complete: directBlockers.length === 0,
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

function contextWarnings(versionFields = {}) {
  const warnings = [];
  if (versionFields.git_commit?.value && versionFields.git_commit.value.length < 12) {
    warnings.push("versioning:git_commit_short");
  }
  return warnings;
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
    for (const blocker of asArray(story.direct_registry_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function compactFields(versionFields = {}) {
  const out = {};
  for (const field of REQUIRED_VERSION_FIELDS) {
    out[field] = {
      value: versionFields[field]?.value || null,
      source: versionFields[field]?.source || null,
      status: versionFields[field]?.status || "missing",
    };
  }
  return out;
}

function buildProductionAuditLog(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    audit_policy: {
      every_published_output_requires_complete_lineage: true,
      publish_allowed_by_this_goal: false,
    },
    entries: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      title: story.title,
      status: story.status,
      git_commit: story.version_fields?.git_commit?.value || null,
      publishing_mode: story.version_fields?.publishing_mode?.value || null,
      output_path: story.output_path || null,
      platform_outputs: story.platform_outputs,
      lineage_complete: story.lineage_complete,
      publish_allowed_by_goal22: false,
      blockers: story.blockers,
      version_fields: compactFields(story.version_fields),
    })),
    safety: {
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
    },
  };
}

function buildModelPromptRegistry(report = {}) {
  const entries = {};
  for (const field of REQUIRED_VERSION_FIELDS) {
    const values = {};
    for (const story of asArray(report.stories)) {
      const row = story.version_fields?.[field];
      const key = row?.value || null;
      if (!key) continue;
      values[key] = values[key] || {
        value: key,
        source: row.source || null,
        story_count: 0,
        story_ids: [],
      };
      values[key].story_count += 1;
      values[key].story_ids.push(story.story_id);
    }
    entries[field] = Object.values(values);
  }
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    registry_version: "model_prompt_registry_v1",
    registry_fields: REQUIRED_VERSION_FIELDS,
    entries,
    missing_field_counts: directRiskCounts(report.stories),
    safety: {
      no_publish_triggered: true,
      no_secret_values_exposed: true,
    },
  };
}

function buildVideoLineageManifest(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    videos: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      title: story.title,
      output_path: story.output_path || null,
      input_fingerprint: story.fingerprint || null,
      platform_outputs: story.platform_outputs,
      lineage_complete: story.lineage_complete,
      blocked_by_upstream: story.upstream_status === "blocked",
      blockers: story.blockers,
      version_fields: compactFields(story.version_fields),
    })),
    safety: {
      no_publish_triggered: true,
      no_external_posting: true,
    },
  };
}

async function buildGoal22VersionedPromptModelRegistry({
  storyPackages = [],
  upstreamObservabilityReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
  gitContext = {},
} = {}) {
  if (!outputDir) throw new Error("buildGoal22VersionedPromptModelRegistry requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const observabilityIndex = buildGoal21Index(upstreamObservabilityReport);
  const loadedStories = [];
  for (const storyPackage of asArray(storyPackages)) {
    loadedStories.push(await loadStoryPackage(storyPackage, { workspaceRoot, gitContext }));
  }
  const stories = loadedStories.map((story) => finaliseStory(story, observabilityIndex));
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const directPassStories = stories.filter((story) => story.direct_registry_status === "pass");
  const directBlockedStories = stories.filter((story) => story.direct_registry_status === "blocked");
  const upstreamBlockedStories = stories.filter((story) => story.upstream_status === "blocked");
  const verdict = !stories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const directRegistryVerdict = !stories.length
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
    direct_registry_verdict: directRegistryVerdict,
    summary: {
      story_count: stories.length,
      version_registry_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_registry_pass_story_count: directPassStories.length,
      direct_registry_blocked_story_count: directBlockedStories.length,
      upstream_blocked_story_count: upstreamBlockedStories.length,
      publish_now_count: 0,
    },
    required_version_fields: REQUIRED_VERSION_FIELDS,
    git_context: {
      commit: gitContext.commit || null,
      branch: gitContext.branch || null,
      dirty: Boolean(gitContext.dirty),
      dirty_warning: gitContext.dirty ? "Working tree has uncommitted changes; published output should be rebuilt from a clean commit before live release." : null,
    },
    blocker_counts: blockerCounts(stories),
    direct_risk_counts: directRiskCounts(stories),
    upstream_blockers: {
      goal21_observability_dashboard:
        "Goal 22 can compile local lineage and version registry artefacts, but readiness requires Goal 21 and earlier campaign gates to be ready first.",
      note:
        "This gate emits LOCAL_PROOF files only. It does not publish, post externally, mutate production rows, inspect secrets or change OAuth/token state.",
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
  report.production_audit_log = buildProductionAuditLog(report);
  report.model_prompt_registry = buildModelPromptRegistry(report);
  report.video_lineage_manifest = buildVideoLineageManifest(report);
  return report;
}

function renderGoal22VersionedPromptModelRegistryMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 22 Versioned Prompt and Model Registry");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct registry verdict: ${report.direct_registry_verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Ready stories: ${report.summary?.version_registry_ready_story_count || 0}`);
  lines.push(`Blocked stories: ${report.summary?.blocked_story_count || 0}`);
  lines.push(`Direct pass stories: ${report.summary?.direct_registry_pass_story_count || 0}`);
  lines.push(`Direct blocked stories: ${report.summary?.direct_registry_blocked_story_count || 0}`);
  lines.push(`Upstream-blocked stories: ${report.summary?.upstream_blocked_story_count || 0}`);
  lines.push(`Publish-now actions: ${report.summary?.publish_now_count || 0}`);
  lines.push("");
  lines.push("## Required Version Fields");
  for (const field of REQUIRED_VERSION_FIELDS) lines.push(`- ${field}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Direct registry blockers");
  const direct = Object.keys(report.direct_risk_counts || {}).sort();
  if (!direct.length) lines.push("- none");
  for (const blocker of direct) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF and DRY_RUN_PUBLISH only. This run did not publish, post externally, mutate the database, touch OAuth or token files, inspect secrets or weaken gates.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal22VersionedPromptModelRegistry(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal22VersionedPromptModelRegistry requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal22_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal22_readiness_report.md");
  const productionAuditLog = path.join(outDir, "production_audit_log.json");
  const modelPromptRegistry = path.join(outDir, "model_prompt_registry.json");
  const videoLineageManifest = path.join(outDir, "video_lineage_manifest.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal22VersionedPromptModelRegistryMarkdown(report), "utf8");
  await fs.writeJson(productionAuditLog, report.production_audit_log || buildProductionAuditLog(report), { spaces: 2 });
  await fs.writeJson(modelPromptRegistry, report.model_prompt_registry || buildModelPromptRegistry(report), { spaces: 2 });
  await fs.writeJson(videoLineageManifest, report.video_lineage_manifest || buildVideoLineageManifest(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    productionAuditLog,
    modelPromptRegistry,
    videoLineageManifest,
  };
}

module.exports = {
  GOAL_ID,
  REQUIRED_VERSION_FIELDS,
  buildGoal22VersionedPromptModelRegistry,
  buildModelPromptRegistry,
  buildProductionAuditLog,
  buildVideoLineageManifest,
  renderGoal22VersionedPromptModelRegistryMarkdown,
  writeGoal22VersionedPromptModelRegistry,
};
