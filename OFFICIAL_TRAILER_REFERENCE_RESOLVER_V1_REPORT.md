# Official Trailer Reference Resolver v1 Report

Date: 2026-05-01

## What Was Built

Official Trailer Reference Resolver v1 is a report-only bridge between verified still acquisition and future motion/frame planning.

It adds:

- `lib/official-trailer-reference-resolver.js`
- `tools/official-trailer-reference-resolver.js`
- `tests/services/official-trailer-reference-resolver.test.js`
- `npm run media:resolve-trailers`
- `npm run ops:trailer-references`

The resolver reads local stories, attaches verified still-enrichment assets from the latest v1.5/v1.4/v1.1 report and resolves official trailer references from verified Steam app ids. It also maps IGDB video ids as reference-only metadata.

## Safety Position

This is still report-only.

It does not:

- download trailer/video media
- extract frames
- slice clips
- use `yt-dlp`
- use browser scraping
- mutate the production DB
- change Railway
- trigger OAuth
- post anything
- change scheduler behaviour
- change render defaults

Steam metadata lookup is limited to appdetails JSON and records official movie references with `downloads_allowed: false`.

## Command

```bash
npm run media:resolve-trailers
```

Useful forms:

```bash
npm run media:resolve-trailers -- --fixture --offline
npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199
npm run media:resolve-trailers -- --limit 5
npm run media:resolve-trailers -- --offline
```

Outputs:

- `test/output/official_trailer_references_v1.json`
- `test/output/official_trailer_references_v1.md`

## Local Proof Result

Story:

- `rss_5b3abe925b27a199`
- `GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One`

Resolved verified Steam targets:

- GTA: `3240220` / `Grand Theft Auto V Enhanced`
- Red Dead: `1174180` / `Red Dead Redemption 2`
- BioShock: `8870` / `BioShock Infinite`

Result:

- official references found: 1 story
- Steam trailer references: 15
- IGDB trailer references: 0
- blockers: clear
- downloads: 0

## Why This Matters

Motion Acquisition Pro v1 showed every sampled story needed official trailer search. This resolver closes the first part of that gap for stories with verified Steam app provenance: Pulse can now identify official trailer references without guessing, scraping or downloading video.

The next system can use these references to decide whether a story is eligible for controlled local frame extraction, but that is not enabled here.

## Validation

- `node --test tests/services/official-trailer-reference-resolver.test.js`: 7/7 pass
- Targeted media/acquisition/readiness suite: 58/58 pass
- `npm run media:resolve-trailers -- --fixture --offline`: pass
- `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199`: pass
- `npm test`: 1,599/1,599 pass
- `npm run build`: pass

## Next Recommended Step

Integrate official trailer references into Motion Acquisition Pro so stories with resolved official Steam/IGDB references move from `official_search_required` to `reference_ready_for_local_frame_plan`.

Keep that step report-only. Do not download videos or extract frames until the reference-to-motion plan is proven.
