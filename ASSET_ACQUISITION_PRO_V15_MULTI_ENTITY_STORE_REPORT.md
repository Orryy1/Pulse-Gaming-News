# Asset Acquisition Pro v1.5 - Multi-Entity Verified Store Search

Date: 2026-05-01

## What Was Built

Asset Acquisition Pro v1.5 adds local multi-entity Steam still search to `npm run media:enrich-stills`.

New command options:

```bash
--multi-entity-store-search
--max-store-search-entities <n>
--max-store-assets-per-entity <n>
--max-downloads-per-story <n>
```

Useful proof command:

```bash
npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --apply-local --multi-entity-store-search --verified-store-metadata --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12
```

The system now searches Steam per required game/franchise entity, stamps app id/title/query provenance and then runs the v1.3 verification gate before anything can be accepted or downloaded locally.

## Local Proof

Story:

- `rss_5b3abe925b27a199`
- title: `GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One`

Verified entity coverage:

| entity | Steam app id | resolved app title | assets |
| --- | --- | --- | ---: |
| GTA | `3240220` | `Grand Theft Auto V Enhanced` | 3 |
| Red Dead | `1174180` | `Red Dead Redemption 2` | 3 |
| BioShock | `8870` | `BioShock Infinite` | 3 |

Apply-local result:

- files written: 10
- rejected candidates: 6
- all accepted store assets: `verified`
- required subject groups covered: GTA, Red Dead, BioShock

Applied local directory:

- `test/output/asset-acquisition-v11/assets/rss_5b3abe925b27a199/`

## Outputs

Generated local outputs:

- `test/output/asset_acquisition_v15_multi_entity_dry_run.json`
- `test/output/asset_acquisition_v15_multi_entity_dry_run.md`
- `test/output/asset_acquisition_v15_multi_entity_apply_local.json`
- `test/output/asset_acquisition_v15_multi_entity_apply_local.md`
- `test/output/asset_acquisition_v15_multi_entity_store.json`
- `test/output/asset_acquisition_v15_multi_entity_store.md`

## Why This Matters

v1.4 could repair provenance on assets that already existed, but it could not fill missing subject groups. v1.5 fills that gap by searching each required entity directly.

This is the first local acquisition proof that produces a genuinely multi-subject still deck instead of more of the same GTA-only imagery.

## Current Limitation

Creator Studio readiness still stays AMBER/short_only because the applied assets are local artefacts, not production DB assets and Studio V2 has not yet consumed this v1.5 deck.

Do not switch production rendering based on this alone.

## Safety

- Local-only.
- Still images only.
- No trailer or video downloads.
- No browser scraping or yt-dlp.
- No production DB mutation.
- No Railway changes.
- No OAuth.
- No posting.
- No hard production gate.
- No Studio V2 production switch.

## Validation

- `node --test tests/services/still-image-enrichment.test.js`: 15/15 pass.
- Targeted acquisition/Creator Studio suite: 57/57 pass.
- `npm test`: 1,583/1,583 pass.
- `npm run build`: pass.
- v1.5 dry-run command: pass.
- v1.5 apply-local command: pass.

## Final Judgement

v1.5 solves the biggest still-image acquisition weakness found so far: missing per-entity coverage.

It is still local-only and should not be promoted to production until a Studio V2 verified-deck proof render confirms that these assets improve the actual video output.

## Next Recommended Phase

Build **Studio V2 Verified Multi-Entity Deck Proof v1**:

1. ingest `asset_acquisition_v15_multi_entity_apply_local.json`;
2. build a Studio V2 media package from the applied local assets;
3. preserve per-entity provenance in the render report;
4. render one local proof video only;
5. run forensic QA, repeat analysis, subtitle/outro/audio QA and contact sheets;
6. decide whether verified multi-entity still decks are enough or trailer-frame enrichment is still required.
