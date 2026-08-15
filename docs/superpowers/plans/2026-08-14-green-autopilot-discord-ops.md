# GREEN Autopilot Discord Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing configured Discord integration into a secure two-way operator console with durable decisions and reliable notifications.

**Architecture:** A dedicated private ops bot validates exact guild, channel and operator identity then enqueues canonical commands. A SQLite outbox delivers status and incidents independently from public community posting.

**Tech Stack:** Node.js 24 CommonJS, discord.js 14, better-sqlite3, existing local-AI task client, Node test runner

**Spec:** `docs/superpowers/specs/2026-08-14-pulse-gaming-green-autopilot-design.md`

## Global Constraints

- Requires the runtime foundation and authority repository interfaces.
- Roles never substitute for the exact configured operator user ID.
- Discord commands never call a publisher or mutate story JSON directly.
- `pause` and `kill` are immediate fail-safe operations.
- `resume` requires a fresh health check and a second single-use confirmation.
- `/pulse ask` is advisory and cannot change policy, authority or publication state.
- Community messages cannot create blockers, repairs or decisions.
- Discord failure does not stop otherwise safe GREEN production or publication.
- Do not print or commit bot tokens, webhook URLs or IDs sourced from secrets.

## File Structure

- `db/migrations/029_discord_ops_control.sql`: decisions, control commands, resume challenges and outbox.
- `lib/repositories/{operator_decisions,control_commands,discord_outbox}.js`: durable repositories.
- `discord/ops-config.js`: fixed identity and permission configuration.
- `lib/services/discord-ops-command-validator.js`: exact interaction validation.
- `lib/services/discord-ops-controller.js`: canonical command ingestion.
- `lib/services/control-command-executor.js`: control-plane command application.
- `lib/services/discord-notification-outbox.js`: event creation and rendering.
- `lib/services/discord-outbox-worker.js`: reliable Discord delivery.
- `discord/ops-bot.js`: dedicated private bot client.
- `tools/discord-ops-worker.js`, `tools/discord-outbox-worker.js`, `tools/discord-ops-doctor.js`: fixed entry points.

---

### Task 1: Add durable decisions, commands and notification outbox

**Files:**
- Create: `db/migrations/029_discord_ops_control.sql`
- Create: `lib/repositories/operator_decisions.js`
- Create: `lib/repositories/control_commands.js`
- Create: `lib/repositories/discord_outbox.js`
- Create: `tests/db/discord-ops-control-migration.test.js`
- Create: `tests/db/operator-decisions-repository.test.js`
- Create: `tests/db/discord-outbox-repository.test.js`
- Modify: `lib/repositories/index.js`

**Interfaces:**
- Produces: `repos.operatorDecisions`, `repos.controlCommands` and `repos.discordOutbox`.

- [ ] **Step 1: Write replay and delivery-ownership tests**

```js
test("one Discord interaction creates one immutable decision", () => {
  const first = repos.operatorDecisions.record(validDecision({ interactionId: "i-1" }));
  assert.throws(() => repos.operatorDecisions.record(validDecision({ interactionId: "i-1" })), /discord_interaction_replayed/);
  assert.equal(first.actor_id, OPERATOR_ID);
});

test("one outbox event key is delivered once", () => {
  repos.discordOutbox.enqueue(validEvent({ eventKey: "incident:p1:42" }));
  assert.throws(() => repos.discordOutbox.enqueue(validEvent({ eventKey: "incident:p1:42" })), /discord_event_exists/);
  const leased = repos.discordOutbox.claim({ workerId: "discord-1", now: NOW, leaseMs: 30000 });
  assert.throws(() => repos.discordOutbox.complete({ id: leased.id, workerId: "wrong", leaseToken: leased.lease_token }), /stale_discord_lease/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/db/discord-ops-control-migration.test.js tests/db/operator-decisions-repository.test.js tests/db/discord-outbox-repository.test.js`

Expected: FAIL on missing migration and repositories.

- [ ] **Step 3: Create migration 029**

Add immutable `operator_decisions`, immutable `control_command_events`, a versioned `control_command_state`, single-use `discord_resume_challenges`, `discord_notification_outbox` and immutable `discord_notification_attempts`. Command projection states are `PENDING`, `APPLIED` and `FAILED`; events include `ACCEPTED`, `APPLIED` and `FAILED`. Uniquely constrain interaction ID, nonce and outbox event key. Add update/delete denial triggers to decision and attempt ledgers.

- [ ] **Step 4: Implement repositories**

All claims use lease tokens. Decisions bind actor, guild, channel, interaction, command, target, artefact hash, expected state version, nonce, expiry, prior state and result. The repository exposes one caller-supplied-transaction interface so urgent controller ingestion can append decision, command and `APPLIED` event in the same SQLite transaction as kill-switch and authority changes. Outbox rows store Discord message ID for edit/reconciliation.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/db/discord-ops-control-migration.test.js tests/db/operator-decisions-repository.test.js tests/db/discord-outbox-repository.test.js`

Expected: PASS.

```powershell
git add db/migrations/029_discord_ops_control.sql lib/repositories/operator_decisions.js lib/repositories/control_commands.js lib/repositories/discord_outbox.js lib/repositories/index.js tests/db/discord-ops-control-migration.test.js tests/db/operator-decisions-repository.test.js tests/db/discord-outbox-repository.test.js
git commit -m "feat: persist Discord operations state"
```

### Task 2: Validate exact private operator interactions

**Files:**
- Create: `discord/ops-config.js`
- Create: `lib/services/discord-interaction-signature.js`
- Create: `lib/services/discord-ops-command-validator.js`
- Create: `tests/services/discord-ops-config.test.js`
- Create: `tests/services/discord-interaction-signature.test.js`
- Create: `tests/services/discord-ops-command-validator.test.js`

**Interfaces:**
- Produces: `loadDiscordOpsConfig(env)`.
- Produces: `verifyDiscordInteractionRequest({ rawBody, signature, timestamp, config, now }) -> verifiedInteractionHandle`.
- Produces: `validateDiscordOpsInteraction({ interaction, config, now, expectedType })`.

- [ ] **Step 1: Write identity, channel, expiry and role tests**

```js
test("exact user, guild and private channel are all required", () => {
  assert.equal(validateDiscordOpsInteraction(fixture()).allowed, true);
  assert.equal(validateDiscordOpsInteraction(fixture({ userId: "other", hasAdminRole: true })).allowed, false);
  assert.equal(validateDiscordOpsInteraction(fixture({ guildId: "other" })).allowed, false);
  assert.equal(validateDiscordOpsInteraction(fixture({ channelId: "public-news" })).allowed, false);
});

test("stale interaction timestamp is rejected", () => {
  const result = validateDiscordOpsInteraction(fixture({ createdAt: OLD }), { now: NOW });
  assert.ok(result.blockers.includes("discord_interaction_expired"));
});

test("only Discord-signed raw HTTP bytes can enter command validation", () => {
  const verified = verifyDiscordInteractionRequest(signedRawHttpFixture());
  assert.equal(validateDiscordOpsInteraction({ interaction: verified }).allowed, true);
  assert.throws(() => verifyDiscordInteractionRequest(signedRawHttpFixture({ bodyTampered: true })), /discord_interaction_signature_invalid/);
  assert.throws(() => validateDiscordOpsInteraction({ interaction: rawGatewayEventFixture() }), /verified_discord_interaction_handle_required/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/discord-ops-config.test.js tests/services/discord-interaction-signature.test.js tests/services/discord-ops-command-validator.test.js`

Expected: FAIL on missing modules.

- [ ] **Step 3: Implement fail-closed configuration**

Require non-empty `DISCORD_APPLICATION_ID`, `DISCORD_APPLICATION_PUBLIC_KEY`, `DISCORD_INTERACTIONS_PUBLIC_URL`, `DISCORD_GUILD_ID`, `DISCORD_OPS_CHANNEL_ID` and `DISCORD_OPERATOR_USER_ID`. Bind the application-public-key fingerprint and the one exact HTTPS interaction route in runtime configuration. The bot token remains outbound REST/command-registration transport only and is never returned. Missing or drifted configuration keeps the ops receiver unhealthy and disabled.

- [ ] **Step 4: Implement exact validation**

Run one authenticated raw-body HTTP interaction receiver, not a Gateway `interactionCreate` listener. Verify `X-Signature-Ed25519` over the exact timestamp plus raw request bytes with the pinned application public key before JSON parsing or database access, reject stale timestamps and replayed interaction IDs, then pass only the closure-minted verified handle to validation. Return `{ allowed, actor, interactionId, command, blockers }`. Accept slash commands and signed component interactions only. Reject DMs, public channels, bot/webhook authors, unknown commands, stale interactions and mismatched application IDs. Gateway events and reconstructed JSON can never satisfy the signed-decision boundary.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/discord-ops-config.test.js tests/services/discord-interaction-signature.test.js tests/services/discord-ops-command-validator.test.js`

Expected: PASS.

```powershell
git add discord/ops-config.js lib/services/discord-interaction-signature.js lib/services/discord-ops-command-validator.js tests/services/discord-ops-config.test.js tests/services/discord-interaction-signature.test.js tests/services/discord-ops-command-validator.test.js
git commit -m "feat: authenticate Discord operator commands"
```

### Task 3: Ingest canonical commands and execute safe controls

**Files:**
- Create: `lib/services/discord-ops-controller.js`
- Create: `lib/services/discord-resume-decision.js`
- Create: `lib/services/control-command-executor.js`
- Create: `tests/services/discord-ops-controller.test.js`
- Create: `tests/services/discord-resume-decision.test.js`
- Create: `tests/services/control-command-executor.test.js`

**Interfaces:**
- Produces: `ingestDiscordOpsInteraction(input)`.
- Produces: `executeControlCommand({ commandId, repos, healthProvider, localAskEnqueuer, now })`.
- Produces: `applyEmergencyControlAtIngest({ command, repos, now }) -> { commandState, switchVersion, authorityVersion }`.
- Produces: `buildResumePrecondition({ readiness, expectedSwitchVersion, expectedAuthorityVersion })`.
- Produces: `buildAndVerifyDiscordResumeDecision({ initialInteraction, confirmationInteraction, challenge, precondition, config, now })`.
- Produces: `resolveDiscordControlTransition({ command, fromState, reasonClass, repairScope })`.

- [ ] **Step 1: Write pause, resume, binding and advisory tests**

```js
test("pause is immediate and resume requires a second healthy confirmation", async () => {
  const pause = await ingestDiscordOpsInteraction(fixtureInteraction("pause"));
  assert.equal(killSwitch.get("external_mutations").state, "ENGAGED");
  assert.equal(authorityRepo.current().suspension_reason_class, "RECOVERABLE_PAUSE");
  assert.equal(commandRepo.get(pause.commandId).state, "APPLIED");
  await assert.rejects(() => attemptPublicationBoundary(), /kill_switch_engaged/);

  const resume = await ingestDiscordOpsInteraction(fixtureInteraction("resume"));
  assert.ok(resume.challenge.nonce);
  await assert.rejects(() => executeControlCommand(commandFixture(resume.commandId)), /resume_confirmation_required/);
});

test("resume precondition permits only the expected engaged switch and suspended authority", async () => {
  const check = buildResumePrecondition(readinessFixture({ killSwitch: "ENGAGED", authority: "SUSPENDED", suspensionReasonClass: "RECOVERABLE_PAUSE", allOtherChecks: "GREEN" }));
  assert.equal(check.readyToResume, true);
  assert.equal(buildResumePrecondition(readinessFixture({ databaseIntegrity: "RED" })).readyToResume, false);
  assert.equal(buildResumePrecondition(readinessFixture({ suspensionReasonClass: "REQUALIFICATION_REQUIRED" })).readyToResume, false);
});

test("resume restores only the recorded phase and fails atomically on drift", async () => {
  const resumed = await executeControlCommand(resumeFixture({ suspendedFromPhase: "PUBLIC_RAMP_ONE_DAILY", suspensionReasonClass: "RECOVERABLE_PAUSE", authorityVersion: 8, switchVersion: 3 }));
  assert.equal(resumed.authority.phase, "PUBLIC_RAMP_ONE_DAILY");
  assert.equal(resumed.authority.version, 9);
  await assert.rejects(() => executeControlCommand(resumeFixture({ authorityVersion: 7, switchVersion: 3 })), /stale_authority_version/);
  await assert.rejects(() => executeControlCommand(resumeFixture({ suspensionReasonClass: "REQUALIFICATION_REQUIRED", suspensionReasonCode: "MODEL_DRIFT" })), /fresh_shadow_required/);
  assert.equal(killSwitch.get("external_mutations").state, "ENGAGED");
});

test("failed post-transition readiness never exposes a mutation-capable state", async () => {
  const gate = blockCanonicalReadinessAfterTentativeResume();
  const [resume, publish] = await Promise.allSettled([
    executeControlCommand(resumeFixture({ suspendedFromPhase: "PUBLIC_RAMP_ONE_DAILY", authorityVersion: 8, switchVersion: 3 })),
    attemptPublicationBoundary(gate)
  ]);
  assert.equal(resume.status, "rejected");
  assert.equal(publish.status, "rejected");
  assert.equal(authorityRepo.current().phase, "SUSPENDED");
  assert.equal(killSwitch.get("external_mutations").state, "ENGAGED");
  assert.equal(gate.observedMutationCapableSnapshotCount, 0);
});

test("the second signed Discord interaction is the exact RESUME authority decision", async () => {
  const decision = buildAndVerifyDiscordResumeDecision(resumeDecisionFixture());
  assert.equal(decision.decision_type, "RESUME");
  assert.equal(decision.signature_scheme, "DISCORD_INTERACTION_ED25519");
  assert.equal(decision.operator_id, MORR_USER_ID);
  assert.equal(decision.expected_authority_version, 8);
  assert.equal(decision.expected_switch_version, 3);
  assert.match(decision.canonical_sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => buildAndVerifyDiscordResumeDecision(resumeDecisionFixture({ confirmationBodyTampered: true })), /discord_interaction_signature_invalid/);
  assert.throws(() => buildAndVerifyDiscordResumeDecision(resumeDecisionFixture({ transport: "gateway" })), /raw_signed_http_interaction_required/);
});

test("resume is phase-aware about the fail-closed shadow switch", async () => {
  const shadow = await executeControlCommand(resumeFixture({ suspendedFromPhase: "SHADOW", suspensionReasonClass: "RECOVERABLE_PAUSE", authorityVersion: 4, switchVersion: 2 }));
  assert.equal(shadow.authority.phase, "SHADOW");
  assert.equal(shadow.killSwitch.state, "ENGAGED");
  const publicRamp = await executeControlCommand(resumeFixture({ suspendedFromPhase: "PUBLIC_RAMP_ONE_DAILY", suspensionReasonClass: "RECOVERABLE_PAUSE", authorityVersion: 8, switchVersion: 5 }));
  assert.equal(publicRamp.authority.phase, "PUBLIC_RAMP_ONE_DAILY");
  assert.equal(publicRamp.killSwitch.state, "CLEAR");
});

test("kill escalates a pause and later pause cannot downgrade requalification", async () => {
  const pause = await ingestDiscordOpsInteraction(fixtureInteraction("pause"));
  const challenge = await issueResumeChallenge(pause);
  await ingestDiscordOpsInteraction(fixtureInteraction("kill"));
  assert.equal(authorityRepo.current().suspension_reason_class, "REQUALIFICATION_REQUIRED");
  assert.equal(resumeChallengeRepo.get(challenge.id).state, "INVALIDATED");
  await ingestDiscordOpsInteraction(fixtureInteraction("pause"));
  assert.equal(authorityRepo.current().suspension_reason_class, "REQUALIFICATION_REQUIRED");
});

test("ask enqueues advisory local AI and cannot mutate controls", async () => {
  const before = snapshotControls();
  await executeControlCommand(commandFixture(await askInteraction("why is story held?")));
  assert.deepEqual(snapshotControls(), before);
});

test("hold, reject and revise have an exact state and enqueue contract", async () => {
  for (const fromState of ["VERIFIED", "SELECTED", "SCRIPTED", "MEDIA_BOUND", "RENDERED", "QA_GREEN", "ENVELOPED"]) {
    assert.equal(resolveDiscordControlTransition({ command: "hold", fromState }).toState, "AMBER_REVIEW");
  }
  assert.equal(resolveDiscordControlTransition({ command: "reject", fromState: "AMBER_REVIEW" }).toState, "REJECTED");
  assert.equal(resolveDiscordControlTransition({ command: "reject", fromState: "PUBLICATION_EXPIRED_HOLD" }).toState, "REJECTED");
  const retention = await executeControlCommand(rejectFixture({ fromState: "PUBLIC_STATUS_EXPIRED_HOLD" }));
  assert.equal(retention.toState, "PUBLIC_STATUS_EXPIRED_HOLD");
  assert.equal(retention.operatorDecisionRequest.type, "RETAIN_PRIVATE_AFTER_WINDOW_EXPIRY");
  assert.equal(retention.operatorDecisionRequest.signed, false);
  assert.equal(retention.remoteMutationCount, 0);
  await executeControlCommand(replayInteraction(retention));
  assert.equal(operatorDecisionRequestsFor(retention.runId).length, 1);
  const revise = await executeControlCommand(reviseFixture({ fromState: "AMBER_REVIEW", repairScope: "EDITORIAL" }));
  assert.equal(revise.toState, "RED_REPAIR");
  assert.deepEqual(revise.enqueuedKinds, ["autopilot_repair"]);
  const expectedRepairs = {
    SOURCE_VERIFICATION: { restartState: "VERIFIED", enqueuedKinds: ["autopilot_candidate_select"], requiredRevalidation: ["source_manifest", "source_freshness", "dedupe"] },
    EDITORIAL: { restartState: "SELECTED", enqueuedKinds: ["autopilot_editorial"], requiredRevalidation: ["source_manifest", "claim_ledger", "public_copy"] },
    MEDIA_RIGHTS: { restartState: "SCRIPTED", enqueuedKinds: ["autopilot_media_rights"], requiredRevalidation: ["canonical_assets", "canonical_placements"] },
    NARRATION_MOTION: { restartState: "MEDIA_BOUND", enqueuedKinds: ["autopilot_narration", "autopilot_motion"], requiredRevalidation: ["audio", "timestamps", "motion_input_joins"] },
    RENDER_QA: { restartState: "MEDIA_BOUND", enqueuedKinds: ["autopilot_render"], requiredRevalidation: ["bound_narration_hash", "bound_motion_hash", "full_render_qa"] }
  };
  for (const [scope, recipe] of Object.entries(expectedRepairs)) assert.deepEqual(resolveRepairRestart(scope), recipe);
  await assert.rejects(() => executeControlCommand(reviseFixture({ fromState: "AMBER_REVIEW", repairScope: "EDITORIAL", restartState: "MEDIA_BOUND" })), /caller_restart_state_forbidden/);
  await assert.rejects(() => executeControlCommand(reviseFixture({ fromState: "PUBLISH_RESERVED" })), /command_state_not_permitted/);
});

test("successful resume atomically queues one continuation recovery for each held reservation", async () => {
  const result = await executeControlCommand(validTwoStepResume({ affectedCapacityReservationIds: ["slot-1"] }));
  assert.equal(result.authorityPhase, "PRIVATE_CANARY");
  assert.deepEqual(jobsFor("slot-1"), [{ kind: "publication_continuation_recovery", key: `slot-1:${result.resumeEventSha256}` }]);
  await executeControlCommand(replayTwoStepResume(result));
  assert.equal(jobsFor("slot-1").length, 1);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/discord-ops-controller.test.js tests/services/control-command-executor.test.js`

Expected: FAIL on missing services.

- [ ] **Step 3: Implement canonical ingestion**

Validate first. For non-emergency commands, record one immutable decision, enqueue one canonical command and return an ephemeral acknowledgement. `pause` and `kill` take the fail-safe synchronous path: in one database transaction record the decision and command, engage the expected durable `external_mutations` switch version, append the matching authority suspension and mark the command `APPLIED`; only after that commit may Discord receive an acknowledgement. If the transaction fails, acknowledgement is a failure and publication remains fail-closed. Replayed interactions return the prior applied receipt. `hold`, `reject` and `revise` require exact target, artefact SHA and expected version. RED approval is not a command. No command has a `publish` operation.

- [ ] **Step 4: Implement command execution**

- `pause`: the controller applies the synchronous ingest transaction above with class `RECOVERABLE_PAUSE` and code `OPERATOR_PAUSE`; the queued executor only returns the immutable applied receipt on replay. If authority is already suspended for requalification, pause records that the stronger hold already applies and cannot downgrade it.
- `kill`: the controller applies the synchronous ingest transaction above through `ensureRequalificationSuspended` with code `EMERGENCY_KILL`; a current recoverable pause becomes `ESCALATE_SUSPENSION`, keeps its original prior phase and invalidates its resume challenge. It cannot use ordinary resume. A signed `RESET_TO_SHADOW` keeps that exact switch engaged while fresh shadow evidence is rebuilt. Only the later signed, evidence-complete `SHADOW -> PRIVATE_CANARY` promotion may atomically clear its expected version, as defined by the authority plan.
- `resume`: consume the exact challenge after a second operator interaction and a fresh resume-precondition report. The canonical authority decision is the pair of raw Discord interaction bodies plus their verified Ed25519 transport signatures, exact guild/channel/application/operator IDs, challenge ID/nonce, expected authority and switch versions, stored prior phase, precondition-report SHA and expiry. `discord-resume-decision` verifies both signatures against the pinned Discord application public key before canonicalising and persisting decision type `RESUME`; body tamper, replay or an unpinned identity is invalid. No separate unsigned claim satisfies the authority service. The precondition requires every canonical readiness check GREEN except the expected engaged kill-switch version and expected suspended authority version. Resume is permitted only when the stored authority suspension class is `RECOVERABLE_PAUSE`. For a publication-capable prior phase, open one database transaction, tentatively append the authority `RESUME` event using the current expected version, tentatively clear that exact switch version and evaluate canonical publication readiness against that same transaction snapshot. Commit the phase restore, switch clear, immutable signed decision, consumed challenge and one `publication_continuation_recovery` job per affected capacity reservation only if the post-transition snapshot is GREEN. Each job key is capacity-reservation ID plus resume-event SHA, so replay cannot duplicate it. Otherwise roll back all five; a clear/active combination is never externally visible and no compensating re-engage is used. For prior `SHADOW`, the same transaction restores only `SHADOW`, keeps the switch `ENGAGED` and evaluates the shadow-specific readiness contract before commit; only a later signed private-canary promotion may clear it. A stale version, missing signed resume decision, `REQUALIFICATION_REQUIRED`, `REVOKED` or failed check leaves the durable switch engaged and authority suspended. Drift, false-GREEN, claim/restriction and unresolved-mutation suspensions use the separate signed `RESET_TO_SHADOW` ceremony after current bindings are materialised; Discord cannot bypass it. Publisher boundary tests run concurrently with a failed post-check and prove zero mutation-capable snapshot is observable.
- `hold`, `reject` and `revise`: use the exact table below. Every row requires the exact content-run ID, artefact SHA, current expected version and immutable operator decision. Any unlisted state/command pair is rejected.
- `status`, `why-blocked`: read-only report.
- `ask`: enqueue the fixed `operator_question` job keyed by interaction/command ID. The editorial worker's local-AI handler records one generic advisory result and atomically enqueues one `discord_operator_question_delivery` job; the later fixed Discord handler maps it to one outbox event. Replay or either worker restart cannot duplicate the answer and neither handler has control mutation capability.

| Command | Permitted source state | Destination | Side effect |
|---|---|---|---|
| `hold` | `VERIFIED`, `SELECTED`, `SCRIPTED`, `MEDIA_BOUND`, `RENDERED`, `QA_GREEN`, `ENVELOPED` | `AMBER_REVIEW` | Cancel not-started downstream stage jobs and enqueue one exception notification |
| `hold` with claim, strike, restriction, correction or takedown reason | `UPLOADED`, `RECONCILED`, `MEASURED` | `CLAIM_OR_RESTRICTION_HOLD` | Append `REQUALIFICATION_REQUIRED` authority suspension and enqueue one P1 incident |
| `reject` | `AMBER_REVIEW`, `RED_REPAIR`, `AUTHORITY_SUSPENDED`, `PUBLICATION_EXPIRED_HOLD` | `REJECTED` | Cancel not-started stage jobs, preserve the consumed zero-network publication slot/action receipt when present and enqueue no repair |
| `reject` | `PUBLIC_STATUS_EXPIRED_HOLD` | `PUBLIC_STATUS_EXPIRED_HOLD` | Materialise the fixed `RETAIN_PRIVATE_AFTER_WINDOW_EXPIRY` decision request and operator instructions; only the local signed apply ceremony may transition it, while the remote video remains private and no ramp credit is granted |
| `revise` | `AMBER_REVIEW` | `RED_REPAIR` | Enqueue exactly one `autopilot_repair` job keyed by decision ID and artefact SHA |

The `revise` decision binds one fixed scope and the controller imports the production-state resolver rather than duplicating or accepting its destination. The exact mapping is:

| Repair scope | GREEN receipt restart | Enqueued stage kinds | Mandatory revalidation before restart |
|---|---|---|---|
| `SOURCE_VERIFICATION` | `VERIFIED` | `autopilot_candidate_select` | Source manifest, freshness and dedupe |
| `EDITORIAL` | `SELECTED` | `autopilot_editorial` | Source manifest, claim ledger and public copy |
| `MEDIA_RIGHTS` | `SCRIPTED` | `autopilot_media_rights` | Canonical assets and canonical placements |
| `NARRATION_MOTION` | `MEDIA_BOUND` | `autopilot_narration`, `autopilot_motion` | Audio, timestamps and motion-input joins |
| `RENDER_QA` | `MEDIA_BOUND` | `autopilot_render` | Bound narration and motion hashes, then full render and QA |

The repair worker validates the held evidence, materialises a new hash-bound receipt and only then applies this derived restart recipe. A caller-supplied restart state or next job kind is rejected. A repair failure returns to `AMBER_REVIEW` with a new version, atomically enqueues one stable-key `discord_exception_card` and enqueues no automatic retry. `RED_REPAIR` cannot accept a second revise command while its keyed repair job is active. Discord never holds the operator signing key: rejection of `PUBLIC_STATUS_EXPIRED_HOLD` writes only the canonical no-overwrite decision request consumed by the fixed local operator-decision signer and expired-publication apply CLI. Replayed Discord interactions return the same request and cannot transition state.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/discord-ops-controller.test.js tests/services/discord-resume-decision.test.js tests/services/control-command-executor.test.js tests/services/durable-kill-switch.test.js tests/services/production-state.test.js`

Expected: PASS.

```powershell
git add lib/services/discord-ops-controller.js lib/services/discord-resume-decision.js lib/services/control-command-executor.js tests/services/discord-ops-controller.test.js tests/services/discord-resume-decision.test.js tests/services/control-command-executor.test.js
git commit -m "feat: execute canonical Discord control commands"
```

### Task 4: Add durable outbound delivery and message reconciliation

**Files:**
- Create: `lib/services/discord-notification-outbox.js`
- Create: `lib/services/discord-ops-transport.js`
- Create: `lib/services/discord-operator-question-adapter.js`
- Create: `lib/job-handlers/discord-operator-question.js`
- Create: `lib/services/discord-outbox-worker.js`
- Create: `tests/services/discord-operator-question-adapter.test.js`
- Create: `tests/services/discord-outbox-worker.test.js`
- Modify: `config/autopilot-job-ownership.json`
- Modify: `config/runtime-lanes.json`
- Modify: `lib/job-handlers/local-ai.js`
- Modify: `lib/job-handlers.js`
- Modify: `tests/services/autopilot-job-ownership.test.js`
- Modify: `notify.js`

**Interfaces:**
- Produces: `enqueueDiscordNotification(event)`.
- Produces: `mapOperatorQuestionResultToOutbox({ commandId, resultReceiptSha256, repos, now }) -> outboxReceipt`.
- Produces: `handleDiscordOperatorQuestionResult({ commandId, resultReceiptSha256, repos, now }) -> outboxReceipt`.
- Produces: `runDiscordOutboxOnce({ repos, transport, workerId, now })`.

- [ ] **Step 1: Write retry, edit and dead-letter tests**

```js
test("network and 5xx failures retry while one incident message is edited", async () => {
  const transport = scriptedTransport([networkError(), http(503), delivered("m-1"), edited("m-1")]);
  await drain(worker(transport));
  assert.equal(repo.getByEventKey(EVENT).message_id, "m-1");
  assert.equal(repo.attempts(EVENT).length, 4);
});

test("delivery exhaustion dead-letters without engaging publication kill switch", async () => {
  await drain(worker(alwaysFail()));
  assert.equal(repo.getByEventKey(EVENT).state, "dead_letter");
  assert.equal(killSwitch.get("external_mutations").state, "CLEAR");
});

test("one completed advisory result maps to one outbox event across restart", async () => {
  const first = await mapOperatorQuestionResultToOutbox(questionResultFixture({ commandId: "cmd-7" }));
  await restartDiscordOpsWorker();
  const replay = await mapOperatorQuestionResultToOutbox(questionResultFixture({ commandId: "cmd-7" }));
  assert.equal(replay.receiptSha256, first.receiptSha256);
  assert.equal(outboxItemsForEvent("operator_question:cmd-7").length, 1);
  assert.equal(replay.advisory_only, true);
});

test("local advisory completion enqueues one fixed Discord mapping job", async () => {
  const first = await completeOperatorQuestionAdvisory(questionCompletionFixture({ commandId: "cmd-8" }));
  await restartEditorialAndDiscordWorkers();
  const replay = await completeOperatorQuestionAdvisory(questionCompletionFixture({ commandId: "cmd-8" }));
  assert.equal(replay.receiptSha256, first.receiptSha256);
  assert.deepEqual(jobsFor(`operator_question:cmd-8`), [{ kind: "discord_operator_question_delivery", ownerLane: "discord-ops" }]);
  await handleDiscordOperatorQuestionResult(jobsFor(`operator_question:cmd-8`)[0]);
  assert.equal(outboxItemsForEvent("operator_question:cmd-8").length, 1);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/discord-operator-question-adapter.test.js tests/services/discord-outbox-worker.test.js tests/services/notify.test.js tests/services/autopilot-job-ownership.test.js`

Expected: FAIL on missing outbox worker.

- [ ] **Step 3: Implement durable delivery**

Use `wait=true` so a message ID is captured. Retry bounded 429, network and 5xx failures with persisted next-at timestamps. Store redacted attempts. Edit the current incident/status message when `message_id` exists. Permanent 4xx moves to dead letter. The generic local-AI advisory completion transaction enqueues exactly one `discord_operator_question_delivery` job keyed by command ID plus result SHA. Its fixed `discord-ops` handler invokes the operator-question adapter, which claims only a completed generic advisory result whose originating command ID and result SHA match the immutable command row, then creates the `operator_question:<commandId>` outbox event and mapping receipt in one transaction. It cannot request another model call, mutate controls or duplicate delivery after restart.

Activate the predeclared `discord_operator_question_delivery` and `discord_outbox_delivery` rows in `config/autopilot-job-ownership.json`; the first is owned by `discord-ops` and the second only by `discord-outbox`. The focused registry test compares active rows with actual handler registrations and lane capabilities.

- [ ] **Step 4: Preserve simple webhook compatibility**

`notify.js` remains a non-authoritative helper for manual tools but production callers enqueue through the outbox. It never exposes the webhook URL in errors or receipts.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/discord-operator-question-adapter.test.js tests/services/discord-outbox-worker.test.js tests/services/notify.test.js tests/services/autopilot-job-ownership.test.js`

Expected: PASS.

```powershell
git add config/runtime-lanes.json config/autopilot-job-ownership.json lib/services/discord-notification-outbox.js lib/services/discord-ops-transport.js lib/services/discord-operator-question-adapter.js lib/services/discord-outbox-worker.js lib/job-handlers/discord-operator-question.js lib/job-handlers/local-ai.js lib/job-handlers.js notify.js tests/services/discord-operator-question-adapter.test.js tests/services/discord-outbox-worker.test.js tests/services/autopilot-job-ownership.test.js
git commit -m "feat: deliver Discord operations reliably"
```

### Task 5: Run a dedicated private ops bot and disable legacy authority

**Files:**
- Create: `discord/ops-command.js`
- Create: `discord/ops-bot.js`
- Create: `config/discord-interactions-ingress.schema.json`
- Create: `lib/runtime/discord-interactions-ingress.js`
- Create: `tools/discord-ops-worker.js`
- Create: `tools/discord-outbox-worker.js`
- Create: `tools/discord-ops-doctor.js`
- Create: `tools/windows/provision-discord-interactions-ingress.ps1`
- Create: `tests/services/discord-interactions-ingress.test.js`
- Create: `tests/services/discord-ops-restart.test.js`
- Create: `tests/services/legacy-discord-authority-disabled.test.js`
- Modify: `config/runtime-lanes.json`
- Modify: `config/autopilot-job-ownership.json`
- Modify: `discord/bot.js`
- Modify: `discord/auto_post.js`
- Modify: `discord_approve.js`
- Modify: `lib/runtime/readiness.js`
- Modify: `server.js`
- Modify: `tools/windows/install-production-services.ps1`
- Modify: `package.json`
- Modify: `tests/services/runtime-readiness.test.js`
- Modify: `tests/ops/windows-production-services.test.js`
- Modify: `tests/services/autopilot-job-ownership.test.js`

**Interfaces:**
- Produces fixed service scripts `service:discord-ops` and `service:discord-outbox`.
- Produces: `planDiscordInteractionsIngress({ runtimeSelection, appIdentity, cloudflaredIdentity, fixedRoute, serviceIdentity, now })` and a closure-owned, signed one-use apply path.
- Removes story mutation authority from public/community Discord code.

- [ ] **Step 1: Write legacy-disable and restart tests**

```js
test("community bot cannot mutate story or control state", () => {
  const source = fs.readFileSync("discord/bot.js", "utf8");
  assert.equal(source.includes("story.story_approved = true"), false);
  assert.equal(source.includes("story.story_rejected = true"), false);
});

test("replayed interaction after bot restart returns prior acknowledgement", async () => {
  const first = await controllerA.ingest(INTERACTION);
  const second = await controllerB.ingest(INTERACTION);
  assert.equal(second.commandId, first.commandId);
  assert.equal(repo.commandCount(), 1);
});

test("a Discord outage degrades operator messaging without blocking safe publication readiness", async () => {
  const report = await buildReadinessSnapshot(readinessFixture({ discordOpsFresh: false, discordOutboxFresh: false, allPublicationCriticalFresh: true }));
  assert.equal(report.checks.publication_critical_workers.verdict, "GREEN");
  assert.equal(report.checks.operator_communications.verdict, "DEGRADED");
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.ready, true);
  assert.equal(report.incidents.some((row) => ["P0", "P1"].includes(row.severity)), false);
});

test("the signed fixed HTTPS ingress reaches raw verification end to end", async () => {
  const installed = await applyDiscordInteractionsIngress(ingressFixture({ decisionType: "PROVISION_DISCORD_INTERACTIONS_INGRESS" }));
  assert.equal(installed.serviceName, "PulseGaming-DiscordInteractionsIngress");
  assert.equal(installed.serviceState, "STOPPED");
  assert.equal(installed.startMode, "disabled_pending_arm_shadow");
  assert.equal(installed.route.publicUrl, DISCORD_INTERACTIONS_PUBLIC_URL);
  assert.equal(installed.route.upstream, FIXED_LOOPBACK_INTERACTION_ROUTE);
  assert.equal(installed.otherRouteCount, 0);
  await assert.rejects(() => sendDiscordSignedPingThroughIngress(installed), /discord_ingress_not_active/);
  const activated = await activateProductionServices(discordActivationFixture({
    ingressInstallationReceipt: installed.receiptSha256,
    schemaCutoverReceipt: SCHEMA_CUTOVER_SHA,
    authorityMaterialisationReceipt: AUTHORITY_MATERIALISATION_SHA,
    armShadowReceipt: ARM_SHADOW_SHA
  }));
  assert.equal(activated.discordIngressState, "RUNNING");
  assert.equal(activated.discordOpsState, "RUNNING");
  const ping = await sendDiscordSignedPingThroughIngress(activated);
  assert.equal(ping.status, 200);
  assert.deepEqual(ping.body, { type: 1 });
  const command = await sendDiscordSignedCommandThroughIngress(activated, "/pulse status");
  assert.equal(command.persistedVerifiedInteractionCount, 1);
  assert.equal(command.gatewayInteractionCount, 0);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/discord-interactions-ingress.test.js tests/services/discord-ops-restart.test.js tests/services/legacy-discord-authority-disabled.test.js tests/services/discord-auto-post-lifecycle.test.js tests/services/autopilot-job-ownership.test.js`

Expected: FAIL because community bot buttons still write `daily_news.json`.

- [ ] **Step 3: Implement dedicated ops bot**

Register only the fixed `/pulse` command tree in the configured guild. The `discord-ops` service is the raw-body HTTP interaction receiver from Task 2 and does not create a discord.js Gateway interaction client; `discord-outbox` alone uses the bot token for outbound REST delivery and fixed command registration. The exact ingress implementation is a named Cloudflare Tunnel supervised as the advisory `PulseGaming-DiscordInteractionsIngress` Windows service under its own non-interactive SID. `config/discord-interactions-ingress.schema.json` contains schema only. The actual external control-root record binds the approved `cloudflared.exe` SHA/version, tunnel/account ID, exact public hostname and path, the one loopback upstream, service SID, ACLs and zero catch-all routes. Its tunnel credential is stored in that service account's fixed Windows Credential Manager target and cannot be read by Discord, publisher or content lanes. `provision-discord-interactions-ingress.ps1` defaults to plan and accepts no caller path. Apply loads only a fixed signed `PROVISION_DISCORD_INTERACTIONS_INGRESS` decision, consumes it once, installs the stopped service, verifies DNS/tunnel-route readback, then writes a no-overwrite receipt. The operator's one-time Discord Developer Portal endpoint setting is bound by a signed receipt after Discord's genuine signed PING reaches the exact route and receives PONG; a subsequent signed `/pulse status` round trip proves command reachability. Both receipts are shadow-cutover requirements. The public URL, tunnel/service identity, application ID and application-public-key fingerprint are runtime-selection bindings. Use slash commands and components, so message-content intent is unnecessary. Give it only view, send, embed, command and message-edit permissions in the private channel. Add separate `discord-ops` and `discord-outbox` fixed runtime lanes and SCM services; neither receives YouTube credentials or authority-signing-key access. In `config/runtime-lanes.json` both use `readiness_class:"advisory_ops"` and `publication_critical:false`. The ingress dependency is also advisory: its exact identity/configuration and successful round trip remain cutover acceptance requirements, but a later outage makes only `operator_communications` `DEGRADED`. Top-level canonical publication readiness remains `GREEN` when every publication-critical check is GREEN. A pure Discord transport or heartbeat outage is an advisory P2 communications incident, not an open P0/P1, unless independent evidence exposes a separate safety failure. The durable outbox queues delivery, and Discord alone cannot stop an otherwise safe strict-GREEN release.

- [ ] **Step 4: Disable legacy mutation paths**

Remove approval/rejection components from `discord/auto_post.js`. Remove button mutations from `discord/bot.js`. `discord_approve.js` exits with `deprecated_approval_server_forbidden` when production role is set. `server.js` no longer spawns the privileged ops bot inline.

- [ ] **Step 5: Add scripts and run tests**

`tools/discord-ops-doctor.js` requires `--database-mode fixture|production` and calls the shared schema preflight for migrations 025 and 029 before reading command or outbox tables. Production mode returns structured `PENDING` without an absent-table query.

```json
"service:discord-ops": "node tools/discord-ops-worker.js",
"service:discord-outbox": "node tools/discord-outbox-worker.js",
"ops:discord-ops:doctor": "node tools/discord-ops-doctor.js"
```

Run: `node --test tests/services/discord-interactions-ingress.test.js tests/services/discord-ops-restart.test.js tests/services/legacy-discord-authority-disabled.test.js tests/services/discord-auto-post-lifecycle.test.js tests/services/non-primary-discord-safety.test.js tests/services/runtime-readiness.test.js tests/services/autopilot-job-ownership.test.js tests/ops/windows-production-services.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add config/runtime-lanes.json config/autopilot-job-ownership.json config/discord-interactions-ingress.schema.json lib/runtime/discord-interactions-ingress.js discord/ops-command.js discord/ops-bot.js tools/discord-ops-worker.js tools/discord-outbox-worker.js tools/discord-ops-doctor.js tools/windows/provision-discord-interactions-ingress.ps1 discord/bot.js discord/auto_post.js discord_approve.js lib/runtime/readiness.js server.js tools/windows/install-production-services.ps1 package.json tests/services/discord-interactions-ingress.test.js tests/services/discord-ops-restart.test.js tests/services/legacy-discord-authority-disabled.test.js tests/services/runtime-readiness.test.js tests/services/autopilot-job-ownership.test.js tests/ops/windows-production-services.test.js
git commit -m "feat: add secure Discord operations console"
```

### Task 6: Build daily, weekly and incident operator messages

**Files:**
- Create: `lib/services/autopilot-operator-digests.js`
- Create: `tests/services/autopilot-operator-digests.test.js`
- Modify: `config/runtime-lanes.json`
- Modify: `config/autopilot-job-ownership.json`
- Modify: `lib/job-handlers.js`
- Modify: `lib/scheduler.js`
- Modify: `tools/discord-ops-worker.js`
- Modify: `tests/services/discord-ops-restart.test.js`
- Modify: `tests/ops/windows-production-services.test.js`
- Modify: `tests/services/autopilot-job-ownership.test.js`

**Interfaces:**
- Produces: `buildDailyDigest`, `buildWeeklyDigest`, `buildIncidentCard` and `buildExceptionCard`.

- [ ] **Step 1: Write concise-copy and no-action tests**

```js
test("healthy daily digest requires no response and stays below Discord limit", () => {
  const digest = buildDailyDigest(healthyFixture());
  assert.match(digest.content, /No action needed/);
  assert.ok(digest.content.length <= 1900);
});

test("exception cards expose only actions valid for their exact state", () => {
  const amber = buildExceptionCard(amberFixture({ state: "AMBER_REVIEW" }));
  assert.match(amber.content, new RegExp(ENVELOPE_SHA));
  assert.deepEqual(amber.actions, ["reject", "revise"]);
  assert.deepEqual(buildExceptionCard(redRepairFixture({ state: "RED_REPAIR" })).actions, ["reject"]);
  assert.deepEqual(buildExceptionCard(preReviewFixture({ state: "QA_GREEN" })).actions, ["hold"]);
});

test("digest schedules have one advisory lane owner and converge to one outbox event", async () => {
  assert.deepEqual(ownerIdsFor("discord_daily_digest"), ["discord-ops"]);
  assert.deepEqual(ownerIdsFor("discord_weekly_digest"), ["discord-ops"]);
  assert.equal(scheduleFor("discord_daily_digest").cron, "0 8 * * *");
  assert.equal(scheduleFor("discord_weekly_digest").cron, "10 8 * * 1");
  const first = await handleDiscordDigest(digestJobFixture({ kind: "discord_daily_digest", occurrence: "2026-08-14" }));
  const replay = await handleDiscordDigest(digestJobFixture({ kind: "discord_daily_digest", occurrence: "2026-08-14" }));
  assert.equal(replay.receiptSha256, first.receiptSha256);
  assert.equal(outboxItemsFor(first.eventKey).length, 1);
});

test("every ordinary AMBER transition reaches exactly one exception card", async () => {
  assert.deepEqual(ownerIdsFor("discord_exception_card"), ["discord-ops"]);
  const first = await handleDiscordExceptionCard(exceptionJobFixture({ runId: "run-7", runVersion: 4 }));
  const replay = await handleDiscordExceptionCard(exceptionJobFixture({ runId: "run-7", runVersion: 4 }));
  assert.equal(first.eventKey, "discord_exception_card:run-7:4");
  assert.equal(replay.receiptSha256, first.receiptSha256);
  assert.equal(outboxItemsFor(first.eventKey).length, 1);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-operator-digests.test.js tests/services/autopilot-job-ownership.test.js`

Expected: FAIL on missing digest module.

- [ ] **Step 3: Implement fixed summaries**

Daily digest covers runtime health, queue ages, candidates, renders, publications, reconciliation and incidents. Weekly digest adds retention, subscriber conversion, experiment proposals and held-reason trends. Never include secret values, raw tokens, internal stack traces or unbounded model text.

- [ ] **Step 4: Schedule through the outbox**

Bind `discord_daily_digest`, `discord_weekly_digest`, `discord_incident_card` and `discord_exception_card` only to the advisory `discord-ops` lane; `discord-outbox` claims delivery jobs only. Schedule daily at `08:00` UTC and weekly Monday at `08:10` UTC, with one active idempotency key per occurrence and bootstrap catch-up for a missing due receipt. Each handler writes one immutable digest, incident or exception receipt and one stable-key outbox row transactionally. Every production-stage transaction that enters `AMBER_REVIEW`, including a failed repair, enqueues `discord_exception_card` with key `discord_exception_card:<runId>:<runVersion>`; restart or replay maps it to the same one outbox item. Immediate P0/P1 events enqueue incident-card jobs. Component actions are derived from the same exact state-command table as the controller: a pre-review eligible state may expose `hold`, `AMBER_REVIEW` exposes only `reject` and `revise`, `RED_REPAIR` exposes only `reject` and `PUBLICATION_EXPIRED_HOLD` exposes only `reject`. Post-publication incident cards expose the reason-bound `hold` path only when the state and claim/restriction reason permit it. No card renders an action the controller would reject. Healthy GREEN publication receipts enqueue concise success messages. All use stable event keys.

- [ ] **Step 5: Run the Discord plan gate and commit**

`PUBLIC_STATUS_EXPIRED_HOLD` uses the same reject-only component surface as `PUBLICATION_EXPIRED_HOLD`, but its derived destination is `PRIVATE_RELEASE_RETAINED` and the card explicitly states that no remote deletion or public promotion will occur.

Run:

```powershell
node --test tests/services/discord-ops-config.test.js tests/services/discord-interaction-signature.test.js tests/services/discord-ops-command-validator.test.js tests/services/discord-ops-controller.test.js tests/services/control-command-executor.test.js tests/services/discord-outbox-worker.test.js tests/services/discord-ops-restart.test.js tests/services/legacy-discord-authority-disabled.test.js tests/services/autopilot-operator-digests.test.js tests/services/autopilot-job-ownership.test.js tests/ops/windows-production-services.test.js
npm run ops:discord-ops:doctor -- --database-mode fixture
```

Expected: tests PASS. Doctor performs configuration and permission-shape checks without sending messages.

```powershell
git add config/runtime-lanes.json config/autopilot-job-ownership.json lib/services/autopilot-operator-digests.js lib/job-handlers.js lib/scheduler.js tools/discord-ops-worker.js tests/services/autopilot-operator-digests.test.js tests/services/discord-ops-restart.test.js tests/services/autopilot-job-ownership.test.js tests/ops/windows-production-services.test.js
git commit -m "feat: send autonomous operations digests"
```
