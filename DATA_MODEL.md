# Pulse Gaming Data Model

> **Authority boundary:** This describes the committed schema and repository intent. Production database contents, migration level and integrity are **UNKNOWN / UNVERIFIED**.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Committed SQLite schema, domain ownership, lifecycle invariants and migration rules |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `docs/phase-a-inventory.md and docs/phase-c-readwrite-map.md for current schema orientation; those audits remain historical evidence` |
| superseded_by | `none` |
| authoritative | `true` |

If expired, mark this document **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Persistence contract

SQLite is the governed durable store when `USE_SQLITE=true`. The repository enables foreign keys and uses versioned migrations with immutable migration checksums. Durable queue and scheduler behaviour additionally requires `USE_JOB_QUEUE=true`.

Legacy JSON files may support local compatibility and roll-ups. They are not a second production system of record.

The actual production database path, file hash, migration table, WAL state, row counts, foreign-key result and backup freshness were not inspected.

## Committed migration baseline

The source commit tracks migrations `001` through `022`:

| Range | Main responsibility |
|---|---|
| `001`–`003` | stories, channels and platform posts |
| `004`–`005` | jobs, job runs, schedules, workers and worker events |
| `006`–`009` | scoring, round-ups, audio packs and derivatives |
| `010`–`016` | idempotency, backfills, source identity, channel markers, metric snapshots and thumbnail paths |
| `017`–`018` | intelligence and live performance models |
| `019` | media provenance and visual-content signals |
| `020` | stabilisation governance, publication lifecycle, dispatch attempts, public state, runtime leases and operator audit |
| `021` | controlled video experiments and YouTube analytics experiment snapshots |
| `022` | hash-bound YouTube retention derivation evidence for controlled experiment cells |

Tracked in source does not mean applied in production. The live migration table, checksums and retention rows remain **UNKNOWN / UNVERIFIED**.

## Domain ownership

| Domain | Representative durable records | Responsibility |
|---|---|---|
| Editorial | `stories`, `story_scores`, `breaking_log` | Story identity, source material, classification, script and approval |
| Channels | `channels`, `platform_accounts` | Channel configuration and platform account mapping |
| Publication | `platform_posts`, lifecycle and public-state tables | Remote projection, state, platform IDs and reconciliation |
| Queue | `jobs`, `job_runs`, `schedules`, `workers`, `worker_events` | Durable work, attempts, recurring schedules and ownership |
| Idempotency | `idempotency_keys`, dispatch records | Prevent duplicate material actions |
| Media | `audio_packs`, `audio_pack_assets`, `derivatives`, `media_provenance`, visual signals | Asset identity, lineage and generated variants |
| Analytics | snapshots, topic stats, performance features and models | Immutable metric history and learning evidence |
| Governance | operator audit, runtime leases and immutable lifecycle evidence | Human decisions, process ownership and state integrity |

Exact table and column names remain defined by migrations, not this summary.

## Story identity

Every story must have one stable `id` and one `channel_id`. Source URL identity and hashes prevent accidental duplicate ingestion. A story record may hold editorial and local production fields but those fields do not replace immutable publication evidence.

## Publication identity

A platform publication is identified by story, channel, platform and guarded operation key. Local state must distinguish:

- a dispatch that failed before remote creation
- a remote object that may have been created but is not confirmed
- a confirmed platform object
- a published object
- a published object with a later QA incident
- a retracted object

A platform ID on a failed row is a reconciliation signal, not evidence that retry is safe.

## Lifecycle invariants

Migration `020` establishes immutable lifecycle and operator-audit protections plus verification triggers for public state. Application services append evidence-backed transitions rather than rewriting history.

Required conceptual invariants:

- no `SCHEDULED` state without verified schedule, approval, control-tower and kill-switch evidence
- no `PLATFORM_OBJECT_CREATED` without an idempotent dispatch attempt
- no `PUBLISHED` without platform confirmation
- no analytics collection before a known published object
- no destructive correction of history; append an incident, reconciliation or retraction state

## Migration rules

1. Never edit an applied migration.
2. Add a monotonically numbered migration.
3. Make the migration idempotent where the migration framework requires it.
4. Add focused repository and migration tests.
5. Verify a clean database upgrade and the supported upgrade path.
6. Back up and validate the target database before an approved production migration.
7. Record the exact source commit and migration level after deployment.

No production migration is authorised by this document.

## Integrity evidence required for release

A current integrity report must establish, read-only:

- resolved database path and environment
- applied migration IDs and checksums
- `PRAGMA quick_check`
- `PRAGMA integrity_check`
- `PRAGMA foreign_key_check`
- status/platform-ID conflicts
- duplicate or ambiguous dispatch keys
- active schedule and lease rows
- backup timestamp, checksum and restore-verification evidence

All those instance-level facts are currently **UNKNOWN / UNVERIFIED**. See [docs/stabilisation/phase-0/database_state_integrity_report.md](docs/stabilisation/phase-0/database_state_integrity_report.md).
