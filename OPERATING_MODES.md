# Pulse Gaming Operating Modes

> **Authority boundary:** This is the canonical safety contract for repository operation. It does not arm a runtime or authorise a live action.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Operating modes, mutation authority, freezes and fail-closed gates |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `README_OPERATIONS.md for current mode authority; the older file remains historical guidance` |
| superseded_by | `none` |
| authoritative | `true` |

If expired, treat the document as **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Modes

| Mode | Purpose | External mutation | Human review |
|---|---|---|---|
| `LOCAL_PROOF` | Tests, local renders, dry-run packages, diagnostics and evidence generation | Forbidden | Not publication authority |
| `HUMAN_REVIEW` | Queue and inspect candidates for an operator decision | Forbidden unless a separate, exact action is explicitly authorised | Required |
| `LIVE_GUARDED` | Narrow, approved dispatch after all technical and human gates | Permitted only when every gate passes | Required for YouTube |

The default is `LOCAL_PROOF`. Unknown or contradictory mode values fail closed.

## `LIVE_GUARDED` prerequisites

The committed operating contract requires all of the following:

- `PULSE_OPERATING_MODE=LIVE_GUARDED`
- `AUTO_PUBLISH=true`
- `PULSE_GUARDED_LIVE_DISPATCH_ENABLED=true`
- `USE_JOB_QUEUE=true`
- `USE_SQLITE=true`
- an explicit primary instance
- a healthy, untripped kill switch
- no frozen secondary-platform automation flag
- a valid publication candidate, governed evidence and operator approval
- a platform policy that permits the proposed action

These are necessary conditions, not proof that a runtime is safe. A deployment must also demonstrate current commit parity, database health, scheduler ownership and platform confirmation.

## Action matrix

| Action | `LOCAL_PROOF` | `HUMAN_REVIEW` | `LIVE_GUARDED` |
|---|---:|---:|---:|
| Read source and local evidence | allowed | allowed | allowed |
| Run focused tests and build | allowed | allowed | allowed |
| Generate local proof media | allowed | allowed | allowed |
| Queue candidate for review | local evidence only | allowed | allowed |
| Mutate OAuth or tokens | forbidden by default | forbidden by default | only under a separate explicit operator procedure |
| Mutate production database | forbidden | forbidden | only through approved application transactions |
| Create a platform object | forbidden | forbidden | only after admission and platform policy pass |
| Retry after uncertain remote creation | forbidden | forbidden | forbidden; reconcile first |
| Change platform policy or weaken a gate | forbidden | forbidden | forbidden during an operational run |

## Frozen scope during stabilisation

The committed contract freezes new platforms, new verticals, finance or crypto expansion, new Studio generations, new affiliates, Discord economy work, autonomous engagement, broad auto-publishing and stack replacement.

Secondary automation flags are blocking contradictions. TikTok, Instagram, Facebook, X, Threads and Pinterest must not silently become automated because credentials exist.

## Approved and disabled production stack

| State | Services |
|---|---|
| Approved | ElevenLabs, Epidemic Sound, HyperFrames, FFmpeg |
| Disabled | HeyGen, Kokoro, MusicGen |

An approved service still requires current entitlement, provenance and asset-level evidence. This document does not verify any subscription or credential.

## Publication gate order

1. Verify the source and editorial facts.
2. approve the final script.
3. clear and hash every included media item.
4. produce and evaluate the standard renderer manifest.
5. pass technical and editorial QA.
6. record the operator’s identity, reason and exact story confirmation.
7. verify schedule window, idempotency, runtime contract and kill switch.
8. begin dispatch.
9. record platform object creation separately from platform confirmation.
10. reconcile uncertainty before any retry.

Only the actual control-tower evaluation may return `GREEN`. Documentation, tests or a dry-run package cannot.

## Kill switch

If either recognised kill-switch flag is tripped, live mutation must stop. During an incident:

- stop new manual dispatch attempts
- preserve current evidence
- identify whether a remote object may already exist
- route ambiguous cases to reconciliation
- follow [INCIDENT_RUNBOOK.md](INCIDENT_RUNBOOK.md)

## Evidence handling

Secrets must never appear in reports. Effective configuration reports may record presence, source class and a truncated hash only. Every status artefact must identify source commit, runtime commit, environment, scope, expiry and authority.
