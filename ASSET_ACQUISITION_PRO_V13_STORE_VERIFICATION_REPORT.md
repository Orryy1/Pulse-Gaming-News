# Asset Acquisition Pro v1.3 - Exact Store App Verification

Date: 2026-05-01

## What Was Built

Asset Acquisition Pro v1.3 tightens the exact-subject gate so Steam and IGDB storefront assets only count as premium subject media when the returned store app is verified.

Store assets now carry or report:

- `store_asset_source`
- `store_app_id`
- `store_app_title`
- `store_app_slug`
- `store_matched_query`
- `store_match_status`
- `store_match_verified`
- `store_match_reason`

Steam assets are verified against app title plus matched query. IGDB assets are verified against title or slug. Store assets with a missing title or slug are treated as unverified historical media and are not counted for premium readiness.

## Why This Matters

v1.2 proved that generic assets should not inflate Studio V2 readiness. v1.3 goes one step deeper: even a Steam CDN URL is not enough on its own. A wrong Steam app can look official while being the wrong subject, so v1.3 requires provenance that says which app the asset actually came from.

This prevents cases like:

- a Metro asset counting inside a BioShock or Take-Two story;
- a loosely matched Steam app counting because only the URL looked official;
- historical cached assets being promoted without knowing the returned app title.

## Implementation Notes

The exact-subject matcher now verifies storefront candidates before classifying them as exact game, franchise or platform matches.

Future acquisition paths now preserve verification metadata:

- Steam direct search assets now store app id, app title and matched query.
- Hunter-stamped Steam assets now store app id, app title and matched query.
- Script-level Steam enrichment now stores app id, app title and matched query.
- IGDB image enrichment now fetches slug and stores IGDB id, title, slug and matched query.
- Downloaded image provenance carries these fields through to the deck.

## Outputs

Generated local outputs:

- `test/output/asset_acquisition_v13_store_verification.json`
- `test/output/asset_acquisition_v13_store_verification.md`
- `test/output/creator_studio_asset_acquisition_v13_store_verification.json`
- updated `test/output/media_provenance.json`
- updated `test/output/visual_deck.json`
- updated `test/output/visual_deck.md`

## Local Sample Result

Latest `npm run ops:asset-acquisition -- --limit 5`:

- stories scanned: 5
- Studio V2 60-second eligible stories: 0
- premium candidates: 0
- store assets inspected: 37
- verified store assets: 0
- missing title or slug provenance: 37

| story | exact verified assets | runtime | Studio V2 60s eligible | main reason |
| --- | ---: | --- | --- | --- |
| `rss_5b3abe925b27a199` | 0 | blog_only | false | historical Steam assets lack app-title provenance and multi-franchise coverage is incomplete |
| `1szzhy9` | 0 | blog_only | false | historical Steam assets lack app-title provenance |
| `rss_0e2778be9f97ffa4` | 0 | blog_only | false | not enough verified exact store assets |
| `rss_4105cb7c837252c3` | 0 | blog_only | false | not enough verified exact store assets |
| `rss_93fdf53a0c1211ef` | 1 | blog_only | false | below the four-exact-still minimum |

The important result is conservative: v1.3 disqualifies historical Steam images unless their app title is known. Future acquisition will stamp that metadata, so newly acquired assets can be counted when they really match.

## Safety

- No deployment.
- No Railway changes.
- No OAuth.
- No production DB mutation.
- No posting.
- No hard production gate.
- No Studio V2 production switch.
- No trailer or video downloads.
- No browser scraping or yt-dlp.

The v1.3 report is read-only. It performs no live store lookups while reporting; it checks the provenance already present on candidate assets.

## Validation

- `node --test tests/services/igdb-images.test.js tests/services/script-game-enrichment.test.js`: 35/35 pass.
- `node --test tests/services/asset-acquisition-exact-subject.test.js tests/services/asset-acquisition-pro.test.js tests/services/still-image-enrichment.test.js tests/services/creator-studio-os.test.js tests/services/studio-v2-still-deck-ingestion.test.js tests/services/studio-v2-regressions.test.js tests/services/igdb-images.test.js tests/services/script-game-enrichment.test.js`: 126/126 pass.
- `npm test`: 1,579/1,579 pass.
- `npm run build`: pass.
- `npm run ops:asset-acquisition -- --fixture`: pass.
- `npm run media:enrich-stills -- --fixture --dry-run`: pass.
- `npm run ops:creator-studio -- --fixture`: pass.
- `npm run ops:asset-acquisition -- --limit 5`: pass.
- `npm run media:enrich-stills -- --limit 5 --dry-run`: pass.
- `npm run ops:creator-studio -- --limit 5`: pass.

## Final Judgement

v1.3 successfully prevents unverified Steam and IGDB assets from inflating premium readiness.

No current sampled story is a valid Studio V2 60-second proof candidate.

Do not render another Studio V2 still-deck proof until acquisition produces at least one story with enough verified exact-subject assets across enough unique subject groups.

## Next Recommended Phase

Build **Asset Acquisition Pro v1.4 - Local Verified Still Acquisition**:

1. run v1.1 still acquisition in apply-local mode for a selected safe story;
2. ensure every fetched Steam/IGDB asset carries app id, app title, slug/query provenance;
3. rerun v1.3 verification on the applied local assets;
4. only render Studio V2 if the story reaches the exact-subject threshold.
