# Flash Lane Visual Director v1

Generated: 2026-05-02

## What Was Built

Flash Lane now has a local-only Visual Director inside Studio V2 preflight.

It does not render, publish or change production defaults. It reads the planned scene list and decides whether the video is genuinely footage-led enough for a 61-75s high-energy Short.

## New Gates

For 60+ second Flash Lane proofs, the Visual Director now checks:

- at least three unique official clip sources;
- no clip source used more than three times;
- no clip anchor starting before 22 seconds;
- at least eight distinct scene beats;
- source cards are not overused;
- cover art remains support material, not the backbone;
- weak official clip anchor scores are surfaced as warnings.

## Why This Matters

The previous proof could technically render, but it stretched two trailer references across a full minute. That created repeated footage, ratings/logo intro risk and boring still/card sections.

The new rule is stricter: if Pulse cannot support a 60+ second Flash Lane video with enough unique footage, it must either acquire more footage or downgrade the format.

## Related Composer Changes

The Studio V2 scene composer now caps Flash Lane clip reuse:

- maximum three scenes per official clip reference;
- once the reuse budget is spent, it fills with support material instead of pretending the video is still footage-led.

That means weak packages now naturally fail the footage-dominance gate instead of producing a repetitive MP4.

## Related Clip-Anchor Changes

Official trailer clip starts now move later:

- previous minimum start: 16s;
- new minimum start: 22s;
- accepted frame lead-out: 2s.

This reduces the chance of PEGI/ESRB/logo/title boards becoming clip anchors.

## Related Caption Changes

Studio V2 kinetic captions now split earlier:

- phrase cap remains three words;
- phrase max characters tightened from 18 to 16;
- long phrases split before they become likely two-line caption blocks.

This is still local Studio V2 behaviour, not a production legacy-render change.

## Current GTA/Take-Two Result

Latest report:

`test/output/studio-v2-still-deck/studio_v2_still_deck_report.json`

Current verdict:

`blocked_by_flash_lane_preflight`

Blockers:

- `unapproved_local_tts_voice_path`
- `flash_lane_clip_dominance_below_target`
- `flash_visual_requires_three_unique_clip_refs_for_60s`

Warnings:

- `flash_visual_source_card_appears_too_early`
- `flash_visual_cover_art_ratio_high`

Key metrics:

- runtime: 66.857s;
- spoken pace: 141.8 WPM;
- official clip references: 2;
- unique clip sources: 2;
- actual clip dominance: 0.38;
- card ratio: 0.13;
- accepted trailer frames: 3;
- source diversity score: 100.

This is the right outcome. It has improved media, but it is not a valid 60+ second Flash Lane proof yet.

## What Still Blocks Premium Quality

- local voice still needs human approval;
- only two usable official trailer references are available;
- Red Dead official frames were rejected for safety/quality, so the story lacks one of the named-game motion sources;
- source/context cards still need a more premium HyperFrames-style design pass;
- 60+ second videos need more footage, not more repeated stills.

## Safety Boundary

- No deploy.
- No Railway env changes.
- No OAuth.
- No production DB mutation.
- No social posting.
- No production renderer switch.
- No production voice switch.
- No hard production gate enabled.

## Validation

- Focused Visual Director suite: 43/43 pass.
- Full `npm test`: 1,701/1,701 pass.
- `npm run build`: pass.

## 2026-05-02 Follow-up

Controlled frame extraction v2 found enough usable official frames to clear the visual blocker for the GTA/Take-Two diagnostic package.

Current Flash Lane preflight:

- blocker: `unapproved_local_tts_voice_path`
- visual blockers: none
- actual clip dominance: 0.56 preflight, 0.88 post-render QA including frames
- source diversity: green, 15 unique sources across 16 scenes
- forensic repeat pairs: 29 baseline -> 3 enriched

The Visual Director is now doing the right job: visual repetition and weak footage no longer pass silently. The remaining gate is voice approval, not visual coverage.

Latest validation:

- Targeted frame/render/QA suites: 69/69 pass.
- Full `npm test`: 1,710/1,710 pass.
- `npm run build`: pass.
