# Studio V2 Still-Deck Ingestion v1 Report

Date: 2026-05-01

## What Was Built

Studio V2 Still-Deck Ingestion v1 is a local-only proof harness that tests whether Asset Acquisition Pro v1.1 still-image decks improve Studio V2 visual output.

It adds:

- a still-deck ingestion adapter;
- provenance-preserving Studio V2 media-package mapping;
- missing-file rejection;
- unsafe portrait/author/avatar rejection;
- duplicate rejection;
- wrong-story stale asset rejection;
- generic Steam/IGDB platform-entity rejection;
- low-confidence article-image rejection;
- local silent-fixture MP4 render comparison;
- baseline vs enriched forensic QA;
- contact-sheet generation.

No production render default was changed.

## Command

```bash
npm run studio:v2:still-deck -- --story STORY_ID --apply-local
```

The command is local-only. `--apply-local` downloads allowed still images only under:

```text
test/output/studio-v2-still-deck/assets/
```

It does not download trailer/video clips, use yt-dlp, use browser scraping, mutate Railway, trigger OAuth, mutate the production DB or post anywhere.

## Preferred Story Result

`1szzhy9` was the preferred target because v1.1 projected it from `RED/blog_only` to `AMBER/short_only`.

After stricter Studio V2 ingestion checks, the story had zero safe enriched stills:

- Steam stills were rejected as `generic_store_asset_without_game_entity`;
- the article image was rejected as too weak once thumbnail safety was read from provenance;
- no Studio V2 enriched render was allowed from that deck.

This is the right safety outcome. The earlier v1.1 readiness improvement was too optimistic.

## Rendered Fallback Story

Because the preferred story was not safe enough, the harness rendered the best available fallback from the v1.1 report:

```text
rss_5b3abe925b27a199
GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
```

Generated artefacts:

- `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_baseline.mp4`
- `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_enriched.mp4`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_baseline_contact_sheet.jpg`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_contact_sheet.jpg`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_baseline_qa.json`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_qa.json`
- `test/output/studio-v2-still-deck/forensic_comparison.json`
- `test/output/studio-v2-still-deck/studio_v2_still_deck_report.json`
- `test/output/studio-v2-still-deck/studio_v2_still_deck_report.md`

## QA Result

The enriched fallback render did not materially improve output quality.

Latest comparison:

```text
Accepted/enriched stills: 3
Baseline source diversity score: 84
Enriched source diversity score: 36
Baseline unique scene sources: 7
Enriched unique scene sources: 3
Baseline visual repeat pairs: 16
Enriched visual repeat pairs: 163
Forensic verdict: no material improvement
```

The enriched contact sheet was more topical than a blank/card-only render, but it repeated GTA stills heavily and did not have enough true scene variety for a 60+ second Short.

## Final Judgement

Did enriched still decks improve visual output?

Not enough. They can improve a totally empty media package, but in the rendered fallback they made visual repetition worse. They are useful as rescue material, not as a Studio V2 promotion path.

Did any story become suitable for Studio V2?

No. `1szzhy9` was rejected by the stricter adapter. `rss_5b3abe925b27a199` rendered locally, but QA says no material improvement and too much repeated still use.

What still blocks premium quality?

- no trailer/video clips in this phase;
- too few unique, exact-subject stills;
- v1.1 entity extraction can confuse platform/source entities with game entities;
- still-only 60+ second videos become repetitive;
- this proof used silent fixture audio, not production voice;
- Studio V2 still needs richer subject-matched images, trailer frames or real footage.

Should this become production mode?

No. Keep it local-only. Do not promote to optional production mode yet.

## Recommended Next Phase

Build **Asset Acquisition Pro v1.2: Exact-Subject Still Matching** before trailer acquisition:

1. require Steam/IGDB app title match, not just platform/entity match;
2. store app names and slugs in provenance;
3. reject generic `Steam`, `PlayStation` and `Xbox` entities for game art;
4. require at least 4 exact-subject stills before 60-second Studio V2 tests;
5. only then rerun still-deck Studio V2 proof.

After that, move to trailer-frame enrichment for premium motion.

## Validation

Fresh validation completed:

- `node --test tests/services/studio-v2-still-deck-ingestion.test.js tests/services/still-image-enrichment.test.js tests/services/asset-acquisition-pro.test.js tests/services/creator-studio-os.test.js tests/services/studio-v2-regressions.test.js`: 76/76 pass
- `npm test`: 1,564/1,564 pass
- `npm run build`: pass
- `npm run media:enrich-stills -- --fixture --dry-run`: pass, files written 0
- `npm run ops:creator-studio -- --fixture`: pass
- `npm run media:enrich-stills -- --limit 5 --dry-run`: pass, files written 0, refreshed the real-story v1.1 dry-run report

Deployment was not performed.
