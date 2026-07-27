# Publication Lifecycle Coverage

The local implementation covers the full governed path:

`DISCOVERED → VERIFIED → EDITORIALLY_APPROVED → SCRIPT_READY → ASSETS_CLEARED → RENDERED → QA_PASSED → HUMAN_APPROVED → SCHEDULED → DISPATCH_STARTED → PLATFORM_OBJECT_CREATED → PLATFORM_CONFIRMED → PUBLISHED → ANALYTICS_PENDING → ANALYTICS_COLLECTED`

## Evidence-bearing writers

| State group | Writer | Required evidence |
| --- | --- | --- |
| Discovery through scheduled | `publication-admission` | Story identity, verification, editorial decision, script/media/rights/QA hashes, operator decision, exact request fingerprint and fresh guarded window |
| Dispatch started | `governed-platform-dispatch` | Current lease, matching scheduled evidence and current request fingerprint |
| Object created | `recordPlatformObjectCreated` | Anchored external platform ID |
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
| `PUBLISHED_QA_INCIDENT` | Publication truth remains, but QA found an incident | Operator review |
| `RETRACTED` | Fresh platform proof and immutable operator approval confirm removal | Terminal |

## Invariants

- Lifecycle and operator-audit records are append-only.
- Published state requires exact, fresh public verification.
- External IDs are unique per platform.
- An idempotency key cannot be replayed with changed evidence.
- Exact retries cannot regress later published, analytics or retracted states.
- Identity-less ambiguity stops before platform verification.
- Canonical publication and the legacy YouTube story projection commit atomically.

This matrix is backed by local tests only. Production observations: **0**.
