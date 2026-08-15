# GREEN Autopilot Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the clean, durable and truthfully observable runtime foundation required by the Pulse Gaming GREEN autopilot.

**Architecture:** A protected control plane owns SQLite, schedules, fenced leases, durable controls and readiness. Production lanes run as separately supervised Windows services with external mutable data and no shared credential-bearing process identity.

**Tech Stack:** Node.js 24 CommonJS, better-sqlite3, Express, node-cron, Windows Service Control Manager/PowerShell, Node test runner

**Spec:** `docs/superpowers/specs/2026-08-14-pulse-gaming-green-autopilot-design.md`

## Global Constraints

- Start from a clean worktree that contains this plan branch plus current `origin/main`.
- Keep `LOCAL_PROOF` and `DRY_RUN_PUBLISH` as defaults; this plan grants no live publication authority.
- YouTube Shorts and channel `pulse-gaming` are the only future live scope.
- Missing, corrupt or stale control state fails closed.
- An environment variable may engage the kill switch but may never clear durable kill-switch state.
- Mutable database, media, evidence, logs, receipts, backups, configuration and credentials live outside the source checkout.
- Never print, copy or commit `.env`, tokens or OAuth material.
- Use British English in operator-facing copy and avoid the Oxford comma.
- Run focused tests after every task and commit each independently.

## Execution Prerequisite: Clean Integrated Worktree

Use the `superpowers:using-git-worktrees` skill before Task 1. Create the implementation worktree from the branch containing this plan, then merge current mainline:

```powershell
git fetch origin
git worktree add ..\pulse-gaming-green-autopilot -b codex/green-autopilot-implementation codex/epidemic-sound-full-integration
Set-Location ..\pulse-gaming-green-autopilot
git merge --no-ff origin/main -m "merge: align green autopilot with current mainline"
npm ci
```

Resolve merge conflicts without copying files from the dirty original checkout. Stop if migrations `001` through `024` are not present or if their committed checksums disagree with migration history.

## File Structure

- `lib/runtime/baseline-audit.js`: clean-tree, commit and migration-chain verification.
- `lib/runtime/production-paths.js`: external mutable-root resolution and containment checks.
- `lib/runtime/control-plane-bootstrap.js`: all-or-nothing production bootstrap and shutdown.
- `lib/runtime/schedule-reconciler.js`: exact schedule convergence for the approved profile.
- `lib/runtime/readiness.js`: canonical production readiness report.
- `lib/services/lease-heartbeat.js`: renewable lease helper shared by scheduler and publisher.
- `lib/services/kill-switch.js`: sole semantic facade over durable kill-switch state.
- `lib/repositories/{kill_switch,circuit_breakers,runtime_components}.js`: durable control repositories.
- `db/migrations/025_green_autopilot_runtime_control.sql`: controls, component identity and fencing schema.
- `config/runtime-lanes.json`: fixed production service identities and health contracts.
- `config/runtime-dependencies.json`: supervised Ollama, VoxCPM and other fixed local-service identities.
- `tools/runtime-*.js`: fixed-role runtime entry points and read-only doctors.
- `tools/windows/*.ps1`: plan/apply and verification for isolated Windows services.

---

### Task 1: Prove a clean integrated baseline

**Files:**
- Create: `lib/runtime/baseline-audit.js`
- Create: `lib/ops/exact-cli-expectation.js`
- Create: `tools/autopilot-baseline-audit.js`
- Create: `tests/services/autopilot-baseline-audit.test.js`
- Create: `tests/services/exact-cli-expectation.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `auditAutopilotBaseline({ root, expectedBranch, databaseMode, migrationRows, migrationFiles, git }) -> { verdict, checks, blockers, identity }`
- Produces: `preflightAutopilotDatabase({ databaseMode, requiredMigrations, openFixture, openProduction }) -> { verdict, db, blockers }`.
- Produces: `assertExpectedCliVerdict({ actual, expected, allowed, required }) -> { matched, exitCode }`.
- Produces: `npm run ops:autopilot:baseline`

- [ ] **Step 1: Write the failing baseline tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { auditAutopilotBaseline, preflightAutopilotDatabase } = require("../../lib/runtime/baseline-audit");
const { assertExpectedCliVerdict } = require("../../lib/ops/exact-cli-expectation");

test("baseline rejects untracked files and a missing migration", async () => {
  const report = await auditAutopilotBaseline({
    root: "C:/live",
    expectedBranch: "codex/green-autopilot-implementation",
    databaseMode: "fixture",
    git: async (args) => args[0] === "status" ? "?? rogue.js\n" : "abc123\n",
    migrationRows: appliedMigrations(24),
    migrationFiles: committedMigrations(23)
  });
  assert.equal(report.verdict, "RED");
  assert.deepEqual(report.blockers.sort(), ["migration_024_missing", "worktree_not_clean"]);
});

test("baseline accepts one clean exact commit and migrations 001 through 024", async () => {
  const rows = Array.from({ length: 24 }, (_, index) => ({
    version: String(index + 1).padStart(3, "0"),
    filename: `${String(index + 1).padStart(3, "0")}_x.sql`,
    checksum: String(index + 1).padStart(64, "0")
  }));
  const report = await auditAutopilotBaseline({
    root: "C:/live",
    expectedBranch: "codex/green-autopilot-implementation",
    databaseMode: "fixture",
    git: async (args) => args[0] === "status" ? "" : args[0] === "branch" ? "codex/green-autopilot-implementation\n" : "abc123\n",
    migrationRows: rows,
    migrationFiles: rows
  });
  assert.equal(report.verdict, "GREEN");
});

test("production mode remains pending when committed migrations are not yet applied", async () => {
  const report = await auditAutopilotBaseline(fixtureBaseline({ databaseMode: "production", migrationRows: APPLIED_001_TO_024, migrationFiles: COMMITTED_001_TO_025 }));
  assert.equal(report.verdict, "PENDING");
  assert.ok(report.blockers.includes("production_migration_cutover_pending"));
});

test("database preflight returns PENDING before any absent-table query", async () => {
  let domainQueryCount = 0;
  const result = await preflightAutopilotDatabase(preflightFixture({ databaseMode: "production", appliedThrough: 24, requiredMigrations: [25, 26], domainQuery: () => { domainQueryCount += 1; } }));
  assert.equal(result.verdict, "PENDING");
  assert.equal(domainQueryCount, 0);
});

test("the shared expectation contract uses exact values without changing the report", () => {
  const report = Object.freeze({ verdict: "PENDING", blockers: ["migration_cutover_pending"] });
  assert.deepEqual(assertExpectedCliVerdict({ actual: report.verdict, expected: "PENDING", allowed: ["GREEN", "PENDING", "RED"], required: true }), { matched: true, exitCode: 0 });
  assert.deepEqual(assertExpectedCliVerdict({ actual: report.verdict, expected: "GREEN", allowed: ["GREEN", "PENDING", "RED"], required: true }), { matched: false, exitCode: 2 });
  assert.deepEqual(assertExpectedCliVerdict({ actual: report.verdict, expected: "MAYBE", allowed: ["GREEN", "PENDING", "RED"], required: true }), { matched: false, exitCode: 64 });
  assert.deepEqual(assertExpectedCliVerdict({ actual: report.verdict, expected: undefined, allowed: ["GREEN", "PENDING", "RED"], required: true }), { matched: false, exitCode: 64 });
  assert.deepEqual(report, { verdict: "PENDING", blockers: ["migration_cutover_pending"] });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `node --test tests/services/autopilot-baseline-audit.test.js tests/services/exact-cli-expectation.test.js`

Expected: FAIL with `Cannot find module '../../lib/runtime/baseline-audit'`.

- [ ] **Step 3: Implement canonical baseline evaluation**

```js
"use strict";

async function auditAutopilotBaseline(input) {
  const blockers = [];
  const pending = [];
  const status = await input.git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const branch = (await input.git(["branch", "--show-current"])).trim();
  const commit = (await input.git(["rev-parse", "HEAD"])).trim();
  if (status.trim()) blockers.push("worktree_not_clean");
  if (branch !== input.expectedBranch) blockers.push("unexpected_branch");
  if (!["fixture", "production"].includes(input.databaseMode)) blockers.push("database_mode_required");
  const files = new Map((input.migrationFiles || []).map((row) => [row.version, row]));
  const rows = new Map((input.migrationRows || []).map((row) => [row.version, row]));
  for (const row of input.migrationRows || []) {
    const file = files.get(row.version);
    if (!file) blockers.push(`migration_${row.version}_missing`);
    else if (file.filename !== row.filename || file.checksum !== row.checksum) blockers.push(`migration_${row.version}_drift`);
  }
  for (const file of input.migrationFiles || []) {
    if (rows.has(file.version)) continue;
    if (input.databaseMode === "production") pending.push(`migration_${file.version}_cutover_pending`);
    else blockers.push(`migration_${file.version}_unapplied_in_fixture`);
  }
  if (pending.length) pending.unshift("production_migration_cutover_pending");
  return {
    schema_version: 1,
    verdict: blockers.length ? "RED" : pending.length ? "PENDING" : "GREEN",
    checks: { worktree_clean: !status.trim(), database_mode: input.databaseMode, migration_count: files.size },
    blockers: [...new Set([...blockers, ...pending])],
    identity: { branch, commit }
  };
}

module.exports = { auditAutopilotBaseline };
```

The implementation must additionally require one contiguous migration sequence from `001` through the highest committed version, reject duplicate versions or filenames and compare every committed file checksum with `schema_migrations`. `databaseMode:"fixture"` applies the committed chain to a newly created disposable database, verifies its rows/checksums and deletes only that validated temporary fixture. `databaseMode:"production"` is strictly read-only: if production lacks a committed migration it returns `PENDING` with `production_migration_cutover_pending`, never GREEN and never applies anything. The abbreviated function above shows the reporting shape, not permission to omit those checks.

Every later CLI that opens SQLite must call `preflightAutopilotDatabase` with its exact required migration list before preparing a statement against a domain table. Fixture mode opens only a fully migrated temporary fixture database. Production mode opens the configured database read-only, checks only the baseline migration metadata first and returns canonical `PENDING` without querying an absent 025–030 table. Unknown or omitted mode fails closed.

Every plan CLI that exposes `--expect` must use `assertExpectedCliVerdict` rather than ad hoc parsing. The option is optional for a human-readable report command, but an automation gate passes `required:true`. An exact allowed-value match exits `0`, a valid mismatch exits `2` and an invalid or required-but-omitted value exits `64`. Omitting the option from a non-gating report leaves that command's documented native exit behaviour unchanged. The helper is read-only: it cannot rewrite, normalise or otherwise alter the report document or its verdict.

- [ ] **Step 4: Add the mode-explicit CLI and package script**

The CLI hashes `db/migrations/*.sql`, calls `auditAutopilotBaseline` and writes JSON plus Markdown under `output/autopilot-baseline/`. `--database-mode fixture` creates a fresh temporary database outside the source checkout, runs the normal migration API there and removes that exact non-reparse fixture after verification. `--database-mode production` reads the configured production `schema_migrations` only and can report `PENDING`; it has no apply flag. `--expect GREEN|PENDING` makes an automation check pass only on that exact verdict and never changes it. `--stdout` emits canonical JSON without writing a report artefact. Database mode is mandatory so a caller cannot accidentally substitute the production database for the fixture gate.

```json
"ops:autopilot:baseline": "node tools/autopilot-baseline-audit.js"
```

- [ ] **Step 5: Run focused tests before commit**

Run:

```powershell
node --test tests/services/autopilot-baseline-audit.test.js tests/services/exact-cli-expectation.test.js tests/db/migrations.test.js
```

Expected: tests PASS. A baseline CLI invocation before commit would correctly report `worktree_not_clean`, so do not claim integrated GREEN yet.

- [ ] **Step 6: Commit**

```powershell
git add package.json lib/runtime/baseline-audit.js lib/ops/exact-cli-expectation.js tools/autopilot-baseline-audit.js tests/services/autopilot-baseline-audit.test.js tests/services/exact-cli-expectation.test.js
git commit -m "feat: verify autonomous runtime baseline"
```

- [ ] **Step 7: Verify the clean committed baseline**

Run:

```powershell
npm run ops:autopilot:baseline -- --database-mode fixture --stdout
npm run ops:autopilot:baseline -- --database-mode production --expect GREEN --stdout
git status --porcelain=v1 --untracked-files=all
```

Expected: fixture report GREEN and `git status` empty. The production report is GREEN only before new unapplied implementation migrations exist; after migrations 025–030 are committed it truthfully becomes `PENDING` until the separately approved cutover. Stop the implementation programme on a dirty tree or fixture failure, but do not migrate production to make this gate pass.

### Task 2: Enforce external production paths and immutable runtime identity

**Files:**
- Create: `lib/runtime/production-paths.js`
- Create: `lib/services/operator-decision-verifier.js`
- Create: `config/operator-trust.schema.json`
- Create: `tests/services/production-paths.test.js`
- Create: `tests/services/operator-decision-verifier.test.js`
- Modify: `lib/ops/approved-runtime-selection.js`
- Modify: `tests/services/approved-runtime-selection.test.js`

**Interfaces:**
- Produces: `resolveProductionPaths({ env, checkoutRoot, fsApi }) -> { dataRoot, db, media, evidence, receipts, logs, backups, control }`
- Produces: `verifyOperatorDecision({ decision, trustRecord, expectedType, expectedBindings, now })`.
- Produces: a hardened `resolveApprovedRuntimeSelection()` that requires a fully clean exact commit and external mutable roots.

- [ ] **Step 1: Write failing containment tests**

```js
test("production paths reject a checkout child and reparse point", () => {
  assert.throws(() => resolveProductionPaths({
    env: { PULSE_DATA_ROOT: "C:/repo/output" },
    checkoutRoot: "C:/repo",
    fsApi: fakeFs({ reparse: false })
  }), /production_data_root_inside_checkout/);
  assert.throws(() => resolveProductionPaths({
    env: { PULSE_DATA_ROOT: "D:/pulse-data" },
    checkoutRoot: "C:/repo",
    fsApi: fakeFs({ reparse: true })
  }), /production_data_root_reparse_point/);
});

test("runtime selection rejects an unsigned or untrusted operator decision", () => {
  assert.throws(() => verifyOperatorDecision({ decision: forgedSelection(), trustRecord: fixtureTrust(), expectedType: "APPROVE_RUNTIME_SELECTION", expectedBindings: RUNTIME_BINDINGS, now: NOW }), /operator_decision_signature_invalid/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/production-paths.test.js tests/services/operator-decision-verifier.test.js tests/services/approved-runtime-selection.test.js`

Expected: FAIL because `production-paths.js` does not exist and current selection ignores untracked files.

- [ ] **Step 3: Implement strict path derivation**

```js
function resolveProductionPaths({ env, checkoutRoot, fsApi }) {
  const dataRoot = fsApi.realpath(env.PULSE_DATA_ROOT);
  const sourceRoot = fsApi.realpath(checkoutRoot);
  if (dataRoot === sourceRoot || dataRoot.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error("production_data_root_inside_checkout");
  }
  if (fsApi.lstat(dataRoot).isSymbolicLink() || fsApi.isReparsePoint(dataRoot)) {
    throw new Error("production_data_root_reparse_point");
  }
  return Object.freeze({
    dataRoot,
    db: path.join(dataRoot, "pulse.db"),
    media: path.join(dataRoot, "media"),
    evidence: path.join(dataRoot, "evidence"),
    receipts: path.join(dataRoot, "receipts"),
    logs: path.join(dataRoot, "logs"),
    backups: path.join(dataRoot, "backups"),
    control: path.join(dataRoot, "control")
  });
}
```

Require `git status --porcelain=v1 --untracked-files=all` to be empty. Bind the full commit, configuration hash, data-root realpath and operator selection decision. Production selection accepts a detached exact commit and must not depend on a mutable branch name. Remove the requirement that `.env`, tokens or `node_modules` live inside the source checkout.

`config/operator-trust.schema.json` defines the external trust-record and immutable-history-entry shapes but contains no real key. `verifyOperatorDecision` resolves the decision's exact key ID, fingerprint and trust-record SHA from `<controlRoot>/operator-trust/history/<key-id>.json`; only new decisions must also match the atomic `<controlRoot>/operator-trust/current.json` pointer. It verifies type, nonce, expiry and complete expected bindings and has no signing API. Historical records are public-key-only, no-overwrite and retained for verification after rotation. Until the operator key is provisioned during cutover, production selection truthfully reports `operator_trust_not_provisioned`; tests use fixture trust history and signatures.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/services/production-paths.test.js tests/services/operator-decision-verifier.test.js tests/services/approved-runtime-selection.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/runtime/production-paths.js lib/services/operator-decision-verifier.js config/operator-trust.schema.json lib/ops/approved-runtime-selection.js tests/services/production-paths.test.js tests/services/operator-decision-verifier.test.js tests/services/approved-runtime-selection.test.js
git commit -m "feat: isolate autonomous runtime data"
```

### Task 3: Add durable controls, component identity and fencing schema

**Files:**
- Create: `db/migrations/025_green_autopilot_runtime_control.sql`
- Create: `lib/repositories/kill_switch.js`
- Create: `lib/repositories/circuit_breakers.js`
- Create: `lib/repositories/runtime_components.js`
- Create: `tests/db/green-autopilot-runtime-control-migration.test.js`
- Create: `tests/services/kill-switch-repository.test.js`
- Create: `tests/services/circuit-breakers-repository.test.js`
- Create: `tests/services/runtime-components-repository.test.js`
- Modify: `lib/repositories/index.js`

**Interfaces:**
- Produces: `repos.killSwitch`, `repos.circuitBreakers` and `repos.runtimeComponents`.
- Adds fencing fields to `runtime_leases` and `jobs` for Tasks 4–6.

- [ ] **Step 1: Write the failing migration and repository tests**

```js
test("a missing kill-switch row is engaged and clearing requires a decision", () => {
  const repos = makeRepos();
  assert.equal(repos.killSwitch.assertClear({ name: "external_mutations" }).clear, false);
  assert.throws(() => repos.killSwitch.clear({ name: "external_mutations", actorId: "op", expectedVersion: 0 }), /authority_decision_required/);
});

test("migration seeds one immutable fail-closed external-mutation switch", () => {
  const row = db.prepare("SELECT * FROM control_switches WHERE name='external_mutations'").get();
  const events = db.prepare("SELECT * FROM control_switch_events WHERE name='external_mutations' ORDER BY version").all();
  assert.equal(row.state, "ENGAGED");
  assert.equal(row.version, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].from_state, null);
  assert.equal(events[0].to_state, "ENGAGED");
  assert.equal(events[0].version, 1);
});

test("only one half-open circuit probe is issued", () => {
  const repos = makeReposWithOpenCircuit();
  const first = repos.circuitBreakers.beforeAttempt({ scope: "youtube", now: NOW });
  const second = repos.circuitBreakers.beforeAttempt({ scope: "youtube", now: NOW });
  assert.ok(first.probeToken);
  assert.equal(second.allowed, false);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/db/green-autopilot-runtime-control-migration.test.js tests/services/kill-switch-repository.test.js tests/services/circuit-breakers-repository.test.js tests/services/runtime-components-repository.test.js`

Expected: FAIL on missing migration and repositories.

- [ ] **Step 3: Add migration 025**

The migration must create:

```sql
CREATE TABLE control_switches (
  name TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('ENGAGED','CLEAR')),
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  authority_decision_id TEXT
);
CREATE TABLE control_switch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  version INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  authority_decision_id TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_control_switch_event_version ON control_switch_events(name, version);
CREATE TRIGGER control_switch_events_no_update BEFORE UPDATE ON control_switch_events BEGIN SELECT RAISE(ABORT, 'immutable_control_switch_events'); END;
CREATE TRIGGER control_switch_events_no_delete BEFORE DELETE ON control_switch_events BEGIN SELECT RAISE(ABORT, 'immutable_control_switch_events'); END;
```

Also create `circuit_breakers` and `runtime_components`, add a monotonic `fencing_token` to `runtime_leases` and add `claim_token` plus `claimed_by` enforcement fields to `jobs`. Use CHECK constraints for states and unique indexes for component identity and half-open probe tokens.

In the same migration transaction, insert exactly one `control_switches` row for `external_mutations` with state `ENGAGED`, version `1`, actor `MIGRATION_025` and reason `FAIL_CLOSED_INITIAL_STATE`, plus its matching immutable initial event from null to `ENGAGED` at version `1`. The insert is part of the migration checksum and cannot be caller-supplied or omitted. Migration tests prove one row/event only and cutover receipts bind their hashes. A missing/corrupt row remains semantically engaged but makes canonical readiness RED.

- [ ] **Step 4: Implement transactional repositories**

Required methods:

```js
killSwitch.bind(db) => ({ get, engage, clear, assertClear })
circuitBreakers.bind(db) => ({ get, beforeAttempt, recordFailure, recordSuccess, open, reset })
runtimeComponents.bind(db) => ({ register, heartbeat, markStopped, listFresh })
```

Every method that changes versioned state must use `WHERE version = ?` and throw `stale_control_version` when `changes !== 1`.

- [ ] **Step 5: Run tests and migration status**

Run:

```powershell
node --test tests/db/green-autopilot-runtime-control-migration.test.js tests/services/kill-switch-repository.test.js tests/services/circuit-breakers-repository.test.js tests/services/runtime-components-repository.test.js tests/db/migrations.test.js
```

Expected: tests PASS. The migration test creates its own temporary pre-025 fixture, proves 025 is pending, applies it only to that fixture and verifies the resulting schema. Do not point any command in this task at `D:\pulse-data\pulse.db`.

- [ ] **Step 6: Commit**

```powershell
git add db/migrations/025_green_autopilot_runtime_control.sql lib/repositories/kill_switch.js lib/repositories/circuit_breakers.js lib/repositories/runtime_components.js lib/repositories/index.js tests/db/green-autopilot-runtime-control-migration.test.js tests/services/kill-switch-repository.test.js tests/services/circuit-breakers-repository.test.js tests/services/runtime-components-repository.test.js
git commit -m "feat: persist autonomous runtime controls"
```

### Task 4: Fence jobs and renew singleton leases

**Files:**
- Create: `lib/services/lease-heartbeat.js`
- Create: `tests/services/lease-heartbeat.test.js`
- Create: `tests/services/jobs-fencing.test.js`
- Create: `tests/services/publisher-lease-heartbeat.test.js`
- Modify: `lib/repositories/jobs.js`
- Modify: `lib/repositories/runtime_leases.js`
- Modify: `lib/services/jobs-runner.js`
- Modify: `lib/services/scheduler-lock.js`
- Modify: `lib/services/publisher-lock.js`

**Interfaces:**
- Produces: `startLeaseHeartbeat({ heartbeat, intervalMs, onLost, signal }) -> { stop, lost }`.
- Changes job terminal methods to require `{ workerId, claimToken }`.
- Changes singleton heartbeat/release methods to require `{ ownerId, fencingToken }`.

- [ ] **Step 1: Write stale-owner and lost-heartbeat tests**

```js
test("a reclaimed job rejects completion by the stale worker", () => {
  const first = repos.jobs.claim({ workerId: "w1", kinds: ["x"] });
  expire(first);
  const second = repos.jobs.claim({ workerId: "w2", kinds: ["x"] });
  assert.throws(() => repos.jobs.complete(first.id, {}, { workerId: "w1", claimToken: first.claim_token }), /stale_job_claim/);
  repos.jobs.complete(second.id, {}, { workerId: "w2", claimToken: second.claim_token });
});

test("lease heartbeat invokes onLost once and stops", async () => {
  let lost = 0;
  const handle = startLeaseHeartbeat({ heartbeat: async () => false, intervalMs: 1, onLost: () => { lost += 1; } });
  await handle.lost;
  assert.equal(lost, 1);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/jobs-fencing.test.js tests/services/lease-heartbeat.test.js tests/services/publisher-lease-heartbeat.test.js`

Expected: FAIL because stale completion currently succeeds and publisher heartbeat is absent.

- [ ] **Step 3: Implement fencing and cooperative cancellation**

`JobsRunner` must create an `AbortController`, pass this fixed context to handlers and abort on timeout or lease loss:

```js
const context = Object.freeze({
  workerId: this.workerId,
  attempt: job.attempt_count,
  claimToken: job.claim_token,
  deadlineAt,
  signal: controller.signal,
  repos: this.repos
});
```

Do not call `fail()` until the handler has observed cancellation and settled. Registration failure is fatal when `registrationRequired:true`.

- [ ] **Step 4: Add publisher renewal**

Export `heartbeatPublisherLease({ ownerId, fencingToken, now })`. Start renewal before long preflight and keep it alive through reconciliation. Losing the lease aborts before any subsequent mutation.

- [ ] **Step 5: Run focused regression**

Run: `node --test tests/services/jobs-repository.test.js tests/services/jobs-runner.test.js tests/services/jobs-fencing.test.js tests/services/scheduler-lock.test.js tests/services/publisher-lock.test.js tests/services/lease-heartbeat.test.js tests/services/publisher-lease-heartbeat.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add lib/services/lease-heartbeat.js lib/repositories/jobs.js lib/repositories/runtime_leases.js lib/services/jobs-runner.js lib/services/scheduler-lock.js lib/services/publisher-lock.js tests/services/lease-heartbeat.test.js tests/services/jobs-fencing.test.js tests/services/publisher-lease-heartbeat.test.js
git commit -m "feat: fence autonomous jobs and leases"
```

### Task 5: Unify durable kill-switch and circuit-breaker semantics

**Files:**
- Create: `lib/services/kill-switch.js`
- Create: `tests/services/durable-kill-switch.test.js`
- Create: `tests/services/durable-circuit-breaker.test.js`
- Modify: `lib/retry.js`
- Modify: `lib/stabilisation/operating-contract.js`
- Modify: `lib/stabilisation/runtime-config.js`
- Modify: `lib/services/publish-dispatch-policy.js`
- Modify: `lib/job-handlers.js`
- Modify: `lib/goal-guarded-live-dispatch-executor.js`
- Modify: `lib/goal-guarded-dispatch-executor-preflight.js`
- Modify: `publisher.js`

**Interfaces:**
- Produces: `buildKillSwitchService({ repo, forcedEngaged, now }) -> { status, assertExternalMutationAllowed, engage, clear }`.
- Changes `withRetry(fn, { breaker, scope, ...options })` to use durable state.

- [ ] **Step 1: Write restart and env-override tests**

```js
test("restart and env clear cannot clear an engaged durable switch", () => {
  repo.engage({ name: "external_mutations", actorId: "ops", reason: "incident", expectedVersion: 0, now: NOW });
  const service = buildKillSwitchService({ repo: reopenRepo(), forcedEngaged: false, now: () => NOW });
  assert.throws(() => service.assertExternalMutationAllowed(), /kill_switch_engaged/);
});

test("open breaker survives a new service instance", () => {
  first.recordFailure({ scope: "youtube", errorClass: "transport", threshold: 1, cooldownMs: 60000, now: NOW });
  assert.equal(second.beforeAttempt({ scope: "youtube", now: NOW }).allowed, false);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/durable-kill-switch.test.js tests/services/durable-circuit-breaker.test.js tests/services/stabilisation-operating-contract.test.js tests/services/retry.test.js`

Expected: FAIL because current state is split between environment variables and process memory.

- [ ] **Step 3: Replace every production consumer**

Use one state vocabulary: `ENGAGED` or `CLEAR`. Missing state is `ENGAGED`. Remove automatic setting of `PULSE_EMERGENCY_KILL_SWITCH=clear` from runtime launchers. `PULSE_EMERGENCY_KILL_SWITCH` may only force `ENGAGED`.

At the final mutation boundary call:

```js
killSwitch.assertExternalMutationAllowed({ expectedVersion: reservation.kill_switch_version });
breaker.beforeAttempt({ scope: `youtube:${accountId}`, now });
```

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/services/durable-kill-switch.test.js tests/services/durable-circuit-breaker.test.js tests/services/stabilisation-operating-contract.test.js tests/services/publish-dispatch-policy.test.js tests/services/retry.test.js`

Expected: PASS and no production reader of `PULSE_KILL_SWITCH_HEALTHY` remains.

- [ ] **Step 5: Commit**

```powershell
git add lib/services/kill-switch.js lib/retry.js lib/stabilisation/operating-contract.js lib/stabilisation/runtime-config.js lib/services/publish-dispatch-policy.js lib/job-handlers.js lib/goal-guarded-live-dispatch-executor.js lib/goal-guarded-dispatch-executor-preflight.js publisher.js tests/services/durable-kill-switch.test.js tests/services/durable-circuit-breaker.test.js
git commit -m "feat: unify durable runtime safety controls"
```

### Task 6: Make schedules, bootstrap and readiness truthful

**Files:**
- Create: `lib/runtime/schedule-reconciler.js`
- Create: `lib/runtime/control-plane-bootstrap.js`
- Create: `lib/runtime/readiness.js`
- Create: `tools/runtime-readiness.js`
- Create: `tests/services/schedule-reconciler.test.js`
- Create: `tests/services/control-plane-bootstrap.test.js`
- Create: `tests/services/runtime-readiness.test.js`
- Create: `tests/services/production-migration-boundary.test.js`
- Create: `tests/ops/runtime-readiness-cli.test.js`
- Modify: `lib/bootstrap-queue.js`
- Modify: `lib/db.js`
- Modify: `lib/migrate.js`
- Modify: `lib/scheduler.js`
- Modify: `server.js`
- Modify: `run.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `reconcileSchedules({ db, definitions, profile, apply })`.
- Produces: `createControlPlaneBootstrap(deps) -> { preflight, start, stop, state }`.
- Produces: `buildReadinessSnapshot(input) -> { schema_version, generated_at, verdict, ready, checks, blockers }`.
- Produces: production `getDb`/bootstrap verify-only semantics; no ordinary runtime owns migration-apply capability.
- Produces: `tools/runtime-readiness.js --database-mode fixture|production [--expect GREEN|PENDING|RED]`, with final migration-set 025–030 schema preflight before any autopilot domain-table read and the shared exact-expect exit contract.

- [ ] **Step 1: Write failing truthfulness tests**

```js
test("inactive scheduler handle makes bootstrap fail and rolls back", async () => {
  const events = [];
  const bootstrap = createControlPlaneBootstrap(fakeDeps({ scheduler: { active: false }, events }));
  await assert.rejects(() => bootstrap.start(), /scheduler_not_active/);
  assert.deepEqual(events, ["lease_acquired", "scheduler_started", "scheduler_stopped", "lease_released"]);
});

test("readiness is RED for a stale required worker", async () => {
  const report = await buildReadinessSnapshot(fixture({ requiredWorkerFresh: false }));
  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes("required_worker_stale:publisher"));
});

test("runtime readiness uses the shared exact-expect exit contract", async () => {
  assert.equal((await runReadinessCli(cliFixture({ verdict: "PENDING", expect: "PENDING" }))).exitCode, 0);
  assert.equal((await runReadinessCli(cliFixture({ verdict: "PENDING", expect: "GREEN" }))).exitCode, 2);
  assert.equal((await runReadinessCli(cliFixture({ verdict: "PENDING", expect: "UNKNOWN" }))).exitCode, 64);
});

test("every partial 025-030 production cutover returns PENDING before a domain query", async () => {
  for (let appliedThrough = 24; appliedThrough < 30; appliedThrough += 1) {
    const probe = cliFixture({ databaseMode: "production", appliedThrough, requiredMigrations: [25, 26, 27, 28, 29, 30] });
    const result = await runReadinessCli(probe);
    assert.equal(result.report.verdict, "PENDING");
    assert.equal(probe.domainQueryCount, 0);
  }
});

test("ordinary production entry points never auto-apply v025-v030", async () => {
  for (const appliedThrough of [24, 25, 26, 27, 28, 29]) {
    for (const entry of [startControlPlane, startBootstrapQueue, startFixedWorker, runReadinessCli]) {
      const probe = productionDatabaseFixture({ appliedThrough });
      const result = await entry(probe);
      assert.match(result.verdict ?? result.status, /PENDING|BLOCKED/);
      assert.equal(probe.migrationStatementCount, 0);
    }
  }
});

test("caller and environment cannot mint migration apply capability", async () => {
  await assert.rejects(() => getDb({ databaseMode: "production", migrationMode: "apply" }), /production_migration_apply_forbidden/);
  await assert.rejects(() => getDb({ databaseMode: "production", migrationCapability: {} }), /production_migration_capability_invalid/);
});

test("healthy SHADOW remains live while publication readiness is intentionally RED", async () => {
  const runtime = await createControlPlaneBootstrap(shadowBootstrapFixture({ localRuntimeReady: true, authorityPhase: "SHADOW", publicationReady: false })).start();
  assert.equal(runtime.state().active, true);
  assert.equal((await request(runtime.app).get("/api/live")).status, 200);
  assert.equal((await request(runtime.app).get("/api/ready?purpose=publication")).status, 503);
  assert.equal((await buildShadowEvidenceReadiness(shadowRuntimeFixture())).verdict, "GREEN");
  assert.equal(runtime.supervisorRestartRequested, false);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/schedule-reconciler.test.js tests/services/control-plane-bootstrap.test.js tests/services/runtime-readiness.test.js tests/services/production-migration-boundary.test.js tests/ops/runtime-readiness-cli.test.js`

Expected: FAIL on missing modules.

- [ ] **Step 3: Implement exact schedule convergence**

`reconcileSchedules` compares and, only with `apply:true`, transactionally converges `cron`, `payload`, `priority`, `kind`, `enabled`, `requires_gpu` and `channel_id`. It enables only schedule IDs in the approved YouTube Phase 1 profile. Report the definition hash and every change.

- [ ] **Step 4: Implement atomic bootstrap and readiness**

Bootstrap order is fixed: runtime identity, external paths, verify-only database migration status/integrity, durable controls, schedule convergence, scheduler lease, scheduler start, required component registration, local/shadow warm-up and HTTP listen. Failure unwinds in reverse order and exits non-zero.

Refactor `lib/db.js` so fixture/test databases may opt into automatic migrations, while every production open is verify-only by construction. `getDb`, `bootstrap-queue`, server, fixed workers and all reporting CLIs must return PENDING/BLOCKED on v024 or any partial 025–029 state and execute zero migration statements. No environment variable, caller object, command-line flag or exported helper may select production apply. The only valid production apply capability is a closure-minted opaque handle inside the later fixed `production-schema-cutover` service, which calls a non-exported migrator path after its signed offline checks. Do not assign the shared singleton until verification succeeds.

Expose:

- `/api/live`: process liveness only
- `/api/ready`: 200 only for canonical GREEN, otherwise 503
- `/api/health`: compatibility summary that never claims scheduler readiness from a truthy handle

Shutdown awaits `bootstrap.stop()` before closing SQLite.

Bootstrap and supervision distinguish process/local-runtime health from publication authority. Healthy `INACTIVE` and `SHADOW` nodes complete bootstrap, listen and remain supervised when verify-only schema, local dependencies, scheduler ownership and required lane heartbeats are healthy. SCM recovery uses `/api/live` plus durable required-component heartbeats only; it never restarts merely because publication `/api/ready` is 503. `/api/ready?purpose=publication` stays 503 in `INACTIVE`/`SHADOW`, while the acceptance service exposes a separate read-only shadow-evidence readiness document that cannot authorise mutation. A local-runtime RED still fails bootstrap or triggers restart according to the bounded budget.

The readiness CLI requires explicit database mode. Fixture mode reads the fully migrated temporary fixture. Its final declared dependency set is exactly migrations 025–030 because later tasks add GPU, content-run, authority, Discord, mutation-attempt and acceptance checks to the same canonical report. Production mode runs the shared schema preflight for that entire set before constructing any domain statement. If any one is absent, out of order or checksum-drifted it returns `PENDING` with the missing migration IDs and zero queries against control, GPU, content, authority, Discord or acceptance tables. Later plans extend the checks but do not weaken or bypass this preflight. When `--expect` is supplied, the allowed values are exactly `GREEN`, `PENDING` and `RED`; the CLI passes the already-built report verdict to `assertExpectedCliVerdict`, so match, mismatch and usage-error exits are `0`, `2` and `64` respectively without changing report bytes.

- [ ] **Step 5: Add package scripts and run regression**

```json
"start:control-plane": "node tools/runtime-control-plane.js",
"ops:runtime:readiness": "node tools/runtime-readiness.js"
```

Run: `node --test tests/services/schedule-reconciler.test.js tests/services/control-plane-bootstrap.test.js tests/services/runtime-readiness.test.js tests/services/production-migration-boundary.test.js tests/ops/runtime-readiness-cli.test.js tests/services/bootstrap-queue.test.js tests/services/stabilisation-scheduler-profile.test.js tests/services/scheduler-plan.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add lib/runtime/schedule-reconciler.js lib/runtime/control-plane-bootstrap.js lib/runtime/readiness.js tools/runtime-readiness.js lib/bootstrap-queue.js lib/db.js lib/migrate.js lib/scheduler.js server.js run.js package.json tests/services/schedule-reconciler.test.js tests/services/control-plane-bootstrap.test.js tests/services/runtime-readiness.test.js tests/services/production-migration-boundary.test.js tests/ops/runtime-readiness-cli.test.js
git commit -m "feat: make autonomous runtime readiness truthful"
```

### Task 7: Isolate and supervise fixed production lanes

**Files:**
- Create: `config/runtime-lanes.json`
- Create: `config/runtime-dependencies.json`
- Create: `config/legacy-runtime-task-conflicts.json`
- Create: `config/legacy-remote-deployments.json`
- Create: `lib/runtime/production-service-installation.js`
- Create: `lib/runtime/legacy-owner-retirement.js`
- Create: `lib/runtime/remote-legacy-deployment-retirement.js`
- Create: `lib/runtime/railway-legacy-deployment-adapter.js`
- Create: `lib/job-handlers/remote-legacy-deployment-audit.js`
- Create: `tools/runtime-control-plane.js`
- Create: `tools/runtime-discovery-worker.js`
- Create: `tools/runtime-editorial-worker.js`
- Create: `tools/runtime-media-worker.js`
- Create: `tools/runtime-render-worker.js`
- Create: `tools/runtime-repair-worker.js`
- Create: `tools/runtime-publisher-worker.js`
- Create: `tools/runtime-analytics-worker.js`
- Create: `tools/windows/install-production-services.ps1`
- Create: `tools/windows/production-supervisor.ps1`
- Create: `tools/windows/retire-legacy-runtime-tasks.ps1`
- Create: `tools/remote-legacy-deployment-retirement.js`
- Create: `tests/services/production-service-installation.test.js`
- Create: `tests/services/legacy-owner-retirement.test.js`
- Create: `tests/services/remote-legacy-deployment-retirement.test.js`
- Create: `tests/services/remote-legacy-deployment-audit.test.js`
- Create: `tests/ops/windows-production-services.test.js`
- Create: `tests/ops/remote-legacy-deployment-retirement-cli.test.js`
- Modify: `lib/runtime/readiness.js`
- Modify: `lib/job-handlers.js`
- Modify: `lib/scheduler.js`
- Modify: `lib/stabilisation/scheduler-profile.js`
- Modify: `tools/machine-boot-supervision-doctor.ps1`
- Modify: `tools/local-live-primary-runtime.ps1`
- Modify: `tests/services/runtime-readiness.test.js`

**Interfaces:**
- Produces fixed entry points with no caller-selected job kinds.
- Produces a plan/apply Windows installer and a read-only verification report, with apply bound to one fixed signed `INSTALL_PRODUCTION_RUNTIME_IDENTITIES` decision.
- Produces: `planProductionServiceInstallation({ approvedRuntimeSelection, productionPaths, laneConfig, dependencyConfig, inventory, now })` and closure-owned `applyProductionServiceInstallation({ fixedSignedDecisionProvider, nativeWindows, now })`.
- Produces: `planLegacyOwnerRetirement({ inventory, expectedRuntime, now })` and `applyLegacyOwnerRetirement({ fixedSignedDecisionProvider, inventory, nativeWindows, now })`.
- Produces: `planRemoteLegacyDeploymentRetirement({ fixedInventory, providerReadback, expectedRuntime, now })` and closure-owned `applyRemoteLegacyDeploymentRetirement({ fixedSignedDecisionProvider, providerAdapter, now })`.
- Produces: `auditRemoteLegacyDeploymentRetirement({ fixedInventory, readOnlyProviderAdapter, priorRetirementReceipt, now }) -> immutableObservationReceipt`; its scheduled handler has no provider mutation methods.

- [ ] **Step 1: Write the failing service-boundary tests**

```js
test("publisher is the only lane allowed a credential capability", () => {
  const lanes = JSON.parse(fs.readFileSync("config/runtime-lanes.json", "utf8"));
  assert.deepEqual(lanes.filter((lane) => lane.capabilities.includes("youtube_credentials")).map((lane) => lane.id), ["publisher"]);
  assert.ok(lanes.every((lane) => lane.expected_service_sid));
  assert.deepEqual(lanes.map((lane) => lane.id).sort(), ["analytics", "control-plane", "discovery", "editorial", "media", "publisher", "render", "repair"]);
});

test("discovery and editorial lanes cannot select publish job kinds", () => {
  assert.throws(() => buildRuntimeDiscoveryWorker({ requestedKinds: ["youtube_publish"] }), /fixed_worker_capability_violation/);
  assert.throws(() => buildRuntimeEditorialWorker({ requestedKinds: ["youtube_publish"] }), /fixed_worker_capability_violation/);
});

test("local inference dependencies are separately supervised", () => {
  const dependencies = JSON.parse(fs.readFileSync("config/runtime-dependencies.json", "utf8"));
  const services = dependencies.filter((row) => row.kind === "service");
  assert.deepEqual(services.map((row) => row.id).sort(), ["ollama", "voxcpm"]);
  assert.ok(services.every((row) => row.service_name && row.readiness_probe));
});

test("every known legacy scheduled owner is disabled before production readiness", async () => {
  const report = await inspectWindowsProductionOwnership(windowsFixture({
    scheduledTasks: [
      legacyTask("Orryy-PulseGaming", "Disabled"),
      legacyTask("PulseGaming-GrowthAutopilot", "Disabled"),
      legacyTask("PulseGaming-LiveWatchdog-Supervisor", "Disabled"),
      legacyTask("PulseGaming-OAuthUptime", "Disabled")
    ]
  }));
  assert.equal(report.legacy_conflict_count, 0);
  const unsafe = await inspectWindowsProductionOwnership(windowsFixture({ scheduledTasks: [legacyTask("PulseGaming-LiveWatchdog-Supervisor", "Running")] }));
  assert.ok(unsafe.blockers.includes("legacy_runtime_task_active:PulseGaming-LiveWatchdog-Supervisor"));
  assert.equal(unsafe.production_ready, false);
});

test("legacy-owner retirement requires one signed fixed decision and proves no surviving child", async () => {
  const result = await applyLegacyOwnerRetirement(legacyRetirementFixture({ decisionType: "RETIRE_LEGACY_RUNTIME_OWNERS" }));
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.running_or_enabled_legacy_owners, 0);
  assert.equal(result.surviving_child_processes, 0);
  assert.equal(result.decision_consumed, true);
  await assert.rejects(() => applyLegacyOwnerRetirement(legacyRetirementFixture({ replay: true })), /legacy_owner_retirement_decision_consumed/);
});

test("service installation is signed, source-bound and leaves every new service stopped", async () => {
  const result = await applyProductionServiceInstallation(serviceInstallFixture({
    decisionType: "INSTALL_PRODUCTION_RUNTIME_IDENTITIES",
    approvedRuntimeSelectionSha256: APPROVED_SELECTION_SHA,
    externalPathsAclSha256: PATHS_ACL_SHA
  }));
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.running_service_count, 0);
  assert.equal(result.startup_mode, "disabled_pending_arm_shadow");
  assert.ok(result.receipt_sha256);
  await assert.rejects(() => applyProductionServiceInstallation(serviceInstallFixture({ replay: true })), /service_install_decision_consumed/);
  await assert.rejects(() => activateProductionServices(activationFixture({ schemaCutoverReceipt: null })), /production_schema_cutover_receipt_required/);
});

test("legacy remote deployment is stopped and stripped of production capability before shadow", async () => {
  const result = await applyRemoteLegacyDeploymentRetirement(remoteRetirementFixture({
    decisionType: "RETIRE_REMOTE_LEGACY_DEPLOYMENT",
    provider: "railway",
    launchSurfaces: ["railway.json", "Procfile"]
  }));
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.remote_runtime_state, "STOPPED");
  assert.equal(result.auto_deploy_enabled, false);
  assert.equal(result.restart_enabled, false);
  assert.equal(result.scheduler_or_worker_count, 0);
  assert.equal(result.production_credential_binding_count, 0);
  assert.equal(result.provider_readback_matches, true);
  assert.equal(result.decision_consumed, true);
});

test("shadow readiness rejects missing, stale or drifted remote retirement evidence", async () => {
  for (const remoteRetirementReceipt of [null, staleRemoteReceipt(), driftedRemoteReceipt()]) {
    const report = await buildReadinessSnapshot(runtimeFixture({ remoteRetirementReceipt }));
    assert.equal(report.shadow_ready, false);
    assert.ok(report.blockers.some((row) => row.startsWith("legacy_remote_deployment_")));
  }
});

test("remote retirement audit is read-only, recurring and bootstrap-caught-up", async () => {
  const first = await handleRemoteLegacyDeploymentAudit(remoteAuditFixture({ dueOccurrence: "2026-08-14T10:00:00Z" }));
  const replay = await handleRemoteLegacyDeploymentAudit(remoteAuditFixture({ dueOccurrence: "2026-08-14T10:00:00Z" }));
  assert.equal(first.verdict, "GREEN");
  assert.equal(first.provider_mutation_count, 0);
  assert.equal(replay.receiptSha256, first.receiptSha256);
  assert.equal(scheduleFor("legacy_remote_deployment_audit").cron, "*/15 * * * *");
  assert.equal(bootstrapCatchupKinds().includes("legacy_remote_deployment_audit"), true);
});

test("remote audit exhaustion blocks readiness but never auto-applies retirement", async () => {
  const result = await handleRemoteLegacyDeploymentAudit(remoteAuditFixture({ providerError: true, attemptsExhausted: true }));
  assert.equal(result.incidentSeverity, "P1");
  assert.equal(result.externalMutationsSwitch, "ENGAGED");
  assert.equal(result.providerMutationCount, 0);
  assert.equal(result.retirementApplyEnqueued, false);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/production-service-installation.test.js tests/services/legacy-owner-retirement.test.js tests/services/remote-legacy-deployment-retirement.test.js tests/services/remote-legacy-deployment-audit.test.js tests/services/runtime-readiness.test.js tests/ops/windows-production-services.test.js tests/ops/remote-legacy-deployment-retirement-cli.test.js tests/services/local-publish-critical-worker.test.js tests/services/local-sqlite-content-worker.test.js`

Expected: FAIL because fixed lane configuration and service installer do not exist.

- [ ] **Step 3: Add fixed lane configuration**

Each lane row must bind `id`, exact entry point, service name, expected account/SID, allowed job kinds, forbidden capabilities, heartbeat SLA, restart budget and data-root ACL requirements. The initial fixed set is control-plane, discovery, editorial, media, render, repair, publisher and analytics. The publisher wrapper starts fail-closed with no publish handler until the authority plan installs the exact implementation. The publisher is a dedicated non-interactive service identity.

Each dependency row binds service ID, exact executable identity from ACL-protected external configuration, service name, service account/SID, readiness probe, restart budget and configuration hash. Ollama and VoxCPM are supervised dependencies rather than children of a content worker. The supervisor may start/stop named services but may not read or inject publisher secrets.

`config/legacy-runtime-task-conflicts.json` binds the exact known legacy task names `Orryy-PulseGaming`, `PulseGaming-GrowthAutopilot`, `PulseGaming-LiveWatchdog-Supervisor` and `PulseGaming-OAuthUptime`, plus their inspected action/principal hashes when available. The doctor also enumerates every other Pulse-labelled scheduled task, configured legacy content-worker task, matching service and matching process command line; an unknown potential owner is a blocker rather than implicitly safe.

`config/legacy-remote-deployments.json` is the closed remote-owner inventory. Its first required row binds the Railway project, environment and service identities from the ACL-protected external control record, the checked-in launch surfaces `railway.json` and `Procfile`, their hashes and the expected legacy command `node server.js`. Unknown production-capable remote deployments, a missing provider identity or an unbound launch surface are blockers. The checked-in file contains schema and fixed logical IDs only; account identifiers live in the external control record and its hash is bound into the approved runtime selection.

- [ ] **Step 4: Implement plan/apply and verification**

`install-production-services.ps1` defaults to plan-only. Plan mode resolves the exact approved clean commit, immutable checkout, external production-root layout and ACL hash, lane/dependency configuration hashes, service names and expected SIDs, then emits canonical decision bytes. `-Apply` accepts no caller path, service identity or authority JSON. It loads only the fixed external operator-signed `INSTALL_PRODUCTION_RUNTIME_IDENTITIES` decision, verifies its approved-runtime-selection SHA, production-path/ACL SHA, lane/dependency hashes, exact service definitions, nonce and expiry, then consumes it once. It uses native PowerShell and SCM commands, never nested `cmd.exe`. It validates targets before writing and does not store passwords in logs or files. Every service is installed in `disabled_pending_arm_shadow`, remains stopped and is proved child-free; a fixed no-overwrite JSON/Markdown receipt binds the actual service SIDs, executable paths, hashes and ACLs. The later supervisor activation path accepts no generic start flag: it requires that exact install receipt, the GREEN production-schema-cutover receipt, initial-authority materialisation receipt and signed `ARM_SHADOW` receipt, then changes only the bound service set to its declared startup modes and starts it. Failure leaves every service disabled and stopped.

`retire-legacy-runtime-tasks.ps1` is a separate fixed plan/apply operation. Plan mode inventories the exact task names, principals, actions, state, child process identities and last result without printing secrets, then emits canonical bytes for decision type `RETIRE_LEGACY_RUNTIME_OWNERS`. `-Apply` accepts no caller path and loads only the fixed external operator-signed decision, verifies its runtime/inventory hashes, nonce and expiry, then consumes it once. It stops only an exact running task/service/process tree and disables the bound owner without deletion. Any unknown or drifted action stops the operation. After apply it proves each legacy owner is disabled, cannot restart and has no surviving child process, then writes fixed no-overwrite JSON and Markdown receipts before the new services or publisher-credential cutover may start. This is a reversible operational retirement, not an automatic implementation action.

The doctor verifies executable path, commit, principal SID, start mode, exact owner, restart budget, ACL and heartbeat identity. SCM service recovery probes `/api/live` and durable lane-heartbeat freshness, never publication `/api/ready`; an intentional INACTIVE/SHADOW 503 therefore cannot cause a restart loop. Canonical readiness and the schema-cutover preflight require zero active or enabled legacy task/service/process conflicts. Generic process existence or a vague one-owner count is insufficient.

Remote retirement is a separate fixed plan/apply ceremony. `node tools/remote-legacy-deployment-retirement.js --plan` performs authenticated read-only provider discovery through the fixed Railway adapter, fully pages the bound project/environment inventory and emits canonical decision bytes without changing deployment state. `--apply` accepts no project, environment, service, command, credential or receipt path. It loads only the fixed one-use `RETIRE_REMOTE_LEGACY_DEPLOYMENT` decision and verifies the approved runtime SHA, external remote-inventory SHA, provider/account/project/environment/service identities, current deployment/readback hash, nonce and expiry. The adapter exposes only the allowlisted reversible operations required to stop or scale the exact legacy service to zero, disable automatic deploy/restart and remove its production credential bindings without reading or logging secret values. It cannot deploy source, start a process, publish, mutate OAuth grants or touch another provider object. If the provider cannot prove all required operations, the ceremony returns `PENDING` and does not arm shadow.

After apply, the adapter performs an independent provider readback and writes fixed no-overwrite JSON and Markdown receipts binding the signed decision, provider object IDs, before/after state hashes and evidence that the legacy command is stopped, replicas are zero, automatic deploy/restart is disabled, no scheduled worker is active and no production credential binding remains. A second read-only observation after the restart grace period must match before the receipt is GREEN. The provider adapter never runs in fixture tests: tests inject a deterministic fake and assert zero network calls on plan validation failure, signature failure, drift, replay or unknown deployment.

Ongoing proof is autonomous and read-only. `legacy_remote_deployment_audit` is owned only by the non-publisher `control-plane` lane with a fixed read-only provider credential capability and adapter surface containing list/get methods only. It runs every 15 minutes and once at bootstrap when no current receipt exists. Each occurrence fully pages the closed inventory, rebinds the retirement receipt and writes one immutable observation receipt with a 30-minute freshness SLA. Retry is bounded to read-only transport failures; dead-letter or any active replica, auto-deploy/restart, schedule, worker, command or production-credential drift creates a P1, engages the external-mutations switch and requalification-suspends active authority. It never invokes or enqueues the apply ceremony. Canonical readiness reads only the durable receipt and never calls the provider synchronously. Production `ARM_SHADOW`, shadow readiness and every later publication-readiness snapshot require the exact initial GREEN retirement receipt plus a fresh matching observation. A stale, missing or drifted observation blocks readiness but never causes an automatic remote mutation.

- [ ] **Step 5: Run tests and plan mode**

Run:

```powershell
node --test tests/services/production-service-installation.test.js tests/services/legacy-owner-retirement.test.js tests/ops/windows-production-services.test.js tests/services/local-publish-critical-worker.test.js tests/services/local-sqlite-content-worker.test.js
powershell -NoProfile -ExecutionPolicy Bypass -File tools/windows/install-production-services.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/windows/retire-legacy-runtime-tasks.ps1
node --test tests/services/remote-legacy-deployment-retirement.test.js tests/services/remote-legacy-deployment-audit.test.js tests/ops/remote-legacy-deployment-retirement-cli.test.js tests/services/runtime-readiness.test.js
node tools/remote-legacy-deployment-retirement.js --plan
```

Expected: tests PASS and plan mode reports proposed services without mutation.

- [ ] **Step 6: Commit**

```powershell
git add config/runtime-lanes.json config/runtime-dependencies.json config/legacy-runtime-task-conflicts.json config/legacy-remote-deployments.json lib/runtime/production-service-installation.js lib/runtime/legacy-owner-retirement.js lib/runtime/remote-legacy-deployment-retirement.js lib/runtime/railway-legacy-deployment-adapter.js lib/job-handlers/remote-legacy-deployment-audit.js lib/job-handlers.js lib/scheduler.js lib/stabilisation/scheduler-profile.js lib/runtime/readiness.js tools/runtime-control-plane.js tools/runtime-discovery-worker.js tools/runtime-editorial-worker.js tools/runtime-media-worker.js tools/runtime-render-worker.js tools/runtime-repair-worker.js tools/runtime-publisher-worker.js tools/runtime-analytics-worker.js tools/remote-legacy-deployment-retirement.js tools/windows/install-production-services.ps1 tools/windows/production-supervisor.ps1 tools/windows/retire-legacy-runtime-tasks.ps1 tools/machine-boot-supervision-doctor.ps1 tools/local-live-primary-runtime.ps1 tests/services/production-service-installation.test.js tests/services/legacy-owner-retirement.test.js tests/services/remote-legacy-deployment-retirement.test.js tests/services/remote-legacy-deployment-audit.test.js tests/services/runtime-readiness.test.js tests/ops/windows-production-services.test.js tests/ops/remote-legacy-deployment-retirement-cli.test.js
git commit -m "feat: isolate autonomous runtime lanes"
```

### Task 8: Bind backup and restore evidence into readiness

**Files:**
- Create: `lib/runtime/backup-evidence.js`
- Create: `lib/job-handlers/runtime-backup-verify.js`
- Create: `tools/runtime-restore-drill.js`
- Create: `tests/services/runtime-backup-evidence.test.js`
- Create: `tests/services/runtime-backup-verify-handler.test.js`
- Create: `tests/ops/runtime-restore-drill-cli.test.js`
- Modify: `config/runtime-lanes.json`
- Modify: `lib/db_backup.js`
- Modify: `lib/bootstrap-queue.js`
- Modify: `lib/job-handlers.js`
- Modify: `lib/scheduler.js`
- Modify: `lib/runtime/readiness.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `createDatabaseBackupEvidence({ db, backupRoot, purpose, now }) -> manifest`.
- Produces: `verifyRestoreDrill({ manifestPath, scratchRoot }) -> report`.
- Produces: `tools/runtime-restore-drill.js --database-mode fixture|production --purpose runtime|schema-cutover`, with purpose-specific shared preflight before any SQLite read.

- [ ] **Step 1: Write failing exact-backup tests**

```js
test("readiness rejects stale or unverified backup evidence", async () => {
  const report = await buildReadinessSnapshot(fixture({ backupAgeHours: 49, restoreVerified: false }));
  assert.ok(report.blockers.includes("backup_evidence_stale"));
  assert.ok(report.blockers.includes("restore_drill_not_verified"));
});

test("restore drill CLI returns PENDING before an absent production-table query", async () => {
  const result = await runRestoreDrillCli(cliFixture({ databaseMode: "production", purpose: "runtime", appliedThrough: 24, requiredMigrations: [25, 26, 27, 28, 29, 30] }));
  assert.equal(result.verdict, "PENDING");
  assert.equal(result.databaseOpenCount, 0);
});

test("schema-cutover backup mode verifies the exact v024 database without future-table queries", async () => {
  const result = await runRestoreDrillCli(cliFixture({ databaseMode: "production", purpose: "schema-cutover", appliedThrough: 24 }));
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.sourceMigrationVersion, 24);
  assert.equal(result.autopilotDomainQueryCount, 0);
  assert.match(result.manifest.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.restore.quick_check, "ok");
});

test("routine backup verification is scheduled, idempotent and freshness-bound", async () => {
  assert.deepEqual(ownerIdsFor("runtime_backup_verify"), ["control-plane"]);
  assert.equal(scheduleFor("runtime_backup_verify").cron, "30 2 * * *");
  const first = await handleRuntimeBackupVerify(runtimeBackupJobFixture({ occurrence: "2026-08-14" }));
  const replay = await handleRuntimeBackupVerify(runtimeBackupJobFixture({ occurrence: "2026-08-14" }));
  assert.equal(replay.receiptSha256, first.receiptSha256);
  assert.equal(first.restore.quick_check, "ok");
  assert.equal(first.restore.integrity_check, "ok");
  const failed = await exhaustRuntimeBackupVerify(runtimeBackupJobFixture({ restoreError: true }));
  assert.equal(failed.deadLettered, true);
  assert.equal(failed.incidentSeverity, "P1");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/runtime-backup-evidence.test.js tests/services/runtime-backup-verify-handler.test.js tests/services/runtime-readiness.test.js tests/ops/runtime-restore-drill-cli.test.js`

Expected: FAIL because backup evidence is not authoritative.

- [ ] **Step 3: Implement SQLite backup API and manifest**

Use the SQLite backup API against a validated external backup path. The manifest binds source database identity, migration version, backup SHA-256, bytes, integrity result and creation timestamp. Restore verification opens a new scratch copy read-only, runs `quick_check`, `integrity_check` and migration status, then writes a separate immutable report.

The CLI requires `--database-mode fixture|production` and `--purpose runtime|schema-cutover`. Fixture mode builds and restores only its declared temporary fixture. Production `runtime` mode requires the final contiguous 025–030 set before opening an autopilot domain table and otherwise returns structured `PENDING`. Production `schema-cutover` mode is the sole pre-cutover exception: it requires an exact contiguous 001–024 migration ledger and approved database identity/path, reads only SQLite metadata and integrity state, creates a SQLite backup through the API, hashes it, restores it to validated scratch storage and runs `quick_check`, `integrity_check` and exact 001–024 checksum verification. It returns RED for any other migration level and never queries a future domain table. Its manifest and restore receipt are marked `PRE_CUTOVER_V024_ONLY` and cannot satisfy post-cutover runtime readiness. The normal post-cutover `runtime` receipt is separate and must bind v030. Neither mode accepts a caller-selected production database path; backup and scratch roots come from validated external production paths. The default is read-only plan/report behaviour and no command in this implementation plan runs a production backup or restore.

Normal post-cutover operation does not depend on an operator rerunning that CLI. Bind `runtime_backup_verify` only to the non-credential `control-plane` lane. The authoritative schedule runs daily at `02:30` UTC and bootstrap enqueues one catch-up occurrence when the last GREEN runtime receipt is older than 24 hours. Its fixed handler uses the same external paths and SQLite backup/restore functions, creates a new same-root scratch directory, restores, runs both integrity checks, verifies the exact 025–030 checksums, then writes immutable manifest and restore receipts before cleaning only its validated scratch directory. The occurrence key is the UTC policy day; replay returns the same receipt. One bounded retry is allowed before dead-letter, which opens a P1 and keeps readiness RED. This routine scratch verification is non-destructive and autonomous. Host-impacting service restart or in-place restore drills remain separate signed operator ceremonies and cannot be inferred from a routine receipt.

- [ ] **Step 4: Add scripts and verify**

```json
"ops:runtime:restore-drill": "node tools/runtime-restore-drill.js"
```

Run: `node --test tests/services/runtime-backup-evidence.test.js tests/services/runtime-backup-verify-handler.test.js tests/services/runtime-readiness.test.js tests/ops/runtime-restore-drill-cli.test.js`

Expected: PASS. Do not run the production apply path during this task.

- [ ] **Step 5: Run the runtime plan gate**

Run:

```powershell
node --test tests/services/autopilot-baseline-audit.test.js tests/services/exact-cli-expectation.test.js tests/services/production-paths.test.js tests/services/kill-switch-repository.test.js tests/services/circuit-breakers-repository.test.js tests/services/runtime-components-repository.test.js tests/services/jobs-fencing.test.js tests/services/control-plane-bootstrap.test.js tests/services/runtime-readiness.test.js tests/ops/runtime-readiness-cli.test.js tests/ops/runtime-restore-drill-cli.test.js tests/ops/windows-production-services.test.js tests/services/runtime-backup-evidence.test.js tests/services/runtime-backup-verify-handler.test.js
npm run ops:agent-rules
npm run docs:doctor
```

Expected: all focused tests and both doctors PASS.

- [ ] **Step 6: Commit**

```powershell
git add config/runtime-lanes.json lib/runtime/backup-evidence.js lib/job-handlers/runtime-backup-verify.js tools/runtime-restore-drill.js lib/db_backup.js lib/bootstrap-queue.js lib/job-handlers.js lib/scheduler.js lib/runtime/readiness.js package.json tests/services/runtime-backup-evidence.test.js tests/services/runtime-backup-verify-handler.test.js tests/ops/runtime-restore-drill-cli.test.js
git commit -m "feat: bind backup recovery to runtime readiness"
```
