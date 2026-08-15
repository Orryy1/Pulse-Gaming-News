# GREEN Autopilot Production Conveyor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert fresh verified stories into immutable, evidence-complete GREEN release candidates through durable stage-specific jobs.

**Architecture:** A versioned content-run state machine fans work across verification, editorial, rights/media, audio, render and QA stages. Existing Goal and Studio modules are invoked through narrow adapters, while legacy monolithic production remains outside the autonomous profile.

**Tech Stack:** Node.js 24 CommonJS, better-sqlite3, existing Pulse Goal/Studio modules, HyperFrames, FFmpeg, Node test runner

**Spec:** `docs/superpowers/specs/2026-08-14-pulse-gaming-green-autopilot-design.md`

## Global Constraints

- Requires the runtime foundation and local-AI runtime plans.
- Only verified, non-rumour, fresh and non-duplicate Pulse Gaming stories enter autonomous production.
- Every stage consumes exact upstream hashes and emits immutable evidence.
- Final narration, word timestamps, materialised motion, distinct motion families, fresh MP4, rights and strict dry-run evidence are mandatory.
- AMBER or deterministic post-intake RED enters `AMBER_REVIEW`; an unverified intake rumour is deterministically `REJECTED`, while `RED_REPAIR` is entered only after authenticated operator `revise`.
- No production job may upload, publish, change OAuth or mint standing authority.
- Existing `run.js produce/full/publish` remains manual compatibility only.

## File Structure

- `db/migrations/027_green_autopilot_content_runs.sql`: durable production state and immutable stage events.
- `lib/repositories/autonomous_content_runs.js`: expected-version state transitions.
- `lib/autopilot/production-state.js`: allowed state graph.
- `lib/autopilot/production-conveyor.js`: stage orchestration and downstream enqueueing.
- `lib/autopilot/stages/*.js`: focused stage adapters.
- `lib/autopilot/release-candidate.js`: final non-authoritative candidate manifest.
- `tools/autopilot-produce-candidate.js`: local proof CLI.
- `tools/autopilot-production-report.js`: read-only queue and stage report.

---

### Task 1: Add the durable content-run state machine

**Files:**
- Create: `db/migrations/027_green_autopilot_content_runs.sql`
- Create: `lib/repositories/autonomous_content_runs.js`
- Create: `lib/autopilot/production-state.js`
- Create: `tests/db/green-autopilot-content-runs-migration.test.js`
- Create: `tests/services/autonomous-content-runs.test.js`
- Create: `tests/services/production-state.test.js`
- Modify: `lib/repositories/index.js`

**Interfaces:**
- Produces: `repos.autonomousContentRuns` with `create`, `get`, `transition`, `appendEvidence`, `listByState`.
- Produces: `assertProductionTransition(from, to)`.
- Produces: `resolveRepairRestart(scope) -> { restartState, enqueuedKinds, requiredRevalidation }`.
- Produces: `resolveStageVerdictTransition({ stage, verdict, reasonCode }) -> { stateChange, enqueuedKinds, eventType }`, where `stateChange:null` is an evidence-only join.

- [ ] **Step 1: Write failing state and concurrency tests**

```js
test("happy path and exceptional transitions are explicit", () => {
  assert.doesNotThrow(() => assertProductionTransition("DISCOVERED", "VERIFIED"));
  assert.doesNotThrow(() => assertProductionTransition("VERIFIED", "SELECTED"));
  assert.doesNotThrow(() => assertProductionTransition("QA_GREEN", "ENVELOPED"));
  assert.doesNotThrow(() => assertProductionTransition("RECONCILED", "MEASURED"));
  assert.doesNotThrow(() => assertProductionTransition("DISCOVERED", "REJECTED"));
  assert.doesNotThrow(() => assertProductionTransition("DISCOVERED", "DEFERRED_STALE"));
  assert.doesNotThrow(() => assertProductionTransition("DISCOVERED", "DUPLICATE"));
  assert.doesNotThrow(() => assertProductionTransition("VERIFIED", "DEFERRED_STALE"));
  assert.throws(() => assertProductionTransition("DISCOVERED", "ENVELOPED"), /invalid_production_transition/);
  assert.throws(() => assertProductionTransition("RED_REPAIR", "ENVELOPED"), /invalid_production_transition/);
});

test("stale expected version cannot overwrite a newer run", () => {
  const run = repo.create(validRun());
  repo.transition({ runId: run.id, expectedVersion: 0, toState: "VERIFIED", event: event("verified") });
  assert.throws(() => repo.transition({ runId: run.id, expectedVersion: 0, toState: "SELECTED", event: event("stale") }), /stale_content_run_version/);
});

test("ambiguous publication can only recover through an exact no-retry reconciliation path", () => {
  assert.doesNotThrow(() => assertProductionTransition("PUBLISH_RESERVED", "MUTATION_OUTCOME_UNKNOWN"));
  assert.doesNotThrow(() => assertProductionTransition("MUTATION_OUTCOME_UNKNOWN", "UPLOADED"));
  assert.doesNotThrow(() => assertProductionTransition("MUTATION_OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED"));
  assert.doesNotThrow(() => assertProductionTransition("RECONCILIATION_REQUIRED", "UPLOADED"));
  assert.throws(() => assertProductionTransition("MUTATION_OUTCOME_UNKNOWN", "PUBLISH_RESERVED"), /invalid_production_transition/);
});

test("a consumed public reservation with no network start expires into an explicit hold", () => {
  assert.doesNotThrow(() => assertProductionTransition("PUBLISH_RESERVED", "PUBLICATION_EXPIRED_HOLD"));
  assert.doesNotThrow(() => assertProductionTransition("PUBLICATION_EXPIRED_HOLD", "ENVELOPED", { decisionType: "REQUEUE_EXPIRED_UNSTARTED" }));
  assert.doesNotThrow(() => assertProductionTransition("PUBLICATION_EXPIRED_HOLD", "REJECTED"));
  assert.throws(() => assertProductionTransition("PUBLICATION_EXPIRED_HOLD", "ENVELOPED"), /signed_expired_requeue_decision_required/);
});

test("an uploaded video whose public window closes enters an explicit private hold", () => {
  assert.doesNotThrow(() => assertProductionTransition("UPLOADED", "PUBLIC_STATUS_EXPIRED_HOLD"));
  assert.doesNotThrow(() => assertProductionTransition("PUBLIC_STATUS_EXPIRED_HOLD", "PRIVATE_RELEASE_RETAINED", { decisionType: "RETAIN_PRIVATE_AFTER_WINDOW_EXPIRY" }));
  assert.throws(() => assertProductionTransition("PUBLIC_STATUS_EXPIRED_HOLD", "RECONCILED"), /signed_private_retention_decision_required/);
});

test("operator hold, reject and repair transitions are explicit", () => {
  for (const from of ["VERIFIED", "SELECTED", "SCRIPTED", "MEDIA_BOUND", "RENDERED", "QA_GREEN", "ENVELOPED"]) {
    assert.doesNotThrow(() => assertProductionTransition(from, "AMBER_REVIEW"));
  }
  for (const from of ["UPLOADED", "RECONCILED", "MEASURED"]) assert.doesNotThrow(() => assertProductionTransition(from, "CLAIM_OR_RESTRICTION_HOLD"));
  for (const from of ["AMBER_REVIEW", "RED_REPAIR", "AUTHORITY_SUSPENDED", "PUBLICATION_EXPIRED_HOLD"]) assert.doesNotThrow(() => assertProductionTransition(from, "REJECTED"));
  assert.doesNotThrow(() => assertProductionTransition("AMBER_REVIEW", "RED_REPAIR"));
  for (const restart of ["VERIFIED", "SELECTED", "SCRIPTED", "MEDIA_BOUND"]) assert.doesNotThrow(() => assertProductionTransition("RED_REPAIR", restart));
  assert.doesNotThrow(() => assertProductionTransition("RED_REPAIR", "AMBER_REVIEW"));
  assert.throws(() => assertProductionTransition("PUBLISH_RESERVED", "AMBER_REVIEW"), /invalid_production_transition/);
});

test("each repair scope has one exact safe restart recipe", () => {
  const expected = {
    SOURCE_VERIFICATION: { restartState: "VERIFIED", enqueuedKinds: ["autopilot_candidate_select"], requiredRevalidation: ["source_manifest", "source_freshness", "dedupe"] },
    EDITORIAL: { restartState: "SELECTED", enqueuedKinds: ["autopilot_editorial"], requiredRevalidation: ["source_manifest", "claim_ledger", "public_copy"] },
    MEDIA_RIGHTS: { restartState: "SCRIPTED", enqueuedKinds: ["autopilot_media_rights"], requiredRevalidation: ["canonical_assets", "canonical_placements"] },
    NARRATION_MOTION: { restartState: "MEDIA_BOUND", enqueuedKinds: ["autopilot_narration", "autopilot_motion"], requiredRevalidation: ["audio", "timestamps", "motion_input_joins"] },
    RENDER_QA: { restartState: "MEDIA_BOUND", enqueuedKinds: ["autopilot_render"], requiredRevalidation: ["bound_narration_hash", "bound_motion_hash", "full_render_qa"] }
  };
  for (const [scope, recipe] of Object.entries(expected)) assert.deepEqual(resolveRepairRestart(scope), recipe);
  assert.throws(() => resolveRepairRestart("CALLER_SELECTED"), /unknown_repair_scope/);
});

test("every deterministic stage verdict has one non-stranding state and job result", () => {
  const expected = {
    VERIFIED_INTAKE: { GREEN: ["VERIFIED", ["autopilot_candidate_select"]], RED: ["REJECTED", []] },
    CANDIDATE_SELECT: { GREEN: ["SELECTED", ["autopilot_editorial"]], NO_SLOT: ["DEFERRED_STALE", []] },
    EDITORIAL: { GREEN: ["SCRIPTED", ["autopilot_media_rights"]], AMBER: ["AMBER_REVIEW", ["discord_exception_card"]], RED: ["AMBER_REVIEW", ["discord_exception_card"]] },
    MEDIA_RIGHTS: { GREEN: ["MEDIA_BOUND", ["autopilot_narration", "autopilot_motion"]], AMBER: ["AMBER_REVIEW", ["discord_exception_card"]], RED: ["AMBER_REVIEW", ["discord_exception_card"]] },
    NARRATION_MOTION_JOIN: { GREEN: [null, ["autopilot_render"]], AMBER: ["AMBER_REVIEW", ["discord_exception_card"]], RED: ["AMBER_REVIEW", ["discord_exception_card"]] },
    RENDER: { GREEN: ["RENDERED", ["autopilot_final_qa"]], RED: ["AMBER_REVIEW", ["discord_exception_card"]] },
    FINAL_QA: { GREEN: ["QA_GREEN", ["autopilot_release_candidate"]], AMBER: ["AMBER_REVIEW", ["discord_exception_card"]], RED: ["AMBER_REVIEW", ["discord_exception_card"]] },
    RELEASE_CANDIDATE: { GREEN: [null, ["autopilot_envelope_prepare"]], RED: ["AMBER_REVIEW", ["discord_exception_card"]] },
    ENVELOPE_PREPARE: { GREEN: ["ENVELOPED", []], RED: ["AMBER_REVIEW", ["discord_exception_card"]] }
  };
  for (const [stage, verdicts] of Object.entries(expected)) {
    for (const [verdict, [stateChange, enqueuedKinds]] of Object.entries(verdicts)) {
      assert.deepEqual(resolveStageVerdictTransition({ stage, verdict }), { stateChange, enqueuedKinds, eventType: "STAGE_VERDICT" });
    }
  }
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/db/green-autopilot-content-runs-migration.test.js tests/services/autonomous-content-runs.test.js tests/services/production-state.test.js`

Expected: FAIL on missing migration and modules.

- [ ] **Step 3: Create migration 027**

```sql
CREATE TABLE autonomous_content_runs (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  source_manifest_sha256 TEXT,
  current_evidence_sha256 TEXT,
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(story_id, policy_version)
);
CREATE TABLE autonomous_content_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  evidence_sha256 TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, version)
);
CREATE TRIGGER autonomous_content_events_no_update BEFORE UPDATE ON autonomous_content_events BEGIN SELECT RAISE(ABORT, 'immutable_autonomous_content_events'); END;
CREATE TRIGGER autonomous_content_events_no_delete BEFORE DELETE ON autonomous_content_events BEGIN SELECT RAISE(ABORT, 'immutable_autonomous_content_events'); END;
```

- [ ] **Step 4: Implement state graph and repository**

The graph includes the exact happy path `DISCOVERED -> VERIFIED -> SELECTED -> SCRIPTED -> MEDIA_BOUND -> RENDERED -> QA_GREEN -> ENVELOPED -> PUBLISH_RESERVED -> UPLOADED -> RECONCILED -> MEASURED` and exceptional states `DEFERRED_STALE`, `DUPLICATE`, `AMBER_REVIEW`, `RED_REPAIR`, `REJECTED`, `AUTHORITY_SUSPENDED`, `MUTATION_OUTCOME_UNKNOWN`, `RECONCILIATION_REQUIRED`, `PUBLICATION_EXPIRED_HOLD` and `CLAIM_OR_RESTRICTION_HOLD`. Deterministic intake edges are `DISCOVERED -> REJECTED` for an unverified rumour with a RED receipt, `DISCOVERED -> DEFERRED_STALE` for stale discovery, `DISCOVERED -> DUPLICATE` for an exact duplicate and `VERIFIED -> DEFERRED_STALE` when the runway has no slot. Every other stage uses the closed `resolveStageVerdictTransition` matrix above. GREEN alone advances and enqueues the exact next kind. AMBER or RED at editorial, rights, branch join, render, final QA, candidate or envelope preparation records the full severity/reason in a `STAGE_VERDICT` event, transitions to `AMBER_REVIEW` and atomically enqueues one stable-key `discord_exception_card`, but no downstream or automatic repair job. `RED_REPAIR` is entered only after an authenticated operator `revise` decision, so a deterministic failure is reviewable rather than stranded. Authority drift may move pre-publication runs to `AUTHORITY_SUSPENDED`. Operator hold may move only `VERIFIED`, `SELECTED`, `SCRIPTED`, `MEDIA_BOUND`, `RENDERED`, `QA_GREEN` or `ENVELOPED` to `AMBER_REVIEW`; a post-publication claim/restriction hold may move only `UPLOADED`, `RECONCILED` or `MEASURED` to `CLAIM_OR_RESTRICTION_HOLD`. Operator reject may move only `AMBER_REVIEW`, `RED_REPAIR`, `AUTHORITY_SUSPENDED` or `PUBLICATION_EXPIRED_HOLD` to `REJECTED`. Operator revise moves only `AMBER_REVIEW -> RED_REPAIR`; after one exact repair job, a GREEN repair receipt may restart according to `resolveRepairRestart`, while a failed repair returns `RED_REPAIR -> AMBER_REVIEW`, enqueues one new-version `discord_exception_card` and never retries automatically. The repair service derives the destination, next job kinds and mandatory revalidation list solely from the five-row resolver; neither a Discord payload, job payload nor any other caller may supply or override a restart state. `PUBLISH_RESERVED`, ambiguity states and post-publication holds never enter the ordinary revise path. A network-started ambiguous mutation may move `PUBLISH_RESERVED` or `UPLOADED` to `MUTATION_OUTCOME_UNKNOWN`; exact one-object read-only recovery moves it to `UPLOADED`, while zero or multiple matches after the bounded scan move it to `RECONCILIATION_REQUIRED`. A later operator-triggered read-only reconciliation may move `RECONCILIATION_REQUIRED -> UPLOADED` only after exactly one bound remote object is proven; it never inserts or retries. A public reservation whose execution interval closes with no sub-action `STARTED` event records `EXPIRED_UNSTARTED`, remains consumed and moves `PUBLISH_RESERVED -> PUBLICATION_EXPIRED_HOLD` with zero remote mutations. Only a signed `REQUEUE_EXPIRED_UNSTARTED` decision plus an exact zero-match remote-intent receipt may return it to `ENVELOPED` for a later fresh slot, or the operator may reject it. Normal `UPLOADED -> RECONCILED` then resumes. Every recovery transition requires the current expected version and a hash-bound reconciliation receipt. `transition` validates the graph then updates with `WHERE id=? AND version=?` in the same transaction that appends the immutable event and keyed exception job.

- [ ] **Step 5: Run tests and commit**

For `NARRATION_MOTION_JOIN` and `RELEASE_CANDIDATE`, `stateChange:null` is deliberate. These are evidence-only joins: the run remains `MEDIA_BOUND` or `QA_GREEN`, respectively, while the repository appends an immutable evidence event and enqueues the declared next kind. Implementations must not invent `MEDIA_BOUND -> MEDIA_BOUND` or `QA_GREEN -> QA_GREEN` graph transitions.

The graph also includes `UPLOADED -> PUBLIC_STATUS_EXPIRED_HOLD` when the public window closes after a video insert but before `STATUS_PROMOTE`. The object remains private and authority is requalification-suspended. The only terminal disposition in this plan is an exact signed `RETAIN_PRIVATE_AFTER_WINDOW_EXPIRY` decision, which records `PUBLIC_STATUS_EXPIRED_HOLD -> PRIVATE_RELEASE_RETAINED`, performs no remote mutation and grants no ramp credit. It cannot silently become `RECONCILED` or use yesterday's slot.

Run: `node --test tests/db/green-autopilot-content-runs-migration.test.js tests/services/autonomous-content-runs.test.js tests/services/production-state.test.js`

Expected: PASS.

```powershell
git add db/migrations/027_green_autopilot_content_runs.sql lib/repositories/autonomous_content_runs.js lib/autopilot/production-state.js lib/repositories/index.js tests/db/green-autopilot-content-runs-migration.test.js tests/services/autonomous-content-runs.test.js tests/services/production-state.test.js
git commit -m "feat: track autonomous production state"
```

### Task 2: Gate discovery and verified intake

**Files:**
- Create: `lib/autopilot/stages/verified-intake.js`
- Create: `tests/services/autopilot-verified-intake.test.js`
- Modify: `lib/ops/candidate-supply.js`
- Modify: `lib/job-handlers.js`

**Interfaces:**
- Produces: `runVerifiedIntake({ story, candidateReport, recentTopics, sourcePolicy, now }) -> { verdict, state, manifest, blockers }`.
- Produces: `selectVerifiedCandidate({ run, runwayPolicy, currentBuffer, now }) -> { verdict, state, evidence, blockers }`.
- Produces job kinds: `autopilot_verified_intake` and `autopilot_candidate_select`.

- [ ] **Step 1: Write source, freshness and duplicate tests**

```js
test("verified fresh source produces a canonical manifest", async () => {
  const result = await runVerifiedIntake(fixture({ flair: "Verified", ageHours: 2, duplicate: false }));
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.state, "VERIFIED");
  assert.match(result.manifest.sha256, /^[a-f0-9]{64}$/);
});

test("rumour, stale and duplicate stories do not enter production", async () => {
  const rumour = await runVerifiedIntake(fixture({ flair: "Rumour" }));
  assert.equal(rumour.verdict, "RED");
  assert.equal(rumour.state, "REJECTED");
  assert.ok(rumour.blockers.includes("unverified_rumour_forbidden"));
  assert.equal((await runVerifiedIntake(fixture({ ageHours: 1000 }))).state, "DEFERRED_STALE");
  assert.equal((await runVerifiedIntake(fixture({ duplicate: true }))).state, "DUPLICATE");
});

test("verified intake is selected only when the fresh buffer permits it", async () => {
  assert.equal((await selectVerifiedCandidate(selectionFixture({ availableSlots: 1 }))).state, "SELECTED");
  assert.equal((await selectVerifiedCandidate(selectionFixture({ availableSlots: 0 }))).state, "DEFERRED_STALE");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-verified-intake.test.js tests/services/candidate-supply-engine.test.js`

Expected: FAIL on missing stage.

- [ ] **Step 3: Implement canonical intake**

Bind story ID, canonical URL/hash, source publisher, publication time, discovery time, verified classification, topic fingerprint, source text hashes and policy version. Do not treat Reddit popularity or an LLM confidence score as verification. A `Rumour` or otherwise unverified factual source returns RED and transitions directly `DISCOVERED -> REJECTED` with `unverified_rumour_forbidden`; it is not sent to the exception queue.

- [ ] **Step 4: Add the handler transition**

For eligible input, the intake handler persists the manifest under the external evidence root, transitions `DISCOVERED -> VERIFIED` by expected version and enqueues `autopilot_candidate_select`. For unverified rumours it records the RED receipt and transitions `DISCOVERED -> REJECTED` without downstream work. The selection handler applies the fixed runway budget, transitions `VERIFIED -> SELECTED` and enqueues `autopilot_editorial`. Editorial handlers reject any run not in `SELECTED`.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/autopilot-verified-intake.test.js tests/services/candidate-supply-engine.test.js tests/services/job-handlers.test.js`

Expected: PASS.

```powershell
git add lib/autopilot/stages/verified-intake.js lib/ops/candidate-supply.js lib/job-handlers.js tests/services/autopilot-verified-intake.test.js
git commit -m "feat: gate autonomous verified intake"
```

### Task 3: Produce source-bound editorial evidence

**Files:**
- Create: `lib/autopilot/stages/editorial.js`
- Create: `lib/autopilot/public-copy-policy.js`
- Create: `tests/services/autopilot-editorial-stage.test.js`
- Create: `tests/services/autopilot-public-copy-policy.test.js`
- Modify: `processor.js`
- Modify: `lib/script-coherence-qa.js`
- Modify: `lib/job-handlers/local-ai.js`

**Interfaces:**
- Consumes: `runLlmTask()` from the local-AI plan.
- Produces: `runEditorialStage({ sourceManifest, runLlmTask, policy, jobContext, signal }) -> editorialEvidence`.
- Produces: `evaluateAutopilotPublicCopy({ title, script, description, pinnedComment, links, identityPolicy })`.

- [ ] **Step 1: Write claim-binding and copy tests**

```js
test("every spoken claim maps to retained source evidence", async () => {
  const result = await runEditorialStage(validEditorialFixture());
  assert.equal(result.verdict, "GREEN");
  assert.ok(result.claims.every((claim) => claim.source_refs.length > 0));
  assert.equal(result.copy.language, "en-GB");
});

test("unsupported claim and internal QA language are RED", async () => {
  const result = await runEditorialStage(fixture({ script: "QA PASSED. An unsupported launch date is confirmed." }));
  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("unsupported_spoken_claim"));
  assert.ok(result.blockers.includes("internal_qa_language_in_public_copy"));
});

test("public copy enforces British English, affiliate and burner identity rules", () => {
  assert.equal(evaluateAutopilotPublicCopy(copyFixture({ spelling: "color" })).verdict, "RED");
  assert.equal(evaluateAutopilotPublicCopy(copyFixture({ oxfordComma: true })).verdict, "RED");
  assert.equal(evaluateAutopilotPublicCopy(copyFixture({ amazonProductUrl: "https://amazon.co.uk/dp/example" })).verdict, "RED");
  assert.equal(evaluateAutopilotPublicCopy(copyFixture({ leakedPersonalEmail: true })).verdict, "RED");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-editorial-stage.test.js tests/services/autopilot-public-copy-policy.test.js tests/services/script-coherence-qa.test.js`

Expected: FAIL on missing stage.

- [ ] **Step 3: Implement draft, critique and one repair**

Use `script_draft`, then deterministic claim validation and `editorial_review`. One `source_bound_rewrite` is allowed when repairable. The output binds prompt/model receipts, exact script sections, word count, public title options, caption transcript and claim-to-source mapping.

Run deterministic public-copy policy over title, script, description, pinned comment and links. Require British English, no Oxford comma, the configured Amazon affiliate tag on every Amazon product link, channel/burner identity only, no personal names/emails/local paths and no internal QA language. Monetisation safety remains a separate required gate.

- [ ] **Step 4: Persist state and enqueue rights/media**

GREEN transitions `SELECTED -> SCRIPTED` and enqueues `autopilot_media_rights`. AMBER or RED transitions to its explicit hold state without downstream work.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/autopilot-editorial-stage.test.js tests/services/autopilot-public-copy-policy.test.js tests/services/script-coherence-qa.test.js tests/services/processor-source-material.test.js`

Expected: PASS.

```powershell
git add lib/autopilot/stages/editorial.js lib/autopilot/public-copy-policy.js processor.js lib/script-coherence-qa.js lib/job-handlers/local-ai.js tests/services/autopilot-editorial-stage.test.js tests/services/autopilot-public-copy-policy.test.js
git commit -m "feat: bind autonomous scripts to sources"
```

### Task 4: Require complete media and rights placement evidence

**Files:**
- Create: `lib/autopilot/stages/media-rights.js`
- Create: `lib/job-handlers/autopilot-media-rights.js`
- Create: `tests/services/autopilot-media-rights-stage.test.js`
- Create: `tests/services/autopilot-media-rights-handler.test.js`
- Modify: `lib/media-rights-policy.js`
- Modify: `lib/candidate-evidence-reconciliation.js`
- Modify: `lib/goal06-rights-ledger.js`
- Modify: `lib/job-handlers.js`
- Modify: `lib/repositories/jobs.js`
- Modify: `tests/services/jobs-repository.test.js`

**Interfaces:**
- Produces: `runMediaRightsStage({ editorialEvidence, acquisition, targetPlatform }) -> { verdict, ledger, placements, blockers }`.
- Produces: `runAutopilotMediaRightsHandler({ job, repos, stage, now }) -> { state, evidenceSha256, enqueuedJobIds }`.

- [ ] **Step 1: Write exact placement tests**

```js
test("every timeline placement resolves to a canonical GREEN media record", async () => {
  const result = await runMediaRightsStage(validRightsFixture());
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.placements.every((row) => row.asset_id && row.placement_id && row.source_sha256), true);
});

test("editorial exception and incomplete placement are not autonomous GREEN", async () => {
  assert.equal((await runMediaRightsStage(fixture({ basis: "editorial_exception" }))).verdict, "AMBER");
  assert.equal((await runMediaRightsStage(fixture({ placementId: null }))).verdict, "RED");
});

test("GREEN rights evidence transitions once and enqueues exactly two media branches", async () => {
  const result = await runAutopilotMediaRightsHandler(handlerFixture({ state: "SCRIPTED", version: 4 }));
  assert.equal(result.state, "MEDIA_BOUND");
  assert.deepEqual(result.enqueuedJobIds.map((row) => row.kind).sort(), ["autopilot_motion", "autopilot_narration"]);
  await assert.rejects(() => runAutopilotMediaRightsHandler(handlerFixture({ state: "MEDIA_BOUND", version: 5 })), /media_rights_already_consumed/);
  assert.equal(countJobsForRun(result.runId), 2);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-media-rights-stage.test.js tests/services/autopilot-media-rights-handler.test.js tests/services/media-rights-policy.test.js tests/services/candidate-evidence-reconciliation.test.js`

Expected: FAIL on missing stage.

- [ ] **Step 3: Implement autonomous rights subset**

Accept only owned, directly licensed or publisher-policy GREEN assets whose canonical records cover YouTube, exact timeline ranges, attribution and retained evidence. Reject ambiguous local captures, `NOT_SELECTED`, path-only records, editorial exceptions and inherited positive flags without current hashes.

- [ ] **Step 4: Persist `MEDIA_BOUND` evidence**

The ledger binds canonical media, acquisition sidecars, placement IDs, start/end ranges, source hashes, policy versions and required on-video/description credits. Extend the jobs repository with a transaction-aware `enqueueOnceInTransaction` operation whose idempotency key is uniquely constrained. The fixed `autopilot_media_rights` job handler loads the exact `SCRIPTED` run/version and performs one database transaction that appends the evidence, transitions `SCRIPTED -> MEDIA_BOUND` by expected version and records exactly two outbox jobs with idempotency keys `<runId>:narration:<evidenceSha256>` and `<runId>:motion:<evidenceSha256>`. Restart consumes the same keys and cannot enqueue a third job. GREEN dispatches narration and motion preparation in parallel; no render starts before both complete. AMBER or RED persists its hold evidence and enqueues neither branch.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/autopilot-media-rights-stage.test.js tests/services/autopilot-media-rights-handler.test.js tests/services/media-rights-policy.test.js tests/services/candidate-evidence-reconciliation.test.js tests/services/goal06-rights-ledger.test.js tests/services/jobs-repository.test.js`

Expected: PASS.

```powershell
git add lib/autopilot/stages/media-rights.js lib/job-handlers/autopilot-media-rights.js lib/job-handlers.js lib/repositories/jobs.js lib/media-rights-policy.js lib/candidate-evidence-reconciliation.js lib/goal06-rights-ledger.js tests/services/autopilot-media-rights-stage.test.js tests/services/autopilot-media-rights-handler.test.js tests/services/jobs-repository.test.js
git commit -m "feat: require autonomous media placement rights"
```

### Task 5: Materialise narration, timestamps and distinct motion

**Files:**
- Create: `lib/autopilot/stages/narration.js`
- Create: `lib/autopilot/stages/motion.js`
- Create: `lib/autopilot/media-branch-join.js`
- Create: `tests/services/autopilot-narration-stage.test.js`
- Create: `tests/services/autopilot-motion-stage.test.js`
- Create: `tests/services/autopilot-media-branch-join.test.js`
- Modify: `lib/goal-audio-timestamp-materializer.js`
- Modify: `lib/goal-render-input-workorder.js`
- Modify: `lib/job-handlers/media-ai.js`

**Interfaces:**
- Produces: `runNarrationStage()` and `runMotionStage()` evidence.
- Produces: `recordMediaBranchAndMaybeEnqueueRender({ runId, branch, evidence, repos, now })`.
- Keeps the content run `MEDIA_BOUND`; both evidence branches must be GREEN before the exact render job is enqueued.

- [ ] **Step 1: Write missing-input and distinct-family tests**

```js
test("narration requires mastered audio and verified word timestamps", async () => {
  const result = await runNarrationStage(validNarrationFixture());
  assert.equal(result.verdict, "GREEN");
  assert.match(result.master.sha256, /^[a-f0-9]{64}$/);
  assert.ok(result.words.length > 0);
});

test("motion requires materialised clips and distinct families", async () => {
  const result = await runMotionStage(fixture({ materialised: 4, distinctFamilies: 1 }));
  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("distinct_motion_families_insufficient"));
});

test("either branch completion order joins once and enqueues exactly one render", async () => {
  for (const order of [["narration", "motion"], ["motion", "narration"]]) {
    const result = await completeBranchesInOrder(order);
    assert.equal(result.renderJobs.length, 1);
    assert.equal(result.run.state, "MEDIA_BOUND");
  }
});

test("simultaneous branch restart cannot stale-write or double-enqueue", async () => {
  const results = await Promise.allSettled([completeNarrationBranch(), completeMotionBranch(), replayNarrationBranch()]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 3);
  assert.equal(listBranchEvidence().length, 2);
  assert.equal(listRenderJobs().length, 1);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-narration-stage.test.js tests/services/autopilot-motion-stage.test.js tests/services/autopilot-media-branch-join.test.js`

Expected: FAIL on missing stage modules.

- [ ] **Step 3: Implement exact narration evidence**

Bind approved voice/reference, source text, raw and mastered audio hashes, provider receipt, duration, sample/frame counts, loudness, true peak, transcript, word timestamps, caption mapping and alignment metrics.

- [ ] **Step 4: Implement exact motion evidence**

Bind every materialised clip, source/asset record, source window, programme window, motion family, validation report and repeat/overlap evidence. Require the configured minimum distinct families and reject stale plans or absent files.

Each branch has a unique immutable evidence key `<runId>:<branch>:<inputSetSha256>`. `recordMediaBranchAndMaybeEnqueueRender` inserts or returns that branch receipt, then reloads the current run and both branch receipts inside one transaction rather than reusing the handler's stale pre-branch version. When both current receipts are GREEN and bind the same media-input root, it records one canonical joined-input receipt and calls `enqueueOnceInTransaction` with `<runId>:render:<joinedInputSha256>`. Completion order, concurrent version increments and branch replay therefore converge on two branch receipts, one joined receipt and one render job while the content run remains `MEDIA_BOUND`. A mismatch persists a RED join receipt and enqueues nothing. It does not invent an intermediate content state.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/autopilot-narration-stage.test.js tests/services/autopilot-motion-stage.test.js tests/services/autopilot-media-branch-join.test.js tests/services/goal-audio-timestamp-materializer.test.js tests/services/goal-render-input-workorder.test.js tests/services/jobs-repository.test.js`

Expected: PASS.

```powershell
git add lib/autopilot/stages/narration.js lib/autopilot/stages/motion.js lib/autopilot/media-branch-join.js lib/goal-audio-timestamp-materializer.js lib/goal-render-input-workorder.js lib/job-handlers/media-ai.js tests/services/autopilot-narration-stage.test.js tests/services/autopilot-motion-stage.test.js tests/services/autopilot-media-branch-join.test.js
git commit -m "feat: materialise autonomous narration and motion"
```

### Task 6: Render and run deterministic final QA

**Files:**
- Create: `lib/autopilot/stages/render.js`
- Create: `lib/autopilot/stages/final-qa.js`
- Create: `lib/autopilot/stages/publish-preflight.js`
- Create: `tests/services/autopilot-render-stage.test.js`
- Create: `tests/services/autopilot-render-gpu-serialization.test.js`
- Create: `tests/services/autopilot-final-qa-stage.test.js`
- Create: `tests/services/autopilot-publish-preflight-stage.test.js`
- Modify: `tests/services/autopilot-public-copy-policy.test.js`
- Modify: `lib/autopilot/public-copy-policy.js`
- Modify: `lib/repositories/autonomous_content_runs.js`
- Modify: `lib/job-handlers.js`
- Modify: `lib/goal-production-render-materializer.js`
- Modify: `lib/stabilisation/media-production-contract.js`
- Modify: `lib/render-contract.js`
- Modify: `lib/services/gpu-work-coordinator.js`
- Modify: `tests/services/autonomous-content-runs.test.js`

**Interfaces:**
- Produces: `runRenderStage({ inputs, renderer, gpuCoordinator, jobContext, signal })`.
- Produces: `runFinalQaStage({ renderEvidence, editorialEvidence, rightsEvidence })`.
- Produces: `runDeterministicPublishPreflight({ finalAsset, captions, metadata, accountPolicy, actionPolicies, now }) -> immutablePreflightReceipt` with zero credential or network access.
- Wires fixed `runRenderHandler` and `runFinalQaHandler` expected-version transitions.

- [ ] **Step 1: Write fresh-render and gate aggregation tests**

```js
test("render evidence is bound to exact current inputs", async () => {
  const result = await runRenderStage(validRenderFixture());
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.input_set_sha256, result.expected_input_set_sha256);
});

test("render and QA handlers perform the exact expected-version transitions", async () => {
  const rendered = await runRenderHandler(runFixture({ state: "MEDIA_BOUND", version: 6 }));
  assert.equal(rendered.state, "RENDERED");
  const qa = await runFinalQaHandler(runFixture({ state: "RENDERED", version: 7 }));
  assert.equal(qa.state, "QA_GREEN");
  assert.equal(listJobs({ kind: "autopilot_release_candidate", runId: qa.runId }).length, 1);
});

test("render owns the sole fenced GPU lease and cannot overlap local AI, narration or ASR", async () => {
  const render = runRenderStage(renderFixture({ holdGpuLease: true }));
  await waitForWorkload("render");
  for (const workload of ["ollama", "voxcpm", "faster_whisper"]) {
    await assert.rejects(() => gpuCoordinator.run(gpuFixture({ workload })), /gpu_lease_unavailable/);
  }
  releaseRenderLease();
  assert.equal((await render).verdict, "GREEN");
});

test("render cancellation on fencing loss terminates and awaits the exact child", async () => {
  const result = await runRenderStage(renderFixture({ loseFenceAfterStart: true }));
  assert.equal(result.verdict, "RED");
  assert.equal(result.child_processes_remaining, 0);
  assert.equal(result.output_accepted, false);
});

test("one failed deterministic lane prevents QA_GREEN", async () => {
  const result = await runFinalQaStage(fixture({ temporal: "RED", allOthers: "GREEN" }));
  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("temporal_qa_red"));
});

test("missing, stale or tampered dry-run publication evidence prevents QA_GREEN", async () => {
  for (const publishPreflight of [null, stalePreflight(), tamperedPreflight()]) {
    const result = await runFinalQaStage(fixture({ allOthers: "GREEN", publishPreflight }));
    assert.equal(result.verdict, "RED");
    assert.ok(result.blockers.includes("publish_preflight_not_exact"));
  }
  const green = await runDeterministicPublishPreflight(validPublishPreflightFixture());
  assert.equal(green.network_call_count, 0);
  assert.equal(green.credential_access_count, 0);
  assert.match(green.private_upload_plan_sha256, /^[a-f0-9]{64}$/);
  assert.match(green.public_release_plan_sha256, /^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-render-stage.test.js tests/services/autopilot-render-gpu-serialization.test.js tests/services/autopilot-final-qa-stage.test.js tests/services/autopilot-publish-preflight-stage.test.js`

Expected: FAIL on missing stage modules.

- [ ] **Step 3: Implement render materialisation**

Use the governed production renderer directly, never `run.js produce`. The fixed render handler must enter through `gpu-work-coordinator` with workload `render`, its current fenced job token and cancellation signal before spawning HyperFrames or FFmpeg. The same durable queue serialises render against Ollama, VoxCPM and faster-whisper; no render-heavy child may bypass it. Lease or fencing loss cancels, terminates and awaits the exact child before releasing the queue and leaves no accepted partial artefact. Require exact joined narration/motion input set, strict HyperFrames result, FFprobe, full decode and output hash. A successful handler persists render evidence and transitions `MEDIA_BOUND -> RENDERED` by expected version.

- [ ] **Step 4: Aggregate final deterministic QA**

Require factual/claim, rights, script/coherence, final public-copy, visual, audio, temporal, caption, container, originality, disclosure, metadata, anti-spam, freshness, platform and deterministic publish-preflight checks. Re-run public-copy policy against the exact final title, description, pinned comment, caption transcript and visible-copy extraction so later packaging cannot reintroduce US spelling, Oxford commas, missing affiliate tags, identity leaks or internal QA language. The publish preflight is a no-network subgate inside the fixed final-QA handler. It canonicalises the exact final MP4/SRT/metadata hashes, YouTube account/channel, both allowed action request shapes, disclosure/status fields and expected envelope inputs, then emits private-upload and public-release plan hashes with `credential_access_count:0` and `network_call_count:0`. It is fresh only for the same candidate input root and current account/action policy. Persist every input report hash. Missing, stale or tampered preflight evidence is RED. Full GREEN atomically transitions `RENDERED -> QA_GREEN` by expected version and enqueues exactly one `autopilot_release_candidate` job keyed by run ID plus QA evidence SHA; any other verdict enters `AMBER_REVIEW` through the closed stage matrix and enqueues nothing. There is no weighted score or LLM override.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/autopilot-render-stage.test.js tests/services/autopilot-render-gpu-serialization.test.js tests/services/autopilot-final-qa-stage.test.js tests/services/autopilot-publish-preflight-stage.test.js tests/services/autopilot-public-copy-policy.test.js tests/services/autonomous-content-runs.test.js tests/services/gpu-work-coordinator.test.js tests/services/goal-production-render-materializer.test.js tests/services/media-production-contract.test.js tests/services/render-contract.test.js`

Expected: PASS.

```powershell
git add lib/autopilot/stages/render.js lib/autopilot/stages/final-qa.js lib/autopilot/stages/publish-preflight.js lib/autopilot/public-copy-policy.js lib/repositories/autonomous_content_runs.js lib/job-handlers.js lib/goal-production-render-materializer.js lib/stabilisation/media-production-contract.js lib/render-contract.js lib/services/gpu-work-coordinator.js tests/services/autopilot-render-stage.test.js tests/services/autopilot-render-gpu-serialization.test.js tests/services/autopilot-final-qa-stage.test.js tests/services/autopilot-publish-preflight-stage.test.js tests/services/autopilot-public-copy-policy.test.js tests/services/autonomous-content-runs.test.js
git commit -m "feat: render and verify autonomous candidates"
```

### Task 7: Materialise a non-authoritative release candidate

**Files:**
- Create: `lib/autopilot/release-candidate.js`
- Create: `lib/autopilot/production-conveyor.js`
- Create: `lib/job-handlers/autopilot-release-candidate.js`
- Create: `tools/autopilot-produce-candidate.js`
- Create: `tools/autopilot-production-report.js`
- Create: `tests/services/autopilot-release-candidate.test.js`
- Create: `tests/services/autopilot-release-candidate-handler.test.js`
- Create: `tests/services/autopilot-production-conveyor.integration.test.js`
- Modify: `config/runtime-lanes.json`
- Modify: `lib/job-handlers.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildReleaseCandidate({ run, evidence }) -> { document, canonicalBytes, sha256 }`.
- Produces: `runAutopilotReleaseCandidate({ runId, expectedQaEvidenceSha256, repos, io, now }) -> immutableCandidateReceipt`.
- Produces: `advanceProductionRun({ runId, repos, handlers, now })`.

- [ ] **Step 1: Write tamper and authority-boundary tests**

```js
test("release candidate binds every stage but grants no publication authority", () => {
  const candidate = buildReleaseCandidate(validCompleteRun());
  assert.equal(candidate.document.verdict, "GREEN_CANDIDATE");
  assert.equal(candidate.document.publication_authorised, false);
  assert.match(candidate.sha256, /^[a-f0-9]{64}$/);
});

test("changed caption bytes invalidate candidate validation", () => {
  const candidate = buildReleaseCandidate(validCompleteRun());
  mutateCaption();
  assert.equal(validateReleaseCandidate(candidate.document).verdict, "RED");
});

test("QA completion and candidate materialisation are ordered and crash-idempotent", async () => {
  const isolated = releaseCandidateCrashFixture({ crashAfterAtomicRename: true });
  assert.equal(isolated.jobsByKind("autopilot_release_candidate"), 1);
  await assert.rejects(() => runAutopilotReleaseCandidate(isolated), /simulated_crash/);
  const recovered = await runAutopilotReleaseCandidate(isolated);
  assert.equal(recovered.candidateCount, 1);
  assert.equal(recovered.envelopeJobs, 0);
  assert.equal(recovered.runState, "QA_GREEN");
  assert.match(recovered.candidateSha256, /^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-release-candidate.test.js tests/services/autopilot-release-candidate-handler.test.js tests/services/autopilot-production-conveyor.integration.test.js`

Expected: FAIL on missing modules.

- [ ] **Step 3: Build canonical candidate and orchestration**

The candidate binds every source, claim, script, prompt/model receipt, audio, timestamp, caption, media/rights placement, render, QA, deterministic publish-preflight, metadata and policy hash. The preflight binding includes the exact account/channel and both allowed action-plan hashes; envelope preparation must recompute the phase-relevant plan from the same bytes. It says `publication_authorised:false`, is recorded as evidence on the existing `QA_GREEN` state and is only an input to the authority plan. `RELEASE_CANDIDATE` is not a content-run state.

`runAutopilotReleaseCandidate` is the sole fixed render-lane owner of the job enqueued by final QA. It reloads the exact `QA_GREEN` run and expected QA SHA, writes to same-parent staging with exclusive files, validates the bytes, renames atomically and idempotently registers one candidate SHA. Restart after any file/database boundary rehashes and converges on one candidate receipt. At this task boundary it does not enqueue the envelope or broker because the authority plan has not yet installed those capabilities; Task 4 of that plan extends this same handler to enqueue envelope preparation only after the candidate receipt is durable.

`advanceProductionRun` performs one expected-version transition and enqueues only the exact next stage. It never loops through all stages in one process.

- [ ] **Step 4: Add local-proof tools**

```json
"ops:autopilot:produce": "node tools/autopilot-produce-candidate.js",
"ops:autopilot:production-report": "node tools/autopilot-production-report.js"
```

Both require `--database-mode fixture|production`, run shared schema preflight for migrations 025–027 and default to read-only or LOCAL_PROOF. Production returns structured `PENDING` before an absent content-run query. Both reject live/public flags.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/services/autopilot-release-candidate.test.js tests/services/autopilot-release-candidate-handler.test.js tests/services/autopilot-production-conveyor.integration.test.js`

Expected: PASS.

```powershell
git add config/runtime-lanes.json lib/autopilot/release-candidate.js lib/autopilot/production-conveyor.js lib/job-handlers/autopilot-release-candidate.js lib/job-handlers.js tools/autopilot-produce-candidate.js tools/autopilot-production-report.js package.json tests/services/autopilot-release-candidate.test.js tests/services/autopilot-release-candidate-handler.test.js tests/services/autopilot-production-conveyor.integration.test.js
git commit -m "feat: materialise autonomous release candidates"
```

### Task 8: Wire the fresh candidate buffer and retire legacy live production

**Files:**
- Create: `lib/autopilot/stages/repair.js`
- Create: `lib/job-handlers/autopilot-repair.js`
- Create: `lib/runtime/production-http-route-policy.js`
- Create: `config/autopilot-job-ownership.json`
- Create: `tests/services/autopilot-repair-stage.test.js`
- Create: `tests/services/autopilot-scheduler-fanout.test.js`
- Create: `tests/services/production-legacy-http-boundary.test.js`
- Create: `tests/services/production-legacy-executable-boundary.test.js`
- Create: `tests/services/autopilot-job-ownership.test.js`
- Modify: `config/runtime-lanes.json`
- Modify: `lib/scheduler.js`
- Modify: `lib/stabilisation/scheduler-profile.js`
- Modify: `lib/job-handlers.js`
- Modify: `run.js`
- Modify: `server.js`
- Modify: `tools/local-live-content-workers.ps1`
- Modify: `tools/local-live-primary-runtime.ps1`
- Modify: `tools/local-publish-critical-worker.js`
- Modify: `tools/runtime-discovery-worker.js`
- Modify: `tools/runtime-editorial-worker.js`
- Modify: `tools/runtime-media-worker.js`
- Modify: `tools/runtime-render-worker.js`
- Modify: `tools/runtime-repair-worker.js`
- Modify: `tools/goal-dry-run-publish.js`
- Modify: `docs/OPERATING_MODES.md`
- Modify: `tests/services/goal-dry-run-publisher.test.js`
- Modify: `tests/ops/windows-production-services.test.js`

**Interfaces:**
- Schedules only intake/refill and stage-specific jobs.
- Produces: `runAutopilotRepair({ runId, decisionId, artefactSha256, scope, repos, stageRunners, now }) -> immutableRepairReceipt`.
- Produces: `classifyProductionHttpRoutes({ routes, readOnlyAllowlist }) -> { allowed, tombstoned, blockers }`.
- Legacy production commands fail closed when `PULSE_RUNTIME_ROLE=production`.

- [ ] **Step 1: Write the scheduler and legacy-boundary tests**

```js
test("approved profile starts verified intake and never monolithic produce", () => {
  const schedules = selectAutopilotSchedules();
  assert.ok(schedules.some((row) => row.kind === "autopilot_verified_intake"));
  assert.equal(schedules.some((row) => row.kind === "produce"), false);
});

test("each production stage is owned by one fixed runtime lane", () => {
  const ownership = loadAutopilotJobOwnership();
  assert.equal(ownership.duplicateKinds.length, 0);
  assert.equal(ownership.activeRows.filter((row) => ownerIdsFor(row.kind).length !== 1).length, 0);
  assert.equal(ownership.rows.every((row) => row.owner_lane && row.handler && row.introduced_by_task), true);
  for (const row of ownership.activeRows) assert.deepEqual(ownerIdsFor(row.kind), [row.owner_lane]);
  assert.equal(ownership.pendingRows.every((row) => row.activation_task && row.active === false), true);
});

test("every legacy run.js mode is unavailable to the production role", async () => {
  for (const mode of ["hunt", "approve", "produce", "publish", "full", "watch", "weekly", "blog", "schedule"]) {
    const probe = legacyExecutableProbe();
    await assert.rejects(() => runMain([mode], { PULSE_RUNTIME_ROLE: "production", probe }), /legacy_live_entrypoint_forbidden/);
    assert.deepEqual(probe.counts, { import: 0, job: 0, spawn: 0, file: 0, network: 0 });
  }
  await assert.rejects(() => runLegacyBlogDirect({ runtimeRole: "production", probe: legacyExecutableProbe() }), /legacy_live_entrypoint_forbidden/);
});

test("legacy supervisors and generic publish worker cannot arm or run in production", async () => {
  const primary = await planLegacyPrimaryRuntime({ runtimeRole: "production" });
  assert.equal(primary.verdict, "RETIRED");
  assert.equal(primary.processStartCount, 0);
  assert.equal(primary.autoPublishWriteCount, 0);
  await assert.rejects(() => buildLocalPublishCriticalWorker({ runtimeRole: "production", kinds: ["publish"] }), /legacy_publish_worker_retired/);
});

test("legacy HTTP mutation routes are gone in the production role", async () => {
  const app = createServerApp({ runtimeRole: "production", forbiddenMutationProbe });
  for (const [method, path] of [
    ["post", "/api/approve"],
    ["post", "/api/publish"],
    ["post", "/api/generate-image"],
    ["post", "/api/generate-video"],
    ["post", "/api/schedule"],
    ["post", "/api/retry-publish"],
    ["post", "/api/autonomous/run"],
    ["post", "/api/autonomous/approve"],
    ["post", "/api/autonomous/publish"],
    ["post", "/api/hunter/run"],
    ["post", "/api/watcher/start"],
    ["post", "/api/engagement/run"]
  ]) {
    const response = await request(app)[method](path).send({ id: "story-1" });
    assert.equal(response.status, 410);
  }
  assert.deepEqual(forbiddenMutationProbe.counts, { job: 0, import: 0, spawn: 0, file: 0, network: 0 });
});

test("production route inventory admits only an exact read-only allowlist", () => {
  const report = classifyProductionHttpRoutes({ routes: listRegisteredRoutes(createServerApp({ runtimeRole: "production" })), readOnlyAllowlist: PRODUCTION_READ_ONLY_HTTP_ALLOWLIST });
  assert.deepEqual(report.blockers, []);
  assert.equal(report.allowed.every((row) => row.classification === "READ_ONLY_COMPATIBILITY"), true);
  assert.equal(report.tombstoned.some((row) => row.path === "/api/engagement/run"), true);
  assert.equal(report.routesWithMutationCapability, 0);
});

test("one keyed repair derives and enforces its exact restart recipe", async () => {
  const first = await runAutopilotRepair(repairFixture({ decisionId: "decision-7", scope: "MEDIA_RIGHTS", revalidation: "GREEN" }));
  assert.equal(first.fromState, "RED_REPAIR");
  assert.equal(first.toState, "SCRIPTED");
  assert.deepEqual(first.enqueuedKinds, ["autopilot_media_rights"]);
  assert.deepEqual(first.revalidated, ["canonical_assets", "canonical_placements"]);
  const replay = await runAutopilotRepair(repairFixture({ decisionId: "decision-7", scope: "MEDIA_RIGHTS" }));
  assert.equal(replay.receiptSha256, first.receiptSha256);
  assert.equal(repairExecutionCount("decision-7"), 1);
  await assert.rejects(() => runAutopilotRepair(repairFixture({ scope: "MEDIA_RIGHTS", restartState: "MEDIA_BOUND" })), /caller_restart_state_forbidden/);
});

test("failed repair returns to AMBER review and never retries itself", async () => {
  const result = await runAutopilotRepair(repairFixture({ scope: "RENDER_QA", revalidation: "RED" }));
  assert.equal(result.toState, "AMBER_REVIEW");
  assert.deepEqual(result.enqueuedKinds, []);
  assert.equal(result.retry_allowed, false);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-repair-stage.test.js tests/services/autopilot-scheduler-fanout.test.js tests/services/autopilot-job-ownership.test.js tests/services/production-legacy-http-boundary.test.js tests/services/production-legacy-executable-boundary.test.js tests/services/stabilisation-scheduler-profile.test.js`

Expected: FAIL because the current profile still carries monolithic production semantics.

- [ ] **Step 3: Wire stage fan-out and candidate buffer**

Reconcile the approved hunt/refill cadence. Intake creates at most the configured fresh work budget. Each completed stage enqueues the next exact job with an idempotency key. Register fixed `autopilot_repair` handling in `lib/job-handlers.js` and bind it only to `tools/runtime-repair-worker.js`. Its idempotency key is decision ID plus held artefact SHA. The handler reloads the exact immutable decision and `RED_REPAIR` run, calls the shared `resolveRepairRestart(scope)`, executes every mandatory revalidation and rejects caller-provided destinations or job kinds. A GREEN receipt transitions by expected version to the derived restart state and enqueues only the derived kinds in the same transaction. Any failed validation transitions to `AMBER_REVIEW`, seals a failure receipt and enqueues no retry.

Create one closed declarative ownership registry, `config/autopilot-job-ownership.json`, whose rows bind exact job kind, sole lane, fixed handler export, introduction task, credential class and publication-critical class. It contains the whole final programme, including runtime maintenance (`publication_health_sentinel`, `runtime_backup_verify`, `legacy_remote_deployment_audit`), discovery/selection, `autopilot_editorial`, `autopilot_media_rights`, `operator_question`, `autopilot_narration`, `local_ai_probe`, `gpu_queue_reap`, `autopilot_motion`, render/final-QA/candidate, envelope preparation, repair, shadow day-close/phase-seal, private-canary/public-window controllers, continuation recovery, reservation expiry sweep, publish/reconciliation/monitor/analytics, `discord_exception_card`, Discord digests and outbox delivery. The exact lane IDs are `control-plane`, `discovery`, `editorial`, `media`, `render`, `repair`, `authority-broker`, `publisher`, `analytics`, `discord-ops` and `discord-outbox`. This task activates only handlers implemented so far; later plans activate their predeclared rows and their focused tests compare runtime-lane capabilities with the same registry. Final programme readiness requires every registry row active and exactly one owner. No plan maintains a second handwritten kind map. The scheduler never enqueues upload work from a story row alone.

In `server.js`, register a production-role compatibility policy before any legacy handler module is imported. Its committed allowlist names every retained read-only status route by method and exact path. Every other registered API route is either replaced with `410 legacy_live_entrypoint_retired` or makes production bootstrap fail if it is unclassified. The tombstone set includes approval, publish, autonomous run/approve/publish, image/video generation, schedule, retry-publish, hunter run, watcher start, engagement/comment moderation and any compile/blog/admin mutation endpoint present in the route inventory. Tombstones cannot import legacy publishers or engagement code, spawn a process, enqueue a job, write a story/media file, open OAuth or touch a network adapter. An inventory test walks the actual Express stack, so a future mutation route cannot silently appear. Keep only exact read-only compatibility status routes. New production operations enter through fixed workers, the broker and the separate authenticated Discord service; no generic HTTP body can approve, produce, comment or publish.

At the top of `run.js`, before mode-specific imports, production role rejects `hunt`, `approve`, `produce`, `publish`, `full`, `watch`, `weekly`, `blog` and generic `schedule`. The direct legacy blog/compile entry point applies the same first-import guard. This closes breaking-queue, weekly/blog compile and multi-platform upload paths as well as the obvious publish modes. `tools/local-live-primary-runtime.ps1` becomes a plan-only retired compatibility shim in production and cannot set `AUTO_PUBLISH`, clear a kill switch or start a server/worker. `tools/local-publish-critical-worker.js` rejects production role and the legacy `publish` kind before loading a handler. Only the new fixed service entry points are valid production executables. Tests instrument module imports, jobs, processes, files and networks to prove refusal occurs first.

Update `tools/goal-dry-run-publish.js` to require explicit database mode and shared migration preflight before it reads autonomous candidate state. Fixture mode remains the implementation proof; production mode returns `PENDING` before any absent migration-027 query.

- [ ] **Step 4: Run the production plan gate**

Run:

```powershell
node --test tests/services/autopilot-verified-intake.test.js tests/services/autopilot-editorial-stage.test.js tests/services/autopilot-media-rights-stage.test.js tests/services/autopilot-narration-stage.test.js tests/services/autopilot-motion-stage.test.js tests/services/autopilot-render-stage.test.js tests/services/autopilot-final-qa-stage.test.js tests/services/autopilot-publish-preflight-stage.test.js tests/services/autopilot-release-candidate.test.js tests/services/autopilot-production-conveyor.integration.test.js tests/services/autopilot-repair-stage.test.js tests/services/autopilot-scheduler-fanout.test.js tests/services/autopilot-job-ownership.test.js tests/services/production-legacy-http-boundary.test.js tests/services/production-legacy-executable-boundary.test.js tests/services/goal-dry-run-publisher.test.js tests/ops/windows-production-services.test.js
npm run ops:autopilot:production-report -- --database-mode fixture
npm run ops:goal-dry-run-publish -- --database-mode fixture
```

Expected: tests PASS. The report contains fresh stage truth. Dry-run output contains zero live actions.

- [ ] **Step 5: Update operating documentation and commit**

```powershell
git add config/runtime-lanes.json config/autopilot-job-ownership.json lib/autopilot/stages/repair.js lib/job-handlers/autopilot-repair.js lib/runtime/production-http-route-policy.js lib/scheduler.js lib/stabilisation/scheduler-profile.js lib/job-handlers.js run.js server.js tools/local-live-content-workers.ps1 tools/local-live-primary-runtime.ps1 tools/local-publish-critical-worker.js tools/runtime-discovery-worker.js tools/runtime-editorial-worker.js tools/runtime-media-worker.js tools/runtime-render-worker.js tools/runtime-repair-worker.js tools/goal-dry-run-publish.js docs/OPERATING_MODES.md tests/services/autopilot-repair-stage.test.js tests/services/autopilot-scheduler-fanout.test.js tests/services/autopilot-job-ownership.test.js tests/services/production-legacy-http-boundary.test.js tests/services/production-legacy-executable-boundary.test.js tests/services/goal-dry-run-publisher.test.js tests/ops/windows-production-services.test.js
git commit -m "feat: activate staged autonomous production"
```

### Task 9: Collect performance and propose controlled experiments

**Files:**
- Create: `lib/autopilot/analytics-learning.js`
- Create: `lib/services/youtube-analytics-snapshot.js`
- Create: `tools/autopilot-analytics-report.js`
- Create: `tests/services/autopilot-analytics-learning.test.js`
- Create: `tests/services/youtube-analytics-snapshot.test.js`
- Create: `tests/services/analytics-credential-isolation.test.js`
- Modify: `config/runtime-lanes.json`
- Modify: `config/autopilot-job-ownership.json`
- Modify: `tests/services/autonomous-content-runs.test.js`
- Modify: `lib/goal11-retention-intelligence-loop.js`
- Modify: `lib/goal12-experimentation-engine.js`
- Modify: `lib/repositories/autonomous_content_runs.js`
- Modify: `lib/job-handlers.js`
- Modify: `lib/scheduler.js`
- Modify: `tools/runtime-analytics-worker.js`
- Modify: `tools/runtime-publisher-worker.js`
- Modify: `package.json`
- Modify: `tests/ops/windows-production-services.test.js`
- Modify: `tests/services/autopilot-job-ownership.test.js`

**Interfaces:**
- Produces: `collectYouTubeAnalyticsSnapshot({ publicationReceipt, readOnlyYouTubeAdapter, policy, now }) -> immutableSnapshotReceipt` on the credential-isolated publisher lane.
- Produces: `collectAutopilotPerformance({ publicationReceipts, analyticsSnapshotReceipts, policy, now }) -> immutableMetricsReceipt` without credential access.
- Produces: `proposeAutopilotExperiment({ metrics, learningPolicy, runLlmTask, jobContext, signal }) -> proposal`.

- [ ] **Step 1: Write read-only collection and non-authority tests**

```js
test("analytics collection accepts only reconciled exact publications", async () => {
  const receipt = await collectAutopilotPerformance(fixturePublications());
  assert.equal(receipt.publications.every((row) => row.reconciled && row.envelope_sha256), true);
});

test("analytics lane consumes receipts and cannot acquire YouTube credentials", async () => {
  const result = await collectAutopilotPerformance(metricsFixture({ analyticsSnapshotReceipts: [BOUND_SNAPSHOT] }));
  assert.equal(result.verdict, "GREEN");
  await assert.rejects(() => importYouTubeCredentialProviderFromAnalyticsLane(), /credential_boundary_forbidden/);
  assert.equal(result.remoteCallCount, 0);
});

test("publisher snapshot job is read-only and emits an immutable envelope-bound receipt", async () => {
  const receipt = await collectYouTubeAnalyticsSnapshot(snapshotFixture());
  assert.equal(receipt.envelope_sha256, ENVELOPE_SHA);
  assert.equal(receipt.measurement_window, WINDOW);
  assert.deepEqual(receipt.adapter_methods.sort(), ["analytics.query", "videos.list"].sort());
  assert.equal(receipt.remoteMutationCount, 0);
  assert.equal(receipt.tokenWriteCount, 0);
});

test("an experiment proposal cannot change gates, rights or authority", async () => {
  const proposal = await proposeAutopilotExperiment(experimentFixture());
  assert.deepEqual(proposal.allowed_fields.sort(), ["content_pillar", "duration", "hook_variant", "packaging_variant", "pacing", "publish_window"].sort());
  assert.equal(proposal.applied, false);
  assert.equal(proposal.authority_effect, "NONE");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/services/autopilot-analytics-learning.test.js tests/services/youtube-analytics-snapshot.test.js tests/services/analytics-credential-isolation.test.js tests/services/goal11-retention-intelligence-loop.test.js tests/services/goal12-experimentation-engine.test.js tests/services/autopilot-job-ownership.test.js`

Expected: FAIL because the autonomous analytics adapter does not exist.

- [ ] **Step 3: Implement source-bound metrics collection**

The analytics lane never receives YouTube OAuth material. Register fixed `youtube_analytics_snapshot` work only on the credential-isolated publisher lane. It obtains a read-only adapter exposing only `videos.list` and Analytics API query methods, forbids token-file writes and has no insert/update/delete surface. For a reconciled publication it emits one immutable receipt bound to remote publication ID, release-envelope SHA, exact measurement window, channel/account, query set, response hashes and completeness. The ordinary `autopilot_analytics_collect` job consumes only those receipts and binds views, watch time, retention curve, swipe-away rate, likes, comments and subscriber conversion to the same envelope and window. Persisting the first complete policy-required metrics receipt transitions the exact content run `RECONCILED -> MEASURED` by expected version. A missing scope or remote error yields an explicit incomplete snapshot receipt, keeps the run `RECONCILED` and never blocks otherwise safe publication.

- [ ] **Step 4: Implement proposal-only learning**

Use the existing controlled-experiment records from migrations 021–024. Require a predetermined sample size, primary metric, guardrail metrics, quality floors and expiry. Gemma 4B may summarise metrics but cannot select significance, change thresholds or apply a proposal. Only the fixed allowed fields can be proposed. Source policy, rights tiers, QA thresholds, kill switch, cadence cap and standing authority are immutable from this lane.

- [ ] **Step 5: Register fixed analytics jobs**

Activate the predeclared `youtube_analytics_snapshot`, `autopilot_analytics_collect` and `autopilot_experiment_propose` rows in `config/autopilot-job-ownership.json`. The focused ownership gate requires each active kind to have the same sole handler and lane in the registry, runtime-lane configuration and job-handler table.

Add `autopilot_analytics_collect` and `autopilot_experiment_propose` to the fixed analytics worker only. Add `youtube_analytics_snapshot` to the fixed publisher worker only and ensure that handler imports the read-only adapter module rather than the publish mutation adapter. Bind all three kinds in `config/runtime-lanes.json`. Schedule the snapshot after reconciliation, collection only after its receipt and a bounded weekly proposal job. Use idempotency keys derived from publication ID plus measurement window or experiment cohort plus policy version. Lane-import and Windows identity tests prove the analytics service SID cannot read the YouTube Credential Manager target or import its provider.

- [ ] **Step 6: Run the analytics gate and commit**

Add the read-only package script:

```json
"ops:autopilot:analytics-report": "node tools/autopilot-analytics-report.js"
```

The report CLI requires explicit database mode and shared preflight for migrations 025–027. Production returns `PENDING` before a missing content-run or metrics-table query; implementation uses only fixture or retained hash-bound receipts.

Run:

```powershell
node --test tests/services/autopilot-analytics-learning.test.js tests/services/youtube-analytics-snapshot.test.js tests/services/analytics-credential-isolation.test.js tests/services/autonomous-content-runs.test.js tests/services/goal11-retention-intelligence-loop.test.js tests/services/goal12-experimentation-engine.test.js tests/services/analytics-stabilisation-contract.test.js tests/services/analytics-stabilisation-experiment.test.js tests/services/autopilot-job-ownership.test.js tests/ops/windows-production-services.test.js
npm run ops:autopilot:analytics-report -- --database-mode fixture
```

Expected: PASS. The report reads fixture or retained analytics receipts only and performs no analytics API call, experiment promotion or policy mutation.

```powershell
git add config/runtime-lanes.json config/autopilot-job-ownership.json lib/autopilot/analytics-learning.js lib/services/youtube-analytics-snapshot.js tools/autopilot-analytics-report.js lib/goal11-retention-intelligence-loop.js lib/goal12-experimentation-engine.js lib/repositories/autonomous_content_runs.js lib/job-handlers.js lib/scheduler.js tools/runtime-analytics-worker.js tools/runtime-publisher-worker.js package.json tests/services/autopilot-analytics-learning.test.js tests/services/youtube-analytics-snapshot.test.js tests/services/analytics-credential-isolation.test.js tests/services/autonomous-content-runs.test.js tests/services/autopilot-job-ownership.test.js tests/ops/windows-production-services.test.js
git commit -m "feat: add governed autopilot learning loop"
```
