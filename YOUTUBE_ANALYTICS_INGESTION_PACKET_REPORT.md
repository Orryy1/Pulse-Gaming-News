# YouTube Analytics Ingestion Packet Report

Generated: 2026-05-07

## What Was Built

A read-only YouTube Analytics ingestion packet was added so Pulse can safely prepare for deeper Creator Studio learning without triggering OAuth or touching live publishing.

New command:

```text
npm run ops:youtube-analytics-packet
```

Useful local dry-run:

```text
npm run ops:youtube-analytics-packet -- --fixture --limit 3
```

## What It Plans

For each video, the packet prepares two YouTube Analytics API query shapes:

- retention curve: `elapsedVideoTimeRatio` with `audienceWatchRatio` and `relativeRetentionPerformance`;
- traffic source: `insightTrafficSourceType` with views, watch time, average view duration and average percentage viewed.

The packet also defines the normalised local schemas Pulse should write later:

- retention rows: `video_id`, `elapsed_video_time_ratio`, `audience_watch_ratio`, `relative_retention_performance`;
- traffic-source rows: `video_id`, `traffic_source_type`, `views`, `estimated_minutes_watched`, `average_view_duration_seconds`, `average_percentage_viewed`.

## Current Local Result

Real-token diagnostic mode currently reports:

- Verdict: `BLOCKED`
- Status: `requires_youtube_scope_reauth`
- Queries planned: `6`
- Output Markdown: `test/output/youtube_analytics_ingestion_packet.md`
- Output JSON: `test/output/youtube_analytics_ingestion_packet.json`

This is expected. The token does not currently have the detailed YouTube Analytics read scope active.

## Safety Boundaries

- No OAuth was triggered.
- No YouTube network request was made by the packet.
- No tokens were printed.
- No production DB rows were mutated.
- No scoring weights were changed.
- No upload, publish, edit, delete or comment action was triggered.

## What Remains Approval-Gated

Detailed analytics ingestion needs Martin to approve a YouTube OAuth re-auth with:

```text
https://www.googleapis.com/auth/yt-analytics.readonly
```

That is a live-account token action, so it is queued in `MORNING_APPROVAL_QUEUE.md`.

## Validation

- `node --test tests/services/youtube-analytics-ingestion-packet.test.js`: pass (`8/8`)
- Fixture packet generation: pass
- Real-token diagnostic packet generation: pass, blocked safely

## Recommendation

Keep this packet local-only for now. Once Martin approves the analytics re-auth, run a read-only ingestion proof against a small set of already-published Shorts and inspect retention drop-off before letting any learning recommendations influence production scoring.
