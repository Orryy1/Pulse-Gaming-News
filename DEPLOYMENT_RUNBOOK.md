# Pulse Gaming Deployment Runbook

> **Authority boundary:** This procedure does not authorise a deployment, database migration, queue reconciliation, OAuth change or platform post. Every mutating step requires the exact authority and evidence named below.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T10:06:00.000Z` |
| source_commit_sha | `4e1a632f8c232b56a74b79da30e603746d0100d9` |
| runtime_commit_sha | `NONE - old local origin contained; Railway observation-only runtime remains at 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus named read-only and containment evidence in CURRENT_STATUS.md` |
| scope | `Approved release preparation, migration, queue reconciliation, local runtime cutover, rollback and acceptance` |
| expires_at | `2026-08-03T10:06:00.000Z` |
| supersedes | `DEPLOYMENT_RUNBOOK.md at ed2745dd2cbeeb179ab54d47b8d380304baaf9e5; LOCAL_DEPLOYMENT_RUNBOOK.md and older notes remain historical` |
| superseded_by | `none` |
| authoritative | `true` |

If expired, treat this runbook as **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Current containment baseline

Before any new cutover, preserve these facts:

- `PulseGaming-LiveWatchdog-Supervisor` and `PulseGaming-OAuthUptime` are disabled.
- The old local runtime and publisher worker family are stopped and port `3001` has no listener.
- `https://pulse.orryy.com/api/health` returns HTTP `502`, which is the intended fail-closed public state while no approved local origin exists.
- Railway deployment `16d8879f-c4ed-4aef-b16c-a5e06aceed43` remains observation-only at old commit `2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10`; it is not the replacement publishing owner.
- Do not restart, re-enable or repurpose any legacy task as part of the new cutover.

## Hard rules

- Use a dedicated clean checkout of an exact reviewed commit.
- Record the operator, change window, candidate commit, target database and rollback decision.
- Keep `HUMAN_REVIEW`, YouTube-only stabilisation, both publication arms off and the kill switch tripped during runtime cutover.
- Do not expose `.env`, token files or credential values in logs or evidence.
- Do not deploy and enable publication in one undifferentiated change.
- Do not treat tests, a dry-run package or policy `PASS` as production `GREEN`.

## Release record

Record before any approved change:

- source branch, exact candidate commit and expected runtime commit
- CI run and required-check result for that exact commit
- target provider, project, service and environment
- database path, applied migration level and checksum state
- verified backup ID, path, SHA-256 and restore result
- scheduler owner and primary lease state
- cutover ID, operator ID and maintenance-window ID
- current platform policy, kill-switch state and publish-arm state
- rollback commit or forward-repair decision

PR #68 was closed as superseded, not merged. PR #69 remains an open forensic draft and is preserved by `archive/pr69-forensic-2026-07-27` at `cfe609ae1b53b2a13ac1af1ae97ae4a0abb4ac48`. Neither is deployment authority.

## Source and CI gate

From a clean checkout of the exact candidate:

```powershell
npm ci
npm run ops:agent-rules
npm test
npm run build
npm run docs:doctor
```

Then run the release preflights:

```powershell
npm run ops:next-publish-candidates
npm run ops:platform-doctor
npm run ops:goal-dry-run-publish
npm run ops:publish-readiness
npm run ops:platform:status
npm run ops:render-health
```

All three commands previously described as missing now exist. A real read-only run against `D:\pulse-data\pulse.db` produced evidence under `D:\pulse-data\cutover-proof\preflight-before-migration`:

- `next_publish_candidates`: `HOLD`, scheduler not ready and publication not authorised
- `platform_doctor`: policy inspection `PASS`, but all seven platforms unpublishable and publication not authorised
- `goal_dry_run_publish`: `HOLD`, package not ready, scheduler not ready, no uploader entered and no external object created

Repeat them at the exact deployment candidate after database reconciliation. Never reuse the old verdict as current readiness evidence.

The full operator command contract is not reconciled. Thirteen render, platform-pack and repair command names in `AGENTS.md` still lack matching npm scripts at this source boundary. [CURRENT_STATUS.md](CURRENT_STATUS.md) lists them. Resolve and test that command surface before using the documented repair flow to build a production candidate.

## Database safety baseline

The named production database is `D:\pulse-data\pulse.db`. A read-only inspection reported:

- latest applied migration `020_stabilisation_governance.sql`
- `quick_check=ok`
- `integrity_check=ok`
- zero foreign-key violations

The verified online backup is:

- database: `D:\pulse-data\backups\pulse_2026-07-27T09-20-24-950Z.db`
- verification: `D:\pulse-data\backups\pulse_2026-07-27T09-20-24-950Z.db.verification.json`
- size: `232570880` bytes
- SHA-256: `086f765148e4a74765a05b4beb2a55f4605a5aac7dd2a9ca6a742782a8dfaf41`

Restore evidence is:

- restored copy: `D:\pulse-data\restore-rehearsals\pulse_2026-07-27T09-20-24-950Z.restore.db`
- restore report: `D:\pulse-data\restore-rehearsals\pulse_2026-07-27T09-20-24-950Z.restore.db.rehearsal.json`
- migration report: `D:\pulse-data\restore-rehearsals\pulse_2026-07-27T09-20-24-950Z.restore.db.migration-rehearsal.json`

The initial restored copy matched the backup hash and passed integrity checks. The rehearsal then applied migrations `021`, `022` and `023` to that copy only, reached migration `023` and passed final integrity checks. Production remains at `020`.

The online-backup verification sidecar is source evidence. The cutover reconciler separately requires a current `pulse-cutover-backup-evidence-v1` record with verified operator, restore and source-database fields. Do not relabel the existing sidecar or bypass the reconciler's evidence contract.

## Production migration gate

Migrations `021` through `023` may be applied only when:

1. the exact release candidate has passed review and CI
2. the production database still identifies as the named file and still passes integrity checks
3. applied migration checksums match source, including the historical checksum for `020`
4. a fresh approved backup is complete, checksummed and restore-tested
5. competing runtimes and database writers remain stopped
6. the operator has approved the exact target, commit and change window
7. the approved migration tool applies the forward migrations without editing migration history
8. a read-only post-check proves migration `023`, required tables and columns, application boot compatibility and database integrity

Do not start the governed runtime while its clean checkout has pending migrations or a checksum mismatch. The supervisor intentionally refuses that state.

## Queue and schedule reconciliation

`tools/stabilisation-cutover-reconcile.js` is the only cutover surface for the currently stranded jobs and schedule drift. It is read-only by default and writes JSON plus Markdown plans.

Its intended terminal schedule is exactly:

| name | cron | timezone | platform |
|---|---|---|---|
| `publish_morning` | `0 9 * * *` | UTC | YouTube |
| `publish_primary` | `0 19 * * *` | UTC | YouTube |

It must leave secondary platforms frozen, quarantine unsafe publish debt, avoid fabricating a scheduler lease and emit an audit record. Apply mode requires all blockers to be clear, exact source/runtime commit parity, an approved backup-evidence record, `HUMAN_REVIEW`, a matching cutover confirmation and the required operator environment.

Run a read-only plan first:

```powershell
node tools/stabilisation-cutover-reconcile.js `
  --database D:\pulse-data\pulse.db `
  --cutover-id <approved-cutover-id> `
  --source-commit-sha <candidate-sha> `
  --runtime-commit-sha <candidate-sha> `
  --backup-evidence <approved-cutover-evidence.json> `
  --out-dir <evidence-directory>
```

Review the complete plan and blockers before an independently authorised invocation adds `--apply --confirm-cutover-id <approved-cutover-id>`. Do not improvise SQL.

## Governed local runtime cutover

Follow [docs/stabilisation/windows-local-runtime-cutover.md](docs/stabilisation/windows-local-runtime-cutover.md). The implemented supervisor:

- requires a dedicated clean checkout at the exact expected commit
- opens SQLite read-only for preflight and refuses pending or mismatched migrations
- reserves port `3001` through receipt-bound ownership
- enforces `PULSE_OPERATING_MODE=HUMAN_REVIEW`
- enforces YouTube-only stabilisation and `stabilisation_30d`
- forces `AUTO_PUBLISH=false` and guarded live dispatch off
- keeps both kill-switch flags tripped
- disables secondary-platform, browser-fallback and token-maintenance automation
- verifies `/api/health` before retaining the process

`PulseGaming-Stabilisation-Runtime` is not installed at this snapshot. `plan` and `status` are read-only. Lifecycle actions are dry runs unless both `--apply` and `--confirm SAFE_HUMAN_REVIEW_RUNTIME` are supplied.

Do not restore the custom domain until the replacement runtime reports the exact approved commit, local-primary identity, SQLite and durable queue health, `HUMAN_REVIEW` and both publish arms off.

## Analytics gate

The read-only audit under `D:\pulse-data\cutover-proof\youtube-analytics-baseline` mapped five unique published YouTube video IDs to five story records. It also proved the remaining blockers:

- live `yt-analytics.readonly` scope is missing or unrecorded
- all five publication timestamps lack proven timezone provenance
- no YouTube Analytics API query was run
- historical platform counters are not an Analytics substitute

Any reauthorisation is a separate explicit OAuth change. After it is approved, request only the required read-only scope, verify the channel identity, collect a bounded five-video sample and preserve query parameters and snapshot times. Do not create or modify a YouTube object during analytics verification.

## Post-cutover acceptance

Do not call production `GREEN` until current evidence proves:

- exact source, runtime and public-health commit parity
- migration `023` and healthy database integrity
- one scheduler owner and one healthy primary lease
- exactly two enabled YouTube publish windows
- no duplicate, stale or uncertain publish jobs
- kill switch and guarded dispatch remain closed
- secondary-platform automation remains off
- a current candidate has complete source, render, rights, originality, disclosure, QA and explicit human-review evidence
- the first in-scope canary, if separately authorised, is confirmed end to end

The 12-video experiment and 30-day and 90-day gates cannot be claimed in advance.

## Rollback

1. trip the kill switch and contain the governed task through its receipt-bound `stop` command
2. preserve logs, queue state, database evidence and any platform uncertainty
3. decide whether the safe action is application rollback, forward migration repair or verified database restoration
4. confirm schema compatibility before changing the application commit
5. use the exact reviewed rollback path
6. repeat commit, database, scheduler, queue and public-health checks
7. reconcile any platform dispatch that crossed the incident window before retrying

Never edit or delete applied migration history. Prefer a reviewed forward repair unless a tested restoration is explicitly authorised.

## Preserved historical guidance

- [LOCAL_DEPLOYMENT_RUNBOOK.md](LOCAL_DEPLOYMENT_RUNBOOK.md)
- [README_OPERATIONS.md](README_OPERATIONS.md)
- [ROLLBACK_RUNBOOK.md](ROLLBACK_RUNBOOK.md)
- [docs/production-cutover-playbook.md](docs/production-cutover-playbook.md)
- [docs/production-readiness-checklist.md](docs/production-readiness-checklist.md)

These files are retained for useful history but do not override this runbook.
