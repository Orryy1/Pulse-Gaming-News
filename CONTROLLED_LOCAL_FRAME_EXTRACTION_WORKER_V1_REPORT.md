# Controlled Local Frame Extraction Worker v1 Report

Date: 2026-05-01

## What Was Built

Controlled Local Frame Extraction Worker v1 extracts planned frames from official trailer references in local-only apply mode.

It adds:

- `lib/controlled-frame-extraction-worker.js`
- `tools/controlled-frame-extraction-worker.js`
- `tests/services/controlled-frame-extraction-worker.test.js`
- `npm run media:extract-frames`
- `npm run ops:frame-extract`

## Safety Model

Default mode is dry-run.

Apply mode requires:

```bash
--apply-local
```

Apply-local writes only under:

```text
test/output/frame-extraction-v1/assets
```

It does not:

- mutate the production DB
- change Railway
- trigger OAuth
- post anything
- change scheduler behaviour
- change render defaults
- use `yt-dlp`
- use browser scraping

The worker uses ffmpeg directly against approved official references only when `--apply-local` is explicitly passed.

## Commands

Dry-run:

```bash
npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --dry-run
```

Apply-local proof:

```bash
npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local --max-frames-per-story 6
```

Outputs:

- `test/output/controlled_frame_extraction_worker_dry_run.json`
- `test/output/controlled_frame_extraction_worker_dry_run.md`
- `test/output/controlled_frame_extraction_worker_apply_local.json`
- `test/output/controlled_frame_extraction_worker_apply_local.md`
- `test/output/controlled_frame_extraction_worker_v1.json`
- `test/output/controlled_frame_extraction_worker_v1.md`

## Local Proof Result

Story:

- `rss_5b3abe925b27a199`

Dry-run:

- planned frames: 6
- files written: 0

Apply-local:

- frames extracted: 6
- frames accepted: 5
- frames rejected: 1
- extract failures: 0

Accepted frame groups:

- GTA: 2 accepted frames
- Red Dead: 1 accepted frame, 1 rejected for face-like thumbnail risk
- BioShock: 2 accepted frames

Frame output directory:

```text
test/output/frame-extraction-v1/assets/rss_5b3abe925b27a199
```

Primary apply-local report:

```text
test/output/controlled_frame_extraction_worker_apply_local.json
```

Primary apply-local markdown:

```text
test/output/controlled_frame_extraction_worker_apply_local.md
```

## QA

Every extracted frame records:

- source URL
- source type
- entity
- target time
- local path
- content hash
- file size
- resolution
- thumbnail safety
- black-frame check
- blur/detail warning
- pixel-level face/stock-person heuristic

Duplicate hashes are rejected. Face-like or thumbnail-unsafe frames are rejected.

## Validation

- `node --test tests/services/controlled-frame-extraction-worker.test.js`: 6/6 pass
- Targeted media-control suite: 37/37 pass
- `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --dry-run`: pass
- `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local --max-frames-per-story 6`: pass
- `npm test`: 1,632/1,632 pass after the full follow-up verification run
- `npm run build`: pass

## Deployment Position

This worker is safe to keep as report-only/local-only tooling.

It is not approved as uncontrolled production acquisition. Do not run apply mode in production and do not wire it into automatic production renders without a separate approval decision.

Safe deployment boundary:

- command/report availability is acceptable;
- dry-run by default is acceptable;
- local `test/output` apply mode is acceptable;
- production DB mutation is not acceptable;
- automatic trailer/video downloads are not acceptable;
- Studio V2 production switching is not acceptable.

## Next Recommended Step

Completed follow-up: accepted extracted frames now integrate into the local still-deck ingestion path and the enriched Studio V2 proof passes forensic QA locally.

Next recommended step:

Prepare a Studio V2 pilot readiness packet:

- MP4
- contact sheet
- QA report
- forensic report
- provenance report
- runtime proof
- subtitle proof
- voice/audio caveat
- rollback plan
