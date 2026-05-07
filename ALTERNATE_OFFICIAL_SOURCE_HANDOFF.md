# Alternate Official Source Handoff

This report is local-only and report-only. It turns exhausted Flash Lane motion sources into exact alternate-source work.

## Summary

- Stories needing alternate sources: 2
- Entities needing alternate sources: 2
- Top priority story: rss_5b3abe925b27a199
- Downloads started: no
- Production touched: no

## Allowed Source Policy

- Allowed: Steam official movie metadata
- Allowed: IGDB official video references
- Allowed: official publisher/developer press pages
- Allowed: official publisher/developer/platform YouTube URLs as references only
- Allowed: platform storefront pages
- Forbidden: random YouTube reuploads
- Forbidden: TikTok/Reels/Shorts reposts
- Forbidden: browser-cookie scraping
- Forbidden: unofficial gameplay compilations
- Forbidden: stock people or generic gaming footage
- Forbidden: rating-card/title-card windows already rejected by local validation

## Entity Handoff

| Story | Entity | Blocker | Attempts | Validated | Rejected | Source families | Top rejection | Remaining refs | Excluded refs |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| rss_5b3abe925b27a199 | Red Dead | resolved_references_exhausted_and_entity_still_missing_from_validated_motion | 18 | 0 | 18 | 2 | segment_contains_black_frame | 0 | 2 |
| 1szzhy9 | Marathon | local_segment_validation_exhausted_current_motion_sources | 63 | 2 | 61 | 10 | segment_lacks_gameplay_action_samples | 0 | 0 |

## rss_5b3abe925b27a199 - Red Dead

- Title: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
- Blocker: resolved_references_exhausted_and_entity_still_missing_from_validated_motion
- Motion status: alternate_source_required
- Motion recommendation: find_alternate_official_source_family
- Top rejection: segment_contains_black_frame
- Planned searches: 4

### Recommended Source Types

- P1: official_publisher_or_developer_trailer_page (reference_only_first) - Best provenance when Steam/IGDB has no usable window or only rating/logo/title cards.
- P2: platform_storefront_video_reference (reference_only_first) - Use a non-exhausted storefront family because the current Steam movie family has failed local validation.
- P3: igdb_video_reference (reference_only_first) - Useful as a second official index when storefront trailers are missing or exhausted.
- P4: official_youtube_channel_url (reference_only_no_download_by_default) - Accept only official publisher/developer/platform channels; do not ingest reuploads.
- P5: official_press_kit_stills (still_downgrade_path) - If no usable motion exists, official stills can support a shorter standard/card lane but not premium motion.

### Exhausted / Attempted Source Families

| Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | ---: | ---: | --- |
| steam | Red Dead Redemption 2 | RDR2 60 FPS Trailer (DE) | 9 | 9 | segment_contains_black_frame |
| steam | Red Dead Redemption 2 | RDR2 Launch Trailer (DE) | 9 | 9 | segment_contains_black_frame |

### Planned Searches

- Red Dead official trailer
- Red Dead gameplay trailer
- Red Dead Steam trailer
- Red Dead gameplay

### Next Safe Actions

- Find a non-exhausted official source for Red Dead.
- Record provenance before any local frame or segment work.
- Rerun: npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
- If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6
- Then rerun: npm run studio:v2:motion-gap -- --story rss_5b3abe925b27a199

## 1szzhy9 - Marathon

- Title: Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists
- Blocker: local_segment_validation_exhausted_current_motion_sources
- Motion status: alternate_source_required
- Motion recommendation: find_alternate_official_source_family
- Top rejection: segment_lacks_gameplay_action_samples
- Planned searches: 4

### Recommended Source Types

- P0: verify_exact_store_or_official_game_page_first (metadata_check) - Do not source motion until the exact game/franchise target is verified.
- P1: official_publisher_or_developer_trailer_page (reference_only_first) - Best provenance when Steam/IGDB has no usable window or only rating/logo/title cards.
- P2: platform_storefront_video_reference (reference_only_first) - Use a non-exhausted storefront family because the current Steam movie family has failed local validation.
- P3: igdb_video_reference (reference_only_first) - Useful as a second official index when storefront trailers are missing or exhausted.
- P4: official_youtube_channel_url (reference_only_no_download_by_default) - Accept only official publisher/developer/platform channels; do not ingest reuploads.
- P5: official_press_kit_stills (still_downgrade_path) - If no usable motion exists, official stills can support a shorter standard/card lane but not premium motion.

### Exhausted / Attempted Source Families

| Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | ---: | ---: | --- |
| steam | Marathon | Marathon Gameplay Trailer | 9 | 7 | segment_lacks_gameplay_action_samples |
| steam | Marathon | Marathon - Loop - EN | 6 | 6 | segment_samples_too_repetitive |
| steam | Marathon | Marathon Pre-Order Story Trailer | 6 | 6 | segment_contains_low_detail_frame |
| steam | Marathon | Marathon \| Reveal Cinematic Short - EN | 6 | 6 | segment_lacks_gameplay_action_samples |
| steam | Marathon | Launch Cinematic - EN | 6 | 6 | segment_lacks_gameplay_action_samples |
| steam | Marathon | Vision of Marathon \| Bungie ViDoc | 6 | 6 | segment_lacks_gameplay_action_samples |
| steam | Marathon | Launch Gameplay Trailer | 6 | 6 | segment_lacks_gameplay_action_samples |
| steam | Marathon | Marathon - Accolades - EN | 6 | 6 | segment_lacks_gameplay_action_samples |
| steam | Marathon | Marathon - Cryo Unlock - EN | 6 | 6 | segment_lacks_gameplay_action_samples |
| steam | Marathon | Marathon \| Official Announce Trailer | 6 | 6 | segment_lacks_gameplay_action_samples |

### Planned Searches

- Marathon official trailer
- Marathon gameplay trailer
- Marathon official gameplay
- Marathon platform storefront trailer

### Next Safe Actions

- Find a non-exhausted official source for Marathon.
- Record provenance before any local frame or segment work.
- Rerun: npm run media:resolve-trailers -- --story-id 1szzhy9 --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
- If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id 1szzhy9 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6
- Then rerun: npm run studio:v2:motion-gap -- --story 1szzhy9

## Safety

- No Railway, OAuth, DB, scheduler, production renderer or posting behaviour changed.
- This report does not download trailer clips, scrape browsers, scrape social platforms or render video.
- Any future media extraction must stay under `test/output` unless explicitly approved later.
