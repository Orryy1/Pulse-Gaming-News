# Phase 0 Database State and Integrity Report

> **NO DATABASE INSTANCE WAS OPENED.** This report covers committed schema controls only. Production and local database state are **UNKNOWN / UNVERIFIED**.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Static migration inventory, integrity controls and instance evidence gaps; no database mutation |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `docs/stabilisation/release-slices/02-db-job-reconciliation/verification_summary.md for this source snapshot only; older local proof remains historical` |
| superseded_by | `none` |
| authoritative | `false` |

After expiry, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Result

| Check | Result |
|---|---|
| Production database path | `UNKNOWN / UNVERIFIED` |
| Local runtime database path | `UNKNOWN / UNVERIFIED` |
| Database file SHA-256 | `UNKNOWN / UNVERIFIED` |
| Applied migration level | `UNKNOWN / UNVERIFIED` |
| `PRAGMA quick_check` | not run |
| `PRAGMA integrity_check` | not run |
| `PRAGMA foreign_key_check` | not run |
| WAL/SHM consistency | not inspected |
| Story row count | `UNKNOWN / UNVERIFIED` |
| Platform-post row count | `UNKNOWN / UNVERIFIED` |
| Status/platform-ID conflicts | `UNKNOWN / UNVERIFIED` |
| Duplicate dispatch keys | `UNKNOWN / UNVERIFIED` |
| Active schedules and leases | `UNKNOWN / UNVERIFIED` |
| Backup freshness and checksum | `UNKNOWN / UNVERIFIED` |
| Restore rehearsal | `UNKNOWN / UNVERIFIED` |

No database, `.env` or token file was opened or mutated.

## Committed schema evidence

Migrations `001` through `022` are tracked at the source commit. They establish stories, channels, platform posts, durable jobs and schedules, workers, scoring, round-ups, media and analytics records, idempotency, performance/intelligence tables, provenance, stabilisation governance, controlled experiment analytics and retention-derivation evidence.

Migration `020` adds immutable publication lifecycle, dispatch, public-state, runtime-lease and operator-audit controls.

`db/migrations/022_youtube_retention_derivation_evidence.sql` is part of the source baseline. It must not be reported as applied in production without the live migration table, checksum and integrity evidence.

## Historical local proof

`docs/stabilisation/release-slices/02-db-job-reconciliation/verification_summary.md` records focused local evidence at another commit. It explicitly does not prove production database state. It was not used as a current integrity result.

## Read-only production procedure

After explicit operator coordination, a purpose-built read-only connection or verified database copy should produce:

1. resolved path and file metadata without exposing secrets
2. migration IDs and recorded checksums
3. quick, full and foreign-key checks
4. table counts and time ranges
5. lifecycle/public-state consistency query
6. failed rows with non-null platform IDs
7. platform-confirmed rows missing a stable ID
8. duplicate operation or idempotency keys
9. running or stale jobs and attempts
10. enabled schedule rows and runtime leases
11. latest online backup metadata and checksum
12. restore-open and integrity evidence against the backup copy

Queries must not repair, vacuum, checkpoint, migrate or rewrite data during the evidence pass.

## Conflict definitions

At minimum, flag:

- failed or pre-create states carrying a platform object ID
- published states without platform confirmation evidence
- confirmed states without a platform object ID
- multiple active publication rows for the same story/platform intent
- a scheduled state without immutable admission evidence
- a dispatch attempt without an idempotency key
- duplicate active scheduler leases
- jobs marked running with no live owner heartbeat

The number of conflicts is currently unknown.

## Backup boundary

Source includes database backup tooling, but this documentation task did not run it. File copying a live WAL database is not automatically a valid backup. Production acceptance needs an online backup, SHA-256, open/integrity verification and a documented restoration test.

## Decision

Schema safeguards exist in source. Database integrity, migration parity and backup recoverability cannot be assessed from this report.
