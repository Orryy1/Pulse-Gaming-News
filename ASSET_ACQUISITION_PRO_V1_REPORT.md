# Asset Acquisition Pro v1 Report

Date: 2026-05-01

## What Was Built

Asset Acquisition Pro v1 is now a read-only media acquisition, provenance, scoring and visual-deck system for Pulse Gaming.

It adds:

- a rights-aware media source registry;
- entity-aware media expansion from title, script, source text and known fields;
- Steam, IGDB, article, official, platform, generated-card and stock/filler source classification;
- candidate scoring for relevance, source priority, quality, safety, duplicate risk and premium suitability;
- a `media_provenance.json` ledger;
- a `visual_deck.json` and `visual_deck.md` deck builder;
- trailer/frame/clip extraction planning in report-only mode;
- Creator Studio OS before/after readiness simulation;
- Creator Studio control-room integration.

## How It Improves Media Scarcity

Before this build, the system could say a story was visually weak, but it could not explain the exact media work needed.

Now each story gets:

- candidate media inventory;
- source/risk classification;
- per-asset provenance;
- ranked visual candidates;
- duplicate and unsafe-person penalties;
- a balanced recommended deck;
- specific acquisition tasks such as Steam search, IGDB lookup, official trailer search, trailer-frame extraction, clip slicing and thumbnail build.

## Commands

```bash
npm run ops:asset-acquisition
npm run ops:creator-studio
```

Useful forms:

```bash
npm run ops:asset-acquisition -- --fixture
npm run ops:asset-acquisition -- --limit 5
npm run ops:asset-acquisition -- --story-id STORY_ID
npm run ops:creator-studio -- --fixture
npm run ops:creator-studio -- --limit 5
```

## Outputs

- `test/output/asset_acquisition_pro.json`
- `test/output/asset_acquisition_pro.md`
- `test/output/media_provenance.json`
- `test/output/visual_deck.json`
- `test/output/visual_deck.md`
- `test/output/asset-acquisition/<storyId>/media_provenance.json`
- `test/output/asset-acquisition/<storyId>/visual_deck.json`
- `test/output/asset-acquisition/<storyId>/visual_deck.md`
- `test/output/creator_studio_asset_acquisition_v1.json`

## Example Before/After

Latest local DB sample:

- stories: 5
- asset candidates: 59
- visual deck items: 45
- stories needing acquisition: 5
- stories improved by estimated acquisition: 3

Notable example:

```text
1szzhy9
before: RED / blog_only
after estimate: GREEN / premium_ready
deck items: 9
key tasks: steam_store_search, igdb_lookup, official_trailer_search, article_og_image_fetch
```

## Asset Source Priorities

Highest priority:

- Steam trailer/movie references;
- Steam header, hero, library, capsule and screenshots;
- IGDB cover, screenshots and video references;
- official publisher/developer assets.

Medium priority:

- article hero and inline images;
- platform UI and logos.

Fallback:

- generated brand card.

Last resort:

- stock/filler.

Rejected:

- unsafe or unknown-person imagery.

## Rights And Risk Notes

The registry labels every source type with:

- expected relevance;
- rights/risk class;
- allowed render use;
- thumbnail eligibility;
- premium-video suitability.

Stock/filler is explicitly last resort. Unknown human/person imagery is penalised and excluded from the deck when unsafe. Video references remain report-only unless a later approved local worker is allowed to fetch or extract frames.

## What Remains Report-Only

This build does not:

- download assets;
- extract frames;
- slice trailer clips;
- mutate the story database;
- publish;
- trigger OAuth;
- change Railway;
- change scheduler behaviour;
- switch Studio V2 into production;
- enable hard publish gates.

## What Can Safely Be Promoted Next

The safest next worker is local-only Steam/IGDB enrichment behind an explicit command. It should:

- read the v1 plan first;
- download only allowed source types;
- write provenance before use;
- dedupe assets;
- run thumbnail safety before render;
- stay disconnected from publish.

## Manual Approval Needed

Ask Martin before:

- enabling downloads by default;
- changing live render/publish gates;
- switching Studio V2 into production;
- mutating Railway env vars;
- writing to production DB;
- using browser automation;
- adding any unofficial/copyright-risk video source.

## Validation

- `node --test tests/services/asset-acquisition-pro.test.js tests/services/creator-studio-os.test.js tests/services/studio-v2-regressions.test.js`: 53/53 pass
- `npm test`: 1,541/1,541 pass
- `npm run build`: pass
- `npm run ops:asset-acquisition -- --fixture`: pass
- `npm run ops:asset-acquisition -- --limit 5`: pass
- `npm run ops:creator-studio -- --fixture`: pass
- `npm run ops:creator-studio -- --limit 5`: pass

## Deployment

Not deployed. This is a read-only/reporting build and no Railway health check was needed.
