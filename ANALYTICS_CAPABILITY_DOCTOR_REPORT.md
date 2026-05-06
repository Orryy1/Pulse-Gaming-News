# Analytics Capability Doctor Report

Generated locally on branch `codex/readiness-qa-failure-window`.

## What was built

- Added a read-only analytics capability doctor command:
  - `npm run ops:analytics-doctor`
- Added a safe YouTube Analytics report mapper so real `reports.query` responses become usable growth fields:
  - views
  - watch time seconds
  - average view duration
  - average percentage viewed
  - likes
  - comments
  - subscribers gained
- Added tests proving token inspection does not leak token values and that real YouTube Analytics rows are mapped correctly.

## Current verdict

AMBER.

Pulse is not yet plugged into full YouTube Creator Studio analytics as an active scheduled learning loop.

The current live analytics path mainly uses:

- YouTube public counters: views, likes, comments
- TikTok counters when tokens/routes are valid
- Instagram counters when Graph insights are available
- local/fixture learning reports

The richer Creator Studio-style metrics are prepared but not active yet:

- watch time
- average view duration
- average percentage viewed
- subscribers gained per video
- traffic source
- Shorts feed source
- retention curve data

## Local doctor result

Latest local read-only run:

- Public YouTube counters: active
- Detailed YouTube Analytics: requires YouTube scope re-auth
- Scheduled learning loop: public counts only
- Platform metric rows: 330
- Rich retention rows: 0
- Video performance rows: 0

Output files:

- `test/output/analytics_capability_doctor.md`
- `test/output/analytics_capability_doctor.json`

## Why this matters

Views and comments tell us what got attention. Retention and watch time tell us whether the video actually held people.

For the growth goal, Pulse needs both:

- public counters for reach and engagement
- Creator Studio analytics for retention, watch quality and subscriber gain

Without the second layer, the system can spot rough winners but cannot reliably learn which hooks, subtitles, pacing, runtime classes and visual lanes are genuinely retaining people.

## Safety boundaries

This build did not:

- trigger OAuth
- print token values
- mutate production DB rows
- change scoring weights
- change publishing behaviour
- deploy anything

## Next step

When ready, the operator should re-authorise YouTube with `yt-analytics.readonly` so the already-built analytics client can pull proper Creator Studio metrics. After that, the next safe build is a dry-run YouTube Analytics ingest command that populates local `video_performance_snapshots` and upgrades the learning digest from public-counter learning to retention-aware learning.
