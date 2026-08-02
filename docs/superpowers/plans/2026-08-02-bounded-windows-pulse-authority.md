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
