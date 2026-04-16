/**
 * workers repository.
 *
 * Each host that claims jobs registers here once and heartbeats on
 * every claim/complete cycle. The status field doubles as a coarse
 * gate for the cloud scheduler — a worker in status='locked'
 * (protected-app running) or 'draining' (shutting down) does not
 * receive new claims.
 */

function bind(db) {
  const upsert = db.prepare(`
    INSERT INTO workers
      (id, display_name, host_os, tags, max_concurrent_jobs,
       last_seen_at, status, version)
    VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      host_os = excluded.host_os,
      tags = excluded.tags,
      max_concurrent_jobs = excluded.max_concurrent_jobs,
      last_seen_at = datetime('now'),
      status = excluded.status,
      version = excluded.version
  `);
  const touch = db.prepare(`
    UPDATE workers
    SET last_seen_at = datetime('now'),
        status = COALESCE(?, status),
        last_job_id = COALESCE(?, last_job_id)
    WHERE id = ?
  `);
  const getOne = db.prepare(`SELECT * FROM workers WHERE id = ?`);
  const listAll = db.prepare(`SELECT * FROM workers ORDER BY id`);
  const event = db.prepare(`
    INSERT INTO worker_events (worker_id, kind, payload)
    VALUES (?, ?, ?)
  `);
  const recentEvents = db.prepare(`
    SELECT * FROM worker_events
    WHERE worker_id = ?
    ORDER BY id DESC
    LIMIT ?
  `);

  function hydrate(row) {
    if (!row) return null;
    if (row.tags) {
      try {
        row.tags = JSON.parse(row.tags);
      } catch {
        row.tags = String(row.tags).split(",");
      }
    }
    return row;
  }

  return {
    register(worker) {
      upsert.run(
        worker.id,
        worker.display_name || worker.id,
        worker.host_os || "unknown",
        JSON.stringify(worker.tags || []),
        worker.max_concurrent_jobs || 1,
        worker.status || "idle",
        worker.version || "dev",
      );
      return hydrate(getOne.get(worker.id));
    },
    heartbeat(workerId, { status = null, lastJobId = null } = {}) {
      touch.run(status, lastJobId, workerId);
    },
    logEvent(workerId, kind, payload = null) {
      event.run(workerId, kind, payload ? JSON.stringify(payload) : null);
    },
    get(id) {
      return hydrate(getOne.get(id));
    },
    list() {
      return listAll.all().map(hydrate);
    },
    recentEvents(workerId, limit = 50) {
      return recentEvents.all(workerId, limit);
    },
  };
}

module.exports = { bind };
