# Asset Acquisition Pro v1.6 - Gameplay Still Preference

Generated: 2026-05-08

## What Changed

Asset Acquisition Pro can now prefer gameplay-like stills over covers, capsules and key art when building local still-image enrichment plans.

This is aimed directly at the Flash Lane problem where a story technically has exact-subject assets but they are mostly boring covers or title-card style images.

## Safety

- Local/reporting path only.
- Dry-run remains the default.
- Apply-local still writes only under `test/output`.
- No trailer/video downloads.
- No browser scraping.
- No Railway, OAuth, token, production DB, scheduler, renderer or posting changes.

## New Command Shape

```powershell
npm run media:enrich-stills -- --fixture --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 3 --max-store-assets-per-entity 3 --max-downloads-per-story 9
```

For a real story, keep it local:

```powershell
npm run media:enrich-stills -- --story STORY_ID --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12
```

## Fixture Result

- Stories inspected: 2
- Files written: 0
- Gameplay still preference: true
- Demo GTA/Xbox story: 4 gameplay stills, 0 cover-like stills
- Off-brand House of the Dragon fixture: no acquisition

## Why It Matters

This does not make Studio V2 production-ready by itself. It fixes a specific upstream problem: exact-subject asset counts were being inflated by covers, capsules and promotional art. The next Flash Lane repair pass can now request actual screenshots/gameplay-style stills before another proof render.

## Validation

- `node --test tests\services\still-image-enrichment.test.js tests\services\asset-acquisition-exact-subject.test.js tests\services\studio-v2-proof-candidates.test.js`
- `npm run media:enrich-stills -- --fixture --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 3 --max-store-assets-per-entity 3 --max-downloads-per-story 9`
- `npm test`
- `npm run build`

All passed.
