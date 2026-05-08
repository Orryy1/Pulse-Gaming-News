# Flash Lane Current State

Read-only control report. No Railway, OAuth, production DB, render default, TTS or social posting changes.

## Summary

- Candidates considered: 1
- Ready for local Flash proof: 0
- Need local Liam audio: 0
- Need Liam audio duration repair: 0
- Need format router decision: 0
- Need exact subject assets: 0
- Need motion validation: 0
- Need alternate official motion source: 1

## Input Freshness

- Motion gap report: 2026-05-08T00:48:24.258Z
- Alternate source report: 2026-05-08T00:48:36.566Z

## Current Queue

| Story | Stage | Distance | Audio | Exact | Clips | Missing motion entities | Next action |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| rss_5b3abe925b27a199: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One | needs_alternate_official_motion_source | one_blocker | ready 72.5s | 26 | 6/5 | none | find_non_exhausted_official_motion_source |

## Next Commands

### rss_5b3abe925b27a199
- Command: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- Command: `npm run media:plan-frames -- --story-id rss_5b3abe925b27a199 --trailer-references test/output/official_trailer_references_v1.json`
- Command: `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local`
- Search targets: GTA official trailer; GTA gameplay trailer; GTA official gameplay; GTA platform storefront trailer; BioShock official trailer; BioShock gameplay trailer; BioShock official gameplay; BioShock platform storefront trailer; Red Dead official trailer; Red Dead gameplay trailer; Red Dead official gameplay; Red Dead platform storefront trailer

## Safety

- Report-only and local-only.
- Does not download media, render video, call TTS, post, mutate the DB, touch Railway or trigger OAuth.
- Use this report to decide the next local acquisition/validation step before any new Studio V2 proof render.
