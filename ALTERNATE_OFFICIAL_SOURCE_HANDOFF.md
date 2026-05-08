# Alternate Official Source Handoff

This report is local-only and report-only. It turns exhausted Flash Lane motion sources into exact alternate-source work.

## Summary

- Stories needing alternate sources: 1
- Entities needing alternate sources: 3
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
| rss_5b3abe925b27a199 | GTA | local_segment_validation_exhausted_current_motion_sources | 55 | 1 | 54 | 9 | segment_samples_too_repetitive | 8 | 1 |
| rss_5b3abe925b27a199 | BioShock | local_segment_validation_exhausted_current_motion_sources | 20 | 3 | 17 | 3 | segment_contains_low_detail_frame | 3 | 0 |
| rss_5b3abe925b27a199 | Red Dead | local_segment_validation_exhausted_current_motion_sources | 13 | 1 | 12 | 2 | segment_contains_black_frame | 2 | 0 |

## rss_5b3abe925b27a199 - GTA

- Title: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
- Blocker: local_segment_validation_exhausted_current_motion_sources
- Motion status: alternate_source_required
- Motion recommendation: find_alternate_official_source_family
- Top rejection: segment_samples_too_repetitive
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
| steam | 3240220 | Steam movie 832632 | 7 | 7 | segment_samples_too_repetitive |
| steam | Grand Theft Auto V Enhanced | Criminal Enterprises | 6 | 6 | segment_contains_black_frame |
| steam | Grand Theft Auto V Enhanced | Los Santos Tuners | 6 | 6 | segment_contains_low_detail_frame |
| steam | Grand Theft Auto V Enhanced | San Andreas Mercenaries | 6 | 6 | segment_samples_too_repetitive |
| steam | Grand Theft Auto V Enhanced | Los Santos Drug Wars | 6 | 6 | segment_samples_too_repetitive |
| steam | Grand Theft Auto V Enhanced | The Chop Shop | 6 | 6 | segment_contains_title_or_rating_card |
| steam | Grand Theft Auto V Enhanced | Cluckin' Bell Farm Raid | 6 | 6 | segment_samples_too_repetitive |
| steam | Grand Theft Auto V Enhanced | Bottom Dollar Bounties | 6 | 6 | segment_contains_low_detail_frame |
| steam | Grand Theft Auto V Enhanced | A Safehouse in the Hills - NR | 6 | 5 | segment_lacks_gameplay_action_samples |

### Planned Searches

- GTA official trailer
- GTA gameplay trailer
- GTA official gameplay
- GTA platform storefront trailer

### Manual Official Source Intake

- Mode: operator_supplied_reference_only
- Downloads allowed by default: no
- Priority: Current Steam/source-family validation is exhausted; prefer a different official source family.

Required fields:
- entity
- official_source_url
- source_owner
- source_type
- source_title
- evidence_of_officialness
- entity_match_notes
- operator_notes

Acceptance checks:
- The source must be for GTA, not only the publisher or a loosely related franchise.
- The URL owner must be official: publisher, developer, platform storefront or verified official channel.
- The source must not be a fan reupload, compilation, social repost, reaction video or generic gaming footage.
- The first usable window must not be dominated by rating boards, black frames, logos or title cards.
- The source must add a new source family when existing families are exhausted.
- Provenance must be recorded before any local frame or segment validation.
- Downloads remain disabled until a later apply-local validation command is run.

Reject if:
- wrong_entity
- publisher_context_only
- unofficial_reupload
- social_repost
- rating_or_logo_only_window
- duplicate_exhausted_source_family
- no_provenance

### Next Safe Actions

- Find a non-exhausted official source for GTA.
- Record provenance before any local frame or segment work.
- Rerun: npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
- If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6
- Then rerun: npm run studio:v2:motion-gap -- --story rss_5b3abe925b27a199

## rss_5b3abe925b27a199 - BioShock

- Title: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
- Blocker: local_segment_validation_exhausted_current_motion_sources
- Motion status: alternate_source_required
- Motion recommendation: find_alternate_official_source_family
- Top rejection: segment_contains_low_detail_frame
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
| steam | BioShock Infinite | BioShock Infinite - Icarus | 6 | 6 | segment_contains_low_detail_frame |
| steam | 8870 | Steam movie 10985 | 8 | 6 | segment_action_score_below_flash_threshold |
| steam | BioShock Infinite | BioShock Infinite - Songbird Lamb | 6 | 5 | segment_contains_low_detail_frame |

### Planned Searches

- BioShock official trailer
- BioShock gameplay trailer
- BioShock official gameplay
- BioShock platform storefront trailer

### Manual Official Source Intake

- Mode: operator_supplied_reference_only
- Downloads allowed by default: no
- Priority: Current Steam/source-family validation is exhausted; prefer a different official source family.

Required fields:
- entity
- official_source_url
- source_owner
- source_type
- source_title
- evidence_of_officialness
- entity_match_notes
- operator_notes

Acceptance checks:
- The source must be for BioShock, not only the publisher or a loosely related franchise.
- The URL owner must be official: publisher, developer, platform storefront or verified official channel.
- The source must not be a fan reupload, compilation, social repost, reaction video or generic gaming footage.
- The first usable window must not be dominated by rating boards, black frames, logos or title cards.
- The source must add a new source family when existing families are exhausted.
- Provenance must be recorded before any local frame or segment validation.
- Downloads remain disabled until a later apply-local validation command is run.

Reject if:
- wrong_entity
- publisher_context_only
- unofficial_reupload
- social_repost
- rating_or_logo_only_window
- duplicate_exhausted_source_family
- no_provenance

### Next Safe Actions

- Find a non-exhausted official source for BioShock.
- Record provenance before any local frame or segment work.
- Rerun: npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
- If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6
- Then rerun: npm run studio:v2:motion-gap -- --story rss_5b3abe925b27a199

## rss_5b3abe925b27a199 - Red Dead

- Title: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
- Blocker: local_segment_validation_exhausted_current_motion_sources
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
| steam | Red Dead Redemption 2 | RDR2 Launch Trailer (GB) | 6 | 6 | segment_contains_black_frame |
| steam | 1174180 | Steam movie 254554 | 7 | 6 | segment_contains_black_frame |

### Planned Searches

- Red Dead official trailer
- Red Dead gameplay trailer
- Red Dead official gameplay
- Red Dead platform storefront trailer

### Manual Official Source Intake

- Mode: operator_supplied_reference_only
- Downloads allowed by default: no
- Priority: Current Steam/source-family validation is exhausted; prefer a different official source family.

Required fields:
- entity
- official_source_url
- source_owner
- source_type
- source_title
- evidence_of_officialness
- entity_match_notes
- operator_notes

Acceptance checks:
- The source must be for Red Dead, not only the publisher or a loosely related franchise.
- The URL owner must be official: publisher, developer, platform storefront or verified official channel.
- The source must not be a fan reupload, compilation, social repost, reaction video or generic gaming footage.
- The first usable window must not be dominated by rating boards, black frames, logos or title cards.
- The source must add a new source family when existing families are exhausted.
- Provenance must be recorded before any local frame or segment validation.
- Downloads remain disabled until a later apply-local validation command is run.

Reject if:
- wrong_entity
- publisher_context_only
- unofficial_reupload
- social_repost
- rating_or_logo_only_window
- duplicate_exhausted_source_family
- no_provenance

### Next Safe Actions

- Find a non-exhausted official source for Red Dead.
- Record provenance before any local frame or segment work.
- Rerun: npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
- If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6
- Then rerun: npm run studio:v2:motion-gap -- --story rss_5b3abe925b27a199

## Safety

- No Railway, OAuth, DB, scheduler, production renderer or posting behaviour changed.
- This report does not download trailer clips, scrape browsers, scrape social platforms or render video.
- Any future media extraction must stay under `test/output` unless explicitly approved later.
