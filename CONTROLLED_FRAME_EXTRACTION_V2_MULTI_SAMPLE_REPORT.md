# Controlled Frame Extraction v2 - Multi-Sample Proof

Generated: 2026-05-02

## What Changed

The controlled frame extraction plan now probes multiple points per official trailer reference instead of only sampling two fixed positions.

Old behaviour:

- sampled 18% and 52%;
- grouped samples trailer-by-trailer;
- one bad rating/title/midpoint frame could make a useful trailer look unusable.

New behaviour:

- samples 18%, 34%, 52%, 68% and 84%;
- interleaves by source first, so GTA, Red Dead and BioShock each get a fair early probe;
- defaults to 12 target frames per story;
- records `sample_order` and `sampling_strategy: interleaved_multi_probe_v2`;
- keeps apply-local writes under `test/output` only.

## Apply-Local Proof

Story:

- `rss_5b3abe925b27a199`

Outputs:

- frame plan: `test/output/controlled_frame_extraction_v1.json`
- worker JSON: `test/output/controlled_frame_extraction_worker_apply_local.json`
- worker Markdown: `test/output/controlled_frame_extraction_worker_apply_local.md`
- extracted frames: `test/output/frame-extraction-v1/assets/rss_5b3abe925b27a199/`

Result:

- planned frames: 12
- extracted frames: 12
- accepted frames: 7
- rejected frames: 5
- accepted entities: GTA 4, Red Dead 2, BioShock 1

Rejected frames were rejected for the right reasons:

- title/rating card;
- unsafe face-like frame;
- black/low-detail official frame.

## Render Proof Outcome

The local diagnostic Studio V2 render now completes.

Outputs:

- enriched MP4: `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_enriched.mp4`
- enriched contact sheet: `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_contact_sheet.jpg`
- enriched QA: `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_qa.json`
- report: `test/output/studio-v2-still-deck/studio_v2_still_deck_report.md`

Key metrics:

- runtime: 68.8s
- source diversity: green, 15 unique sources across 16 scenes
- clip dominance: green, 0.88
- subtitles: pass
- forensic visual repeat pairs: 29 baseline -> 3 enriched
- forensic verdict: baseline fail -> enriched warn

Still blocked:

- `voicePathUsed` is red because the render used unapproved local TTS.

That is intentional. This render is a local diagnostic proof, not a pilot candidate.

## Additional Fixes From The Proof

- Flash Lane scene planning no longer overuses an official clip source after the clip-ratio target is reached.
- Flash Lane source cards are delayed until after the hook section.
- Flash Lane avoids cover-art still scenes while exact trailer frames are available.
- Flash Lane card filters no longer use unsupported `drawbox alpha=` syntax.
- Studio V2 source-diversity QA now treats different timestamped trailer segments as distinct footage beats.

## Safety Boundary

- No deploy.
- No Railway changes.
- No OAuth or token changes.
- No production DB mutation.
- No social posting.
- No production renderer switch.
- No production voice switch.
- No yt-dlp.
- No browser scraping.
- No retained trailer/video downloads.

Apply-local frame extraction fetched sources only to write still frames under `test/output`.

## Current Judgement

Visuals are now meaningfully improved and the previous age-card/title-card/repetition problems are being caught or reduced.

The next blocker is voice approval: either produce approved 61-75s production narration, or explicitly approve a local voice path after human review.

## Validation

- Targeted frame/render/QA suites: 69/69 pass.
- Full `npm test`: 1,710/1,710 pass.
- `npm run build`: pass.
