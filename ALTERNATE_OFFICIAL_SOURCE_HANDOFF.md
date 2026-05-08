# Alternate Official Source Handoff

This report is local-only and report-only. It turns exhausted Flash Lane motion sources into exact alternate-source work.

## Summary

- Stories needing alternate sources: 6
- Entities needing alternate sources: 7
- Top priority story: rss_5b3abe925b27a199
- Downloads started: no
- Production touched: no

## Input Freshness

- Motion gap report: 2026-05-08T02:41:07.172Z
- Reference report: 2026-05-08T02:12:25.182Z

Warnings:
- reference_report_older_than_motion_gap: Official trailer references are older than the motion-gap report; rerun media:resolve-trailers before trusting remaining/excluded reference counts.
  Recommended: `npm run media:resolve-trailers -- --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`

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

| Story | Entity | Blocker | Attempts | Validated | Rejected | Source families | Top rejection | Remaining refs (provisional) | Excluded refs (provisional) |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| rss_5b3abe925b27a199 | BioShock | local_segment_validation_exhausted_current_motion_sources | 20 | 3 | 17 | 3 | segment_contains_low_detail_frame | 2 | 1 |
| rss_5b3abe925b27a199 | Red Dead | local_segment_validation_exhausted_current_motion_sources | 25 | 2 | 23 | 4 | segment_contains_black_frame | 1 | 1 |
| 1szzhy9 | Marathon | local_segment_validation_exhausted_current_motion_sources | 160 | 13 | 147 | 10 | segment_samples_too_repetitive | 8 | 2 |
| rss_0e2778be9f97ffa4 | Tales Of | local_segment_validation_exhausted_current_motion_sources | 12 | 1 | 11 | 2 | segment_samples_too_repetitive | 1 | 1 |
| rss_4105cb7c837252c3 | The Division | resolved_references_exhausted_before_segment_plan | 6 | 0 | 6 | 1 | segment_contains_black_frame | 0 | 1 |
| 1t0u9o4 | GTA | resolved_references_exhausted_and_entity_still_missing_from_validated_motion | 48 | 0 | 48 | 8 | segment_samples_too_repetitive | 0 | 8 |
| 1t0x9ui | Oblivion | resolved_references_exhausted_before_segment_plan | 6 | 0 | 6 | 1 | segment_lacks_gameplay_action_samples | 0 | 1 |

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
- source_family
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
- Validate operator intake: npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id rss_5b3abe925b27a199
- Rerun: npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
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
| steam | Red Dead Redemption 2 | RDR2 Launch Trailer (DE) | 6 | 6 | segment_contains_black_frame |
| steam | Red Dead Redemption 2 | RDR2 60 FPS Trailer (DE) | 6 | 5 | segment_contains_black_frame |

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
- source_family
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
- Validate operator intake: npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id rss_5b3abe925b27a199
- Rerun: npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
- If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6
- Then rerun: npm run studio:v2:motion-gap -- --story rss_5b3abe925b27a199

## 1szzhy9 - Marathon

- Title: Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists
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
| steam | Marathon | Marathon - Loop - EN | 16 | 16 | segment_samples_too_repetitive |
| steam | Marathon | Marathon \| Official Announce Trailer | 16 | 16 | segment_lacks_gameplay_action_samples |
| steam | Marathon | Marathon \| Reveal Cinematic Short - EN | 16 | 15 | segment_lacks_gameplay_action_samples |
| steam | Marathon | Vision of Marathon \| Bungie ViDoc | 16 | 15 | segment_contains_black_frame |
| steam | Marathon | Marathon - Accolades - EN | 16 | 15 | segment_samples_too_repetitive |
| steam | Marathon | Marathon Gameplay Trailer | 16 | 14 | segment_samples_too_repetitive |
| steam | Marathon | Marathon Pre-Order Story Trailer | 16 | 14 | segment_contains_black_frame |
| steam | Marathon | Launch Cinematic - EN | 16 | 14 | segment_lacks_gameplay_action_samples |
| steam | Marathon | Launch Gameplay Trailer | 16 | 14 | segment_lacks_gameplay_action_samples |
| steam | Marathon | Marathon - Cryo Unlock - EN | 16 | 14 | segment_samples_too_repetitive |

### Planned Searches

- Marathon official trailer
- Marathon gameplay trailer
- Marathon official gameplay
- Marathon platform storefront trailer

### Manual Official Source Intake

- Mode: operator_supplied_reference_only
- Downloads allowed by default: no
- Priority: Current Steam/source-family validation is exhausted; prefer a different official source family.

Required fields:
- entity
- official_source_url
- source_owner
- source_type
- source_family
- source_title
- evidence_of_officialness
- entity_match_notes
- operator_notes

Acceptance checks:
- The source must be for Marathon, not only the publisher or a loosely related franchise.
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

- Find a non-exhausted official source for Marathon.
- Record provenance before any local frame or segment work.
- Validate operator intake: npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id 1szzhy9
- Rerun: npm run media:resolve-trailers -- --story-id 1szzhy9 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
- If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id 1szzhy9 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6
- Then rerun: npm run studio:v2:motion-gap -- --story 1szzhy9

## rss_0e2778be9f97ffa4 - Tales Of

- Title: The next Tales Of remaster has leaked, and it's probably not what you're expecting
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
| steam | Tales of the Shire: A The Lord of The Rings™ Game | Tales of the Shire - Available Now | 6 | 6 | segment_samples_too_repetitive |
| steam | Tales of the Shire: A The Lord of The Rings™ Game | Tales of the Shire - Gameplay Trailer | 6 | 5 | segment_lacks_gameplay_action_samples |

### Planned Searches

- Tales Of official trailer
- Tales Of gameplay trailer
- Tales Of official gameplay
- Tales Of platform storefront trailer

### Manual Official Source Intake

- Mode: operator_supplied_reference_only
- Downloads allowed by default: no
- Priority: Current Steam/source-family validation is exhausted; prefer a different official source family.

Required fields:
- entity
- official_source_url
- source_owner
- source_type
- source_family
- source_title
- evidence_of_officialness
- entity_match_notes
- operator_notes

Acceptance checks:
- The source must be for Tales Of, not only the publisher or a loosely related franchise.
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

- Find a non-exhausted official source for Tales Of.
- Record provenance before any local frame or segment work.
- Validate operator intake: npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id rss_0e2778be9f97ffa4
- Rerun: npm run media:resolve-trailers -- --story-id rss_0e2778be9f97ffa4 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
- If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id rss_0e2778be9f97ffa4 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6
- Then rerun: npm run studio:v2:motion-gap -- --story rss_0e2778be9f97ffa4

## rss_4105cb7c837252c3 - The Division

- Title: A New The Division PC Game Is Out Right Now, And It's Free
- Blocker: resolved_references_exhausted_before_segment_plan
- Motion status: current_references_exhausted_needs_new_official_source_before_sampling
- Motion recommendation: continue_segment_scan_with_resume
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
| steam | The Division 2 - Warlords of New York - Expansion | Trailer | 6 | 6 | segment_contains_black_frame |

### Planned Searches

- The Division official trailer
- The Division gameplay trailer
- The Division Steam trailer
- The Division gameplay

### Manual Official Source Intake

- Mode: operator_supplied_reference_only
- Downloads allowed by default: no
- Priority: Current Steam/source-family validation is exhausted; prefer a different official source family.

Required fields:
- entity
- official_source_url
- source_owner
- source_type
- source_family
- source_title
- evidence_of_officialness
- entity_match_notes
- operator_notes

Acceptance checks:
- The source must be for The Division, not only the publisher or a loosely related franchise.
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

- Find a non-exhausted official source for The Division.
- Record provenance before any local frame or segment work.
- Validate operator intake: npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id rss_4105cb7c837252c3
- Rerun: npm run media:resolve-trailers -- --story-id rss_4105cb7c837252c3 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
- If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id rss_4105cb7c837252c3 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6
- Then rerun: npm run studio:v2:motion-gap -- --story rss_4105cb7c837252c3

## 1t0u9o4 - GTA

- Title: Don’t Expect Product Placement in GTA 6 — the CEO of Take-Two Says It Won't Do Real World Brand Partnerships Because 'All the Brands Are Made Up'
- Blocker: resolved_references_exhausted_and_entity_still_missing_from_validated_motion
- Motion status: current_references_exhausted_needs_new_official_source_before_sampling
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
| steam | Grand Theft Auto V Enhanced | Agents of Sabotage | 6 | 6 | segment_samples_too_repetitive |
| steam | Grand Theft Auto V Enhanced | Criminal Enterprises | 6 | 6 | segment_contains_black_frame |
| steam | Grand Theft Auto V Enhanced | Los Santos Tuners | 6 | 6 | segment_contains_low_detail_frame |
| steam | Grand Theft Auto V Enhanced | San Andreas Mercenaries | 6 | 6 | segment_samples_too_repetitive |
| steam | Grand Theft Auto V Enhanced | Los Santos Drug Wars | 6 | 6 | segment_samples_too_repetitive |
| steam | Grand Theft Auto V Enhanced | The Chop Shop | 6 | 6 | segment_contains_title_or_rating_card |
| steam | Grand Theft Auto V Enhanced | Cluckin' Bell Farm Raid | 6 | 6 | segment_samples_too_repetitive |
| steam | Grand Theft Auto V Enhanced | Bottom Dollar Bounties | 6 | 6 | segment_contains_low_detail_frame |

### Planned Searches

- GTA official trailer
- GTA gameplay trailer
- GTA Steam trailer
- GTA gameplay

### Manual Official Source Intake

- Mode: operator_supplied_reference_only
- Downloads allowed by default: no
- Priority: Current Steam/source-family validation is exhausted; prefer a different official source family.

Required fields:
- entity
- official_source_url
- source_owner
- source_type
- source_family
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
- Validate operator intake: npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id 1t0u9o4
- Rerun: npm run media:resolve-trailers -- --story-id 1t0u9o4 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
- If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id 1t0u9o4 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6
- Then rerun: npm run studio:v2:motion-gap -- --story 1t0u9o4

## 1t0x9ui - Oblivion

- Title: It's been a year since release and Oblivion Remastered is still broken- Digital Foundry
- Blocker: resolved_references_exhausted_before_segment_plan
- Motion status: current_references_exhausted_needs_new_official_source_before_sampling
- Motion recommendation: continue_segment_scan_with_resume
- Top rejection: segment_lacks_gameplay_action_samples
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
| steam | The Elder Scrolls IV: Oblivion Remastered | Launch Trailer | 6 | 6 | segment_lacks_gameplay_action_samples |

### Planned Searches

- Oblivion official trailer
- Oblivion gameplay trailer
- Oblivion Steam trailer
- Oblivion gameplay

### Manual Official Source Intake

- Mode: operator_supplied_reference_only
- Downloads allowed by default: no
- Priority: Current Steam/source-family validation is exhausted; prefer a different official source family.

Required fields:
- entity
- official_source_url
- source_owner
- source_type
- source_family
- source_title
- evidence_of_officialness
- entity_match_notes
- operator_notes

Acceptance checks:
- The source must be for Oblivion, not only the publisher or a loosely related franchise.
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

- Find a non-exhausted official source for Oblivion.
- Record provenance before any local frame or segment work.
- Validate operator intake: npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id 1t0x9ui
- Rerun: npm run media:resolve-trailers -- --story-id 1t0x9ui --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5
- If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id 1t0x9ui --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6
- Then rerun: npm run studio:v2:motion-gap -- --story 1t0x9ui

## Safety

- No Railway, OAuth, DB, scheduler, production renderer or posting behaviour changed.
- This report does not download trailer clips, scrape browsers, scrape social platforms or render video.
- Any future media extraction must stay under `test/output` unless explicitly approved later.
