# Flash Lane Current State

Read-only control report. No Railway, OAuth, production DB, render default, TTS or social posting changes.

## Summary

- Candidates considered: 1
- Ready for local Flash proof: 0
- Need local Liam audio: 0
- Need Liam audio duration repair: 0
- Need format router decision: 0
- Need exact subject assets: 0
- Need visual evidence repair: 0
- Need motion validation: 0
- Need alternate official motion source: 1

## Input Freshness

- Motion gap report: 2026-05-08T13:16:16.824Z
- Alternate source report: 2026-05-08T13:01:08.416Z
- Reference counts: provisional - refresh resolver before trusting remaining/excluded refs

- Warning: alternate_source_report_older_than_motion_gap - The alternate-source handoff is older than the motion-gap report; alternate source entities may be incomplete.
  Recommended: `npm run studio:v2:alternate-sources`
- Warning: reference_report_older_than_motion_gap - Official trailer references are older than the motion-gap report; rerun media:resolve-trailers before trusting remaining/excluded reference counts.
  Recommended: `npm run media:resolve-trailers -- --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`

## Current Queue

| Story | Stage | Distance | Audio | Exact | Visual gate | Clips | Clip gap | Missing motion entities | Next action |
| --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- |
| rss_5b3abe925b27a199: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One | needs_alternate_official_motion_source | one_blocker | ready 66.2s | 39 | pass | 9/4 | 10.2s | none | find_more_validated_gameplay_seconds_or_downgrade_story |

## Next Commands

### rss_5b3abe925b27a199
- Refresh resolver before trusting remaining/excluded refs: `npm run media:resolve-trailers -- --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- Command: `npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id rss_5b3abe925b27a199`
- Command: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- Search targets: GTA official trailer; GTA gameplay trailer; GTA official gameplay; GTA platform storefront trailer; BioShock official trailer; BioShock gameplay trailer; BioShock official gameplay; BioShock platform storefront trailer; Red Dead official trailer; Red Dead gameplay trailer; Red Dead Steam trailer; Red Dead gameplay

## Safety

- Report-only and local-only.
- Does not download media, render video, call TTS, post, mutate the DB, touch Railway or trigger OAuth.
- Use this report to decide the next local acquisition/validation step before any new Studio V2 proof render.
