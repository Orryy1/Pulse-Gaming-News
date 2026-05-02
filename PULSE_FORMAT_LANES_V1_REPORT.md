# Pulse Format Lanes v1

Generated: 2026-05-01

## What changed

Pulse Creator Studio OS now reports a format-lane policy for each production packet.

The two production lanes are:

- Pulse Flash Lane: 61-75s Shorts, TikTok-native pacing, punch captions, rapid topic cards, creator-style overlays and a game-footage backbone.
- Pulse Briefing Lane: 6-15 minute weekly/monthly/documentary formats with calmer narration, chapters, source timelines, fact-check callouts and stronger context.

This is a read-only control/reporting layer. It does not switch renderers, enable hard gates, post anything or change Railway.

## Shared Intelligence Layer

Both lanes use the same underlying intelligence:

- story dossier
- source and fact-check pack
- media inventory
- exact-subject readiness
- platform route plan
- learning hook

The lane policy changes script, runtime, render and QA expectations without duplicating the research systems.

## Pulse Flash Lane Rules

- Runtime target: 61-75 seconds.
- Platform targets: TikTok dispatch, YouTube Shorts and Instagram Reels.
- Script rules: concrete consequence hooks, first-two-second hook, first-eight-second proof/context, one editorial angle and no weak "could/might" hook framing.
- Captions: punch style, preferably one line, max three words per punch.
- Render rules: game footage, official trailer frames and exact-subject game art should drive the video.
- QA gates: approved voice, 60s runtime, exact-subject visuals, no wrong-story assets, subtitle energy and outro.

## Pulse Briefing Lane Rules

- Runtime target: 6-15 minutes.
- Platform targets: YouTube longform, blog and newsletter.
- Script rules: source timeline, chaptered structure, calmer narration, context before opinion and explicit uncertainty labels.
- Render rules: chapter cards, source timelines, fact-check callouts, context cards and branded outro.
- QA gates: source pack, fact-check, chapter cards, source timeline and clear uncertainty labels.

## Safety Boundaries

- No production render default changed.
- No Studio V2 production switch.
- No Railway/env/OAuth/token changes.
- No production DB mutation.
- No social posting.
- No hard gates enabled.

## Next Recommended Build

Build the Pulse Flash Lane renderer contract locally:

1. fix approved voice selection so demonic local TTS cannot pass;
2. make footage/clip dominance a hard local QA blocker for Flash proofs;
3. redesign captions into one-line punch captions;
4. replace bland static cards with creator-style popups and HyperFrames-style moment cards;
5. render one local proof only after the packet is Flash-lane eligible.
