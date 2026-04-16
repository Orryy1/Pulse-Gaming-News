/**
 * lib/services/jobs-runner.js — the worker loop.
 *
 * Polls jobs.claim() at `pollIntervalMs` and dispatches claimed rows to
 * a registered handler map. Each handler is a plain async function
 * `(job, ctx) => result`. Completion writes status='done', failure
 * increments attempt_count and either reschedules with backoff or
 * finalises at status='failed' once max_attempts is exhausted.
 *
 * One runner instance = one worker. You can run multiple processes
 * (e.g. a cloud runner restricted to CPU kinds + a local runner that
 * claims GPU-required jobs) — the atomic claim in jobs.js guarantees
 * no two workers ever execute the same job row.
 *
 * Heartbeat discipline:
 *   Every `heartbeatMs` the runner pokes the DB to refresh lease_until
 *   for the currently-running job. If the whole process dies, the
 *   `jobs_reap` schedule will return the abandoned claim to 'pending'
 *   once the lease lapses.
 */

const { getRepos } = require("../repositories");

const DEFAULT_POLL_MS = 2000;
const DEFAULT_HEARTBEAT_MS = 30 * 1000;

class JobsRunner {
  constructor({
    workerId,
    handlers,
    kinds = null, // restrict to these kinds (null = all)
    gpu = false, // only claim GPU-required jobs
    pollIntervalMs = DEFAULT_POLL_MS,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    log = console.log,
    onError = null,
  } = {}) {
    if (!workerId) throw new Error("workerId required");
    if (!handlers || typeof handlers !== "object")
      throw new Error("handlers map required");
    this.workerId = workerId;
    this.handlers = handlers;
    this.kinds = kinds;
    this.gpu = gpu;
    this.pollIntervalMs = pollIntervalMs;
    this.heartbeatMs = heartbeatMs;
    this.log = log;
    this.onError = onError;
    this.running = false;
    this.current = null;
    this._tickHandle = null;
    this._heartbeatHandle = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.log(
      `[jobs-runner] ${this.workerId} starting (kinds=${this.kinds || "all"}, gpu=${this.gpu})`,
    );
    this._heartbeatHandle = setInterval(
      () => this._heartbeat(),
      this.heartbeatMs,
    );
    // Register the worker row so dashboards have something to show.
    try {
      const { workers } = getRepos();
      workers.register({
        id: this.workerId,
        display_name: this.workerId,
        host_os: process.platform,
        tags: [this.gpu ? "gpu" : "cpu", ...(this.kinds || [])],
      });
      workers.heartbeat(this.workerId, { status: "idle" });
    } catch (err) {
      this.log(`[jobs-runner] worker register failed: ${err.message}`);
    }
    this._schedule();
  }

  async stop() {
    this.running = false;
    if (this._tickHandle) clearTimeout(this._tickHandle);
    if (this._heartbeatHandle) clearInterval(this._heartbeatHandle);
    this._tickHandle = null;
    this._heartbeatHandle = null;
    try {
      const { workers } = getRepos();
      workers.heartbeat(this.workerId, { status: "offline" });
    } catch {
      /* ignore */
    }
    this.log(`[jobs-runner] ${this.workerId} stopped`);
  }

  _schedule(delay = this.pollIntervalMs) {
    if (!this.running) return;
    this._tickHandle = setTimeout(() => this._tick(), delay);
  }

  async _tick() {
    if (!this.running) return;
    let jobRow = null;
    try {
      const { jobs } = getRepos();
      jobRow = jobs.claim(this.workerId, {
        kinds: this.kinds,
        gpu: this.gpu,
      });
    } catch (err) {
      this.log(`[jobs-runner] claim error: ${err.message}`);
      this._schedule();
      return;
    }

    if (!jobRow) {
      this._schedule();
      return;
    }

    this.current = jobRow;
    try {
      const { workers } = getRepos();
      workers.heartbeat(this.workerId, { status: "busy" });
    } catch {
      /* ignore */
    }

    const handler = this.handlers[jobRow.kind];
    if (!handler) {
      const msg = `no handler registered for kind=${jobRow.kind}`;
      this.log(`[jobs-runner] job ${jobRow.id} ${msg}`);
      try {
        const { jobs } = getRepos();
        jobs.fail(jobRow.id, new Error(msg));
      } catch (err) {
        this.log(`[jobs-runner] fail-write error: ${err.message}`);
      }
      this.current = null;
      this._schedule(50);
      return;
    }

    this.log(
      `[jobs-runner] ${this.workerId} running #${jobRow.id} ${jobRow.kind}`,
    );
    const startedAt = Date.now();
    try {
      const result = await handler(jobRow, {
        workerId: this.workerId,
        repos: getRepos(),
      });
      const { jobs } = getRepos();
      jobs.complete(jobRow.id, {
        log:
          result && typeof result === "object"
            ? JSON.stringify(result).slice(0, 4000)
            : null,
      });
      this.log(
        `[jobs-runner] #${jobRow.id} done in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      this.log(
        `[jobs-runner] #${jobRow.id} ${jobRow.kind} FAILED: ${err.message}`,
      );
      try {
        const { jobs } = getRepos();
        jobs.fail(jobRow.id, err, {
          log: (err && err.stack ? err.stack : String(err)).slice(-4000),
        });
      } catch (innerErr) {
        this.log(`[jobs-runner] fail-write error: ${innerErr.message}`);
      }
      if (this.onError) {
        try {
          await this.onError(err, jobRow);
        } catch (handlerErr) {
          this.log(
            `[jobs-runner] onError handler threw: ${handlerErr.message}`,
          );
        }
      }
    } finally {
      this.current = null;
      try {
        const { workers } = getRepos();
        workers.heartbeat(this.workerId, { status: "idle" });
      } catch {
        /* ignore */
      }
      // Chain straight into another claim if one is waiting; the poll
      // interval is the idle cadence, not the busy cadence.
      this._schedule(50);
    }
  }

  _heartbeat() {
    if (!this.running) return;
    if (!this.current) return;
    try {
      const { jobs, workers } = getRepos();
      jobs.heartbeat(this.current.id, this.workerId);
      workers.heartbeat(this.workerId, { status: "busy" });
    } catch (err) {
      this.log(`[jobs-runner] heartbeat error: ${err.message}`);
    }
  }
}

module.exports = {
  JobsRunner,
  DEFAULT_POLL_MS,
  DEFAULT_HEARTBEAT_MS,
};
