"use strict";

const { execFileSync } = require("node:child_process");

const { getPublicUrl } = require("../deployment-mode");
const { fetchJson } = require("./local-primary-readiness");
const { buildPublishCadenceReportFromDb } = require("./publish-cadence");
const { resolveRuntimeBuildInfo } = require("../runtime-build-info");

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function execText(args, { cwd = process.cwd(), execFileSyncImpl = execFileSync } = {}) {
  try {
    return String(
      execFileSyncImpl("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 2000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }) || "",
    ).trim();
  } catch {
    return null;
  }
}

function buildGitStatus({
  cwd = process.cwd(),
  execFileSyncImpl = execFileSync,
} = {}) {
  let porcelain = null;
  try {
    porcelain = String(
      execFileSyncImpl("git", ["status", "--porcelain"], {
        cwd,
        encoding: "utf8",
        timeout: 2000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }) || "",
    ).trimEnd();
  } catch {
    porcelain = null;
  }
  const lines = porcelain ? porcelain.split(/\r?\n/).filter(Boolean) : [];
  return {
    clean: lines.length === 0,
    changed_count: lines.length,
    changed_files: lines.slice(0, 25),
    truncated: lines.length > 25,
  };
}

function healthBuild(health) {
  return health?.json?.build || null;
}

function healthDeployment(health) {
  return health?.json?.deployment || null;
}

function commitsMatch(expected, running) {
  if (!expected || !running) return false;
  return String(expected).slice(0, 12) === String(running).slice(0, 12);
}

function cadenceHardGateState(env = {}) {
  const requireWindow =
    truthy(env.PUBLISH_REQUIRE_WINDOW) || truthy(env.PUBLISH_WINDOW_HARD_GATE);
  const requireGap =
    truthy(env.PUBLISH_REQUIRE_MIN_GAP) || truthy(env.PUBLISH_COOLDOWN_HARD_GATE);
  return {
    require_window: requireWindow,
    require_min_gap: requireGap,
    all_required: requireWindow && requireGap,
    env: {
      PUBLISH_REQUIRE_WINDOW: env.PUBLISH_REQUIRE_WINDOW || null,
      PUBLISH_WINDOW_HARD_GATE: env.PUBLISH_WINDOW_HARD_GATE || null,
      PUBLISH_REQUIRE_MIN_GAP: env.PUBLISH_REQUIRE_MIN_GAP || null,
      PUBLISH_COOLDOWN_HARD_GATE: env.PUBLISH_COOLDOWN_HARD_GATE || null,
    },
  };
}

function summariseCadence(report) {
  return {
    verdict: report?.verdict || "unknown",
    public_posts: report?.summary?.published_count || 0,
    off_schedule_posts: report?.summary?.off_schedule_count || 0,
    tight_spacing_pairs: report?.summary?.burst_pairs || 0,
    min_gap_minutes: report?.summary?.min_gap_minutes ?? null,
    failed_rows_with_platform_ids:
      report?.summary?.failed_rows_with_platform_ids || 0,
    invalid_public_story_rows: report?.summary?.invalid_public_story_rows || 0,
  };
}

async function buildLocalRestartReadiness({
  cwd = process.cwd(),
  env = process.env,
  now = new Date(),
  localHealth,
  publicHealth,
  cadenceReport,
  gitStatus,
  currentBuild,
  execFileSyncImpl = execFileSync,
} = {}) {
  const port = env.PORT || 3001;
  const publicUrl = getPublicUrl(env);
  const expectedBuild =
    currentBuild ||
    resolveRuntimeBuildInfo({ cwd, env, execFileSyncImpl });

  const local =
    localHealth || (await fetchJson(`http://localhost:${port}/api/health`));
  const publicResult =
    publicHealth || (publicUrl ? await fetchJson(`${publicUrl}/api/health`) : null);
  const cadence =
    cadenceReport || (await buildPublishCadenceReportFromDb({ windowHours: 24 }));
  const status = gitStatus || buildGitStatus({ cwd, execFileSyncImpl });
  const hardGates = cadenceHardGateState(env);

  const localBuild = healthBuild(local);
  const publicBuild = healthBuild(publicResult);
  const expectedSha = expectedBuild?.commit_sha || null;
  const localSha = localBuild?.commit_sha || null;
  const publicSha = publicBuild?.commit_sha || null;
  const localMatches = commitsMatch(expectedSha, localSha);
  const publicMatches = commitsMatch(expectedSha, publicSha);
  const publicDeployment = healthDeployment(publicResult);
  const localDeployment = healthDeployment(local);
  const cadenceSummary = summariseCadence(cadence);

  const blockers = [];
  const warnings = [];

  if (!local?.ok) blockers.push("localhost /api/health is not reachable");
  if (!publicResult?.ok) blockers.push("public /api/health is not reachable");
  if (!expectedSha) blockers.push("current git commit could not be resolved");
  if (local?.ok && !localSha) {
    blockers.push("running local server does not expose build.commit_sha yet");
  } else if (local?.ok && !localMatches) {
    blockers.push("running local server is not on the current git commit");
  }
  if (publicResult?.ok && !publicSha) {
    blockers.push("public server does not expose build.commit_sha yet");
  } else if (publicResult?.ok && !publicMatches) {
    blockers.push("public server is not on the current git commit");
  }
  if (publicDeployment && publicDeployment.mode !== "local") {
    blockers.push(`public server reports mode=${publicDeployment.mode}, expected local`);
  }
  if (publicDeployment && publicDeployment.primary !== true) {
    blockers.push("public server is not reporting primary=true");
  }
  if (cadenceSummary.off_schedule_posts > 0 && !hardGates.require_window) {
    blockers.push("off-schedule posts were detected but publish window hard gate is not enabled");
  }
  if (cadenceSummary.tight_spacing_pairs > 0 && !hardGates.require_min_gap) {
    blockers.push("tight publish spacing was detected but publish cooldown hard gate is not enabled");
  }
  if (cadenceSummary.invalid_public_story_rows > 0) {
    blockers.push("public script-validation fallback rows need repair before a clean resume");
  }

  if (!status.clean) {
    warnings.push(
      `${status.changed_count} uncommitted file(s) are present; commit code changes before restart for reproducibility`,
    );
  }
  if (cadenceSummary.failed_rows_with_platform_ids > 0) {
    warnings.push(
      `${cadenceSummary.failed_rows_with_platform_ids} failed row(s) still carry platform IDs`,
    );
  }

  const verdict = blockers.length ? "red" : warnings.length ? "amber" : "green";
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    verdict,
    safety:
      "read-only; does not restart the server, edit env vars, mutate DB rows, touch Railway or post",
    expected_build: expectedBuild,
    running: {
      local: {
        ok: !!local?.ok,
        status: local?.status || null,
        deployment: localDeployment,
        build: localBuild,
        matches_current_commit: localMatches,
      },
      public: {
        ok: !!publicResult?.ok,
        status: publicResult?.status || null,
        deployment: publicDeployment,
        build: publicBuild,
        matches_current_commit: publicMatches,
      },
    },
    git_status: status,
    cadence_hard_gates: hardGates,
    cadence: cadenceSummary,
    blockers,
    warnings,
    restart_recommendation:
      verdict === "green"
        ? "controlled_restart_ready"
        : "do_not_restart_primary_until_blockers_are_cleared",
    commands: {
      cadence: "npm run ops:publish-cadence -- --hours 24",
      row_repair_plan: "npm run ops:publish-row-repair -- --limit 40",
      restart_readiness: "npm run ops:local-restart-readiness",
    },
  };
}

function formatLocalRestartReadinessMarkdown(report) {
  const lines = [];
  lines.push("# Local Restart Readiness");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Verdict: ${String(report.verdict || "unknown").toUpperCase()}`);
  lines.push(`Safety: ${report.safety}`);
  lines.push("");
  lines.push("## Build Match");
  lines.push(`- Current commit: ${report.expected_build?.commit_short || "unknown"}`);
  lines.push(
    `- Local running commit: ${report.running?.local?.build?.commit_short || "unknown"} (${report.running?.local?.matches_current_commit ? "matches" : "does not match"})`,
  );
  lines.push(
    `- Public running commit: ${report.running?.public?.build?.commit_short || "unknown"} (${report.running?.public?.matches_current_commit ? "matches" : "does not match"})`,
  );
  lines.push("");
  lines.push("## Runtime");
  lines.push(
    `- Local health: ${report.running?.local?.ok ? "pass" : "fail"}${report.running?.local?.status ? ` (${report.running.local.status})` : ""}`,
  );
  lines.push(
    `- Public health: ${report.running?.public?.ok ? "pass" : "fail"}${report.running?.public?.status ? ` (${report.running.public.status})` : ""}`,
  );
  lines.push(
    `- Public mode: ${report.running?.public?.deployment?.mode || "unknown"}`,
  );
  lines.push(
    `- Public primary: ${String(report.running?.public?.deployment?.primary ?? "unknown")}`,
  );
  lines.push("");
  lines.push("## Cadence");
  lines.push(`- Public posts in 24h: ${report.cadence?.public_posts || 0}`);
  lines.push(`- Off-schedule posts: ${report.cadence?.off_schedule_posts || 0}`);
  lines.push(`- Tight spacing pairs: ${report.cadence?.tight_spacing_pairs || 0}`);
  lines.push(`- Minimum gap: ${report.cadence?.min_gap_minutes ?? "n/a"} minutes`);
  lines.push(
    `- Invalid public story rows: ${report.cadence?.invalid_public_story_rows || 0}`,
  );
  lines.push(
    `- Failed rows with platform IDs: ${report.cadence?.failed_rows_with_platform_ids || 0}`,
  );
  lines.push("");
  lines.push("## Cadence Gates");
  lines.push(
    `- Publish window hard gate: ${report.cadence_hard_gates?.require_window ? "enabled" : "disabled"}`,
  );
  lines.push(
    `- Minimum-gap hard gate: ${report.cadence_hard_gates?.require_min_gap ? "enabled" : "disabled"}`,
  );
  if (report.blockers?.length) {
    lines.push("");
    lines.push("## Blockers");
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }
  if (report.warnings?.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push(`Recommendation: ${report.restart_recommendation}`);
  lines.push("");
  lines.push("## Commands");
  for (const [label, command] of Object.entries(report.commands || {})) {
    lines.push(`- ${label}: \`${command}\``);
  }
  return lines.join("\n");
}

module.exports = {
  buildGitStatus,
  buildLocalRestartReadiness,
  cadenceHardGateState,
  commitsMatch,
  formatLocalRestartReadinessMarkdown,
  summariseCadence,
  truthy,
};
