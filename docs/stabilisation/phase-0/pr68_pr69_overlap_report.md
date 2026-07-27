# Phase 0 PR 68 / PR 69 Overlap Report

> **RED — TWO ENORMOUS DRAFTS, WITH PR 68 CONTAINED BY PR 69.** Read-only Git ancestry and path analysis proves no observed commit or changed path is unique to PR 68. Human review is still required before supersession.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Read-only PR 68/69 identity, ancestry, patch-equivalence, changed-path and supersession analysis |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `none — first Phase 0 overlap report with observed PR metadata` |
| superseded_by | `none` |
| authoritative | `false` |

After expiry, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Observed GitHub metadata

Metadata was observed read-only on 2026-07-27. The abbreviated SHAs below are exactly the precision supplied by that observation.

| Item | [PR 68](https://github.com/Orryy1/Pulse-Gaming-News/pull/68) | [PR 69](https://github.com/Orryy1/Pulse-Gaming-News/pull/69) |
|---|---|---|
| state | open draft | open draft |
| title | `Reconcile V4 governance cutover work` | `[codex] restore governed publish readiness and narration cadence` |
| base | `main@2c7f47c5` | `main@2c7f47c5` |
| reported head | `codex/github-reconciliation-v4-cutover@9e23fdb3` | `codex/epidemic-sound-full-integration@cfe609ae` |
| mergeable state | `clean` | `clean` |
| commits | 522 | 1,348 |
| changed files | 901 | 1,277 |
| additions | 249,610 | 522,756 |
| deletions | 4,023 | 6,197 |
| last updated | 2026-05-27 | 2026-07-15 |

GitHub’s `clean` mergeable state means no current mechanical merge conflict was reported. It does not mean reviewed, safe, current or suitable as a release candidate.

## Divergent checkout evidence

The main checkout was observed on branch `codex/epidemic-sound-full-integration` at `5dc164dc3469a4bc642fa6ca9498cc296f559198` with 80 dirty entries. Local ancestry proves reported PR 69 head `cfe609ae` is its ancestor and the checkout is 145 commits ahead (`0 / 145`).

This explains the branch-name relationship but does not make the dirty checkout equal to PR 69 or safe to use as a release candidate.

The release worktree is a separate reconstructed line and is recorded by this report’s final `source_commit_sha`.

## Overlap result

| Question | Finding |
|---|---|
| Merge base | PR 68 head `9e23fdb3`; it is an ancestor of PR 69 head `cfe609ae` |
| Commit-level unique counts | PR 68: `0`; PR 69: `826` |
| `git rev-list --left-right --count` | `0 / 826` |
| Cherry-equivalent unique counts | `0 / 826` |
| PR 68 main-relative changed paths | 901 |
| PR 69 main-relative changed paths | 1,277 |
| PR 68 paths absent from PR 69 | `0` |
| PR 69 paths absent from PR 68 | `376` |
| Work unique to PR 68 in observed refs | none |
| Work unique to PR 69 in observed refs | 826 commits and 376 changed paths, before semantic/noise review |
| Work already reconstructed on `release/pulse-v1` | not mapped to PR provenance |
| Safe supersession decision | PR 68 may be superseded after human review confirms the observed refs and retained provenance |

Because PR 69 contains PR 68 by ancestry and path set, no content or commit is unique to PR 68 in the observed refs. This is stronger than file-name similarity, but it does not make either draft reviewable or release-ready.

## Required read-only reconciliation

1. have a human verify the observed PR refs and containment result
2. classify PR 69’s 826 later commits and 376 additional paths by responsibility
3. separate valid work from generated/noise content
4. map retained work to the small release slices
5. record source PR and commit provenance for every reconstructed change
6. close or mark PR 68 superseded only after the containment evidence is accepted

## Forensic archive

The audit proposed tagging PR 69’s head as a forensic archive candidate. No tag was created. A tag must not be created from an abbreviated SHA or without explicit operator approval.

## Decision

Both PRs are enormous draft histories, not release candidates. PR 69 fully contains the observed PR 68 history and changed-path set, so no PR 68 work needs a separate salvage lane. Human review must accept that evidence before PR 68 is closed or marked superseded. Do not merge either merely because GitHub reports a clean mechanical merge state.
