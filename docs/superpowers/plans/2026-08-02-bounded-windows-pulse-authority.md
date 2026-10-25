# Bounded Windows Pulse Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the open-ended workstation command classifier with one positively identified Windows Scheduled Task authority, preserve the proven exact-drain and WAL controls, and reach a hash-bound release that can safely perform one governed YouTube canary.

**Architecture:** `PulseGaming-LiveGuarded-YouTube-Runtime` is the only permitted production authority. A focused inspector follows one positive chain from exact task XML and running instance through PID/creation-time identity, parentage, Job Object membership, listener ownership, receipts and database leases; unrelated workstation processes are ignored. Existing drain, quarantine and WAL consumers retain their compatibility entry point but receive bounded, fail-closed evidence.

**Tech Stack:** Node.js 22 CommonJS, Windows Task Scheduler COM, PowerShell/CIM read-only probes, Win32 Job Object query through fixed committed probe code, SQLite leases, `node:test`, existing Pulse JSON evidence and release tooling.

## Global Constraints

- Production remains stopped until the final SHA is committed, pushed, independently reviewed, externally green and cut over through the governed runbook.
- The only permitted authority is `PulseGaming-LiveGuarded-YouTube-Runtime`; known legacy Pulse tasks remain explicit conflicts.
- Preserve canonical/no-link checkout and database identity, transition fencing, predecessor bindings, sequential PRIMARY then STANDBY draining, exact `LOCAL_PROOF` attestations, immutable crash-safe evidence, secret-safe blockers, quarantine and WAL backup/restore verification.
- A missing, malformed, unavailable, unstable or contradictory targeted observation returns `HOLD`; never infer safety from absence of evidence.
- Do not enumerate or parse unrelated PowerShell, `cmd.exe`, Node, Codex, Desktop Commander, Ollama, Plex or maintenance commands.
- Raw command lines, environment values, OAuth material, tokens and raw lease owner IDs must never enter evidence or blocker text.
- Do not mutate OAuth/tokens, publish externally, activate secondary platforms or repeat paid ElevenLabs synthesis during implementation and verification.
- Node verification uses `D:\pulse-tools\node-v22.17.1\node.exe` and the existing lockfile.
- TDD is mandatory: observe the focused test fail for the intended reason before each implementation change.
- Commit each task only after its focused tests and `git diff --check` pass; never stage unrelated pre-existing changes.

---

## File map and stable interfaces

- Create `lib/stabilisation/windows-task-authority.js`: bounded task-instance, process-chain, Job Object and listener observations plus stable double-read comparison.
- Modify `lib/stabilisation/windows-process-identity.js`: include parent PID and canonical executable path while retaining PID and UTC creation time.
- Modify `lib/stabilisation/windows-live-guarded-runtime.js`: build and inspect versioned task-bound receipts and expose the shared live/quiescent bounded verdict.
- Create `lib/stabilisation/bounded-runtime-db-authority.js`: validate scheduler/publisher leases and worker/job claims against one runtime generation without exposing raw owners.
- Modify `lib/stabilisation/live-runtime-transition-lease.js`: bind acquire and borrow operations to an exact authority context fingerprint.
- Modify `lib/services/scheduler-lock.js`, `lib/scheduler.js` and `lib/bootstrap-queue.js`: write the runtime-generation bindings consumed by the database authority inspector.
- Modify `lib/ops/governed-exact-production-plan-drain.js`: make `inspectWindowsPulseQuiescence` a compatibility adapter over the bounded inspector and delete global command-language parsing.
- Modify `lib/ops/governed-exact-plan-quarantine.js` and `lib/ops/governed-source-wal-clean-close.js`: consume the preserved bounded attestation shape without weakening their existing controls.
- Modify `package.json` and `package-lock.json`: return TypeScript to development-only status after AST parsing is removed.
- Add or modify focused tests under `tests/services/` and `tests/ops/` named in each task.

Stable interfaces introduced by this plan:

```js
inspectExactWindowsTaskInstances({ taskName, runPowerShell })
// => { ok, task_name, instances: [{ instance_guid, engine_pid, state }], blockers }

inspectWindowsAuthorityProcess({ pid, expected, runPowerShell })
// => { ok, pid, creation_time_utc, parent_pid, executable_path, command_sha256, blockers }

inspectCurrentWindowsJobMembership({ runPowerShell })
// => { ok, process_ids: number[], blockers }

inspectBoundedWindowsAuthority({ mode, expected, probes, firstObservation })
// => { schema: "pulse-windows-bounded-authority-v1", verdict, state, authority_fingerprint, ... }

inspectBoundedRuntimeDbAuthority({ db, mode, expected, now })
// => { ok, scheduler, publisher, workers, jobs, blockers }

buildLiveTaskAuthorityBinding(expected)
// => deterministic non-secret object used by receipts, leases and evidence
```

The only success states are `ACTIVE_BOUND` for live mode and `STOPPED_BOUND` for quiescent mode. Every other result is `HOLD` with stable blocker codes.

### Task 1: Add bounded Windows task and process probes

**Files:**
- Create: `lib/stabilisation/windows-task-authority.js`
- Modify: `lib/stabilisation/windows-process-identity.js`
- Create: `tests/services/windows-task-authority.test.js`
- Create: `tests/services/windows-process-identity.test.js`

**Interfaces:**
- Consumes: injected `runPowerShell({ script })` and existing SHA-256/path helpers.
- Produces: `inspectExactWindowsTaskInstances`, `inspectWindowsAuthorityProcess`, `inspectCurrentWindowsJobMembership`, `observeBoundedWindowsAuthority` and `compareStableAuthorityObservations`.

- [ ] **Step 1: Write failing process and task-instance tests**

```js
test("binds the exact task instance to its EnginePID", async () => {
  const result = await inspectExactWindowsTaskInstances({
    taskName: "PulseGaming-LiveGuarded-YouTube-Runtime",
    runPowerShell: fakePowerShell([{ InstanceGuid: "guid-1", EnginePID: 4100, State: 4 }]),
  });
  assert.deepEqual(result.instances, [
    { instance_guid: "guid-1", engine_pid: 4100, state: 4 },
  ]);
});

test("process identity includes parent, executable and a command hash only", async () => {
  const result = await inspectWindowsAuthorityProcess({ pid: 4200, runPowerShell: fakeProcessProbe });
  assert.equal(result.parent_pid, 4100);
  assert.equal(result.executable_path, "D:\\pulse-tools\\node-v22.17.1\\node.exe");
  assert.match(result.command_sha256, /^[a-f0-9]{64}$/);
  assert.equal("command_line" in result, false);
});
```

- [ ] **Step 2: Run the tests and confirm the imports/fields fail**

Run:

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/services/windows-task-authority.test.js tests/services/windows-process-identity.test.js
```

Expected: non-zero exit because the new module/fields do not exist.

- [ ] **Step 3: Implement fixed read-only probes**

Use Task Scheduler COM only for the exact task path and `GetInstances(0)`. Extend the CIM process projection to `ProcessId`, `ParentProcessId`, `CreationDate`, `ExecutablePath` and `CommandLine`, hashing the command line immediately and excluding it from the return value. Implement one fixed PowerShell `Add-Type` probe around `QueryInformationJobObject(NULL, JobObjectBasicProcessIdList, ...)`; do not evaluate input text.

```js
function compareStableAuthorityObservations(first, second) {
  const firstHash = sha256(canonicalJson(first));
  const secondHash = sha256(canonicalJson(second));
  return firstHash === secondHash
    ? { ok: true, observation_sha256: secondHash }
    : { ok: false, blockers: ["bounded_authority_observation_unstable"] };
}
```

- [ ] **Step 4: Add adversarial fail-closed cases**

Cover zero/two task instances, missing EnginePID, PID reuse, creation-time drift, wrong parent, wrong executable, wrong command hash, missing child Job membership, probe failure and changing first/second observations. Assert unrelated process rows are never requested or returned.

- [ ] **Step 5: Run focused tests and commit**

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/services/windows-task-authority.test.js tests/services/windows-process-identity.test.js
git diff --check
git add lib/stabilisation/windows-task-authority.js lib/stabilisation/windows-process-identity.js tests/services/windows-task-authority.test.js tests/services/windows-process-identity.test.js
git commit -m "feat: add bounded Windows task authority probes"
```

Expected: all focused tests pass and the commit contains only these four files.

### Task 2: Bind activation and owner receipts to the task instance

**Files:**
- Modify: `lib/stabilisation/windows-live-guarded-runtime.js`
- Modify: `tests/ops/windows-live-guarded-runtime.test.js`

**Interfaces:**
- Consumes: Task 1 probes and existing task XML/profile/database inspectors.
- Produces: `buildLiveTaskAuthorityBinding(expected)` and `inspectBoundedWindowsAuthority({ mode, expected, probes })`.

- [ ] **Step 1: Add failing receipt and verdict tests**

```js
test("ACTIVE_BOUND requires one continuous task-to-lease identity", async () => {
  const result = await inspectBoundedWindowsAuthority(activeFixture());
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.state, "ACTIVE_BOUND");
  assert.match(result.authority_fingerprint, /^[a-f0-9]{64}$/);
});

test("a mismatched task InstanceGuid is HOLD", async () => {
  const result = await inspectBoundedWindowsAuthority(activeFixture({ ownerInstanceGuid: "other" }));
  assert.equal(result.state, "HOLD");
  assert.deepEqual(result.blockers, ["live_task_instance_receipt_mismatch"]);
});
```

- [ ] **Step 2: Run the focused runtime test and observe RED**

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/ops/windows-live-guarded-runtime.test.js
```

Expected: failure because the task-bound receipt schema and inspector are absent.

- [ ] **Step 3: Implement versioned task-bound receipts**

Activation and owner receipts must include `runtime_instance_id`, exact task name, instance GUID, engine/supervisor PID and creation time, child PID and creation time, authority fingerprint, release SHA, profile hash and database identity hash. Validate the exact task XML before trusting an instance. Archive a stale receipt only after PID plus creation-time death is proven.

```js
function buildLiveTaskAuthorityBinding(expected) {
  return Object.freeze({
    task_name: expected.taskName,
    node_path: canonicalPath(expected.nodePath),
    checkout_real_path: canonicalPath(expected.checkoutRealPath),
    release_sha: expected.releaseSha,
    profile_sha256: expected.profileSha256,
    database_identity_sha256: expected.databaseIdentitySha256,
  });
}
```

- [ ] **Step 4: Implement stable live and quiescent verdicts**

`ACTIVE_BOUND` requires one task instance, EnginePID/supervisor equality, exact supervisor/child creation times, child parentage, both executable/command fingerprints, Job membership, child-owned port 3001, exact health response and matching database authority. `STOPPED_BOUND` requires valid-and-disabled-or-absent exact task, no instances, disabled/absent conflict tasks, absent activation receipt, absent or governed-stale owner receipt, no listener and quiescent database authority. Perform two stable observations around the decision.

- [ ] **Step 5: Prove secrets stay out and commit**

Add a fixture containing token-shaped command text and lease owners. Assert neither raw value appears in `JSON.stringify(result)`. Then run:

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/ops/windows-live-guarded-runtime.test.js tests/services/windows-task-authority.test.js
git diff --check
git add lib/stabilisation/windows-live-guarded-runtime.js tests/ops/windows-live-guarded-runtime.test.js
git commit -m "feat: bind guarded runtime receipts to task authority"
```

### Task 3: Bind database leases and workers to one runtime generation

**Files:**
- Create: `lib/stabilisation/bounded-runtime-db-authority.js`
- Create: `tests/services/bounded-runtime-db-authority.test.js`
- Modify: `lib/services/scheduler-lock.js`
- Modify: `lib/scheduler.js`
- Modify: `lib/bootstrap-queue.js`
- Modify: `tests/services/scheduler-lock.test.js`
- Modify: `tests/services/bootstrap-queue-primary-safety.test.js`
- Modify: `tests/services/bootstrap-queue-multi-lane-workers.test.js`

**Interfaces:**
- Consumes: `runtime_instance_id`, child PID/start time and authority fingerprint from Task 2.
- Produces: `inspectBoundedRuntimeDbAuthority({ db, mode, expected, now })`; scheduler/publisher lease metadata and worker IDs bound to `runtime_instance_id`.

- [ ] **Step 1: Write failing exact-binding tests**

```js
test("accepts only scheduler lease and workers from the bound runtime", () => {
  const result = inspectBoundedRuntimeDbAuthority({
    db: fixtureDb(), mode: "LIVE", now: NOW,
    expected: { runtime_instance_id: "ri-1", child_pid: 4200, child_started_at: START },
  });
  assert.equal(result.ok, true);
});

test("rejects an active job claimed by a predecessor worker", () => {
  const result = inspectBoundedRuntimeDbAuthority(predecessorClaimFixture());
  assert.deepEqual(result.blockers, ["runtime_db_active_job_foreign_worker"]);
});
```

- [ ] **Step 2: Run database/scheduler tests and observe RED**

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/services/bounded-runtime-db-authority.test.js tests/services/scheduler-lock.test.js tests/services/bootstrap-queue-primary-safety.test.js tests/services/bootstrap-queue-multi-lane-workers.test.js
```

- [ ] **Step 3: Implement exact database authority checks**

Inspect only the bound database. In live mode require the unexpired `scheduler:primary` lease metadata to match runtime instance, child PID/start and authority fingerprint. Permit `publisher:global` only for the same runtime and an admitted operation. Derive worker IDs as `server-<runtime_instance_id>-<pool_id>-<instance>` and require each active claim/open `job_runs` row to map to that finite set. In quiescent mode require no live scheduler/publisher lease and no active/open claim outside the maintenance transition.

- [ ] **Step 4: Hash private owner identifiers**

Evidence returns `owner_sha256` and non-secret PID/runtime bindings, never raw owner strings. Tests must assert raw fixture owners are absent from serialised success and blocker evidence.

- [ ] **Step 5: Run focused tests and commit**

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/services/bounded-runtime-db-authority.test.js tests/services/scheduler-lock.test.js tests/services/bootstrap-queue-primary-safety.test.js tests/services/bootstrap-queue-multi-lane-workers.test.js
git diff --check
git add lib/stabilisation/bounded-runtime-db-authority.js lib/services/scheduler-lock.js lib/scheduler.js lib/bootstrap-queue.js tests/services/bounded-runtime-db-authority.test.js tests/services/scheduler-lock.test.js tests/services/bootstrap-queue-primary-safety.test.js tests/services/bootstrap-queue-multi-lane-workers.test.js
git commit -m "feat: bind runtime database authority"
```

### Task 3b: Bind post-admission publication to immutable authority

**Depends on:** a clean independent review of Task 3.

**Files:**
- Modify: `publisher.js`
- Modify: `lib/bootstrap-queue.js`
- Modify: `lib/services/jobs-runner.js`
- Modify: `lib/job-handlers.js`
- Modify: `lib/services/publisher-lock.js`
- Modify: `lib/services/governed-youtube-publisher-adapter.js`
- Modify: `lib/services/governed-youtube-scheduled-replay-verifier.js`
- Modify: `lib/stabilisation/bounded-runtime-db-authority.js`
- Test: `tests/services/publisher-lock.test.js`
- Test: `tests/services/publisher-qa-persistence.test.js`
- Test: `tests/services/bootstrap-queue-multi-lane-workers.test.js`
- Test: `tests/services/bootstrap-queue-primary-safety.test.js`
- Test: `tests/services/jobs-runner.test.js`
- Test: `tests/services/governed-lane-publication-handlers.test.js`
- Test: `tests/services/governed-youtube-runway-handlers.test.js`
- Test: `tests/services/governed-youtube-publisher-adapter.test.js`
- Test: `tests/services/governed-youtube-schedule-disarm-adapter.test.js`
- Test: `tests/services/governed-youtube-scheduled-replay-verifier.test.js`
- Test: `tests/services/guarded-youtube-window.test.js`

**Interfaces:**
- Consumes: trusted runtime authority supplied by bootstrap, a frozen canonical claimed-job authority and immutable scheduled-admission evidence.
- Produces: a canonical exact-metadata-CAS `publisher:global` lease binding for one of the seven closed post-admission operations.

- [ ] **Step 1: Write failing authority-propagation tests**

Cover the publisher lock, queue bootstrap, claimed-job context, publication handlers, YouTube adapters and scheduled replay. Prove that missing, malformed or drifted runtime/admission/job fields prevent the lease task from running and that job payloads, direct CLI calls and legacy server paths cannot inject authority. Prove `publishToAllPlatforms` returns its existing disabled/held result before it reads or acquires a lease and never invokes a secondary-platform adapter.

- [ ] **Step 2: Canonicalise the complete publication binding once**

Replace the admitted binding with closed schema `pulse-admitted-publication-operation-v2`. Preserve and validate canonical `channel_id`, story ID, platform `youtube`, a positive safe-integer scheduled event ID, canonical scheduled time, dispatch idempotency key, request fingerprint and `runwayLockSha256`. Include `channel_id` in the admitted-operation hash, reserve it against generic metadata and compare it with the durable SCHEDULED event/state evidence. Reject `0`, negative, fractional, unsafe and non-numeric event IDs and prove a `pulse-gaming` binding cannot be substituted with `stacked`.

Build one frozen, minimally cloned claimed-job authority from repository data, never from payload authority fields. Its digest must bind job ID, kind, canonical `channel_id`, story ID, canonical `run_at`, canonical parsed payload, positive safe-integer `attempt_count`, claimed worker, claim-token/open `job_runs` identity and idempotency-key hash. Re-read and recompute it on every assertion. Hard-code this job-kind-to-publisher-operation map and reject all other pairs:

- `dispatch_governed_publication` -> `publish_next_story`
- `prestage_governed_youtube_release` -> `prestage_governed_youtube_release`
- `governed_youtube_runway_t60` -> `verify_governed_youtube_private_prestage`
- `governed_youtube_runway_t60` -> `disarm_governed_youtube_scheduled_release`
- `verify_governed_youtube_release_tminus15` -> `arm_governed_youtube_scheduled_release`
- `verify_governed_youtube_release_tminus15` -> `verify_governed_youtube_scheduled_replay`
- `verify_governed_youtube_release_tminus15` -> `disarm_governed_youtube_scheduled_release`
- `verify_governed_youtube_release_t0` -> `confirm_governed_youtube_scheduled_release`

At minimum, `publish_next_story` must be impossible outside a currently claimed `dispatch_governed_publication` job. In `LIVE_GUARDED`, require trusted runtime authority, the exact claimed-job authority and immutable admission context before acquiring `publisher:global`.

- [ ] **Step 3: Fence acquire, heartbeat, assertion and release by exact metadata CAS**

Construct the authoritative metadata without merging untrusted generic metadata into reserved fields, serialise it once canonically and retain the exact raw metadata string returned by acquisition. Acquire with `replaceSameOwner: false`. Heartbeat and `assertHealthy` must compare-and-swap the exact owner plus that raw metadata snapshot; release must use `releaseExactMetadata` with the same snapshot. A same-owner replacement, metadata drift or old-generation handle must lose authority, must not release the successor and must prevent every later irreversible callback. Returned evidence may expose only trusted constants, expected values, hashes and boolean mismatch flags, never raw owner, claim token, environment or OAuth-shaped material.

- [ ] **Step 4: Bind the closed post-admission allowlist and lifecycle continuations**

Permit only:

- `publish_next_story`
- `disarm_governed_youtube_scheduled_release`
- `prestage_governed_youtube_release`
- `verify_governed_youtube_private_prestage`
- `arm_governed_youtube_scheduled_release`
- `confirm_governed_youtube_scheduled_release`
- `verify_governed_youtube_scheduled_replay`

`publishToAllPlatforms` must return its existing disabled/held result before acquiring the lease. Thread the same immutable binding through every governed adapter and exact durable-job handler. Preserve all platform, rights, quality, freshness, replay, compensation and reconciliation gates; a compensated verification must not nest a second publisher lease.

Add `PLATFORM_SCHEDULE_DISARMED` only to the continuation states for `disarm_governed_youtube_scheduled_release`. No other publisher operation may gain that state. Prove a crash or lease loss after the durable disarm commit but before lease release replays as the terminal disarm continuation without reopening create, arm or confirm authority. Preserve `createAttemptStarted`, `updateAttemptStarted`, `platformContacted`, `reconciliationRequired` and `remoteDisarmRequired` when lease loss occurs.

- [ ] **Step 5: Prove evidence is complete and secret-safe**

`readScheduledDispatchEvidence` and the final binding assertion must compare the runway hash as well as the existing fields. Returned evidence must not expose raw lease owners, environment values or token-shaped material.

- [ ] **Step 6: Run focused Node 22 tests, review and commit**

Run the publisher lock, QA persistence, bootstrap, jobs runner, governed lane/runway handlers, YouTube publisher/disarm/replay adapters and guarded-window suites. Require an independent review before Task 3c.

### Task 3c: Give pre-admission work a separate single-flight authority

**Depends on:** clean independent reviews of Tasks 3 and 3b.

**Files:**
- Create: `lib/services/publication-admission-lock.js`
- Create: `tests/services/publication-admission-lock.test.js`
- Modify: `lib/bootstrap-queue.js`
- Modify: `lib/services/jobs-runner.js`
- Modify: `lib/stabilisation/bounded-runtime-db-authority.js`
- Modify: `lib/services/governed-autonomous-pre-t90-window-runner.js`
- Modify: `lib/job-handlers.js`
- Modify: `lib/services/publication-admission.js`
- Modify: `lib/services/autonomous-admission-control-proof.js`
- Modify: `lib/services/autonomous-official-jit-admission-packet.js`
- Modify: `lib/services/autonomous-official-source-evidence-apply.js`
- Test: `tests/services/jobs-runner-lease-deadline.test.js`
- Test: `tests/services/bootstrap-queue-multi-lane-workers.test.js`
- Test: `tests/services/bootstrap-queue-primary-safety.test.js`
- Test: `tests/services/bounded-runtime-db-authority.test.js`
- Test: `tests/services/publication-admission.test.js`
- Test: `tests/services/autonomous-admission-control-proof.test.js`
- Test: `tests/services/autonomous-official-jit-admission-packet.test.js`
- Test: `tests/services/autonomous-official-source-evidence-apply.test.js`
- Test: `tests/services/governed-autonomous-pre-t90-window-runner.test.js`
- Test: `tests/services/governed-autonomous-pre-t90-window-handler.test.js`
- Test: `tests/services/governed-autonomous-jit-admission-handler.test.js`
- Test: `tests/services/governed-autonomous-pre-t90-to-runway-t90.integration.test.js`
- Test: `tests/services/governed-youtube-private-prestage.test.js`
- Test: `tests/services/governed-youtube-reserve-promotion.test.js`

**Interfaces:**
- Consumes: trusted runtime authority and the exact currently claimed durable job.
- Produces: `publication-admission:global`, a non-publishing exact-metadata-CAS lease with schema `pulse-runtime-generation-publication-admission-lease-v1`, scope `PUBLICATION_ADMISSION_ONLY` and a canonical non-secret claimed-job authority digest.

- [ ] **Step 1: Write failing separation and exact-claim tests**

Prove admission and publisher leases cannot substitute for one another. Require exact positive safe-integer job ID and attempt, kind, canonical `channel_id`, story ID, canonical `run_at`, canonical payload, claimed worker, claim token matching the positive safe-integer unfinished `job_runs.id`, unexpired claim and idempotency-key hash. Prove payloads cannot supply authority and stale, foreign or malformed admission leases make the bounded DB inspector return HOLD. Add causal drift cases for payload, story, channel, `run_at`, attempt and open run.

- [ ] **Step 2: Implement the closed operation-to-job map**

Hard-code and reject every other combination:

- `governed_autonomous_pre_t90_window_preparation` -> `prepare_governed_autonomous_pre_t90_window`
- `autonomous_t75_jit_admission` -> `admit_governed_publication`
- `promote_governed_youtube_reserve_release` -> `prestage_governed_youtube_release`
- `promote_confirmed_disarm_youtube_reserve_release` -> `governed_youtube_runway_t60`

The operation is lock-selected, not payload-selected. Reject every unmapped pair. For `admit_governed_publication`, authorise only the autonomous official-source JIT branch; the non-JIT branch must explicitly return HOLD in `LIVE_GUARDED` unless a separately reviewed authority is added later.

- [ ] **Step 3: Acquire and maintain the lease with SQLite time and exact metadata CAS**

Reuse `runtime_leases`; do not add a migration. Read current time from SQLite in every acquire, heartbeat, assertion and expiry-cap calculation; JavaScript clocks, payload timestamps and handler `now` values cannot grant or extend authority. Acquire inside one immediate transaction that validates `main.jobs` and the exact unfinished `main.job_runs` claim-token row. Cap the lease to the remaining job-claim lifetime. Acquire with `replaceSameOwner: false`, retain one canonical raw metadata snapshot and use exact owner-plus-metadata CAS for every heartbeat/assertion and `releaseExactMetadata` for release. Same-owner replacement and clock/payload drift must fail closed. Mark every external-create and platform-mutation flag explicitly false. Expose only hashed contention evidence.

- [ ] **Step 4: Reassert admission authority inside the SCHEDULED-creation transaction**

Expose `assertHealthyInTransaction()` on the admission lease handle. It must use the caller's existing immediate transaction without starting a nested `BEGIN` and re-read the exact admission lease metadata, `main.jobs` claim and unfinished `main.job_runs` row. Compose it with the existing `transactionBoundaryCheck` and `transactionCompletionCheck` in `admitPublication` and `admitAutonomousOfficialPublication`: assert immediately before the transaction, after the boundary hook, before the completion hook and immediately before the transaction callback returns to COMMIT. Claim or lease loss at any checkpoint must roll back all lifecycle, cancellation, audit and successor-job writes. No SCHEDULED authority or successor work may commit from a merely pre-transaction assertion.

- [ ] **Step 5: Version proof, packet and apply artefacts and make retries crash-safe**

Pre-T90 preparation, T-75 JIT admission and both reserve-promotion paths use the new lease rather than `publisher:global` before a valid immutable SCHEDULED ticket exists. Rename proof/packet fields to `publicationAdmissionLease` / `publication_admission_lease`. Never carry the admission lease into the resulting scheduled dispatch binding or publication authority. Preserve existing single-owner, compensation and recovery controls.

Replace publisher-owner proof fields with `publication_admission_*` fields and the exact non-secret claimed-job authority digest. Introduce closed schema `pulse-publication-admission-owner-proof-v1`, bump the admission-control result to `pulse-autonomous-admission-control-proof-result-v2`, the JIT result/resolved-plan schemas to v4 and the source-evidence apply request/report/result/materialiser schemas to v4. Update every closed field set, validator, lineage hash and consumer together. Add `lib/services/autonomous-official-source-evidence-apply.js` and its test suite to this production change. Publisher-based v1 proof/packet/apply artefacts must fail closed rather than being silently upgraded.

Bind JIT attempt identity and artefact paths to the durable positive safe-integer `attempt_count`. If the process crashes after proof materialisation but before SCHEDULED commit, a fresh claim must create or exactly replay a distinct attempt without overwriting the prior attempt; conflicting prior artefacts are quarantined/HOLD. Test the crash boundary and successful fresh-claim recovery.

- [ ] **Step 6: Extend every DB authority snapshot and quiescence path**

Treat `publication-admission:global` as the third governed lease in every live read, stable snapshot digest, evidence projection and QUIESCENT check. Add every job column needed by the claimed-job digest. A valid exact active admission lease may coexist only with its matching runtime/job in LIVE; publisher/admission schema substitution, stale/foreign/malformed bindings and an active admission lease in QUIESCENT all yield HOLD. Returned evidence must stay secret-safe.

- [ ] **Step 7: Run focused Node 22 tests, review and commit**

Run the new lock suite plus runner lease-deadline, bootstrap, bounded DB authority, admission proof/JIT packet, pre-T90, admission, integration, private-prestage and reserve-promotion suites. Require a fresh independent review before transition-lease work.

#### Mandatory Task 3b/3c regression matrix

- Disabled `publishToAllPlatforms` returns before touching the lease repository and never calls YouTube or any secondary-platform adapter.
- Trusted runtime, exact claimed-job and immutable admission authority propagate through all seven post-admission adapter/replay operations.
- Same-owner lease replacement, metadata drift and an old-generation release all fail exact CAS; no irreversible callback runs after drift.
- Lease loss preserves all compensation flags and private verification never nests a second publisher lease.
- `PLATFORM_SCHEDULE_DISARMED` is terminal only for the disarm continuation; it grants no create, prestage, arm, replay or confirm authority.
- Claim or admission-lease loss immediately before `BEGIN`, after the transaction boundary, before completion and before COMMIT rolls back lifecycle, cancellation, audit and successor writes.
- Publisher-based v1 proof, packet and apply artefacts are rejected by the new closed schemas.
- Payload/story/channel/`run_at`/attempt/open-run drift, past/future payload clocks and the exact SQLite expiry boundary fail closed.
- A crash after proof writes but before SCHEDULED commit permits a fresh durable attempt without clobbering the old attempt.
- Event IDs `0`, negative, fractional, unsafe or non-numeric fail both camelCase and snake_case binding normalisers.
- The DB inspector accepts one exact admission lease, rejects publisher/admission substitution both ways and rejects stale, foreign or malformed admission authority in LIVE and any active admission authority in QUIESCENT.
- No result or artefact contains a raw owner ID, claim token, environment value or OAuth-shaped secret.

### Task 4: Fence transition leases with the same authority fingerprint

**Files:**
- Modify: `lib/stabilisation/live-runtime-transition-lease.js`
- Modify: `tests/services/live-runtime-transition-lease.test.js`

**Interfaces:**
- Consumes: `buildLiveTaskAuthorityBinding(expected)` and its fingerprint.
- Produces: acquire/borrow/renew/release validation against `metadata.authority_context_sha256`.

- [ ] **Step 1: Write failing borrow and context-drift tests**

Assert acquiring stores the context fingerprint, borrowing rejects a correct token paired with a different authority context and renewal fails after context drift.

- [ ] **Step 2: Run and observe RED**

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/services/live-runtime-transition-lease.test.js
```

- [ ] **Step 3: Add required authority context to every lease operation**

Extend `acquireLiveRuntimeTransitionLease` and `borrowLiveRuntimeTransitionLease` arguments with `authorityContextSha256`. Canonically validate it as 64 lowercase hex characters and compare it continuously during renew/release. Do not add a database migration; store it in existing versioned metadata.

- [ ] **Step 4: Run focused tests and commit**

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/services/live-runtime-transition-lease.test.js
git diff --check
git add lib/stabilisation/live-runtime-transition-lease.js tests/services/live-runtime-transition-lease.test.js
git commit -m "feat: fence transitions by task authority"
```

### Task 5: Replace the global quiescence classifier while retaining exact drain controls

**Files:**
- Modify: `lib/ops/governed-exact-production-plan-drain.js`
- Modify: `tests/services/governed-exact-production-plan-drain.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `inspectBoundedWindowsAuthority({ mode: "QUIESCENT" })`.
- Produces: existing `inspectWindowsPulseQuiescence` result shape populated only from bounded authority evidence.

- [ ] **Step 1: Replace parser-family tests with authority-boundary tests**

Delete tests whose only purpose is recognising PowerShell/cmd/JavaScript execution syntax. Add tests proving the exact active task, legacy conflicting task, receipt, listener, DB lease or unstable observation blocks; unrelated shells and processes do not affect the verdict because they are never requested.

- [ ] **Step 2: Run the exact-drain suite and observe RED**

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/services/governed-exact-production-plan-drain.test.js
```

- [ ] **Step 3: Make the compatibility function a thin adapter**

Remove arbitrary PowerShell/cmd/JavaScript AST and alias/environment classifier functions. Keep `inspectWindowsPulseQuiescence` exported, inject the bounded inspector and translate `STOPPED_BOUND` into the existing pass attestation. Any `HOLD` or probe error maps to stable exact-drain blockers without raw text.

- [ ] **Step 4: Preserve every non-parser safety test**

Run exact queue binding, every predecessor database binding, PRIMARY-before-STANDBY sequencing, non-cooperative runner quiescence, activation absence throughout, immutable evidence, exact `LOCAL_PROOF` result and crash recovery cases. Restore TypeScript to `devDependencies` only and verify production code no longer imports it.

- [ ] **Step 5: Run the complete exact-drain suite and commit**

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/services/governed-exact-production-plan-drain.test.js
git diff --check
git add lib/ops/governed-exact-production-plan-drain.js tests/services/governed-exact-production-plan-drain.test.js package.json package-lock.json
git commit -m "refactor: bound exact drain to task authority"
```

### Task 6: Prove quarantine and WAL consumers retain fail-closed behaviour

**Files:**
- Modify: `lib/ops/governed-exact-plan-quarantine.js`
- Modify: `tests/ops/governed-exact-plan-quarantine.test.js`
- Modify: `lib/ops/governed-source-wal-clean-close.js`
- Modify: `tests/ops/governed-source-wal-clean-close.test.js`

**Interfaces:**
- Consumes: the Task 5 compatibility attestation and Task 4 transition context.
- Produces: unchanged governed quarantine and WAL result schemas with bounded authority fingerprints added to their input/evidence binding.

- [ ] **Step 1: Add failing consumer fixtures**

For both consumers, add one `STOPPED_BOUND` success fixture and cases for changed observation, wrong DB identity, missing transition context, reappearing activation receipt and stale/non-exact attestation. Assert `HOLD` before mutation.

- [ ] **Step 2: Run both suites and observe RED**

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/ops/governed-exact-plan-quarantine.test.js tests/ops/governed-source-wal-clean-close.test.js
```

- [ ] **Step 3: Bind consumer evidence to bounded authority**

Require schema `pulse-windows-bounded-authority-v1`, state `STOPPED_BOUND`, exact authority fingerprint and continuously valid transition context. Preserve quarantine path safety and the independently green WAL post-quiescence rebinding, backup hash, restore rehearsal and clean-close logic.

- [ ] **Step 4: Run all bounded consumer suites and commit**

```powershell
& 'D:\pulse-tools\node-v22.17.1\node.exe' --test tests/services/windows-task-authority.test.js tests/ops/windows-live-guarded-runtime.test.js tests/services/bounded-runtime-db-authority.test.js tests/services/live-runtime-transition-lease.test.js tests/services/governed-exact-production-plan-drain.test.js tests/ops/governed-exact-plan-quarantine.test.js tests/ops/governed-source-wal-clean-close.test.js
git diff --check
git add lib/ops/governed-exact-plan-quarantine.js lib/ops/governed-source-wal-clean-close.js tests/ops/governed-exact-plan-quarantine.test.js tests/ops/governed-source-wal-clean-close.test.js
git commit -m "test: bind quarantine and WAL to task authority"
```

### Task 7: Complete release verification and independent review

**Files:**
- Modify only files required by demonstrated failures in Tasks 1-6.
- Generate proof under the repository's existing ignored/test-output locations; do not commit transient runtime evidence.

**Interfaces:**
- Consumes: complete candidate diff.
- Produces: exact candidate SHA, command results, source/test hashes and independent hash-bound verdict.

- [ ] **Step 1: Run all focused suites under Node 22**

Use `TEMP` and `TMP` set to `D:\pulse-data\runtime\pulse-live-guarded-youtube\sqlite-temp-cutover`. Expected: every focused test passes with no skipped safety case.

- [ ] **Step 2: Run repository verification**

```powershell
$env:TEMP='D:\pulse-data\runtime\pulse-live-guarded-youtube\sqlite-temp-cutover'
$env:TMP=$env:TEMP
$env:npm_config_cache='D:\pulse-data\runtime\npm-cache-cutover'
& 'D:\pulse-tools\node-v22.17.1\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' test
& 'D:\pulse-tools\node-v22.17.1\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run build
& 'D:\pulse-tools\node-v22.17.1\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run ops:agent-rules
& 'D:\pulse-tools\node-v22.17.1\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run docs:doctor
git diff --check
```

- [ ] **Step 3: Inspect for forbidden scope and secrets**

```powershell
& 'C:\Users\MORR\.local\bin\rg.exe' -n "typescript|require\(['\"]typescript|powershell.*parser|javascript.*parser" lib package.json
git diff -- . ':!package-lock.json' | & 'C:\Users\MORR\.local\bin\rg.exe' -n "API_KEY|ACCESS_TOKEN|CLIENT_SECRET|BEGIN PRIVATE KEY"
```

Expected: no production TypeScript import, no retained global parser family and no secret material.

- [ ] **Step 4: Request two independent reviews**

One reviewer checks spec compliance and the exact positive authority chain; a second checks the whole diff adversarially for fail-open paths, secret leakage and lost drain/WAL controls. Both reviews must cite the exact source hash and test-evidence hash. Any finding returns to the task that owns it and repeats that task's RED/GREEN cycle.

- [ ] **Step 5: Commit, push and verify external CI**

After a clean whole-diff review, commit the integrated candidate, push `codex/release-20260730-cutover`, update PR 82 at that SHA and require external CI to rebuild the exact commit under Node 22. Do not label the release GREEN from local tests alone.

### Task 8: Perform the bounded cutover and one reconciled canary

**Files:**
- No source edits during the cutover unless an actual Pulse-boundary escape is demonstrated.
- Runtime evidence is written to the governed D: runtime/evidence locations already used by the release tooling.

**Interfaces:**
- Consumes: externally green reviewed SHA and the existing governed cutover commands.
- Produces: one active bounded authority, one fresh admitted YouTube window and externally reconciled public-object evidence.

- [ ] **Step 1: Satisfy host prerequisites**

Clear the pending Windows reboot, verify system-drive headroom, pause Codex/Desktop Commander/maintenance automations for the cutover window and prove production remains stopped: no port-3001 listener, no running exact task instance and no live scheduler/publisher owner.

- [ ] **Step 2: Verify backup and restore rehearsal**

Create the governed database backup, verify its SHA-256 and restore it into the isolated rehearsal location. Abort on identity, integrity or row-count mismatch.

- [ ] **Step 3: Materialise the immutable release**

Create the permanent D: checkout at the reviewed SHA, copy ignored `.env` without displaying it and compare only its hash, preserve `output`, reuse completed provider-ledger narration/timing and create one immutable successor production plan.

- [ ] **Step 4: Drain in `LOCAL_PROOF`**

Drain PRIMARY then STANDBY sequentially. Require fresh GREEN media, exact result attestations, no activation receipt throughout, every predecessor database binding and crash-recoverable evidence. Back up again after the drain.

- [ ] **Step 5: Activate one authority and verify the full chain**

Enable/start only `PulseGaming-LiveGuarded-YouTube-Runtime`. Require `ACTIVE_BOUND` twice with unchanged fingerprints, exact task XML, one InstanceGuid/EnginePID, supervisor/child PID and creation times, parentage, Job membership, port ownership, health SHA/profile/topology and scheduler lease binding.

- [ ] **Step 6: Admit and publish one fresh YouTube canary**

Select a new eligible window; never reuse the expired 31 July window. Revalidate source/rights/candidate, upload privately once, wait for processing, arm exactly one `publishAt`, observe the scheduled public transition and reconcile the remote YouTube object independently. Do not infer publication from a database row and do not blind-retry a possibly created upload.

- [ ] **Step 7: Freeze and observe**

Verify no duplicate, secondary-platform action or unexpected runtime owner. Record remote URL/platform ID, exact video hash, candidate/request fingerprint and reconciled local lifecycle. Freeze engineering changes while observing the canary and only then schedule dependable cadence.

## Self-review record

- Spec coverage: all exact task, task instance, process, Job Object, port, receipt, lease, quiescent/live state, consumer, release and canary requirements map to Tasks 1-8.
- Scope control: global shell classification is deleted in Task 5; unrelated processes are explicitly ignored and no service-account, VM, renderer, platform or content expansion is included.
- Type consistency: `runtime_instance_id`, `authority_fingerprint`, `authority_context_sha256`, `ACTIVE_BOUND`, `STOPPED_BOUND` and `pulse-windows-bounded-authority-v1` are used consistently across tasks.
- Safety preservation: exact drain sequencing, predecessor bindings, activation absence, immutable evidence, quarantine and the independently green WAL rebinding/restore logic are explicitly retained and tested.
- Completion boundary: local success is insufficient; Task 7 requires independent hash-bound review and external CI, while Task 8 requires remote-object reconciliation before cadence.
