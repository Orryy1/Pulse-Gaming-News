# Phase 0 CI Implementation Plan

> **CURRENT CI RUN UNKNOWN.** A committed workflow exists, but no GitHub run, branch-protection rule or required-check status was queried.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Existing release-gate workflow assessment and proposed CI acceptance controls |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `none — first canonical Phase 0 CI plan` |
| superseded_by | `none` |
| authoritative | `false` |

After expiry, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Existing committed workflow

`.github/workflows/pulse-release.yml` runs on pull requests to `main` and `release/pulse-v1`, pushes to `release/pulse-v1` and manual dispatch.

Static inspection found:

- `contents: read` permissions
- concurrency cancellation by workflow and ref
- pinned checkout and setup-node action SHAs
- Node 24
- `npm ci`
- focused configuration, provenance, report-governance and secret-scan tests
- agent-rules validation
- secret scan
- full Node test suite
- Vite dashboard build
- 45-minute timeout

No workflow was triggered or queried. The code and test boundary is committed at the metadata SHA, while this documentation hand-off remains uncommitted. Neither state is evidence of a passing required GitHub run.

CI should also validate that every operator command named in `AGENTS.md` resolves to a package script and an existing tool entry point. The final source currently fails that contract for `ops:next-publish-candidates`, `ops:platform-doctor` and `ops:goal-dry-run-publish`. No check should be marked passed by substituting another command.

## Gaps not proven

| Control | State |
|---|---|
| Workflow file present | verified in source |
| Exact source commit has passing run | `UNKNOWN / UNVERIFIED` |
| `release-gate` required for merge | `UNKNOWN / UNVERIFIED` |
| Branch protection blocks direct push | `UNKNOWN / UNVERIFIED` |
| Required approving reviews | `UNKNOWN / UNVERIFIED` |
| CODEOWNERS for safety-critical paths | `UNKNOWN / UNVERIFIED` |
| Dependency update policy | `UNKNOWN / UNVERIFIED` |
| CI artefact retention | `UNKNOWN / UNVERIFIED` |
| Deployment environment approval | `UNKNOWN / UNVERIFIED` |
| Post-deploy commit-parity check | not established |
| Clean production smoke test | not established |

## Phase 1 implementation plan

### 1. Protect the release line

- require `release-gate`
- block force pushes and branch deletion
- require reviewed pull requests
- dismiss stale approvals after material changes
- restrict direct pushes
- require conversations resolved

These are provider mutations and need explicit operator approval.

### 2. Make source proof deterministic

- retain `npm ci` from the lockfile
- pin the supported Node and external-action versions
- record source commit and tool versions in artefacts
- run focused tests before the full suite
- keep secret scan output value-free
- verify the dashboard build

Resolve the current Node 24 CI versus Node 22 Dockerfile mismatch through an approved runtime decision.

### 3. Add governed artefacts

Upload, rather than commit, bounded evidence for:

- effective non-secret configuration
- migration inventory and checksums
- lifecycle/reconciliation coverage
- renderer and rights contract tests
- docs metadata and link validation
- test summary and build manifest

Artefacts must carry the standard provenance fields and expiry.

### 4. Separate deploy from CI

A passing workflow must not auto-arm live publication. Deployment should target an exact saved candidate, require environment approval and verify runtime commit after deployment. Live guarded mode is a separate operator decision.

### 5. Add post-deploy read-only proof

After an approved deployment:

- query authenticated health
- compare runtime and source commits
- record provider deployment ID
- inspect scheduler owner and queue health
- verify no unexpected platform action

Do not run a public canary unless explicitly included in approval.

## Documentation validation

The canonical documentation set should be checked for:

- all ten expected files
- required provenance keys
- valid relative links
- explicit unknown markers for unverified runtime facts
- no unqualified production `GREEN` claim

This task uses a read-only one-off validation rather than adding a new test unless the repository owner later wants the rule enforced in CI.

## Exit criteria

CI is ready only when a clean committed candidate has a passing required run and the provider confirms branch protection. That condition is currently **UNKNOWN / UNVERIFIED**.
