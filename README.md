# Pulse Gaming

> **Authority boundary:** This is the canonical repository entry point. It describes the governed system and current cutover evidence at the source boundary below. It does not authorise deployment or publication.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T10:06:00.000Z` |
| source_commit_sha | `4e1a632f8c232b56a74b79da30e603746d0100d9` |
| runtime_commit_sha | `NONE - old local origin contained; Railway observation-only runtime remains at 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus named read-only and containment evidence in CURRENT_STATUS.md` |
| scope | `Canonical repository orientation, authority boundaries and documentation index` |
| expires_at | `2026-08-03T10:06:00.000Z` |
| supersedes | `README.md at ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| superseded_by | `none` |
| authoritative | `true` |

If `expires_at` has passed, treat the status statements as **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS** until refreshed.

Pulse Gaming is a Node.js CommonJS media system with a React/Vite control surface. It discovers gaming stories, builds governed editorial and media evidence, renders platform-native assets and can dispatch approved publications through guarded platform adapters. A rendered file is not automatically publishable and a configured adapter is not evidence that a platform is live.

The repository's compatibility operating goal is [docs/codex-main-goal.md](docs/codex-main-goal.md). Detailed authority lives in the canonical documents below.

## Current release posture

- Production status: **NOT GREEN**.
- Previous local publisher/watchdog and OAuth maintenance tasks: contained and disabled.
- Custom domain: HTTP `502` fail-closed because no approved local origin is running.
- Railway: observation-only old deployment at commit `2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10`; not the release target.
- Production SQLite: integrity checks passed at migration `020`; verified backup, restore and a separate `021` to `023` migration rehearsal exist. Production migrations `021` through `023` remain pending.
- Replacement ownership: the exact two-window reconciler and fail-closed Windows `HUMAN_REVIEW` supervisor are implemented but have not been applied or installed.
- Publication: all real preflight output remains unauthorised. Next-candidate and strict dry-run verdicts are `HOLD`.
- Analytics: five YouTube videos map to five story records, but live Analytics scope, publication timezone provenance and an API sample remain unproved.
- Platform scope: YouTube under exact final human review only. Instagram, Facebook, TikTok, X, Threads and Pinterest remain disabled, frozen or manual according to [PLATFORM_MATRIX.md](PLATFORM_MATRIX.md).
- No current release upload or multi-platform post is claimed.
- Current evidence and blockers: [CURRENT_STATUS.md](CURRENT_STATUS.md).

## Canonical documentation

Read these documents in order:

1. [ARCHITECTURE.md](ARCHITECTURE.md) - component boundaries and publication lifecycle.
2. [OPERATING_MODES.md](OPERATING_MODES.md) - permitted actions in each mode.
3. [DATA_MODEL.md](DATA_MODEL.md) - durable records, migrations and invariants.
4. [CONTENT_STANDARD.md](CONTENT_STANDARD.md) - editorial and audience-quality contract.
5. [MEDIA_AND_RIGHTS.md](MEDIA_AND_RIGHTS.md) - asset provenance, rights and disclosure gates.
6. [PLATFORM_MATRIX.md](PLATFORM_MATRIX.md) - intended platform policy versus unverified live state.
7. [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md) - approved release and verification procedure.
8. [INCIDENT_RUNBOOK.md](INCIDENT_RUNBOOK.md) - containment and reconciliation procedure.
9. [CURRENT_STATUS.md](CURRENT_STATUS.md) - expiring release-status snapshot.

The [governed Windows local runtime cutover](docs/stabilisation/windows-local-runtime-cutover.md) is the implementation-specific operator guide for the replacement local runtime.

The old Phase 0 report index and release-slice reports remain non-authoritative historical evidence. Their observations can support a forensic review, but their old source commits and expiry timestamps do not override the canonical set.

## Repository map

| Path | Responsibility |
|---|---|
| `server.js` | Express API, dashboard delivery and runtime bootstrap |
| `run.js` | Operator pipeline modes and local scheduler entry point |
| `publisher.js`, `processor.js`, `audio.js`, `assemble.js` | Publication, production, audio and assembly orchestration |
| `lib/` | Services, repositories, scheduling, governance and studio code |
| `tools/` | Diagnostics, proof generators and operator commands |
| `db/migrations/` | Versioned SQLite schema |
| `channels/` | Channel-specific brand and editorial configuration |
| `src/`, `public/` | React/Vite dashboard and static assets |
| `tests/`, `test/fixtures/` | Automated checks and regression fixtures |
| `output/`, `test/output/` | Generated evidence and disposable proof output |
| `tokens/`, `.env` | Local secret material; never print or commit |

## Safe local orientation

Install and validate a clean checkout:

```powershell
npm ci
npm run ops:agent-rules
npm test
npm run build
npm run docs:doctor
```

The documented release preflights now exist:

```powershell
npm run ops:next-publish-candidates
npm run ops:platform-doctor
npm run ops:goal-dry-run-publish
npm run ops:publish-readiness
npm run ops:platform:status
npm run ops:render-health
```

These commands are evidence surfaces, not publication permission. The 2026-07-27 production-database read-only run returned `HOLD` for the next-candidate and strict dry-run checks. `platform-doctor` passed its fail-closed policy inspection while every platform remained unpublishable.

This fixes the three publication preflight gaps only. Thirteen render, platform-pack and repair command names in `AGENTS.md` still lack matching npm scripts. Their exact names and release impact are recorded in [CURRENT_STATUS.md](CURRENT_STATUS.md); do not substitute similar commands.

The new cutover tools are also fail-closed:

```powershell
node tools/stabilisation-cutover-reconcile.js --database D:\pulse-data\pulse.db
npm run ops:windows-local-runtime -- plan --repo-root <clean-checkout> --expected-commit <sha>
node tools/youtube-analytics-cutover-audit.js --db D:\pulse-data\pulse.db --out <evidence-directory>
```

The reconciler is a dry run unless all apply requirements are supplied. The Windows supervisor lifecycle is a dry run without `--apply` and its exact confirmation value. The analytics command reads SQLite only and does not call YouTube or change OAuth.

## Preserved historical guidance

Useful older guidance remains available but is non-canonical:

- [README_OPERATIONS.md](README_OPERATIONS.md)
- [PULSE_SYSTEM_MAP.md](PULSE_SYSTEM_MAP.md)
- [STUDIO_V2_ARCHITECTURE.md](STUDIO_V2_ARCHITECTURE.md)
- [STUDIO_V21_BASELINE.md](STUDIO_V21_BASELINE.md)
- [PLATFORM_STATUS.md](PLATFORM_STATUS.md)
- [LOCAL_DEPLOYMENT_RUNBOOK.md](LOCAL_DEPLOYMENT_RUNBOOK.md)
- [ROLLBACK_RUNBOOK.md](ROLLBACK_RUNBOOK.md)
- [PULSE_DEEP_FORENSIC_AUDIT.md](PULSE_DEEP_FORENSIC_AUDIT.md)
- [docs/phase-a-inventory.md](docs/phase-a-inventory.md)
- [docs/phase-c-readwrite-map.md](docs/phase-c-readwrite-map.md)

Those files may contain valuable incident history, but their dates, commit references and evidence boundaries must be checked before use.
