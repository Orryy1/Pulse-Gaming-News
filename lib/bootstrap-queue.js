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

let _state = null;

function defaultWorkerId(role = "node") {
  return `${role}-${os.hostname()}-${process.pid}`;
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
  const {
    workerId = defaultWorkerId("server"),
    runScheduler = true,
    runRunner = true,
    kinds = null,
    gpu = false,
    autoSeed = true,
    resetSchedules = false,
    extraHandlers = {},
    log = (msg) => console.log(msg),
  } = opts;

  if (process.env.USE_SQLITE !== "true") {
    throw new Error(
      "bootstrap-queue requires USE_SQLITE=true (the jobs/schedules tables live in SQLite)",
    );
  }

  // Ensure migrations are applied and pragmas set.
  const repos = getRepos();

  if (autoSeed) {
    try {
      seed({ reset: resetSchedules, log });
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

    runner = new JobsRunner({
      workerId,
      kinds,
      gpu,
      handlers: { ...handlers, ...extraHandlers },
      log,
    });
    await runner.start();
  }

  _state = { workerId, schedulerHandle, runner };
  log(
    `[bootstrap-queue] up: scheduler=${!!schedulerHandle} runner=${!!runner} worker=${workerId}`,
  );
  return _state;
}

async function stop() {
  if (!_state) return;
  const { schedulerHandle, runner } = _state;
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
  _state = null;
}

function state() {
  return _state;
}

module.exports = { start, stop, state, defaultWorkerId };
