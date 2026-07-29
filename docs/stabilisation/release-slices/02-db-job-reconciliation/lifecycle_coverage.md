# Publication Lifecycle Coverage

The local implementation covers the full governed path:

`DISCOVERED → VERIFIED → EDITORIALLY_APPROVED → SCRIPT_READY → ASSETS_CLEARED → RENDERED → QA_PASSED → HUMAN_APPROVED → SCHEDULED → DISPATCH_STARTED → PLATFORM_OBJECT_CREATED → PLATFORM_SCHEDULED → PLATFORM_CONFIRMED → PUBLISHED → ANALYTICS_PENDING → ANALYTICS_COLLECTED`

## Evidence-bearing writers

| State group | Writer | Required evidence |
| --- | --- | --- |
| Discovery through scheduled | `publication-admission` | Story identity, verification, editorial decision, script/media/rights/QA hashes, operator decision, exact request fingerprint and fresh guarded window |
| Dispatch started | `governed-platform-dispatch` | Current lease, matching scheduled evidence and current request fingerprint |
| Object created | `recordPlatformObjectCreated` | Anchored external platform ID |
| Platform scheduled | `recordPlatformScheduled` | Exact private, processed object with matching `publishAt`, request fingerprint and runway lock |
| Release commitment ledger | `recordScheduledPlatformReleaseCommitment` | Exact private, processed remote `publishAt`, immutable schedule identity and fresh GREEN create/verification control; lifecycle remains `PLATFORM_SCHEDULED` |
| Platform confirmed | `recordPlatformConfirmed` | Fresh proof that the exact object is public and processed |
| Published | `recordPublished` | Matching confirmation and atomic story projection |
| Analytics pending | `recordAnalyticsPending` | Canonical published identity |
| Analytics collected | `recordAnalyticsCollected` | Timestamped metrics snapshot |

## Exception handling

| State | Meaning | Allowed recovery |
| --- | --- | --- |
| `DISPATCH_FAILED_BEFORE_CREATE` | No remote create boundary was crossed | New reviewed admission |
| `PLATFORM_CREATED_CONFIRMATION_FAILED` | An object ID exists but public confirmation failed | Reconciliation only |
| `PLATFORM_CREATED_METADATA_FAILED` | Creation succeeded but a later step failed | Reconciliation only |
| `RECONCILIATION_REQUIRED` | Platform outcome is uncertain or inconsistent | Read-only discovery, then guarded operator reconciliation |
| `PLATFORM_SCHEDULE_DISARMED` | Owner-authenticated proof confirms the exact object is private and has no `publishAt` | Terminal: no re-arm and no catch-up |
| `PUBLISHED_QA_INCIDENT` | Publication truth remains, but QA found an incident | Operator review |
| `RETRACTED` | Fresh platform proof and immutable operator approval confirm removal | Terminal |

## Invariants

- Lifecycle and operator-audit records are append-only.
- Published state requires exact, fresh public verification.
- External IDs are unique per platform.
- An idempotency key cannot be replayed with changed evidence.
- Exact retries cannot regress later published, analytics or retracted states.
- Identity-less ambiguity stops before platform verification.
- A private scheduled object cannot project as public before T0.
- A successfully verified T70 remote `publishAt` is the durable external release commitment, so YouTube can hit T0 even through a later local outage.
- T15 is a best-effort reaffirmation and emergency-revocation checkpoint, not a second arm prerequisite. A HOLD before T0 triggers owner-authenticated disarm of the exact object. Only confirmed private/no-`publishAt` proof closes it as disarmed; uncertainty becomes reconciliation/incident evidence and can never be represented as disarmed. A confirmed disarm cannot re-arm or catch up.
- T0 is observation-only: it requires the exact durable release commitment but does not require local LIVE_GUARDED health.
- Canonical publication and the legacy YouTube story projection commit atomically.

This matrix is backed by local tests only. Production observations: **0**.
