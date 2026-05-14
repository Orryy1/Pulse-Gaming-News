"use strict";

const { truthy } = require("./publish-dispatch-policy");

const UNSAFE_DIRECT_UPLOAD_FLAGS = new Set([
  "--unsafe-direct-upload",
  "--operator-direct-upload",
]);

const UNSAFE_DIRECT_UPLOAD_ENV = "DIRECT_UPLOAD_UNSAFE_ALLOW";

function normaliseArgv(argv = process.argv) {
  return Array.isArray(argv) ? argv.map((arg) => String(arg)) : [];
}

function argValue(args, name) {
  const exact = args.indexOf(name);
  if (exact !== -1) return "true";
  const withEquals = args.find((arg) => arg.startsWith(`${name}=`));
  if (!withEquals) return null;
  return withEquals.slice(name.length + 1);
}

function commandFromArgv(args) {
  const command = args.slice(2).find((arg) => !arg.startsWith("-"));
  return command ? command.toLowerCase() : "";
}

function resolveDirectUploadMode({ argv = process.argv, command } = {}) {
  const args = normaliseArgv(argv);
  const resolvedCommand = String(command || commandFromArgv(args)).toLowerCase();

  if (
    truthy(argValue(args, "--dry-run")) ||
    resolvedCommand === "dry-run" ||
    resolvedCommand === "dryrun"
  ) {
    return "dry_run";
  }
  if (truthy(argValue(args, "--preflight")) || resolvedCommand === "preflight") {
    return "preflight";
  }
  return "actual_upload";
}

function findUnsafeAllowReason({ argv = process.argv, env = process.env } = {}) {
  const args = normaliseArgv(argv);
  for (const flag of UNSAFE_DIRECT_UPLOAD_FLAGS) {
    if (args.includes(flag)) return `flag:${flag}`;
  }
  if (truthy(env[UNSAFE_DIRECT_UPLOAD_ENV])) {
    return `env:${UNSAFE_DIRECT_UPLOAD_ENV}`;
  }
  return null;
}

function buildDirectUploadPolicy({
  platform = "unknown",
  env = process.env,
  argv = process.argv,
  command,
  mode,
} = {}) {
  const resolvedMode = mode || resolveDirectUploadMode({ argv, command });
  const allowReason = findUnsafeAllowReason({ argv, env });
  const autoPublish = truthy(env.AUTO_PUBLISH);
  const blockers = [];
  const advisory = [];

  if (resolvedMode === "actual_upload" && !allowReason) {
    blockers.push("direct_upload_not_enabled");
  }

  if (resolvedMode === "actual_upload" && allowReason) {
    advisory.push("direct upload unsafe operator mode enabled");
  }
  if (!autoPublish) {
    advisory.push("AUTO_PUBLISH is disabled");
  }
  if (resolvedMode !== "actual_upload") {
    advisory.push(`${resolvedMode} does not publish`);
  }

  return {
    platform,
    mode: resolvedMode,
    verdict: blockers.length ? "red" : advisory.length ? "amber" : "green",
    blocked: blockers.length > 0,
    autoPublish,
    unsafeOperatorMode: Boolean(allowReason),
    allowReason,
    blockers,
    advisory,
  };
}

function formatDirectUploadBlock(policy) {
  const p = policy || {};
  const platform = p.platform || "unknown";
  const blockers =
    Array.isArray(p.blockers) && p.blockers.length
      ? p.blockers.join(",")
      : "blocked";
  return (
    `direct_upload_blocked:${platform}:${blockers}. ` +
    `Use --dry-run/--preflight for local checks, or pass ` +
    `--unsafe-direct-upload / set ${UNSAFE_DIRECT_UPLOAD_ENV}=true ` +
    `for an explicit operator upload.`
  );
}

function assertDirectUploadAllowed(policyOrOptions = {}) {
  const policy =
    policyOrOptions.blocked === undefined
      ? buildDirectUploadPolicy(policyOrOptions)
      : policyOrOptions;
  if (policy.blocked) {
    const err = new Error(formatDirectUploadBlock(policy));
    err.code = "direct_upload_blocked";
    err.policy = policy;
    throw err;
  }
  return policy;
}

module.exports = {
  UNSAFE_DIRECT_UPLOAD_FLAGS,
  UNSAFE_DIRECT_UPLOAD_ENV,
  buildDirectUploadPolicy,
  resolveDirectUploadMode,
  assertDirectUploadAllowed,
  formatDirectUploadBlock,
};
