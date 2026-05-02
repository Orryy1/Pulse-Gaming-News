# Studio V2 Proof Render Safety

Generated: 2026-05-01

## What Changed

Local Studio V2 proof renders now refuse to continue when the narration path is known to be unsafe for review.

Blocked by default:

- unapproved local VoxCPM production path;
- unapproved local Chatterbox production path;
- silent fixture audio unless explicitly requested as a visual-only diagnostic.

Allowed:

- provided real narration audio;
- local voice only after `STUDIO_V2_LOCAL_VOICE_APPROVED=true`.

The Studio V2 subtitle layer also now keeps Flash-style caption punches shorter:

- phrase cap remains three words;
- long phrases are split before they become likely two-line blocks;
- words inside a punch use ASS hard spaces so they do not wrap mid-punch.

The local enriched Studio V2 proof path now also runs Flash Lane preflight before FFmpeg:

- blocks enriched proofs with fewer than two actual clip scenes;
- blocks enriched proofs where actual clip dominance is below 55%;
- blocks narration outside the 61-75 second Flash Lane window;
- keeps stills and trailer frames as support, not a replacement for footage;
- allows a bypass only with the explicit `--allow-flash-diagnostic-render` diagnostic flag.

The enriched Studio V2 composer now has Flash Lane mode:

- official clip references become the backbone of the slate;
- repeated use of a clip advances the media start time so it is a new segment, not the same intro frame;
- stills, trailer frames and cards support the edit instead of dominating it.

The official trailer clip-reference selector now also has segment-quality scoring:

- text-heavy rating/title cards are rejected even when logo detection misses them;
- blur/low-detail warning frames are rejected before becoming clip anchors;
- safe frames are ranked by visual detail, saturation, text burden and start position;
- the selected clip provenance records `segment_selection_policy` and `segment_quality_score`.

## Why

The recent enriched Studio V2 proof looked materially worse than it should because it still allowed a local TTS path that the user heard as a demonic low voice. A red voice path should not produce another MP4 that looks like a pilot candidate.

## Safety Boundary

This is local-only proof tooling. It does not change production voice, production renderer, Railway, OAuth, tokens, DB rows, scheduler, posting or hard publish gates.

## Next Step

The next Flash Lane local proof should use either:

- approved cached production narration; or
- a newly approved local voice path after side-by-side human approval.

Do not use unapproved local TTS for pilot proof videos.

The cached narration found for `rss_5b3abe925b27a199` is 118 seconds, so it is not a valid Flash Lane proof source. A valid next proof needs approved narration in the 61-75 second window.

## Latest Validation

- `node --test tests/services/official-trailer-clip-refs.test.js`: pass
- `node --test tests/services/controlled-frame-extraction-worker.test.js tests/services/studio-v2-still-deck-ingestion.test.js tests/services/official-trailer-clip-refs.test.js`: pass
- `npm test`: 1,675/1,675 pass
- `npm run build`: pass

## 2026-05-02 Update

The proof-render safety layer now also treats supplied local workbench audio as local TTS, not as approved provided narration.

Blocked by default:

- `flash-lane-voice-workbench` audio paths;
- VoxCPM/Chatterbox/local TTS paths;
- any local voice candidate without approval.

A diagnostic render can opt in with `--allow-local-voice-diagnostic`, but that does not make the proof pilot-ready.

Flash Lane preflight also now includes the Visual Director. The current GTA/Take-Two package has only two usable official clip references. The composer no longer stretches those beyond the safe reuse budget, so the package now fails as insufficiently footage-led rather than rendering a repetitive MP4.

Latest local proof status:

- story: `rss_5b3abe925b27a199`;
- verdict: blocked before render;
- blockers: `unapproved_local_tts_voice_path`, `flash_lane_clip_dominance_below_target`, `flash_visual_requires_three_unique_clip_refs_for_60s`;
- narration duration: 66.857s;
- spoken pace: 141.8 WPM;
- official clip references: 2;
- unique clip sources: 2;
- actual clip dominance: 0.38;
- card ratio: 0.13.

Latest validation:

- `npm test`: 1,701/1,701 pass.
- `npm run build`: pass.

## 2026-05-02 Later Update

The GTA/Take-Two visual package now passes Flash Lane visual preflight after controlled frame extraction v2 and scene-planning fixes.

Latest local diagnostic render:

- MP4: `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_enriched.mp4`
- QA: `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_qa.json`
- contact sheet: `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_contact_sheet.jpg`

Current outcome:

- runtime: 68.8s;
- source diversity: green;
- clip dominance: green;
- subtitles: pass;
- visual repeat pairs: 29 baseline -> 3 enriched;
- only red QA trip: `voicePathUsed`.

This is still not a pilot candidate because the narration uses unapproved local TTS. The visual proof is useful for local review, but promotion requires approved 61-75s narration.

Validation:

- Targeted frame/render/QA suites: 69/69 pass.
- Full `npm test`: 1,710/1,710 pass.
- `npm run build`: pass.
