# GREEN Autopilot Local AI Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local Ollama, VoxCPM and faster-whisper a durable, observable and cancellable production service with no unapproved cloud escape path.

**Architecture:** A SQLite-backed GPU queue serialises all GPU workloads. Fixed task policy maps each editorial task to Gemma 4B or 12B, while real probes and fenced job context control readiness and cancellation.

**Tech Stack:** Node.js 24 CommonJS, better-sqlite3, Ollama OpenAI-compatible API, VoxCPM 2, faster-whisper, Python, Node test runner

**Spec:** `docs/superpowers/specs/2026-08-14-pulse-gaming-green-autopilot-design.md`

## Global Constraints

- Requires the runtime foundation plan through job fencing and durable readiness.
- Production permits only `gemma3:4b`, `gemma3:12b`, VoxCPM 2 and `faster-whisper:base.en`.
- Do not run a 27B model alongside resident VoxCPM.
- Cloud AI and cloud TTS are denied in autonomous mode regardless of `.env`.
- Original attempt plus one bounded repair is the maximum creative-model attempt budget.
- AI output is never factual, rights, policy or publication authority.
- Every GPU operation is cancellable, hash-receipted and owned by a fenced job attempt.
- Keep external mutation disabled throughout this plan.

## File Structure

- `db/migrations/026_green_autopilot_gpu_queue.sql`: durable GPU work requests.
- `lib/repositories/gpu_work_requests.js`: queue ownership and fencing.
- `lib/local-ai/task-policy.js`: fixed task-to-model policy.
- `lib/services/gpu-work-coordinator.js`: sole GPU execution boundary.
- `lib/services/local-ai-readiness.js`: real Ollama, VoxCPM, ASR and GPU probes.
- `lib/job-handlers/local-ai.js`: editorial inference job handlers.
- `lib/job-handlers/media-ai.js`: narration and ASR handlers.
- `tools/local-ai-doctor.js` and `tools/gpu-queue-inspect.js`: read-only evidence.

---

### Task 1: Add the durable GPU queue

**Files:**
- Create: `db/migrations/026_green_autopilot_gpu_queue.sql`
- Create: `lib/repositories/gpu_work_requests.js`
- Create: `lib/repositories/local_ai_creative_attempts.js`
- Create: `tests/db/green-autopilot-gpu-queue-migration.test.js`
- Create: `tests/services/gpu-work-requests.test.js`
- Create: `tests/services/local-ai-creative-attempts.test.js`
- Modify: `lib/repositories/index.js`

**Interfaces:**
- Produces: `repos.gpuWorkRequests` with `enqueue`, `claimNext`, `heartbeat`, `complete`, `fail`, `cancel`, `markRecoveryPending` and `inspect`.
- Produces: `repos.localAiCreativeAttempts` with `reserveNext`, `complete`, `fail`, `countConsumed` and `listForStage`.

- [ ] **Step 1: Write failing queue tests**

```js
test("only one live GPU request can be leased", () => {
  const first = repo.enqueue(spec("a"));
  const second = repo.enqueue(spec("b"));
  assert.equal(repo.claimNext({ workerId: "gpu-1", now: NOW, leaseMs: 30000 }).id, first.id);
  assert.equal(repo.claimNext({ workerId: "gpu-2", now: NOW, leaseMs: 30000 }), null);
  repo.complete({ requestId: first.id, workerId: "gpu-1", leaseToken: firstLease(), resultHash: HASH });
  assert.equal(repo.claimNext({ workerId: "gpu-2", now: NOW, leaseMs: 30000 }).id, second.id);
});

test("expired ownership cannot be reclaimed before a verified settlement barrier", () => {
  const first = claimThenExpire();
  assert.equal(repo.claimNext({ workerId: "gpu-2", now: LATER, leaseMs: 30000 }), null);
  assert.equal(repo.get(first.id).status, "recovery_pending");
  assert.equal(repo.get(first.id).settlement_state, "pending");
  assert.throws(() => repo.complete({ requestId: first.id, workerId: "gpu-1", leaseToken: first.lease_token, resultHash: HASH }), /stale_gpu_lease/);
  assert.equal(repo.listClaimable().length, 0);
});

test("creative output attempts are capped durably at two per run and stage", () => {
  const first = repos.localAiCreativeAttempts.reserveNext({ runId: "run-1", stage: "editorial", taskId: "script_draft" });
  repos.localAiCreativeAttempts.fail({ attemptId: first.id, errorCode: "schema_invalid" });
  const second = repos.localAiCreativeAttempts.reserveNext({ runId: "run-1", stage: "editorial", taskId: "source_bound_rewrite" });
  repos.localAiCreativeAttempts.fail({ attemptId: second.id, errorCode: "claim_mismatch" });
  assert.throws(() => repos.localAiCreativeAttempts.reserveNext({ runId: "run-1", stage: "editorial", taskId: "source_bound_rewrite" }), /creative_attempt_budget_exhausted/);
  assert.equal(repos.localAiCreativeAttempts.countConsumed({ runId: "run-1", stage: "editorial" }), 2);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/db/green-autopilot-gpu-queue-migration.test.js tests/services/gpu-work-requests.test.js tests/services/local-ai-creative-attempts.test.js`

Expected: FAIL on missing migration and repository.

- [ ] **Step 3: Create migration 026**

```sql
CREATE TABLE gpu_work_requests (
  id TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  job_attempt INTEGER NOT NULL,
  worker_id TEXT,
  workload TEXT NOT NULL CHECK (workload IN ('ollama','voxcpm','faster_whisper','render')),
  memory_class TEXT NOT NULL CHECK (memory_class IN ('small','medium','large')),
  estimated_vram_mb INTEGER NOT NULL,
  timeout_ms INTEGER NOT NULL,
  cancellation_policy TEXT NOT NULL CHECK (cancellation_policy = 'abort_and_hold'),
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('queued','leased','recovery_pending','completed','failed','cancelled')),
  lease_token TEXT,
  fencing_token INTEGER NOT NULL DEFAULT 0,
  heartbeat_at TEXT,
  expires_at TEXT,
  orphaned_at TEXT,
  settlement_state TEXT NOT NULL DEFAULT 'not_required' CHECK (settlement_state IN ('not_required','pending','settled')),
  settlement_receipt_sha256 TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  result_hash TEXT,
  error_code TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_gpu_single_owned_or_unsettled ON gpu_work_requests((1)) WHERE status IN ('leased','recovery_pending');
CREATE TABLE gpu_work_recovery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  prior_fencing_token INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('WORKER_DEATH_FENCED','PROCESS_TREE_SETTLED','DEPENDENCY_IDLE','GPU_IDLE','GPU_OPERATION_SETTLED')),
  actor_component_id TEXT NOT NULL,
  actor_instance_id TEXT NOT NULL,
  receipt_sha256 TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(request_id, prior_fencing_token, event_type)
);
CREATE TRIGGER gpu_work_recovery_events_no_update BEFORE UPDATE ON gpu_work_recovery_events BEGIN SELECT RAISE(ABORT, 'immutable_gpu_work_recovery_events'); END;
CREATE TRIGGER gpu_work_recovery_events_no_delete BEFORE DELETE ON gpu_work_recovery_events BEGIN SELECT RAISE(ABORT, 'immutable_gpu_work_recovery_events'); END;
```

Also create immutable `local_ai_creative_attempts` keyed by run ID, stage ID and ordinal, with task ID, input hash, status, output hash/error code, job ID/claim token and timestamps. A database trigger limits ordinals to 1 or 2 and a unique index prevents replay from reserving another ordinal. `STARTED`, `COMPLETED` and `FAILED` all consume the attempt; delete/update is forbidden except the exact versioned terminal transition.

- [ ] **Step 4: Implement transactional claim and fencing**

`claimNext` must use one SQLite transaction. It converts expired ownership to `recovery_pending`, records `orphaned_at` and `settlement_state:'pending'`, then returns `null`; lease expiry alone never makes that request or another queued request claimable. A settled recovery is requeued only through the Task 2 closure-owned recovery capability, after which a new claim increments the fencing token. Every terminal write requires exact request ID, worker ID, lease token and fencing token. Task 1 deliberately leaves a recovery-pending row blocked until Task 2 supplies the independently verified settlement path.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/db/green-autopilot-gpu-queue-migration.test.js tests/services/gpu-work-requests.test.js tests/services/local-ai-creative-attempts.test.js`

Expected: PASS.

```powershell
git add db/migrations/026_green_autopilot_gpu_queue.sql lib/repositories/gpu_work_requests.js lib/repositories/local_ai_creative_attempts.js lib/repositories/index.js tests/db/green-autopilot-gpu-queue-migration.test.js tests/services/gpu-work-requests.test.js tests/services/local-ai-creative-attempts.test.js
git commit -m "feat: add durable local GPU queue"
```

### Task 2: Implement the cancellable GPU coordinator

**Files:**
- Modify: `db/migrations/026_green_autopilot_gpu_queue.sql`
- Create: `lib/services/gpu-work-coordinator.js`
- Create: `lib/services/gpu-work-recovery.js`
- Create: `lib/services/gpu-recovery-control.js`
- Create: `tests/services/gpu-work-coordinator.test.js`
- Create: `tests/services/gpu-work-recovery.test.js`
- Create: `tests/services/gpu-recovery-control.test.js`
- Create: `tests/services/jobs-runner-cancellation.test.js`
- Modify: `lib/repositories/gpu_work_requests.js`
- Modify: `lib/services/jobs-runner.js`
- Modify: `tools/windows/production-supervisor.ps1`
- Modify: `tests/services/gpu-work-requests.test.js`
- Modify: `tests/services/jobs-runner.test.js`
- Modify: `tests/ops/windows-production-services.test.js`

**Interfaces:**
- Produces: `createGpuWorkCoordinator({ repo, workerId, poll, now })`.
- Produces: `runWithGpuLease({ jobContext, workload, memoryClass, estimatedVramMb, timeoutMs, cancellationPolicy, signal, healthProbe, operation })`.
- Produces: `recoverOrphanedGpuWork({ requestId, deadWorkerReceipt, processTreeProbe, dependencyController, gpuIdleProbe, repo, now })`.
- Produces: `requestSupervisedGpuRecovery({ requestId, priorFence, observerContext, repos, now })` and `finaliseSupervisedGpuRecovery({ requestId, supervisorReceipt, repos, now })`; ordinary media workers can request and finalise verified evidence but cannot terminate cross-SID processes or control dependencies.

- [ ] **Step 1: Write failure, cancellation and receipt tests**

```js
test("timeout aborts operation before the queue row fails", async () => {
  const events = [];
  await assert.rejects(() => coordinator.runWithGpuLease({
    ...validSpec(),
    timeoutMs: 5,
    operation: ({ signal }) => new Promise((resolve) => signal.addEventListener("abort", () => { events.push("aborted"); resolve(); }))
  }), /gpu_operation_timed_out/);
  assert.deepEqual(events, ["aborted"]);
  assert.equal(repo.get(REQUEST).status, "failed");
});

test("a long operation renews its lease and remains the sole GPU owner", async () => {
  const first = coordinator.runWithGpuLease(longOperationFixture({ durationMs: LEASE_TTL_MS * 3 }));
  await advanceClock(LEASE_TTL_MS * 2);
  assert.equal(repo.get(REQUEST).heartbeat_count >= 2, true);
  await assert.rejects(() => secondCoordinator.runWithGpuLease(validSpec()), /gpu_lease_unavailable/);
  await finishLongOperation();
  assert.equal((await first).receipt.status, "completed");
});

test("heartbeat or fencing loss aborts and settles before a reclaim can execute", async () => {
  const events = [];
  const stale = coordinator.runWithGpuLease(operationFixture({ onAbort: async () => { events.push("aborted"); await settleChild(); events.push("settled"); } }));
  loseGpuFence(REQUEST);
  await assert.rejects(() => stale, /gpu_lease_lost/);
  const reclaimed = await secondCoordinator.runWithGpuLease(operationFixture({ onStart: () => events.push("reclaimed") }));
  assert.deepEqual(events, ["aborted", "settled", "reclaimed"]);
  assert.equal(reclaimed.receipt.status, "completed");
  assert.throws(() => repo.complete(staleCompletion()), /stale_gpu_lease_token/);
});

test("a hard-killed GPU worker cannot be reclaimed until the supervised operation is proved idle", async () => {
  const orphan = hardKilledGpuWorkerFixture({ childStillRunning: true });
  await assert.rejects(() => recoverOrphanedGpuWork(orphan), /gpu_operation_not_settled/);
  assert.equal(orphan.secondWorkloadStartCount, 0);
  orphan.recordFencedWorkerDeath();
  await orphan.stopExactProcessTreeOrRestartDependency();
  orphan.setGpuAndDependencyIdle(true);
  const recovered = await recoverOrphanedGpuWork(orphan);
  assert.equal(recovered.barrier, "GPU_OPERATION_SETTLED");
  assert.equal((await orphan.claimAndRunSecond()).status, "completed");
  assert.equal(orphan.maxConcurrentGpuOperations, 1);
});

test("the supervisor emits the fenced death receipt before recovery is enqueued", async () => {
  const result = await superviseHardKilledGpuWorker(supervisorFixture());
  assert.deepEqual(result.events.slice(0, 2), ["WORKER_DEATH_FENCED", "gpu_queue_reap:enqueued"]);
  assert.equal(result.receipt.prior_fencing_token, DEAD_FENCE);
  assert.equal(result.receipt.surviving_child_count, 0);
});

test("media recovery requests cannot mint or perform privileged settlement", async () => {
  const requested = await requestSupervisedGpuRecovery(mediaObserverFixture());
  assert.equal(requested.state, "SUPERVISOR_RECOVERY_REQUESTED");
  assert.equal(requested.privileged_action_count, 0);
  await assert.rejects(() => finaliseSupervisedGpuRecovery({ ...requested, supervisorReceipt: forgedSupervisorReceipt() }), /gpu_supervisor_receipt_untrusted/);
  const supervisorReceipt = await productionSupervisor.performGpuRecovery(requested);
  const settled = await finaliseSupervisedGpuRecovery({ ...requested, supervisorReceipt });
  assert.equal(settled.barrier, "GPU_OPERATION_SETTLED");
  await assert.rejects(() => finaliseSupervisedGpuRecovery({ ...requested, supervisorReceipt }), /gpu_supervisor_receipt_consumed/);
});

test("GPU recovery control rejects wrong SID, replay and a changed request hash", async () => {
  for (const receipt of [wrongSupervisorSidReceipt(), replayedSupervisorReceipt(), changedRequestReceipt()]) {
    await assert.rejects(() => finaliseSupervisedGpuRecovery({ requestId: REQUEST, supervisorReceipt: receipt }), /gpu_supervisor_receipt_/);
  }
});

test("external job cancellation aborts and settles the exact child before terminal state", async () => {
  const fixture = externallyCancelledOperation();
  const pending = coordinator.runWithGpuLease(fixture.spec);
  fixture.abortJob();
  await assert.rejects(() => pending, /job_cancelled/);
  assert.deepEqual(fixture.events, ["operation_aborted", "child_exited", "GPU_OPERATION_SETTLED", "request_failed"]);
  assert.equal(fixture.maxConcurrentGpuOperations, 1);
});

test("raw callers cannot forge the GPU settlement barrier", async () => {
  const orphan = hardKilledGpuWorkerFixture({ childStillRunning: false, gpuAndDependencyIdle: true });
  assert.throws(() => orphan.repo.recordSettlementBarrier({ requestId: orphan.requestId, receiptSha256: SETTLEMENT_SHA }), /trusted_gpu_recovery_handle_required/);
  const recovered = await recoverOrphanedGpuWork(orphan);
  assert.equal(recovered.barrier, "GPU_OPERATION_SETTLED");
  assert.ok(recovered.settlement_receipt_sha256);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/gpu-work-requests.test.js tests/services/gpu-work-coordinator.test.js tests/services/gpu-work-recovery.test.js tests/services/gpu-recovery-control.test.js tests/services/jobs-runner.test.js`

Expected: FAIL on missing coordinator.

- [ ] **Step 3: Implement coordinator ownership**

```js
async function runWithGpuLease(spec) {
  const request = repo.enqueue(toRow(spec));
  const lease = await waitForOwnedLease(request.id, spec.signal);
  const controller = new AbortController();
  const unlinkExternalAbort = forwardAbortSignal(spec.signal, controller);
  const heartbeat = startLeaseHeartbeat({
    intervalMs: lease.ttl_ms / 3,
    heartbeat: () => repo.heartbeat({ requestId: request.id, workerId, leaseToken: lease.lease_token, expectedFence: lease.fencing_token }),
    onLost: (error) => controller.abort(new GpuLeaseLostError(error))
  });
  try {
    await spec.healthProbe({ signal: controller.signal });
    const value = await withDeadline(() => spec.operation({ signal: controller.signal }), spec.timeoutMs, controller);
    heartbeat.assertOwned();
    const resultHash = sha256(canonicalJson(value));
    repo.complete({ requestId: request.id, workerId, leaseToken: lease.lease_token, expectedFence: lease.fencing_token, resultHash });
    return { value, receipt: buildReceipt(request, lease, resultHash) };
  } catch (error) {
    controller.abort(error);
    await waitForOperationSettlement();
    repo.fail({ requestId: request.id, workerId, leaseToken: lease.lease_token, expectedFence: lease.fencing_token, errorCode: safeCode(error), retryable: false });
    throw error;
  } finally {
    await heartbeat.stop();
    unlinkExternalAbort();
  }
}
```

`forwardAbortSignal` registers a one-way listener from the external job/shutdown signal to `controller.abort(reason)` and removes it in `finally`; the health probe and operation receive only `controller.signal`, so caller cancellation, timeout and lease loss all reach the same child-settlement path. The heartbeat uses the generic renewable lease helper and an expected fencing token. It starts before the health probe and runs throughout Ollama, VoxCPM, faster-whisper or render execution. An expired lease is never sufficient to reclaim GPU ownership. Graceful loss aborts the operation, terminates and awaits its exact child or in-process promise, then records `GPU_OPERATION_SETTLED`.

Hard-death recovery uses a durable least-privilege handshake. The ordinary `media` worker's `gpu_queue_reap` handler may only observe an orphan and transactionally create one `SUPERVISOR_RECOVERY_REQUESTED` row keyed by request ID, prior fence and canonical request hash. It has no process termination, service-control or cross-SID capability. The SYSTEM production supervisor polls only that fixed table through `gpu-recovery-control`, verifies the requesting lane identity and fenced-death evidence, then is the sole component permitted to terminate the exact surviving process tree or restart the bound Ollama/VoxCPM/ASR dependency. It appends immutable `WORKER_DEATH_FENCED`, process-tree, dependency-idle and GPU-idle events and writes a no-overwrite receipt signed by its machine-bound control key, including supervisor SID/instance, request hash, prior fence and before/after process identities. It cannot start content work or claim the GPU request.

The media handler may then call `finaliseSupervisedGpuRecovery`, which accepts only that exact verified receipt, consumes it once and gives `recoverOrphanedGpuWork` a closure-owned settlement handle. Raw JSON, a wrong SID, changed hash, stale fence, replay or a direct repository call is rejected. That one transaction verifies the complete event chain, binds the final recovery receipt SHA and prior fence, appends `GPU_OPERATION_SETTLED`, marks the row settled and requeues it. `claimNext` can issue a new lease only after that barrier exists. A failed or indeterminate idle probe keeps the request blocked and readiness RED, so a new owner can never overlap an orphaned operation. Terminal writes require the same owner, lease token and fence, so a stale worker can never complete or fail a reclaimed request. The supervisor IPC/control table and receipt directory ACLs give the media SID append-request/read-receipt access only; spoof, replay and cross-SID tests prove it cannot perform the privileged half.

- [ ] **Step 4: Pass coordinator through fenced job context**

Every handler context contains:

```js
{
  workerId,
  jobId: job.id,
  attempt: job.attempt_count,
  claimToken: job.claim_token,
  signal,
  deadlineAt,
  runWithGpuLease
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/gpu-work-requests.test.js tests/services/gpu-work-coordinator.test.js tests/services/gpu-work-recovery.test.js tests/services/gpu-recovery-control.test.js tests/services/jobs-runner.test.js tests/services/jobs-runner-cancellation.test.js tests/ops/windows-production-services.test.js`

Expected: PASS.

```powershell
git add db/migrations/026_green_autopilot_gpu_queue.sql lib/repositories/gpu_work_requests.js lib/services/gpu-work-coordinator.js lib/services/gpu-work-recovery.js lib/services/gpu-recovery-control.js lib/services/jobs-runner.js tools/windows/production-supervisor.ps1 tests/services/gpu-work-requests.test.js tests/services/gpu-work-coordinator.test.js tests/services/gpu-work-recovery.test.js tests/services/gpu-recovery-control.test.js tests/services/jobs-runner.test.js tests/services/jobs-runner-cancellation.test.js tests/ops/windows-production-services.test.js
git commit -m "feat: coordinate cancellable GPU work"
```

### Task 3: Replace inferred model routing with fixed task policy

**Files:**
- Create: `lib/local-ai/task-policy.js`
- Create: `tests/services/local-ai-task-policy.test.js`
- Create: `tests/services/local-ai-creative-budget.integration.test.js`
- Create: `tests/services/local-ai-cloud-deny.test.js`
- Modify: `lib/llm-client.js`
- Modify: `lib/llm-key.js`
- Modify: `tests/services/llm-client.test.js`
- Modify: `tests/services/llm-key.test.js`

**Interfaces:**
- Produces: `resolveTaskPolicy(taskId, { mode })`.
- Produces: `runLlmTask({ taskId, system, messages, schema, jobContext, signal })`.

- [ ] **Step 1: Write exact routing and cloud-deny tests**

```js
test("script drafting and review use 12B while extraction uses 4B", () => {
  assert.equal(resolveTaskPolicy("script_draft", { mode: "production" }).modelId, "gemma3:12b");
  assert.equal(resolveTaskPolicy("editorial_review", { mode: "production" }).modelId, "gemma3:12b");
  assert.equal(resolveTaskPolicy("entity_extraction", { mode: "production" }).modelId, "gemma3:4b");
  assert.equal(resolveTaskPolicy("topic_clustering", { mode: "production" }).modelId, "gemma3:4b");
});

test("production rejects caller model overrides and cloud provider", async () => {
  assert.throws(() => resolveTaskPolicy("script_draft", { mode: "production", model: "qwen3.5:27b" }), /caller_model_override_forbidden/);
  await assert.rejects(() => runLlmTask(fixture({ provider: "anthropic" })), /cloud_ai_not_approved/);
});

test("draft plus repair share two durable output attempts across worker restart", async () => {
  const first = await runLlmTask(creativeFixture({ taskId: "script_draft", schemaResult: "RED" }));
  assert.equal(first.attempt.ordinal, 1);
  await restartWorker();
  const second = await runLlmTask(creativeFixture({ taskId: "source_bound_rewrite", sourceBoundResult: "RED" }));
  assert.equal(second.attempt.ordinal, 2);
  await assert.rejects(() => runLlmTask(creativeFixture({ taskId: "source_bound_rewrite" })), /creative_attempt_budget_exhausted/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/local-ai-task-policy.test.js tests/services/local-ai-creative-budget.integration.test.js tests/services/local-ai-cloud-deny.test.js tests/services/llm-client.test.js tests/services/llm-key.test.js`

Expected: FAIL because routing currently derives from legacy model names.

- [ ] **Step 3: Define the production policy**

```js
const TASKS = Object.freeze({
  entity_extraction: fast("json", 4096),
  title_variants: fast("json", 4096),
  source_summary: fast("json", 4096),
  topic_clustering: fast("json", 4096),
  analytics_digest: fast("text", 4096),
  operator_question: fast("text", 4096),
  script_draft: strong("json", 8192),
  editorial_review: strong("json", 8192),
  source_bound_rewrite: strong("json", 8192),
  creative_critique: strong("json", 8192)
});
```

Every task call has `maxAttempts:1`, `cancellationPolicy:"abort_and_hold"` and a fixed VRAM estimate. Output-producing tasks `script_draft` and `source_bound_rewrite` additionally require a durable attempt reservation for the exact run/stage/input root. The stage ceiling is two total output-producing attempts: original draft and, only after a failed deterministic validation, one source-bound repair. Schema failure, model failure and rejected output all consume their ordinal. Job retry or worker restart reloads the ledger and cannot reset it. `editorial_review` and `creative_critique` are non-output assessments, cannot return replacement public copy and each is separately capped at one call. Unknown task IDs fail.

- [ ] **Step 4: Implement `runLlmTask` receipts**

The receipt binds provider `ollama`, model ID and digest, task ID, prompt hash, input hash, output hash, durable creative-attempt ID/ordinal when applicable, start and completion times. `runLlmTask` reserves before model execution and terminally records the same claim token after deterministic validation; caller-supplied attempt numbers are forbidden. `LLM_PROVIDER=anthropic` cannot override production policy.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/local-ai-task-policy.test.js tests/services/local-ai-creative-budget.integration.test.js tests/services/local-ai-cloud-deny.test.js tests/services/llm-client.test.js tests/services/llm-key.test.js`

Expected: PASS.

```powershell
git add lib/local-ai/task-policy.js lib/llm-client.js lib/llm-key.js tests/services/local-ai-task-policy.test.js tests/services/local-ai-creative-budget.integration.test.js tests/services/local-ai-cloud-deny.test.js tests/services/llm-client.test.js tests/services/llm-key.test.js
git commit -m "feat: enforce local AI task policy"
```

### Task 4: Add real local-AI readiness probes

**Files:**
- Create: `lib/services/local-ai-readiness.js`
- Create: `lib/job-handlers/local-ai-probe.js`
- Create: `tools/local-ai-doctor.js`
- Create: `tools/gpu-queue-inspect.js`
- Create: `tests/services/local-ai-readiness.test.js`
- Create: `tests/services/local-ai-probe-handler.test.js`
- Create: `tests/services/ollama-health.test.js`
- Modify: `config/runtime-dependencies.json`
- Modify: `lib/runtime/readiness.js`
- Modify: `lib/studio/local-gpu-pressure.js`
- Modify: `tests/ops/windows-production-services.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `probeLocalAiStack({ requiredModels, requiredVoice, requiredAsr, mode, deps, runWithGpuLease }) -> report`.
- Produces: `handleLocalAiProbe(job, ctx) -> immutableProbeReceipt`.

- [ ] **Step 1: Write failing degraded-service tests**

```js
test("configured but non-responsive Ollama is RED", async () => {
  const report = await probeLocalAiStack(fixture({ ollamaTags: new Error("ECONNREFUSED") }));
  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("ollama_unreachable"));
});

test("missing nvidia-smi is RED in production", async () => {
  const report = await probeLocalAiStack(fixture({ nvidiaSmi: null, mode: "production" }));
  assert.ok(report.blockers.includes("gpu_probe_unavailable"));
});

test("model and ASR smokes use the renewable GPU queue and readiness only reads their receipts", async () => {
  const isolated = localAiProbeFixture({ holdWorkload: "render" });
  await assert.rejects(() => handleLocalAiProbe(isolated.job, isolated.ctx), /gpu_lease_unavailable/);
  assert.equal(isolated.directGpuProbeCount, 0);
  const stale = await buildReadinessSnapshot(isolated.readinessFixture({ probeAgeMs: PROBE_MAX_AGE_MS + 1 }));
  assert.ok(stale.blockers.includes("local_ai_probe_stale"));
  assert.equal(stale.liveInferenceProbeCount, 0);
});

test("the faster-whisper runtime identity is exact and authority-bound", () => {
  const dependency = loadRuntimeDependencies().find((row) => row.id === "faster-whisper");
  assert.equal(dependency.kind, "toolchain");
  for (const field of ["python_executable_sha256", "aligner_tool_sha256", "faster_whisper_version", "ctranslate2_version", "cuda_runtime", "model_artifact_sha256"]) {
    assert.match(String(dependency[field]), /\S+/);
  }
  assert.equal(authorityModelSetFixture().faster_whisper_dependency_sha256, canonicalSha(dependency));
});

test("ASR-only identity drift makes readiness RED and requalification-suspends active authority", async () => {
  const drifted = await buildReadinessSnapshot(readinessFixture({ fasterWhisperVersion: "drifted" }));
  assert.ok(drifted.blockers.includes("faster_whisper_identity_drift"));
  const observed = await observePublicationCriticalHealth({ readinessSnapshot: drifted, repos, now: NOW });
  assert.equal(observed.authority.suspension_reason_class, "REQUALIFICATION_REQUIRED");
  assert.equal(observed.authority.suspension_reason_code, "REQUIRED_HEALTH_FAILURE:faster_whisper_identity");
  assert.equal(observed.killSwitch.state, "ENGAGED");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/local-ai-readiness.test.js tests/services/local-ai-probe-handler.test.js tests/services/ollama-health.test.js`

Expected: FAIL on missing readiness service.

- [ ] **Step 3: Implement bounded real probes**

`handleLocalAiProbe` is the sole production owner of active model, narration and ASR smokes. It probes `/api/tags` without the GPU, then acquires a separate renewable `gpu-work-coordinator` lease for each deterministic Ollama model inference, VoxCPM voice smoke and faster-whisper CUDA health operation. It uses the fixed job claim/fence, cancellation path and hard-death recovery barrier from Task 2. A probe cannot overlap rendering or another model/narration/ASR workload. It persists one canonical, expiry-bound receipt containing both approved model digests, the VoxCPM service and approved voice/reference fingerprint, faster-whisper result, `nvidia-smi`, lease receipts, queue owner, oldest age and expired rows. Bind the exact Ollama and VoxCPM service names, executable/config hashes, accounts, model digests, voice fingerprint and probe contracts into `config/runtime-dependencies.json`. Bind ASR just as strictly: the confined Python executable identity, `tools/local_whisper_word_align.py` SHA-256, faster-whisper and CTranslate2 package versions, CUDA/cuDNN runtime identity, `base.en` model artefact digest and smoke-transcript contract all enter the dependency receipt and the standing authority's `model_set` hash. Any ASR-only drift makes readiness RED and an active authority requalification-suspended.

```js
return {
  schema_version: 1,
  ok: blockers.length === 0,
  checked_at: now.toISOString(),
  ollama, narration, asr, gpu, queue,
  blockers
};
```

- [ ] **Step 4: Wire readiness and scripts**

```json
"ops:local-ai-doctor": "node tools/local-ai-doctor.js",
"ops:gpu-queue:inspect": "node tools/gpu-queue-inspect.js"
```

Both tools require `--database-mode fixture|production` before reading the migration-026 GPU queue. They use shared schema preflight and production returns structured `PENDING` before an absent-table query. The doctor may enqueue or inspect the fixed probe job only in its explicit operator mode; it never runs an inference directly. Canonical readiness is synchronous and read-only: it consumes the hash-bound durable probe receipt, rejects stale or incomplete evidence and never calls Ollama, VoxCPM, faster-whisper or the GPU itself.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/local-ai-readiness.test.js tests/services/local-ai-probe-handler.test.js tests/services/ollama-health.test.js tests/services/runtime-readiness.test.js tests/services/local-gpu-pressure.test.js tests/ops/windows-production-services.test.js`

Expected: PASS.

```powershell
git add config/runtime-dependencies.json lib/services/local-ai-readiness.js lib/job-handlers/local-ai-probe.js tools/local-ai-doctor.js tools/gpu-queue-inspect.js lib/runtime/readiness.js lib/studio/local-gpu-pressure.js package.json tests/services/local-ai-readiness.test.js tests/services/local-ai-probe-handler.test.js tests/services/ollama-health.test.js tests/ops/windows-production-services.test.js
git commit -m "feat: probe the local AI production stack"
```

### Task 5: Convert editorial callers and deterministic fallback semantics

**Files:**
- Modify: `processor.js`
- Modify: `ab_titles.js`
- Modify: `entities.js`
- Modify: `competitor_monitor.js`
- Modify: `engagement.js`
- Modify: `blog/generator.js`
- Modify: `weekly_compile.js`
- Modify: `lib/intelligence/overnight-workshop.js`
- Modify: `lib/studio/v2/story-package.js`
- Modify: `tools/studio-v2-analytics-loop.js`
- Create: `tests/services/local-ai-caller-routing.test.js`
- Create: `tests/services/local-ai-deterministic-fallback.test.js`
- Create: `tests/ops/studio-v2-analytics-loop-cli.test.js`

**Interfaces:**
- Consumes: `runLlmTask()` and fixed task IDs from Task 3.
- Produces: source-bound fallback receipts with no invented score.
- Produces: `tools/studio-v2-analytics-loop.js --database-mode fixture|production`, with shared preflight before any SQLite query.

- [ ] **Step 1: Write caller and fallback tests**

```js
test("processor uses strong draft and one repair", async () => {
  const calls = [];
  await processStories(fixtureStories(), { runLlmTask: capture(calls), creativeAttemptRepo: durableAttemptFixture() });
  assert.deepEqual(calls.map((call) => call.taskId), ["script_draft", "source_bound_rewrite"]);
  assert.deepEqual(calls.map((call) => call.creativeAttemptOrdinal), [1, 2]);
});

test("deterministic fallback never fabricates quality score 7", () => {
  const fallback = buildDeterministicScriptFallback(sourceFixture());
  assert.equal(fallback.qualityScore, null);
  assert.equal(fallback.provenance, "deterministic_source_bound_fallback");
});

test("analytics loop returns PENDING before querying an unapplied production schema", async () => {
  const result = await runAnalyticsLoopCli(cliFixture({ databaseMode: "production", appliedThrough: 24, requiredMigrations: [25, 26] }));
  assert.equal(result.verdict, "PENDING");
  assert.equal(result.analyticsQueryCount, 0);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/local-ai-caller-routing.test.js tests/services/local-ai-deterministic-fallback.test.js tests/ops/studio-v2-analytics-loop-cli.test.js`

Expected: FAIL because callers still pass legacy Claude names and processor defaults to three attempts.

- [ ] **Step 3: Convert every listed caller**

Use 4B task IDs for extraction, titles, clustering, analytics and operator questions. Use 12B task IDs for scripts, editorial review, rewrites and critique. Pass `jobContext` and `signal` on every call. Remove arbitrary caller model and attempt-count fields. `processor.js` reserves ordinal 1 for `script_draft`; it may reserve ordinal 2 for `source_bound_rewrite` only after the first receipt plus deterministic RED validation are persisted. A failed second attempt transitions to review/repair and never calls a third time. Restart reloads the durable attempt ledger before selecting a task.

`tools/studio-v2-analytics-loop.js` requires `--database-mode fixture|production` and calls `preflightAutopilotDatabase` for migrations 025 and 026 before constructing any analytics statement. Fixture mode uses the migrated temporary database. Production mode returns canonical `PENDING` before an absent-table query. It accepts no caller database path and is not a scheduler or publication entry point.

- [ ] **Step 4: Fix fallback evidence**

A deterministic fallback records `qualityScore:null`, exact source hashes and its fallback reason. It proceeds only through the normal deterministic gates. Failure to meet them yields `AMBER_REVIEW` or `RED_REPAIR`.

- [ ] **Step 5: Run focused regression and commit**

Run: `node --test tests/services/local-ai-caller-routing.test.js tests/services/local-ai-deterministic-fallback.test.js tests/ops/studio-v2-analytics-loop-cli.test.js tests/services/source-bound-script-writer.test.js tests/services/script-lint.test.js tests/services/script-coherence-qa.test.js tests/services/llm-client.test.js`

Expected: PASS.

```powershell
git add processor.js ab_titles.js entities.js competitor_monitor.js engagement.js blog/generator.js weekly_compile.js lib/intelligence/overnight-workshop.js lib/studio/v2/story-package.js tools/studio-v2-analytics-loop.js tests/services/local-ai-caller-routing.test.js tests/services/local-ai-deterministic-fallback.test.js tests/ops/studio-v2-analytics-loop-cli.test.js
git commit -m "refactor: route editorial work through local AI policy"
```

### Task 6: Put VoxCPM and faster-whisper behind the coordinator

**Files:**
- Create: `lib/job-handlers/media-ai.js`
- Create: `tests/services/voxcpm-autonomous-provider.test.js`
- Create: `tests/services/faster-whisper-gpu-queue.test.js`
- Modify: `audio.js`
- Modify: `lib/local-whisper-word-aligner.js`
- Modify: `tools/local_whisper_word_align.py`
- Modify: `lib/goal-audio-timestamp-materializer.js`
- Modify: `tools/goal-audio-timestamp-materializer.js`
- Modify: `lib/ops/local-tts-batch-recovery.js`

**Interfaces:**
- Produces: `handleNarrationGenerate(job, ctx)` and `handleAsrVerify(job, ctx)`.

- [ ] **Step 1: Write provider and coordination tests**

```js
test("autonomous narration rejects every non-VoxCPM provider before network", async () => {
  await assert.rejects(() => generateTtsForStory(story, { mode: "autonomous", provider: "elevenlabs", fetchImpl: failIfCalled }), /autonomous_tts_provider_forbidden/);
});

test("ASR acquires faster-whisper queue lease and honours cancellation", async () => {
  const calls = [];
  await alignWords(audio, { mode: "production", runWithGpuLease: capture(calls), signal: AbortSignal.timeout(1000) });
  assert.equal(calls[0].workload, "faster_whisper");
  assert.equal(calls[0].model, "base.en");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/voxcpm-autonomous-provider.test.js tests/services/faster-whisper-gpu-queue.test.js tests/services/local-whisper-word-aligner.test.js`

Expected: FAIL because cloud and direct CUDA paths remain reachable.

- [ ] **Step 3: Enforce autonomous provider policy**

`audio.js` requires an execution mode. Autonomous mode accepts only `provider:"local"`, `engine:"voxcpm2"` and the approved voice/reference fingerprint. Remove Voicebox and ElevenLabs fallback from that mode before any transport is constructed.

- [ ] **Step 4: Add structured faster-whisper health and cancellation**

The Python tool supports `--health --model base.en --device cuda` and returns JSON with backend, version, CUDA, model and smoke transcript. Node passes an abort signal, terminates the exact child process and awaits exit. One explicit CPU fallback is allowed only after releasing the GPU lease and recording `cpu_fallback:true`.

- [ ] **Step 5: Persist audio-stage identity**

Before and after any trim, write exact audio SHA-256, bytes, sample rate, frame count and stage status. A restart rejects partial stage evidence. Use the approved model plus one repair model only.

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/services/voxcpm-autonomous-provider.test.js tests/services/faster-whisper-gpu-queue.test.js tests/services/local-whisper-word-aligner.test.js tests/services/goal-audio-timestamp-materializer.test.js tests/services/audio-local-tts-retry.test.js`

Expected: PASS.

```powershell
git add lib/job-handlers/media-ai.js audio.js lib/local-whisper-word-aligner.js tools/local_whisper_word_align.py lib/goal-audio-timestamp-materializer.js tools/goal-audio-timestamp-materializer.js lib/ops/local-tts-batch-recovery.js tests/services/voxcpm-autonomous-provider.test.js tests/services/faster-whisper-gpu-queue.test.js
git commit -m "feat: govern local narration and transcription"
```

### Task 7: Split local-AI jobs from monolithic production

**Files:**
- Create: `lib/job-handlers/local-ai.js`
- Create: `tests/services/local-ai-content-worker.integration.test.js`
- Modify: `docs/local-llm-runbook.md`
- Modify: `config/runtime-lanes.json`
- Modify: `lib/job-handlers.js`
- Modify: `tools/runtime-editorial-worker.js`
- Modify: `tools/runtime-media-worker.js`
- Modify: `tools/local-sqlite-content-worker.js`
- Modify: `tools/local-live-content-workers.ps1`
- Modify: `lib/bootstrap-queue.js`
- Modify: `lib/scheduler.js`
- Modify: `package.json`
- Modify: `tests/ops/windows-production-services.test.js`

**Interfaces:**
- Produces fixed queue job kinds: `autopilot_editorial`, `autopilot_narration`, `operator_question`, `local_ai_probe` and `gpu_queue_reap`. Draft, review, narration generation and ASR verification remain fixed task/substage IDs inside those handlers, not caller-selectable queue kinds.
- Removes monolithic `produce` from the autonomous schedule profile.

- [ ] **Step 1: Write the failing worker-capability test**

```js
test("autonomous editorial and media lanes claim only fixed granular kinds", () => {
  const localKinds = new Set(["autopilot_editorial", "autopilot_narration", "operator_question", "local_ai_probe", "gpu_queue_reap"]);
  assert.deepEqual(buildLane("editorial").kinds.filter((kind) => localKinds.has(kind)), ["autopilot_editorial", "operator_question"]);
  assert.deepEqual(buildLane("media").kinds.filter((kind) => localKinds.has(kind)), ["autopilot_narration", "local_ai_probe", "gpu_queue_reap"]);
  assert.equal(selectAutonomousSchedules().some((row) => row.kind === "produce"), false);
});

test("probe and orphan-recovery maintenance have fixed owners and recurring liveness", () => {
  const schedules = selectAutonomousSchedules();
  assert.deepEqual(schedules.find((row) => row.kind === "local_ai_probe").cron, "*/10 * * * *");
  assert.deepEqual(schedules.find((row) => row.kind === "gpu_queue_reap").cron, "* * * * *");
  assert.equal(buildLane("media").kinds.includes("local_ai_probe"), true);
  assert.equal(buildLane("media").kinds.includes("gpu_queue_reap"), true);
  assert.equal(bootstrapMaintenanceKinds().includes("gpu_queue_reap"), true);
});

test("operator questions produce one generic advisory result across restart", async () => {
  const first = await handleOperatorQuestion(operatorQuestionFixture({ commandId: "cmd-7" }));
  await restartEditorialWorker();
  const replay = await handleOperatorQuestion(operatorQuestionFixture({ commandId: "cmd-7" }));
  assert.equal(replay.receiptSha256, first.receiptSha256);
  assert.equal(advisoryResultsFor("operator_question:cmd-7").length, 1);
  assert.equal(replay.advisory_only, true);
  assert.equal(controlMutationCount(), 0);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/local-ai-content-worker.integration.test.js tests/services/local-sqlite-content-worker.test.js tests/services/job-handlers-produce-child.test.js`

Expected: FAIL because the scheduler still invokes monolithic `run.js produce`.

- [ ] **Step 3: Register fixed handlers and capabilities**

Content workers cannot accept caller-selected kinds. Bind `autopilot_editorial` and `operator_question` only to `tools/runtime-editorial-worker.js`. The editorial handler uses the fixed task policy internally for `script_draft`, `editorial_review`, `source_bound_rewrite` and `operator_question`; those task IDs are never standalone queue payload authority. A completed operator-question receipt is advisory and keyed by the immutable originating command/event ID. It persists one generic local-AI advisory result through the ordinary job/evidence store, so restart reuses the key and cannot mutate controls. This plan deliberately has no dependency on migration 029 or the Discord outbox; Discord Task 4 later consumes the generic completed result and maps it transactionally to one stable-key outbox item. Bind `autopilot_narration`, `local_ai_probe` and `gpu_queue_reap` only to the fixed `media` lane in `config/runtime-lanes.json`. Later production-plan tasks may add non-local-AI kinds to these lanes, so the local test asserts this owned subset and the final conveyor test asserts the complete one-owner table. The probe handler uses the same GPU coordinator as normal work and writes freshness-bound receipts; readiness never performs it inline. The scheduler enqueues `local_ai_probe` every ten minutes with one active idempotency key per occurrence and `gpu_queue_reap` every minute. Bootstrap also enqueues one idempotent `gpu_queue_reap` before readiness so a recovery-pending row cannot strand the lane after restart. The reap handler never converts expiry directly into ownership: it invokes only the supervised Task 2 recovery flow, remains blocked without the signed worker-death/settlement evidence and records a P1 readiness blocker when recovery cannot be proved. `handleProduce` remains manual compatibility code and is excluded from the approved schedule profile. Bootstrap derives required probes from lane capabilities rather than a `gpu` boolean.

- [ ] **Step 4: Remove competing owners**

`workers/local-worker.js` is never launched by production scripts. `INFER_ALLOW_FAILED_START` cannot make a production lane healthy. Remove the file-lease and host-file narration locks after the durable job and GPU leases cover the same boundary.

- [ ] **Step 5: Run the local-AI plan gate**

Run:

```powershell
node --test tests/services/gpu-work-requests.test.js tests/services/gpu-work-coordinator.test.js tests/services/local-ai-task-policy.test.js tests/services/local-ai-readiness.test.js tests/services/local-ai-caller-routing.test.js tests/services/voxcpm-autonomous-provider.test.js tests/services/faster-whisper-gpu-queue.test.js tests/services/local-ai-content-worker.integration.test.js tests/services/local-sqlite-content-worker.test.js tests/services/job-handlers-produce-child.test.js tests/services/bootstrap-queue.test.js tests/services/stabilisation-scheduler-profile.test.js tests/ops/windows-production-services.test.js
npm run ops:local-ai-doctor -- --database-mode fixture
npm run ops:gpu-queue:inspect -- --database-mode fixture
```

Expected: tests PASS. Doctors produce read-only GREEN evidence on the production-capable host.

- [ ] **Step 6: Update the runbook and commit**

Document fixed task routing, local-only failure behaviour, queue inspection and real probes in `docs/local-llm-runbook.md`.

```powershell
git add config/runtime-lanes.json lib/job-handlers/local-ai.js lib/job-handlers.js tools/runtime-editorial-worker.js tools/runtime-media-worker.js tools/local-sqlite-content-worker.js tools/local-live-content-workers.ps1 lib/bootstrap-queue.js lib/scheduler.js package.json docs/local-llm-runbook.md tests/services/local-ai-content-worker.integration.test.js tests/ops/windows-production-services.test.js
git commit -m "feat: split autonomous local AI workers"
```
