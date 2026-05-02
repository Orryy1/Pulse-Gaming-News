# Flash Lane Card Treatment v1

Generated: 2026-05-02

## What Was Built

Studio V2 Flash Lane cards now have a separate creator-news treatment instead of falling back to the plain centred cards.

This is local Studio V2 rendering only. It does not affect the live legacy production renderer.

## Changes

### Source Cards

Flash Lane source cards now render with:

- `SOURCE CHECK` kicker;
- larger source label;
- stronger amber side rail and animated top rule;
- `PULSE VERIFIED` pill;
- brighter, higher-saturation backdrop.

Standard source cards remain available outside Flash Lane.

### Context Cards

Flash Lane context/stat cards now render through a dedicated `MUST KNOW` card treatment instead of reusing the release-date card layout.

This is meant for short, sharp context beats rather than documentary-style exposition.

### Scene Composer

When `flashLane: true`, all card scenes are tagged with:

`cardTreatment: flash_lane`

The FFmpeg renderer uses that tag to select the stronger local treatment.

### Report Visibility

The Studio V2 still-deck report now includes each scene's card treatment in the preflight scene list.

Latest report:

`test/output/studio-v2-still-deck/studio_v2_still_deck_report.json`

## Current GTA/Take-Two Status

The card treatment is now wired in, but the story remains blocked before render because the package is still not footage-led enough:

- `unapproved_local_tts_voice_path`
- `flash_lane_clip_dominance_below_target`
- `flash_visual_requires_three_unique_clip_refs_for_60s`

That is correct. Better cards do not compensate for insufficient unique footage.

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

- Focused card/Flash Lane suite: 34/34 pass.
- Full `npm test`: 1,705/1,705 pass.
- `npm run build`: pass.
