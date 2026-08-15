# GREEN Autopilot Programme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the six GREEN autopilot implementation tracks in a dependency-safe order and produce one verifiable, local-first YouTube Shorts conveyor without granting premature live authority.

**Architecture:** This is the programme index. Each task delegates to one detailed TDD plan, requires its machine-verifiable exit gate and prevents later tracks from treating partial implementation as operational readiness.

**Tech Stack:** Node.js 24 CommonJS, SQLite, Windows services, Ollama, VoxCPM, faster-whisper, HyperFrames, FFmpeg, YouTube Data API v3, Discord

**Spec:** `docs/superpowers/specs/2026-08-14-pulse-gaming-green-autopilot-design.md`

## Plan Set

1. `docs/superpowers/plans/2026-08-14-green-autopilot-runtime-foundation.md`
2. `docs/superpowers/plans/2026-08-14-green-autopilot-local-ai-runtime.md`
3. `docs/superpowers/plans/2026-08-14-green-autopilot-production-conveyor.md`
4. `docs/superpowers/plans/2026-08-14-green-autopilot-authority-and-publisher.md`
5. `docs/superpowers/plans/2026-08-14-green-autopilot-discord-ops.md`
6. `docs/superpowers/plans/2026-08-14-green-autopilot-acceptance-and-cutover.md`

## Programme Rules

- Use the clean integrated worktree created by the runtime plan. Never implement in the current dirty checkout.
- Complete plans in the listed order. A later plan may add tests against an earlier interface but must not silently redefine it.
- Migration numbers are reserved as follows: 025 runtime controls, 026 GPU queue, 027 content runs, 028 autonomous authority, 029 Discord operations and 030 acceptance/cutover.
- If current mainline already owns one of those numbers at execution time, stop, assign the next contiguous unused numbers across all six plans and update every reference before writing a migration.
- Use a temporary database for migration and repository tests. Never apply implementation migrations to `D:\pulse-data\pulse.db` without a separate operator-approved cutover.
- Every implementation or reporting CLI that reads SQLite must receive explicit `--database-mode fixture|production` and call the shared schema preflight before any domain-table query. Fixture mode uses only the fully migrated temporary database. Production mode returns structured `PENDING` before querying tables from unapplied migrations 025–030.
- `LOCAL_PROOF`, `DRY_RUN_PUBLISH` and inactive authority remain the defaults throughout implementation.
- Do not run live YouTube, Discord-send, OAuth, production-DB, Windows-service-install or schedule-arming commands while executing these plans.
- Commit each subplan task separately, then request code review before crossing a plan boundary.
- Every claimed gate requires fresh command output from the implementation worktree.

---

### Task 1: Establish the protected runtime foundation

**Detailed plan:** `docs/superpowers/plans/2026-08-14-green-autopilot-runtime-foundation.md`

- [ ] **Step 1: Create and verify the clean integrated worktree**

Use `superpowers:using-git-worktrees`. Merge current `origin/main`, install from the lockfile and require a clean exact commit plus migrations 001–024 before Task 1 of the runtime plan. The implementation gate validates migrations against a freshly created disposable fixture database. Production migration status is a separate read-only report and must remain pending rather than being changed during implementation.

- [ ] **Step 2: Execute all eight runtime tasks in order**

Do not begin the local-AI plan until external production paths, migration 025, fenced leases, durable controls, schedule reconciliation, atomic bootstrap, truthful readiness, isolated service identities and restore evidence are implemented.

- [ ] **Step 3: Run the runtime exit gate**

Run the exact final focused commands in the runtime plan plus:

```powershell
npm run ops:agent-rules
npm run ops:autopilot:baseline -- --database-mode fixture --expect GREEN
npm run ops:autopilot:baseline -- --database-mode production --expect PENDING
npm run ops:runtime:readiness -- --database-mode production --expect PENDING
```

Expected: rules and fixture baseline PASS. The production baseline truthfully reports `PENDING` after migration 025 is committed because no production migration is authorised in this plan. Readiness reports `migration_cutover_pending` and `not_armed` or equivalent; it must not report production GREEN.

- [ ] **Step 4: Review before continuing**

Request review focused on fail-closed startup, fencing, durable kill-switch persistence, external path containment, service-account isolation and restore evidence. Resolve P0/P1 findings before Task 2.

### Task 2: Make local AI deterministic, bounded and observable

**Detailed plan:** `docs/superpowers/plans/2026-08-14-green-autopilot-local-ai-runtime.md`

- [ ] **Step 1: Execute all seven local-AI tasks**

Implement migration 026, one cancellable GPU queue, fixed model-task policy, real probes, converted callers, fail-closed VoxCPM/faster-whisper coordination and split production jobs.

- [ ] **Step 2: Prove the approved routing boundary**

Require Gemma 4B only for extraction, summaries, entities, titles, analytics and operator questions; Gemma 12B only for scripts, reviews, rewrites and critique; VoxCPM only for narration; faster-whisper only for transcript/timestamps. Prove that 27B and cloud models cannot enter normal production.

- [ ] **Step 3: Run the local-AI exit gate**

Run the exact final test group and health command from the local-AI plan.

Expected: focused tests PASS. Real probes may report unavailable services on a development host, but missing services must produce explicit holds rather than false readiness or cloud fallback.

- [ ] **Step 4: Review before continuing**

Request review focused on cancellation, GPU ownership, model drift, schema validation, fallback receipts and removal of direct production model calls.

### Task 3: Build the deterministic production conveyor

**Detailed plan:** `docs/superpowers/plans/2026-08-14-green-autopilot-production-conveyor.md`

- [ ] **Step 1: Execute all nine production tasks**

Implement migration 027, verified intake, source-bound editorial work, complete rights placement, narration/timestamps/motion, deterministic render/QA, non-authoritative release candidates, the staged job graph and proposal-only performance learning.

- [ ] **Step 2: Prove the declared production blockers are closed**

Require evidence for final narration, word timestamps, caption mapping, materialised and distinct motion, fresh MP4 identity, complete rights records, scheduler bridge, strict dry run and absence of thin-render, placeholder-title or internal-QA-copy incidents.

- [ ] **Step 3: Run the production exit gate**

Run the exact final focused and integration commands in the production plan.

Expected: fixture GREEN candidates remain `QA_GREEN` with a hash-bound non-authoritative release-candidate document; AMBER and RED fixtures stop in their exact hold states. No release reaches `ENVELOPED` or publication reservation.

- [ ] **Step 4: Review before continuing**

Request review focused on source evidence, rights completeness, state transitions, deterministic QA, stale artefact invalidation and retirement of monolithic live production.

### Task 4: Add standing authority and the isolated publisher

**Detailed plan:** `docs/superpowers/plans/2026-08-14-green-autopilot-authority-and-publisher.md`

- [ ] **Step 1: Execute all eight authority tasks**

Implement migration 028, inactive standing authority, strict GREEN eligibility, immutable envelopes, Ed25519 request signing, the credential-isolated adapter, exactly-once publication/reconciliation and shadow-only wiring.

- [ ] **Step 2: Prove that no caller can mint authority**

Run raw JSON, forged signature, stale envelope, wrong worker, wrong channel, wrong cadence, ambiguity and replay tests. Confirm only the authority broker can sign and only the dedicated publisher identity can read YouTube credentials.

- [ ] **Step 3: Run the authority exit gate**

Run the exact final authority plan gate.

Expected: all tests PASS, authority state is `INACTIVE` or `SHADOW` and every live mutation count is zero.

- [ ] **Step 4: Review before continuing**

Request security and mutation-boundary review. Resolve all P0/P1 findings before Discord or acceptance work treats the authority interfaces as stable.

### Task 5: Add secure two-way Discord operations

**Detailed plan:** `docs/superpowers/plans/2026-08-14-green-autopilot-discord-ops.md`

- [ ] **Step 1: Execute all six Discord tasks**

Implement migration 029, exact identity validation, canonical commands, durable outbox delivery, a dedicated private ops bot and daily/weekly/incident messages.

- [ ] **Step 2: Prove Discord has no publication authority**

Require exact user, guild and private channel. Prove role-only, public-channel, DM, replayed, stale and community-bot inputs fail. Confirm commands enter the control plane and no Discord handler calls the publisher.

- [ ] **Step 3: Run the Discord exit gate**

Run the exact final Discord plan gate and read-only doctor.

Expected: tests PASS. The doctor performs no outbound send. Missing live private-channel evidence remains explicit for the acceptance plan.

- [ ] **Step 4: Review before continuing**

Request review focused on identity, replay protection, two-step resume, notification idempotency, secret redaction and legacy approval removal.

### Task 6: Build acceptance, promotions and phased cutover tooling

**Detailed plan:** `docs/superpowers/plans/2026-08-14-green-autopilot-acceptance-and-cutover.md`

- [ ] **Step 1: Execute all nine acceptance tasks**

Implement migration 030, the 30-case corpus, shadow evaluator, recovery drills, Discord acceptance, exact promotions, private canary reporting, public cadence gates, the signed production schema-cutover ceremony and programme readiness. Task 8's cutover implementation and fixture gate must pass before Task 9 may report implementation complete; no production apply is run as part of implementation.

- [ ] **Step 2: Run the complete non-live programme gate**

Run the final command group in the acceptance plan and the closest integration suite for every changed boundary.

Expected: implementation and fixture evidence may be GREEN. Actual shadow, private-canary, public-ramp and two-daily readiness remain false until their elapsed observations and separate signed operator decisions exist.

- [ ] **Step 3: Perform final plan-to-spec verification**

Check every section of the design against code, tests and evidence. Verify zero unresolved P0/P1, no gate weakening, exact current commit/config binding and no live mutation during implementation.

- [ ] **Step 4: Prepare but do not execute operational promotions**

Generate the operator-facing shadow plan and handoff. Starting shadow, each host-impacting drill, activation of `PRIVATE_CANARY`, activation of the public ramp and the later two-daily cadence promotion remain separate signed operational decisions. Once `PRIVATE_CANARY` is active, its capped 5–10 strict-GREEN private uploads run under that standing phase authority and budget without per-video approval.

### Task 7: Finish the implementation branch safely

- [ ] **Step 1: Run repository-wide verification**

```powershell
npm test
npm run build
npm run ops:agent-rules
npm run docs:doctor
git diff --check origin/main...HEAD
git status --porcelain=v1 --untracked-files=all
```

Expected: tests, build, rules and docs PASS. The worktree is clean after committing generated source and documentation; runtime evidence belongs under the configured external data root or ignored test output.

- [ ] **Step 2: Use the branch-finishing workflow**

Use `superpowers:finishing-a-development-branch`. Present exact test results, commits, remaining phase blockers and the non-live operator handoff. Do not merge or activate services without the operator’s chosen integration path.

- [ ] **Step 3: Record the operational boundary**

The implementation is complete when the branch proves all code and fixture gates. The autonomous conveyor is operationally armed only after the real shadow period, drills, private canary and relevant signed promotion. Keep those two claims distinct in every report.
