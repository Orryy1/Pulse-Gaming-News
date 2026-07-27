# Phase 0 Documentation Consolidation Plan

> **REPOSITORY PLAN, NOT RUNTIME EVIDENCE.** The canonical set has been prepared in this working tree. It is not committed by this documentation lane.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Canonical-document structure, supersession, archival and validation plan |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `none — first Phase 0 consolidation plan` |
| superseded_by | `none` |
| authoritative | `false` |

After expiry, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Problem

The repository contains many useful audits, status snapshots, render reports and operational notes created at different times. Without explicit supersession and expiry, a reader can mistake old evidence for the current release state.

The corrective action is not to delete history. It is to reduce the live reading surface and mark authority clearly.

## Canonical live set

| Document | Responsibility |
|---|---|
| `README.md` | entry point and documentation index |
| `ARCHITECTURE.md` | component and lifecycle boundaries |
| `OPERATING_MODES.md` | mutation authority and safety modes |
| `DATA_MODEL.md` | durable schema and invariants |
| `CONTENT_STANDARD.md` | editorial and audience-quality policy |
| `MEDIA_AND_RIGHTS.md` | provenance, rights, transformation and disclosure |
| `PLATFORM_MATRIX.md` | platform policy versus live-state evidence |
| `DEPLOYMENT_RUNBOOK.md` | approved deployment and rollback |
| `INCIDENT_RUNBOOK.md` | containment and reconciliation |
| `CURRENT_STATUS.md` | one expiring release-status snapshot |

All ten were created or refreshed in this working tree. No historical document was deleted or moved.

`docs/codex-main-goal.md` is retained as a concise compatibility contract because `AGENTS.md` uses that stable path. It points to the ten canonical documents and does not create a second runtime-status authority.

## Provenance contract

Every generated report and current-status document must carry:

- `generated_at`
- `source_commit_sha`
- `runtime_commit_sha`
- `environment`
- `scope`
- `expires_at`
- `supersedes`
- `superseded_by`
- `authoritative`

Unknown values must remain visibly `UNKNOWN / UNVERIFIED`. On expiry, readers must see:

> **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**

Authority must be scoped. A repository contract cannot be authoritative for a runtime.

## Supersession policy

- Canonical docs may supersede older guidance while retaining links to it.
- `CURRENT_STATUS.md` is the only live status snapshot.
- Phase reports are evidence appendices and normally `authoritative: false`.
- A superseded document should link forward when deliberately archived.
- Never rewrite an old report to make its historical claim appear current.

## Archive policy

Architectural decisions should go under:

```text
docs/adr/
```

Curated historical reports should move under:

```text
docs/archive/YYYY-MM/
```

Moves should occur in a dedicated, reviewed change with a link map so inbound references are not silently broken. Bulk machine output should normally be retained as CI artefacts, not committed.

## Preserved historical entry points

The new `README.md` links to useful older material including:

- `README_OPERATIONS.md`
- `PULSE_SYSTEM_MAP.md`
- `STUDIO_V2_ARCHITECTURE.md`
- `STUDIO_V21_BASELINE.md`
- `PLATFORM_STATUS.md`
- `LOCAL_DEPLOYMENT_RUNBOOK.md`
- `ROLLBACK_RUNBOOK.md`
- forensic and production-readiness audits under the repository root and `docs/`

There was no root `README.md` at the source baseline, so no previous README content was overwritten.

## Maintenance workflow

1. Update the relevant canonical contract in the same change as behaviour.
2. Regenerate `CURRENT_STATUS.md` only from fresh evidence.
3. Set a short expiry for operational claims.
4. Link durable machine artefacts by commit and run ID.
5. Run metadata and link validation.
6. Review supersession fields.
7. Archive replaced reports in a separate, traceable change.

## Validation plan

Read-only validation for this lane should confirm:

- exact canonical and Phase 0 file lists
- all nine metadata keys in every file
- relative Markdown links resolve
- no unqualified production `GREEN` assertion
- `git diff --check` passes for documentation paths
- only documentation files were changed by this lane
- `report_index.json` parses and inventories the exact ten canonical documents and ten required reports

No new source test is necessary for this one-off documentation task. A future CI slice may promote the checks into the existing report-governance or docs-doctor system.

## Decision

Adopt the ten-file set as the live documentation estate after review. Preserve all older material until a separate archive change proves links and ownership.
