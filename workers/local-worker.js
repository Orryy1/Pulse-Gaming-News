/**
 * workers/local-worker.js — the unattended worker daemon.
 *
 * Mirrors JobsRunner (lib/services/jobs-runner.js) but talks to the
 * cloud over HTTPS instead of a local SQLite handle. This is the Phase
 * 4 contract: cloud = truth, local = muscle; all traffic is outbound
 * from the local box.
 *
 * Runtime layout:
 *   WORKER_CLOUD_URL      https://pulse-gaming-news.up.railway.app
 *   WORKER_TOKEN          shared secret (falls back to API_TOKEN)
 *   WORKER_ID             stable id, default `local-<hostname>`
 *   WORKER_KINDS          comma-separated list (e.g. "image,audio,assemble")
 *                         omit to claim everything
 *   WORKER_GPU            set to 1 to only claim requires_gpu=1 jobs
 *   WORKER_POLL_MS        idle poll cadence (default 3000)
 *   WORKER_HEARTBEAT_MS   lease heartbeat cadence (default 30000)
 *
 * Running: `node workers/local-worker.js`
 * Under Task Scheduler: wrap in scripts/task-scheduler/pulse-worker.ps1
 *   (see Phase 5).
 *
 * The worker starts a child process per job by running `node workers/
 * job-exec.js <kind>`, so a hung or crashing handler cannot take down
 * the polling loop. For Phase 4 we only ship the in-process variant to
 * prove the protocol; the process-isolated variant comes with Phase 5's
 * power-aware wrapper.
 */

const os = require("os");
const { handlers } = require("../lib/job-handlers");

const DEFAULT_POLL_MS = Number(process.env.WORKER_POLL_MS) || 3000;
const DEFAULT_HEARTBEAT_MS = Number(process.env.WORKER_HEARTBEAT_MS) || 30000;

class LocalWorker {
  constructor({
    cloudUrl = process.env.WORKER_CLOUD_URL,
    token = process.env.WORKER_TOKEN || process.env.API_TOKEN,
    workerId = process.env.WORKER_ID || `local-${os.hostname()}`,
    kinds = parseCsv(process.env.WORKER_KINDS),
    gpu = process.env.WORKER_GPU === "1" || process.env.WORKER_GPU === "true",
    pollIntervalMs = DEFAULT_POLL_MS,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    handlerMap = handlers,
    log = (msg) => console.log(msg),
    onError = null,
    isAllowed = null, // async () => boolean — Phase 5 power gate
  } = {}) {
    if (!cloudUrl) {
      throw new Error(
        "LocalWorker: WORKER_CLOUD_URL (or cloudUrl option) is required",
      );
    }
    this.cloudUrl = cloudUrl.replace(/\/$/, "");
    this.token = token || null;
    this.workerId = workerId;
    this.kinds = kinds && kinds.length ? kinds : null;
    this.gpu = !!gpu;
    this.pollIntervalMs = pollIntervalMs;
    this.heartbeatMs = heartbeatMs;
    this.handlerMap = handlerMap;
    this.log = log;
    this.onError = onError;
    this.isAllowed = isAllowed;
    this.running = false;
    this.current = null;
    this._heartbeatHandle = null;
    this._tickHandle = null;
  }

  async _fetch(path, { method = "GET", body = null } = {}) {
    const url = `${this.cloudUrl}${path}`;
    const headers = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`,
      );
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.log(
      `[local-worker] ${this.workerId} starting cloud=${this.cloudUrl} kinds=${this.kinds || "all"} gpu=${this.gpu}`,
    );

    // Phase 1B: same readiness gate the in-process bootstrap-queue runs.
    // Without this, a remote GPU worker boots, claims a job, and then
    // the job handler hits the dead inference service — burning one
    // attempt per poll cycle. Wait for phase='ready' (or refuse to
    // start when phase='failed') before we announce the worker as live.
    if (this.gpu && process.env.INFER_WAIT_ON_BOOT !== "false") {
      const inferenceClient = require("../lib/inference-client");
      try {
        this.log(
          `[local-worker] ${this.workerId} — waiting for inference ready`,
        );
        const h = await inferenceClient.waitForReady({
          acceptSkipped: process.env.INFER_ACCEPT_SKIPPED === "true",
          log: (m) => this.log(m),
          deadlineMs: Number(process.env.INFER_READY_DEADLINE_MS || 900_000),
        });
        this.log(
          `[local-worker] inference ready phase=${h.phase} last_load_ms=${h.last_load_ms ?? "-"}`,
        );
      } catch (err) {
        const isFailed =
          err instanceof inferenceClient.InferFailedStateError ||
          err?.name === "InferFailedStateError";
        if (isFailed && process.env.INFER_ALLOW_FAILED_START !== "true") {
          this.log(
            `[local-worker] REFUSING to start — inference phase=failed ` +
              `(${err.lastError || err.message}). Restart tts_server and ` +
              `investigate, or set INFER_ALLOW_FAILED_START=true to override.`,
          );
          this.running = false;
          throw err;
        }
        this.log(
          `[local-worker] inference readiness wait FAILED: ${err.message}. ` +
            `Claiming anyway — jobs will pay cold-start cost or fail.`,
        );
      }
    }

    try {
      await this._fetch("/api/workers/register", {
        method: "POST",
        body: {
          id: this.workerId,
          display_name: this.workerId,
          host_os: process.platform,
          tags: [this.gpu ? "gpu" : "cpu", ...(this.kinds || [])],
          version: process.env.npm_package_version || null,
        },
      });
    } catch (err) {
      this.log(`[local-worker] register failed: ${err.message}`);
      // Soft-fail: keep trying to claim anyway; register isn't strictly
      // required for the claim to succeed.
    }
    this._heartbeatHandle = setInterval(
      () => this._heartbeat(),
      this.heartbeatMs,
    );
    this._schedule(0);
  }

  async stop() {
    this.running = false;
    if (this._tickHandle) clearTimeout(this._tickHandle);
    if (this._heartbeatHandle) clearInterval(this._heartbeatHandle);
    this._tickHandle = null;
    this._heartbeatHandle = null;
    try {
      await this._fetch("/api/workers/heartbeat", {
        method: "POST",
        body: { id: this.workerId, status: "offline" },
      });
    } catch {
      /* ignore */
    }
    this.log(`[local-worker] ${this.workerId} stopped`);
  }

  _schedule(delay = this.pollIntervalMs) {
    if (!this.running) return;
    this._tickHandle = setTimeout(() => this._tick(), delay);
  }

  async _tick() {
    if (!this.running) return;

    // Phase 5 power gate: skip claims while blocked (idle timer not yet
    // expired, protected app running, on battery, etc). We still
    // heartbeat so the worker row doesn't go stale.
    if (typeof this.isAllowed === "function") {
      try {
        const allowed = await this.isAllowed();
        if (!allowed) {
          this._schedule();
          return;
        }
      } catch (err) {
        this.log(`[local-worker] isAllowed error: ${err.message}`);
        this._schedule();
        return;
      }
    }

    let job = null;
    try {
      const resp = await this._fetch("/api/jobs/claim", {
        method: "POST",
        body: {
          worker_id: this.workerId,
          kinds: this.kinds,
          gpu: this.gpu,
        },
      });
      job = resp && resp.job;
    } catch (err) {
      this.log(`[local-worker] claim error: ${err.message}`);
      this._schedule();
      return;
    }

    if (!job) {
      this._schedule();
      return;
    }

    this.current = job;
    const handler = this.handlerMap[job.kind];
    if (!handler) {
      const msg = `no handler registered for kind=${job.kind}`;
      this.log(`[local-worker] job ${job.id} ${msg}`);
      await this._safeFail(job.id, msg);
      this.current = null;
      this._schedule(50);
      return;
    }

    this.log(`[local-worker] ${this.workerId} running #${job.id} ${job.kind}`);
    const startedAt = Date.now();
    try {
      // The cloud-side jobs repo gave us a legit row but the handlers
      // expect real repo access via ctx.repos. In the remote-worker case
      // repo writes must round-trip through the cloud, so handlers that
      // need repo mutations should use the enqueue endpoint rather than
      // touching a local DB. For handlers that only read/transform
      // (image, audio, assemble) this is fine — they operate on files.
      const result = await handler(job, {
        workerId: this.workerId,
        remote: true,
        fetch: (path, opts) => this._fetch(path, opts),
      });
      await this._fetch(`/api/jobs/${job.id}/complete`, {
        method: "POST",
        body: {
          worker_id: this.workerId,
          result: truncateResult(result),
        },
      });
      this.log(`[local-worker] #${job.id} done in ${Date.now() - startedAt}ms`);
    } catch (err) {
      this.log(`[local-worker] #${job.id} ${job.kind} FAILED: ${err.message}`);
      await this._safeFail(
        job.id,
        err.message || String(err),
        (err && err.stack) || null,
      );
      if (this.onError) {
        try {
          await this.onError(err, job);
        } catch (handlerErr) {
          this.log(`[local-worker] onError threw: ${handlerErr.message}`);
        }
      }
    } finally {
      this.current = null;
      this._schedule(50);
    }
  }

  async _safeFail(jobId, errorMsg, stack) {
    try {
      await this._fetch(`/api/jobs/${jobId}/fail`, {
        method: "POST",
        body: {
          worker_id: this.workerId,
          error: errorMsg,
          log: stack ? String(stack).slice(-4000) : null,
        },
      });
    } catch (err) {
      this.log(`[local-worker] fail-write error: ${err.message}`);
    }
  }

  async _heartbeat() {
    if (!this.running) return;
    try {
      await this._fetch("/api/workers/heartbeat", {
        method: "POST",
        body: {
          id: this.workerId,
          status: this.current ? "busy" : "idle",
        },
      });
    } catch (err) {
      this.log(`[local-worker] worker heartbeat error: ${err.message}`);
    }
    if (!this.current) return;
    try {
      await this._fetch(`/api/jobs/${this.current.id}/heartbeat`, {
        method: "POST",
        body: { worker_id: this.workerId },
      });
    } catch (err) {
      this.log(
        `[local-worker] job #${this.current.id} heartbeat error: ${err.message}`,
      );
    }
  }
}

function parseCsv(s) {
  if (!s) return null;
  return String(s)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function truncateResult(result) {
  if (result === undefined || result === null) return null;
  try {
    const s = JSON.stringify(result);
    if (s.length > 8000) return { truncated: true, preview: s.slice(0, 8000) };
    return result;
  } catch {
    return { type: typeof result };
  }
}

// CLI: `node workers/local-worker.js`
if (require.main === module) {
  // Phase 5: attach the power/idle gate by default on Windows. Disable
  // with WORKER_IGNORE_POWER=1.
  let isAllowed = null;
  if (process.env.WORKER_IGNORE_POWER !== "1") {
    try {
      const { createGate } = require("../lib/power-gate");
      const cloud = (
        process.env.WORKER_CLOUD_URL || "http://127.0.0.1:3001"
      ).replace(/\/$/, "");
      const token = process.env.WORKER_TOKEN || process.env.API_TOKEN;
      const workerId =
        process.env.WORKER_ID || `local-${require("os").hostname()}`;
      const reporter = async (kind, payload) => {
        try {
          await fetch(`${cloud}/api/workers/event`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ id: workerId, kind, payload }),
          });
        } catch {
          /* tolerable: gate events are nice-to-have */
        }
      };
      isAllowed = createGate({ reporter });
    } catch (err) {
      console.error(
        `[local-worker] power gate disabled (load error): ${err.message}`,
      );
    }
  }

  const worker = new LocalWorker({ isAllowed });
  worker.start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
  const shutdown = async () => {
    console.log("\n[local-worker] shutting down…");
    await worker.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = { LocalWorker };
