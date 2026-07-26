/**
 * Single entry point for the authoritative scheduler and durable jobs
 * runner. Both server.js and run.js delegate here and lib/scheduler.js
 * owns the only cron registry.
 *
 * Multiple processes may request scheduler startup, but the durable
 * scheduler lease permits only one active owner. USE_JOB_QUEUE=false
 * never enables a second or legacy scheduler.
 */

const os = require("os");
const {
  DEFAULT_SCHEDULES,
  activeSchedulesForEnvironment,
  seed,
  start: startScheduler,
} = require("./scheduler");
const { JobsRunner } = require("./services/jobs-runner");
const { handlers } = require("./job-handlers");
const { getRepos } = require("./repositories");

let _state = null;
const PUBLISH_CRITICAL_JOB_KINDS = Object.freeze([
  "publish_schedule_recovery_monitor",
  "publish_window_watchdog",
  "publish",
  "instagram_token_refresh",
  "tiktok_auth_check",
]);
const MAINTENANCE_JOB_KINDS = Object.freeze(["jobs_reap"]);
const CRITICAL_MAINTENANCE_SCHEDULES = Object.freeze(["jobs_reap_stale"]);
const { assertSafeContentRunnerLanes } = require("./content-runner-lanes");

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function normaliseAdditionalRunnerLanes(lanes = []) {
  const normalised = (lanes || []).map((lane) => ({
    id: String(lane?.id || "").trim(),
    kinds: Array.from(lane?.kinds || []),
    leaseMs: Number.isFinite(Number(lane?.leaseMs)) ? Number(lane.leaseMs) : undefined,
  }));
  assertSafeContentRunnerLanes(normalised);
  return normalised;
}

function defaultWorkerId(role = "node") {
  return `${role}-${os.hostname()}-${process.pid}`;
}

function publishCriticalRunnerEnabled({
  runRunner = true,
  kinds = null,
  gpu = false,
  env = process.env,
} = {}) {
  if (!runRunner) return false;
  if (gpu) return false;
  if (Array.isArray(kinds) && kinds.length > 0) return false;
  return !/^(false|0|off|no)$/i.test(
    String(env.PULSE_PUBLISH_CRITICAL_RUNNER || "").trim(),
  );
}

function generalRunnerEnabled({
  runRunner = true,
  runGeneralRunner = true,
  kinds = null,
  gpu = false,
  env = process.env,
} = {}) {
  if (!runRunner) return false;
  if (Array.isArray(kinds) && kinds.length > 0) return true;
  if (gpu) return true;
  if (runGeneralRunner === false) return false;
  return !/^(false|0|off|no)$/i.test(
    String(env.PULSE_GENERAL_QUEUE_RUNNER || "").trim(),
  );
}

function maintenanceRunnerEnabled({
  runRunner = true,
  kinds = null,
  gpu = false,
  env = process.env,
} = {}) {
  if (!runRunner) return false;
  if (gpu) return false;
  if (Array.isArray(kinds) && kinds.length > 0) return false;
  return !/^(false|0|off|no)$/i.test(
    String(env.PULSE_MAINTENANCE_RUNNER || "").trim(),
  );
}

async function launchMissedPublishWindowRecovery({
  runScheduler = true,
  primary = true,
  env = process.env,
  recover = null,
  log = console.log,
} = {}) {
  if (!runScheduler) {
    return { skipped: true, reason: "scheduler_disabled" };
  }
  if (!primary) {
    return { skipped: true, reason: "observation_only_runtime" };
  }
  if (/^(false|0|off|no)$/i.test(String(env.PULSE_MISSED_WINDOW_RECOVERY || "").trim())) {
    return { skipped: true, reason: "missed_window_recovery_disabled" };
  }

  const runRecovery = recover || (() =>
    require("./ops/missed-publish-window-recovery")
      .recoverMissedPublishWindowsFromEnvironment({ env }));
  try {
    const report = await runRecovery();
    if (report?.enqueued) {
      log(
        `[bootstrap-queue] missed-window recovery queued job #${report.queued_job_id} ` +
          `for ${report.selected_window?.name || "unknown window"}`,
      );
    } else if (Number(report?.missed_window_count || 0) > 0) {
      log(
        `[bootstrap-queue] missed-window recovery observed ${report.missed_window_count} debt window(s); ` +
          `no catch-up queued (${report.reason || "unknown"})`,
      );
    } else {
      log("[bootstrap-queue] missed-window recovery found no debt");
    }
    return report;
  } catch (err) {
    log(`[bootstrap-queue] missed-window recovery failed safely: ${err.message}`);
    return {
      verdict: "red",
      enqueued: false,
      failed_safely: true,
      reason: "missed_window_recovery_exception",
      error: err.message,
    };
  }
}

function reconcileCriticalMaintenanceSchedules({ repos = getRepos(), log = console.log } = {}) {
  const db = repos?.db;
  if (!db || typeof db.prepare !== "function") return { updated: 0, checked: 0 };
  const desiredByName = new Map(DEFAULT_SCHEDULES.map((schedule) => [schedule.name, schedule]));
  const getByName = db.prepare(`SELECT * FROM schedules WHERE name = ?`);
  const update = db.prepare(`
    UPDATE schedules
    SET cron_expr = ?, payload = ?, priority = ?, kind = ?
    WHERE name = ?
  `);
  let checked = 0;
  let updated = 0;
  for (const name of CRITICAL_MAINTENANCE_SCHEDULES) {
    const desired = desiredByName.get(name);
    if (!desired) continue;
    checked++;
    const existing = getByName.get(name);
    if (!existing) continue;
    const payload = JSON.stringify({
      ...(desired.payload || {}),
      idempotencyTemplate: desired.idempotencyTemplate,
    });
    const drifted =
      existing.kind !== desired.kind ||
      existing.cron_expr !== desired.cron_expr ||
      Number(existing.priority ?? 50) !== Number(desired.priority ?? 50) ||
      String(existing.payload || "") !== payload;
    if (!drifted) continue;
    const result = update.run(
      desired.cron_expr,
      payload,
      desired.priority ?? 50,
      desired.kind,
      name,
    );
    if (result?.changes) {
      updated += result.changes;
      log(`[bootstrap-queue] reconciled critical schedule ${name}`);
    }
  }
  return { updated, checked };
}

/**
 * Start some combination of the scheduler + runner.
 *
 * Options:
 *   workerId        string   — unique id for this process in the workers table
 *   runScheduler    boolean  — if true (default), register the cron → enqueue dispatcher
 *   runRunner       boolean  — if true (default), start claiming and executing jobs
 *   kinds           string[] — restrict the runner to these job kinds (null = all)
 *   gpu             boolean  — runner only claims requires_gpu=1 rows
 *   claimGuard      function — optional claim-time safety guard for restricted workers
 *   handlerTimeoutMsByKind object — optional per-kind execution deadlines
 *   stopOnHandlerTimeout boolean — stop this runner after a deadline expires
 *   onHandlerTimeout function — fatal timeout callback after failure persistence
 *   autoSeed        boolean  — if true, write DEFAULT_SCHEDULES into the schedules table
 *                              (idempotent). Default true.
 *   resetSchedules  boolean  — pass `{reset:true}` to seed() to overwrite existing rows.
 *   extraHandlers   object   — kind→fn map merged over the default handlers
 */
async function start(opts = {}) {
  if (_state) {
    console.log("[bootstrap-queue] already started");
    return _state;
  }
  let {
    workerId = defaultWorkerId("server"),
    runScheduler = true,
    runRunner = true,
    runGeneralRunner = true,
    kinds = null,
    gpu = false,
    leaseMs = undefined,
    claimGuard = null,
    handlerTimeoutMsByKind = null,
    stopOnHandlerTimeout = false,
    onHandlerTimeout = null,
    autoSeed = true,
    resetSchedules = null,
    extraHandlers = {},
    additionalRunnerLanes = [],
    missedWindowRecovery = null,
    log = (msg) => console.log(msg),
  } = opts;
  additionalRunnerLanes = normaliseAdditionalRunnerLanes(additionalRunnerLanes);
  if (resetSchedules === null || resetSchedules === undefined) {
    resetSchedules = truthy(process.env.PULSE_RESET_SCHEDULES_ON_BOOT);
  }

  if (process.env.USE_SQLITE !== "true") {
    throw new Error(
      "bootstrap-queue requires USE_SQLITE=true (the jobs/schedules tables live in SQLite)",
    );
  }

  // 2026-04-30 hard primary-safety check.
  // PULSE_PRIMARY_INSTANCE=false MUST disable the scheduler + runner
  // regardless of any dispatch-mode override. Without this, the
  // production-mode forcing in lib/dispatch-mode.js silently ignores
  // the operator's intent on a "mirror" instance - a real safety
  // failure caught while bringing up the Phase 1 mirror.
  //
  // Defaults to primary=true so Railway behaviour is unchanged
  // (PULSE_PRIMARY_INSTANCE unset on Railway -> primary=true -> fires
  // as before). The flag is read via lib/deployment-mode.js so any
  // future precedence rules (e.g. "DEPLOYMENT_MODE=local without
  // explicit primary flag" -> not primary) take effect here too.
  let primary = true;
  try {
    primary = require("./deployment-mode").isPrimary();
  } catch {
    /* deployment-mode missing on very old branches - default true */
  }
  if (!primary) {
    log(
      "[bootstrap-queue] PULSE_PRIMARY_INSTANCE=false - refusing to start scheduler/runner. " +
        "This instance is observation-only.",
    );
    runScheduler = false;
    runRunner = false;
  }

  // Ensure migrations are applied and pragmas set.
  const repos = getRepos();

  if (autoSeed) {
    try {
      seed({ reset: resetSchedules, log });
      reconcileCriticalMaintenanceSchedules({ repos, log });
    } catch (err) {
      log(`[bootstrap-queue] seed failed: ${err.message}`);
      throw err;
    }

    // Phase 9: ensure audio identity packs are synced at boot. The sync
    // is idempotent — re-running just refreshes metadata + rows — so
    // running it on every bootstrap is safe.
    try {
      const audioIdentity = require("./audio-identity");
      audioIdentity.syncPacks({ repos, log: { log } });
    } catch (err) {
      log(`[bootstrap-queue] audio pack sync failed: ${err.message}`);
      // non-fatal — legacy renders don't read from audio_packs
    }
  }

  let schedulerHandle = null;
  let runner = null;
  let maintenanceRunner = null;
  let publishCriticalRunner = null;
  const additionalRunners = [];

  if (runScheduler) {
    schedulerHandle = startScheduler({ log });
  }

  if (runRunner) {
    // Phase F readiness gate: if this runner will claim GPU jobs,
    // block until the inference service reports phase='ready'. Prevents
    // the class of failure that stranded job 23 on 2026-04-16 — the
    // runner claimed the job, the infer service was still warming,
    // the 180s client timeout (now 600s per commit f76d1a5) fired,
    // the claim was lost and the job ended up orphaned.
    //
    // Non-GPU runners skip this — their work doesn't depend on the
    // inference service, so they should start draining the queue
    // regardless of engine state.
    if (gpu && process.env.INFER_WAIT_ON_BOOT !== "false") {
      const inferenceClient = require("./inference-client");
      try {
        log(`[bootstrap-queue] GPU runner — waiting for inference ready`);
        const h = await inferenceClient.waitForReady({
          acceptSkipped: process.env.INFER_ACCEPT_SKIPPED === "true",
          log: (m) => log(m),
          deadlineMs: Number(process.env.INFER_READY_DEADLINE_MS || 900_000),
        });
        log(
          `[bootstrap-queue] inference ready phase=${h.phase} last_load_ms=${h.last_load_ms ?? "-"}`,
        );
      } catch (err) {
        // Phase 1B: phase='failed' means the inference service flipped
        // itself into a watchdog-expired or load-errored state. Starting
        // a GPU runner against a dead service just burns attempt_count
        // budget on every job. Refuse to start unless the operator
        // explicitly opts in via INFER_ALLOW_FAILED_START=true.
        const isFailed =
          err instanceof inferenceClient.InferFailedStateError ||
          err?.name === "InferFailedStateError";
        if (isFailed && process.env.INFER_ALLOW_FAILED_START !== "true") {
          log(
            `[bootstrap-queue] GPU runner REFUSING to start — inference ` +
              `reported phase=failed (${err.lastError || err.message}). ` +
              `Restart tts_server and investigate, or set ` +
              `INFER_ALLOW_FAILED_START=true to override.`,
          );
          throw err;
        }
        log(
          `[bootstrap-queue] inference readiness wait FAILED: ${err.message}. ` +
            `Starting GPU runner anyway — jobs will pay cold-start cost or fail.`,
        );
      }
    }

    if (generalRunnerEnabled({ runRunner, runGeneralRunner, kinds, gpu })) {
      runner = new JobsRunner({
        workerId,
        kinds,
        gpu,
        leaseMs,
        claimGuard,
        handlerTimeoutMsByKind,
        stopOnHandlerTimeout,
        onHandlerTimeout,
        handlers: { ...handlers, ...extraHandlers },
        log,
      });
      await runner.start();
    } else {
      log("[bootstrap-queue] general all-jobs runner disabled for this process");
    }

    if (maintenanceRunnerEnabled({ runRunner, kinds, gpu })) {
      maintenanceRunner = new JobsRunner({
        workerId: `${workerId}-maintenance`,
        kinds: MAINTENANCE_JOB_KINDS,
        gpu: false,
        handlers: { ...handlers, ...extraHandlers },
        log,
      });
      await maintenanceRunner.start();
    }

    if (publishCriticalRunnerEnabled({ runRunner, kinds, gpu })) {
      publishCriticalRunner = new JobsRunner({
        workerId: `${workerId}-publish-critical`,
        kinds: PUBLISH_CRITICAL_JOB_KINDS,
        gpu: false,
        handlers: { ...handlers, ...extraHandlers },
        log,
      });
      await publishCriticalRunner.start();
    }

    for (const lane of additionalRunnerLanes) {
      const additionalRunner = new JobsRunner({
        workerId: `${workerId}-${lane.id}`,
        kinds: lane.kinds,
        gpu: false,
        leaseMs: lane.leaseMs,
        handlers: { ...handlers, ...extraHandlers },
        log,
      });
      await additionalRunner.start();
      additionalRunners.push(additionalRunner);
    }
  }

  const missedWindowRecoveryPromise = new Promise((resolve) => {
    setImmediate(() => {
      launchMissedPublishWindowRecovery({
        runScheduler: !!schedulerHandle,
        primary,
        env: process.env,
        recover: missedWindowRecovery || (() =>
          require("./ops/missed-publish-window-recovery")
            .recoverMissedPublishWindowsFromEnvironment({
              env: process.env,
              repos,
              schedules: activeSchedulesForEnvironment(
                DEFAULT_SCHEDULES,
                process.env,
              ),
            })),
        log,
      }).then(resolve);
    });
  });

  _state = {
    workerId,
    schedulerHandle,
    runner,
    maintenanceRunner,
    publishCriticalRunner,
    additionalRunners,
    missedWindowRecoveryPromise,
  };
  log(
    `[bootstrap-queue] up: scheduler=${!!schedulerHandle} runner=${!!runner} maintenanceRunner=${!!maintenanceRunner} publishCriticalRunner=${!!publishCriticalRunner} additionalRunners=${additionalRunners.length} worker=${workerId}`,
  );
  return _state;
}

async function stop() {
  if (!_state) return;
  const { schedulerHandle, runner, maintenanceRunner, publishCriticalRunner, additionalRunners = [] } = _state;
  try {
    if (schedulerHandle) schedulerHandle.stop();
  } catch {
    /* ignore */
  }
  try {
    if (runner) await runner.stop();
  } catch {
    /* ignore */
  }
  try {
    if (maintenanceRunner) await maintenanceRunner.stop();
  } catch {
    /* ignore */
  }
  try {
    if (publishCriticalRunner) await publishCriticalRunner.stop();
  } catch {
    /* ignore */
  }
  for (const additionalRunner of additionalRunners) {
    try {
      await additionalRunner.stop();
    } catch {
      /* ignore */
    }
  }
  _state = null;
}

function state() {
  return _state;
}

module.exports = {
  start,
  stop,
  state,
  defaultWorkerId,
  PUBLISH_CRITICAL_JOB_KINDS,
  MAINTENANCE_JOB_KINDS,
  reconcileCriticalMaintenanceSchedules,
  generalRunnerEnabled,
  publishCriticalRunnerEnabled,
  maintenanceRunnerEnabled,
  normaliseAdditionalRunnerLanes,
  launchMissedPublishWindowRecovery,
};
