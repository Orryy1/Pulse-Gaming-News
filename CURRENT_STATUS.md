# Pulse Gaming Current Status

> **NOT PRODUCTION GREEN.** Read-only evidence proves runtime-commit divergence and multiple scheduler-owner risk. Production database integrity, platform authentication, live platform objects and live analytics remain unverified.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Phase 0 repository status and explicit evidence gaps |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `TONIGHT_STATUS_SNAPSHOT.md, LOCAL_MIGRATION_PHASE0_STATUS.md, PHASE1_MIRROR_STATUS.md and ad hoc status claims for current release decisions` |
| superseded_by | `none` |
| authoritative | `true` |

After `expires_at`, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS** and refresh from the actual target environment.

## Executive status

| Area | Status | Evidence boundary |
|---|---|---|
| Repository baseline | known | branch `release/pulse-v1`, commit shown above |
| Separate main checkout | observed divergent | `codex/epidemic-sound-full-integration` at `5dc164dc3469a4bc642fa6ca9498cc296f559198`, 80 dirty entries at the observation time |
| Working tree | documentation-only dirty | the code and test boundary is committed at the metadata SHA; only the canonical documents and Phase 0 evidence set remain uncommitted |
| Canonical documentation | created in this working tree | not committed by this documentation lane |
| Operating contract | committed | default fail-closed modes and platform freeze present |
| Renderer, rights and disclosure gates | committed | final source includes the governed renderer cutover, exact-subject controls, rights evidence and disclosure gates; no live candidate evaluated here |
| Editorial and brand contract | committed | final source includes the three editorial lanes, runtime bands, CTA policy, Pulse Gaming News copy and governed avatar assets; live channel state remains unverified |
| Controlled-experiment analytics | committed | migrations `021` and `022` plus evidence-bound ingestion, repository and retention-derivation support are in the final source; live data remains unverified |
| Local tests for final source commit | not run by this documentation lane | **UNKNOWN / UNVERIFIED** |
| CI for current candidate | not queried | **UNKNOWN / UNVERIFIED** |
| Operator command surface | inconsistent | `AGENTS.md` names `ops:next-publish-candidates`, `ops:platform-doctor` and `ops:goal-dry-run-publish`, but the final source has no matching package scripts or tool entry points |
| Available local operator checks | observed by the owning validation lane | `ops:publish-readiness` returned AMBER with zero database stories, unknown queue/media/render evidence and no published rows; `ops:control-room` returned AMBER; `ops:system:doctor` returned review |
| External branch protection and required checks | not queried | **UNKNOWN / UNVERIFIED** |
| Local running process | observed | PID `34536`, local `:3001`, start `2026-07-26 19:59:11` as reported by the host; timezone not independently verified |
| Local runtime health | observed divergent | commit `ec2ba4d98d3ee55f8c8999952cde5b378168e0c1`, scheduler active, autonomous mode active, queue/strict dispatch |
| Public runtime health | observed divergent | Railway commit `2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10`, deployment `16d8879f-c4ed-4aef-b16c-a5e06aceed43`, scheduler and autonomous mode inactive |
| Deployed equality with the release commit | mismatch observed | **RED** |
| Production database integrity | not inspected | **UNKNOWN / UNVERIFIED** |
| Scheduler owner and lease | local active indicator plus four Pulse-named Windows tasks; lease and task action ownership not proven | **RED / MULTIPLE-OWNER RISK** |
| OAuth and platform eligibility | not inspected | **UNKNOWN / UNVERIFIED** |
| Current public posts | untouched and not queried | **UNKNOWN / UNVERIFIED** |
| Live YouTube Analytics data | not queried | **UNKNOWN / UNVERIFIED** |
| Real 12-video and 30-day evidence programme | not observed | **UNKNOWN / UNVERIFIED** |
| PR 68 / PR 69 | enormous drafts; ancestry and path analysis proves PR 69 fully contains PR 68, but human supersession review and PR 69 slice reconstruction remain | **RED / NOT RELEASE CANDIDATES** |

## What the committed baseline establishes

- `LOCAL_PROOF`, `HUMAN_REVIEW` and `LIVE_GUARDED` operating modes exist.
- Live mutation fails closed without queue, SQLite, primary-instance, arm and kill-switch evidence.
- YouTube is the only primary human-reviewed stabilisation lane.
- Secondary-platform automation is frozen, disabled or manual.
- A durable publication lifecycle and exception states exist.
- Renderer evidence distinguishes standard `studio-v21` from non-publishable experimental work.
- Rights evidence is per-item, hash-bound and rejects attribution as permission.
- Synthetic-media disclosure requires an explicit operator decision.
- The editorial contract fixes three outward lanes, controlled runtime bands, selective CTA use and exact-subject first-frame requirements.
- Pulse Gaming News display copy and governed wordless avatar assets are tracked locally without changing the live channel.
- Migrations `001` through `022` are tracked at the source commit.
- A release-gate workflow exists in `.github/workflows/pulse-release.yml`.

Those are source facts, not proof that production has deployed or exercised them.

## Unresolved Phase 0 evidence

The following must be established before a production readiness claim:

1. reconcile the release, main-checkout, local-runtime and public-runtime commits
2. confirm provider project, service and build authority beyond the observed Railway health identity
3. inspect each Pulse-named Windows task action and every other publishing-capable process
4. establish one scheduler owner, process ID, start time and lease
5. production database path, applied migrations, integrity checks and verified backup
6. every status/platform-ID conflict
7. human approval of PR 68 supersession and release-slice provenance for PR 69’s later work
8. current CI run for the exact candidate plus branch-protection state
9. `yt-analytics.readonly` availability and a small validated read-only import
10. current platform account identity, scopes, eligibility and confirmation behaviour
11. a real 12-video controlled sample and completed 30-day evidence window
12. reconcile the three documented but absent operator commands or correct `AGENTS.md`
13. a clean, reviewed and committed documentation hand-off plus current CI evidence

## Release posture

- Do not merge a giant ambiguous branch.
- Do not tag a forensic archive until the exact PR head is identified and approval is given.
- Do not deploy or enable live publishing from this documentation task.
- Treat the observed provenance and ownership mismatch as a hard stop until reconciled.
- Do not mutate OAuth, tokens, provider configuration or production data.
- Keep the current public upload untouched.
- Continue reconstructing the release as reviewable thematic slices.

## Phase 0 report set

- [runtime_provenance_report.md](docs/stabilisation/phase-0/runtime_provenance_report.md)
- [publishing_process_inventory.md](docs/stabilisation/phase-0/publishing_process_inventory.md)
- [pr68_pr69_overlap_report.md](docs/stabilisation/phase-0/pr68_pr69_overlap_report.md)
- [release_pulse_v1_slice_plan.md](docs/stabilisation/phase-0/release_pulse_v1_slice_plan.md)
- [database_state_integrity_report.md](docs/stabilisation/phase-0/database_state_integrity_report.md)
- [scheduler_ownership_report.md](docs/stabilisation/phase-0/scheduler_ownership_report.md)
- [analytics_readiness_report.md](docs/stabilisation/phase-0/analytics_readiness_report.md)
- [ci_implementation_plan.md](docs/stabilisation/phase-0/ci_implementation_plan.md)
- [documentation_consolidation_plan.md](docs/stabilisation/phase-0/documentation_consolidation_plan.md)
- [current_status_proposal.md](docs/stabilisation/phase-0/current_status_proposal.md)
- [report_index.json](docs/stabilisation/phase-0/report_index.json) — machine-readable inventory and verification state
- [audit_implementation_matrix.json](docs/stabilisation/release-slices/audit_implementation_matrix.json) — machine-readable mapping of 139 audit controls to local, external, time-bound or deferred status

The proposal report is non-authoritative. This file is the canonical repository status snapshot, within its stated scope and expiry.
