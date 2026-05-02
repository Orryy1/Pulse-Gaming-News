# Studio V2 Trailer Segment Safety

Generated: 2026-05-01

## What Changed

Official trailer clip references are no longer selected by "latest accepted frame wins" alone.

The selector now:

- rejects text-heavy rating/title cards even when logo detection misses them;
- rejects frames already carrying blur or low-detail warnings;
- scores safe trailer frames by visual detail, saturation, text burden and start position;
- chooses the highest-quality safe frame per trailer source;
- keeps the later frame only as a tie-breaker when quality is effectively equal;
- records `segment_selection_policy` and `segment_quality_score` in clip provenance.

## Why

The local enriched proof showed rating cards, trailer intro boards and strange low-information frames. Those can pass a basic "accepted frame" check but still look poor in a creator-style Short.

This change makes the clip reference layer more editor-like: it prefers frames that look like actual game footage and refuses obvious platform/rating/text boards before the renderer sees them.

## Safety Boundary

This is local/reporting/render-prep logic only.

It does not:

- download trailer/video clips;
- use browser scraping;
- use yt-dlp;
- touch Railway;
- mutate production DB rows;
- trigger OAuth;
- post to any platform;
- switch Studio V2 into production.

## Validation

- `node --test tests/services/official-trailer-clip-refs.test.js`: pass
- `node --test tests/services/controlled-frame-extraction-worker.test.js tests/services/studio-v2-still-deck-ingestion.test.js tests/services/official-trailer-clip-refs.test.js`: pass

## Remaining Risk

This still depends on the extracted frame sample quality. The next proper proof should sample multiple candidate timestamps per trailer, then choose a short segment from the best motion-rich region rather than relying on one frame per source.
