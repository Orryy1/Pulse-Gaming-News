# Tonight Handoff

Date: 2026-05-01

## Branch

- Branch: `codex/hermes-sandbox-quality-routing`
- HEAD: `add29c308cd1f255d6ba963f2f616dee98f11759`
- `origin/main`: `b01f858820b75d50b0793532e1bcb81bb82541a8`
- Divergence: `2 0`
- Commit created: no
- Deployed: no

## Files Changed In This Build

- `lib/creator-studio-os.js`
- `tools/creator-studio-control-room.js`
- `tests/services/creator-studio-os.test.js`
- `package.json`
- `docs/superpowers/plans/2026-05-01-creator-studio-os-v1.md`
- `PULSE_CREATOR_STUDIO_OS_V1_REPORT.md`
- `lib/asset-acquisition-pro.js`
- `tools/asset-acquisition-pro.js`
- `tests/services/asset-acquisition-pro.test.js`
- `ASSET_ACQUISITION_PRO_REPORT.md`
- `ASSET_ACQUISITION_PRO_V1_REPORT.md`
- `TONIGHT_STATUS_SNAPSHOT.md`
- `TONIGHT_HANDOFF.md`

Voice regression guard touched:

- `lib/studio/sound-layer.js`
- `lib/studio/v2/quality-gate-v2.js`
- `tests/services/studio-v2-regressions.test.js`

Generated reports:

- `test/output/creator_studio_control_room.json`
- `test/output/creator_studio_control_room.md`
- `test/output/creator-studio/<storyId>/...`
- `test/output/asset_acquisition_pro.json`
- `test/output/asset_acquisition_pro.md`
- `test/output/media_provenance.json`
- `test/output/visual_deck.json`
- `test/output/visual_deck.md`
- `test/output/creator_studio_asset_acquisition_v1.json`
- `test/output/asset-acquisition/<storyId>/...`

## Commands Added

```bash
npm run ops:creator-studio
npm run ops:asset-acquisition
```

Useful forms:

```bash
npm run ops:creator-studio -- --fixture
npm run ops:creator-studio -- --limit 5
npm run ops:creator-studio -- --story-id STORY_ID
npm run ops:creator-studio -- --all-approved
npm run ops:asset-acquisition -- --fixture
npm run ops:asset-acquisition -- --limit 5
npm run ops:asset-acquisition -- --story-id STORY_ID
npm run ops:asset-acquisition -- --all-approved
```

## Tests And Build

- `node --test tests/services/asset-acquisition-pro.test.js tests/services/creator-studio-os.test.js tests/services/studio-v2-regressions.test.js`: 53/53 pass
- `npm test`: 1,541/1,541 pass
- `npm run build`: pass
- `npm run ops:creator-studio -- --fixture`: pass
- `npm run ops:creator-studio -- --limit 5`: pass
- `npm run ops:asset-acquisition -- --fixture`: pass
- `npm run ops:asset-acquisition -- --limit 5`: pass

## Current Creator Studio Verdict

Last local DB sample:

- Overall: RED
- Story count: 5
- GREEN: 0
- AMBER: 2
- RED: 3

Meaning: the system is now correctly refusing to pretend thin or missing-media stories are ready. This is the desired behaviour for a control-room layer.

## Current Asset Acquisition Verdict

Last local DB sample:

- Overall: AMBER
- Story count: 5
- Acquire: 5
- Maintain: 0
- Reject: 0
- Candidates: 59
- Visual deck items: 45
- Estimated Creator Studio improvements: 3

Meaning: the next bottleneck is concrete and measurable. Recent stories mostly need official trailer search, Steam/IGDB asset search, article hero fetches, publisher press imagery and thumbnail candidate generation before they should become premium videos.

## Railway

- Railway health: not checked
- Reason: no deployment was performed
- Railway env vars: untouched
- Railway scheduler/upload behaviour: untouched

## Remaining Risks

- Creator Studio OS is still report-only.
- It is not connected to the dashboard yet.
- It does not block live uploads yet.
- Media inventory is the biggest creative bottleneck.
- TikTok official API remains externally blocked.
- Facebook Reels remain page-gated.

## Martin Decisions Needed

No immediate manual action is required.

Future approval is needed before any of these become live behaviour:

- making Creator Studio OS a hard publish gate
- switching Studio V2 into production
- enabling hard visual blocks
- changing platform upload routing
- changing scheduler timing
- changing Railway env vars

## Recommended Next Build

Build the safe local acquisition worker next, starting with Steam/IGDB enrichment and official trailer planning. Keep it behind an explicit command, local-only by default and still separate from render/publish until Martin approves live behaviour changes.

## Asset Acquisition Pro v1.1 Update

Controlled Still-Image Enrichment is implemented as a local/reporting path.

Additional files changed:

- `lib/still-image-enrichment.js`
- `tools/still-image-enrichment.js`
- `tests/services/still-image-enrichment.test.js`
- `ASSET_ACQUISITION_PRO_V11_REPORT.md`
- `tools/creator-studio-control-room.js`
- `package.json`

Additional generated reports:

- `test/output/asset_acquisition_v11_dry_run.json`
- `test/output/asset_acquisition_v11_dry_run.md`
- `test/output/asset_acquisition_v11_visual_deck_examples.json`
- `test/output/asset_acquisition_v11_visual_deck_examples.md`
- `test/output/creator_studio_asset_acquisition_v11_stills.json`

Additional command:

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

Fresh validation:

- `node --test tests/services/still-image-enrichment.test.js tests/services/asset-acquisition-pro.test.js tests/services/creator-studio-os.test.js tests/services/studio-v2-regressions.test.js`: 63/63 pass
- `npm test`: 1,551/1,551 pass
- `npm run build`: pass
- `npm run ops:asset-acquisition -- --fixture`: pass
- `npm run media:enrich-stills -- --fixture --dry-run`: pass
- `npm run ops:creator-studio -- --fixture`: pass
- `npm run ops:asset-acquisition -- --limit 5`: pass
- `npm run media:enrich-stills -- --limit 5 --dry-run`: pass
- `npm run ops:creator-studio -- --limit 5`: pass

Latest local v1.1 dry-run:

- Stories scanned: 5
- Stories with deck changes: 5
- Stories with readiness improvement: 2
- `1szzhy9`: RED/blog_only to AMBER/short_only
- `rss_4105cb7c837252c3`: RED/short_only to AMBER/short_only
- Files written by enrichment dry-run: 0

Safety position:

- Still images only.
- Dry-run remains default.
- `--apply-local` writes only to `test/output/asset-acquisition-v11/assets`.
- No production DB rows, Railway variables, OAuth state, scheduler settings, hard gates, render defaults or posting behaviour changed.

Recommended next build:

Build Studio V2 still-deck ingestion for one improved local story and run forensic QA. Keep it local, manual and non-publishing.

## Studio V2 Verified Multi-Entity Deck Proof v1 Update

Asset Acquisition Pro v1.5 outputs are now ingested directly by the local Studio V2 still-deck proof harness.

Additional files changed:

- `lib/studio/v2/still-deck-ingestion.js`
- `tools/studio-v2-still-deck-ingestion.js`
- `lib/scene-composer.js`
- `tests/services/studio-v2-still-deck-ingestion.test.js`
- `tests/services/studio-short-engine-v1.test.js`
- `STUDIO_V2_VERIFIED_MULTI_ENTITY_DECK_PROOF_REPORT.md`

Latest proof story:

```text
rss_5b3abe925b27a199
GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
```

Latest proof result:

- Accepted verified stills: 10
- Entities covered: GTA, Red Dead, BioShock
- Source diversity score: 84 baseline to 100 enriched
- Unique scene sources: 5 baseline to 10 enriched
- Visual repeat pairs: 35 baseline to 3 enriched
- Subtitle verdict: pass
- Forensic comparison verdict: improved
- Runtime: 62.933s
- Local sound-design proof: SFX cue count 4, SFX grade green, bed ducking grade green, forensic comparison improved, audio recurrence warn

Generated artefacts:

- `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_baseline.mp4`
- `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_enriched.mp4`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_baseline_contact_sheet.jpg`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_contact_sheet.jpg`
- `test/output/studio-v2-still-deck/forensic_comparison.json`
- `test/output/studio-v2-still-deck/studio_v2_still_deck_report.json`
- `test/output/studio-v2-still-deck/studio_v2_still_deck_report.md`

Fresh validation:

- `node --test tests/services/studio-v2-still-deck-ingestion.test.js tests/services/studio-short-engine-v1.test.js`: 26/26 pass
- `node --test tests/services/studio-v2-still-deck-ingestion.test.js tests/services/studio-short-engine-v1.test.js tests/services/studio-v2-regressions.test.js`: 52/52 pass
- `npm run studio:v2:still-deck -- --story rss_5b3abe925b27a199`: pass, local-only render regenerated
- `npm run studio:v2:still-deck -- --story rss_5b3abe925b27a199 --with-sound-design`: pass, local-only sound-designed render regenerated

Safety position:

- no Railway change;
- no production DB mutation;
- no OAuth;
- no posting;
- no trailer/video downloads;
- no yt-dlp;
- no browser scraping;
- no production Studio V2 default change;
- no ElevenLabs call.

Remaining blockers:

- the proof is still still-image-led;
- no clips or trailer frames;
- no production voice in this harness;
- audio recurrence still warns with four scheduled cues;
- keep local-only until motion and audio layers are proven.

## Motion Acquisition Pro v1 Update

Motion Acquisition Pro v1 is implemented as a report-only wrapper around the existing Asset Acquisition trailer/frame plan.

Additional files changed:

- `lib/motion-acquisition-pro.js`
- `tools/motion-acquisition-pro.js`
- `tests/services/motion-acquisition-pro.test.js`
- `MOTION_ACQUISITION_PRO_V1_REPORT.md`
- `package.json`

Commands added:

```bash
npm run media:plan-motion
npm run ops:motion-acquisition
```

Outputs:

- `test/output/motion_acquisition_v1.json`
- `test/output/motion_acquisition_v1.md`

Latest local sample:

- Stories scanned: 5
- Local motion proof ready: 0
- Reference ready for local frame plan: 0
- Official trailer search required: 5

Safety position:

- report-only;
- no trailer/video downloads;
- no frame extraction;
- no clip slicing;
- no yt-dlp;
- no browser scraping;
- no Railway change;
- no OAuth;
- no production DB mutation;
- no posting.

Recommended next build:

Build Official Trailer Reference Resolver v1 as report-only first. It should resolve Steam movie/IGDB video/official-platform references with provenance but still not download anything.

## Studio V2 Still-Deck Ingestion v1 Update

Studio V2 Still-Deck Ingestion is implemented as a local-only proof harness.

Additional files changed:

- `lib/studio/v2/still-deck-ingestion.js`
- `tools/studio-v2-still-deck-ingestion.js`
- `tests/services/studio-v2-still-deck-ingestion.test.js`
- `lib/still-image-enrichment.js`
- `tests/services/still-image-enrichment.test.js`
- `package.json`
- `STUDIO_V2_STILL_DECK_INGESTION_REPORT.md`

Additional command:

```bash
npm run studio:v2:still-deck
```

Useful forms:

```bash
npm run studio:v2:still-deck -- --story 1szzhy9 --apply-local
npm run studio:v2:still-deck -- --story rss_5b3abe925b27a199 --apply-local
npm run studio:v2:still-deck -- --story STORY_ID --apply-local --no-render
```

Generated local artefacts:

- `test/output/studio-v2-still-deck/studio_v2_still_deck_report.json`
- `test/output/studio-v2-still-deck/studio_v2_still_deck_report.md`
- `test/output/studio-v2-still-deck/enriched_media_package.json`
- `test/output/studio-v2-still-deck/enriched_media_package.md`
- `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_baseline.mp4`
- `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_enriched.mp4`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_baseline_contact_sheet.jpg`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_contact_sheet.jpg`
- `test/output/studio-v2-still-deck/forensic_comparison.json`
- `test/output/studio-v2-still-deck/forensic_comparison.md`

Fresh validation:

- `node --test tests/services/studio-v2-still-deck-ingestion.test.js tests/services/still-image-enrichment.test.js tests/services/asset-acquisition-pro.test.js tests/services/creator-studio-os.test.js tests/services/studio-v2-regressions.test.js`: 76/76 pass
- `npm test`: 1,564/1,564 pass
- `npm run build`: pass
- `npm run media:enrich-stills -- --fixture --dry-run`: pass
- `npm run ops:creator-studio -- --fixture`: pass
- `npm run media:enrich-stills -- --limit 5 --dry-run`: pass

Latest Studio V2 proof result:

- `1szzhy9` was rejected by stricter ingestion checks after the adapter removed generic store/platform assets and weak article images.
- `rss_5b3abe925b27a199` rendered baseline and enriched local MP4s.
- Enriched visual source diversity dropped from 84 to 36.
- Visual repeat pairs increased from 16 to 163.
- Forensic comparison verdict: no material improvement.

Safety position:

- Local-only.
- Still images only.
- Silent fixture audio; ElevenLabs was not called.
- No Railway variables, OAuth state, production DB rows, scheduler settings, hard gates, render defaults or posting behaviour changed.
- No deployment was performed.

Recommended next build:

Build Asset Acquisition Pro v1.2: Exact-Subject Still Matching. Require real Steam/IGDB app-title matches and at least four exact-subject stills before another 60-second Studio V2 still-only render proof.

## Asset Acquisition Pro v1.2 Update

Exact-Subject Still Matching is implemented as a local/reporting readiness gate.

Additional files changed:

- `lib/exact-subject-matching.js`
- `lib/asset-acquisition-pro.js`
- `lib/still-image-enrichment.js`
- `lib/creator-studio-os.js`
- `tools/asset-acquisition-pro.js`
- `tools/creator-studio-control-room.js`
- `tests/services/asset-acquisition-exact-subject.test.js`
- `ASSET_ACQUISITION_PRO_V12_EXACT_SUBJECT_REPORT.md`

Additional generated reports:

- `test/output/asset_acquisition_v12_exact_subject.json`
- `test/output/asset_acquisition_v12_exact_subject.md`
- `test/output/creator_studio_asset_acquisition_v12_exact_subject.json`
- updated `test/output/media_provenance.json`
- updated `test/output/visual_deck.json`
- updated `test/output/visual_deck.md`

Fresh validation:

- `node --test tests/services/asset-acquisition-exact-subject.test.js tests/services/asset-acquisition-pro.test.js tests/services/still-image-enrichment.test.js tests/services/creator-studio-os.test.js tests/services/studio-v2-still-deck-ingestion.test.js tests/services/studio-v2-regressions.test.js`: 86/86 pass
- `npm test`: 1,574/1,574 pass
- `npm run build`: pass
- `npm run ops:asset-acquisition -- --fixture`: pass
- `npm run media:enrich-stills -- --fixture --dry-run`: pass
- `npm run ops:creator-studio -- --fixture`: pass
- `npm run ops:asset-acquisition -- --limit 5`: pass
- `npm run media:enrich-stills -- --limit 5 --dry-run`: pass
- `npm run ops:creator-studio -- --limit 5`: pass

Latest v1.2 local sample:

- Stories scanned: 5
- Studio V2 60s eligible stories: 0
- Premium candidates: 0
- Exact-subject assets counted: 18
- Generic/context assets disqualified from premium: 41
- Downgraded stories: 5

Notable story outcomes:

- `1szzhy9`: v1.1 projected improvement, but v1.2 counts 0 exact-subject assets and keeps it out of Studio V2.
- `rss_4105cb7c837252c3`: v1.1 projected improvement, but v1.2 counts 0 exact-subject assets and keeps it out of Studio V2.
- `rss_5b3abe925b27a199`: has many exact-labelled GTA/BioShock assets, but fails 60s eligibility due missing Red Dead coverage and repeated asset pairs.

Safety position:

- Local/reporting only.
- No Railway variables, OAuth state, production DB rows, scheduler settings, hard gates, render defaults, trailer/video downloads, browser scraping, yt-dlp or posting behaviour changed.
- No deployment was performed.

Recommended next build:

Build Asset Acquisition Pro v1.3: Exact Store App Verification. Store Steam/IGDB app ids, titles and matched query strings, then reject assets when the returned app title does not match the story subject.

## Asset Acquisition Pro v1.3 Update

Exact Store App Verification is implemented as a local/reporting readiness layer.

Additional files changed:

- `lib/exact-subject-matching.js`
- `lib/asset-acquisition-pro.js`
- `lib/still-image-enrichment.js`
- `lib/creator-studio-os.js`
- `lib/igdb-images.js`
- `lib/script-game-enrichment.js`
- `images_download.js`
- `hunter.js`
- `tools/asset-acquisition-pro.js`
- `tools/creator-studio-control-room.js`
- `tests/services/asset-acquisition-exact-subject.test.js`
- `tests/services/igdb-images.test.js`
- `tests/services/script-game-enrichment.test.js`
- `ASSET_ACQUISITION_PRO_V13_STORE_VERIFICATION_REPORT.md`

Additional generated reports:

- `test/output/asset_acquisition_v13_store_verification.json`
- `test/output/asset_acquisition_v13_store_verification.md`
- `test/output/creator_studio_asset_acquisition_v13_store_verification.json`
- updated `test/output/media_provenance.json`
- updated `test/output/visual_deck.json`
- updated `test/output/visual_deck.md`

Fresh validation:

- `node --test tests/services/igdb-images.test.js tests/services/script-game-enrichment.test.js`: 35/35 pass
- `node --test tests/services/asset-acquisition-exact-subject.test.js tests/services/asset-acquisition-pro.test.js tests/services/still-image-enrichment.test.js tests/services/creator-studio-os.test.js tests/services/studio-v2-still-deck-ingestion.test.js tests/services/studio-v2-regressions.test.js tests/services/igdb-images.test.js tests/services/script-game-enrichment.test.js`: 126/126 pass
- `npm test`: 1,579/1,579 pass
- `npm run build`: pass
- `npm run ops:asset-acquisition -- --fixture`: pass
- `npm run media:enrich-stills -- --fixture --dry-run`: pass
- `npm run ops:creator-studio -- --fixture`: pass
- `npm run ops:asset-acquisition -- --limit 5`: pass
- `npm run media:enrich-stills -- --limit 5 --dry-run`: pass
- `npm run ops:creator-studio -- --limit 5`: pass

Latest v1.3 local sample:

- Stories scanned: 5
- Store assets inspected: 37
- Verified store assets: 0
- Missing app title or slug provenance: 37
- Studio V2 60s eligible stories: 0
- Premium candidates: 0

Safety position:

- Local/reporting only.
- No Railway variables, OAuth state, production DB rows, scheduler settings, hard gates, render defaults, trailer/video downloads, browser scraping, yt-dlp or posting behaviour changed.
- No deployment was performed.

Recommended next build:

Build Asset Acquisition Pro v1.4: Local Verified Still Acquisition. Apply still enrichment locally for one safe story, stamp verified Steam/IGDB app provenance, rerun exact store verification and only then consider another Studio V2 proof render.

## Asset Acquisition Pro v1.4 Update

Verified Store Still Acquisition is implemented as a local-only apply proof.

Additional files changed:

- `lib/still-image-enrichment.js`
- `tools/still-image-enrichment.js`
- `tests/services/still-image-enrichment.test.js`
- `ASSET_ACQUISITION_PRO_V14_VERIFIED_STORE_STILLS_REPORT.md`

Additional command options:

```bash
npm run media:enrich-stills -- --verified-store-metadata --require-verified-store
```

Useful forms:

```bash
npm run media:enrich-stills -- --limit 5 --dry-run --verified-store-metadata --require-verified-store
npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --apply-local --verified-store-metadata --require-verified-store
```

Generated reports:

- `test/output/asset_acquisition_v14_verified_store_dry_run.json`
- `test/output/asset_acquisition_v14_verified_store_dry_run.md`
- `test/output/asset_acquisition_v14_verified_store_apply_local.json`
- `test/output/asset_acquisition_v14_verified_store_apply_local.md`
- `test/output/asset_acquisition_v14_verified_store.json`
- `test/output/asset_acquisition_v14_verified_store.md`

Local proof:

- Applied story: `rss_5b3abe925b27a199`
- Files written: 3
- Store app id: `3240220`
- Store app title: `Grand Theft Auto V Enhanced`
- Store verification: `verified`
- Output directory: `test/output/asset-acquisition-v11/assets/rss_5b3abe925b27a199/`

Important catch:

- `1szzhy9` historical Steam app id `2580190` resolves to `PlayStation VR2 App`.
- v1.4 rejects it in verified-store-only mode instead of treating it as Marathon media.

Fresh validation:

- `node --test tests/services/still-image-enrichment.test.js`: 14/14 pass
- Targeted acquisition/Creator Studio suite: 91/91 pass
- `npm test`: 1,582/1,582 pass
- `npm run build`: pass
- `npm run media:enrich-stills -- --limit 5 --dry-run --verified-store-metadata --require-verified-store`: pass
- `npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --apply-local --verified-store-metadata --require-verified-store`: pass
- `npm run ops:creator-studio -- --limit 5`: pass
- `npm run ops:asset-acquisition -- --limit 5`: pass

Safety position:

- Local-only.
- Still images only.
- No Railway variables, OAuth state, production DB rows, scheduler settings, hard gates, render defaults, trailer/video downloads, browser scraping, yt-dlp or posting behaviour changed.
- No deployment was performed.

Recommended next build:

Build Asset Acquisition Pro v1.5: Multi-Entity Verified Store Search. Search exact Steam/IGDB entities for each required subject group, prove per-entity coverage and only then attempt another Studio V2 proof render.

## Asset Acquisition Pro v1.5 Update

Multi-Entity Verified Store Search is implemented as a local-only still acquisition proof.

Additional files changed:

- `lib/still-image-enrichment.js`
- `tools/still-image-enrichment.js`
- `tests/services/still-image-enrichment.test.js`
- `ASSET_ACQUISITION_PRO_V15_MULTI_ENTITY_STORE_REPORT.md`

Additional command options:

```bash
--multi-entity-store-search
--max-store-search-entities <n>
--max-store-assets-per-entity <n>
--max-downloads-per-story <n>
```

Proof command:

```bash
npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --apply-local --multi-entity-store-search --verified-store-metadata --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12
```

Generated reports:

- `test/output/asset_acquisition_v15_multi_entity_dry_run.json`
- `test/output/asset_acquisition_v15_multi_entity_dry_run.md`
- `test/output/asset_acquisition_v15_multi_entity_apply_local.json`
- `test/output/asset_acquisition_v15_multi_entity_apply_local.md`
- `test/output/asset_acquisition_v15_multi_entity_store.json`
- `test/output/asset_acquisition_v15_multi_entity_store.md`

Local proof:

- Applied story: `rss_5b3abe925b27a199`
- Files written: 10
- Covered groups: GTA, Red Dead, BioShock
- GTA: `3240220` / `Grand Theft Auto V Enhanced`
- Red Dead: `1174180` / `Red Dead Redemption 2`
- BioShock: `8870` / `BioShock Infinite`
- Output directory: `test/output/asset-acquisition-v11/assets/rss_5b3abe925b27a199/`

Fresh validation:

- `node --test tests/services/still-image-enrichment.test.js`: 15/15 pass
- Targeted acquisition/Creator Studio suite: 57/57 pass
- `npm test`: 1,583/1,583 pass
- `npm run build`: pass
- v1.5 dry-run command: pass
- v1.5 apply-local command: pass

Safety position:

- Local-only.
- Still images only.
- No Railway variables, OAuth state, production DB rows, scheduler settings, hard gates, render defaults, trailer/video downloads, browser scraping, yt-dlp or posting behaviour changed.
- No deployment was performed.

Recommended next build:

Build Studio V2 Verified Multi-Entity Deck Proof v1. Ingest the v1.5 applied local assets, render one local proof video and run forensic QA before deciding whether still-only decks are enough.

## Motion Acquisition Pro v1 Update

Motion Acquisition Pro v1 is implemented as a report-only command.

Additional files changed:

- `lib/motion-acquisition-pro.js`
- `tools/motion-acquisition-pro.js`
- `tests/services/motion-acquisition-pro.test.js`
- `MOTION_ACQUISITION_PRO_V1_REPORT.md`

Additional commands:

```bash
npm run media:plan-motion
npm run ops:motion-acquisition
```

Generated reports:

- `test/output/motion_acquisition_v1.json`
- `test/output/motion_acquisition_v1.md`

Fresh validation:

- `node --test tests/services/motion-acquisition-pro.test.js`: 5/5 pass
- `npm run media:plan-motion -- --fixture`: pass
- `npm run media:plan-motion -- --limit 5`: pass
- Full `npm test`: 1,592/1,592 pass at the time of this build
- `npm run build`: pass

Latest local sample:

- Stories scanned: 5
- Local motion proof ready: 0
- Reference ready for local frame plan: 0
- Official trailer search required: 5

Safety position:

- Report-only.
- No trailer/video downloads, frame extraction, clip slicing, browser scraping, yt-dlp, Railway changes, OAuth, production DB mutation or posting behaviour changed.

Recommended next build:

Build Official Trailer Reference Resolver v1 so Motion Acquisition Pro can stop saying every story needs a manual official trailer search.

## Official Trailer Reference Resolver v1 Update

Official Trailer Reference Resolver v1 is implemented as a report-only command.

Additional files changed:

- `lib/official-trailer-reference-resolver.js`
- `tools/official-trailer-reference-resolver.js`
- `tests/services/official-trailer-reference-resolver.test.js`
- `OFFICIAL_TRAILER_REFERENCE_RESOLVER_V1_REPORT.md`
- `package.json`

Additional commands:

```bash
npm run media:resolve-trailers
npm run ops:trailer-references
```

Useful forms:

```bash
npm run media:resolve-trailers -- --fixture --offline
npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199
npm run media:resolve-trailers -- --limit 5
```

Generated reports:

- `test/output/official_trailer_references_v1.json`
- `test/output/official_trailer_references_v1.md`

Local proof:

- Story: `rss_5b3abe925b27a199`
- Verified Steam targets: 3
- Official Steam trailer references: 15
- GTA: `3240220` / `Grand Theft Auto V Enhanced`
- Red Dead: `1174180` / `Red Dead Redemption 2`
- BioShock: `8870` / `BioShock Infinite`
- Downloads: 0

Fresh validation:

- `node --test tests/services/official-trailer-reference-resolver.test.js`: 7/7 pass
- Targeted media/acquisition/readiness suite: 58/58 pass
- `npm run media:resolve-trailers -- --fixture --offline`: pass
- `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199`: pass
- `npm test`: 1,599/1,599 pass
- `npm run build`: pass

Safety position:

- Report-only.
- Steam metadata JSON only; no video downloads.
- No frame extraction, clip slicing, yt-dlp, browser scraping, Railway changes, OAuth, production DB mutation, scheduler change, render-default change or posting behaviour changed.

Recommended next build:

Integrate official trailer references into Motion Acquisition Pro so resolved stories move from `official_search_required` to `reference_ready_for_local_frame_plan`, still without downloading video or extracting frames.

## Motion Reference Integration v1 Update

Motion Acquisition Pro now consumes the Official Trailer Reference Resolver report.

Additional files changed:

- `lib/motion-acquisition-pro.js`
- `tools/motion-acquisition-pro.js`
- `tests/services/motion-acquisition-pro.test.js`
- `MOTION_REFERENCE_INTEGRATION_V1_REPORT.md`

Additional command options:

```bash
npm run media:plan-motion -- --trailer-references test/output/official_trailer_references_v1.json
npm run media:plan-motion -- --no-trailer-references
```

Default behaviour:

- `npm run media:plan-motion` reads `test/output/official_trailer_references_v1.json` when present.

Local proof:

- Story: `rss_5b3abe925b27a199`
- Existing official references consumed: 15
- Motion readiness: `reference_ready_for_local_frame_plan`
- Planned action: `trailer_frame_extract_plan`
- Remaining blockers: `needs_three_trailer_frames`, `needs_three_clip_slices`
- Downloads: 0

Fresh validation:

- `node --test tests/services/motion-acquisition-pro.test.js`: 7/7 pass
- `node --test tests/services/motion-acquisition-pro.test.js tests/services/official-trailer-reference-resolver.test.js`: 14/14 pass
- `npm run media:plan-motion -- --story-id rss_5b3abe925b27a199`: pass
- `npm test`: 1,601/1,601 pass
- `npm run build`: pass

Safety position:

- Report-only.
- No video downloads, frame extraction, clip slicing, yt-dlp, browser scraping, Railway changes, OAuth, production DB mutation, scheduler change, render-default change or posting behaviour changed.

Recommended next build:

Build Controlled Frame Extraction Plan v1 as a no-download/report-only packet: choose which official references would be used, target frame timestamps, quality scoring rules and exact-subject coverage requirements before any local media fetch/extraction worker exists.

## Controlled Frame Extraction Plan v1 Update

Controlled Frame Extraction Plan v1 is implemented as a no-download planning packet.

Additional files changed:

- `lib/controlled-frame-extraction-plan.js`
- `tools/controlled-frame-extraction-plan.js`
- `tests/services/controlled-frame-extraction-plan.test.js`
- `CONTROLLED_FRAME_EXTRACTION_PLAN_V1_REPORT.md`
- `package.json`

Additional commands:

```bash
npm run media:plan-frames
npm run ops:frame-plan
```

Generated reports:

- `test/output/controlled_frame_extraction_v1.json`
- `test/output/controlled_frame_extraction_v1.md`

Local proof:

- Story: `rss_5b3abe925b27a199`
- Frame-plan readiness: `frame_plan_ready`
- Selected official references: 3
- Unique entities: GTA, Red Dead, BioShock
- Planned target frames: 6
- Blockers: clear
- Downloads: 0
- Frames extracted: 0

Fresh validation:

- `node --test tests/services/controlled-frame-extraction-plan.test.js`: 5/5 pass
- Targeted frame/motion/reference suite: 19/19 pass
- `npm run media:plan-frames -- --story-id rss_5b3abe925b27a199`: pass
- `npm test`: 1,606/1,606 pass
- `npm run build`: pass

Safety position:

- Report-only.
- No video downloads, frame extraction, clip slicing, yt-dlp, browser scraping, Railway changes, OAuth, production DB mutation, scheduler change, render-default change or posting behaviour changed.

Recommended next build:

Integrate motion-reference and controlled-frame readiness into Creator Studio OS so the control room shows the full pre-download motion path before any apply-local video extraction worker is considered.

## Creator Studio Motion Readiness Integration Update

Creator Studio OS now exposes motion and frame-plan readiness in the main packet and markdown table.

Additional files changed:

- `lib/creator-studio-os.js`
- `tools/creator-studio-control-room.js`
- `tests/services/creator-studio-os.test.js`
- `CREATOR_STUDIO_MOTION_READINESS_INTEGRATION_REPORT.md`

Additional per-story packet outputs:

- `motion_acquisition.json`
- `controlled_frame_plan.json`

Local proof:

- Command: `npm run ops:creator-studio -- --story-id rss_5b3abe925b27a199`
- Creator Studio overall: AMBER
- Media inventory: `short_only`
- Motion readiness: `reference_ready_for_local_frame_plan`
- Frame-plan readiness: `frame_plan_ready`
- Official references visible in the control room: 15
- Render lane remains `legacy_multi_image`

Fresh validation:

- Creator Studio targeted test: 12/12 pass
- Targeted control-room/frame/motion/reference suite: 31/31 pass
- `npm run ops:creator-studio -- --story-id rss_5b3abe925b27a199`: pass
- `npm test`: 1,607/1,607 pass
- `npm run build`: pass

Safety position:

- Report-only.
- No video downloads, frame extraction, clip slicing, yt-dlp, browser scraping, Railway changes, OAuth, production DB mutation, scheduler change, render-default change or posting behaviour changed.

Recommended next build:

Build Controlled Local Frame Extraction Worker v1 behind explicit `--apply-local`. Default must remain dry-run, output must stay under `test/output` and extracted frames must carry provenance plus dedupe/blur/black-frame/thumbnail-safety QA before they count as usable media.

## Controlled Local Frame Extraction Worker v1 Update

Controlled Local Frame Extraction Worker v1 is implemented.

Additional files changed:

- `lib/controlled-frame-extraction-worker.js`
- `tools/controlled-frame-extraction-worker.js`
- `tests/services/controlled-frame-extraction-worker.test.js`
- `CONTROLLED_LOCAL_FRAME_EXTRACTION_WORKER_V1_REPORT.md`
- `package.json`

Additional commands:

```bash
npm run media:extract-frames
npm run ops:frame-extract
```

Useful forms:

```bash
npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --dry-run
npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local --max-frames-per-story 6
```

Generated reports:

- `test/output/controlled_frame_extraction_worker_dry_run.json`
- `test/output/controlled_frame_extraction_worker_dry_run.md`
- `test/output/controlled_frame_extraction_worker_apply_local.json`
- `test/output/controlled_frame_extraction_worker_apply_local.md`
- `test/output/controlled_frame_extraction_worker_v1.json`
- `test/output/controlled_frame_extraction_worker_v1.md`

Local proof:

- Story: `rss_5b3abe925b27a199`
- Frames planned: 6
- Frames extracted: 6
- Frames accepted: 5
- Frames rejected: 1
- Extract failures: 0
- Accepted groups: GTA 2, Red Dead 1, BioShock 2
- One Red Dead frame rejected for `unsafe_face_like_frame`.

Fresh validation:

- `node --test tests/services/controlled-frame-extraction-worker.test.js`: 6/6 pass
- Targeted media-control suite: 37/37 pass
- `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --dry-run`: pass
- `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local --max-frames-per-story 6`: pass
- `npm test`: 1,613/1,613 pass
- `npm run build`: pass

Safety position:

- Dry-run by default.
- Apply-local writes only under `test/output`.
- No production DB mutation, Railway change, OAuth, scheduler change, render-default change, platform posting, yt-dlp or browser scraping.

Recommended next build:

Integrate accepted extracted frames into local still-deck ingestion, then rerender the proof story and compare still-only vs stills plus official trailer frames.

## Discord Blockers 2026-05-01 Update

Two concrete issues from today's Discord log are fixed.

Monthly topics crash:

- Discord failure: `roundup_monthly_topics` failed with `extractKeywords is not a function`.
- Root cause: `analytics.js` defined `extractKeywords` but did not export it.
- Fix: exported `extractKeywords` and added `tests/services/analytics-keywords.test.js`.

Runaway Shorts duration:

- Discord failure: publish candidates were blocked by `video_qa: duration_too_long` at 117-137s.
- Root cause: publish-time video QA was correctly blocking overlong MP4s, but `assemble.js` was still rendering audio that was already too long for the Shorts contract.
- Fix: added `lib/services/short-duration-contract.js`.
- `assemble.js` now blocks overlong audio before FFmpeg render and stamps QA failure.
- `content-qa.js` now blocks already-rendered rows with overlong audio/runtime metadata.
- Tests added: `tests/services/short-duration-contract.test.js`, `tests/services/assemble-duration-gate.test.js`.
- Tests updated: `tests/services/content-qa.test.js`.

Additional report:

- `DISCORD_BLOCKERS_2026_05_01_REPORT.md`

Fresh validation:

- Targeted Discord-blocker suite: 72/72 pass.
- Short duration targeted suite: 31/31 pass after cleanup.
- `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --dry-run`: pass.
- `npm run ops:creator-studio -- --story-id rss_5b3abe925b27a199`: pass.
- Full `npm test`: 1,623/1,623 pass.
- `npm run build`: pass.

Remaining manual blocker:

- TikTok token refresh failed with `invalid_grant`.
- The bare `https://pulse.orryy.com/auth/tiktok` route returns `{"error":"Unauthorized"}` by design because OAuth start is operator-auth protected.
- Use `https://pulse.orryy.com/auth/tiktok?token=YOUR_API_TOKEN` or a dashboard auth button that supplies the token.
- I did not trigger OAuth or change tokens.
- Detailed note: `TIKTOK_REAUTH_OPERATOR_NOTE.md`

Current recommendation:

Integrate the accepted local trailer frames into local still-deck ingestion, then run a proof render comparing still-only versus stills plus official extracted trailer frames.

## Studio V2 Still-Deck + Official Frame Ingestion Update

Accepted local official frames now feed into Studio V2 still-deck ingestion.

Code/reporting changes:

- `lib/studio/v2/still-deck-ingestion.js` now accepts a `frameReport`.
- Accepted frame report rows become `media.trailerFrames`.
- Rejected, unsafe, missing, duplicate and wrong-story frames are excluded.
- `tools/studio-v2-still-deck-ingestion.js` now supports `--frame-report` and defaults to the local controlled frame worker apply report when present.
- Report: `STUDIO_V2_STILL_DECK_FRAME_INGESTION_REPORT.md`

Local proof:

- Story: `rss_5b3abe925b27a199`
- Command: `node tools\studio-v2-still-deck-ingestion.js --story rss_5b3abe925b27a199 --frame-report test\output\controlled_frame_extraction_worker_apply_local.json --with-sound-design`
- Enriched MP4: `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_enriched.mp4`
- Enriched contact sheet: `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_contact_sheet.jpg`
- Comparison report: `test/output/studio-v2-still-deck/studio_v2_still_deck_report.json`

Final proof metrics:

- Accepted stills: 10
- Accepted official trailer frames: 5
- Rejected official trailer frames: 1
- Unique scene sources: 5 -> 12
- Visual repeat pairs: 38 -> 2
- Forensic verdict: baseline fail -> enriched pass
- Enriched duration: 62.93s
- Subtitles: pass
- Audio recurrence: pass
- Black-frame warnings: cleared

Additional proof fixes:

- `lib/studio/v2/audio-library.js` now defaults to one high-value local SFX cue so forensic audio recurrence passes.
- `lib/scenes/release-date-card.js` now keeps known-unknown cards bright enough to avoid black-frame warnings.

Remaining local proof caveat:

- Silent fixture voice only; no ElevenLabs call and no local TTS proof in this render.

Safety position:

- Local-only.
- No Railway, OAuth, production DB, scheduler, production render default, hard gate or posting path changed.

Fresh validation:

- Targeted fix suite: 85/85 pass.
- Frame worker dry-run: pass.
- Creator Studio story report: pass.
- Studio V2 no-render packaging check: pass.
- Final rendered Studio V2 proof: enriched forensic QA pass with 0 issues.
- Full `npm test`: 1,632/1,632 pass.
- `npm run build`: pass.

Next recommendation:

Prepare the Studio V2 pilot readiness packet for `rss_5b3abe925b27a199`, using the clean local proof as the promotion candidate. Keep the next decision manual and do not switch production render defaults.

## Local Deploy Notification Clarity Update

Discord showed repeated confusing messages with `Railway Deploy OK`, `Commit: dev` and `Deploy: local`.

Fix:

- Added `lib/deploy-notification.js`.
- Updated `server.js` startup notification path to use it.
- Real Railway deploys still send `Railway Deploy OK` when `RAILWAY_DEPLOYMENT_ID` is present.
- Local/dev starts are skipped by default.
- Optional local notifications use `Local Pulse Mirror Started` when `PULSE_LOCAL_DEPLOY_NOTIFY=true`.
- Added `tests/services/deploy-notification.test.js`.

Safety:

- No Railway deployment behaviour or env vars changed.
- No production scheduler/upload/publish behaviour changed.

## Studio V2 Pilot Readiness Packet

Created a report-only pilot packet for `rss_5b3abe925b27a199`.

- Markdown: `STUDIO_V2_PILOT_READINESS_PACKET.md`
- JSON: `test/output/studio-v2-still-deck/studio_v2_pilot_readiness_packet.json`
- Verdict: `AMBER`
- Recommendation: human-review one-story pilot candidate, not production default.

Key proof:

- Enriched MP4: `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_enriched.mp4`
- Contact sheet: `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_contact_sheet.jpg`
- Runtime: 62.93s
- Forensic QA: pass, 0 issues
- Visual repeat pairs: 38 -> 2
- Accepted official trailer frames: 5

Caveat:

- This does not prove live voice quality because the proof used a silent visual fixture with local sound design.
