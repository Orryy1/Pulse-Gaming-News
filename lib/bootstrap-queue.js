/**
 * lib/bootstrap-queue.js — single entry point that wires the scheduler,
 * the jobs runner and the kind→handler map.
 *
 * Usage:
 *   if (process.env.USE_JOB_QUEUE === "true") {
 *     require("./lib/bootstrap-queue").start({ workerId: "server-" + os.hostname() });
 *   }
 *
 * Why a dedicated bootstrap instead of inlining into server.js / run.js:
 *   - One place to flip the feature flag and have the whole queue rise or
 *     fall together.
 *   - Lets us stand up a "scheduler-only" process and an arbitrary number
 *     of "runner-only" processes (cloud vs local GPU) from the same module.
 *   - Keeps the legacy cron handlers in server.js / run.js untouched —
 *     they remain the fallback for `USE_JOB_QUEUE=false`. (The old
 *     third dispatcher in cloud.js was retired in Phase B, so there is
 *     one less parallel brain to worry about.)
 */

const os = require("os");
const { seed, start: startScheduler } = require("./scheduler");
const { JobsRunner } = require("./services/jobs-runner");
const { handlers } = require("./job-handlers");
const { getRepos } = require("./repositories");
const {
  buildRuntimeGenerationLeaseMetadata,
} = require("./stabilisation/bounded-runtime-db-authority");

let _state = null;

function defaultWorkerId(role = "node") {
  return `${role}-${os.hostname()}-${process.pid}`;
}

function isLiveGuardedRuntime(env = process.env) {
  return (
    String(env.PULSE_OPERATING_MODE || env.OPERATING_MODE || "")
      .trim()
      .toUpperCase() === "LIVE_GUARDED"
  );
}

function resolveLiveRuntimeAuthority({
  env = process.env,
  pid = process.pid,
  processIdentityInspector = require("./stabilisation/windows-process-identity")
    .inspectWindowsProcessIdentity,
} = {}) {
  const processId = Number(pid);
  if (
    !isLiveGuardedRuntime(env) ||
    !Number.isInteger(processId) ||
    processId <= 0 ||
    typeof processIdentityInspector !== "function"
  ) {
    throw new Error("live_runtime_generation_authority_unavailable");
  }
  const identity = processIdentityInspector({ pid: processId });
  if (
    identity?.available !== true ||
    identity?.exists !== true ||
    Number(identity.process_id) !== processId
  ) {
    throw new Error("live_runtime_generation_authority_unavailable");
  }
  const authority = {
    runtime_instance_id: env.PULSE_LIVE_RUNTIME_INSTANCE_ID,
    child_pid: processId,
    child_started_at: identity.process_started_at,
    authority_fingerprint: env.PULSE_LIVE_AUTHORITY_FINGERPRINT,
  };
  buildRuntimeGenerationLeaseMetadata(authority);
  return authority;
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
    multiLaneWorkers =
      process.env.PULSE_MULTI_LANE_WORKERS !== "false",
    runBreakingWatcher =
      process.env.BREAKING_WATCHER_ENABLED !== "false",
    runCreditMonitor =
      process.env.NODE_ENV === "production" &&
      /^(true|1|yes|on)$/i.test(
        String(
          process.env.ELEVENLABS_CREDIT_MONITOR_ENABLED || "",
        ).trim(),
      ),
    kinds = null,
    gpu = false,
    autoSeed = true,
    resetSchedules = false,
    primeMultiLaneOnStartup =
      process.env.PULSE_MULTI_LANE_STARTUP_PRIME !== "false",
    primeWindowCheckpointsOnStartup =
      process.env
        .PULSE_YOUTUBE_WINDOW_CHECKPOINT_STARTUP_PRIME !==
      "false",
    schedulerProfile =
      process.env.PULSE_SCHEDULER_PROFILE ||
      "stabilisation_30d",
    startupNow = new Date().toISOString(),
    startupPrimer = null,
    windowCheckpointPrimer = null,
    windowCheckpointHorizonHours = 36,
    extraHandlers = {},
    log = (msg) => console.log(msg),
    repos: suppliedRepos = null,
    schedulerStarter = startScheduler,
    runtimeAuthority = null,
    runtimeAuthorityProvider = resolveLiveRuntimeAuthority,
    runnerFactory = (runnerOptions) => new JobsRunner(runnerOptions),
    breakingWatcherFactory = ({ jobs, log: watcherLog }) => {
      const {
        startGovernedBreakingWatcher,
      } = require("./services/governed-breaking-watcher");
      const watcher = require("../watcher");
      return startGovernedBreakingWatcher({
        startWatching: watcher.startWatching,
        stopWatching: watcher.stopWatching,
        jobs,
        channelId: process.env.CHANNEL || "pulse-gaming",
        log: watcherLog,
      });
    },
    creditMonitorFactory = ({ env, log: monitorLog }) => {
      const {
        createElevenLabsCreditRuntimeMonitor,
      } = require("./services/elevenlabs-credit-runtime-monitor");
      const alertsEnabled =
        /^(true|1|yes|on)$/i.test(
          String(
            env.ELEVENLABS_CREDIT_MONITOR_DISCORD_ALERTS || "",
          ).trim(),
        );
      return createElevenLabsCreditRuntimeMonitor({
        env,
        log: monitorLog,
        notify: alertsEnabled ? require("../notify") : null,
      });
    },
  } = opts;

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
    runBreakingWatcher = false;
    runCreditMonitor = false;
  }

  if (!runtimeAuthority && isLiveGuardedRuntime(process.env)) {
    if (typeof runtimeAuthorityProvider !== "function") {
      throw new Error("live_runtime_generation_authority_unavailable");
    }
    runtimeAuthority = runtimeAuthorityProvider({
      env: process.env,
      pid: process.pid,
    });
  }
  if (runtimeAuthority) {
    const binding = buildRuntimeGenerationLeaseMetadata(runtimeAuthority);
    runtimeAuthority = Object.freeze({
      runtime_instance_id: binding.runtime_instance_id,
      child_pid: binding.process_id,
      child_started_at: binding.process_started_at,
      authority_fingerprint: binding.authority_fingerprint,
    });
    workerId = `server-${binding.runtime_instance_id}`;
  }

  if (
    !runScheduler &&
    !runRunner &&
    !runBreakingWatcher &&
    !runCreditMonitor
  ) {
    _state = {
      workerId,
      schedulerHandle: null,
      runner: null,
      runners: [],
      breakingWatcherHandle: null,
      elevenLabsCreditMonitor: null,
      startupPrime: null,
      windowCheckpointPrime: null,
      get schedulerActive() {
        return false;
      },
    };
    log(
      `[bootstrap-queue] up: scheduler=false runner=false worker=${workerId}`,
    );
    return _state;
  }

  // Ensure migrations are applied and pragmas set.
  const repos = suppliedRepos || getRepos();

  if (autoSeed) {
    try {
      seed({
        reset: resetSchedules,
        log,
        repos,
        profile: schedulerProfile,
        env: process.env,
      });
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
  const runners = [];
  let breakingWatcherHandle = null;
  let elevenLabsCreditMonitor = null;
  let startupPrime = null;
  let windowCheckpointPrime = null;

  if (runScheduler && primeWindowCheckpointsOnStartup) {
    const primeWindowCheckpoints =
      windowCheckpointPrimer ||
      require("./services/governed-youtube-window-checkpoint-primer")
        .primeGovernedYoutubeWindowCheckpoints;
    windowCheckpointPrime = primeWindowCheckpoints({
      jobs: repos.jobs,
      schedulerProfile,
      now: startupNow,
      horizonHours: windowCheckpointHorizonHours,
    });
    if (windowCheckpointPrime?.status === "PRIMED") {
      log(
        `[bootstrap-queue] governed YouTube window checkpoints primed ` +
          `${windowCheckpointPrime.queued_jobs?.length || 0} jobs ` +
          `through=${windowCheckpointPrime.horizon_ends_at}`,
      );
    }
  }

  if (runScheduler) {
    schedulerHandle = schedulerStarter({
      log,
      repos,
      runtimeAuthority,
    });
  }

  try {
    if (runCreditMonitor) {
      elevenLabsCreditMonitor = creditMonitorFactory({
        env: process.env,
        log,
      });
      await elevenLabsCreditMonitor.start();
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

      const mergedHandlers = { ...handlers, ...extraHandlers };
      if (multiLaneWorkers) {
        const {
          buildMultiLaneWorkerDefinitions,
        } = require("./services/multi-lane-worker-topology");
        const definitions = buildMultiLaneWorkerDefinitions({
          handlers: mergedHandlers,
          kinds,
        });
        for (const definition of definitions) {
          for (
            let instance = 1;
            instance <= definition.instances;
            instance += 1
          ) {
            const laneRunner = runnerFactory({
              workerId:
                `${workerId}-${definition.pool_id}-${instance}`,
              kinds: definition.kinds,
              gpu,
              handlers: mergedHandlers,
              log,
              runtimeAuthority,
              reposProvider: () => repos,
              poolId: definition.pool_id,
              poolInstance: instance,
              ...(definition.lease_ms
                ? { leaseMs: definition.lease_ms }
                : {}),
              ...(definition.heartbeat_ms
                ? {
                    heartbeatMs:
                      definition.heartbeat_ms,
                  }
                : {}),
            });
            runners.push(laneRunner);
            if (!runner) runner = laneRunner;
            await laneRunner.start();
          }
        }
      } else {
        runner = runnerFactory({
          workerId,
          kinds,
          gpu,
          handlers: mergedHandlers,
          log,
          runtimeAuthority,
          reposProvider: () => repos,
        });
        runners.push(runner);
        await runner.start();
      }
    }
    if (runBreakingWatcher) {
      breakingWatcherHandle = breakingWatcherFactory({
        jobs: repos.jobs,
        log,
      });
      if (!breakingWatcherHandle?.active) {
        throw new Error("governed_breaking_watcher_failed_to_start");
      }
    }
    if (runScheduler && primeMultiLaneOnStartup) {
      const prime =
        startupPrimer ||
        require("./services/governed-multi-lane-startup-primer")
          .primeGovernedMultiLaneStartup;
      startupPrime = prime({
        jobs: repos.jobs,
        schedulerProfile,
        channelId: process.env.CHANNEL || "pulse-gaming",
        now: startupNow,
        env: process.env,
      });
      if (startupPrime?.status === "PRIMED") {
        log(
          `[bootstrap-queue] governed multi-lane startup primed ` +
            `${startupPrime.queued_jobs?.length || 0} jobs ` +
            `bucket=${startupPrime.bootstrap_bucket}`,
        );
      }
    }
  } catch (error) {
    try {
      await elevenLabsCreditMonitor?.stop();
    } catch {
      /* preserve startup failure */
    }
    try {
      breakingWatcherHandle?.stop();
    } catch {
      /* preserve startup failure */
    }
    for (const startedRunner of [...runners].reverse()) {
      try {
        await startedRunner.stop();
      } catch {
        /* preserve startup failure */
      }
    }
    try {
      if (schedulerHandle) schedulerHandle.stop();
    } catch {
      /* preserve startup failure */
    }
    throw error;
  }

  _state = {
    workerId,
    schedulerHandle,
    runner,
    runners,
    breakingWatcherHandle,
    elevenLabsCreditMonitor,
    startupPrime,
    windowCheckpointPrime,
    get schedulerActive() {
      return schedulerHandle?.active === true;
    },
  };
  log(
    `[bootstrap-queue] up: scheduler=${_state.schedulerActive} runner=${!!runner} runners=${runners.length} breaking_watcher=${!!breakingWatcherHandle?.active} credit_monitor=${!!elevenLabsCreditMonitor} worker=${workerId}`,
  );
  return _state;
}

async function stop() {
  if (!_state) return { runnerDrained: true };
  const {
    schedulerHandle,
    runner,
    runners,
    breakingWatcherHandle,
    elevenLabsCreditMonitor,
  } = _state;
  let runnerDrained = true;
  try {
    if (schedulerHandle) schedulerHandle.stop();
  } catch {
    /* ignore */
  }
  try {
    if (breakingWatcherHandle) breakingWatcherHandle.stop();
  } catch {
    /* ignore */
  }
  try {
    if (elevenLabsCreditMonitor) {
      await elevenLabsCreditMonitor.stop();
    }
  } catch {
    /* ignore */
  }
  const activeRunners =
    Array.isArray(runners) && runners.length
      ? runners
      : runner
        ? [runner]
        : [];
  for (const activeRunner of [...activeRunners].reverse()) {
    try {
      const result = await activeRunner.stop();
      if (result?.drained === false) runnerDrained = false;
    } catch {
      runnerDrained = false;
    }
  }
  _state = null;
  return { runnerDrained };
}

function state() {
  return _state;
}

function schedulerActive() {
  return _state?.schedulerHandle?.active === true;
}

module.exports = {
  start,
  stop,
  state,
  schedulerActive,
  defaultWorkerId,
  resolveLiveRuntimeAuthority,
};
