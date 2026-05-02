# Asset Acquisition Pro v1.1 Report

Date: 2026-05-01

## What Became Safely Actionable

Asset Acquisition Pro v1.1 promotes the safest slice of the v1 media system into an explicit local still-image enrichment path.

It adds:

- `npm run media:enrich-stills`;
- dry-run by default;
- `--apply-local` mode for local/test asset downloads only;
- entity-aware still-image selection using the Asset Acquisition Pro v1 candidate pool;
- allowed-source filtering for Steam, IGDB, article, official and platform stills;
- trailer/video source rejection;
- duplicate URL/hash rejection;
- unsafe portrait/person rejection;
- relevance and visual-diversity checks;
- per-asset provenance records;
- Creator Studio before/after readiness projections;
- Creator Studio control-room integration as report-only output.

No production story rows, Railway variables, OAuth state, scheduler settings, publish behaviour or render defaults are changed.

## Command

```bash
npm run media:enrich-stills
```

Useful forms:

```bash
npm run media:enrich-stills -- --fixture --dry-run
npm run media:enrich-stills -- --limit 5 --dry-run
npm run media:enrich-stills -- --story STORY_ID --dry-run
npm run media:enrich-stills -- --fixture --apply-local
```

`--dry-run` is the default. `--apply-local` writes only under `test/output/asset-acquisition-v11/assets`.

## Outputs

- `test/output/asset_acquisition_v11_dry_run.json`
- `test/output/asset_acquisition_v11_dry_run.md`
- `test/output/asset_acquisition_v11_visual_deck_examples.json`
- `test/output/asset_acquisition_v11_visual_deck_examples.md`
- `test/output/creator_studio_asset_acquisition_v11_stills.json`
- local apply assets under `test/output/asset-acquisition-v11/assets` only when `--apply-local` is used

## Allowed Still Sources

Allowed in v1.1:

- Steam capsule, header, library, hero and screenshots;
- IGDB cover and screenshots;
- official publisher/developer still images;
- platform UI and logos;
- article hero and inline images.

Blocked in v1.1:

- trailer downloads;
- video clips;
- yt-dlp;
- browser scraping;
- unofficial clip downloads;
- social-media media scraping;
- production DB mutation;
- hard publish gates.

## Local Dry-Run Evidence

Latest local DB sample:

```text
rss_5b3abe925b27a199
before: AMBER / short_only
after:  AMBER / short_only
effect: deck improves with 3 stills, readiness unchanged

1szzhy9
before: RED / blog_only
after:  AMBER / short_only
effect: readiness improves with 5 stills

rss_0e2778be9f97ffa4
before: RED / short_only
after:  RED / short_only
effect: deck improves with 1 still, readiness still blocked elsewhere

rss_4105cb7c837252c3
before: RED / short_only
after:  AMBER / short_only
effect: readiness improves with 1 still

rss_93fdf53a0c1211ef
before: AMBER / short_only
after:  AMBER / short_only
effect: deck improves with 4 stills, readiness unchanged
```

This confirms v1.1 can improve real local candidates without pretending every story becomes publish-ready.

## How It Improves Media Scarcity

The v1 reports could identify candidate assets and score them. v1.1 now turns safe stills into an explicit controlled enrichment plan:

- `would_fetch` shows safe candidates;
- `would_reject` explains rejected candidates;
- `would_change_visual_deck` shows whether the deck becomes more diverse;
- `before` and `after_projected` show Creator Studio readiness movement;
- provenance records source URL, source type, entity, risk class, relevance, hash and local path where applicable.

The enrichment path never blindly replaces existing assets. It only adds candidates when they improve diversity or readiness.

## Rights And Risk Notes

Steam and IGDB still assets are treated as storefront/promotional or metadata-promotional sources, not as owned media. They are safer than random web images or unofficial videos, but still require platform-aware use and attribution/disclosure policy later.

Article imagery remains contextual and lower priority than direct game/storefront assets. Unknown person, author headshot and profile-style imagery is rejected for this phase.

## What Remains Report-Only

- trailer and video acquisition;
- frame extraction;
- official trailer clipping;
- Studio V2 production defaults;
- production DB writes;
- render/publish hard gates;
- scheduler integration;
- platform upload routing;
- live social posting.

## Safe Promotion Path

The next safe promotion would be a manually approved local pre-render enrichment step:

1. run dry-run for approved local stories;
2. review `would_fetch` and `would_reject`;
3. run `--apply-local` for selected stories only;
4. feed local stills into Studio V2 test renders;
5. keep publish gates warn-only until Martin approves a hard gate.

## Manual Approval Needed Later

Ask Martin before:

- writing enriched assets back into story rows;
- making still enrichment part of the live scheduler;
- enabling hard media gates;
- changing production render defaults;
- acquiring trailer/video clips;
- downloading from unofficial sources;
- touching Railway or platform auth.

## Next Recommended Phase

Build a Studio V2 still-deck ingestion test that renders one improved local story using only v1.1 still assets, then runs the forensic quality gate. Keep it local, manual and non-publishing.

## Validation

Fresh validation on 2026-05-01:

- `node --test tests/services/still-image-enrichment.test.js tests/services/asset-acquisition-pro.test.js tests/services/creator-studio-os.test.js tests/services/studio-v2-regressions.test.js`: 63/63 pass
- `npm test`: 1,551/1,551 pass
- `npm run build`: pass
- `npm run ops:asset-acquisition -- --fixture`: pass
- `npm run media:enrich-stills -- --fixture --dry-run`: pass
- `npm run ops:creator-studio -- --fixture`: pass
- `npm run ops:asset-acquisition -- --limit 5`: pass, read-only local report regenerated
- `npm run media:enrich-stills -- --limit 5 --dry-run`: pass, read-only local v1.1 report regenerated
- `npm run ops:creator-studio -- --limit 5`: pass, read-only Creator Studio report regenerated

Deployment was not performed. Railway health was not checked because this task intentionally stayed local/report-only.
