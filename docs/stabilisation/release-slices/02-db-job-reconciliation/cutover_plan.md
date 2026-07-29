# Slice 02 Production Cutover Plan

Status: **plan only**. This file does not authorise or record a production change.

## Ordered change window

1. Name the operator, rollback owner and change-window ID, then trip the emergency kill switch.
2. Create an online backup of the live SQLite database. Preserve its SHA-256 sidecar and require clean `quick_check`, `integrity_check` and `foreign_key_check` results.
3. Confirm the migration file checksum is `90099468774c7858861b02cba6618f94bbfec4c9950fa172d64f81a8de3bb3e7`, supply the approved backup evidence and apply migration 020 once.
4. Start exactly one primary runtime in HUMAN_REVIEW using the 30-day stabilisation profile. Verify all secondary-platform automation is false and observe a single scheduler lease owner.
5. Run `npm run ops:publication-reconciliation` without `--apply`. Preserve the JSON inventory and hold every identity-less case for discovery.
6. Verify that the authenticated YouTube channel matches the admission contract without exposing token values.
7. Admit one fully reviewed candidate close to the 09:00 or 19:00 UTC window. Preserve operator identity, exact-request fingerprint, media and script hashes, QA evidence and rights evidence.
8. Observe one governed create attempt. Require the exact external ID to become public and processed before recording publication and atomically projecting it to the story.
9. Confirm there are no unknown dispatch outcomes, preserve lease-health evidence, take a post-cutover backup and close the change window.

## Immediate rollback or hold conditions

- Backup, integrity or foreign-key verification fails.
- The migration checksum differs.
- More than one primary or scheduler owner appears.
- Any secondary-platform automation is enabled.
- The authenticated YouTube channel differs from the admitted channel.
- The final request fingerprint differs from the approved fingerprint.
- A create response is uncertain or public verification fails.

An uncertain create is a reconciliation case. It must never be retried as a new upload.

## Current execution record

- Production change started: no.
- Production backup created: no.
- Migration 020 applied to production: no.
- Production deployment changed: no.
- YouTube object created: no.
