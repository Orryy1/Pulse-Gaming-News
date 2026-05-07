# Analytics And Learning Status

Generated: 2026-05-07

## Plain-English Verdict

Pulse has the foundation of a learning system, but it is not yet plugged into full YouTube Studio analytics in the way a serious creator-studio growth loop needs.

Right now the system can analyse public counters, local performance rows, fixture snapshots and comment signals. It can produce recommendations, viewer-signal digests and draft-only comment intelligence. It does not yet have retention curves, traffic-source breakdowns, audience graphs or rich Creator Studio analytics active.

Verdict: `AMBER`

## What Works Today

- Public YouTube counters are active.
- Local platform metric history exists.
- Learning digest generation works.
- Comment intelligence works in draft-only mode.
- Recommendations are report-only and do not change scoring weights.
- Comment drafts are never sent automatically.
- Moderation flags are never actioned automatically.

Current local outputs:

- `test/output/analytics_capability_doctor.md`
- `test/output/learning-digest/digest-2026-05-07.md`
- `test/output/comment-digest/comments-2026-05-07.md`
- `test/output/comment-digest/reply-queue-2026-05-07.json`
- `test/output/comment-digest/viewer-signals-2026-05-07.json`

## What Is Missing

- Detailed YouTube Analytics scope is not active.
- Rich retention rows: `0`
- Video performance rows: `0`
- Traffic-source data is not active.
- Audience-retention graphs are not active.
- True machine-learning feedback into scoring is not enabled.

The analytics doctor reports:

- Detailed YouTube Analytics: `requires_youtube_scope_reauth`
- Learning dataset: `public_counter_history_only`
- Platform metric rows: `330`

## Why This Matters

For Pulse to become a real growth machine, it needs to learn from:

- which openings keep viewers watching;
- which topics create comments and subscribers;
- which visual lanes hold attention;
- which runtimes outperform;
- where viewers drop off;
- which upload routes create real reach.

The current system can start that process, but it cannot yet see the deepest YouTube Studio signals.

## Safety Boundaries

No live-risk action was taken.

- No OAuth was triggered.
- No tokens were printed.
- No production DB rows were changed.
- No social posting happened.
- No scoring weights were changed.
- No auto-replies, likes or moderation actions were run.

## Text Hygiene Fix

The learning and comment reports now have automated tests that prevent public Markdown from containing mojibake markers such as `â`, `Â` or `PokÃ`.

This matters because malformed encoding is the same class of quality problem as public-facing text saying `Pokmon` instead of `Pokemon` or `Pokemon` instead of `Pokémon`.

## Morning Approval Item

Decision needed: approve a YouTube OAuth re-auth for analytics read scope when Martin is ready.

Why it matters: this unlocks detailed Creator Studio analytics ingestion.

What changes: the YouTube token would gain `yt-analytics.readonly` access. It should still be read-only and should not upload, edit or delete videos.

Risk: OAuth/token handling is live-account work, so it should be done deliberately and never logged.

Rollback: keep the current token and continue with public-counter learning only.

Recommendation: approve this after the current local build is committed and pushed, because the growth loop needs real retention and traffic-source data.

## Next Safe Build

Build a read-only YouTube Analytics ingestion packet:

- scope checklist;
- token-status doctor;
- retention snapshot schema;
- traffic-source snapshot schema;
- local fixture tests;
- no OAuth trigger by default;
- operator command for re-auth only when approved.

