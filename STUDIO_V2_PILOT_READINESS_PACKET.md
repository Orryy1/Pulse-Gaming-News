# Studio V2 Pilot Readiness Packet

Generated: 2026-05-01
Story: `rss_5b3abe925b27a199`
Title: `GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One`

## Verdict

`AMBER` - suitable for local human review as a one-story Studio V2 pilot candidate, not suitable for automatic production default.

This packet supersedes the earlier silent-fixture proof. The current enriched MP4 has real local VoxCPM narration, shorter kinetic subtitle phrases, compact entity popups, official Steam trailer references, extracted official frames and corrected card honesty. It still needs human visual review because the forensic layer reports one possible repeated/black-frame pair and the local voice remains an amber path until it is judged against the production ElevenLabs voice.

## Artefacts

- Enriched MP4: `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_enriched.mp4`
- Enriched contact sheet: `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_contact_sheet.jpg`
- Enriched QA: `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_qa.json`
- Enriched forensic QA: `test/output/studio-v2-still-deck/qa_forensic_rss_5b3abe925b27a199_enriched_report.json`
- Forensic comparison: `test/output/studio-v2-still-deck/forensic_comparison.json`
- Media package: `test/output/studio-v2-still-deck/enriched_media_package.json`
- Frame extraction proof: `test/output/controlled_frame_extraction_worker_apply_local.json`
- Comparison report: `test/output/studio-v2-still-deck/studio_v2_still_deck_report.md`

## Proof Summary

| Check | Result |
| --- | --- |
| Runtime | 66.126s |
| TikTok 60s floor | pass |
| Audio stream present | pass |
| Voice path | local VoxCPM, amber |
| QA lane | pass |
| Forensic verdict | warn |
| Forensic issues | 1 visual repetition warning |
| Subtitle verdict | pass |
| Subtitle phrase cap | 3 words |
| Audio recurrence | pass |
| SFX cues | 1 |
| Accepted stills | 10 |
| Accepted official trailer frames | 5 |
| Official trailer references | 3 |
| In-image entity popups | GTA, Red Dead, BioShock |
| Distinct entities | 3 |
| Unique scene sources | 14 |
| Visual repeat pairs | 1 |
| Stock filler | 0 |

## Before And After

| Metric | Baseline | Enriched | Change |
| --- | ---: | ---: | ---: |
| Forensic verdict | fail | warn | improved |
| Fails | 1 | 0 | -1 |
| Runtime | 40.00s | 66.126s | +26.126s |
| Accepted trailer frames | 0 | 5 | +5 |
| Source diversity score | 84 | 100 | +16 |
| Unique scene sources | 4 | 14 | +10 |
| Visual repeat pairs | 29 | 1 | -28 |

## Fixes From Martin's Review

- The MP4 now has real narration audio instead of silent fixture audio.
- RSS source cards now label the publisher/source as `GameSpot`, not `r/GameSpot`.
- RSS article excerpts no longer render as fake `u/Redditor` comment cards.
- The irrelevant `NO DATE YET` card is suppressed for this publisher-business story.
- The hook no longer fails QA because of a chopped five-word first sentence.
- Kinetic subtitles now cap at three words per phrase to reduce two-line caption blocks.
- Visual scenes now carry exact entity labels into compact in-image popups.
- The opener hook overlay is now a smaller timed plate instead of the old full-width black slab.
- The report now records real narration and official trailer references honestly.

## Remaining Caveats

- The proof is better, but not final creative quality. Some frames are still cover/key-art heavy and need more subject-matched motion.
- FFmpeg reported packet/NAL warnings while reading remote Steam HLS references. The output completed, but this is a production-risk item before any live pilot.
- The local VoxCPM voice path is present and not demonic here, but it remains amber until consistently approved across more stories.
- The source/takeaway cards still need a stronger HyperFrames-style visual language before Studio V2 becomes a polished live lane.
- The entity popups are intentionally conservative in this proof; they are a functional first pass, not the final broadcast design.

## Safety Boundaries

- No Railway variables changed.
- No OAuth triggered.
- No production DB mutation.
- No publish/produce job was manually run.
- No platform posting occurred.
- No production render default changed.
- No Studio V2 production switch.
- No hard production gate enabled.
- Output stayed under `test/output`.

## Pilot Recommendation

Do not promote Studio V2 broadly from this packet. The safe next step is one more local creative pass focused on card polish and richer clip/frame selection, then a single manually approved pilot story if the watched MP4 looks materially better than legacy.
