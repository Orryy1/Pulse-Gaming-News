"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "23_security_secrets_deployment_safety";

const REQUIRED_SECURITY_CONTROLS = [
  "no_hardcoded_tokens",
  "no_secrets_in_logs",
  "scoped_oauth",
  "token_rotation_plan",
  "environment_separation",
  "least_privilege",
  "local_dev_prod_modes",
  "dry_run_publishing",
  "queue_approval",
  "emergency_kill_switch",
  "retry_logging",
  "audit_trail",
  "rollback_path",
  "safe_api_handling",
];

const SECRET_VALUE_PATTERN =
  /\b(sk_live_[A-Za-z0-9_=-]{16,}|sk-[A-Za-z0-9]{24,}|ghp_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,}|xox[baprs]-[A-Za-z0-9-]{20,}|ya29\.[A-Za-z0-9_-]{20,})\b/g;

const SECRET_ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|token|secret|password|client[_-]?secret|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*["'`]([^"'`]{20,})["'`]/gi;

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const EXCLUDED_NAMES = new Set([
  ".git",
  ".cache",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "output",
  "test-output",
  "tokens",
]);

const EXCLUDED_SECRET_PATHS = [".env", ".env.*", "tokens/**"];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function passLike(value) {
  return ["pass", "passed", "ready", "green", "ok", "clear"].includes(normaliseStatus(value));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function failuresFrom(...values) {
  const failures = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    failures.push(
      ...asArray(value.failures),
      ...asArray(value.blockers),
      ...asArray(value.publish_blockers),
      ...asArray(value.direct_registry_blockers),
      ...asArray(value.upstream_blockers),
      ...asArray(value.reason_codes),
      ...asArray(value.errors),
    );
  }
  return unique(failures);
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

function relativeTo(workspaceRoot, value) {
  const resolved = path.resolve(value);
  const relative = path.relative(path.resolve(workspaceRoot || process.cwd()), resolved);
  return relative && !relative.startsWith("..") ? relative.replace(/\\/g, "/") : resolved;
}

function shaPrefix(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function likelyPlaceholder(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return true;
  return (
    text.includes("process.env") ||
    text.includes("your_") ||
    text.includes("replace_me") ||
    text.includes("placeholder") ||
    text.includes("example") ||
    text.includes("dummy") ||
    text.includes("redacted") ||
    text.includes("<") ||
    text.includes("{")
  );
}

function redactLine(line, secretValue = null) {
  let out = String(line || "").slice(0, 260);
  if (secretValue) out = out.split(secretValue).join("[REDACTED]");
  out = out.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
  out = out.replace(SECRET_ASSIGNMENT_PATTERN, (_match, key) => `${key}="[REDACTED]"`);
  return out;
}

function secretLogRisk(line) {
  const text = String(line || "");
  if (!/\b(console|logger)\.(log|info|warn|error|debug)\b/i.test(text)) return false;
  if (/\bprocess\.env\.[A-Z0-9_]*(TOKEN|SECRET|KEY|PASSWORD)\b/i.test(text)) return true;
  if (/\$\{[^}]*\b(api[_-]?key|token|secret|password|client[_-]?secret|access[_-]?token|refresh[_-]?token)\b[^}]*\}/i.test(text)) return true;
  if (/\b(api[_-]?key|token|secret|password|client[_-]?secret|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*(\$\{|[A-Za-z_$][\w$]*|\+)/i.test(text)) return true;
  if (/\b(console|logger)\.(log|info|warn|error|debug)\s*\(\s*(apiKey|token|secret|password|clientSecret|accessToken|refreshToken)\b/i.test(text)) return true;
  return false;
}

function finding({ workspaceRoot, filePath, lineNumber, kind, severity, line, secretValue = null }) {
  return {
    file: relativeTo(workspaceRoot, filePath),
    line: lineNumber,
    kind,
    severity,
    redacted_snippet: redactLine(line, secretValue),
    value_sha256_prefix: secretValue ? shaPrefix(secretValue) : null,
    secret_value_redacted: true,
  };
}

async function scanFileForSecrets(filePath, workspaceRoot) {
  const findings = [];
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    for (const match of line.matchAll(SECRET_VALUE_PATTERN)) {
      const secretValue = match[1];
      if (likelyPlaceholder(secretValue)) continue;
      findings.push(finding({
        workspaceRoot,
        filePath,
        lineNumber,
        kind: "hardcoded_token",
        severity: "high",
        line,
        secretValue,
      }));
    }

    SECRET_ASSIGNMENT_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(SECRET_ASSIGNMENT_PATTERN)) {
      const secretValue = match[2];
      if (likelyPlaceholder(secretValue)) continue;
      findings.push(finding({
        workspaceRoot,
        filePath,
        lineNumber,
        kind: "hardcoded_token",
        severity: "high",
        line,
        secretValue,
      }));
    }

    if (secretLogRisk(line)) {
      findings.push(finding({
        workspaceRoot,
        filePath,
        lineNumber,
        kind: "secret_log_risk",
        severity: "high",
        line,
      }));
    }
  }
  return findings;
}

function isExcludedPath(filePath) {
  const parts = path.resolve(filePath).split(path.sep);
  return parts.some((part) => EXCLUDED_NAMES.has(part)) || /^\.env(\.|$)/i.test(path.basename(filePath));
}

async function collectSourceFiles(rootPath, out = []) {
  if (!rootPath || !(await fs.pathExists(rootPath))) return out;
  const stat = await fs.stat(rootPath);
  if (isExcludedPath(rootPath)) return out;
  if (stat.isFile()) {
    if (SOURCE_EXTENSIONS.has(path.extname(rootPath).toLowerCase()) && stat.size <= 1024 * 1024) out.push(rootPath);
    return out;
  }
  if (!stat.isDirectory()) return out;
  const entries = await fs.readdir(rootPath);
  for (const entry of entries) {
    await collectSourceFiles(path.join(rootPath, entry), out);
  }
  return out;
}

async function scanSourceRootsForSecrets({ workspaceRoot = process.cwd(), sourceRoots = [] } = {}) {
  const resolvedRoots = asArray(sourceRoots).map((sourceRoot) => resolveWorkspacePath(workspaceRoot, sourceRoot));
  const files = [];
  for (const sourceRoot of resolvedRoots) {
    await collectSourceFiles(sourceRoot, files);
  }

  const findings = [];
  for (const filePath of unique(files)) {
    findings.push(...await scanFileForSecrets(filePath, workspaceRoot));
  }

  return {
    schema_version: 1,
    scanned_file_count: unique(files).length,
    source_roots: resolvedRoots.map((sourceRoot) => relativeTo(workspaceRoot, sourceRoot)),
    excluded_secret_paths: EXCLUDED_SECRET_PATHS,
    findings,
    finding_count: findings.length,
    secret_values_exposed: false,
  };
}

function normaliseSourceScan(sourceScan = {}) {
  const findings = asArray(sourceScan.findings).map((item) => ({
    file: cleanText(item.file),
    line: Number.isFinite(Number(item.line)) ? Number(item.line) : null,
    kind: cleanText(item.kind || "unknown"),
    severity: cleanText(item.severity || "unknown"),
    redacted_snippet: redactLine(item.redacted_snippet || item.snippet || ""),
    value_sha256_prefix: item.value_sha256_prefix || null,
    secret_value_redacted: true,
  }));
  return {
    schema_version: sourceScan.schema_version || 1,
    scanned_file_count: Number.isFinite(Number(sourceScan.scanned_file_count)) ? Number(sourceScan.scanned_file_count) : 0,
    source_roots: asArray(sourceScan.source_roots),
    excluded_secret_paths: asArray(sourceScan.excluded_secret_paths).length ? asArray(sourceScan.excluded_secret_paths) : EXCLUDED_SECRET_PATHS,
    findings,
    finding_count: findings.length,
    secret_values_exposed: false,
  };
}

function buildGoal22Index(upstreamRegistryReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamRegistryReport.stories || upstreamRegistryReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamBlockers(storyId, registryIndex = new Map()) {
  const row = registryIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal22_versioned_prompt_model_registry_missing"];
  const blockers = failuresFrom(row);
  const status = normaliseStatus(row.status || row.verdict || row.final_verdict);
  if (passLike(status) && blockers.length === 0) return [];
  return unique(["upstream:goal22_versioned_prompt_model_registry_blocked", ...blockers]);
}

function publishNowCount(dryRunPlan = {}) {
  const summaryCount = Number(dryRunPlan.summary?.platform_publish_now_action_count ?? dryRunPlan.publish_now_count ?? 0);
  const actions = asArray(dryRunPlan.actions).filter((action) => {
    const type = normaliseStatus(action.action || action.action_type || action.type || action.status);
    return Boolean(action.publish_now || type.includes("publish_now") || type === "publish");
  }).length;
  return Math.max(Number.isFinite(summaryCount) ? summaryCount : 0, actions);
}

function truthyEvidence(value) {
  if (value === true) return true;
  if (typeof value === "string") return ["true", "pass", "present", "enabled", "available", "ready"].includes(normaliseStatus(value));
  if (value && typeof value === "object") {
    if (value.present === true || value.enabled === true || value.available === true || value.status === "pass") return true;
  }
  return false;
}

function tokenRotationStatus(securitySnapshot = {}) {
  const plan = securitySnapshot.token_rotation_plan;
  const days = Number(plan?.rotation_days ?? plan?.days ?? securitySnapshot.token_rotation_days);
  if (!plan && !Number.isFinite(days)) {
    return { pass: false, blocker: "security:token_rotation_plan_missing", evidence: null };
  }
  if (Number.isFinite(days) && days > 90) {
    return { pass: false, blocker: "security:token_rotation_period_too_long", evidence: { rotation_days: days } };
  }
  if (truthyEvidence(plan) || Number.isFinite(days)) {
    return { pass: true, blocker: null, evidence: { rotation_days: Number.isFinite(days) ? days : null } };
  }
  return { pass: false, blocker: "security:token_rotation_plan_missing", evidence: null };
}

function control(control, pass, blocker, evidence = null) {
  return {
    control,
    status: pass ? "pass" : "blocked",
    blocker: pass ? null : blocker,
    evidence,
  };
}

function evaluateDirectSafety({ securitySnapshot = {}, sourceScan = {}, dryRunPlan = {} } = {}) {
  const findings = asArray(sourceScan.findings);
  const hardcodedFindings = findings.filter((item) => item.kind === "hardcoded_token");
  const logFindings = findings.filter((item) => item.kind === "secret_log_risk");
  const rotation = tokenRotationStatus(securitySnapshot);
  const dryRunMode = normaliseStatus(dryRunPlan.mode || dryRunPlan.publish_mode || dryRunPlan.operating_mode);
  const publishNow = publishNowCount(dryRunPlan);
  const dryRunPublishing =
    truthyEvidence(securitySnapshot.dry_run_publishing) ||
    (dryRunMode === "dry_run_publish" && publishNow === 0);

  const controls = [
    control("no_hardcoded_tokens", hardcodedFindings.length === 0, "security:hardcoded_token_findings", {
      finding_count: hardcodedFindings.length,
    }),
    control("no_secrets_in_logs", logFindings.length === 0, "security:secret_logging_risk", {
      finding_count: logFindings.length,
    }),
    control("scoped_oauth", truthyEvidence(securitySnapshot.scoped_oauth), "security:scoped_oauth_evidence_missing"),
    control("token_rotation_plan", rotation.pass, rotation.blocker, rotation.evidence),
    control("environment_separation", truthyEvidence(securitySnapshot.environment_separation), "deployment:environment_separation_missing"),
    control("least_privilege", truthyEvidence(securitySnapshot.least_privilege), "security:least_privilege_missing"),
    control("local_dev_prod_modes", truthyEvidence(securitySnapshot.local_dev_prod_modes), "deployment:local_dev_prod_modes_missing"),
    control("dry_run_publishing", dryRunPublishing, "deployment:dry_run_publish_mode_missing", {
      mode: dryRunPlan.mode || null,
      publish_now_count: publishNow,
    }),
    control("queue_approval", truthyEvidence(securitySnapshot.queue_approval), "deployment:queue_approval_missing"),
    control("emergency_kill_switch", truthyEvidence(securitySnapshot.emergency_kill_switch), "deployment:emergency_kill_switch_missing"),
    control("retry_logging", truthyEvidence(securitySnapshot.retry_logging), "deployment:retry_logging_missing"),
    control("audit_trail", truthyEvidence(securitySnapshot.audit_trail), "security:audit_trail_missing"),
    control("rollback_path", truthyEvidence(securitySnapshot.rollback_path), "deployment:rollback_path_missing"),
    control("safe_api_handling", truthyEvidence(securitySnapshot.safe_api_handling), "security:safe_api_handling_missing"),
  ];

  return {
    controls,
    blockers: unique(controls.filter((item) => item.status !== "pass").map((item) => item.blocker)),
    warnings: unique(asArray(securitySnapshot.warnings)),
    publish_now_count: publishNow,
  };
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
    for (const blocker of asArray(story.direct_safety_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function finaliseStory(storyPackage = {}, registryIndex = new Map(), directSafety = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const upstream = upstreamBlockers(storyId, registryIndex);
  const directBlockers = asArray(directSafety.blockers);
  const blockers = unique([...upstream, ...directBlockers]);
  return {
    story_id: storyId,
    artifact_dir: cleanText(storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir),
    title: cleanText(storyPackage.title || storyPackage.selected_title),
    status: blockers.length ? "blocked" : "ready",
    upstream_status: upstream.length ? "blocked" : "ready",
    direct_safety_status: directBlockers.length ? "blocked" : "pass",
    blockers,
    upstream_blockers: upstream,
    direct_safety_blockers: directBlockers,
    publish_allowed_by_goal23: false,
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

function buildSecurityReport(report = {}, directSafety = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    verdict: report.direct_safety_verdict || "FAIL",
    required_controls: REQUIRED_SECURITY_CONTROLS,
    controls: asArray(directSafety.controls),
    blockers: asArray(directSafety.blockers),
    direct_risk_counts: report.direct_risk_counts || {},
    hard_publish_policy: {
      live_publish_allowed: false,
      oauth_or_token_mutation_allowed: false,
      production_db_mutation_allowed: false,
      secret_file_content_inspection_allowed: false,
    },
    safety: report.safety,
  };
}

function buildDeploymentSafetyReport(report = {}, directSafety = {}, dryRunPlan = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    verdict: report.direct_safety_verdict || "FAIL",
    publish_allowed_by_goal23: false,
    dry_run_mode: dryRunPlan.mode || dryRunPlan.publish_mode || null,
    publish_now_count: directSafety.publish_now_count || 0,
    required_controls: REQUIRED_SECURITY_CONTROLS.filter((item) =>
      [
        "environment_separation",
        "least_privilege",
        "local_dev_prod_modes",
        "dry_run_publishing",
        "queue_approval",
        "emergency_kill_switch",
        "retry_logging",
        "audit_trail",
        "rollback_path",
        "safe_api_handling",
      ].includes(item),
    ),
    controls: asArray(directSafety.controls).filter((item) =>
      [
        "environment_separation",
        "least_privilege",
        "local_dev_prod_modes",
        "dry_run_publishing",
        "queue_approval",
        "emergency_kill_switch",
        "retry_logging",
        "audit_trail",
        "rollback_path",
        "safe_api_handling",
      ].includes(item.control),
    ),
    blockers: asArray(directSafety.blockers).filter((item) => item.startsWith("deployment:") || item === "security:audit_trail_missing" || item === "security:safe_api_handling_missing"),
    safety: report.safety,
  };
}

async function buildGoal23SecuritySecretsDeploymentSafety({
  storyPackages = [],
  upstreamRegistryReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
  securitySnapshot = {},
  sourceScan = null,
  sourceRoots = [],
  dryRunPlan = {},
} = {}) {
  if (!outputDir) throw new Error("buildGoal23SecuritySecretsDeploymentSafety requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const scan = sourceScan
    ? normaliseSourceScan(sourceScan)
    : await scanSourceRootsForSecrets({ workspaceRoot, sourceRoots });
  const directSafety = evaluateDirectSafety({ securitySnapshot, sourceScan: scan, dryRunPlan });
  const registryIndex = buildGoal22Index(upstreamRegistryReport);
  const stories = asArray(storyPackages).map((storyPackage) => finaliseStory(storyPackage, registryIndex, directSafety));
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const directPassStories = stories.filter((story) => story.direct_safety_status === "pass");
  const directBlockedStories = stories.filter((story) => story.direct_safety_status === "blocked");
  const upstreamBlockedStories = stories.filter((story) => story.upstream_status === "blocked");
  const verdict = !stories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const directSafetyVerdict = !stories.length
    ? "FAIL"
    : directBlockedStories.length
      ? "BLOCKED"
      : "PASS";

  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    direct_safety_verdict: directSafetyVerdict,
    summary: {
      story_count: stories.length,
      security_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_safety_pass_story_count: directPassStories.length,
      direct_safety_blocked_story_count: directBlockedStories.length,
      upstream_blocked_story_count: upstreamBlockedStories.length,
      secret_finding_count: scan.finding_count,
      publish_now_count: directSafety.publish_now_count,
    },
    required_security_controls: REQUIRED_SECURITY_CONTROLS,
    blocker_counts: blockerCounts(stories),
    direct_risk_counts: directRiskCounts(stories),
    upstream_blockers: {
      goal22_versioned_prompt_model_registry:
        "Goal 23 can compile local security and deployment safety artefacts, but readiness still requires Goal 22 and earlier campaign gates to pass first.",
      note:
        "This gate emits LOCAL_PROOF files only. It does not publish, post externally, mutate production rows, inspect secret file contents or change OAuth/token state.",
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
      excluded_secret_paths: EXCLUDED_SECRET_PATHS,
    },
  };
  report.security_report = buildSecurityReport(report, directSafety);
  report.secrets_scan_report = {
    ...scan,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    blocked_by_findings: scan.finding_count > 0,
    secret_values_exposed: false,
  };
  report.deployment_safety_report = buildDeploymentSafetyReport(report, directSafety, dryRunPlan);
  return report;
}

function renderGoal23SecuritySecretsDeploymentSafetyMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 23 - Security, Secrets and Deployment Safety");
  lines.push("");
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct safety verdict: ${report.direct_safety_verdict || "UNKNOWN"}`);
  lines.push(`Mode: ${report.mode || "LOCAL_PROOF"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Stories checked: ${report.summary?.story_count ?? 0}`);
  lines.push(`- Ready stories: ${report.summary?.security_ready_story_count ?? 0}`);
  lines.push(`- Blocked stories: ${report.summary?.blocked_story_count ?? 0}`);
  lines.push(`- Upstream-blocked stories: ${report.summary?.upstream_blocked_story_count ?? 0}`);
  lines.push(`- Direct safety pass stories: ${report.summary?.direct_safety_pass_story_count ?? 0}`);
  lines.push(`- Direct safety blocked stories: ${report.summary?.direct_safety_blocked_story_count ?? 0}`);
  lines.push(`- Secret scan findings: ${report.summary?.secret_finding_count ?? 0}`);
  lines.push(`- Publish-now actions: ${report.summary?.publish_now_count ?? 0}`);
  lines.push("");
  lines.push("## Direct Blockers");
  const directBlockers = Object.keys(report.direct_risk_counts || {});
  if (directBlockers.length) {
    for (const blocker of directBlockers) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  } else {
    lines.push("- None.");
  }
  lines.push("");
  lines.push("## Main Blockers");
  const blockers = Object.keys(report.blocker_counts || {});
  if (blockers.length) {
    for (const blocker of blockers.slice(0, 40)) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
    if (blockers.length > 40) lines.push(`- Additional blocker types: ${blockers.length - 40}`);
  } else {
    lines.push("- None.");
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- LOCAL_PROOF only.");
  lines.push("- DRY_RUN_PUBLISH boundary preserved.");
  lines.push("- No live publishing, external posting, production DB mutation, OAuth/token mutation or secret value exposure.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal23SecuritySecretsDeploymentSafety(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal23SecuritySecretsDeploymentSafety requires outputDir");
  await fs.ensureDir(outputDir);
  const paths = {
    readinessJson: path.join(outputDir, "goal23_readiness_report.json"),
    readinessMarkdown: path.join(outputDir, "goal23_readiness_report.md"),
    securityReport: path.join(outputDir, "security_report.json"),
    secretsScanReport: path.join(outputDir, "secrets_scan_report.json"),
    deploymentSafetyReport: path.join(outputDir, "deployment_safety_report.json"),
  };
  await fs.writeJson(paths.readinessJson, report, { spaces: 2 });
  await fs.outputFile(paths.readinessMarkdown, renderGoal23SecuritySecretsDeploymentSafetyMarkdown(report));
  await fs.writeJson(paths.securityReport, report.security_report || {}, { spaces: 2 });
  await fs.writeJson(paths.secretsScanReport, report.secrets_scan_report || {}, { spaces: 2 });
  await fs.writeJson(paths.deploymentSafetyReport, report.deployment_safety_report || {}, { spaces: 2 });
  return paths;
}

module.exports = {
  GOAL_ID,
  REQUIRED_SECURITY_CONTROLS,
  buildGoal23SecuritySecretsDeploymentSafety,
  renderGoal23SecuritySecretsDeploymentSafetyMarkdown,
  scanSourceRootsForSecrets,
  writeGoal23SecuritySecretsDeploymentSafety,
};
