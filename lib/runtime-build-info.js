"use strict";

const { execFileSync } = require("node:child_process");

function cleanCommit(value) {
  const text = String(value || "").trim();
  return /^[a-f0-9]{7,64}$/i.test(text) ? text : null;
}

function cleanPublicLabel(value, maxLen = 128) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLen) return null;
  if (!/^[A-Za-z0-9._/@:-]+$/.test(text)) return null;
  return text;
}

function gitText(args, { cwd, execFileSyncImpl = execFileSync } = {}) {
  try {
    return String(
      execFileSyncImpl("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 1500,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }) || "",
    ).trim();
  } catch {
    return null;
  }
}

function resolveRuntimeBuildInfo({
  cwd = process.cwd(),
  env = process.env,
  execFileSyncImpl = execFileSync,
} = {}) {
  const railwayCommit = cleanCommit(env.RAILWAY_GIT_COMMIT_SHA);
  const preferLocalGit =
    String(env.DEPLOYMENT_MODE || "").trim().toLowerCase() === "local";
  const localGitCommit = cleanCommit(
    gitText(["rev-parse", "HEAD"], { cwd, execFileSyncImpl }),
  );
  const gitCommit = preferLocalGit
    ? localGitCommit || railwayCommit
    : railwayCommit || localGitCommit;
  const railwayBranch = cleanPublicLabel(env.RAILWAY_GIT_BRANCH);
  const localGitBranch = cleanPublicLabel(
    gitText(["rev-parse", "--abbrev-ref", "HEAD"], { cwd, execFileSyncImpl }),
  );
  const gitBranch = preferLocalGit
    ? localGitBranch || railwayBranch
    : railwayBranch || localGitBranch;
  const commitSource = preferLocalGit
    ? localGitCommit
      ? "local_git"
      : railwayCommit
        ? "railway_env"
        : "unknown"
    : railwayCommit
      ? "railway_env"
      : localGitCommit
        ? "local_git"
        : "unknown";
  const branchSource = preferLocalGit
    ? localGitBranch
      ? "local_git"
      : railwayBranch
        ? "railway_env"
        : "unknown"
    : railwayBranch
      ? "railway_env"
      : localGitBranch
        ? "local_git"
        : "unknown";

  return {
    commit_sha: gitCommit,
    commit_short: gitCommit ? gitCommit.slice(0, 7) : null,
    commit_source: commitSource,
    commit_message_present: !!env.RAILWAY_GIT_COMMIT_MESSAGE,
    branch: gitBranch,
    branch_source: branchSource,
    deployment_id: cleanPublicLabel(env.RAILWAY_DEPLOYMENT_ID),
    environment:
      cleanPublicLabel(env.RAILWAY_ENVIRONMENT_NAME) ||
      cleanPublicLabel(env.RAILWAY_ENVIRONMENT),
    project_id: cleanPublicLabel(env.RAILWAY_PROJECT_ID),
    service_id: cleanPublicLabel(env.RAILWAY_SERVICE_ID),
    node_env: cleanPublicLabel(env.NODE_ENV),
  };
}

module.exports = {
  cleanCommit,
  cleanPublicLabel,
  resolveRuntimeBuildInfo,
};
