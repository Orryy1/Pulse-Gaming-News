# GREEN Autopilot Authority and Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grant standing authority only to exact strict-GREEN release envelopes and deliver them through an isolated, exactly-once YouTube publisher.

**Architecture:** An inactive versioned authority is promoted through operator-signed phase events. A broker signs immutable requests with Ed25519 and a dedicated publisher verifies, reserves, mutates and reconciles without access to content-generation capabilities.

**Tech Stack:** Node.js 24 CommonJS and crypto, better-sqlite3, googleapis YouTube Data API v3, Windows Credential Manager with account-scoped ACLs, Node test runner

**Spec:** `docs/superpowers/specs/2026-08-14-pulse-gaming-green-autopilot-design.md`

## Global Constraints

- Requires the runtime, local-AI and production-conveyor plans.
- Standing authority starts inactive and requires signed shadow, private-canary and public-ramp promotions.
- Only strict GREEN, verified-source, fully rights-complete releases are eligible.
- AMBER and RED are never autonomously published.
- Initial cadence is one YouTube Short daily. Two daily requires 30 clean days and a new promotion event.
- Every ambiguous network outcome is terminal no-retry until reconciliation.
- The publisher has no hunt, editorial, render, repair, OAuth-authorisation or token-write capability.
- No live mutation occurs while implementing this plan.

## File Structure

- `db/migrations/028_autonomous_green_authority.sql`: authority, envelope, request and mutation reservation tables.
- `lib/repositories/autonomous_authorities.js`: versioned standing authority state.
- `lib/repositories/release_envelopes.js`: immutable envelope registry.
- `lib/repositories/publication_requests.js`: signed requests and exactly-once reservations.
- `lib/services/autonomous-green-*.js`: definition, eligibility, envelope and broker services.
- `lib/services/publication-request-signing.js`: canonical Ed25519 signing.
- `lib/services/youtube-publish-critical-*.js`: isolated worker, credential provider and reconciliation.
- `tools/youtube-publish-critical-worker.js`: fixed publisher entry point.

---

### Task 1: Add authority, envelope and publication-request persistence

**Files:**
- Create: `db/migrations/028_autonomous_green_authority.sql`
- Create: `lib/repositories/autonomous_authorities.js`
- Create: `lib/repositories/release_envelopes.js`
- Create: `lib/repositories/publication_requests.js`
- Create: `tests/db/autonomous-green-authority-migration.test.js`
- Create: `tests/db/autonomous-authorities-repository.test.js`
- Create: `tests/db/release-envelopes-repository.test.js`
- Create: `tests/db/publication-requests-repository.test.js`
- Modify: `lib/repositories/index.js`

**Interfaces:**
- Produces: `repos.autonomousAuthorities`, `repos.releaseEnvelopes` and `repos.publicationRequests`.

- [ ] **Step 1: Write failing immutability and reservation tests**

```js
test("authority begins inactive and uses expected-version transitions", () => {
  const row = repos.autonomousAuthorities.create(validDefinition());
  assert.equal(row.phase, "INACTIVE");
  repos.autonomousAuthorities.transition({ authorityId: row.id, expectedVersion: 0, eventType: "ARM_SHADOW", decisionReceipt: DECISION, evidenceSha256: HASH });
  assert.throws(() => repos.autonomousAuthorities.transition({ authorityId: row.id, expectedVersion: 0, eventType: "PROMOTE_PRIVATE_CANARY", decisionReceipt: DECISION, evidenceSha256: HASH }), /stale_authority_version/);
});

test("one capacity generation receives one reservation per exact remote sub-action", () => {
  for (const action of ["VIDEO_INSERT", "CAPTION_INSERT", "STATUS_PROMOTE"]) {
    const input = validReservation({ action, capacityReservationId: "slot-1", generation: 1 });
    const first = repos.publicationRequests.reserveMutation(input);
    assert.equal(first.state, "RESERVED");
    assert.throws(() => repos.publicationRequests.reserveMutation(input), /publication_mutation_already_reserved/);
  }
  assert.equal(repos.publicationRequests.listReservations(ENVELOPE_ID).length, 3);
});

test("signed EXPIRED_UNSTARTED requeue creates one later generation without mutating the old one", () => {
  const old = repos.publicationRequests.reserveMutation(validReservation({ action: "VIDEO_INSERT", capacityReservationId: "slot-1", generation: 1 }));
  repos.publicationRequests.expireUnstarted({ reservationId: old.id, expectedVersion: 0 });
  const next = repos.publicationRequests.reserveMutation(validReservation({ action: "VIDEO_INSERT", capacityReservationId: "slot-2", generation: 2, supersedesReservationId: old.id, requeueDecision: SIGNED_REQUEUE, zeroMatchScan: ZERO_MATCH_SCAN }));
  assert.notEqual(next.id, old.id);
  assert.equal(next.supersedes_reservation_id, old.id);
  assert.throws(() => repos.publicationRequests.reserveMutation(validReservation({ action: "VIDEO_INSERT", capacityReservationId: "slot-3", generation: 2 })), /publication_mutation_generation_invalid/);
  assert.equal(repos.publicationRequests.getReservation(old.id).state, "EXPIRED_UNSTARTED");
});

test("continuations form one immutable request chain under the reservation-bound root", () => {
  const root = repos.publicationRequests.createSignedRequest(rootRequest());
  const child = repos.publicationRequests.reserveContinuation(continuationRequest({ rootRequestId: root.id, rootRequestSha256: root.sha256, parentRequestId: root.id, nextAction: "CAPTION_INSERT" }));
  assert.equal(child.root_request_id, root.id);
  assert.equal(child.parent_request_id, root.id);
  assert.throws(() => repos.publicationRequests.reserveContinuation(continuationRequest({ rootRequestId: root.id, parentRequestId: root.id, nextAction: "CAPTION_INSERT", nonce: "different" })), /publication_continuation_already_reserved/);
  assert.throws(() => repos.publicationRequests.reserveContinuation(continuationRequest({ rootRequestId: root.id, parentRequestId: root.id, nextAction: "STATUS_PROMOTE", authorityVersion: 99 })), /publication_continuation_fork_forbidden/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/db/autonomous-green-authority-migration.test.js tests/db/autonomous-authorities-repository.test.js tests/db/release-envelopes-repository.test.js tests/db/publication-requests-repository.test.js`

Expected: FAIL on missing schema and repositories.

- [ ] **Step 3: Create migration 028**

Every mutation reservation binds an immutable capacity-reservation ID, generation and optional superseded-reservation ID. Generation 1 belongs to the original private-canary budget row or public slot. A later generation is permitted only when it binds a new signed capacity reservation, the immediately prior generation is immutably `EXPIRED_UNSTARTED`, the exact `REQUEUE_EXPIRED_UNSTARTED` decision and zero-match intent-scan receipt verify and no sibling generation exists. Old reservations, attempts and roots are never rebound or deleted.

Create immutable definitions/events, versioned authority state, immutable release envelopes, immutable signed requests with root/parent chain fields, versioned mutation reservations, immutable attempt events, versioned publication-critical health state and immutable health observations. Root requests have `root_request_id=id` and null parent. Continuations bind root ID/SHA, parent ID/SHA, original reservation ID/SHA, next action and new authority version. Put a unique partial constraint on `parent_request_id` for every non-root request, so each request has at most one child regardless of a caller's next-action, version or nonce values. Separate checks enforce the one valid next stage and current authority version. Replay of the same canonical child returns it, while any different child of that parent fails `publication_continuation_fork_forbidden`. Permit authority events only:

```text
MATERIALISE_INACTIVE
ARM_SHADOW
PROMOTE_PRIVATE_CANARY
PROMOTE_PUBLIC_RAMP
PROMOTE_TWO_DAILY
SUSPEND
ESCALATE_SUSPENSION
RESUME
RESET_TO_SHADOW
REVOKE
```

Migration 028 creates schema only and inserts no authority definition or projection. Before materialisation, reporting maps the empty set to semantic `INACTIVE` plus blocker `authority_definition_missing`; it is never publication-ready. The phase projection is fixed: signed `MATERIALISE_INACTIVE -> INACTIVE`, `ARM_SHADOW -> SHADOW`, `PROMOTE_PRIVATE_CANARY -> PRIVATE_CANARY`, `PROMOTE_PUBLIC_RAMP -> PUBLIC_RAMP_ONE_DAILY`, `PROMOTE_TWO_DAILY -> PUBLIC_RAMP_TWO_DAILY`, `SUSPEND -> SUSPENDED`, `ESCALATE_SUSPENSION` keeps `SUSPENDED`, `RESUME -> suspended_from_phase`, `RESET_TO_SHADOW -> SHADOW` and `REVOKE -> REVOKED`. `SUSPEND` records the exact prior phase, a fixed reason class and a detailed reason code. Suspension is monotonic: `ESCALATE_SUSPENSION` may change only `RECOVERABLE_PAUSE -> REQUALIFICATION_REQUIRED`, preserves the original `suspended_from_phase`, increments version and invalidates every outstanding resume challenge. It can never downgrade a requalification hold. `RESUME` is valid only from `SUSPENDED` when the reason class is `RECOVERABLE_PAUSE`; it requires an exact signed resume decision plus a GREEN resume-precondition report, preserves the immutable authority definition and increments the projection version. Commit, configuration, model, policy, operator-trust, broker-trust or worker drift, false GREEN, claims/restrictions and unresolved mutation ambiguity use `REQUALIFICATION_REQUIRED`, which cannot resume. `RESET_TO_SHADOW` then requires a replacement immutable definition with current bindings plus a signed reset decision and invalidates all prior shadow/canary/ramp evidence; fresh shadow and promotions are mandatory. `REVOKED` cannot resume or reset.

Attempt events are `STARTED`, `RETURNED`, `AMBIGUOUS`, `RECOVERED_EXISTING`, `EXPIRED_UNSTARTED`, `RECONCILED` or `CONFIRMED`. Add unique constraints on envelope SHA, request nonce and platform/account/envelope/capacity-reservation/generation/action reservation.

- [ ] **Step 4: Implement transactional repositories**

All definitions, envelopes, requests and events are insert-only. Projection updates require expected version. Publication-critical health observations bind the complete canonical readiness snapshot hash, individual check results and prior aggregate state; the versioned projection makes a GREEN-to-RED edge durable and replay-idempotent. Each remote sub-action has its own unique platform/account/envelope/capacity-reservation/generation/action reservation. `reserveMutation` records `RESERVED` without claiming that network began. Immediately before the corresponding API mutation, a second transaction revalidates the current kill-switch, authority, lease and breaker versions and appends the durable `STARTED` network-attempt sentinel. A crash before `STARTED` may safely resume the same reservation; any uncertainty after `STARTED` is reconciliation-only and never repeats that sub-action.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/db/autonomous-green-authority-migration.test.js tests/db/autonomous-authorities-repository.test.js tests/db/release-envelopes-repository.test.js tests/db/publication-requests-repository.test.js`

Expected: PASS.

```powershell
git add db/migrations/028_autonomous_green_authority.sql lib/repositories/autonomous_authorities.js lib/repositories/release_envelopes.js lib/repositories/publication_requests.js lib/repositories/index.js tests/db/autonomous-green-authority-migration.test.js tests/db/autonomous-authorities-repository.test.js tests/db/release-envelopes-repository.test.js tests/db/publication-requests-repository.test.js
git commit -m "feat: persist autonomous release authority"
```

### Task 2: Implement inactive standing authority and promotion rules

**Files:**
- Create: `lib/services/autonomous-green-authority.js`
- Create: `lib/services/publication-health-sentinel.js`
- Create: `lib/job-handlers/publication-health-sentinel.js`
- Create: `tests/services/autonomous-green-authority.test.js`
- Create: `tests/services/publication-health-sentinel.test.js`
- Modify: `lib/repositories/kill_switch.js`
- Modify: `config/runtime-lanes.json`
- Modify: `lib/bootstrap-queue.js`
- Modify: `lib/job-handlers.js`
- Modify: `lib/runtime/readiness.js`
- Modify: `lib/stabilisation/operating-contract.js`
- Modify: `tests/services/kill-switch-repository.test.js`
- Modify: `tests/services/control-plane-bootstrap.test.js`
- Modify: `tests/services/runtime-readiness.test.js`
- Modify: `tests/ops/windows-production-services.test.js`
- Modify: `tools/runtime-control-plane.js`
- Modify: `tests/services/stabilisation-operating-contract.test.js`
- Modify: `docs/codex-main-goal.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: `buildAutonomousGreenDefinition`, `evaluateAutonomousGreenAuthority`, `transitionAutonomousGreenAuthority` and `ensureRequalificationSuspended`.
- Produces: `observePublicationCriticalHealth({ readinessSnapshot, repos, now }) -> immutableHealthReceipt`.

- [ ] **Step 1: Write exact binding and promotion tests**

```js
test("definition binds immutable runtime and acceptance policy, while reports bind phase events", () => {
  const definition = buildAutonomousGreenDefinition(validDefinitionInput());
  assert.deepEqual(Object.keys(definition.bindings).sort(), ["acceptance_policy", "configuration", "model_set", "operator_trust", "policy_bundle", "production_commit", "publication_request_trust", "publisher_worker", "rights_policy", "source_policy", "youtube_account"].sort());
  assert.equal(definition.bindings.acceptance_policy.sha256, ACCEPTANCE_CORPUS_AND_RULES_SHA);
  const shadow = transitionAutonomousGreenAuthority({ ...fixture({ definition }), eventType: "PROMOTE_PRIVATE_CANARY", decisionReceipt: PRIVATE_CANARY_DECISION, evidenceSha256: SEALED_SHADOW_REPORT });
  assert.equal(shadow.current_phase_evidence_sha256, SEALED_SHADOW_REPORT);
  assert.equal(shadow.definition_sha256, canonicalSha(definition));
  assert.equal(definition.cadence.policy_day_timezone, "UTC");
  assert.equal(definition.cadence.max_per_policy_day, 2);
  assert.deepEqual(definition.cadence.permitted_windows_utc, ["13:00", "19:00"]);
  assert.equal(definition.cadence.window_execution_minutes, 30);
  assert.deepEqual(projectActiveCadence(definition, "PUBLIC_RAMP_ONE_DAILY"), { max_per_policy_day: 1, permitted_windows_utc: ["19:00"], window_execution_minutes: 30 });
  assert.deepEqual(projectActiveCadence(definition, "PUBLIC_RAMP_TWO_DAILY"), { max_per_policy_day: 2, permitted_windows_utc: ["13:00", "19:00"], window_execution_minutes: 30 });
  assert.equal(definition.cadence.minimum_cooldown_minutes, 360);
});

test("public promotion requires a private-canary report and operator decision", () => {
  assert.throws(() => transitionAutonomousGreenAuthority({ ...fixture(), eventType: "PROMOTE_PUBLIC_RAMP", decisionReceipt: null }), /operator_decision_required/);
  assert.throws(() => transitionAutonomousGreenAuthority({ ...fixture(), eventType: "PROMOTE_PUBLIC_RAMP", evidenceSha256: SHADOW_ONLY }), /private_canary_evidence_required/);
});

test("resume restores the recorded prior phase with a new version", () => {
  const suspended = transitionAutonomousGreenAuthority({ ...fixture({ phase: "PUBLIC_RAMP_ONE_DAILY", version: 7 }), eventType: "SUSPEND", reasonClass: "RECOVERABLE_PAUSE", reasonCode: "OPERATOR_PAUSE" });
  const resumed = transitionAutonomousGreenAuthority({ ...fixture(suspended), eventType: "RESUME", decisionReceipt: RESUME_DECISION, resumePrecondition: GREEN_RESUME });
  assert.equal(resumed.phase, "PUBLIC_RAMP_ONE_DAILY");
  assert.equal(resumed.version, 9);
  assert.equal(resumed.definition_sha256, suspended.definition_sha256);
});

test("binding drift cannot resume and must reset through a new shadow definition", () => {
  const suspended = transitionAutonomousGreenAuthority({ ...fixture({ phase: "PUBLIC_RAMP_ONE_DAILY" }), eventType: "SUSPEND", reasonClass: "REQUALIFICATION_REQUIRED", reasonCode: "CONFIGURATION_DRIFT" });
  assert.throws(() => transitionAutonomousGreenAuthority({ ...fixture(suspended), eventType: "RESUME", decisionReceipt: RESUME_DECISION }), /fresh_shadow_required/);
  const reset = transitionAutonomousGreenAuthority({ ...fixture(suspended), eventType: "RESET_TO_SHADOW", replacementDefinition: CURRENT_DEFINITION, decisionReceipt: RESET_DECISION });
  assert.equal(reset.phase, "SHADOW");
  assert.equal(reset.prior_phase_evidence_valid, false);
  assert.equal(killSwitch.get("external_mutations").state, "ENGAGED");
});

test("fresh private-canary promotion atomically re-arms a requalified shadow", () => {
  assert.throws(() => transitionAutonomousGreenAuthority(requalifiedShadowFixture({ eventType: "PROMOTE_PRIVATE_CANARY", expectedSwitchVersion: 10 })), /stale_kill_switch_version/);
  assert.equal(authorityRepo.current().phase, "SHADOW");
  const promoted = transitionAutonomousGreenAuthority(requalifiedShadowFixture({
    eventType: "PROMOTE_PRIVATE_CANARY",
    decisionReceipt: PRIVATE_CANARY_DECISION,
    evidenceSha256: FRESH_SHADOW_REPORT,
    expectedSwitchVersion: 11
  }));
  assert.equal(promoted.phase, "PRIVATE_CANARY");
  assert.equal(killSwitch.get("external_mutations").state, "CLEAR");
  assert.equal(killSwitch.get("external_mutations").version, 12);
});

test("the initial shadow promotion also clears the exact default-engaged switch", () => {
  const isolated = initialShadowFixture({ switchState: "ENGAGED", switchVersion: 1, shadowReportSha: INITIAL_SHADOW_REPORT });
  const promoted = transitionAutonomousGreenAuthority({ ...isolated, eventType: "PROMOTE_PRIVATE_CANARY", decisionReceipt: PRIVATE_CANARY_DECISION, expectedSwitchVersion: 1 });
  assert.equal(promoted.phase, "PRIVATE_CANARY");
  assert.equal(isolated.killSwitch.get("external_mutations").state, "CLEAR");
  assert.equal(isolated.killSwitch.get("external_mutations").version, 2);
});

test("canonical readiness is publication-aware across authority phases", async () => {
  const shadow = await buildReadinessSnapshot(readyRuntimeFixture({ authorityPhase: "SHADOW", killSwitch: "ENGAGED" }));
  assert.equal(shadow.verdict, "RED");
  assert.ok(shadow.blockers.includes("authority_not_armed"));
  const canary = await buildReadinessSnapshot(readyRuntimeFixture({ authorityPhase: "PRIVATE_CANARY", killSwitch: "CLEAR", openP0: 0, openP1: 0 }));
  assert.equal(canary.verdict, "GREEN");
  assert.equal(canary.ready, true);
  assert.equal((await buildReadinessSnapshot(readyRuntimeFixture({ authorityPhase: "PUBLIC_RAMP_ONE_DAILY", killSwitch: "ENGAGED" }))).verdict, "RED");
});

test("suspension races can only escalate and never restore a weaker pause", async () => {
  for (const order of [["pause", "ambiguity"], ["ambiguity", "pause"]]) {
    const isolated = authorityRaceFixture();
    await runSuspensionRace(isolated, order);
    assert.equal(isolated.authority.current().phase, "SUSPENDED");
    assert.equal(isolated.authority.current().suspension_reason_class, "REQUALIFICATION_REQUIRED");
    assert.equal(isolated.authority.current().suspended_from_phase, "PUBLIC_RAMP_ONE_DAILY");
    assert.equal(isolated.resumeChallenges.activeCount(), 0);
  }
  const paused = authorityRaceFixture({ suspensionReasonClass: "RECOVERABLE_PAUSE" });
  await ensureRequalificationSuspended({ ...paused, reasonCode: "EMERGENCY_KILL" });
  assert.equal(paused.authority.current().suspension_reason_class, "REQUALIFICATION_REQUIRED");
  assert.throws(() => transitionAutonomousGreenAuthority({ ...paused, eventType: "SUSPEND", reasonClass: "RECOVERABLE_PAUSE" }), /suspension_downgrade_forbidden/);
});

test("required health GREEN-to-RED suspends active authority and recovery alone cannot resume", async () => {
  const isolated = activeAuthorityFixture();
  await observePublicationCriticalHealth({ ...isolated, readinessSnapshot: publicationHealth("GREEN") });
  const failed = await observePublicationCriticalHealth({ ...isolated, readinessSnapshot: publicationHealth("RED", { failedCheck: "publisher_lease" }) });
  assert.equal(failed.authority.phase, "SUSPENDED");
  assert.equal(failed.authority.suspension_reason_class, "REQUALIFICATION_REQUIRED");
  assert.equal(failed.authority.suspension_reason_code, "REQUIRED_HEALTH_FAILURE:publisher_lease");
  assert.equal(failed.killSwitch.state, "ENGAGED");
  await observePublicationCriticalHealth({ ...isolated, readinessSnapshot: publicationHealth("GREEN") });
  assert.equal(isolated.authority.current().phase, "SUSPENDED");
});

test("pause and required-health races converge on requalification", async () => {
  for (const order of [["pause", "health"], ["health", "pause"]]) {
    const isolated = activeAuthorityFixture();
    await runHealthPauseRace(isolated, order);
    assert.equal(isolated.authority.current().suspension_reason_class, "REQUALIFICATION_REQUIRED");
    assert.equal(isolated.killSwitch.get("external_mutations").state, "ENGAGED");
    assert.equal(isolated.resumeChallenges.activeCount(), 0);
  }
});

test("the fixed control-plane sentinel observes before publication and survives restart", async () => {
  assert.deepEqual(ownerIdsFor("publication_health_sentinel"), ["control-plane"]);
  const started = await startControlPlaneSentinel(sentinelFixture({ intervalMs: 5000, initialReadiness: "GREEN" }));
  assert.equal(started.initialObservationPersisted, true);
  await started.requiredCheckChanged("publisher_lease", "RED");
  assert.equal(authorityRepo.current().suspension_reason_code, "REQUIRED_HEALTH_FAILURE:publisher_lease");
  await restartControlPlane();
  assert.equal(latestSentinelReceipt().authorityPhase, "SUSPENDED");
  assert.equal(killSwitch.get("external_mutations").state, "ENGAGED");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autonomous-green-authority.test.js tests/services/publication-health-sentinel.test.js tests/services/stabilisation-operating-contract.test.js`

Expected: FAIL on missing authority service and old per-story contract.

- [ ] **Step 3: Implement definition and evaluation**

```js
function evaluateAutonomousGreenAuthority({ definition, state, currentRuntime, now }) {
  const blockers = compareBindings(definition.bindings, currentRuntime);
  if (!["PRIVATE_CANARY", "PUBLIC_RAMP_ONE_DAILY", "PUBLIC_RAMP_TWO_DAILY"].includes(state.phase)) blockers.push("authority_not_armed");
  if (Date.parse(state.expires_at) <= now.getTime()) blockers.push("authority_expired");
  return { verdict: blockers.length ? "RED" : "GREEN", active: blockers.length === 0, phase: state.phase, version: state.version, blockers, bindingSha256: canonicalSha(definition) };
}
```

`operator_trust` and `publication_request_trust` each bind the fixed external trust-record path, SHA-256, bytes, key ID and public-key fingerprint. Any rotation or drift suspends authority and changes the overall definition binding.

Initial `ARM_SHADOW` and every `RESET_TO_SHADOW` leave or place `external_mutations` in `ENGAGED` and record its exact version on the shadow projection. Shadow processing and evidence collection need no external-mutation permission. After a complete shadow report, whether this is first cutover or requalification, the signed `PROMOTE_PRIVATE_CANARY` transaction is the sole re-arm ceremony: it verifies the current definition, sealed fresh evidence, operator decision and expected engaged switch version, clears that exact switch version and appends the authority promotion atomically. If either write or version check fails, both roll back and the system remains `SHADOW` plus `ENGAGED`. Ordinary Discord `resume` remains forbidden for every `REQUALIFICATION_REQUIRED` suspension.

Wire the evaluated authority into `buildReadinessSnapshot` and `/api/ready`. Canonical publication readiness is RED with `authority_not_armed` in `INACTIVE` or `SHADOW`, even when local runtime probes are healthy. It may be GREEN only in `PRIVATE_CANARY`, `PUBLIC_RAMP_ONE_DAILY` or `PUBLIC_RAMP_TWO_DAILY` when all bound identities match, `external_mutations` is exactly `CLEAR`, no P0/P1 is open and every other publication-critical check is GREEN. `SUSPENDED`, `REVOKED`, expired or drifted authority is always RED. The separate acceptance programme may call a SHADOW-specific readiness view for evidence collection, but it cannot make `/api/ready` publication-GREEN.

All kill, ambiguity, claim, drift, false-GREEN and required publication-health failure paths call `ensureRequalificationSuspended`. Bind `publication_health_sentinel` only to the non-credential `control-plane` lane. Bootstrap enqueues and waits for its first canonical observation before any publication-ready state is possible. The control-plane service then enqueues one idempotent five-second bucket and every repository/service that changes a required check immediately enqueues the current bucket; queue uniqueness coalesces duplicates. The handler builds one read-only canonical readiness snapshot, persists its complete hash and feeds `publication-health-sentinel`. Canonical readiness only reads the latest receipt and marks publication RED when it is older than ten seconds; it never runs the sentinel recursively. While authority is active, the first observed required publication-critical check transition from GREEN to RED atomically records the failing check, engages the switch and invokes the monotonic suspension with code `REQUIRED_HEALTH_FAILURE:<check>`. Every publisher mutation boundary independently rebuilds the required snapshot and, if RED, invokes the same observer before returning without mutation, so a failure cannot slip through between sentinel buckets. Probe recovery may append a GREEN health observation but cannot restore authority or clear the switch; signed reset, fresh shadow and fresh promotions remain mandatory. Advisory Discord communication failures are excluded from the required-health set unless they expose a separate safety failure. The helper uses an expected-version compare-and-swap loop only on local SQLite projection state: active phases append `SUSPEND`, a recoverable suspension appends `ESCALATE_SUSPENSION`, and an existing requalification suspension is returned unchanged. The operation retries only stale local projection versions, never a platform mutation. A concurrent pause may not overwrite the stronger class. Escalation preserves the original phase, engages the durable switch in the same transaction and consumes all resume challenges.

The immutable cadence is a ceiling, not a grant. It binds at most two UTC policy-day releases, both permitted windows, `13:00` and `19:00`, and a fixed 30-minute execution interval beginning at each window. `projectActiveCadence` narrows the active state to one release at `19:00` in `PUBLIC_RAMP_ONE_DAILY` and two releases across both windows only in `PUBLIC_RAMP_TWO_DAILY`. Promotion changes the versioned phase projection, never the definition bytes.

- [ ] **Step 4: Amend repository operating law**

State explicitly that exact armed `AUTONOMOUS_GREEN` envelopes satisfy the required operator review through the signed policy-level decision. Per-story review remains mandatory for every other path. Design approval alone remains non-operative.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/autonomous-green-authority.test.js tests/services/publication-health-sentinel.test.js tests/services/kill-switch-repository.test.js tests/services/control-plane-bootstrap.test.js tests/services/runtime-readiness.test.js tests/services/stabilisation-operating-contract.test.js tests/services/agent-operating-rules.test.js tests/ops/windows-production-services.test.js`

Expected: PASS.

```powershell
git add config/runtime-lanes.json lib/services/autonomous-green-authority.js lib/services/publication-health-sentinel.js lib/job-handlers/publication-health-sentinel.js lib/repositories/kill_switch.js lib/bootstrap-queue.js lib/job-handlers.js lib/runtime/readiness.js lib/stabilisation/operating-contract.js tools/runtime-control-plane.js docs/codex-main-goal.md AGENTS.md tests/services/autonomous-green-authority.test.js tests/services/publication-health-sentinel.test.js tests/services/kill-switch-repository.test.js tests/services/control-plane-bootstrap.test.js tests/services/runtime-readiness.test.js tests/services/stabilisation-operating-contract.test.js tests/ops/windows-production-services.test.js
git commit -m "feat: define autonomous green standing authority"
```

### Task 3: Enforce strict GREEN eligibility

**Files:**
- Create: `lib/services/autonomous-green-eligibility.js`
- Create: `tests/services/autonomous-green-eligibility.test.js`
- Modify: `lib/goal19-autonomy-control-tower.js`
- Modify: `lib/stabilisation/publish-manifest-gate.js`

**Interfaces:**
- Produces: `evaluateAutonomousGreenContent({ storyPackage, releaseCandidate, controlTowerStory, now })`.
- Produces: `evaluateAutonomousGreenPublication({ contentResult, currentAuthority, runtime, publishWindow, now })`.

- [ ] **Step 1: Write exhaustive negative tests**

```js
for (const [name, patch] of [
  ["rumour", { source_class: "rumour" }],
  ["editorial exception", { rights_basis: "editorial_exception" }],
  ["amber", { control_tower: "AMBER" }],
  ["public copy", { public_copy_verdict: "RED" }],
  ["stale", { evidence_age_ms: 999999999 }],
  ["duplicate", { duplicate: true }]
]) {
  test(`content gate rejects ${name}`, () => assert.equal(evaluateAutonomousGreenContent(fixture(patch)).verdict, "RED"));
}

test("strict content can be GREEN while SHADOW publication remains RED", () => {
  const contentResult = evaluateAutonomousGreenContent(fixture());
  const publication = evaluateAutonomousGreenPublication(publicationFixture({ contentResult, authorityPhase: "SHADOW" }));
  assert.equal(contentResult.verdict, "GREEN");
  assert.equal(publication.verdict, "RED");
  assert.ok(publication.blockers.includes("authority_not_armed"));
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autonomous-green-eligibility.test.js tests/services/goal19-autonomy-control-tower.test.js tests/services/stabilisation-publish-manifest-gate.test.js`

Expected: FAIL on missing eligibility service.

- [ ] **Step 3: Implement deterministic conjunction**

The content gate requires every named source, claim, rights, media, QA and final public-copy receipt and returns a sorted blocker list. It does not compute a weighted score. V15's accepted editorial exception is a negative fixture and cannot pass this service. Publication eligibility is a separate conjunction over content GREEN, an armed exact authority phase, runtime identity and the active publication window. `SHADOW` can therefore prove content GREEN without ever reporting publish eligibility GREEN.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/services/autonomous-green-eligibility.test.js tests/services/goal19-autonomy-control-tower.test.js tests/services/stabilisation-publish-manifest-gate.test.js`

Expected: PASS.

```powershell
git add lib/services/autonomous-green-eligibility.js lib/goal19-autonomy-control-tower.js lib/stabilisation/publish-manifest-gate.js tests/services/autonomous-green-eligibility.test.js
git commit -m "feat: enforce strict autonomous green eligibility"
```

### Task 4: Build canonical immutable release envelopes

**Files:**
- Create: `lib/services/canonical-json.js`
- Create: `lib/services/autonomous-green-release-envelope.js`
- Create: `lib/job-handlers/autopilot-envelope-prepare.js`
- Create: `tests/services/canonical-json.test.js`
- Create: `tests/services/autonomous-green-release-envelope.test.js`
- Create: `tests/services/autopilot-envelope-prepare.test.js`
- Modify: `config/runtime-lanes.json`
- Modify: `lib/job-handlers.js`
- Modify: `lib/job-handlers/autopilot-release-candidate.js`
- Modify: `lib/repositories/autonomous_content_runs.js`
- Modify: `tests/services/autonomous-content-runs.test.js`

**Interfaces:**
- Produces: `buildAutonomousGreenReleaseEnvelope(input, io)` and `validateAutonomousGreenReleaseEnvelope(input)`.
- Produces: `runAutopilotEnvelopePrepare({ runId, expectedQaEvidenceSha256, repos, io, now })`.

- [ ] **Step 1: Write canonicalisation and tamper tests**

```js
test("canonical JSON is stable across key order", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});

test("changed caption, rights or render byte invalidates envelope", async () => {
  const envelope = await buildAutonomousGreenReleaseEnvelope(validEnvelopeInput(), fixtureIo());
  for (const path of [CAPTION, RIGHTS, VIDEO]) {
    const io = fixtureIo({ mutate: path });
    assert.equal((await validateAutonomousGreenReleaseEnvelope({ envelope: envelope.document, authoritySnapshot: AUTH, currentRuntime: RUNTIME, now: NOW, io })).verdict, "RED");
  }
});

test("a durable release candidate enqueues one envelope job and restart creates one envelope transition", async () => {
  const candidate = await runAutopilotReleaseCandidate(releaseCandidateFixture({ verdict: "GREEN_CANDIDATE" }));
  assert.equal(candidate.runState, "QA_GREEN");
  assert.equal(candidate.candidateCount, 1);
  assert.equal(listJobs({ kind: "autopilot_envelope_prepare" }).length, 1);
  const isolated = envelopeCrashFixture({ crashAfterAtomicRename: true });
  await assert.rejects(() => runAutopilotEnvelopePrepare(isolated), /simulated_crash/);
  const recovered = await runAutopilotEnvelopePrepare(isolated);
  assert.equal(recovered.state, "ENVELOPED");
  assert.equal(isolated.envelopeFiles.length, 1);
  assert.equal(isolated.registeredEnvelopes.length, 1);
  assert.equal(isolated.transitionCount("QA_GREEN", "ENVELOPED"), 1);
});

test("shadow envelope preparation never creates a publication request", async () => {
  const result = await runAutopilotEnvelopePrepare(envelopeFixture({ authorityPhase: "SHADOW" }));
  assert.equal(result.shadowPreflight.verdict, "GREEN_NO_PUBLICATION_REQUEST");
  assert.equal(result.publicationRequestCount, 0);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/canonical-json.test.js tests/services/autonomous-green-release-envelope.test.js tests/services/autopilot-envelope-prepare.test.js`

Expected: FAIL on missing modules.

- [ ] **Step 3: Bind the complete release**

The envelope includes exact source, claim, script, LLM receipt, audio, timestamp, caption, media placement, rights, render, QA, policy, metadata, anti-spam, runtime, account, worker, window and authority hashes. It also derives one non-secret `intent_marker` tag from the already immutable release-candidate SHA, includes it in the final audited YouTube tag set and forbids caller override, so a future read-only uploads scan can identify remote intent without changing metadata later. It contains relative confined paths plus SHA-256 and bytes for materialised files.

- [ ] **Step 4: Persist only after full validation**

Extend the existing `autopilot_release_candidate` handler so its transaction enqueues one `autopilot_envelope_prepare` job only after the exact candidate SHA is durable, keyed by `<runId>:envelope:<candidateSha256>`. A final-QA job never queues envelope preparation directly. Bind the envelope kind only to the fixed render lane; it has no broker signing key or platform credentials. The envelope handler reloads the exact `QA_GREEN` run, complete durable release-candidate evidence and expected QA and candidate SHAs. Write to same-parent staging with exclusive files, validate from bytes and rename atomically. In one database transaction idempotently register the envelope SHA, record the shadow preflight and transition its exact content run from `QA_GREEN -> ENVELOPED` by expected version. Restart after the QA, candidate, enqueue, file or database boundary converges on one candidate, one envelope job, one envelope file, one registration and one transition. In `SHADOW` it emits `GREEN_NO_PUBLICATION_REQUEST` and does not import the broker, create a signed request or enqueue the publisher. No caller-provided output root is accepted and a run in any other state is rejected.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/canonical-json.test.js tests/services/autonomous-green-release-envelope.test.js tests/services/autopilot-envelope-prepare.test.js tests/services/autopilot-final-qa-stage.test.js tests/services/autonomous-content-runs.test.js tests/services/short-release-evidence-finalizer.test.js`

Expected: PASS.

```powershell
git add config/runtime-lanes.json lib/services/canonical-json.js lib/services/autonomous-green-release-envelope.js lib/job-handlers/autopilot-envelope-prepare.js lib/job-handlers/autopilot-release-candidate.js lib/job-handlers.js lib/repositories/autonomous_content_runs.js tests/services/canonical-json.test.js tests/services/autonomous-green-release-envelope.test.js tests/services/autopilot-envelope-prepare.test.js tests/services/autonomous-content-runs.test.js
git commit -m "feat: seal autonomous release envelopes"
```

### Task 5: Sign publication requests through the authority broker

**Files:**
- Create: `lib/services/publication-request-signing.js`
- Create: `lib/services/public-key-trust-history.js`
- Create: `lib/services/publication-action-contract.js`
- Create: `lib/services/autonomous-green-authority-broker.js`
- Create: `lib/services/windows-authority-signing-key-provider.js`
- Create: `config/publication-request-trust.schema.json`
- Create: `tools/autonomous-green-broker-worker.js`
- Create: `tools/windows/provision-authority-broker-key.ps1`
- Create: `tests/services/publication-request-signing.test.js`
- Create: `tests/services/public-key-trust-history.test.js`
- Create: `tests/services/publication-action-contract.test.js`
- Create: `tests/services/autonomous-green-authority-broker.test.js`
- Create: `tests/services/authority-signing-key-provider.test.js`

**Interfaces:**
- Produces: `signPublicationRequest`, `verifyPublicationRequest` and `brokerAutonomousGreenRelease`.
- Produces: `resolveHistoricalVerificationKey({ trustRoot, keyId, fingerprint, signedAt, io }) -> verifiedPublicKeyHandle`.
- Produces: `assertPhaseActionContract({ phase, action, publicationSlot, privateCanary, continuation })`.
- Produces: `createAuthoritySigningKeyProvider({ workerIdentity, credentialReader, trustRecord }) -> { signCanonical }`.
- Produces: `planAuthorityBrokerKeyProvisioning({ installedBrokerIdentityReceipt, trustSchema, controlRootReceipt, now })` and a closure-owned one-use signed apply path.

- [ ] **Step 1: Write signature, expiry and forged-request tests**

```js
test("Ed25519 request rejects tamper, expiry and wrong worker", () => {
  const signed = signPublicationRequest(validRequest(), keys.privateKey);
  assert.equal(verifyPublicationRequest({ request: signed, publicKey: keys.publicKey, expectedPublisherWorkerId: "publisher-1", now: NOW }).valid, true);
  assert.equal(verifyPublicationRequest({ request: { ...signed, action: "public" }, publicKey: keys.publicKey, expectedPublisherWorkerId: "publisher-1", now: NOW }).valid, false);
  assert.equal(verifyPublicationRequest({ request: signed, publicKey: keys.publicKey, expectedPublisherWorkerId: "publisher-2", now: NOW }).valid, false);
});

test("base signing preserves explicit reservation fields before acceptance is armed", () => {
  const signed = signPublicationRequest(validRequest({ action: "PRIVATE_UPLOAD", publication_slot: null, private_canary: null, continuation: null }), keys.privateKey);
  assert.equal(signed.publication_slot, null);
  assert.equal(signed.private_canary, null);
  assert.equal(signed.continuation, null);
  assert.equal(verifyPublicationRequest({ request: signed, publicKey: keys.publicKey, expectedPublisherWorkerId: "publisher-1", now: NOW }).valid, true);
});

test("phase and publication action use one closed contract", () => {
  assert.doesNotThrow(() => assertPhaseActionContract({ phase: "PRIVATE_CANARY", action: "PRIVATE_UPLOAD", publicationSlot: null, privateCanary: PRIVATE_CANARY_RESERVATION, continuation: null }));
  assert.doesNotThrow(() => assertPhaseActionContract({ phase: "PUBLIC_RAMP_ONE_DAILY", action: "PUBLIC_RELEASE", publicationSlot: PUBLIC_SLOT, privateCanary: null, continuation: null }));
  assert.doesNotThrow(() => assertPhaseActionContract({ phase: "PUBLIC_RAMP_TWO_DAILY", action: "PUBLIC_RELEASE", publicationSlot: PUBLIC_SLOT, privateCanary: null, continuation: null }));
  assert.throws(() => assertPhaseActionContract({ phase: "PRIVATE_CANARY", action: "PRIVATE_UPLOAD", publicationSlot: null, privateCanary: null }), /private_canary_reservation_required/);
  assert.throws(() => assertPhaseActionContract({ phase: "PRIVATE_CANARY", action: "PUBLIC_RELEASE", publicationSlot: PUBLIC_SLOT }), /phase_action_forbidden/);
  assert.throws(() => assertPhaseActionContract({ phase: "PUBLIC_RAMP_ONE_DAILY", action: "PRIVATE_UPLOAD", publicationSlot: null }), /phase_action_forbidden/);
  assert.throws(() => assertPhaseActionContract({ phase: "SHADOW", action: "PRIVATE_UPLOAD", publicationSlot: null }), /phase_action_forbidden/);
});

test("broker key provider rejects the wrong service SID and never exports private key bytes", async () => {
  await assert.rejects(() => providerForSid("wrong").signCanonical(BYTES), /authority_broker_identity_not_authorised/);
  assert.equal("exportPrivateKey" in providerForSid(BROKER_SID), false);
});

test("broker key is provisioned only after its fixed SID exists and under a signed decision", async () => {
  await assert.rejects(() => applyAuthorityBrokerKeyProvisioning(brokerKeyFixture({ installedBrokerIdentityReceipt: null })), /installed_broker_identity_required/);
  const first = await applyAuthorityBrokerKeyProvisioning(brokerKeyFixture({ decisionType: "PROVISION_AUTHORITY_BROKER_KEY" }));
  assert.equal(first.verdict, "GREEN");
  assert.equal(first.credentialTarget, "PulseGaming/AuthorityBrokerSigning");
  assert.equal(first.privateKeyBytesExposed, 0);
  assert.ok(first.trustRecordSha256);
  await assert.rejects(() => applyAuthorityBrokerKeyProvisioning(brokerKeyFixture({ replay: true })), /broker_key_provision_decision_consumed/);
});

test("key rotation retains the exact historical verification key for an ambiguous request", async () => {
  const original = signPublicationRequest(validRequest({ signingKeyId: "broker-k1" }), brokerK1.privateKey);
  await rotateBrokerKeyToK2(trustHistoryFixture({ nonterminalRequest: original }));
  const key = resolveHistoricalVerificationKey({ trustRoot: TRUST_ROOT, keyId: "broker-k1", fingerprint: brokerK1.fingerprint, signedAt: original.issued_at, io: fixtureIo });
  assert.equal(verifyPublicationRequest({ request: original, publicKey: key, expectedPublisherWorkerId: "publisher-1", now: LATER, mode: "reconciliation" }).valid, true);
  assert.equal(loadTrustHistory("broker-k1").record.sha256, brokerK1.originalRecordSha256);
  assert.equal(loadTrustHistory("broker-k1").effectiveStatus, "VERIFICATION_ONLY_RETAINED");
  assert.equal(loadTrustHistory("broker-k1").statusEvent.previous_record_sha256, brokerK1.originalRecordSha256);
  assert.throws(() => resolveHistoricalVerificationKey({ trustRoot: TRUST_ROOT, keyId: "unknown", fingerprint: "0".repeat(64), signedAt: original.issued_at, io: fixtureIo }), /historical_trust_not_found/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/publication-request-signing.test.js tests/services/public-key-trust-history.test.js tests/services/publication-action-contract.test.js tests/services/autonomous-green-authority-broker.test.js tests/services/authority-signing-key-provider.test.js`

Expected: FAIL on missing modules.

- [ ] **Step 3: Implement canonical Ed25519 signing**

Use a distinct Ed25519 key stored in the authority-broker service account's fixed Windows Credential Manager target `PulseGaming/AuthorityBrokerSigning`. `windows-authority-signing-key-provider.js` verifies the exact broker SID, reads that target through the same private-pipe discipline as the publisher secret store and exposes `signCanonical()` only; it never returns or serialises private key bytes.

The committed `config/publication-request-trust.schema.json` contains no real key. The initial approved runtime selection is deliberately key-independent: it binds the trust schema SHA, fixed credential target, expected broker service SID, trust-root path and `broker_trust_state:"PENDING_PROVISION"`, not a future key. Only after the signed service-install receipt proves that broker SID exists may plan-only `provision-authority-broker-key.ps1` emit canonical `PROVISION_AUTHORITY_BROKER_KEY` decision bytes. Its apply mode accepts no caller identity, target, key or path, loads the fixed signed decision, generates the key under the broker account and exclusively writes its public record to `<controlRoot>/publication-request-trust/history/<key-id>.json`, then atomically points `<controlRoot>/publication-request-trust/current.json` at that immutable record. The no-overwrite receipt binds the installed identity, selection SHA, schema/control-root hashes, credential target and actual trust SHA/key ID without secret bytes. Standing authority and publisher configuration bind that actual record; authority materialisation and `ARM_SHADOW` are impossible while runtime crypto state is still pending. Every signed request also binds the exact history-record SHA, key ID and fingerprint. The publisher can read current and history public records but cannot access the broker account's credential vault. Rotation first suspends authority and writes the new no-overwrite key record. It then appends a separately signed immutable status/rotation event that references the unchanged old and new record SHAs and atomically advances the current pointer; it never edits, deletes or rewrites an old public-key record. The event-chain projection makes an old key `VERIFICATION_ONLY_RETAINED`, so it cannot sign new requests but remains available for an exact pre-rotation request's read-only reconciliation. Verification checks the original record SHA, complete signed event chain and pointer monotonicity; missing history, event rollback, an unknown key or a key revoked at signing fails closed. Rotation requires fresh shadow acceptance before new mutations.

Job payload contains only `{ request_id }`. The signed document binds envelope ID/hash, authority ID/version/hash, action, worker, account, issued/expiry timestamps, nonce, `publication_slot`, `private_canary` and `continuation`. The base serializer always includes all three final fields. Before migration 030 is present, both reservation fields are explicit `null` and no mutation phase can be armed. Migration 030's private-canary task upgrades `PRIVATE_UPLOAD` to require its canonical epoch-bound reservation while keeping `publication_slot:null`. Its public-ramp task upgrades `PUBLIC_RELEASE` to require a canonical slot object containing `id`, `sha256`, `version`, `account_id`, `policy_day_utc`, `window_utc`, `opens_at` and `closes_at` while keeping `private_canary:null`. The timestamps are derived at reservation from the authority-bound UTC day/window and fixed `window_execution_minutes:30`, then signed as part of the immutable original snapshot. Those fields are signed bytes and cannot be supplied later by a worker. Task 7 permits a fresh post-pause request only by replacing `continuation:null` with a canonical prior-request and action-state binding under the new authority version.

- [ ] **Step 4: Broker only current eligible envelopes**

Reload and validate the envelope, authority, runtime, kill switch and phase-projected active cadence before signing. Invoke the shared closed phase/action contract before opening the signing-key provider: after migration 030, `PRIVATE_CANARY` permits only `PRIVATE_UPLOAD` with `publication_slot:null` and the current epoch-bound `private_canary` reservation; `PUBLIC_RAMP_ONE_DAILY` and `PUBLIC_RAMP_TWO_DAILY` permit only `PUBLIC_RELEASE` with the exact canonical original slot snapshot and `private_canary:null`; every other phase/action pair is RED. The publisher invokes the same function before every sub-mutation, so a forged or stale request cannot widen the phase. The immutable ceiling and active projection both use `policy_day_timezone:"UTC"`, `max_per_policy_day`, fixed `permitted_windows_utc`, `window_execution_minutes` and `minimum_cooldown_minutes`; the broker and scheduler use the same projection and policy-day function. Store request SHA and signature in the immutable repository. Never accept raw envelope JSON from a job payload. `INACTIVE` and `SHADOW` stop before this signing boundary.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/publication-request-signing.test.js tests/services/public-key-trust-history.test.js tests/services/publication-action-contract.test.js tests/services/autonomous-green-authority-broker.test.js tests/services/authority-signing-key-provider.test.js`

Expected: PASS.

```powershell
git add lib/services/publication-request-signing.js lib/services/public-key-trust-history.js lib/services/publication-action-contract.js lib/services/autonomous-green-authority-broker.js lib/services/windows-authority-signing-key-provider.js config/publication-request-trust.schema.json tools/autonomous-green-broker-worker.js tools/windows/provision-authority-broker-key.ps1 tests/services/publication-request-signing.test.js tests/services/public-key-trust-history.test.js tests/services/publication-action-contract.test.js tests/services/autonomous-green-authority-broker.test.js tests/services/authority-signing-key-provider.test.js
git commit -m "feat: broker signed publication requests"
```

### Task 6: Build the isolated credential and YouTube adapter boundary

**Files:**
- Create: `lib/services/windows-publisher-secret-store.js`
- Create: `lib/services/youtube-publisher-credential-provider.js`
- Create: `lib/services/youtube-publish-critical-adapter.js`
- Create: `lib/services/legacy-youtube-credential-audit.js`
- Create: `config/legacy-youtube-credential-surfaces.json`
- Create: `tools/windows/publisher-credential-manager.ps1`
- Create: `tools/windows/provision-publisher-credential.ps1`
- Create: `tools/windows/retire-legacy-youtube-credentials.ps1`
- Create: `tests/services/youtube-publisher-credential-provider.test.js`
- Create: `tests/services/legacy-youtube-credential-audit.test.js`
- Create: `tests/ops/youtube-publish-critical-boundary.test.js`

**Interfaces:**
- Produces credential provider `getCredential({ accountId, workerIdentity })` with no token-write API.
- Produces: `auditLegacyYouTubeCredentialSurfaces({ productionPaths, developerPaths, aclReader, providerGrantReader, expectedPublisherSid, legacyServiceSids }) -> report`.
- Produces: `validatePublisherCredentialCutover({ retirementReceipt, newGrantReceipt, legacyGrantReceipts, accountPreflight, processInventory }) -> report`.
- Produces adapter methods `preflightChannel`, `scanIntent`, `insertPrivate`, `insertCaptions`, `readVideo`, `readCaptions`, `promotePublic` and `readProcessing`.

- [ ] **Step 1: Write boundary and ordering tests**

```js
test("credential provider rejects the wrong service SID", async () => {
  await assert.rejects(() => provider.getCredential({ accountId: ACCOUNT, workerIdentity: { serviceSid: "wrong" } }), /publisher_identity_not_authorised/);
});

test("publisher boundary imports no legacy uploader or OAuth writer", () => {
  const source = fs.readFileSync("lib/services/youtube-publish-critical-adapter.js", "utf8");
  for (const forbidden of ["upload_youtube", "publisher.js", "run.js", "generateAuthUrl", "getToken("]) assert.equal(source.includes(forbidden), false);
});

test("legacy token surfaces are absent from production or unreadable to every non-publisher identity", async () => {
  const report = await auditLegacyYouTubeCredentialSurfaces(credentialAclFixture());
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.secretBytesRead, 0);
  assert.deepEqual(report.identitiesWithPublisherCredentialAccess, [PUBLISHER_SID]);
  assert.equal(report.liveCheckoutLegacyTokenCount, 0);
  for (const sid of [SERVER_SID, BROKER_SID, ANALYTICS_SID, LEGACY_WATCHDOG_SID, INTERACTIVE_GENERIC_CLI_SID]) {
    assert.equal(report.accessBySid[sid], "DENIED");
  }
});

test("credential cutover proves the production account has one writer and every legacy grant is unusable", async () => {
  const report = await validatePublisherCredentialCutover(credentialCutoverFixture({
    legacyRuntimeRetirement: "GREEN_NO_SURVIVING_CHILDREN",
    productionAccountWriters: [PUBLISHER_SID],
    developerGrant: { status: "REVOKED", channelId: PULSE_CHANNEL_ID },
    newPublisherGrant: { clientId: DISTINCT_PUBLISHER_CLIENT_ID, channelId: PULSE_CHANNEL_ID, scopes: REQUIRED_SCOPES }
  }));
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.legacyProductionAccountGrantCount, 0);
  for (const entrypoint of ["upload_youtube.js", "run.js publish", "v15-youtube-private-review", "v15-youtube-public-release"]) {
    assert.equal((await probeLegacyPublisher(entrypoint, { runtimeRole: "production" })).credentialAcquireCount, 0);
  }
  assert.equal((await validatePublisherCredentialCutover(credentialCutoverFixture({ developerGrant: { status: "VALID", channelId: PULSE_CHANNEL_ID } }))).verdict, "RED");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/youtube-publisher-credential-provider.test.js tests/services/legacy-youtube-credential-audit.test.js tests/ops/youtube-publish-critical-boundary.test.js`

Expected: FAIL on missing modules.

- [ ] **Step 3: Implement secret retrieval and adapter**

Use one fixed Windows Credential Manager Generic Credential target, `PulseGaming/YouTubePublisher`, stored in the dedicated publisher service account's user vault. `provision-publisher-credential.ps1` accepts the OAuth material only as interactive `SecureString` input, invokes `CredWriteW` under that account and never writes plaintext or logs. It defaults to validation/plan mode; credential creation is a later explicit operator cutover action.

`publisher-credential-manager.ps1` wraps `CredReadW` for that fixed target only. `windows-publisher-secret-store.js` invokes it only after service-SID verification, captures the result through a private child-process pipe, never logs it and zeroes temporary buffers after constructing the in-memory OAuth client. It exposes no write, list, export, arbitrary-target or token-refresh persistence operation. Other runtime service accounts have no access to the publisher account's vault.

`config/legacy-youtube-credential-surfaces.json` lists metadata-only checks for both live and developer checkout `.env`/token surfaces, legacy credential/config files, external general-purpose environment files, every known OAuth client/grant identity and the fixed publisher Credential Manager target. The local audit inspects existence, owner and ACL/identity access without reading or printing secret bytes. The signed cutover additionally performs provider-side metadata-only token/client/account preflight under tightly scoped handles so it can prove whether each legacy grant is revoked/unusable or belongs to a distinct non-production channel. Production readiness is RED if any legacy grant or token copy can still authorise the production YouTube channel, a server/generic CLI/legacy service SID can acquire any production credential, the publisher SID cannot read its one fixed target or any other runtime SID can.

`retire-legacy-youtube-credentials.ps1` is a plan/apply cutover tool with no caller-selected paths. Plan mode reports only identities, ACLs, provider grant IDs and presence flags. Apply is forbidden until the runtime plan's exact signed legacy-owner retirement receipt proves every old supervisor/service/task stopped, fenced and disabled with no surviving child or publisher-capable process; the cutover rechecks that state immediately before and after credential operations. A later exact signed `PUBLISHER_CREDENTIAL_CUTOVER` decision provisions a distinct OAuth client/grant into the new fixed publisher target, proves its exact production channel/account and minimum scopes, quarantines any exact legacy production token file behind publisher-only ACLs and removes nonpublisher access. It then revokes every old grant capable of the production channel, including a still-present developer-checkout token, or binds cryptographic provider readback that the developer credential targets a distinct non-production channel. Local developer files need not be edited, but their grants must be inert or provably separate. The tool logs no values, never deletes the only recovery copy and never grants generic server access. The no-overwrite receipt binds before/after metadata hashes, provider-side grant/channel results, expected SIDs, stopped-process receipt and the new target/client identity. Direct legacy CLI probes must fail before auth even if obsolete local bytes remain. Private-canary readiness requires this exact GREEN receipt and a fresh account/surface audit showing one production writer.

The adapter pins `retry:false`, bounded timeouts, exact destination channel and private-first settings. Reuse validated mechanics from V15 services without retaining V15 paths or manual authority.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/services/youtube-publisher-credential-provider.test.js tests/services/legacy-youtube-credential-audit.test.js tests/ops/youtube-publish-critical-boundary.test.js tests/services/v15-youtube-private-review.test.js tests/services/v15-youtube-public-release.test.js`

Expected: PASS.

```powershell
git add lib/services/windows-publisher-secret-store.js lib/services/youtube-publisher-credential-provider.js lib/services/youtube-publish-critical-adapter.js lib/services/legacy-youtube-credential-audit.js config/legacy-youtube-credential-surfaces.json tools/windows/publisher-credential-manager.ps1 tools/windows/provision-publisher-credential.ps1 tools/windows/retire-legacy-youtube-credentials.ps1 tests/services/youtube-publisher-credential-provider.test.js tests/services/legacy-youtube-credential-audit.test.js tests/ops/youtube-publish-critical-boundary.test.js
git commit -m "feat: isolate YouTube publisher credentials"
```

### Task 7: Implement exactly-once publication and reconciliation

**Files:**
- Create: `lib/services/youtube-publish-critical-worker.js`
- Create: `lib/services/youtube-publication-reconciler.js`
- Create: `lib/services/publication-attempt-sentinel.js`
- Create: `lib/services/publication-continuation-recovery.js`
- Create: `lib/services/expired-publication-recovery.js`
- Create: `lib/job-handlers/publication-continuation-recovery.js`
- Create: `lib/job-handlers/publication-reservation-expiry-sweep.js`
- Create: `tools/youtube-publish-critical-worker.js`
- Create: `tools/autonomous-green-expired-publication.js`
- Create: `tests/services/youtube-publish-critical-worker.test.js`
- Create: `tests/services/youtube-publication-reconciler.test.js`
- Create: `tests/services/publication-attempt-sentinel.test.js`
- Create: `tests/services/autonomous-green-ambiguity-restart.test.js`
- Create: `tests/services/publication-continuation-recovery.test.js`
- Create: `tests/services/expired-publication-recovery.test.js`
- Create: `tests/ops/autonomous-green-expired-publication-cli.test.js`
- Modify: `config/runtime-lanes.json`
- Modify: `config/autopilot-job-ownership.json`
- Modify: `lib/job-handlers.js`
- Modify: `lib/scheduler.js`
- Modify: `lib/stabilisation/scheduler-profile.js`
- Modify: `lib/repositories/autonomous_content_runs.js`
- Modify: `lib/runtime/readiness.js`
- Modify: `lib/services/autonomous-green-authority-broker.js`
- Modify: `lib/services/publication-request-signing.js`
- Modify: `tests/services/autonomous-content-runs.test.js`
- Modify: `tests/services/runtime-readiness.test.js`
- Modify: `tests/services/autonomous-green-authority-broker.test.js`
- Modify: `tests/services/publication-request-signing.test.js`
- Modify: `tests/services/autopilot-job-ownership.test.js`
- Modify: `tools/runtime-publisher-worker.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `runYouTubePublishCriticalJob(input) -> immutableReceipt`.
- Produces: `reconcilePublicationAction({ requestId, action, repos, readOnlyAdapter, now }) -> immutableReceipt`.
- Produces: `inspectPublicationAttemptSentinels({ repos, currentWorkerLease, now }) -> { verdict, blockers, orphanedActions }`.
- Produces: `brokerPublicationContinuation({ originalRequestId, repos, runtimeSnapshot, signingKeyHandle, now }) -> { requestId, nextAction }`.
- Produces: `brokerCapacityReservationRootRequest({ capacityReservationId, repos, runtimeSnapshot, signingKeyHandle, now }) -> { requestId, nextAction:"VIDEO_INSERT" }` for the only mode in which no root request exists yet.
- Produces: `recoverPublicationContinuation({ capacityReservationId, triggerEventId, repos, broker, now }) -> immutableRecoveryReceipt`.
- Produces: `sweepExpiredPublicationReservations({ repos, broker, operatorDecisionVerifier, now }) -> immutableSweepReceipt`.
- Produces: `requeueExpiredPublication({ heldRunId, signedDecision, zeroMatchIntentReceipt, repos, now }) -> { newCapacityGeneration, contentRun }`.
- Produces: `retainPrivateAfterWindowExpiry({ heldRunId, signedDecision, repos, now }) -> immutableDispositionReceipt`.
- Produces: fixed `autonomous-green-expired-publication --database-mode fixture|production --plan|--apply-requeue|--apply-retain-private` semantics with no caller-selected run or path.

- [ ] **Step 1: Write exact ordering and ambiguity tests**

```js
test("every remote mutation has a distinct reservation and last-second STARTED boundary", async () => {
  const events = [];
  const result = await runYouTubePublishCriticalJob(publicFixture({ events }));
  assert.deepEqual(result.actionReservations.map((row) => row.action), ["VIDEO_INSERT", "CAPTION_INSERT", "STATUS_PROMOTE"]);
  for (const action of ["VIDEO_INSERT", "CAPTION_INSERT", "STATUS_PROMOTE"]) {
    assert.ok(events.indexOf(`${action}:reserved`) < events.indexOf(`${action}:started`));
    assert.ok(events.indexOf(`${action}:started`) < events.indexOf(`${action}:remote_call`));
    assert.ok(events.indexOf(`${action}:returned`) < events.indexOf(`${action}:confirmed`));
  }
  assert.deepEqual(result.stateTransitions.filter((row) => row === "ENVELOPED->PUBLISH_RESERVED"), []);
  assert.equal(result.capacityReservationState, "PUBLISH_RESERVED");
  assert.equal(result.contentRunState, "RECONCILED");
});

test("first video action reservation reuses the already-consumed capacity owner", async () => {
  const first = await runYouTubePublishCriticalJob(crashFixture({ action: "VIDEO_INSERT", crashAfter: "RESERVED" }));
  assert.equal(first.contentRunState, "PUBLISH_RESERVED");
  assert.equal(first.publicationBudgetConsumed, true);
  assert.equal(first.actionReservation.capacity_reservation_id, first.capacityReservationId);
  assert.equal(first.actionReservation.generation, 1);
  const restart = await runYouTubePublishCriticalJob(restartFixture(first));
  assert.equal(restart.videoReservationId, first.videoReservationId);
  assert.equal(restart.stateTransitions.filter((row) => row === "ENVELOPED->PUBLISH_RESERVED").length, 0);
  assert.equal(restart.remoteMutationCounts.VIDEO_INSERT, 1);
});

test("resume and expiry recovery derive and enqueue one continuation", async () => {
  for (const trigger of ["DISCORD_RESUME_CONFIRMED", "REQUEST_EXPIRY_SWEEP"]) {
    const isolated = recoverableContinuationFixture({ trigger });
    const first = await recoverPublicationContinuation(isolated);
    const replay = await recoverPublicationContinuation(isolated);
    assert.equal(replay.receiptSha256, first.receiptSha256);
    assert.equal(isolated.capacityReservations.length, 1);
    assert.equal(isolated.publicationRequests.filter((row) => row.parent_request_id).length, 1);
    assert.deepEqual(isolated.publisherJobs.map((row) => row.key), [`${isolated.capacityReservation.id}:${first.childRequestSha256}`]);
  }
});

test("expired unstarted requeue creates one new generation only after a signed zero-match proof", async () => {
  const held = expiredUnstartedFixture({ generation: 1, state: "PUBLICATION_EXPIRED_HOLD" });
  await assert.rejects(() => requeueExpiredPublication({ ...held, signedDecision: null }), /signed_expired_requeue_decision_required/);
  const recovered = await requeueExpiredPublication({ ...held, signedDecision: SIGNED_REQUEUE, zeroMatchIntentReceipt: ZERO_MATCH_SCAN });
  assert.equal(recovered.newCapacityGeneration, 2);
  assert.equal(recovered.contentRun.state, "ENVELOPED");
  assert.equal(held.oldActionReservation.state, "EXPIRED_UNSTARTED");
  const replay = await requeueExpiredPublication({ ...held, signedDecision: SIGNED_REQUEUE, zeroMatchIntentReceipt: ZERO_MATCH_SCAN });
  assert.equal(replay.receiptSha256, recovered.receiptSha256);
  assert.equal(held.remoteMutationCount, 0);
});

test("the fixed expired-publication CLI applies only the one signed held run", async () => {
  const planned = await runExpiredPublicationCli(cliFixture({ argv: ["--database-mode", "fixture", "--plan"] }));
  assert.equal(planned.remoteMutationCount, 0);
  const applied = await runExpiredPublicationCli(cliFixture({ argv: ["--database-mode", "fixture", "--apply-requeue"], signedDecision: SIGNED_REQUEUE }));
  assert.equal(applied.newCapacityGeneration, 2);
  await assert.rejects(() => runExpiredPublicationCli(cliFixture({ argv: ["--database-mode", "fixture", "--apply-requeue", "--run-id", "caller"] })), /caller_target_forbidden/);
});

test("the expiry sweep holds every reserved run whose window closed before STARTED", async () => {
  const swept = await sweepExpiredPublicationReservations(expirySweepFixture({ closedPublicReservations: 2, startedCount: 0 }));
  assert.equal(swept.heldCount, 2);
  assert.equal(swept.remoteMutationCount, 0);
  assert.equal(swept.runs.every((row) => row.state === "PUBLICATION_EXPIRED_HOLD"), true);
});

test("crash boundaries are exactly-once for every remote sub-action", async () => {
  const boundaries = ["RESERVED", "STARTED", "REMOTE_RETURNED_BEFORE_RECEIPT", "RETURNED", "CONFIRMED"];
  for (const action of ["VIDEO_INSERT", "CAPTION_INSERT", "STATUS_PROMOTE"]) {
    for (const boundary of boundaries) {
      const restart = await restartFromBoundary(boundaryFixture({ action, boundary, currentSafety: "GREEN" }));
      assert.equal(restart.remoteMutationCounts[action], boundary === "RESERVED" ? 1 : 0, `${action}:${boundary}`);
      if (boundary !== "CONFIRMED") assert.equal(restart.nextActionStarted, false, `${action}:${boundary}:next`);
      if (boundary === "STARTED" || boundary === "REMOTE_RETURNED_BEFORE_RECEIPT") assert.equal(restart.mode, "reconciliation_only");
    }
    const blocked = await restartFromBoundary(boundaryFixture({ action, boundary: "CONFIRMED", currentSafety: "RED" }));
    assert.equal(blocked.nextActionStarted, false);
  }
});

test("fresh VIDEO_INSERT performs a complete remote intent scan before mutation", async () => {
  const zero = await runYouTubePublishCriticalJob(publicFixture({ exactRemoteIntentMatches: 0 }));
  assert.ok(zero.events.indexOf("VIDEO_INSERT:intent_scan_complete") < zero.events.indexOf("VIDEO_INSERT:started"));
  assert.equal(zero.remoteMutationCounts.VIDEO_INSERT, 1);

  const restored = await runYouTubePublishCriticalJob(restoredDatabaseFixture({ localVideoAttemptMissing: true, exactRemoteIntentMatches: 1 }));
  assert.equal(restored.remoteMutationCounts.VIDEO_INSERT, 0);
  assert.equal(restored.recoveredAction, "VIDEO_INSERT");
  assert.equal(restored.authority.suspension_reason_class, "REQUALIFICATION_REQUIRED");
  assert.equal(restored.nextActionStarted, false);

  const duplicate = await runYouTubePublishCriticalJob(publicFixture({ exactRemoteIntentMatches: 2 }));
  assert.equal(duplicate.remoteMutationCounts.VIDEO_INSERT, 0);
  assert.equal(duplicate.contentRunState, "RECONCILIATION_REQUIRED");
});

test("STARTED is the mutation linearisation point for pause and kill races", async () => {
  const before = await interleaveEmergencyControl(publicFixture(), { controlCommit: "BEFORE_STARTED" });
  assert.equal(before.remoteMutationCount, 0);
  assert.equal(before.actionState, "RESERVED");
  const after = await interleaveEmergencyControl(publicFixture(), { controlCommit: "AFTER_STARTED_BEFORE_ADAPTER_CALL" });
  assert.equal(after.remoteMutationCount, 1);
  assert.equal(after.actionAlreadyInFlight, true);
  assert.equal(after.nextActionStarted, false);
  assert.equal(after.restartMode, "reconciliation_only");
});

test("orphaned STARTED sentinel blocks every other request before mutation", async () => {
  const crashed = await crashAfterRemoteCallBeforeAmbiguous(crashFixture({ action: "CAPTION_INSERT" }));
  assert.equal(crashed.persistedActionState, "STARTED");
  const second = await runYouTubePublishCriticalJob(secondMutationRequestFixture(crashed));
  assert.equal(second.remoteMutationCount, 0);
  assert.equal(second.blocker, "orphaned_publication_attempt:CAPTION_INSERT");
  assert.equal(second.authority.phase, "SUSPENDED");
  assert.equal(second.authority.suspension_reason_class, "REQUALIFICATION_REQUIRED");
  assert.equal(killSwitch.get("external_mutations").state, "ENGAGED");
  const readiness = await buildReadinessSnapshot(readinessFixture({ publicationAttempts: crashed.repos }));
  assert.equal(readiness.verdict, "RED");
});

test("remote creation followed by transport error never inserts again", async () => {
  const first = await runAndLoseResponse();
  assert.equal(first.state, "MUTATION_OUTCOME_UNKNOWN");
  const restart = await runYouTubePublishCriticalJob(restartFixture());
  assert.equal(restart.insertCount, 0);
  assert.equal(restart.mode, "reconciliation_only");
  assert.deepEqual(restart.stateTransitions, ["MUTATION_OUTCOME_UNKNOWN->UPLOADED"]);
  assert.equal(restart.nextActionStarted, false);
  assert.equal(restart.authority.phase, "SUSPENDED");
});

test("zero or multiple reconciliation matches enter a permanent no-retry hold", async () => {
  const result = await runYouTubePublishCriticalJob(restartFixture({ exactRemoteMatches: 0 }));
  assert.equal(result.state, "RECONCILIATION_REQUIRED");
  assert.equal(result.insertCount, 0);
  assert.equal(result.retry_allowed, false);
});

test("pause committed after video insert blocks caption and public status before either mutation", async () => {
  const first = await runYouTubePublishCriticalJob(publicFixture({ afterVideoConfirmed: () => ingestDiscordOpsInteraction(fixtureInteraction("pause")) }));
  assert.deepEqual(first.remoteMutationCounts, { VIDEO_INSERT: 1, CAPTION_INSERT: 0, STATUS_PROMOTE: 0 });
  assert.equal(first.contentRunState, "UPLOADED");
  assert.equal(first.slotConsumed, true);
  assert.equal(first.blocker, "kill_switch_engaged_before_caption_insert");
  await assert.rejects(() => runYouTubePublishCriticalJob(resumedWithOriginalRequestFixture(first)), /stale_authority_version/);
  const continuation = await brokerPublicationContinuation(continuationFixture({ original: first, resumedAuthorityVersion: first.authorityVersion + 2 }));
  assert.equal(continuation.request.action, "PUBLIC_RELEASE");
  assert.equal(continuation.request.continuation.original_request_id, first.requestId);
  assert.equal(continuation.request.continuation.next_action, "CAPTION_INSERT");
  const resumed = await runYouTubePublishCriticalJob(resumedPauseFixture({ first, continuation }));
  assert.deepEqual(resumed.remoteMutationCounts, { VIDEO_INSERT: 0, CAPTION_INSERT: 1, STATUS_PROMOTE: 1 });
});

test("continuation request binds the original request, remote identity and first unstarted action", async () => {
  const continued = await brokerPublicationContinuation(continuationFixture({ nextAction: "CAPTION_INSERT" }));
  assert.deepEqual(continued.request.continuation, {
    root_request_id: ROOT_REQUEST_ID,
    root_request_sha256: ROOT_REQUEST_SHA,
    original_request_id: ORIGINAL_REQUEST_ID,
    original_request_sha256: ORIGINAL_REQUEST_SHA,
    confirmed_action_receipts: [VIDEO_CONFIRMED_SHA],
    remote_video_id: REMOTE_VIDEO_ID,
    next_action: "CAPTION_INSERT"
  });
  assert.equal(verifyPublicationRequest(verifyFixture(continued.request)).valid, true);
  assert.equal(verifyPublicationRequest(verifyFixture({ ...continued.request, continuation: { ...continued.request.continuation, next_action: "VIDEO_INSERT" } })).valid, false);
  await assert.rejects(() => brokerPublicationContinuation(requalifiedContinuationFixture()), /recoverable_pause_required/);
});

test("a public status continuation cannot reuse an expired publication window", async () => {
  const paused = confirmedPrivateVideoFixture({ slot: slotFixture({ opensAt: "2026-08-14T19:00:00Z", closesAt: "2026-08-14T19:30:00Z" }) });
  const isolated = continuationFixture({ original: paused, nextAction: "STATUS_PROMOTE", now: "2026-08-15T19:00:00Z" });
  await assert.rejects(() => brokerPublicationContinuation(isolated), /publication_window_expired/);
  assert.deepEqual(isolated.counts, { signed: 0, persisted: 0, enqueued: 0, remote: 0 });
  const forged = forgedStaleContinuationFixture({ original: paused, nextAction: "STATUS_PROMOTE" });
  await assert.rejects(() => runYouTubePublishCriticalJob(forged), /publication_window_expired/);
  assert.equal(forged.remoteMutationCounts.STATUS_PROMOTE, 0);
  assert.equal(forged.remotePrivacy, "private");
  assert.equal(forged.contentRunState, "PUBLIC_STATUS_EXPIRED_HOLD");
  assert.equal(forged.authority.suspension_reason_class, "REQUALIFICATION_REQUIRED");
});

test("an expired uploaded video can only be retained private by the fixed signed disposition", async () => {
  const held = uploadedWindowExpiredFixture({ state: "PUBLIC_STATUS_EXPIRED_HOLD", remotePrivacy: "private" });
  await assert.rejects(() => retainPrivateAfterWindowExpiry({ ...held, signedDecision: null }), /signed_private_retention_decision_required/);
  const first = await retainPrivateAfterWindowExpiry({ ...held, signedDecision: signedDecision("RETAIN_PRIVATE_AFTER_WINDOW_EXPIRY") });
  assert.equal(first.contentRunState, "PRIVATE_RELEASE_RETAINED");
  assert.equal(first.remoteMutationCount, 0);
  assert.equal(first.publicRampCredit, 0);
  assert.equal(first.remotePrivacy, "private");
  const replay = await retainPrivateAfterWindowExpiry({ ...held, signedDecision: first.signedDecision });
  assert.equal(replay.receiptSha256, first.receiptSha256);
});

test("public execution interval is UTC start-inclusive and close-exclusive", () => {
  const slot = slotFixture({ policyDay: "2026-08-14", windowUtc: "19:00", opensAt: "2026-08-14T19:00:00.000Z", closesAt: "2026-08-14T19:30:00.000Z" });
  assert.equal(isPublicationSlotActive(slot, new Date("2026-08-14T19:00:00.000Z")), true);
  assert.equal(isPublicationSlotActive(slot, new Date("2026-08-14T19:29:59.999Z")), true);
  assert.equal(isPublicationSlotActive(slot, new Date("2026-08-14T19:30:00.000Z")), false);
  assert.equal(isPublicationSlotActive(slot, new Date("2026-08-15T19:00:00.000Z")), false);
});

test("pause before VIDEO_INSERT STARTED reauthorises the same reservation without a second reserve", async () => {
  const paused = preStartPauseFixture({ reservationState: "RESERVED", startedEventCount: 0 });
  const continuation = await brokerPublicationContinuation(continuationFixture({ original: paused, nextAction: "VIDEO_INSERT", mode: "PRE_START_REAUTHORISATION" }));
  assert.deepEqual(continuation.request.continuation.confirmed_action_receipts, []);
  assert.equal(continuation.request.continuation.original_reservation_sha256, paused.reservationSha256);
  const result = await runYouTubePublishCriticalJob(resumedPauseFixture({ first: paused, continuation }));
  assert.equal(result.actionReservationCreateCount, 0);
  assert.equal(result.remoteMutationCounts.VIDEO_INSERT, 1);
  await assert.rejects(() => brokerPublicationContinuation(continuationFixture({ original: paused, nextAction: "VIDEO_INSERT", mode: "PRE_START_REAUTHORISATION", startedEventCount: 1 })), /pre_start_reauthorisation_forbidden/);
});

test("every pre-first-mutation pause or expiry boundary reuses capacity without a fork", async () => {
  const beforeRoot = preFirstMutationFixture({ capacityReserved: true, rootRequest: null, videoReservation: null });
  const root = await brokerCapacityReservationRootRequest(rootReauthorisationFixture({ capacityReservationId: beforeRoot.capacityReservationId, mode: "PRE_ROOT_BIND_REAUTHORISATION" }));
  assert.equal(root.isRootRequest, true);
  assert.equal(root.capacityReservationId, beforeRoot.capacityReservationId);
  assert.equal(root.capacityReservationCreateCount, 0);

  const beforeAction = preFirstMutationFixture({ rootRequest: expiredRootRequest(), videoReservation: null });
  const child = await brokerPublicationContinuation(continuationFixture({ original: beforeAction, mode: "PRE_ACTION_RESERVATION_REAUTHORISATION", nextAction: "VIDEO_INSERT" }));
  assert.equal(child.rootRequestId, beforeAction.rootRequest.id);
  assert.equal(child.videoReservationCreateCount, 1);
  assert.equal(child.capacityReservationCreateCount, 0);

  for (const action of ["PRIVATE_UPLOAD", "PUBLIC_RELEASE"]) {
    const expired = preFirstMutationFixture({ action, requestExpired: true, startedEventCount: 0, publicWindowActive: true, canaryEpochActive: true });
    const reauthorised = await brokerPublicationContinuation(continuationFixture({ original: expired, mode: "PRE_START_EXPIRY_REAUTHORISATION", nextAction: "VIDEO_INSERT" }));
    assert.equal(reauthorised.capacityReservationCreateCount, 0);
    assert.equal(reauthorised.remoteMutationCount, 0);
  }
});

test("public close with consumed capacity and no STARTED becomes EXPIRED_UNSTARTED", async () => {
  const expired = await runYouTubePublishCriticalJob(preFirstMutationFixture({ action: "PUBLIC_RELEASE", publicWindowActive: false, startedEventCount: 0 }));
  assert.equal(expired.actionState, "EXPIRED_UNSTARTED");
  assert.equal(expired.contentRunState, "PUBLICATION_EXPIRED_HOLD");
  assert.equal(expired.publicationSlotConsumed, true);
  assert.deepEqual(expired.remoteMutationCounts, { VIDEO_INSERT: 0, CAPTION_INSERT: 0, STATUS_PROMOTE: 0 });
  await assert.rejects(() => requeueExpiredPublication(expired, { decision: null }), /signed_expired_requeue_decision_required/);
});

test("ambiguous caption insertion is reconciled without a second caption insert", async () => {
  const first = await runAndLoseCaptionResponse();
  assert.equal(first.ambiguousAction, "CAPTION_INSERT");
  const restart = await runYouTubePublishCriticalJob(restartFixture({ action: "CAPTION_INSERT", exactCaptionMatches: 1 }));
  assert.equal(restart.remoteMutationCounts.CAPTION_INSERT, 0);
  assert.equal(restart.reconciledAction, "CAPTION_INSERT");
});

test("ambiguous public status promotion is read back without a second update", async () => {
  const first = await runAndLoseStatusResponse();
  assert.equal(first.ambiguousAction, "STATUS_PROMOTE");
  const restart = await runYouTubePublishCriticalJob(restartFixture({ action: "STATUS_PROMOTE", remotePrivacy: "public" }));
  assert.equal(restart.remoteMutationCounts.STATUS_PROMOTE, 0);
  assert.equal(restart.contentRunState, "RECONCILED");
});

test("expired or suspended requests can reconcile a started action but can never begin the next one", async () => {
  const result = await runYouTubePublishCriticalJob(restartFixture({ action: "CAPTION_INSERT", requestExpired: true, authorityPhase: "SUSPENDED", exactCaptionMatches: 1 }));
  assert.equal(result.mode, "reconciliation_only");
  assert.equal(result.reconciledAction, "CAPTION_INSERT");
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.nextActionStarted, false);
});

test("ambiguity in any sub-action suspends all mutation authority but leaves read-only reconciliation available", async () => {
  for (const action of ["VIDEO_INSERT", "CAPTION_INSERT", "STATUS_PROMOTE"]) {
    const isolated = ambiguousActionFixture({ action });
    const first = await runYouTubePublishCriticalJob(isolated);
    assert.equal(first.authority.phase, "SUSPENDED");
    assert.equal(first.authority.suspension_reason_class, "REQUALIFICATION_REQUIRED");
    assert.equal(first.authority.suspension_reason_code, `REMOTE_MUTATION_OUTCOME_UNKNOWN:${action}`);
    await assert.rejects(() => runYouTubePublishCriticalJob(secondMutationRequestFixture(isolated)), /authority_suspended/);
    const reconciled = await reconcilePublicationAction(readOnlyReconciliationFixture(isolated));
    assert.equal(reconciled.remoteMutationCount, 0);
    assert.equal(reconciled.authority.phase, "SUSPENDED");
    assert.throws(() => applyDiscordResume(isolated), /fresh_shadow_required/);
  }
});

test("publisher rejects wrong phase and action before credentials or any sub-mutation", async () => {
  for (const input of [
    publishFixture({ phase: "PRIVATE_CANARY", action: "PUBLIC_RELEASE", publication_slot: PUBLIC_SLOT }),
    publishFixture({ phase: "PUBLIC_RAMP_ONE_DAILY", action: "PRIVATE_UPLOAD", publication_slot: null })
  ]) {
    await assert.rejects(() => runYouTubePublishCriticalJob(input), /phase_action_forbidden/);
    assert.equal(input.credentialAcquireCount, 0);
    assert.deepEqual(input.remoteMutationCounts, { VIDEO_INSERT: 0, CAPTION_INSERT: 0, STATUS_PROMOTE: 0 });
  }
});

test("private canary reconciles after confirmed video, caption and private readback", async () => {
  const result = await runYouTubePublishCriticalJob(privateFixture({ processed: true, captionConfirmed: true, remotePrivacy: "private" }));
  assert.deepEqual(result.actionReservations.map((row) => row.action), ["VIDEO_INSERT", "CAPTION_INSERT"]);
  assert.equal(result.remoteMutationCounts.STATUS_PROMOTE, 0);
  assert.equal(result.contentRunState, "RECONCILED");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/youtube-publish-critical-worker.test.js tests/services/youtube-publication-reconciler.test.js tests/services/publication-attempt-sentinel.test.js tests/services/autonomous-green-ambiguity-restart.test.js tests/services/publication-continuation-recovery.test.js tests/services/expired-publication-recovery.test.js tests/ops/autonomous-green-expired-publication-cli.test.js tests/services/autonomous-content-runs.test.js tests/services/publication-request-signing.test.js tests/services/autonomous-green-authority-broker.test.js tests/services/autopilot-job-ownership.test.js`

Expected: FAIL on missing worker and reconciler.

- [ ] **Step 3: Implement required ordering**

Reload and verify request, envelope and authority in mutation mode. Rehash inputs. Check worker/account, expiry, cadence, cooldown, kill switch and breaker. The high-level request authorises a fixed sequence, but it is not a coarse exactly-once boundary. Create separate immutable reservations keyed by platform/account/envelope and action for `VIDEO_INSERT`, `CAPTION_INSERT` and, only for `PUBLIC_RELEASE`, `STATUS_PROMOTE`.

Every envelope contains a deterministic non-secret `intent_marker` tag derived from its bound immutable release-candidate SHA and included in the audited exact tag set for the final upload. Before every fresh `VIDEO_INSERT`, the worker obtains a read-only adapter, fully pages the exact bound channel's uploads from the candidate's immutable creation time minus a fixed clock-skew allowance through `now` and batch-reads candidates to match that marker, account, exact title/description/tag set, media duration/dimensions and available owner-only file details. There is no caller page limit: an incomplete, quota-exhausted or truncated interval scan is RED. It writes a canonical scan receipt before a mutation-capable adapter can be constructed. Zero exact matches permits the normal `STARTED`/insert path. One exact match proves lost local ledger state: append `RECOVERED_EXISTING`, bind the remote ID, engage the switch and requalification-suspend without inserting or starting a later action. More than one match enters `RECONCILIATION_REQUIRED`. This mandatory pre-insert scan also runs after database restore, so restoring a backup from before a successful remote insert cannot duplicate the video. A scan transport error is fail-closed and performs zero mutation.

The authority-broker scheduler has already consumed the exact private-canary budget or public slot, transitioned the owned run `ENVELOPED -> PUBLISH_RESERVED` and bound its unique active capacity-reservation ID before it may enqueue this worker. For the first `VIDEO_INSERT`, one transaction creates or reloads only the action reservation bound to that exact capacity-reservation ID and generation; it cannot consume another budget row, slot or content transition. Replay returns that same action reservation. For each action, reserve it before credential or network use. Immediately before its remote call, reload the durable emergency-control state, pending-emergency blocker, authority/version, publisher lease/fencing token, circuit breaker, request expiry and the exact preceding action receipt. Before public `STATUS_PROMOTE`, also recompute the UTC policy day and require `publication_slot.opens_at <= now < publication_slot.closes_at`. The successful transaction that appends that action's durable `STARTED` sentinel is the external-mutation linearisation point. A pause or kill committed before it makes the transaction fail and produces zero call. A pause or kill committed after it treats exactly that sub-action as already in flight: the worker makes at most its one pinned `retry:false` call, persists or reconciles the outcome and may not reserve or start any later action. There is no unsafe check-to-call promise that an already-started network action can be cancelled. Persist returned remote identity before considering the next action, then independently read back and append `CONFIRMED`. `VIDEO_INSERT` confirmation transitions `PUBLISH_RESERVED -> UPLOADED`; caption confirmation preserves `UPLOADED`. For `PRIVATE_UPLOAD`, confirmed video and caption, complete processing, exact identity readback and still-private visibility atomically permit `UPLOADED -> RECONCILED`. For `PUBLIC_RELEASE`, that transition additionally requires confirmed in-window `STATUS_PROMOTE` and exact public readback. A switch, authority, request-expiry or window change between actions stops before reserving or starting the next mutation. A kill or requalification suspension prevents any later mutation until fresh authority exists. Commit final confirmed state and enqueue notification only after all action receipts required by the phase/action matrix are confirmed.

A recoverable pause changes the authority version, so the original signed request is permanently stale for mutation mode. Request expiry before any `STARTED` is handled by the same closed pre-start family even without a pause; expiry never allows a fresh capacity reservation. After the two-step resume restores the same mutation-capable phase, or while authority remains current for expiry-only recovery, the broker may issue the one permitted immutable root/child request with the same `PRIVATE_UPLOAD` or `PUBLIC_RELEASE` action. If capacity was reserved but no root request was bound, only `brokerCapacityReservationRootRequest` accepts `PRE_ROOT_BIND_REAUTHORISATION`; it verifies the reservation owner/envelope, zero prior root/action/STARTED rows, active canary epoch or open public interval and current authority, then creates and CAS-binds the reservation's one root. `brokerPublicationContinuation` always requires a real `originalRequestId` and cannot represent that mode. If the root exists but no `VIDEO_INSERT` action reservation exists, `PRE_ACTION_RESERVATION_REAUTHORISATION` creates exactly that one action reservation. If it exists with no `STARTED`, `PRE_START_REAUTHORISATION` or expiry-specific `PRE_START_EXPIRY_REAUTHORISATION` reuses it. These modes require zero `STARTED` events, unchanged owner/envelope, an active canary epoch or still-open original public interval and zero new capacity reservations. Every child binds the reservation's root request ID/SHA, immediate parent ID/SHA, unchanged reservation ID/SHA and a unique continuation stage under the new authority version. The unique parent constraint makes the chain linear even when a caller changes action, version or nonce; replay returns the same canonical child and a fork is rejected. After any `STARTED`, every pre-start mode is forbidden. After a confirmed action, the ordinary child binds confirmed action-receipt hashes, remote video ID and first unstarted later action; it rejects skipped stages, a changed remote ID and any attempt to repeat `VIDEO_INSERT`. Before `STATUS_PROMOTE`, it additionally requires the signed original public interval and request expiry to remain current. If a public interval closes before any action starts, append `EXPIRED_UNSTARTED`, keep the slot consumed and transition the run to `PUBLICATION_EXPIRED_HOLD` with zero network activity. Only a signed `REQUEUE_EXPIRED_UNSTARTED` decision plus a fresh zero-match intent scan can return it to `ENVELOPED`; rejection is the other terminal choice. If the interval closes after upload, the video remains private and the run enters requalification hold. Yesterday's slot can never expand today's cadence. `REQUALIFICATION_REQUIRED` cannot obtain a child; it follows reset-to-shadow instead.

For the after-upload branch, “requalification hold” means the exact immutable state transition `UPLOADED -> PUBLIC_STATUS_EXPIRED_HOLD` in the same expected-version transaction that rejects `STATUS_PROMOTE`, preserves exact private readback and applies `REQUALIFICATION_REQUIRED`. It cannot obtain a continuation or silently reconcile. Only the fixed signed `RETAIN_PRIVATE_AFTER_WINDOW_EXPIRY` disposition may transition it to `PRIVATE_RELEASE_RETAINED`; that service re-reads the exact remote ID/private state, performs zero remote mutation, grants no canary or ramp credit and keeps the slot/action receipts consumed.

- [ ] **Step 4: Implement reconciliation-only restart**

Register `publication_continuation_recovery` and `publication_reservation_expiry_sweep` only on the `authority-broker` lane and activate their rows in `config/autopilot-job-ownership.json`. A successfully committed Discord `RESUME` event enqueues one continuation-recovery job per affected capacity reservation. The broker also enqueues the same idempotent recovery after a pre-start request-expiry observation. The handler reloads the immutable owner/root/action chain, derives the sole legal next mode and action, signs at most one root or child and enqueues publisher work by `<capacityReservationId>:<childRequestSha256>`. It can never create capacity or choose a next action from its payload.

In the same registry update, activate every authority/publisher row implemented by Tasks 2â€“7, including `publication_health_sentinel`, `autopilot_release_candidate`, `autopilot_envelope_prepare`, authority-broker request work, the isolated publisher, reconciliation and attempt-sentinel recovery. The ownership test compares all active registry rows with actual handler registrations and lane capabilities, so earlier authority handlers cannot remain predeclared but inactive.

Run the expiry sweep every minute and at authority-broker bootstrap. It finds every public capacity reservation whose `closes_at` passed with zero `STARTED` action events, appends `EXPIRED_UNSTARTED`, transitions the already `PUBLISH_RESERVED` run to `PUBLICATION_EXPIRED_HOLD` and emits zero network calls. `expired-publication-recovery.js` is the sole apply owner for the fixed `REQUEUE_EXPIRED_UNSTARTED` ceremony. It verifies the operator decision, the held run, prior immutable generation and a fresh complete zero-match intent scan, then atomically returns the run to `ENVELOPED`, clears its old active owner and records the one allowed next capacity generation. A later window may reserve that next generation once; the old slot/action/root remain immutable. Replay returns the same receipt and a fork, gap or second sibling generation fails. A signed reject is the only alternative terminal outcome.

`tools/autonomous-green-expired-publication.js --database-mode <fixture|production> --plan` reads the sole oldest eligible `PUBLICATION_EXPIRED_HOLD` or `PUBLIC_STATUS_EXPIRED_HOLD` after migration preflight and materialises exactly one type-specific fixed operator-decision request path. `--apply-requeue` loads only that path's signed `REQUEUE_EXPIRED_UNSTARTED` decision and service-generated zero-match scan, then invokes `requeueExpiredPublication`. `--apply-retain-private` loads only the signed `RETAIN_PRIVATE_AFTER_WINDOW_EXPIRY` request for the sole uploaded hold, verifies current private readback and invokes `retainPrivateAfterWindowExpiry`. Neither mode accepts a run ID, envelope, video ID, slot, generation, scan, disposition or output path. The same exact decision replay returns its receipt, while a different hold remains untouched. This maintenance command is the only apply ingress for either disposition and is never scheduled automatically. Discord may materialise the fixed request but cannot sign or apply it.

Before an action's `STARTED` sentinel, restart may continue the same `RESERVED` row because no network attempt was recorded. After `STARTED`, any crash, transport error, timeout or 5xx uses one database transaction to append action-specific `AMBIGUOUS`, transition the content run to `MUTATION_OUTCOME_UNKNOWN` by expected version and engage the durable external-mutation switch, then calls the monotonic `ensureRequalificationSuspended` CAS with code `REMOTE_MUTATION_OUTCOME_UNKNOWN:<ACTION>`. A concurrent pause cannot make the final hold resumable, and a pre-existing requalification hold is never downgraded. It records `retry_allowed:false` for that sub-action and permanently consumes the applicable canary budget or public slot. Every other mutation-mode request is blocked immediately. `VIDEO_INSERT` reconciliation scans exact remote intent, `CAPTION_INSERT` reconciliation lists and reads back the exact caption track and `STATUS_PROMOTE` reconciliation reads the exact status without updating it. One exact match appends a hash-bound action recovery receipt; zero or multiple matches transition to `RECONCILIATION_REQUIRED`. No action recovery can call its insert/update method again.

A hard process death cannot append `AMBIGUOUS`, so `publication-attempt-sentinel.js` supplies the derived global blocker. Publisher bootstrap, canonical readiness and the first step of every mutation-mode request inspect all nonterminal action reservations. A `STARTED` action whose fenced worker lease is no longer current is an orphan; any existing `AMBIGUOUS` action is unresolved. Before another mutation can reserve or start, one transaction marks an orphan `AMBIGUOUS`, engages the switch and appends the same `REQUALIFICATION_REQUIRED` suspension. The exact orphan alone may enter reconciliation mode. A current in-flight `STARTED` action blocks every other request but is not rewritten until its lease is lost. This scan closes the remote-call-to-error-handler crash gap and makes canonical readiness RED until reconciliation and requalification complete.

Request verification has two explicit modes. Mutation mode requires an unexpired request, active matching authority, current readiness and all live safety controls. Reconciliation mode is available only for an immutable matching reservation with a prior `STARTED` or `AMBIGUOUS` event. It still verifies the original request signature/hash, envelope, account, worker and exact action intent, but tolerates later request expiry or authority suspension because it exposes read-only adapter methods only. It may reconcile and persist the already-started action, but it cannot start any unreserved next action, acquire a mutation-capable adapter or make the video public. Successful reconciliation does not clear the switch or authority suspension. Operation returns only through signed `RESET_TO_SHADOW`, fresh shadow acceptance and fresh phase promotions; ordinary resume is forbidden. A later operator-triggered reconciliation uses the same mode. Every database transition uses current expected version. No recovery path can return to `PUBLISH_RESERVED` or repeat a remote mutation.

`tools/runtime-publisher-worker.js` becomes the sole supervised entry point and imports the fixed publish-critical worker. It accepts no caller-selected job kinds or credential paths.

- [ ] **Step 5: Add scripts and run tests**

```json
"service:autonomous-green-broker": "node tools/autonomous-green-broker-worker.js",
"service:youtube-publish-critical": "node tools/runtime-publisher-worker.js"
```

Run: `node --test tests/services/youtube-publish-critical-worker.test.js tests/services/youtube-publication-reconciler.test.js tests/services/publication-attempt-sentinel.test.js tests/services/autonomous-green-ambiguity-restart.test.js tests/services/publication-continuation-recovery.test.js tests/services/expired-publication-recovery.test.js tests/ops/autonomous-green-expired-publication-cli.test.js tests/services/publication-lifecycle.test.js tests/services/autonomous-content-runs.test.js tests/services/runtime-readiness.test.js tests/services/publication-request-signing.test.js tests/services/autonomous-green-authority-broker.test.js tests/services/autopilot-job-ownership.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add config/runtime-lanes.json config/autopilot-job-ownership.json lib/services/youtube-publish-critical-worker.js lib/services/youtube-publication-reconciler.js lib/services/publication-attempt-sentinel.js lib/services/publication-continuation-recovery.js lib/services/expired-publication-recovery.js lib/job-handlers/publication-continuation-recovery.js lib/job-handlers/publication-reservation-expiry-sweep.js lib/job-handlers.js lib/scheduler.js lib/stabilisation/scheduler-profile.js lib/services/autonomous-green-authority-broker.js lib/services/publication-request-signing.js lib/repositories/autonomous_content_runs.js lib/runtime/readiness.js tools/youtube-publish-critical-worker.js tools/autonomous-green-expired-publication.js tools/runtime-publisher-worker.js package.json tests/services/youtube-publish-critical-worker.test.js tests/services/youtube-publication-reconciler.test.js tests/services/publication-attempt-sentinel.test.js tests/services/autonomous-green-ambiguity-restart.test.js tests/services/publication-continuation-recovery.test.js tests/services/expired-publication-recovery.test.js tests/ops/autonomous-green-expired-publication-cli.test.js tests/services/autonomous-content-runs.test.js tests/services/runtime-readiness.test.js tests/services/publication-request-signing.test.js tests/services/autonomous-green-authority-broker.test.js tests/services/autopilot-job-ownership.test.js
git commit -m "feat: publish autonomous releases exactly once"
```

### Task 8: Wire shadow-only authority and publication reporting

**Files:**
- Create: `tools/autonomous-green-status.js`
- Create: `tools/autonomous-green-envelope-report.js`
- Create: `tests/services/autonomous-green-publication.integration.test.js`
- Create: `tests/ops/autonomous-green-reporting-cli.test.js`
- Modify: `config/runtime-lanes.json`
- Modify: `lib/repositories/publication_governance.js`
- Modify: `lib/services/publish-dispatch-policy.js`
- Modify: `tools/windows/install-production-services.ps1`
- Modify: `package.json`
- Modify: `tests/ops/windows-production-services.test.js`

**Interfaces:**
- Adds a distinct autonomous preparation chain; does not reuse synthetic `HUMAN_APPROVED` events.
- Produces read-only authority and envelope reports using the shared exact-expect contract.

- [ ] **Step 1: Write the full shadow integration test**

```js
test("strict GREEN candidate reaches a sealed shadow preflight with no publication request", async () => {
  const result = await runAutonomousGreenFixture({ phase: "SHADOW", network: failIfCalled });
  assert.equal(result.content_eligibility, "GREEN");
  assert.equal(result.publication_eligibility, "RED");
  assert.ok(result.publication_blockers.includes("authority_not_armed"));
  assert.equal(result.envelope.sha256.length, 64);
  assert.equal(result.shadow_preflight.verdict, "GREEN_NO_PUBLICATION_REQUEST");
  assert.equal(result.request, null);
  assert.equal(result.mutations, 0);
});

test("AMBER fixture stops before envelope broker", async () => {
  const result = await runAutonomousGreenFixture({ rights: "AMBER" });
  assert.equal(result.request, null);
  assert.ok(result.blockers.includes("rights_not_green"));
});

test("authority reporting CLIs enforce their exact expectation vocabularies", async () => {
  assert.equal((await runAuthorityStatusCli(reportCliFixture({ actual: "INACTIVE", expect: "INACTIVE" }))).exitCode, 0);
  assert.equal((await runAuthorityStatusCli(reportCliFixture({ actual: "INACTIVE", expect: "SHADOW" }))).exitCode, 2);
  assert.equal((await runAuthorityStatusCli(reportCliFixture({ actual: "INACTIVE", expect: "EMPTY" }))).exitCode, 64);
  assert.equal((await runEnvelopeReportCli(reportCliFixture({ actual: "EMPTY", expect: "EMPTY" }))).exitCode, 0);
  assert.equal((await runEnvelopeReportCli(reportCliFixture({ actual: "EMPTY", expect: "NONEMPTY" }))).exitCode, 2);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autonomous-green-publication.integration.test.js`

Expected: FAIL until all services are wired.

- [ ] **Step 3: Add distinct lifecycle semantics and scripts**

Do not call `prepareDispatch()` where it fabricates `HUMAN_APPROVED`. Add `prepareAutonomousDispatch()` that records exact authority ID/version and envelope SHA. In `SHADOW`, it materialises a canonical `GREEN_NO_PUBLICATION_REQUEST` preflight receipt and stops before the broker, signing-key provider, publication-request repository and publisher queue. Only `PRIVATE_CANARY`, `PUBLIC_RAMP_ONE_DAILY` and `PUBLIC_RAMP_TWO_DAILY` may cross the signing boundary.

Add an `authority-broker` runtime lane under a dedicated non-interactive identity that can read the authority signing key but cannot read YouTube credentials. Bind the `publisher` lane to `tools/runtime-publisher-worker.js` and allow it to read the fixed Credential Manager target but not the signing key. Update the Windows installer and lane test so the broker and publisher are distinct SCM services with distinct SIDs and disjoint secret capabilities.

Both reporting CLIs require `--database-mode fixture|production` and run the shared schema preflight for migrations 025–028 before reading authority, envelope or request tables. Production mode returns structured `PENDING` without preparing an absent-table query. Both pass their already-built document to `assertExpectedCliVerdict`; an expectation never changes the report. `autonomous-green-status` permits exactly `INACTIVE`, `SHADOW`, `PRIVATE_CANARY`, `PUBLIC_RAMP_ONE_DAILY`, `PUBLIC_RAMP_TWO_DAILY`, `SUSPENDED`, `REVOKED` or `PENDING`. `autonomous-green-envelope-report` permits exactly `EMPTY`, `NONEMPTY` or `PENDING`. For either CLI, an exact match exits `0`, a valid mismatch exits `2` and an invalid expectation exits `64`. The implementation gate uses a fully migrated fixture and expects inactive/empty state.

```json
"ops:autonomous-green:status": "node tools/autonomous-green-status.js",
"ops:autonomous-green:envelopes": "node tools/autonomous-green-envelope-report.js"
```

- [ ] **Step 4: Run the authority plan gate**

Run:

```powershell
node --test tests/services/autonomous-green-authority.test.js tests/services/autonomous-green-eligibility.test.js tests/services/autonomous-green-release-envelope.test.js tests/services/publication-request-signing.test.js tests/services/autonomous-green-authority-broker.test.js tests/services/youtube-publish-critical-worker.test.js tests/services/youtube-publication-reconciler.test.js tests/services/autonomous-green-publication.integration.test.js tests/ops/autonomous-green-reporting-cli.test.js tests/ops/windows-production-services.test.js
npm run ops:autonomous-green:status -- --database-mode fixture --expect INACTIVE
npm run ops:autonomous-green:envelopes -- --database-mode fixture --expect EMPTY
```

Expected: tests PASS. Authority remains `INACTIVE` or `SHADOW`; no network mutation occurs.

- [ ] **Step 5: Commit**

```powershell
git add config/runtime-lanes.json tools/autonomous-green-status.js tools/autonomous-green-envelope-report.js lib/repositories/publication_governance.js lib/services/publish-dispatch-policy.js tools/windows/install-production-services.ps1 package.json tests/services/autonomous-green-publication.integration.test.js tests/ops/autonomous-green-reporting-cli.test.js tests/ops/windows-production-services.test.js
git commit -m "feat: wire autonomous green shadow authority"
```
