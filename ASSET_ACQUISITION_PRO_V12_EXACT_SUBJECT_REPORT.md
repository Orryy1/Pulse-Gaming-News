# Asset Acquisition Pro v1.2 - Exact-Subject Still Matching

Date: 2026-05-01

## What Was Built

Asset Acquisition Pro v1.2 adds an exact-subject gate to the local/reporting media-acquisition layer.

It classifies every media candidate as:

- `exact_game_match`
- `exact_franchise_match`
- `exact_platform_match`
- `publisher_context_only`
- `article_context_only`
- `generic_store_asset`
- `generic_stock_or_filler`
- `unsafe_or_rejected`

Every candidate now carries:

- `subject_match_quality`
- `subject_match_reason`
- `counted_for_premium`
- `counted_for_standard`
- `exact_subject_group`
- `rejection_or_downgrade_reason`

These fields are written into media provenance, visual decks, Asset Acquisition Pro output and Creator Studio OS media inventory.

## Why v1 Still-Deck Ingestion Failed

The Studio V2 still-deck proof showed that loosely related stills can make a video worse:

- generic store/platform assets can look topical in a spreadsheet but wrong in a render;
- repeated stills inflate deck size without adding scene variety;
- publisher logos and article images help context but do not create premium subject coverage;
- v1.1 could project readiness improvement even when the actual deck was not visually rich enough.

v1.2 separates context assets from subject assets so generic media no longer counts towards Studio V2 premium readiness.

## Runtime Gate

Current local-only v1.2 rules:

- 0-1 exact-subject assets: `blog_only` or `reject_visuals`
- 2-3 exact-subject assets: `short_only_30_45`
- 4-5 exact-subject assets: `standard_short_45_60`
- 6+ exact-subject assets, or enough exact stills plus approved clips/frames: `premium_short_60_75`

Studio V2 60-second eligibility also requires:

- enough exact stills or exact stills plus clips/frames;
- enough unique exact-subject groups;
- low repeated asset pairs;
- no unsafe thumbnail-critical assets;
- no more than one generic fallback card;
- at least eight scene-beat capacity.

This remains reporting only. No hard production gate was enabled.

## Local Sample Result

Latest `npm run ops:asset-acquisition -- --limit 5`:

| story | v1/v1.1 apparent route | exact assets | runtime | Studio V2 60s eligible |
| --- | --- | ---: | --- | --- |
| `rss_5b3abe925b27a199` | AMBER/short_only | 17 | premium_short_60_75 | false |
| `1szzhy9` | RED/blog_only to GREEN/premium_ready estimate | 0 | blog_only | false |
| `rss_0e2778be9f97ffa4` | RED/short_only to AMBER/short_only estimate | 0 | blog_only | false |
| `rss_4105cb7c837252c3` | RED/short_only to AMBER/short_only estimate | 0 | blog_only | false |
| `rss_93fdf53a0c1211ef` | AMBER/short_only | 1 | blog_only | false |

No sampled story became genuinely Studio V2 60-second eligible.

`rss_5b3abe925b27a199` has many exact-labelled GTA assets, but it still fails the Studio V2 gate because the story discusses multiple Take-Two/franchise possibilities and does not have enough exact subject-group coverage for the named comparison points.

`1szzhy9` is the clearest example of v1.2 doing its job: v1.1 projected readiness improvement, but v1.2 disqualifies the generic/store/context media and leaves it at zero exact-subject assets.

## Outputs

Generated local outputs:

- `test/output/asset_acquisition_v12_exact_subject.json`
- `test/output/asset_acquisition_v12_exact_subject.md`
- `test/output/media_provenance.json`
- `test/output/visual_deck.json`
- `test/output/visual_deck.md`
- `test/output/creator_studio_asset_acquisition_v12_exact_subject.json`

## Safety

- No deployment.
- No Railway changes.
- No OAuth.
- No production DB mutation.
- No posting.
- No Studio V2 production switch.
- No hard production gates.
- No trailer/video downloads.
- No browser scraping or yt-dlp.

## Final Judgement

v1.2 prevents generic assets from inflating Studio V2 readiness in the reporting layer.

No current sampled story is a valid Studio V2 60-second proof candidate.

The next proof render should wait until Asset Acquisition can provide at least one story with six or more exact-subject assets across enough subject groups, or two exact stills plus approved clips/frames with low repetition.

## Next Recommended Phase

Build **Asset Acquisition Pro v1.3 - Exact Store App Verification**:

1. store Steam app id, app title and matched query for every Steam asset;
2. reject Steam assets when the returned app title does not match the story subject;
3. add IGDB slug/title verification;
4. require per-entity coverage for multi-game publisher stories;
5. then rerun the Studio V2 still-deck proof only if v1.2 reports a real candidate.
