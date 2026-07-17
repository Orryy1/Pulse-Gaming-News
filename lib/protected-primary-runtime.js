"use strict";

const ALLOWED_API_JOB_KINDS = Object.freeze(new Set(["hunt", "produce"]));
const DEFAULT_PRIORITIES = Object.freeze({
  hunt: 40,
  produce: 30,
});

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function protectedPrimaryRuntimeEnabled({
  argv = process.argv,
  env = process.env,
} = {}) {
  return (
    Array.isArray(argv) && argv.includes("--protected-primary-runtime")
  ) || truthy(env.PULSE_PROTECTED_PRIMARY_RUNTIME);
}

function applyProtectedPrimaryRuntime({
  argv = process.argv,
  env = process.env,
} = {}) {
  const enabled = protectedPrimaryRuntimeEnabled({ argv, env });
  if (!enabled) return { enabled: false };

  // Apply this after dotenv loading so local configuration cannot put
  // content execution back into the scheduler process.
  env.PULSE_PROTECTED_PRIMARY_RUNTIME = "true";
  env.PULSE_SERVER_GENERAL_QUEUE_RUNNER = "false";
  env.PULSE_GENERAL_QUEUE_RUNNER = "false";
  env.PULSE_SERVER_CONTENT_RUNNERS = "false";
  return { enabled: true };
}

function minuteBucket(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("protected primary API job requires a valid timestamp");
  }
  return date.toISOString().slice(0, 16) + "Z";
}

function enqueueProtectedApiJob({
  repos,
  kind,
  payload = {},
  priority = null,
  runAt = null,
  now = new Date(),
  idempotencyKey = null,
} = {}) {
  const cleanKind = String(kind || "").trim();
  if (!ALLOWED_API_JOB_KINDS.has(cleanKind)) {
    throw new Error(
      `protected primary API job kind is not allowed: ${cleanKind || "missing"}`,
    );
  }
  if (!repos?.jobs || typeof repos.jobs.enqueue !== "function") {
    throw new Error("protected primary API queue is unavailable");
  }

  return repos.jobs.enqueue({
    kind: cleanKind,
    payload,
    priority:
      priority === null || priority === undefined
        ? DEFAULT_PRIORITIES[cleanKind]
        : Number(priority),
    run_at: runAt || null,
    max_attempts: 3,
    requires_gpu: 0,
    idempotency_key:
      idempotencyKey ||
      `protected_api:${cleanKind}:${minuteBucket(now)}`,
  });
}

module.exports = {
  ALLOWED_API_JOB_KINDS,
  applyProtectedPrimaryRuntime,
  enqueueProtectedApiJob,
  protectedPrimaryRuntimeEnabled,
};
