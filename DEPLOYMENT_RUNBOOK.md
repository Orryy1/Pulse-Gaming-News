# Pulse Gaming Deployment Runbook

> **Authority boundary:** This procedure does not authorise a deployment. A public Railway deployment was observed read-only, but its commit differs from the release line and its build source, configuration and database remain incompletely verified.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Approved release preparation, deployment, rollback and post-deploy evidence |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `DEPLOYMENT_RUNBOOK.md at the source baseline for live guidance; LOCAL_DEPLOYMENT_RUNBOOK.md and older deployment notes remain historical references` |
| superseded_by | `none` |
| authoritative | `true` |

If expired, treat this runbook as **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Hard rule

Do not deploy, redeploy, restart, mutate environment variables, change volumes or migrate a production database without explicit operator approval naming the target environment and exact commit.

Do not deploy directly from a dirty working tree. Do not treat a passing local test or CI job as production readiness.

## Release record

Before any approved deployment, record:

- target provider, project, service and environment
- source branch and exact candidate commit
- expected runtime commit
- current runtime commit from read-only health evidence
- actual build authority
- database location class and current migration level
- scheduler owner and lease
- approved change set and rollback commit
- operator, approval time and maintenance window

At repository level, `railway.json`, `Dockerfile`, `Procfile` and `package.json` all describe `server.js` as the process entry point. `railway.json` declares Nixpacks while the Dockerfile declares a separate image build. Node 24 is used by CI and Node 22 by the Dockerfile. The actual public build path is **UNKNOWN / UNVERIFIED** and must be resolved before deployment.

The 2026-07-27 read-only health snapshot reported public Railway commit `2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10`, deployment `16d8879f-c4ed-4aef-b16c-a5e06aceed43`, scheduling and autonomous mode inactive and a non-persistent/ephemeral SQLite indicator. This does not equal the release worktree and is a hard pre-deploy reconciliation blocker.

## Pre-deploy gate

Use a clean checkout of the exact candidate:

```powershell
npm ci
npm run ops:agent-rules
npm test
npm run build
```

Then run the smallest relevant read-only or local-proof diagnostics for the change, including:

```powershell
npm run ops:publish-readiness
npm run ops:platform:status
npm run ops:render-health
```

The command implementations and effective mode must be reviewed before execution. A dry-run package is evidence only.

At the recorded source commit, `AGENTS.md` also names three unavailable preflight commands: `ops:next-publish-candidates`, `ops:platform-doctor` and `ops:goal-dry-run-publish`. Do not substitute a similarly named tool or claim those checks passed. Reconcile the command contract before release. The available `ops:publish-readiness`, `ops:control-room` and `ops:system:doctor` checks were reported as AMBER, AMBER and review, not `GREEN`.

Required evidence:

- clean source tree and reviewed diff
- CI result for the exact commit
- no secret or token material in source or artefacts
- focused tests for changed behaviour
- dashboard build
- migration and rollback review
- standard-renderer, rights and QA evidence for any publication candidate
- explicit unresolved-blocker list

## Database change gate

For a migration:

1. verify the committed migration list and checksums
2. prove clean-create and supported upgrade paths locally
3. identify the exact target database read-only
4. create and checksum an approved online backup
5. verify the backup can be opened and passes integrity checks
6. obtain explicit migration approval
7. apply through the approved runtime only
8. verify migration level, integrity and application health

This runbook did not perform a backup or inspect a production database.

## Deployment execution

Only after approval:

1. confirm the kill switch and publishing posture
2. freeze competing deploys and identify the single operator
3. deploy the exact commit through the identified build authority
4. capture provider deployment ID, build log and runtime start time
5. read `/api/health` and record the reported build metadata
6. verify the runtime commit equals the approved commit
7. verify one scheduler owner, lease and expected stabilisation profile
8. verify queue and database health without triggering publication
9. verify no unexpected jobs or platform actions were created

Do not enable live publication as part of a general code deploy. That is a separate, explicit operational decision under [OPERATING_MODES.md](OPERATING_MODES.md).

## Platform-specific verification

- **YouTube:** persist object ID before confirmation and verify public or scheduled state independently.
- **Facebook:** processing completion is not public success; require published/permalink evidence.
- **Instagram:** retain container status and error fields until public confirmation.
- **TikTok:** do not retry an uncertain or rejected post without reconciliation and current eligibility evidence.
- **All platforms:** never mask a failed primary media object with a successful fallback card.

## Rollback

Rollback is an approved deployment, not an improvised file replacement:

1. contain live mutation and preserve evidence
2. decide whether application rollback, configuration rollback or data recovery is needed
3. identify the last known verified commit
4. confirm database compatibility before changing application versions
5. deploy the approved rollback commit
6. re-run health, commit-parity, scheduler and queue checks
7. reconcile any dispatch that crossed the incident window

Do not reverse an applied migration by deleting or editing migration history. Use a reviewed forward repair unless a tested restoration procedure is explicitly approved.

## Post-deploy acceptance

Do not call production `GREEN` until current evidence proves:

- exact runtime commit
- healthy authenticated service identity
- expected database and migration level
- one scheduler owner and healthy lease
- no duplicate or stale publish jobs
- kill switch works
- guarded platform path remains closed unless intentionally armed
- first approved canary is confirmed end to end, if a canary was in scope

## Preserved historical guidance

- [LOCAL_DEPLOYMENT_RUNBOOK.md](LOCAL_DEPLOYMENT_RUNBOOK.md)
- [README_OPERATIONS.md](README_OPERATIONS.md)
- [ROLLBACK_RUNBOOK.md](ROLLBACK_RUNBOOK.md)
- [docs/production-cutover-playbook.md](docs/production-cutover-playbook.md)
- [docs/production-readiness-checklist.md](docs/production-readiness-checklist.md)

These files are retained for useful history but do not override this runbook.
