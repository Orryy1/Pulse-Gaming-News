# Overnight Status Snapshot

Generated: 2026-05-06 20:12 BST

## Branch

- Current branch: `codex/readiness-qa-failure-window`
- Latest commit: `d77aa768 Resolve still-deck narration via media root`
- `origin/main`: `2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10`
- Working tree at snapshot start: clean

## Validation

- Focused Studio V2 still-deck ingestion tests: pass (`24/24`)
- Full `npm test`: pass (`2001/2001`)
- `npm run build`: pass
- No Railway deploy, OAuth, production DB mutation, social posting or production renderer switch was performed.

## Local TTS

- Approved local voice reference: `pulse-sleepy-liam-20260502`
- Latest local TTS doctor verdict: `red`
- Current reason: local TTS HTTP health is unreachable
- Action: workstream A will stabilise the local TTS server workflow and batch handling. Do not fall back to the old low/demonic voice.

## Creator Studio OS

- Latest fixture report: `test/output/creator_studio_control_room.md`
- Current state: reporting/control layer exists and remains read-only.
- Overall fixture state: `RED` due the deliberate off-brand rejection fixture.

## Asset Acquisition

- Latest report: `test/output/asset_acquisition_pro.md`
- Current state: Asset Acquisition Pro is report/local-only.
- Latest plan-only state: `AMBER`; no direct downloads or production writes.
- Exact-subject and verified-store gating are active in reports to stop generic assets inflating readiness.

## Studio V2 Proof Status

- Latest proof candidate: `1szzhy9`
- Latest enriched proof: `test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4`
- Runtime: `74.666s`
- Narration: approved local Liam MP3 from `D:/pulse-data/media/test/output/local-script-extension/audio/1szzhy9_liam_extended.mp3`
- QA: pass lane with amber warnings.
- Forensic comparison: improved from baseline, with repeat pairs reduced from `16` to `0`.
- Still blocked from production: needs human visual approval and production pilot approval.

## Known Blockers

- Local TTS server is currently down/unreachable.
- Studio V2 is still local-only and must not become production default overnight.
- TikTok official direct posting remains dependent on TikTok app/API constraints; do not post overnight.
- Old production/final MP4 folder contains many videos without approved voice provenance and must not be treated as TikTok-ready.
- Any live production change must go into `MORNING_APPROVAL_QUEUE.md`.

## Overnight Plan

1. Nail local TTS reliability and quality.
2. Produce Studio V2 promotion readiness without switching production.
3. Improve local-only motion acquisition and gap reporting.
4. Improve TikTok automation diagnostics and dispatch planning without posting.
5. Build the voice model shootout framework.
6. Build longform production architecture/prototype.
7. Build monetisation readiness tooling.
8. Produce morning handoff and approval queue.
