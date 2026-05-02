# Flash Lane Visual Safety Update

Generated: 2026-05-02

## Why This Exists

The latest `studio_v2_rss_5b3abe925b27a199_enriched.mp4` proof was not good enough for a creator-grade Flash Lane pilot.

Martin's review was correct:

- the voice path still sounded too low and unsafe;
- rating-card/trailer-intro material was visible in the edit;
- too few official clip references were being reused too many times;
- some frames were blurry, dark or meaningless;
- the proof leaned too heavily on covers, source cards and support stills;
- the result felt further from a high-energy gaming TikTok than it should.

The correct fix is not to promote that proof. The correct fix is to make the local proof tooling block weak packages earlier.

## Changes Made

### 1. Local TTS Is Now Treated As Local TTS

The Studio V2 still-deck proof CLI previously accepted an explicit `--audio` path as provided narration. That was too permissive because a local VoxCPM/Chatterbox workbench file could masquerade as a normal approved narration file.

Now paths from the Flash Lane voice workbench, VoxCPM, Chatterbox or local TTS areas are classified as local voice candidates.

Default behaviour:

- unapproved local TTS blocks proof render;
- local TTS can only be used for a diagnostic render with an explicit flag;
- local TTS still requires human approval before any pilot recommendation.

### 2. Clip Reuse Is Now Blocked

The proof tried to build a 60+ second Flash Lane video from only two official trailer clip references.

That is why repetition and weak visual moments leaked in. The new preflight gate blocks a Flash Lane package when actual clip scenes exceed the safe reuse budget.

Current rule:

- each official clip reference can support at most three actual clip scenes;
- if the scene plan needs more than that, the package is blocked before render;
- stills and cards cannot hide insufficient footage.

### 3. Frame Quality Is Kept Strict

The controlled frame extraction report is now used as the source of truth for accepted/rejected trailer frames.

For the GTA/Take-Two proof story:

- accepted frames: 3;
- rejected frames: 3;
- rejected examples include rating/title-card material, unsafe face-like material and low-detail frames.

This confirms the worker is catching some of the exact problems Martin saw, but it also confirms the story does not yet have enough high-quality unique motion material.

## Latest Proof Status

Story:

`rss_5b3abe925b27a199`

Latest local report:

`test/output/studio-v2-still-deck/studio_v2_still_deck_report.json`

Current preflight verdict:

`block`

Blockers:

- `unapproved_local_tts_voice_path`
- `flash_lane_clip_dominance_below_target`
- `flash_visual_requires_three_unique_clip_refs_for_60s`

Key metrics:

- narration duration: 66.857s;
- spoken pace: 141.8 WPM;
- accepted stills: 10;
- accepted trailer frames: 3;
- official clip references: 2;
- unique clip sources: 2;
- actual clip dominance: 0.38;
- card ratio: 0.13.

This is the desired safety outcome. The package should not become a pilot candidate yet.

## What This Means

Pulse Flash Lane should be treated as:

- 61-75s;
- high-energy;
- footage-led;
- punch-captioned;
- rapid topic cards;
- exact subject assets only;
- no repeated trailer intros or rating-card filler;
- no unapproved local voice.

The current GTA/Take-Two proof has the right runtime and script pace, but it is still short on footage diversity and voice approval. It now fails because it needs at least three unique official clip sources for a 60+ second Flash Lane proof.

## What Remains Blocked

- No Studio V2 production switch.
- No production renderer default change.
- No production voice switch.
- No hard publish gate change.
- No Railway change.
- No OAuth/token change.
- No social posting.

## Next Build Recommendation

Build **Flash Lane Visual Director v1** before any new pilot proof.

It should:

- reject PEGI/ESRB/rating/trailer-logo intros as clip anchors;
- require more unique clip references before 60+ second render;
- score frames for action, detail, saturation and subject relevance;
- downgrade stories with only covers/stills to a shorter standard lane;
- replace plain source cards with stronger HyperFrames-style cards;
- make captions punchier and less likely to span two lines;
- use in-image popups for mentioned games and franchises;
- only render a pilot when visual coverage is footage-led.

## Validation

- `npm test`: 1,701/1,701 pass.
- `npm run build`: pass.

Safety boundary: all changes are local/reporting/proof tooling only. Nothing was deployed.
