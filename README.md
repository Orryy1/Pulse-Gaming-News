# Pulse Gaming

> **Authority boundary:** This is the canonical repository entry point. It describes the intended governed system at the source commit below. It does not prove what is running in production.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Canonical repository orientation, authority boundaries and documentation index |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `none — no root README.md existed at the source baseline` |
| superseded_by | `none` |
| authoritative | `true` |

If `expires_at` has passed, treat the status statements as **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS** until refreshed.

Pulse Gaming is a Node.js CommonJS media system with a React/Vite control surface. It discovers gaming stories, builds governed editorial and media evidence, renders platform-native assets and can dispatch approved publications through guarded platform adapters. The stabilisation contract is deliberately conservative: a generated file is not automatically publishable and a configured capability is not evidence that a platform is live.

The repository’s compatibility operating goal is [docs/codex-main-goal.md](docs/codex-main-goal.md). It delegates detailed authority to the canonical set below.

## Current release posture

- Default operating mode: `LOCAL_PROOF`.
- Live publication: **not authorised by this document**.
- Runtime provenance and scheduler ownership: **RED**. A 2026-07-27 read-only snapshot found different commits in the release worktree, main checkout, local server and public Railway service, with the local scheduler/autonomous indicators active and several Pulse-named Windows tasks present.
- Production database health, OAuth state and current platform objects: **UNKNOWN / UNVERIFIED**.
- Approved production stack in the committed operating contract: ElevenLabs, Epidemic Sound, HyperFrames and FFmpeg.
- Disabled replacement stack: HeyGen, Kokoro and MusicGen.
- Primary stabilisation platform: YouTube under human review. Secondary-platform automation remains disabled or manual according to [PLATFORM_MATRIX.md](PLATFORM_MATRIX.md).
- Controlled evidence gate: the real 12-video experiment and 30-day observation window are not yet proven complete.
- Current evidence and blockers: [CURRENT_STATUS.md](CURRENT_STATUS.md).

## Canonical documentation

Read these documents in order:

1. [ARCHITECTURE.md](ARCHITECTURE.md) — component boundaries and publication lifecycle.
2. [OPERATING_MODES.md](OPERATING_MODES.md) — permitted actions in each mode.
3. [DATA_MODEL.md](DATA_MODEL.md) — durable records, migrations and invariants.
4. [CONTENT_STANDARD.md](CONTENT_STANDARD.md) — editorial and audience-quality contract.
5. [MEDIA_AND_RIGHTS.md](MEDIA_AND_RIGHTS.md) — asset provenance, rights and disclosure gates.
6. [PLATFORM_MATRIX.md](PLATFORM_MATRIX.md) — intended platform policy versus unverified live state.
7. [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md) — approved release and verification procedure.
8. [INCIDENT_RUNBOOK.md](INCIDENT_RUNBOOK.md) — containment and reconciliation procedure.
9. [CURRENT_STATUS.md](CURRENT_STATUS.md) — expiring release-status snapshot.

Machine-readable traceability is available in the [Phase 0 report index](docs/stabilisation/phase-0/report_index.json) and [audit implementation matrix](docs/stabilisation/release-slices/audit_implementation_matrix.json). Both are non-authoritative inventories and must be read with their evidence boundaries and expiry.

Architecture decisions belong under `docs/adr/`. Historical generated evidence should move, when deliberately curated, to `docs/archive/YYYY-MM/`. New machine-generated evidence should normally be a CI artefact rather than committed source.

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

These commands describe or verify source without authorising publication:

```powershell
npm install
npm test
npm run build
npm run ops:agent-rules
npm run ops:publish-readiness
npm run ops:platform:status
```

Some operator commands can create local evidence or read configured services. Check [OPERATING_MODES.md](OPERATING_MODES.md) and the command implementation before running them. Never infer live permission from the presence of an npm script.

Known command-surface gap: `AGENTS.md` names `ops:next-publish-candidates`, `ops:platform-doctor` and `ops:goal-dry-run-publish`, but those scripts and tool entry points do not exist at the recorded source commit. Do not report them as run or passed. The available `ops:publish-readiness`, `ops:control-room` and `ops:system:doctor` checks most recently returned AMBER, AMBER and review respectively, which is not production readiness.

## Historical material retained

No prior root `README.md` existed at the source baseline, so nothing was deleted or silently replaced. Useful older guidance remains available and is now explicitly non-canonical:

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

Those files may contain valuable incident history but they do not override the canonical set above. Their dates, commit references and evidence scope must be checked before use.
