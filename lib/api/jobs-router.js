/**
 * lib/api/jobs-router.js — HTTP surface for remote workers.
 *
 * Design constraints (from the V4 brief):
 *   - Outbound-only from the worker's perspective. The cloud never calls
 *     the local box; the local box polls the cloud. This is what lets
 *     the Windows worker sit behind any NAT / firewall / VPN without
 *     port-forwarding.
 *   - The cloud is the authority on what exists. Workers claim work,
 *     heartbeat, and report results — they never write state the cloud
 *     can't validate.
 *   - Auth is a shared secret header (WORKER_TOKEN). Falls back to
 *     API_TOKEN if WORKER_TOKEN is unset, so existing deployments keep
 *     working with just one secret.
 *
 * Wire-up:
 *   const jobsRouter = require('./lib/api/jobs-router').build();
 *   app.use('/api', jobsRouter);
 *
 * Endpoints (all under /api):
 *   POST /workers/register           { id, display_name?, host_os?, tags? }
 *   POST /workers/heartbeat          { id, status, metrics? }
 *   POST /workers/event              { id, kind, payload? }
 *   POST /jobs/claim                 { worker_id, kinds?, gpu? } -> job | null
 *   POST /jobs/:id/heartbeat         { worker_id }
 *   POST /jobs/:id/complete          { worker_id, result? }
 *   POST /jobs/:id/fail              { worker_id, error, log? }
 *   GET  /jobs/:id                   -> job row (for worker to re-check)
 *   POST /jobs                       { kind, ... }   (for privileged remote enqueue)
 */

const express = require("express");

function requireWorkerAuth(req, res, next) {
  const headerToken = (req.headers.authorization || "").replace("Bearer ", "");
  const workerSecret = process.env.WORKER_TOKEN || process.env.API_TOKEN;
  if (!workerSecret) {
    // Dev mode: no token enforced. Document loudly so nobody ships it.
    if (process.env.NODE_ENV === "production") {
      return res.status(500).json({
        error: "server_misconfigured",
        message: "WORKER_TOKEN / API_TOKEN not set in production",
      });
    }
    return next();
  }
  if (headerToken !== workerSecret) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function build({
  getRepos = require("../repositories").getRepos,
  log = console.log,
} = {}) {
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));

  // ---------- Workers ----------

  router.post("/workers/register", requireWorkerAuth, (req, res) => {
    try {
      const { id, display_name, host_os, tags, version } = req.body || {};
      if (!id) return res.status(400).json({ error: "id required" });
      const { workers } = getRepos();
      workers.register({
        id,
        display_name: display_name || id,
        host_os: host_os || null,
        tags: Array.isArray(tags) ? tags : [],
        version: version || null,
      });
      workers.heartbeat(id, { status: "idle" });
      workers.logEvent(id, "wake", { display_name, host_os, tags, version });
      res.json({ ok: true });
    } catch (err) {
      log(`[jobs-api] workers/register error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/workers/heartbeat", requireWorkerAuth, (req, res) => {
    try {
      const { id, status, metrics } = req.body || {};
      if (!id) return res.status(400).json({ error: "id required" });
      const { workers } = getRepos();
      workers.heartbeat(id, { status: status || "idle", metrics });
      res.json({ ok: true });
    } catch (err) {
      log(`[jobs-api] workers/heartbeat error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/workers/event", requireWorkerAuth, (req, res) => {
    try {
      const { id, kind, payload } = req.body || {};
      if (!id || !kind)
        return res.status(400).json({ error: "id, kind required" });
      const { workers } = getRepos();
      workers.logEvent(id, kind, payload || {});
      res.json({ ok: true });
    } catch (err) {
      log(`[jobs-api] workers/event error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ---------- Jobs ----------

  router.post("/jobs/claim", requireWorkerAuth, (req, res) => {
    try {
      const { worker_id, kinds, gpu, channel_id, lease_ms } = req.body || {};
      if (!worker_id)
        return res.status(400).json({ error: "worker_id required" });
      const { jobs, workers } = getRepos();
      const job = jobs.claim(worker_id, {
        kinds: Array.isArray(kinds) && kinds.length ? kinds : null,
        gpu: !!gpu,
        channelId: channel_id || null,
        leaseMs: lease_ms || undefined,
      });
      if (!job) return res.json({ job: null });
      try {
        workers.heartbeat(worker_id, { status: "busy" });
      } catch {
        /* ignore */
      }
      res.json({ job });
    } catch (err) {
      log(`[jobs-api] jobs/claim error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/jobs/:id/heartbeat", requireWorkerAuth, (req, res) => {
    try {
      const jobId = Number(req.params.id);
      const { worker_id, lease_ms } = req.body || {};
      if (!worker_id)
        return res.status(400).json({ error: "worker_id required" });
      const { jobs } = getRepos();
      const ok = jobs.heartbeat(jobId, worker_id, lease_ms || undefined);
      if (!ok)
        return res.status(409).json({ error: "lease_not_held", job_id: jobId });
      res.json({ ok: true });
    } catch (err) {
      log(`[jobs-api] jobs/heartbeat error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/jobs/:id/complete", requireWorkerAuth, (req, res) => {
    try {
      const jobId = Number(req.params.id);
      const { worker_id, result, log: logExcerpt } = req.body || {};
      const { jobs, workers } = getRepos();
      // Only the holder of the claim may complete it. Lightweight guard
      // that reads the current row and compares claimed_by.
      const current = jobs.get(jobId);
      if (!current) return res.status(404).json({ error: "job_not_found" });
      if (current.claimed_by && worker_id && current.claimed_by !== worker_id) {
        return res.status(409).json({
          error: "not_claim_holder",
          claimed_by: current.claimed_by,
        });
      }
      jobs.complete(jobId, {
        log:
          logExcerpt ||
          (result !== undefined ? JSON.stringify(result).slice(0, 4000) : null),
      });
      if (worker_id) {
        try {
          workers.heartbeat(worker_id, { status: "idle" });
        } catch {
          /* ignore */
        }
      }
      res.json({ ok: true });
    } catch (err) {
      log(`[jobs-api] jobs/complete error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/jobs/:id/fail", requireWorkerAuth, (req, res) => {
    try {
      const jobId = Number(req.params.id);
      const { worker_id, error, log: logExcerpt } = req.body || {};
      if (!error) return res.status(400).json({ error: "error required" });
      const { jobs, workers } = getRepos();
      const current = jobs.get(jobId);
      if (!current) return res.status(404).json({ error: "job_not_found" });
      if (current.claimed_by && worker_id && current.claimed_by !== worker_id) {
        return res.status(409).json({
          error: "not_claim_holder",
          claimed_by: current.claimed_by,
        });
      }
      const result = jobs.fail(
        jobId,
        typeof error === "string" ? new Error(error) : error,
        { log: logExcerpt || null },
      );
      if (worker_id) {
        try {
          workers.heartbeat(worker_id, { status: "idle" });
        } catch {
          /* ignore */
        }
      }
      res.json({ ok: true, job_status: result && result.status });
    } catch (err) {
      log(`[jobs-api] jobs/fail error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/jobs/:id", requireWorkerAuth, (req, res) => {
    try {
      const { jobs } = getRepos();
      const job = jobs.get(Number(req.params.id));
      if (!job) return res.status(404).json({ error: "job_not_found" });
      res.json({ job });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/jobs", requireWorkerAuth, (req, res) => {
    try {
      const { jobs } = getRepos();
      const job = jobs.enqueue(req.body || {});
      res.json({ job });
    } catch (err) {
      log(`[jobs-api] jobs enqueue error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { build, requireWorkerAuth };
