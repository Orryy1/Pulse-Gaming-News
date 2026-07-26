/**
 * Single source of truth for scheduler dispatch.
 *
 * Pulse v1 has one model: lib/bootstrap-queue starts lib/scheduler.js
 * and the durable jobs runner. USE_JOB_QUEUE=false does not activate a
 * second registry. Production bootstrap failure is fatal; development
 * bootstrap failure leaves the process running without any scheduler.
 */

"use strict";

function isProduction(env = process.env) {
  return (
    env.NODE_ENV === "production" ||
    !!env.RAILWAY_ENVIRONMENT ||
    !!env.RAILWAY_PUBLIC_URL
  );
}

function resolveDispatchMode({ env = process.env } = {}) {
  const prod = isProduction(env);

  if (prod) {
    return {
      mode: "queue",
      strict: true,
      reason: "production_queue_only",
    };
  }

  return {
    mode: "queue",
    strict: false,
    reason:
      env.USE_JOB_QUEUE === "false"
        ? "legacy_scheduler_retired_queue_only"
        : "dev_queue_default",
  };
}

module.exports = {
  resolveDispatchMode,
  isProduction,
};
