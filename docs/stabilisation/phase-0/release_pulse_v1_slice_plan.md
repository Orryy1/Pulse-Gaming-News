# Phase 0 `release/pulse-v1` Slice Plan

> **PLANNING ARTEFACT ONLY.** Slice status describes repository evidence, not deployment. PR 68 and PR 69 provenance remains **UNKNOWN / UNVERIFIED**.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Thematic reconstruction and verification plan for the clean Pulse v1 release line |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `CHERRY_PICK_PLAN.md for the stabilisation release structure; the older plan remains historical` |
| superseded_by | `none` |
| authoritative | `false` |

After expiry, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Objective

Build one reviewable release from small, independently proven slices. Preserve useful work from large branches without merging branch ambiguity, generated artefacts or unrelated features.

## Slice rules

Each slice must:

- have one clear responsibility
- identify source commits or PR provenance
- exclude unrelated generated output and secrets
- include focused tests
- produce machine-readable proof where the behaviour calls for it
- pass the closest integration tests
- avoid weakening gates
- state whether it mutates database schema or runtime behaviour
- be reversible or have an explicit forward-repair path
- be reviewed before the next dependent slice is promoted

## Proposed sequence

| Slice | Responsibility | Repository evidence at generation | Promotion gate |
|---|---|---|---|
| 01 | configuration, dotenv precedence and runtime provenance | historical local slice evidence exists | clean tests, exact runtime metadata contract, no secrets |
| 02 | SQLite jobs, lifecycle, reconciliation, leases and backup proof | migrations through `020` and historical local slice evidence exist | clean upgrade tests, integrity proof, reconciliation cases |
| 03 | editorial verification, lanes, scripts, brand and topicality | committed at the final source boundary | focused editorial tests, source evidence, public-copy review and live profile kept unchanged |
| 04 | standard renderer, rights ledger and synthetic disclosure | committed at the final source boundary | renderer/rights/admission tests plus representative governed proof |
| 05 | controlled read-only analytics and experiments | migrations `021` and `022` plus evidence-bound analytics and retention support are committed | no OAuth mutation, schema tests, validated sample mapping |
| 06 | end-to-end production integration | scene, card, processor, CLI and Studio integration are committed at the final source boundary | exact-subject render, final audio/timestamps, full manifest and QA |
| 07 | canonical documentation and Phase 0 status | this documentation working tree | metadata, links, supersession and review |
| 08 | CI, deployment and operational acceptance | committed workflow exists | clean CI, branch protection, exact deploy authority and rollback rehearsal |

“Exists” does not mean ready. Historical proof at an older commit must be re-run against the final candidate.

## Dependency order

```text
01 configuration/provenance
        |
        v
02 durable data and reconciliation
        |
        +----------+
        v          v
03 editorial   04 renderer/rights
        \          /
         v        v
       06 production integration
              |
       05 analytics can ingest
              |
       07 documentation
              |
       08 CI/deployment acceptance
```

Analytics schema work may be developed independently but should not be promoted before the durable data contract it extends is stable.

## PR 68 / PR 69 handling

Read-only GitHub metadata identifies two open drafts:

- PR 68: 522 commits and 901 changed files, reported head `9e23fdb3`
- PR 69: 1,348 commits and 1,277 changed files, reported head `cfe609ae`

Both are enormous histories, not release candidates. Their reported `clean` mergeable state is mechanical metadata, not a safety or review verdict. Read-only ancestry and path analysis proves PR 69 contains PR 68 completely: PR 68 has zero unique commits or paths, while PR 69 has 826 later commits and 376 additional paths. The separate main checkout is another 145 commits beyond the reported PR 69 head.

Therefore:

- do not merge either giant PR
- permit PR 68 supersession only after a human accepts the observed containment evidence
- do not create a forensic tag from an abbreviated SHA
- treat PR 69’s later work as the only giant-branch salvage surface, then classify it into small slices

Map every retained PR 69 change to exactly one slice. Preserve source provenance in the slice description.

## Generated artefacts

Do not commit bulk render output or volatile status reports as a substitute for CI. Retain small deterministic fixtures only where a test needs them. Publish larger proof bundles as CI artefacts with source and runtime metadata.

## Release acceptance

The release branch is ready for deployment review only when:

- working tree is clean
- exact commit has passing required CI
- no unresolved high-risk review findings remain
- schema and backup evidence are current
- one runtime and scheduler owner are known
- controlled publishing is still fail closed
- operator reviews the exact release diff and deployment plan

This plan does not assert any of those conditions currently hold.
