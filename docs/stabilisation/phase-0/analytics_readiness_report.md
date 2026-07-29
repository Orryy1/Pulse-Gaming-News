# Phase 0 Analytics Readiness Report

> **LIVE ANALYTICS NOT VERIFIED.** Schema and client capabilities exist, but current OAuth scope, API access, data quality and production snapshots were not inspected.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Static YouTube/platform analytics capability, controlled-experiment candidate and evidence gaps |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `docs/analytics-feedback-first-pass.md and PULSE_INTELLIGENCE_MONETISATION_PASS.md for current readiness status; those files remain historical design evidence` |
| superseded_by | `none` |
| authoritative | `false` |

After expiry, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Readiness summary

| Layer | Source evidence | Current readiness |
|---|---|---|
| Basic story analytics | `analytics_snapshots` schema and application code | live data unknown |
| Platform time series | migration `015`, repository and analytics writes | live rows unknown |
| Intelligence layer | migration `017`, clients and models | data quality unknown |
| Live performance model | migration `018` and analysis code | enablement and history unknown |
| YouTube Analytics client | committed read-only client declares `yt-analytics.readonly` and does not initiate OAuth | existing token scope unknown |
| OAuth request scopes | `upload_youtube.js` requests `yt-analytics.readonly` for future authorisation | existing saved token does not gain scope automatically; actual scope unknown |
| Controlled experiments | committed migration `021`, repositories and evidence-bound ingestion/adapter services | live dataset and operator mapping unknown |
| Retention derivation evidence | committed migration `022` and repository/test support | live dataset, derivation provenance and operator mapping unknown |
| Dashboard/API | authenticated analytics endpoints exist in `server.js` | runtime behaviour unknown |

## Scope inspection

Source inspection confirms the repository contains the scope string:

```text
https://www.googleapis.com/auth/yt-analytics.readonly
```

That proves only that code can request or require the scope. No OAuth flow was started, no token file was opened and no token introspection or YouTube API request was made. The current credential may predate the scope.

## Minimum useful dataset

Phase 1 should import a small read-only sample of five already-published Shorts and manually reconcile:

- platform video ID and story ID
- publish timestamp and timezone
- views and engaged views
- stayed-to-watch or equivalent metric definition
- average percentage viewed
- retention curve or supported retention checkpoints
- traffic sources
- subscribers gained
- likes, comments and shares where available
- snapshot time and query parameters

Metric names must retain their API definition. Do not silently map unavailable metrics to approximate fields.

## Data quality checks

Before optimisation:

1. confirm each platform ID resolves to the expected public Short
2. compare a small sample with YouTube Studio
3. record timezone and reporting delay
4. distinguish cumulative metrics from period metrics
5. preserve query dimensions, filters and date range
6. store immutable raw response evidence with secrets and personal data excluded
7. reject duplicate snapshots and impossible negative deltas
8. document unavailable fields rather than filling them with zero

## Controlled experiment boundary

The baseline commits `021_controlled_experiment_analytics.sql`, `022_youtube_retention_derivation_evidence.sql`, experiment repositories and evidence-bound YouTube analytics ingestion/adapters. This source capability does not prove a live API, token scope, deployed migration or populated dataset.

Before promotion they need:

- migration `021` and `022` deployment review
- clean-create and upgrade tests
- repository boundary tests
- fixture-based API mapping tests
- read-only credential handling review
- one small operator-verified sample
- explicit experiment assignment and immutability rules
- no model changes until the sample window is complete

## Learning policy

Pulse should first beat its own trailing median. Do not invent universal benchmarks. Complete the planned 12-video controlled sample before promoting a content lane or changing the scoring model based on individual outcomes.

Candidate metrics include stayed-to-watch, average percentage viewed, three-second retention, subscribers per 1,000 engaged views, shares per 1,000 engaged views and returning-viewer rate. Availability is platform and query dependent.

## Decision

Source plumbing is promising but live analytics readiness cannot be established. OAuth scope, five-video mapping, production data quality and experiment schema promotion remain open.
