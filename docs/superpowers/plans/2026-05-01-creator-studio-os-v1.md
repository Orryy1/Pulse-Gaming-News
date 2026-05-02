# Pulse Creator Studio OS v1 Implementation Plan

Date: 2026-05-01
Branch: codex/hermes-sandbox-quality-routing

## Goal

Build a read-only Creator Studio OS control layer that turns a story into a production packet:

story dossier -> source pack -> media inventory -> format route -> shot list -> render contract -> platform route -> publish readiness -> learning hook

This layer must not publish, produce, change OAuth, mutate Railway, alter env vars, change scheduler frequency, enable hard production gates or switch Studio V2 into production.

## Existing Modules To Reuse

- `lib/topicality-gate.js` for gaming/off-topic/adaptation decisions.
- `lib/text-hygiene.js` for raw HTML entity and mojibake detection.
- `lib/creative/media-inventory-scorer.js` for visual inventory scoring.
- `lib/creative/format-catalogue.js` for format concepts and confidence tiers.
- `lib/render-contract.js` for current render contract language.
- `lib/ops/platform-status.js` for platform state shape.
- `lib/studio/v2/quality-gate-v2.js` for Studio V2 quality vocabulary where useful.

## Implementation Steps

1. Add failing tests for Creator Studio OS packet generation:
   - House of the Dragon rejected.
   - GTA / Xbox / MindsEye accepted.
   - Gaming adaptation routed to review.
   - Blog-only and thin visuals do not go green.
   - Premium visuals route to premium short.
   - RSS description is not treated as a Reddit comment.
   - Raw HTML entity is flagged.
   - TikTok 60+ eligibility and blocked dispatch state are reported.
   - Final verdict produces GREEN / AMBER / RED correctly.
   - JSON and Markdown output are valid and readable.

2. Add `lib/creator-studio-os.js`:
   - Pure functions only.
   - No database writes.
   - No network calls.
   - No upload/render side effects.

3. Add `tools/creator-studio-control-room.js`:
   - CLI for `npm run ops:creator-studio`.
   - Supports fixture mode, story id mode and approved-story selection where available.
   - Writes:
     - `test/output/creator_studio_control_room.json`
     - `test/output/creator_studio_control_room.md`
   - Writes per-story packets under `test/output/creator-studio/<storyId>/`.

4. Add package script:
   - `ops:creator-studio`

5. Add reports:
   - `PULSE_CREATOR_STUDIO_OS_V1_REPORT.md`
   - Update `TONIGHT_HANDOFF.md`

6. Verify:
   - Targeted tests.
   - `npm test` if feasible.
   - `npm run build`.
   - No deploy unless explicitly approved and still read-only.

## Safety Notes

- The implementation is reporting/control only.
- Production publishing behaviour must remain unchanged.
- No hard publish gates are enabled.
- Platform monetisation rules are recorded as advisory routing context only.
