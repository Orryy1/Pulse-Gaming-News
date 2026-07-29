/**
 * jobs repository.
 *
 * Claim semantics:
 *   - `claim(workerId, { kinds, gpu, limit })` runs a tiny transaction
 *     that (1) finds the next eligible row and (2) updates it to
 *     status='claimed' with the worker id + a lease_until timestamp.
 *   - Heartbeats extend lease_until. A reaper elsewhere sweeps jobs whose
 *     lease has expired back to status='pending'.
 *   - `complete(jobId, result)` writes status='done' and appends a
 *     job_runs row; `fail(jobId, err)` increments attempt_count and
 *     either retries (status='pending' with backoff) or finalises to
 *     'failed' when attempts exceed max_attempts.
 */

const DEFAULT_LEASE_MS = 5 * 60 * 1000; // 5 min
const MAX_LEASE_MS = 30 * 60 * 1000; // 30 min hard ceiling
const BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000]; // 1m, 5m, 30m

// Grace window for claims that somehow ended up with lease_until=NULL
// while still in status IN ('claimed','running'). This shouldn't happen
// in the normal claim → heartbeat → complete/fail flow (every path sets
// a non-null lease or transitions status out of running) but the Phase F
// drill found a real orphan (job 23: status=running, lease_until=NULL,
// claimed_by pointing at a dead process). If we require a lease to reap,
// that row is stranded forever and blocks the whole pipeline. Treat
// "claimed more than this long ago with no lease" as reapable too.
const DEFAULT_ORPHAN_GRACE_MIN = Number(
  process.env.JOBS_ORPHAN_GRACE_MIN || 10,
);

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function serialisePayload(payload) {
  if (payload === undefined || payload === null) return null;
  if (typeof payload !== "string") return stableJson(payload);
  try {
    return stableJson(JSON.parse(payload));
  } catch {
    return payload;
  }
}

function canonicalRunAt(value) {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return null;
  }
  const raw = String(value).trim();
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
      raw,
    )
  ) {
    throw new Error("job_run_at_timezone_required");
  }
  const sqliteUtc =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
      ? `${raw.replace(" ", "T")}Z`
      : raw;
  const parsed = new Date(sqliteUtc);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("job_run_at_invalid");
  }
  if (parsed.getUTCMilliseconds() > 0) {
    parsed.setTime(
      parsed.getTime() + (1000 - parsed.getUTCMilliseconds()),
    );
  }
  return parsed.toISOString().replace("T", " ").slice(0, 19);
}

function requiredWorkerId(workerId) {
  const normalised =
    typeof workerId === "string" ? workerId.trim() : "";
  if (!normalised) throw new Error("job_worker_id_required");
  return normalised;
}

function positiveLeaseDuration(leaseMs) {
  const normalised = Number(leaseMs);
  if (!Number.isFinite(normalised) || normalised <= 0) {
    throw new Error("positive_job_lease_duration_required");
  }
  if (normalised > MAX_LEASE_MS) {
    throw new Error("job_lease_duration_exceeds_limit");
  }
  return normalised;
}

function requiredClaimToken(claimToken) {
  const normalised = Number(claimToken);
  if (!Number.isInteger(normalised) || normalised <= 0) {
    throw new Error("job_claim_token_required");
  }
  return normalised;
}

function bind(db) {
  const enqueueStmt = db.prepare(`
    INSERT INTO jobs
      (kind, channel_id, story_id, payload, priority, run_at,
       max_attempts, requires_gpu, idempotency_key, updated_at)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')),
            ?, ?, ?, datetime('now'))
  `);
  const findIdempotent = db.prepare(
    `SELECT * FROM jobs WHERE idempotency_key = ?`,
  );
  const getOne = db.prepare(`SELECT * FROM jobs WHERE id = ?`);
  const cancelPendingExact = db.prepare(`
    UPDATE jobs
    SET status = 'cancelled',
        claimed_by = NULL,
        claimed_at = NULL,
        lease_until = NULL,
        completed_at = datetime('now'),
        last_error = @reason,
        updated_at = datetime('now')
    WHERE id = @id
      AND kind = @kind
      AND idempotency_key = @idempotencyKey
      AND story_id = @storyId
      AND status = 'pending'
    RETURNING *
  `);

  // Atomic claim: we do "SELECT then UPDATE WHERE id=? AND status='pending'"
  // inside a single transaction. Multiple workers racing will see exactly
  // one winner per row because the row-level lock held by the transaction
  // serialises them. RETURNING * lets us avoid a second SELECT.
  const nextClaimable = db.prepare(`
    SELECT * FROM jobs
    WHERE status = 'pending'
      AND attempt_count < max_attempts
      AND datetime(run_at) <= datetime('now')
      AND (@gpuOnly = 0 OR requires_gpu = 1)
      AND (@kindsJson IS NULL OR kind IN (SELECT value FROM json_each(@kindsJson)))
      AND (@channelId IS NULL OR channel_id = @channelId OR channel_id IS NULL)
    ORDER BY priority ASC, run_at ASC, id ASC
    LIMIT 1
  `);
  const claimRow = db.prepare(`
    UPDATE jobs
    SET status = 'claimed',
        claimed_by = @workerId,
        claimed_at = datetime('now'),
        lease_until = datetime(
          'now',
          '+' || (@leaseMs / 1000.0) || ' seconds'
        ),
        attempt_count = attempt_count + 1,
        updated_at = datetime('now')
    WHERE id = @id AND status = 'pending'
    RETURNING *
  `);
  const heartbeatStmt = db.prepare(`
    UPDATE jobs
    SET lease_until = datetime(
          'now',
          '+' || (@leaseMs / 1000.0) || ' seconds'
        ),
        updated_at = datetime('now'),
        status = CASE WHEN status = 'claimed' THEN 'running' ELSE status END
    WHERE id = @id AND claimed_by = @workerId
      AND status IN ('claimed', 'running')
      AND lease_until IS NOT NULL
      AND datetime(lease_until) > datetime('now')
      AND EXISTS (
        SELECT 1
        FROM job_runs
        WHERE id = @claimToken
          AND job_id = jobs.id
          AND worker_id = @workerId
          AND attempt = jobs.attempt_count
          AND finished_at IS NULL
      )
  `);
  const completeStmt = db.prepare(`
    UPDATE jobs
    SET status = 'done',
        completed_at = datetime('now'),
        updated_at = datetime('now'),
        last_error = NULL
    WHERE id = @id
      AND claimed_by = @workerId
      AND status IN ('claimed', 'running')
      AND lease_until IS NOT NULL
      AND datetime(lease_until) > datetime('now')
      AND EXISTS (
        SELECT 1
        FROM job_runs
        WHERE id = @claimToken
          AND job_id = jobs.id
          AND worker_id = @workerId
          AND attempt = jobs.attempt_count
          AND finished_at IS NULL
      )
    RETURNING *
  `);
  const failStmt = db.prepare(`
    UPDATE jobs
    SET status = CASE
          WHEN attempt_count >= max_attempts THEN 'failed'
          ELSE 'pending'
        END,
        run_at = datetime('now', @backoffSec || ' seconds'),
        last_error = @error,
        claimed_by = NULL,
        claimed_at = NULL,
        lease_until = NULL,
        updated_at = datetime('now')
    WHERE id = @id
      AND claimed_by = @workerId
      AND status IN ('claimed', 'running')
      AND lease_until IS NOT NULL
      AND datetime(lease_until) > datetime('now')
      AND EXISTS (
        SELECT 1
        FROM job_runs
        WHERE id = @claimToken
          AND job_id = jobs.id
          AND worker_id = @workerId
          AND attempt = jobs.attempt_count
          AND finished_at IS NULL
      )
    RETURNING status
  `);
  // Reap any claimed/running row whose lease has expired OR whose lease
  // is NULL and whose claim is older than the orphan grace window. The
  // second clause is the bug-fix from the Phase F drill — the original
  // query required lease_until IS NOT NULL and therefore skipped rows
  // that somehow lost their lease while still flagged running.
  const reapStale = db.prepare(`
    UPDATE jobs
    SET status = CASE
          WHEN attempt_count >= max_attempts THEN 'failed'
          ELSE 'pending'
        END,
        claimed_by = NULL,
        claimed_at = NULL,
        lease_until = NULL,
        completed_at = CASE
          WHEN attempt_count >= max_attempts THEN datetime('now')
          ELSE completed_at
        END,
        last_error = COALESCE(last_error, 'reaped: stale claim (' || COALESCE(claimed_by, 'unknown') || ')'),
        updated_at = datetime('now')
    WHERE status IN ('claimed','running')
      AND (
        (lease_until IS NOT NULL AND datetime(lease_until) < datetime('now'))
        OR (
          lease_until IS NULL
          AND claimed_at IS NOT NULL
          AND datetime(claimed_at, '+' || @orphanGraceMin || ' minutes')
              < datetime('now')
        )
      )
  `);
  // Inspection helper — the reaper returns how many rows it touched, but
  // during incident response we also want to know what was there BEFORE
  // the sweep without running the destructive update.
  const listOrphanClaimed = db.prepare(`
    SELECT id, kind, status, claimed_by, claimed_at, lease_until,
           attempt_count, max_attempts
    FROM jobs
    WHERE status IN ('claimed','running')
      AND (
        (lease_until IS NOT NULL AND datetime(lease_until) < datetime('now'))
        OR (
          lease_until IS NULL
          AND claimed_at IS NOT NULL
          AND datetime(claimed_at, '+' || @orphanGraceMin || ' minutes')
              < datetime('now')
        )
      )
    ORDER BY id
  `);
  const runInsert = db.prepare(`
    INSERT INTO job_runs
      (job_id, worker_id, attempt, status, started_at)
    VALUES (?, ?, ?, 'running', datetime('now'))
  `);
  const runFinish = db.prepare(`
    UPDATE job_runs
    SET status = @status,
        finished_at = datetime('now'),
        duration_ms = CAST(
          (julianday('now') - julianday(started_at)) * 86400000 AS INTEGER
        ),
        error_message = @error,
        log_excerpt = @log
    WHERE id = @id
  `);
  const finishReapedRuns = db.prepare(`
    UPDATE job_runs
    SET status = 'failed',
        finished_at = datetime('now'),
        duration_ms = CAST(
          (julianday('now') - julianday(started_at)) * 86400000 AS INTEGER
        ),
        error_message = 'job_lease_expired_and_reaped'
    WHERE job_id = @jobId
      AND worker_id = @workerId
      AND finished_at IS NULL
  `);
  const listByStatus = db.prepare(
    `SELECT * FROM jobs WHERE status = ? ORDER BY priority ASC, run_at ASC`,
  );

  function hydrate(row) {
    if (!row) return null;
    if (row.payload) {
      try {
        row.payload = JSON.parse(row.payload);
      } catch {
        /* keep string */
      }
    }
    return row;
  }

  function enqueueInternal(job) {
    const payload = serialisePayload(job.payload);
    const explicitRunAt =
      job.run_at !== undefined &&
      job.run_at !== null &&
      String(job.run_at).trim() !== "";
    const runAt = canonicalRunAt(job.run_at);
    if (job.idempotency_key) {
      const existing = findIdempotent.get(job.idempotency_key);
      if (existing) {
        const expected = {
          kind: job.kind,
          channel_id: job.channel_id || null,
          story_id: job.story_id || null,
          payload,
          priority: job.priority ?? 50,
          max_attempts: job.max_attempts ?? 3,
          requires_gpu: job.requires_gpu ? 1 : 0,
        };
        const matches = Object.entries(expected).every(
          ([field, value]) =>
            (field === "payload"
              ? serialisePayload(existing[field])
              : existing[field]) === value,
        );
        const runAtMatches =
          !explicitRunAt ||
          canonicalRunAt(existing.run_at) === runAt;
        if (!matches || !runAtMatches) {
          throw new Error("job_idempotency_conflict");
        }
        return existing;
      }
    }
    const info = enqueueStmt.run(
      job.kind,
      job.channel_id || null,
      job.story_id || null,
      payload,
      job.priority ?? 50,
      runAt,
      job.max_attempts ?? 3,
      job.requires_gpu ? 1 : 0,
      job.idempotency_key || null,
    );
    return getOne.get(info.lastInsertRowid);
  }

  return {
    /**
     * Enqueue a job. An exact idempotent retry returns the existing row;
     * reusing the key for different work is a control-plane conflict.
     */
    enqueue(job) {
      const enqueueTransaction = db.transaction(() =>
        enqueueInternal(job),
      );
      return hydrate(enqueueTransaction.immediate());
    },

    /**
     * Enqueue as part of an already-open SQLite transaction. This is the
     * publication-admission outbox boundary: callers cannot accidentally
     * commit SCHEDULED without its exact T0 dispatch job.
     */
    enqueueInTransaction(job) {
      if (db.inTransaction !== true) {
        throw new Error("job_enqueue_transaction_required");
      }
      return hydrate(enqueueInternal(job));
    },

    /**
     * Cancel one exact pending outbox row inside a caller-owned
     * transaction. Reserve promotion uses this fence so the primary's
     * T-15/T0 verification chain cannot remain active alongside the
     * promoted reserve. The immutable runway lock hash is verified from
     * the canonical job payload before mutation.
     */
    cancelExactInTransaction(binding = {}) {
      if (db.inTransaction !== true) {
        throw new Error("job_cancel_transaction_required");
      }
      const id = Number(binding.id);
      const kind = String(binding.kind || "").trim();
      const idempotencyKey = String(
        binding.idempotency_key || "",
      ).trim();
      const storyId = String(
        binding.story_id || "",
      ).trim();
      const runwayLockSha256 = String(
        binding.runway_lock_sha256 || "",
      )
        .trim()
        .toLowerCase();
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error("job_cancel_id_required");
      }
      if (!kind || !idempotencyKey || !storyId) {
        throw new Error("job_cancel_exact_binding_required");
      }
      if (!/^[a-f0-9]{64}$/.test(runwayLockSha256)) {
        throw new Error(
          "job_cancel_runway_lock_sha256_required",
        );
      }
      const row = getOne.get(id);
      if (
        !row ||
        row.kind !== kind ||
        row.idempotency_key !== idempotencyKey ||
        row.story_id !== storyId
      ) {
        throw new Error("job_cancel_exact_binding_mismatch");
      }
      let payload;
      try {
        payload = JSON.parse(row.payload || "{}");
      } catch {
        throw new Error("job_cancel_payload_invalid");
      }
      if (
        String(payload.runway_lock_sha256 || "")
          .trim()
          .toLowerCase() !== runwayLockSha256
      ) {
        throw new Error(
          "job_cancel_runway_lock_sha256_mismatch",
        );
      }
      if (row.status === "cancelled") {
        return hydrate(row);
      }
      if (row.status !== "pending") {
        throw new Error("job_cancel_not_pending");
      }
      const cancelled = cancelPendingExact.get({
        id,
        kind,
        idempotencyKey,
        storyId,
        reason:
          String(binding.reason || "").trim() ||
          "cancelled_by_exact_fenced_transaction",
      });
      if (!cancelled) {
        throw new Error("job_cancel_fence_lost");
      }
      return hydrate(cancelled);
    },

    cancelManyExactInTransaction(bindings = []) {
      if (db.inTransaction !== true) {
        throw new Error("job_cancel_transaction_required");
      }
      if (!Array.isArray(bindings) || bindings.length < 1) {
        throw new Error("job_cancel_bindings_required");
      }
      return bindings.map((binding) =>
        this.cancelExactInTransaction(binding),
      );
    },

    /**
     * Claim the next eligible job for this worker. Returns null when the
     * pool is empty. kinds is optional; passing it narrows to those
     * job kinds. Pass gpu:true to only look at GPU-required jobs.
     */
    claim(
      workerId,
      {
        kinds = null,
        gpu = false,
        channelId = null,
        leaseMs = DEFAULT_LEASE_MS,
      } = {},
    ) {
      const normalisedWorkerId = requiredWorkerId(workerId);
      const normalisedLeaseMs = positiveLeaseDuration(leaseMs);
      const kindsJson = kinds && kinds.length ? JSON.stringify(kinds) : null;
      const txn = db.transaction(() => {
        const candidate = nextClaimable.get({
          gpuOnly: gpu ? 1 : 0,
          kindsJson,
          channelId,
        });
        if (!candidate) return null;
        const claimed = claimRow.get({
          id: candidate.id,
          workerId: normalisedWorkerId,
          leaseMs: normalisedLeaseMs,
        });
        if (!claimed) return null;
        const run = runInsert.run(
          claimed.id,
          normalisedWorkerId,
          claimed.attempt_count,
        );
        claimed.claim_token = String(run.lastInsertRowid);
        return claimed;
      });
      return hydrate(txn.immediate());
    },

    heartbeat(
      jobId,
      workerId,
      claimToken,
      leaseMs = DEFAULT_LEASE_MS,
    ) {
      const normalisedWorkerId = requiredWorkerId(workerId);
      const normalisedClaimToken = requiredClaimToken(claimToken);
      const normalisedLeaseMs = positiveLeaseDuration(leaseMs);
      const info = heartbeatStmt.run({
        id: jobId,
        workerId: normalisedWorkerId,
        claimToken: normalisedClaimToken,
        leaseMs: normalisedLeaseMs,
      });
      return info.changes > 0;
    },

    complete(jobId, workerId, claimToken, { log = null } = {}) {
      const normalisedWorkerId = requiredWorkerId(workerId);
      const normalisedClaimToken = requiredClaimToken(claimToken);
      const txn = db.transaction(() => {
        const completed = completeStmt.get({
          id: jobId,
          workerId: normalisedWorkerId,
          claimToken: normalisedClaimToken,
        });
        if (!completed) throw new Error("job_lease_not_held");
        const runRow = db
          .prepare(
            `SELECT id
             FROM job_runs
             WHERE id = ? AND job_id = ? AND worker_id = ?
               AND finished_at IS NULL`,
          )
          .get(
            normalisedClaimToken,
            jobId,
            normalisedWorkerId,
          );
        if (runRow) {
          runFinish.run({
            id: runRow.id,
            status: "done",
            error: null,
            log,
          });
        }
        return completed;
      });
      return hydrate(txn.immediate());
    },

    fail(
      jobId,
      workerId,
      claimToken,
      error,
      { log = null, retryAfterSeconds = null } = {},
    ) {
      const normalisedWorkerId = requiredWorkerId(workerId);
      const normalisedClaimToken = requiredClaimToken(claimToken);
      const errText = (error && error.message) || String(error || "unknown");

      const txn = db.transaction(() => {
        const attempt = getOne.get(jobId);
        if (!attempt) throw new Error("job_lease_not_held");
        const idx = Math.min(
          attempt.attempt_count - 1,
          BACKOFF_MS.length - 1,
        );
        const requestedRetryAfter = Number(
          retryAfterSeconds,
        );
        const backoffSec =
          Number.isFinite(requestedRetryAfter) &&
          requestedRetryAfter >= 1
            ? Math.min(
                3600,
                Math.floor(requestedRetryAfter),
              )
            : Math.max(
                1,
                Math.floor(
                  BACKOFF_MS[Math.max(0, idx)] / 1000,
                ),
              );
        const res = failStmt.get({
          id: jobId,
          workerId: normalisedWorkerId,
          claimToken: normalisedClaimToken,
          error: errText,
          backoffSec,
        });
        if (!res) throw new Error("job_lease_not_held");
        const runRow = db
          .prepare(
            `SELECT id
             FROM job_runs
             WHERE id = ? AND job_id = ? AND worker_id = ?
               AND finished_at IS NULL`,
          )
          .get(
            normalisedClaimToken,
            jobId,
            normalisedWorkerId,
          );
        if (runRow) {
          runFinish.run({
            id: runRow.id,
            status: res && res.status === "failed" ? "failed" : "failed",
            error: errText,
            log,
          });
        }
        return res;
      });
      return txn.immediate();
    },

    /**
     * Sweep expired-lease and null-lease orphans back to pending. Returns
     * the number of rows reclaimed. orphanGraceMin overrides the env
     * default for a single sweep (useful for manual recovery). See
     * DEFAULT_ORPHAN_GRACE_MIN for the semantics.
     */
    reapStaleClaims({ orphanGraceMin = DEFAULT_ORPHAN_GRACE_MIN } = {}) {
      const txn = db.transaction(() => {
        const stale = listOrphanClaimed.all({ orphanGraceMin });
        const info = reapStale.run({ orphanGraceMin });
        for (const row of stale) {
          if (!row.claimed_by) continue;
          finishReapedRuns.run({
            jobId: row.id,
            workerId: row.claimed_by,
          });
        }
        return info.changes;
      });
      return txn.immediate();
    },

    /**
     * Non-destructive inspection of the rows the next reap would touch.
     * Surface this through the API during incident response to prove
     * what's about to be reclaimed before running the sweep.
     */
    listOrphanClaims({ orphanGraceMin = DEFAULT_ORPHAN_GRACE_MIN } = {}) {
      return listOrphanClaimed.all({ orphanGraceMin });
    },

    get(jobId) {
      return hydrate(getOne.get(jobId));
    },

    getByIdempotencyKey(idempotencyKey) {
      const key = String(idempotencyKey || "").trim();
      return key ? hydrate(findIdempotent.get(key)) : null;
    },

    listPending() {
      return listByStatus.all("pending").map(hydrate);
    },
    listFailed() {
      return listByStatus.all("failed").map(hydrate);
    },
  };
}

module.exports = { bind, DEFAULT_LEASE_MS, DEFAULT_ORPHAN_GRACE_MIN };
