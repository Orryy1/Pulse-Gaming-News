# Asset Acquisition Pro v1.4 - Verified Store Still Acquisition

Date: 2026-05-01

## What Was Built

Asset Acquisition Pro v1.4 promotes the safest local still-image path into a verified local acquisition proof.

It adds an optional verified-store mode to `npm run media:enrich-stills`:

```bash
npm run media:enrich-stills -- --dry-run --verified-store-metadata --require-verified-store
npm run media:enrich-stills -- --story STORY_ID --apply-local --verified-store-metadata --require-verified-store
```

The command can now:

- resolve missing Steam app titles from a Steam app id;
- re-run the v1.3 exact-store verification after metadata repair;
- reject Steam/IGDB assets unless the store title or slug verifies;
- apply verified stills locally only under `test/output`;
- preserve verified store provenance on every applied asset.

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

Apply-local writes only to local test output. It does not attach assets to production story rows.

## Local Proof

Command run:

```bash
npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --apply-local --verified-store-metadata --require-verified-store
```

Result:

- story: `rss_5b3abe925b27a199`
- files written: 3
- Steam metadata lookups: 7
- verified store stills applied: 3
- store app id: `3240220`
- resolved app title: `Grand Theft Auto V Enhanced`
- store match status: `verified`

Applied local files:

- `test/output/asset-acquisition-v11/assets/rss_5b3abe925b27a199/GTA_steam_hero_2e1b850bc46f8ba1.jpg`
- `test/output/asset-acquisition-v11/assets/rss_5b3abe925b27a199/GTA_steam_capsule_947dd9680e3da0d8.jpg`
- `test/output/asset-acquisition-v11/assets/rss_5b3abe925b27a199/GTA_steam_screenshot_380f4f7e4dd8bef5.jpg`

This did not make the story Studio V2 60-second eligible because the story still lacks enough exact coverage across the other discussed subject groups.

## Important Catch

v1.4 also caught a bad historical media match:

- story: `1szzhy9`
- historical Steam app id: `2580190`
- resolved title: `PlayStation VR2 App`
- result: rejected in verified-store-only mode

That asset had previously looked like useful Marathon/Steam media because it was a Steam URL. v1.4 correctly rejects it because the resolved app title does not match the story subject.

## Outputs

Generated local outputs:

- `test/output/asset_acquisition_v14_verified_store_dry_run.json`
- `test/output/asset_acquisition_v14_verified_store_dry_run.md`
- `test/output/asset_acquisition_v14_verified_store_apply_local.json`
- `test/output/asset_acquisition_v14_verified_store_apply_local.md`
- `test/output/asset_acquisition_v14_verified_store.json`
- `test/output/asset_acquisition_v14_verified_store.md`

## Validation

- `node --test tests/services/still-image-enrichment.test.js`: 14/14 pass.
- Targeted acquisition/Creator Studio suite: 91/91 pass.
- `npm test`: 1,582/1,582 pass.
- `npm run build`: pass.
- `npm run media:enrich-stills -- --limit 5 --dry-run --verified-store-metadata --require-verified-store`: pass.
- `npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --apply-local --verified-store-metadata --require-verified-store`: pass.
- `npm run ops:creator-studio -- --limit 5`: pass.
- `npm run ops:asset-acquisition -- --limit 5`: pass.

## Final Judgement

v1.4 is a useful local acquisition step, but it is still not enough for Studio V2 production.

It proves that verified store stills can be fetched locally and that bad store matches can be rejected. It also shows the next bottleneck: one verified game group is not enough for a 60-second premium Short when the script discusses multiple games, franchises or platform contexts.

## Next Recommended Phase

Build **Asset Acquisition Pro v1.5 - Multi-Entity Verified Store Search**:

1. for every required subject group, search Steam/IGDB by exact entity rather than relying on historical assets;
2. require at least one verified still per required game/franchise group;
3. reject platform/store app mismatches before download;
4. produce a per-entity coverage table;
5. only then attempt another Studio V2 still-deck proof render.
