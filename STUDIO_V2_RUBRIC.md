# Studio Short Engine v2 — success rubric

This is the bar v2 has to clear. Two distinct categories: **automatically measurable** (the engine writes these into a JSON report) and **human-judged** (you decide). Each criterion has a green/amber/red threshold.

The premium lane verdict combines both. A v2 render passes ONLY if it clears every red threshold and clears at least 80% of the green/amber thresholds.

---

## A. Automatically measurable (the engine writes these)

| #   | Criterion            | Metric                                          | Green      | Amber              | Red (premium-lane fail)       |
| --- | -------------------- | ----------------------------------------------- | ---------- | ------------------ | ----------------------------- |
| 1   | Hook word count      | Spoken words in first 1.6s                      | 8–12       | 6–7 or 13–15       | <6 or >15                     |
| 2   | Hook AI-tells        | Regex hits on filler openers                    | 0          | —                  | ≥1                            |
| 3   | Spoken pacing        | WPM over the full narration                     | 130–160    | 110–129 or 161–180 | <110 or >180                  |
| 4   | Source diversity     | Unique topical assets / total scenes            | ≥0.85      | 0.7–0.85           | <0.7                          |
| 5   | Clip dominance       | (clip + clip-frame scenes) / total scenes       | ≥0.55      | 0.4–0.55           | <0.4                          |
| 6   | Scene variety        | Distinct scene types in the slate               | ≥6         | 4–5                | <4                            |
| 7   | Repetition control   | Max times a still source is used                | 1          | 2                  | ≥3                            |
| 8   | Subtitle integrity   | Caption gaps >2s                                | 0          | 1                  | ≥2                            |
| 9   | Card duplication     | Same card type adjacent in slate                | 0          | —                  | ≥1                            |
| 10  | Stock filler count   | Pexels/Bing/Unsplash stills in slate            | 0          | 1                  | ≥2                            |
| 11  | Voice path used      | One of {production, fresh-local, trimmed-local} | production | fresh-local        | trimmed-local with no warning |
| 12  | Motion density       | Cuts/transitions per minute                     | ≥18        | 12–17              | <12                           |
| 13  | Beat awareness       | % of cuts within ±0.15s of a syllable boundary  | ≥0.6       | 0.4–0.6            | <0.4                          |
| 14  | SFX presence         | Distinct SFX events (whoosh/hit/sting)          | ≥3         | 1–2                | 0                             |
| 15  | Bed ducking          | Music drops by ≥6 dB during voice               | yes        | partial            | no                            |
| 16  | Premium-lane verdict | composite of all above                          | pass       | downgrade          | reject                        |

Every entry above has a corresponding key in `STUDIO_V2_RUBRIC.schema.json` and is filled in by the post-render quality gate.

## B. Human-judged (you decide)

These are the things metrics can't catch. The engine prints them as a checklist; you tick or untick each.

| #   | Criterion                            | What to look for                                                                                        |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| H1  | Hook strength                        | First 1–2s makes one specific claim — feels like a creator-studio cold open, not generic suspense       |
| H2  | Edit rhythm                          | Cuts feel deliberate and beat-aware, not metronomic; speed feels right for the content                  |
| H3  | Card polish                          | Typography is crisp; shadows + easings are smooth (no pixel-hard offsets, no linear fades on hero text) |
| H4  | Motion intensity                     | Each scene has visible motion that ties to the audio — push-ins on key beats, not generic Ken Burns     |
| H5  | Sound-design feel                    | SFX feel restrained and intentional, not cheesy; music ducks under voice without pumping                |
| H6  | Subject focus                        | When a face or hero shot appears, it's centred and held long enough to register                         |
| H7  | Subtitle readability                 | Captions read fast but never feel like a wall; emphasis lands on the right words                        |
| H8  | Slideshow risk                       | At no point does the video read as "still + Ken Burns + still + Ken Burns"                              |
| H9  | Brand consistency                    | One brand mark, one CTA, one tone — never feels like AI mash                                            |
| H10 | Comparable to a human-edited TikTok? | Honest yes/no                                                                                           |

## Premium-lane verdict semantics

The post-render quality gate emits one of three verdicts:

- **`pass`** — every red threshold clear, ≥80% green hits. Eligible to ship as the premium-lane render.
- **`downgrade`** — one or more red trips, but the failure modes can be auto-substituted (e.g. premium card replaced by simpler ffmpeg version). The engine should auto-rebuild as a "simple lane" render and flag what got cut.
- **`reject`** — the source material can't sustain a premium-lane render at all. E.g. zero clips available + ≤2 unique stills. Better to skip than ship a slideshow.

The gate prefers honesty. If a story can't carry a premium short, **reject** is the right answer. Don't fake diversity with crops or recycled stills.

## What's deliberately out of scope

- Per-channel rubric variants (Pulse Gaming vs Stacked vs Signal). v2 ships one rubric; channel-specific tuning is a v3+ problem.
- AB-test framework. v2 produces ONE artifact per story.
- Predictive metrics (estimated retention curve). v2 measures observable structure only.
- Automated lyric/beat alignment with music. v2 only beat-aligns to spoken syllables.
