/**
 * lib/dispatch-mode.js — single source of truth for "which scheduler
 * runs in this process?".
 *
 * Background
 * ----------
 * Before Phase D the repo had three parallel cron dispatchers: the
 * canonical lib/scheduler.js (queue-backed, idempotency-keyed,
 * durable) and two legacy in-process node-cron blocks in server.js
 * and run.js. A boot-time bootstrap-queue failure silently fell
 * through to the legacy block, which meant production could end up
 * running both systems without the operator noticing.
 *
 * This module collapses the decision down to one helper so server.js
 * and run.js stay in lockstep:
 *
 *   resolveDispatchMode({env})
 *     -> { mode, strict, reason }
 *
 *     mode
 *       'queue'       lib/bootstrap-queue.start() is the scheduler.
 *                     The legacy cron block must NOT register.
 *       'legacy_dev'  Explicit dev escape. USE_JOB_QUEUE=false in a
 *                     non-production environment. Legacy cron runs
 *                     as it did pre-Phase D. Never possible in prod.
 *
 *     strict
 *       true if bootstrap failure must throw (production). false if
 *       bootstrap failure is logged and the process continues without
 *       any scheduler running (dev, to keep `npm run dev` usable when
 *       the DB is missing).
 *
 *     reason
 *       Short tag for the log line at dispatch selection time.
 *
 * Production guarantees
 * ---------------------
 *   * mode is ALWAYS 'queue' when NODE_ENV=production or any
 *     RAILWAY_* env var is set.
 *   * strict is ALWAYS true in production, so the legacy cron block
 *     is not reachable even if bootstrap fails.
 *   * USE_JOB_QUEUE=false is ignored in production — there is no prod
 *     escape hatch to the legacy registry.
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

  // Dev path. Explicit opt-out goes to legacy; anything else (unset,
  // 'true', anything truthy) stays on the canonical queue so the dev
  // loop matches production behaviour by default.
  if (env.USE_JOB_QUEUE === "false") {
    return {
      mode: "legacy_dev",
      strict: false,
      reason: "dev_explicit_legacy_opt_in",
    };
  }

  return {
    mode: "queue",
    strict: false,
    reason: "dev_queue_default",
  };
}

module.exports = {
  resolveDispatchMode,
  isProduction,
};
