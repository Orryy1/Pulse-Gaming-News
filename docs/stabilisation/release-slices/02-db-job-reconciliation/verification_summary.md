# Slice 02 Verification Summary

| Field | Result |
| --- | --- |
| generated_at | 2026-07-27T05:56:56.7374085Z |
| code_commit_sha | e563c041b90f542cb322ba8d26fb51ce30c0048b |
| branch | release/pulse-v1 |
| scope | Database governance, jobs, leases, human admission, guarded YouTube dispatch and reconciliation |
| verdict | GREEN for local slice verification |
| production_authority | false |

## Verified behaviour

- Migration 020 creates immutable lifecycle, dispatch, publication-state, lease and operator-audit controls. Fresh application, re-run safety, integrity verification and rollback are tested.
- Job claims are transactional. Claim tokens, worker identity and server lease deadlines fence stale workers from completing or mutating work.
- Scheduler and publisher ownership are exclusive durable leases, including startup-failure release and live ownership reporting.
- The 30-day stabilisation profile exposes only the 09:00 and 19:00 UTC YouTube windows, caps output at two Shorts per rolling 24 hours, enforces a four-hour minimum gap and refuses catch-up bursts.
- Human admission binds operator identity, evidence hashes, channel identity, final media, final script, metadata and the guarded schedule to one immutable request fingerprint.
- Editing the approved request or moving to an expired window blocks before upload.
- The YouTube adapter marks the exact remote-create boundary and performs one `videos.insert` attempt. Pre-create failures remain reschedulable; any uncertain post-create result requires reconciliation.
- A publication is not recorded until the exact YouTube object is publicly visible and processed.
- Normal finalisation and reconciliation project the canonical YouTube identity to the story row in the same transaction and reject conflicting IDs or URLs.
- Reconciliation is read-only by default. Apply mode requires matching candidate confirmation, HUMAN_REVIEW, a dedicated maintenance flag, a tripped kill switch, the primary instance and a named change window.
- SQLite backup tooling uses the live online-backup API, hashes the result, reopens it read-only, runs `quick_check`, `integrity_check` and `foreign_key_check`, emits JSON evidence and rejects tampering.

## Verification

- Focused stabilisation suite: 269 passed, 0 failed.
- Full Node suite: 2,106 passed, 0 failed.
- Dashboard production build: passed.
- Syntax checks: passed.
- Secret scan: 396 files scanned, 0 findings.
- Agent operating-rules validator: passed.
- Docs doctor: 0 high, 0 medium and 3 low historical commit-reference notices.
- `git diff --check`: passed.

## Evidence boundary

This is local proof only. No video was uploaded, no social post was created, no OAuth or token state was changed, no production database was mutated and no Railway service was changed or inspected.

Migration 020 has not been applied to production. The production database has not been backed up by this run. No real YouTube object, authenticated channel, production lease or operator admission has been observed. The 12-video experiment and the 30-day and 90-day operating evidence necessarily remain future work.

## Commands

```text
node --test <28 focused stabilisation test files>
npm test
npm run build
node tools/ci-secret-scan.js
npm run ops:agent-rules
npm run docs:doctor
git diff --check
```
