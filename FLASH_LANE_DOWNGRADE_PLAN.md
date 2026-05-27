# Flash Lane Downgrade Plan

Report-only planner for stories that are good enough for Pulse, but not good enough for premium Flash Lane yet.

## Summary

- Rows considered: 1
- Keep Flash Lane: 0
- Downgrade to standard short: 1
- Not safe for video yet: 0
- Blocked before downgrade: 0
- Blog/card only: 0

## Decisions

| Story | Current stage | Verdict | Lane | Runtime | Reason |
| --- | --- | --- | --- | ---: | --- |
| rss_5b3abe925b27a199: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One | needs_alternate_official_motion_source | downgrade_to_standard_short_motion_lite | pulse_standard_short_motion_lite | 66.2s | The story has enough exact material for a standard creator-style short, but not enough clip dominance for premium Flash Lane. |

## Standard Overlay Contracts

### rss_5b3abe925b27a199
- Overlay verdict: ready_for_standard_short_overlay
- Caption style: creator_punch
- Max caption lines: 1
- Entity popups: GTA, BioShock, Red Dead
- Overlay command: `npm run studio:v2:standard-overlay -- --story-json test/output/flash_lane_downgrade_standard_story_rss_5b3abe925b27a199.json --scenes-json test/output/flash_lane_downgrade_standard_scenes_rss_5b3abe925b27a199.json --duration 66.2`
- Next actions: use_creator_overlay_contract; keep_flash_lane_blocked_until_more_official_motion_is_acquired

## Safety

- Report-only and local-only.
- Does not render, download media, call TTS, post, mutate the DB, touch Railway, trigger OAuth or switch production renderer.
- Downgrade recommendations are planning signals only. Live production routing still needs a separate reviewed change.
