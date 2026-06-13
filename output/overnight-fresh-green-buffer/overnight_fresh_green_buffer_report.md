# Overnight Fresh GREEN Buffer Report

Generated: 2026-06-13T00:27:36.293Z

## Verdict

PARTIAL for live uploading, PASS for candidate buffer.

The fresh candidate buffer now has 5 scheduler-preflight candidates and strict dry-run exposes 15 enabled-platform actions for YouTube Shorts, Instagram Reels and Facebook Reels with 0 blocked actions.

Live uploads remain held because publish readiness is RED while the local/public runtime health endpoint is unreachable and a public script-validation fallback row repair is still required before clean resume. No publishing, DB mutation, credential mutation or disabled-platform enablement was performed.

## Counts

- Fresh bridge candidates: 5
- Scheduler preflight pass: 5
- Strict dry-run ready stories: 5
- Strict dry-run blocked stories: 0
- Enabled-platform dry-run actions: 15
- Deferred disabled-platform actions: 20
- Blocked actions: 0

## Upload Timing

The next canonical scheduler window is 2026-06-13 09:00 UTC / 10:00 UK, but only if publish readiness is non-red before that window. If the runtime and public-row repair are not cleared before 10:00 UK, the next clean windows are 15:00 UK and 20:00 UK.

## Remaining Live Blockers

- localhost/public API health is unreachable on port 3001.
- Public script-validation fallback row repair is required for clean resume.
- TikTok/X/Threads/Pinterest remain deferred and must not be counted as live.

## Safety

No manual publish was triggered. No production DB rows were mutated. No OAuth, token, billing or platform settings were changed.
