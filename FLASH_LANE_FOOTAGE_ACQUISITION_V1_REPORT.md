# Flash Lane Footage Acquisition v1

## What Was Built

Added a local, report-only footage acquisition planner for Flash Lane.

It reads the controlled frame extraction and trailer segment validation reports, then produces a shopping list of missing validated footage windows per entity.

For the Take-Two proof story, this matters because the previous render pulled weak early trailer material:

- rating cards
- black transition frames
- title cards
- blurry low-detail frames
- mismatched or boring cover-art moments

## Command

```bash
npm run studio:v2:footage-acquisition -- --story-id rss_5b3abe925b27a199
```

Alias:

```bash
npm run ops:flash-footage-acquisition -- --story-id rss_5b3abe925b27a199
```

Outputs:

- `test/output/flash_lane_footage_acquisition_v1.json`
- `test/output/flash_lane_footage_acquisition_v1.md`

## Safety Boundaries

- report-only
- no downloads
- no `yt-dlp`
- no browser scraping
- no social-media scraping
- no unofficial clip ingestion
- no Railway changes
- no OAuth or token changes
- no production DB changes
- no render default changes
- no posting

## What It Enables

This gives the next local proof a concrete acquisition target instead of blindly sampling the first few seconds of trailers.

The renderer should not get Flash Lane approval until the footage backbone has enough validated windows for the actual story entities.
