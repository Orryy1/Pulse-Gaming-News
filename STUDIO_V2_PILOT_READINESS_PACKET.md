# Studio V2 Pilot Readiness Packet

Generated: 2026-05-01
Story: `rss_5b3abe925b27a199`
Title: `GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One`

## Verdict

`RED` - not suitable for a Studio V2 pilot yet.

This packet supersedes the earlier optimistic proof. Martin's review exposed real blockers: rating/title cards were leaking from trailer starts, weak trailer frames were being counted as acceptable and the local VoxCPM voice path still sounds wrong. The current rerender is useful as a diagnostic, but QA now correctly blocks promotion because the local voice is unapproved and clip dominance is too low for the high-energy Shorts lane.

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
| Voice path | local VoxCPM, red/unapproved |
| QA lane | reject |
| Forensic verdict | warn |
| Forensic issues | visual warning only, no repeat pairs |
| Subtitle verdict | pass |
| Subtitle phrase cap | 3 words |
| Audio recurrence | pass |
| SFX cues | 1 |
| Accepted stills | 10 |
| Accepted official trailer frames | 3 |
| Rejected official trailer frames | 3 |
| Official trailer references | 2 |
| In-image entity popups | GTA, BioShock, still assets for Red Dead |
| Distinct entities | 3 |
| Unique scene sources | 14 |
| Visual repeat pairs | 0 |
| Stock filler | 0 |

## Before And After

| Metric | Baseline | Enriched | Change |
| --- | ---: | ---: | ---: |
| Forensic verdict | fail | warn | improved |
| Fails | 1 | 0 | -1 |
| Runtime | 40.00s | 66.126s | +26.126s |
| Accepted trailer frames | 0 | 3 | +3 |
| Source diversity score | 84 | 100 | +16 |
| Unique scene sources | 4 | 14 | +10 |
| Visual repeat pairs | 29 | 0 | -29 |

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
- Official trailer clips now seek to the selected trailer beat instead of starting at 0, which was causing PEGI/ESRB cards to appear.
- Official trailer title/rating-card frames are rejected.
- Low-detail official trailer frames are rejected.
- Unapproved local Studio V2 voices now fail QA instead of passing as amber.

## Remaining Caveats

- The proof is still not final creative quality. It remains cover/key-art heavy and needs more subject-matched motion.
- FFmpeg reported packet/NAL warnings while reading remote Steam HLS references. The output completed, but this is a production-risk item before any live pilot.
- The local VoxCPM voice path is present but blocked. Martin heard it as wrong, so it cannot be treated as pilot-ready.
- Clip dominance is still too low for a high-energy gaming TikTok news lane.
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

Do not promote Studio V2 from this packet. The safe next step is a dedicated Shorts creator-edit lane: approved narration only, stronger trailer segment selection, no rating/title cards, richer gameplay-first motion, punchier subtitles and HyperFrames-grade cards before another pilot proof.
