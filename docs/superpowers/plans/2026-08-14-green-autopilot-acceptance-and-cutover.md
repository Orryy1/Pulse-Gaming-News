# GREEN Autopilot Acceptance and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the complete Pulse Gaming conveyor in shadow, exercise its failure boundaries and promote it through private canary and tightly capped public operation using exact operator-signed decisions.

**Architecture:** An immutable acceptance ledger aggregates fixture, shadow, drill, Discord, canary and remote-reconciliation evidence. Promotion tooling can move the standing authority only when the complete prior phase is GREEN and an exact operator signature is present; implementation and test commands never perform a live platform mutation.

**Tech Stack:** Node.js 24 CommonJS, better-sqlite3, YouTube Data API v3 adapter boundary, Discord operations services, Node test runner

**Spec:** `docs/superpowers/specs/2026-08-14-pulse-gaming-green-autopilot-design.md`

## Global Constraints

- Execute this plan only after the runtime, local-AI, production, authority/publisher and Discord plans are complete and their focused gates pass.
- Implementation tests use fixture databases and injected transports. They never use production SQLite, Discord or YouTube.
- Every SQLite-reading CLI requires explicit `--database-mode fixture|production` and shared migration preflight. Production mode returns structured `PENDING` before any query against an unapplied 025–030 table.
- Every operator promotion binds the exact acceptance report, production commit, configuration hash, channel, platform, cadence and policy version.
- Shadow, private-canary, public-ramp and two-daily cadence promotions are four distinct single-use decisions.
- Default CLI behaviour is read-only planning. A live-capable flag is accepted only by a fixed phase-specific command after its exact signed decision validates.
- `AMBER` and `RED` releases never enter the autonomous publisher.
- A canary or public ambiguity consumes its reservation permanently and appends `SUSPEND` with `REQUALIFICATION_REQUIRED`. Read-only reconciliation may resolve remote identity and ledger state, but it never restores mutation authority; return requires signed `RESET_TO_SHADOW`, fresh evidence and fresh promotions rather than ordinary resume.
- The one-Short daily cap remains in force until 30 clean public days and a separate two-daily promotion.
- A claim, restriction, false GREEN, duplicate, off-schedule action, P0/P1 incident or drift suspends authority immediately.
- Do not print, copy, mutate or commit OAuth, Discord or signing credentials.
- Machine-readable JSON and a concise Markdown summary are required for each phase.

## File Structure

- `db/migrations/030_green_autopilot_acceptance.sql`: immutable observations, drill results, phase reports, promotion decisions and publication-slot events.
- `lib/repositories/autopilot_acceptance.js`: acceptance observation and report persistence.
- `lib/repositories/publication_slots.js`: account/day/window cadence reservations and immutable transitions.
- `lib/autopilot/acceptance-report.js`: deterministic threshold evaluation and canonical reports.
- `lib/autopilot/shadow-runner.js`: no-mutation representative and continuous shadow execution.
- `lib/autopilot/drill-runner.js`: restart, fencing, restore, kill-switch, breaker and ambiguity drills.
- `lib/autopilot/promotion.js`: exact phase-transition and operator-signature validation.
- `lib/autopilot/canary-report.js`: private remote-readback aggregation.
- `lib/autopilot/public-ramp-report.js`: daily public safety and cadence evidence.
- `tools/autonomous-green-*.js`: fixed planning, evidence and phase-specific operator commands.
- `docs/runbooks/green-autopilot-*.md`: operator, drill, canary, incident and rollback procedures.

---

### Task 1: Add immutable acceptance and promotion persistence

**Files:**
- Create: `db/migrations/030_green_autopilot_acceptance.sql`
- Create: `lib/repositories/autopilot_acceptance.js`
- Create: `lib/repositories/publication_slots.js`
- Create: `lib/repositories/private_canary_reservations.js`
- Create: `lib/repositories/public_ramp_intervals.js`
- Create: `tests/db/green-autopilot-acceptance-migration.test.js`
- Create: `tests/db/autopilot-acceptance-repository.test.js`
- Create: `tests/db/publication-slots-repository.test.js`
- Create: `tests/db/private-canary-reservations-repository.test.js`
- Create: `tests/db/public-ramp-intervals-repository.test.js`
- Modify: `lib/repositories/index.js`

**Interfaces:**
- Produces: `repos.autopilotAcceptance` with `openShadowSessionFromAuthorityEvent`, `appendObservation`, `recordDrill`, `beginScopeClose`, `sealPhaseReport`, `invalidateScope`, `recordPromotion`, `getCurrentPhase` and `listEvidence`.
- Produces: `repos.publicationSlots` with `reserve`, `bindRequest`, `transition`, `getReservedSnapshot`, `countConsumedForPolicyDay`, `get` and `listByPolicyDay`.
- Produces: `repos.privateCanaryReservations` with `createEpochFromPromotion`, `reserve`, `bindRequest`, `getReservedSnapshot`, `countConsumedForEpoch`, `transition` and `get`.
- Produces: `repos.publicRampIntervals` with `openFromPromotion`, `beginClose`, `seal`, `invalidate`, `getCurrent` and `get`.

- [ ] **Step 1: Write failing immutability and replay tests**

```js
test("an acceptance observation is immutable and content-addressed", () => {
  const row = repos.autopilotAcceptance.appendObservation(observation({ key: "fixture:001" }));
  assert.equal(row.sha256, canonicalSha(row.document));
  assert.throws(() => db.prepare("UPDATE autopilot_acceptance_observations SET verdict='GREEN'").run(), /immutable_acceptance_observation/);
});

test("one promotion decision cannot be replayed for another phase", () => {
  repos.autopilotAcceptance.recordPromotion(promotion({ nonce: "n-1", toPhase: "PRIVATE_CANARY" }));
  assert.throws(() => repos.autopilotAcceptance.recordPromotion(promotion({ nonce: "n-1", toPhase: "PUBLIC_RAMP_ONE_DAILY" })), /promotion_nonce_replayed/);
});

test("a publication slot is consumed across authority versions from reservation onward", () => {
  const reserved = repos.publicationSlots.reserve(slot({ accountId: "pulse", policyDay: "2026-08-14", windowUtc: "19:00", authorityVersion: 4, contentRunId: "run-1", envelopeId: "env-1", envelopeSha256: ENVELOPE_SHA }));
  const signedSnapshot = repos.publicationSlots.getReservedSnapshot({ slotId: reserved.id });
  repos.publicationSlots.bindRequest({ slotId: reserved.id, expectedVersion: 0, requestId: "req-1", requestSha256: REQUEST_SHA });
  assert.throws(() => repos.publicationSlots.bindRequest({ slotId: reserved.id, expectedVersion: 1, requestId: "req-2", requestSha256: OTHER_REQUEST_SHA }), /publication_slot_request_already_bound/);
  repos.publicationSlots.transition({ slotId: reserved.id, expectedVersion: 1, toState: "STARTED" });
  repos.publicationSlots.transition({ slotId: reserved.id, expectedVersion: 2, toState: "AMBIGUOUS" });
  assert.throws(() => repos.publicationSlots.reserve(slot({ accountId: "pulse", policyDay: "2026-08-14", windowUtc: "19:00", authorityVersion: 6 })), /publication_slot_consumed/);
  assert.equal(repos.publicationSlots.countConsumedForPolicyDay({ accountId: "pulse", policyDay: "2026-08-14" }), 1);
  assert.deepEqual(repos.publicationSlots.getReservedSnapshot({ slotId: reserved.id }), signedSnapshot);
  assert.equal(repos.publicationSlots.get({ slotId: reserved.id }).version, 3);
});

test("a private-canary budget is scoped to one immutable promotion epoch", () => {
  const epoch = repos.privateCanaryReservations.createEpochFromPromotion(privateCanaryPromotion({ decisionId: "promote-private-1" }));
  for (let ordinal = 1; ordinal <= 10; ordinal += 1) repos.privateCanaryReservations.reserve(canaryReservation({ epochId: epoch.id, ordinal }));
  assert.throws(() => repos.privateCanaryReservations.reserve(canaryReservation({ epochId: epoch.id, ordinal: 11 })), /private_canary_phase_cap_reached/);
  repos.autopilotAcceptance.recordPromotion(pauseResumePromotion({ phaseEpochId: epoch.id }));
  assert.equal(repos.privateCanaryReservations.countConsumedForEpoch({ epochId: epoch.id }), 10);
  const fresh = repos.privateCanaryReservations.createEpochFromPromotion(privateCanaryPromotion({ decisionId: "promote-private-2", afterReset: true }));
  assert.notEqual(fresh.id, epoch.id);
  assert.equal(repos.privateCanaryReservations.countConsumedForEpoch({ epochId: fresh.id }), 0);
});

test("ARM_SHADOW and RESET_TO_SHADOW own exactly one deterministic shadow session", () => {
  const initial = repos.autopilotAcceptance.openShadowSessionFromAuthorityEvent(armShadowEvent({ eventId: "arm-1" }));
  assert.equal(repos.autopilotAcceptance.openShadowSessionFromAuthorityEvent(armShadowEvent({ eventId: "arm-1" })).id, initial.id);
  assert.throws(() => repos.autopilotAcceptance.openShadowSessionFromAuthorityEvent(armShadowEvent({ eventId: "arm-2" })), /shadow_session_already_open/);
  const reset = applyResetAndOpenShadow(resetShadowEvent({ eventId: "reset-1" }));
  assert.equal(repos.autopilotAcceptance.getSession(initial.id).state, "INVALIDATED");
  assert.notEqual(reset.session.id, initial.id);
});

test("public-ramp promotion opens one immutable interval and pause does not replace it", () => {
  const interval = repos.publicRampIntervals.openFromPromotion(publicRampPromotion({ decisionId: "promote-public-1" }));
  applyPauseAndResume({ intervalId: interval.id });
  assert.equal(repos.publicRampIntervals.getCurrent().id, interval.id);
  assert.equal(repos.publicRampIntervals.openFromPromotion(publicRampPromotion({ decisionId: "promote-public-1" })).id, interval.id);
  assert.throws(() => repos.publicRampIntervals.openFromPromotion(publicRampPromotion({ decisionId: "promote-public-2" })), /public_ramp_interval_already_open/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/db/green-autopilot-acceptance-migration.test.js tests/db/autopilot-acceptance-repository.test.js tests/db/publication-slots-repository.test.js tests/db/private-canary-reservations-repository.test.js tests/db/public-ramp-intervals-repository.test.js`

Expected: FAIL because migration 030 and the repository do not exist.

- [ ] **Step 3: Create migration 030**

Create `autopilot_acceptance_sessions`, immutable `autopilot_acceptance_observations`, immutable `autopilot_drill_results`, immutable `autopilot_phase_reports`, immutable `autopilot_promotion_decisions`, versioned `autopilot_publication_slots`, immutable `autopilot_publication_slot_events`, immutable `autopilot_private_canary_epochs`, versioned `autopilot_private_canary_reservations` and immutable private-canary reservation events. A session, epoch or ramp interval stores immutable open/close bounds plus per-table start and end high-water marks so a report proves the complete database set rather than accepting a caller subset. Uniquely constrain session ID plus observation key, drill execution ID, report SHA, promotion nonce, publication account plus UTC policy day plus window and canary epoch plus ordinal. Add update/delete denial triggers to all immutable evidence, decision, epoch and reservation-event tables. Store phase, exact authority ID/version, commit, config hash, policy hash, report SHA, operator identity, signature algorithm, signature, nonce, expiry and prior phase. A private-canary epoch is derived from and uniquely binds the exact signed `PROMOTE_PRIVATE_CANARY` decision ID/hash; `RESUME` preserves it, while signed `RESET_TO_SHADOW` invalidates it and only a fresh promotion creates a new epoch. Slot and canary reservation states are `RESERVED`, `STARTED`, `AMBIGUOUS`, `UPLOADED`, `RECONCILED` and `EXPIRED_UNSTARTED`; every state counts as consumed and no state, pause/resume or authority-version change releases capacity.

- [ ] **Step 4: Implement transactional repository methods**

Migration 030 also creates versioned `autopilot_public_ramp_intervals` plus immutable interval events. `ARM_SHADOW` atomically opens the one shadow session whose ID is derived from the authority-definition SHA and ARM decision/event ID, binding its exact authority version and start high-water marks. `RESET_TO_SHADOW` invalidates any open prior session and opens a fresh deterministic session in the same transaction; pause/resume preserves the current session. `PROMOTE_PUBLIC_RAMP` similarly opens exactly one interval bound to its decision, authority definition and UTC policy-day start. Pause/resume preserves that interval and reset invalidates it. A duplicate replay returns the same session or interval, while a second competing open fails.

`sealPhaseReport()` must run the closed-set verifier and verify every complete-set observation, event and drill hash inside one transaction. Closing first fences the scope's writers, requires zero pending/retryable scope jobs, captures end high-water marks, then queries by immutable scope/session/epoch/interval identity rather than trusting an ID range. It stores the scope bounds, start/end high-water marks, ordered member IDs, member count and set SHA; a caller cannot provide or omit members. A late insert for a closed scope is rejected or appends an immutable closure-invalidated event, and promotion rechecks the same set SHA plus zero invalidation immediately before apply. `recordPromotion()` must use expected phase/version semantics and reject missing, expired or already consumed decisions. Publication-slot and private-canary reserve/transition methods use expected-version semantics and database uniqueness rather than check-then-insert races. `getReservedSnapshot` canonicalises the immutable original `RESERVED` event. Public slots include ID, SHA, version, account, UTC policy day, window, exact 30-minute `opens_at`/`closes_at`, content-run ID and envelope ID/SHA. Private canaries include ID, SHA, version, phase-epoch ID, promotion decision ID/hash, ordinal, content-run ID and envelope ID/SHA. Both reservation types require owner fields atomically and they are immutable. Their `bindRequest` performs one expected-version CAS from null to the exact root request ID/SHA, appends an immutable `ROOT_REQUEST_BOUND` event and can never rebind. Unique constraints enforce one reservation to one root request and one root request to one reservation. A later recoverable-pause continuation is an immutable child in the publication-request chain, not a reservation rebind; it must name the same bound root ID/SHA. Signed requests bind the relevant snapshot forever and later verification compares it with the original event, never the mutable current projection. Repository methods return deep-frozen documents rather than mutable database rows.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/db/green-autopilot-acceptance-migration.test.js tests/db/autopilot-acceptance-repository.test.js tests/db/publication-slots-repository.test.js tests/db/private-canary-reservations-repository.test.js tests/db/public-ramp-intervals-repository.test.js tests/db/migrations.test.js`

Expected: PASS against a temporary fixture database. No command targets `D:\pulse-data\pulse.db`.

- [ ] **Step 6: Commit**

```powershell
git add db/migrations/030_green_autopilot_acceptance.sql lib/repositories/autopilot_acceptance.js lib/repositories/publication_slots.js lib/repositories/private_canary_reservations.js lib/repositories/public_ramp_intervals.js lib/repositories/index.js tests/db/green-autopilot-acceptance-migration.test.js tests/db/autopilot-acceptance-repository.test.js tests/db/publication-slots-repository.test.js tests/db/private-canary-reservations-repository.test.js tests/db/public-ramp-intervals-repository.test.js
git commit -m "feat: persist autopilot acceptance evidence"
```

### Task 2: Build the representative shadow corpus and acceptance evaluator

**Files:**
- Create: `test/fixtures/autopilot-acceptance/manifest.json`
- Create: `test/fixtures/autopilot-acceptance/stories/*.json`
- Create: `lib/autopilot/shadow-runner.js`
- Create: `lib/autopilot/shadow-session.js`
- Create: `lib/autopilot/acceptance-report.js`
- Create: `lib/autopilot/acceptance-set-closure.js`
- Create: `lib/job-handlers/autopilot-shadow-observe.js`
- Create: `lib/job-handlers/autopilot-shadow-day-close.js`
- Create: `lib/job-handlers/autopilot-phase-seal.js`
- Create: `tools/autonomous-green-shadow-acceptance.js`
- Create: `tests/services/autopilot-shadow-runner.test.js`
- Create: `tests/services/autopilot-shadow-session.test.js`
- Create: `tests/services/autopilot-acceptance-report.test.js`
- Create: `tests/services/autopilot-acceptance-set-closure.test.js`
- Create: `tests/services/autopilot-phase-seal.test.js`
- Create: `tests/services/autopilot-shadow-jobs.test.js`
- Modify: `config/runtime-lanes.json`
- Modify: `config/autopilot-job-ownership.json`
- Modify: `lib/job-handlers.js`
- Modify: `lib/scheduler.js`
- Modify: `lib/stabilisation/scheduler-profile.js`
- Modify: `package.json`
- Modify: `tests/ops/windows-production-services.test.js`
- Modify: `tests/services/autopilot-job-ownership.test.js`

**Interfaces:**
- Produces: `runShadowCorpus({ manifest, pipeline, clock, mutationTrap }) -> observations`.
- Produces: `recordShadowTerminalObservation({ runId, sessionId, repos, now })` and `sealShadowDay({ sessionId, policyDay, repos, now })`.
- Produces: `proveClosedAcceptanceSet({ scope, scopeId, repos, transaction, now }) -> { orderedMembers, startHighWater, endHighWater, setSha256, blockers }`.
- Produces: `buildAcceptanceReport({ sessionId, repos, discord, authority, now }) -> { verdict, metrics, blockers, document, sha256 }`.
- Produces: `handleAutopilotPhaseSeal({ scopeType, scopeId, repos, clock }) -> immutableSealReceipt`.
- Produces: `handleAutopilotShadowObserve({ sessionId, runId, expectedRunVersion, repos, now })` and `handleAutopilotShadowDayClose({ sessionId, policyDayUtc, repos, now })`.

- [ ] **Step 1: Write the failing corpus and threshold tests**

```js
test("the representative corpus contains thirty labelled cases", () => {
  const manifest = loadAcceptanceManifest();
  assert.equal(manifest.cases.length, 30);
  assert.deepEqual(countBy(manifest.cases, "expectedVerdict"), { GREEN: 12, AMBER: 8, RED: 10 });
  assert.equal(manifest.cases.slice(-10).every((entry) => entry.expectedVerdict === "GREEN"), true);
});

test("acceptance rejects one false green or one external mutation", () => {
  const report = buildAcceptanceReport(fixtureAcceptance({ falseGreenCount: 1, externalMutationCount: 1 }));
  assert.equal(report.verdict, "RED");
  assert.deepEqual(report.blockers.sort(), ["external_mutation_in_shadow", "false_green_detected"]);
});

test("continuous shadow requires thirty distinct runs and ten consecutive green envelopes", () => {
  assert.equal(buildAcceptanceReport(fixtureAcceptance({ continuousRunCount: 29 })).verdict, "RED");
  assert.equal(buildAcceptanceReport(fixtureAcceptance({ consecutiveContinuousGreen: 9 })).verdict, "RED");
});

test("continuous shadow records one terminal observation per content run", async () => {
  await recordShadowTerminalObservation(shadowFixture({ runId: "run-1" }));
  await assert.rejects(() => recordShadowTerminalObservation(shadowFixture({ runId: "run-1" })), /shadow_observation_exists/);
  assert.equal(externalMutationCount(), 0);
});

test("shadow sealing rejects an omitted run, day close, high-water gap or late member", async () => {
  for (const patch of [{ omitRunId: "run-17" }, { omitPolicyDay: "2026-08-20" }, { endHighWater: "stale" }, { nonterminalRunId: "run-29" }, { latePostCloseRunId: "run-31" }]) {
    const report = await buildAcceptanceReport(closedShadowFixture(patch));
    assert.equal(report.verdict, "RED");
    assert.ok(report.blockers.some((entry) => entry.startsWith("acceptance_set_not_closed")));
  }
});

test("the phase sealer closes one complete scope and cannot race a late writer", async () => {
  const isolated = eligibleShadowScope({ completeDays: 7, distinctRuns: 30, consecutiveGreen: 10, pendingScopeJobs: 0 });
  const [first, replay] = await Promise.all([handleAutopilotPhaseSeal(isolated), handleAutopilotPhaseSeal(isolated)]);
  assert.equal(first.receiptSha256, replay.receiptSha256);
  assert.equal(isolated.repos.phaseReports.list().length, 1);
  await assert.rejects(() => isolated.repos.autopilotAcceptance.appendObservation(lateShadowObservation(isolated.sessionId)), /acceptance_scope_closed/);
});

test("phase sealing includes every row and waits for the exact phase threshold", async () => {
  assert.equal((await handleAutopilotPhaseSeal(shadowScope({ completeDays: 6 }))).outcome, "NOT_DUE");
  assert.equal((await handleAutopilotPhaseSeal(canaryScope({ target: 5, reconciled: 4 }))).outcome, "NOT_DUE");
  assert.equal((await handleAutopilotPhaseSeal(rampScope({ completePolicyDays: 29 }))).outcome, "NOT_DUE");
  for (const scope of [shadowScope({ completeDays: 14, falseGreen: 1 }), canaryScope({ target: 5, reconciled: 5, additionalAmbiguous: 1 }), rampScope({ completePolicyDays: 30, missingMonitor: 1 })]) {
    assert.equal((await handleAutopilotPhaseSeal(scope)).verdict, "RED");
  }
});

test("shadow observation and UTC day close have one owner and replay-safe receipts", async () => {
  assert.deepEqual(ownerIdsFor("autopilot_shadow_observe"), ["analytics"]);
  assert.deepEqual(ownerIdsFor("autopilot_shadow_day_close"), ["analytics"]);
  const observed = await handleAutopilotShadowObserve(shadowObserveJob({ sessionId: "shadow-1", runId: "run-7" }));
  const replay = await handleAutopilotShadowObserve(shadowObserveJob({ sessionId: "shadow-1", runId: "run-7" }));
  assert.equal(replay.receiptSha256, observed.receiptSha256);
  assert.equal(observationsFor("shadow-1", "run-7").length, 1);
  const closed = await handleAutopilotShadowDayClose(shadowDayCloseJob({ sessionId: "shadow-1", policyDayUtc: "2026-08-14" }));
  assert.equal(closed.policyDayUtc, "2026-08-14");
  assert.equal(closed.externalMutationCount, 0);
});

test("shadow day-close schedule catches up every missing completed UTC day", async () => {
  assert.equal(scheduleFor("autopilot_shadow_day_close").cron, "5 0 * * *");
  const jobs = await bootstrapShadowDayCloseCatchup(shadowCatchupFixture({ openDay: "2026-08-12", now: "2026-08-15T00:07:00Z", existingDays: ["2026-08-12"] }));
  assert.deepEqual(jobs.map((row) => row.policyDayUtc), ["2026-08-13", "2026-08-14"]);
  assert.equal(jobs.every((row) => row.key === `autopilot_shadow_day_close:shadow-1:${row.policyDayUtc}`), true);
  const replay = await bootstrapShadowDayCloseCatchup(replayShadowCatchupFixture());
  assert.equal(replay.createdJobCount, 0);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-shadow-runner.test.js tests/services/autopilot-shadow-session.test.js tests/services/autopilot-acceptance-report.test.js tests/services/autopilot-acceptance-set-closure.test.js tests/services/autopilot-phase-seal.test.js tests/services/autopilot-shadow-jobs.test.js tests/services/autopilot-job-ownership.test.js`

Expected: FAIL on missing modules and fixture manifest.

- [ ] **Step 3: Create the exact 30-case corpus**

Use retained local fixtures only. The corpus contains:

- 12 expected strict-GREEN verified stories, with the final 10 ordered consecutively
- 6 expected AMBER stories covering incomplete rights, source ambiguity and policy-review cases
- 2 expected AMBER stories covering unavailable local AI and narration/ASR holds
- 4 expected RED stories covering rumours, unsupported claims, unsafe visible copy and advertiser-safety failure
- 2 expected RED duplicate stories
- 2 expected RED stale stories
- 2 expected RED platform, authority or reconciliation failures

Every fixture case binds source bytes, expected state, expected blockers, allowed local-AI task IDs, media rights and the assertion `external_mutations_expected:0`.

- [ ] **Step 4: Implement the no-mutation runner**

For the deterministic fixture corpus, inject a `mutationTrap` into every external adapter. Any YouTube, Discord send, production-DB, OAuth or scheduler-arming call fails the case and increments `externalMutationCount`. Record the complete content-state path, gate outputs, release-envelope SHA when GREEN and exact final hold reason otherwise.

Register `autopilot_shadow_observe` and `autopilot_shadow_day_close` on the fixed analytics lane with their own fixed handler modules and active one-owner registry rows. While authority phase is exactly `SHADOW`, the same transaction that records each terminal production run enqueues one observation job keyed `autopilot_shadow_observe:<sessionId>:<runId>:<runVersion>`. The handler reloads that exact terminal version, writes one immutable observation and performs no external mutation.

Schedule `autopilot_shadow_day_close` at `00:05` UTC daily (`5 0 * * *`) for the just-completed UTC policy day. Analytics bootstrap scans from the current session's immutable open day through yesterday, compares every expected day with existing close receipts and enqueues each missing day once with key `autopilot_shadow_day_close:<sessionId>:<policyDayUtc>` in ascending order. The handler seals one policy day from immutable observations only after all terminal jobs due for that day are settled, then event-enqueues `autopilot_phase_seal`. A pending day retries under the same key; exhaustion is P1 and leaves an explicit missing-day blocker. Restart, concurrent schedule delivery or bootstrap catch-up cannot duplicate a day. Neither handler can load a credential provider, broker a live request or enqueue the publisher.

Register `autopilot_phase_seal` on the `authority-broker` lane, scheduled hourly at minute 17 and enqueued immediately after a relevant terminal day, reservation or monitor receipt. It is the sole production caller of `beginScopeClose` and `sealPhaseReport`. Shadow becomes eligible after at least seven complete policy days, 30 distinct runs and 10 consecutive strict-GREEN envelopes; it closes GREEN as soon as those thresholds and every drill/Discord requirement are complete, while day 14 forces a complete RED-or-GREEN seal rather than extending the interval. `PROMOTE_PRIVATE_CANARY` fixes `target_count:5`, the smallest approved canary, and the sealer closes once all five budget reservations are terminal, with every extra consumed row still included and capable of making the report RED. A one-daily ramp interval closes only after exactly 30 complete policy days and every due monitor, publication, incident and slot is terminal. Closing is a CAS that first fences scope writers, requires zero pending/retryable scope jobs, captures end high-water marks and then calls the read-only report builder. Restart or concurrent invocations return one no-overwrite receipt. A late writer invalidates the closure and blocks promotion.

- [ ] **Step 5: Implement deterministic acceptance thresholds**

Require all 30 fixture cases classified as expected, zero false GREENs, zero duplicates admitted, zero off-schedule actions, zero external mutations and exact repeatability on a second run.

The final shadow report separately requires 7–14 complete production-equivalent shadow days, at least 30 distinct real content runs spanning the approved source classes and content pillars and at least 10 consecutive real strict-GREEN envelopes. `proveClosedAcceptanceSet` fixes the session interval and high-water marks, then transactionally queries every eligible content run, terminal observation, scheduled day-close row, incident and drill inside it. The ordered database set must equal the report member set exactly; a missing, extra, nonterminal or unreported row, policy-day gap or changed high-water mark is RED. The same zero-false-GREEN, duplicate and off-schedule thresholds apply. Its mutation threshold is specifically zero YouTube, public-platform, OAuth, publication or authority-arming mutations. Authorised sends to the private ops Discord channel and required writes to the durable shadow-evidence database are permitted, separately receipted and counted in their own acceptance checks rather than `externalMutationCount`. Fixture mode reports `FIXTURE_GREEN_CONTINUOUS_SHADOW_PENDING` rather than pretending elapsed time or real throughput passed.

- [ ] **Step 6: Add the read-only CLI**

```json
"ops:autonomous-green:shadow-acceptance": "node tools/autonomous-green-shadow-acceptance.js"
```

`--database-mode fixture` runs the corpus against a fully migrated temporary database and writes canonical JSON plus Markdown under `output/autonomous-green/acceptance/fixture/`. `--database-mode production --inspect-continuous` first requires migration 030, then reads durable shadow sessions and writes a report; without it the command returns `PENDING` before querying. It has no flag that can publish, send Discord messages or arm authority.

- [ ] **Step 7: Run tests and commit**

Run:

```powershell
node --test tests/services/autopilot-shadow-runner.test.js tests/services/autopilot-shadow-session.test.js tests/services/autopilot-acceptance-report.test.js tests/services/autopilot-acceptance-set-closure.test.js tests/services/autopilot-phase-seal.test.js tests/services/autopilot-shadow-jobs.test.js tests/services/autopilot-job-ownership.test.js tests/services/autonomous-green-eligibility.test.js tests/ops/windows-production-services.test.js
npm run ops:autonomous-green:shadow-acceptance -- --database-mode fixture
```

Expected: tests PASS. Fixture report is GREEN for fixture classification and explicitly pending the elapsed continuous-shadow requirement.

```powershell
git add test/fixtures/autopilot-acceptance config/runtime-lanes.json config/autopilot-job-ownership.json lib/autopilot/shadow-runner.js lib/autopilot/shadow-session.js lib/autopilot/acceptance-report.js lib/autopilot/acceptance-set-closure.js lib/job-handlers/autopilot-shadow-observe.js lib/job-handlers/autopilot-shadow-day-close.js lib/job-handlers/autopilot-phase-seal.js lib/job-handlers.js lib/scheduler.js lib/stabilisation/scheduler-profile.js tools/autonomous-green-shadow-acceptance.js tests/services/autopilot-shadow-runner.test.js tests/services/autopilot-shadow-session.test.js tests/services/autopilot-acceptance-report.test.js tests/services/autopilot-acceptance-set-closure.test.js tests/services/autopilot-phase-seal.test.js tests/services/autopilot-shadow-jobs.test.js tests/services/autopilot-job-ownership.test.js tests/ops/windows-production-services.test.js package.json
git commit -m "feat: evaluate autonomous shadow acceptance"
```

### Task 3: Automate restart, fencing, recovery and safety drills

**Files:**
- Create: `lib/autopilot/drill-runner.js`
- Create: `tools/autonomous-green-drills.js`
- Create: `tests/services/autopilot-drill-runner.test.js`
- Create: `tests/ops/autonomous-green-drills.test.js`
- Create: `docs/runbooks/green-autopilot-drills.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `runAutopilotDrill({ drillId, harness, repos, clock }) -> immutableDrillResult`.

- [ ] **Step 1: Write failing drill contract tests**

```js
for (const drillId of [
  "host_restart", "worker_crash", "scheduler_lease_loss", "publisher_lease_loss",
  "database_restore", "kill_switch_restart", "durable_breaker_restart",
  "authority_binding_drift", "authority_revocation", "ambiguous_youtube_insert", "ambiguous_youtube_status_update"
]) {
  test(`${drillId} reaches its exact safe terminal state`, async () => {
    const result = await runAutopilotDrill({ drillId, harness: fixtureHarness(drillId) });
    assert.equal(result.verdict, "GREEN");
    assert.equal(result.external_mutation_count, 0);
  });
}
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-drill-runner.test.js tests/ops/autonomous-green-drills.test.js`

Expected: FAIL because the drill runner and CLI do not exist.

- [ ] **Step 3: Implement isolated drill harnesses**

Each drill uses a temporary database, fixture data root, fake clocks and injected transports. Assert these terminal conditions:

- restart preserves engaged kill switch and open breaker state
- stale jobs and leases cannot commit after reassignment
- partial bootstrap rolls back handles and never reports ready
- backup restores to a distinct temporary path and passes SQLite integrity plus manifest hashes
- ambiguous YouTube outcomes reserve once, prohibit retry and enter reconciliation state
- commit, configuration, model, policy, key or worker drift suspends standing authority as `REQUALIFICATION_REQUIRED`, rejects ordinary `RESUME` and requires definition-bound `RESET_TO_SHADOW` before the next publication window
- the isolated `authority_revocation` harness consumes one signed `REVOKE` decision, transitions the fixture authority to terminal `REVOKED`, engages the fixture external-mutations switch, invalidates all resume challenges, refuses `RESUME`, `RESET_TO_SHADOW` and every publication request across restart and records zero external mutations; it never targets the current production authority
- publisher lease loss aborts before the next mutation boundary
- no drill writes to production data, credentials or live services

- [ ] **Step 4: Add plan/apply separation for a later host drill**

`node tools/autonomous-green-drills.js --database-mode fixture --plan` emits commands, required maintenance window and expected evidence only. `--database-mode production --apply-host-drills` requires schema preflight, a distinct signed `SHADOW_HOST_DRILL` operator decision and an external fixture data root. Authority revocation remains an isolated signed fixture harness even during production acceptance: its sealed receipt binds the current authority definition hash while its fixture authority ID, database identity and transport trap prove that it could not revoke or mutate production. The implementation plan must run only fixture mode.

- [ ] **Step 5: Write the runbook**

Document prerequisites, exact expected states, rollback, safe target-path validation and evidence paths for each drill. The database restore drill must never overwrite the production database. The sealed drill-set report is complete only when the repository-derived fixed drill ID set, including `authority_revocation`, has exact set equality with its immutable receipts; omission, duplicate IDs or a non-terminal revocation receipt is RED.

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
node --test tests/services/autopilot-drill-runner.test.js tests/ops/autonomous-green-drills.test.js tests/services/jobs-fencing.test.js tests/services/durable-kill-switch.test.js tests/services/durable-circuit-breaker.test.js
node tools/autonomous-green-drills.js --database-mode fixture
```

Expected: PASS and all fixture drill artefacts GREEN with zero live mutations.

```powershell
git add lib/autopilot/drill-runner.js tools/autonomous-green-drills.js tests/services/autopilot-drill-runner.test.js tests/ops/autonomous-green-drills.test.js docs/runbooks/green-autopilot-drills.md package.json
git commit -m "feat: exercise autonomous recovery drills"
```

### Task 4: Prove Discord operations and operator communication end to end

**Files:**
- Create: `lib/autopilot/discord-acceptance.js`
- Create: `tools/autonomous-green-discord-acceptance.js`
- Create: `tests/services/autopilot-discord-acceptance.test.js`
- Create: `docs/runbooks/green-autopilot-discord-ops.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildDiscordAcceptance({ isolatedCommandSemantics, productionProbe, deliveryReceipts, digests, incidents, now })`.

- [ ] **Step 1: Write command and outbox acceptance tests**

```js
test("isolated signed harness proves all nine command semantics and replay protection", () => {
  const report = buildDiscordAcceptance(completeDiscordFixture({ mode: "isolated_signed_harness" }));
  assert.equal(report.verdict, "GREEN");
  assert.deepEqual(report.commands_verified, ["status", "why-blocked", "pause", "kill", "resume", "hold", "reject", "revise", "ask"]);
  assert.equal(report.duplicate_delivery_count, 0);
});

test("the real shadow probe is non-destructive and cannot invalidate its own session", () => {
  const report = buildDiscordAcceptance(completeDiscordFixture({
    productionProbeCommands: ["status", "why-blocked", "ask"],
    productionMutationCommands: [],
    signedHarnessCommands: ["status", "why-blocked", "pause", "kill", "resume", "hold", "reject", "revise", "ask"]
  }));
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.production_probe.external_mutations, 0);
  assert.equal(report.production_probe.authority_invalidations, 0);
});

test("a missing daily digest or unconfirmed resume is RED", () => {
  const report = buildDiscordAcceptance(completeDiscordFixture({ dailyDigest: null, resumeConfirmed: false }));
  assert.equal(report.verdict, "RED");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-discord-acceptance.test.js`

Expected: FAIL on missing acceptance module.

- [ ] **Step 3: Implement acceptance evaluation**

Split acceptance into two sealed layers. A fixture/isolated signed harness requires exact guild, private channel and operator identities, replay rejection and all nine command semantics, including kill, hold, reject, revise and two-step resume, against a temporary database and fake transports. The real private-channel shadow probe verifies the deployed application/guild/channel/operator identities, signed interaction ingestion, `status`, `why-blocked` and advisory-only `ask`, one outbound round trip, one daily digest, one weekly digest, P1 incident create/edit flow, outbox retry/dead-letter evidence, no direct publisher invocation and no secret content. It must not execute live kill, content hold/reject/revise or any other command that invalidates the current shadow session. A recoverable pause/resume round trip is optional only inside a separately signed maintenance window and is not required for GREEN. The isolated all-nine proof plus non-destructive real probe are both required; neither can stand in for the other.

- [ ] **Step 4: Add read-only evidence command and runbook**

`npm run ops:autonomous-green:discord-acceptance -- --database-mode fixture|production` runs migration preflight before reading existing receipts and writes JSON plus Markdown. Missing production migration 029 or 030 returns structured `PENDING` before any domain query. It does not send a test message. The runbook gives the operator a separate signed `DISCORD_ACCEPTANCE_PROBE` procedure for the non-destructive private-channel round trip during shadow operation and explicitly forbids using a production `kill` or content mutation as acceptance evidence.

```json
"ops:autonomous-green:discord-acceptance": "node tools/autonomous-green-discord-acceptance.js"
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
node --test tests/services/autopilot-discord-acceptance.test.js tests/services/discord-ops-command-validator.test.js tests/services/discord-ops-restart.test.js tests/services/discord-outbox-worker.test.js tests/services/autopilot-operator-digests.test.js
npm run ops:autonomous-green:discord-acceptance -- --database-mode fixture
```

Expected: tests PASS. The command reports pending until real shadow receipts exist.

```powershell
git add lib/autopilot/discord-acceptance.js tools/autonomous-green-discord-acceptance.js tests/services/autopilot-discord-acceptance.test.js docs/runbooks/green-autopilot-discord-ops.md package.json
git commit -m "feat: verify autonomous Discord operations"
```

### Task 5: Seal the shadow report and require exact operator promotions

**Files:**
- Create: `lib/autopilot/initial-authority.js`
- Create: `lib/autopilot/promotion.js`
- Create: `lib/runtime/autopilot-root-bootstrap.js`
- Create: `lib/services/operator-promotion-signing.js`
- Create: `tools/autonomous-green-promotion.js`
- Create: `tools/autonomous-green-materialise-authority.js`
- Create: `tools/autonomous-green-operator-decision.js`
- Create: `tools/windows/provision-autopilot-operator-key.ps1`
- Create: `tools/windows/bootstrap-autopilot-root.ps1`
- Create: `tests/services/autopilot-promotion.test.js`
- Create: `tests/services/autopilot-initial-authority.test.js`
- Create: `tests/services/operator-promotion-signing.test.js`
- Create: `tests/ops/autonomous-green-promotion-cli.test.js`
- Create: `tests/ops/autonomous-green-materialise-authority-cli.test.js`
- Create: `tests/ops/autonomous-green-operator-decision-cli.test.js`
- Create: `tests/ops/autopilot-root-bootstrap.test.js`
- Create: `docs/runbooks/green-autopilot-promotion.md`
- Modify: `lib/services/autonomous-green-authority.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `materialiseInitialAutonomousGreenAuthority({ signedDecision, definition, cutoverReceipt, repos, verifier, now })`.
- Produces: `buildPromotionRequest({ fromPhase, toPhase, acceptanceReport, authority, runtime, cadence, now })`.
- Produces: `buildAuthorityResetRequest({ suspendedAuthority, replacementDefinition, resolutionEvidence, runtime, now })`.
- Produces: `verifyAndApplyPromotion({ request, signedDecision, repos, verifier, now })`.
- Produces: `signOperatorPromotion(request, keyHandle)` and `verifyOperatorPromotion({ decision, trust, now })`.
- Produces: `planOperatorDecision({ decisionType, fixedContext, now })`, `signFixedOperatorDecision({ decisionType, keyProvider })` and `verifyFixedOperatorDecision({ decision, expectedType, expectedBindings, trustHistory, now })`.
- Produces: `planAutopilotRootBootstrap({ controlRoot, productionRoot, operatorSid, machineSid, now })` and a one-time local-console `applyAutopilotRootBootstrap(plan)` owned only by `bootstrap-autopilot-root.ps1`.

- [ ] **Step 1: Write wrong-phase, drift, expiry and forged-signature tests**

```js
test("private canary promotion requires the exact sealed shadow report", () => {
  assert.throws(() => verifyAndApplyPromotion(fixturePromotion({ reportSha: "0".repeat(64) })), /acceptance_report_mismatch/);
});

test("initial authority materialisation is signed, exact and idempotent", () => {
  assert.equal(authorityRepo.listDefinitions().length, 0);
  const first = materialiseInitialAutonomousGreenAuthority(initialAuthorityFixture({ decisionType: "MATERIALISE_AUTONOMOUS_GREEN_DEFINITION" }));
  assert.equal(first.phase, "INACTIVE");
  assert.equal(first.version, 0);
  assert.equal(authorityRepo.listDefinitions().length, 1);
  assert.equal(authorityRepo.listEvents(first.authorityId)[0].event_type, "MATERIALISE_INACTIVE");
  const replay = materialiseInitialAutonomousGreenAuthority(initialAuthorityFixture({ decisionId: first.decisionId }));
  assert.equal(replay.receiptSha256, first.receiptSha256);
  assert.throws(() => materialiseInitialAutonomousGreenAuthority(initialAuthorityFixture({ decisionId: "different" })), /initial_authority_already_materialised/);
});

test("missing, multiple or drifted definitions block ARM_SHADOW", () => {
  for (const override of [{ definitionCount: 0 }, { definitionCount: 2 }, { definitionSha256: "0".repeat(64) }]) {
    assert.throws(() => verifyAndApplyPromotion(armShadowFixture(override)), /initial_authority_not_exact/);
  }
});

test("a valid decision is single-use and binds cadence", () => {
  const first = verifyAndApplyPromotion(validSignedPromotion({ toPhase: "PUBLIC_RAMP_ONE_DAILY", maxPerPolicyDay: 1, permittedWindowsUtc: ["19:00"], policyDayTimezone: "UTC" }));
  assert.equal(first.phase, "PUBLIC_RAMP_ONE_DAILY");
  assert.throws(() => verifyAndApplyPromotion(validSignedPromotion({ toPhase: "PUBLIC_RAMP_ONE_DAILY" })), /promotion_decision_consumed/);
});

test("two-daily promotion activates only the pre-bound second window", () => {
  const promoted = verifyAndApplyPromotion(validSignedPromotion({ fromPhase: "PUBLIC_RAMP_ONE_DAILY", toPhase: "PUBLIC_RAMP_TWO_DAILY", maxPerPolicyDay: 2, permittedWindowsUtc: ["13:00", "19:00"], cleanDays: 30 }));
  assert.deepEqual(promoted.activeCadence, { policy_day_timezone: "UTC", max_per_policy_day: 2, permitted_windows_utc: ["13:00", "19:00"], window_execution_minutes: 30, minimum_cooldown_minutes: 360 });
  assert.equal(promoted.definitionSha256, IMMUTABLE_DEFINITION_SHA);
});

test("a decision signed by any key except the pinned operator key is rejected", () => {
  const decision = signFixtureDecision(untrustedKeys.privateKey);
  assert.throws(() => verifyOperatorPromotion({ decision, trust: PINNED_TRUST, now: NOW }), /operator_signature_untrusted/);
});

test("historical operator decisions remain verifiable after a trusted rotation", () => {
  const oldDecision = signFixtureDecision(operatorK1.privateKey, { keyId: "operator-k1" });
  rotateOperatorTrustFixture({ from: operatorK1, to: operatorK2 });
  assert.equal(verifyOperatorPromotion({ decision: oldDecision, trustHistory: TRUST_HISTORY, now: LATER, mode: "historical_evidence" }).valid, true);
  assert.equal(loadOperatorTrustHistory("operator-k1").sha256, OPERATOR_K1_ORIGINAL_SHA);
  assert.equal(operatorTrustProjection("operator-k1").status, "VERIFICATION_ONLY_RETAINED");
  assert.throws(() => verifyOperatorPromotion({ decision: oldDecision, trustHistory: missingHistory() }), /historical_operator_trust_not_found/);
});

test("ARM, reset and public promotion own their acceptance scopes atomically", () => {
  const armed = verifyAndApplyPromotion(armShadowFixture());
  assert.equal(armed.shadowSession.authority_event_id, armed.eventId);
  assert.equal(replayPromotion(armed.decision).shadowSession.id, armed.shadowSession.id);
  const reset = verifyAndApplyPromotion(validSignedReset({ priorSessionId: armed.shadowSession.id }));
  assert.equal(reset.invalidatedSessionId, armed.shadowSession.id);
  assert.notEqual(reset.shadowSession.id, armed.shadowSession.id);
  const publicRamp = verifyAndApplyPromotion(validSignedPromotion({ fromPhase: "PRIVATE_CANARY", toPhase: "PUBLIC_RAMP_ONE_DAILY" }));
  assert.equal(publicRamp.rampInterval.promotion_decision_id, publicRamp.decisionId);
});

test("operator decision tooling accepts only fixed allowlisted ceremonies", () => {
  for (const decisionType of OPERATOR_DECISION_TYPES) {
    const planned = planOperatorDecision({ decisionType, fixedContext: fixtureContext(decisionType), now: NOW });
    assert.equal(verifyFixedOperatorDecision({ decision: signFixture(planned), expectedType: decisionType, expectedBindings: planned.bindings, trustHistory: TRUST_HISTORY, now: NOW }).valid, true);
  }
  assert.throws(() => planOperatorDecision({ decisionType: "CALLER_CHOSEN", fixedContext: {} }), /operator_decision_type_forbidden/);
  assert.throws(() => signFixedOperatorDecision({ decisionType: "ARM_SHADOW", requestPath: "caller.json" }), /caller_path_forbidden/);
});

test("root bootstrap is one-time, path-safe and precedes every signed ceremony", async () => {
  const plan = planAutopilotRootBootstrap(rootBootstrapFixture());
  assert.equal(plan.network_mutation_count, 0);
  assert.equal(plan.production_database_query_count, 0);
  const applied = await applyAutopilotRootBootstrap(plan);
  assert.equal(applied.verdict, "GREEN");
  assert.equal(applied.operator_private_key_location, "WINDOWS_CREDENTIAL_MANAGER");
  assert.equal(applied.secret_bytes_in_receipt, 0);
  assert.equal(applied.control_root_is_normal_non_reparse, true);
  assert.equal(applied.production_root_is_normal_non_reparse, true);
  assert.ok(applied.base_acl_sha256);
  await assert.rejects(() => applyAutopilotRootBootstrap(plan), /autopilot_root_already_bootstrapped/);
  await assert.rejects(() => applyAutopilotRootBootstrap(rootBootstrapFixture({ productionRootInsideCheckout: true })), /production_root_inside_checkout/);
});

test("requalification suspension can reset only to a new exact shadow definition", () => {
  assert.throws(() => verifyAndApplyPromotion(resetFixture({ reasonClass: "RECOVERABLE_PAUSE" })), /reset_not_required/);
  const reset = verifyAndApplyPromotion(validSignedReset({ reasonClass: "REQUALIFICATION_REQUIRED", replacementDefinitionSha256: CURRENT_DEFINITION_SHA }));
  assert.equal(reset.phase, "SHADOW");
  assert.equal(reset.prior_phase_evidence_valid, false);
  assert.equal(reset.external_mutations_switch_state, "ENGAGED");
  assert.throws(() => applyDiscordResume(reset), /fresh_shadow_required/);
});

test("the first fresh promotion clears only the expected requalification switch version", () => {
  assert.throws(() => verifyAndApplyPromotion(validSignedPromotion({ fromPhase: "SHADOW", toPhase: "PRIVATE_CANARY", switchVersion: 6, shadowReportSha: FRESH_SHADOW_SHA })), /stale_kill_switch_version/);
  const promoted = verifyAndApplyPromotion(validSignedPromotion({ fromPhase: "SHADOW", toPhase: "PRIVATE_CANARY", switchVersion: 7, shadowReportSha: FRESH_SHADOW_SHA }));
  assert.equal(promoted.phase, "PRIVATE_CANARY");
  assert.equal(promoted.external_mutations_switch_state, "CLEAR");
});

test("initial cutover from shadow uses the same signed switch-version clear", () => {
  const promoted = verifyAndApplyPromotion(validSignedPromotion({ fromPhase: "SHADOW", toPhase: "PRIVATE_CANARY", initialCutover: true, switchState: "ENGAGED", switchVersion: 1, shadowReportSha: INITIAL_SHADOW_SHA }));
  assert.equal(promoted.external_mutations_switch_state, "CLEAR");
  assert.equal(promoted.external_mutations_switch_version, 2);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-initial-authority.test.js tests/services/autopilot-promotion.test.js tests/services/operator-promotion-signing.test.js tests/ops/autopilot-root-bootstrap.test.js tests/ops/autonomous-green-materialise-authority-cli.test.js tests/ops/autonomous-green-promotion-cli.test.js tests/ops/autonomous-green-operator-decision-cli.test.js`

Expected: FAIL on missing promotion service and command.

- [ ] **Step 3: Implement four fixed transitions**

After the schema cutover, a separate signed `MATERIALISE_AUTONOMOUS_GREEN_DEFINITION` decision binds the exact GREEN cutover receipt, clean runtime/config/model/policy/trust/account/worker identities and complete immutable definition bytes. `materialiseInitialAutonomousGreenAuthority` requires zero existing definitions and projections, then inserts exactly one definition, one `INACTIVE` version-0 projection and one `MATERIALISE_INACTIVE` event atomically. Replay of the exact consumed decision returns its receipt; a different decision, multiple/partial rows or any drift fails closed. It never arms shadow or clears the seeded switch.

After that one-time materialisation, allow only:

1. `INACTIVE -> SHADOW` after a distinct signed shadow-start decision
2. `SHADOW -> PRIVATE_CANARY` after a sealed GREEN shadow report
3. `PRIVATE_CANARY -> PUBLIC_RAMP_ONE_DAILY` after a sealed GREEN private-canary report
4. `PUBLIC_RAMP_ONE_DAILY -> PUBLIC_RAMP_TWO_DAILY` after 30 clean days and a distinct cadence decision

`RESET_TO_SHADOW` is a separate recovery event, not a fifth promotion. It is permitted only from `SUSPENDED` with `REQUALIFICATION_REQUIRED`, resolved-incident evidence, a replacement current immutable definition and a distinct signed reset decision. It invalidates prior phase evidence, cannot restore a public or canary phase directly and keeps the exact durable `external_mutations` switch `ENGAGED`. Initial `ARM_SHADOW` uses that same fail-closed engaged state. Fresh shadow work remains local and evidence-only. For both first cutover and requalification, the later signed `SHADOW -> PRIVATE_CANARY` transition is the only re-arm point: after verifying the current definition and sealed fresh shadow report, it clears the expected engaged switch version in the same transaction as the promotion event. Version drift or any failure rolls back both operations. Ordinary Discord resume never clears a requalification switch.

Phase changes also own acceptance-scope lifecycle in that same transaction. `ARM_SHADOW` opens the deterministic session derived from definition plus decision/event IDs. `RESET_TO_SHADOW` invalidates every open shadow, canary and ramp scope, then opens a fresh shadow session. `SHADOW -> PRIVATE_CANARY` seals/rechecks the exact shadow report and creates one epoch with immutable `target_count:5` plus hard cap 10. `PRIVATE_CANARY -> PUBLIC_RAMP_ONE_DAILY` seals/rechecks that exact epoch and opens one public-ramp interval. Pause/resume preserves the current session, epoch or interval. `PUBLIC_RAMP_ONE_DAILY -> PUBLIC_RAMP_TWO_DAILY` can occur only after the current interval is closed and sealed over exactly 30 policy days. Each scope open/invalidate is part of the authority expected-version transaction, so a crash or replay cannot leave phase and scope disagreeing.

Every request includes exact channel, YouTube account/channel ID, commit, config hash, model set, policy hash, authority definition, acceptance report, effective and expiry times and the exact phase-projected cadence. A `SHADOW -> PRIVATE_CANARY` request additionally signs `external_mutations.expected_state:"ENGAGED"` and `external_mutations.expected_version`; the applied receipt signs and records the resulting clear version. A caller cannot substitute the switch row or version after the operator signs. The immutable definition ceiling is `policy_day_timezone:"UTC"`, `max_per_policy_day:2`, `permitted_windows_utc:["13:00","19:00"]`, `window_execution_minutes:30` and `minimum_cooldown_minutes:360`. The one-daily projection narrows this to one release at `19:00`; the two-daily projection activates both pre-bound windows. A byte change invalidates the request. Promotion changes the authority phase/version and active projection only, never the immutable definition SHA.

Use the Ed25519 operator trust contract created by the runtime plan and keep it separate from the broker request-signing key. The committed `config/operator-trust.schema.json` defines the exact trust-record schema but contains no real key. Provisioning exclusively writes the actual operator ID, key ID, public key, fingerprint, creation time and status to `<controlRoot>/operator-trust/history/<key-id>.json`, then atomically points `<controlRoot>/operator-trust/current.json` at it. Runtime selection and standing authority bind the current record's SHA-256 and key ID. Every decision binds its exact history-record SHA, key ID and fingerprint. Tests use fixture trust history.

The root of trust is created by one fixed local-console bootstrap before any signed ceremony. `bootstrap-autopilot-root.ps1` defaults to plan mode and permits `-ControlRoot` plus `-ProductionRoot` only during this first ceremony. It resolves both to absolute normal non-reparse paths outside the development and future live checkouts, rejects existing non-empty or weakly owned targets, proves the expected local operator and machine SIDs, creates only the closed directory layout and applies a base ACL limited to that operator and SYSTEM. `-ApplyBootstrap` requires an interactive exact confirmation phrase, accepts the exact just-inspected canonical plan hash and uses exclusive no-overwrite creation. It generates the first Ed25519 key inside the process, writes the private key only to the interactive operator's fixed Windows Credential Manager target `PulseGaming/AutopilotOperatorSigning`, zeroes temporary buffers and writes the public immutable trust-history record, current pointer, schema and a JSON/Markdown bootstrap receipt. No secret bytes enter the receipt or stdout. Any partial creation is a RED manual recovery state and is never overwritten or retried automatically. Fixture tests inject filesystem, ACL and credential adapters and make zero host changes.

The bootstrap receipt binds the realised control/production roots, realpaths, base ACL hash, machine/operator SIDs, first trust-record SHA/key ID, tool/source hashes and zero database/network/runtime mutations. The approved runtime-selection planner requires this receipt and re-reads the roots before it can emit decision bytes. The later service installer may extend only declared data subdirectory ACLs to its newly created service SIDs and records the resulting final ACL hash; it cannot change the control-root/operator-key ACL. `provision-autopilot-operator-key.ps1` remains the rotation/recovery plan tool after bootstrap and cannot create a second initial root.

The private key lives only in the interactive operator account's Windows Credential Manager target `PulseGaming/AutopilotOperatorSigning`; production service identities cannot read it. Key rotation or recovery is a separate operator cutover action.

Rotation requires a canonical `ROTATE_OPERATOR_PROMOTION_KEY` decision signed by the current key, writes the new immutable history entry without overwrite, appends a signed `VERIFICATION_ONLY_RETAINED` status/rotation event for the old key and atomically advances the current pointer. It never deletes or rewrites an old key record, so every historical decision continues to verify against the exact original history-record SHA plus the append-only event chain. Historical promotion, reset and schema-cutover receipts resolve the exact key active when signed, while only the current pointer may author a new decision. Rotation is forbidden while a signed but unapplied decision is live and followed by a new shadow acceptance run because the runtime configuration hash changes. If the current key is lost, keep the kill switch engaged and use the documented offline break-glass re-provisioning ceremony; there is no unsigned rotation path.

- [ ] **Step 4: Implement plan-first CLI semantics**

`node tools/autonomous-green-materialise-authority.js --database-mode <fixture|production> --plan` runs schema preflight and requires the exact cutover receipt before emitting the fixed initial-definition request; its later `--apply` loads only the fixed signed decision and never accepts definition bytes from the caller. `node tools/autonomous-green-promotion.js --database-mode <fixture|production> --phase <phase> --plan` then runs schema preflight before reading the one exact current projection and writes an unsigned transition request to the phase's fixed path under the ACL-protected control root. `--reset-to-shadow --plan` writes only the fixed recovery request described above. The generic operator-decision tool below is the sole signer for these requests and every other ceremony. Each type-specific `--apply` loads the corresponding fixed signed-decision path and fails if the source checkout or a caller-selected path supplies it. Production plan/apply returns `PENDING` before reading absent authority/acceptance tables. Tests inject the signer, verifier and temporary control root. Do not run `--sign`, provisioning or `--apply` during implementation.

`tools/autonomous-green-operator-decision.js` is the one closed ceremony planner/signer for every operator decision, including phase promotions and reset. It accepts only `--type` from the committed allowlist `APPROVE_RUNTIME_SELECTION`, `INSTALL_PRODUCTION_RUNTIME_IDENTITIES`, `PROVISION_AUTHORITY_BROKER_KEY`, `RETIRE_LEGACY_RUNTIME_OWNERS`, `PROVISION_DISCORD_INTERACTIONS_INGRESS`, `PROVISION_SCHEMA_CUTOVER_LATCH`, `PRODUCTION_SCHEMA_CUTOVER`, `MATERIALISE_AUTONOMOUS_GREEN_DEFINITION`, `ARM_SHADOW`, `SHADOW_HOST_DRILL`, `DISCORD_ACCEPTANCE_PROBE`, `PUBLISHER_CREDENTIAL_CUTOVER`, `PROMOTE_PRIVATE_CANARY`, `PROMOTE_PUBLIC_RAMP`, `PROMOTE_TWO_DAILY`, `RESET_TO_SHADOW`, `ROTATE_OPERATOR_PROMOTION_KEY` and `REQUEUE_EXPIRED_UNSTARTED`. Every type has one fixed request path, one fixed signed-decision path and a type-specific complete binding builder. It accepts no caller JSON, binding, identity or path. Planning is read-only, signing is available only to the pinned interactive operator identity and applying remains owned by the fixed type-specific service. Nonce replay, expiry, wrong type, wrong trust event chain and path substitution fail before mutation.

The same closed allowlist includes `RETIRE_REMOTE_LEGACY_DEPLOYMENT`, bound to the exact provider/project/deployment inventory and `RETAIN_PRIVATE_AFTER_WINDOW_EXPIRY`, bound to the exact held run, remote video ID, expired slot and zero-remote-mutation disposition.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
node --test tests/services/autopilot-initial-authority.test.js tests/services/autopilot-promotion.test.js tests/services/operator-promotion-signing.test.js tests/ops/autopilot-root-bootstrap.test.js tests/ops/autonomous-green-materialise-authority-cli.test.js tests/ops/autonomous-green-promotion-cli.test.js tests/ops/autonomous-green-operator-decision-cli.test.js tests/services/autonomous-green-authority.test.js
node tools/autonomous-green-materialise-authority.js --database-mode fixture --plan
node tools/autonomous-green-promotion.js --database-mode fixture --phase SHADOW --plan
```

Expected: tests PASS and the plan command creates no authority transition.

```powershell
git add lib/autopilot/initial-authority.js lib/autopilot/promotion.js lib/runtime/autopilot-root-bootstrap.js lib/services/operator-promotion-signing.js tools/autonomous-green-materialise-authority.js tools/autonomous-green-promotion.js tools/autonomous-green-operator-decision.js tools/windows/bootstrap-autopilot-root.ps1 tools/windows/provision-autopilot-operator-key.ps1 lib/services/autonomous-green-authority.js tests/services/autopilot-initial-authority.test.js tests/services/autopilot-promotion.test.js tests/services/operator-promotion-signing.test.js tests/ops/autopilot-root-bootstrap.test.js tests/ops/autonomous-green-materialise-authority-cli.test.js tests/ops/autonomous-green-promotion-cli.test.js tests/ops/autonomous-green-operator-decision-cli.test.js docs/runbooks/green-autopilot-promotion.md package.json
git commit -m "feat: require signed autopilot promotions"
```

### Task 6: Build private-canary execution and exact remote reconciliation

**Files:**
- Create: `lib/autopilot/canary-report.js`
- Create: `lib/autopilot/private-canary-controller.js`
- Create: `lib/autopilot/private-canary-scheduler.js`
- Create: `tools/autonomous-green-private-canary.js`
- Create: `tests/services/autopilot-private-canary.test.js`
- Create: `tests/services/autopilot-private-canary-controller.test.js`
- Create: `tests/services/autopilot-private-canary-scheduler.test.js`
- Create: `tests/ops/autonomous-green-private-canary-cli.test.js`
- Create: `docs/runbooks/green-autopilot-private-canary.md`
- Modify: `lib/services/publication-request-signing.js`
- Modify: `lib/services/publication-action-contract.js`
- Modify: `lib/services/autonomous-green-authority-broker.js`
- Modify: `config/runtime-lanes.json`
- Modify: `config/autopilot-job-ownership.json`
- Modify: `lib/job-handlers.js`
- Modify: `lib/scheduler.js`
- Modify: `lib/stabilisation/scheduler-profile.js`
- Modify: `tests/services/publication-request-signing.test.js`
- Modify: `tests/services/publication-action-contract.test.js`
- Modify: `tests/services/autonomous-green-authority-broker.test.js`
- Modify: `tests/ops/windows-production-services.test.js`
- Modify: `tests/services/autopilot-job-ownership.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildPrivateCanaryReport({ epochId, repos, now })`.
- Produces: `reservePrivateCanary({ authority, envelopeId, repos, broker, now }) -> { reservation, requestId }`.
- Produces: `runAutonomousPrivateCanaryWindow({ repos, readinessProvider, broker, now }) -> { reservationId, requestId, blockers }`.

- [ ] **Step 1: Write the five-to-ten canary threshold tests**

```js
test("five exact private releases with complete readback are GREEN", () => {
  const report = buildPrivateCanaryReport(canaryFixture({ count: 5 }));
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.private_release_count, 5);
});

test("public visibility, duplicate, missing caption or ambiguous outcome is RED", () => {
  const report = buildPrivateCanaryReport(canaryFixture({ privacyStatus: "public", duplicateCount: 1 }));
  assert.equal(report.verdict, "RED");
});

test("the canary report cannot omit any consumed reservation or event in its epoch", async () => {
  for (const sixth of [
    { state: "AMBIGUOUS" },
    { state: "UPLOADED", privacyStatus: "public" },
    { state: "STARTED" }
  ]) {
    const isolated = completeEpochFixture({ reconciledPrivateCount: 5, additionalReservation: sixth });
    const report = await buildPrivateCanaryReport({ epochId: isolated.epochId, repos: isolated.repos, now: NOW });
    assert.equal(report.verdict, "RED");
    assert.equal(report.closed_set.member_count, 6);
    assert.ok(report.blockers.includes("private_canary_epoch_not_fully_reconciled"));
  }
});

test("fewer than five canaries cannot promote and more than ten cannot reserve", async () => {
  assert.equal(buildPrivateCanaryReport(canaryFixture({ count: 4 })).verdict, "RED");
  assert.equal(buildPrivateCanaryReport(canaryFixture({ count: 11 })).verdict, "RED");
  await assert.rejects(() => reservePrivateCanary(canaryControllerFixture({ consumedOrReserved: 10 })), /private_canary_phase_cap_reached/);
});

test("concurrent reservation attempts cannot consume the same final slot", async () => {
  const [first, second] = await Promise.allSettled([reserveFinalCanarySlot(), reserveFinalCanarySlot()]);
  assert.equal([first, second].filter((row) => row.status === "fulfilled").length, 1);
});

test("every canary reservation state consumes the same epoch cap across restart", async () => {
  const states = ["RESERVED", "STARTED", "AMBIGUOUS", "UPLOADED", "RECONCILED", "EXPIRED_UNSTARTED"];
  const epoch = await canaryEpochFixture();
  for (let index = 0; index < states.length; index += 1) await createCanaryInState({ epochId: epoch.id, ordinal: index + 1, state: states[index] });
  assert.equal(countConsumedForEpoch(epoch.id), 6);
  await restartCanaryController();
  assert.equal(countConsumedForEpoch(epoch.id), 6);
  await Promise.allSettled(Array.from({ length: 4 }, (_, index) => reservePrivateCanary(canaryControllerFixture({ phaseEpochId: epoch.id, ordinal: index + 7 }))));
  assert.equal(countConsumedForEpoch(epoch.id), 10);
  await assert.rejects(() => reservePrivateCanary(canaryControllerFixture({ phaseEpochId: epoch.id, ordinal: 11 })), /private_canary_phase_cap_reached/);
});

test("pause and resume preserve the canary epoch and cannot reopen its cap", async () => {
  const epoch = await promotePrivateCanaryEpoch();
  await consumeCanaryReservations(epoch.id, 10);
  await pauseAndResumePrivateCanary();
  await assert.rejects(() => reservePrivateCanary(canaryControllerFixture({ phaseEpochId: epoch.id })), /private_canary_phase_cap_reached/);
});

test("reset and a fresh signed promotion create a new zero-count epoch", async () => {
  const oldEpoch = await consumedEpochFixture(10);
  await resetToShadowAndRequalify();
  const fresh = await promotePrivateCanaryEpoch();
  assert.notEqual(fresh.id, oldEpoch.id);
  assert.equal(countConsumedForEpoch(fresh.id), 0);
});

test("PRIVATE_UPLOAD signs the exact canary reservation and no public slot", async () => {
  const result = await reservePrivateCanary(canaryControllerFixture());
  assert.equal(loadContentRun(result.reservation.content_run_id).state, "PUBLISH_RESERVED");
  assert.equal(loadContentRun(result.reservation.content_run_id).active_publication_reservation_id, result.reservation.id);
  const request = loadSignedRequest(result.requestId);
  assert.equal(request.publication_slot, null);
  assert.deepEqual(request.private_canary, {
    epoch_id: result.reservation.epoch_id,
    reservation_id: result.reservation.id,
    reservation_sha256: result.reservation.sha256,
    ordinal: result.reservation.ordinal
  });
  assert.equal(verifyPublicationRequest({ ...verifyFixture(request), activeCanaryEpochId: result.reservation.epoch_id }).valid, true);
  assert.equal(verifyPublicationRequest({ ...verifyFixture(request), activeCanaryEpochId: "wrong-epoch" }).valid, false);
});

test("the fixed canary window runs without per-video input and stops at its epoch cap", async () => {
  const first = await runAutonomousPrivateCanaryWindow(canaryWindowFixture({ consumedInEpoch: 4, eligibleCount: 2 }));
  assert.equal(first.brokerCalls, 1);
  assert.equal(first.publisherJobs, 1);
  assert.equal(first.reservation.ordinal, 5);
  const capped = await runAutonomousPrivateCanaryWindow(canaryWindowFixture({ consumedInEpoch: 10, eligibleCount: 2 }));
  assert.equal(capped.requestId, null);
  assert.ok(capped.blockers.includes("private_canary_phase_cap_reached"));
});

test("canary window crash recovery reuses one reservation and request", async () => {
  for (const crashAt of ["AFTER_BUDGET_RESERVE", "AFTER_REQUEST_BOUND", "AFTER_PUBLISHER_ENQUEUE"]) {
    const isolated = canaryWindowCrashFixture({ crashAt });
    await assert.rejects(() => runAutonomousPrivateCanaryWindow(isolated), /simulated_crash/);
    await runAutonomousPrivateCanaryWindow(isolated);
    assert.equal(isolated.canaryReservations.length, 1);
    assert.equal(isolated.contentRuns[0].state, "PUBLISH_RESERVED");
    assert.equal(isolated.publicationRequests.length, 1);
    assert.equal(isolated.publisherJobs.length, 1);
  }
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-private-canary.test.js tests/services/autopilot-private-canary-controller.test.js tests/services/autopilot-private-canary-scheduler.test.js tests/ops/autonomous-green-private-canary-cli.test.js`

Expected: FAIL on missing canary module and command.

- [ ] **Step 3: Implement private-canary validation**

Require 5–10 distinct strict-GREEN envelopes from one immutable private-canary phase epoch. The builder accepts only the epoch ID and repositories. In one transaction, `proveClosedAcceptanceSet` queries every consumed reservation and immutable event from the epoch's opening high-water mark through its close, then requires exact set equality and terminal `RECONCILED` state for every member. A caller cannot pass a release list. Five good rows plus an omitted, public, ambiguous, expired or otherwise nonterminal sixth row is RED. Each receipt must prove exact epoch and one canary-budget reservation, channel, remote ID, private visibility, processed state, video identity evidence, title, description, tags, language, category, captions, disclosures, no duplicate and the complete distinct `VIDEO_INSERT` plus `CAPTION_INSERT` submutation reservation/receipt set. Claims/restriction checks use point-in-time evidence where the platform exposes it and are labelled `NOT_EVALUATED` rather than inferred when unavailable. Reports must never combine canaries across epoch IDs.

- [ ] **Step 4: Implement a fixed phase-aware CLI**

The CLI requires explicit database mode and migrations 025–030 before reading phase, envelope or canary tables; production returns `PENDING` first when they are absent. `--plan` lists eligible envelopes and performs read-only local preflight. A future `--apply-private-canary` path calls `reservePrivateCanary`, which transactionally requires active `PRIVATE_CANARY` authority, action `PRIVATE_UPLOAD`, a strict-GREEN unused envelope and `countConsumedForEpoch(currentEpochId) < 10`. That one canonical counter includes every `RESERVED`, `STARTED`, `AMBIGUOUS`, `UPLOADED`, `RECONCILED` and `EXPIRED_UNSTARTED` budget reservation and cannot decrease on transition, restart, pause or resume. The reservation snapshot binds epoch ID, promotion decision ID/hash, ordinal, envelope SHA and its own ID/hash. Pause/resume preserves the epoch and its consumed count. Reset invalidates it; a fresh signed promotion creates a new zero-count epoch. The broker signs that snapshot as `private_canary`, requires `publication_slot:null` and rejects an epoch, reservation, ordinal or envelope mismatch before credential access. Public requests require `private_canary:null`. It then delegates only the returned signed `{ request_id }` to the isolated publisher. The implementation tests supply a fake adapter and assert at most one insert, always private. Do not invoke the live flag in this plan.

Register one fixed `autonomous_green_private_canary_window` schedule at `19:00` UTC on the authority-broker lane. It is active only in `PRIVATE_CANARY`, uses canonical PRIVATE_UPLOAD readiness and selects at most one ordered `ENVELOPED` run. In one transaction it reserves the epoch budget with immutable run/envelope ownership, transitions that exact run `ENVELOPED -> PUBLISH_RESERVED` by expected version and writes the reservation ID into the run's unique active-publication-owner field. No other canary or public scheduler can select the run after that commit. The broker persists the request and binds its ID/SHA to that reservation atomically, then the handler enqueues one publisher job by `<reservationId>:<requestSha256>`. Restart after reserve, bind or enqueue reloads the same owner and never selects or brokers again. It emits no-action receipts once the promotion-bound target of five is consumed and lets `autopilot_phase_seal` close the epoch when all five are terminal; the hard cap of ten remains a fail-closed protection and is never an autonomous target. There is no per-video operator step or caller-selected live payload. The CLI apply path is retained only as a fixed maintenance/reconciliation tool and is not the normal autonomous trigger.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
node --test tests/services/autopilot-private-canary.test.js tests/services/autopilot-private-canary-controller.test.js tests/services/autopilot-private-canary-scheduler.test.js tests/services/autopilot-acceptance-set-closure.test.js tests/ops/autonomous-green-private-canary-cli.test.js tests/services/publication-request-signing.test.js tests/services/publication-action-contract.test.js tests/services/autonomous-green-authority-broker.test.js tests/services/youtube-publish-critical-worker.test.js tests/services/youtube-publication-reconciler.test.js tests/services/autopilot-job-ownership.test.js tests/ops/windows-production-services.test.js
node tools/autonomous-green-private-canary.js --database-mode fixture --plan
```

Expected: tests PASS. The local plan contains no remote mutation.

```powershell
git add config/runtime-lanes.json config/autopilot-job-ownership.json lib/autopilot/canary-report.js lib/autopilot/private-canary-controller.js lib/autopilot/private-canary-scheduler.js lib/job-handlers.js lib/scheduler.js lib/stabilisation/scheduler-profile.js lib/services/publication-request-signing.js lib/services/publication-action-contract.js lib/services/autonomous-green-authority-broker.js tools/autonomous-green-private-canary.js tests/services/autopilot-private-canary.test.js tests/services/autopilot-private-canary-controller.test.js tests/services/autopilot-private-canary-scheduler.test.js tests/services/publication-request-signing.test.js tests/services/publication-action-contract.test.js tests/services/autonomous-green-authority-broker.test.js tests/services/autopilot-job-ownership.test.js tests/ops/autonomous-green-private-canary-cli.test.js tests/ops/windows-production-services.test.js docs/runbooks/green-autopilot-private-canary.md package.json
git commit -m "feat: govern private autopilot canaries"
```

### Task 7: Enforce the one-daily public ramp and 30-day cadence gate

**Files:**
- Create: `lib/autopilot/public-ramp-report.js`
- Create: `lib/autopilot/publication-scheduler.js`
- Create: `lib/autopilot/post-publication-monitor.js`
- Create: `tools/autonomous-green-public-ramp.js`
- Create: `tests/services/autopilot-public-ramp.test.js`
- Create: `tests/services/autopilot-publication-scheduler.test.js`
- Create: `tests/services/autopilot-post-publication-monitor.test.js`
- Create: `tests/ops/autonomous-green-public-ramp-cli.test.js`
- Create: `docs/runbooks/green-autopilot-public-ramp.md`
- Modify: `config/runtime-lanes.json`
- Modify: `config/autopilot-job-ownership.json`
- Modify: `lib/job-handlers.js`
- Modify: `lib/scheduler.js`
- Modify: `lib/stabilisation/scheduler-profile.js`
- Modify: `lib/services/autonomous-green-authority-broker.js`
- Modify: `lib/services/autonomous-green-authority.js`
- Modify: `lib/services/autonomous-green-eligibility.js`
- Modify: `lib/services/control-command-executor.js`
- Modify: `lib/services/publication-request-signing.js`
- Modify: `lib/services/youtube-publish-critical-worker.js`
- Modify: `package.json`
- Modify: `tests/services/control-command-executor.test.js`
- Modify: `tests/services/publication-request-signing.test.js`
- Modify: `tests/services/youtube-publish-critical-worker.test.js`
- Modify: `tests/ops/windows-production-services.test.js`
- Modify: `tests/services/autopilot-job-ownership.test.js`

**Interfaces:**
- Produces: `evaluatePublicRamp({ authority, publicationSlots, publicationLedger, incidents, drills, now })`.
- Produces: `buildPublicRampReport({ intervalId, repos, now })`.
- Produces: `runAutonomousPublicationWindow({ repos, readinessProvider, broker, now }) -> { selectedRunId, requestId, blockers }`.
- Produces: `monitorPublishedRelease({ publication, youtubeReadAdapter, repos, now }) -> immutableMonitorReceipt`.

- [ ] **Step 1: Write cadence, suspension and 30-day tests**

```js
test("public ramp admits at most one strict-green release per UTC policy day", () => {
  assert.equal(evaluatePublicRamp(rampFixture({ consumedSlotsToday: 0 })).allowed, true);
  assert.equal(evaluatePublicRamp(rampFixture({ consumedSlotsToday: 1, slotState: "RESERVED" })).allowed, false);
});

test("two daily remains blocked before thirty clean days and promotion", () => {
  assert.equal(evaluatePublicRamp(rampFixture({ cleanDays: 29, requestedDailyCap: 2 })).allowed, false);
  assert.equal(evaluatePublicRamp(rampFixture({ cleanDays: 30, confirmedPublications: 29, requestedDailyCap: 2 })).allowed, false);
  assert.equal(evaluatePublicRamp(rampFixture({ cleanDays: 30, confirmedPublications: 30, monitorReceiptsByOffset: { plus15m: 30, plus6h: 30, plus18h: 29 }, requestedDailyCap: 2 })).allowed, false);
  assert.equal(evaluatePublicRamp(rampFixture({ cleanDays: 30, cadencePromotionActive: false, requestedDailyCap: 2 })).allowed, false);
});

test("ramp sealing rejects an omitted slot, monitor, incident or policy day", async () => {
  for (const patch of [{ omitSlotId: "slot-11" }, { omitMonitorId: "monitor-8" }, { omitIncidentId: "incident-2" }, { omitPolicyDay: "2026-08-22" }]) {
    const report = await buildPublicRampReport(closedRampFixture(patch));
    assert.equal(report.verdict, "RED");
    assert.ok(report.blockers.some((entry) => entry.startsWith("acceptance_set_not_closed")));
  }
});

test("one publication-window job selects at most one exact enveloped run", async () => {
  const result = await runAutonomousPublicationWindow(publicationWindowFixture({ eligibleCount: 2 }));
  assert.equal(result.brokerCalls, 1);
  assert.equal(result.publisherCalls, 0);
  assert.match(result.requestId, /^request_/);
  assert.equal(loadContentRun(result.selectedRunId).state, "PUBLISH_RESERVED");
  assert.equal(loadContentRun(result.selectedRunId).active_publication_reservation_id, result.slotId);
});

test("window restart reuses one owned slot, request and publisher enqueue across every crash boundary", async () => {
  for (const crashAt of ["AFTER_SLOT_RESERVE", "AFTER_REQUEST_BOUND", "AFTER_PUBLISHER_ENQUEUE"]) {
    const isolated = publicationWindowCrashFixture({ crashAt });
    await assert.rejects(() => runAutonomousPublicationWindow(isolated), /simulated_crash/);
    const recovered = await runAutonomousPublicationWindow(isolated);
    assert.equal(isolated.publicationSlots.length, 1);
    assert.equal(isolated.contentRuns[0].state, "PUBLISH_RESERVED");
    assert.equal(isolated.publicationSlots[0].content_run_id, recovered.selectedRunId);
    assert.equal(isolated.publicationSlots[0].envelope_sha256, recovered.envelopeSha256);
    assert.equal(isolated.publicationRequests.length, 1);
    assert.equal(isolated.publisherJobs.length, 1);
    assert.equal(isolated.publicationSlots[0].request_id, isolated.publicationRequests[0].id);
  }
});

test("concurrent window attempts consume one account-day-window slot across authority versions", async () => {
  const results = await Promise.allSettled([
    runAutonomousPublicationWindow(publicationWindowFixture({ authorityVersion: 8 })),
    runAutonomousPublicationWindow(publicationWindowFixture({ authorityVersion: 9 }))
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled" && row.value.requestId).length, 1);
  assert.equal(publicationSlots.countConsumedForPolicyDay({ accountId: PULSE_ACCOUNT, policyDay: TODAY_UTC }), 1);
});

test("the evening attempt is deferred inside its window when the six-hour cooldown is still running", async () => {
  const at1305 = await runAutonomousPublicationWindow(publicationWindowFixture({ windowUtc: "19:00", lastPublicConfirmedAt: "2026-08-14T13:05:00Z", now: "2026-08-14T19:00:00Z" }));
  assert.equal(at1305.requestId, null);
  assert.equal(at1305.deferredJob.runAt, "2026-08-14T19:05:00Z");
  const at1329 = await runAutonomousPublicationWindow(publicationWindowFixture({ windowUtc: "19:00", lastPublicConfirmedAt: "2026-08-14T13:29:00Z", now: "2026-08-14T19:00:00Z" }));
  assert.equal(at1329.deferredJob, null);
  assert.ok(at1329.blockers.includes("insufficient_publication_window_runway"));
  const tooLate = await runAutonomousPublicationWindow(publicationWindowFixture({ windowUtc: "19:00", lastPublicConfirmedAt: "2026-08-14T13:30:00Z", now: "2026-08-14T19:00:00Z" }));
  assert.equal(tooLate.deferredJob, null);
  assert.ok(tooLate.blockers.includes("cooldown_exceeds_publication_window"));
});

test("a stale, failed, incomplete or grace-exhausted due monitor blocks the next public slot and suspends", async () => {
  for (const monitorState of ["MISSING_AFTER_GRACE", "STALE", "FAILED", "INCOMPLETE"]) {
    const result = await runAutonomousPublicationWindow(publicationWindowFixture({ priorDueMonitorState: monitorState }));
    assert.equal(result.requestId, null);
    assert.equal(result.authority.phase, "SUSPENDED");
    assert.equal(result.authority.suspension_reason_code, `REQUIRED_HEALTH_FAILURE:post_publication_monitor:${monitorState}`);
  }
});

test("same-timestamp monitor work wins and completion releases one in-window attempt", async () => {
  const waiting = await runAutonomousPublicationWindow(publicationWindowFixture({
    now: "2026-08-14T19:05:00Z",
    lastPublicConfirmedAt: "2026-08-14T13:05:00Z",
    priorDueMonitorState: "PENDING_WITHIN_GRACE"
  }));
  assert.equal(waiting.requestId, null);
  assert.equal(waiting.authority.phase, "PUBLIC_RAMP_TWO_DAILY");
  assert.equal(waiting.blocker, "publication_monitor_pending_within_grace");
  assert.ok(priorityFor("youtube_post_publication_monitor") > priorityFor("autonomous_green_publish_window"));
  const completed = await completePostPublicationMonitor(monitorFixture({ completedAt: "2026-08-14T19:06:00Z", verdict: "GREEN" }));
  assert.equal(completed.deferredWindowJob.runAt, "2026-08-14T19:06:00Z");
  await completePostPublicationMonitor(replayMonitorFixture(completed));
  assert.equal(windowJobsFor(completed.policyDay, "19:00").filter((row) => row.trigger === "MONITOR_BARRIER_RELEASE").length, 1);
});

test("a detected restriction suspends authority before another window", async () => {
  const receipt = await monitorPublishedRelease(monitorFixture({ regionRestriction: ["GB"] }));
  assert.equal(receipt.verdict, "RED");
  assert.equal(authorityRepo.current().phase, "SUSPENDED");
  assert.equal((await runAutonomousPublicationWindow(publicationWindowFixture())).requestId, null);
});

test("a public request signs the exact consumed publication slot", () => {
  const slot = reservedSlot({ id: "slot-pulse-2026-08-14-1900", accountId: PULSE_ACCOUNT, policyDay: TODAY_UTC, windowUtc: "19:00", contentRunId: RUN_ID, envelopeId: ENVELOPE_ID, envelopeSha256: ENVELOPE_SHA });
  const signed = signPublicationRequest(publicRequestFixture({ publication_slot: canonicalSlotBinding(slot) }), keys.privateKey);
  publicationSlots.bindRequest({ slotId: slot.id, expectedVersion: 0, requestId: signed.id, requestSha256: signed.sha256 });
  assert.equal(verifyPublicationRequest(publicVerifyFixture({ request: signed, expectedSlot: slot })).valid, true);
  for (const publication_slot of [null, undefined]) assert.throws(() => signPublicationRequest(publicRequestFixture({ publication_slot }), keys.privateKey), /publication_slot_required/);
  const wrong = signPublicationRequest(publicRequestFixture({ publication_slot: canonicalSlotBinding({ ...slot, id: "wrong" }) }), keys.privateKey);
  assert.match(verifyPublicationRequest(publicVerifyFixture({ request: wrong, expectedSlot: slot })).blockers.join(","), /publication_slot_mismatch/);
  assert.equal(verifyPublicationRequest(publicVerifyFixture({ request: { ...signed, publication_slot: { ...signed.publication_slot, window_utc: "13:00" } }, expectedSlot: slot })).valid, false);
  publicationSlots.transition({ slotId: slot.id, expectedVersion: 1, toState: "STARTED" });
  publicationSlots.transition({ slotId: slot.id, expectedVersion: 2, toState: "AMBIGUOUS" });
  assert.equal(verifyPublicationRequest(publicVerifyFixture({ request: signed, expectedSlot: publicationSlots.getReservedSnapshot({ slotId: slot.id }) })).valid, true);
});

test("private canary requests retain the null-slot contract", () => {
  const signed = signPublicationRequest(privateRequestFixture({ action: "PRIVATE_UPLOAD", publication_slot: null }), keys.privateKey);
  assert.equal(verifyPublicationRequest(privateVerifyFixture({ request: signed })).valid, true);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-public-ramp.test.js tests/services/autopilot-publication-scheduler.test.js tests/services/autopilot-post-publication-monitor.test.js tests/ops/autonomous-green-public-ramp-cli.test.js`

Expected: FAIL on missing public-ramp module and command.

- [ ] **Step 3: Implement the public-ramp contract**

For one-daily mode require active exact public authority, strict-GREEN envelope, canonical readiness GREEN, a current recovery-drill window, no P0/P1, no claims/restrictions hold and zero consumed publication slots in the current UTC policy day. Every monitor due for a prior publication must have a fresh complete GREEN receipt before a later slot can reserve. A due monitor still running inside its exact 30-minute grace is `PENDING_WITHIN_GRACE`: it blocks slot reservation without opening an incident or suspending authority. Only missing after grace, stale, incomplete, failed or exhausted monitor work opens a P1, engages the switch and calls `ensureRequalificationSuspended` with its exact monitor reason. Count a slot from `RESERVED` onward, including `STARTED`, `AMBIGUOUS`, `UPLOADED`, `RECONCILED` and `EXPIRED_UNSTARTED`; completion is not required for it to consume cadence. The evaluator uses the same `policy_day_timezone`, `max_per_policy_day`, fixed-window and minimum-cooldown function as the authority and broker. Any false GREEN, duplicate, off-schedule mutation, claim, restriction, reconciliation ambiguity, authority drift or failed mandatory drill appends `SUSPEND` with class `REQUALIFICATION_REQUIRED` and its exact reason code.

For two-daily mode additionally require 30 consecutive clean UTC policy days with exactly one confirmed, reconciled public release on each day and the complete three-offset monitor set for every publication: normally 90 GREEN receipts, 30 each at plus 15 minutes, plus 6 hours and plus 18 hours. One missing offset is a gap. Also require zero incidents or cadence gaps, the sealed 30-day report and an exact `PUBLIC_RAMP_TWO_DAILY` promotion. `buildPublicRampReport` accepts only the fixed interval ID and repositories; it transactionally closes over every policy day, slot, publication, action receipt, monitor and incident between the interval's immutable high-water marks. Missing, extra, nonterminal or unreported rows are RED. Preserve the configured minimum cooldown between publication windows.

Register one `autonomous_green_publish_window` schedule for each definition-ceiling window, `13:00` and `19:00`, and bind it only to the `authority-broker` runtime lane. At an identical timestamp, `youtube_post_publication_monitor` has a fixed higher priority than the publication-window job. Its handler loads canonical readiness, phase-projected cadence, the current promotion-bound ramp interval and the ordered `ENVELOPED` buffer. In one-daily mode the `13:00` occurrence is an immutable no-action receipt; in two-daily mode both windows are active. Cooldown is measured from the prior release's confirmed public timestamp. If the scheduled occurrence is too early, calculate `max(opens_at, last_public_confirmation + minimum_cooldown)` and enqueue one durable deferred attempt only when the fixed publisher sequence deadline policy leaves enough time before `closes_at`; otherwise write `insufficient_publication_window_runway` or `cooldown_exceeds_publication_window`. If the window handler observes `PENDING_WITHIN_GRACE`, it writes a no-action barrier receipt and does not create a slot. A GREEN monitor-completion transaction checks the still-active window, cooldown, request deadline, remaining runway and prior barrier key, then enqueues exactly one `MONITOR_BARRIER_RELEASE` window attempt at `max(now, cooldown_end)` when that time is before the close. Restart or repeated completion reuses the same key. A monitor that completes too late records a no-action close receipt; a monitor that exhausts grace suspends before any attempt. The deadline policy is code-hash-bound in the publisher worker and cannot be caller shortened. Thus a 13:05 confirmation defers to 19:05, a 13:29 confirmation safely produces no second attempt and 13:30 cannot create an off-window release. At an active attempt it validates one candidate, then transactionally reserves the account plus UTC policy-day plus window slot with immutable ramp-interval ID, content-run ID and envelope ID/SHA ownership, transitions that exact run `ENVELOPED -> PUBLISH_RESERVED` by expected version and writes the slot ID into its unique active-publication-owner field. The slot uniqueness key deliberately excludes authority version, so suspension, resume or promotion cannot reopen a consumed window. Once reserved, failure, expiry or ambiguity never releases it and restart must reload that same owner rather than select again. The broker persists the one signed root request and CAS-binds its ID/SHA to the slot in the same transaction. A slot can never bind a second root; later requests are children in that root chain. Publisher enqueue uses `<slotId>:<requestSha256>` as a unique idempotency key. Crashes after reservation, state transition, request persistence/binding or enqueue therefore converge on one slot, one envelope, one request chain and one job per request. The handler never calls YouTube itself. Any missing GREEN precondition before reservation produces an immutable no-action receipt.

For `PUBLIC_RELEASE`, `publication-request-signing.js` requires and signs the canonical original `RESERVED` slot snapshot `{ id, sha256, version, account_id, policy_day_utc, window_utc, opens_at, closes_at, content_run_id, envelope_id, envelope_sha256 }`. `opens_at` is the exact UTC policy-day window and `closes_at` is exactly 30 minutes later. Verification calls `publicationSlots.getReservedSnapshot({ slotId })`, verifies the separately signed request envelope/run fields equal the slot owner and verifies the slot's immutable bound request ID/SHA equals the signed request's root ID/SHA. For the root request those are its own bytes; for a continuation they are the immutable root fields and the complete parent chain must verify. It rejects any missing, null, wrong, tampered, forked or rebound value before credential access. Binding a request updates the immutable request fields and appends `ROOT_REQUEST_BOUND` while the slot state remains `RESERVED`; `REQUEST_BOUND` is an event name, never a projection state. It never compares the signed reservation version with the later mutable slot projection, so a legitimate in-window binding followed by `RESERVED -> STARTED -> AMBIGUOUS` still verifies against immutable original bytes plus its one binding event. `PRIVATE_UPLOAD` continues to require `publication_slot:null`. The publisher advances the current public slot projection by expected version in the same database transactions that append publication `STARTED`, `AMBIGUOUS`, recovered `UPLOADED`, `EXPIRED_UNSTARTED` and final `RECONCILED` events. A slot remains consumed even when the content run enters `RECONCILIATION_REQUIRED`, `PUBLICATION_EXPIRED_HOLD`, the authority suspends or a later phase/version becomes active.

Register `youtube_post_publication_monitor` on the credential-isolated publisher lane as a read-only job after reconciliation and on the approved monitoring cadence. It re-reads visibility, processing, restrictions, made-for-kids, metadata, caption presence and other owner-visible fields exposed by the API. Each publication records its exact monitor due times and grace deadline. A later public-window handler must query the complete due set and cannot proceed while any receipt is missing, stale, incomplete or failed. Monitor retry exhaustion is itself a required-health P1 and requalification suspension rather than an advisory gap. Any claim/restriction signal, unexpected visibility, metadata drift, processing failure or remote disappearance transactionally moves the content run to `CLAIM_OR_RESTRICTION_HOLD`, appends authority `SUSPEND` with class `REQUALIFICATION_REQUIRED` and its exact reason code, blocks future window jobs and enqueues a P1 Discord incident before returning. Platform fields that are not exposed are recorded `NOT_EVALUATED`, never inferred GREEN.

The monitoring policy is exact and authority-bound: enqueue owner-only reads at confirmation plus 15 minutes, plus 6 hours and plus 18 hours, each with a 30-minute grace deadline. A publisher-lane bootstrap and five-minute catch-up schedule scan the immutable due ledger and enqueue one job per publication/due-offset idempotency key. Network/5xx failures use the durable breaker and bounded retries only within that receipt's grace window. At grace exhaustion the handler records a terminal failed receipt, opens the P1 and requalification-suspends. Canonical readiness and every later publication window require the complete due set through `now`; a missing scheduler occurrence cannot silently skip monitoring.

An exact-operator Discord `hold` targeting a reconciled publication with reason class `claim`, `strike`, `restriction`, `correction` or `takedown` uses the same durable suspension service and `REQUALIFICATION_REQUIRED` class. This is the manual incident ingress for Studio-only evidence. Once the incident is resolved and a clean monitor receipt exists, operation can return only through a new definition-bound `RESET_TO_SHADOW`, fresh shadow evidence and fresh signed promotions, never ordinary `resume`.

- [ ] **Step 4: Add read-only public plan and report commands**

`node tools/autonomous-green-public-ramp.js --database-mode <fixture|production> --plan` runs schema preflight and returns the next eligible window and blockers without creating a mutation reservation. `--report` materialises JSON plus Markdown from existing ledgers only after migrations 025–030 are present; otherwise production mode returns `PENDING`. A live publish remains owned solely by the isolated worker after the scheduler enqueues an already authorised request. Do not add a generic `--publish` flag.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
node --test tests/services/autopilot-public-ramp.test.js tests/services/autopilot-publication-scheduler.test.js tests/services/autopilot-post-publication-monitor.test.js tests/services/autopilot-acceptance-set-closure.test.js tests/ops/autonomous-green-public-ramp-cli.test.js tests/services/autonomous-green-eligibility.test.js tests/services/autonomous-green-authority.test.js tests/services/publication-request-signing.test.js tests/services/youtube-publish-critical-worker.test.js tests/services/control-command-executor.test.js tests/services/autopilot-job-ownership.test.js tests/ops/windows-production-services.test.js
node tools/autonomous-green-public-ramp.js --database-mode fixture --plan
```

Expected: tests PASS and no external mutation occurs.

```powershell
git add config/runtime-lanes.json config/autopilot-job-ownership.json lib/autopilot/public-ramp-report.js lib/autopilot/publication-scheduler.js lib/autopilot/post-publication-monitor.js tools/autonomous-green-public-ramp.js lib/job-handlers.js lib/scheduler.js lib/stabilisation/scheduler-profile.js lib/services/autonomous-green-authority-broker.js lib/services/autonomous-green-authority.js lib/services/autonomous-green-eligibility.js lib/services/control-command-executor.js lib/services/publication-request-signing.js lib/services/youtube-publish-critical-worker.js tests/services/autopilot-public-ramp.test.js tests/services/autopilot-publication-scheduler.test.js tests/services/autopilot-post-publication-monitor.test.js tests/services/control-command-executor.test.js tests/services/publication-request-signing.test.js tests/services/youtube-publish-critical-worker.test.js tests/services/autopilot-job-ownership.test.js tests/ops/autonomous-green-public-ramp-cli.test.js tests/ops/windows-production-services.test.js docs/runbooks/green-autopilot-public-ramp.md package.json
git commit -m "feat: enforce autonomous public ramp cadence"
```

### Task 8: Build the signed production schema cutover

**Files:**
- Create: `lib/runtime/production-schema-cutover.js`
- Create: `lib/runtime/schema-cutover-latch.js`
- Create: `tools/autopilot-production-schema-cutover.js`
- Create: `tools/autopilot-schema-cutover-latch.js`
- Create: `tests/services/production-schema-cutover.test.js`
- Create: `tests/services/schema-cutover-latch.test.js`
- Create: `tests/ops/autopilot-production-schema-cutover-cli.test.js`
- Create: `tests/ops/autopilot-schema-cutover-latch-cli.test.js`
- Create: `docs/runbooks/green-autopilot-schema-cutover.md`
- Modify: `lib/db.js`
- Modify: `lib/migrate.js`
- Modify: `lib/services/operator-promotion-signing.js`
- Modify: `lib/runtime/readiness.js`
- Modify: `tests/services/operator-promotion-signing.test.js`
- Modify: `tests/services/runtime-readiness.test.js`
- Modify: `tests/services/production-migration-boundary.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `planProductionSchemaCutover({ productionPaths, expectedRuntime, migrationManifest, now }) -> immutablePlan`.
- Produces: `applyProductionSchemaCutover({ fixedDecisionProvider, productionPaths, expectedRuntime, migrationManifest, repos, now }) -> immutableReceipt`.
- Produces: `planSchemaCutoverLatch({ productionPaths, expectedRuntime, expectedServiceSids, now })` and `applySchemaCutoverLatch({ fixedDecisionProvider, productionPaths, now })`.
- Produces: `tools/autopilot-production-schema-cutover.js --database-mode <fixture|production> --plan|--apply` with no caller-selected paths.
- Produces: `tools/autopilot-schema-cutover-latch.js --plan|--apply-engage` with no caller-selected paths.

- [ ] **Step 1: Write fail-closed cutover and rollback tests**

```js
test("production cutover requires one exact signed decision and a stopped fail-closed runtime", async () => {
  const result = await applyProductionSchemaCutover(cutoverFixture());
  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.applied_migrations, [25, 26, 27, 28, 29, 30]);
  assert.equal(result.external_mutations_switch, "ENGAGED");
  assert.equal(result.authority_record_count, 0);
  assert.equal(result.authority_semantic_state, "INACTIVE_UNMATERIALISED");
  assert.equal(result.required_service_process_count, 0);
  assert.equal(result.receipt.single_use_decision_consumed, true);
});

test("cutover reads no future control table and verifies fail-closed seed state after commit", async () => {
  const probe = cutoverFixture({ appliedThrough: 24, externalCutoverLatch: "ENGAGED" });
  const result = await applyProductionSchemaCutover(probe);
  assert.equal(probe.preMigrationAutopilotDomainQueryCount, 0);
  assert.equal(result.external_mutations_switch, "ENGAGED");
  assert.equal(result.external_mutations_switch_version, 1);
  assert.equal(result.authority_record_count, 0);
});

test("every precondition fails before a migration statement", async () => {
  for (const override of [
    { decisionSignature: "invalid" },
    { decisionType: "PROMOTE_PRIVATE_CANARY" },
    { databaseId: "wrong" },
    { commitSha: "wrong" },
    { migrationChecksum: "wrong" },
    { externalCutoverLatch: "CLEAR" },
    { appliedThrough: 25 },
    { requiredServiceAlive: true },
    { schedulerLeaseHeld: true },
    { backupAgeHours: 49 },
    { restoreDrillVerified: false }
  ]) {
    const probe = cutoverFixture(override);
    await assert.rejects(() => applyProductionSchemaCutover(probe), /production_schema_cutover_blocked/);
    assert.equal(probe.migrationStatementCount, 0);
  }
});

test("a migration failure rolls back all 025-030 changes and keeps operation stopped", async () => {
  const result = await applyProductionSchemaCutover(cutoverFixture({ failMigration: 28 }));
  assert.equal(result.verdict, "RED");
  assert.equal(result.database.appliedThrough, 24);
  assert.equal(result.external_mutations_switch, "ENGAGED");
  assert.equal(result.servicesRestarted, false);
  assert.equal(result.failureReceipt.immutable, true);
});

test("decision or receipt replay cannot apply the cutover twice", async () => {
  const fixture = cutoverFixture();
  await applyProductionSchemaCutover(fixture);
  await assert.rejects(() => applyProductionSchemaCutover(fixture), /schema_cutover_already_consumed/);
});

test("the external cutover latch is provisioned once at the fixed control-root path", async () => {
  const result = await applySchemaCutoverLatch(latchFixture({ decisionType: "PROVISION_SCHEMA_CUTOVER_LATCH" }));
  assert.equal(result.state, "ENGAGED");
  assert.equal(result.version, 1);
  assert.equal(result.path, FIXED_CONTROL_ROOT_LATCH_PATH);
  assert.equal(result.acl.publisherWrite, false);
  assert.equal(result.acl.controlPlaneWrite, false);
  assert.equal(result.acl.operatorWrite, true);
  await assert.rejects(() => applySchemaCutoverLatch(latchFixture()), /schema_cutover_latch_already_exists/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/schema-cutover-latch.test.js tests/services/production-schema-cutover.test.js tests/ops/autopilot-schema-cutover-latch-cli.test.js tests/ops/autopilot-production-schema-cutover-cli.test.js tests/services/operator-promotion-signing.test.js tests/services/runtime-readiness.test.js tests/services/production-migration-boundary.test.js`

Expected: FAIL because the cutover service and fixed CLI do not exist.

- [ ] **Step 3: Implement a fixed plan and signed apply ceremony**

First provision the fail-closed external latch. `autopilot-schema-cutover-latch --plan` derives one fixed `<controlRoot>/schema-cutover/latch.json` path, exact operator/service SIDs, expected production root and runtime identity without writing. A later `--apply-engage` requires a fixed signed `PROVISION_SCHEMA_CUTOVER_LATCH` decision, creates the parent with verified non-reparse ownership/ACLs, exclusively creates version 1 in `ENGAGED` state, flushes it and writes a no-overwrite receipt. Only the operator cutover identity may write it; production services may read but never clear or replace it. Existing/drifted files fail closed. The receipt identity is an input to the main cutover plan and decision.

`autopilot-production-schema-cutover --plan` is read-only. It resolves the approved production paths, exact production database identity, clean approved commit/config hashes, the canonical migration 025–030 filename/checksum manifest, an exact contiguous migration-024 baseline, absent/fenced required service processes and legacy scheduler ownership, the ACL-protected external schema-cutover latch and its exact GREEN engage receipt and fresh pre-cutover-v024 backup/restore receipts. It reads only SQLite metadata, migrations 001–024 and integrity state before apply. It must not prepare a statement against migration-025 controls or migration-028 authority tables because they do not exist yet. It emits the canonical bytes the operator must sign as decision type `PRODUCTION_SCHEMA_CUTOVER`. It never accepts a database, migration, backup, decision, latch or receipt path from the caller. A database at 025–029 is rejected as `production_schema_partial_cutover_requires_manual_recovery`; that is a separate signed recovery lane, never an implicit continuation.

The later `--apply` reads the single fixed decision under the ACL-protected external control root and verifies its Ed25519 signature, trusted key ID, plan SHA, exact database ID, commit, config, migration checksums, pre-cutover backup/restore hashes, external latch identity/version, nonce and expiry. It consumes that decision once before mutation. After rechecking that every configured production service is stopped and fenced, no legacy scheduler owner exists and the external latch remains engaged, the cutover service alone unwraps the closure-minted opaque migration capability and calls the non-exported `lib/migrate.js` apply path for the exact contiguous 025–030 set in one `BEGIN IMMEDIATE` transaction. `lib/db.js`, normal `getDb`, bootstrap and every other production entry remain verify-only and cannot mint or pass that capability. Any statement or verification failure rolls the transaction back to migration 024. Never partially continue, auto-skip, overwrite a receipt, auto-restore a backup or restart services.

On success, run SQLite `quick_check`, `integrity_check`, migration-version/checksum verification and durable WAL checkpoint, then verify migration 025 created exactly one `external_mutations:ENGAGED` row and initial event at version 1 and migration 028 left definition/projection tables empty. Bind the switch row/event hashes and empty authority-table counts into fixed no-overwrite JSON and Markdown receipts under the external evidence root. Reporting calls that empty post-cutover state `INACTIVE_UNMATERIALISED`, never an armed authority. Release the external cutover latch only into a `COMPLETE_SWITCH_STILL_ENGAGED` state. On failure, write a distinct immutable failure receipt and keep the latch engaged. In either case leave services stopped. The later signed initial-definition materialiser creates the sole `INACTIVE` projection and a separate signed `ARM_SHADOW` begins shadow; cutover does neither. A later runtime start is another operator action and must consume the GREEN cutover receipt through readiness. The runbook includes stop/fence, plan, offline signature, apply, inspect and manual rollback/escalation commands without embedding secrets.

- [ ] **Step 4: Add CLI scripts and prove fixture behaviour**

```json
"ops:autopilot:schema-cutover-latch": "node tools/autopilot-schema-cutover-latch.js",
"ops:autopilot:schema-cutover": "node tools/autopilot-production-schema-cutover.js"
```

Run:

```powershell
node --test tests/services/schema-cutover-latch.test.js tests/services/production-schema-cutover.test.js tests/ops/autopilot-schema-cutover-latch-cli.test.js tests/ops/autopilot-production-schema-cutover-cli.test.js tests/services/operator-promotion-signing.test.js tests/services/runtime-readiness.test.js tests/services/production-migration-boundary.test.js
node tools/autopilot-schema-cutover-latch.js --plan
node tools/autopilot-production-schema-cutover.js --database-mode fixture --plan
```

Expected: tests PASS and fixture plan mode performs zero production writes. Do not invoke production `--apply` during implementation.

- [ ] **Step 5: Commit**

```powershell
git add lib/runtime/production-schema-cutover.js lib/runtime/schema-cutover-latch.js tools/autopilot-production-schema-cutover.js tools/autopilot-schema-cutover-latch.js lib/db.js lib/migrate.js lib/services/operator-promotion-signing.js lib/runtime/readiness.js tests/services/schema-cutover-latch.test.js tests/services/production-schema-cutover.test.js tests/ops/autopilot-schema-cutover-latch-cli.test.js tests/ops/autopilot-production-schema-cutover-cli.test.js tests/services/operator-promotion-signing.test.js tests/services/runtime-readiness.test.js tests/services/production-migration-boundary.test.js docs/runbooks/green-autopilot-schema-cutover.md package.json
git commit -m "feat: gate production schema cutover"
```

### Task 9: Produce the final programme gate and operator handoff

**Files:**
- Create: `lib/autopilot/programme-readiness.js`
- Create: `tools/autonomous-green-programme-readiness.js`
- Create: `tests/services/autopilot-programme-readiness.test.js`
- Create: `tests/ops/autonomous-green-programme-readiness-cli.test.js`
- Create: `docs/runbooks/green-autopilot-operator-handoff.md`
- Modify: `docs/codex-main-goal.md`
- Modify: `AGENTS.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildAutopilotProgrammeReadiness({ phase, runtime, localAi, production, authority, discord, acceptance, canary, ramp, now })` where `phase` is one of `implementation_complete`, `shadow_ready`, `private_canary_ready`, `public_ramp_ready` or `two_daily_ready`.
- Produces: `tools/autonomous-green-programme-readiness.js --database-mode fixture|production --phase <fixed-phase>`; production schema absence yields `PENDING` before evidence-table queries.

- [ ] **Step 1: Write the complete definition-of-done test**

```js
test("programme readiness is GREEN only with every exact proof layer", () => {
  const report = buildAutopilotProgrammeReadiness({ ...completeProgrammeFixture(), phase: "two_daily_ready" });
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.ready_for_current_phase, true);
  assert.equal(report.blockers.length, 0);
});

test("missing scheduler eligibility or one P1 remains RED", () => {
  const report = buildAutopilotProgrammeReadiness({ ...completeProgrammeFixture({ freshEligibleCandidateCount: 0, openP1: 1 }), phase: "public_ramp_ready" });
  assert.equal(report.verdict, "RED");
});

test("readiness applies only the evidence required for the requested phase", () => {
  const implementation = buildAutopilotProgrammeReadiness({ ...implementationFixture({ realShadowReport: null, authority: null, canaryReport: null }), phase: "implementation_complete" });
  assert.equal(implementation.flags.implementation_complete, true);
  assert.equal(implementation.flags.shadow_ready, false);
  assert.equal(buildAutopilotProgrammeReadiness({ ...shadowFixture({ authorityPhase: "SHADOW", publicationEligibility: "RED" }), phase: "shadow_ready" }).flags.shadow_ready, true);
  assert.equal(buildAutopilotProgrammeReadiness({ ...privateFixture({ sealedShadowReport: null }), phase: "private_canary_ready" }).flags.private_canary_ready, false);
  assert.equal(buildAutopilotProgrammeReadiness({ ...publicFixture({ sealedCanaryReport: null }), phase: "public_ramp_ready" }).flags.public_ramp_ready, false);
  assert.equal(buildAutopilotProgrammeReadiness({ ...twoDailyFixture({ cleanOneDailyDays: 29 }), phase: "two_daily_ready" }).flags.two_daily_ready, false);
});

test("shadow readiness requires the exact engaged external-mutation switch version", () => {
  const green = buildAutopilotProgrammeReadiness({ ...shadowFixture({ authorityPhase: "SHADOW", authoritySwitchVersion: 7, switchState: "ENGAGED", switchVersion: 7 }), phase: "shadow_ready" });
  assert.equal(green.flags.shadow_ready, true);
  const unsafe = buildAutopilotProgrammeReadiness({ ...shadowFixture({ authorityPhase: "SHADOW", authoritySwitchVersion: 7, switchState: "CLEAR", switchVersion: 7 }), phase: "shadow_ready" });
  assert.equal(unsafe.flags.shadow_ready, false);
  assert.ok(unsafe.blockers.includes("shadow_external_mutations_switch_not_engaged"));
});

test("shadow and every later phase require current remote legacy-retirement proof", () => {
  for (const remoteRetirement of [null, remoteRetirementFixture({ stale: true }), remoteRetirementFixture({ providerDrift: true })]) {
    const report = buildAutopilotProgrammeReadiness({ ...shadowFixture({ remoteRetirement }), phase: "shadow_ready" });
    assert.equal(report.flags.shadow_ready, false);
    assert.ok(report.blockers.some((row) => row.startsWith("legacy_remote_deployment_")));
  }
});

test("private-canary readiness requires the live PRIVATE_UPLOAD path to be GREEN", () => {
  const report = buildAutopilotProgrammeReadiness({ ...privateFixture({ privateUploadReadiness: "RED", publisherLaneFresh: false }), phase: "private_canary_ready" });
  assert.equal(report.flags.private_canary_ready, false);
  assert.ok(report.blockers.includes("private_upload_path_not_green"));
});

test("public phases require the current PUBLIC_RELEASE path to be GREEN", () => {
  for (const phase of ["public_ramp_ready", "two_daily_ready"]) {
    const report = buildAutopilotProgrammeReadiness({ ...publicFixture({ publicReleaseReadiness: "RED", publicationSlot: null, statusUpdateScope: false }), phase });
    assert.equal(report.flags[phase], false);
    assert.ok(report.blockers.includes("public_release_path_not_green"));
  }
});

test("programme readiness rejects any inactive, duplicate or unregistered job owner", () => {
  for (const registryPatch of [{ inactiveKind: "publication_health_sentinel" }, { inactiveKind: "youtube_analytics_snapshot" }, { duplicateKind: "discord_daily_digest" }, { missingHandler: "autopilot_phase_seal" }]) {
    const report = buildAutopilotProgrammeReadiness({ ...completeProgrammeFixture({ registryPatch }), phase: "implementation_complete" });
    assert.equal(report.verdict, "RED");
    assert.ok(report.blockers.some((row) => row.startsWith("autopilot_job_ownership_not_exact")));
  }
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-programme-readiness.test.js tests/ops/autonomous-green-programme-readiness-cli.test.js`

Expected: FAIL on missing programme readiness module.

- [ ] **Step 3: Aggregate every required proof**

Apply a progressive requirement matrix and report every flag independently:

- `implementation_complete`: clean committed implementation source, fixture-migrated schema, focused/integration/docs/rules gates, 30-case fixture acceptance, fixture-safe drill tests, every row in the closed autopilot job-ownership registry active with exactly one registered handler and lane and zero P0/P1. It does not require installed services, real probes, active authority, real elapsed shadow, Discord round-trip receipts, a live candidate or canary/ramp evidence.
- `shadow_ready`: `implementation_complete` plus the exact signed approved-runtime-selection and `INSTALL_PRODUCTION_RUNTIME_IDENTITIES` receipts, external production-root/ACL proof, exact stopped-service identity set, exact fresh `RETIRE_LEGACY_RUNTIME_OWNERS` and `RETIRE_REMOTE_LEGACY_DEPLOYMENT` receipts with matching current provider readback, GREEN production-schema-cutover receipt for contiguous migrations 025–030, the one-use initial-definition materialisation receipt, the distinct signed `ARM_SHADOW` and service-activation receipt, fresh leases/heartbeats, real Ollama/VoxCPM/ASR probes, converged no-publication-mutation shadow schedules, fresh backup/restore evidence, a successful non-destructive private Discord acceptance round trip, current authority phase exactly `SHADOW` and zero P0/P1. The durable `external_mutations` row must be `ENGAGED` at the exact switch version recorded by the authority projection; `SHADOW` plus a clear or drifted switch is a P0 blocker even though publication eligibility is otherwise RED. Content and envelope eligibility may be GREEN in this phase, but publication eligibility must be RED with `authority_not_armed`, no signed publication request and no publisher enqueue. It does not require completed shadow observations or a live publication candidate.
- `private_canary_ready`: the accumulated implementation and shadow evidence requirements, plus the sealed 7–14-day/30-run/10-consecutive-GREEN real shadow report, required host drills, active exact `PRIVATE_CANARY` authority, a genuinely eligible strict-GREEN envelope and remaining budget in the current private-canary epoch. It also requires canonical `PRIVATE_UPLOAD` mutation readiness GREEN: current publisher lane and fenced lease healthy, exact signed `PUBLISHER_CREDENTIAL_CUTOVER` receipt plus fresh legacy-surface audit, credential-health receipt current, exact YouTube channel/account preflight GREEN, current switch clear at the authority-recorded version, phase/action/reservation contract GREEN, no orphan mutation attempt, closed breaker and zero P0/P1. Phase membership alone cannot make the canary path ready.
- `public_ramp_ready`: the accumulated implementation, shadow and private-canary evidence requirements, plus a sealed GREEN 5–10-upload private-canary report, active exact `PUBLIC_RAMP_ONE_DAILY` authority, current publication-window eligibility and a fresh eligible `ENVELOPED` run. Its canonical `PUBLIC_RELEASE` path must independently be GREEN now: immutable current-day slot snapshot and interval, publisher lane/lease and credentials, exact channel and status-update scope, clear authority-recorded switch version, phase/action contract, cooldown/day cap, closed breaker, no orphan attempt and zero P0/P1.
- `two_daily_ready`: the accumulated implementation, shadow, private-canary and one-daily evidence requirements, plus 30 consecutive clean one-daily UTC policy days, the complete three-offset monitor set for every publication, normally 90 GREEN receipts, zero gaps/incidents and active exact `PUBLIC_RAMP_TWO_DAILY` authority. It re-evaluates the same current `PUBLIC_RELEASE` mutation path and exact second-window slot rather than inheriting a prior phase's readiness.

Evidence requirements accumulate, but exact phase predicates are mutually exclusive, so the report never requires every phase-specific flag to be true at once. Missing future-phase evidence cannot turn `implementation_complete` RED. Conversely, no earlier flag can inherit or imply a later operational grant. The top-level `verdict` and `ready_for_current_phase` evaluate only the caller's explicit fixed phase argument; the full flag lattice and blockers for every phase remain visible.

- [ ] **Step 4: Amend the operating law only through exact evidence**

Update `docs/codex-main-goal.md` and `AGENTS.md` so per-story review is superseded only for releases satisfying the exact active `AUTONOMOUS_GREEN` contract. Preserve all existing no-live defaults for other modes, channels, platforms, AMBER, RED and manual tools. Bind the amendment hash in the standing authority.

- [ ] **Step 5: Write operator handoff and rollback**

Document normal zero-input operation, daily and weekly Discord messages, manual pause/kill/resume, authority expiry, credential re-authentication, claims/takedowns, correction flow, rollback to `SHADOW`, emergency service stop and evidence collection. Include exact commands from the completed implementation rather than legacy `run.js full`, `run.js publish` or `upload_*.js`.

- [ ] **Step 6: Run the final non-live gate**

Run:

```powershell
node --test tests/services/autopilot-programme-readiness.test.js tests/ops/autonomous-green-programme-readiness-cli.test.js
npm run ops:agent-rules
npm run docs:doctor
npm run ops:autopilot:baseline -- --database-mode fixture --expect GREEN
npm run ops:autopilot:baseline -- --database-mode production --expect PENDING
npm run ops:runtime:readiness -- --database-mode production --expect PENDING
npm run ops:autonomous-green:status -- --database-mode fixture --expect INACTIVE
npm run ops:autonomous-green:discord-acceptance -- --database-mode fixture
npm run ops:autonomous-green:shadow-acceptance -- --database-mode fixture
node tools/autonomous-green-programme-readiness.js --database-mode fixture --phase implementation_complete
node tools/autopilot-production-schema-cutover.js --database-mode fixture --plan
```

Expected: all tests, document checks and the fully migrated fixture baseline PASS. The read-only production baseline and runtime readiness truthfully remain `PENDING` on migrations 025–030 until the separate cutover. The final report can say `implementation_complete:true`, but it must keep every operational readiness flag false until production migration, real probes, real shadow, signed promotions and private canaries supply the phase-specific evidence.

- [ ] **Step 7: Commit**

```powershell
git add lib/autopilot/programme-readiness.js tools/autonomous-green-programme-readiness.js tests/services/autopilot-programme-readiness.test.js tests/ops/autonomous-green-programme-readiness-cli.test.js docs/runbooks/green-autopilot-operator-handoff.md docs/codex-main-goal.md AGENTS.md package.json
git commit -m "feat: gate autonomous conveyor cutover"
```

## Execution Boundary

Completion of these implementation tasks creates tested controls and proof tooling only. The following later policy-boundary actions are deliberately outside implementation execution and each requires its own exact signed operator decision at the time it occurs:

1. at the local console, run the one-time root bootstrap to create both the ACL-protected control root and fixed external production/data roots, verify their realpaths, non-reparse status, ownership and base ACL and generate the first interactive operator Ed25519 key/trust history in its fixed Credential Manager target. This unavoidable ceremony writes one no-overwrite receipt and creates no runtime, database or network mutation; the narrowly scoped local credential write is its declared purpose
2. build the exact clean key-independent approved runtime selection from that realised root/ACL receipt, then use the operator key to sign the runtime-selection and `INSTALL_PRODUCTION_RUNTIME_IDENTITIES` decisions and install the complete new SCM identity set disabled, stopped and child-free
3. after the broker and Discord ingress SIDs exist, sign/apply `PROVISION_AUTHORITY_BROKER_KEY` to create the broker key/trust record, then provision the isolated ingress credential. Sign/apply `PROVISION_DISCORD_INTERACTIONS_INGRESS` and retain the stopped-service installation plus provider/DNS/route readback receipt; do not claim an end-to-end Discord round trip while its service is stopped
4. sign/apply `RETIRE_LEGACY_RUNTIME_OWNERS` and `RETIRE_REMOTE_LEGACY_DEPLOYMENT`. Prove every legacy Windows task/service/process and every remote `server.js` deployment is stopped or observation-only, cannot schedule or publish, has no production credential and cannot restart; preserve provider readback receipts
5. while every new and legacy service is stopped and fenced, create and verify the fixed pre-cutover-v024 backup/restore receipt, provision/engage the signed external schema latch, then sign and apply the one-use production schema cutover for exact migrations 025–030
6. sign/apply the one-use exact initial-authority definition materialisation, then sign and apply `ARM_SHADOW`; the ARM authority transaction is the sole owner that atomically opens the 7–14-day production-equivalent shadow session. Only after both receipts and that already-open session exist may the fixed supervisor verify installation, remote retirement, cutover, materialisation and ARM receipts and enable/start the isolated services without creating another session. With the advisory ingress and ops services now live, complete the one-time Discord Developer Portal endpoint binding and retain genuine signed PING/PONG plus `/pulse status` receipts before `shadow_ready` can become GREEN
7. run each signed host-impacting restart or restore drill, run the isolated authority-revocation harness drill and complete the remaining non-destructive real Discord acceptance probe
8. let the fixed phase sealer close the complete GREEN shadow scope. In a new stopped/fenced maintenance boundary, provision the distinct publisher OAuth client/grant and Credential Manager target, revoke or prove separate every legacy production-channel grant and apply the signed `PUBLISHER_CREDENTIAL_CUTOVER`; recheck zero legacy/server/generic publisher-capable process before and after
9. restart the fixed services while authority remains `SHADOW`, then wait for fresh fenced leases/heartbeats, local-AI and GPU probe receipts, backup evidence, publication-health sentinel, publisher credential-health/legacy-surface audit and exact read-only YouTube account/channel/scope preflight. Only that current GREEN set may be bound into the signed private-canary promotion
10. sign/apply `PROMOTE_PRIVATE_CANARY`; its target five private uploads then run under standing authority without per-video approval
11. after the complete canary epoch seals GREEN, sign/apply `PROMOTE_PUBLIC_RAMP` for one public Short per UTC policy day
12. after the complete 30-day interval and all three monitor offsets per publication seal GREEN, sign/apply `PROMOTE_TWO_DAILY`

Individual private-canary uploads and autonomous public releases do not require per-video operator approval once their exact phase authority is active. They run only under the standing signed phase decision, strict-GREEN envelope, remaining canary or cadence budget and all last-second gates. They are still not executed by these implementation tasks: the first operational run begins only after the relevant signed phase transition and cutover checklist.

No implementation agent may infer those authorities from approval of this plan.
