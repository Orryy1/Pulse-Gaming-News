# Studio V2 Verified Multi-Entity Deck Proof v1

Date: 2026-05-01

## Purpose

Prove whether Asset Acquisition Pro v1.5's verified multi-entity still deck can improve a local Studio V2 render without touching production.

This proof is local-only:

- no Railway changes;
- no production DB mutation;
- no OAuth;
- no posting;
- no trailer/video downloads;
- no yt-dlp;
- no browser scraping;
- no Studio V2 production default change;
- no ElevenLabs call.

## What Changed

The Studio V2 still-deck adapter now understands v1.5 verified exact-subject assets.

It will accept a thin local script when the asset already carries the safer v1.5 contract:

- `subject_match_quality` is exact game, franchise or platform;
- `counted_for_premium` or `counted_for_standard` is true;
- `exact_subject_group` matches the entity;
- Steam/IGDB store metadata is verified.

It still rejects unverified wrong-story assets.

The local Studio V2 proof command now defaults to the newest v1.5/v1.4/v1.1 still-enrichment report and can build a fallback local story from the report when the local DB sample is missing.

The scene composer now rotates card backdrops through the enriched still deck instead of using the same first article/store image behind every card.

## Command

```bash
npm run studio:v2:still-deck -- --story rss_5b3abe925b27a199
```

## Rendered Story

```text
rss_5b3abe925b27a199
GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
```

The enriched package accepted 10 verified stills across:

- GTA;
- Red Dead;
- BioShock.

## Result

Latest local comparison:

```text
Accepted stills: baseline 7, enriched 10
Source diversity score: baseline 84, enriched 100
Unique scene sources: baseline 5, enriched 10
Visual repeat pairs: baseline 35, enriched 3
Subtitle verdict: pass
Forensic verdict: improved
Runtime: 62.933s
```

The local enriched render is now a genuine Studio V2 60-second still-deck proof candidate, not a production promotion candidate.

## Sound-Designed Proof

The proof harness now supports local-only sound design:

```bash
npm run studio:v2:still-deck -- --story rss_5b3abe925b27a199 --with-sound-design
```

This mixes the local music bed and restrained local SFX plan into the proof render while keeping the voice as a silent fixture. It does not call ElevenLabs.

Latest audio QA with sound design:

```text
SFX cue count: 4
SFX QA grade: green
Bed ducking QA grade: green
Duration integrity: green
Subtitle verdict: pass
Forensic comparison: improved
Audio recurrence: warn
```

The warning is from the forensic detector seeing four scheduled cut-synchronous cues. That is acceptable for a local proof but should be tuned before production promotion.

## Remaining Blockers

QA still correctly downgrades the render because:

- there are no clips or trailer frames;
- the proof still uses silent fixture voice;
- sound design is local-proof only and not production default;
- source diversity is better but still still-image-led;
- final promotion needs real audio, SFX and more motion.

## Artefacts

- `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_baseline.mp4`
- `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_enriched.mp4`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_baseline_contact_sheet.jpg`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_contact_sheet.jpg`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_baseline_qa.json`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_qa.json`
- `test/output/studio-v2-still-deck/forensic_comparison.json`
- `test/output/studio-v2-still-deck/studio_v2_still_deck_report.json`
- `test/output/studio-v2-still-deck/studio_v2_still_deck_report.md`

## Validation

Fresh targeted validation:

```bash
node --test tests/services/studio-v2-still-deck-ingestion.test.js tests/services/studio-short-engine-v1.test.js
```

Result: 26/26 pass.

Expanded local sound-design validation:

```bash
node --test tests/services/studio-v2-still-deck-ingestion.test.js tests/services/studio-short-engine-v1.test.js tests/services/studio-v2-regressions.test.js
```

Result: 52/52 pass.

Render proof:

```bash
npm run studio:v2:still-deck -- --story rss_5b3abe925b27a199
npm run studio:v2:still-deck -- --story rss_5b3abe925b27a199 --with-sound-design
```

Result: pass, local MP4 and QA artefacts regenerated.

## Next Phase

Build the next local-only proof around motion and audio polish:

1. trailer-frame enrichment plan with report-only/apply-local controls;
2. Studio V2 SFX/bed harness that does not spend production credits;
3. clip/frame dominance thresholds for real Studio V2 promotion;
4. then one fresh local candidate with verified stills, trailer frames, outro and full audio QA.
