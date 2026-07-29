# Pulse Gaming Incident Runbook

> **Authority boundary:** Canonical containment and reconciliation procedure. It does not prove an incident is resolved or authorise a destructive action.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Detection, containment, evidence capture, reconciliation, recovery and closure |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `ROLLBACK_RUNBOOK.md and individual historical incident reports for current incident procedure; those records remain available` |
| superseded_by | `none` |
| authoritative | `true` |

If expired, treat this runbook as **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## First response

1. Stop new manual publication attempts.
2. Trip the configured kill switch when live dispatch may continue.
3. Preserve logs, request IDs, story IDs, media hashes, platform IDs and timestamps.
4. Identify the exact runtime commit, process and scheduler owner read-only.
5. Classify whether a remote platform object may already exist.
6. Do not retry an uncertain post-create action.
7. Assign one incident commander and one evidence timeline.

Never delete logs, rewrite lifecycle history or rotate credentials before preserving the evidence needed to understand exposure, unless immediate credential revocation is necessary to contain active misuse.

## Severity

| Severity | Examples | Initial posture |
|---|---|---|
| SEV-1 | uncontrolled publishing, credential exposure, destructive database event, repeated duplicate public posts | immediate kill switch and operator escalation |
| SEV-2 | ambiguous remote creation, wrong public media or metadata, scheduler duplication, rights complaint | stop affected lane and reconcile |
| SEV-3 | failed local render, blocked candidate, analytics delay, non-public dashboard defect | preserve evidence and repair in `LOCAL_PROOF` |

Severity does not authorise a broader action than necessary.

## Evidence bundle

Capture:

- incident ID, reporter and UTC start time
- environment, provider, service and process
- source commit and runtime commit
- runtime start time and deployment ID
- scheduler lease owner and active schedules
- queue rows and job-run attempts
- story, channel, platform and operation key
- local lifecycle and public-state records
- platform object ID, if any
- request and response metadata with secrets redacted
- final script, media SHA-256, renderer manifest, rights ledger and QA hash
- operator decisions and timestamps

Mark unavailable facts `UNKNOWN / UNVERIFIED`. Do not fill gaps with inference.

## Publication uncertainty

| Observed point | Safe action |
|---|---|
| failure proven before remote create | preserve failure, repair and create a new approved attempt |
| request sent, no reliable response | enter `RECONCILIATION_REQUIRED`; query remote state read-only |
| remote object ID returned, confirmation failed | persist ID, do not retry create, reconcile |
| object confirmed but metadata update failed | preserve object, repair metadata under explicit approval |
| public object has QA or rights issue | enter incident state, decide private/retract action explicitly |

Platform object creation, confirmation and publication are separate events.

## Common incident playbooks

### Duplicate or excessive publishing

- trip kill switch
- identify every scheduler, worker, Windows task and manual process capable of dispatch
- preserve leases and queue rows
- disable only through an approved containment action
- reconcile remote objects and idempotency keys
- restore with exactly one scheduler owner

### Wrong script, title or media

- stop the affected lane
- preserve the public URL and exact published artefacts
- assess advertiser, factual, privacy and rights impact
- obtain explicit approval for metadata correction, privacy change or retraction
- require full re-review before replacement

### Rights complaint

- preserve the claim and asset evidence
- stop reuse of the affected asset
- inspect licence, permission, transformation and attribution records
- escalate legal uncertainty
- do not rely on “fair use everywhere” or competitor behaviour

### Credential exposure

- contain access through the provider’s approved revocation path
- do not print or copy the credential into incident records
- identify affected permissions, use and time range
- rotate only the exposed scope
- update secret storage and verify old credentials are unusable

### Database integrity concern

- stop writers when necessary
- preserve the original database and WAL/SHM files
- take an approved online backup if safe
- run read-only integrity checks against a copy
- reconcile application and remote platform state
- restore only from a verified backup under explicit approval

## Recovery

Recovery requires:

- root cause and affected interval identified
- exact repaired commit and configuration recorded
- focused regression proof
- database and queue reconciliation
- scheduler ownership proof
- platform confirmation for affected objects
- kill-switch test
- operator sign-off

Use [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md) for a release or rollback. Do not resume live publishing merely because the HTTP health endpoint returns `ok`.

## Closure

An incident may be closed only when remaining unknowns and accepted risks are explicit. A `GREEN` claim requires fresh evidence from the actual runtime and target platform. This documentation-only pass generated no such evidence.

Historical incident context remains in:

- [PRODUCTION_RENDER_REGRESSION_INCIDENT_REPORT.md](PRODUCTION_RENDER_REGRESSION_INCIDENT_REPORT.md)
- [PRODUCTION_RENDER_REGRESSION_DIAGNOSIS.md](PRODUCTION_RENDER_REGRESSION_DIAGNOSIS.md)
- [RENDER_FALLBACK_ROOT_CAUSE.md](RENDER_FALLBACK_ROOT_CAUSE.md)
- [ROLLBACK_RUNBOOK.md](ROLLBACK_RUNBOOK.md)
