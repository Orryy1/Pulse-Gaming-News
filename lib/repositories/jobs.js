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

  // Atomic claim: we do "SELECT then UPDATE WHERE id=? AND status='pending'"
  // inside a single transaction. Multiple workers racing will see exactly
  // one winner per row because the row-level lock held by the transaction
  // serialises them. RETURNING * lets us avoid a second SELECT.
  const nextClaimable = db.prepare(`
    SELECT * FROM jobs
    WHERE status = 'pending'
      AND run_at <= datetime('now')
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
        lease_until = datetime('now', @leaseMs || ' milliseconds'),
        attempt_count = attempt_count + 1,
        updated_at = datetime('now')
    WHERE id = @id AND status = 'pending'
    RETURNING *
  `);
  const heartbeatStmt = db.prepare(`
    UPDATE jobs
    SET lease_until = datetime('now', @leaseMs || ' milliseconds'),
        updated_at = datetime('now'),
        status = CASE WHEN status = 'claimed' THEN 'running' ELSE status END
    WHERE id = @id AND claimed_by = @workerId
  `);
  const completeStmt = db.prepare(`
    UPDATE jobs
    SET status = 'done',
        completed_at = datetime('now'),
        updated_at = datetime('now'),
        last_error = NULL
    WHERE id = ?
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
    RETURNING status
  `);
  // Reap any claimed/running row whose lease has expired OR whose lease
  // is NULL and whose claim is older than the orphan grace window. The
  // second clause is the bug-fix from the Phase F drill — the original
  // query required lease_until IS NOT NULL and therefore skipped rows
  // that somehow lost their lease while still flagged running.
  const reapStale = db.prepare(`
    UPDATE jobs
    SET status = 'pending',
        claimed_by = NULL,
        claimed_at = NULL,
        lease_until = NULL,
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
    SELECT id, kind, status, claimed_by, claimed_at, lease_until, attempt_count
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

  return {
    /**
     * Enqueue a job. If idempotency_key is set and already exists,
     * returns the existing row instead of inserting.
     */
    enqueue(job) {
      if (job.idempotency_key) {
        const existing = findIdempotent.get(job.idempotency_key);
        if (existing) return hydrate(existing);
      }
      const payload = job.payload
        ? typeof job.payload === "string"
          ? job.payload
          : JSON.stringify(job.payload)
        : null;
      const info = enqueueStmt.run(
        job.kind,
        job.channel_id || null,
        job.story_id || null,
        payload,
        job.priority ?? 50,
        job.run_at || null,
        job.max_attempts ?? 3,
        job.requires_gpu ? 1 : 0,
        job.idempotency_key || null,
      );
      return hydrate(getOne.get(info.lastInsertRowid));
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
          workerId,
          leaseMs,
        });
        if (!claimed) return null;
        runInsert.run(claimed.id, workerId, claimed.attempt_count);
        return claimed;
      });
      return hydrate(txn());
    },

    heartbeat(jobId, workerId, leaseMs = DEFAULT_LEASE_MS) {
      const info = heartbeatStmt.run({ id: jobId, workerId, leaseMs });
      return info.changes > 0;
    },

    complete(jobId, { log = null } = {}) {
      const txn = db.transaction(() => {
        completeStmt.run(jobId);
        const runRow = db
          .prepare(
            `SELECT id FROM job_runs WHERE job_id = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1`,
          )
          .get(jobId);
        if (runRow) {
          runFinish.run({
            id: runRow.id,
            status: "done",
            error: null,
            log,
          });
        }
      });
      txn();
    },

    fail(jobId, error, { log = null } = {}) {
      const attempt = getOne.get(jobId);
      if (!attempt) return null;
      const idx = Math.min(attempt.attempt_count - 1, BACKOFF_MS.length - 1);
      const backoffSec = Math.max(
        1,
        Math.floor(BACKOFF_MS[Math.max(0, idx)] / 1000),
      );
      const errText = (error && error.message) || String(error || "unknown");

      const txn = db.transaction(() => {
        const res = failStmt.get({
          id: jobId,
          error: errText,
          backoffSec,
        });
        const runRow = db
          .prepare(
            `SELECT id FROM job_runs WHERE job_id = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1`,
          )
          .get(jobId);
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
      return txn();
    },

    /**
     * Sweep expired-lease and null-lease orphans back to pending. Returns
     * the number of rows reclaimed. orphanGraceMin overrides the env
     * default for a single sweep (useful for manual recovery). See
     * DEFAULT_ORPHAN_GRACE_MIN for the semantics.
     */
    reapStaleClaims({ orphanGraceMin = DEFAULT_ORPHAN_GRACE_MIN } = {}) {
      const info = reapStale.run({ orphanGraceMin });
      return info.changes;
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

    listPending() {
      return listByStatus.all("pending").map(hydrate);
    },
    listFailed() {
      return listByStatus.all("failed").map(hydrate);
    },
  };
}

module.exports = { bind, DEFAULT_LEASE_MS, DEFAULT_ORPHAN_GRACE_MIN };
