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
 * claims GPU-required jobs). Atomic claims prevent concurrent ownership.
 * If an expired lease is reaped while a non-cooperative handler is still
 * running, completion remains fenced by worker identity and lease expiry;
 * handlers must honour `signal` or `assertLeaseHealthy` before side effects.
 *
 * Heartbeat discipline:
 *   Every `heartbeatMs` the runner pokes the DB to refresh lease_until
 *   for the currently-running job. If the whole process dies, the
 *   `jobs_reap` schedule will return the abandoned claim to 'pending'
 *   once the lease lapses. A conservative local deadline mirrors the
 *   server lease so stalled event loops and late heartbeat responses
 *   cannot silently extend handler authority.
 */

const { getRepos } = require("../repositories");
const { DEFAULT_LEASE_MS } = require("../repositories/jobs");

const DEFAULT_POLL_MS = 2000;
const DEFAULT_HEARTBEAT_MS = 30 * 1000;
const DEFAULT_DRAIN_TIMEOUT_MS = 8000;
const MAX_SERVER_JOB_LEASE_MS = 30 * 60 * 1000;
const QUIET_SUCCESS_KINDS = new Set(["jobs_reap"]);

function positiveMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
}

function timestampMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  let normalised = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalised)) {
    normalised = `${normalised.replace(" ", "T")}Z`;
  }
  const parsed = Date.parse(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

function serverLeaseDurationMs(jobRow, fallback) {
  const claimedAt = timestampMs(jobRow?.claimed_at);
  const leaseUntil = timestampMs(jobRow?.lease_until);
  const reportedDuration =
    claimedAt === null || leaseUntil === null ? null : leaseUntil - claimedAt;
  if (
    Number.isFinite(reportedDuration) &&
    reportedDuration > 0 &&
    reportedDuration <= MAX_SERVER_JOB_LEASE_MS
  ) {
    return Math.min(reportedDuration, fallback);
  }
  return fallback;
}

class JobLeaseLostError extends Error {
  constructor() {
    super("job_lease_lost");
    this.name = "JobLeaseLostError";
    this.code = "job_lease_lost";
  }
}

class RetryableJobOutcomeError extends Error {
  constructor(result = {}) {
    const blockers = Array.isArray(result.blockers)
      ? result.blockers
          .map((value) =>
            String(value || "")
              .trim()
              .replace(/[^a-zA-Z0-9_:.=-]/g, "_")
              .slice(0, 160),
          )
          .filter(Boolean)
          .slice(0, 20)
      : [];
    super(
      `retryable_job_outcome:${blockers[0] || "handler_requested_retry"}`,
    );
    this.name = "RetryableJobOutcomeError";
    this.code = "retryable_job_outcome";
    this.retryable = true;
    this.blockers = blockers;
    const retryAfterSeconds = Number(
      result.retry_after_seconds,
    );
    this.retryAfterSeconds =
      Number.isFinite(retryAfterSeconds) &&
      retryAfterSeconds >= 1
        ? Math.min(3600, Math.floor(retryAfterSeconds))
        : null;
  }
}

function retryableHandlerOutcome(result) {
  return (
    result &&
    typeof result === "object" &&
    result.status === "held" &&
    result.job_outcome === "RETRY" &&
    result.retryable === true
  );
}

function shouldLogJobLifecycle(jobRow) {
  return !QUIET_SUCCESS_KINDS.has(jobRow?.kind);
}

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
    reposProvider = getRepos,
    drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
    leaseMs = DEFAULT_LEASE_MS,
  } = {}) {
    if (!workerId) throw new Error("workerId required");
    if (!handlers || typeof handlers !== "object")
      throw new Error("handlers map required");
    this.workerId = workerId;
    this.handlers = handlers;
    this.kinds = kinds;
    this.gpu = gpu;
    this.pollIntervalMs = positiveMs(pollIntervalMs, DEFAULT_POLL_MS);
    this.heartbeatMs = positiveMs(heartbeatMs, DEFAULT_HEARTBEAT_MS);
    this.leaseMs = Math.min(
      MAX_SERVER_JOB_LEASE_MS,
      positiveMs(leaseMs, DEFAULT_LEASE_MS),
    );
    this.log = log;
    this.onError = onError;
    this.reposProvider = reposProvider;
    this.drainTimeoutMs = Math.max(
      1,
      Number(drainTimeoutMs) || DEFAULT_DRAIN_TIMEOUT_MS,
    );
    this.running = false;
    this.current = null;
    this._currentLeaseHealthy = false;
    this._currentLeaseDurationMs = null;
    this._currentLeaseDeadlineMs = 0;
    this._currentLeaseDeadlineHandle = null;
    this._claimGeneration = 0;
    this._currentClaimGeneration = 0;
    this._currentAbortController = null;
    this._tickHandle = null;
    this._heartbeatHandle = null;
    this._currentDrainPromise = null;
    this._resolveCurrentDrain = null;
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
      const { workers } = this.reposProvider();
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
    const drainPromise = this._currentDrainPromise;
    this._currentLeaseHealthy = false;
    this._currentLeaseDurationMs = null;
    this._currentLeaseDeadlineMs = 0;
    this._clearLeaseDeadlineTimer();
    this._currentAbortController?.abort(new JobLeaseLostError());
    if (this._tickHandle) clearTimeout(this._tickHandle);
    if (this._heartbeatHandle) clearInterval(this._heartbeatHandle);
    this._tickHandle = null;
    this._heartbeatHandle = null;
    let drained = true;
    if (drainPromise) {
      drained = await Promise.race([
        drainPromise.then(() => true),
        new Promise((resolve) =>
          setTimeout(() => resolve(false), this.drainTimeoutMs),
        ),
      ]);
    }
    try {
      const { workers } = this.reposProvider();
      workers.heartbeat(this.workerId, { status: "offline" });
    } catch {
      /* ignore */
    }
    this.log(
      `[jobs-runner] ${this.workerId} stopped drained=${drained}`,
    );
    return { drained };
  }

  _schedule(delay = this.pollIntervalMs) {
    if (!this.running) return;
    this._tickHandle = setTimeout(() => this._tick(), delay);
  }

  _isCurrentClaim(jobRow, generation) {
    return (
      this._currentClaimGeneration === generation &&
      this.current?.id === jobRow?.id &&
      String(this.current?.claim_token) === String(jobRow?.claim_token)
    );
  }

  _clearLeaseDeadlineTimer() {
    if (this._currentLeaseDeadlineHandle) {
      clearTimeout(this._currentLeaseDeadlineHandle);
      this._currentLeaseDeadlineHandle = null;
    }
  }

  _loseLease(jobRow, generation) {
    if (!this._isCurrentClaim(jobRow, generation)) return false;
    this._currentLeaseHealthy = false;
    this._currentLeaseDeadlineMs = 0;
    this._clearLeaseDeadlineTimer();
    this._currentAbortController?.abort(new JobLeaseLostError());
    return true;
  }

  _localLeaseWindowMs(durationMs) {
    const duration = positiveMs(durationMs, this.leaseMs);
    const safetyMs = Math.min(
      this.heartbeatMs,
      Math.max(1, Math.floor(duration * 0.1)),
    );
    return Math.max(1, duration - safetyMs);
  }

  _armLeaseDeadline(jobRow, generation, deadlineMs) {
    if (!this._isCurrentClaim(jobRow, generation)) return false;
    this._currentLeaseDeadlineMs = deadlineMs;
    this._clearLeaseDeadlineTimer();
    const expectedDeadline = this._currentLeaseDeadlineMs;
    const checkDeadline = () => {
      if (!this._isCurrentClaim(jobRow, generation)) return;
      if (this._currentLeaseDeadlineMs !== expectedDeadline) return;
      const remainingMs = expectedDeadline - Date.now();
      if (remainingMs > 0) {
        this._currentLeaseDeadlineHandle = setTimeout(
          checkDeadline,
          remainingMs,
        );
        this._currentLeaseDeadlineHandle.unref?.();
        return;
      }
      if (this._loseLease(jobRow, generation)) {
        this.log(
          `[jobs-runner] job ${jobRow.id} local lease deadline elapsed; aborting cooperative work`,
        );
      }
    };
    const delayMs = expectedDeadline - Date.now();
    if (delayMs <= 0) {
      checkDeadline();
      return false;
    }
    this._currentLeaseDeadlineHandle = setTimeout(checkDeadline, delayMs);
    this._currentLeaseDeadlineHandle.unref?.();
    return true;
  }

  _startLocalLease(jobRow, generation, claimStartedAt) {
    this._currentLeaseDurationMs = serverLeaseDurationMs(
      jobRow,
      this.leaseMs,
    );
    return this._armLeaseDeadline(
      jobRow,
      generation,
      claimStartedAt +
        this._localLeaseWindowMs(this._currentLeaseDurationMs),
    );
  }

  _renewLocalLease(jobRow, generation, heartbeatStartedAt) {
    if (
      !this._currentLeaseHealthy ||
      !this._isCurrentClaim(jobRow, generation)
    ) {
      return false;
    }
    return this._armLeaseDeadline(
      jobRow,
      generation,
      heartbeatStartedAt +
        this._localLeaseWindowMs(this._currentLeaseDurationMs),
    );
  }

  async _tick() {
    if (!this.running) return;
    let jobRow = null;
    const claimStartedAt = Date.now();
    try {
      const { jobs } = this.reposProvider();
      jobRow = jobs.claim(this.workerId, {
        kinds: this.kinds,
        gpu: this.gpu,
        leaseMs: this.leaseMs,
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
    const claimGeneration = ++this._claimGeneration;
    this._currentClaimGeneration = claimGeneration;
    this._currentDrainPromise = new Promise((resolve) => {
      this._resolveCurrentDrain = resolve;
    });
    this._currentLeaseHealthy = true;
    this._currentAbortController = new AbortController();
    this._startLocalLease(jobRow, claimGeneration, claimStartedAt);
    const assertLeaseHealthy = () => {
      if (
        this._isCurrentClaim(jobRow, claimGeneration) &&
        Date.now() >= this._currentLeaseDeadlineMs
      ) {
        this._loseLease(jobRow, claimGeneration);
      }
      if (
        !this._currentLeaseHealthy ||
        !this._isCurrentClaim(jobRow, claimGeneration)
      ) {
        throw new JobLeaseLostError();
      }
      return true;
    };
    try {
      const { workers } = this.reposProvider();
      workers.heartbeat(this.workerId, { status: "busy" });
    } catch {
      /* ignore */
    }

    const handler = this.handlers[jobRow.kind];
    if (!handler) {
      const msg = `no handler registered for kind=${jobRow.kind}`;
      this.log(`[jobs-runner] job ${jobRow.id} ${msg}`);
      try {
        const { jobs } = this.reposProvider();
        jobs.fail(
          jobRow.id,
          this.workerId,
          jobRow.claim_token,
          new Error(msg),
        );
      } catch (err) {
        this.log(`[jobs-runner] fail-write error: ${err.message}`);
      }
      this.current = null;
      this._currentLeaseHealthy = false;
      this._currentLeaseDurationMs = null;
      this._currentLeaseDeadlineMs = 0;
      this._clearLeaseDeadlineTimer();
      this._currentAbortController = null;
      this._resolveCurrentDrain?.();
      this._currentDrainPromise = null;
      this._resolveCurrentDrain = null;
      this._schedule(50);
      return;
    }

    const logLifecycle = shouldLogJobLifecycle(jobRow);
    if (logLifecycle) {
      this.log(
        `[jobs-runner] ${this.workerId} running #${jobRow.id} ${jobRow.kind}`,
      );
    }
    const startedAt = Date.now();
    try {
      assertLeaseHealthy();
      const result = await handler(jobRow, {
        workerId: this.workerId,
        repos: this.reposProvider(),
        signal: this._currentAbortController.signal,
        assertLeaseHealthy,
      });
      assertLeaseHealthy();
      if (retryableHandlerOutcome(result)) {
        throw new RetryableJobOutcomeError(result);
      }
      const { jobs } = this.reposProvider();
      jobs.complete(jobRow.id, this.workerId, jobRow.claim_token, {
        log:
          result && typeof result === "object"
            ? JSON.stringify(result).slice(0, 4000)
            : null,
      });
      if (logLifecycle) {
        this.log(
          `[jobs-runner] #${jobRow.id} done in ${Date.now() - startedAt}ms`,
        );
      }
    } catch (err) {
      this.log(
        `[jobs-runner] #${jobRow.id} ${jobRow.kind} FAILED: ${err.message}`,
      );
      let failResult = null;
      try {
        const { jobs } = this.reposProvider();
        failResult = jobs.fail(
          jobRow.id,
          this.workerId,
          jobRow.claim_token,
          err,
          {
            log: (err && err.stack ? err.stack : String(err)).slice(-4000),
            ...(Number.isFinite(err?.retryAfterSeconds)
              ? {
                  retryAfterSeconds:
                    err.retryAfterSeconds,
                }
              : {}),
          },
        );
      } catch (innerErr) {
        this.log(`[jobs-runner] fail-write error: ${innerErr.message}`);
      }
      // Discord alert on TERMINAL failure only — not on every retry.
      // Gated behind DISCORD_NOTIFY_FAILED_JOBS=true so dev doesn't
      // spam. Production should set this in Railway env so
      // roundup_weekly / db_backup_daily / instagram_token_refresh /
      // studio_analytics_loop failures don't sit in the jobs table
      // unnoticed.
      if (
        failResult &&
        failResult.status === "failed" &&
        process.env.DISCORD_NOTIFY_FAILED_JOBS === "true"
      ) {
        try {
          const sendDiscord = require("../../notify");
          const safeMsg = String(err && err.message ? err.message : err)
            .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
            .replace(/access_token=[^\s&"']+/gi, "access_token=<redacted>")
            .slice(0, 1500);
          await sendDiscord(
            `**Job failed (terminal)** \`${jobRow.kind}\` job #${jobRow.id} after ${jobRow.attempt_count + 1} attempt(s)\n\`\`\`\n${safeMsg}\n\`\`\``,
          );
        } catch (notifyErr) {
          this.log(
            `[jobs-runner] Discord notify error (non-fatal): ${notifyErr.message}`,
          );
        }
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
      this._currentLeaseHealthy = false;
      this._currentLeaseDurationMs = null;
      this._currentLeaseDeadlineMs = 0;
      this._clearLeaseDeadlineTimer();
      this._currentAbortController = null;
      this._resolveCurrentDrain?.();
      this._currentDrainPromise = null;
      this._resolveCurrentDrain = null;
      try {
        const { workers } = this.reposProvider();
        workers.heartbeat(this.workerId, { status: "idle" });
      } catch {
        /* ignore */
      }
      // Chain straight into another claim if one is waiting; the poll
      // interval is the idle cadence, not the busy cadence.
      this._schedule(50);
    }
  }

  async _heartbeat() {
    if (!this.running) return false;
    if (!this.current) return false;
    const jobRow = this.current;
    const claimGeneration = this._currentClaimGeneration;
    if (
      !this._currentLeaseHealthy ||
      !this._isCurrentClaim(jobRow, claimGeneration)
    ) {
      return false;
    }
    if (Date.now() >= this._currentLeaseDeadlineMs) {
      if (this._loseLease(jobRow, claimGeneration)) {
        this.log(
          `[jobs-runner] job ${jobRow.id} local lease deadline elapsed before heartbeat`,
        );
      }
      return false;
    }
    let held = false;
    const heartbeatStartedAt = Date.now();
    try {
      const { jobs } = this.reposProvider();
      held = await jobs.heartbeat(
        jobRow.id,
        this.workerId,
        jobRow.claim_token,
        this.leaseMs,
      );
    } catch (err) {
      this.log(`[jobs-runner] heartbeat error: ${err.message}`);
    }
    if (!this._isCurrentClaim(jobRow, claimGeneration)) {
      return false;
    }
    if (
      !this._currentLeaseHealthy ||
      Date.now() >= this._currentLeaseDeadlineMs
    ) {
      this._loseLease(jobRow, claimGeneration);
      return false;
    }
    if (!held) {
      if (this._loseLease(jobRow, claimGeneration)) {
        this.log(
          `[jobs-runner] job ${jobRow.id} lease lost; aborting cooperative work`,
        );
      }
      return false;
    }
    this._renewLocalLease(jobRow, claimGeneration, heartbeatStartedAt);
    try {
      const { workers } = this.reposProvider();
      workers.heartbeat(this.workerId, { status: "busy" });
    } catch (err) {
      this.log(`[jobs-runner] worker heartbeat error: ${err.message}`);
    }
    return true;
  }
}

module.exports = {
  JobLeaseLostError,
  RetryableJobOutcomeError,
  JobsRunner,
  DEFAULT_POLL_MS,
  DEFAULT_HEARTBEAT_MS,
  retryableHandlerOutcome,
  shouldLogJobLifecycle,
};
