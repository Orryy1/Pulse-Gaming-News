# Longform Overnight Architecture Report

Generated: 2026-05-08T09:10:24.926Z
Selected format: Weekly Roundup
Status: insufficient_segments

## What Was Built

- A local-only longform candidate selector.
- A production dossier with segments, source pack, chapter plan, visual plan, shot list, SEO package and Shorts spin-off plan.
- A fixture prototype that does not upload, schedule or write production DB rows.

## Lane Strategy

- Pulse Flash Lane: 61-75s high-energy Shorts, punch captions, rapid topic cards and game-footage backbone.
- Pulse Briefing Lane: weekly and monthly formats with mini-documentary rhythm, chapter cards, calmer narration, source timelines and richer context.
- Shared intelligence layer: research, fact-checking, media inventory and analytics stay common, while script rules, render rules and QA gates differ per format.

## Format Ladder

- Weekly Roundup: 6-10 minutes - Rank the week's strongest gaming stories by consequence and audience demand.
- Monthly Release Radar: 10-15 minutes - Preview dated releases with source-backed dates, platforms and player utility.
- Trailer Breakdown: 6-10 minutes - Turn official trailer footage into a frame-led explanation.
- Before You Download: 5-8 minutes - Help players decide whether a release is worth their time or money.
- Daily Briefing: 2-4 minutes - Compress the day's important stories into one source-backed briefing.

## Candidate Selector

- 92: Subnautica 2 release times confirmed for PC and Xbox -> monthly_release_radar (confirmed, media=premium_video)
- 80: FF14 director confirms Nintendo Switch 2 is being explored -> weekly_roundup (verified, media=standard_video)
- 75: Xbox CEO responds to Xbox being down this quarter -> weekly_roundup (verified, media=standard_video)
- 71: The Outer Worlds Spacer's Choice Edition receives performance fixes -> weekly_roundup (verified, media=standard_video)
- 69: New York age verification law puts new pressure on game platforms -> daily_briefing (verified, media=standard_video)
- 65: All the evidence that GTA 6's next trailer is nearly here -> daily_briefing (rumour, media=standard_video)
- 43: Mystery horror game may launch next month -> daily_briefing (rumour, media=blog_only)

## Fact Safety

- No selected-segment fact flags.

Deferred candidate flags:
- rumour_must_be_labelled
- unsupported_release_date:rss_unsupported_release

## Promotion Notes

- This is architecture and a local prototype only.
- No longform upload was made.
- No scheduler changes were made.
- Monthly Release Radar still needs official date and platform verification before public use.
- Weekly Roundup is the safest first longform format once enough visual coverage exists.
